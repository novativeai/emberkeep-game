/**
 * Where the named cast stand — world builder → `src/data/characters.json`.
 *
 *   node scripts/apply-characters.mjs [src/data/world-map.json]
 *
 * The World Builder's 🧝 Characters tab is the authority on the CELL Eleanor and
 * Selyna stand on. That cell reaches the game two ways, and both land here:
 *
 *   ⤒ Apply (dev server)  → vite's /__worldbuilder/characters POST → applyCharacters()
 *   ⬇ Export world.json   → scripts/ingest-world.mjs → this file's CLI
 *
 * ONLY her POSITION moves — `anchor` (the cell) and `dx`/`dy` (the free nudge
 * off its centre, in builder pixels; the game rebases them by
 * TILE_W / map.tile.width). `action`, `cooldownMs` and `world` are gameplay
 * design that lives in characters.json and nowhere else — a placement tool must
 * never be able to silently retune a cooldown. A character the builder has never
 * placed keeps the position it already had; a character not yet in the file is
 * appended with the safe defaults below, so dropping a newly-arted character
 * onto the map is enough to put her in the game.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Defaults for a character the builder places for the first time. */
const NEW_CHARACTER = { action: 'give_back', cooldownMs: 900_000 };

/**
 * @param {{characters: Array<{id: string, world?: string, col: number, row: number, dx?: number, dy?: number}>}} doc
 * @param {string} root repo root
 * @returns {Array<{id: string, col: number, row: number, dx: number, dy: number, added: boolean}>}
 */
export function applyCharacters(doc, root) {
  if (!Array.isArray(doc?.characters)) throw new Error('no `characters` array in the doc');
  const file = path.resolve(root, 'src/data/characters.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const summary = [];
  for (const c of doc.characters) {
    if (typeof c?.id !== 'string' || !Number.isInteger(c.col) || !Number.isInteger(c.row)) {
      throw new Error(`bad character entry: ${JSON.stringify(c)}`);
    }
    const dx = Math.round(c.dx ?? 0);
    const dy = Math.round(c.dy ?? 0);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      throw new Error(`bad character offset: ${JSON.stringify(c)}`);
    }
    const existing = data.characters.find((x) => x.id === c.id);
    const target = existing ?? {
      id: c.id,
      speaker: c.id,
      world: c.world ?? 'emberkeep',
      ...NEW_CHARACTER
    };
    target.anchor = [c.col, c.row];
    // Centred is the common case — keep the file clean rather than writing two
    // zeroes onto every character who never needed a nudge.
    if (dx || dy) {
      target.dx = dx;
      target.dy = dy;
    } else {
      delete target.dx;
      delete target.dy;
    }
    if (!existing) data.characters.push(target);
    summary.push({ id: c.id, col: c.col, row: c.row, dx, dy, added: !existing });
  }
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return summary;
}

/** The current doc, in the shape the builder's ↺ Reload reads. */
export function readCharacters(root) {
  return JSON.parse(readFileSync(path.resolve(root, 'src/data/characters.json'), 'utf8'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const inPath = process.argv[2] ?? 'src/data/world-map.json';
  const world = JSON.parse(readFileSync(path.resolve(root, inPath), 'utf8'));
  if (!world.characters?.length) {
    console.log(`No characters placed in ${inPath} — characters.json left alone.`);
    process.exit(0);
  }
  for (const s of applyCharacters(world, root)) {
    const off = s.dx || s.dy ? ` + offset [${s.dx}, ${s.dy}]` : '';
    console.log(`  ${s.added ? 'added  ' : 'moved  '}${s.id} → anchor [${s.col}, ${s.row}]${off}`);
  }
  console.log(`Applied ${world.characters.length} character anchor(s) to src/data/characters.json`);
}
