import { describe, expect, it } from 'vitest';
import { MERGE_HINT_WEIGHTS } from '../../src/core/Constants';
import {
  type HintBoard,
  type MergePlan,
  mergeHints,
  nextMergeHint,
  nextMergePlan,
  planFor
} from '../../src/core/mergeHints';
import { verdictOnto, type DropVerdict, type RuleBoard } from '../../src/core/mergeRule';
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
 * The rule above says WHICH merge. These say how, and "how" is now the rule
 * in mergeRule.ts: a merge happens when, and only when, a piece is dropped ON
 * a matching piece and the target's cluster reaches the recipe. Dropped on
 * free ground a piece MOVES — three alike in a row stay three pieces. So a
 * plan is gathers onto free seats beside a growing cluster, then ONE drop ON
 * it, and these specs hold the planner to the same predicate the board runs
 * (`verdictOnto`). A hand running its own arithmetic can promise a fusion
 * MergeSystem refuses — which is exactly the planner this one replaced: it
 * parked the last piece on free ground beside the pair and waited for a
 * free-tile flood that no longer exists.
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

/** The RULE's view of the fixture board, with some of a plan's drags already
 *  made — how a test asks the board's own predicate about a promised drop. */
const ruleView = (items: BoardItemState[], grid: HintBoard, moved: Map<number, TilePos>): RuleBoard => ({
  itemAt: (c, r) => {
    for (const p of items) {
      const at = moved.get(p.id) ?? p;
      if (at.col === c && at.row === r) return { ...p, col: at.col, row: at.row };
    }
    return undefined;
  },
  neighbors: (c, r) => grid.neighbors(c, r),
  isTileActive: (c, r) => grid.isActive(c, r)
});

/** Carry out every gather of `plan` on an overlay and ask `verdictOnto` — the
 *  predicate MergeSystem runs — what the final drop would do. */
const finalVerdict = (plan: MergePlan, items: BoardItemState[], grid: HintBoard): DropVerdict => {
  const moved = new Map<number, TilePos>();
  for (const step of plan.steps.slice(0, -1)) moved.set(step.itemId, step.to);
  const view = ruleView(items, grid, moved);
  const last = plan.steps.at(-1)!;
  const raw = items.find((i) => i.id === last.itemId)!;
  const at = moved.get(raw.id) ?? raw;
  const dragged = { ...raw, col: at.col, row: at.row };
  const target = view.itemAt(last.to.col, last.to.row);
  if (!target || target.id === dragged.id) return { kind: 'none' };
  return verdictOnto(view, CHAINS, dragged, target);
};

describe('the plan', () => {
  it('prices a drag above every other weight put together — the invariant the ranking stands on', () => {
    // `nextMergePlan` breaks its walk on drag count alone (`dragFloor`), and
    // that is only sound while no pile of merit can buy an extra drag.
    const w = MERGE_HINT_WEIGHTS;
    expect(w.drag).toBeGreaterThan(w.near + w.haul + w.frame + w.tier + w.order + w.orderSpend + w.declined);
  });

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

  it('gathers beside the cluster, and the last drop lands ON it and really fuses', () => {
    nextId = 1;
    const board = [
      item('moonwater', 1, { col: 1, row: 1 }),
      item('moonwater', 1, { col: 5, row: 1 }),
      item('moonwater', 1, { col: 3, row: 6 })
    ];
    const grid = isle(board);
    const plan = nextMergePlan(board, CHAINS, grid)!;
    // Once the gathers are made, the pieces still standing are ONE flood —
    // gathers seat a piece BESIDE the cluster, never merely near it…
    const last = plan.steps.at(-1)!;
    const moved = new Map(plan.steps.slice(0, -1).map((s) => [s.itemId, s.to] as const));
    const seats = board
      .filter((p) => p.id !== last.itemId)
      .map((p) => moved.get(p.id) ?? { col: p.col, row: p.row });
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
    expect(seen.size).toBe(seats.length);
    // …and the final drop lands ON one of them, and the SAME predicate the
    // board runs on the drop says merge. Not our arithmetic — the rule's.
    expect(seats.some((s) => s.col === last.to.col && s.row === last.to.row)).toBe(true);
    expect(finalVerdict(plan, board, grid).kind).toBe('merge');
  });

  it('asks for ONE drag when two pieces are already side by side — dropped ON the pair', () => {
    nextId = 1;
    const board = [
      item('moonwater', 1, { col: 2, row: 2 }),
      item('moonwater', 1, { col: 3, row: 2 }),
      item('moonwater', 1, { col: 7, row: 7 })
    ];
    const grid = isle(board);
    const plan = nextMergePlan(board, CHAINS, grid)!;
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0]!.itemId).toBe(3); // the one standing apart
    expect(plan.steps[0]!.completes).toBe(true);
    // ONTO a member of the pair, never onto free ground beside them: a drop on
    // free ground is a plain move now, and the merge would simply not happen.
    expect([1, 2]).toContain(grid.itemIdAt(plan.steps[0]!.to.col, plan.steps[0]!.to.row));
    expect(finalVerdict(plan, board, grid).kind).toBe('merge');
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

  it('picks a LEAF to finish with, never the piece holding the set together', () => {
    nextId = 1;
    // The same three-in-a-row, but the MIDDLE piece is the oldest — which is
    // the order the pieces get walked in. The flood is walked on the board as
    // it stands now, so even the middle dropped on an end fuses — but the hand
    // still lifts a piece from the END: the pile is not pulled apart to reach
    // the piece that joins it, and the scene's lean (readyClusters) points the
    // leaves at the centre, so the hand and the lean must agree.
    const board = [
      item('moonwater', 1, { col: 3, row: 2 }), // id 1 — the middle
      item('moonwater', 1, { col: 2, row: 2 }),
      item('moonwater', 1, { col: 4, row: 2 })
    ];
    const grid = isle(board);
    const plan = nextMergePlan(board, CHAINS, grid)!;
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0]!.itemId).not.toBe(1);
    // And the proof rather than the proxy: with the mover lifted, the pieces
    // left standing are still one flood, and the drop lands on one of them.
    const mover = plan.steps[0]!.itemId;
    const staying = board.filter((p) => p.id !== mover).map((p) => ({ col: p.col, row: p.row }));
    const seen = new Set([`${staying[0]!.col},${staying[0]!.row}`]);
    const queue = [staying[0]!];
    while (queue.length) {
      const at = queue.shift()!;
      for (const n of grid.neighbors(at.col, at.row)) {
        const key = `${n.col},${n.row}`;
        if (seen.has(key) || !staying.some((s) => s.col === n.col && s.row === n.row)) continue;
        seen.add(key);
        queue.push(n);
      }
    }
    expect(seen.size).toBe(staying.length);
    expect(staying.some((s) => s.col === plan.steps[0]!.to.col && s.row === plan.steps[0]!.to.row)).toBe(true);
  });

  it('CARRIES a piece across zones — the move is not zone-bound, the merge is', () => {
    nextId = 1;
    // The rule the planner has to get right, and got wrong: `MergeSystem`'s
    // drop validation asks `isTileActive` and NOTHING about zones, so a piece
    // may be carried from any slab to any other. Only the flood that fuses is
    // zone-bound. Bucketing by zone confused the two and silenced the hint on
    // every world but the authored isle, which happens to be one dense slab.
    const split = [
      item('moonwater', 1, { col: 1, row: 1 }),
      item('moonwater', 1, { col: 2, row: 1 }),
      item('moonwater', 1, { col: 6, row: 6 })
    ];
    const twoZones = isle(split, { zoneAt: (c) => (c < 4 ? 'main' : 'far') });
    const plan = nextMergePlan(split, CHAINS, twoZones)!;
    expect(plan).not.toBeNull();
    // …and EVERY cell it asks a drop onto lies in ONE zone, because the
    // cluster grows through the board's own adjacency. That is where the zone
    // rule lives, and it is the half that must never be relaxed.
    const zones = new Set(plan.steps.map((st) => twoZones.zoneOf(st.to.col, st.to.row)));
    expect(zones.size).toBe(1);
    // The last step is the one that fuses; every other lands on free ground.
    expect(plan.steps.at(-1)!.completes).toBe(true);
    for (const st of plan.steps.slice(0, -1)) expect(st.completes).toBe(false);
  });

  it('still refuses when no single slab can hold the set', () => {
    nextId = 1;
    // Three pieces, and a world cut into one-cell slabs: no piece has a free
    // neighbour to gather onto, so no cluster of two can ever stand and no
    // drop can ever fuse. Silence here is the CORRECT answer, and the reason
    // the zone rule has to survive on the cluster even though it left the
    // bucket.
    const scattered = [
      item('moonwater', 1, { col: 0, row: 0 }),
      item('moonwater', 1, { col: 2, row: 2 }),
      item('moonwater', 1, { col: 4, row: 4 })
    ];
    const crumbs = isle(scattered, { zoneAt: (c, r) => `${c},${r}` });
    expect(nextMergePlan(scattered, CHAINS, crumbs)).toBeNull();
  });

  it('plans around holes in the ground', () => {
    nextId = 1;
    // The obvious gathering spot is missing from the map. The plan has to find
    // seats that are painted AND connected, not seats that look near.
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
    expect(finalVerdict(plan, board, grid).kind).toBe('merge');
  });

  it('says nothing rather than something wrong when there is no room', () => {
    nextId = 1;
    // A one-cell islet each: nothing can ever stand beside anything.
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
    // direction, so no two of them can ever stand connected.
    const grid = isle(board, { cols: 5, rows: 3, holes: ['1,0', '3,0', '0,1', '2,1', '4,1'] });
    const plan = nextMergePlan(board, CHAINS, grid)!;
    expect(plan.chain).toBe('moonwater');
  });

  /* ----------------------------------------------------------------------- *
   * WHICH MERGE GETS OFFERED, once more than one of them can be made.
   *
   * The queue is ordered first-completed, and for a while that was also the
   * offer: `nextMergePlan` returned the first plannable hint it walked past. On
   * 30% of measured mid-session boards across the three exported worlds that
   * handed the player a two-drag gather while a pair sat touching — a median
   * 1250 world units of swipe on Emberkeep where 506 was on the table. The
   * offer is now ordered by effort: drags, then haul, then the queue's own age
   * as the tie-break.
   * ----------------------------------------------------------------------- */
  it('offers the ONE-DRAG merge over an older set that needs two hauls', () => {
    nextId = 1;
    const board = [
      // The old set (ids 1-3), one piece per corner: two drags, whatever it does.
      item('lumber', 1, { col: 0, row: 0 }),
      item('lumber', 1, { col: 7, row: 0 }),
      item('lumber', 1, { col: 0, row: 7 }),
      // The young one (ids 4-6): a pair already touching, one piece to bring.
      item('moonwater', 1, { col: 3, row: 3 }),
      item('moonwater', 1, { col: 4, row: 3 }),
      item('moonwater', 1, { col: 6, row: 6 })
    ];
    const plan = nextMergePlan(board, CHAINS, isle(board))!;
    expect(plan.chain).toBe('moonwater');
    expect(plan.steps.length).toBe(1);
    // The queue itself is untouched — age still orders WHICH merges exist, it
    // just no longer decides which one is worth asking for.
    expect(mergeHints(board, CHAINS).map((h) => h.chain)).toEqual(['lumber', 'moonwater']);
  });

  it('takes the shorter haul when two merges cost the same one drag', () => {
    nextId = 1;
    const board = [
      // Older, and its third piece is right across the isle.
      item('lumber', 1, { col: 0, row: 0 }),
      item('lumber', 1, { col: 1, row: 0 }),
      item('lumber', 1, { col: 7, row: 7 }),
      // Younger, and its third piece is one tile from home.
      item('moonwater', 1, { col: 0, row: 5 }),
      item('moonwater', 1, { col: 1, row: 5 }),
      item('moonwater', 1, { col: 3, row: 5 })
    ];
    const plan = nextMergePlan(board, CHAINS, isle(board))!;
    expect(plan.chain).toBe('moonwater');
    expect(plan.steps.length).toBe(1);
  });

  it('falls back to the OLDEST when two merges cost exactly the same', () => {
    nextId = 1;
    // The same shape twice, five rows apart: same drags, same haul. Age is the
    // tie-break, which is what keeps the hand from flickering between two
    // equally good answers.
    const board = [
      item('lumber', 1, { col: 0, row: 0 }),
      item('lumber', 1, { col: 1, row: 0 }),
      item('lumber', 1, { col: 3, row: 0 }),
      item('moonwater', 1, { col: 0, row: 5 }),
      item('moonwater', 1, { col: 1, row: 5 }),
      item('moonwater', 1, { col: 3, row: 5 })
    ];
    const plan = nextMergePlan(board, CHAINS, isle(board))!;
    expect(plan.chain).toBe('lumber');
    // …and it does not depend on which order the board was iterated in.
    expect(nextMergePlan([...board].reverse(), CHAINS, isle(board))!.chain).toBe('lumber');
  });

  it('reports the haul it is asking for, and asks for none when the set already stands connected', () => {
    nextId = 1;
    const connected = [
      item('moonwater', 1, { col: 2, row: 2 }),
      item('moonwater', 1, { col: 3, row: 2 }),
      item('moonwater', 1, { col: 4, row: 2 })
    ];
    const settled = nextMergePlan(connected, CHAINS, isle(connected))!;
    expect(settled.steps.length).toBe(1);
    expect(settled.travel).toBe(0); // nothing travels; only the flick that fuses

    nextId = 1;
    const apart = [
      item('moonwater', 1, { col: 2, row: 2 }),
      item('moonwater', 1, { col: 3, row: 2 }),
      item('moonwater', 1, { col: 7, row: 7 })
    ];
    expect(nextMergePlan(apart, CHAINS, isle(apart))!.travel).toBeGreaterThan(0);
  });

  /* ----------------------------------------------------------------------- *
   * THE GAP BRIDGE — the shape that keeps breaking drag arithmetic.
   *
   * Three pieces touching nothing, one free hub joining them. Under the old
   * free-flood rule this was ONE drag — drop any piece into the hub — and the
   * planner's drag floor famously over-stated it as two and pruned the best
   * plan away. The drop-on rule prices it at TWO honestly: the hub drop is a
   * plain MOVE now, so the bridge has to be built first and dropped on
   * second. `dragFloor` is re-derived to match — one drag exists only when a
   * cluster of `need − 1` is already standing — and the decoy that used to
   * lose, the touching pair with the long haul, is now the win.
   * ----------------------------------------------------------------------- */
  it('prices the gap bridge at TWO drags — the hub drop is a move, not a merge', () => {
    nextId = 1;
    // (0,0), (2,0) and (1,1): pairwise non-adjacent, one hub at (1,0) joining
    // all three. One gather builds the bridge (the seat touches the other two,
    // so the cluster completes in a single move); the second drag drops ON it.
    const board = [
      item('lumber', 1, { col: 0, row: 0 }),
      item('lumber', 1, { col: 2, row: 0 }),
      item('lumber', 1, { col: 1, row: 1 })
    ];
    const grid = isle(board);
    // The premise, spelled out: nothing here is next to anything.
    for (const a of board) {
      for (const b of board) {
        if (a.id >= b.id) continue;
        expect(grid.neighbors(a.col, a.row).some((n) => n.col === b.col && n.row === b.row)).toBe(false);
      }
    }
    const plan = nextMergePlan(board, CHAINS, grid)!;
    expect(plan.steps.length).toBe(2);
    expect(plan.travel).toBe(1); // one tile into the hub; the fuse is a free flick
    // The gather lands on FREE ground — under the drop-on rule it fuses
    // nothing on its own, however the three then stand…
    expect(plan.steps[0]!.completes).toBe(false);
    expect(grid.itemIdAt(plan.steps[0]!.to.col, plan.steps[0]!.to.row)).toBeNull();
    // …and the second drag lands ON the cluster and the RULE calls it a merge.
    expect(finalVerdict(plan, board, grid).kind).toBe('merge');
  });

  it('offers the touching pair over the gap bridge, which now costs a second drag', () => {
    nextId = 1;
    // The mirror of the board that broke the OLD floor. Lumber is the gap
    // bridge: two drags now, one tile of swipe. Moonwater has a pair already
    // touching and its third six tiles away: one drag, six tiles of swipe.
    // Under the free-flood rule lumber won; under the drop-on rule a drag
    // outweighs any haul, so the pair must — and the floors (pair 1, bridge 2)
    // let the walk prove it without planning the bridge at all.
    const board = [
      item('lumber', 1, { col: 0, row: 0 }),
      item('lumber', 1, { col: 2, row: 0 }),
      item('lumber', 1, { col: 1, row: 1 }),
      item('moonwater', 1, { col: 0, row: 5 }),
      item('moonwater', 1, { col: 1, row: 5 }),
      item('moonwater', 1, { col: 7, row: 5 })
    ];
    const grid = isle(board);
    const plan = nextMergePlan(board, CHAINS, grid)!;
    expect(plan.chain).toBe('moonwater');
    expect(plan.steps.length).toBe(1);
    expect(plan.travel).toBe(6);

    // Against the WHOLE field, not a hand-picked answer: the pair costs one
    // drag, the bridge two, and the offer has to be the head of the list —
    // and every plan in the field has to end in a drop the rule would fuse.
    const field = mergeHints(board, CHAINS, grid)
      .map((h) => planFor(h, board, grid, CHAINS))
      .filter((p): p is MergePlan => !!p)
      .sort((a, b) => a.steps.length - b.steps.length || a.travel - b.travel || a.completedBy - b.completedBy);
    expect(field.map((p) => [p.chain, p.steps.length, p.travel])).toEqual([
      ['moonwater', 1, 6],
      ['lumber', 2, 1]
    ]);
    for (const p of field) expect(finalVerdict(p, board, grid).kind).toBe('merge');
    expect([plan.steps.length, plan.travel, plan.completedBy]).toEqual([
      field[0]!.steps.length,
      field[0]!.travel,
      field[0]!.completedBy
    ]);

    // …and the same board answers the same way whichever way it is walked.
    expect(nextMergePlan([...board].reverse(), CHAINS, isle(board))).toEqual(plan);
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
