import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { WORLD_TELEPORTS } from '../../src/core/Constants';
import mapData from '../../src/data/map.json';
import { getLattice, gridToWorld, projectIn, setLattice, setProjection, unprojectIn, worldToGrid } from '../../src/core/iso';
import { gridCellCenter, latticeFor, type GridDef } from '../../src/editor/editorStore';

/**
 * The per-world cell lattice.
 *
 * The game has ONE projection, configured at boot from the authored map. A world
 * whose backdrop art is painted at a different tile scale gets hand-drawn grids at
 * that scale, and folding them through the authored lattice collapses several drawn
 * cells onto one game cell — every one but the last silently unreachable.
 *
 * This is the ONLY possible guard for that: the whole custom-world path is dead
 * under `vite preview` (the `/__editor/map` route is dev-server middleware), so no
 * Playwright assertion can ever reach it.
 */

// iso.ts holds module-global state — always hand it back, or the next spec inherits
// a foreign lattice.
afterEach(() => setProjection(mapData.tile));

const isoGrid = (over: Partial<GridDef> = {}): GridDef => ({
  id: 'g1',
  name: 'Grille 1',
  persp: 'iso',
  tileW: 170,
  tileH: 92,
  cols: 3,
  rows: 3,
  ox: 1234,
  oy: 567,
  rot: 0,
  alloc: { '0,0': 1, '1,0': 1, '2,0': 1, '0,1': 1, '1,1': 1, '2,1': 1, '0,2': 1, '1,2': 1, '2,2': 1 },
  ...over
});

/** How many of a grid's allocated cells survive the fold into game cells. */
function distinctGameCells(grids: GridDef[]): { drawn: number; cells: number } {
  const seen = new Set<string>();
  let drawn = 0;
  for (const g of grids) {
    for (const [cell, lvl] of Object.entries(g.alloc ?? {})) {
      if (lvl <= 0) continue;
      drawn++;
      const [i, j] = cell.split(',').map(Number) as [number, number];
      const w = gridCellCenter(g, i, j);
      const { col, row } = worldToGrid(w.x, w.y);
      seen.add(`${col},${row}`);
    }
  }
  return { drawn, cells: seen.size };
}

describe('the per-world cell lattice', () => {
  it('adopts a drawn grid exactly — every cell round-trips to its own game cell', () => {
    const g = isoGrid();
    const lattice = latticeFor([g]);
    expect(lattice).not.toBeNull();
    setLattice(lattice!);

    // An unrotated iso grid IS this projection: cell (i,j) must land on the very
    // pixel the editor drew it at, not merely near it.
    for (let i = 0; i < g.cols; i++) {
      for (let j = 0; j < g.rows; j++) {
        const drawn = gridCellCenter(g, i, j);
        const game = gridToWorld(i, j);
        expect(game.x).toBeCloseTo(drawn.x, 6);
        expect(game.y).toBeCloseTo(drawn.y, 6);
        expect(worldToGrid(drawn.x, drawn.y)).toEqual({ col: i, row: j });
      }
    }
    const { drawn, cells } = distinctGameCells([g]);
    expect(cells).toBe(drawn); // nothing collapsed
  });

  it('the authored lattice DOES collapse a finer grid — the bug this exists to stop', () => {
    setProjection(mapData.tile); // 256 × 147.5
    const { drawn, cells } = distinctGameCells([isoGrid()]);
    expect(drawn).toBe(9);
    expect(cells).toBeLessThan(drawn); // several cells fold onto one
  });

  it('declines grids it cannot represent, so the world keeps the authored lattice', () => {
    expect(latticeFor([])).toBeNull();
    expect(latticeFor([isoGrid({ alloc: {} })])).toBeNull(); // nothing allocated
    expect(latticeFor([isoGrid({ rot: 12 })])).toBeNull(); // the game lattice has no rotation
    expect(latticeFor([isoGrid({ persp: 'ortho' })])).toBeNull(); // different basis
  });

  it('takes its pitch from the median grid and FITS its phase to every drawn cell', () => {
    const busy = isoGrid({ id: 'a', tileW: 170, tileH: 92, ox: 100, oy: 200 });
    const thin = isoGrid({ id: 'b', tileW: 200, tileH: 110, ox: 900, oy: 900, alloc: { '0,0': 1 } });
    const lattice = latticeFor([busy, thin])!;
    expect(lattice.halfW * 2).toBe(200); // median of [170, 200] on 2 items = the upper one

    // The phase is no longer copied from the busiest grid. Pinning ITS origin made
    // that one grid exact and let every other drift — and a cell that drifts far
    // enough shares a game cell with its neighbour, which means one of the two can
    // never hold a piece. The fitted phase spreads the unavoidable error instead.
    const pinned = { ...lattice, originX: busy.ox, originY: busy.oy };
    const drift = (l: typeof lattice): number => {
      let sum = 0;
      let n = 0;
      for (const g of [busy, thin]) {
        for (const cell of Object.keys(g.alloc ?? {})) {
          const [i, j] = cell.split(',').map(Number) as [number, number];
          const w = gridCellCenter(g, i, j);
          const back = projectIn(l, unprojectIn(l, w.x, w.y).col, unprojectIn(l, w.x, w.y).row);
          sum += Math.hypot(back.x - w.x, back.y - w.y);
          n++;
        }
      }
      return sum / n;
    };
    expect(drift(lattice)).toBeLessThan(drift(pinned));
  });

  it('leaves a world drawn on ONE consistent grid pixel-exact', () => {
    // The fit must have nothing to do when there is nothing to reconcile: one grid
    // at its own pitch already round-trips, so its origin must come back untouched.
    const g = isoGrid({ ox: 1234, oy: 567 });
    const lattice = latticeFor([g])!;
    expect(lattice.originX).toBeCloseTo(1234, 9);
    expect(lattice.originY).toBeCloseTo(567, 9);
  });

  it('setProjection restores the authored lattice', () => {
    setLattice({ halfW: 85, halfH: 46, skewK: 0, originX: 1, originY: 2 });
    setProjection(mapData.tile);
    const l = getLattice();
    expect(l.halfW).toBe(128);
    expect(l.halfH).toBeCloseTo((256 * (242 / 420)) / 2, 6);
    expect(l.originX).toBe(2560 / 2);
    expect(l.originY).toBe(316);
  });

  // Regression against the user's REAL worlds. Tolerant by design — it compares the
  // two lattices rather than pinning a count, so redrawing a grid cannot turn this
  // red for the wrong reason.
  it('recovers real cells in the SUB-worlds, and is rightly refused for the primary one', () => {
    const path = 'asset3d/editor-map.json';
    if (!existsSync(path)) return; // the editor project is not part of a clean checkout
    const project = JSON.parse(readFileSync(path, 'utf8')) as {
      maps?: { id: string; name: string }[];
      grids?: Record<string, GridDef[]>;
    };
    const subWorlds = new Set(WORLD_TELEPORTS.map((w) => w.toWorld));
    let checked = 0;
    for (const m of project.maps ?? []) {
      const grids = project.grids?.[m.id] ?? [];
      const lattice = latticeFor(grids);
      if (!lattice) continue;

      setProjection(mapData.tile);
      const authored = distinctGameCells(grids);
      setLattice(lattice);
      const own = distinctGameCells(grids);
      if (!authored.drawn) continue;

      if (subWorlds.has(m.name)) {
        // A teleport target is entered via world:switch, which adopts its lattice.
        expect(own.cells, `${m.name}: its own lattice must recover cells`).toBeGreaterThan(authored.cells);
        checked++;
      } else {
        // The PRIMARY world never switches, so it keeps the authored lattice — and it
        // must, whatever a fitted lattice scores: map.json's regions, the tutorial's
        // spawn cells and the camera's focal cells are all expressed in that lattice,
        // so re-pitching it would move the authored game out from under them. (This
        // used to assert that its own lattice was WORSE; once the phase became fitted
        // that stopped being true, and it was never the real reason.) What has to
        // hold is that its grids were drawn AT the authored pitch, so keeping it
        // costs next to nothing.
        expect(
          authored.cells / authored.drawn,
          `${m.name}: the primary world's grids should already sit on the authored lattice`
        ).toBeGreaterThan(0.95);
      }
    }
    expect(checked, 'at least one sub-world should have been measured').toBeGreaterThan(0);
  });
});
