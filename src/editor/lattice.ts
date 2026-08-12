import type { TilePos } from '../core/types';

/**
 * The editor's own cell lattice.
 *
 * A hand-drawn grid is an ORIGIN plus a step — it is placed on its backdrop art,
 * not on the game's board, so it carries an origin the engine's projection never
 * needs (`core/iso` measures from `BOARD_ORIGIN_*`, one grid at a time). Keeping
 * the two apart is the point: the editor lays out many grids at once, each at its
 * own pitch, while the running game asks a different question — "where does THIS
 * cell land" — and answers it through `core/world`'s zone registry.
 *
 * This used to live in `core/iso.ts` as `Lattice`/`setLattice`, back when the game
 * had one global lattice the editor could re-point. The engine now holds a world
 * as many independently placed zones (`core/world.ts`), so the ambient lattice is
 * gone and this math belongs to the tool that actually draws grids.
 */
export interface Lattice {
  halfW: number;
  halfH: number;
  skewK: number;
  originX: number;
  originY: number;
}

/** Cell (col,row) → the pixel at its centre, in the lattice's own space. */
export function projectIn(l: Lattice, col: number, row: number): { x: number; y: number } {
  const cx = l.halfW + l.skewK * l.halfH;
  const rx = -l.halfW + l.skewK * l.halfH;
  return {
    x: l.originX + col * cx + row * rx,
    y: l.originY + (col + row) * l.halfH
  };
}

/** The inverse: a pixel → the cell that covers it. `det = 2·halfW·halfH` is never
 *  zero for a drawable grid, so this stays invertible at any aspect or skew. */
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
