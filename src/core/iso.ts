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

/** Adopt an authored tile's perspective. Absent/degenerate → the classic 2:1. */
export function setProjection(tile?: { width?: number; height?: number; skew?: number | null } | null): void {
  const w = tile?.width;
  const h = tile?.height;
  halfW = TILE_W / 2;
  // Keep the game's width reference; derive the vertical pitch from the authored
  // aspect (height / width). The world-builder's `angle` is just atan(h/w), so
  // matching the aspect matches the angle too.
  halfH = w && h ? (TILE_W * (h / w)) / 2 : TILE_H / 2;
  skewK = tile?.skew ? Math.tan((tile.skew * Math.PI) / 180) : 0;
}

/** Current projection half-extents (the vertical one moves with the perspective). */
export const projHalfW = (): number => halfW;
export const projHalfH = (): number => halfH;

/** Logical (col,row) -> world pixel centre of the tile. */
export function gridToWorld(col: number, row: number): { x: number; y: number } {
  const cx = halfW + skewK * halfH;
  const rx = -halfW + skewK * halfH;
  return {
    x: BOARD_ORIGIN_X + col * cx + row * rx,
    y: BOARD_ORIGIN_Y + (col + row) * halfH
  };
}

/** World pixel -> nearest logical tile (may be out of bounds; caller clamps). */
export function worldToGrid(x: number, y: number): TilePos {
  const cx = halfW + skewK * halfH;
  const rx = -halfW + skewK * halfH;
  const cy = halfH;
  const ry = halfH;
  const det = cx * ry - rx * cy; // = 2·halfW·halfH
  const wx = x - BOARD_ORIGIN_X;
  const wy = y - BOARD_ORIGIN_Y;
  return {
    col: Math.round((wx * ry - rx * wy) / det),
    row: Math.round((cx * wy - wx * cy) / det)
  };
}
