import { BOARD_ORIGIN_X, BOARD_ORIGIN_Y, TILE_H, TILE_W } from './Constants';
import type { TilePos } from './types';

/**
 * Parametric axonometric projection (ported from the world-builder's `gridAxes`):
 * each world step (+col / +row) maps to a screen-space vector derived from the
 * tile half-extents + skew. The default is the game's symmetric 2:1 iso
 * (`skew 0`); `setProjection` re-derives the vertical pitch + shear from an
 * imported world's `map.tile` so its authored grid perspective (aspect / skew /
 * angle) is honoured. Width stays the game's `TILE_W` reference — tile-art scale
 * and the camera math are unchanged; only the vertical pitch + shear move.
 *
 * det = 2·halfW·halfH is always non-zero, so the projection stays invertible
 * (worldToGrid works at any aspect/skew).
 */
let halfW = TILE_W / 2;
let halfH = TILE_H / 2;
let skewK = 0; // tan(skew°)
let originX = BOARD_ORIGIN_X;
let originY = BOARD_ORIGIN_Y;

/**
 * A complete cell lattice: pitch, shear and PHASE. The phase matters as much as
 * the pitch — a lattice at the right pitch but the wrong origin still lands every
 * piece half a cell off the tile it was drawn on.
 */
export interface Lattice {
  halfW: number;
  halfH: number;
  skewK: number;
  originX: number;
  originY: number;
}

/** Adopt an authored tile's perspective. Absent/degenerate → the classic 2:1.
 *  Also restores the authored ORIGIN, so this doubles as "back to the base world". */
export function setProjection(tile?: { width?: number; height?: number; skew?: number | null } | null): void {
  const w = tile?.width;
  const h = tile?.height;
  halfW = TILE_W / 2;
  // Keep the game's width reference; derive the vertical pitch from the authored
  // aspect (height / width). The world-builder's `angle` is just atan(h/w), so
  // matching the aspect matches the angle too.
  halfH = w && h ? (TILE_W * (h / w)) / 2 : TILE_H / 2;
  skewK = tile?.skew ? Math.tan((tile.skew * Math.PI) / 180) : 0;
  originX = BOARD_ORIGIN_X;
  originY = BOARD_ORIGIN_Y;
}

/**
 * Adopt an EXPLICIT lattice — how a custom world takes on the pitch of the grid
 * it was hand-drawn with.
 *
 * The authored lattice (256 × 147.5) comes from the BASE map's art. A world whose
 * backdrop is painted at a different tile scale gets grids drawn at that scale, and
 * folding them through the base lattice collapses several drawn cells onto one game
 * cell — measured at 53% of roothold's cells and 50% of borealis'. Giving each world
 * its own lattice removes that: both are at 0% loss (`node scripts/audit-grids.mjs`).
 * Borealis needed the phase FIT in `latticeFor` to get there — pitch alone left it
 * at 6% loss and half a cell of visible drift under the pieces.
 *
 * An editor grid with `persp:'iso'` and no rotation IS a lattice: its basis is
 * u = (tileW/2, tileH/2), v = (−tileW/2, tileH/2) — exactly this projection at
 * halfW = tileW/2, halfH = tileH/2, skew 0. That identity is why the conversion is
 * lossless rather than a fit.
 */
export function setLattice(l: Lattice): void {
  halfW = l.halfW;
  halfH = l.halfH;
  skewK = l.skewK;
  originX = l.originX;
  originY = l.originY;
}

/** The live lattice — capture it before a world switch to restore it after. */
export function getLattice(): Lattice {
  return { halfW, halfH, skewK, originX, originY };
}

/** Current projection half-extents (the vertical one moves with the perspective). */
export const projHalfW = (): number => halfW;
export const projHalfH = (): number => halfH;

/** Logical (col,row) -> world pixel centre, in an EXPLICIT lattice. Same math as
 *  `gridToWorld`, without reading the live one — so a candidate lattice can be
 *  measured before it is adopted (editorStore.latticeFor fits its phase this way). */
export function projectIn(l: Lattice, col: number, row: number): { x: number; y: number } {
  const cx = l.halfW + l.skewK * l.halfH;
  const rx = -l.halfW + l.skewK * l.halfH;
  return {
    x: l.originX + col * cx + row * rx,
    y: l.originY + (col + row) * l.halfH
  };
}

/** World pixel -> nearest logical tile, in an EXPLICIT lattice. */
export function unprojectIn(l: Lattice, x: number, y: number): TilePos {
  const cx = l.halfW + l.skewK * l.halfH;
  const rx = -l.halfW + l.skewK * l.halfH;
  const det = cx * l.halfH - rx * l.halfH; // = 2·halfW·halfH
  const wx = x - l.originX;
  const wy = y - l.originY;
  return {
    col: Math.round((wx * l.halfH - rx * wy) / det),
    row: Math.round((cx * wy - wx * l.halfH) / det)
  };
}

/** Logical (col,row) -> world pixel centre of the tile. */
export function gridToWorld(col: number, row: number): { x: number; y: number } {
  return projectIn({ halfW, halfH, skewK, originX, originY }, col, row);
}

/** World pixel -> nearest logical tile (may be out of bounds; caller clamps). */
export function worldToGrid(x: number, y: number): TilePos {
  return unprojectIn({ halfW, halfH, skewK, originX, originY }, x, y);
}
