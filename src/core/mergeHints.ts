/**
 * WHICH MERGE TO POINT AT — the decidable half of the idle hint.
 *
 * A player who looks away comes back to a board they have to re-read. The hand
 * exists for that moment: after a stretch of nothing happening, it points at
 * ONE merge that is sitting there ready to be made. Not a list, not a glow on
 * everything mergeable — one, because a hint that highlights six things is the
 * same problem as no hint at all.
 *
 * WHICH one is the whole question, and it is answered in two passes, because
 * "which merge exists" and "which merge to ask for" are not the same question.
 *
 * The QUEUE (`mergeHints`) is ordered FIRST COMPLETED. A board late in a
 * session holds many possible merges; ordering by size or by tier picks a
 * favourite the player did not, and ordering by position changes every time
 * anything moves. The set that has been sitting ready the LONGEST is the one
 * they are most likely to have forgotten, and it is the only ordering that
 * does not move under its own board.
 *
 * "Longest" without storing a timestamp: item ids come from one increasing
 * counter, so a set's completing id — the highest id among the pieces that
 * first made it mergeable — IS its completion order. Sorting by that is exact,
 * survives a save/load, and costs nothing to keep up to date.
 *
 * The OFFER (`nextMergePlan`) is not that queue, and has not been for two
 * revisions. First it became the CHEAPEST plannable merge — fewest drags, then
 * the shortest haul — because first-completed is a fact about the board and
 * not a claim about what is easy, and a hand that sends the player on a
 * two-drag gather while a pair sits touching reads as broken rather than as
 * old-fashioned. That fixed the arithmetic. It did not make the hand look like
 * it was thinking, and this revision is about the difference.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY EFFORT ALONE IS NOT ENOUGH — measured, not guessed.
 *
 * Cost is not worth. Ranking by drags-then-haul answers "what is the smallest
 * gesture available" and never asks "and is that the gesture a person would
 * make next". Over 1200 generated mid-session boards (a third to two thirds of
 * the ground carrying six or seven chains, a cluster by the player's last move
 * and a cluster across the map, decor in the way) on Emberkeep / Borealis /
 * Roothold, the effort-only offer was defensible and daft at these rates:
 *
 *   points more than half a screen further from the player's last
 *   action than an equally cheap merge sitting there ........ 20.7 / 23.0 / 22.5 %
 *   points off the visible board while an equally cheap merge
 *   is in frame ............................................ 17.9 / 14.8 /  1.5 %
 *   points at a tier-1 trinket while an equally cheap merge
 *   one tier deeper is available ........................... 17.1 / 48.3 / 43.5 %
 *   points at a chain no standing order wants while an equally
 *   cheap one would fill the Ledger ......................... 2.5 /  8.0 / 13.0 %
 *   points at a trio across the isle when three of the same
 *   kind sit around the player's last move (the bucket only
 *   ever put ONE trio forward) ............................. 15.9 / 16.0 /  0.3 %
 *
 * Two hypotheses did NOT survive contact with the measurement and are written
 * down so nobody re-invents them: the offer does NOT flicker (drop an unrelated
 * piece anywhere on the board and the offer changes identity on 0.3–0.5% of
 * boards, and only when the drop really did change what was cheapest), and the
 * planner never re-offers a DECLINED set on its own account — it cannot, since
 * `skip` is passed by the caller and BoardScene passes none. That last one is a
 * wiring gap, not a ranking defect, and the weight below exists for the day it
 * is wired.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE OFFER, AS PSEUDOCODE. Weights live in `MERGE_HINT_WEIGHTS`.
 *
 *   CANDIDATES
 *     for each chain:tier bucket on the WHOLE WORLD (a move is not zone-bound):
 *       for each piece in the bucket, take the `need` pieces nearest to it
 *       → dedupe → keep the `groupsPerBucket` with the lowest proven drag floor
 *     for each candidate: plan ← planFor(candidate)   (unchanged, still exact)
 *
 *   SCORE(plan), in merit points, higher is better:
 *       − W.drag        × (drags − 1)                    the work it asks for
 *       − W.haul        × d/(d + haulHalf)               d = swipe, in tiles
 *       + W.near        × nearHalf/(nearHalf + f)        f = tiles from where
 *                                                        the player last acted
 *       + W.frame       × [any of it is on screen]
 *       + W.tier        × (tier−1)/(deepest mergeable tier−1)
 *       + W.order       × [it MAKES what a live order still wants]
 *       − W.orderSpend  × [it EATS what a live order still wants]
 *       − W.declined    × min(times shown and ignored, cap)/cap
 *
 *   OFFER ← argmax score, ties broken by first-completed, then by the set's
 *           own sorted ids. Scores are quantised to integers first, so a
 *           rounding artefact falls to the tie-break instead of to iteration
 *           order.
 *
 *   INVARIANT (asserted in MergeHints.spec.ts): W.drag exceeds the sum of every
 *   other weight, so no amount of merit can buy an extra drag. Effort is the
 *   floor the argument stands on; the rest only ever sorts moves that cost the
 *   same. That is also what keeps `dragFloor`'s prune legitimate.
 *
 *   DEGRADES GRACEFULLY. `focus`, `inView`, `wants` and `declines` are OPTIONAL
 *   members of `HintBoard`. A caller that supplies none — every unit fixture,
 *   and BoardScene until the wiring lands — gets a planner that scores drags,
 *   haul and tier depth and nothing else, which is still strictly better than
 *   the ordering it replaces. Nothing throws, nothing is skipped, and the
 *   answer is still total and deterministic.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Phaser-free on purpose (like worldArt.ts and dragonClips.ts): what the hand
 * should point at is a rule the unit tests can check, and the scene spends a
 * couple of lines pointing it.
 */
import { MERGE_HINT_WEIGHTS as W } from './Constants';
import type { BoardItemState, ChainConfig, ChainsData, TilePos } from './types';

/**
 * THE BOARD THE PLANNER REASONS ABOUT — and, now, the PLAYER as well.
 *
 * Injected rather than imported, for the same reason this whole file is
 * Phaser-free: what the hand should ask for is a rule, and a rule is worth
 * nothing if it can only be checked by looking at a screenshot. The unit tests
 * hand it a fixture; BoardScene hands it `GameState` + `world.ts`.
 *
 * The first four members are the BOARD and are required. `neighbors` is the one
 * that matters. A merge is an ORTHOGONALLY-CONNECTED flood
 * (MergeSystem.collectGroup) and adjacency never leaves a zone (world.ts
 * `neighborsOf`), so the SHAPE a plan gathers onto can never span two slabs.
 *
 * A MOVE, however, can. MergeSystem's drop validation asks `isTileActive` and
 * nothing else — no zone test — so a piece may be carried from any slab to any
 * other. Confusing those two rules is what silenced this hint everywhere but
 * the authored isle: pieces were bucketed BY ZONE, which is the merge rule
 * applied to the gather. On Emberkeep's one dense slab that is invisible;
 * Borealis is 38 slabs of at most 9 cells, so three of a kind almost never
 * shared a bucket and the hand simply never came up.
 *
 * Everything after `distance` is OPTIONAL and describes the player's situation
 * rather than the board's shape: where they are working, what they can see,
 * what they are trying to get, and what they have already turned down. Each
 * missing member zeroes exactly one term of the score (see the header), so a
 * caller may supply as many or as few as it can honestly answer.
 */
export interface HintBoard {
  /** Playable ground of the ACTIVE world — a piece may be dropped here. */
  isActive(col: number, row: number): boolean;
  /** Who is standing here, if anyone. */
  itemIdAt(col: number, row: number): number | null;
  /** Orthogonal neighbours; never crosses into another zone. */
  neighbors(col: number, row: number): TilePos[];
  /** Which zone owns this cell. Kept for callers that need it; the planner no
   *  longer buckets on it (see above) — the SHAPE carries the zone rule. */
  zoneOf(col: number, row: number): string | undefined;
  /**
   * How far apart two cells really are, for RANKING only.
   *
   * Index arithmetic is the honest answer on a dense lattice and a number about
   * nothing on a zoned world: slabs are laid out with gutters, so two cells five
   * columns apart may be on different islands. A board that can project its
   * cells should answer in world units; without this the planner falls back to
   * cell distance, which is exactly right for the fixtures and the dense isle.
   *
   * SQUARED, in whatever unit the board thinks in. The planner never compares
   * it across boards and converts it to TILES before it reaches any weight (see
   * `rulerFor`), so the unit only has to be consistent with itself.
   */
  distance?(a: TilePos, b: TilePos): number;
  /**
   * WHERE THE PLAYER IS WORKING — the cell they last acted on.
   *
   * The single most valuable thing the scene can tell the planner, and the
   * whole of the `near` weight. A merge game is played in a neighbourhood: the
   * player drops a piece, looks at what is around it, and drops another. A hand
   * that answers from that neighbourhood looks like it is watching them; a hand
   * that answers from the far corner of the isle looks like it is reading a
   * different board, which is exactly what "il n'est pas logique" describes.
   *
   * Absent = the planner has no idea where the player is and says nothing about
   * it — every candidate scores zero on proximity and the rest of the model
   * decides. Never used as a filter, only as merit: a merge does not stop being
   * worth making because it is far away.
   */
  focus?: TilePos;
  /**
   * CAN THE PLAYER SEE THIS CELL RIGHT NOW — camera, and anything covering it.
   *
   * Only the FIRST offer moves the camera (BoardScene aims once, deliberately:
   * a heartbeat that yanks the view every thirty seconds is the board arguing
   * with the finger). Every re-aim after that speaks from wherever the player
   * chose to be standing, so an offer whose pieces are off screen is a hand
   * pointing at the edge of the world. This is also the right place to hang
   * "under a panel" — a cell behind an open sheet is a cell the player cannot
   * act on, whatever the camera says.
   *
   * Absent = the planner assumes nothing is hidden and the term drops out.
   */
  inView?(col: number, row: number): boolean;
  /**
   * HOW MANY MORE OF THIS PIECE THE PLAYER'S LIVE GOALS STILL WANT.
   *
   * Counted AFTER what is already standing on the board — so a Ledger asking
   * for six Gem Shards with five on the board answers 1, and answers 0 once the
   * sixth arrives. Zero (or absent) means nothing is waiting on it.
   *
   * It cuts both ways, which is the point. A merge that MAKES a wanted piece is
   * what the player is trying to do. A merge that EATS one — three Gem Shards
   * fused while an order still wants six of them — is the hand asking them to
   * walk backwards, and no amount of "it is only one drag" makes that a good
   * suggestion. Both terms are small: an order is a preference, not a rail.
   */
  wants?(chain: string, tier: number): number;
  /**
   * HOW MANY TIMES THIS EXACT SET HAS BEEN OFFERED AND LEFT ALONE.
   *
   * Keyed by `MergeHint.key`, which names the set and not the chain, so a
   * player who ignores one trio of Gem Shards is not read as having refused
   * every trio of Gem Shards. Distinct from `skip`, which is a ban: this is
   * merely enough merit to hand the turn to something else once they have said
   * no `declineCap` times, and it saturates so nothing is buried for ever.
   */
  declines?(key: string): number;
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
  /**
   * HOW FAR THE PLAN ASKS THE PLAYER TO SWIPE, summed over its legs, IN TILES.
   *
   * A real length now, not a squared one: each leg is converted through the
   * board's own step size (`rulerFor`) before it is added, so `travel` reads as
   * "about nine tiles of dragging" on any world and in any fixture. That
   * matters because the score puts it through a saturating curve — a number
   * that is squared on one board and linear on another cannot share a weight.
   *
   * Zero for a set that is already standing connected: nothing has to travel,
   * only the one flick that fuses it.
   */
  travel: number;
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
   * THE SET'S OWN NAME — chain, tier and the exact pieces, in one string.
   *
   * The last tie-break, and the key a caller counts declines against. A bucket
   * of six now puts several trios forward and two of them can share a
   * `completedBy` (both may contain the newest piece), so `completedBy` alone
   * is no longer a total order and the ids have to finish the job.
   */
  key: string;
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
function cellGap(a: TilePos, b: TilePos): number {
  return (a.col - b.col) ** 2 + (a.row - b.row) ** 2;
}

/** The board's own metric when it has one, cell distance when it does not.
 *  Ranking only — never a legality test. */
function metric(board?: HintBoard): (a: TilePos, b: TilePos) => number {
  const d = board?.distance;
  return d ? (a, b) => d.call(board, a, b) : cellGap;
}

/* ------------------------------------------------------------------------- *
 * THE RULER — turning the board's own metric into TILES.
 *
 * Every weight in the score is a number with an opinion about distance:
 * "halved at four tiles", "half-spent at three". A board that answers in
 * squared world units (the game: ~20480 per step) and a board that answers in
 * squared cells (every fixture: 1 per step) cannot share those numbers, and
 * asking the caller to declare its scale is a member somebody will forget to
 * wire — after which the proximity term silently evaluates to zero everywhere
 * and the whole point of this revision quietly stops working.
 *
 * So the scale is MEASURED off the board instead: walk the pieces, ask each one
 * what the metric says about its first neighbour, and take the median. That is
 * the length of one tile step in the board's own unit, whatever that unit is,
 * and it adapts per world without anybody declaring anything. A board where
 * nothing has a neighbour (one-cell islets) has no scale to measure and falls
 * back to 1, which costs nothing: no merge can be planned there anyway.
 * ------------------------------------------------------------------------- */
interface Ruler {
  /** One tile step, in the board's own squared metric. */
  span: number;
  /** Distance in TILES — the unit every weight is written in. */
  tiles(a: TilePos, b: TilePos): number;
}

function rulerFor(items: readonly BoardItemState[], board: HintBoard): Ruler {
  const gap = metric(board);
  // Sorted by id so the median is the same however the caller iterated.
  const cells = [...items].sort((a, b) => a.id - b.id);
  const spans: number[] = [];
  for (const c of cells) {
    const n = board.neighbors(c.col, c.row)[0];
    if (n) spans.push(gap(c, n));
  }
  spans.sort((a, b) => a - b);
  const span = spans.length ? (spans[(spans.length - 1) >> 1] ?? 1) : 1;
  const scale = span > 0 ? span : 1;
  return { span: scale, tiles: (a, b) => Math.sqrt(gap(a, b) / scale) };
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
 *
 * ONE ANSWER, which is why the offer no longer relies on it alone: the tightest
 * trio on the board is not always the trio the player is standing next to, and
 * `groupsIn` below puts the alternatives forward. This still decides what the
 * QUEUE says a bucket's merge is, because a queue with three entries for one
 * chain would be a queue about nothing.
 */
function tightest(bucket: BoardItemState[], need: number, board?: HintBoard): BoardItemState[] {
  if (bucket.length <= need) return [...bucket];
  const gap = metric(board);
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

/**
 * EVERY set a bucket could reasonably put forward — one per anchor, deduped.
 *
 * A bucket of six holds twenty trios and enumerating all of them is both slow
 * and pointless: nineteen of them are the same three pieces with one swapped
 * for a further-away twin. The ones worth planning are the tight ones, and
 * every tight one is "the `need` nearest to SOME piece" — so one candidate per
 * anchor covers the field, at bucket size rather than at the binomial.
 *
 * Returned in a stable order (by the set's own ids) so the caller's ranking,
 * not the iteration, decides which survives the `groupsPerBucket` cut.
 */
function groupsIn(bucket: BoardItemState[], need: number, board?: HintBoard): BoardItemState[][] {
  if (bucket.length <= need) return bucket.length === need ? [[...bucket]] : [];
  const gap = metric(board);
  const seen = new Set<string>();
  const out: BoardItemState[][] = [];
  for (const anchor of bucket) {
    const group = [...bucket]
      .sort((a, b) => gap(a, anchor) - gap(b, anchor) || a.id - b.id)
      .slice(0, need);
    const key = group
      .map((p) => p.id)
      .sort((a, b) => a - b)
      .join('-');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(group);
  }
  return out.sort((a, b) => (a[0]!.id - b[0]!.id) || (a.at(-1)!.id - b.at(-1)!.id));
}

/** The odd one out: the piece whose distance to the others is largest. Ties by
 *  id, so an evenly spread set still names one piece and always the same one. */
function outlier(group: BoardItemState[], board?: HintBoard): BoardItemState {
  const gap = metric(board);
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

/** Build the hint record for one already-chosen set of pieces. */
function hintOf(chain: string, tier: number, need: number, group: BoardItemState[], board?: HintBoard): MergeHint {
  const ids = group.map((i) => i.id).sort((a, b) => a - b);
  return {
    chain,
    tier,
    need,
    ids,
    key: `${chain}:${tier}#${ids.join('-')}`,
    completedBy: ids[need - 1]!,
    moveId: outlier(group, board).id
  };
}

/** Chain+tier buckets across the WHOLE WORLD, skipping what can never merge. */
interface Bucket {
  chain: string;
  tier: number;
  need: number;
  items: BoardItemState[];
}

function bucketsOf(items: Iterable<BoardItemState>, data: ChainsData): Bucket[] {
  // BUCKETED BY CHAIN+TIER, across the whole world — because a MOVE is not
  // zone-bound even though a MERGE is. The zone rule is enforced where it
  // belongs, in `shapesFrom`: the destination shape is grown through the
  // board's own adjacency and therefore always lies on one slab. What may
  // travel onto it is anything the player owns, from anywhere.
  const byKey = new Map<string, { chain: string; tier: number; items: BoardItemState[] }>();
  for (const item of items) {
    if (item.kind !== 'item') continue; // decor never merges
    const key = `${item.chain}:${item.tier}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.items.push(item);
    else byKey.set(key, { chain: item.chain, tier: item.tier, items: [item] });
  }

  const out: Bucket[] = [];
  for (const { chain, tier, items: bucket } of byKey.values()) {
    const config = data.chains.find((c) => c.id === chain);
    if (!config) continue;
    // The top of a chain has nowhere to go. Merging it is not a move the player
    // is failing to notice — it is not a move at all.
    if (!config.tiers.some((t) => t.tier === tier + 1)) continue;
    const need = needFor(config, tier, data);
    if (bucket.length < need) continue;
    out.push({ chain, tier, need, items: bucket });
  }
  return out;
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
 *
 * ONE ENTRY PER BUCKET, still — this is the QUEUE, a reading of what the board
 * holds. The offer looks wider (`groupsIn`), but a queue that listed four
 * different trios of Gem Shards would be listing one fact four times.
 */
export function mergeHints(
  items: Iterable<BoardItemState>,
  data: ChainsData,
  board?: HintBoard
): MergeHint[] {
  const hints: MergeHint[] = [];
  for (const { chain, tier, need, items: bucket } of bucketsOf(items, data)) {
    hints.push(hintOf(chain, tier, need, tightest(bucket, need, board), board));
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

/**
 * The biggest clump these pieces already form, walked through the BOARD'S OWN
 * adjacency — which is the only adjacency that means anything.
 *
 * Not `|Δcol| + |Δrow| === 1`. On the exported worlds a cell's neighbours are
 * whatever the zone graph says they are — Emberkeep as exported today is
 * eighteen zones, where (25,0) neighbours both (23,0) and (20,0) while those
 * two do not touch each other at all. Anything that reasons about "already
 * together" from index arithmetic is reasoning about a lattice the game
 * stopped having, and it will be wrong in exactly the cases that matter.
 *
 * ONE caller, and it is a question about the board as it STANDS: `planOnShape`
 * asking whether the pieces left behind by a pick-up are still one flood. It
 * used to answer a second question too — how many pieces a plan could leave
 * standing, and therefore how few drags a hint could cost — and that reading
 * was simply false. Pieces that stay put do not have to be touching each other;
 * they have to fit inside one connected `need`-cell shape, and the piece that
 * moves may land in the GAP between them. What a set is already touching is not
 * what a set can be gathered onto. The full retraction, and the bound that
 * replaced it, are on `dragFloor`.
 */
function largestCluster(pieces: BoardItemState[], board: HintBoard): number {
  const spots = new Map<string, BoardItemState>();
  for (const p of pieces) spots.set(cellKey(p.col, p.row), p);
  const seen = new Set<string>();
  let biggest = 0;
  for (const [key, start] of spots) {
    if (seen.has(key)) continue;
    seen.add(key);
    let size = 0;
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      size++;
      for (const n of board.neighbors(cur.col, cur.row)) {
        const k = cellKey(n.col, n.row);
        const mate = spots.get(k);
        if (!mate || seen.has(k)) continue;
        seen.add(k);
        queue.push(mate);
      }
    }
    if (size > biggest) biggest = size;
  }
  return biggest;
}

/** A gathering spot: `need` connected cells, plus the identity that names it.
 *  The key is its sorted cells — the shape's own address, which is what breaks
 *  a tie between two equally cheap plans without appealing to iteration order. */
interface Shape {
  key: string;
  cells: TilePos[];
}

/**
 * Every connected shape of `size` usable cells that contains at least one seed
 * — each one enumerated EXACTLY ONCE.
 *
 * Grown one neighbour at a time through the board's OWN adjacency, so a shape
 * can never span two zones and can never include a cell the flood would not
 * walk.
 *
 * "Exactly once" is the only thing that changed, and it is worth stating why,
 * because the obvious version is quadratic in the answer: a 3-cell shape is
 * reached from each of its own cells, and the seeds handed in here are the
 * pieces PLUS the ground around them, so the same shape used to come back — and
 * get planned — up to three times. Two guards remove that. `spent` holds the
 * seeds already walked, and growth refuses them, so a shape containing several
 * seeds is only ever built from the first of them; `seen` catches what is left,
 * the same shape reached twice from one seed by different orders of growth.
 * Measured on a half-full Borealis that is 9.3ms of planning down to 6.0ms,
 * before any pruning at all.
 *
 * Bounded and small either way: `size` is 2..5 and a cell has at most four
 * neighbours, so this is a few dozen shapes per hint, once per hint, never per
 * frame.
 */
function shapesAround(
  seeds: TilePos[],
  size: number,
  board: HintBoard,
  usable: (cell: TilePos) => boolean
): Shape[] {
  const found: Shape[] = [];
  const seen = new Set<string>();
  const spent = new Set<string>();
  for (const seed of seeds) {
    const seedKey = cellKey(seed.col, seed.row);
    if (!spent.has(seedKey) && usable(seed)) {
      const shape: TilePos[] = [seed];
      const held = new Set<string>([seedKey]);
      const grow = (): void => {
        if (shape.length === size) {
          const key = [...held].sort().join('|');
          if (!seen.has(key)) {
            seen.add(key);
            found.push({ key, cells: shape.map((c) => ({ col: c.col, row: c.row })) });
          }
          return;
        }
        for (const cell of [...shape]) {
          for (const n of board.neighbors(cell.col, cell.row)) {
            const k = cellKey(n.col, n.row);
            if (held.has(k) || spent.has(k) || !usable(n)) continue;
            held.add(k);
            shape.push(n);
            grow();
            shape.pop();
            held.delete(k);
          }
        }
      };
      grow();
    }
    spent.add(seedKey);
  }
  return found;
}

/**
 * GROUND A PLAN MAY USE: painted, and either empty or holding one of our own.
 *
 * Our own pieces count as usable because they are the ones being gathered — a
 * shape drawn over a piece of the set is a piece that stays standing. Anything
 * else on it is a stranger the plan cannot move, so the cell is out.
 *
 * Shared by the planner and the floor below on purpose: a bound that reasoned
 * about ground the planner cannot use would not be a bound on the planner.
 */
function usableGround(pieces: BoardItemState[], board: HintBoard): (cell: TilePos) => boolean {
  const ours = new Set(pieces.map((p) => p.id));
  return (cell) => {
    if (!board.isActive(cell.col, cell.row)) return false;
    const occupant = board.itemIdAt(cell.col, cell.row);
    return occupant === null || ours.has(occupant);
  };
}

/** Every cell reachable from `from` in at most `steps` hops of usable ground,
 *  walked through the board's own adjacency. Keyed, because the only question
 *  ever asked of it is whether some other cell is in there. */
function withinSteps(
  from: TilePos,
  steps: number,
  board: HintBoard,
  usable: (cell: TilePos) => boolean
): Set<string> {
  const seen = new Set<string>([cellKey(from.col, from.row)]);
  let frontier: TilePos[] = [{ col: from.col, row: from.row }];
  for (let step = 0; step < steps && frontier.length; step++) {
    const next: TilePos[] = [];
    for (const cur of frontier) {
      for (const n of board.neighbors(cur.col, cur.row)) {
        const k = cellKey(n.col, n.row);
        if (seen.has(k) || !usable(n)) continue;
        seen.add(k);
        next.push(n);
      }
    }
    frontier = next;
  }
  return seen;
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
function planOnShape(
  pieces: BoardItemState[],
  shape: Shape,
  board: HintBoard,
  ruler: Ruler
): Candidate | null {
  // The haul is measured in TILES through the board's own metric — a leg that
  // crosses from one slab to another is a real distance on screen and a
  // meaningless one in index space, and this number decides both which plan
  // asks the shorter swipe and how much the score docks it for asking.
  const haul = (a: TilePos, b: TilePos): number => ruler.tiles(a, b);
  const shapeKeys = new Set(shape.cells.map((c) => cellKey(c.col, c.row)));
  const movers = pieces.filter((p) => !shapeKeys.has(cellKey(p.col, p.row)));
  const free = shape.cells.filter((c) => board.itemIdAt(c.col, c.row) === null);
  // Belt and braces on the caller's `usableGround` filter: every cell of the
  // shape is empty or one of ours, so the free cells and the movers are the
  // same count by construction. If that ever stops being true a stranger is
  // standing on the gathering spot and the plan is not a plan.
  if (free.length !== movers.length) return null;
  const key = shape.key;

  // ALREADY IN SHAPE. Three pieces can end up connected without ever merging —
  // a producer drops one beside two — because a merge only ever happens on a
  // DROP. One gesture still finishes it: pick one of them up and put it on a
  // neighbour of its own set, which is the plain merge-game move.
  //
  // WHICH one is not free, and "any of them" was wrong. Picking a piece up
  // takes its cell out of the flood, so moving the one in the MIDDLE cuts the
  // set in two: three cells in a row, move the centre onto the left, and the
  // right-hand piece is now touching nothing — the flood MergeSystem walks from
  // the drop reaches two, `performMerge` returns false, and the piece the hand
  // asked for bounces straight home. It survived this long because the pieces
  // are walked in id order and the middle one is usually not the oldest; the
  // exported Emberkeep board is where it finally came up, on a set standing at
  // (23,0)-(25,0)-(20,0) whose centre by adjacency is the YOUNGEST of the three.
  //
  // So the piece that moves has to be a LEAF: the ones left behind must still
  // be one flood by themselves, and the cell it lands on is one of them.
  if (movers.length === 0) {
    for (const p of pieces) {
      const rest = pieces.filter((q) => q.id !== p.id);
      if (largestCluster(rest, board) !== rest.length) continue;
      const mate = rest.find((q) =>
        board.neighbors(p.col, p.row).some((n) => n.col === q.col && n.row === q.row)
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
    const legs = movers.map((p, i) => ({ piece: p, to: arrangement[i]!, cost: haul(p, arrangement[i]!) }));
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
 * the same way and the hand does not flicker between two equal plans. This is
 * the plan for ONE set of pieces; which SET to ask for is `nextMergePlan`'s
 * question and is decided by score, not here.
 */
function planWith(
  hint: MergeHint,
  byId: Map<number, BoardItemState>,
  board: HintBoard,
  ruler: Ruler
): MergePlan | null {
  const pieces = hint.ids.map((id) => byId.get(id)).filter((p): p is BoardItemState => !!p);
  if (pieces.length !== hint.need) return null;

  const usable = usableGround(pieces, board);

  const seeds = new Map<string, TilePos>();
  for (const p of pieces) {
    seeds.set(cellKey(p.col, p.row), { col: p.col, row: p.row });
    for (const n of board.neighbors(p.col, p.row)) seeds.set(cellKey(n.col, n.row), n);
  }

  let best: Candidate | null = null;
  for (const shape of shapesAround([...seeds.values()], hint.need, board, usable)) {
    const candidate = planOnShape(pieces, shape, board, ruler);
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
  return best ? { ...hint, steps: best.steps, travel: best.travel } : null;
}

/** `planWith`, for a caller that has items rather than an index. Measures the
 *  board's step size itself, so a plan costed here reads the same as one costed
 *  inside `nextMergePlan` — the two must agree or the tests are checking a
 *  different ruler from the game. */
export function planFor(hint: MergeHint, items: Iterable<BoardItemState>, board: HintBoard): MergePlan | null {
  const all = [...items];
  const byId = new Map<number, BoardItemState>();
  for (const item of all) byId.set(item.id, item);
  return planWith(hint, byId, board, rulerFor(all, board));
}

/**
 * A PROVEN FLOOR ON THE DRAGS a hint can cost, worked out without planning it.
 *
 * WHAT THIS USED TO CLAIM, AND WHY IT WAS FALSE — written out because the wrong
 * version shipped, and a bound nobody re-derives is a bound nobody catches.
 * The floor was `need − largestCluster(pieces)`, argued as: "the destination is
 * ONE connected shape, so at most one of the set's existing connected clusters
 * can stay standing". The premise does not hold. Pieces that stay put do not
 * have to be adjacent TO EACH OTHER — they have to fit inside the same
 * connected `need`-cell shape, and the piece that moves is allowed to land in
 * the gap between them. Three lumber standing at (0,0), (2,0) and (1,1) are
 * three clusters of one, so the old floor said 3 − 1 = 2 drags; the real plan
 * is ONE drag, (1,1) → (1,0), which bridges (0,0) and (2,0) into a straight
 * triomino. `largestCluster` counts adjacency the board already has. A plan is
 * allowed to BUILD adjacency, and usually that is the whole point of it.
 *
 * An over-stated floor is not a rounding error here, because the walk in
 * `nextMergePlan` BREAKS on it: the cheap plan is never enumerated at all and
 * the hand offers a costlier merge instead. Fuzzed over the three exported
 * worlds that can host a 3-merge — 400 random 18-piece boards each, the offer
 * compared against the fully enumerated field ranked by this file's own triple
 * — the old floor mis-ranked 3.8% of Emberkeep boards, 9.3% of Borealis and
 * 10.0% of Roothold. Never the drag count (`need` is 2 or 3 in chains.json,
 * which caps the over-statement at one drag and the fuzz never spent it):
 * always the haul tie-break, and on every single mis-ranked board both plans
 * cost ONE drag — so `travel` there is one leg's distance and a real swipe
 * length. A median 206–420 world units of extra swipe, 1485 at the worst. That
 * is the same defect class the effort ranking exists to remove, arriving
 * through the optimisation instead of through the ordering.
 *
 * WHAT IS ACTUALLY TRUE. A plan gathers onto ONE connected shape S of exactly
 * `need` usable cells (`shapesAround`); the pieces that stay standing are
 * exactly the ones already on S, and every other piece costs a drag:
 *
 *     drags = need − |pieces ∩ S|, minimised over legal S, and never below 1
 *     (a set already standing connected still needs the flick that fuses it,
 *     because a merge only ever happens on a drop).
 *
 * Any two pieces of `pieces ∩ S` are joined by a path lying INSIDE S, and S is
 * `need` cells, so that path is at most `need − 1` hops and every cell on it is
 * usable. Contrapositive — and this is the whole bound: two pieces further
 * apart than `need − 1` hops of usable ground can never stay standing together.
 * So the largest subset of the set that is PAIRWISE within `need − 1` usable
 * hops is an upper bound on `|pieces ∩ S|`, and `need − that` is a true lower
 * bound on the drags.
 *
 * It holds on the shape that broke the old one: (0,0) and (1,1) are two usable
 * hops apart, `need − 1` is 2, so the bound keeps two, floors the hint at one
 * drag, and the one-drag plan gets enumerated.
 *
 * It is a BOUND, not the answer, and it is loose in the safe direction only:
 * pairwise closeness does not prove a subset fits one shape — (0,0), (1,1) and
 * (2,0) are pairwise two hops apart and no triomino holds all three — so the
 * floor can read 1 where the truth is 2. That costs a plan that was not needed.
 * The other direction, reading 2 where the truth is 1, is the bug above, and
 * the proof is what rules it out.
 *
 * It survives the scoring model unchanged, and only because of the dominance
 * rule: `W.drag` is larger than every other weight together, so a plan costing
 * more drags can never out-score one costing fewer, and a floor above the
 * incumbent's drag count still proves nothing left can win.
 */
function dragFloor(hint: MergeHint, byId: Map<number, BoardItemState>, board: HintBoard): number {
  const pieces = hint.ids.map((id) => byId.get(id)).filter((p): p is BoardItemState => !!p);
  // A hint whose pieces have gone missing is one `planFor` will refuse anyway;
  // 1 is the floor that assumes nothing, so it can never break the walk early.
  if (pieces.length !== hint.need) return 1;

  const usable = usableGround(pieces, board);
  const reachOf = pieces.map((p) => withinSteps(p, hint.need - 1, board, usable));

  // The largest pairwise-close subset, by brute force over subsets. `need` is 2
  // or 3 in chains.json and the grammar tops out at a handful, so this is
  // 2^need ≤ 32 masks of at most 10 pair tests — cheaper than one shape.
  let keep = 1;
  for (let mask = 1; mask < 1 << pieces.length; mask++) {
    const members: number[] = [];
    for (let i = 0; i < pieces.length; i++) if (mask & (1 << i)) members.push(i);
    if (members.length <= keep) continue; // cannot improve on what we have
    let together = true;
    for (let a = 0; a < members.length && together; a++) {
      for (let b = a + 1; b < members.length && together; b++) {
        const far = pieces[members[b]!]!;
        if (!reachOf[members[a]!]!.has(cellKey(far.col, far.row))) together = false;
      }
    }
    if (together) keep = members.length;
  }
  return Math.max(1, hint.need - keep);
}

/* ========================================================================= *
 *                              THE SCORE                                    *
 *                                                                           *
 * The "petite IA": a legible weighted opinion about which of several legal
 * moves a thinking player would make next. Not a search, not a model — eight
 * numbers and a sentence each, arguable line by line, and every one of them
 * measured against a defect that was really on the board (see the header).
 * ========================================================================= */

/** A plan carries ids; the score wants cells. Resolved once, here, so `meritOf`
 *  never has to look a piece up. */
interface PlacedPlan extends MergePlan {
  /** Where the plan's pieces are standing right now. */
  at: TilePos[];
}

function withCells(plan: MergePlan, items: readonly BoardItemState[]): PlacedPlan {
  const at: TilePos[] = [];
  for (const id of plan.ids) {
    const piece = items.find((i) => i.id === id);
    if (piece) at.push({ col: piece.col, row: piece.row });
  }
  return { ...plan, at };
}

/** A saturating 0..1 ramp: 0 at no distance, ½ at `half`, never quite 1. Used
 *  for every distance term, so nothing has a cliff the player could feel. */
function ramp(distance: number, half: number): number {
  return distance / (distance + half);
}

/** What the score can know about the player, resolved once per call so every
 *  candidate is judged against exactly the same reading of the board. */
interface Situation {
  ruler: Ruler;
  board: HintBoard;
  /** chain id → its deepest tier that can still merge. Fixes the denominator of
   *  the tier term, so "one from the top" means the same in a 3-tier chain and
   *  a 6-tier one. */
  deepest: Map<string, number>;
}

function situationOf(items: readonly BoardItemState[], data: ChainsData, board: HintBoard): Situation {
  const deepest = new Map<string, number>();
  for (const chain of data.chains) {
    const tiers = chain.tiers.map((t) => t.tier).sort((a, b) => a - b);
    // The deepest tier that has somewhere to merge TO — the top of the chain is
    // not a merge, so it is not the top of this scale either.
    const top = tiers.filter((t) => tiers.includes(t + 1)).at(-1) ?? 1;
    deepest.set(chain.id, top);
  }
  return { ruler: rulerFor(items, board), board, deepest };
}

/**
 * WHAT THIS MERGE IS WORTH, in merit points. Higher is better; see the header
 * for the model and `MERGE_HINT_WEIGHTS` for the argument behind each number.
 *
 * Every optional term is zero when the board cannot answer it, so a fixture
 * that supplies nothing but ground gets `− drag − haul + tier` and a ranking
 * that is still total, still deterministic, and still an improvement on the
 * ordering it replaces.
 */
function meritOf(plan: PlacedPlan, it: Situation): number {
  const { board, ruler } = it;
  let merit = 0;

  // WORK. Dominant, by construction: no combination of the merits below can
  // reach `W.drag`, so a cheaper plan always wins.
  merit -= W.drag * (plan.steps.length - 1);
  merit -= W.haul * ramp(plan.travel, W.haulHalfTiles);

  // THE CELLS THE PLAN TOUCHES — every piece where it stands, and every place
  // it is asked to go. "Near" and "on screen" are questions about the whole
  // gesture, not about one end of it.
  const touched: TilePos[] = [...plan.at];
  for (const step of plan.steps) touched.push(step.to);

  // PROXIMITY. The distance to the CLOSEST end of the gesture: a merge whose
  // far piece is across the isle but whose gathering spot is beside the
  // player's last move is still work happening where they are looking.
  if (board.focus) {
    const focus = board.focus;
    const near = Math.min(...touched.map((c) => ruler.tiles(focus, c)));
    merit += W.near * (1 - ramp(near, W.nearHalfTiles));
  }

  // ACTIONABILITY. Anything at all on screen is enough — the hand will point at
  // one end of the gesture and the player's eye follows the rest.
  if (board.inView) {
    const seen = touched.some((c) => board.inView!(c.col, c.row));
    if (seen) merit += W.frame;
  }

  // DEPTH. Where this merge sits in its chain, as a fraction of the mergeable
  // tiers. Tier 1 scores nothing; the last tier that can still merge scores the
  // whole weight.
  const top = it.deepest.get(plan.chain) ?? 1;
  merit += W.tier * (top > 1 ? (plan.tier - 1) / (top - 1) : 0);

  // INTENT. What the player is trying to get, and what they would be spending
  // to get it.
  if (board.wants) {
    if (board.wants(plan.chain, plan.tier + 1) > 0) merit += W.order;
    if (board.wants(plan.chain, plan.tier) > 0) merit -= W.orderSpend;
  }

  // INSISTENCE. Shown, seen, ignored.
  if (board.declines) {
    const times = Math.min(board.declines(plan.key), W.declineCap);
    merit -= W.declined * (times / W.declineCap);
  }

  return merit;
}

/**
 * The score of one plan, on the same terms `nextMergePlan` uses.
 *
 * Exported so a test can rank the whole field by hand and assert the offer is
 * its argmax — checking the OFFER against an independently computed order is
 * the only way to test a ranking without hand-picking the answer it should
 * give.
 */
export function scorePlan(
  plan: MergePlan,
  items: Iterable<BoardItemState>,
  data: ChainsData,
  board: HintBoard
): number {
  const all = [...items];
  return meritOf(withCells(plan, all), situationOf(all, data, board));
}

/**
 * The next merge the hand should offer, as the drags that make it.
 *
 * THE HIGHEST-SCORING ONE — the model is in the file header and the weights are
 * in `MERGE_HINT_WEIGHTS`. Two things about it are worth stating here because
 * they are what make it safe to reason about:
 *
 * TOTAL. Every candidate the board can produce is planned unless a PROVEN bound
 * says it cannot win. If a legal merge exists, one is offered — the ranking may
 * choose badly, but it never falls silent. The `groupsPerBucket` cut is the one
 * place that could break that (a bucket's plannable set could be cut in favour
 * of unplannable ones), so it is repaired explicitly: if the cut field yields
 * nothing at all, the leftovers are walked too.
 *
 * DETERMINISTIC. Scores are quantised to integers before they are compared, and
 * the tie-break below them is the set's first-completed id and then its own
 * sorted ids — a total order with no appeal to iteration. The same board answers
 * the same way whichever direction it is walked, which is what the mirrored-
 * iteration assertions in both spec files check.
 *
 * `dragFloor` is what keeps this affordable: candidates are walked cheapest-
 * floor first and the walk breaks the moment the plan in hand costs fewer drags
 * than anything left could. The break is only legitimate because that floor is a
 * PROVEN lower bound AND because `W.drag` dominates — a plan with more drags can
 * never out-score one with fewer, however much merit it carries.
 *
 * WHAT CORRECTNESS COSTS, measured on the densest hint list a world can hold: a
 * half-full board carrying exactly three of every chain, which is 23 mergeable
 * sets on Borealis and 24 on Roothold, averaged over 60 calls.
 *
 *     plan every hint, no prune, shapes enumerated per seed   9.3ms / 9.3ms
 *     ... with each shape enumerated once (`shapesAround`)    6.0ms / 6.3ms
 *     ... and the proven floor pruning the walk               2.1ms / 1.3ms
 *
 * (One machine, the rows timed against each other in one process, so read the
 * ratios and not the absolutes.) That budget matters because `refreshHint`
 * re-plans on every board change while a hand is up, and four of those can land
 * in one frame when a merge fires.
 *
 * A merge with no plan is not skipped for ever, it is skipped for NOW: the
 * board changes, and the set that had nowhere to gather this minute may have
 * room the next.
 */
export function nextMergePlan(
  items: Iterable<BoardItemState>,
  data: ChainsData,
  board: HintBoard,
  skip: ReadonlySet<number> = new Set()
): MergePlan | null {
  const all = [...items];
  const byId = new Map<number, BoardItemState>();
  for (const item of all) byId.set(item.id, item);
  const situation = situationOf(all, data, board);

  // CANDIDATES. Several sets per bucket, not one — the tightest trio on the
  // board is not always the trio the player is standing beside. Ranked by the
  // proven floor so the cut keeps the cheap ones, then by the set's own name so
  // the cut itself never depends on iteration order.
  const candidates: { hint: MergeHint; floor: number }[] = [];
  const spare: { hint: MergeHint; floor: number }[] = [];
  for (const { chain, tier, need, items: bucket } of bucketsOf(all, data)) {
    const graded = groupsIn(bucket, need, board)
      .map((group) => hintOf(chain, tier, need, group, board))
      .filter((hint) => !skip.has(hint.completedBy))
      .map((hint) => ({ hint, floor: dragFloor(hint, byId, board) }))
      .sort((a, b) => a.floor - b.floor || (a.hint.key < b.hint.key ? -1 : a.hint.key > b.hint.key ? 1 : 0));
    candidates.push(...graded.slice(0, W.groupsPerBucket));
    spare.push(...graded.slice(W.groupsPerBucket));
  }
  candidates.sort((a, b) => a.floor - b.floor || (a.hint.key < b.hint.key ? -1 : a.hint.key > b.hint.key ? 1 : 0));
  spare.sort((a, b) => a.floor - b.floor || (a.hint.key < b.hint.key ? -1 : a.hint.key > b.hint.key ? 1 : 0));

  let best: MergePlan | null = null;
  let bestRank = -Infinity;
  const consider = (queue: { hint: MergeHint; floor: number }[]): void => {
    for (const { hint, floor } of queue) {
      // Ascending floors: once the incumbent is STRICTLY cheaper than the floor
      // of everything remaining, nothing left can beat it — not even on merit,
      // because `W.drag` is larger than every other weight together. This line
      // is what makes `dragFloor` load-bearing rather than advisory, and it is
      // why that floor has to be a bound with a proof behind it: a floor one
      // drag too high here does not cost time, it silently deletes the best
      // answer.
      if (best && best.steps.length < floor) break;
      const plan = planWith(hint, byId, board, situation.ruler);
      if (!plan) continue;
      const rank = Math.round(meritOf(withCells(plan, all), situation) * W.quantum);
      if (
        !best ||
        rank > bestRank ||
        (rank === bestRank &&
          (plan.completedBy < best.completedBy ||
            (plan.completedBy === best.completedBy && plan.key < best.key)))
      ) {
        best = plan;
        bestRank = rank;
      }
    }
  };
  consider(candidates);
  // TOTALITY REPAIR. The per-bucket cut is a performance measure and must never
  // be the reason the hand says nothing: if every set that survived it turned
  // out to be unplannable, walk the ones it dropped.
  if (!best) consider(spare);
  return best;
}
