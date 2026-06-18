// Extract the world-builder's DECOR art (huts, crystals, landmarks — the
// `decor` category) from the embedded images of the canonical world export into
// assets/, and register each as a `decor_<slug>` entry in assets.json (+ its
// anchor in anchors.json) so the loader and BoardScene.buildMapDecor pick it up.
// Names are slugged (lowercase, non-alphanumeric → "_") to safe texture keys,
// matching build-gamemap.mjs. Run after importing a world with new decor.
//
//   node scripts/extract-decor.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exportPath = resolve(root, 'assets/map/dragon-land.world-2.json');
const outDir = resolve(root, 'assets/sprites/environment/map/decor');
const assetsPath = resolve(root, 'src/data/assets.json');
const anchorsPath = resolve(root, 'src/data/anchors.json');
const REL = 'sprites/environment/map/decor';
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const doc = JSON.parse(readFileSync(exportPath, 'utf8'));
mkdirSync(outDir, { recursive: true });

const decor = doc.assets.filter((a) => a.category === 'decor');
const assets = JSON.parse(readFileSync(assetsPath, 'utf8'));
const anchors = JSON.parse(readFileSync(anchorsPath, 'utf8'));
const have = new Set(assets.images.map((e) => e.key));

let written = 0;
let added = 0;
for (const a of decor) {
  const dataURL = doc.images?.[a.file];
  if (!dataURL) {
    console.warn(`  no embedded image for ${a.file}`);
    continue;
  }
  const name = slug(a.name);
  const fname = `${name}.png`;
  writeFileSync(resolve(outDir, fname), Buffer.from(dataURL.split(',')[1], 'base64'));
  written++;
  const key = `decor_${name}`;
  if (!have.has(key)) {
    assets.images.push({ key, source: 'file', generator: 'decor', file: `${REL}/${fname}` });
    have.add(key);
    added++;
  }
  // Decor anchors default to top-centred (0.5/0); honour the world-builder value.
  const anchor = a.calibration?.anchor ?? { x: 0.5, y: 0 };
  anchors.byKey[key] = [anchor.x, anchor.y];
}

writeFileSync(assetsPath, JSON.stringify(assets, null, 2) + '\n');
writeFileSync(anchorsPath, JSON.stringify(anchors, null, 2) + '\n');
console.log(`Extracted ${written} decor sprites → ${REL}/`);
console.log(`assets.json: +${added} decor_ entries (now ${assets.images.length} total)`);
