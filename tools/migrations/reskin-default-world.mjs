// Re-skin the authored default world with the new grass tileset.
// border-grass-1..15 keep their NAMES (so every placement still resolves) but
// get the new iso-cube art + one uniform calibration. The lone border-grass-16
// cell is reassigned to border-grass-15, and the 16th tile is dropped.
import fs from 'fs';

const WB = 'tools/worldbuilder/default-world.json';
const SRC = 'assets/sprites/environment/map/grass-tiles';
const CALIB = { offsetX: 0, offsetY: 0, scale: 0.854, anchor: { x: 0.5, y: 0.34 } };

const dims = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
const grass = {}; // border-grass-N  ->  { dataURL, w, h }
for (let i = 1; i <= 15; i++) {
  const buf = fs.readFileSync(`${SRC}/Tiles-out_${String(i).padStart(3, '0')}.png`);
  grass[`border-grass-${i}`] = { dataURL: 'data:image/png;base64,' + buf.toString('base64'), ...dims(buf) };
}

const d = JSON.parse(fs.readFileSync(WB, 'utf8'));

// 1) reassign the single border-grass-16 placement, then forget the 16th tile
let reassigned = 0;
for (const p of d.placements) if (p.asset === 'border-grass-16') { p.asset = 'border-grass-15'; reassigned++; }
d.assets = d.assets.filter((a) => a.name !== 'border-grass-16');
delete d.images['border-grass-16.png'];

// 2) re-skin border-grass-1..15 (both 'tile' and 'decotile' copies)
let reskinned = 0;
for (const a of d.assets) {
  const g = grass[a.name];
  if (!g || (a.category !== 'tile' && a.category !== 'decotile')) continue;
  a.width = g.w; a.height = g.h;
  a.calibration = JSON.parse(JSON.stringify(CALIB));
  d.images[a.file] = g.dataURL; // a.file is "border-grass-N.png"
  reskinned++;
}

fs.writeFileSync(WB, JSON.stringify(d));
const tileNames = [...new Set(d.placements.filter((p) => p.category === 'tile').map((p) => p.asset))].sort();
console.log(`reassigned ${reassigned} cell(s) off border-grass-16 · re-skinned ${reskinned} asset(s)`);
console.log('tile names now placed:', tileNames.join(', '));
console.log('border-grass-16 still referenced?', d.placements.some((p) => p.asset === 'border-grass-16'), '· image present?', !!d.images['border-grass-16.png']);
