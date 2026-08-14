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
}

/** The merge size for a chain+tier: the tier's own override, else the chain's,
 *  else the global rule — the same precedence MergeSystem applies. */
function needFor(config: ChainConfig, tier: number, data: ChainsData): number {
  return config.tiers.find((t) => t.tier === tier)?.merge?.group ?? config.merge?.group ?? data.mergeRule.minGroup;
}

/**
 * Every merge the board can currently make, in the order they became possible.
 *
 * Deliberately blind to WHERE the pieces are. Two Dew Drops on opposite corners
 * are as mergeable as two side by side — the player drags one onto the other,
 * which is exactly the move the hand is there to suggest. Adjacency is
 * MergeSystem's business at the moment of the drop, not the hint's.
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
    const ids = bucket.map((i) => i.id).sort((a, b) => a - b);
    hints.push({ chain, tier, need, ids: ids.slice(0, need), completedBy: ids[need - 1]! });
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
