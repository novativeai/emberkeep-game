/**
 * World-builder → game map ingest.
 *
 * Reads a world-builder export (`assets/map/*.json`, format 'emberkeep-world')
 * and produces a normalised game map: the playable tile set, the decorative
 * (non-playable) ground, and per-LEVEL fog regions derived from the cloud
 * `levels` map. Cells are normalised so the min (col,row) sits at (0,0).
 *
 * This is the data foundation for the large authored board (the camera + big-
 * grid renderer is the next phase). For now it emits a clean, inspectable map
 * + a stats report so the layout can be validated before wiring it in.
 *
 *   node scripts/ingest-world.mjs assets/map/level-1-3.json [out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const inPath = process.argv[2] ?? 'assets/map/level-1-3.json';
const outPath = process.argv[3] ?? 'src/data/world-map.json';

const doc = JSON.parse(readFileSync(inPath, 'utf8'));
if (doc.format !== 'emberkeep-world') {
  console.error(`Not an emberkeep-world export: ${inPath}`);
  process.exit(1);
}

const calibByKey = {};
for (const a of doc.assets) calibByKey[`${a.category}|${a.name}`] = a.calibration;

// Normalisation: shift so the most-NW occupied cell is (0,0).
let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
for (const p of doc.placements) {
  minC = Math.min(minC, p.col); minR = Math.min(minR, p.row);
  maxC = Math.max(maxC, p.col); maxR = Math.max(maxR, p.row);
}
const norm = (p) => ({ col: p.col - minC, row: p.row - minR });

const tileAt = new Map(); // "c,r" -> { asset, kind }
const decoAt = new Map();
const decorStack = []; // category 'decor' — stackable authored scenery (huts, crystals)
const fogLevelAt = new Map(); // "c,r" -> lowest level that covers it

for (const p of doc.placements) {
  const { col, row } = norm(p);
  const key = `${col},${row}`;
  if (p.category === 'tile') tileAt.set(key, p.asset);
  else if (p.category === 'decotile') decoAt.set(key, p.asset);
  else if (p.category === 'decor') decorStack.push({ name: p.asset, col, row, z: p.z ?? 0 });
  else if (p.category === 'blocker') {
    const lvl = p.level ?? 1;
    fogLevelAt.set(key, Math.min(fogLevelAt.get(key) ?? Infinity, lvl));
  }
}
// Stable back-to-front paint order: lower z first, then north-to-south.
decorStack.sort((a, b) => (a.z ?? 0) - (b.z ?? 0) || a.row + a.col - (b.row + b.col));

const cell = (key) => key.split(',').map(Number);
const tiles = [...tileAt.keys()].map(cell);
const deco = [...decoAt.keys()].map(cell);

// Group fog cells by level → one region per level.
const byLevel = new Map();
for (const [key, lvl] of fogLevelAt) {
  // a fog cell that also has a playable tile under it stays gated by the level.
  if (!byLevel.has(lvl)) byLevel.set(lvl, []);
  byLevel.get(lvl).push(cell(key));
}
const regions = [...byLevel.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([level, cells]) => ({
    id: `level_${level}`,
    /** unlocks when the Keeper reaches this level (or spends a key) */
    level,
    status: 'unlockable',
    cells
  }));

// Playable cells NOT under any fog = the level-1 starting clearing.
// Authoring convention: no cloud = level-1 zone; a cloud tagged level N gates
// the cells that become playable when the Keeper reaches level N.
const startCells = tiles.filter(([c, r]) => !fogLevelAt.has(`${c},${r}`));

// Per-LEVEL playable merge zone = the playable tiles unlocked AT that level
// (level 1 = the start clearing; level N = playable tiles under a level-N cloud).
const playZoneByLevel = new Map([[1, startCells]]);
for (const [c, r] of tiles) {
  const lvl = fogLevelAt.get(`${c},${r}`);
  if (lvl === undefined) continue; // already counted in the level-1 start clearing
  if (!playZoneByLevel.has(lvl)) playZoneByLevel.set(lvl, []);
  playZoneByLevel.get(lvl).push([c, r]);
}
const playZones = [...playZoneByLevel.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([level, cells]) => ({ level, cells }));

// Camera keyframes (focal cell + world point + zoom), normalised onto the grid.
const cameraKeyframes = (doc.cameraKeyframes ?? []).map((kf) => ({
  level: kf.level,
  focus: kf.focus ? { col: kf.focus.col - minC, row: kf.focus.row - minR } : undefined,
  world: kf.world,
  zoom: kf.zoom
}));

const out = {
  format: 'emberkeep-gamemap',
  version: 1,
  source: inPath,
  tile: doc.tile, // { width, height }
  cols: maxC - minC + 1,
  rows: maxR - minR + 1,
  /** per-asset calibration so the renderer can place real tile art exactly */
  calibration: calibByKey,
  playable: tiles,        // [col,row] cells that are part of the board
  decorative: deco,       // [col,row] non-playable ground
  decor: decorStack,      // { name, col, row, z } — stackable authored scenery
  startClearing: startCells,
  playZones,              // { level, cells } — the merge zone unlocked at each level
  fogRegions: regions,    // { id, level, status, cells }
  cameraKeyframes,        // { level, focus:{col,row}, world:{x,y}, zoom } — level-up framing
  tilesByCell: Object.fromEntries(tileAt),
  decoByCell: Object.fromEntries(decoAt)
};

writeFileSync(outPath, JSON.stringify(out, null, 2));

console.log(`Ingested ${inPath} → ${outPath}`);
console.log(`  grid: ${out.cols} × ${out.rows} (normalised from cols ${minC}..${maxC}, rows ${minR}..${maxR})`);
console.log(`  playable tiles: ${tiles.length}  ·  decorative: ${deco.length}  ·  decor scenery: ${decorStack.length}`);
for (const d of decorStack) console.log(`    decor ${d.name} @ (${d.col},${d.row}) z${d.z}`);
for (const z of playZones) console.log(`  play zone L${z.level}: ${z.cells.length} playable tiles unlock`);
for (const r of regions) console.log(`  fog ${r.id}: ${r.cells.length} cells (unlock at level ${r.level})`);
console.log(`  camera keyframes: ${cameraKeyframes.map((k) => `L${k.level}@(${k.focus?.col},${k.focus?.row})z${k.zoom}`).join(', ')}`);
