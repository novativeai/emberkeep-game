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
 * The OFFER (`nextMergePlan`) is not that queue. It is the highest-SCORING
 * plannable merge — fewest drags first, then the shortest haul, then a handful
 * of merits about the player's situation — because first-completed is a fact
 * about the board and not a claim about what is easy, and a hand that sends
 * the player on a two-drag gather while a pair sits touching reads as broken
 * rather than as old-fashioned.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE RULE THE PLAN OBEYS — and why this file imports it instead of owning it.
 *
 * A merge happens when, and only when, a piece is dropped ON a matching piece
 * and the two of them plus the target's connected cluster reach the recipe
 * (`mergeRule.verdictOnto`). Dropped on free ground a piece simply MOVES, however
 * many of its kind now stand beside it. That is the whole rule, and it is not
 * restated here: the planner builds a `RuleBoard` over the same items the
 * scene hands it, replays its own earlier drags on an overlay, and asks the
 * SAME predicate MergeSystem will ask when the finger lets go. A hand that ran
 * its own copy of the predicate could promise a fusion the board refuses, and
 * that is precisely the bug the previous planner shipped — see THE PLAN below.
 *
 * So every plan has the same shape:
 *
 *     gather, gather, …, DROP ON.
 *
 * Each gather moves one piece onto a FREE cell beside the growing cluster — a
 * drop on free ground, which always succeeds and never fuses, so no step the
 * hand asks for can bounce and none can fire early. The last step lands ON a
 * member of that cluster, and it is only emitted once `verdictOnto` on the
 * replayed board says `merge`. A set already standing complete (three in a row
 * a producer built, a pair of Houses) is the zero-gather case: one leaf dropped
 * on the cluster's centre, the same centre the scene leans the pieces toward.
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
 *     for each candidate: plan ← planFor(candidate)   (exact, see THE PLAN)
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
import { clusterOf, readyClusters, recipeFor, type RuleBoard, verdictOnto } from './mergeRule';
import type { BoardItemState, ChainsData, TilePos } from './types';

/**
 * THE BOARD THE PLANNER REASONS ABOUT — and the PLAYER as well.
 *
 * Injected rather than imported, for the same reason this whole file is
 * Phaser-free: what the hand should ask for is a rule, and a rule is worth
 * nothing if it can only be checked by looking at a screenshot. The unit tests
 * hand it a fixture; BoardScene hands it `GameState` + `world.ts`.
 *
 * The first four members are the BOARD and are required. `neighbors` is the one
 * that matters. A merge is an ORTHOGONALLY-CONNECTED flood
 * (`mergeRule.clusterOf`) and adjacency never leaves a zone (world.ts
 * `neighborsOf`), so the cluster a plan gathers onto can never span two slabs.
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
   *  longer buckets on it (see above) — the CLUSTER carries the zone rule. */
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
  /**
   * The CELL to drop on. For a gather that is a free seat beside the cluster —
   * named explicitly so the hand has somewhere to point, the ground diamond
   * has somewhere to pulse, and `BoardScene.notePlayerMove` can recognise the
   * landing and bring the next step straight back. For the last step it is the
   * cell of the piece being dropped ON.
   */
  to: TilePos;
  /**
   * True on the LAST step only — the drop that actually fuses.
   *
   * Every other step is a GATHER onto a FREE cell, which is the whole safety
   * property of a plan: a drop on free ground always succeeds and never merges,
   * so no step the hand asks for can bounce and none can fire before its turn.
   * The final step MUST land on a piece — under the rule in mergeRule.ts there
   * is no other way to merge — and it is only emitted once `verdictOnto` on the
   * replayed board has said so.
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
   * Zero for a set that is already standing complete: nothing has to travel,
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
  // belongs, in the plan: the cluster is grown through the board's own
  // adjacency and therefore always lies on one slab. What may travel onto it
  // is anything the player owns, from anywhere.
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
    // The recipe comes from mergeRule.ts — the same precedence MergeSystem
    // applies (tier override, then chain, then the global rule), and the same
    // "the top of a chain has nowhere to go": merging it is not a move the
    // player is failing to notice, it is not a move at all.
    const recipe = recipeFor(data, chain, tier);
    if (!recipe.mergeable) continue;
    if (bucket.length < recipe.need) continue;
    out.push({ chain, tier, need: recipe.need, items: bucket });
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
 * WHAT THE PREVIOUS PLAN PROMISED, AND WHY IT STOPPED BEING TRUE. It gathered
 * the set onto a connected shape of `need` FREE cells and relied on the last
 * drop — onto the last free cell of the shape — fusing by flood: three
 * standing connected used to merge the moment the third arrived beside the
 * other two. MergeSystem no longer does that. Under the rule in mergeRule.ts a
 * drop on free ground is a MOVE, whatever stands beside it, and the only drop
 * that fuses is a drop ON a matching piece. So the old plan's final step was a
 * gesture the board accepts and does nothing with: the player followed the
 * hand exactly, three pieces stood in a row, and nothing happened. Its drag
 * floor was wrong the same way — it counted the "gap bridge" (three pieces
 * touching nothing, one of them dropped into the free hub between the others)
 * as one drag, which under the drop-on rule is two.
 *
 * A plan is now a sequence of drags with ONE invariant:
 *
 *      every step but the last is a GATHER — the piece lands on a FREE cell
 *      beside the cluster being built; the last step lands ON a member of
 *      that cluster, and `verdictOnto` on the replayed board says `merge`.
 *
 * A drop on free active ground always succeeds and never fuses, so nothing the
 * hand asks for can bounce and nothing can fire early. The final drop is not
 * guaranteed by construction — it is CHECKED, with the same predicate the
 * board uses, on an overlay where the earlier gathers have been made. The
 * cluster grows through the board's own `neighbors`, so it never crosses a
 * zone, and the zone rule needs no second statement here.
 *
 * Drags, not distance, are the first cost: a drag crosses the isle as easily
 * as it crosses one tile, so the player's real cost is how many times they
 * have to pick something up. A set with a pair already touching costs ONE
 * (the third dropped on either of them); three pieces touching nothing cost
 * TWO (one gathered beside another, the third dropped on); a set already
 * standing complete costs one flick and no travel at all.
 * ========================================================================= */

const cellKey = (col: number, row: number): string => `${col},${row}`;

/**
 * THE BOARD AS THE RULE SEES IT, with the plan's earlier drags already made.
 *
 * `RuleBoard` wants pieces, not ids, and it wants them where the PLAN has put
 * them — a gather seated two steps ago has to count as standing on its seat
 * when the final verdict is asked. So the overlay indexes the items the
 * planner was handed by cell, and lays a small map of moves over it. Nothing
 * here touches `GameState`: a plan is a prediction, and a prediction that
 * mutated the board to find out what it predicts would be a move.
 *
 * Immutable on purpose — `with` returns a new overlay — so two candidate plans
 * explored from the same base never see each other's seats, and a rejected
 * branch leaves nothing to undo.
 */
class Overlay implements RuleBoard {
  private constructor(
    private readonly board: HintBoard,
    private readonly home: ReadonlyMap<string, BoardItemState>,
    private readonly moved: ReadonlyMap<number, TilePos>,
    private readonly seated: ReadonlyMap<string, BoardItemState>
  ) {}

  static of(board: HintBoard, items: readonly BoardItemState[]): Overlay {
    const home = new Map<string, BoardItemState>();
    for (const item of items) home.set(cellKey(item.col, item.row), item);
    return new Overlay(board, home, new Map(), new Map());
  }

  /** This board with `piece` standing on `to`, its old cell left empty. */
  with(piece: BoardItemState, to: TilePos): Overlay {
    const moved = new Map(this.moved).set(piece.id, to);
    const seated = new Map<string, BoardItemState>();
    for (const [key, p] of this.seated) if (p.id !== piece.id) seated.set(key, p);
    seated.set(cellKey(to.col, to.row), { ...piece, col: to.col, row: to.row });
    return new Overlay(this.board, this.home, moved, seated);
  }

  /** Where `piece` stands on THIS board — its seat if the plan moved it. */
  place(piece: BoardItemState): BoardItemState {
    const to = this.moved.get(piece.id);
    return to ? { ...piece, col: to.col, row: to.row } : piece;
  }

  itemAt(col: number, row: number): BoardItemState | undefined {
    const seat = this.seated.get(cellKey(col, row));
    if (seat) return seat;
    const piece = this.home.get(cellKey(col, row));
    return piece && !this.moved.has(piece.id) ? piece : undefined;
  }

  neighbors(col: number, row: number): TilePos[] {
    return this.board.neighbors(col, row);
  }

  isTileActive(col: number, row: number): boolean {
    return this.board.isActive(col, row);
  }

  /**
   * Free to land on: painted, and nobody standing there. Asked of the items
   * index AND of the board's own occupancy — they are the same source in the
   * game and in every fixture, and the second test costs nothing; a stranger
   * the caller's item list did not mention must still keep its cell.
   */
  isFree(col: number, row: number): boolean {
    if (!this.board.isActive(col, row) || this.itemAt(col, row)) return false;
    const occupant = this.board.itemIdAt(col, row);
    return occupant === null || this.moved.has(occupant);
  }
}

/**
 * The connected groups these pieces form among THEMSELVES, walked through the
 * board's own adjacency — which is the only adjacency that means anything.
 *
 * Not `|Δcol| + |Δrow| === 1`. On the exported worlds a cell's neighbours are
 * whatever the zone graph says they are — Emberkeep as exported today is
 * eighteen zones, where (25,0) neighbours both (23,0) and (20,0) while those
 * two do not touch each other at all. Anything that reasons about "already
 * together" from index arithmetic is reasoning about a lattice the game
 * stopped having, and it will be wrong in exactly the cases that matter.
 *
 * Largest first, then by oldest member, and every group sorted by id — so the
 * anchors a plan is tried from come out the same whichever way the caller
 * iterated the board.
 */
function groupsAmong(pieces: readonly BoardItemState[], board: Pick<RuleBoard, 'neighbors'>): BoardItemState[][] {
  const spots = new Map<string, BoardItemState>();
  for (const p of [...pieces].sort((a, b) => a.id - b.id)) spots.set(cellKey(p.col, p.row), p);
  const seen = new Set<string>();
  const out: BoardItemState[][] = [];
  for (const [key, start] of spots) {
    if (seen.has(key)) continue;
    seen.add(key);
    const group: BoardItemState[] = [];
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      group.push(cur);
      for (const n of board.neighbors(cur.col, cur.row)) {
        const k = cellKey(n.col, n.row);
        const mate = spots.get(k);
        if (!mate || seen.has(k)) continue;
        seen.add(k);
        queue.push(mate);
      }
    }
    out.push(group.sort((a, b) => a.id - b.id));
  }
  return out.sort((a, b) => b.length - a.length || a[0]!.id - b[0]!.id);
}

/**
 * ONE FLICK FINISHES A COMPLETE CLUSTER.
 *
 * Three pieces can stand connected without ever merging — a producer drops one
 * beside two, or the player's last gather bridged a gap — because a merge only
 * ever happens on a DROP. `readyClusters` is the board's own list of those, and
 * the gesture that finishes one is a member dropped on the cluster's CENTRE:
 * the same centre the scene leans the pieces toward, so the hand and the lean
 * agree about where the drop goes.
 *
 * WHICH member moves is not free, and "any of them" used to be wrong. The
 * flood is now walked on the board as it stands, so even the middle of a row
 * dropped on an end fuses (see mergeRule.ts) — but the piece the hand lifts is
 * still chosen to be a LEAF, one whose removal leaves the rest one flood. That
 * is what a person does: the piece on the end goes onto the pile, the pile
 * does not get pulled apart to reach it. Among the leaves, one of the hint's
 * own pieces is preferred (so the hand points at what it named), then one
 * touching the centre (the shortest flick), then the oldest.
 *
 * The drop is CHECKED with `verdictOnto` before it is promised. On a cluster
 * of five that verdict is the five-bonus — the plan never sets out to make
 * one, but a board that has one standing still gets its one-drop answer.
 */
function finishingFlick(
  overlay: Overlay,
  chains: ChainsData,
  pieces: readonly BoardItemState[]
): MergeStep | null {
  const ready = readyClusters(overlay, chains, pieces)[0];
  if (!ready) return null;
  const { members, centre } = ready;
  const named = new Set(pieces.map((p) => p.id));
  const touchesCentre = (m: BoardItemState): boolean =>
    overlay.neighbors(centre.col, centre.row).some((n) => n.col === m.col && n.row === m.row);
  const leaves = members
    .filter((m) => m.id !== centre.id && groupsAmong(members.filter((q) => q.id !== m.id), overlay).length === 1)
    .sort(
      (a, b) =>
        Number(named.has(b.id)) - Number(named.has(a.id)) ||
        Number(touchesCentre(b)) - Number(touchesCentre(a)) ||
        a.id - b.id
    );
  const leaf = leaves[0];
  if (!leaf || verdictOnto(overlay, chains, leaf, centre).kind !== 'merge') return null;
  return { itemId: leaf.id, to: { col: centre.col, row: centre.row }, completes: true };
}

interface Candidate {
  moves: number;
  travel: number;
  /** The plan's own address — its steps, serialised — which is what breaks a
   *  tie between two equally cheap plans without appealing to iteration order. */
  key: string;
  steps: MergeStep[];
}

/**
 * The cheapest way to bring one set of pieces together STARTING FROM `anchor`,
 * one of the connected groups the set already forms. The anchor stays where
 * it stands; every other piece is a mover.
 *
 * ORDER: the LONGEST haul first, the fuse last. The awkward journey happens
 * while the player is still reading the board, and the gesture that pays off —
 * the one that turns three into one — is the short flick. That is how a merge
 * game feels, and it is a policy rather than a search: the total swipe of the
 * two orders of a two-mover plan differs by a fraction of a tile on most
 * boards, and a planner that flipped between them on that fraction would read
 * as a hand changing its mind.
 *
 * EACH GATHER seats its mover on the free cell beside the cluster nearest to
 * where the mover stands — `gatherSeat`'s own "ring one" logic, so a player
 * who drops the piece ON the cluster instead of beside it ends up on the same
 * cell the hand pointed at. The cluster is then RE-READ from the overlay,
 * because a seat can bridge: the gap-bridge board ((0,0), (2,0), (1,1)) puts
 * its first mover on (1,0), and the third piece is now touching it and needs
 * no drag of its own. When that re-read finds the cluster complete, the plan
 * ends with the flick a complete cluster always gets.
 *
 * Null when the cluster is boxed in with a gather still to make: the board
 * has nowhere for the piece to sit, and a plan that cannot be carried out is
 * not a plan. The caller tries the next anchor, or says nothing.
 */
function planFromAnchor(
  anchor: readonly BoardItemState[],
  pieces: readonly BoardItemState[],
  need: number,
  base: Overlay,
  ruler: Ruler,
  chains: ChainsData
): Candidate | null {
  const anchored = new Set(anchor.map((p) => p.id));
  const gapToGroup = (p: TilePos, group: readonly BoardItemState[]): number =>
    Math.min(...group.map((m) => ruler.tiles(p, m)));
  // The order is fixed once, against the anchor as it stands: longest first.
  const movers = pieces
    .filter((p) => !anchored.has(p.id))
    .sort((a, b) => gapToGroup(b, anchor) - gapToGroup(a, anchor) || a.id - b.id);

  let overlay = base;
  let travel = 0;
  const steps: MergeStep[] = [];
  const done = (): Candidate => ({
    moves: steps.length,
    travel,
    key: steps.map((s) => `${s.itemId}>${s.to.col},${s.to.row}`).join('|'),
    steps
  });

  for (;;) {
    const placed = pieces.map((p) => overlay.place(p));
    const cluster = groupsAmong(placed, overlay).find((g) => g.some((m) => anchored.has(m.id)))!;
    if (cluster.length >= need) {
      const flick = finishingFlick(overlay, chains, placed);
      if (!flick) return null;
      steps.push(flick);
      return done();
    }
    const inCluster = new Set(cluster.map((m) => m.id));
    const remaining = movers.map((m) => overlay.place(m)).filter((m) => !inCluster.has(m.id));
    const mover = remaining[0];
    if (!mover) return null; // cannot happen: the set is `need` pieces and the cluster is short of it

    if (remaining.length === 1) {
      // THE DROP ON. The cluster holds `need − 1`; this piece on any member
      // reaches the recipe. Nearest member, so the fuse is the short flick —
      // and the board's own verdict, never our arithmetic, is what promises it.
      const target = [...cluster].sort((a, b) => ruler.tiles(mover, a) - ruler.tiles(mover, b) || a.id - b.id)[0]!;
      if (verdictOnto(overlay, chains, mover, target).kind !== 'merge') return null;
      travel += ruler.tiles(mover, target);
      steps.push({ itemId: mover.id, to: { col: target.col, row: target.row }, completes: true });
      return done();
    }

    // A GATHER. Free ground touching the cluster, nearest to the mover; ties
    // by the cell's own name so two equidistant seats never fall to iteration.
    const seats = new Map<string, TilePos>();
    for (const member of cluster) {
      for (const n of overlay.neighbors(member.col, member.row)) {
        if (overlay.isFree(n.col, n.row)) seats.set(cellKey(n.col, n.row), { col: n.col, row: n.row });
      }
    }
    const seat = [...seats.entries()].sort(
      ([ka, a], [kb, b]) => ruler.tiles(mover, a) - ruler.tiles(mover, b) || (ka < kb ? -1 : ka > kb ? 1 : 0)
    )[0]?.[1];
    if (!seat) return null;
    travel += ruler.tiles(mover, seat);
    steps.push({ itemId: mover.id, to: seat, completes: false });
    overlay = overlay.with(mover, seat);
  }
}

/**
 * How to make this particular merge happen, or null if the board cannot.
 *
 * DEPTH 0 FIRST: if the board's own `readyClusters` already lists a complete
 * cluster among these pieces, the plan is the one flick and no search is run.
 * Otherwise every connected group the set already forms is tried as the
 * anchor, and the cheapest plan wins — by drags, then by swipe length, then by
 * the plan's own steps; in that order and never on iteration order, so the
 * same board always answers the same way and the hand does not flicker between
 * two equal plans. This is the plan for ONE set of pieces; which SET to ask for
 * is `nextMergePlan`'s question and is decided by score, not here.
 */
function planWith(
  hint: MergeHint,
  byId: Map<number, BoardItemState>,
  overlay: Overlay,
  ruler: Ruler,
  chains: ChainsData
): MergePlan | null {
  const pieces = hint.ids.map((id) => byId.get(id)).filter((p): p is BoardItemState => !!p);
  if (pieces.length !== hint.need) return null;

  const flick = finishingFlick(overlay, chains, pieces);
  if (flick) return { ...hint, steps: [flick], travel: 0 };

  let best: Candidate | null = null;
  for (const anchor of groupsAmong(pieces, overlay)) {
    const candidate = planFromAnchor(anchor, pieces, hint.need, overlay, ruler, chains);
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
export function planFor(
  hint: MergeHint,
  items: Iterable<BoardItemState>,
  board: HintBoard,
  data: ChainsData
): MergePlan | null {
  const all = [...items];
  const byId = new Map<number, BoardItemState>();
  for (const item of all) byId.set(item.id, item);
  return planWith(hint, byId, Overlay.of(board, all), rulerFor(all, board), data);
}

/**
 * A PROVEN FLOOR ON THE DRAGS a hint can cost, worked out without planning it.
 *
 * The walk in `nextMergePlan` BREAKS on this, so an over-stated floor is not a
 * rounding error: the cheap plan is never enumerated at all and the hand
 * offers a costlier merge instead. That is how the previous floor failed —
 * it was derived for a plan shape the board no longer fuses (see THE PLAN) —
 * and it is why the argument is written out here rather than trusted.
 *
 * THE BOUND. Let k be the largest cluster, AS THE BOARD WALKS IT, that any of
 * the set's pieces stands in — `clusterOf` on the live board, so an outside
 * piece of the same kind touching one of ours counts, exactly as it will count
 * in the verdict. A ONE-drag plan is a drop with no gather before it, and the
 * rule says that drop fuses only if the dragged piece plus the target's
 * cluster, as it stands, reach `need`: so one drag needs k ≥ need − 1, and
 * without it every plan is at least two. That is the whole proof, and it is
 * tight for every recipe the game ships (2 and 3): with need 3, a touching
 * pair is one drag and anything else is two, which is also what the planner
 * produces.
 *
 * WHY IT STOPS AT TWO. The natural guess is `need − min(k, need − 1)`, and it
 * is what the bound reads for need ≤ 3; for a larger recipe it would
 * over-state. One gather can bridge: a piece seated on a free hub joins every
 * cluster touching that hub at once, so a recipe of four with three lone
 * pieces around a hub is two drags, not three. Nothing above two can be proven
 * without enumerating seats — which is planning — so the floor says 1 or 2
 * and is honest about the rest.
 *
 * It is a BOUND, not the answer, and loose only in the safe direction: k is
 * measured on the live board, and a plan that names a set whose mate is an
 * outside piece may still cost two because the planner moves the pieces the
 * hint NAMED. That costs a plan that was not needed. The other direction,
 * reading 2 where the truth is 1, is the bug above, and the proof rules it out.
 *
 * It survives the scoring model unchanged, and only because of the dominance
 * rule: `W.drag` is larger than every other weight together, so a plan costing
 * more drags can never out-score one costing fewer, and a floor above the
 * incumbent's drag count still proves nothing left can win.
 */
function dragFloor(hint: MergeHint, byId: Map<number, BoardItemState>, overlay: Overlay): number {
  const pieces = hint.ids.map((id) => byId.get(id)).filter((p): p is BoardItemState => !!p);
  // A hint whose pieces have gone missing is one `planWith` will refuse anyway;
  // 1 is the floor that assumes nothing, so it can never break the walk early.
  if (pieces.length !== hint.need) return 1;
  let k = 0;
  for (const p of pieces) k = Math.max(k, clusterOf(overlay, p).length);
  return k >= hint.need - 1 ? 1 : 2;
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
 * never out-score one with fewer, however much merit it carries. The budget
 * matters because `refreshHint` re-plans on every board change while a hand is
 * up, and four of those can land in one frame when a merge fires.
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
  // ONE overlay of the live board for every candidate — each plan lays its own
  // seats over it and never writes back, so the candidates cannot see each
  // other and the board the verdicts are asked of is the one the scene holds.
  const live = Overlay.of(board, all);

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
      .map((hint) => ({ hint, floor: dragFloor(hint, byId, live) }))
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
      const plan = planWith(hint, byId, live, situation.ruler, data);
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
