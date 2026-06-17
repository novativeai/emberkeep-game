// Bake the red-dragon rig into ONE flat PNG by driving the World Builder's own
// `bakeDragonRig()` in a headless browser — single source of truth with the
// in-browser bake. Writes the PNG next to the rig and into the builder assets.
//
//   node scripts/bake-dragon.mjs
//
// (uses the Chromium that ships with @playwright/test)
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const builder = resolve(root, 'world/emberkeep-world-builder/index.html');
const RIG = resolve(root, 'world/emberkeep-world-builder/assets/dragon/dragon-red.rig.json');
const RIG_JS = resolve(root, 'world/emberkeep-world-builder/assets/dragon/dragon-rig.js');
const OUT = [
  resolve(root, 'assets/sprites/characters/dragon/red-dragon/sprite/red-dragon-baked.png'),
  resolve(root, 'world/emberkeep-world-builder/assets/dragon/red-dragon-baked.png')
];

// 1) Refresh the JSONP wrapper the builder loads under file:// (rig with its
//    embedded data: images as a global → no fetch, no tainted bake canvas).
const rigText = readFileSync(RIG, 'utf8').trim();
writeFileSync(
  RIG_JS,
  '/* Auto-generated from dragon-red.rig.json by scripts/bake-dragon.mjs — do not\n' +
    '   hand-edit. JSONP wrapper so the rig (with embedded data: images) loads under\n' +
    "   file:// where fetch() is blocked and <img src=file://> would taint the bake. */\n" +
    'window.__DRAGON_RIG = ' + rigText + ';\n'
);

const browser = await chromium.launch();
const page = await browser.newPage();
// Only uncaught JS exceptions are fatal. Console errors under file:// include
// the benign default-world.json fetch (the builder falls back to starter tiles).
const errors = [];
const BENIGN = /Fetch API cannot load|net::ERR|Failed to load resource/i;
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !BENIGN.test(m.text()) && errors.push(m.text()));

await page.goto(pathToFileURL(builder).href);
// The bake function flattens 8 rig pieces (loaded via <img>, file://-safe).
await page.waitForFunction(() => typeof window.bakeDragonRig === 'function');
const dataURL = await page.evaluate(() => window.bakeDragonRig());

// Sanity: the builder's own auto-bake (markReady → loadDragonAssets) should
// wire the Whelp merge slot + a placeable decor asset. It runs async after the
// load path settles, so wait for it.
// `S` is a top-level `const` in a classic script, so it is a global lexical
// binding (reachable by name) but NOT a property of `window`.
await page
  .waitForFunction(
    () =>
      // eslint-disable-next-line no-undef
      !!S.mergeSlots?.ember_dragon_3?.custom &&
      // eslint-disable-next-line no-undef
      Object.values(S.assets).some((a) => a.file === 'red-dragon-baked.png'),
    { timeout: 15000 }
  )
  .catch(() => {});
const wired = await page.evaluate(() => ({
  // eslint-disable-next-line no-undef
  whelp: !!S.mergeSlots?.ember_dragon_3?.custom,
  // eslint-disable-next-line no-undef
  decor: Object.values(S.assets).some((a) => a.file === 'red-dragon-baked.png')
}));

await browser.close();
if (errors.length) { console.error('Page errors:\n' + errors.join('\n')); process.exit(1); }
if (!dataURL?.startsWith('data:image/png')) { console.error('bake produced no PNG'); process.exit(1); }

const buf = Buffer.from(dataURL.split(',')[1], 'base64');
for (const f of OUT) writeFileSync(f, buf);
console.log(`Baked dragon → ${buf.length} bytes`);
console.log(`Auto-wire in builder: whelp slot=${wired.whelp}, decor asset=${wired.decor}`);
for (const f of OUT) console.log('  wrote ' + f.replace(root + '/', ''));
