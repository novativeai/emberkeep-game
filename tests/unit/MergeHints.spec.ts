import { describe, expect, it } from 'vitest';
import { mergeHints, nextMergeHint } from '../../src/core/mergeHints';
import type { BoardItemState, ChainsData } from '../../src/core/types';

const CHAINS = {
  mergeRule: { minGroup: 3, fiveBonus: true, fiveGroup: 5, fiveOutputs: 2 },
  chains: [
    { id: 'moonwater', tiers: [{ tier: 1 }, { tier: 2 }, { tier: 3 }] },
    { id: 'lumber', tiers: [{ tier: 1 }, { tier: 2 }] },
    // A chain that merges in PAIRS at its first tier — the tier override wins
    // over the chain's, which wins over the global rule.
    { id: 'twins', merge: { group: 4 }, tiers: [{ tier: 1, merge: { group: 2 } }, { tier: 2 }, { tier: 3 }] }
  ]
} as unknown as ChainsData;

let nextId = 1;
const item = (chain: string, tier: number, extra: Partial<BoardItemState> = {}): BoardItemState =>
  ({ id: nextId++, chain, tier, col: 0, row: 0, kind: 'item', ...extra }) as BoardItemState;

describe('mergeHints', () => {
  it('finds nothing on a board with too few of anything', () => {
    nextId = 1;
    expect(mergeHints([item('moonwater', 1), item('moonwater', 1)], CHAINS)).toEqual([]);
  });

  it('finds a set the moment it is complete, and points at exactly that many', () => {
    nextId = 1;
    const hint = nextMergeHint([item('moonwater', 1), item('moonwater', 1), item('moonwater', 1), item('moonwater', 1)], CHAINS);
    expect(hint).toMatchObject({ chain: 'moonwater', tier: 1, need: 3 });
    // The three OLDEST, not the fourth — a hint that points at a spare teaches
    // nothing the first three did not.
    expect(hint!.ids).toEqual([1, 2, 3]);
    expect(hint!.completedBy).toBe(3);
  });

  it('ignores where the pieces are — the drag is the move being suggested', () => {
    nextId = 1;
    const far = [
      item('moonwater', 1, { col: 0, row: 0 }),
      item('moonwater', 1, { col: 40, row: 9 }),
      item('moonwater', 1, { col: 12, row: 3 })
    ];
    expect(nextMergeHint(far, CHAINS)).not.toBeNull();
  });

  it('never points at the top of a chain, which has nowhere to merge to', () => {
    nextId = 1;
    expect(mergeHints([item('lumber', 2), item('lumber', 2), item('lumber', 2)], CHAINS)).toEqual([]);
  });

  it('leaves decor alone', () => {
    nextId = 1;
    const decor = [
      item('moonwater', 1, { kind: 'decor' }),
      item('moonwater', 1, { kind: 'decor' }),
      item('moonwater', 1, { kind: 'decor' })
    ];
    expect(mergeHints(decor, CHAINS)).toEqual([]);
  });

  it('honours a tier override over the chain rule over the global rule', () => {
    nextId = 1;
    const pair = [item('twins', 1), item('twins', 1)];
    expect(nextMergeHint(pair, CHAINS)).toMatchObject({ chain: 'twins', tier: 1, need: 2 });
    // Tier 2 has no override of its own, so it falls to the CHAIN's group of 4.
    nextId = 1;
    const three = [item('twins', 2), item('twins', 2), item('twins', 2)];
    expect(nextMergeHint(three, CHAINS)).toBeNull();
    expect(nextMergeHint([...three, item('twins', 2)], CHAINS)).toMatchObject({ need: 4 });
  });

  it('queues by WHEN each set became mergeable, not by tier or size', () => {
    nextId = 1;
    // Three lumber complete first (ids 1-3); a pile of six moonwater completes
    // after (ids 4-9). The older set leads even though the other is bigger.
    const board = [
      item('lumber', 1), item('lumber', 1), item('lumber', 1),
      item('moonwater', 1), item('moonwater', 1), item('moonwater', 1),
      item('moonwater', 1), item('moonwater', 1), item('moonwater', 1)
    ];
    const order = mergeHints(board, CHAINS).map((h) => h.chain);
    expect(order).toEqual(['lumber', 'moonwater']);
  });

  it('gives the same answer whatever order the board is iterated in', () => {
    nextId = 1;
    const board = [
      item('lumber', 1), item('moonwater', 1), item('lumber', 1),
      item('moonwater', 1), item('lumber', 1), item('moonwater', 1)
    ];
    const forward = mergeHints(board, CHAINS);
    const backward = mergeHints([...board].reverse(), CHAINS);
    expect(backward).toEqual(forward);
  });

  it('moves on when the player has been shown a set and left it alone', () => {
    nextId = 1;
    const board = [
      item('lumber', 1), item('lumber', 1), item('lumber', 1),
      item('moonwater', 1), item('moonwater', 1), item('moonwater', 1)
    ];
    const first = nextMergeHint(board, CHAINS)!;
    expect(first.chain).toBe('lumber');
    const second = nextMergeHint(board, CHAINS, new Set([first.completedBy]))!;
    expect(second.chain).toBe('moonwater');
    expect(nextMergeHint(board, CHAINS, new Set([first.completedBy, second.completedBy]))).toBeNull();
  });

  it('survives a chain the data does not describe', () => {
    nextId = 1;
    const ghost = [item('ghost', 1), item('ghost', 1), item('ghost', 1)];
    expect(mergeHints(ghost, CHAINS)).toEqual([]);
  });
});
