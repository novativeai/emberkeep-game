/**
 * Shared, reactive state for the in-game Map Editor (a Blender-style level tool
 * opened from Settings). It is the single channel between the DOM chrome
 * (EditorDom — sidebar, toolbar, coord readout) and the Phaser board layer
 * (BoardEditor — darken, grid, cell allocation, placed assets). Both subscribe
 * to `on('change')` and mutate through the setters, so neither side needs a
 * reference to the other. This is a DEV tool: it lives OUTSIDE the game's typed
 * EventBus and never touches GameState/map.json.
 */

import { projectIn, unprojectIn, type Lattice } from './lattice';

export type EditorTab = 'edit' | 'assets' | 'position' | 'grille' | 'carte';
export type EditorTool = 'select' | 'multiselect' | 'allocate' | 'deallocate';

/**
 * A named GRID DEFINITION — the foundation the level design is laid out on. It is
 * defined FIRST (perspective + tile size + matrix size) and every zone drawn
 * afterwards references one. Unlike the game's single implicit iso grid, several
 * can coexist per map, each positioned freely, so one floating island can carry a
 * grid that actually matches its art.
 *
 * - `persp`  — the PERSPECTIVE: 'iso' (2:1-style diamonds, the game look) or
 *              'ortho' (axis-aligned squares, top-down).
 * - `tileW/tileH` — the SIZE of one cell in world px (full width/height).
 * - `cols/rows`   — the MATRIX size (how many cells across / down).
 * - `ox/oy`  — world position of cell (0,0)'s CENTRE.
 *
 * Basis vectors (per +col `u`, per +row `v`) are derived from persp+size, so cell
 * (i,j) centre = (ox + i·u + j·v). Use the exported `gridBasis`/`gridCellCenter`/
 * `gridOutline`/`gridInvert` helpers — never re-derive the projection inline.
 */
export interface GridDef {
  id: string;
  name: string;
  persp: 'iso' | 'ortho';
  tileW: number;
  tileH: number;
  cols: number;
  rows: number;
  ox: number;
  oy: number;
  /** Rotation in degrees, applied around the grid's footprint centre (0 = none). */
  rot?: number;
  /** Cell allocation: "i,j" → UNLOCK LEVEL (1 = playable now, N = opens at level N).
   *  Absent cell = not allocated. Edited from the Edit tab's allocate/deallocate. */
  alloc?: Record<string, number>;
}

/** Per-column (`u`) and per-row (`v`) UNROTATED step vectors for a grid. */
export function gridBasis(g: GridDef): { u: { x: number; y: number }; v: { x: number; y: number } } {
  if (g.persp === 'ortho') return { u: { x: g.tileW, y: 0 }, v: { x: 0, y: g.tileH } };
  return { u: { x: g.tileW / 2, y: g.tileH / 2 }, v: { x: -g.tileW / 2, y: g.tileH / 2 } };
}

const gridRad = (g: GridDef): number => ((g.rot ?? 0) * Math.PI) / 180;
/** Rotate a point around a pivot by `ang` radians. */
function rotAround(p: { x: number; y: number }, c: { x: number; y: number }, ang: number): { x: number; y: number } {
  if (!ang) return { x: p.x, y: p.y };
  const co = Math.cos(ang);
  const si = Math.sin(ang);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * co - dy * si, y: c.y + dx * si + dy * co };
}
/** UNROTATED world centre of cell (i,j). */
function cellRaw(g: GridDef, i: number, j: number): { x: number; y: number } {
  const { u, v } = gridBasis(g);
  return { x: g.ox + i * u.x + j * v.x, y: g.oy + i * u.y + j * v.y };
}
/** The grid's footprint centre (the rotation pivot) — invariant under rotation. */
export function gridCenter(g: GridDef): { x: number; y: number } {
  return cellRaw(g, (g.cols - 1) / 2, (g.rows - 1) / 2);
}

/** World centre of cell (i,j), WITH rotation applied. */
export function gridCellCenter(g: GridDef, i: number, j: number): { x: number; y: number } {
  return rotAround(cellRaw(g, i, j), gridCenter(g), gridRad(g));
}

/** Allocated cells of a grid (unlock level > 0). */
const allocCount = (g: GridDef): number =>
  g.alloc ? Object.values(g.alloc).filter((lvl) => lvl > 0).length : 0;

/**
 * The cell lattice a world was DRAWN on — pitch from the median of its grids, phase
 * FITTED to every drawn cell.
 *
 * Only `persp:'iso'`, unrotated grids qualify: their basis is exactly the game's
 * projection (see `setLattice` in core/iso.ts), so adopting them is lossless rather
 * than approximate. Returns null when a world has no such grid — the caller then
 * keeps the authored lattice, which is the right answer for the base world (its
 * grids were already drawn at the game's own pitch; forcing a median there makes it
 * WORSE, measured 3% loss → 8%).
 *
 * The PHASE used to be copied from the grid with the most allocated cells: that grid
 * was then pixel-exact and every other one drifted away from it, by up to two thirds
 * of a cell in a world whose grids were drawn freehand at slightly different pitches.
 * Drift is not cosmetic — two drawn cells that round to the same game cell means one
 * of them can never hold a piece. Measured on the real project (audit-grids.mjs):
 * borealis lost 9 of its 140 cells and sat 38px off on average, and the drawn grid
 * visibly did not line up with the pieces standing on it. Fitting the phase to ALL
 * the cells instead costs a few iterations and takes borealis to 0 lost / 21px, nb2
 * to 0 lost / 30px, and leaves roothold — already lossless — a touch better at 6px.
 *
 * A world drawn with ONE consistent grid is unaffected: its residuals are zero, so
 * the fit has nothing to move and the lattice stays pixel-exact.
 */
export function latticeFor(grids: GridDef[]): Lattice | null {
  const usable = grids.filter((g) => g.persp !== 'ortho' && !(g.rot ?? 0) && allocCount(g) > 0);
  if (!usable.length) return null;
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  };
  // Start from the busiest grid's own origin — the best single guess — then let the
  // cells move it.
  const anchor = usable.reduce((a, b) => (allocCount(b) > allocCount(a) ? b : a));
  const lattice: Lattice = {
    halfW: median(usable.map((g) => g.tileW)) / 2,
    halfH: median(usable.map((g) => g.tileH)) / 2,
    skewK: 0,
    originX: anchor.ox,
    originY: anchor.oy
  };

  const drawn: { x: number; y: number }[] = [];
  for (const g of usable) {
    for (const [cell, lvl] of Object.entries(g.alloc ?? {})) {
      if (lvl <= 0) continue;
      const [i, j] = cell.split(',').map(Number) as [number, number];
      drawn.push(gridCellCenter(g, i, j));
    }
  }
  // Shift the origin by the mean residual until it settles. Each cell is snapped to
  // a game cell, so which cell a point claims can change as the origin moves — hence
  // iterate rather than solve once. It converges in a handful of passes; the cap is
  // only there so a pathological set cannot spin.
  for (let pass = 0; pass < 24; pass++) {
    let dx = 0;
    let dy = 0;
    for (const p of drawn) {
      const { col, row } = unprojectIn(lattice, p.x, p.y);
      const back = projectIn(lattice, col, row);
      dx += p.x - back.x;
      dy += p.y - back.y;
    }
    dx /= drawn.length;
    dy /= drawn.length;
    lattice.originX += dx;
    lattice.originY += dy;
    if (Math.hypot(dx, dy) < 0.01) break; // sub-pixel: done
  }
  return lattice;
}

/** World → fractional (i,j) grid coordinate (inverse basis, undoing rotation). */
export function gridInvert(g: GridDef, x: number, y: number): { i: number; j: number } {
  const p = rotAround({ x, y }, gridCenter(g), -gridRad(g)); // undo rotation first
  const { u, v } = gridBasis(g);
  const det = u.x * v.y - v.x * u.y || 1;
  const wx = p.x - g.ox;
  const wy = p.y - g.oy;
  return { i: (wx * v.y - v.x * wy) / det, j: (u.x * wy - wx * u.y) / det };
}

/** Snap a world point to the nearest CELL CORNER of the grid (cell corners sit at
 *  half-integer (i,j) — grid-line intersections — so a traced zone runs along cell
 *  edges). */
export function gridSnap(g: GridDef, x: number, y: number): { x: number; y: number } {
  const { i, j } = gridInvert(g, x, y);
  return gridCellCenter(g, Math.round(i - 0.5) + 0.5, Math.round(j - 0.5) + 0.5);
}

/** UNROTATED footprint box (the "area" you dragged) — rotation-independent, so the
 *  sidebar size/position stay put while the grid spins. */
export function gridBBox(g: GridDef): { x: number; y: number; w: number; h: number } {
  const o = gridOutlineRaw(g);
  const xs = o.map((p) => p.x);
  const ys = o.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Derive tile size + origin so a `cols×rows` grid of `persp` exactly FILLS the
 *  given world box (its bounding box == the box). The box aspect sets the iso
 *  perspective aspect, so dragging the box shapes the grid. */
export function gridFromBox(
  persp: GridDef['persp'],
  box: { x: number; y: number; w: number; h: number },
  cols: number,
  rows: number
): { tileW: number; tileH: number; ox: number; oy: number } {
  const w = Math.max(1, box.w);
  const h = Math.max(1, box.h);
  if (persp === 'ortho') {
    const tileW = w / cols;
    const tileH = h / rows;
    return { tileW, tileH, ox: box.x + tileW / 2, oy: box.y + tileH / 2 };
  }
  // Iso: bbox is hw·(cols+rows) wide and hh·(cols+rows) tall (hw/hh = tile half-extents).
  const s = cols + rows;
  const hw = w / s;
  const hh = h / s;
  return { tileW: 2 * hw, tileH: 2 * hh, ox: box.x + hw * rows, oy: box.y + hh };
}

/** The 4 outer corners of the matrix (parallelogram/rectangle) WITHOUT rotation —
 *  the "footprint" the sidebar box + `gridFromBox` work in. */
function gridOutlineRaw(g: GridDef): { x: number; y: number }[] {
  const { u, v } = gridBasis(g);
  const hw = g.tileW / 2;
  const hh = g.tileH / 2;
  const ci = Math.max(0, g.cols - 1);
  const rj = Math.max(0, g.rows - 1);
  if (g.persp === 'ortho') {
    const a = cellRaw(g, 0, 0);
    const b = cellRaw(g, ci, 0);
    const d = cellRaw(g, ci, rj);
    const e = cellRaw(g, 0, rj);
    return [
      { x: a.x - hw, y: a.y - hh },
      { x: b.x + hw, y: b.y - hh },
      { x: d.x + hw, y: d.y + hh },
      { x: e.x - hw, y: e.y + hh }
    ];
  }
  // Iso: the outer tile vertices form a parallelogram with sides cols·u and rows·v.
  return [
    { x: g.ox, y: g.oy - hh }, // top vertex of cell (0,0)
    { x: g.ox + ci * u.x + hw, y: g.oy + ci * u.y }, // right vertex of (cols-1,0)
    { x: g.ox + ci * u.x + rj * v.x, y: g.oy + ci * u.y + rj * v.y + hh }, // bottom of (cols-1,rows-1)
    { x: g.ox + rj * v.x - hw, y: g.oy + rj * v.y } // left vertex of (0,rows-1)
  ];
}

/** The 4 outer corners WITH rotation — outline the grid + hit-test which grid a
 *  click falls in. */
export function gridOutline(g: GridDef): { x: number; y: number }[] {
  const c = gridCenter(g);
  const ang = gridRad(g);
  return gridOutlineRaw(g).map((p) => rotAround(p, c, ang));
}

/** The 4 corner points of ONE cell (i,j) — a diamond (iso) or square (ortho),
 *  rotation-aware — so a highlight matches the EXACT shape of the grid you drew.
 *  Shared by the grid mesh AND the asset placement/selection highlight. */
export function gridCellPolygon(g: GridDef, i: number, j: number): { x: number; y: number }[] {
  const c = cellRaw(g, i, j);
  const hw = g.tileW / 2;
  const hh = g.tileH / 2;
  const corners =
    g.persp === 'ortho'
      ? [
          { x: c.x - hw, y: c.y - hh },
          { x: c.x + hw, y: c.y - hh },
          { x: c.x + hw, y: c.y + hh },
          { x: c.x - hw, y: c.y + hh }
        ]
      : [
          { x: c.x, y: c.y - hh },
          { x: c.x + hw, y: c.y },
          { x: c.x, y: c.y + hh },
          { x: c.x - hw, y: c.y }
        ];
  const center = gridCenter(g);
  const ang = gridRad(g);
  return corners.map((p) => rotAround(p, center, ang));
}

/** World position of the ROTATE handle — above the grid, following its rotation. */
export function gridRotateHandle(g: GridDef): { x: number; y: number } {
  const c = gridCenter(g);
  const dist = gridBBox(g).h / 2 + 60;
  const ang = gridRad(g);
  return { x: c.x + dist * Math.sin(ang), y: c.y - dist * Math.cos(ang) };
}

/** World position of the MOVE handle — a knob OUTSIDE the grid's left vertex (so it
 *  never sits over a cell), letting you drag the whole grid from ANY tab. */
export function gridMoveHandle(g: GridDef): { x: number; y: number } {
  const c = gridCenter(g);
  const l = gridOutline(g)[3]!; // left outer vertex
  const dx = l.x - c.x;
  const dy = l.y - c.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: l.x + (dx / len) * 46, y: l.y + (dy / len) * 46 };
}

/** Coerce a persisted `alloc` (old string[] of playable cells → level 1, or an
 *  already-a-map value) into a cell→level record. */
function normAlloc(a: unknown): Record<string, number> {
  if (Array.isArray(a)) {
    const o: Record<string, number> = {};
    for (const k of a) o[String(k)] = 1;
    return o;
  }
  return a && typeof a === 'object' ? (a as Record<string, number>) : {};
}
/** Copy a grid record, normalising its `alloc` shape. */
function cloneGrid(g: GridDef): GridDef {
  return { ...g, ...(g.alloc ? { alloc: normAlloc(g.alloc) } : {}) };
}

/** A cell key "col,row". */
export const cellKey = (col: number, row: number): string => `${col},${row}`;

export interface PlacedAsset {
  id: string;
  name: string;
  kind: 'png' | 'obj' | 'fbx' | 'glb';
  /** 'asset' sits on one cell; 'map' is a large base layer behind the grid. */
  role: 'asset' | 'map';
  /** Phaser texture key holding the (baked) art. */
  textureKey: string;
  /** Natural texture size (px) — the auto-fit algorithm reads this. */
  w: number;
  h: number;
  col: number;
  row: number;
  /** Pinned to a custom GridDef: its id + cell indices (i,j) on that grid, so the
   *  asset sits EXACTLY on the grid you drew — not the game's implicit iso grid.
   *  Absent = free placement on the game cell (col,row). */
  gridId?: string;
  gi?: number;
  gj?: number;
  /** Baked world centre of the pinned cell — a RENDER FALLBACK that survives a reload
   *  even if the grid can't be resolved at paint time (kept in sync on pin). Without
   *  it, an unresolved grid falls back to the coarse game cell (col,row) → the asset
   *  jumps off its spot. */
  wx?: number;
  wy?: number;
  /** Vertical pixel offset from the tile centre (fine up/down positioning) = "z". */
  z?: number;
  /** On-board display scale (the size slider drives this). */
  scale: number;
  /** On-board rotation in DEGREES (the rotation slider drives this). Absent = 0. */
  rot?: number;
  /** Mirror the art to face the other way (H) / flip it (V). The "face" toggles. */
  flipX?: boolean;
  flipY?: boolean;
  /** For an ANIMATED 3D model: frames in its baked spritesheet (>1 = animated) + the
   *  rate to play them, so the placed decor MOVES in-game. */
  frameCount?: number;
  frameRate?: number;
  /** Original imported filename incl. extension (e.g. "home.png") — the manifest key. */
  fileName?: string;
  /** A data-URL snapshot so placed assets survive a reload (like map layers). */
  dataUrl?: string;
  /** For 3D: raw model file (base64) + ext, to rebuild the ANIMATED model on reload. */
  modelSrc?: string;
  modelExt?: string;
  /** Filename in the repo's `asset3d/` folder (dev store) — preferred over modelSrc. */
  file3d?: string;
  /** Filename in `asset3d/` for a 2D image (so teammates get the original on pull). */
  file2d?: string;
  /** MODIFIABLE decor: the PLAYER can drag it around in-game. Absent/false = FIXED —
   *  inert in play, only the editor can move it. */
  movable?: boolean;
}

/** A full-board base map layer (imported via "Add map"), paged with ‹ N/M ›. */
export interface MapLayer {
  id: string;
  name: string;
  kind: 'png' | 'obj' | 'fbx' | 'glb';
  textureKey: string;
  w: number;
  h: number;
  /** A data-URL snapshot so the first map(s) survive a reload. */
  dataUrl?: string;
  /** The game's OWN authored backdrop (map #1) — rendered by the game itself, so
   *  the editor draws no override sprite for it. Never persisted. */
  base?: boolean;
}

/** Allocation value = UNLOCK LEVEL: 0 = blocked (de-allocated), N>=1 = playable
 *  once the Keeper reaches level N (1 = playable now). Absent = authored default. */

/** A hand-drawn map zone: a closed polygon of WORLD-space points, named and saved
 *  like a selection. Independent of the square grid — it traces the art itself, so
 *  it can match the floating isometric islands the uniform grid never lines up with. */
export interface MapZone {
  id: string;
  name: string;
  /** Id of the GridDef this zone was laid out on (the grid it depends on). Absent
   *  = drawn free-hand before any grid existed. */
  gridId?: string;
  /** Polygon vertices in WORLD (board) coordinates, in click order. */
  points: { x: number; y: number }[];
  /** Optional per-zone iso grid, CALIBRATED on one painted tile (click its 4
   *  corners). ox/oy = that tile's centre; hw/hh = its half-width/half-height.
   *  Lattice tile (i,j) centre = (ox+(i-j)·hw, oy+(i+j)·hh), clipped to the
   *  polygon — so cells line up with the art the global grid never matched. */
  grid?: { ox: number; oy: number; hw: number; hh: number };
}

/** Independent editor state for ONE paged map (grids + allocations + assets + zones). */
interface MapEditState {
  allocations: Map<string, number>;
  placedAssets: PlacedAsset[];
  zones: MapZone[];
  /** Grid definitions this map is laid out on (defined before any zone). */
  grids: GridDef[];
}

/** A row in the Position tab: a live game object OR a placed editor asset. */
export interface PositionEntry {
  id: string;
  name: string;
  col: number;
  row: number;
  z: number;
  rank: number;
  source: 'game' | 'asset';
}

type Listener = () => void;

class EditorStore {
  open = false;
  darken = true;
  /** Erase the default game backdrop to a black screen (so you can build your own
   *  map on a clean canvas). Editor-view only — the game itself is untouched. */
  blackout = false;
  setBlackout(v: boolean): void {
    this.blackout = v;
    this.emit();
  }
  /** The default game backdrop (map #1) was deleted, so an imported map is now the
   *  primary map. Persists — and forces the black cover so the default never peeks. */
  baseHidden = false;
  private BASEHIDDEN_KEY = 'emberkeep_editor_basehidden';
  private persistBaseHidden(): void {
    try {
      window.localStorage.setItem(this.BASEHIDDEN_KEY, this.baseHidden ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }
  /** The square iso grid overlay. OFF by default — it never matches the
   *  hand-authored floating islands, so the map opens clean for zone-drawing;
   *  the Carte tab's toggle can bring the grid back for cell allocation. */
  showGrid = false;
  tab: EditorTab = 'edit';
  tool: EditorTool = 'select';

  /** Authored playable dims (for export's `map` field). */
  mapCols = 0;
  mapRows = 0;
  setMapDims(cols: number, rows: number): void {
    this.mapCols = cols;
    this.mapRows = rows;
  }

  /**
   * The FULL grid extent (in col/row), covering the whole backdrop — not just the
   * authored playable tiles. Set by BoardEditor from the backdrop's world rect;
   * powers "select whole map" and bounds the selectable/allocatable area. May be
   * negative (the backdrop overhangs the authored origin).
   */
  gridMinCol = 0;
  gridMaxCol = 0;
  gridMinRow = 0;
  gridMaxRow = 0;
  setGridExtent(minCol: number, maxCol: number, minRow: number, maxRow: number): void {
    this.gridMinCol = minCol;
    this.gridMaxCol = maxCol;
    this.gridMinRow = minRow;
    this.gridMaxRow = maxRow;
  }

  /** Bumped on every STRUCTURAL change (not hover) so the board can cache the
   *  expensive full-grid draw and only repaint the light hover overlay on move. */
  rev = 0;

  /** Live cursor cell (for the x/y/z readout) — null when off the board. */
  hoverCell: { col: number; row: number } | null = null;

  /** Cells the user has box/click-selected (grid tools operate on these). */
  selectedCells = new Set<string>();

  /**
   * Per-map editor state (allocations + placed assets), keyed by MapLayer id, so
   * each paged map edits INDEPENDENTLY — editing map 2 never touches map 1.
   */
  private mapStates = new Map<string, MapEditState>();
  private stateFor(id: string): MapEditState {
    let s = this.mapStates.get(id);
    if (!s) {
      s = { allocations: new Map(), placedAssets: [], zones: [], grids: [] };
      this.mapStates.set(id, s);
    }
    return s;
  }
  /** Id of the map being edited — the game backdrop ('__base__') by default. */
  get currentMapId(): string {
    return this.maps[this.currentMap]?.id ?? '__base__';
  }
  /** Id of the map that IS the live game world: the default ('__base__') unless it
   *  was deleted (baseHidden), in which case the first imported map is primary. Used
   *  to push the right map's design (allocations + grids + assets) into the game. */
  get primaryMapId(): string {
    if (!this.baseHidden) return '__base__';
    const imported = this.maps.find((m) => !m.base) ?? this.diskMaps.find((m) => !m.base);
    return imported?.id ?? '__base__';
  }
  /** Runtime override of the live game world (set by a `world:switch` teleport, e.g.
   *  to borealis). Null = use `primaryMapId`. NOT persisted — a reload returns to
   *  the primary world. */
  activeWorldId: string | null = null;
  get activeGameWorldId(): string {
    return this.activeWorldId ?? this.primaryMapId;
  }
  /** Look up a saved/loaded map by NAME (used to resolve `world:switch` targets). */
  mapByName(name: string): MapLayer | undefined {
    const all = [...this.maps, ...this.diskMaps];
    return all.find((m) => m.name === name || m.name === name.replace(/\.[^.]+$/, ''));
  }

  /**
   * Per-cell functional override the editor applied on top of the authored map:
   * true = allocated (functional/bright), false = de-allocated. Absent = use the
   * map's authored playable state. Belongs to the CURRENT map only.
   */
  get allocations(): Map<string, number> {
    return this.stateFor(this.currentMapId).allocations;
  }
  set allocations(v: Map<string, number>) {
    this.stateFor(this.currentMapId).allocations = v;
  }
  /** The unlock LEVEL the "allocate" tool assigns to picked cells (1 = now). */
  allocLevel = 1;
  setAllocLevel(n: number): void {
    this.allocLevel = Math.max(1, Math.min(9, Math.round(n) || 1));
    this.emit();
  }

  /** Placed assets — also per current map. */
  get placedAssets(): PlacedAsset[] {
    return this.stateFor(this.currentMapId).placedAssets;
  }
  set placedAssets(v: PlacedAsset[]) {
    this.stateFor(this.currentMapId).placedAssets = v;
  }
  selectedAssetId: string | null = null;

  /** An imported-but-not-yet-placed asset shown in the preview tray. */
  pendingAsset: Omit<PlacedAsset, 'col' | 'row'> | null = null;

  private listeners = new Set<Listener>();

  on(_evt: 'change', fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  /** `structural=false` (hover only) skips the rev bump so the board can avoid a
   *  full-grid rebuild on plain pointer moves. */
  private emit(structural = true): void {
    if (structural) this.rev++;
    for (const fn of this.listeners) fn();
  }

  setOpen(v: boolean): void {
    if (this.open === v) return;
    this.open = v;
    if (!v) {
      this.selectedCells.clear();
      this.selectedAssetId = null;
      this.pendingAsset = null;
      this.drawingZone = false;
      this.draftPoints = [];
      this.draftCursor = null;
      this.selectedZoneId = null;
      this.selectedGridId = null;
      this.drawingGrid = false;
      this.gridDraft = null;
      this.blackout = false;
      this.calibratingGrid = false;
      this.calibPoints = [];
    }
    this.emit();
  }
  setDarken(v: boolean): void {
    this.darken = v;
    this.emit();
  }
  setTab(t: EditorTab): void {
    this.tab = t;
    this.emit();
  }
  setTool(t: EditorTool): void {
    this.tool = t;
    this.emit();
  }
  setHover(cell: { col: number; row: number } | null): void {
    const same =
      (cell === null && this.hoverCell === null) ||
      (cell && this.hoverCell && cell.col === this.hoverCell.col && cell.row === this.hoverCell.row);
    if (same) return;
    this.hoverCell = cell;
    this.emit(false); // hover-only — no full-grid rebuild
  }

  toggleCell(col: number, row: number, additive: boolean): void {
    const k = cellKey(col, row);
    if (!additive) this.selectedCells.clear();
    if (this.selectedCells.has(k) && additive) this.selectedCells.delete(k);
    else this.selectedCells.add(k);
    this.emit();
  }
  addCell(col: number, row: number): void {
    this.selectedCells.add(cellKey(col, row));
    this.emit();
  }
  removeCell(col: number, row: number): void {
    this.selectedCells.delete(cellKey(col, row));
    this.emit();
  }
  /** Select EVERY cell of the whole map — the full backdrop grid extent. */
  selectAll(): void {
    for (let r = this.gridMinRow; r <= this.gridMaxRow; r++)
      for (let c = this.gridMinCol; c <= this.gridMaxCol; c++) this.selectedCells.add(cellKey(c, r));
    this.emit();
  }
  clearSelection(): void {
    this.selectedCells.clear();
    this.emit();
  }

  /** Set every selected cell's unlock LEVEL (0 = blocked/de-allocate, N = opens at
   *  level N; 1 = playable now). */
  applyAllocation(level: number): void {
    for (const k of this.selectedCells) this.allocations.set(k, level);
    this.persist();
    this.emit();
  }
  /** Functional (allocated at any level>0) if an override says so, else authored. */
  isAllocated(col: number, row: number, authoredPlayable: boolean): boolean {
    const o = this.allocations.get(cellKey(col, row));
    return o === undefined ? authoredPlayable : o > 0;
  }
  /** The unlock level assigned to a cell (undefined = no override; 0 = blocked). */
  allocationLevel(col: number, row: number): number | undefined {
    return this.allocations.get(cellKey(col, row));
  }

  setPendingAsset(a: EditorStore['pendingAsset']): void {
    this.pendingAsset = a;
    this.emit();
  }
  placePendingAt(col: number, row: number): PlacedAsset | null {
    if (!this.pendingAsset) return null;
    const asset: PlacedAsset = { ...this.pendingAsset, col, row };
    this.placedAssets.push(asset);
    this.pendingAsset = null;
    this.selectedAssetId = asset.id;
    this.persistAssets();
    this.emit();
    return asset;
  }
  moveAsset(id: string, col: number, row: number): void {
    const a = this.placedAssets.find((x) => x.id === id);
    if (!a) return;
    a.col = col;
    a.row = row;
    this.detachFromGrid(a); // free placement on the game cell
    this.persistAssets();
    this.emit();
  }
  /** Place the pending asset PINNED to a custom grid cell (i,j); `col,row` = the game
   *  cell that cell's centre falls on (kept in sync for the game integration). */
  placePendingOnGrid(gridId: string, gi: number, gj: number, col: number, row: number): PlacedAsset | null {
    if (!this.pendingAsset) return null;
    const c = this.cellCenterOf(gridId, gi, gj);
    const asset: PlacedAsset = { ...this.pendingAsset, col, row, gridId, gi, gj, ...(c ? { wx: c.x, wy: c.y } : {}) };
    this.placedAssets.push(asset);
    this.pendingAsset = null;
    this.selectedAssetId = asset.id;
    this.persistAssets();
    this.emit();
    return asset;
  }
  /** Move a placed asset to a custom grid cell (i,j) — snapped exactly to the grid. */
  moveAssetOnGrid(id: string, gridId: string, gi: number, gj: number, col: number, row: number): void {
    const a = this.placedAssets.find((x) => x.id === id);
    if (!a) return;
    a.gridId = gridId;
    a.gi = gi;
    a.gj = gj;
    a.col = col;
    a.row = row;
    const c = this.cellCenterOf(gridId, gi, gj);
    if (c) {
      a.wx = c.x;
      a.wy = c.y;
    }
    this.persistAssets();
    this.emit();
  }
  /** World centre of a grid cell (current map's grids), or null if the grid is gone. */
  private cellCenterOf(gridId: string, i: number, j: number): { x: number; y: number } | null {
    const g = this.grids.find((x) => x.id === gridId);
    return g ? gridCellCenter(g, i, j) : null;
  }
  private detachFromGrid(a: PlacedAsset): void {
    delete a.gridId;
    delete a.gi;
    delete a.gj;
    delete a.wx;
    delete a.wy;
  }
  /** Backfill baked cell centres (`wx/wy`) for pinned assets that predate the field,
   *  resolving each grid within its OWN map state (deterministic — no dependence on
   *  the live world). Run after load/ingest so a reload always has a robust position. */
  private backfillAssetPins(): void {
    for (const s of this.mapStates.values()) {
      for (const a of s.placedAssets) {
        if (a.gridId === undefined || a.gi === undefined || a.gj === undefined) continue;
        if (a.wx !== undefined && a.wy !== undefined) continue;
        const g = s.grids.find((x) => x.id === a.gridId);
        if (g) {
          const c = gridCellCenter(g, a.gi, a.gj);
          a.wx = c.x;
          a.wy = c.y;
        }
      }
    }
  }
  scaleAsset(id: string, scale: number): void {
    const a = this.placedAssets.find((x) => x.id === id);
    if (!a) return;
    a.scale = scale;
    this.persistAssets();
    this.emit();
  }
  /** Toggle the art's facing: 'x' mirrors horizontally (face the other way), 'y' flips. */
  toggleAssetFlip(id: string, axis: 'x' | 'y'): void {
    const a = this.placedAssets.find((x) => x.id === id);
    if (!a) return;
    if (axis === 'x') a.flipX = !a.flipX;
    else a.flipY = !a.flipY;
    this.persistAssets();
    this.emit();
  }
  /** Fixe ↔ Modifiable: whether the PLAYER may drag this decor in-game. */
  setAssetMovable(id: string, movable: boolean): void {
    const a = this.placedAssets.find((x) => x.id === id);
    if (!a) return;
    a.movable = movable;
    this.persistAssets();
    this.emit();
  }
  /** Pre-set Fixe/Modifiable on the not-yet-placed asset (carried when it lands). */
  setPendingMovable(movable: boolean): void {
    if (!this.pendingAsset) return;
    this.pendingAsset = { ...this.pendingAsset, movable };
    this.emit();
  }
  /** A MODIFIABLE asset moved by the player in-game: drop it at a free world position
   *  (wx/wy), keep col/row in sync, unpin from any grid, and persist. Searches every
   *  map (ids are unique) so it works no matter which world is live. */
  setAssetWorldPos(id: string, wx: number, wy: number, col: number, row: number): void {
    for (const s of this.mapStates.values()) {
      const a = s.placedAssets.find((x) => x.id === id);
      if (!a) continue;
      a.wx = wx;
      a.wy = wy;
      a.col = col;
      a.row = row;
      delete a.gridId; // free placement — no longer pinned to a custom grid cell
      delete a.gi;
      delete a.gj;
      this.persistAssets();
      this.emit();
      return;
    }
  }
  /** Set an asset's grid position (x=col, y=row), vertical offset (z) and/or rotation. */
  setAssetPos(id: string, pos: { col?: number; row?: number; z?: number; rot?: number }): void {
    const a = this.placedAssets.find((x) => x.id === id);
    if (!a) return;
    if (pos.col !== undefined) a.col = pos.col;
    if (pos.row !== undefined) a.row = pos.row;
    if (pos.z !== undefined) a.z = pos.z;
    if (pos.rot !== undefined) a.rot = pos.rot;
    if (pos.col !== undefined || pos.row !== undefined) this.detachFromGrid(a); // manual x/y = free game cell
    this.persistAssets();
    this.emit();
  }
  removeAsset(id: string): void {
    this.placedAssets = this.placedAssets.filter((a) => a.id !== id);
    if (this.selectedAssetId === id) this.selectedAssetId = null;
    this.persistAssets();
    this.emit();
  }
  /** Placed assets whose cell falls on the CURRENT map layer (the "Voir" list). */
  get assetsOnCurrentMap(): PlacedAsset[] {
    return this.placedAssets;
  }
  /** Is an asset3d file (3D or 2D) still referenced by ANY placed asset (any map)?
   *  Guards the on-disk delete so a file shared by two placements isn't removed too early. */
  isFile3dUsed(file3d: string): boolean {
    for (const s of this.mapStates.values()) {
      if (s.placedAssets.some((a) => a.file3d === file3d)) return true;
    }
    return false;
  }
  isFileUsed(fileName: string): boolean {
    for (const s of this.mapStates.values()) {
      if (s.placedAssets.some((a) => a.file3d === fileName || a.file2d === fileName)) return true;
    }
    return false;
  }
  /** Force a structural change notification (e.g. after Apply/Save mutates the
   *  allocations map directly, so the board overlay repaints). */
  markChanged(): void {
    this.emit();
  }
  selectAsset(id: string | null): void {
    this.selectedAssetId = id;
    this.emit();
  }
  get selectedAsset(): PlacedAsset | null {
    return this.placedAssets.find((a) => a.id === this.selectedAssetId) ?? null;
  }

  /* ----------------------- grid definitions (foundation) -------------------- */
  selectedGridId: string | null = null;
  /** True while the "Nouvelle grille" tool is armed — DRAG a rectangle on the board
   *  to set the new grid's extent (grids are created by hand, never auto). */
  drawingGrid = false;
  /** Live drag box for the grid being drawn (WORLD coords); null before mousedown. */
  gridDraft: { sx: number; sy: number; ex: number; ey: number } | null = null;

  /** Grid definitions for the CURRENT paged map. */
  get grids(): GridDef[] {
    return this.stateFor(this.currentMapId).grids;
  }
  /** Grid definitions for a SPECIFIC map id (export/manifest). */
  gridsFor(id: string): GridDef[] {
    return this.stateFor(id).grids;
  }
  get selectedGrid(): GridDef | null {
    return this.grids.find((g) => g.id === this.selectedGridId) ?? null;
  }

  /** Arm the manual grid tool: the next drag on the board defines the box. */
  startGridDraw(): void {
    this.drawingGrid = true;
    this.gridDraft = null;
    this.selectedGridId = null;
    this.emit();
  }
  setGridDraftStart(x: number, y: number): void {
    if (!this.drawingGrid) return;
    this.gridDraft = { sx: x, sy: y, ex: x, ey: y };
    this.emit(false);
  }
  setGridDraftEnd(x: number, y: number): void {
    if (!this.drawingGrid || !this.gridDraft) return;
    this.gridDraft.ex = x;
    this.gridDraft.ey = y;
    this.emit(false);
  }
  cancelGridDraw(): void {
    this.drawingGrid = false;
    this.gridDraft = null;
    this.emit();
  }
  /** Finish the drag: if the box is big enough, create an 8×8 iso grid FILLING it,
   *  selected and ready to tune (perspective / matrix / size in the sidebar). */
  finishGridDraw(): GridDef | null {
    const d = this.gridDraft;
    this.gridDraft = null;
    if (!d || Math.abs(d.ex - d.sx) < 12 || Math.abs(d.ey - d.sy) < 12) {
      this.emit(); // too small — mis-click; stay armed to retry
      return null;
    }
    this.drawingGrid = false;
    const box = { x: Math.min(d.sx, d.ex), y: Math.min(d.sy, d.ey), w: Math.abs(d.ex - d.sx), h: Math.abs(d.ey - d.sy) };
    const cols = 8;
    const rows = 8;
    const f = gridFromBox('iso', box, cols, rows);
    const g: GridDef = { id: `g${Date.now()}`, name: `Grille ${this.grids.length + 1}`, persp: 'iso', tileW: f.tileW, tileH: f.tileH, cols, rows, ox: f.ox, oy: f.oy, rot: 0 };
    this.grids.push(g);
    this.selectedGridId = g.id;
    this.persistGrids();
    this.emit();
    return g;
  }
  selectGrid(id: string | null): void {
    this.selectedGridId = id;
    this.emit();
  }
  renameGrid(id: string, name: string): void {
    const g = this.grids.find((x) => x.id === id);
    if (!g) return;
    g.name = name;
    this.persistGrids();
    this.emit();
  }
  removeGrid(id: string): void {
    this.stateFor(this.currentMapId).grids = this.grids.filter((g) => g.id !== id);
    if (this.selectedGridId === id) this.selectedGridId = null;
    this.persistGrids();
    this.emit();
  }
  clearGrids(): void {
    this.stateFor(this.currentMapId).grids = [];
    this.selectedGridId = null;
    this.persistGrids();
    this.emit();
  }
  /** Edit perspective / matrix — tile size + origin REFIT so the grid keeps filling
   *  its current box (matrix ≥ 1×1, ≤ 200 each way). */
  setGridParams(id: string, patch: Partial<Pick<GridDef, 'persp' | 'cols' | 'rows'>>): void {
    const g = this.grids.find((x) => x.id === id);
    if (!g) return;
    const box = gridBBox(g); // the area to keep filling
    if (patch.persp) g.persp = patch.persp;
    if (patch.cols !== undefined) g.cols = Math.max(1, Math.min(200, Math.round(patch.cols)));
    if (patch.rows !== undefined) g.rows = Math.max(1, Math.min(200, Math.round(patch.rows)));
    const f = gridFromBox(g.persp, box, g.cols, g.rows);
    g.tileW = f.tileW;
    g.tileH = f.tileH;
    g.ox = f.ox;
    g.oy = f.oy;
    this.persistGrids();
    this.emit();
  }
  /** The grid's box (top-left position + size) for the sidebar fields. */
  gridBox(id: string): { x: number; y: number; w: number; h: number } | null {
    const g = this.grids.find((x) => x.id === id);
    return g ? gridBBox(g) : null;
  }
  /** Precise box edit (X/Y = top-left, W/H = size) — refits the tiles to fill it.
   *  `persist=false` during a live drag (flushed on pointer-up). */
  setGridBounds(id: string, b: { x?: number; y?: number; w?: number; h?: number }, persist = true): void {
    const g = this.grids.find((x) => x.id === id);
    if (!g) return;
    const cur = gridBBox(g);
    const box = { x: b.x ?? cur.x, y: b.y ?? cur.y, w: Math.max(16, b.w ?? cur.w), h: Math.max(16, b.h ?? cur.h) };
    const f = gridFromBox(g.persp, box, g.cols, g.rows);
    g.tileW = f.tileW;
    g.tileH = f.tileH;
    g.ox = f.ox;
    g.oy = f.oy;
    if (persist) this.persistGrids();
    this.emit(persist);
  }
  /** Drag the whole grid by a world delta (no persist per move — flushed on release). */
  moveGridBy(id: string, dx: number, dy: number): void {
    const g = this.grids.find((x) => x.id === id);
    if (!g) return;
    g.ox += dx;
    g.oy += dy;
    this.emit(false);
  }
  /** Set the grid's rotation in degrees (normalised 0..360). */
  setGridRot(id: string, deg: number, persist = true): void {
    const g = this.grids.find((x) => x.id === id);
    if (!g) return;
    let d = deg % 360;
    if (d < 0) d += 360;
    g.rot = Math.round(d * 10) / 10;
    if (persist) this.persistGrids();
    this.emit(persist);
  }
  /** Allocate grid cell (i,j) at an unlock LEVEL (≥1), or REMOVE it (level ≤ 0).
   *  Out-of-matrix clicks are ignored. */
  setGridCellAlloc(id: string, i: number, j: number, level: number): void {
    const g = this.grids.find((x) => x.id === id);
    if (!g || i < 0 || j < 0 || i >= g.cols || j >= g.rows) return;
    const key = `${i},${j}`;
    const map = { ...(g.alloc ?? {}) };
    if (level >= 1) map[key] = Math.round(level);
    else delete map[key];
    g.alloc = map;
    this.persistGrids();
    this.emit();
  }
  /** Unlock level of grid cell (i,j) (0 = not allocated). */
  gridCellLevel(g: GridDef, i: number, j: number): number {
    return g.alloc?.[`${i},${j}`] ?? 0;
  }

  private GRIDS_KEY = 'emberkeep_editor_grids';
  persistGrids(): void {
    try {
      const out: Record<string, GridDef[]> = {};
      for (const [id, s] of this.mapStates) if (s.grids.length) out[id] = s.grids;
      window.localStorage.setItem(this.GRIDS_KEY, JSON.stringify(out));
    } catch {
      /* quota / unavailable — grids still live in-session */
    }
  }
  savedGridsAll(): Record<string, GridDef[]> {
    try {
      const p = JSON.parse(window.localStorage.getItem(this.GRIDS_KEY) ?? '{}');
      return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, GridDef[]>) : {};
    } catch {
      return {};
    }
  }

  /* --------------------------- map zones (polygons) ------------------------- */
  setShowGrid(v: boolean): void {
    this.showGrid = v;
    this.emit();
  }

  /** True while the "Tracer une zone" tool is active (click = drop a vertex). */
  drawingZone = false;
  /** Vertices placed so far in the current draft (WORLD coords). */
  draftPoints: { x: number; y: number }[] = [];
  /** Live cursor position for the rubber-band segment (WORLD coords). */
  draftCursor: { x: number; y: number } | null = null;
  selectedZoneId: string | null = null;

  /** Zones for the CURRENT paged map (independent per map, like allocations). */
  get zones(): MapZone[] {
    return this.stateFor(this.currentMapId).zones;
  }
  /** Zones for a SPECIFIC map id (used by export/manifest). */
  zonesFor(id: string): MapZone[] {
    return this.stateFor(id).zones;
  }

  /** Enter draw mode with a fresh, empty draft. */
  startZoneDraw(): void {
    this.drawingZone = true;
    this.draftPoints = [];
    this.draftCursor = null;
    this.selectedZoneId = null;
    this.emit();
  }
  /** Drop a polygon vertex at a world point. */
  addZonePoint(x: number, y: number): void {
    if (!this.drawingZone) return;
    this.draftPoints.push({ x, y });
    this.emit();
  }
  /** Update the rubber-band end (cheap — no full-grid rebuild). */
  setZoneCursor(x: number, y: number): void {
    if (!this.drawingZone) return;
    this.draftCursor = { x, y };
    this.emit(false);
  }
  /** Undo the last dropped vertex (Backspace). */
  undoZonePoint(): void {
    if (!this.drawingZone) return;
    this.draftPoints.pop();
    this.emit();
  }
  /** Close the polygon (Enter): needs ≥3 points. Saves + selects the new zone.
   *  `name` comes from the prompt shown on Enter; falls back to "Zone N". */
  finishZone(name?: string): MapZone | null {
    if (!this.drawingZone || this.draftPoints.length < 3) return null;
    const zone: MapZone = {
      id: `z${Date.now()}`,
      name: name?.trim() || `Zone ${this.zones.length + 1}`,
      ...(this.selectedGridId ? { gridId: this.selectedGridId } : {}), // the grid it depends on
      points: this.draftPoints.map((p) => ({ ...p }))
    };
    this.zones.push(zone);
    this.drawingZone = false;
    this.draftPoints = [];
    this.draftCursor = null;
    this.selectedZoneId = zone.id;
    this.persistZones();
    this.emit();
    return zone;
  }
  /** Discard the current draft (Escape). */
  cancelZoneDraw(): void {
    this.drawingZone = false;
    this.draftPoints = [];
    this.draftCursor = null;
    this.emit();
  }
  renameZone(id: string, name: string): void {
    const z = this.zones.find((x) => x.id === id);
    if (!z) return;
    z.name = name;
    this.persistZones();
    this.emit();
  }
  removeZone(id: string): void {
    this.stateFor(this.currentMapId).zones = this.zones.filter((z) => z.id !== id);
    if (this.selectedZoneId === id) this.selectedZoneId = null;
    this.persistZones();
    this.emit();
  }
  clearZones(): void {
    this.stateFor(this.currentMapId).zones = [];
    this.selectedZoneId = null;
    this.persistZones();
    this.emit();
  }
  selectZone(id: string | null): void {
    this.selectedZoneId = id;
    this.emit();
  }
  get selectedZone(): MapZone | null {
    return this.zones.find((z) => z.id === this.selectedZoneId) ?? null;
  }

  /* ---- moving / reshaping a zone (drag on the board; no persist per move) ---- */
  /** Translate the whole polygon (and its grid origin) by (dx,dy). */
  moveZoneBy(id: string, dx: number, dy: number): void {
    const z = this.zones.find((x) => x.id === id);
    if (!z) return;
    for (const p of z.points) {
      p.x += dx;
      p.y += dy;
    }
    if (z.grid) {
      z.grid.ox += dx;
      z.grid.oy += dy;
    }
    this.emit(false); // drag — redraw only, persist on pointer-up
  }
  /** Nudge one vertex by a world delta (reshape). */
  moveZoneVertexBy(id: string, i: number, dx: number, dy: number): void {
    const z = this.zones.find((zz) => zz.id === id);
    const p = z?.points[i];
    if (!z || !p) return;
    z.points[i] = { x: p.x + dx, y: p.y + dy };
    this.emit(false);
  }
  /** Replace a zone's polygon wholesale (used by the resize/scale handles). */
  setZonePoints(id: string, pts: { x: number; y: number }[]): void {
    const z = this.zones.find((zz) => zz.id === id);
    if (!z) return;
    z.points = pts.map((p) => ({ x: p.x, y: p.y }));
    this.emit(false);
  }
  /** The zone's bounding box in world px (for the precise X/Y/W/H sidebar fields). */
  zoneBounds(id: string): { x: number; y: number; w: number; h: number } | null {
    const z = this.zones.find((zz) => zz.id === id);
    if (!z || !z.points.length) return null;
    const xs = z.points.map((p) => p.x);
    const ys = z.points.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  /** Precise edit: move (x/y = bbox top-left) and/or scale (w/h = bbox size) the
   *  zone from its top-left. A pure move carries the grid origin; a resize leaves
   *  the tile size (grid stays aligned to the art). Persists (discrete edit). */
  setZoneBounds(id: string, b: { x?: number; y?: number; w?: number; h?: number }): void {
    const z = this.zones.find((zz) => zz.id === id);
    const cur = this.zoneBounds(id);
    if (!z || !cur) return;
    const tx = b.x ?? cur.x;
    const ty = b.y ?? cur.y;
    const tw = Math.max(4, b.w ?? cur.w);
    const th = Math.max(4, b.h ?? cur.h);
    const scaleX = tw / (cur.w || 1);
    const scaleY = th / (cur.h || 1);
    z.points = z.points.map((p) => ({ x: tx + (p.x - cur.x) * scaleX, y: ty + (p.y - cur.y) * scaleY }));
    if (z.grid) {
      z.grid.ox += tx - cur.x; // translate with a move; tile size unchanged
      z.grid.oy += ty - cur.y;
    }
    this.persistZones();
    this.emit();
  }

  /* ---- per-zone grid: calibrate on one painted tile (click its 4 corners) ---- */
  calibratingGrid = false;
  /** The tile-corner clicks gathered so far (world coords): haut, droite, bas, gauche. */
  calibPoints: { x: number; y: number }[] = [];

  /** Begin calibrating a grid for the SELECTED zone (needs one selected). */
  startGridCalibration(): void {
    if (!this.selectedZone) return;
    this.calibratingGrid = true;
    this.calibPoints = [];
    this.draftCursor = null;
    this.emit();
  }
  addCalibPoint(x: number, y: number): void {
    if (!this.calibratingGrid) return;
    this.calibPoints.push({ x, y });
    if (this.calibPoints.length >= 4) this.finishGridCalibration();
    else this.emit();
  }
  undoCalibPoint(): void {
    if (!this.calibratingGrid) return;
    this.calibPoints.pop();
    this.emit();
  }
  /** Derive {ox,oy,hw,hh} from the 4 tile corners and store it on the zone. */
  finishGridCalibration(): void {
    const z = this.selectedZone;
    const p = this.calibPoints;
    if (z && p.length >= 4) {
      const [t, r, b, l] = p as [typeof p[0], typeof p[0], typeof p[0], typeof p[0]];
      z.grid = {
        ox: (l.x + r.x) / 2,
        oy: (t.y + b.y) / 2,
        hw: Math.max(2, Math.abs(r.x - l.x) / 2),
        hh: Math.max(2, Math.abs(b.y - t.y) / 2)
      };
      this.persistZones();
    }
    this.calibratingGrid = false;
    this.calibPoints = [];
    this.draftCursor = null;
    this.emit();
  }
  cancelGridCalibration(): void {
    this.calibratingGrid = false;
    this.calibPoints = [];
    this.draftCursor = null;
    this.emit();
  }
  /** Drop a zone's grid (keep the zone). */
  removeZoneGrid(id: string): void {
    const z = this.zones.find((x) => x.id === id);
    if (!z || !z.grid) return;
    delete z.grid;
    this.persistZones();
    this.emit();
  }

  /* ------------------------- base map layers (pager) ------------------------ */
  maps: MapLayer[] = [];
  currentMap = 0;

  /** Seed the game's OWN authored backdrop as map #1 (index 0) so the pager reads
   *  "1/1" before anything is imported, and the first import becomes "1/2".
   *  Idempotent — safe to call on every open. */
  seedBaseMap(name: string): void {
    if (this.baseHidden) return; // default map deleted → an imported map is primary
    if (this.maps.some((m) => m.base)) return;
    this.maps.unshift({ id: '__base__', name, kind: 'png', textureKey: '', w: 1, h: 1, base: true });
    this.currentMap = 0;
    this.emit();
  }
  /** Move one map's whole design (grids + zones + placed assets + allocations) onto
   *  another, so deleting the source map doesn't orphan what you built on it. */
  private mergeDesignInto(fromId: string, toId: string): void {
    if (fromId === toId) return;
    const from = this.mapStates.get(fromId);
    if (!from) return;
    const to = this.stateFor(toId);
    to.grids = [...to.grids, ...from.grids];
    to.zones = [...to.zones, ...from.zones];
    to.placedAssets = [...to.placedAssets, ...from.placedAssets];
    for (const [k, v] of from.allocations) if (!to.allocations.has(k)) to.allocations.set(k, v);
    from.grids = [];
    from.zones = [];
    from.placedAssets = [];
    from.allocations.clear();
    this.persistGrids();
    this.persistZones();
    this.persistAssets();
    this.persist();
  }
  /** Bring the default map back even if it was hidden (empty-pager safety). */
  forceSeedBase(name: string): void {
    this.baseHidden = false;
    this.persistBaseHidden();
    this.seedBaseMap(name);
  }

  addMap(m: MapLayer): void {
    this.maps.push(m);
    this.currentMap = this.maps.length - 1;
    this.persistMaps();
    this.emit();
  }
  /** Switch the paged map AND its edit context — selection/pending reset so each
   *  map starts clean; its own allocations + assets come back via the getters. */
  private goToMap(i: number): void {
    if (!this.maps.length) return;
    this.currentMap = ((i % this.maps.length) + this.maps.length) % this.maps.length;
    this.selectedCells.clear();
    this.selectedAssetId = null;
    this.pendingAsset = null;
    this.drawingZone = false; // each map draws its own zones from a clean draft
    this.draftPoints = [];
    this.draftCursor = null;
    this.selectedZoneId = null;
    this.selectedGridId = null;
    this.calibratingGrid = false;
    this.calibPoints = [];
    this.emit();
  }
  setCurrentMap(i: number): void {
    if (!this.maps.length) return;
    this.goToMap(Math.max(0, Math.min(i, this.maps.length - 1)));
  }
  /** Delete the current paged map. The DEFAULT map (base) can be deleted too — it's
   *  hidden (blackout on) and the next map becomes primary — but the pager is never
   *  left empty. */
  removeCurrentMap(): void {
    if (this.maps.length <= 1) return; // never leave the pager empty
    const layer = this.maps[this.currentMap];
    if (!layer) return;
    if (layer.base) {
      this.baseHidden = true; // hide the default; keep its design data untouched
      this.blackout = true; // erase the default backdrop so the next map stands alone
      this.persistBaseHidden();
      // Carry the base map's design (grids/zones/cells/assets) onto whatever map
      // becomes primary, so nothing you built on it is orphaned.
      const successor = this.maps.find((m) => !m.base && m.id !== layer.id);
      if (successor) this.mergeDesignInto('__base__', successor.id);
    } else {
      this.mapStates.delete(layer.id); // drop its edit state too
      this.deletedMapIds.add(layer.id); // an INTENTIONAL removal — serializeProject may drop it
    }
    this.maps.splice(this.currentMap, 1);
    this.currentMap = Math.max(0, Math.min(this.currentMap, this.maps.length - 1));
    this.selectedCells.clear();
    this.selectedAssetId = null;
    this.persistMaps();
    this.emit();
  }
  prevMap(): void {
    this.goToMap(this.currentMap - 1);
  }
  nextMap(): void {
    this.goToMap(this.currentMap + 1);
  }
  get currentMapLayer(): MapLayer | null {
    return this.maps[this.currentMap] ?? null;
  }
  private MAPS_KEY = 'emberkeep_editor_maps';
  /** Persist maps as data-URLs (size-capped so we never blow the localStorage
   *  quota — the earliest maps are kept, later ones stay in-session). */
  private persistMaps(): void {
    try {
      const slim: MapLayer[] = [];
      const dropped: string[] = [];
      let budget = 4_000_000; // ~4MB of base64 across all saved maps
      for (const m of this.maps) {
        const url = m.dataUrl ?? '';
        if (url && url.length < budget) {
          slim.push({ ...m });
          budget -= url.length;
        } else if (url) {
          dropped.push(m.name);
        }
      }
      window.localStorage.setItem(this.MAPS_KEY, JSON.stringify(slim));
      // Never silently: a map too big for the quota lives only until the tab closes,
      // and "it was there yesterday" is the worst way to find that out. Save bakes it
      // to disk (asset3d/editor-map.json), which has no such limit.
      if (dropped.length) {
        console.warn(`[editor] too big for localStorage — Save to keep: ${dropped.join(', ')}`);
      }
    } catch {
      /* quota / unavailable — maps still live in-session */
    }
  }
  /** Raw saved map records (textures are re-created by the orchestrator on open). */
  savedMaps(): MapLayer[] {
    try {
      return JSON.parse(window.localStorage.getItem(this.MAPS_KEY) ?? '[]') as MapLayer[];
    } catch {
      return [];
    }
  }

  /* ------------------------- placed assets (persist) ------------------------ */
  private ASSETS_KEY = 'emberkeep_editor_assets';
  /** Persist placed assets PER MAP (data-URLs, budget-capped) so they survive a reload. */
  persistAssets(): void {
    try {
      const out: Record<string, PlacedAsset[]> = {};
      let budget = 4_500_000; // ~4.5MB of base64 across ALL maps' assets + model sources
      for (const [id, s] of this.mapStates) {
        if (!s.placedAssets.length) continue;
        const slim: PlacedAsset[] = [];
        for (const a of s.placedAssets) {
          const still = (a.dataUrl ?? '').length;
          const full = still + (a.modelSrc ?? '').length;
          if (full < budget) {
            slim.push({ ...a }); // keep the animated source too
            budget -= full;
          } else if (still < budget) {
            const copy = { ...a };
            delete copy.modelSrc; // too big to persist the source — keep the static snapshot only
            slim.push(copy);
            budget -= still;
          }
        }
        if (slim.length) out[id] = slim;
      }
      window.localStorage.setItem(this.ASSETS_KEY, JSON.stringify(out));
    } catch {
      /* quota / unavailable — assets still live in-session */
    }
  }
  /** Saved asset records per map id (textures re-created by the orchestrator on open). */
  savedAssetsAll(): Record<string, PlacedAsset[]> {
    try {
      const p = JSON.parse(window.localStorage.getItem(this.ASSETS_KEY) ?? '{}');
      return Array.isArray(p) ? { __base__: p as PlacedAsset[] } : (p as Record<string, PlacedAsset[]>);
    } catch {
      return {};
    }
  }
  /** Re-seed one map's placed assets from persistence (textures restored elsewhere). */
  restoreAssetsFor(id: string, assets: PlacedAsset[]): void {
    this.stateFor(id).placedAssets = assets;
    this.emit();
  }

  /* ----------------------------- zones (persist) ---------------------------- */
  private ZONES_KEY = 'emberkeep_editor_zones';
  /** Persist hand-drawn zones PER MAP (small — just polygon points + names). */
  persistZones(): void {
    try {
      const out: Record<string, MapZone[]> = {};
      for (const [id, s] of this.mapStates) if (s.zones.length) out[id] = s.zones;
      window.localStorage.setItem(this.ZONES_KEY, JSON.stringify(out));
    } catch {
      /* quota / unavailable — zones still live in-session */
    }
  }
  /** Saved zone records per map id (from localStorage). */
  savedZonesAll(): Record<string, MapZone[]> {
    try {
      const p = JSON.parse(window.localStorage.getItem(this.ZONES_KEY) ?? '{}');
      return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, MapZone[]>) : {};
    } catch {
      return {};
    }
  }

  /** The "Save" button: flush everything (grids, allocations, maps, assets, zones). */
  saveAll(): void {
    this.persist();
    this.persistMaps();
    this.persistAssets();
    this.persistZones();
    this.persistGrids();
  }

  /* ---- persistence: per-map allocations (imported files stay in-session) ---- */
  private KEY = 'emberkeep_editor_allocations';
  persist(): void {
    try {
      const out: Record<string, [string, number][]> = {};
      for (const [id, s] of this.mapStates) if (s.allocations.size) out[id] = [...s.allocations];
      window.localStorage.setItem(this.KEY, JSON.stringify(out));
    } catch {
      /* storage full / unavailable — editor still works in-session */
    }
  }
  /** Coerce a persisted value to an unlock LEVEL (old saves stored booleans). */
  private toLevel(v: unknown): number {
    return v === true ? 1 : v === false ? 0 : Math.max(0, Math.round(Number(v) || 0));
  }
  /** Load per-map allocations into mapStates (used by load() + the disk overlay). */
  ingestAllocations(byMap: Record<string, [string, unknown][]>): void {
    for (const [id, entries] of Object.entries(byMap)) {
      this.stateFor(id).allocations = new Map(entries.map(([k, v]) => [k, this.toLevel(v)]));
    }
  }
  load(): void {
    try {
      this.baseHidden = window.localStorage.getItem(this.BASEHIDDEN_KEY) === '1';
    } catch {
      /* storage unavailable */
    }
    try {
      const raw = window.localStorage.getItem(this.KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // Migrate the OLD single-map format → the base (game) map.
          this.ingestAllocations({ __base__: parsed as [string, unknown][] });
        } else {
          this.ingestAllocations(parsed as Record<string, [string, unknown][]>);
        }
      }
    } catch {
      /* ignore corrupt overrides */
    }
    // Seed placed-asset metadata too (textures are rebuilt later, on demand).
    try {
      for (const [id, list] of Object.entries(this.savedAssetsAll())) {
        this.stateFor(id).placedAssets = list.map((a) => ({ ...a }));
      }
    } catch {
      /* ignore corrupt asset records */
    }
    // Seed hand-drawn zones (pure data — no textures to rebuild).
    try {
      for (const [id, list] of Object.entries(this.savedZonesAll())) {
        this.stateFor(id).zones = list.map((z) => ({ ...z, points: (z.points ?? []).map((p) => ({ ...p })) }));
      }
    } catch {
      /* ignore corrupt zone records */
    }
    // One-time: drop any grids from the old auto-create flow — grids are now drawn
    // by hand (drag a box), so start clean.
    try {
      if (!window.localStorage.getItem('emberkeep_editor_grids_reset')) {
        window.localStorage.removeItem(this.GRIDS_KEY);
        window.localStorage.setItem('emberkeep_editor_grids_reset', '1');
      }
    } catch {
      /* storage unavailable — nothing to clear */
    }
    // Seed grid definitions (pure data).
    try {
      for (const [id, list] of Object.entries(this.savedGridsAll())) {
        this.stateFor(id).grids = list.map(cloneGrid);
      }
    } catch {
      /* ignore corrupt grid records */
    }
    this.backfillAssetPins(); // bake pinned assets' world centres (robust across reloads)
  }

  /** Allocations for a SPECIFIC map (used by Apply / reload to target one map). */
  allocationsFor(id: string): Map<string, number> {
    return this.stateFor(id).allocations;
  }
  /** Placed assets for a SPECIFIC map (from mapStates — disk or localStorage). */
  assetsFor(id: string): PlacedAsset[] {
    return this.stateFor(id).placedAssets;
  }

  /* ---- on-disk default project (asset3d/editor-map.json) — survives cookie wipe ---- */
  /** Imported map layers restored from disk (used by restoreMaps over localStorage). */
  private diskMaps: MapLayer[] = [];
  /** Maps the user DELETED this session — the only reason serializeProject may drop
   *  one that is still on disk. */
  private deletedMapIds = new Set<string>();
  /** The editor design to bake to disk as the game's DEFAULT: per-map unlock-level
   *  allocations + placed-asset metadata + imported map layers (so they survive a
   *  cookie/localStorage wipe). */
  serializeProject(): {
    allocations: Record<string, [string, number][]>;
    assets: Record<string, PlacedAsset[]>;
    zones: Record<string, MapZone[]>;
    grids: Record<string, GridDef[]>;
    maps: MapLayer[];
    baseHidden: boolean;
  } {
    const allocations: Record<string, [string, number][]> = {};
    const assets: Record<string, PlacedAsset[]> = {};
    const zones: Record<string, MapZone[]> = {};
    const grids: Record<string, GridDef[]> = {};
    for (const [id, s] of this.mapStates) {
      if (s.allocations.size) allocations[id] = [...s.allocations];
      if (s.placedAssets.length) assets[id] = s.placedAssets.map((a) => ({ ...a }));
      if (s.zones.length) zones[id] = s.zones.map((z) => ({ ...z, points: z.points.map((p) => ({ ...p })) }));
      if (s.grids.length) grids[id] = s.grids.map((g) => ({ ...g }));
    }
    // Safety net: a map that is ON DISK but absent from the live pager was never
    // loaded (a slow disk read, a texture that failed) — it was NOT deleted. Baking
    // the pager as-is would erase it permanently, which is how a fast editor open
    // could cost a whole map. Only an explicit delete may remove one.
    const live = this.maps.filter((m) => !m.base);
    const inPager = new Set(live.map((m) => m.id));
    const rescued = this.diskMaps.filter((m) => !inPager.has(m.id) && !this.deletedMapIds.has(m.id));
    if (rescued.length) {
      console.warn(`[editor] kept map(s) the pager never loaded: ${rescued.map((m) => m.name).join(', ')}`);
    }
    return {
      allocations,
      assets,
      zones,
      grids,
      maps: [...live.map((m) => ({ ...m })), ...rescued.map((m) => ({ ...m }))],
      baseHidden: this.baseHidden
    };
  }
  /** Load the on-disk default design (disk is the source of truth for the default). */
  ingestProject(data: {
    allocations?: Record<string, [string, unknown][]>;
    assets?: Record<string, PlacedAsset[]>;
    zones?: Record<string, MapZone[]>;
    grids?: Record<string, GridDef[]>;
    maps?: MapLayer[];
    baseHidden?: boolean;
  }): void {
    if (typeof data.baseHidden === 'boolean') {
      this.baseHidden = data.baseHidden;
      this.persistBaseHidden();
    }
    if (data.allocations) this.ingestAllocations(data.allocations);
    if (data.assets) {
      for (const [id, list] of Object.entries(data.assets)) {
        this.stateFor(id).placedAssets = list.map((a) => ({ ...a }));
      }
    }
    if (data.zones) {
      for (const [id, list] of Object.entries(data.zones)) {
        this.stateFor(id).zones = list.map((z) => ({ ...z, points: (z.points ?? []).map((p) => ({ ...p })) }));
      }
    }
    if (data.grids) {
      for (const [id, list] of Object.entries(data.grids)) {
        this.stateFor(id).grids = list.map(cloneGrid);
      }
    }
    if (data.maps) this.diskMaps = data.maps.map((m) => ({ ...m }));
    this.backfillAssetPins(); // bake pinned assets' world centres (robust across reloads)
    this.emit();
  }
  /**
   * Imported maps to restore on open: everything on disk, PLUS any map that only
   * localStorage knows about.
   *
   * Disk stays the source of truth for what it holds — it survives a cookie wipe and
   * it is what a teammate gets from git. But it was winner-take-all, so a map
   * imported since the last bake existed only in localStorage and silently vanished
   * on the next reload unless you remembered to Save. Deletes are written to BOTH
   * (see deleteMap → persistMaps), so nothing deleted can come back through here.
   */
  resolvedSavedMaps(): MapLayer[] {
    if (!this.diskMaps.length) return this.savedMaps();
    const onDisk = new Set(this.diskMaps.map((m) => m.id));
    return [...this.diskMaps, ...this.savedMaps().filter((m) => !m.base && !onDisk.has(m.id))];
  }
}

export const editorStore = new EditorStore();
