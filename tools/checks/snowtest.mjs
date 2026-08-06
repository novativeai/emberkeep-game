/**
 * Snowfall regression + performance harness.
 *
 * The things a screenshot cannot confirm, measured instead:
 *   - it FALLS (best vertical cross-correlation between two frames is downward)
 *   - it does not read as a GRID, which is the standing risk of the one-flake-
 *     per-cell technique (autocorrelation of the brightness profile on both axes)
 *   - the planes are actually at different DEPTHS (a far-only field and a
 *     near-only field have different blob sizes)
 *   - flakes are antialiased rather than hard-edged squares
 *   - doze fades the field out completely, and waking brings it back
 *
 * The performance number is deliberately RELATIVE, for the same reason as the
 * aurora's: this harness's empty 2560×1600 canvas costs tens of ms/frame, so
 * absolute times are meaningless. The yardstick is a plain alpha-blended quad
 * of the same area — the irreducible cost of covering the screen with anything.
 *
 * All pixel analysis runs INSIDE the page; shipping RGBA buffers over CDP costs
 * seconds a frame, and a dozen summary numbers cost nothing.
 *
 * Needs `pnpm dev` running.
 *   node tools/checks/snowtest.mjs [outDir]
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

/* Pixel helpers, installed before the page's own script runs. */
await page.addInitScript(() => {
  /**
   * Grab the canvas INSIDE Phaser's postrender, never after N rAFs.
   *
   * The lab runs with an fps limit (so an unattended tab throttles), which means
   * Phaser skips render on some rAF ticks — and a WebGL drawing buffer with no
   * draw since the last composite reads back BLACK. Waiting two rAFs sampled
   * those empty frames and reported an empty sky over a perfectly good one.
   */
  window.__snap = () => new Promise((resolve) => {
    window.__game.events.once('postrender', () => {
    const cv = window.__game.canvas;
    const g = document.createElement('canvas');
    g.width = cv.width; g.height = cv.height;
    g.getContext('2d').drawImage(cv, 0, 0);
    const d = g.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    // Luminance on a coarse grid — every measurement below works on this.
    const step = 2;
    const w = Math.floor(cv.width / step), h = Math.floor(cv.height / step);
    const lum = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = ((y * step) * cv.width + x * step) * 4;
        lum[y * w + x] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      }
    }
    resolve({ w, h, lum, raw: null });
    });
  });

  /** Best integer vertical shift taking frame A onto frame B, by SAD. */
  window.__bestShiftY = (a, b, range) => {
    let best = 0, bestErr = Infinity;
    for (let dy = -range; dy <= range; dy++) {
      let err = 0, n = 0;
      for (let y = range + 4; y < a.h - range - 4; y += 2) {
        const ay = y, by = y + dy;
        for (let x = 4; x < a.w - 4; x += 2) {
          err += Math.abs(a.lum[ay * a.w + x] - b.lum[by * b.w + x]);
          n++;
        }
      }
      err /= n;
      if (err < bestErr) { bestErr = err; best = dy; }
    }
    return { shift: best, err: bestErr };
  };

  /**
   * Strongest normalised autocorrelation peak of a 1-D profile.
   *
   * `minLag` matters more than it looks: at short lags a profile of blobs
   * correlates with itself simply because a blob is several pixels wide, which
   * has nothing to do with a lattice. Start past the widest flake.
   */
  window.__peak = (profile, minLag, maxLag) => {
    const n = profile.length;
    let mean = 0;
    for (const v of profile) mean += v;
    mean /= n;
    const c = profile.map((v) => v - mean);
    let e0 = 0;
    for (const v of c) e0 += v * v;
    let peak = 0, at = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = 0; i + lag < n; i++) s += c[i] * c[i + lag];
      const r = s / Math.max(e0, 1e-9);
      if (r > peak) { peak = r; at = lag; }
    }
    return { peak, at };
  };

  /** Mean run of contiguous lit pixels along a row — the flakes' apparent size. */
  window.__blobRun = (f, thresh) => {
    let runs = 0, px = 0;
    for (let y = 4; y < f.h - 4; y += 3) {
      let run = 0;
      for (let x = 0; x < f.w; x++) {
        if (f.lum[y * f.w + x] > thresh) run++;
        else if (run) { runs++; px += run; run = 0; }
      }
    }
    return runs ? px / runs : 0;
  };
});

await page.goto(`${BASE}/tools/snowlab/index.html`);
await page.waitForFunction(() => window.__ready === true, { timeout: 25000 });
await page.evaluate(() => window.__keepAwake?.());   // the lab throttles unattended tabs
await page.waitForTimeout(1600);

/* ------------------------------------------------------------ foundations */

const boot = await page.evaluate(() => ({
  pipeline: window.__game.renderer.pipelines.has('SnowFall'),
  presets: Object.keys(window.__doc.presets),
  planes: window.__snow.planeCount,
  loadErr: window.__loadErr ?? null
}));
check('SnowFall pipeline compiled and registered', boot.pipeline);
check('the backdrop art loaded', !boot.loadErr, boot.loadErr ?? '');
check('three presets ship', boot.presets.length === 3, boot.presets.join(', '));
check('five depth planes are live at the top tier', boot.planes === 5, String(boot.planes));

// Black backdrop and no aurora, so every measurement below is the snow alone.
await page.evaluate(() => {
  document.getElementById('bgBlack').click();
  if (window.__state.aurora) document.getElementById('btnAurora').click();
});
await page.waitForTimeout(500);

/* -------------------------------------------------------------- it falls - */

const fall = await page.evaluate(async () => {
  const build = (range) => {
    window.__snow?.destroy();
    window.__snow = new window.__SnowFX(window.__scene, window.__doc.presets.snowfall, {
      now: window.__now, width: window.__W, height: window.__H, depth: 20, tier: 'high', planeRange: range
    });
  };
  const at = async (t) => { window.__setT(t); window.__snow.update(); return window.__snap(); };

  // One mid plane in isolation: with all five the correlation is a compromise
  // between five different fall speeds and says nothing about any of them.
  // Its cell period is 33 samples, so the search window stays inside ±20 or
  // the correlation can lock onto the neighbouring row instead.
  build([2, 3]);
  const a = await at(10000);
  const b = await at(10100);   // 0.125 screen-heights/s × 0.1 s ≈ 10 of 800 samples
  const down = window.__bestShiftY(a, b, 20);
  build();
  return { shift: down.shift };
});
check('the field falls, and falls downward', fall.shift >= 6 && fall.shift <= 15,
  `best shift over 0.1s = ${fall.shift} samples, expected ~10`);

/* ------------------------------------------------------ structure, not grid */

const structure = await page.evaluate(async () => {
  window.__setT(24000); window.__snow.update();
  const f = await window.__snap();

  let lit = 0, soft = 0, hard = 0, peakLum = 0;
  for (let i = 0; i < f.lum.length; i++) {
    const v = f.lum[i];
    if (v > 6) lit++;
    if (v > 6 && v < 55) soft++;
    if (v >= 55) hard++;
    if (v > peakLum) peakLum = v;
  }
  return { lit, soft, hard, peakLum, total: f.lum.length };
});

console.log(`\nlit ${((structure.lit / structure.total) * 100).toFixed(1)}% of pixels · ` +
  `soft edges ${structure.soft} vs cores ${structure.hard} · brightest ${structure.peakLum.toFixed(0)}`);

check('the sky actually has snow in it', structure.lit / structure.total > 0.01,
  `${((structure.lit / structure.total) * 100).toFixed(1)}% lit`);
check('it does not white out the screen', structure.lit / structure.total < 0.45,
  `${((structure.lit / structure.total) * 100).toFixed(1)}% lit`);
check('flakes are antialiased, not hard-edged', structure.soft > structure.hard,
  `${structure.soft} soft vs ${structure.hard} hard`);

/* ---------------------------------------------------------- no lattice -- */

/**
 * The standing risk of one-flake-per-cell: a visible grid. It has to be
 * measured on a SINGLE plane — over the composite, five grids at unrelated
 * densities average each other out and the test would pass on a field that is
 * obviously latticed. It also has to skip the short lags, where any field of
 * blobs correlates with itself simply because a blob is wide.
 *
 * Plane 0 (cells 17 samples apart, flakes ~2 wide) and plane 2 (cells 33,
 * flakes ~7) are the two where a lattice would show first.
 */
const lattice = await page.evaluate(async () => {
  const out = [];
  for (const [i, cell] of [[0, 17], [2, 33]]) {
    window.__snow?.destroy();
    window.__snow = new window.__SnowFX(window.__scene, window.__doc.presets.snowfall, {
      now: window.__now, width: window.__W, height: window.__H, depth: 20, tier: 'high', planeRange: [i, i + 1]
    });
    window.__setT(24000); window.__snow.update();
    const f = await window.__snap();
    const colSum = new Float32Array(f.w);
    const rowSum = new Float32Array(f.h);
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const v = f.lum[y * f.w + x];
        colSum[x] += v;
        rowSum[y] += v;
      }
    }
    const min = Math.round(cell * 0.45); // past the widest flake, before the cell
    out.push({
      plane: i,
      cell,
      cols: window.__peak(Array.from(colSum), min, 200),
      rows: window.__peak(Array.from(rowSum), min, 200)
    });
  }
  window.__snow.destroy();
  window.__snow = new window.__SnowFX(window.__scene, window.__doc.presets.snowfall, {
    now: window.__now, width: window.__W, height: window.__H, depth: 20, tier: 'high'
  });
  return out;
});

for (const l of lattice) {
  console.log(`plane ${l.plane} (cell ${l.cell}): columns ${l.cols.peak.toFixed(3)} @ ${l.cols.at} · ` +
    `rows ${l.rows.peak.toFixed(3)} @ ${l.rows.at}`);
  check(`plane ${l.plane} shows no column lattice`, l.cols.peak < 0.3,
    `peak ${l.cols.peak.toFixed(3)} @ lag ${l.cols.at}, cell is ${l.cell}`);
  check(`plane ${l.plane} shows no row lattice`, l.rows.peak < 0.3,
    `peak ${l.rows.peak.toFixed(3)} @ lag ${l.rows.at}, cell is ${l.cell}`);
}

/* ------------------------------------------------------------- real depth */

const depth = await page.evaluate(async () => {
  const measure = async (range) => {
    window.__snow?.destroy();
    window.__snow = new window.__SnowFX(window.__scene, window.__doc.presets.snowfall, {
      now: window.__now, width: window.__W, height: window.__H, depth: 20, tier: 'high', planeRange: range
    });
    window.__setT(31000); window.__snow.update();
    const f = await window.__snap();
    return window.__blobRun(f, 5);
  };
  const far = await measure([0, 1]);
  const near = await measure([4, 5]);
  window.__snow.destroy();
  window.__snow = new window.__SnowFX(window.__scene, window.__doc.presets.snowfall, {
    now: window.__now, width: window.__W, height: window.__H, depth: 20, tier: 'high'
  });
  return { far, near };
});
console.log(`flake width: far plane ${depth.far.toFixed(2)}px · near plane ${depth.near.toFixed(2)}px`);
check('the near plane is visibly larger than the far one', depth.near > depth.far * 3,
  `${depth.near.toFixed(2)}px vs ${depth.far.toFixed(2)}px`);

/* ---------------------------------------------------------- tier and off - */

const tiers = await page.evaluate(async () => {
  const litAt = async (tier) => {
    window.__snow.setTier(tier);
    window.__setT(37000); window.__snow.update();
    const f = await window.__snap();
    let lit = 0;
    for (let i = 0; i < f.lum.length; i++) if (f.lum[i] > 6) lit++;
    return lit;
  };
  return { high: await litAt('high'), medium: await litAt('medium'), low: await litAt('low'), off: await litAt('off') };
});
check('each tier down thins the field', tiers.low < tiers.medium && tiers.medium < tiers.high,
  `${tiers.high} → ${tiers.medium} → ${tiers.low}`);
check('off renders nothing at all', tiers.off === 0, String(tiers.off));

/* -------------------------------------------------------- doze fades out - */

const dozed = await page.evaluate(async () => {
  window.__snow.setTier('high');
  window.__live();
  window.__snow.setPowerState('doze');
  await new Promise((r) => setTimeout(r, 900));
  const off = window.__snow.gameObject.visible;
  window.__snow.setPowerState('active');
  await new Promise((r) => setTimeout(r, 900));
  return { off, on: window.__snow.gameObject.visible };
});
check('doze fades the snow out completely', dozed.off === false);
check('waking brings it back', dozed.on === true);

/* ------------------------------------------------------------ screenshots */

await page.evaluate(() => {
  window.__snow.setTier('high');
  window.__live();
  document.getElementById('bgArt').click();
  if (!window.__state.aurora) document.getElementById('btnAurora').click();
});
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/SNOW-snowfall.png` });
for (const id of ['flurry', 'blizzard']) {
  await page.evaluate((k) => { window.__state.preset = k; window.__paintPreset(); window.__rebuildSnow(); }, id);
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}/SNOW-${id}.png` });
}
await page.evaluate(() => { window.__state.preset = 'snowfall'; window.__paintPreset(); window.__rebuildSnow(); });
await page.waitForTimeout(700);

/* ------------------------------------------------------------- the budget */

// Quiet scene: the aurora and the backdrop art are their own variable cost and
// only add noise to a measurement about the snow.
await page.evaluate(() => {
  document.getElementById('bgBlack').click();
  if (window.__state.aurora) document.getElementById('btnAurora').click();
});

const fpsOf = async (setup, ms = 1300) => {
  await page.evaluate(setup);
  await page.waitForTimeout(350);
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
 * A single pass per configuration is not a measurement: one GC pause or one
 * thermal step during the 1.3 s window shifts a whole reading, and a first run
 * of this harness reported the snow as CHEAPER than the plain quad it contains
 * — which is impossible, and was the measurement moving under it. Interleaving
 * spreads any drift across every configuration instead of one of them.
 */
const CONFIGS = {
  none: () => { window.__snow?.destroy(); window.__snow = null; window.__benchQuad?.destroy(); window.__benchQuad = null; },
  // The floor: a plain alpha-blended quad over the same area, no shader at all.
  quad: () => {
    window.__snow?.destroy(); window.__snow = null;
    window.__benchQuad?.destroy();
    window.__benchQuad = window.__scene.add
      .image(0, 0, '__WHITE').setOrigin(0, 0)
      .setDisplaySize(window.__W, window.__H).setAlpha(0.35).setDepth(20);
  },
  low: () => { window.__benchQuad?.destroy(); window.__benchQuad = null; window.__rebuildSnow(); window.__snow.setTier('low'); },
  high: () => { window.__benchQuad?.destroy(); window.__benchQuad = null; window.__rebuildSnow(); window.__snow.setTier('high'); }
};
const samples = { none: [], quad: [], low: [], high: [] };
for (let round = 0; round < 3; round++) {
  for (const [name, setup] of Object.entries(CONFIGS)) samples[name].push(await fpsOf(setup));
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const msOf = (name) => 1000 / median(samples[name]);

const floor = msOf('none');
const costQuad = msOf('quad') - floor;
const costLow = msOf('low') - floor;
const costHigh = msOf('high') - floor;
const flakes = await page.evaluate(() => {
  window.__benchQuad?.destroy();
  window.__rebuildSnow();
  return window.__snow.cost(60).flakes;
});
console.log(`\nempty-frame floor of this harness: ${floor.toFixed(1)} ms   (median of 3)`);
console.log(`  plain alpha quad, full screen   : ${costQuad.toFixed(2)} ms   (the irreducible fill cost)`);
console.log(`  snow · high (5 planes, ${flakes} flakes): ${costHigh.toFixed(2)} ms   = ${(costHigh / costQuad).toFixed(2)}× the quad`);
console.log(`  snow · low  (3 planes)          : ${costLow.toFixed(2)} ms   = ${(costLow / costQuad).toFixed(2)}× the quad`);

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

costCheck('the whole snowfield costs at most 3× a plain full-screen quad', costHigh / costQuad < 3,
  `${(costHigh / costQuad).toFixed(2)}×`);
costCheck('the snow costs at least what its own fill costs', costHigh > costQuad * 0.6,
  `${(costHigh / costQuad).toFixed(2)}× — under 1 means the measurement drifted, not that it is free`);
costCheck('the low tier is cheaper than the high one', costLow < costHigh,
  `${costLow.toFixed(2)} vs ${costHigh.toFixed(2)} ms`);

const real = errs.filter((e) => !/favicon|404/.test(e));
check('no console errors', real.length === 0, real.slice(0, 3).join(' | '));

await browser.close();
console.log(`\nscreenshots -> ${OUT}/SNOW-snowfall.png, SNOW-flurry.png, SNOW-blizzard.png`);
console.log(fails.length ? `${fails.length} FAILED: ${fails.join(', ')}` : 'all snow checks passed');
process.exit(fails.length ? 1 : 0);
