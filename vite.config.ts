import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import { createEventsApi } from './tools/events-api/server';
import { createTutorialApi } from './tools/tutorial-api/server';

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
 * Dev-only endpoint for the FX Lab (tools/fxlab):
 *   GET  /__fxlab/presets → current src/data/fx-emitters.json
 *   POST /__fxlab/presets → validate + write it
 *
 * The game BUNDLES this file, so a save from the lab lands in the real game
 * rather than in a copy — the same contract the UI Builder theme endpoint has.
 * Validation is structural only (the authoritative check is
 * `validatePresetFile` in src/render/fx/emitterTypes.ts, which the unit test
 * runs); this just refuses to overwrite good data with something that is not a
 * preset document at all.
 */
const fxLabPresetsEndpoint = (): Plugin => ({
  name: 'emberkeep-fxlab-presets',
  configureServer(server: ViteDevServer) {
    const file = path.resolve(__dirname, 'src/data/fx-emitters.json');
    server.middlewares.use('/__fxlab/presets', (req, res) => {
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
            const doc = JSON.parse(body) as { version?: number; presets?: Record<string, { layers?: unknown }> };
            if (doc.version !== 1) throw new Error('version must be 1');
            const presets = Object.values(doc.presets ?? {});
            if (!presets.length) throw new Error('no presets');
            for (const p of presets) if (!Array.isArray(p.layers) || !p.layers.length) throw new Error('a preset has no layers');
            writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
            res.setHeader('Content-Type', 'application/json');
            res.end('{"ok":true}');
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
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
 * Dev-only endpoint for the Aurora Lab (tools/auroralab):
 *   GET  /__auroralab/presets → current src/data/aurora.json
 *   POST /__auroralab/presets → validate + write it
 *
 * Same contract as the FX Lab: the game bundles this file, so a save lands in
 * the real game rather than in a copy. The authoritative check is
 * `validateAuroraFile` in src/render/fx/AuroraFX.ts (which the unit test runs);
 * this only refuses a body that is not an aurora document at all.
 */
const auroraLabEndpoint = (): Plugin => ({
  name: 'emberkeep-auroralab-presets',
  configureServer(server: ViteDevServer) {
    const file = path.resolve(__dirname, 'src/data/aurora.json');
    server.middlewares.use('/__auroralab/presets', (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (req.method === 'GET') {
        res.end(readFileSync(file, 'utf8'));
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: Buffer) => (body += chunk.toString()));
        req.on('end', () => {
          try {
            const doc = JSON.parse(body) as { version?: number; presets?: Record<string, { layers?: unknown }> };
            if (doc.version !== 1) throw new Error('version must be 1');
            const presets = Object.values(doc.presets ?? {});
            if (!presets.length) throw new Error('no presets');
            for (const p of presets) {
              if (!Array.isArray(p.layers) || !p.layers.length) throw new Error('a preset has no layers');
            }
            writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
            res.end('{"ok":true}');
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
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
 * Dev-only endpoint for the Snow Lab (tools/snowlab):
 *   GET  /__snowlab/presets → current src/data/snow.json
 *   POST /__snowlab/presets → validate + write it
 *
 * Same contract as the Aurora Lab. The authoritative check is `validateSnowFile`
 * in src/render/fx/snowConfig.ts (which the unit test runs); this only refuses a
 * body that is not a snow document at all.
 */
const snowLabEndpoint = (): Plugin => ({
  name: 'emberkeep-snowlab-presets',
  configureServer(server: ViteDevServer) {
    const file = path.resolve(__dirname, 'src/data/snow.json');
    server.middlewares.use('/__snowlab/presets', (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (req.method === 'GET') {
        res.end(readFileSync(file, 'utf8'));
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: Buffer) => (body += chunk.toString()));
        req.on('end', () => {
          try {
            const doc = JSON.parse(body) as { version?: number; presets?: Record<string, { planes?: unknown }> };
            if (doc.version !== 1) throw new Error('version must be 1');
            const presets = Object.values(doc.presets ?? {});
            if (!presets.length) throw new Error('no presets');
            for (const p of presets) {
              if (!Array.isArray(p.planes) || !p.planes.length) throw new Error('a preset has no planes');
            }
            writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
            res.end('{"ok":true}');
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
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
 * Dev-only endpoint for the worldbuilder FX page (tools/worldbuilder, 🔥 tab):
 *   GET  /__worldbuilder/emitters → { placements, presets }
 *   POST /__worldbuilder/emitters → validate + write src/data/emitters.json
 *
 * The builder needs the PRESETS as well as the placements: it renders the real
 * `FxEmitterRig` on its map, so it has to know what the presets contain, and
 * fetching them here means the tool cannot be looking at a different roster
 * from the one the game bundles.
 *
 * Validation mirrors `validatePlacementFile` in
 * src/render/fx/emitterPlacements.ts (which the unit test runs against the
 * committed file) — enough to refuse a body that is not a placement document,
 * so a broken POST cannot silently erase authored placements.
 */
/**
 * Dev-only endpoint for the worldbuilder Tutorial page (📜 tab) and the
 * `tutorial-editor` skill: every read and write of src/data/tutorial.json.
 * Routes, ops and validation live in tools/tutorial-api/server.ts (pure,
 * unit-tested); this is only the mount.
 */
/** `/__events` — the Event Creator's API (docs/event-creator.md). */
const eventsEndpoint = (): Plugin => ({
  name: 'events-endpoint',
  configureServer(server) {
    server.middlewares.use('/__events', createEventsApi(__dirname));
  }
});

const tutorialEndpoint = (): Plugin => ({
  name: 'emberkeep-tutorial-api',
  configureServer(server: ViteDevServer) {
    server.middlewares.use('/__tutorial', createTutorialApi(__dirname));
  }
});

const worldbuilderEmittersEndpoint = (): Plugin => ({
  name: 'emberkeep-worldbuilder-emitters',
  configureServer(server: ViteDevServer) {
    const file = path.resolve(__dirname, 'src/data/emitters.json');
    const presetFile = path.resolve(__dirname, 'src/data/fx-emitters.json');
    server.middlewares.use('/__worldbuilder/emitters', (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (req.method === 'GET') {
        res.end(
          JSON.stringify({
            placements: JSON.parse(readFileSync(file, 'utf8')),
            presets: JSON.parse(readFileSync(presetFile, 'utf8'))
          })
        );
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: Buffer) => (body += chunk.toString()));
        req.on('end', () => {
          try {
            const doc = JSON.parse(body) as { version?: number; emitters?: unknown };
            if (doc.version !== 1) throw new Error('version must be 1');
            if (!Array.isArray(doc.emitters)) throw new Error('emitters must be an array');
            const presets = JSON.parse(readFileSync(presetFile, 'utf8')) as { presets: Record<string, unknown> };
            const known = Object.keys(presets.presets ?? {});
            const seen = new Set<string>();
            for (const raw of doc.emitters) {
              const e = raw as { id?: string; preset?: string; world?: string; anchor?: unknown };
              if (!e.id) throw new Error('an emitter has no id');
              if (seen.has(e.id)) throw new Error(`duplicate emitter id "${e.id}"`);
              seen.add(e.id);
              if (!e.preset || !known.includes(e.preset)) throw new Error(`unknown preset "${String(e.preset)}"`);
              if (!e.world) throw new Error(`emitter "${e.id}" has no world`);
              if (!Array.isArray(e.anchor) || e.anchor.length !== 2 || !e.anchor.every((n) => Number.isFinite(n))) {
                throw new Error(`emitter "${e.id}" anchor must be [col, row]`);
              }
            }
            writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
            res.end(JSON.stringify({ ok: true, count: doc.emitters.length }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
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
 * Dev-only endpoint that hands the worldbuilder the map the game is ACTUALLY
 * running: GET /__worldbuilder/map → src/data/map.json.
 *
 * The tool needs this to know where the game's cell (0,0) is. It cannot derive
 * that: ingest fixes the frame by the most-NW placement of whatever document was
 * exported, `map.json` is hand-tuned and never fully regenerated afterwards, and
 * a project that has since lost that NW-most placement renumbers every cell
 * under the tool's feet. The world's BACKGROUND appears in both frames and never
 * moves, so the tool pins itself to the game by matching that one placement
 * (`gameOrigin` in tools/worldbuilder/index.html).
 */
const worldbuilderMapEndpoint = (): Plugin => ({
  name: 'emberkeep-worldbuilder-map',
  configureServer(server: ViteDevServer) {
    server.middlewares.use('/__worldbuilder/map', (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.end();
        return;
      }
      res.end(readFileSync(path.resolve(__dirname, 'src/data/map.json'), 'utf8'));
    });
  }
});

/**
 * Dev-only endpoint for the worldbuilder's 🧩 Worlds & grids page:
 *   GET  /__worldbuilder/zones → current src/data/zones.json (or an empty doc)
 *   POST /__worldbuilder/zones → validate + write src/data/zones.json
 *
 * This is the file the game reads for zones, per-world boards and travel
 * (src/core/world.ts). It is normally GENERATED by `scripts/build-zones.mjs`
 * from the imported editor registry; this endpoint lets the World Builder be
 * the other producer, so a grid can be authored rather than only imported.
 *
 * The validation below is deliberately structural rather than cosmetic — a
 * zones.json that parses but lies about its geometry would put every cell of a
 * world a few hundred pixels off its island, and the failure would look like an
 * art bug rather than a data one.
 */
const worldbuilderZonesEndpoint = (): Plugin => ({
  name: 'emberkeep-worldbuilder-zones',
  configureServer(server: ViteDevServer) {
    server.middlewares.use('/__worldbuilder/zones', (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Content-Type', 'application/json');
      const file = path.resolve(__dirname, 'src/data/zones.json');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (req.method === 'GET') {
        if (!existsSync(file)) {
          res.end(JSON.stringify({ format: 'emberkeep-zones', version: 1, worlds: [] }));
          return;
        }
        res.end(readFileSync(file, 'utf8'));
        return;
      }
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end();
        return;
      }
      // `?dryRun=1` runs the whole validation and reports, without touching the
      // file — what a regression harness needs so it can exercise the REAL
      // validator rather than a copy of its rules that could drift from it.
      const dryRun = /[?&]dryRun=1\b/.test(req.url ?? '');
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        try {
          const doc = JSON.parse(body) as {
            format?: string;
            worlds?: {
              id?: string;
              zones?: {
                id?: string;
                block?: number[];
                matrix?: number[];
                origin?: number[];
                u?: number[];
                v?: number[];
                pivot?: number[];
                cells?: number[][];
              }[];
              portals?: { id?: string; to?: string; rect?: number[] }[];
            }[];
          };
          if (doc.format !== 'emberkeep-zones') throw new Error('not an emberkeep-zones document');
          const worlds = doc.worlds ?? [];
          if (!Array.isArray(worlds) || worlds.length === 0) throw new Error('no worlds');
          const seenWorlds = new Set<string>();
          let zoneCount = 0;
          let cellCount = 0;
          let portalCount = 0;
          for (const w of worlds) {
            if (!w.id) throw new Error('a world has no id');
            if (seenWorlds.has(w.id)) throw new Error(`duplicate world id "${w.id}"`);
            seenWorlds.add(w.id);
            const seenZones = new Set<string>();
            // Index blocks must not overlap, or two grids would share addresses
            // and a piece saved on one would load onto the other.
            const taken: { c0: number; c1: number; r0: number; r1: number; id: string }[] = [];
            for (const z of w.zones ?? []) {
              if (!z.id) throw new Error(`${w.id}: a grid has no id`);
              if (seenZones.has(z.id)) throw new Error(`${w.id}: duplicate grid id "${z.id}"`);
              seenZones.add(z.id);
              const nums = [z.block, z.matrix, z.origin, z.u, z.v, z.pivot];
              if (nums.some((a) => !Array.isArray(a) || a.length !== 2 || a.some((n) => !Number.isFinite(n)))) {
                throw new Error(`${w.id}/${z.id}: block/matrix/origin/u/v/pivot must each be two finite numbers`);
              }
              const [cols, rows] = z.matrix as number[];
              if (cols < 1 || rows < 1) throw new Error(`${w.id}/${z.id}: empty matrix`);
              // A degenerate basis is not invertible — the renderer could place
              // a cell but never find one again.
              const det = (z.u as number[])[0] * (z.v as number[])[1] - (z.v as number[])[0] * (z.u as number[])[1];
              if (!Number.isFinite(det) || Math.abs(det) < 1e-6) {
                throw new Error(`${w.id}/${z.id}: u and v are parallel — the grid has no area`);
              }
              const [bc, br] = z.block as number[];
              const box = { c0: bc, c1: bc + cols - 1, r0: br, r1: br + rows - 1, id: z.id };
              for (const t of taken) {
                if (box.c0 <= t.c1 && t.c0 <= box.c1 && box.r0 <= t.r1 && t.r0 <= box.r1) {
                  throw new Error(`${w.id}: grids "${t.id}" and "${z.id}" claim overlapping cell addresses`);
                }
              }
              taken.push(box);
              for (const c of z.cells ?? []) {
                if (!Array.isArray(c) || c.length !== 2) throw new Error(`${w.id}/${z.id}: bad cell`);
                if (c[0] < 0 || c[1] < 0 || c[0] >= cols || c[1] >= rows) {
                  throw new Error(`${w.id}/${z.id}: cell ${c[0]},${c[1]} is outside its ${cols}×${rows} matrix`);
                }
                cellCount++;
              }
              zoneCount++;
            }
            // Portals are INVISIBLE rectangles, so every one of these mistakes
            // is a door that looks perfectly fine and does nothing when tapped.
            // They cost nothing to catch here and are near-impossible to
            // diagnose on the board.
            const seenPortals = new Set<string>();
            for (const p of w.portals ?? []) {
              if (!p.id) throw new Error(`${w.id}: a portal has no id`);
              if (seenPortals.has(p.id)) throw new Error(`${w.id}: duplicate portal id "${p.id}"`);
              seenPortals.add(p.id);
              const r = p.rect;
              if (!Array.isArray(r) || r.length !== 4 || r.some((n) => !Number.isFinite(n))) {
                throw new Error(`${w.id}/${p.id}: rect must be four finite numbers [x, y, w, h]`);
              }
              if ((r[2] as number) <= 0 || (r[3] as number) <= 0) {
                throw new Error(`${w.id}/${p.id}: a portal with no width or height can never be tapped`);
              }
              if (!p.to) throw new Error(`${w.id}/${p.id}: portal leads nowhere`);
              if (p.to === w.id) throw new Error(`${w.id}/${p.id}: portal leads to its own world`);
              portalCount++;
            }
          }
          // Checked across ALL worlds, so it has to wait for the loop to finish:
          // a door may legitimately name a world declared later in the document.
          for (const w of worlds) {
            for (const p of w.portals ?? []) {
              if (!seenWorlds.has(p.to as string)) {
                throw new Error(`${w.id}/${p.id}: leads to unknown world "${p.to}"`);
              }
            }
          }
          if (!dryRun) writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
          res.end(JSON.stringify({
            ok: true,
            dryRun,
            worlds: worlds.length,
            zones: zoneCount,
            cells: cellCount,
            portals: portalCount,
            note: `${worlds.length} worlds, ${zoneCount} grids, ${cellCount} cells, ${portalCount} portals validated${dryRun ? ' (dry run — nothing written)' : ''}.`
          }));
        } catch (e) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
        }
      });
    });
  }
});

/**
 * Dev-only endpoint for the worldbuilder Characters tab (tools/worldbuilder, 🧝):
 *   GET  /__worldbuilder/characters → current src/data/characters.json
 *   POST /__worldbuilder/characters { characters: [{id, world?, col, row, dx?, dy?}] }
 *        → rewrites the `anchor` + `dx`/`dy` of each one (scripts/
 *          apply-characters.mjs, the same implementation the export → ingest
 *          route uses). Only her POSITION moves — action/cooldown stay design
 *          data.
 * Cells arrive already in GAME grid space (the builder normalises them the way
 * ingest does) and dx/dy in builder pixels, so a placement here is exactly where
 * the game renders her.
 */
const worldbuilderCharactersEndpoint = (): Plugin => ({
  name: 'emberkeep-worldbuilder-characters',
  configureServer(server: ViteDevServer) {
    server.middlewares.use('/__worldbuilder/characters', (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (req.method === 'GET') {
        res.end(readFileSync(path.resolve(__dirname, 'src/data/characters.json'), 'utf8'));
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: Buffer) => (body += chunk.toString()));
        req.on('end', () => {
          void (async () => {
            try {
              const { applyCharacters } = await import('./scripts/apply-characters.mjs');
              const summary = applyCharacters(JSON.parse(body), __dirname);
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
 * Dev-only endpoint for the worldbuilder Island generator (tools/worldbuilder, 🏝 tab):
 *   POST /__worldbuilder/island {action:'preview', ...spec}
 *     → tools/mapmask/island.py — fits the tile lattice into the drawn shapes
 *       (hugging the right rim), hangs the rock skirt below them by the border
 *       law, and returns the map mask as data URLs plus per-island stats.
 *   POST /__worldbuilder/island {action:'generate', prompt, mask, reference?, name}
 *     → .claude/skills/nano-banana/scripts/artgen.py map-seedream — renders the
 *       island from that mask (plus an optional style reference) with Seedream
 *       5.0 Pro into assets/raw/map-gen/islands/.
 * Both shell out to the scripts the CLI pipelines already use, so there is one
 * implementation of each step. Generation is server-side because it needs FAL_KEY.
 */
const worldbuilderIslandEndpoint = (): Plugin => ({
  name: 'emberkeep-worldbuilder-island',
  configureServer(server: ViteDevServer) {
    const PY = process.env.PYTHON ?? 'python3';
    const OUT_DIR = path.resolve(__dirname, 'assets/raw/map-gen/islands');

    const python = (args: string[], stdin?: string) =>
      new Promise<{ code: number; out: string; err: string }>((resolve) => {
        const proc = spawn(PY, args, { cwd: __dirname });
        let out = '';
        let err = '';
        proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
        proc.stderr.on('data', (d: Buffer) => (err += d.toString()));
        proc.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
        proc.on('close', (code) => resolve({ code: code ?? -1, out, err }));
        if (stdin !== undefined) proc.stdin.end(stdin);
      });

    /** `data:image/png;base64,…` → a real file, so artgen can take it as -i. */
    const writeDataUrl = (dataUrl: string, file: string) => {
      const comma = dataUrl.indexOf(',');
      if (!dataUrl.startsWith('data:') || comma < 0) throw new Error('not a data URL');
      writeFileSync(file, Buffer.from(dataUrl.slice(comma + 1), 'base64'));
    };

    server.middlewares.use('/__worldbuilder/island', (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end('{"ok":false,"error":"POST only"}');
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        // A reference photo plus a 2610x1632 mask is a few MB; anything past
        // this is a mistake, and buffering it would be the server's problem.
        if (size > 64 * 1024 * 1024) req.destroy();
        else chunks.push(chunk);
      });
      req.on('end', () => {
        void (async () => {
          try {
            const doc = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
            const action = doc.action ?? 'preview';

            if (action === 'preview') {
              const { action: _drop, ...spec } = doc;
              const r = await python([path.resolve(__dirname, 'tools/mapmask/island.py'), '--stdin'],
                                     JSON.stringify(spec));
              if (r.code !== 0 || !r.out.trim()) {
                throw new Error(r.err.trim() || `island.py exited ${r.code}`);
              }
              res.end(r.out);
              return;
            }

            if (action === 'generate') {
              const prompt = String(doc.prompt ?? '').trim();
              if (!prompt) throw new Error('the prompt is empty');
              if (typeof doc.mask !== 'string') throw new Error('build the island first');
              const name = (String(doc.name ?? 'island').toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
                .replace(/^-+|-+$/g, '') || 'island');
              const work = path.join(OUT_DIR, '.work');
              mkdirSync(work, { recursive: true });
              const maskFile = path.join(work, `${name}-mask.png`);
              writeDataUrl(doc.mask, maskFile);
              const refs = ['-i', maskFile];
              if (typeof doc.reference === 'string' && doc.reference.startsWith('data:')) {
                const refFile = path.join(work, `${name}-ref.png`);
                writeDataUrl(doc.reference, refFile);
                refs.push('-i', refFile);
              }
              const dst = path.join(OUT_DIR, `${name}.jpg`);
              writeFileSync(path.join(OUT_DIR, `${name}.prompt.txt`), prompt + '\n');
              const r = await python([
                path.resolve(__dirname, '.claude/skills/nano-banana/scripts/artgen.py'),
                'map-seedream', prompt, ...refs, '-o', dst
              ]);
              if (r.code !== 0 || !existsSync(dst)) {
                throw new Error((r.err || r.out).trim().split('\n').pop() || `artgen exited ${r.code}`);
              }
              res.end(JSON.stringify({
                ok: true,
                image: 'data:image/jpeg;base64,' + readFileSync(dst).toString('base64'),
                file: path.relative(__dirname, dst),
                log: (r.out || r.err).trim().split('\n').pop()
              }));
              return;
            }
            throw new Error(`unknown action ${String(action)}`);
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
          }
        })();
      });
    });
  }
});

/**
 * Deploy slimming: `assets/` (the publicDir) doubles as the art WORKSPACE —
 * AE frame sources, reference shots, uncropped masters and the PNG originals of
 * webp-converted sprites live there for future editing but are never requested
 * at runtime, and they are 2.2 GB of its 2.8 GB.
 *
 * So Vite's own publicDir copy is OFF (`build.copyPublicDir: false`) and this
 * plugin does the copy through a FILTER. It used to copy all 2.8 GB into dist
 * and then delete most of it again — >2 GB of disk dirtied per build to throw
 * the majority away, on top of whatever else was writing at the time. Filtering
 * on the way in writes only what ships. Three rules:
 *   1. an explicit list of source-only dirs/files;
 *   2. under `sprites/`, any .png whose sibling .webp exists (the webp is what
 *      assets.json references; the png is the kept master);
 *   3. under `vfx-bank/`, only the files the runtime actually loads.
 */
const copyRuntimeArt = (): Plugin => ({
  name: 'emberkeep-copy-runtime-art',
  apply: 'build',
  closeBundle() {
    const publicDir = path.resolve(__dirname, 'assets');
    const dist = path.resolve(__dirname, process.env.EMBERKEEP_DIST ?? 'dist'); // lane-isolated, like build.outDir
    if (!existsSync(publicDir)) return;
    // `raw/` is the GENERATION WORKSPACE and is DEFAULT-DENY: every art run
    // (dragons, characters, shop/bag concepts, merge chains, UI kits…) drops
    // its full-resolution masters there, and naming the offenders one by one
    // meant every new run silently re-entered the deploy — this pass alone had
    // 2.1 GB of it inside `dist`, over Vercel's ceiling and 25x the hub's copy.
    // Only what the RUNNING GAME fetches is listed here; keep this in step with
    // the `raw/` paths in src/data/assets.json (`raw/ai` is referenced there
    // too, but is a placeholder set TextureFactory paints at runtime, so it
    // stays out and the loader's fallback chain covers it).
    const RAW_SHIPPED = ['raw/screamingbrain'];
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
      // AI map generations + their briefs (assets/raw/map-gen/README.md).
      // Concept art at full generation resolution — 145 MB and climbing, none
      // of it requested at runtime. The chosen map gets promoted into
      // `sprites/background/` as a sized, converted file like any other sprite.
      'raw/map-gen',
      'raw/screamingbrain/Overworld - Large',
      'position-reference',
      'sprites/background/title-screen-background.jpg', // byte-dup of sprites/ui/
      'sprites/environment/level-blocker/cloud/cloud-non-cropped.png',
      // Character AE/Sprite-Studio exports — the game and the builder use the
      // downscaled `sprites/<name>/` copies and the baked disc atlas.
      'sprites/characters/eleanor',
      'sprites/characters/selyna',
      // Same rule for the merge-style bubble art: the game loads the downscaled
      // `sprites/<who>-merge/` copies and the baked disc atlas, never these
      // full-resolution frame exports (211 MB, no reference anywhere in src).
      'sprites/characters-merge',
      // Superseded / never-referenced art, each verified against the reference
      // graph (`node scripts/audit-art.mjs`) rather than by eye:
      'sprites/background/emberkeep.jpg', //  background_emberkeep points at emberkeep-nb2.webp
      // The hand-drawn emerald. `item_crystal_1` now points at crystal-still.webp
      // — one frame of the SAME three.js gem the board renders live, so the still
      // and the spin sheet and the live render are finally all the same object.
      // Kept in the workspace as the original art; nothing loads it.
      'sprites/items/crystal.webp',
      // The two hub backdrops swapped places on 2026-08-12: the editor replaced
      // its Hatchery map with Runevault and drew a grid on it, so Runevault is
      // the world Borealis's Rune Way now opens onto and ships like any other
      // backdrop, while hatchery.webp has nothing left that can ask for it.
      'sprites/background/hatchery.webp', //  no world, no zone, no assets.json key
      'sprites/environment/full-water-bg',
      'sprites/environment/level-blocker', //  superseded by sprites/environment/blockers/
      'sprites/environment/blockers/cloud/cloud-cropped', // cloud_tile is the shipped one
      'sprites/environment/map/grass-tiles', // tile pack: no cell in any world places one
      'sprites/bg-tile',
      'sprites/level1',
      'sprites/rewards',
      'sprites/merge/rubis-transparent_002',
      'sprites/merge/rubis-transparent_004',
      'sprites/ui/icon_store', //  the shipped Store icon is the one in sprites/ui/store/
      'sprites/items/black-egg',
      'sprites/items/emerald-egg',
      'sprites/items/key', //  icon_key_bronze / ui_icon_key use key-icon
      'sprites/items/stone',
      'sprites/characters/dragon/golden-dragon/golden-egg', // items/golden-egg.webp ships
      'sprites/characters/dragon/golden-dragon/golden-egg-sunset',
      'map', //  World Builder project files — the game reads src/data/map.json
      'atlases' //  empty scaffold
    ];
    /**
     * The same rule, as PATTERNS, for what recurs per character and per dragon.
     *
     * These are the categories a new breed or a re-bake creates more of every
     * time, so naming instances would go stale by the next art run:
     *
     *  · `.rigproject.json` — the rigger's project file beside its export. It is
     *    the same 1.2 MB of base64 as the `.rig.json` the game loads, twice over.
     *  · rig / sprite PART images — a rig carries its layers INSIDE the json as
     *    data URIs (RigPlayer reads `rig.images`), and a board skin ships as the
     *    baked `*-baked.webp` that assets.json names. The loose part PNGs beside
     *    them are what the rigger consumed, not what the game fetches.
     *  · the guides' bake INPUTS — `sprites/<who>/{talk_*,blink,eyelids,
     *    expressions,visemes,rest,portrait,disc-atlas}`. What the bubble loads is
     *    `sprites/<who>-merge/disc-atlas.png`; what the board loads is
     *    `world-idle/-cast.webp`, and those two stay.
     *  · authoring sidecars — `frames.json` (superseded at runtime by the
     *    calibrated src/data/faces.json), Sprite Studio's `catalog.json`, tile
     *    `manifest.json`/`preview.png`, README notes, and .DS_Store.
     */
    const SOURCE_ONLY_PATTERNS: RegExp[] = [
      /\.rigproject\.json$/,
      /^sprites\/characters\/dragon\/[^/]+\/rig[^/]*\/.+\.(png|jpg|webp)$/,
      // …and the same for the sprite folders, EXCEPT the baked board art
      // (`*-baked.webp`), which is what assets.json names for a skin.
      /^sprites\/characters\/dragon\/[^/]+\/sprite[^/]*\/(?!.*-baked\.webp$).+\.(png|jpg|webp)$/,
      /^sprites\/(eleanor|selyna)\/(talk_|blink\/|eyelids\/|expressions\/|visemes\/)/,
      /^sprites\/(eleanor|selyna)\/(rest|portrait|disc-atlas)\.(png|webp)$/,
      /^sprites\/(eleanor|selyna)-merge\/portrait\.(png|webp)$/,
      /^sprites\/(eleanor|selyna)\/(world-standee|visemes)\.(webp|json)$/, // pre-bake stills
      /^sprites\/items\/wood\.(png|webp)$/, //  superseded by the lumber chain icons
      /(^|\/)(frames|catalog|manifest)\.json$/,
      /(^|\/)preview\.(png|webp)$/,
      /(^|\/)README[^/]*\.(txt|md)$/,
      /(^|\/)\.DS_Store$/,
      /-raw\.(png|webp)$/ //  trailer/legend generation masters beside their sized copies
    ];
    /**
     * A speaker with a DISC ATLAS ships the atlas, not the frames it was baked
     * from — they are the same pixels twice (35 MB of the second copy).
     *
     * `sprites/<who>-merge/{talk_*,blink,rest.png}` is what
     * `scripts/bake-portrait-disc.py` consumed; the bubble draws
     * `disc-atlas.png` and nothing else (CharacterBubble → discTextureFor).
     * The loose frames have exactly one consumer left — the UI Builder's
     * Animations rail, which is a dev tool served straight out of `assets/` by
     * `pnpm dev`, and `referencedBuiltins` already means the game itself fetches
     * a bank only when a saved ui-theme component names one.
     *
     * Derived from ANIMATED_SPEAKERS, so a speaker who has no atlas — the Golden
     * Elder, whose banks EMB-24 is about to drive — keeps her frames.
     */
    const atlasSpeakers = (
      readFileSync(path.resolve(__dirname, 'src/entities/PortraitAnimator.ts'), 'utf8').match(
        /ANIMATED_SPEAKERS\s*=\s*\[([^\]]*)\]/
      )?.[1] ?? ''
    )
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);
    if (atlasSpeakers.length === 0)
      throw new Error('[copy-runtime-art] could not read ANIMATED_SPEAKERS — did PortraitAnimator move?');
    const bakedIntoAtlas = (rel: string): boolean =>
      atlasSpeakers.some((who) => rel.startsWith(`sprites/${who}-merge/`)) &&
      // The atlas itself is the one file the folder exists to ship — as WebP
      // (lossless, 58% smaller) with the PNG master beside it for the baker.
      !/\/disc-atlas\.(png|webp)$/.test(rel);

    // Rigs: keep ONLY the ones a scene can actually ask for. Each rig json
    // carries its own layer art as data URIs, so an unreferenced one is ~1.2 MB
    // of art for a dragon nothing can spawn — and the skin rigs are exactly
    // that: a worn skin swaps the BAKED `skin_<id>_<tier>` texture (BoardScene),
    // it does not load a second rig. Derived from the two files that name rig
    // urls, so a newly registered rig ships the moment it is registered.
    const rigKeep = new Set<string>();
    for (const file of ['src/render/characterCatalog.ts', 'src/scenes/BoardScene.ts']) {
      const src = readFileSync(path.resolve(__dirname, file), 'utf8');
      for (const [, url] of src.matchAll(/'(sprites\/[^']*\.rig\.json)'/g)) rigKeep.add(url);
    }
    if (rigKeep.size === 0) throw new Error('[copy-runtime-art] no rig urls found — did the catalog move?');
    // VFX bank: keep ONLY what the runtime loads — the ramp LUT plus the
    // `_pack`/`_mv` pair for each shipped sheet. The graded colour sheets are
    // the bake INPUT, the other flipbooks are unshipped, and the manifests are
    // authoring data; none are fetched by the game. Derived from the same
    // SHIPPED list the loader uses, so this cannot drift out of sync.
    const bankKeep = new Set(['ramps.png']);
    {
      const src = readFileSync(path.resolve(__dirname, 'src/render/vfxBank.ts'), 'utf8');
      const decl = /export const SHIPPED\s*=\s*\[([^\]]*)\]/.exec(src);
      if (!decl) throw new Error('[copy-runtime-art] could not read SHIPPED from src/render/vfxBank.ts');
      for (const [, key] of decl[1].matchAll(/'([^']+)'/g)) {
        bankKeep.add(`flipbooks/${key}_pack.png`);
        bankKeep.add(`flipbooks/${key}_mv.png`);
      }
      // …plus the particle stills the world emitters reference. PreloadScene
      // always queues these (they are a few KB each), so dropping them turns
      // every build into a wall of loader errors — read the preset file rather
      // than restating the list, so the two cannot drift.
      const presets = JSON.parse(
        readFileSync(path.resolve(__dirname, 'src/data/fx-emitters.json'), 'utf8')
      ) as { textures?: Record<string, string> };
      for (const rel of Object.values(presets.textures ?? {})) bankKeep.add(rel);
    }

    let copied = 0;
    let copiedBytes = 0;
    let skipped = 0;
    let skippedBytes = 0;
    const sizeOf = (p: string): number => {
      const st = statSync(p);
      if (!st.isDirectory()) return st.size;
      return readdirSync(p).reduce((a, f) => a + sizeOf(path.join(p, f)), 0);
    };
    /** `false` prunes the whole subtree — the filter is never called below it. */
    const ships = (from: string): boolean => {
      const rel = path.relative(publicDir, from).split(path.sep).join('/');
      if (!rel) return true; // the publicDir itself
      const isDir = statSync(from).isDirectory();
      // An entry matches a path, a directory prefix, or a path with its
      // extension taken off — so naming a file names the ART, not the container
      // it happens to be in today. `optimize-art.py --project` re-encodes a PNG
      // master to WebP and deletes the PNG; an extension-pinned rule would have
      // silently stopped matching and let the file back into the deploy.
      const stem = rel.replace(/\.[A-Za-z0-9]+$/, '');
      if (SOURCE_ONLY.some((s) => rel === s || stem === s || rel.startsWith(`${s}/`))) return false;
      if (!isDir && SOURCE_ONLY_PATTERNS.some((re) => re.test(rel))) return false;
      if (!isDir && rel.endsWith('.rig.json') && !rigKeep.has(rel)) return false;
      if (!isDir && bakedIntoAtlas(rel)) return false;
      // Default-deny the workspace: `raw` itself ships (it has kept children),
      // anything under it must be on — or an ancestor of — RAW_SHIPPED.
      if (rel === 'raw' || rel.startsWith('raw/')) {
        if (rel !== 'raw' && !RAW_SHIPPED.some((k) => rel === k || rel.startsWith(`${k}/`) || k.startsWith(`${rel}/`)))
          return false;
      }
      if (!isDir && rel.startsWith('sprites/') && rel.endsWith('.png')) {
        if (existsSync(from.replace(/\.png$/, '.webp'))) return false;
      }
      if (rel === 'vfx-bank' || rel.startsWith('vfx-bank/')) {
        const inBank = rel.slice('vfx-bank/'.length);
        if (rel === 'vfx-bank') return true;
        // A directory ships only if a kept file lives under it, so the bank
        // arrives with no empty scaffolding.
        return isDir
          ? [...bankKeep].some((k) => k.startsWith(`${inBank}/`))
          : bankKeep.has(inBank);
      }
      return true;
    };
    cpSync(publicDir, dist, {
      recursive: true,
      filter: (from) => {
        const keep = ships(from);
        const isDir = statSync(from).isDirectory();
        if (keep) {
          if (!isDir) {
            copied++;
            copiedBytes += statSync(from).size;
          }
        } else {
          skipped++;
          skippedBytes += sizeOf(from);
        }
        return keep;
      }
    });
    // Ship data JSON minified. parse→stringify is structurally lossless, and the
    // sources stay pretty on disk (the rig editor and git diffs read them). The
    // saving is honest but small — the rig JSONs' bulk is base64 layer art, not
    // whitespace. In DIST only, after the copy, so nothing upstream ever sees a
    // minified file.
    let jsonSaved = 0;
    for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const file = path.join(entry.parentPath, entry.name);
      try {
        const raw = readFileSync(file, 'utf8');
        const min = JSON.stringify(JSON.parse(raw));
        if (min.length < raw.length) {
          writeFileSync(file, min);
          jsonSaved += raw.length - min.length;
        }
      } catch {
        // Not JSON after all (or unreadable) — ship it untouched.
      }
    }
    console.log(`[copy-runtime-art] minified shipped JSON: ${(jsonSaved / 1048576).toFixed(1)}MB saved`);

    // Keep Spotlight out of dist. 1.5 GB is rewritten here on every build, and
    // mds_stores re-indexes all of it each time — nobody has ever Spotlight-searched
    // a build output. `emptyOutDir` deletes the marker with everything else, so it
    // is re-written here rather than left as a file someone has to remember.
    writeFileSync(path.join(dist, '.metadata_never_index'), '');

    const missing = [...bankKeep].filter((k) => !existsSync(path.join(dist, 'vfx-bank', k)));
    if (missing.length) {
      this.warn(`[copy-runtime-art] VFX bank: ${missing.length} runtime file(s) missing: ${missing.join(', ')}`);
    }
    console.log(
      `[copy-runtime-art] copied ${copied} art files (${(copiedBytes / 1048576).toFixed(1)}MB) into dist; ` +
        `skipped ${skipped} source-only entries (${(skippedBytes / 1048576).toFixed(1)}MB never written)`
    );
  }
});

/* ── Dev-server watch scope ─────────────────────────────────────────────────
 * The repo root holds far more than the game: `assets/raw` (2.2 GB of art
 * workspace, which the island endpoint above writes into), `embergames/` (a
 * whole Next.js hub with its OWN dev server and its own public/ copy of dist),
 * `path-of-embers/`, `.claude/worktrees/` (full repo checkouts). Vite's default
 * chokidar ignore list is only `.git`, `node_modules`, `test-results` and the
 * outDir, so all of that was watched recursively through fsevents — and any
 * second writer in the tree (the hub's `next dev`, `sync:game`, an art
 * generation run, an agent worktree) turned every write into invalidate →
 * full-reload → Rolldown rebundle across every core, for as long as it ran.
 *
 * The watcher is therefore an ALLOW-list: only the directories the running game
 * is built from, and anything new that lands at the repo root is ignored until
 * it is named here. Ignoring a path never stops it being SERVED — publicDir
 * files are read per request — it only means no auto-reload when it changes.
 */
const WATCHED_DIRS = new Set(['src', 'assets', 'tools', 'scripts']);
const WATCH_DENY = [
  /^assets\/raw\//, // generation workspace: never loaded by the running game
  /^assets\/map\//, // 28 MB worldbuilder project files
  /^assets\/position-reference\//,
  /(^|\/)__pycache__\//,
  /(^|\/)\.work\//
];
const watchIgnored = (file: string): boolean => {
  const rel = path.relative(__dirname, file).split(path.sep).join('/');
  // '' is the root itself; '..' means Vite added the file deliberately from
  // outside root (config deps, env files) — never second-guess those.
  if (!rel || rel.startsWith('..')) return false;
  const slash = rel.indexOf('/');
  if (slash < 0) return false; // a root-level FILE: index.html, vite.config.ts, .env
  if (!WATCHED_DIRS.has(rel.slice(0, slash))) return true;
  return WATCH_DENY.some((re) => re.test(rel));
};

/**
 * Rebuild-storm circuit breaker. The allow-list above removes the writers we
 * know about; this one catches the next one. Watcher events are counted in a
 * rolling window: a directory that floods it gets UNWATCHED (dev keeps working
 * for everything else), and a flood coming from everywhere at once stops the
 * watcher outright. Either way the loop is broken in seconds instead of
 * rebundling on 16 threads until someone notices the fans.
 *
 * Build tooling, so wall-clock `Date.now()` is right here — the GameClock rule
 * is about gameplay timers.
 */
const WATCH_WINDOW_MS = 5_000;
const WATCH_DIR_LIMIT = 150; // events from ONE directory within a window
const WATCH_ALL_LIMIT = 400; // events from everywhere within a window

const watchGuard = (): Plugin => ({
  name: 'emberkeep-watch-guard',
  apply: 'serve',
  configureServer(server: ViteDevServer) {
    const perDir = new Map<string, number>();
    const dropped = new Set<string>();
    let windowStart = Date.now();
    let total = 0;
    let halted = false;
    server.watcher.on('all', (_event, file) => {
      if (halted) return;
      const now = Date.now();
      if (now - windowStart > WATCH_WINDOW_MS) {
        windowStart = now;
        total = 0;
        perDir.clear();
      }
      total += 1;
      const rel = path.relative(__dirname, String(file)).split(path.sep).join('/');
      const dir = rel.split('/').slice(0, 2).join('/');
      if (total >= WATCH_ALL_LIMIT) {
        halted = true;
        void server.watcher.close();
        server.config.logger.error(
          `[watch-guard] ${total} file events in ${WATCH_WINDOW_MS / 1000}s across the tree — ` +
            'stopping the watcher before it rebuilds in a loop. Find the writer (a second dev ' +
            'server, a build, an asset run), stop it, then restart `pnpm dev`.',
          { timestamp: true }
        );
        return;
      }
      if (dropped.has(dir)) return;
      const n = (perDir.get(dir) ?? 0) + 1;
      perDir.set(dir, n);
      if (n >= WATCH_DIR_LIMIT) {
        dropped.add(dir);
        server.watcher.unwatch(path.resolve(__dirname, dir));
        server.config.logger.error(
          `[watch-guard] ${dir} fired ${n} file events in ${WATCH_WINDOW_MS / 1000}s — something is ` +
            'writing there in a loop. It is UNWATCHED for the rest of this session (no auto-reload ' +
            'from it); stop the writer, then restart `pnpm dev`.',
          { timestamp: true }
        );
      }
    });
  }
});

/* ---------- Map Editor (nionja) : magasin disque côté dev ---------- */
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
 * Dev-only publish endpoint for the in-game Map Editor's "Apply".
 *
 * The editor authors grids in ITS space; the engine runs zones in game pixels, and
 * `scripts/build-zones.mjs` is the one place that knows how to get from one to the
 * other. So Apply does not compute geometry in the browser — it writes the editor's
 * own export where the pipeline already reads it and runs the pipeline:
 *
 *   POST /__editor/worlds  → assets/map/nionja-worlds.json
 *                          → node scripts/ingest-worlds.mjs  → src/data/worlds.json
 *                          → node scripts/build-zones.mjs    → src/data/zones.json
 *
 * Vite then reloads the game onto the new zones. One source of truth, and the
 * editor→art transform is never duplicated.
 */
const editorWorldsEndpoint = (): Plugin => ({
  name: 'emberkeep-editor-worlds',
  configureServer(server: ViteDevServer) {
    const file = path.resolve(__dirname, 'assets/map/nionja-worlds.json');
    const run = (script: string, args: string[] = []): Promise<string> =>
      new Promise((resolve, reject) => {
        const child = spawn('node', [path.resolve(__dirname, script), ...args], { cwd: __dirname });
        let err = '';
        child.stderr.on('data', (d: Buffer) => (err += d.toString()));
        child.on('close', (code) => (code === 0 ? resolve(script) : reject(new Error(`${script}: ${err || code}`))));
      });
    server.middlewares.use('/__editor/worlds', (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end();
        return;
      }
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        void (async () => {
          try {
            const doc = JSON.parse(body) as { worlds?: unknown[] };
            if (!Array.isArray(doc.worlds) || doc.worlds.length === 0)
              throw new Error('no `worlds` array — not a Map Editor export');
            mkdirSync(path.dirname(file), { recursive: true });
            writeFileSync(file, JSON.stringify(doc, null, 1) + '\n');
            await run('scripts/ingest-worlds.mjs');
            await run('scripts/build-zones.mjs');
            res.end('{"ok":true}');
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: String(e) }));
          }
        })();
      });
    });
  }
});


export default defineConfig({
  base: './',
  publicDir: 'assets',
  plugins: [
    uiThemeEndpoint(),
    asset3dStore(),
    editorMapStore(),
    editorWorldsEndpoint(),
    fxLabPresetsEndpoint(),
    auroraLabEndpoint(),
    snowLabEndpoint(),
    worldbuilderMergeEndpoint(),
    worldbuilderEmittersEndpoint(),
    tutorialEndpoint(),
    eventsEndpoint(),
    worldbuilderCharactersEndpoint(),
    worldbuilderMapEndpoint(),
    worldbuilderZonesEndpoint(),
    worldbuilderIslandEndpoint(),
    watchGuard(),
    copyRuntimeArt()
  ],
  server: {
    port: 5173,
    // strict: a second `pnpm dev` must FAIL, not silently start on 5174 with a
    // second recursive watcher over the same multi-GB tree.
    strictPort: true,
    /**
     * Bind every interface, so `pnpm dev` prints a Network URL beside the Local
     * one and a phone on the same wifi can open the build being worked on. The
     * game is authored at 2560x1600 and FIT-scales, so a handset is a real test
     * of the fit — one that no desktop window reproduces.
     *
     * This DOES put the dev server on the local network, and the dev server is
     * not a read-only thing: the map editor and the worldbuilder endpoints
     * above write to the repo. That is fine on a home network and is not fine
     * on a shared one — on café wifi, run `pnpm dev --host false`.
     */
    host: true,
    watch: { ignored: watchIgnored }
  },
  preview: {
    // Lane-isolated: two agents sharing this checkout must not land on ONE port
    // and ONE dist, or each silently tests the build the other left behind
    // (`pnpm verify:lane <name>` derives all four vars from one id).
    port: Number(process.env.EMBERKEEP_PREVIEW_PORT ?? 4173),
    strictPort: true
  },
  build: {
    outDir: process.env.EMBERKEEP_DIST ?? 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 3000,
    // `copyRuntimeArt` does the publicDir copy through a ship/skip filter.
    copyPublicDir: false
  }
});
