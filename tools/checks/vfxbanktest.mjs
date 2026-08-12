/**
 * VFX bank integrity check — `node tools/checks/vfxbanktest.mjs`
 *
 * Pure filesystem/PNG checks, no browser and no server: verifies the baked bank
 * in assets/vfx-bank matches its manifest, that every source it claims still
 * exists, and that it obeys the constraints in docs/vfx-textures.md
 * (4096px ceiling, sheet dims = cols*cellW x rows*cellH, ADD textures authored
 * on black, credits present).
 *
 * Re-bake with: node scripts/bake-vfx-bank.mjs --contact
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BANK = path.join(ROOT, 'assets/vfx-bank');
const fails = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

/* ------------------------- minimal PNG reader ------------------------- */
// IHDR for dimensions; full inflate only where a pixel check is needed.
function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20),
    bitDepth: buf[24], colorType: buf[25] };
}
// Decode an 8-bit RGBA PNG to raw pixels (handles the standard filters).
function pngPixels(buf) {
  const { width: w, height: h, bitDepth, colorType } = pngSize(buf);
  if (bitDepth !== 8 || colorType !== 6) return null;   // only RGBA8 needed here
  let idat = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
    if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * 4);
  const bpp = 4, stride = w * bpp;
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
  }
  return { w, h, px: out };
}

/* ------------------------------ manifest ------------------------------ */
const manifest = JSON.parse(fs.readFileSync(path.join(BANK, 'bank.json'), 'utf8'));
const indexPath = path.join(BANK, 'bank.index.json');
check('bank.index.json exists (bank has been baked)', fs.existsSync(indexPath));
if (!fs.existsSync(indexPath)) { console.log('\nrun: node scripts/bake-vfx-bank.mjs --contact'); process.exit(1); }
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

check('manifest and index agree on asset count', manifest.assets.length === index.assets.length,
  `${manifest.assets.length} vs ${index.assets.length}`);
check('asset keys are unique', new Set(manifest.assets.map((a) => a.key)).size === manifest.assets.length);

const MAX = manifest.conventions.maxTexturePx;
let bytes = 0, sheets = 0, stills = 0;

for (const a of manifest.assets) {
  const entry = index.assets.find((e) => e.key === a.key);
  if (!entry) { check(`${a.key}: present in index`, false); continue; }
  const file = path.join(BANK, entry.file);
  if (!fs.existsSync(file)) { check(`${a.key}: baked PNG exists`, false, entry.file); continue; }

  const buf = fs.readFileSync(file);
  bytes += buf.length;
  const { width, height } = pngSize(buf);

  // source art the recipe claims must still be on disk (bank is re-bakeable)
  if (a.source?.file) {
    check(`${a.key}: source art present`, fs.existsSync(path.join(ROOT, a.source.file)), a.source.file);
  }

  if (a.kind === 'sheet') {
    sheets++;
    const wantW = a.cols * a.cellW, wantH = a.rows * a.cellH;
    check(`${a.key}: sheet is cols*cellW x rows*cellH`, width === wantW && height === wantH,
      `${width}x${height} want ${wantW}x${wantH}`);
    check(`${a.key}: frame count`, entry.frames === a.cols * a.rows, `${entry.frames}`);
    check(`${a.key}: fps declared`, Number.isFinite(a.fps) && a.fps > 0);
  } else {
    stills++;
    check(`${a.key}: still is size x size`, width === a.size && height === a.size, `${width}x${height}`);
  }
  check(`${a.key}: within the ${MAX}px ceiling`, width <= MAX && height <= MAX, `${width}x${height}`);
}

/* ------------- ADD textures must be authored on black ----------------- */
// Under Phaser.BlendModes.ADD the RGB is added regardless of alpha, so a
// non-black transparent border shows up as a glowing box. Sample the outer ring
// of each additive still and require it to be dark.
for (const a of manifest.assets.filter((x) => x.blend === 'add' && x.kind !== 'sheet')) {
  const entry = index.assets.find((e) => e.key === a.key);
  const dec = pngPixels(fs.readFileSync(path.join(BANK, entry.file)));
  if (!dec) { check(`${a.key}: decodable for black-border check`, false); continue; }
  const { w, h, px } = dec;
  let worst = 0;
  const probe = (x, y) => {
    const i = (y * w + x) * 4;
    worst = Math.max(worst, px[i], px[i + 1], px[i + 2]);
  };
  for (let x = 0; x < w; x++) { probe(x, 0); probe(x, h - 1); }
  for (let y = 0; y < h; y++) { probe(0, y); probe(w - 1, y); }
  check(`${a.key}: ADD-safe (border RGB is black)`, worst <= 8, `max border channel ${worst}`);
}

/* ------------------------------ credits ------------------------------- */
const credits = fs.readFileSync(path.join(ROOT, 'assets/CREDITS.md'), 'utf8');
check('CREDITS.md documents the VFX bank', credits.includes('VFX bank'));
for (const dir of ['kenney', 'unity-labs', 'sbs-noise']) {
  check(`CREDITS.md covers raw/vfx-sources/${dir}`, credits.includes(dir));
}
check('CREDITS.md records the LeLu no-redistribute carve-out', /CANNOT resell and\/or redistribute/.test(credits));

/* --------------------- deploy must not ship the bank ------------------ */
const vite = fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
check('vite prunes raw/vfx-sources from dist', vite.includes("'raw/vfx-sources'"));
check('vite prunes vfx-bank from dist', vite.includes("'vfx-bank'"));

console.log(`\n${stills} stills · ${sheets} flipbooks · ${(bytes / 1048576).toFixed(2)}MB`);
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.slice(0, 8).join(', ')}` : '\nvfx bank OK');
process.exit(fails.length ? 1 : 0);
