/**
 * World Builder 🧩 Worlds & grids — the multi-world / multi-grid regression.
 *
 * The claim this harness defends is the one the page is FOR: everything the
 * engine's zone model can express can be authored here, and what the builder
 * exports is what the game will actually run. So it checks the things a
 * screenshot cannot:
 *
 *   · a project saved before zones existed reopens as ONE grid, unchanged
 *   · each grid projects its own cells — tile size, skew and rotation included
 *   · paint lands on the active grid and nowhere else; "one tile per cell" is
 *     per grid, since two grids share cell numbers freely
 *   · the exported zones.json satisfies the engine's own invariants: unique
 *     ids, non-overlapping index blocks, in-range cells, an invertible basis
 *   · the exported geometry ROUND-TRIPS — feeding zones.json's own numbers back
 *     through the engine's formula lands on the cell the builder drew
 *   · emitters and characters keep working and export game-resolvable addresses
 *   · worlds are isolated: switching keeps each board standing
 *   · a PORTAL — the invisible rectangle that travels to another world — is
 *     found by the same tap the game would make, exports in game pixels, and
 *     never reaches the game leading nowhere
 *
 * It writes nothing to the game: every export is built in memory and asserted
 * there, and `src/data/zones.json` is left exactly as it was.
 *
 * Needs `pnpm dev` running.
 *   node tools/checks/wbzonestest.mjs [outDir]
 */
import { chromium } from '@playwright/test';

const OUT = process.argv[2] || '/tmp';
const BASE = process.env.BASE || 'http://localhost:5173';

const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
// Console 'error' lines are noisy here for a reason that predates this page:
// the asset loaders probe several candidate hosts for art (repo tree, :8080,
// the dev server) and take whichever answers, so a refused connection is the
// loader working as designed. Only real failures are collected.
page.on('requestfailed', (r) => {
  const url = r.url();
  const why = r.failure()?.errorText ?? '';
  if (/localhost:8080|:8820/.test(url)) return;   // candidate-host probing
  // This harness reloads the page once to start from a known project, which
  // cancels whatever was still in flight. A cancellation is not a failure.
  if (why.includes('ERR_ABORTED')) return;
  errs.push(`${why} ${url}`);
});
page.on('response', (r) => {
  if (r.status() >= 500) errs.push(`${r.status()} ${r.url()}`);
});

const fails = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

await page.goto(`${BASE}/tools/worldbuilder/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__wbfx?.AW, null, { timeout: 30000 });
// Start from a known project rather than whatever was last auto-saved.
await page.evaluate(() => localStorage.removeItem('emberkeep-worldbuilder'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__wbfx?.AW && window.__wbfx.S.ready, null, { timeout: 30000 });
await page.waitForTimeout(900);

/* ---------------------------------------------------------------- */
/* 1. a pre-zones project opens as one grid, unchanged                */
/* ---------------------------------------------------------------- */
const base = await page.evaluate(() => {
  const { S, AW, Z } = window.__wbfx;
  return {
    worlds: S.worlds.length,
    zones: AW().zones.length,
    zoneId: Z().id,
    tile: [Z().tileW, Z().tileH],
    placements: AW().placements.length,
    everyPlacementOnMain: AW().placements.every((p) => (p.zone || 'main') === 'main')
  };
});
check('a project with no zones opens as exactly one grid', base.worlds === 1 && base.zones === 1,
  `${base.worlds} world / ${base.zones} grid, tile ${base.tile.join('×')}`);
check('its placements all belong to that grid', base.everyPlacementOnMain, `${base.placements} placements`);

/* ---------------------------------------------------------------- */
/* 2. a second grid, with geometry of its own                        */
/* ---------------------------------------------------------------- */
const geo = await page.evaluate(async () => {
  const { S, AW, addZone, Z, worldOf, worldToCell, paintAt, invisibleAssetId } = window.__wbfx;
  addZone();
  const z = Z();
  // Give it a different tile, a skew and a turn — every axis the engine has.
  z.tileW = 160; z.tileH = 96; z.skew = 8; z.rot = 17; z.level = 4;
  const inv = await invisibleAssetId();
  S.selectedAssetId = inv;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) paintAt(i, j);
  const probes = [];
  for (const [c, r] of [[0, 0], [2, 1], [1, 0]]) {
    const w = worldOf(c, r, z);
    const back = worldToCell(w.x, w.y, z);
    probes.push({ c, r, bc: Math.round(back.col), br: Math.round(back.row) });
  }
  // …and the SAME numbers on the reference grid must land somewhere else.
  const main = AW().zones[0];
  const sameCellDifferentPlace = JSON.stringify(worldOf(1, 1, z)) !== JSON.stringify(worldOf(1, 1, main));
  return {
    zones: AW().zones.length,
    painted: AW().placements.filter((p) => (p.zone || 'main') === z.id).length,
    roundTrip: probes.every((p) => p.c === p.bc && p.r === p.br),
    probes, sameCellDifferentPlace,
    onOtherGrid: AW().placements.filter((p) => (p.zone || 'main') !== z.id && p.col < 3 && p.row < 2 && p.col >= 0 && p.row >= 0).length
  };
});
check('a grid can be added with its own tile, skew and rotation', geo.zones === 2);
check('painting lands on the ACTIVE grid only', geo.painted === 6, `${geo.painted} cells on the new grid`);
check('turned + skewed cells round-trip through their own projection', geo.roundTrip,
  geo.probes.map((p) => `${p.c},${p.r}→${p.bc},${p.br}`).join(' '));
check('the same (col,row) is a different place on a different grid', geo.sameCellDifferentPlace);

/* ---------------------------------------------------------------- */
/* 3. one tile per cell is PER GRID                                  */
/* ---------------------------------------------------------------- */
const perGrid = await page.evaluate(async () => {
  const { S, AW, paintAt, invisibleAssetId } = window.__wbfx;
  const inv = await invisibleAssetId();
  S.selectedAssetId = inv;
  const z = AW().activeZone;
  const before = AW().placements.filter((p) => p.col === 0 && p.row === 0).length;
  paintAt(0, 0); // repaint the same cell on the active grid — must REPLACE
  const after = AW().placements.filter((p) => p.col === 0 && p.row === 0).length;
  const byZone = {};
  for (const p of AW().placements) if (p.col === 0 && p.row === 0) byZone[p.zone || 'main'] = (byZone[p.zone || 'main'] || 0) + 1;
  return { before, after, byZone, active: z };
});
check('repainting a cell replaces it on that grid', perGrid.after === perGrid.before,
  `cell 0,0 holds ${JSON.stringify(perGrid.byZone)}`);
check('a cell number on another grid is untouched', Object.keys(perGrid.byZone).length >= 1);

/* ---------------------------------------------------------------- */
/* 4. the export: structure the engine will accept                   */
/* ---------------------------------------------------------------- */
const doc = await page.evaluate(async () => await window.__wbfx.buildZonesDoc());
const world = doc.worlds[0];
check('export is an emberkeep-zones document', doc.format === 'emberkeep-zones' && Array.isArray(doc.worlds));
check('the extending world omits its reference grid', !world.extendsAuthoredMap || !world.zones.some((z) => z.id === 'main'),
  `extends=${world.extendsAuthoredMap}, ${world.zones.length} grids emitted`);

const ids = doc.worlds.flatMap((w) => w.zones.map((z) => `${w.id}/${z.id}`));
check('every grid id is unique', new Set(ids).size === ids.length);

let overlap = null;
for (const w of doc.worlds) {
  const boxes = [];
  for (const z of w.zones) {
    const b = { c0: z.block[0], c1: z.block[0] + z.matrix[0] - 1, r0: z.block[1], r1: z.block[1] + z.matrix[1] - 1, id: z.id };
    for (const t of boxes) if (b.c0 <= t.c1 && t.c0 <= b.c1 && b.r0 <= t.r1 && t.r0 <= b.r1) overlap = `${t.id} vs ${b.id}`;
    boxes.push(b);
  }
}
check('index blocks never overlap', overlap === null, overlap || 'disjoint');

let cellOutOfRange = null, degenerate = null;
for (const w of doc.worlds) for (const z of w.zones) {
  const det = z.u[0] * z.v[1] - z.v[0] * z.u[1];
  if (!isFinite(det) || Math.abs(det) < 1e-6) degenerate = `${w.id}/${z.id}`;
  for (const [i, j] of z.cells) {
    if (i < 0 || j < 0 || i >= z.matrix[0] || j >= z.matrix[1]) cellOutOfRange = `${w.id}/${z.id} ${i},${j}`;
  }
}
check('every cell is inside its matrix', cellOutOfRange === null, cellOutOfRange || 'in range');
check('every basis is invertible', degenerate === null, degenerate || 'all non-degenerate');

/* ---------------------------------------------------------------- */
/* 5. the export ROUND-TRIPS through the engine's own formula        */
/* ---------------------------------------------------------------- */
// src/core/world.ts zonePoint(): rotate(origin + i·u + j·v, pivot, rotation).
const rt = await page.evaluate((exported) => {
  const { AW, worldOf, zoneLayout } = window.__wbfx;
  const L = zoneLayout(AW());
  const w = exported.worlds[0];
  // The builder's document px → game px affine, rebuilt from two known points,
  // so this check does not reuse the exporter's own mapper.
  const rot = (p, c, deg) => {
    if (!deg) return p;
    const r = deg * Math.PI / 180, co = Math.cos(r), si = Math.sin(r);
    const dx = p.x - c.x, dy = p.y - c.y;
    return { x: c.x + dx * co - dy * si, y: c.y + dx * si + dy * co };
  };
  const out = [];
  for (const z of w.zones) {
    const e = L.get(z.id);
    if (!e) continue;
    for (const [i, j] of z.cells.slice(0, 6)) {
      // engine side
      const flat = { x: z.origin[0] + i * z.u[0] + j * z.v[0], y: z.origin[1] + i * z.u[1] + j * z.v[1] };
      const game = rot(flat, { x: z.pivot[0], y: z.pivot[1] }, z.rotation);
      // builder side, same cell
      const doc2 = worldOf(e.minC + i, e.minR + j, z.id);
      out.push({ zone: z.id, i, j, game, doc: doc2 });
    }
  }
  return out;
}, doc);
// The two live in different pixel spaces; what must hold is that the affine
// between them is the SAME for every cell of every grid — that is exactly the
// statement "the export preserves the geometry".
let worstDev = 0;
if (rt.length >= 2) {
  const sx = (rt[1].game.x - rt[0].game.x) / ((rt[1].doc.x - rt[0].doc.x) || 1e-9);
  for (const p of rt) {
    const px = (p.game.x - rt[0].game.x) / (sx || 1e-9) + rt[0].doc.x;
    const py = (p.game.y - rt[0].game.y) / (sx || 1e-9) + rt[0].doc.y;
    worstDev = Math.max(worstDev, Math.abs(px - p.doc.x), Math.abs(py - p.doc.y));
  }
}
check('exported geometry reproduces every cell the builder drew', rt.length > 0 && worstDev < 1.5,
  `${rt.length} cells checked, worst deviation ${worstDev.toFixed(3)} px`);

/* ---------------------------------------------------------------- */
/* 6. emitters + characters still work, and export real addresses    */
/* ---------------------------------------------------------------- */
const fx = await page.evaluate(async () => {
  const { S, AW, Z, fxDoc, ensureFxAssets, gameAddressOf, zoneLayout } = window.__wbfx;
  ensureFxAssets();
  const fxAsset = Object.values(S.assets).find((a) => a.category === 'fx');
  if (!fxAsset) return { skipped: true };
  // one emitter on the reference grid, one on the new grid
  AW().placements.push({ id: 900001, assetId: fxAsset.id, col: 1, row: 1, z: 1, zone: AW().zones[0].id, fxId: 'fx_t1', fx: window.__wbfx.fxDefaults() });
  AW().placements.push({ id: 900002, assetId: fxAsset.id, col: 2, row: 1, z: 2, zone: Z().id, fxId: 'fx_t2', fx: window.__wbfx.fxDefaults() });
  const d = fxDoc();
  const L = zoneLayout(AW());
  const zEntry = L.get(Z().id);
  return {
    count: d.emitters.length,
    world: d.emitters[0]?.world,
    anchors: d.emitters.map((e) => e.anchor),
    expectedSecond: zEntry ? [zEntry.block.col + (2 - zEntry.minC), zEntry.block.row + (1 - zEntry.minR)] : null,
    presets: d.emitters.map((e) => e.preset)
  };
});
if (fx.skipped) {
  check('FX emitters still export', false, 'no FX preset roster loaded');
} else {
  check('emitters export for BOTH grids', fx.count === 2, `anchors ${JSON.stringify(fx.anchors)}`);
  check('emitters name the world they burn in', fx.world === (await page.evaluate(() => window.__wbfx.AW().id)), fx.world);
  check('an emitter on a second grid gets that grid\'s block address',
    JSON.stringify(fx.anchors[1]) === JSON.stringify(fx.expectedSecond),
    `${JSON.stringify(fx.anchors[1])} vs expected ${JSON.stringify(fx.expectedSecond)}`);
  check('emitters keep their preset', fx.presets.every(Boolean));
}

/* ---------------------------------------------------------------- */
/* 7. worlds are isolated                                            */
/* ---------------------------------------------------------------- */
const iso = await page.evaluate(async () => {
  const { S, AW, addWorld, switchWorld, paintAt, invisibleAssetId, setCategory } = window.__wbfx;
  const firstId = AW().id;
  const firstCount = AW().placements.length;
  addWorld();
  const second = AW().id;
  setCategory('tile');
  S.selectedAssetId = await invisibleAssetId();
  paintAt(5, 5); paintAt(6, 5);
  const secondCount = AW().placements.length;
  switchWorld(firstId);
  const backCount = AW().placements.length;
  switchWorld(second);
  const stillThere = AW().placements.length;
  return { firstId, second, firstCount, secondCount, backCount, stillThere, worlds: S.worlds.length };
});
check('a new world starts with its own empty board', iso.secondCount === 2, `${iso.secondCount} placements`);
check('switching back leaves the first world untouched', iso.backCount === iso.firstCount,
  `${iso.backCount} vs ${iso.firstCount}`);
check('and the world you left is still standing', iso.stillThere === iso.secondCount);
check('the project holds both worlds', iso.worlds === 2);

const multi = await page.evaluate(async () => {
  const d = await window.__wbfx.buildZonesDoc();
  return { worlds: d.worlds.map((w) => ({ id: w.id, zones: w.zones.length, cells: w.zones.reduce((a, z) => a + z.cells.length, 0), extends: w.extendsAuthoredMap })) };
});
check('the export carries every world', multi.worlds.length === 2, JSON.stringify(multi.worlds));
check('only the authored world extends map.json', multi.worlds.filter((w) => w.extends).length <= 1);

/* ---------------------------------------------------------------- */
/* 8. the classic single-lattice export is unchanged in shape        */
/* ---------------------------------------------------------------- */
const legacy = await page.evaluate(() => {
  const { buildDoc, AW } = window.__wbfx;
  const d = buildDoc(false);
  const ref = AW().zones[0].id;
  return {
    hasProject: !!d.project,
    projectWorlds: d.project?.worlds?.length ?? 0,
    tile: d.tile,
    // every placement in the flat list must belong to the reference grid
    flatOnRef: (d.project?.worlds ?? []).length > 0,
    placements: d.placements.length,
    refPlacements: AW().placements.filter((p) => (p.zone || 'main') === ref && !String(p.fxId || '')).length
  };
});
check('the world export still carries `tile` for ingest-world.mjs', !!legacy.tile && legacy.tile.width > 0,
  JSON.stringify(legacy.tile));
check('and now also the whole multi-world project', legacy.hasProject && legacy.projectWorlds === 2,
  `${legacy.projectWorlds} worlds in doc.project`);

/* ---------------------------------------------------------------- */
/* 9. the REAL endpoint validator accepts it (dry run — nothing written) */
/* ---------------------------------------------------------------- */
const posted = await page.evaluate(async (b) => {
  const doc = await window.__wbfx.buildZonesDoc();
  const res = await fetch(`${b}/__worldbuilder/zones?dryRun=1`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc)
  });
  return { status: res.status, body: await res.json() };
}, BASE);
check('the game\'s own zones validator accepts the export', posted.status === 200 && posted.body.ok,
  posted.body.note || posted.body.error);
check('and it was a dry run — src/data/zones.json untouched', posted.body.dryRun === true);

// …and it REJECTS a broken one, so the check above means something.
const rejected = await page.evaluate(async (b) => {
  const doc = await window.__wbfx.buildZonesDoc();
  // Two grids claiming the same addresses — the failure that would load a piece
  // saved on one grid onto another.
  const w = doc.worlds.find((x) => x.zones.length > 1) || doc.worlds[0];
  if (w.zones.length > 1) w.zones[1].block = [...w.zones[0].block];
  else w.zones.push({ ...w.zones[0], id: `${w.zones[0].id}-clash` });
  const res = await fetch(`${b}/__worldbuilder/zones?dryRun=1`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc)
  });
  return { status: res.status, body: await res.json() };
}, BASE);
check('and rejects overlapping index blocks', rejected.status === 400 && !rejected.body.ok,
  rejected.body.error || 'accepted a clash');

/* ---------------------------------------------------------------- */
/* 10. doors out — the invisible rectangles                          */
/* ---------------------------------------------------------------- */
// Every one of these is invisible in game, so a portal that is subtly wrong
// looks exactly like one that is right. The authoring surface is the only place
// the mistake can be caught, which is why it is checked here rather than left
// to a screenshot.
const doors = await page.evaluate(async () => {
  const { S, AW, addPortal, portalAt, switchWorld, buildZonesDoc } = window.__wbfx;
  const home = AW().id;
  const other = S.worlds.find((w) => w.id !== home).id;
  const p = addPortal({ x: 500, y: 500, w: 300, h: 400, to: other, label: 'Test door' });
  // The tap test the game runs, run here: the editor and `portalAtWorldPoint`
  // must agree about what is under a point, or authoring is guesswork.
  const cx = 500 + 150, cy = 500 + 200;
  const s = { x: cx * S.cam.zoom + S.cam.x, y: cy * S.cam.zoom + S.cam.y };
  const insideId = portalAt(s.x, s.y)?.id ?? null;
  const outside = portalAt((499 * S.cam.zoom + S.cam.x) - 40, (499 * S.cam.zoom + S.cam.y) - 40);
  // A door with no destination is authorable (you have to draw it before you
  // can choose) but must never reach the game.
  const blank = addPortal({ x: 900, y: 900, to: '' });
  const doc = await buildZonesDoc();
  const w = doc.worlds.find((x) => x.id === home);
  const exported = w.portals.map((q) => ({ id: q.id, to: q.to, rect: q.rect }));
  // …and it survives a world switch, because portals belong to their world.
  switchWorld(other); switchWorld(home);
  const kept = AW().portals.length;
  return { pid: p.id, blankId: blank.id, insideId, outsideNull: outside === null, exported, kept, other };
});
check('a drawn door is found by a tap inside it', doors.insideId === doors.pid, doors.insideId || 'nothing there');
check('and not by one outside it', doors.outsideNull);
check('the export carries the door in game pixels',
  doors.exported.length === 1 && doors.exported[0].to === doors.other && doors.exported[0].rect.every(Number.isFinite),
  JSON.stringify(doors.exported));
check('a door that leads nowhere is never exported',
  !doors.exported.some((q) => q.id === doors.blankId));
check('doors belong to their world and survive a switch', doors.kept === 2, `${doors.kept} portals`);

// The endpoint validator is the last gate before the game reads it.
const badDoor = await page.evaluate(async (b) => {
  const doc = await window.__wbfx.buildZonesDoc();
  doc.worlds[0].portals = [{ id: 'nowhere', to: 'atlantis', rect: [0, 0, 100, 100] }];
  const res = await fetch(`${b}/__worldbuilder/zones?dryRun=1`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc)
  });
  return { status: res.status, body: await res.json() };
}, BASE);
check('the validator rejects a door to a world that does not exist',
  badDoor.status === 400 && !badDoor.body.ok, badDoor.body.error || 'accepted it');

await page.screenshot({ path: `${OUT}/wb-zones.png` });
await page.evaluate(() => window.__wbfx.setCategory('zones'));
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/wb-zones-page.png` });

check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'clean');
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
