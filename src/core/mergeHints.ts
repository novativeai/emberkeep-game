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
import type { BoardItemState, ChainConfig, ChainsData } from './types';

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
export function mergeHints(items: Iterable<BoardItemState>, data: ChainsData): MergeHint[] {
  const byKey = new Map<string, BoardItemState[]>();
  for (const item of items) {
    if (item.kind !== 'item') continue; // decor never merges
    const key = `${item.chain}:${item.tier}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(item);
    else byKey.set(key, [item]);
  }

  const hints: MergeHint[] = [];
  for (const [key, bucket] of byKey) {
    const [chain, tierText] = key.split(':');
    const tier = Number(tierText);
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
