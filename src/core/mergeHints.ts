/**
 * WHICH MERGE TO POINT AT — the decidable half of the idle hint.
 *
 * A player who looks away comes back to a board they have to re-read. The hand
 * exists for that moment: after a stretch of nothing happening, it points at
 * ONE merge that is sitting there ready to be made. Not a list, not a glow on
 * everything mergeable — one, because a hint that highlights six things is the
 * same problem as no hint at all.
 *
 * WHICH one is the whole question, and the answer is FIRST COMPLETED. A board
 * late in a session holds many possible merges; showing the biggest, or the
 * highest tier, or the nearest, all pick a favourite the player did not. The
 * set that has been sitting ready the LONGEST is the one they are most likely
 * to have forgotten, and it is also the only ordering that is stable — it does
 * not change when something new drops on the far side of the isle.
 *
 * "Longest" without storing a timestamp: item ids come from one increasing
 * counter, so a set's completing id — the highest id among the pieces that
 * first made it mergeable — IS its completion order. Sorting by that is exact,
 * survives a save/load, and costs nothing to keep up to date.
 *
 * Phaser-free on purpose (like worldArt.ts and dragonClips.ts): what the hand
 * should point at is a rule the unit tests can check, and the scene spends a
 * couple of lines pointing it.
 */
import type { BoardItemState, ChainConfig, ChainsData, TilePos } from './types';

/**
 * THE BOARD THE PLANNER REASONS ABOUT.
 *
 * Injected rather than imported, for the same reason this whole file is
 * Phaser-free: what the hand should ask for is a rule, and a rule is worth
 * nothing if it can only be checked by looking at a screenshot. The unit tests
 * hand it a fixture; BoardScene hands it `GameState` + `world.ts`.
 *
 * `neighbors` and `zoneOf` are the two that matter. A merge is an
 * ORTHOGONALLY-CONNECTED flood (MergeSystem.collectGroup) and adjacency never
 * leaves a zone (world.ts `neighborsOf`), so three pieces in two zones cannot
 * be merged by any gesture at all — a fact the hint has to know before it
 * points at them.
 */
export interface HintBoard {
  /** Playable ground of the ACTIVE world — a piece may be dropped here. */
  isActive(col: number, row: number): boolean;
  /** Who is standing here, if anyone. */
  itemIdAt(col: number, row: number): number | null;
  /** Orthogonal neighbours; never crosses into another zone. */
  neighbors(col: number, row: number): TilePos[];
  /** Which zone owns this cell. Two pieces in different zones never merge. */
  zoneOf(col: number, row: number): string | undefined;
}

/** One drag: pick up `itemId`, drop it on `to`. */
export interface MergeStep {
  itemId: number;
  to: TilePos;
  /**
   * True on the LAST step only — the drop that actually fuses.
   *
   * Every other step lands on a FREE cell, which is the whole safety property
   * of a plan: a drop on free ground always succeeds, so no step the hand asks
   * for can bounce. Only the final one is allowed to land on a piece.
   */
  completes: boolean;
}

/** A merge, broken into the drags that actually make it happen. */
export interface MergePlan extends MergeHint {
  steps: MergeStep[];
}

export interface MergeHint {
  chain: string;
  tier: number;
  /** How many pieces the merge needs — the chain's rule, not the global one. */
  need: number;
  /** The pieces to point at, oldest first. Exactly `need` of them: pointing at
   *  a seventh Dew Drop teaches nothing the first three did not. */
  ids: number[];
  /**
   * The id that completed the set. This orders the queue, and it is also what
   * makes the hint STABLE: the same board always yields the same hint, whatever
   * order the items happen to be iterated in.
   */
  completedBy: number;
  /**
   * THE PIECE TO MOVE — the one standing apart from the rest of the set.
   *
   * A merge is one gesture with two roles: pieces that are already together,
   * and the one that has to travel to them. Naming it is what lets the hand
   * point the right way round, and what lets the board give that piece a nudge
   * so the eye finds it across the isle.
   *
   * Always a member of `ids`. When the set is evenly spread there is no real
   * outlier and this is simply the farthest from their middle, broken by id so
   * the same board always answers the same way.
   */
  moveId: number;
}

/** Squared cell distance. Squared because nothing here needs the real length —
 *  only the ORDER — and a square root per pair buys nothing. */
function gap(a: BoardItemState, b: BoardItemState): number {
  return (a.col - b.col) ** 2 + (a.row - b.row) ** 2;
}

/**
 * The `need` pieces that are actually TOGETHER, out of a bucket that may hold
 * many more.
 *
 * This used to be `ids.slice(0, need)` — the oldest ones, position ignored.
 * With five Dew Drops on one board that reliably picked three scattered across
 * the isle and drew a line between two of them, which reads as the hint being
 * WRONG rather than the hint being far: the player looks at a pair sitting side
 * by side and is pointed at neither.
 *
 * Chooses by tightness: every piece is tried as the anchor, the `need − 1`
 * nearest join it, and the cheapest cluster wins. Exhaustive over a bucket
 * (never more than a boardful) and exact for the sizes a merge ever asks for.
 * Ties go to the set that has been ready LONGEST, which is the ordering the
 * queue was already built on.
 */
function tightest(bucket: BoardItemState[], need: number): BoardItemState[] {
  if (bucket.length <= need) return [...bucket];
  let best: BoardItemState[] = [];
  let bestCost = Infinity;
  let bestAge = Infinity;
  for (const anchor of bucket) {
    const group = [...bucket]
      .sort((a, b) => gap(a, anchor) - gap(b, anchor) || a.id - b.id)
      .slice(0, need);
    const cost = group.reduce((sum, p) => sum + gap(p, anchor), 0);
    const age = Math.max(...group.map((p) => p.id));
    if (cost < bestCost || (cost === bestCost && age < bestAge)) {
      bestCost = cost;
      bestAge = age;
      best = group;
    }
  }
  return best;
}

/** The odd one out: the piece whose distance to the others is largest. Ties by
 *  id, so an evenly spread set still names one piece and always the same one. */
function outlier(group: BoardItemState[]): BoardItemState {
  let worst = group[0]!;
  let worstCost = -1;
  for (const p of group) {
    const cost = group.reduce((sum, q) => sum + gap(p, q), 0);
    if (cost > worstCost || (cost === worstCost && p.id > worst.id)) {
      worstCost = cost;
      worst = p;
    }
  }
  return worst;
}

/** The merge size for a chain+tier: the tier's own override, else the chain's,
 *  else the global rule — the same precedence MergeSystem applies. */
function needFor(config: ChainConfig, tier: number, data: ChainsData): number {
  return config.tiers.find((t) => t.tier === tier)?.merge?.group ?? config.merge?.group ?? data.mergeRule.minGroup;
}

/**
 * Every merge the board can currently make, in the order they became possible.
 *
 * WHETHER a merge exists is still blind to position — two Dew Drops on opposite
 * corners are as mergeable as two side by side, and dragging one onto the other
 * is exactly the move the hand is there to suggest. Adjacency is MergeSystem's
 * business at the moment of the drop, not the hint's.
 *
 * WHICH pieces to point at is not, and used to be. That is the difference
 * between "this merge is available" and "here is the move", and getting it
 * wrong makes the hand look broken rather than helpful.
 */
export function mergeHints(
  items: Iterable<BoardItemState>,
  data: ChainsData,
  board?: HintBoard
): MergeHint[] {
  // BUCKETED BY ZONE when a board is given, and that is not a detail.
  //
  // The flood that merges never leaves a zone, so a chain+tier with two pieces
  // on one isle and two on another has no mergeable set at all — while a
  // zone-blind bucket counts four and offers a move nothing can complete.
  const byKey = new Map<string, { chain: string; tier: number; items: BoardItemState[] }>();
  for (const item of items) {
    if (item.kind !== 'item') continue; // decor never merges
    const zone = board?.zoneOf(item.col, item.row) ?? '';
    const key = `${item.chain}:${item.tier}:${zone}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.items.push(item);
    else byKey.set(key, { chain: item.chain, tier: item.tier, items: [item] });
  }

  const hints: MergeHint[] = [];
  for (const { chain, tier, items: bucket } of byKey.values()) {
    const config = data.chains.find((c) => c.id === chain);
    if (!config) continue;
    // The top of a chain has nowhere to go. Merging it is not a move the player
    // is failing to notice — it is not a move at all.
    if (!config.tiers.some((t) => t.tier === tier + 1)) continue;
    const need = needFor(config, tier, data);
    if (bucket.length < need) continue;
    const group = tightest(bucket, need);
    const ids = group.map((i) => i.id).sort((a, b) => a - b);
    hints.push({
      chain,
      tier,
      need,
      ids,
      completedBy: ids[need - 1]!,
      moveId: outlier(group).id
    });
  }
  return hints.sort((a, b) => a.completedBy - b.completedBy);
}

/**
 * The one merge to point at, or null when the board has none.
 *
 * `skip` lets the caller pass over sets the player has already been shown and
 * left alone — a hand that points at the same untouched pair every ten seconds
 * stops being help and becomes nagging.
 */
export function nextMergeHint(
  items: Iterable<BoardItemState>,
  data: ChainsData,
  skip: ReadonlySet<number> = new Set()
): MergeHint | null {
  const all = mergeHints(items, data);
  return all.find((h) => !skip.has(h.completedBy)) ?? null;
}

/* ========================================================================= *
 *                              THE PLAN                                     *
 *                                                                           *
 * A hint says WHICH merge. A plan says HOW, and on a spread board those are
 * not the same thing at all.
 *
 * The hand used to be told "drag this piece onto that one", and with three
 * pieces standing apart that is a gesture the game REFUSES: dropping onto an
 * occupied cell goes through MergeSystem's `tryMergeOnto`, whose `performMerge`
 * returns false when the group is short of `minGroup` — so the piece bounces
 * straight home. The player followed the hand exactly and the board undid it.
 *
 * A plan is a sequence of drags with ONE invariant that makes every step safe:
 *
 *      every step but the last lands on FREE ground; only the last lands on,
 *      or completes, a cluster.
 *
 * A drop on free active ground always succeeds, so nothing the hand asks for
 * can be refused, and the final drop is guaranteed to fuse by construction:
 * the cells were chosen as a CONNECTED shape, so once the others are standing
 * on it the flood from the last cell walks the whole set.
 *
 * The shape is the other half. A merge does not need pieces "near" each other,
 * it needs them orthogonally adjacent — so the planner does not look for an
 * empty cell, it looks for `need` connected empty-or-ours cells, and then asks
 * which assignment of pieces to that shape costs the fewest DRAGS. Drags, not
 * distance: a drag crosses the isle as easily as it crosses one tile, so the
 * player's real cost is how many times they have to pick something up.
 * ========================================================================= */

const cellKey = (col: number, row: number): string => `${col},${row}`;

/** Chebyshev cell distance — the tiebreak, never the cost. One drag is one
 *  drag whatever it crosses; this only decides which of two equal plans asks
 *  for the shorter swipe. */
function reach(a: TilePos, b: TilePos): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

/**
 * Every connected shape of `size` cells containing `seed`.
 *
 * Grown one neighbour at a time through the board's OWN adjacency, so a shape
 * can never span two zones and can never include a cell the flood would not
 * walk. Deduped by its sorted cells, because the same shape is reached by as
 * many paths as it has cells.
 *
 * Bounded and small: `size` is 2..5 and a cell has at most four neighbours, so
 * this is a few dozen shapes per seed — cheap enough to run over every seed
 * without a second thought, and it runs once per hint, not per frame.
 */
function shapesFrom(
  seed: TilePos,
  size: number,
  board: HintBoard,
  usable: (cell: TilePos) => boolean
): TilePos[][] {
  if (!usable(seed)) return [];
  const found = new Map<string, TilePos[]>();
  const shape: TilePos[] = [seed];
  const held = new Set<string>([cellKey(seed.col, seed.row)]);
  const grow = (): void => {
    if (shape.length === size) {
      const key = [...held].sort().join('|');
      if (!found.has(key)) found.set(key, shape.map((c) => ({ col: c.col, row: c.row })));
      return;
    }
    for (const cell of [...shape]) {
      for (const n of board.neighbors(cell.col, cell.row)) {
        const k = cellKey(n.col, n.row);
        if (held.has(k) || !usable(n)) continue;
        held.add(k);
        shape.push(n);
        grow();
        shape.pop();
        held.delete(k);
      }
    }
  };
  grow();
  return [...found.values()];
}

/** Permutations of a small list — the movers over the shape's free cells.
 *  `need` never exceeds a handful, so this is at most 24 arrangements. */
function permutations<T>(list: T[]): T[][] {
  if (list.length <= 1) return [list];
  const out: T[][] = [];
  list.forEach((item, i) => {
    const rest = [...list.slice(0, i), ...list.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([item, ...tail]);
  });
  return out;
}

interface Candidate {
  moves: number;
  travel: number;
  key: string;
  steps: MergeStep[];
}

/**
 * The cheapest way to bring one set of pieces onto one shape.
 *
 * A piece whose own cell is part of the shape STAYS THERE — it is not assigned
 * a target, which is what keeps a plan free of swaps. (Two pieces trading
 * cells would need an intermediate drop onto an occupied tile, and that is the
 * one move that bounces.) Every other piece is a mover, and the shape's free
 * cells are exactly as many as there are movers.
 *
 * Order: the LONGEST haul first, the fuse last. The awkward journey happens
 * while the player is still reading the board, and the gesture that pays off —
 * the one that turns three into one — is a short flick. That is how a merge
 * game feels, and it costs nothing to arrange because any order is legal:
 * after k < need pieces are standing on the shape, the connected group is k,
 * so no intermediate drop can fuse early.
 */
function planOnShape(pieces: BoardItemState[], shape: TilePos[], board: HintBoard): Candidate | null {
  const shapeKeys = new Set(shape.map((c) => cellKey(c.col, c.row)));
  const movers = pieces.filter((p) => !shapeKeys.has(cellKey(p.col, p.row)));
  const free = shape.filter((c) => board.itemIdAt(c.col, c.row) === null);
  if (free.length !== movers.length) return null; // a foreign piece is standing on it
  const key = [...shapeKeys].sort().join('|');

  // ALREADY IN SHAPE. Three pieces can end up connected without ever merging —
  // a producer drops one beside two — because a merge only ever happens on a
  // DROP. One gesture still finishes it: pick any of them up and put it on a
  // neighbour of its own set, which is the plain merge-game move.
  if (movers.length === 0) {
    for (const p of pieces) {
      const mate = pieces.find(
        (q) => q.id !== p.id && board.neighbors(p.col, p.row).some((n) => n.col === q.col && n.row === q.row)
      );
      if (mate) {
        return {
          moves: 1,
          travel: 0,
          key,
          steps: [{ itemId: p.id, to: { col: mate.col, row: mate.row }, completes: true }]
        };
      }
    }
    return null;
  }
  // A shape holding none of the pieces is a plan that moves ALL of them, and it
  // is deliberately left in: on a crowded board where the only clear ground is
  // away from every piece, three drags is the move. It can never win by
  // accident — `moves` is the first thing candidates are ranked on, so any plan
  // that keeps a piece standing beats it outright.
  let best: { travel: number; order: MergeStep[] } | null = null;
  for (const arrangement of permutations(free)) {
    const legs = movers.map((p, i) => ({ piece: p, to: arrangement[i]!, cost: reach(p, arrangement[i]!) }));
    const travel = legs.reduce((sum, leg) => sum + leg.cost, 0);
    if (best && travel >= best.travel) continue;
    legs.sort((a, b) => b.cost - a.cost || a.piece.id - b.piece.id);
    best = {
      travel,
      order: legs.map((leg, i) => ({
        itemId: leg.piece.id,
        to: { col: leg.to.col, row: leg.to.row },
        completes: i === legs.length - 1
      }))
    };
  }
  return best ? { moves: movers.length, travel: best.travel, key, steps: best.order } : null;
}

/**
 * How to make this particular merge happen, or null if the board cannot.
 *
 * Seeds every shape search from the pieces themselves and from the ground one
 * step around them: the cheapest plan always keeps at least one piece where it
 * stands (a stayer is a drag saved), so a shape that touches none of them is
 * not worth enumerating.
 *
 * Ties break on drags, then on swipe length, then on the shape's own cells —
 * in that order and never on iteration order, so the same board always answers
 * the same way and the hand does not flicker between two equal plans.
 */
export function planFor(hint: MergeHint, items: Iterable<BoardItemState>, board: HintBoard): MergePlan | null {
  const byId = new Map<number, BoardItemState>();
  for (const item of items) byId.set(item.id, item);
  const pieces = hint.ids.map((id) => byId.get(id)).filter((p): p is BoardItemState => !!p);
  if (pieces.length !== hint.need) return null;

  const ours = new Set(pieces.map((p) => p.id));
  const usable = (cell: TilePos): boolean => {
    if (!board.isActive(cell.col, cell.row)) return false;
    const occupant = board.itemIdAt(cell.col, cell.row);
    return occupant === null || ours.has(occupant);
  };

  const seeds = new Map<string, TilePos>();
  for (const p of pieces) {
    seeds.set(cellKey(p.col, p.row), { col: p.col, row: p.row });
    for (const n of board.neighbors(p.col, p.row)) seeds.set(cellKey(n.col, n.row), n);
  }

  let best: Candidate | null = null;
  for (const seed of seeds.values()) {
    for (const shape of shapesFrom(seed, hint.need, board, usable)) {
      const candidate = planOnShape(pieces, shape, board);
      if (!candidate) continue;
      if (
        !best ||
        candidate.moves < best.moves ||
        (candidate.moves === best.moves &&
          (candidate.travel < best.travel || (candidate.travel === best.travel && candidate.key < best.key)))
      ) {
        best = candidate;
      }
    }
  }
  return best ? { ...hint, steps: best.steps } : null;
}

/**
 * The next merge the hand should offer, as the drags that make it.
 *
 * Walks the hint queue in its own order — oldest ready first — and returns the
 * first one the board can actually carry out. A merge with no plan is not
 * skipped for ever, it is skipped for NOW: the board changes, and the set that
 * had nowhere to gather this minute may have room the next.
 */
export function nextMergePlan(
  items: Iterable<BoardItemState>,
  data: ChainsData,
  board: HintBoard,
  skip: ReadonlySet<number> = new Set()
): MergePlan | null {
  const all = [...items];
  for (const hint of mergeHints(all, data, board)) {
    if (skip.has(hint.completedBy)) continue;
    const plan = planFor(hint, all, board);
    if (plan) return plan;
  }
  return null;
}
