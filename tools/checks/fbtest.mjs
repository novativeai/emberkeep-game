/**
 * Motion-vector flipbook proof + regression harness.
 *
 * Renders each bank flipbook twice at the SAME instant — once cross-dissolved,
 * once warped along the baked optical flow — and measures the difference
 * on-GPU. Needs `pnpm dev` running.
 *
 *   node tools/checks/fbtest.mjs [outDir]
 */
import { chromium } from '@playwright/test';

const OUT = process.argv[2] || '/tmp';
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1120, height: 840 }, deviceScaleFactor: 2 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

await page.goto('http://localhost:5173/tools/fbtest/index.html');
await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
await page.waitForTimeout(600);

const fails = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

// The pipeline must actually have compiled and bound.
const gl = await page.evaluate(() => {
  const r = window.__game.renderer;
  return { webgl: r.type === Phaser.WEBGL, pipeline: r.pipelines.has('FlipbookMV') };
});
check('renderer is WebGL', gl.webgl);
check('FlipbookMV pipeline registered', gl.pipeline);

const sheets = await page.evaluate(() => Object.keys(window.__sheets));
console.log(`sheets in bank.mv.json: ${sheets.length}`);

// Park mid-way between two frames (t ~ 0.5) — the worst case for a
// cross-dissolve and the whole point of motion vectors.
await page.evaluate(() => window.__setT(1000 / 8 * 2.5)); // 2.5 frames at 8fps
await page.waitForTimeout(350);
await page.screenshot({ path: `${OUT}/FB-mv-vs-crossfade.png` });

// Difference between the two halves, measured on the rendered canvas.
const diff = await page.evaluate(async () => {
  // The WebGL canvas has no preserveDrawingBuffer, so it must be copied inside
  // the frame that drew it — otherwise the read lands on a cleared buffer.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const cv = window.__game.canvas;
  const g = document.createElement('canvas');
  g.width = cv.width; g.height = cv.height;
  g.getContext('2d').drawImage(cv, 0, 0);
  const ctx = g.getContext('2d');
  const scale = cv.width / 1120;
  const grab = (cx, cy) => ctx.getImageData(
    Math.round((cx - 110) * scale), Math.round((cy - 110) * scale),
    Math.round(220 * scale), Math.round(220 * scale)).data;
  const out = [];
  const rows = [['fb_flame_small', 150], ['fb_fireburst', 410], ['fb_smoke_wispy', 670]];
  for (const [key, y] of rows) {
    const a = grab(360, y), b = grab(760, y);
    let sum = 0, la = 0, lb = 0;
    for (let i = 0; i < a.length; i += 4) {
      sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      la += a[i] + a[i + 1] + a[i + 2];
      lb += b[i] + b[i + 1] + b[i + 2];
    }
    const n = a.length / 4;
    out.push({ key, meanAbsDiff: +(sum / (n * 3)).toFixed(2),
      lumCross: +(la / (n * 3)).toFixed(2), lumMV: +(lb / (n * 3)).toFixed(2) });
  }
  return out;
});
console.log('\nrendered difference at t=0.5 between frames:');
for (const d of diff) {
  console.log(`  ${d.key.padEnd(16)} mean|Δ| ${String(d.meanAbsDiff).padStart(6)}   ` +
              `lum cross ${d.lumCross} vs mv ${d.lumMV}`);
  check(`${d.key}: MV output differs from cross-dissolve`, d.meanAbsDiff > 1.0, `mean|Δ| ${d.meanAbsDiff}`);
  check(`${d.key}: both halves render something`, d.lumCross > 0.5 && d.lumMV > 0.5);
}

// Frame stepping across a whole loop must stay stable (no NaN / black frames).
const sweep = await page.evaluate(async () => {
  const out = [];
  for (let i = 0; i <= 8; i++) {
    window.__setT(i * 125);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const cv = window.__game.canvas;
    const g = document.createElement('canvas'); g.width = cv.width; g.height = cv.height;
    g.getContext('2d').drawImage(cv, 0, 0);
    const d = g.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let s = 0; for (let k = 0; k < d.length; k += 40) s += d[k];
    out.push(+(s / (d.length / 40)).toFixed(2));
  }
  return out;
});
console.log('\nluminance across a loop:', sweep.join(', '));
check('no black frames across the loop', sweep.every((v) => v > 0.2), sweep.join(','));
check('animation actually changes frame to frame', new Set(sweep.map((v) => Math.round(v * 10))).size > 3);

// Runtime recolour: same sheet, different ramp, must change the output.
const recolour = await page.evaluate(async () => {
  const sample = async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const cv = window.__game.canvas;
    const g = document.createElement('canvas'); g.width = cv.width; g.height = cv.height;
    g.getContext('2d').drawImage(cv, 0, 0);
    const s = cv.width / 1120;
    const d = g.getContext('2d').getImageData(Math.round(650 * s), Math.round(40 * s),
      Math.round(220 * s), Math.round(220 * s)).data;
    let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return [+(r / n).toFixed(1), +(gg / n).toFixed(1), +(b / n).toFixed(1)];
  };
  const fx = window.__game.scene.scenes[0].book[1];
  fx.setRamp('ember'); const ember = await sample();
  fx.setRamp('teal'); const teal = await sample();
  fx.setRamp('moss'); const moss = await sample();
  fx.setRamp('ember');
  return { ember, teal, moss };
});
console.log('\nruntime recolour (mean RGB of one effect):', JSON.stringify(recolour));
const shifted = (a, b) => Math.abs(a[2] - b[2]) > 2 || Math.abs(a[0] - b[0]) > 2;
check('ramp swap recolours at runtime (ember vs teal)', shifted(recolour.ember, recolour.teal), JSON.stringify(recolour));
check('ramp swap recolours at runtime (ember vs moss)', shifted(recolour.ember, recolour.moss));

await page.screenshot({ path: `${OUT}/FB-final.png` });
const real = errs.filter((e) => !e.includes('favicon'));
check('no console errors', real.length === 0, real.slice(0, 3).join(' | '));

await browser.close();
console.log(`\nscreenshots -> ${OUT}/FB-mv-vs-crossfade.png`);
console.log(fails.length ? `${fails.length} FAILED: ${fails.join(', ')}` : 'all flipbook checks passed');
process.exit(fails.length ? 1 : 0);
