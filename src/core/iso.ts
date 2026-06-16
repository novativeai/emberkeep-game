import { BOARD_ORIGIN_X, BOARD_ORIGIN_Y, TILE_H, TILE_W } from './Constants';
import type { TilePos } from './types';

/** Logical (col,row) -> world pixel centre of the tile (2:1 isometric). */
export function gridToWorld(col: number, row: number): { x: number; y: number } {
  return {
    x: BOARD_ORIGIN_X + ((col - row) * TILE_W) / 2,
    y: BOARD_ORIGIN_Y + ((col + row) * TILE_H) / 2
  };
}

/** World pixel -> nearest logical tile (may be out of bounds; caller clamps). */
export function worldToGrid(x: number, y: number): TilePos {
  const dx = (x - BOARD_ORIGIN_X) / (TILE_W / 2);
  const dy = (y - BOARD_ORIGIN_Y) / (TILE_H / 2);
  return {
    col: Math.round((dy + dx) / 2),
    row: Math.round((dy - dx) / 2)
  };
}
