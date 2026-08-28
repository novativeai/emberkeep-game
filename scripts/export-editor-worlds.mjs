/**
 * The Map Editor's own project on disk → `assets/map/nionja-worlds.json`.
 *
 *   node scripts/export-editor-worlds.mjs
 *        [asset3d/editor-map.json] [assets/map/nionja-worlds.json]
 *
 * WHY THIS EXISTS
 * ---------------
 * The export the pipeline reads is written by a BUTTON. `mapEditor.buildExportDoc`
 * runs in the browser, and `Apply` POSTs it to `/__editor/worlds`. So the export is
 * only ever as fresh as the last time somebody had the editor open and pressed it —
 * and on 2026-08-12 it was four maps and two grids behind the project actually on
 * disk. The editor had replaced Hatchery with Runevault, drawn 33 grids on it and
 * placed the cauldron; the game was still building the Hatchery deck, because
 * nothing outside the browser could read what the editor had saved.
 *
 * `asset3d/editor-map.json` IS that project — the same `serializeProject()` document
 * the editor bakes to disk on every change, precisely so the work survives a cookie
 * wipe. This turns it back into an export, headlessly, so `ingest-worlds.mjs` and
 * `build-zones.mjs` can run from what the editor knows rather than from what someone
 * last remembered to publish.
 *
 * IT IS A MIRROR, NOT AN AUTHOR. Every field is computed the way `buildExportDoc`
 * computes it, from the same geometry helpers (`gridBasis`/`gridCellCenter` in
 * editorStore.ts, duplicated here in plain JS for the same reason build-zones
 * duplicates `mapSignature`: this is node with no TypeScript in the loop). It adds
 * nothing and decides nothing. If a cell is not marked playable in the editor, it is
 * not in the export.
 *
 * THE ONE APPROXIMATION, measured. Each playable cell carries a `gameCell`, which
 * the editor gets from the AMBIENT `worldToGrid` — the projection of whatever world
 * the game happens to be showing behind the editor. That is not reproducible outside
 * a running scene, so this uses the pure projection built from `map.json`'s own tile
 * instead. Checked against the 357 cells of the previous export: 355 identical, 2
 * off by one index. `gameCell` feeds exactly one thing — the least-squares fit of
 * `editorToArt` in build-zones, over hundreds of samples — and the fit is unchanged
 * to five decimals by those two.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname: the checkout lives under a path with
// spaces, and the raw pathname keeps them percent-encoded — every readFileSync
// then ENOENTs on a directory that exists.
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const inPath = process.argv[2] ?? 'asset3d/editor-map.json';
const outPath = process.argv[3] ?? 'assets/map/nionja-worlds.json';
const read = (rel) => JSON.parse(readFileSync(path.resolve(ROOT, rel), 'utf8'));

const project = read(inPath);
const authored = read('src/data/map.json');
const registry = existsSync(path.resolve(ROOT, 'src/data/worlds.json'))
  ? read('src/data/worlds.json')
  : {};
/** The document being replaced — the source for the two fields only a live board
 *  can produce (`gameObjects`), so re-exporting never silently empties them. */
const previous = existsSync(path.resolve(ROOT, outPath)) ? read(outPath) : {};

/* ---- editorStore.ts geometry, verbatim ---------------------------------- */

const gridBasis = (g) =>
  g.persp === 'ortho'
    ? { u: { x: g.tileW, y: 0 }, v: { x: 0, y: g.tileH } }
    : { u: { x: g.tileW / 2, y: g.tileH / 2 }, v: { x: -g.tileW / 2, y: g.tileH / 2 } };

const cellRaw = (g, i, j) => {
  const { u, v } = gridBasis(g);
  return { x: g.ox + i * u.x + j * v.x, y: g.oy + i * u.y + j * v.y };
};

/** The footprint centre — the rotation pivot, invariant under rotation. */
const gridCenter = (g) => cellRaw(g, (g.cols - 1) / 2, (g.rows - 1) / 2);

const rotAround = (p, c, ang) => {
  if (!ang) return { x: p.x, y: p.y };
  const co = Math.cos(ang);
  const si = Math.sin(ang);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * co - dy * si, y: c.y + dx * si + dy * co };
};

const gridCellCenter = (g, i, j) =>
  rotAround(cellRaw(g, i, j), gridCenter(g), ((g.rot ?? 0) * Math.PI) / 180);

/** The UNROTATED footprint box, exactly as `gridBBox` reports it to the sidebar. */
function gridBBox(g) {
  const corners = [
    cellRaw(g, -0.5, -0.5),
    cellRaw(g, g.cols - 0.5, -0.5),
    cellRaw(g, g.cols - 0.5, g.rows - 0.5),
    cellRaw(g, -0.5, g.rows - 0.5)
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/* ---- the game lattice (iso.ts's pure layer, from the authored tile) ------ */

const TILE_W = 256;
const BOARD_ORIGIN_X = 1280;
const BOARD_ORIGIN_Y = 316;
const halfW = TILE_W / 2;
const halfH = (TILE_W * ((authored.tile?.height ?? TILE_W / 2) / (authored.tile?.width ?? TILE_W))) / 2;
const worldToGrid = (x, y) => {
  const dx = x - BOARD_ORIGIN_X;
  const dy = y - BOARD_ORIGIN_Y;
  return {
    col: Math.round((dx / halfW + dy / halfH) / 2),
    row: Math.round((dy / halfH - dx / halfW) / 2)
  };
};

/* ---- buildExportDoc, mirrored ------------------------------------------- */

const round = (n) => Math.round(n);
const authoredName = authored.backgrounds?.[0]?.name ?? 'authored';
const maps = project.maps ?? [];
const ids = ['__base__', ...maps.map((m) => m.id)];
// `serializeProject` carries grids/zones/assets/allocations/maps/baseHidden and
// nothing else — which map is primary and which one the game is showing live are
// editor session state, not project state. They come from the document being
// replaced, so a headless re-export never demotes the primary world to nobody.
const primaryMapId = project.primaryMapId ?? previous.primaryWorldId ?? null;
const liveMapId = project.liveGameWorldId ?? previous.liveGameWorldId ?? null;

const worlds = ids.map((id, i) => {
  const isBase = id === '__base__';
  const layer = maps.find((m) => m.id === id);
  const grids = (project.grids?.[id] ?? []).map((g) => {
    const bb = gridBBox(g);
    const cells = Object.entries(g.alloc ?? {})
      // 0 means BLOCKED in the editor's own legend, not "level zero".
      .filter(([, unlockLevel]) => unlockLevel > 0)
      .map(([cell, unlockLevel]) => {
        const [gi, gj] = cell.split(',').map(Number);
        const w = gridCellCenter(g, gi, gj);
        const gc = worldToGrid(w.x, w.y);
        return {
          cell,
          i: gi,
          j: gj,
          world: { x: round(w.x), y: round(w.y) },
          gameCell: { col: gc.col, row: gc.row },
          unlockLevel
        };
      });
    return {
      id: g.id,
      name: g.name,
      onLevel: i + 1,
      assigned: cells.length > 0,
      perspective: g.persp === 'ortho' ? 'ortho' : 'iso',
      tile: { w: g.tileW, h: g.tileH },
      matrix: { cols: g.cols, rows: g.rows },
      rotation: g.rot ?? 0,
      origin: { x: round(g.ox), y: round(g.oy) },
      bounds: { x: round(bb.x), y: round(bb.y), w: round(bb.w), h: round(bb.h) },
      playableCellCount: cells.length,
      cells
    };
  });
  return {
    world: i + 1,
    level: `Level ${i + 1}`,
    id,
    map: isBase ? authoredName : (layer?.name ?? id),
    isAuthoredDefault: isBase,
    isLiveGameWorld: id === liveMapId,
    isPrimary: id === primaryMapId,
    grids,
    allocations: (project.allocations?.[id] ?? []).map(([cell, unlockLevel]) => ({
      cell,
      unlockLevel
    })),
    assets: (project.assets?.[id] ?? []).map((a) => ({
      file: a.fileName ?? a.file3d ?? a.file2d ?? `${a.name}.${a.kind}`,
      name: a.name,
      kind: a.kind,
      x: a.col,
      y: a.row,
      z: a.z ?? 0,
      scale: Number(Number(a.scale ?? 1).toFixed(3)),
      onGrid: a.gridId ? { gridId: a.gridId, cell: `${a.gi},${a.gj}` } : null,
      // Not in the browser's export: the exact point the editor dropped it on,
      // and whether it was mirrored. `x/y` is a game cell, which on a world cut
      // into slabs of different pitches is far too coarse to place a prop by —
      // build-zones needs the pixel to put the cauldron back where he put it.
      world: a.wx === undefined ? null : { x: round(a.wx), y: round(a.wy) },
      flipX: a.flipX === true,
      art: { w: a.w, h: a.h },
      behaviour: ''
    })),
    zones: (project.zones?.[id] ?? []).map((z) => ({
      name: z.name,
      gridId: z.gridId ?? null,
      points: (z.points ?? []).map((p) => ({ x: round(p.x), y: round(p.y) })),
      behaviour: ''
    }))
  };
});

const doc = {
  generatedBy: 'scripts/export-editor-worlds.mjs (from the editor project on disk)',
  map: previous.map ?? { cols: authored.cols, rows: authored.rows },
  defaultMapDeleted: project.baseHidden === true,
  primaryWorldId: primaryMapId,
  liveGameWorldId: liveMapId,
  teleport: registry.teleport ?? previous.teleport ?? null,
  // Live board items. They exist only while the game is running, so a headless
  // export carries the last published set rather than declaring there are none.
  gameObjects: previous.gameObjects ?? [],
  worlds,
  project,
  legend: previous.legend ?? undefined
};

writeFileSync(path.resolve(ROOT, outPath), `${JSON.stringify(doc, null, 2)}\n`);

const rows = worlds.map((w) => ({
  world: w.map,
  grids: w.grids.length,
  cells: w.grids.reduce((n, g) => n + g.cells.length, 0),
  assets: w.assets.length,
  flags: [w.isAuthoredDefault && 'base', w.isPrimary && 'primary', w.isLiveGameWorld && 'live']
    .filter(Boolean)
    .join(' ')
}));
console.table(rows);
console.log(`wrote ${outPath}`);
