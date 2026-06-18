// Rasterize every assets/raw/svg/*.svg → assets/sprites/level1/<name>.png
// (transparent background) so hand-authored SVG art drops into the existing
// file-based asset pipeline (assets.json source:"file"). Re-run after editing
// any SVG.  Uses the Chromium that ships with @playwright/test.
//
//   node scripts/rasterize-svg.mjs
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(root, 'assets/raw/svg');
const OUT = resolve(root, 'assets/sprites/level1');
mkdirSync(OUT, { recursive: true });

const svgs = readdirSync(SRC).filter((f) => f.endsWith('.svg'));
if (!svgs.length) { console.error('No SVGs in ' + SRC); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

for (const file of svgs) {
  const svg = readFileSync(resolve(SRC, file), 'utf8');
  const w = +(svg.match(/width="(\d+)"/)?.[1] ?? 240);
  const h = +(svg.match(/height="(\d+)"/)?.[1] ?? 240);
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`, {
    waitUntil: 'networkidle'
  });
  const el = await page.$('svg');
  const png = await el.screenshot({ omitBackground: true });
  const name = basename(file, '.svg') + '.png';
  writeFileSync(resolve(OUT, name), png);
  console.log(`  ${file} → sprites/level1/${name} (${w}×${h})`);
}

await browser.close();
if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
console.log(`Rasterized ${svgs.length} SVG → PNG.`);
