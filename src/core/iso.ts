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
 *
 * TWO LAYERS, on purpose:
 *
 *   `projectionOf` / `project` / `unproject` are PURE — a projection is a value
 *   you pass around. Nothing reads module state, so two grids can be live at
 *   once and a caller in node cannot silently get the wrong one.
 *
 *   `setProjection` / `gridToWorld` / `worldToGrid` are the ambient, one-grid
 *   convenience the running scene uses, implemented on top. They are correct
 *   only AFTER `setProjection`, which BoardScene.create does — so anything that
 *   must be right without a scene (saves, migration, tools, tests) uses the pure
 *   layer with the projection built from its own `map.tile`. When one world
 *   becomes many zones with different grids, the pure layer is already the
 *   shape that supports it; the ambient one is the thing that stops working.
 */
export interface Projection {
  /** Half tile width in world px — always TILE_W/2; the width reference is fixed. */
  halfW: number;
  /** Half tile height in world px, derived from the authored aspect. */
  halfH: number;
  /** tan(skew°) — the horizontal shear per row of depth. */
  skewK: number;
}

/** An authored tile footprint, as `MapData.tile` carries it. */
export interface TileSpec {
  width?: number;
  height?: number;
  skew?: number | null;
}

/** The game's default symmetric 2:1 iso. */
export const DEFAULT_PROJECTION: Projection = { halfW: TILE_W / 2, halfH: TILE_H / 2, skewK: 0 };

/**
 * Build a projection from an authored tile. Absent/degenerate → the classic 2:1.
 *
 * The game's width reference stays TILE_W whatever the authoring width was; the
 * vertical pitch comes from the authored ASPECT (height / width). The world
 * builder's `angle` is just atan(h/w), so matching the aspect matches the angle.
 */
export function projectionOf(tile?: TileSpec | null): Projection {
  const w = tile?.width;
  const h = tile?.height;
  return {
    halfW: TILE_W / 2,
    halfH: w && h ? (TILE_W * (h / w)) / 2 : TILE_H / 2,
    skewK: tile?.skew ? Math.tan((tile.skew * Math.PI) / 180) : 0
  };
}

/** Logical (col,row) -> world pixel centre of the tile, under `p`. */
export function project(p: Projection, col: number, row: number): { x: number; y: number } {
  const cx = p.halfW + p.skewK * p.halfH;
  const rx = -p.halfW + p.skewK * p.halfH;
  return {
    x: BOARD_ORIGIN_X + col * cx + row * rx,
    y: BOARD_ORIGIN_Y + (col + row) * p.halfH
  };
}

/** World pixel -> nearest logical tile under `p` (may be out of bounds). */
export function unproject(p: Projection, x: number, y: number): TilePos {
  const cx = p.halfW + p.skewK * p.halfH;
  const rx = -p.halfW + p.skewK * p.halfH;
  const det = cx * p.halfH - rx * p.halfH; // = 2·halfW·halfH, never 0
  const wx = x - BOARD_ORIGIN_X;
  const wy = y - BOARD_ORIGIN_Y;
  return {
    col: Math.round((wx * p.halfH - rx * wy) / det),
    row: Math.round((cx * wy - wx * p.halfH) / det)
  };
}

/** Same as `unproject` but WITHOUT rounding — the exact fractional cell. Used by
 *  the map-space migration, which needs to know how far off a cell centre a
 *  point landed before it decides the point still belongs to that cell. */
export function unprojectExact(p: Projection, x: number, y: number): { col: number; row: number } {
  const cx = p.halfW + p.skewK * p.halfH;
  const rx = -p.halfW + p.skewK * p.halfH;
  const det = cx * p.halfH - rx * p.halfH;
  const wx = x - BOARD_ORIGIN_X;
  const wy = y - BOARD_ORIGIN_Y;
  return {
    col: (wx * p.halfH - rx * wy) / det,
    row: (cx * wy - wx * p.halfH) / det
  };
}

/* ---------------- the ambient one-grid projection (scene use) ---------------- */

let current: Projection = { ...DEFAULT_PROJECTION };

/**
 * A zoned world's projector, installed by `world.ts`.
 *
 * When a world is many grids there is no single correct `Projection`, so the
 * ambient helpers below stop computing an answer and start asking for one. The
 * indirection (rather than importing world.ts here) keeps the dependency
 * one-way: world.ts already needs this module, and a cycle between the two
 * would be a real trap in files this central.
 */
export interface AmbientProjector {
  toWorld(col: number, row: number): { x: number; y: number };
  toGrid(x: number, y: number): TilePos;
}

let ambient: AmbientProjector | null = null;

/** Route the ambient helpers through a world. Null restores the plain grid. */
export function setAmbientProjector(projector: AmbientProjector | null): void {
  ambient = projector;
}

/** Adopt an authored tile's perspective for the ambient helpers. */
export function setProjection(tile?: TileSpec | null): void {
  current = projectionOf(tile);
}

/** The ambient projection as a value — hand this to the pure layer. */
export function currentProjection(): Projection {
  return current;
}

/** Current projection half-extents (the vertical one moves with the perspective). */
export const projHalfW = (): number => current.halfW;
export const projHalfH = (): number => current.halfH;

/** Logical (col,row) -> world pixel centre of the tile. Zone-aware once a world
 *  is active; unbounded either way (off-grid decor relies on that). */
export function gridToWorld(col: number, row: number): { x: number; y: number } {
  return ambient ? ambient.toWorld(col, row) : project(current, col, row);
}

/** World pixel -> nearest logical tile (may be out of bounds; caller clamps). */
export function worldToGrid(x: number, y: number): TilePos {
  return ambient ? ambient.toGrid(x, y) : unproject(current, x, y);
}
