import { describe, expect, it } from 'vitest';
import { buildWorlds, hasCell, neighborsOf, worldPointOf, zoneAt } from '../../src/core/world';
import { nextMergePlan, type HintBoard } from '../../src/core/mergeHints';
import mapJson from '../../src/data/map.json';
import chainsJson from '../../src/data/chains.json';
import type { BoardItemState, ChainsData, MapData } from '../../src/core/types';

/**
 * THE HINT, ON THE GROUND THE GAME ACTUALLY SHIPS.
 *
 * The fixture tests prove the rule; this proves the rule survives contact with
 * the exported worlds — which is where it failed. The planner bucketed pieces
 * BY ZONE, copying the merge rule onto the gather, and that is invisible on
 * Emberkeep (one dense slab holds the whole playable isle) and fatal on
 * Borealis (38 slabs, at most 9 cells each): three of a kind almost never
 * shared a bucket, so the hand simply never came up. "It works on nb2 but not
 * the other maps" was that, exactly.
 *
 * Two properties, and the second is the one that must never be traded for the
 * first: a scattered set gets a PLAN, and every plan really fuses — the three
 * pieces end up as ONE connected flood through the world's own adjacency,
 * which is what MergeSystem does when the last piece lands.
 */

const worlds = buildWorlds(mapJson as unknown as MapData);
const CHAINS = chainsJson as unknown as ChainsData;

/** Every playable cell of a world, in a stable order. */
function groundOf(world: ReturnType<typeof buildWorlds> extends Map<string, infer W> ? W : never) {
  const cells: { col: number; row: number }[] = [];
  for (const z of world.zones) {
    for (const local of z.cells) {
      const [i = 0, j = 0] = local.split(',').map(Number);
      const col = z.block.col + i;
      const row = z.block.row + j;
      if (hasCell(world, col, row)) cells.push({ col, row });
    }
  }
  return cells;
}

function boardFor(
  world: Parameters<typeof groundOf>[0],
  items: BoardItemState[]
): HintBoard {
  return {
    isActive: (c, r) => hasCell(world, c, r),
    itemIdAt: (c, r) => items.find((i) => i.col === c && i.row === r)?.id ?? null,
    neighbors: (c, r) => neighborsOf(world, c, r),
    zoneOf: (c, r) => zoneAt(world, c, r)?.id,
    distance: (a, b) => {
      const pa = worldPointOf(world, a.col, a.row);
      const pb = worldPointOf(world, b.col, b.row);
      return (pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2;
    }
  };
}

/** Are these cells one orthogonally-connected group, by the world's own graph? */
function oneFlood(
  world: Parameters<typeof groundOf>[0],
  spots: { col: number; row: number }[]
): boolean {
  const want = new Set(spots.map((s) => `${s.col},${s.row}`));
  if (want.size !== spots.length) return false; // two pieces on one cell
  const seen = new Set([`${spots[0]!.col},${spots[0]!.row}`]);
  const queue = [spots[0]!];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of neighborsOf(world, cur.col, cur.row)) {
      const k = `${n.col},${n.row}`;
      if (want.has(k) && !seen.has(k)) {
        seen.add(k);
        queue.push(n);
      }
    }
  }
  return seen.size === want.size;
}

describe('the merge planner, on every shipped world', () => {
  for (const [id, world] of worlds) {
    const ground = groundOf(world);
    // A world with almost no ground cannot host a 3-merge, and saying nothing
    // there is the CORRECT answer — Runevault is five one-cell slabs.
    if (ground.length < 12) continue;

    it(`${id}: offers a plan for scattered pieces, and every plan really fuses`, () => {
      let offered = 0;
      let tried = 0;
      for (let t = 0; t < 40; t++) {
        const pick = [
          ground[(t * 7) % ground.length]!,
          ground[(t * 13 + 3) % ground.length]!,
          ground[(t * 29 + 11) % ground.length]!
        ];
        if (new Set(pick.map((c) => `${c.col},${c.row}`)).size < 3) continue;
        tried++;
        const items = pick.map(
          (c, n) =>
            ({ id: n + 1, chain: 'flame_gem', tier: 1, col: c.col, row: c.row, kind: 'item' }) as BoardItemState
        );
        const board = boardFor(world, items);
        const plan = nextMergePlan(items, CHAINS, board);
        if (!plan) continue;
        offered++;

        // Where each piece ends up once the plan has been carried out.
        const finals = new Map(items.map((i) => [i.id, { col: i.col, row: i.row }]));
        for (const step of plan.steps) finals.set(step.itemId, step.to);
        expect(oneFlood(world, [...finals.values()]), `${id}: plan does not fuse`).toBe(true);

        // The safety property: every step but the last lands on FREE ground, so
        // no intermediate drag can bounce off an occupied tile.
        expect(plan.steps.at(-1)!.completes).toBe(true);
        for (const step of plan.steps.slice(0, -1)) expect(step.completes).toBe(false);
      }
      // The regression itself: this was ~0 on every world but Emberkeep.
      expect(offered / tried).toBeGreaterThan(0.9);
    });
  }
});
