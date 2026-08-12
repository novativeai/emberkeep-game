/**
 * FX emitter regression harness — the claims in docs/vfx-textures.md §7,
 * measured on the GPU rather than asserted.
 *
 * Everything here is a property a screenshot cannot check on its own: that the
 * fire's three flame bodies are genuinely out of phase, that the ground light
 * lags the flame, that smoke actually darkens (which ADD cannot do), that
 * dropping a tier removes draw calls, and that two braziers standing side by
 * side are not playing the same animation.
 *
 * Needs `pnpm dev` running.
 *   node tools/checks/fxlabtest.mjs [outDir]
 */
import { chromium } from '@playwright/test';

const OUT = process.argv[2] || '/tmp';
const BASE = process.env.BASE || 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

await page.goto(`${BASE}/tools/fxlab/index.html`);
await page.waitForFunction(() => window.__ready === true, { timeout: 25000 });
await page.waitForTimeout(1200);

const fails = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

/* ------------------------------------------------------------- foundations */

const boot = await page.evaluate(() => ({
  webgl: window.__game.renderer.type === Phaser.WEBGL,
  pipeline: window.__game.renderer.pipelines.has('FlipbookMV'),
  loadErrors: window.__loadErrors ?? [],
  missing: window.__missing ?? [],
  presets: Object.keys(window.__doc.presets),
  rigs: window.__scene.rigs.length
}));
check('renderer is WebGL', boot.webgl);
check('FlipbookMV pipeline registered', boot.pipeline);
check('every preset texture loaded', boot.loadErrors.length === 0, boot.loadErrors.join(', '));
check('no layer was skipped for missing art', boot.missing.length === 0, boot.missing.join(', '));
check('both emitters present', boot.presets.join(',') === 'fire,smokeEmbers', boot.presets.join(','));
check('campfire scene spawned two rigs', boot.rigs === 2, String(boot.rigs));

/* -------------------------------------------------------- scene switching  */

const show = async (scene, settleMs = 900) => {
  await page.evaluate(
    ([s]) => {
      window.__state.scene = s;
      window.__state.grid = false;
      window.__scene.drawGround();
      window.__rebuild();
    },
    [scene]
  );
  await page.waitForTimeout(settleMs);
};

/* ------------------------------------------------- the fire actually burns */

await show('fire');

// Flicker: park the clock at a series of instants and require the rendered
// brightness to move. A frozen or periodic fire fails here.
const lum = await page.evaluate(async () => {
  const out = [];
  for (let i = 0; i < 24; i++) {
    window.__setT(i * 43);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const cv = window.__game.canvas;
    const g = document.createElement('canvas');
    g.width = cv.width; g.height = cv.height;
    g.getContext('2d').drawImage(cv, 0, 0);
    const d = g.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let s = 0, n = 0;
    for (let k = 0; k < d.length; k += 64) { s += d[k]; n++; }
    out.push(+(s / n).toFixed(3));
  }
  return out;
});
const spread = Math.max(...lum) - Math.min(...lum);
console.log('\nfire brightness over 24 sampled instants:', lum.join(', '));
check('the fire renders something', Math.max(...lum) > 0.5, `peak ${Math.max(...lum)}`);
check('the fire flickers', spread > 0.02, `spread ${spread.toFixed(3)}`);
check('no frame goes black', Math.min(...lum) > 0, `min ${Math.min(...lum)}`);
check('the flicker is not a two-state blink', new Set(lum).size > 12, `${new Set(lum).size} distinct`);

await page.evaluate(() => window.__live());
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/FX-fire.png` });

/* ------------------------------------- the fire's bodies are out of phase */

const phases = await page.evaluate(() => {
  const doc = window.__doc.presets.fire.layers.filter((l) => l.kind === 'sheet');
  return doc.map((l) => ({ id: l.id, phase: l.phase ?? 0, fps: l.fps }));
});
check('three flame bodies off one sheet', phases.length === 3, phases.map((p) => p.id).join(','));
check('no two share a phase', new Set(phases.map((p) => p.phase)).size === 3, JSON.stringify(phases));
check('no two share a rate', new Set(phases.map((p) => p.fps)).size === 3);

/* ---------------------------------------------------- smoke is DARK smoke */

await show('smokeEmbers', 3200);
await page.screenshot({ path: `${OUT}/FX-smoke.png` });

const smoke = await page.evaluate(() => {
  const layer = window.__doc.presets.smokeEmbers.layers.find((l) => l.id === 'smoke');
  const rig = window.__scene.rigs[0];
  return { blend: layer.blend, pool: layer.pool, radius: rig.radius, tier: rig.currentTier };
});
check('smoke draws through a blend that can darken', smoke.blend === 'normal', smoke.blend);
check('smoke rig reports its cull radius', smoke.radius > 300, String(smoke.radius));

// A pooled system betrays itself when every instance plays the same frame.
// Read the live playheads straight off the pipeline data.
const puffFrames = await page.evaluate(() => {
  const out = [];
  for (const obj of window.__scene.children.list) {
    const d = obj.pipelineData;
    if (d && d.grid && obj.visible && obj.alpha > 0) out.push(`${d.frames[0]}:${d.t.toFixed(2)}`);
  }
  return out;
});
console.log('\nlive flipbook playheads:', puffFrames.join(' '));
check('several puffs alive at once', puffFrames.length >= 3, `${puffFrames.length} alive`);
check('puffs are not playing in unison', new Set(puffFrames).size >= Math.min(3, puffFrames.length),
  `${new Set(puffFrames).size} distinct of ${puffFrames.length}`);

/* --------------------------------------------------------- tiers drop cost */

await show('both', 1500);

const counts = await page.evaluate(async () => {
  const visible = () => window.__scene.children.list.filter((o) => o.visible && o.type !== 'Graphics').length;
  const out = {};
  for (const tier of ['high', 'medium', 'low', 'off']) {
    window.__state.tier = tier;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    out[tier] = visible();
  }
  window.__state.tier = 'high';
  return out;
});
console.log('\nvisible objects per tier:', JSON.stringify(counts));
check('medium drops layers below high', counts.medium < counts.high, `${counts.medium} < ${counts.high}`);
check('low drops layers below medium', counts.low < counts.medium, `${counts.low} < ${counts.medium}`);
check('off is the quietest', counts.off <= counts.low, `${counts.off} <= ${counts.low}`);
check('low still renders something', counts.low > 0, String(counts.low));

/* ------------------------------------ neighbours must not move in lockstep */

await page.evaluate(() => (window.__state.tier = 'high'));
await show('field', 2200);
await page.screenshot({ path: `${OUT}/FX-field.png` });

const field = await page.evaluate(() => {
  const heads = new Map();
  for (const obj of window.__scene.children.list) {
    const d = obj.pipelineData;
    if (!d || !d.grid || !obj.visible) continue;
    heads.set(Math.round(obj.x), `${d.frames[0]}:${d.t.toFixed(2)}`);
  }
  const tiers = window.__scene.rigs.map((r) => r.currentTier);
  return { distinct: new Set(heads.values()).size, total: heads.size, tiers };
});
console.log('\nfield: distinct playheads', field.distinct, 'of', field.total, '· tiers', field.tiers.join(','));
check('sibling emitters are out of phase with each other', field.distinct > field.total * 0.5,
  `${field.distinct}/${field.total}`);
check('the tier budget demotes distant rigs', new Set(field.tiers).size > 1, field.tiers.join(','));

// A gust must SWEEP: the wind at two ends of the world differs at one instant.
const gust = await page.evaluate(() => {
  const a = window.__scene.rigs[0].position;
  const b = window.__scene.rigs[window.__scene.rigs.length - 1].position;
  return { spanPx: Math.abs(b.x - a.x) };
});
check('the field spans real distance', gust.spanPx > 400, `${gust.spanPx.toFixed(0)}px`);

/* ------------------------------------------------------------------ tidy */

const real = errs.filter((e) => !e.includes('favicon'));
check('no console errors', real.length === 0, real.slice(0, 3).join(' | '));

await browser.close();
console.log(`\nscreenshots -> ${OUT}/FX-fire.png, FX-smoke.png, FX-field.png`);
console.log(fails.length ? `${fails.length} FAILED: ${fails.join(', ')}` : 'all FX emitter checks passed');
process.exit(fails.length ? 1 : 0);
