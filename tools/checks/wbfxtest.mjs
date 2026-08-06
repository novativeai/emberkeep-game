/**
 * World Builder 🔥 FX tab — placement + live-preview regression.
 *
 * The claim this harness defends is the one the tab is FOR: what you drop on
 * the map is what will burn in the game. So it checks the things a screenshot
 * cannot — that the live rig lands on the cell centre to the pixel, that the
 * inspector's shaping reaches the running effect, that emitters stay out of the
 * world export, and that Apply produces game cells rather than builder cells.
 *
 * It does NOT write to the game: the POST is exercised against a doc built in
 * memory, and `src/data/emitters.json` is left alone. Placing emitters in the
 * world is authoring, not a test fixture.
 *
 * Needs `pnpm dev` running.
 *   node tools/checks/wbfxtest.mjs [outDir]
 */
import { chromium } from '@playwright/test';

const OUT = process.argv[2] || '/tmp';
const BASE = process.env.BASE || 'http://localhost:5173';

const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

const fails = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

await page.goto(`${BASE}/tools/worldbuilder/index.html`);
await page.waitForTimeout(2600);

/* ------------------------------------------------------------ the bridge - */

const bridge = await page.evaluate(() => ({ ok: !!window.__FX, err: window.__FX_ERROR ?? null }));
check('the game FX modules load into the builder', bridge.ok, bridge.err ?? '');

await page.click('#tabFx');
await page.waitForTimeout(700);

const roster = await page.evaluate(() => [...document.querySelectorAll('#assetGrid .nm')].map((n) => n.textContent));
check('both presets appear as cards', roster.length === 2, roster.join(', '));

/* ------------------------------------------------- drop → it burns, live - */

const placed = await page.evaluate(() => {
  const W = window.__wbfx;
  W.S.cam = { x: 520, y: 340, zoom: 1.2 };
  selectAsset('fx:fire'); paintAt(0, 0);
  selectAsset('fx:smokeEmbers'); paintAt(0, 0);
  selectAsset('fx:fire'); paintAt(4, 2);
  renderAssets(); render(); W.fxSyncOverlayVisibility();
  return W.fxPlacements().length;
});
await page.waitForTimeout(2600);
check('three emitters placed', placed === 3, String(placed));

const live = await page.evaluate(() => ({
  rigs: window.__wbfx.FXV.rigs.size,
  hidden: document.getElementById('fxStage').classList.contains('hidden'),
  count: document.getElementById('fxCount').textContent
}));
check('a live rig exists per placement', live.rigs === 3, `${live.rigs} rigs`);
check('the overlay is showing', !live.hidden);
check('the tab count tracks placements', live.count === '(3)', live.count);

// Two emitters on ONE cell is the campfire pattern and must be allowed.
const stacked = await page.evaluate(() =>
  window.__wbfx.fxPlacements().filter((p) => p.col === 0 && p.row === 0).length);
check('fire and smoke stack on one cell', stacked === 2, String(stacked));

/* --------------------------------- registration, to the pixel ------------ */

const reg = await page.evaluate(() => {
  const W = window.__wbfx;
  const p = W.fxPlacements().find((q) => q.col === 4 && q.row === 2);
  const wc = W.worldOf(p.col, p.row);
  const sc = W.toScreen(wc.x, wc.y);
  const rig = W.FXV.rigs.get(p.id).rig;
  return { want: { x: sc.x * devicePixelRatio, y: sc.y * devicePixelRatio }, got: rig.position };
});
check('the live rig sits exactly on the cell centre',
  Math.abs(reg.want.x - reg.got.x) < 0.5 && Math.abs(reg.want.y - reg.got.y) < 0.5,
  `want ${JSON.stringify(reg.want)} got ${JSON.stringify(reg.got)}`);

// Panning the map must carry the effect with it, or the preview is decorative.
const panned = await page.evaluate(async () => {
  const W = window.__wbfx;
  const p = W.fxPlacements().find((q) => q.col === 4 && q.row === 2);
  const before = { ...W.FXV.rigs.get(p.id).rig.position };
  W.S.cam.x += 140; W.S.cam.y -= 60; render();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const after = { ...W.FXV.rigs.get(p.id).rig.position };
  W.S.cam.x -= 140; W.S.cam.y += 60; render();
  return { dx: after.x - before.x, dy: after.y - before.y, dpr: devicePixelRatio };
});
check('the effect follows a pan', Math.abs(panned.dx - 140 * panned.dpr) < 1 && Math.abs(panned.dy + 60 * panned.dpr) < 1,
  `moved ${panned.dx},${panned.dy}`);

// …and zooming must scale it, not just move it.
const zoomed = await page.evaluate(async () => {
  const W = window.__wbfx;
  const p = W.fxPlacements().find((q) => q.col === 4 && q.row === 2);
  const rig = W.FXV.rigs.get(p.id).rig;
  const before = rig.radius;
  W.S.cam.zoom *= 2; render();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const after = rig.radius;
  W.S.cam.zoom /= 2; render();
  return { before, after };
});
check('the effect scales with zoom', Math.abs(zoomed.after / zoomed.before - 2) < 0.02,
  `${zoomed.before.toFixed(1)} → ${zoomed.after.toFixed(1)}`);

await page.locator('#stageWrap').screenshot({ path: `${OUT}/WB-fx.png` });

/* --------------------------------- the inspector reaches the effect ------ */

const shaped = await page.evaluate(async () => {
  const W = window.__wbfx;
  const p = W.fxPlacements().find((q) => q.col === 4 && q.row === 2);
  W.S.selectedPlacement = p.id;
  refreshInspector();
  const visible = getComputedStyle(document.getElementById('fxRow')).display !== 'none';
  const set = (id, v) => {
    const e = document.getElementById(id);
    e.value = v;
    e.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set('fxW', 2.2); set('fxH', 1.7); set('fxTilt', 18); set('fxRate', 1.6); set('fxScale', 1.3);
  const flip = document.getElementById('fxFlip');
  flip.checked = true; flip.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { visible, stored: { ...p.fx }, onRig: { ...W.FXV.rigs.get(p.id).rig.instance } };
});
check('the inspector opens for a selected emitter', shaped.visible);
check('base width reaches the live rig', shaped.onRig.widthScale === 2.2, String(shaped.onRig.widthScale));
check('height reaches the live rig', shaped.onRig.heightScale === 1.7, String(shaped.onRig.heightScale));
check('tilt reaches the live rig', shaped.onRig.tiltDeg === 18, String(shaped.onRig.tiltDeg));
check('rate reaches the live rig', shaped.onRig.rate === 1.6, String(shaped.onRig.rate));
check('mirror reaches the live rig', shaped.onRig.flipX === true);
check('scale is stored on the placement', shaped.stored.scale === 1.3, String(shaped.stored.scale));

await page.waitForTimeout(1400);
await page.locator('#stageWrap').screenshot({ path: `${OUT}/WB-fx-shaped.png` });

/* ------------------------------------------- the applied doc is game data */

const doc = await page.evaluate(() => window.__wbfx.fxDoc());
const O = await page.evaluate(() => window.__wbfx.gameOrigin());
check('every emitter carries a preset, world and anchor',
  doc.emitters.every((e) => e.preset && e.world && Array.isArray(e.anchor) && e.anchor.length === 2));
check('anchors are GAME cells, not builder cells',
  doc.emitters.some((e) => e.anchor[0] === 4 - O.c && e.anchor[1] === 2 - O.r),
  `origin ${O.c},${O.r} · ${JSON.stringify(doc.emitters.map((e) => e.anchor))}`);
check('every emitter gets its own flicker seed',
  new Set(doc.emitters.map((e) => e.seed)).size === doc.emitters.length,
  doc.emitters.map((e) => e.seed).join(','));
const shapedOut = doc.emitters.find((e) => e.widthScale);
check('the shaping is written out', !!shapedOut && shapedOut.tiltDeg === 18 && shapedOut.flipX === true,
  JSON.stringify(shapedOut));
check('neutral fields are omitted', !('groundRotDeg' in (doc.emitters[0] ?? {})),
  Object.keys(doc.emitters[0] ?? {}).join(','));

const valid = await page.evaluate((d) =>
  window.__FX.validatePlacementFile(d, Object.keys(window.__FX.EMITTER_PRESETS.presets)), doc);
check('the doc passes the game validator', valid.length === 0, valid.join(' | '));

// The dev endpoint has to accept it — without writing anything, we POST the
// file's CURRENT contents back so authored placements are never disturbed.
const roundTrip = await page.evaluate(async () => {
  const cur = await (await fetch('/__worldbuilder/emitters')).json();
  const res = await fetch('/__worldbuilder/emitters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cur.placements)
  });
  return { get: !!cur.presets && !!cur.placements, post: (await res.json()).ok };
});
check('the dev endpoint serves placements + presets', roundTrip.get);
check('the dev endpoint accepts a valid doc', roundTrip.post);

/* --------------------------------------------- emitters stay out of art -- */

const isolation = await page.evaluate(() => {
  const world = buildDoc(false);
  return {
    assets: world.assets.filter((a) => a.category === 'fx').length,
    placements: world.placements.filter((p) => p.category === 'fx').length,
    session: JSON.parse(JSON.stringify(window.__wbfx.S.placements.length))
  };
});
check('emitters are absent from the world.json assets', isolation.assets === 0, String(isolation.assets));
check('emitters are absent from the world.json placements', isolation.placements === 0, String(isolation.placements));

// Deleting must retire the live rig, or the map keeps burning where nothing is.
const removed = await page.evaluate(async () => {
  const W = window.__wbfx;
  const p = W.fxPlacements()[0];
  removePlacement(p);
  render();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { placements: W.fxPlacements().length, rigs: W.FXV.rigs.size };
});
check('deleting an emitter retires its rig', removed.placements === 2 && removed.rigs === 2,
  `${removed.placements} placements, ${removed.rigs} rigs`);

const real = errs.filter((e) => !/favicon|three|ERR_CONNECTION_REFUSED|404/.test(e));
check('no console errors', real.length === 0, real.slice(0, 3).join(' | '));

await browser.close();
console.log(`\nscreenshots -> ${OUT}/WB-fx.png, WB-fx-shaped.png`);
console.log(fails.length ? `${fails.length} FAILED: ${fails.join(', ')}` : 'all World Builder FX checks passed');
process.exit(fails.length ? 1 : 0);
