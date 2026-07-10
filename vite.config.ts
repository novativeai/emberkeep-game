import { readFileSync, writeFileSync } from 'node:fs';
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

export default defineConfig({
  base: './',
  publicDir: 'assets',
  plugins: [uiThemeEndpoint()],
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
