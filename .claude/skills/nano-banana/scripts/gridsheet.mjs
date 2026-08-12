#!/usr/bin/env node
/**
 * Grid-sheet mask template, built by Sprite Studio's OWN `lib/gridSheet.ts`.
 *
 *   gridsheet.mjs <source.png> <out.png> --cols 4 --rows 2
 *                 [--cell 900] [--mode mask|character] [--bg 2A2A32] [--guides]
 *
 * The source must be a transparent PNG — gridSheet takes its tight alpha bbox
 * and stamps that content into every cell at identical position and scale. That
 * identical framing is the whole point: an image model handed the template can
 * only put the head where the template says, so the cells stay co-registered
 * and nothing gets clipped by a cell edge.
 *
 * `gridSheet.ts` is browser code (canvas, HTMLImageElement), so it is compiled
 * with Sprite Studio's own tsc and run in headless Chromium rather than ported.
 * A port would drift from the app the artist actually uses.
 *
 * --bg flattens the transparent template onto a solid colour: white silhouettes
 * on transparent are invisible to the model, so they need something to sit on.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STUDIO = path.join(process.env.HOME, 'Documents/Dev/Helper/SmartGrid/sprite-studio');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const [src, out] = positional;
if (!src || !out) {
  console.error('usage: gridsheet.mjs <source.png> <out.png> --cols N --rows M');
  process.exit(2);
}
const opts = {
  cols: Number(flag('cols', 4)),
  rows: Number(flag('rows', 2)),
  mode: flag('mode', 'mask'),
  guides: argv.includes('--guides'),
  cellLong: Number(flag('cell', 900)),
  // Per-side margin around each silhouette (fraction of the cell's long side).
  // The model paints PAST the mask it is handed, so cells packed tight produce
  // artwork that crosses into its neighbours and the sheet cannot be sliced.
  // Omit to take Sprite Studio's own default; raise it for flaring subjects.
  ...(flag('pad', null) === null ? {} : { padPct: Number(flag('pad')) }),
};
const bg = flag('bg', null);

// 1. Compile Sprite Studio's module with Sprite Studio's own compiler.
const work = mkdtempSync(path.join(tmpdir(), 'gridsheet-'));
execFileSync(path.join(STUDIO, 'node_modules/.bin/tsc'), [
  path.join(STUDIO, 'lib/gridSheet.ts'),
  '--outDir', work,
  '--target', 'es2020',
  '--module', 'es2020',
  '--moduleResolution', 'bundler',
  '--skipLibCheck',
  '--lib', 'es2020,dom',
], { stdio: 'inherit' });
const moduleJs = readFileSync(path.join(work, 'gridSheet.js'), 'utf8');

// 2. Run it in a real browser — it is canvas code and wants a real canvas.
// @playwright/test is CommonJS — an ESM `import` of it hands back a namespace
// whose named exports are not hoisted, so go through require.
const require = createRequire(path.join(REPO, 'package.json'));
const { chromium } = require('@playwright/test');
const browser = await chromium.launch();
const page = await browser.newPage();
// Forward warnings too, not just errors: gridSheet warns when the requested
// grid cannot hold a safe margin, and that warning is the difference between
// noticing an unsliceable sheet now and finding it after a 4K generation.
page.on('console', (m) => {
  if (m.type() === 'error') console.error('page:', m.text());
  else if (m.type() === 'warning') console.warn(m.text());
});
await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
await page.addScriptTag({ content: `${moduleJs}\nwindow.__grid = { buildGridSheet, tightBBox };`, type: 'module' });

const dataUri = `data:image/png;base64,${readFileSync(src).toString('base64')}`;
const result = await page.evaluate(async ({ uri, o, bgHex }) => {
  const image = new Image();
  await new Promise((res, rej) => {
    image.onload = res;
    image.onerror = () => rej(new Error('source image failed to decode'));
    image.src = uri;
  });
  const bbox = window.__grid.tightBBox(image);
  let sheet = window.__grid.buildGridSheet(image, o);
  if (bgHex) {
    // Flatten: a white mask on transparent reads as nothing to an image model.
    const flat = document.createElement('canvas');
    flat.width = sheet.width;
    flat.height = sheet.height;
    const ctx = flat.getContext('2d');
    ctx.fillStyle = `#${bgHex}`;
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(sheet, 0, 0);
    sheet = flat;
  }
  return {
    png: sheet.toDataURL('image/png'),
    w: sheet.width,
    h: sheet.height,
    cell: { w: sheet.width / o.cols, h: sheet.height / o.rows },
    bbox,
  };
}, { uri: dataUri, o: opts, bgHex: bg });
await browser.close();

writeFileSync(out, Buffer.from(result.png.split(',')[1], 'base64'));
const cellAr = (result.cell.w / result.cell.h).toFixed(3);
const sheetAr = (result.w / result.h).toFixed(3);
console.log(
  `saved ${out} (${result.w}x${result.h}) | ${opts.cols}x${opts.rows} ` +
  `| cell ${Math.round(result.cell.w)}x${Math.round(result.cell.h)} (ar ${cellAr}) ` +
  `| sheet ar ${sheetAr} | source bbox ${result.bbox.w}x${result.bbox.h}`,
);
