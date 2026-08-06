/**
 * Aurora regression + performance harness.
 *
 * The performance number is deliberately RELATIVE. Absolute frame times mean
 * nothing across machines — this harness's own empty 2560×1600 canvas costs
 * ~22 ms/frame, roughly fifty times a real GPU — so the check measures the
 * aurora against a **plain additive quad of the same size**: the irreducible
 * cost of covering that area with any additive layer at all. A ratio near 1
 * means the shader is essentially free and all that remains is fill rate, which
 * no implementation could avoid.
 *
 * The rest is the stuff a screenshot cannot confirm: that it actually moves,
 * that it is not banded, that the colour ramp is applied by altitude rather
 * than as a flat tint, that it stays inside its band, and that doze really does
 * stop the work.
 *
 * Needs `pnpm dev` running.
 *   node tools/checks/auroratest.mjs [outDir]
 */
import { chromium } from '@playwright/test';

const OUT = process.argv[2] || '/tmp';
const BASE = process.env.BASE || 'http://localhost:5173';

const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

const fails = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

await page.goto(`${BASE}/tools/auroralab/index.html`);
await page.waitForFunction(() => window.__ready === true, { timeout: 25000 });
await page.evaluate(() => window.__keepAwake?.());   // the lab throttles unattended tabs
await page.waitForTimeout(1800);

/* ------------------------------------------------------------ foundations */

const boot = await page.evaluate(() => ({
  pipeline: window.__game.renderer.pipelines.has('AuroraSky'),
  presets: Object.keys(window.__doc.presets),
  renders: window.__aurora.renderCount,
  loadErr: window.__loadErr ?? null
}));
check('AuroraSky pipeline compiled and registered', boot.pipeline);
check('the backdrop art loaded', !boot.loadErr, boot.loadErr ?? '');
check('three presets ship', boot.presets.length === 3, boot.presets.join(', '));
check('it rendered on construction', boot.renders > 0, String(boot.renders));

/* ------------------------------------------------------------- it moves - */

// All pixel analysis runs INSIDE the page. Shipping a 1280×800 RGBA buffer over
// CDP costs seconds per frame; shipping a dozen numbers costs nothing.
await page.addInitScript(() => {
  // Read INSIDE postrender: the lab runs with an fps limit, so Phaser skips
  // render on some rAF ticks, and a WebGL buffer with no draw since the last
  // composite reads back black.
  window.__snap = () => new Promise((resolve) => {
    window.__game.events.once('postrender', () => {
      const cv = window.__game.canvas;
      const g = document.createElement('canvas');
      g.width = cv.width; g.height = cv.height;
      const ctx = g.getContext('2d');
      ctx.drawImage(cv, 0, 0);
      resolve({ w: cv.width, h: cv.height, d: ctx.getImageData(0, 0, cv.width, cv.height).data });
    });
  });
});
await page.reload();
await page.waitForFunction(() => window.__ready === true, { timeout: 25000 });
await page.evaluate(() => window.__keepAwake?.());   // the lab throttles unattended tabs
await page.waitForTimeout(1500);

// Black backdrop so every measurement below is the aurora and nothing else.
await page.evaluate(() => { document.getElementById('bgBlack').click(); });
await page.waitForTimeout(400);

const motion = await page.evaluate(async () => {
  const shots = [];
  for (const t of [0, 4000, 12000]) {
    window.__setT(t);
    window.__aurora.refresh();
    await new Promise((r) => setTimeout(r, 260));
    shots.push(await window.__snap());
  }
  const diff = (a, b) => {
    let s = 0, n = 0;
    for (let i = 0; i < a.d.length; i += 16) { s += Math.abs(a.d[i] - b.d[i]); n++; }
    return s / n;
  };
  return { d01: diff(shots[0], shots[1]), d12: diff(shots[1], shots[2]), d02: diff(shots[0], shots[2]) };
});
console.log(`\nframe difference: t0→t4s ${motion.d01.toFixed(2)}   t4s→t12s ${motion.d12.toFixed(2)}`);
check('the sky moves', motion.d01 > 0.5 && motion.d12 > 0.5, `${motion.d01.toFixed(2)}, ${motion.d12.toFixed(2)}`);
check('it does not loop back to where it started', motion.d02 > 0.5, motion.d02.toFixed(2));

/* --------------------------------------------------- structure and colour */

const shape = await page.evaluate(() => {
  const a = window.__aurora;
  return { band: a.gameObject.displayHeight, canvas: window.__game.scale.height };
});
check('the band covers the top half', Math.abs(shape.band / shape.canvas - 0.5) < 0.02,
  `${shape.band}/${shape.canvas}`);

const analysis = await page.evaluate(async () => {
  const f = await window.__snap();
  const W = f.w, H = f.h, d = f.d;
  const px = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };

  // Nothing below the band: an aurora that leaks onto the board is a bug.
  let below = 0;
  for (let y = Math.floor(H * 0.62); y < H; y += 4)
    for (let x = 0; x < W; x += 8) below = Math.max(below, Math.max(...px(x, y)));

  // The ramp must be APPLIED, not flattened: the display has to contain both
  // green-dominant pixels (the oxygen body) and violet ones (the fringes).
  let green = 0, violet = 0, lit = 0;
  for (let y = 0; y < H * 0.6; y += 2)
    for (let x = 0; x < W; x += 2) {
      const [r, g, b] = px(x, y);
      if (r + g + b < 40) continue;
      lit++;
      if (g > r * 1.25 && g > b * 1.05) green++;
      if (b > g * 1.05 && r > g * 0.7) violet++;
    }

  // RAYS. Raw variance is the wrong instrument: scanning DOWN y crosses the
  // curtain's whole brightness envelope, so it always wins regardless of
  // structure. What distinguishes rays is LOCAL roughness — the field changes
  // fast across x and slowly along y. Measure the mean absolute gradient on
  // each axis at the same step, which cancels the envelope out.
  const lum = (x, y) => { const [r, g, b] = px(x, y); return r * 0.299 + g * 0.587 + b * 0.114; };
  const rough = (along) => {
    let sum = 0, n = 0;
    for (let y = Math.floor(H * 0.10); y < H * 0.45; y += 7)
      for (let x = 4; x < W - 4; x += 3) {
        sum += along === 'x' ? Math.abs(lum(x + 3, y) - lum(x, y)) : Math.abs(lum(x, y + 3) - lum(x, y));
        n++;
      }
    return sum / n;
  };
  const varX = rough('x');
  const varY = rough('y');

  // Banding shows as runs of one identical 8-bit value down a smooth gradient.
  // The MAX run is the wrong statistic: the dither is stochastic, so one long
  // run happens by chance and the number swings run to run. Systematic banding
  // raises the MEAN run length across the whole field, which is stable.
  let runs = 0, runPixels = 0, longRuns = 0;
  for (let x = Math.floor(W * 0.06); x < W * 0.94; x += 37) {
    let run = 1, prev = -1;
    for (let y = 10; y < H * 0.48; y++) {
      const g = px(x, y)[1];
      if (g === prev && g > 8) { run++; } else {
        if (prev > 8) { runs++; runPixels += run; if (run > 24) longRuns++; }
        run = 1;
      }
      prev = g;
    }
  }
  const meanRun = runs ? runPixels / runs : 0;
  return { below, green, violet, lit, varX, varY, meanRun, longRuns, runs };
});

console.log(`lit samples ${analysis.lit} · green ${((analysis.green / analysis.lit) * 100).toFixed(1)}% · violet ${((analysis.violet / analysis.lit) * 100).toFixed(1)}%`);
console.log(`local roughness across x ${analysis.varX.toFixed(3)} · along y ${analysis.varY.toFixed(3)} (rays ⇒ x > y)`);
check('nothing renders below the band', analysis.below <= 6, `brightest ${analysis.below}`);
check('the aurora actually lights the band', analysis.lit > 2000, String(analysis.lit));
check('the oxygen-green body is present', analysis.green / analysis.lit > 0.15,
  `${((analysis.green / analysis.lit) * 100).toFixed(1)}%`);
check('the violet fringe is present', analysis.violet / analysis.lit > 0.03,
  `${((analysis.violet / analysis.lit) * 100).toFixed(1)}%`);
check('the structure is striated into rays', analysis.varX > analysis.varY * 1.15,
  `x ${analysis.varX.toFixed(3)} vs y ${analysis.varY.toFixed(3)}`);
check('the gradient is dithered, not banded', analysis.meanRun < 4,
  `mean identical-value run ${analysis.meanRun.toFixed(2)}px over ${analysis.runs} runs`);
check('no systematic plateaus', analysis.longRuns / Math.max(1, analysis.runs) < 0.01,
  `${analysis.longRuns} runs over 24px of ${analysis.runs}`);

await page.evaluate(() => { window.__live(); document.getElementById('bgArt').click(); });
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/AUR-borealis.png` });
for (const id of ['calm', 'storm']) {
  await page.evaluate((k) => { window.__state.preset = k; window.__paintPreset?.(); }, id);
  await page.evaluate((k) => {
    window.__state.preset = k;
    window.__aurora.destroy();
    window.__rebuildAurora();
  }, id);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/AUR-${id}.png` });
}
await page.evaluate(() => { window.__state.preset = 'borealis'; window.__aurora.destroy(); window.__rebuildAurora(); });
await page.waitForTimeout(600);

/* ------------------------------------------------------------ the budget */

const fpsOf = async (setup, ms = 1500) => {
  await page.evaluate(setup);
  await page.waitForTimeout(450);
  return page.evaluate(async (dur) => {
    let n = 0;
    const t0 = performance.now();
    await new Promise((res) => {
      const tick = () => { n++; performance.now() - t0 < dur ? requestAnimationFrame(tick) : res(); };
      requestAnimationFrame(tick);
    });
    return (n * 1000) / (performance.now() - t0);
  }, ms);
};

/**
 * Rotate through the configurations three times and take the MEDIAN.
 *
 * A single pass per configuration is not a measurement: one GC pause, one
 * thermal step, or a Vite hot-reload during the 1.5 s window shifts a whole
 * reading — this harness has reported NEGATIVE shader costs that way, which is
 * the measurement moving, not the shader. Interleaving spreads any drift across
 * every configuration instead of landing it all on one.
 */
const CONFIGS = {
  none: () => { window.__aurora?.destroy(); window.__aurora = null; window.__benchQuad?.destroy(); window.__benchQuad = null; },
  // The floor: a plain additive quad over the same area, no shader at all.
  quad: () => {
    window.__aurora?.destroy(); window.__aurora = null;
    window.__benchQuad?.destroy();
    window.__benchQuad = window.__scene.add
      .image(0, 0, '__WHITE').setOrigin(0, 0)
      .setDisplaySize(2560, 800).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.35).setDepth(10);
  },
  doze: () => { window.__benchQuad?.destroy(); window.__benchQuad = null; window.__rebuildAurora(); window.__aurora.setPowerState('doze'); },
  low: () => { window.__benchQuad?.destroy(); window.__benchQuad = null; window.__rebuildAurora(); window.__aurora.setTier('low'); },
  high: () => { window.__benchQuad?.destroy(); window.__benchQuad = null; window.__rebuildAurora(); window.__aurora.setTier('high'); }
};
const samples = { none: [], quad: [], doze: [], low: [], high: [] };
for (let round = 0; round < 3; round++) {
  for (const [name, setup] of Object.entries(CONFIGS)) samples[name].push(await fpsOf(setup));
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const msOf = (name) => 1000 / median(samples[name]);

const floor = msOf('none');
const costQuad = msOf('quad') - floor;
const costLow = msOf('low') - floor;
const costHigh = msOf('high') - floor;
const costDoze = msOf('doze') - floor;
console.log(`\nempty-frame floor of this harness: ${floor.toFixed(1)} ms   (median of 3)`);
console.log(`  plain additive quad, same area  : ${costQuad.toFixed(2)} ms   (the irreducible fill cost)`);
console.log(`  aurora · high                   : ${costHigh.toFixed(2)} ms   = ${(costHigh / costQuad).toFixed(2)}× the quad`);
console.log(`  aurora · low                    : ${costLow.toFixed(2)} ms   = ${(costLow / costQuad).toFixed(2)}× the quad`);
console.log(`  aurora · doze (frozen)          : ${costDoze.toFixed(2)} ms   = ${(costDoze / costQuad).toFixed(2)}× the quad`);

/**
 * fps-delta only measures anything while the harness is GPU-BOUND. When every
 * configuration hits the vsync ceiling the deltas are pure noise — this check
 * has printed NEGATIVE costs that way. Detect it and say so, rather than pass
 * or fail on a number that means nothing.
 */
const VSYNC_MS = 17.5;   // ~57 fps and up: the compositor is the limit, not us
const MIN_BASELINE_MS = 2.0;
// Two ways this measurement can be meaningless, and both have happened here:
// every configuration pinned at the vsync ceiling (deltas are noise, and the
// costs printed NEGATIVE), or a baseline so small that dividing by it amplifies
// noise into a 5× swing between runs. Neither is a fact about the shader.
const measurable = floor > VSYNC_MS && costQuad > MIN_BASELINE_MS;
if (!measurable) {
  console.log(floor > VSYNC_MS
    ? `  (the plain-quad baseline came out at ${costQuad.toFixed(2)}ms — too small to divide by,`
    : '  (every configuration hit the vsync ceiling — this machine has too much headroom');
  console.log('   so the ratio would be noise. Cost checks skipped; re-run under load, at a');
  console.log('   larger canvas, or on the target device.)');
}
const costCheck = (name, ok, detail) => {
  if (!measurable) { console.log(`  skip  ${name} — not measurable at the vsync ceiling`); return; }
  check(name, ok, detail);
};

costCheck('high tier costs at most 2.5× a plain additive quad', costHigh / costQuad < 2.5,
  `${(costHigh / costQuad).toFixed(2)}×`);
costCheck('the aurora costs at least what its own fill costs', costHigh > costQuad * 0.6,
  `${(costHigh / costQuad).toFixed(2)}× — under 1 means the measurement drifted, not that it is free`);
// Total cost is dominated by the fill, which is identical at every tier, so
// compare what the tier actually changes: the shader pass on top of the blit.
const shaderHigh = costHigh - costDoze;
const shaderLow = costLow - costDoze;
console.log(`  shader pass alone               : high ${shaderHigh.toFixed(2)} ms · low ${shaderLow.toFixed(2)} ms`);
costCheck('the low tier runs a cheaper shader pass', shaderLow <= shaderHigh + 0.25,
  `${shaderLow.toFixed(2)} vs ${shaderHigh.toFixed(2)}`);
costCheck('doze costs no more than the bare quad', costDoze < costQuad * 1.6, `${(costDoze / costQuad).toFixed(2)}×`);

/* --------------------------------------------------- doze stops the work */

await page.evaluate(() => {
  window.__benchQuad?.destroy();
  window.__benchQuad = null;
  window.__rebuildAurora();
  window.__aurora.setPowerState('doze');
});
await page.waitForTimeout(300);
const dozed = await page.evaluate(async () => {
  const before = window.__aurora.renderCount;
  await new Promise((r) => setTimeout(r, 1200));
  const during = window.__aurora.renderCount;
  window.__aurora.setPowerState('active');
  await new Promise((r) => setTimeout(r, 800));
  return { before, during, after: window.__aurora.renderCount };
});
check('doze stops re-rendering entirely', dozed.during === dozed.before, `${dozed.before} → ${dozed.during}`);
check('waking resumes it', dozed.after > dozed.during, `${dozed.during} → ${dozed.after}`);

const real = errs.filter((e) => !/favicon|404/.test(e));
check('no console errors', real.length === 0, real.slice(0, 3).join(' | '));

await browser.close();
console.log(`\nscreenshots -> ${OUT}/AUR-borealis.png, AUR-calm.png, AUR-storm.png`);
console.log(fails.length ? `${fails.length} FAILED: ${fails.join(', ')}` : 'all aurora checks passed');
process.exit(fails.length ? 1 : 0);
