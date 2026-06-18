/**
 * world-map.json  →  src/data/map.json  (the authored game map the engine runs).
 *
 * Produces the full 51×24 board: per-LEVEL regions gated by Keeper level, the
 * tutorial's start clearing + key-gated fog pocket re-anchored into the L1 zone
 * (offset +1,+4 so the tutorial centres on the authored L1 camera focus 4,7),
 * seeded merge clusters in each higher zone, and the rendering data the board
 * needs (per-cell tile art + calibration + camera keyframes).
 *
 *   node scripts/build-gamemap.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const world = JSON.parse(readFileSync('src/data/world-map.json', 'utf8'));

const key = (c, r) => `${c},${r}`;

/* ---- Level 1 start: three red Dragon Eggs in the clearing. Merging them
 *      hatches the first dragon; everything after (gem shards, flame gems, the
 *      key) is earned through the scripted tutorial (see tutorial.json). ---- */
const TUT_START_ITEMS = [
  { chain: 'ember_dragon', tier: 1, at: [3, 3] },
  { chain: 'ember_dragon', tier: 1, at: [4, 3] },
  { chain: 'ember_dragon', tier: 1, at: [3, 4] }
];
// Five logs sit in the L1 clearing at new game (NO house pre-placed): merging
// the 5 (lumber chain, 5→1) builds the first House, a coins/xp/energy generator.
const WOOD_COUNT = 5;

const dist2 = ([c, r], f) => (c - f.col) ** 2 + (r - f.row) ** 2;
const nearestTo = (cells, f, n) => [...cells].sort((a, b) => dist2(a, f) - dist2(b, f)).slice(0, n);

const SEED = [
  ['sparkweed', 1], ['sparkweed', 1], ['sparkweed', 1],
  ['ember_dragon', 1], ['ember_dragon', 1], ['ember_dragon', 1],
  ['flame_gem', 1], ['flame_gem', 1], ['flame_gem', 1]
];
const focusByLevel = Object.fromEntries(
  (world.cameraKeyframes ?? []).filter((k) => k.focus).map((k) => [k.level, k.focus])
);
const GATE_SIZE = 12; // authored level-2 cloud cells nearest L1 = the tutorial's key gate

/* ----------------------------- regions -----------------------------
 * EVERY fogged cell is an authored cloud-blocker from the world JSON — nothing
 * is invented. The tutorial's "spend a key to clear the fog" lesson clears a
 * small cluster (`level_2_gate`) of the level-2 clouds nearest the start; the
 * rest of level 2 (and levels 3–4) lift on reaching that Keeper level.
 */
const clearing = world.startClearing.map(([c, r]) => [c, r]);
const regions = [{ id: 'level_1', status: 'active', tiles: clearing }];
let gateTapCell = null, gateNestCell = null;

/* ---- L1 anchor: where the tutorial cluster + dragon sit. Use the authored L1
 * camera focus if the export carries one; otherwise the ACTUAL clearing's
 * centroid (snapped to a real clearing cell). This keeps the start cluster on
 * the isle for ANY imported map — never the old hard-coded (4,7). The board
 * camera frames this same centroid when no keyframe exists, so it stays on-screen. */
const centroidCell = (cells) => {
  const c = cells.reduce((s, [x]) => s + x, 0) / cells.length;
  const r = cells.reduce((s, [, y]) => s + y, 0) / cells.length;
  return nearestTo(cells, { col: c, row: r }, 1)[0] ?? [Math.round(c), Math.round(r)];
};
const L1_FOCUS = focusByLevel[1] ?? (([c, r]) => ({ col: c, row: r }))(centroidCell(clearing));

for (const zone of world.playZones) {
  if (zone.level === 1) continue;
  const cells = zone.cells.map(([c, r]) => [c, r]);
  const focus = focusByLevel[zone.level] ?? {
    col: Math.round(cells.reduce((s, [c]) => s + c, 0) / cells.length),
    row: Math.round(cells.reduce((s, [, r]) => s + r, 0) / cells.length)
  };

  if (zone.level === 2) {
    // Carve the key-gate from THIS zone's authored clouds nearest the start.
    const gateCells = nearestTo(cells, L1_FOCUS, GATE_SIZE);
    const gateSet = new Set(gateCells.map(([c, r]) => key(c, r)));
    const restCells = cells.filter(([c, r]) => !gateSet.has(key(c, r)));
    const eg = gateCells; // closest-first
    gateTapCell = eg[0];
    gateNestCell = eg[3];
    regions.push({
      id: 'level_2_gate',
      status: 'unlockable',
      unlock: { keys: 1, level: 2 }, // key it open in the tutorial, or it lifts at L2 anyway
      tiles: gateCells,
      contents: [
        { chain: 'ember_dragon', tier: 1, at: eg[0] },
        { chain: 'ember_dragon', tier: 1, at: eg[1] },
        { chain: 'ember_dragon', tier: 1, at: eg[2] }
      ],
      decor: [{ decor: 'nest', at: eg[3] }]
    });
    // Seed the zone, plus the Ancient Tree (produces 1 wood / 10 min → 5 = House).
    const restSeed = nearestTo(restCells, focus, SEED.length + 1);
    const l2Contents = SEED.map(([chain, tier], i) => ({ chain, tier, at: restSeed[i] }));
    const treeCell = restSeed[SEED.length];
    if (treeCell) l2Contents.push({ chain: 'bigtree', tier: 1, at: treeCell });
    regions.push({
      id: 'level_2',
      status: 'unlockable',
      unlock: { level: 2 },
      tiles: restCells,
      contents: l2Contents
    });
  } else {
    const seedCells = nearestTo(cells, focus, SEED.length);
    regions.push({
      id: `level_${zone.level}`,
      status: 'unlockable',
      unlock: { level: zone.level },
      tiles: cells,
      contents: SEED.map(([chain, tier], i) => ({ chain, tier, at: seedCells[i] }))
    });
  }
}

/* ----------------------- tutorial start placement -----------------------
 * Lay the start items into a CONNECTED blob of clearing cells, BFS-grown from
 * L1_FOCUS. Adjacency matters: drop-onto-merge needs the cluster's pieces to be
 * orthogonal neighbours, and BFS guarantees that for any imported map (a plain
 * "nearest N" scatters them into un-mergeable singletons). */
const clearingSet = new Set(clearing.map(([c, r]) => key(c, r)));
const focusCell = nearestTo(clearing, L1_FOCUS, 1)[0] ?? [L1_FOCUS.col, L1_FOCUS.row];

/** BFS a contiguous blob of `count` clearing cells from `start`, skipping any in
 *  `excludeSet`. Adjacency matters: drop-onto-merge needs orthogonal neighbours. */
function growBlob(start, count, excludeSet) {
  const out = [];
  const seen = new Set([key(...start)]);
  const queue = [start];
  while (queue.length > 0 && out.length < count) {
    const [c, r] = queue.shift();
    if (clearingSet.has(key(c, r)) && !excludeSet.has(key(c, r))) out.push([c, r]);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nb = [c + dc, r + dr];
      if (!seen.has(key(...nb))) { seen.add(key(...nb)); queue.push(nb); }
    }
  }
  return out;
}

const eggBlob = growBlob(focusCell, TUT_START_ITEMS.length, new Set());
const eggSet = new Set(eggBlob.map(([c, r]) => key(c, r)));
// A separate wood cluster a couple of cells south-east of the eggs.
const woodStart =
  nearestTo(clearing.filter(([c, r]) => !eggSet.has(key(c, r))), { col: L1_FOCUS.col + 2, row: L1_FOCUS.row + 2 }, 1)[0] ??
  focusCell;
const woodBlob = growBlob(woodStart, WOOD_COUNT, eggSet);

const startingItems = [
  ...TUT_START_ITEMS.map((x, i) => ({ chain: x.chain, tier: x.tier, at: eggBlob[i] ?? focusCell })),
  ...Array.from({ length: WOOD_COUNT }, (_, i) => ({
    chain: 'lumber',
    tier: 1,
    at: woodBlob[i] ?? woodStart
  }))
];

// No pre-placed dragon: the dragon is EARNED by merging 3 eggs (the hatch
// mechanic), so seeding a guardian decor at new-game was confusing. The decor
// pipeline still works — to drop a static landmark dragon back in, add e.g.
//   { decor: 'dragon', at: snapToFreeClearing([L1_FOCUS.col, L1_FOCUS.row - 3]) }
const startingDecor = [];

/* --------------------------- camera keyframes --------------------------- */
// Frame one view per LEVEL so the board glides to each zone on unlock. Honour
// keyframes the world builder authored (🎥 panel); otherwise derive a focus from
// each play-zone's centroid so framing works for ANY imported map. The game uses
// `focus` (it computes its own zoom from the zone spread); world/zoom are kept
// for the world-builder round-trip.
const { width: TW, height: TH } = world.tile;
const worldOf = ([c, r]) => ({ x: Math.round((c - r) * TW / 2), y: Math.round((c + r) * TH / 2) });
const cameraKeyframes = world.cameraKeyframes?.length
  ? world.cameraKeyframes
  : world.playZones
      .map((z) => {
        const [fc, fr] = centroidCell(z.cells);
        return { level: z.level, focus: { col: fc, row: fr }, world: worldOf([fc, fr]), zoom: 0.5 };
      })
      .sort((a, b) => a.level - b.level);

/* --------------------------- rendering data --------------------------- */
// Per-asset calibration keyed by the bare tile name (drop the "tile|" prefix).
const calibration = {};
for (const [k, v] of Object.entries(world.calibration)) {
  if (k.startsWith('tile|')) calibration[k.slice(5)] = v;
}

/* Static authored scenery (world-builder `decor`): huts, crystals, landmarks.
 * Slug names to safe texture keys (`decor_<slug>`, matching extract-decor.mjs)
 * and carry per-asset calibration so the renderer places each PNG exactly. */
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const decorCalibration = {};
for (const [k, v] of Object.entries(world.calibration)) {
  if (k.startsWith('decor|')) decorCalibration[slug(k.slice(6))] = v;
}
// Houses/huts are now EARNED gameplay (merge 5 wood → House), so any hut/house
// authored as world-builder scenery is dropped — nothing house-shaped is
// pre-placed. Other scenery (e.g. crystals) still flows through.
const mapDecor = (world.decor ?? [])
  .map((d) => ({ name: slug(d.name), col: d.col, row: d.row, z: d.z ?? 0 }))
  .filter((d) => !/hut|house|maison/.test(d.name));

const map = {
  cols: world.cols,
  rows: world.rows,
  tile: world.tile, // { width, height } authored tile footprint
  regions,
  startingItems,
  startingDecor,
  // rendering: which tile art sits on each playable cell + how to place it.
  playable: world.playable,
  tilesByCell: world.tilesByCell,
  calibration,
  mapDecor,
  decorCalibration,
  cameraKeyframes
};

writeFileSync('src/data/map.json', JSON.stringify(map, null, 2));

console.log('Wrote src/data/map.json');
console.log(`  grid ${map.cols}×${map.rows} · ${world.playable.length} playable tiles`);
for (const r of regions) {
  const gate = r.unlock?.keys ? ` (key gate)` : r.unlock?.level ? ` (unlock@L${r.unlock.level})` : ' (active)';
  console.log(`  ${r.id}: ${r.tiles.length} tiles${gate}, ${(r.contents ?? []).length} items, ${(r.decor ?? []).length} decor`);
}
console.log(`  startingItems: ${map.startingItems.length} (snapped onto L1 clearing @ focus ${L1_FOCUS.col},${L1_FOCUS.row})`);
console.log(`  startingDecor: ${startingDecor.length} (dragon now earned via the 3-egg hatch, not pre-placed)`);
console.log(`  mapDecor: ${mapDecor.length} static scenery (${mapDecor.map((d) => `${d.name}@${d.col},${d.row}`).join(' ') || 'none'}) — run extract-decor.mjs for the art`);
console.log(`  cameraKeyframes: ${cameraKeyframes.length} (${cameraKeyframes.map((k) => `L${k.level}@${k.focus.col},${k.focus.row}`).join(' ')})`);
console.log(`  >> tutorial key-gate: tap cell [${gateTapCell}] · nest at [${gateNestCell}] (use these in tutorial.json + e2e)`);
