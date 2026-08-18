import { describe, expect, it } from 'vitest';
import { type HintBoard, mergeHints, nextMergeHint, nextMergePlan } from '../../src/core/mergeHints';
import type { BoardItemState, ChainsData, TilePos } from '../../src/core/types';

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

  it('still offers a set whose pieces are far apart — the drag IS the move', () => {
    nextId = 1;
    const far = [
      item('moonwater', 1, { col: 0, row: 0 }),
      item('moonwater', 1, { col: 40, row: 9 }),
      item('moonwater', 1, { col: 12, row: 3 })
    ];
    expect(nextMergeHint(far, CHAINS)).not.toBeNull();
  });

  describe('which pieces, once there are more than enough', () => {
    it('points at the ones actually TOGETHER, not the oldest three', () => {
      nextId = 1;
      // Two ancient pieces stranded on opposite corners, three sitting in a
      // huddle. By id the answer is 1,2,3 — a line drawn between two corners of
      // the isle, which reads as the hint being wrong rather than being far.
      const board = [
        item('moonwater', 1, { col: 0, row: 0 }),
        item('moonwater', 1, { col: 40, row: 9 }),
        item('moonwater', 1, { col: 20, row: 4 }),
        item('moonwater', 1, { col: 21, row: 4 }),
        item('moonwater', 1, { col: 20, row: 5 })
      ];
      expect(nextMergeHint(board, CHAINS)!.ids).toEqual([3, 4, 5]);
    });

    it('names the piece that has to travel', () => {
      nextId = 1;
      const board = [
        item('moonwater', 1, { col: 2, row: 2 }),
        item('moonwater', 1, { col: 3, row: 2 }),
        item('moonwater', 1, { col: 9, row: 8 }) // the outlier
      ];
      const hint = nextMergeHint(board, CHAINS)!;
      expect(hint.moveId).toBe(3);
      expect(hint.ids).toContain(hint.moveId);
    });

    it('names one piece and always the same one, even with nothing to choose', () => {
      nextId = 1;
      // All on one cell: no outlier exists, but the hand still has to point
      // somewhere, and it must not point somewhere new every ten seconds.
      const stacked = [item('moonwater', 1), item('moonwater', 1), item('moonwater', 1)];
      const a = nextMergeHint(stacked, CHAINS)!;
      const b = nextMergeHint([...stacked].reverse(), CHAINS)!;
      expect(a.moveId).toBe(b.moveId);
    });

    it('breaks a tie in tightness toward the set that has waited longest', () => {
      nextId = 1;
      // Two equally tight huddles; the older one is the one the player is more
      // likely to have forgotten, which is the queue's whole ordering rule.
      const board = [
        item('moonwater', 1, { col: 0, row: 0 }),
        item('moonwater', 1, { col: 1, row: 0 }),
        item('moonwater', 1, { col: 0, row: 1 }),
        item('moonwater', 1, { col: 30, row: 0 }),
        item('moonwater', 1, { col: 31, row: 0 }),
        item('moonwater', 1, { col: 30, row: 1 })
      ];
      expect(nextMergeHint(board, CHAINS)!.ids).toEqual([1, 2, 3]);
    });
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

/* ========================================================================= *
 * THE PLAN — how the merge actually gets made.
 *
 * The rule above says WHICH merge. These say how, and the difference is the
 * whole bug they exist for: the hand used to ask the player to drop a piece
 * onto another one, which MergeSystem REFUSES when the pair is short of
 * `minGroup` — the piece bounced home and the hint looked broken.
 * ========================================================================= */

/** A rectangular test isle. `holes` are cells the map does not paint, `zones`
 *  splits the board so adjacency can be checked against the real rule. */
const isle = (
  items: BoardItemState[],
  opts: { cols?: number; rows?: number; holes?: string[]; zoneAt?: (c: number, r: number) => string } = {}
): HintBoard => {
  const cols = opts.cols ?? 8;
  const rows = opts.rows ?? 8;
  const holes = new Set(opts.holes ?? []);
  const zoneAt = opts.zoneAt ?? (() => 'main');
  const active = (c: number, r: number): boolean =>
    c >= 0 && r >= 0 && c < cols && r < rows && !holes.has(`${c},${r}`);
  return {
    isActive: active,
    itemIdAt: (c, r) => items.find((i) => i.col === c && i.row === r)?.id ?? null,
    neighbors: (c, r) =>
      (
        [
          { col: c + 1, row: r },
          { col: c - 1, row: r },
          { col: c, row: r + 1 },
          { col: c, row: r - 1 }
        ] as TilePos[]
      ).filter((n) => active(n.col, n.row) && zoneAt(n.col, n.row) === zoneAt(c, r)),
    zoneOf: (c, r) => (active(c, r) ? zoneAt(c, r) : undefined)
  };
};

describe('the plan', () => {
  it('never asks for a drop that the board would bounce', () => {
    nextId = 1;
    // Three pieces, none adjacent to another. Every step but the last must
    // land on FREE ground — that is the property that makes a plan safe.
    const board = [
      item('moonwater', 1, { col: 1, row: 1 }),
      item('moonwater', 1, { col: 5, row: 1 }),
      item('moonwater', 1, { col: 3, row: 6 })
    ];
    const plan = nextMergePlan(board, CHAINS, isle(board))!;
    expect(plan).not.toBeNull();
    expect(plan.steps.length).toBe(2); // one piece stays; two travel
    for (const step of plan.steps.slice(0, -1)) {
      const occupant = isle(board).itemIdAt(step.to.col, step.to.row);
      expect(occupant).toBeNull();
    }
    expect(plan.steps[plan.steps.length - 1]!.completes).toBe(true);
    expect(plan.steps.filter((s) => s.completes).length).toBe(1);
  });

  it('gathers onto CONNECTED ground, so the last drop really fuses', () => {
    nextId = 1;
    const board = [
      item('moonwater', 1, { col: 1, row: 1 }),
      item('moonwater', 1, { col: 5, row: 1 }),
      item('moonwater', 1, { col: 3, row: 6 })
    ];
    const grid = isle(board);
    const plan = nextMergePlan(board, CHAINS, grid)!;
    // Where every piece ends up: movers on their target, the rest where they are.
    const moved = new Map(plan.steps.map((s) => [s.itemId, s.to]));
    const seats = board.map((p) => moved.get(p.id) ?? { col: p.col, row: p.row });
    // The three seats must form ONE orthogonally connected group — that is
    // exactly what MergeSystem's flood walks.
    const seen = new Set<string>([`${seats[0]!.col},${seats[0]!.row}`]);
    const queue = [seats[0]!];
    while (queue.length) {
      const at = queue.shift()!;
      for (const n of grid.neighbors(at.col, at.row)) {
        const key = `${n.col},${n.row}`;
        if (seen.has(key)) continue;
        if (!seats.some((s) => s.col === n.col && s.row === n.row)) continue;
        seen.add(key);
        queue.push(n);
      }
    }
    expect(seen.size).toBe(3);
  });

  it('asks for ONE drag when two pieces are already side by side', () => {
    nextId = 1;
    const board = [
      item('moonwater', 1, { col: 2, row: 2 }),
      item('moonwater', 1, { col: 3, row: 2 }),
      item('moonwater', 1, { col: 7, row: 7 })
    ];
    const plan = nextMergePlan(board, CHAINS, isle(board))!;
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0]!.itemId).toBe(3); // the one standing apart
    expect(plan.steps[0]!.completes).toBe(true);
    // Onto free ground beside the pair, never onto one of them.
    expect(isle(board).itemIdAt(plan.steps[0]!.to.col, plan.steps[0]!.to.row)).toBeNull();
  });

  it('finishes a set the board built by itself', () => {
    nextId = 1;
    // A producer dropped the third piece beside the other two. They are
    // connected and still unmerged, because a merge only happens on a DROP.
    const board = [
      item('moonwater', 1, { col: 2, row: 2 }),
      item('moonwater', 1, { col: 3, row: 2 }),
      item('moonwater', 1, { col: 4, row: 2 })
    ];
    const plan = nextMergePlan(board, CHAINS, isle(board))!;
    expect(plan.steps.length).toBe(1);
    // The one gesture that works here IS a drop onto a piece — the flood
    // reaches three, so MergeSystem fuses instead of bouncing.
    const target = isle(board).itemIdAt(plan.steps[0]!.to.col, plan.steps[0]!.to.row);
    expect(target).not.toBeNull();
    expect(target).not.toBe(plan.steps[0]!.itemId);
  });

  it('refuses to point at a set split across two zones', () => {
    nextId = 1;
    // Adjacency never leaves a zone, so this trio cannot be merged by any
    // gesture at all. The old hint counted three and pointed anyway.
    const split = [
      item('moonwater', 1, { col: 1, row: 1 }),
      item('moonwater', 1, { col: 2, row: 1 }),
      item('moonwater', 1, { col: 6, row: 6 })
    ];
    const twoZones = isle(split, { zoneAt: (c) => (c < 4 ? 'main' : 'far') });
    expect(nextMergePlan(split, CHAINS, twoZones)).toBeNull();
    // …and the plain hint agrees, once it is given the board.
    expect(mergeHints(split, CHAINS, twoZones)).toEqual([]);
  });

  it('plans around holes in the ground', () => {
    nextId = 1;
    // The obvious gathering spot is missing from the map. The plan has to find
    // three cells that are painted AND connected, not three that look near.
    const board = [
      item('moonwater', 1, { col: 1, row: 1 }),
      item('moonwater', 1, { col: 1, row: 3 }),
      item('moonwater', 1, { col: 6, row: 6 })
    ];
    const grid = isle(board, { holes: ['1,2', '0,2', '2,2', '0,1', '2,1'] });
    const plan = nextMergePlan(board, CHAINS, grid)!;
    for (const step of plan.steps) {
      expect(grid.isActive(step.to.col, step.to.row)).toBe(true);
    }
  });

  it('says nothing rather than something wrong when there is no room', () => {
    nextId = 1;
    // A one-cell islet each: no three cells anywhere are connected.
    const board = [
      item('moonwater', 1, { col: 0, row: 0 }),
      item('moonwater', 1, { col: 2, row: 0 }),
      item('moonwater', 1, { col: 4, row: 0 })
    ];
    const grid = isle(board, { cols: 5, rows: 1, holes: ['1,0', '3,0'] });
    expect(nextMergePlan(board, CHAINS, grid)).toBeNull();
  });

  it('gives the same plan every time it is asked', () => {
    nextId = 1;
    const board = [
      item('moonwater', 1, { col: 1, row: 1 }),
      item('moonwater', 1, { col: 5, row: 1 }),
      item('moonwater', 1, { col: 3, row: 6 })
    ];
    const a = nextMergePlan(board, CHAINS, isle(board));
    const b = nextMergePlan([...board].reverse(), CHAINS, isle(board));
    expect(b).toEqual(a);
  });

  it('moves on to a merge it CAN make when the first one has nowhere to go', () => {
    nextId = 1;
    // Lumber is older, and stranded one piece per islet. Moonwater is younger
    // and sitting in a huddle — the hand should offer the one that works.
    const board = [
      item('lumber', 1, { col: 0, row: 0 }),
      item('lumber', 1, { col: 2, row: 0 }),
      item('lumber', 1, { col: 4, row: 0 }),
      item('moonwater', 1, { col: 0, row: 2 }),
      item('moonwater', 1, { col: 1, row: 2 }),
      item('moonwater', 1, { col: 4, row: 2 })
    ];
    // Each lumber cell is a one-cell islet: no active neighbour in any
    // direction, so no three of them can ever stand connected.
    const grid = isle(board, { cols: 5, rows: 3, holes: ['1,0', '3,0', '0,1', '2,1', '4,1'] });
    const plan = nextMergePlan(board, CHAINS, grid)!;
    expect(plan.chain).toBe('moonwater');
  });

  it('does the long haul first and fuses with the short flick', () => {
    nextId = 1;
    const board = [
      item('moonwater', 1, { col: 3, row: 3 }),
      item('moonwater', 1, { col: 4, row: 6 }), // near
      item('moonwater', 1, { col: 7, row: 0 }) // far
    ];
    const plan = nextMergePlan(board, CHAINS, isle(board))!;
    expect(plan.steps.length).toBe(2);
    expect(plan.steps[0]!.itemId).toBe(3); // the far one travels first
    expect(plan.steps[1]!.completes).toBe(true);
  });
});
