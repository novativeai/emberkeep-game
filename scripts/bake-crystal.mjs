#!/usr/bin/env node
/**
 * Bake the live Three.js crystal into a sprite sheet the runtime can just play.
 *
 * ## Why this is exact, not an approximation
 *
 * The gem is a stretched octahedron spinning about Y. Its vertex set is
 * (±0.66,0,0), (0,±1.2,0), (0,0,±0.66); a 90° turn about Y maps that set — and
 * every face built from it — onto itself, while the lights never move. So the
 * rendered image at angle θ and at θ+90° is IDENTICAL, and the whole animation
 * is a 90° loop, not a 360° one. `--verify` proves it by hashing both frames
 * rather than trusting the argument.
 *
 * The frame count follows from the governor, not from taste: ACTIVE re-renders
 * the crystal every `POWER.crystalMs.active` = 33 ms at 50°/s, i.e. 1.667° per
 * step, and 90° / 1.667° = 54. Fifty-four frames held 33.33 ms each is not a
 * close match for today's motion — it is the same motion.
 *
 * ## Why a browser
 *
 * Three.js needs WebGL. Rendering here through the SHIPPED `Crystal3D` module
 * (served by a throwaway Vite dev server, watcher off, on its own port) is the
 * only way the baked pixels are the pixels being replaced. Headless, 803x902,
 * a few seconds — this is not an e2e run.
 *
 *     node scripts/bake-crystal.mjs [--frames 54] [--verify] [--out DIR]
 *
 * Writes PNG frames to DIR (default: a scratch dir), then hands them to
 * `scripts/pack-crystal.py`, which measures the silhouette and packs the sheet.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5199; // never 5173 — the dev server owns that one, strictly

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const FRAMES = Number(arg('frames', 54));
const OUT = resolve(arg('out', join(ROOT, '.crystal-bake')));

/** Straight from src/data/map.json's decor3d — the one spec the worlds carry. */
const SPEC = {
  shape: 'emerald',
  color: '#2ad673',
  material: 'toon-cel',
  outline: '#07331b',
  spinDegPerSec: 50,
  camera: 'iso-top',
  steps: 4
};

/** The gem's symmetry period in ms: 90° at `spinDegPerSec`. */
const PERIOD_MS = (90 / SPEC.spinDegPerSec) * 1000;

async function main() {
  console.log(`[bake-crystal] ${FRAMES} frames over ${PERIOD_MS} ms (90° of spin)`);

  // A throwaway dev server: no project config (so none of the game's watch
  // allow-list applies), and `watch: null` so it cannot walk the 4 GB of
  // non-game trees sitting beside this repo.
  const server = await createServer({
    configFile: false,
    root: ROOT,
    logLevel: 'warn',
    server: { port: PORT, strictPort: true, watch: null, hmr: false }
  });
  await server.listen();

  const browser = await chromium.launch({
    args: ['--use-angle=metal', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 400 } });
  page.on('pageerror', (e) => console.error('[page]', e.message));

  let frames = [];
  try {
    await page.goto(`http://localhost:${PORT}/tools/crystalbake/index.html`);
    await page.waitForFunction('window.__bakeReady === true', null, { timeout: 30_000 });
    const [w, h] = await page.evaluate((s) => window.__init(s), SPEC);
    console.log(`[bake-crystal] renderer up at ${w}x${h}`);

    if (flag('verify')) {
      // The claim the whole bake rests on: one 90° turn is a closed loop.
      const [a, b, quarter] = await page.evaluate(
        (p) => [window.__pixels(0), window.__pixels(p), window.__pixels(p / 2)],
        PERIOD_MS
      );
      console.log(`[bake-crystal] hash(0°)=${a}  hash(90°)=${b}  hash(45°)=${quarter}`);
      if (a !== b) throw new Error('90° is NOT a closed loop — the sheet would pop on wrap');
      if (a === quarter) throw new Error('45° matches 0° — the frame set is degenerate');
      console.log('[bake-crystal] periodicity verified: 90° wraps exactly, 45° differs');
    }

    for (let i = 0; i < FRAMES; i++) {
      const url = await page.evaluate((t) => window.__frame(t), (i * PERIOD_MS) / FRAMES);
      frames.push(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    }
    console.log(`[bake-crystal] rendered ${frames.length} frames`);
  } finally {
    await browser.close();
    await server.close();
  }

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  frames.forEach((buf, i) => writeFileSync(join(OUT, `${String(i).padStart(3, '0')}.png`), buf));
  console.log(`[bake-crystal] wrote ${frames.length} PNGs → ${OUT}`);

  const pack = spawnSync(
    'python3',
    [join(ROOT, 'scripts/pack-crystal.py'), '--frames-dir', OUT, ...process.argv.slice(2)],
    { stdio: 'inherit' }
  );
  process.exit(pack.status ?? 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
