// Extract the world-builder's PLAYABLE tile art (the flower tiles) from the
// embedded images of the canonical world export into assets/, and register each
// as a `tile_<name>` entry in assets.json so the loader picks it up. Run after
// importing a world whose tiles aren't yet shipped as files.
//
//   node scripts/extract-tiles.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exportPath = resolve(root, 'assets/map/dragon-land.world-2.json');
const outDir = resolve(root, 'assets/sprites/environment/map/flower-tiles');
const assetsPath = resolve(root, 'src/data/assets.json');
const REL = 'sprites/environment/map/flower-tiles';

const doc = JSON.parse(readFileSync(exportPath, 'utf8'));
mkdirSync(outDir, { recursive: true });

const tiles = doc.assets.filter((a) => a.category === 'tile');
const assets = JSON.parse(readFileSync(assetsPath, 'utf8'));
const have = new Set(assets.images.map((e) => e.key));

let written = 0;
let added = 0;
for (const a of tiles) {
  const dataURL = doc.images?.[a.file];
  if (!dataURL) {
    console.warn(`  no embedded image for ${a.file}`);
    continue;
  }
  writeFileSync(resolve(outDir, a.file), Buffer.from(dataURL.split(',')[1], 'base64'));
  written++;
  const key = `tile_${a.name}`;
  if (!have.has(key)) {
    assets.images.push({ key, source: 'file', generator: 'tile', file: `${REL}/${a.file}` });
    have.add(key);
    added++;
  }
}

writeFileSync(assetsPath, JSON.stringify(assets, null, 2) + '\n');
console.log(`Extracted ${written} flower tiles → ${REL}/`);
console.log(`assets.json: +${added} tile_ entries (now ${assets.images.length} total)`);
