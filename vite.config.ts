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
    console.log(
      `[prune-dist-art] removed ${removed} source-art entries (${(bytes / 1048576).toFixed(1)}MB) from dist`
    );
  }
});

export default defineConfig({
  base: './',
  publicDir: 'assets',
  plugins: [uiThemeEndpoint(), pruneDistArt()],
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
