#!/usr/bin/env node
/**
 * Grid audit — do the hand-drawn editor cells hold pieces?
 *
 *   node scripts/audit-grids.mjs
 *
 * The editor lets you draw grids at any pitch; the game projects a drawn cell's
 * world centre through `worldToGrid` to decide which game cell it makes habitable
 * (mapEditor.applyBaseToGame). When the drawn pitch differs from the live lattice,
 * several drawn cells land on ONE game cell and all but the last are silently lost —
 * they look allocated in the editor and can never hold a piece.
 *
 * PRODUCTION RULE (mapEditor): the PRIMARY world keeps the authored lattice
 * (256 × 147.5, from src/data/map.json); a sub-world entered by `world:switch`
 * adopts its OWN lattice via `latticeFor` — unless its grids are rotated or ortho,
 * which `latticeFor` refuses, leaving it on the authored one.
 *
 * This script replicates iso.ts + editorStore.ts exactly and reports, per map and
 * per grid, what the game actually gets — plus what the OTHER lattice would have
 * given, so the rule can be checked rather than trusted. It reads only.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TILE_W = 256; // src/core/Constants.ts
const TILE_H = 128;

const project = JSON.parse(readFileSync(join(ROOT, 'asset3d/editor-map.json'), 'utf8'));
const gameMap = JSON.parse(readFileSync(join(ROOT, 'src/data/map.json'), 'utf8'));
const constants = readFileSync(join(ROOT, 'src/core/Constants.ts'), 'utf8');
/** The sub-worlds a teleport can enter — the ones that adopt their own lattice. */
const SUB_WORLDS = new Set([...constants.matchAll(/toWorld:\s*'([^']+)'/g)].map((m) => m[1]));

/* ---- src/core/iso.ts, verbatim (parameterised by lattice) ---- */
const tile = gameMap.tile;
const AUTHORED = {
  halfW: TILE_W / 2,
  halfH: tile?.width && tile?.height ? (TILE_W * (tile.height / tile.width)) / 2 : TILE_H / 2,
  skewK: tile?.skew ? Math.tan((tile.skew * Math.PI) / 180) : 0,
  originX: 2560 / 2, // BOARD_ORIGIN_X = GAME_WIDTH / 2
  originY: 316 // BOARD_ORIGIN_Y
};

function gridToWorld(L, col, row) {
  const cx = L.halfW + L.skewK * L.halfH;
  const rx = -L.halfW + L.skewK * L.halfH;
  return { x: L.originX + col * cx + row * rx, y: L.originY + (col + row) * L.halfH };
}
function worldToGrid(L, x, y) {
  const cx = L.halfW + L.skewK * L.halfH;
  const rx = -L.halfW + L.skewK * L.halfH;
  const det = cx * L.halfH - rx * L.halfH;
  const wx = x - L.originX;
  const wy = y - L.originY;
  return {
    col: Math.round((wx * L.halfH - rx * wy) / det),
    row: Math.round((cx * wy - wx * L.halfH) / det)
  };
}

/* ---- src/editor/editorStore.ts, verbatim ---- */
const gridBasis = (g) =>
  g.persp === 'ortho'
    ? { u: { x: g.tileW, y: 0 }, v: { x: 0, y: g.tileH } }
    : { u: { x: g.tileW / 2, y: g.tileH / 2 }, v: { x: -g.tileW / 2, y: g.tileH / 2 } };
const gridRad = (g) => ((g.rot ?? 0) * Math.PI) / 180;
function rotAround(p, c, ang) {
  if (!ang) return { x: p.x, y: p.y };
  const co = Math.cos(ang);
  const si = Math.sin(ang);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * co - dy * si, y: c.y + dx * si + dy * co };
}
function cellRaw(g, i, j) {
  const { u, v } = gridBasis(g);
  return { x: g.ox + i * u.x + j * v.x, y: g.oy + i * u.y + j * v.y };
}
const gridCenter = (g) => cellRaw(g, (g.cols - 1) / 2, (g.rows - 1) / 2);
const gridCellCenter = (g, i, j) => rotAround(cellRaw(g, i, j), gridCenter(g), gridRad(g));
const allocCount = (g) => Object.values(g.alloc ?? {}).filter((l) => l > 0).length;

/** editorStore.latticeFor — median pitch, phase FITTED to every drawn cell. */
function latticeFor(grids) {
  const usable = grids.filter((g) => g.persp !== 'ortho' && !(g.rot ?? 0) && allocCount(g) > 0);
  if (!usable.length) return null;
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const anchor = usable.reduce((a, b) => (allocCount(b) > allocCount(a) ? b : a));
  const L = {
    halfW: median(usable.map((g) => g.tileW)) / 2,
    halfH: median(usable.map((g) => g.tileH)) / 2,
    skewK: 0,
    originX: anchor.ox,
    originY: anchor.oy
  };
  const drawn = [];
  for (const g of usable) {
    for (const [cell, lvl] of Object.entries(g.alloc ?? {})) {
      if (!(lvl > 0)) continue;
      const [i, j] = cell.split(',').map(Number);
      drawn.push(gridCellCenter(g, i, j));
    }
  }
  for (let pass = 0; pass < 24; pass++) {
    let dx = 0;
    let dy = 0;
    for (const p of drawn) {
      const { col, row } = worldToGrid(L, p.x, p.y);
      const back = gridToWorld(L, col, row);
      dx += p.x - back.x;
      dy += p.y - back.y;
    }
    dx /= drawn.length;
    dy /= drawn.length;
    L.originX += dx;
    L.originY += dy;
    if (Math.hypot(dx, dy) < 0.01) break;
  }
  return L;
}

/** Fold a map's drawn cells through a lattice: distinct game cells + placement error. */
function fold(grids, L) {
  const perGrid = [];
  const mapCells = new Set();
  let drawn = 0;
  for (const g of grids) {
    const cells = Object.entries(g.alloc ?? {}).filter(([, lvl]) => lvl > 0);
    if (!cells.length) continue;
    const seen = new Map();
    let sumErr = 0;
    let maxErr = 0;
    for (const [cell] of cells) {
      const [i, j] = cell.split(',').map(Number);
      const w = gridCellCenter(g, i, j);
      const { col, row } = worldToGrid(L, w.x, w.y);
      const back = gridToWorld(L, col, row);
      const err = Math.hypot(back.x - w.x, back.y - w.y);
      sumErr += err;
      maxErr = Math.max(maxErr, err);
      const k = `${col},${row}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
      mapCells.add(k);
    }
    drawn += cells.length;
    perGrid.push({
      g,
      drawn: cells.length,
      cells: seen.size,
      lost: cells.length - seen.size,
      worst: Math.max(...seen.values()),
      avgErr: sumErr / cells.length,
      maxErr,
      keys: [...seen.keys()]
    });
  }
  return { perGrid, drawn, cells: mapCells.size, lost: drawn - mapCells.size, keys: mapCells };
}

/* ---- the audit ---- */
const maps = project.maps ?? [];
const grids = project.grids ?? {};
const allocs = project.allocations ?? {};
const assets = project.assets ?? {};

const px = (L) => `${(L.halfW * 2).toFixed(1)} x ${(L.halfH * 2).toFixed(2)} px`;
console.log(`Lattice AUTORISÉE (monde primaire) : ${px(AUTHORED)}`);
console.log(`  (src/data/map.json tile ${tile?.width}x${tile?.height})`);
console.log(`Sous-mondes (adoptent leur propre pas) : ${[...SUB_WORLDS].join(', ')}\n`);

const owners = new Map(); // "col,row" -> [mapName…]
let grandLost = 0;
let grandRecovered = 0;

for (const m of maps) {
  const gs = grids[m.id] ?? [];
  const al = allocs[m.id] ?? [];
  const as = assets[m.id] ?? [];
  const own = SUB_WORLDS.has(m.name) ? latticeFor(gs) : null;
  const live = own ?? AUTHORED; // exactly what mapEditor installs for this world
  const other = own ? AUTHORED : latticeFor(gs);

  console.log(`━━ ${m.name}  (${m.id})`);
  console.log(`   ${gs.length} grille(s) · ${al.length} allocation(s) directe(s) · ${as.length} asset(s)`);
  console.log(
    `   lattice en jeu : ${px(live)}` +
      (own ? '  ← la sienne (latticeFor)' : SUB_WORLDS.has(m.name) ? '  ← autorisée (grilles non représentables)' : '  ← autorisée (monde primaire)')
  );

  for (const [key] of al) owners.set(key, [...(owners.get(key) ?? []), m.name]);

  const now = fold(gs, live);
  for (const r of now.perGrid) {
    const ok = r.lost === 0;
    console.log(
      `   ${ok ? '  OK' : ' PERD'} ${String(r.g.name ?? r.g.id).padEnd(12)} ` +
        `${r.g.cols}x${r.g.rows} cellule ${r.g.tileW.toFixed(0)}x${r.g.tileH.toFixed(0)} rot ${r.g.rot ?? 0} · ` +
        `${r.drawn} allouées -> ${r.cells} cases jeu` +
        (ok ? '' : ` · ${r.lost} PERDUES, pire ${r.worst}/1`) +
        ` · décalage moy ${r.avgErr.toFixed(0)}px max ${r.maxErr.toFixed(0)}px`
    );
  }
  for (const k of now.keys) owners.set(k, [...(owners.get(k) ?? []), m.name]);

  if (now.drawn) {
    console.log(
      `   TOTAL carte: ${now.drawn} cellules dessinées -> ${now.cells} cases de jeu` +
        (now.lost ? `  ⚠ ${now.lost} perdues (${((now.lost / now.drawn) * 100).toFixed(0)}%)` : '  ✓ aucune perte')
    );
    if (other) {
      const alt = fold(gs, other);
      const delta = now.cells - alt.cells;
      console.log(
        `   (avec l'autre lattice ${px(other)} : ${alt.cells} cases, ` +
          (delta > 0 ? `soit ${delta} de MOINS — la règle en place est la bonne)` : delta < 0 ? `soit ${-delta} de PLUS ⚠)` : `identique)`)
      );
      if (delta > 0) grandRecovered += delta;
    }
  }
  grandLost += now.lost;
  console.log();
}

/* A game cell claimed by more than one map means the worlds are DRAWN on the same
   board coordinates. Boards are per-world now, so this leaks nothing — but it is
   why the same (col,row) means a different place depending on where you stand. */
const shared = [...owners.entries()].filter(([, ms]) => new Set(ms).size > 1);
console.log('━━ Coordonnées partagées entre cartes');
if (!shared.length) {
  console.log('   ✓ aucune case de jeu revendiquée par deux cartes différentes.');
} else {
  console.log(`   ${shared.length} case(s) revendiquée(s) par plusieurs cartes:`);
  for (const [k, ms] of shared.slice(0, 12)) console.log(`     ${k} <- ${[...new Set(ms)].join(', ')}`);
  if (shared.length > 12) console.log(`     … +${shared.length - 12}`);
}
console.log(
  `\n   Chaque monde possède son plateau (GameState.boards) et ses cases jouables sont\n` +
    `   remises à zéro à chaque bascule (applyBaseToGame -> clearEditorTileOverrides),\n` +
    `   donc un chevauchement ici ne fuit RIEN d'un monde à l'autre.`
);

console.log(`\n━━ Verdict : ${grandLost} cellule(s) dessinée(s) inatteignable(s) en jeu.`);
if (grandRecovered) console.log(`   ${grandRecovered} case(s) récupérée(s) par les lattices par monde.`);
if (grandLost) {
  console.log(
    `   Une grille est sans perte quand son pas ÉGALE celui de la lattice de son monde\n` +
      `   (et une grille tournée ne peut jamais l'être — la lattice n'a pas de rotation).`
  );
}
