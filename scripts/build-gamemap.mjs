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

const [OC, OR] = [1, 4]; // tutorial → L1-zone offset (centres on camera focus 4,7)
const off = ([c, r]) => [c + OC, r + OR];
const key = (c, r) => `${c},${r}`;

/* ---- the hand-authored tutorial start items (from the original 8×8), offset ---- */
const TUT_START_ITEMS = [
  { chain: 'sparkweed', tier: 1, at: [1, 2] },
  { chain: 'sparkweed', tier: 1, at: [1, 3] },
  { chain: 'sparkweed', tier: 1, at: [3, 4] },
  { chain: 'sparkweed', tier: 1, at: [5, 1] },
  { chain: 'sparkweed', tier: 1, at: [5, 5] },
  { chain: 'ember_dragon', tier: 1, at: [2, 2] },
  { chain: 'ember_dragon', tier: 1, at: [3, 2] },
  { chain: 'ember_dragon', tier: 1, at: [4, 4] },
  { chain: 'flame_gem', tier: 1, at: [1, 5] },
  { chain: 'flame_gem', tier: 1, at: [2, 5] },
  { chain: 'flame_gem', tier: 1, at: [4, 2] },
  { chain: 'flame_gem', tier: 1, at: [5, 3] },
  { chain: 'flame_gem', tier: 1, at: [3, 1] }
];

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
const L1_FOCUS = focusByLevel[1] ?? { col: 4, row: 7 };
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
    const restSeed = nearestTo(restCells, focus, SEED.length);
    regions.push({
      id: 'level_2',
      status: 'unlockable',
      unlock: { level: 2 },
      tiles: restCells,
      contents: SEED.map(([chain, tier], i) => ({ chain, tier, at: restSeed[i] }))
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

/* --------------------------- rendering data --------------------------- */
// Per-asset calibration keyed by the bare tile name (drop the "tile|" prefix).
const calibration = {};
for (const [k, v] of Object.entries(world.calibration)) {
  if (k.startsWith('tile|')) calibration[k.slice(5)] = v;
}

const map = {
  cols: world.cols,
  rows: world.rows,
  tile: world.tile, // { width, height } authored tile footprint
  regions,
  startingItems: TUT_START_ITEMS.map((x) => ({ ...x, at: off(x.at) })),
  // rendering: which tile art sits on each playable cell + how to place it.
  playable: world.playable,
  tilesByCell: world.tilesByCell,
  calibration,
  cameraKeyframes: world.cameraKeyframes
};

writeFileSync('src/data/map.json', JSON.stringify(map, null, 2));

console.log('Wrote src/data/map.json');
console.log(`  grid ${map.cols}×${map.rows} · ${world.playable.length} playable tiles`);
for (const r of regions) {
  const gate = r.unlock?.keys ? ` (key gate)` : r.unlock?.level ? ` (unlock@L${r.unlock.level})` : ' (active)';
  console.log(`  ${r.id}: ${r.tiles.length} tiles${gate}, ${(r.contents ?? []).length} items, ${(r.decor ?? []).length} decor`);
}
console.log(`  startingItems: ${map.startingItems.length} (offset +${OC},+${OR})`);
console.log(`  >> tutorial key-gate: tap cell [${gateTapCell}] · nest at [${gateNestCell}] (use these in tutorial.json + e2e)`);
