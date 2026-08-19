import { describe, expect, it } from 'vitest';
import mapJson from '../../src/data/map.json';
import {
  buildWorlds,
  cellAtWorldPoint,
  groundCellAtWorldPoint,
  hasCell,
  worldPointOf
} from '../../src/core/world';
import type { MapData } from '../../src/core/types';

/**
 * A POINT IN OPEN SKY IS NOT STANDING ON ANYTHING.
 *
 * `cellAtWorldPoint` falls back to the world's lattice when no zone owns the
 * point — and every world ships the SAME fallback, the authored Emberkeep isle
 * at 148px pitch and origin (1280,316). Borealis, Roothold and the Runevault
 * are built from the editor's own zones on their own pitch, so that fallback
 * projects their open sky onto small Emberkeep indices — indices those worlds'
 * zones already own. `hasCell` then answers about an island somewhere else
 * entirely, and the caller is told there is floor under the clouds.
 *
 * That is what lit a shadow under a piece carried out over the void, and what
 * would have let a drop there move it to another isle. `groundCellAtWorldPoint`
 * is the answer with no fallback in it; this pins the difference.
 */
const worlds = buildWorlds(mapJson as unknown as MapData);

/** Every real cell centre in a world, and the box they span. */
function groundOf(world: ReturnType<typeof buildWorlds> extends Map<string, infer W> ? W : never) {
  const centres: { x: number; y: number }[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const z of world.zones) {
    for (let i = 0; i < z.matrix.cols; i++) {
      for (let j = 0; j < z.matrix.rows; j++) {
        const col = z.block.col + i;
        const row = z.block.row + j;
        if (!hasCell(world, col, row)) continue;
        const p = worldPointOf(world, col, row);
        centres.push(p);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
  }
  return { centres, minX, maxX, minY, maxY };
}

describe('groundCellAtWorldPoint', () => {
  for (const id of [...worlds.keys()]) {
    const world = worlds.get(id)!;

    it(`${id}: every cell centre resolves to its own cell`, () => {
      for (const z of world.zones) {
        for (let i = 0; i < z.matrix.cols; i++) {
          for (let j = 0; j < z.matrix.rows; j++) {
            const col = z.block.col + i;
            const row = z.block.row + j;
            if (!hasCell(world, col, row)) continue;
            const p = worldPointOf(world, col, row);
            expect(groundCellAtWorldPoint(world, p.x, p.y)).toEqual({ col, row });
          }
        }
      }
    });

    it(`${id}: never claims ground more than one tile from a real cell`, () => {
      const { minX, maxX, minY, maxY } = groundOf(world);
      // A generous ceiling: the widest tile any shipped world uses is ~185px
      // across, so a point standing on a cell is never further than that from
      // its centre. Anything beyond is the lattice inventing an address.
      const REACH = 260;
      const spanX = maxX - minX;
      const spanY = maxY - minY;
      const stepX = spanX / 60;
      const stepY = spanY / 60;
      let checked = 0;
      for (let x = minX - spanX * 0.25; x <= maxX + spanX * 0.25; x += stepX) {
        for (let y = minY - spanY * 0.25; y <= maxY + spanY * 0.25; y += stepY) {
          const cell = groundCellAtWorldPoint(world, x, y);
          if (!cell) continue;
          checked++;
          expect(hasCell(world, cell.col, cell.row)).toBe(true);
          const c = worldPointOf(world, cell.col, cell.row);
          expect(Math.hypot(c.x - x, c.y - y)).toBeLessThan(REACH);
        }
      }
      expect(checked).toBeGreaterThan(100); // the sweep really did cross the isle
    });

    it(`${id}: a point well outside every isle is null, though the lattice still names a cell`, () => {
      const { centres, minX, maxX, minY, maxY } = groundOf(world);
      const far = { x: maxX + (maxX - minX), y: minY - (maxY - minY) };
      const nearest = Math.min(...centres.map((c) => Math.hypot(c.x - far.x, c.y - far.y)));
      expect(nearest).toBeGreaterThan(600); // the probe really is out in the sky
      expect(groundCellAtWorldPoint(world, far.x, far.y)).toBeNull();
      // …and the unbounded projection still answers, which is its job.
      expect(cellAtWorldPoint(world, far.x, far.y)).toBeTruthy();
    });
  }
});
