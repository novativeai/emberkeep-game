import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';

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
 * Dev-only endpoint for the worldbuilder Merge page (tools/worldbuilder, 🔮 tab):
 *   GET  /__worldbuilder/merge → { chains, anchors } (current src/data docs)
 *   POST /__worldbuilder/merge → validate + apply a merge export: writes
 *        chains.json, decodes uploaded art into assets/sprites/items/wb/, and
 *        wires assets.json/anchors.json — same logic as scripts/ingest-merge.mjs.
 * CORS is open because the tool is usually opened from :8820 or file://.
 */
const worldbuilderMergeEndpoint = (): Plugin => ({
  name: 'emberkeep-worldbuilder-merge',
  configureServer(server: ViteDevServer) {
    server.middlewares.use('/__worldbuilder/merge', (req, res) => {
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
        res.end(
          JSON.stringify({
            chains: JSON.parse(readFileSync(path.resolve(__dirname, 'src/data/chains.json'), 'utf8')),
            anchors: JSON.parse(readFileSync(path.resolve(__dirname, 'src/data/anchors.json'), 'utf8'))
          })
        );
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: Buffer) => (body += chunk.toString()));
        req.on('end', () => {
          void (async () => {
            try {
              const { applyMergeDoc } = await import('./scripts/apply-merge.mjs');
              const summary = applyMergeDoc(JSON.parse(body), __dirname);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, summary }));
            } catch (e) {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
            }
          })();
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
    const dist = path.resolve(__dirname, 'dist');
    if (!existsSync(dist)) return;
    const SOURCE_ONLY = [
      'raw/ai', // placeholder sources — TextureFactory paints these at runtime
      // VFX bank (docs/vfx-textures.md): `raw/vfx-sources` is the CC0 pack art
      // the bank is baked FROM and is never loaded at runtime.
      //
      // `vfx-bank` itself is now PARTLY shipped: the game loads `ramps.png` plus
      // the `_pack`/`_mv` pair of every sheet in `SHIPPED` (src/render/vfxBank.ts).
      // Those survive; the graded colour sheets, the unshipped flipbooks and the
      // authoring manifests are workspace-only and are dropped by
      // `pruneVfxBank` below. Widen SHIPPED and the prune follows automatically.
      'raw/vfx-sources',
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

    // VFX bank: keep ONLY what the runtime loads — the ramp LUT plus the
    // `_pack`/`_mv` pair for each shipped sheet. The graded colour sheets are
    // the bake INPUT, the other flipbooks are unshipped, and the manifests are
    // authoring data; none are fetched by the game. Derived from the same
    // SHIPPED list the loader uses, so this cannot drift out of sync.
    const bankDir = path.join(dist, 'vfx-bank');
    if (existsSync(bankDir)) {
      const src = readFileSync(path.resolve(__dirname, 'src/render/vfxBank.ts'), 'utf8');
      const decl = /export const SHIPPED\s*=\s*\[([^\]]*)\]/.exec(src);
      if (!decl) throw new Error('[prune-dist-art] could not read SHIPPED from src/render/vfxBank.ts');
      const shipped = [...decl[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
      const keep = new Set(['ramps.png']);
      for (const key of shipped) {
        keep.add(path.join('flipbooks', `${key}_pack.png`));
        keep.add(path.join('flipbooks', `${key}_mv.png`));
      }
      const sweep = (dir: string): void => {
        for (const f of readdirSync(dir)) {
          const p = path.join(dir, f);
          const rel = path.relative(bankDir, p);
          if (statSync(p).isDirectory()) {
            sweep(p);
            if (readdirSync(p).length === 0) rmSync(p, { recursive: true });
          } else if (!keep.has(rel)) {
            bytes += statSync(p).size;
            rmSync(p);
            removed++;
          }
        }
      };
      sweep(bankDir);
      const kept = existsSync(bankDir) ? [...keep].filter((k) => existsSync(path.join(bankDir, k))) : [];
      if (kept.length !== keep.size) {
        this.warn(
          `[prune-dist-art] VFX bank: expected ${keep.size} runtime files, found ${kept.length}. ` +
            `Missing: ${[...keep].filter((k) => !existsSync(path.join(bankDir, k))).join(', ')}`
        );
      }
    }
    console.log(
      `[prune-dist-art] removed ${removed} source-art entries (${(bytes / 1048576).toFixed(1)}MB) from dist`
    );
  }
});

export default defineConfig({
  base: './',
  publicDir: 'assets',
  plugins: [uiThemeEndpoint(), worldbuilderMergeEndpoint(), pruneDistArt()],
  server: {
    port: 5173,
    strictPort: false
  },
  preview: {
    port: 4173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1600
  }
});
