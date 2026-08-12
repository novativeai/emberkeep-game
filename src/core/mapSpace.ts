/**
 * MAP SPACE — the coordinate that survives a re-grid.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every position in Emberkeep is a `(col,row)` on ONE grid belonging to ONE
 * world. That is about to stop being true twice over: a world becomes a set of
 * ZONES with their own separated tile patches (`world -> zone -> tile`), and
 * there will be several worlds with entirely different grid sizes. The moment
 * either lands, a stored `(col,row)` means nothing — it is an index into a grid
 * that no longer exists, and a player's board would be silently scrambled or
 * lost.
 *
 * A pixel position on the world's ART does not have that problem. The backdrop
 * is the thing that does NOT move when you re-grid a world: re-cut the lattice,
 * split it into zones, change the tile size — the painted island still has a
 * pixel at the same place, and "the Red Dragon stood on that ledge" is still
 * answerable. So alongside the grid cell we persist a MAP POINT, and the
 * migration to zones reads that.
 *
 * THE DEFINITION
 * --------------
 * A map point is measured in the backdrop image's OWN pixels, from the backdrop
 * sprite's placement point (the world pixel its origin lands on):
 *
 *     mapPoint = (worldPx - backdropPlacementWorldPx) / (cal.scale * ratio)
 *
 * Three properties earn it the job:
 *
 *   - It needs no knowledge of the art's native size, because it is measured
 *     from the placement point rather than a corner. That keeps it computable
 *     with no texture loaded, so systems, saves, scripts and unit tests all get
 *     the same number as the renderer (which is Phaser-only).
 *   - It is independent of `cols`, `rows`, `BOARD_ORIGIN`, tile size and skew.
 *     Everything grid-shaped divides out.
 *   - It is expressed in the units the ART was authored in, so it stays readable
 *     next to the world-builder, whose `dx`/`dy` are the same kind of number.
 *
 * WHAT USES IT TODAY: nothing, deliberately. The renderer, the merge board, the
 * tutorial and every system still run on `(col,row)` exactly as before, and the
 * save still loads through the grid whenever the map is the one it was written
 * against. Map points are written to the save and verified by tests, and the
 * relocation path (`placeByMapPoint`) is live but only reachable when the map
 * SIGNATURE changes — which today it cannot. That is the point: the transition
 * code ships, and is exercised, before the transition.
 *
 * WHAT IT IS NOT: a replacement for the grid. Merging is a grid adjacency
 * problem and should stay one. Map space answers "where on the world is this",
 * never "what is next to this".
 */
import type { Projection } from './iso';
import { project, projectionOf, unproject } from './iso';
import { TILE_W } from './Constants';
import type { MapData, TilePos } from './types';

/** A point on the world's ART, in backdrop pixels from its placement point. */
export interface MapPoint {
  x: number;
  y: number;
}

/**
 * A stored position, in every form the game may need to read it.
 *
 * `zone` names the grid within the world that this cell belongs to. It was
 * written as the constant `MAIN_ZONE` before zones existed, precisely so that
 * the field would already be on every save in the wild when they did — and that
 * is what happened: the authored isle became the zone whose id IS `main`, so
 * every older save names its zone correctly without being touched.
 */
export interface PersistedPlace {
  /** Which world this position belongs to (`WORLD_ID` today). */
  world: string;
  /** Which zone within it. One world = one zone today. */
  zone: string;
  /** Map-space x, in backdrop art px. */
  mx: number;
  /** Map-space y, in backdrop art px. */
  my: number;
  /**
   * Was this cell part of the authored playable isle when it was saved?
   *
   * Recorded because it cannot be recovered afterwards, and the two cases want
   * opposite things on a re-grid. A merge piece must come back on real ground,
   * even if that means nudging it a tile. A permanent fixture standing OFF the
   * isle on purpose — the Theme Crystal is authored at [8,11], outside
   * `playable`, and is still a `kind: 'item'` — must come back exactly where the
   * art says, because "on the isle" was never where it was.
   */
  onIsle?: boolean;
}

/** The only zone that exists while a world is a single grid. */
export const MAIN_ZONE = 'main';

/**
 * Everything needed to convert between the grid, world pixels and map space for
 * one map. Built from `MapData` alone — never from the ambient projection in
 * iso.ts, which is only correct inside a running BoardScene.
 */
export interface MapSpace {
  projection: Projection;
  /** World px of the backdrop sprite's placement point. */
  originX: number;
  originY: number;
  /** World px per art px. */
  unit: number;
  /**
   * False when the map has no backdrop to anchor to. Map space then degenerates
   * to raw world pixels (origin 0,0, unit 1) — still a stable number for the
   * map it was written on, but NOT comparable across a re-grid. Callers that
   * care (the save migration) check this rather than trusting a number that
   * cannot mean what it claims.
   */
  anchored: boolean;
}

/** Rounded to a hundredth of an art pixel: far finer than anything can see, and
 *  it keeps saves free of 17-digit float noise. */
const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * Build the map space for a map. Mirrors `BoardScene.buildBackground` exactly —
 * cell + calibration offset + free-move dx/dy, all scaled by the grid-unit ratio
 * — because a map point that disagreed with where the backdrop is actually drawn
 * would be a lie that only shows up years later, during the migration.
 */
export function mapSpaceOf(map: MapData): MapSpace {
  const projection = projectionOf(map.tile);
  const bg = map.backgrounds?.[0];
  if (!bg) {
    return { projection, originX: 0, originY: 0, unit: 1, anchored: false };
  }
  const ratio = TILE_W / (map.tile?.width ?? TILE_W);
  const cal = map.backgroundCalibration?.[bg.name];
  const at = project(projection, bg.col, bg.row);
  return {
    projection,
    originX: at.x + ((cal?.offsetX ?? 0) + (bg.dx ?? 0)) * ratio,
    originY: at.y + ((cal?.offsetY ?? 0) + (bg.dy ?? 0)) * ratio,
    unit: (cal?.scale ?? 1) * ratio,
    anchored: true
  };
}

/** World px -> map point. */
export function worldToMapPoint(space: MapSpace, x: number, y: number): MapPoint {
  return { x: round((x - space.originX) / space.unit), y: round((y - space.originY) / space.unit) };
}

/** Map point -> world px. */
export function mapPointToWorld(space: MapSpace, p: MapPoint): { x: number; y: number } {
  return { x: p.x * space.unit + space.originX, y: p.y * space.unit + space.originY };
}

/** Grid cell centre -> map point. */
export function gridToMapPoint(space: MapSpace, col: number, row: number): MapPoint {
  const w = project(space.projection, col, row);
  return worldToMapPoint(space, w.x, w.y);
}

/** Map point -> the grid cell containing it (may be out of bounds). */
export function mapPointToGrid(space: MapSpace, p: MapPoint): TilePos {
  const w = mapPointToWorld(space, p);
  return unproject(space.projection, w.x, w.y);
}

/**
 * The stored form of a cell on this map.
 *
 * `onIsle`, `zone` and the map point are all supplied or derived from the
 * caller's world rather than looked up here: mapSpace stays purely geometric and
 * knows nothing about which cells are playable or which grid owns them.
 *
 * NOTE the map point still comes from the map's own single lattice
 * (`gridToMapPoint`). That is exact for the authored isle and approximate for a
 * cell on another zone — good enough to be a hint, which is all it is once
 * `zone` is recorded, because relocation resolves inside the named zone.
 */
export function placeOf(
  space: MapSpace,
  world: string,
  col: number,
  row: number,
  onIsle: boolean,
  zone: string = MAIN_ZONE,
  point?: MapPoint
): PersistedPlace {
  const p = point ?? gridToMapPoint(space, col, row);
  return { world, zone, mx: p.x, my: p.y, onIsle };
}

/**
 * A fingerprint of everything that decides where a cell sits on the ART.
 *
 * Written into the save; compared on load. Equal means the grid a save was
 * written against still exists and its `(col,row)` are meaningful, which is the
 * only fast path. Different means the world has been re-gridded under a save —
 * exactly the event this whole module exists for — and positions must be
 * recovered from map space instead.
 *
 * Deliberately NOT a hash: a short readable string costs nothing at these sizes
 * and tells whoever is debugging a migration precisely what moved.
 */
export function mapSignature(world: string, map: MapData): string {
  const bg = map.backgrounds?.[0];
  const cal = bg ? map.backgroundCalibration?.[bg.name] : undefined;
  const grid = `${map.cols}x${map.rows}`;
  const tile = `${map.tile?.width ?? TILE_W}x${map.tile?.height ?? TILE_W / 2}s${map.tile?.skew ?? 0}`;
  const art = bg
    ? `${bg.name}@${bg.col},${bg.row}+${bg.dx ?? 0},${bg.dy ?? 0}*${cal?.scale ?? 1}`
    : 'none';
  return `${world}|${grid}|${tile}|${art}`;
}
