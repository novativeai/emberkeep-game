/**
 * Map Editor world export → `src/data/worlds.json` (the multi-world registry).
 *
 *   node scripts/ingest-worlds.mjs [assets/map/nionja-worlds.json] [src/data/worlds.json]
 *
 * WHY THIS EXISTS, AND WHY IT KEYS OFF WORLD PIXELS
 * -------------------------------------------------
 * A world is no longer one lattice. In the editor's model each world is a set of
 * ZONES — independently placed grids, each with its own perspective, tile size,
 * matrix and rotation — so a floating island can carry a grid that matches its
 * art instead of being forced onto one global diamond pitch.
 *
 * The export offers two addresses per playable cell: its `world` pixel centre and
 * a `gameCell` {col,row} projected onto the game's single coarse lattice. The
 * second one is LOSSY and not by a little: across the shipped worlds, 147 of 357
 * zone cells (41%) collapse onto a `gameCell` some other cell already claims —
 * borealis alone loses 71 of its 141. Ingesting by `gameCell` would silently
 * delete two-fifths of the level design and look like it worked.
 *
 * So this reads `world` {x,y} — the one address that is exact — and keeps the
 * zone geometry beside it. That is the same reasoning `src/core/mapSpace.ts`
 * already applies to saved positions: a cell index is only meaningful next to the
 * grid that owns it; a pixel on the art is meaningful on its own.
 *
 * The output is DATA ONLY. Nothing renders it yet — the engine still runs the
 * single-lattice `map.json`. This lands the worlds losslessly and verifiably so
 * the renderer has something true to build against.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const inPath = process.argv[2] ?? 'assets/map/nionja-worlds.json';
const outPath = process.argv[3] ?? 'src/data/worlds.json';

const doc = JSON.parse(readFileSync(inPath, 'utf8'));
if (!Array.isArray(doc.worlds)) {
  console.error(`${inPath} has no \`worlds\` array — not a Map Editor export.`);
  process.exit(1);
}

/** Stable id from the editor's map NAME, which is the only human-meaningful key
 *  in the export (its `id` is a timestamp that changes every re-export). */
const slug = (name) =>
  String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .replace(/-4k-aligned$/, ''); // nb2-4k-aligned is just nb2's art file

const round = (n) => Math.round(Number(n) * 100) / 100;

const worlds = doc.worlds.map((w) => {
  const zones = (w.grids ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    persp: g.perspective === 'ortho' ? 'ortho' : 'iso',
    tile: { w: round(g.tile?.w ?? 0), h: round(g.tile?.h ?? 0) },
    matrix: { cols: g.matrix?.cols ?? 0, rows: g.matrix?.rows ?? 0 },
    // Degrees, about the footprint centre. Normalised to (-180,180] so 358°
    // reads as the -2° nudge it actually is.
    rotation: (() => {
      const r = ((Number(g.rotation ?? 0) % 360) + 360) % 360;
      return round(r > 180 ? r - 360 : r);
    })(),
    origin: { x: round(g.origin?.x ?? 0), y: round(g.origin?.y ?? 0) },
    bounds: g.bounds
      ? { x: round(g.bounds.x), y: round(g.bounds.y), w: round(g.bounds.w), h: round(g.bounds.h) }
      : null,
    /** Playable cells. `x`/`y` are the cell centre in WORLD PIXELS — the exact,
     *  lossless address. `i`/`j` are its coordinate within THIS zone. */
    cells: (g.cells ?? []).map((c) => ({
      i: c.i,
      j: c.j,
      x: round(c.world?.x ?? 0),
      y: round(c.world?.y ?? 0),
      unlock: c.unlockLevel ?? 1
    }))
  }));
  return {
    id: slug(w.map),
    name: w.map,
    /** The editor's "Level N" paging — the order worlds are meant to open in. */
    level: Number(String(w.level ?? '').replace(/\D+/g, '')) || 0,
    /** Backdrop art key. The authored isle keeps the one the engine already ships. */
    backdrop: slug(w.map),
    primary: Boolean(w.isPrimary),
    live: Boolean(w.isLiveGameWorld),
    authoredDefault: Boolean(w.isAuthoredDefault),
    zones,
    /** Per-cell unlock overrides the editor applied on top of the zones. */
    unlockOverrides: (w.allocations ?? []).map((a) => ({ cell: a.cell, unlock: a.unlockLevel }))
  };
});

const t = doc.teleport ?? {};
const out = {
  format: 'emberkeep-worlds',
  version: 1,
  source: inPath,
  generatedBy: doc.generatedBy ?? 'Emberkeep Map Editor',
  primary: worlds.find((w) => w.primary)?.id ?? worlds[0]?.id ?? null,
  teleport: t.enabled
    ? {
        trigger: t.trigger,
        chain: t.triggerChain ?? null,
        tier: t.triggerTier ?? null,
        dragonChain: t.dragonChain ?? null,
        toWorld: slug(t.toWorld)
      }
    : null,
  worlds
};

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');

const cells = worlds.reduce((n, w) => n + w.zones.reduce((m, z) => m + z.cells.length, 0), 0);
console.log(`Ingested ${inPath} → ${outPath}`);
console.log(`  worlds: ${worlds.length}  ·  zones: ${worlds.reduce((n, w) => n + w.zones.length, 0)}  ·  playable cells: ${cells}`);
for (const w of worlds) {
  const c = w.zones.reduce((m, z) => m + z.cells.length, 0);
  const flags = [w.primary && 'PRIMARY', w.live && 'live', w.authoredDefault && 'authored-default']
    .filter(Boolean)
    .join(' ');
  console.log(`    L${w.level} ${w.id.padEnd(12)} zones ${String(w.zones.length).padStart(2)}  cells ${String(c).padStart(3)}  ${flags}`);
}
if (out.teleport) {
  console.log(`  teleport: ${out.teleport.trigger} ${out.teleport.chain ?? ''}${out.teleport.tier ?? ''} → ${out.teleport.toWorld}`);
}
