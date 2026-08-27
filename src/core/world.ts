/**
 * WORLDS AND ZONES — one world is many independently placed grids.
 *
 * WHAT CHANGED, AND WHAT DELIBERATELY DID NOT
 * -------------------------------------------
 * A position is still a `(col, row)`. Every system, every tutorial step, every
 * order, every save in the wild keeps working, because the pair is unchanged —
 * what moved is what it INDEXES. It used to be a dense rectangle: one lattice,
 * `0 ≤ col < cols`, projected by one ambient projection. It is now an index into
 * the WORLD'S CELL REGISTRY, and each zone owns a disjoint rectangular block of
 * that index space with geometry entirely its own: its own tile size, its own
 * origin in world pixels, its own rotation.
 *
 * The authored isle keeps block (0,0) and the projection it has always had, so
 * every `(col,row)` that meant something yesterday means exactly the same thing
 * today and lands on exactly the same pixel. `Zones.spec.ts` pins that as an
 * equality against the old projection rather than leaving it to inspection.
 *
 * THREE RULES WORTH STATING OUTRIGHT
 * ----------------------------------
 * 1. PROJECTION IS PER ZONE. `worldPointOf` routes through the zone that owns
 *    the address. There is no single correct projection for a zoned world, which
 *    is why `iso.ts` calls its module-level one "the thing that stops working".
 *
 * 2. PROJECTION IS UNBOUNDED, MEMBERSHIP IS NOT. `worldPointOf` answers for any
 *    integer pair, including ones no zone owns — the Golden Altar is authored at
 *    (-2,2) precisely because projecting off the grid was always legal. Only
 *    `hasCell` decides what can be stood on.
 *
 * 3. ADJACENCY NEVER CROSSES OPEN SKY — which is NOT the same rule as "adjacency
 *    never leaves a zone", and the difference is the whole of `buildAdjacency`.
 *    A zone is an EDITOR artefact: the map editor cuts one painted island into as
 *    many little grids as it likes, and Borealis's three islands arrive as 38 of
 *    them. Trusting zone identity there severed 96 of its 141 cells from the
 *    neighbour they visibly touch, so two thirds of the world could not merge
 *    with itself. The law the players can see is geometric — you may merge with
 *    the tile next to you and not with one across the water — so that is the one
 *    measured: a neighbour is a cell sitting where this cell's own ±u / ±v step
 *    lands, whichever grid drew it. The authored isle is exempt by category (see
 *    `buildAdjacency`), so Emberkeep is bit-for-bit the game it was.
 */
import { BOARD_ORIGIN_X, BOARD_ORIGIN_Y, WORLD_ID } from './Constants';
import type { Projection } from './iso';
import { projectionOf, setAmbientProjector } from './iso';
import type { MapSpace } from './mapSpace';
import { mapSignature, mapSpaceOf } from './mapSpace';
import type { MapData, MapRegionConfig, TilePos } from './types';
import zonesJson from '../data/zones.json';

const key = (col: number, row: number): string => `${col},${row}`;

/** One grid inside a world. All lengths are game world pixels. */
export interface ZoneRuntime {
  id: string;
  name: string;
  /** Where this zone's local (0,0) sits in the world's index space. */
  block: TilePos;
  matrix: { cols: number; rows: number };
  /** World px of local cell (0,0)'s centre, before `rotation`. */
  origin: { x: number; y: number };
  /** World-px step for +1 local column and +1 local row. */
  u: { x: number; y: number };
  v: { x: number; y: number };
  /** Degrees about `pivot`. */
  rotation: number;
  pivot: { x: number; y: number };
  /** Art drawn on this zone's cells scales by this (1 = the game's own tile). */
  artScale: number;
  /** Local "i,j" this zone actually owns. Empty when `dense`. */
  cells: Set<string>;
  /**
   * True for the zone synthesised from a `MapData`'s own `cols`/`rows` — it owns
   * EVERY index in its block, art or no art, which is what the authored map has
   * always meant by "in bounds". Explicit zones own only the cells they list.
   */
  dense: boolean;
}

/**
 * A door out of a world: an invisible axis-aligned rectangle in world pixels
 * that travels somewhere when tapped.
 *
 * INVISIBLE IS THE POINT, not an omission. Every shipped backdrop already
 * PAINTS its gateway — Emberkeep's lit stone arch, Borealis's keep door,
 * Roothold's vined archway onto the bridge — so a portal is the hit area over
 * art that is already there. Drawing a second marker on top would be the game
 * failing to trust its own painting.
 *
 * A rectangle in SCREEN-ALIGNED world pixels rather than a set of cells,
 * because a gateway is a piece of scenery and scenery does not stand on the
 * lattice: the arch Emberkeep opens through is off every playable cell, hanging
 * over the north-east rim. Cells would also make a door as tall as the art
 * impossible to describe.
 */
export interface PortalRuntime {
  id: string;
  /** World id this door leads to. */
  to: string;
  /** Authoring/diagnostic name. Never drawn — see the type's doc comment. */
  label: string;
  /** Top-left in world px, and its size. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorldRuntime {
  id: string;
  name: string;
  /** Keeper level at which this world may be travelled to. */
  level: number;
  /** The map this world renders from — the authored one, or a generated one. */
  map: MapData;
  /** Index-space extent; sizes the occupancy grid. */
  cols: number;
  rows: number;
  zones: ZoneRuntime[];
  /** Projects addresses no zone owns (see rule 2). */
  fallback: ZoneRuntime;
  /** Art-anchored map space, for saves. See mapSpace.ts. */
  space: MapSpace;
  /**
   * Fingerprint of the geometry a save's `(col,row)` were written against.
   *
   * Computed from the world's BASE map — for Emberkeep, `map.json` exactly as it
   * sits on disk, before its new zones are appended. That is not a dodge: the
   * signature's contract is "do this save's cells still index what they did",
   * and adding zones at columns 14 and beyond cannot change what an address
   * inside the authored 13×12 isle means. Every existing save therefore still
   * takes the fast path, which is the correct answer and not merely the
   * convenient one.
   */
  signature: string;
  /** Authored playable cells (`onIsle` in saves, and the re-grid search target). */
  playable: Set<string>;
  /** "col,row" → region id, scoped to this world. */
  tileRegion: Map<string, string>;
  /**
   * "col,row" → the cells one tile step away ACROSS THE ART, for every cell an
   * explicit zone owns. Built once (see `buildAdjacency`); the dense authored
   * zone is absent from it on purpose and keeps the index rule.
   */
  adjacency: Map<string, TilePos[]>;
  /** Doors out of this world, in authoring order. */
  portals: PortalRuntime[];
}

/* ------------------------------------------------------------------ */
/* geometry                                                            */
/* ------------------------------------------------------------------ */

const rotate = (
  p: { x: number; y: number },
  c: { x: number; y: number },
  deg: number
): { x: number; y: number } => {
  if (!deg) return p;
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
};

/** Local (i,j) → world px. Fractional inputs are fine (drag previews use them). */
export function zonePoint(z: ZoneRuntime, i: number, j: number): { x: number; y: number } {
  const flat = { x: z.origin.x + i * z.u.x + j * z.v.x, y: z.origin.y + i * z.u.y + j * z.v.y };
  return rotate(flat, z.pivot, z.rotation);
}

/** World px → the exact fractional local cell (no rounding, no bounds check). */
export function zoneLocalExact(
  z: ZoneRuntime,
  x: number,
  y: number
): { i: number; j: number } {
  const p = rotate({ x, y }, z.pivot, -z.rotation);
  const det = z.u.x * z.v.y - z.v.x * z.u.y;
  if (!det) return { i: 0, j: 0 };
  const dx = p.x - z.origin.x;
  const dy = p.y - z.origin.y;
  return { i: (dx * z.v.y - z.v.x * dy) / det, j: (z.u.x * dy - dx * z.u.y) / det };
}

/** Does this zone's block contain the world address? */
const inBlock = (z: ZoneRuntime, col: number, row: number): boolean =>
  col >= z.block.col &&
  row >= z.block.row &&
  col < z.block.col + z.matrix.cols &&
  row < z.block.row + z.matrix.rows;

/** The zone owning this address's index block, or undefined. */
export function zoneAt(world: WorldRuntime, col: number, row: number): ZoneRuntime | undefined {
  return world.zones.find((z) => inBlock(z, col, row));
}

/** Is there real ground at this address? */
export function hasCell(world: WorldRuntime, col: number, row: number): boolean {
  const z = zoneAt(world, col, row);
  if (!z) return false;
  return z.dense || z.cells.has(key(col - z.block.col, row - z.block.row));
}

/**
 * World-pixel centre of an address. Unbounded by design (rule 2): an address
 * belonging to no zone is projected by `fallback`, which for a world built on an
 * authored map IS that map's lattice — so off-grid decor keeps landing exactly
 * where it always did.
 */
export function worldPointOf(
  world: WorldRuntime,
  col: number,
  row: number
): { x: number; y: number } {
  const z = zoneAt(world, col, row) ?? world.fallback;
  return zonePoint(z, col - z.block.col, row - z.block.row);
}

/**
 * The cell a point is actually STANDING ON, or null when it is over open sky.
 *
 * THE HONEST HALF of `cellAtWorldPoint`, and the one anything that cares
 * whether there is FLOOR under a point must ask. The difference is the whole
 * bug this exists to close:
 *
 * `cellAtWorldPoint` falls back to the world's lattice when no zone owns the
 * point, so that a drag released over the void still resolves to *an* address
 * the caller can reject. But every world ships the SAME fallback — the authored
 * Emberkeep isle's 148px grid at origin (1280,316) — while Borealis, Roothold
 * and the Runevault are built from the editor's own zones, on their own pitch,
 * at their own origins. So in those worlds the fallback projects a point in the
 * open sky onto a small Emberkeep index like (0,0) or (1,1) — and those indices
 * are inside a real zone's block. `hasCell` then answers about a cell on a
 * different island entirely: a probe of Borealis found 532 sky points claiming
 * ground up to 2700px away, which is most of the world.
 *
 * That claim is what put a shadow under a piece carried out over the clouds,
 * and what would have let a drop there teleport it to another isle.
 *
 * So: same search, no fallback. Null means null.
 */
export function groundCellAtWorldPoint(
  world: WorldRuntime,
  x: number,
  y: number
): TilePos | null {
  let best: { pos: TilePos; d2: number } | undefined;
  for (const z of world.zones) {
    const e = zoneLocalExact(z, x, y);
    const i = Math.round(e.i);
    const j = Math.round(e.j);
    if (i < 0 || j < 0 || i >= z.matrix.cols || j >= z.matrix.rows) continue;
    // Ground only: an explicit zone's listed cells, and a dense zone's authored
    // playable cells (its rectangle corners are sky — see `denseZoneOf`). A
    // dense zone with no cell list keeps meaning "every index".
    if (!z.cells.has(key(i, j)) && !(z.dense && z.cells.size === 0)) continue;
    // Zones do not overlap in the shipped art, but nothing enforces that, so
    // resolve ties by whichever cell centre the point is actually nearest.
    const c = zonePoint(z, i, j);
    const d2 = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (!best || d2 < best.d2) {
      best = { pos: { col: z.block.col + i, row: z.block.row + j }, d2 };
    }
  }
  return best?.pos ?? null;
}

/**
 * The address under a world point. Prefers a zone that has real ground there;
 * failing that, falls back to the unbounded lattice so a caller that needs an
 * address for a point in open space still gets one.
 *
 * READ THE WARNING ON `groundCellAtWorldPoint` BEFORE USING THIS to decide
 * whether a point is on the floor. The fallback address is a projection, not a
 * claim about ground, and in every world but Emberkeep it can land on an index
 * a real zone owns — at which point it becomes indistinguishable from a true
 * one. Anything asking "is there floor here" wants the other function.
 */
export function cellAtWorldPoint(world: WorldRuntime, x: number, y: number): TilePos {
  const standing = groundCellAtWorldPoint(world, x, y);
  if (standing) return standing;
  const f = world.fallback;
  const e = zoneLocalExact(f, x, y);
  // `|| 0` collapses negative zero — Math.round(-0.2) is -0, which stringifies
  // as "-0" and would miss the "0" cell it means when used as a map key.
  return { col: (Math.round(e.i) || 0) + f.block.col, row: (Math.round(e.j) || 0) + f.block.row };
}

/**
 * The playable cell PHYSICALLY nearest a world point, in pixels.
 *
 * The rule every "where does this thing go" question needs and none of them
 * had. Two traps it exists to avoid, both of which had already been fallen
 * into:
 *
 *   • Resolving the point to a cell first. A gateway, a portal or a decor
 *     rectangle is authored in world pixels and is very often painted OFF the
 *     playable ground; `cellAtWorldPoint` answers such a point through the
 *     unbounded lattice, which in any world but Emberkeep is an address some
 *     other zone owns. Everything measured from it is then measured from
 *     nowhere.
 *   • Measuring in cell indices. A world is a registry of zones whose blocks
 *     sit side by side with gutters, so `|Δcol| + |Δrow|` calls a cell on the
 *     next island two away and the slab underfoot thirty.
 *
 * `accept` lets a caller add its own condition (free of items, say) without
 * this function knowing anything about boards.
 */
export function nearestPlayableCell(
  world: WorldRuntime,
  x: number,
  y: number,
  accept?: (col: number, row: number) => boolean
): TilePos | null {
  let best: TilePos | null = null;
  let bestD = Infinity;
  for (const cell of world.playable) {
    const [col, row] = cell.split(',').map(Number);
    if (col === undefined || row === undefined) continue;
    if (accept && !accept(col, row)) continue;
    const p = worldPointOf(world, col, row);
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { col, row };
    }
  }
  return best;
}

/**
 * The world address nearest this point ON A NAMED ZONE, whether or not that
 * zone has ground there. Used by save recovery, which knows which grid a piece
 * came from and wants the answer inside it rather than the nearest answer
 * anywhere. The caller checks membership.
 */
export function cellInZone(z: ZoneRuntime, x: number, y: number): TilePos {
  const e = zoneLocalExact(z, x, y);
  // `|| 0` collapses negative zero (see cellAtWorldPoint).
  return { col: (Math.round(e.i) || 0) + z.block.col, row: (Math.round(e.j) || 0) + z.block.row };
}

/**
 * Adjacent addresses with real ground — the cells a merge may reach (rule 3).
 *
 * The authored dense lattice answers from its own indices, exactly as it always
 * has. Everything else answers from the measured adjacency graph, because on a
 * world the editor cut into slabs the index neighbour and the cell you can see
 * yourself touching are different questions.
 */
export function neighborsOf(world: WorldRuntime, col: number, row: number): TilePos[] {
  const z = zoneAt(world, col, row);
  if (!z) return [];
  if (!z.dense) return world.adjacency.get(key(col, row)) ?? [];
  const out: TilePos[] = [];
  for (const [dc, dr] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ] as const) {
    const c = col + dc;
    const r = row + dr;
    if (!inBlock(z, c, r)) continue;
    out.push({ col: c, row: r });
  }
  return out;
}

/**
 * Cells reachable from here in at most `maxHops` steps ACROSS THE GROUND, in
 * hop order, excluding the start.
 *
 * The thing it replaces is index arithmetic — `|Δcol| + |Δrow|` — which on the
 * authored isle IS the number of steps and on a zoned world is a number about
 * nothing at all: index blocks are laid side by side with gutters, so two cells
 * five columns apart may be on different islands and two cells on adjacent slabs
 * may be dozens of columns apart. Callers that mean "near enough to drop a
 * reward on" want steps, so this walks them.
 */
export function cellsWithin(
  world: WorldRuntime,
  col: number,
  row: number,
  maxHops: number
): TilePos[] {
  const seen = new Set<string>([key(col, row)]);
  const out: TilePos[] = [];
  let frontier: TilePos[] = [{ col, row }];
  for (let hop = 0; hop < maxHops && frontier.length; hop++) {
    const next: TilePos[] = [];
    for (const cell of frontier) {
      for (const n of neighborsOf(world, cell.col, cell.row)) {
        const k = key(n.col, n.row);
        if (seen.has(k)) continue;
        seen.add(k);
        // Fog is not a wall: a locked region between here and a free tile is
        // still ground, and the old arithmetic counted straight through it.
        if (!hasCell(world, n.col, n.row)) continue;
        out.push(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return out;
}

/** How much to scale art standing on this address (1 = the game's own tile). */
export function artScaleAt(world: WorldRuntime, col: number, row: number): number {
  return (zoneAt(world, col, row) ?? world.fallback).artScale;
}

/* ------------------------------------------------------------------ */
/* construction                                                        */
/* ------------------------------------------------------------------ */

/** The zone an ordinary single-lattice `MapData` describes: the whole rectangle
 *  at the board origin, under the map's authored perspective. Its world points
 *  are `iso.project` term for term, which is what keeps the isle still. */
export function denseZoneOf(map: MapData, id = 'main', name = 'Main Isle'): ZoneRuntime {
  const p: Projection = projectionOf(map.tile);
  const origin = { x: BOARD_ORIGIN_X, y: BOARD_ORIGIN_Y };
  return {
    id,
    name,
    block: { col: 0, row: 0 },
    matrix: { cols: map.cols, rows: map.rows },
    origin,
    u: { x: p.halfW + p.skewK * p.halfH, y: p.halfH },
    v: { x: -p.halfW + p.skewK * p.halfH, y: p.halfH },
    rotation: 0,
    pivot: origin,
    artScale: 1,
    // A dense zone ADDRESSES its whole rectangle, but only the authored
    // playable cells are GROUND — the rectangle's corners are open sky the
    // painting never gave a floor. `groundCellAtWorldPoint` reads this set so
    // a sky corner cannot outcompete a real painted cell it overlaps (the
    // isle's (9,0) sat 43 px from the far island's (32,0) once the extension
    // slabs were seated on their true stones, and won drops aimed at them).
    // Maps that carry no playable list (the unit-test fixture) leave it empty,
    // which `groundCellAtWorldPoint` treats as "every index", as before.
    cells: new Set((map.playable ?? []).map(([c, r]) => key(c, r))),
    dense: true
  };
}

/** The generated per-world zone table (`src/data/zones.json`). */
export interface ZoneSpec {
  id: string;
  name: string;
  block: [number, number];
  matrix: [number, number];
  origin: [number, number];
  u: [number, number];
  v: [number, number];
  rotation: number;
  pivot: [number, number];
  artScale: number;
  cells: [number, number][];
}

/** A portal as `src/data/zones.json` carries it: `[x, y, width, height]` in
 *  world px, top-left first. */
export interface PortalSpec {
  id: string;
  to: string;
  label?: string;
  rect: [number, number, number, number];
}

export interface WorldSpec {
  id: string;
  name: string;
  level: number;
  backdrop: string;
  /** True when `map` holds only what is ADDED to the build's authored map. */
  extendsAuthoredMap: boolean;
  /**
   * `mapSignature` of the authored map these zones' ABSOLUTE world-pixel origins
   * were measured against (extending worlds only). Checked at build time: zones
   * grafted onto a lattice they were not measured for would sit a few hundred
   * pixels off their islands, silently and everywhere.
   */
  baseSignature?: string;
  map: Partial<MapData> & { cols: number; rows: number };
  zones: ZoneSpec[];
  /** Doors out. Absent on a world with none — every world SHOULD have one, but
   *  a world mid-authoring legitimately does not, and a missing door is a world
   *  you cannot leave rather than a world that fails to load. */
  portals?: PortalSpec[];
}

export interface ZonesDoc {
  format: string;
  version: number;
  worlds: WorldSpec[];
}

export const ZONES = zonesJson as unknown as ZonesDoc;

const portalFromSpec = (s: PortalSpec): PortalRuntime => ({
  id: s.id,
  to: s.to,
  label: s.label ?? s.to,
  x: s.rect[0],
  y: s.rect[1],
  width: s.rect[2],
  height: s.rect[3]
});

/** The portal under a world point, if any. Topmost-authored wins, so two
 *  overlapping doors resolve the way the list reads rather than by accident. */
export function portalAtWorldPoint(
  world: WorldRuntime,
  x: number,
  y: number
): PortalRuntime | undefined {
  for (let i = world.portals.length - 1; i >= 0; i--) {
    const p = world.portals[i] as PortalRuntime;
    if (x >= p.x && y >= p.y && x < p.x + p.width && y < p.y + p.height) return p;
  }
  return undefined;
}

const zoneFromSpec = (s: ZoneSpec): ZoneRuntime => ({
  id: s.id,
  name: s.name,
  block: { col: s.block[0], row: s.block[1] },
  matrix: { cols: s.matrix[0], rows: s.matrix[1] },
  origin: { x: s.origin[0], y: s.origin[1] },
  u: { x: s.u[0], y: s.u[1] },
  v: { x: s.v[0], y: s.v[1] },
  rotation: s.rotation,
  pivot: { x: s.pivot[0], y: s.pivot[1] },
  artScale: s.artScale,
  cells: new Set(s.cells.map(([i, j]) => key(i, j))),
  dense: false
});

/** The world-px direction of +1 local column and +1 local row, after rotation. */
const stepsOf = (z: ZoneRuntime): { u: { x: number; y: number }; v: { x: number; y: number } } => ({
  u: rotate(z.u, { x: 0, y: 0 }, z.rotation),
  v: rotate(z.v, { x: 0, y: 0 }, z.rotation)
});

/**
 * How far off its predicted spot a cell may sit and still count as the
 * neighbour, as a fraction of a tile step.
 *
 * Measured, not guessed. Across all 282 cells of the two zoned worlds the
 * furthest true neighbour lands at 0.50 of a step (the editor's grids differ in
 * pitch by up to 15%, so a seam never lines up perfectly), and the nearest
 * NON-neighbour — the closest cell to a predicted spot with nothing there — is
 * 0.78. Anywhere in that gap is correct; the midpoint is the honest choice.
 *
 * It must stay well under 0.5·√2 ≈ 0.71 for a second reason: in an iso lattice
 * the DIAGONAL (u+v) is shorter than either step, so a rule that merely asked
 * "is a cell nearby" would quietly make the board 8-connected.
 */
const ADJACENCY_TOLERANCE = 0.6;

/**
 * How unalike two grids' tile pitches may be and still be treated as one
 * island's lattice, as a ratio of the smaller step to the larger.
 *
 * Cells of the same island differ only by the editor's per-grid rounding — 15%
 * at the very worst across Borealis. A coarse grid parked beside a fine one is
 * something else, and bonding them produces a cell whose "neighbour" is two of
 * its own steps away: roothold has exactly one such seam, 96 px against 145.
 * This is also the guard that would keep the authored 242 px isle off a 127 px
 * `beyond` slab, and stating it costs nothing — dense zones are excluded
 * outright, but a rule this load-bearing should not rest on one clause.
 */
const ADJACENCY_PITCH_MATCH = 0.7;

/**
 * The farthest apart two linked cells may stand, in steps of the SMALLER
 * zone's longest axis. This is the merge law as the player reads it — "the
 * tile beside you, not one across the water" — and `Zones.spec.ts` asserts it
 * from both sides of every link.
 *
 * The probe tolerance above cannot enforce it alone: it is measured against
 * the PROBING zone's pitch, so a coarse grid can accept a fine grid's cell
 * that the fine grid, probing back, correctly rejects — and pass 2's symmetry
 * would then heal the wrong thing into a two-way merge across a gap. The
 * measured re-seat of emberkeep (2026-08-27) surfaced exactly one: the arm's
 * green slab and the gate outcrop, 1.65 of the slab's steps apart, painted
 * with open sky between them.
 */
const ADJACENCY_REACH = 1.6;

/**
 * Measure which cells actually touch, once, at world build.
 *
 * DENSE ZONES ARE EXEMPT BY CATEGORY, and that is the safety property rather
 * than a tuned number: the authored isle's neighbours are defined by the map it
 * was drawn as, not by where a later editor slab happened to land. One of those
 * slabs sits 80 px from an isle cell — a third of the isle's own 242 px step —
 * so a purely geometric rule would have grafted `beyond_l4` onto the shipped
 * board. Excluding the authored lattice makes that impossible to express.
 */
function buildAdjacency(zones: ZoneRuntime[]): Map<string, TilePos[]> {
  const out = new Map<string, TilePos[]>();
  const cells: { pos: TilePos; at: { x: number; y: number }; zone: ZoneRuntime }[] = [];
  for (const z of zones) {
    if (z.dense) continue;
    for (const local of z.cells) {
      const [i = 0, j = 0] = local.split(',').map(Number);
      cells.push({
        pos: { col: z.block.col + i, row: z.block.row + j },
        at: zonePoint(z, i, j),
        zone: z
      });
    }
  }

  const edges = new Map<string, TilePos[]>();
  const link = (from: TilePos, to: TilePos): void => {
    const k = key(from.col, from.row);
    const list = edges.get(k) ?? [];
    if (!list.some((p) => p.col === to.col && p.row === to.row)) list.push(to);
    edges.set(k, list);
  };

  // Pass 1 — every cell probes its own four steps, in the order the index rule
  // listed them (+col, -col, +row, -row), so a cell's neighbour list keeps the
  // shape callers have always seen.
  const pitch = (z: ZoneRuntime): number => {
    const { u, v } = stepsOf(z);
    return Math.min(Math.hypot(u.x, u.y), Math.hypot(v.x, v.y));
  };
  for (const cell of cells) {
    const { u, v } = stepsOf(cell.zone);
    const step = pitch(cell.zone);
    for (const d of [u, { x: -u.x, y: -u.y }, v, { x: -v.x, y: -v.y }]) {
      const tx = cell.at.x + d.x;
      const ty = cell.at.y + d.y;
      let best: (typeof cells)[number] | undefined;
      let bestD = Infinity;
      for (const other of cells) {
        if (other === cell) continue;
        const dd = Math.hypot(other.at.x - tx, other.at.y - ty);
        if (dd < bestD) {
          bestD = dd;
          best = other;
        }
      }
      if (!best || bestD > step * ADJACENCY_TOLERANCE) continue;
      const theirs = pitch(best.zone);
      if (Math.min(step, theirs) / Math.max(step, theirs) < ADJACENCY_PITCH_MATCH) continue;
      const longest = (z: ZoneRuntime): number => {
        const s = stepsOf(z);
        return Math.max(Math.hypot(s.u.x, s.u.y), Math.hypot(s.v.x, s.v.y));
      };
      const reach = ADJACENCY_REACH * Math.min(longest(cell.zone), longest(best.zone));
      if (Math.hypot(best.at.x - cell.at.x, best.at.y - cell.at.y) >= reach) continue;
      link(cell.pos, best.pos);
    }
  }
  // Pass 2 — symmetry. Two slabs of slightly different pitch can see each other
  // from one side only, and a one-way merge would be a bug nobody could read.
  for (const [k, list] of [...edges].map(([k2, l]) => [k2, [...l]] as const)) {
    const [col = 0, row = 0] = k.split(',').map(Number);
    for (const n of list) link(n, { col, row });
  }
  for (const [k, list] of edges) out.set(k, list);
  return out;
}

/**
 * Fold a world's added ground into the map the renderer reads. Concatenation
 * only: nothing authored is replaced, so the isle's tiles, decor, calibration,
 * camera keyframes and starting items are untouched by definition.
 */
function extendMap(base: MapData, add: Partial<MapData> & { cols: number; rows: number }): MapData {
  return {
    ...base,
    cols: Math.max(base.cols, add.cols),
    rows: Math.max(base.rows, add.rows),
    playable: [...(base.playable ?? []), ...(add.playable ?? [])],
    invisible: [...(base.invisible ?? []), ...(add.invisible ?? [])],
    regions: [...base.regions, ...((add.regions ?? []) as MapRegionConfig[])]
  };
}

/**
 * Assemble a runnable world.
 *
 * `authored` is the build's own `src/data/map.json`. A world that extends it
 * gets the authored lattice as its dense `main` zone plus its extra zones; a
 * world of its own gets only what its spec declares, and a bare lattice at the
 * board origin as the fallback projector so off-cell maths never divides by a
 * zone that is not there.
 */
export function buildWorld(spec: WorldSpec, authored: MapData): WorldRuntime {
  const baseMap: MapData = spec.extendsAuthoredMap
    ? authored
    : ({ startingItems: [], ...spec.map } as MapData);
  const map = spec.extendsAuthoredMap ? extendMap(authored, spec.map) : baseMap;
  const zones = spec.zones.map(zoneFromSpec);
  const main = spec.extendsAuthoredMap ? denseZoneOf(authored) : undefined;
  if (main) zones.unshift(main);
  // A world of pure zones still needs SOMETHING to project an address that
  // belongs to none of them. The board-origin lattice is the neutral choice: it
  // is what the engine did before zones existed.
  const fallback = main ?? denseZoneOf({ ...baseMap, cols: 0, rows: 0 }, 'lattice', 'Lattice');

  const tileRegion = new Map<string, string>();
  for (const region of map.regions) {
    for (const [c, r] of region.tiles) tileRegion.set(key(c, r), region.id);
  }
  return {
    id: spec.id,
    name: spec.name,
    level: spec.level,
    map,
    cols: Math.max(map.cols, ...zones.map((z) => z.block.col + z.matrix.cols)),
    rows: Math.max(map.rows, ...zones.map((z) => z.block.row + z.matrix.rows)),
    zones,
    fallback,
    space: mapSpaceOf(map),
    // Deliberately the BASE map — see the field's doc comment.
    signature: mapSignature(spec.id, baseMap),
    playable: new Set((map.playable ?? []).map(([c, r]) => key(c, r))),
    tileRegion,
    adjacency: buildAdjacency(zones),
    portals: (spec.portals ?? []).map(portalFromSpec)
  };
}

/** The single-zone world an ordinary `MapData` is on its own. */
const plainWorld = (id: string, authored: MapData): WorldRuntime =>
  buildWorld(
    {
      id,
      name: id,
      level: 1,
      backdrop: authored.backgrounds?.[0]?.name ?? '',
      extendsAuthoredMap: true,
      map: { cols: authored.cols, rows: authored.rows },
      zones: []
    },
    authored
  );

/**
 * Every world this build can run, keyed by id, with the authored world first.
 *
 * The authored map only picks up its extra zones when it is demonstrably the
 * map they were measured against — the 8×8 unit fixture, or a re-exported
 * `map.json` with this file left stale, gets one dense zone and the pre-zone
 * behaviour exactly. That is both what lets every existing test construct a
 * `GameContext` without knowing zones exist, and the trap that stops absolute
 * zone geometry from being grafted onto a lattice it does not belong to.
 */
export function buildWorlds(authored: MapData): Map<string, WorldRuntime> {
  const out = new Map<string, WorldRuntime>();
  const authoredMatches = (spec: WorldSpec): boolean =>
    spec.baseSignature === undefined ||
    spec.baseSignature === mapSignature(spec.id, authored);
  for (const spec of ZONES.worlds) {
    // Only the build's own world may extend the authored map.
    if (spec.extendsAuthoredMap && spec.id !== WORLD_ID) continue;
    // The game's own world carries absolute geometry measured against a specific
    // map, so it is adopted ONLY when that map is still the one in hand — the 8x8
    // unit fixture, or a re-exported map.json with zones.json left stale, gets one
    // dense zone and the pre-zone behaviour instead. This guard is about the
    // MEASUREMENT, not about extending: it applies whether the world is built on
    // the authored rectangle or entirely from its own grids.
    if (spec.id === WORLD_ID) {
      out.set(spec.id, authoredMatches(spec) ? buildWorld(spec, authored) : plainWorld(spec.id, authored));
      continue;
    }
    out.set(spec.id, buildWorld(spec, authored));
  }
  if (!out.has(WORLD_ID)) out.set(WORLD_ID, plainWorld(WORLD_ID, authored));
  return out;
}

/* ------------------------------------------------------------------ */
/* the ambient world (scene use)                                        */
/* ------------------------------------------------------------------ */

/**
 * Point `iso.gridToWorld` / `iso.worldToGrid` at a world, so the ~35 call sites
 * that ask for "the cell's pixel" keep their one-line shape and become
 * zone-aware without knowing it. Passing null restores the plain projection.
 *
 * Injection rather than an import inside iso.ts: this module already depends on
 * iso, and a cycle between the two would be a genuine trap in a file this
 * central.
 */
export function setActiveWorld(world: WorldRuntime | null): void {
  setAmbientProjector(
    world
      ? {
          toWorld: (col, row) => worldPointOf(world, col, row),
          toGrid: (x, y) => cellAtWorldPoint(world, x, y)
        }
      : null
  );
}
