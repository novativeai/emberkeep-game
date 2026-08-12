/**
 * FX Studio — texture layer regression harness.
 *
 * Covers the half of the studio that docs/vfx-textures.md drives: the ten
 * generators, the technique chain (multibrush symmetry, polar conversion,
 * wrap-around seamless, duplicate+blur glow, morphological dissolve, levels),
 * flipbook frame resolution, tint caching, recipe persistence and the export.
 *
 * Needs a static server on 8820 from the repo root, e.g.
 *   python3 -m http.server 8820
 * Companions: tools/checks/fxtest.mjs (elements/events/export), tools/checks/fxrigtest.mjs (rigs).
 */
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1320, height: 860 }, deviceScaleFactor: 1.5 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

const fails = [];
const check = (name, ok, detail) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fails.push(name); };

await page.goto('http://localhost:8820/tools/fxstudio/index.html');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(2600);              // first run bakes the seed library

/* ---------------------------- seed library ---------------------------- */
const lib = await page.evaluate(() => ({
  count: Object.keys(S.textures).length,
  decoded: Object.keys(S.textures).filter((id) => !!TEX[id]).length,
  recipes: Object.values(S.textures).filter((t) => !!t.recipe).length,
  fields: FX_PRESETS.every((p) => p.texture !== undefined && p.frameMode !== undefined),
  bound: FX_PRESETS.filter((p) => p.texture).length
}));
console.log('seed library:', JSON.stringify(lib));
check('seed library bakes and decodes', lib.count > 0 && lib.decoded === lib.count);
check('every seed persists as a recipe', lib.recipes === lib.count);
check('presets carry texture/frameMode', lib.fields);
check('seeds are NOT auto-bound (default look unchanged)', lib.bound === 0);

/* ---------------------------- generators ------------------------------ */
const gens = await page.evaluate(() => Object.keys(GENERATORS).map((k) => {
  const rec = defaultRecipe(k);
  if (k === 'source') rec.params.srcTex = Object.keys(S.textures)[0];
  try {
    const c = bakeRecipe(rec);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let max = 0, sum = 0;
    for (let i = 3; i < d.length; i += 4) { sum += d[i]; if (d[i] > max) max = d[i]; }
    return { k, ok: max > 8, size: c.width, maxA: max, meanA: +(sum / (d.length / 4)).toFixed(1) };
  } catch (e) { return { k, ok: false, err: String(e).slice(0, 80) }; }
}));
for (const g of gens) check(`generator ${g.k}`, g.ok, g.err || `maxA=${g.maxA} meanA=${g.meanA}`);

/* ---------------------------- technique chain ------------------------- */
const tech = await page.evaluate(() => {
  const base = defaultRecipe('fbm'); base.size = 128;
  const hash = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 17) h = (h * 31 + d[i]) | 0; return h; };
  const h0 = hash(bakeRecipe(base));
  const out = {};
  for (const t of ['symmetry', 'polar', 'seamless', 'glowBlur', 'dissolve', 'levels']) {
    const r = JSON.parse(JSON.stringify(base)); r.tech[t].on = true;
    if (t === 'levels') { r.tech.levels.gamma = 2.2; r.tech.levels.black = 0.15; }
    out[t] = hash(bakeRecipe(r)) !== h0;
  }
  return out;
});
for (const [t, changed] of Object.entries(tech)) check(`technique ${t} alters the field`, changed);

/* --- wrap-around actually makes a NON-tiling imported texture seamless -- */
const seam = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 256, 0);
  gr.addColorStop(0, '#000'); gr.addColorStop(1, '#fff');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const rec = addTexture('__seamtest', c.toDataURL());
  await new Promise((r) => setTimeout(r, 300));
  const err = (cv) => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, n = cv.width;
    let e = 0; for (let y = 0; y < n; y++) e += Math.abs(d[(y * n) * 4] - d[(y * n + n - 1) * 4]);
    return +(e / n).toFixed(1);
  };
  const r1 = defaultRecipe('source'); r1.params.srcTex = rec.id; r1.ramp = 'white'; r1.alpha = 'opaque';
  const plain = err(bakeRecipe(r1));
  const r2 = JSON.parse(JSON.stringify(r1)); r2.tech.seamless = { on: true, feather: 0.2 };
  const fixed = err(bakeRecipe(r2));
  removeTexture(rec.id);
  return { plain, fixed };
});
check('wrap-around heals a non-tiling import', seam.fixed < seam.plain * 0.1, `edge error ${seam.plain} → ${seam.fixed}`);

/* ---------------------------- flipbook -------------------------------- */
const flip = await page.evaluate(() => {
  const t = Object.values(S.textures)[0];
  t.cols = 4; t.rows = 2; t.fps = 20;
  const img = TEX[t.id];
  const at = (mode, f, clock, idx) => frameRect(t, img, mode, f, clock, idx).map(Math.round);
  return { frames: texFrames(t), first: at('life', 0, 0, 0), mid: at('life', 0.5, 0, 0), last: at('life', 0.99, 0, 0),
    loop0: at('loop', 0, 0, 0), loop3: at('loop', 0, 0.16, 0), rnd: at('random', 0, 0, 5) };
});
const fw = 64, fh = 128;
check('flipbook frame count', flip.frames === 8, JSON.stringify(flip.frames));
check('life mode walks the sheet', flip.first[0] === 0 && flip.first[1] === 0 && flip.mid[1] === fh && flip.last[0] === 3 * fw && flip.last[1] === fh);
check('loop mode advances at fps', flip.loop0[0] === 0 && flip.loop3[0] === 3 * fw);
check('random mode picks per particle', flip.rnd[0] === (5 % 4) * fw);

/* ---------------------------- tint cache ------------------------------ */
const tint = await page.evaluate(() => {
  const id = Object.keys(S.textures)[0];
  const a = tintedTexture(id, '#E8503C'), b = tintedTexture(id, '#E8503C');
  const p = presetByKey('confetti_pop');                       // rainbow
  const keys = new Set(); for (let i = 0; i < 200; i++) keys.add(quantHex(pickColor(p, '#E8503C')));
  return { cached: a === b, rainbowKeys: keys.size, wellFormed: [...keys].every((c) => /^hsl\(\d+,85%,62%\)$/.test(c)) };
});
check('tint cache reuses canvases', tint.cached);
check('rainbow tint keys stay bounded + well-formed', tint.rainbowKeys <= 24 && tint.wellFormed, `${tint.rainbowKeys} keys`);

/* ------------------ derived (source-gen) texture persistence ---------- */
const persist = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); g.fillStyle = '#888'; g.fillRect(0, 0, 128, 128);
  const imported = addTexture('__imported', c.toDataURL());
  await new Promise((r) => setTimeout(r, 250));
  const rec = defaultRecipe('source'); rec.params.srcTex = imported.id; rec.ramp = 'magic';
  rec.tech.symmetry = { on: true, axes: 6, snowflake: true };
  const derived = addTexture('__derived', bakeRecipe(rec).toDataURL(), { recipe: rec });
  presetByKey('magic_swirl').texture = derived.id;
  save();
  const raw = localStorage.getItem(FX_KEY);
  return { bytes: raw.length, generatedStoredAsRecipeOnly: (raw.match(/data:image/g) || []).length === 1 };
});
await page.reload();
await page.waitForTimeout(2600);
const after = await page.evaluate(() => {
  const d = Object.values(S.textures).find((t) => t.name === '__derived');
  const i = Object.values(S.textures).find((t) => t.name === '__imported');
  return { derivedAlive: !!d, derivedDecoded: !!(d && TEX[d.id]), inputDecoded: !!(i && TEX[i.id]),
    bound: presetByKey('magic_swirl').texture === d?.id,
    allDecoded: Object.keys(S.textures).every((id) => !!TEX[id]),
    sheetKept: Object.values(S.textures).some((t) => t.cols === 4 && t.rows === 2) };
});
console.log('persist:', JSON.stringify(persist), '→', JSON.stringify(after));
check('generated textures persist as recipes, not base64', persist.generatedStoredAsRecipeOnly);
check('source-gen texture rebakes in dependency order', after.derivedAlive && after.derivedDecoded && after.inputDecoded);
check('preset binding survives reload', after.bound);
check('every texture decodes after reload', after.allDecoded);
check('flipbook layout survives reload', after.sheetKept);

/* ---------------------------- live render ----------------------------- */
const live = await page.evaluate(() => {
  const ids = Object.values(S.textures).filter((t) => !t.name.startsWith('__'));
  presetByKey('sparkle_burst').texture = ids[1].id;
  presetByKey('ember_rise').texture = ids[3].id;
  S.config['ember_dragon_2'].appear = ['sparkle_burst', 'ember_rise'];
  selectElement('ember_dragon_2'); selectEvent('appear'); restartStage();
  return true;
});
await page.waitForTimeout(300);
const stageState = await page.evaluate(() => ({
  effects: stage.effects.length,
  parts: stage.effects.reduce((a, e) => a + e.parts.length, 0),
  textured: stage.effects.filter((e) => e.p.texture).length
}));
check('textured presets spawn particles on stage', stageState.parts > 0 && stageState.textured === 2, JSON.stringify(stageState));

/* ---------------------------- export ---------------------------------- */
const exp = await page.evaluate(() => {
  const d = buildDoc();
  return { version: d.version, textures: Object.keys(d.textures).length, images: Object.keys(d.textureImages).length,
    dataUrls: Object.values(d.textureImages).every((s) => typeof s === 'string' && s.startsWith('data:image')),
    boundResolve: d.fxPresets.filter((p) => p.texture).every((p) => !!d.textures[p.texture]),
    hasFrames: Object.values(d.textures).every((t) => typeof t.frames === 'number'),
    spec: !!d.fxParamSpec.texture && !!d.fxParamSpec.frameMode,
    elements: d.elements.length, presets: d.fxPresets.length };
});
console.log('export:', JSON.stringify(exp));
check('export is v2 with textures + images', exp.version === 2 && exp.textures > 0 && exp.textures === exp.images);
check('texture images are data URLs', exp.dataUrls);
check('every bound preset resolves to a shipped texture', exp.boundResolve);
check('textures declare frame counts', exp.hasFrames);
check('fxParamSpec documents the new fields', exp.spec);
check('elements/presets unchanged', exp.elements === 11 && exp.presets === 10);

/* ---------------------------- console --------------------------------- */
const real = errs.filter((e) => !e.includes('favicon'));
check('no console errors', real.length === 0, real.slice(0, 3).join(' | '));

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall texture-layer checks passed');
process.exit(fails.length ? 1 : 0);
