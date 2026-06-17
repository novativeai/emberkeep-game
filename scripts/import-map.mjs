// One-command world-builder → game map import.
//
//   pnpm map:import ~/Downloads/dragon-land.world.json   # import a fresh export
//   pnpm map:import                                       # just rebuild from the
//                                                         # current canonical source
//
// Copies the export to the canonical source the pipeline reads, then runs the
// existing ingest + build-gamemap scripts (single source of truth). Regenerates
// src/data/map.json — the map main.ts actually runs.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const CANON = 'assets/map/dragon-land.world-2.json';

let src = process.argv[2];
if (src) {
  if (src.startsWith('~/')) src = resolve(homedir(), src.slice(2)); // shell may not expand ~ if quoted
  src = resolve(src);
  if (!existsSync(src)) {
    console.error(`✗ Export introuvable : ${src}`);
    process.exit(1);
  }
  let doc;
  try { doc = JSON.parse(readFileSync(src, 'utf8')); }
  catch { console.error(`✗ JSON invalide : ${src}`); process.exit(1); }
  if (doc.format !== 'emberkeep-world') {
    console.error(`✗ Pas un export world builder (format ${doc.format ?? '?'}) : ${src}`);
    process.exit(1);
  }
  copyFileSync(src, CANON);
  console.log(`✓ Importé  ${src}\n        → ${CANON}`);
} else {
  if (!existsSync(CANON)) {
    console.error(`✗ Aucun fichier fourni et ${CANON} absent.\n  Usage : pnpm map:import <chemin/vers/export.world.json>`);
    process.exit(1);
  }
  console.log(`• Aucun fichier fourni — rebuild depuis ${CANON}`);
}

const run = (file, args = []) => execFileSync('node', [file, ...args], { stdio: 'inherit' });
run('scripts/ingest-world.mjs', [CANON]);   // → src/data/world-map.json
run('scripts/build-gamemap.mjs');           // → src/data/map.json

console.log('\n✓ src/data/map.json régénéré.');
console.log('  Dans la console du jeu (localhost:5173) : __emberkeep.reset()  pour voir le résultat.');
