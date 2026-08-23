import { describe, expect, it } from 'vitest';
import sourceExport from '../../assets/map/nionja-worlds.json';
import worldsJson from '../../src/data/worlds.json';
import type { WorldsData } from '../../src/core/zones';
import { worldById, worldCells, zoneCellAt, zoneCellCenter } from '../../src/core/zones';

const WORLDS = worldsJson as unknown as WorldsData;

/** The Map Editor export the registry is generated from. */
interface SourceCell {
  i: number;
  j: number;
  world: { x: number; y: number };
  gameCell: { col: number; row: number };
  unlockLevel: number;
}
interface SourceWorld {
  map: string;
  grids: { id: string; cells?: SourceCell[] }[];
}
const SOURCE = sourceExport as unknown as { worlds: SourceWorld[] };
const sourceCells = SOURCE.worlds.flatMap((w) => w.grids.flatMap((g) => g.cells ?? []));

describe('worlds registry — the ingest loses nothing', () => {
  it('carries every world, zone and playable cell the editor exported', () => {
    expect(WORLDS.worlds).toHaveLength(SOURCE.worlds.length);
    const zones = WORLDS.worlds.reduce((n, w) => n + w.zones.length, 0);
    const sourceZones = SOURCE.worlds.reduce((n, w) => n + w.grids.length, 0);
    expect(zones).toBe(sourceZones);
    expect(WORLDS.worlds.flatMap(worldCells)).toHaveLength(sourceCells.length);
    // The shipped level design, pinned. It MOVES when he draws: on 2026-08-14,
    // 367 → 366 when Grille 2 of the emberkeep map dropped its level-3 cell, then
    // 366 → 367 when Runevault's Grille 16 — the 1×1 on the wooden landing — was
    // allocated so the Rune Stair door has ground under it; 367 → 369 on
    // 2026-08-20 when emberkeep's Grille 27 gained a cell and Grille 28 its
    // first; 369 → 371 on 2026-08-21 with the re-draw that also renumbered
    // Borealis's unlock levels, and 371 → 367 later the same day when four of
    // emberkeep's cells were taken back out. Update it with the export; the
    // number is here to catch a count that changed when NOTHING was drawn,
    // which is what a lost grid or a half-loaded pager looks like.
    // 367 → 368 on 2026-08-23, the pass that re-levelled both maps so each
    // fog bank lifts on its own Keeper rank; one cell was drawn along the way.
    expect(sourceCells.length).toBe(368);
  });

  it('keeps each cell at the exact world point the editor placed it', () => {
    for (const w of SOURCE.worlds) {
      const mine = WORLDS.worlds.find((x) => x.name === w.map)!;
      for (const [gi, g] of w.grids.entries()) {
        const zone = mine.zones[gi]!;
        expect(zone.id).toBe(g.id);
        for (const [ci, c] of (g.cells ?? []).entries()) {
          const cell = zone.cells[ci]!;
          expect({ i: cell.i, j: cell.j, x: cell.x, y: cell.y, unlock: cell.unlock }).toEqual({
            i: c.i,
            j: c.j,
            x: c.world.x,
            y: c.world.y,
            unlock: c.unlockLevel
          });
        }
      }
    }
  });

  /**
   * The guard that justifies the whole design. The export also offers a
   * `gameCell` — each cell projected onto the game's single coarse lattice — and
   * it is tempting because it plugs straight into today's engine. It is also
   * lossy enough to delete two-fifths of the level design without a warning.
   *
   * A FRACTION, not a count. The exact number was pinned at 149 and it is not a
   * stable property of the level design: `gameCell` is filled from whatever
   * projection the editor had ambient when the export was written, so the two
   * writers disagree about a handful of cells and the collisions shift with them
   * (149 from `scripts/export-editor-worlds.mjs`, 144 from the editor's own
   * Apply, same 367 cells either way). Pinning the count made this test a report
   * on which button was pressed. The claim being made is that the collapse is
   * CATASTROPHIC, and that is true of both.
   */
  it('proves `gameCell` is lossy, which is why the registry keys off world pixels', () => {
    let collapsed = 0;
    for (const w of SOURCE.worlds) {
      const seen = new Set<string>();
      for (const g of w.grids) {
        for (const c of g.cells ?? []) {
          const key = `${c.gameCell.col},${c.gameCell.row}`;
          if (seen.has(key)) collapsed++;
          seen.add(key);
        }
      }
    }
    expect(collapsed / sourceCells.length).toBeGreaterThan(0.3); // ~40% — borealis alone loses about half
    // …whereas the world points we DO key off are unique per world.
    for (const w of WORLDS.worlds) {
      const pts = worldCells(w).map(({ cell }) => `${cell.x},${cell.y}`);
      expect(new Set(pts).size).toBe(pts.length);
    }
  });
});

describe('worlds registry — shape', () => {
  it('names exactly one primary world and a resolvable teleport target', () => {
    const primary = WORLDS.worlds.filter((w) => w.primary);
    expect(primary).toHaveLength(1);
    expect(WORLDS.primary).toBe(primary[0]!.id);
    expect(worldById(WORLDS, WORLDS.primary!)).toBeDefined();
    expect(WORLDS.teleport).not.toBeNull();
    expect(worldById(WORLDS, WORLDS.teleport!.toWorld)).toBeDefined();
  });

  it('has unique world and zone ids, and finite geometry throughout', () => {
    const ids = WORLDS.worlds.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    const zoneIds = WORLDS.worlds.flatMap((w) => w.zones.map((z) => z.id));
    expect(new Set(zoneIds).size).toBe(zoneIds.length);
    for (const w of WORLDS.worlds) {
      for (const z of w.zones) {
        expect(z.tile.w).toBeGreaterThan(0);
        expect(z.tile.h).toBeGreaterThan(0);
        expect(Math.abs(z.rotation)).toBeLessThanOrEqual(180);
        for (const c of z.cells) {
          expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
          expect(c.i).toBeGreaterThanOrEqual(0);
          expect(c.j).toBeGreaterThanOrEqual(0);
          expect(c.i).toBeLessThan(z.matrix.cols);
          expect(c.j).toBeLessThan(z.matrix.rows);
        }
      }
    }
  });
});

describe('zone geometry — we can reproduce the editor, so a renderer can trust us', () => {
  it('derives every shipped cell centre from (perspective, tile, origin, rotation)', () => {
    let checked = 0;
    let worst = 0;
    for (const w of WORLDS.worlds) {
      for (const z of w.zones) {
        for (const c of z.cells) {
          const p = zoneCellCenter(z, c.i, c.j);
          worst = Math.max(worst, Math.abs(p.x - c.x), Math.abs(p.y - c.y));
          checked++;
        }
      }
    }
    expect(checked).toBe(sourceCells.length); // every drawn cell, whatever he drew
    // The export rounds its world points to whole pixels, so agreement to within
    // a pixel IS exact agreement. Anything larger would mean we had misread the
    // basis, the pivot or the rotation convention.
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('round-trips world pixels back to the cell they came from', () => {
    for (const w of WORLDS.worlds) {
      for (const z of w.zones) {
        for (const c of z.cells) {
          expect(zoneCellAt(z, c.x, c.y)).toEqual({ i: c.i, j: c.j });
        }
      }
    }
  });

  it('reports null outside a zone rather than inventing a cell', () => {
    const z = WORLDS.worlds.flatMap((w) => w.zones).find((x) => x.cells.length > 0)!;
    expect(zoneCellAt(z, z.origin.x + 1e6, z.origin.y + 1e6)).toBeNull();
  });
});
