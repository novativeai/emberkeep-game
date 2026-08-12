import { describe, expect, it } from 'vitest';
import map from '../../src/data/map.json';
import zones from '../../src/data/zones.json';

/**
 * WHAT THE PLAYER CAN STAND ON, CHECKED EVERYWHERE.
 *
 * No world here paints its own floor. Every playable cell is `invisible` and
 * the BACKDROP's flagstones are the floor, so a playable cell is a CLAIM about
 * the painting: "there is stone here". When the claim is false the board still
 * accepts the drop, the art still shows open sky, and the piece is standing on
 * a cloud. Four such cells shipped on the isle — a 2×2 block hanging under the
 * southern edge, in the `active` region, droppable from the first frame.
 *
 * Two halves guard that, and only together:
 *
 *   `scripts/audit-ground.py` asks the ART. It samples each cell over its own
 *   tile footprint and flags the ones that do not look like the ground around
 *   them. That is the half that can see a hole, and it needs the images, so it
 *   is a script (`pnpm audit:ground`) rather than a test.
 *
 *   THIS FILE asks the DATA — the invariants that hold with no image at all,
 *   for every world, and that no re-export may quietly break.
 */

const key = (c: number, r: number) => `${c},${r}`;
const setOf = (cells: number[][]) => new Set(cells.map(([c, r]) => key(c!, r!)));

describe('the authored isle', () => {
  const playable = map.playable;

  /**
   * A detached block is ground with no path to the rest of the isle: it cannot
   * be walked to, cannot be adjacent to anything, and in practice is drawn
   * floating in the clouds. That is the structural signature of ground the
   * painting does not support, and it is checked structurally so that a
   * re-export which shifts the isle is caught the same way — not just the one
   * block that was found.
   *
   * ONLY the isle. Every other world is deliberately an archipelago: the map
   * editor cut them into one zone per painted island, and those islands are
   * meant to be apart.
   */
  it('is one connected island — no ground floating off on its own', () => {
    const cells = setOf(playable);
    const seen = new Set<string>();
    const components: string[][] = [];

    for (const start of cells) {
      if (seen.has(start)) continue;
      const stack = [start];
      const found: string[] = [];
      seen.add(start);
      while (stack.length) {
        const cur = stack.pop()!;
        found.push(cur);
        const [c, r] = cur.split(',').map(Number) as [number, number];
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1]
        ] as const) {
          const next = key(c + dc, r + dr);
          if (cells.has(next) && !seen.has(next)) {
            seen.add(next);
            stack.push(next);
          }
        }
      }
      components.push(found);
    }

    // The offenders travel with the failure: a bare `toBe(1)` tells nobody
    // which cells to go and look at on the backdrop.
    const detached = components.sort((a, b) => b.length - a.length).slice(1).flat();
    expect(detached).toEqual([]);
  });

  it('describes the same cells everywhere it lists them', () => {
    const cells = setOf(playable);
    expect(cells.size).toBe(playable.length);

    const invisible = setOf(map.invisible);
    expect([...cells].filter((k) => !invisible.has(k))).toEqual([]);
    expect([...cells].filter((k) => !(k in map.tilesByCell))).toEqual([]);

    const owned = map.regions.flatMap((r) => r.tiles.map(([c, x]) => key(c!, x!)));
    expect(owned.length).toBe(new Set(owned).size);
    expect([...owned].filter((k) => !cells.has(k))).toEqual([]);
    expect([...cells].filter((k) => !owned.includes(k))).toEqual([]);
  });
});

describe.each(zones.worlds.map((w) => [w.id, w] as const))('the ground of %s', (_id, world) => {
  const playable = setOf(world.map.playable);

  it('lists every playable cell exactly once, and paints none of them', () => {
    expect(playable.size).toBe(world.map.playable.length);
    // `invisible` is what tells the renderer to leave the backdrop showing. A
    // playable cell missing from it gets a tile painted over the art.
    const invisible = setOf(world.map.invisible);
    expect([...playable].filter((k) => !invisible.has(k))).toEqual([]);
    expect([...invisible].filter((k) => !playable.has(k))).toEqual([]);
  });

  it('is partitioned by its regions — no cell unowned, none owned twice', () => {
    const owned = world.map.regions.flatMap((r) => r.tiles.map(([c, x]) => key(c!, x!)));
    expect(owned.length).toBe(new Set(owned).size);
    expect(owned.filter((k) => !playable.has(k))).toEqual([]);
    expect([...playable].filter((k) => !owned.includes(k))).toEqual([]);
  });

  /**
   * A cell index only means something beside the grid that owns it, so every
   * playable address has to resolve to exactly one zone. Two zones sharing an
   * index block is the failure that puts a piece on one island and draws it on
   * another; a playable address in no zone is a piece with nowhere to be drawn.
   */
  it('gives every cell exactly one zone, and no zone claims another zone’s block', () => {
    const owner = new Map<string, string>();
    for (const zone of world.zones) {
      for (const [i, j] of zone.cells) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(j).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(zone.matrix[0]!);
        expect(j).toBeLessThan(zone.matrix[1]!);
        const k = key(zone.block[0]! + i!, zone.block[1]! + j!);
        expect(owner.get(k)).toBeUndefined();
        owner.set(k, zone.id);
      }
    }
    expect([...playable].filter((k) => !owner.has(k))).toEqual([]);
    expect([...owner.keys()].filter((k) => !playable.has(k))).toEqual([]);
  });
});
