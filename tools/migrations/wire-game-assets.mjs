// Wire the new assets into the GAME (parallels the world-builder swap):
//   • grass_1..15 textures re-point to the new iso-cube tiles
//   • the 16th grass slot is dropped (its lone cell 7,11 → border-grass-15)
//   • world-map.json calibration updated so build-gamemap emits the new placement
//   • the water tile is registered as a loadable texture (bg_water)
// Run `node scripts/build-gamemap.mjs` afterwards to regenerate src/data/map.json.
import { readFileSync, writeFileSync } from 'node:fs';

const CALIB = { offsetX: 0, offsetY: 0, scale: 0.854, anchor: { x: 0.5, y: 0.34 } };

/* ---------- 1) assets.json: re-point grass, drop grass_16, add water ---------- */
let assets = readFileSync('src/data/assets.json', 'utf8');
for (let n = 1; n <= 15; n++) {
  const pad = String(n).padStart(3, '0');
  assets = assets.replace(
    `sprites/environment/map/border-grass/border-grass-${n}.png`,
    `sprites/environment/map/grass-tiles/Tiles-out_${pad}.png`
  );
}
assets = assets.replace(
  `    {
      "key": "grass_16",
      "source": "file",
      "generator": "tile",
      "file": "sprites/environment/map/border-grass/border-grass-16.webp"
    },
`,
  ''
);
assets = assets.replace(
  `      "file": "sprites/environment/blockers/cloud/cloud-tile.webp"
    }
  ]`,
  `      "file": "sprites/environment/blockers/cloud/cloud-tile.webp"
    },
    {
      "key": "bg_water",
      "source": "file",
      "generator": "tile",
      "file": "sprites/bg-tile/water-tile.webp"
    }
  ]`
);
writeFileSync('src/data/assets.json', assets);

/* ---------- 2) world-map.json: calibration + reassign the 16th cell ---------- */
const world = JSON.parse(readFileSync('src/data/world-map.json', 'utf8'));
let reassigned = 0;
for (const [cell, name] of Object.entries(world.tilesByCell)) {
  if (name === 'border-grass-16') { world.tilesByCell[cell] = 'border-grass-15'; reassigned++; }
}
let recalibrated = 0;
for (const key of Object.keys(world.calibration)) {
  const bare = key.replace(/^(tile|decotile)\|/, '');
  if (bare === 'border-grass-16') { delete world.calibration[key]; continue; }
  if (/^border-grass-([1-9]|1[0-5])$/.test(bare)) {
    world.calibration[key] = JSON.parse(JSON.stringify(CALIB));
    recalibrated++;
  }
}
writeFileSync('src/data/world-map.json', JSON.stringify(world, null, 2));

const grassRefs = (assets.match(/grass-tiles\/Tiles-out_/g) || []).length;
console.log(`assets.json → ${grassRefs} grass refs re-pointed · grass_16 dropped: ${!assets.includes('"grass_16"')} · bg_water added: ${assets.includes('"bg_water"')}`);
console.log(`world-map.json → reassigned ${reassigned} cell(s) off border-grass-16 · recalibrated ${recalibrated} entries · bg16 cal left: ${Object.keys(world.calibration).some((k) => k.endsWith('border-grass-16'))}`);
