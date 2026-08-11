import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';

/**
 * Dev-only 3D-asset store for the in-game Map Editor. The browser can't write to
 * disk, so imported models live in the repo's `asset3d/` folder via this endpoint
 * (auto-created), and the editor loads them straight off disk — no localStorage
 * size limit (so big GLBs never "disappear"), and a real folder the dev can manage.
 *   GET  /asset3d/<name>       → serve the model file
 *   GET  /__asset3d/list       → { files: [...] } (glb/gltf/obj/fbx only)
 *   POST /__asset3d/save       → { name, data(base64) } → writes asset3d/<name>
 *   POST /__asset3d/delete     → { name } → removes asset3d/<name>
 */
/**
 * Dev-only store for the Map Editor's DEFAULT design (allocations with unlock
 * levels + placed-asset metadata). Written to `asset3d/editor-map.json` so the
 * edited map is the game's baked-in default — it survives a browser cookie/
 * localStorage wipe (unlike per-browser storage).
 *   GET  /__editor/map → the JSON ({} if none)
 *   POST /__editor/map → validate + write it
 */
const editorMapStore = (): Plugin => ({
  name: 'emberkeep-editor-map',
  configureServer(server: ViteDevServer) {
    const dir = path.resolve(__dirname, 'asset3d');
    const file = path.join(dir, 'editor-map.json');
    server.middlewares.use('/__editor/map', (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end(existsSync(file) ? readFileSync(file, 'utf8') : '{}');
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: Buffer) => (body += chunk.toString()));
        req.on('end', () => {
          try {
            const doc = JSON.parse(body) as { allocations?: unknown; assets?: unknown };
            if (typeof doc !== 'object' || doc === null) throw new Error('not an object');
            mkdirSync(dir, { recursive: true });
            writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
            res.setHeader('Content-Type', 'application/json');
            res.end('{"ok":true}');
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: String(e) }));
          }
        });
        return;
      }
      res.statusCode = 405;
      res.end();
    });
  }
});

const asset3dStore = (): Plugin => ({
  name: 'emberkeep-asset3d',
  configureServer(server: ViteDevServer) {
    const dir = path.resolve(__dirname, 'asset3d');
    const EXT = /\.(glb|gltf|obj|fbx|png|jpg|jpeg|webp)$/i; // 3D models AND 2D images
    const safe = (name: string): string => path.basename(name || ''); // no path traversal

    server.middlewares.use('/asset3d', (req, res, next) => {
      const name = safe(decodeURIComponent((req.url ?? '').split('?')[0].replace(/^\/+/, '')));
      const p = path.join(dir, name);
      if (req.method === 'GET' && name && EXT.test(name) && existsSync(p) && statSync(p).isFile()) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(readFileSync(p));
        return;
      }
      next();
    });

    server.middlewares.use('/__asset3d', (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      const url = (req.url ?? '').split('?')[0];
      if (req.method === 'GET' && url === '/list') {
        const files = existsSync(dir) ? readdirSync(dir).filter((f) => EXT.test(f)) : [];
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ files }));
        return;
      }
      if (req.method === 'POST' && (url === '/save' || url === '/delete')) {
        let body = '';
        req.on('data', (chunk: Buffer) => (body += chunk.toString()));
        req.on('end', () => {
          try {
            const { name, data } = JSON.parse(body) as { name: string; data?: string };
            const fn = safe(name);
            if (!fn || !EXT.test(fn)) throw new Error('bad file name');
            const p = path.join(dir, fn);
            if (url === '/save') {
              mkdirSync(dir, { recursive: true });
              writeFileSync(p, Buffer.from(data ?? '', 'base64'));
            } else if (existsSync(p)) {
              rmSync(p);
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, url: `/asset3d/${fn}` }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: String(e) }));
          }
        });
        return;
      }
      res.statusCode = 405;
      res.end();
    });
  }
});

/**
 * Dev-only endpoint for the UI Builder satellite tool (tools/uibuilder):
 *   GET  /__uibuilder/theme  → current src/data/ui-theme.json
 *   POST /__uibuilder/theme  → validate + write it (the game bundles this file,
 *                              so a save lands in the REAL game, not a copy)
 * CORS is open because the tool may also be opened straight from file://.
 */
const uiThemeEndpoint = (): Plugin => ({
  name: 'emberkeep-uibuilder-theme',
  configureServer(server: ViteDevServer) {
    const file = path.resolve(__dirname, 'src/data/ui-theme.json');
    server.middlewares.use('/__uibuilder/theme', (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end(readFileSync(file, 'utf8'));
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: Buffer) => (body += chunk.toString()));
        req.on('end', () => {
          try {
            const doc = JSON.parse(body) as { version?: number; textures?: unknown; elements?: unknown };
            if (doc.version !== 1 || typeof doc.textures !== 'object' || typeof doc.elements !== 'object') {
              throw new Error('not a ui-theme doc');
            }
            writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
            res.setHeader('Content-Type', 'application/json');
            res.end('{"ok":true}');
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: String(e) }));
          }
        });
        return;
      }
      res.statusCode = 405;
      res.end();
    });
  }
});

/**
 * Deploy slimming: `assets/` (the publicDir) doubles as the art WORKSPACE —
 * AE frame sources, reference shots, uncropped masters and the PNG originals of
 * webp-converted sprites live there for future editing but are never requested
 * at runtime. Strip them from dist AFTER the copy so the deploy ships only what
 * the game can actually load. Two rules:
 *   1. an explicit list of source-only dirs/files;
 *   2. any .png whose sibling .webp exists (the webp is what assets.json
 *      references; the png is the kept master).
 */
const pruneDistArt = (): Plugin => ({
  name: 'emberkeep-prune-dist-art',
  apply: 'build',
  closeBundle() {
    // The SAME directory the build wrote to — hardcoding 'dist' meant an
    // EMBERKEEP_DIST run shipped the 91MB of source art it is meant to strip.
    const dist = path.resolve(__dirname, process.env.EMBERKEEP_DIST ?? 'dist');
    if (!existsSync(dist)) return;
    const SOURCE_ONLY = [
      'raw/emb10', // EMB-10 board drop: untouched sources + the trimmed-but-unwired producers
      'raw/ai', // placeholder sources — TextureFactory paints these at runtime
      'raw/screamingbrain/Overworld - Large',
      'position-reference',
      'sprites/background/title-screen-background.jpg', // byte-dup of sprites/ui/
      'sprites/environment/level-blocker/cloud/cloud-non-cropped.png',
      // Laurah AE exports — the game/builder use the downscaled sprites/laurah copies.
      'sprites/guide-characters/laurah-dragonMaster/laurah_idle_1',
      'sprites/guide-characters/laurah-dragonMaster/laurah_idle_2',
      'sprites/guide-characters/laurah-dragonMaster/laurah_talk_short',
      'sprites/guide-characters/laurah-dragonMaster/laurah_talk_mid',
      'sprites/guide-characters/laurah-dragonMaster/laurah_talk_long'
    ];
    let removed = 0;
    let bytes = 0;
    const sizeOf = (p: string): number => {
      const st = statSync(p);
      if (!st.isDirectory()) return st.size;
      return readdirSync(p).reduce((a, f) => a + sizeOf(path.join(p, f)), 0);
    };
    for (const rel of SOURCE_ONLY) {
      const p = path.join(dist, rel);
      if (!existsSync(p)) continue;
      bytes += sizeOf(p);
      rmSync(p, { recursive: true });
      removed++;
    }
    const dropPngMasters = (dir: string): void => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) {
          dropPngMasters(p);
        } else if (f.endsWith('.png') && existsSync(p.replace(/\.png$/, '.webp'))) {
          bytes += statSync(p).size;
          rmSync(p);
          removed++;
        }
      }
    };
    dropPngMasters(path.join(dist, 'sprites'));
    // The VFX bank is a WORKSPACE of nine flipbook sheets; the game loads four.
    // Ship `ramps.png` plus the `_pack`/`_mv` pair of everything in `SHIPPED`, and
    // nothing else — the full bank is ~19.8 MB. The keep-list is read from
    // src/render/vfxBank.ts itself, so widening SHIPPED widens the ship with no
    // second place to remember. Absent bank = nothing to prune, not an error: this
    // build only ever loads what it finds.
    const bankDir = path.join(dist, 'vfx-bank');
    if (existsSync(bankDir)) {
      const src = readFileSync(path.resolve(__dirname, 'src/render/vfxBank.ts'), 'utf8');
      const decl = /export const SHIPPED\s*=\s*\[([^\]]*)\]/.exec(src);
      if (!decl) throw new Error('[prune-dist-art] could not read SHIPPED from src/render/vfxBank.ts');
      const keep = new Set(['ramps.png']);
      for (const m of decl[1]!.matchAll(/'([^']+)'/g)) {
        keep.add(`flipbooks/${m[1]}_pack.png`);
        keep.add(`flipbooks/${m[1]}_mv.png`);
      }
      const sweep = (dir: string): void => {
        for (const f of readdirSync(dir)) {
          const p = path.join(dir, f);
          if (statSync(p).isDirectory()) {
            sweep(p);
          } else if (!keep.has(path.relative(bankDir, p).split(path.sep).join('/'))) {
            bytes += statSync(p).size;
            rmSync(p);
            removed++;
          }
        }
      };
      sweep(bankDir);
    }
    console.log(
      `[prune-dist-art] removed ${removed} source-art entries (${(bytes / 1048576).toFixed(1)}MB) from dist`
    );
  }
});

export default defineConfig({
  base: './',
  publicDir: 'assets',
  plugins: [uiThemeEndpoint(), asset3dStore(), editorMapStore(), pruneDistArt()],
  server: {
    port: 5173,
    strictPort: false
  },
  preview: {
    // Overridable so two verifies can run side by side. Several agents share this
    // checkout; with ONE port and ONE dist, the second `vite preview` reuses the
    // first (playwright's reuseExistingServer) and each run's browser reads the
    // OTHER run's build. That is invisible: every failure lands somewhere else,
    // in code neither side touched. Set EMBERKEEP_PREVIEW_PORT + EMBERKEEP_DIST
    // to the same values in both, and the runs stop crossing.
    port: Number(process.env.EMBERKEEP_PREVIEW_PORT ?? 4173),
    strictPort: true
  },
  build: {
    outDir: process.env.EMBERKEEP_DIST ?? 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1600
  }
});
