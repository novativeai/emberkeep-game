/**
 * Bake the Emberkeep VFX bank.
 *
 *   node scripts/bake-vfx-bank.mjs [--only <key>] [--contact]
 *
 * Reads assets/vfx-bank/bank.json and renders every entry through the REAL FX
 * Studio engine (tools/fxstudio/index.html) in headless Chromium, so the shipped
 * bank and the authoring tool can never drift. Outputs PNGs next to the manifest
 * plus bank.index.json (what was baked, from what, under which licence).
 *
 * Stills  → bakeRecipe()  : full technique chain (spatial ops allowed).
 * Sheets  → bakeSheet()   : per-pixel grade only — blur/dissolve/symmetry would
 *                           bleed across flipbook cell borders.
 *
 * Serves the repo root itself (no external server needed).
 */
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BANK_DIR = path.join(ROOT, 'assets/vfx-bank');
const MANIFEST = path.join(BANK_DIR, 'bank.json');

const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const wantContact = argv.includes('--contact');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.css': 'text/css' };

/* ------------------------------ tiny static server -------------------- */
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('nope'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const assets = manifest.assets.filter((a) => !only || a.key === only);
if (!assets.length) { console.error(`no asset matches --only ${only}`); process.exit(1); }

const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrs = [];
page.on('pageerror', (e) => pageErrs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) pageErrs.push(m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/tools/fxstudio/index.html`);
await page.evaluate(() => localStorage.clear());   // no seed library, no saved state
await page.reload();
await page.waitForFunction(() => typeof bakeRecipe === 'function' && typeof bakeSheet === 'function');

const dataUrl = (p) => `data:image/png;base64,${fs.readFileSync(path.join(ROOT, p)).toString('base64')}`;
const index = [];
let failed = 0;

for (const a of assets) {
  const outRel = a.kind === 'sheet' ? `flipbooks/${a.key}.png`
    : a.tiling ? `noise/${a.key}.png` : `particles/${a.key}.png`;
  const outAbs = path.join(BANK_DIR, outRel);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });

  const srcUrl = a.source?.file ? dataUrl(a.source.file) : null;

  let png;
  try {
    png = await page.evaluate(async ({ a, srcUrl }) => {
      const loadImg = (u) => new Promise((res, rej) => {
        const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('decode failed')); i.src = u;
      });

      if (a.kind === 'sheet') {
        const img = await loadImg(srcUrl);
        const c = bakeSheet(img, { cols: a.cols, rows: a.rows, cellW: a.cellW, cellH: a.cellH, ...a.grade });
        return c.toDataURL('image/png');
      }

      // still: merge the manifest recipe over the generator's defaults so a
      // manifest only has to state what it changes
      const rec = defaultRecipe(a.recipe.gen);
      rec.size = a.size || rec.size;
      rec.ramp = a.recipe.ramp || rec.ramp;
      rec.alpha = a.recipe.alpha || rec.alpha;
      Object.assign(rec.params, a.recipe.params || {});
      for (const [k, v] of Object.entries(a.recipe.tech || {})) Object.assign(rec.tech[k], v);

      if (a.recipe.gen === 'source') {
        const img = await loadImg(srcUrl);
        const id = '__bake_src';
        S.textures[id] = { id, name: id, src: srcUrl, cols: 1, rows: 1, fps: 24, recipe: null };
        TEX[id] = img;
        rec.params.srcTex = id;
        const out = bakeRecipe(rec).toDataURL('image/png');
        delete S.textures[id]; delete TEX[id];
        return out;
      }
      return bakeRecipe(rec).toDataURL('image/png');
    }, { a, srcUrl });
  } catch (e) {
    console.log(`  FAIL  ${a.key} — ${String(e).split('\n')[0].slice(0, 120)}`);
    failed++; continue;
  }

  const buf = Buffer.from(png.split(',')[1], 'base64');
  fs.writeFileSync(outAbs, buf);

  const cw = a.cellW || a.cell, ch = a.cellH || a.cell;
  const dims = a.kind === 'sheet'
    ? `${a.cols * cw}x${a.rows * ch} (${a.cols}x${a.rows} cells of ${cw}x${ch} @${a.fps}fps, ${a.cols * a.rows} frames)`
    : `${a.size}x${a.size}`;
  console.log(`  ok    ${a.key.padEnd(18)} ${dims.padEnd(40)} ${String(Math.round(buf.length / 1024)).padStart(4)}KB  ${outRel}`);

  index.push({ key: a.key, role: a.role, file: outRel, kind: a.kind, blend: a.blend,
    ...(a.kind === 'sheet'
      ? { cols: a.cols, rows: a.rows, cellW: cw, cellH: ch, fps: a.fps, frames: a.cols * a.rows,
          width: a.cols * cw, height: a.rows * ch }
      : { size: a.size }),
    ...(a.tiling ? { tiling: true } : {}),
    ...(a.replaces ? { replaces: a.replaces } : {}),
    source: a.source?.file ?? 'generated', credit: a.source?.credit ?? 'emberkeep (procedural)',
    bytes: buf.length });
}

/* ------------------------------ contact sheet ------------------------- */
if (wantContact && !only) {
  const rows = index.map((e) => ({ ...e, url: dataUrl(path.join('assets/vfx-bank', e.file)) }));
  const contact = await page.evaluate(async (rows) => {
    const COLS = 5, CELL = 190, PAD = 26, HEAD = 34;
    const r = Math.ceil(rows.length / COLS);
    const c = document.createElement('canvas');
    c.width = COLS * (CELL + PAD) + PAD; c.height = HEAD + r * (CELL + PAD + 24) + PAD;
    const g = c.getContext('2d');
    g.fillStyle = '#1d1622'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#F7A437'; g.font = 'bold 18px sans-serif';
    g.fillText('Emberkeep VFX bank — baked on black (how ADD reads)', PAD, 24);
    for (let i = 0; i < rows.length; i++) {
      const x = PAD + (i % COLS) * (CELL + PAD), y = HEAD + Math.floor(i / COLS) * (CELL + PAD + 24);
      g.fillStyle = '#000'; g.fillRect(x, y, CELL, CELL);
      const img = await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = rows[i].url; });
      const s = Math.min(CELL / img.width, CELL / img.height);
      g.drawImage(img, x + (CELL - img.width * s) / 2, y + (CELL - img.height * s) / 2, img.width * s, img.height * s);
      g.strokeStyle = '#473548'; g.strokeRect(x + 0.5, y + 0.5, CELL, CELL);
      g.fillStyle = '#FFF6E8'; g.font = '11px sans-serif';
      g.fillText(rows[i].key, x, y + CELL + 14);
      g.fillStyle = '#9b8d99'; g.font = '9px sans-serif';
      g.fillText(rows[i].kind === 'sheet' ? `${rows[i].frames} frames · ${rows[i].blend}` : `${rows[i].size}px · ${rows[i].blend}`, x, y + CELL + 25);
    }
    return c.toDataURL('image/png');
  }, rows);
  const cp = path.join(BANK_DIR, 'contact-sheet.png');
  fs.writeFileSync(cp, Buffer.from(contact.split(',')[1], 'base64'));
  console.log(`\n  contact sheet → assets/vfx-bank/contact-sheet.png`);
}

if (!only) {
  fs.writeFileSync(path.join(BANK_DIR, 'bank.index.json'),
    JSON.stringify({ format: 'emberkeep-vfx-bank-index', version: 1,
      generatedBy: 'scripts/bake-vfx-bank.mjs', engine: 'tools/fxstudio/index.html',
      palette: 'src/core/Constants.ts PALETTE', credits: 'assets/CREDITS.md',
      count: index.length, totalBytes: index.reduce((s, e) => s + e.bytes, 0),
      assets: index }, null, 2) + '\n');
}

await browser.close();
server.close();

if (pageErrs.length) { console.log('\npage errors:', pageErrs.slice(0, 5)); failed++; }
const total = index.reduce((s, e) => s + e.bytes, 0);
console.log(`\n${index.length}/${assets.length} baked · ${(total / 1048576).toFixed(2)}MB total${failed ? ` · ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
