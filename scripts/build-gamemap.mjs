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

/* ----------------------- tutorial cluster + decor placement -----------------------
 * Place the hand-authored start items by SNAPPING the cluster onto free clearing
 * cells around L1_FOCUS — never a fixed +1,+4 offset (that only matched the old
 * map and floated the items off any re-imported isle). Each item keeps its
 * relative position to the cluster centre, then snaps to the nearest unused
 * clearing cell, so all items + the dragon always land on the active L1 isle. */
const usedCells = new Set();
const snapToFreeClearing = (target) => {
  const t = { col: target[0], row: target[1] };
  const sorted = [...clearing].sort((a, b) => dist2(a, t) - dist2(b, t));
  for (const cell of sorted) {
    const k = key(cell[0], cell[1]);
    if (!usedCells.has(k)) { usedCells.add(k); return cell; }
  }
  return target; // clearing smaller than the cluster (shouldn't happen)
};
const clusterCentre = (() => {
  const c = TUT_START_ITEMS.reduce((s, x) => s + x.at[0], 0) / TUT_START_ITEMS.length;
  const r = TUT_START_ITEMS.reduce((s, x) => s + x.at[1], 0) / TUT_START_ITEMS.length;
  return { col: c, row: r };
})();
const placeOnClearing = ([c, r]) =>
  snapToFreeClearing([
    Math.round(L1_FOCUS.col + (c - clusterCentre.col)),
    Math.round(L1_FOCUS.row + (r - clusterCentre.row))
  ]);
const startingItems = TUT_START_ITEMS.map((x) => ({ chain: x.chain, tier: x.tier, at: placeOnClearing(x.at) }));

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
console.log(`  cameraKeyframes: ${cameraKeyframes.length} (${cameraKeyframes.map((k) => `L${k.level}@${k.focus.col},${k.focus.row}`).join(' ')})`);
console.log(`  >> tutorial key-gate: tap cell [${gateTapCell}] · nest at [${gateNestCell}] (use these in tutorial.json + e2e)`);
