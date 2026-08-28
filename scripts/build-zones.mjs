#!/usr/bin/env node
/**
 * BUILD ZONES — turn the lossless editor registry into worlds the game can run.
 *
 *   assets/map/nionja-worlds.json   (editor space, imported by ingest-worlds.mjs)
 *        │
 *        ├─ scripts/ingest-worlds.mjs → src/data/worlds.json   the REGISTRY (lossless)
 *        └─ scripts/build-zones.mjs   → src/data/zones.json    the RUNTIME (game px)
 *
 * The split mirrors ingest-world/build-gamemap: ingest imports without judgement,
 * build projects into the engine's own space and makes the design decisions.
 *
 * WHAT THIS DECIDES
 * -----------------
 * 1. THE EDITOR→ART TRANSFORM. The editor lays grids out in its own pixel space,
 *    not the backdrop's. It also records, per cell, the `gameCell` it believes
 *    that cell maps to on the game's 13×12 lattice — which is a lossy address
 *    (see tests/unit/Worlds.spec.ts) but an excellent *measurement*. Fitting one
 *    uniform scale + offset against all 357 of them recovers the transform and
 *    reproduces the editor's own answer for ~97% of cells to under half a cell,
 *    so the number below is derived here rather than pasted in.
 *
 * 2. WHOSE GROUND IT IS. The hand-drawn grid is (2026-08-11). `nb2` is a re-grid
 *    of the same island `map.json` covers, and this script used to keep the
 *    authored 46-tile isle as the zone `main` and adopt only the 36 editor cells
 *    that fell outside it. That kept the shipped Chapter One bit-for-bit, at the
 *    price of the editor and the game disagreeing about where the ground is — you
 *    draw a cell on the isle and the game keeps the authored one underneath.
 *    Emberkeep is now built from its own grids like every other world: all 75
 *    drawn cells, at the pitch they were drawn at, nothing dropped.
 *
 *    What it costs: (col,row) no longer indexes the authored rectangle, so a save
 *    written against it reads onto different ground, and anything that names a
 *    cell — the tutorial, the quest ladder, map.json's starting items — has to be
 *    re-verified. `Zones.spec.ts` pinned the old equality and had to move with it.
 *
 * 3. WHEN THE NEW GROUND OPENS. A world that is nothing but its own grids opens
 *    them when the editor says so (`plainLevel`); rebasing them above the Chapter
 *    One cap would now start the player on no ground at all. `BEYOND_BASE_LEVEL`
 *    survives for any world that goes back to extending the authored map.
 *
 * Run: node scripts/build-zones.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));
const readText = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const SOURCE = 'assets/map/nionja-worlds.json';
/** The world the game boots into (src/core/Constants.ts WORLD_ID). */
const PRIMARY_WORLD_ID = 'emberkeep';
const OUT = 'src/data/zones.json';

/* ---- the engine's own numbers (src/core/Constants.ts) ---- */
const TILE_W = 256;
const BOARD_ORIGIN_X = 2560 / 2;
const BOARD_ORIGIN_Y = 316;
/** Every shipped backdrop is this size, and each world reuses the authored
 *  emberkeep placement, so one art→world transform serves all of them. */
const ART_W = 2610;
const ART_H = 1632;
/**
 * First Keeper level a new emberkeep zone may open on.
 *
 * It sat at 4 — one past the Chapter One cap — so none of this ground could ever
 * appear: `LEVEL_XP` ends at 3, `UnlockSystem` lifts a level region only when the
 * Keeper reaches its level, and the 36 cells drawn beside the isle were therefore
 * data nobody could ever stand on. The map editor showed them, the game did not,
 * and that gap is what "my grid doesn't match" actually was.
 *
 * At 2 the editor's own unlock levels (2 and 3) land on 2 and 3 — both reached in
 * the shipped campaign, so the ground opens instead of waiting for a level that
 * does not exist. The cost is deliberate and known: level 2 is the tutorial's own
 * level-up beat, so the first 9 cells surface while the tutorial is still running.
 * Raise this to 3 to push all of it to the finale instead.
 */
const BEYOND_BASE_LEVEL = 2;
/** Blank columns between two zones' index blocks. One is enough to make a
 *  ±1 step fall in the gap, so adjacency can never leak between zones even
 *  before the same-zone rule in world.ts. */
const BLOCK_GUTTER = 1;
/**
 * Highest Keeper level the campaign can reach — READ from Constants, never typed.
 *
 * It was `3`, which was true when `LEVEL_XP` was `[0, 60, 220]`. The ladder went
 * to six on 2026-08-13 and this did not follow, so every band the editor drew at
 * 4, 5 or 6 shipped `'locked'` — and `UnlockSystem.unlockForLevel` only ever
 * lifts a region already at `'unlockable'`. The clouds were therefore permanent
 * over ground the player earns the right to stand on. A cap that can disagree
 * with the curve it describes is not a cap, so it is derived.
 */
const LEVEL_CAP = (() => {
  const src = readText('src/core/Constants.ts');
  const m = src.match(/export const LEVEL_XP = \[([^\]]*)\]/);
  if (!m) throw new Error('build-zones: LEVEL_XP not found in src/core/Constants.ts');
  return m[1].split(',').filter((n) => n.trim().length).length;
})();

const source = read(SOURCE);
const authored = read('src/data/map.json');

/**
 * `src/core/mapSpace.ts` mapSignature, duplicated here on purpose: this script
 * is plain node with no TypeScript in the loop, and the value it stamps has to
 * be the one the runtime computes. `Zones.spec.ts` asserts the two agree, which
 * is what makes the duplication safe rather than a second source of truth.
 */
function signatureOf(worldId, map) {
  const bg = map.backgrounds?.[0];
  const cal = bg ? map.backgroundCalibration?.[bg.name] : undefined;
  const tile = `${map.tile?.width ?? TILE_W}x${map.tile?.height ?? TILE_W / 2}s${map.tile?.skew ?? 0}`;
  const art = bg
    ? `${bg.name}@${bg.col},${bg.row}+${bg.dx ?? 0},${bg.dy ?? 0}*${cal?.scale ?? 1}`
    : 'none';
  return `${worldId}|${map.cols}x${map.rows}|${tile}|${art}`;
}

/* ------------------------------------------------------------------ */
/* 1. the game lattice, in the backdrop's own pixels                     */
/* ------------------------------------------------------------------ */

const ratio = TILE_W / (authored.tile?.width ?? TILE_W);
const halfW = TILE_W / 2;
const halfH = (TILE_W * ((authored.tile?.height ?? TILE_W / 2) / (authored.tile?.width ?? TILE_W))) / 2;
const bg = authored.backgrounds[0];
const cal = authored.backgroundCalibration[bg.name];
/** World px of the backdrop's placement point (its centre — anchor 0.5/0.5). */
const artOriginX = BOARD_ORIGIN_X + bg.col * halfW - bg.row * halfW + ((cal.offsetX ?? 0) + (bg.dx ?? 0)) * ratio;
const artOriginY = BOARD_ORIGIN_Y + (bg.col + bg.row) * halfH + ((cal.offsetY ?? 0) + (bg.dy ?? 0)) * ratio;
/** World px per backdrop px. */
const unit = (cal.scale ?? 1) * ratio;

/** Backdrop px (from the image's top-left) → game world px. */
const artToWorld = (x, y) => ({
  x: artOriginX + (x - ART_W / 2) * unit,
  y: artOriginY + (y - ART_H / 2) * unit
});

/** The game lattice expressed in backdrop px, for the overlap test below. */
const AU = { x: halfW / unit, y: halfH / unit };
const AV = { x: -halfW / unit, y: halfH / unit };
const A0 = {
  x: (BOARD_ORIGIN_X - artOriginX) / unit + ART_W / 2,
  y: (BOARD_ORIGIN_Y - artOriginY) / unit + ART_H / 2
};
const DET = AU.x * AV.y - AV.x * AU.y;
const artToCell = (x, y) => {
  const dx = x - A0.x;
  const dy = y - A0.y;
  return {
    col: Math.round((dx * AV.y - AV.x * dy) / DET),
    row: Math.round((AU.x * dy - dx * AU.y) / DET)
  };
};

/* ------------------------------------------------------------------ */
/* 2. fit the editor→backdrop transform                                  */
/* ------------------------------------------------------------------ */

/**
 * THE EXPORT'S `gameCell` IS NOT EVIDENCE, AND TRUSTING IT ONCE COST EVERY WORLD.
 *
 * The editor fills that field from the AMBIENT `worldToGrid` — the projection of
 * whatever the game is showing behind the editor window. Once the game runs on
 * the very zones this script writes, that projector is zone-aware, so `gameCell`
 * comes back as a ZONE BLOCK ADDRESS (grid 1's cell 0,1 → col 14) rather than a
 * position on the game lattice. Fitting to those is fitting to this script's own
 * previous output, and the loop diverges: on 2026-08-12 an export written by the
 * editor's Apply button drove the fit from 1.22453 to 0.21583, reproducing 0 of
 * 367 cells and moving every zone in every world.
 *
 * So the correspondence is DERIVED here instead, from the one address the ingest
 * doc already calls exact — the cell's `world` pixel. Iterated closest point:
 * with a transform in hand, each editor point names the lattice cell it is
 * nearest; with those cells, least squares re-solves the transform; two rounds
 * converge because the answer never moves far.
 *
 * The result no longer depends on who wrote the export or on what the editor
 * happened to be showing when they pressed the button.
 */
/**
 * THE SEED IS A CONSTANT IN THIS FILE, AND DELIBERATELY NOT THE LAST BUILD'S ANSWER.
 *
 * Seeding from `zones.json` was the obvious thing — let the fit track the editor
 * if its world space is ever genuinely re-scaled — and it is the reason a single
 * bad build could not be undone by re-running the good one. ICP needs a
 * transform to derive its correspondences with; if that transform is yesterday's
 * mistake, today derives the same wrong cells and re-measures the same wrong
 * answer. The error had become the input.
 *
 * There is no scoring trick that rescues it either. Every "is this fit better"
 * measure available here is either scale-dependent (residual in editor px falls
 * as the scale shrinks) or saturates (distance to the NEAREST lattice cell is
 * bounded by half a cell whatever the scale), so a wrong fit can look as good as
 * a right one.
 *
 * A constant is both simpler and stronger. ICP's basin of convergence around
 * this value covers any plausible drift, and a change big enough to fall outside
 * it is a change somebody should make HERE, on purpose, in a diff — not one that
 * seeps in through a generated file nobody reads.
 */
const SEED_FIT = { scale: 1.22453, offsetX: -16.26, offsetY: -46.9 };

/**
 * Least squares for `editor = scale·art + offset`, one uniform scale.
 *
 * `gameCell` is still USED where it IS a lattice address, because it is the
 * editor's own answer and measurably the better one: on a clean export it fits
 * to 352/367 against the derived assignment's 339. The check is per SAMPLE, not
 * per FILE, and that distinction is the whole lesson of 2026-08-13.
 *
 * A file-wide vote was tried first — trust the column if 80% of it agrees with
 * the derived cells — and it does catch the export that is corrupt end to end.
 * It does not catch the one that matters, because the corruption is PARTIAL:
 * only the grids the running game had already adopted as zones come back as
 * zone addresses. That day 356 of 367 gameCells were honest and 11 were not, the
 * vote passed at 97%, and those 11 went into the sum of squares naming cells
 * thousands of pixels from where they sit — (1,4) offered as (14,0). Least
 * squares has no defence against that: it is the SQUARE of the error, so eleven
 * gross outliers outweighed three hundred and fifty-six good points and pulled
 * the scale from 1.22453 to 1.1175. Every zone in every world moved, and the
 * only visible symptom was a map that no longer sat on its painting.
 *
 * So no sample is trusted on its neighbours' behalf. A gameCell that disagrees
 * with the pixel is simply not used — the derived cell stands in for it — and
 * whatever survives that is trimmed again on its own residual. Corruption of
 * eleven cells now costs eleven cells.
 */
const OUTLIER_TRIM = 4; // × the median residual — a sample past this is not fitted

/** ICP from one seed: assign, trim, re-solve. Two rounds; a third moves nothing. */
function fitFrom(seed, cells, points) {
  let fit = seed;
  let kept = 0;
  let vetoed = 0;
  let trimmed = 0;
  for (let pass = 0; pass < 2; pass++) {
    // What the transform in hand says each point's cell is, independent of the
    // file — both the stand-in for a rejected gameCell and the test of every
    // other one.
    const derived = points.map((ed) => artToCell((ed.x - fit.offsetX) / fit.scale, (ed.y - fit.offsetY) / fit.scale));
    const samples = cells.map((c, i) => {
      // NEIGHBOURING, not identical. A cell centre can legitimately fall just
      // the wrong side of a boundary and derive as the cell next door, and
      // rejecting those loses the very samples that make `gameCell` the better
      // answer. A zone address is not off by one — the eleven that broke the
      // build named cells three to eight columns away.
      const honest = c.gameCell && Math.max(Math.abs(c.gameCell.col - derived[i].col), Math.abs(c.gameCell.row - derived[i].row)) <= 1;
      return { ed: c.world, cell: honest ? c.gameCell : derived[i], honest };
    });
    vetoed = samples.filter((s) => !s.honest).length;
    // Residual trim: whatever assignment a sample ended up with, a point that
    // still lands far from the lattice it is supposed to name is not evidence.
    const res = samples.map((s) => residual(s, fit));
    const med = median(res) || 1;
    const fitted = samples.filter((_, i) => res[i] <= med * OUTLIER_TRIM);
    trimmed = samples.length - fitted.length;
    kept = fitted.length;
    fit = solve(fitted, fit);
  }
  return { fit, kept, vetoed, trimmed };
}

function fitEditorToArt() {
  const cells = [];
  for (const w of source.worlds) {
    for (const g of w.grids ?? []) {
      for (const c of g.cells ?? []) cells.push(c);
    }
  }
  const points = cells.map((c) => c.world);

  const best = fitFrom(SEED_FIT, cells, points);
  if (best.vetoed) {
    console.warn(
      `build-zones: ${best.vetoed}/${points.length} of the export's gameCells are zone addresses rather than lattice ` +
        `ones — the signature of an Apply pressed while the game was running on zones. Those cells were derived from ` +
        `their world pixel instead, so the fit is sound; the count is only worth watching if it climbs.`
    );
  }
  return {
    ...best.fit,
    samples: points.length,
    fitted: best.kept,
    source:
      best.vetoed || best.trimmed
        ? `${best.kept}/${points.length} samples (${best.vetoed} veto, ${best.trimmed} trim)`
        : 'editor gameCells'
  };
}

/** How far a sample's editor point lands from the cell it claims, in editor px. */
function residual({ ed, cell }, fit) {
  const art = { x: A0.x + cell.col * AU.x + cell.row * AV.x, y: A0.y + cell.col * AU.y + cell.row * AV.y };
  return Math.hypot(ed.x - (art.x * fit.scale + fit.offsetX), ed.y - (art.y * fit.scale + fit.offsetY));
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};

/** One round: re-assign any cell left open, then close-form the transform. */
function solve(samples, fit) {
  const rows = samples.map(({ ed, cell }) => {
    const c =
      cell ??
      artToCell((ed.x - fit.offsetX) / fit.scale, (ed.y - fit.offsetY) / fit.scale);
    return {
      art: { x: A0.x + c.col * AU.x + c.row * AV.x, y: A0.y + c.col * AU.y + c.row * AV.y },
      ed
    };
  });
  let sAA = 0, sAx = 0, sAy = 0, sAex = 0, sAey = 0, sEx = 0, sEy = 0;
  for (const r of rows) {
    sAA += r.art.x * r.art.x + r.art.y * r.art.y;
    sAx += r.art.x;
    sAy += r.art.y;
    sAex += r.art.x * r.ed.x;
    sAey += r.art.y * r.ed.y;
    sEx += r.ed.x;
    sEy += r.ed.y;
  }
  const n = rows.length;
  // Normal equations for [scale, offsetX, offsetY].
  const M = [
    [sAA, sAx, sAy],
    [sAx, n, 0],
    [sAy, 0, n]
  ];
  const b = [sAex + sAey, sEx, sEy];
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let k = i; k < 3; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]];
    [b[i], b[p]] = [b[p], b[i]];
    for (let k = 0; k < 3; k++) {
      if (k === i) continue;
      const f = M[k][i] / M[i][i];
      for (let j = i; j < 3; j++) M[k][j] -= f * M[i][j];
      b[k] -= f * b[i];
    }
  }
  return { scale: b[0] / M[0][0], offsetX: b[1] / M[1][1], offsetY: b[2] / M[2][2] };
}

/* ------------------------------------------------------------------ */
/* 2b. the ANALYTIC editor→art transform — the fit is now a watchdog     */
/* ------------------------------------------------------------------ */

/**
 * The editor places every imported map image by a FORMULA, not by hand —
 * `BoardEditor.renderCurrentMap`: the layer is centred on the authored
 * backdrop's world rect (`backdropRect`, whose centre is exactly `artOrigin`
 * above) and scaled to COVER it (`cover = max(rect/layer)` per axis). Both
 * ends of that placement are constants this script already holds, so
 * editor→art needs no estimation at all.
 *
 * The least-squares fit above measured the same relationship from the cells,
 * and measuring it was the imprecision: the samples' `gameCell`s are ROUNDED
 * lattice answers, so the solve chases their rounding structure and lands
 * 0.3–0.8% off scale run over run (1.22453 → 1.22876 across two exports).
 * Composed with `artToWorld`, a 0.8% scale error is a shear of ±12 world px
 * across the board — the drawn grid sat visibly beside the painted tiles it
 * was traced from. The analytic transform composes to identity within ~0.5 px
 * (the residue is the layer's own 1024×640 downscale of 2610×1632 art).
 *
 * The fit still runs, as a WATCHDOG: if someone changes how the editor places
 * the layer, the measured transform drifts away from this one and the build
 * says so loudly instead of silently mis-placing every zone.
 */
const LAYERS = (source.project?.maps ?? []).map((m) => ({ name: m.name, w: m.w, h: m.h }));
const LAYER = LAYERS[0] ?? { w: 1024, h: 640 };
for (const l of LAYERS) {
  if (l.w !== LAYER.w || l.h !== LAYER.h) {
    throw new Error(
      `build-zones: editor map layers disagree on size (${LAYER.w}x${LAYER.h} vs ${l.name} ${l.w}x${l.h}) — ` +
        'the analytic editor→art assumes one layer geometry; teach it per-map sizes before importing this project.'
    );
  }
}
const COVER = Math.max((ART_W * unit) / LAYER.w, (ART_H * unit) / LAYER.h);
const LAYER_TL = { x: artOriginX - (LAYER.w * COVER) / 2, y: artOriginY - (LAYER.h * COVER) / 2 };
const editorToArt = (p) => ({
  x: ((p.x - LAYER_TL.x) / COVER) * (ART_W / LAYER.w),
  y: ((p.y - LAYER_TL.y) / COVER) * (ART_H / LAYER.h)
});

const FIT = fitEditorToArt();
{
  // The watchdog: express the analytic transform in the fit's own
  // `editor = scale·art + offset` terms and compare.
  const aScale = (COVER * LAYER.w) / ART_W;
  const drift = Math.abs(FIT.scale - aScale) / aScale;
  if (drift > 0.02) {
    console.error(
      `build-zones: the MEASURED editor→art (scale ${FIT.scale.toFixed(5)}) is ${(drift * 100).toFixed(1)}% away ` +
        `from the ANALYTIC one (${aScale.toFixed(5)}). Either the editor changed how it places the map layer ` +
        '(update the analytic constants above) or the export is corrupt. The analytic transform was used.'
    );
  }
}

/**
 * How faithfully the fit reproduces the editor's own cell assignment.
 *
 * `worst` is measured against the cell each point is NEAREST, not against the
 * `gameCell` the export names, so a poisoned column cannot report itself as a
 * catastrophe (nor a good fit as a bad one). The gameCell agreement is still the
 * headline — it is the editor's answer and it should be the same as ours — but
 * it is a count, and the distance is what says the deck sits on the lattice.
 */
function fitAccuracy() {
  let hit = 0;
  let total = 0;
  let worst = 0;
  for (const w of source.worlds) {
    for (const g of w.grids ?? []) {
      for (const c of g.cells ?? []) {
        const a = editorToArt(c.world);
        const cell = artToCell(a.x, a.y);
        total++;
        if (cell.col === c.gameCell.col && cell.row === c.gameCell.row) hit++;
        const dx = a.x - (A0.x + cell.col * AU.x + cell.row * AV.x);
        const dy = a.y - (A0.y + cell.col * AU.y + cell.row * AV.y);
        worst = Math.max(worst, Math.hypot(dx, dy));
      }
    }
  }
  return { hit, total, worst };
}

/* ------------------------------------------------------------------ */
/* 3. zone geometry: editor grid → game world px                         */
/* ------------------------------------------------------------------ */

const rotate = (p, c, deg) => {
  if (!deg) return { x: p.x, y: p.y };
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
};

const round2 = (n) => Math.round(n * 100) / 100;

/** One editor grid → a runtime zone, with every length in game world px. */
function zoneOf(grid, block) {
  const iso = grid.perspective !== 'ortho';
  // Step vectors in EDITOR px, then straight through to world px. Both stages
  // are uniform scales, so a rotation applied in either space is the same angle.
  const eu = iso ? { x: grid.tile.w / 2, y: grid.tile.h / 2 } : { x: grid.tile.w, y: 0 };
  const ev = iso ? { x: -grid.tile.w / 2, y: grid.tile.h / 2 } : { x: 0, y: grid.tile.h };
  const s = unit / FIT.scale; // world px per editor px
  const oa = editorToArt(grid.origin);
  const origin = artToWorld(oa.x, oa.y);
  const pivotEd = grid.bounds
    ? { x: grid.bounds.x + grid.bounds.w / 2, y: grid.bounds.y + grid.bounds.h / 2 }
    : grid.origin;
  const pa = editorToArt(pivotEd);
  const pivot = artToWorld(pa.x, pa.y);
  return {
    id: grid.id,
    name: grid.name,
    block: [block.col, block.row],
    matrix: [grid.matrix.cols, grid.matrix.rows],
    origin: [round2(origin.x), round2(origin.y)],
    u: [round2(eu.x * s), round2(eu.y * s)],
    v: [round2(ev.x * s), round2(ev.y * s)],
    rotation: grid.rotation ?? 0,
    pivot: [round2(pivot.x), round2(pivot.y)],
    // Tile art on this zone is scaled to the zone's own tile, not the game's.
    artScale: round2((grid.tile.w * s) / TILE_W),
    cells: []
  };
}

/**
 * A world whose ground came from the PAINTING rather than the map editor.
 *
 * Hatchery has no editor grid — only its backdrop — so `scripts/fit-deck-grid.py`
 * measures the flagstone lattice out of the art itself and writes
 * `assets/map/<name>-deck.json` in backdrop px. This turns one of its islands
 * into a runtime zone, through the very same `artToWorld` the editor worlds go
 * through, so a measured world and an authored one land in one coordinate
 * system by construction.
 *
 * Local (0,0) is the island's own NW-most cell, which is what makes the matrix
 * tight and every local index non-negative — the block model's requirement.
 */
function deckZone(deck, island, index, block) {
  const cells = island.cells;
  const minI = Math.min(...cells.map((c) => c[0]));
  const minJ = Math.min(...cells.map((c) => c[1]));
  const maxI = Math.max(...cells.map((c) => c[0]));
  const maxJ = Math.max(...cells.map((c) => c[1]));
  const art = (i, j) => ({
    x: deck.origin[0] + i * deck.u[0] + j * deck.v[0],
    y: deck.origin[1] + i * deck.u[1] + j * deck.v[1]
  });
  const a0 = art(minI, minJ);
  const origin = artToWorld(a0.x, a0.y);
  return {
    id: `${deck.backdrop}_d${index + 1}`,
    name: index === 0 ? 'Deck' : `Outpost ${index}`,
    block: [block.col, block.row],
    matrix: [maxI - minI + 1, maxJ - minJ + 1],
    origin: [round2(origin.x), round2(origin.y)],
    u: [round2(deck.u[0] * unit), round2(deck.u[1] * unit)],
    v: [round2(deck.v[0] * unit), round2(deck.v[1] * unit)],
    // The lattice is measured off an unrotated painting, so there is no turn to
    // apply and the pivot is free; pinning it to the origin keeps the record
    // self-consistent rather than leaving a number that means nothing.
    rotation: 0,
    pivot: [round2(origin.x), round2(origin.y)],
    artScale: round2((Math.abs(deck.u[0] - deck.v[0]) * unit) / TILE_W),
    cells: cells.map(([i, j]) => [i - minI, j - minJ])
  };
}

/** World px centre of an editor cell — the address everything else derives from. */
function editorCellWorld(grid, i, j) {
  const iso = grid.perspective !== 'ortho';
  const eu = iso ? { x: grid.tile.w / 2, y: grid.tile.h / 2 } : { x: grid.tile.w, y: 0 };
  const ev = iso ? { x: -grid.tile.w / 2, y: grid.tile.h / 2 } : { x: 0, y: grid.tile.h };
  const flat = { x: grid.origin.x + i * eu.x + j * ev.x, y: grid.origin.y + i * eu.y + j * ev.y };
  const pivotEd = grid.bounds
    ? { x: grid.bounds.x + grid.bounds.w / 2, y: grid.bounds.y + grid.bounds.h / 2 }
    : grid.origin;
  return editorToArt(rotate(flat, pivotEd, grid.rotation ?? 0));
}

/* ------------------------------------------------------------------ */
/* 4. build each world                                                   */
/* ------------------------------------------------------------------ */

/** Chapter One owns the isle; new emberkeep ground waits until after it.
 *  RETIRED as emberkeep's rule on 2026-08-23 — see `plainLevel` — and kept for
 *  the next world that extends the authored map and wants its ground held back. */
const emberkeepLevel = (editorUnlock) => BEYOND_BASE_LEVEL + Math.max(0, (editorUnlock ?? 1) - 2);
/** The level the editor drew, verbatim. */
const plainLevel = (editorUnlock) => Math.max(1, editorUnlock ?? 1);

/* ------------------------------------------------------------------ */
/* 4b. ISLANDS — measured, so a level number never has to name one       */
/* ------------------------------------------------------------------ */

/**
 * THE ONE NUMBER THAT WAS DOING TWO JOBS.
 *
 * A cell's editor `unlockLevel` used to mean both "which island is this" and
 * "when does it open". That held only while the two happened to coincide: the
 * editor had drawn Borealis's three islands at levels 1, 2 and 3, so
 * `BOREALIS_PLAN` could be keyed by level and still be talking about islands.
 *
 * The moment the owner re-levelled the map to stage the fog — the mainland cut
 * into four waves at 2, 4, 5 and 6 — the plan matched nothing. Not "matched
 * badly": `spec.plan?.[lvl]` returned undefined for every band, so the north
 * would have shipped with no active region, no seeds on any island, and a
 * player landing on a world where nothing can be merged.
 *
 * So the two jobs are separated. WHICH ISLAND is measured here, from the art
 * the player can see — the same question `world.ts:buildAdjacency` asks, and
 * for the same reason: what a player may merge across is what visibly touches,
 * never what a data file grouped together. WHEN IT OPENS stays the editor's
 * number, untouched.
 *
 * The test is nearest-neighbour, not a fixed pixel threshold: island spacing is
 * a property of each backdrop's own tile pitch, and a constant tuned on
 * Borealis would mis-cut the next world. Two cells belong to the same island if
 * they sit within `ISLAND_REACH` medians of each other, which on the north
 * recovers exactly the three components the shipped world has always had
 * (9 / 103 / 29 cells) and is stable against re-export drift.
 */
const ISLAND_REACH = 1.45;

function islandsOf(cells) {
  const n = cells.length;
  if (!n) return [];
  const gap = (a, b) => Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y);
  // Median nearest-neighbour distance = this world's own idea of "touching".
  const nearest = cells.map((c, i) => {
    let best = Infinity;
    for (let j = 0; j < n; j++) if (j !== i) best = Math.min(best, gap(c, cells[j]));
    return best;
  });
  const sorted = [...nearest].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const reach = median * ISLAND_REACH;

  const comp = new Array(n).fill(-1);
  let next = 0;
  for (let i = 0; i < n; i++) {
    if (comp[i] !== -1) continue;
    const queue = [i];
    comp[i] = next;
    while (queue.length) {
      const k = queue.pop();
      for (let j = 0; j < n; j++) {
        if (comp[j] === -1 && gap(cells[k], cells[j]) <= reach) {
          comp[j] = next;
          queue.push(j);
        }
      }
    }
    next++;
  }

  const groups = Array.from({ length: next }, () => []);
  cells.forEach((c, i) => groups[comp[i]].push(c));
  // SOUTH TO NORTH — the march the plan is written in ("shore cy≈1509 →
  // coast cy≈884 → keep cy≈652"). Ordering by geography rather than by size
  // means the plan keeps naming the same island when one of them grows.
  return groups.sort(
    (a, b) =>
      b.reduce((n2, c) => n2 + c.at.y, 0) / b.length - a.reduce((n2, c) => n2 + c.at.y, 0) / a.length
  );
}

const authoredPlayable = new Set((authored.playable ?? []).map(([c, r]) => `${c},${r}`));

/** Cells a world character already stands on, per world (src/data/characters.json). */
const characters = read('src/data/characters.json');
const standingIn = (worldId) =>
  new Set(
    characters.characters
      .filter((c) => c.world === worldId)
      .map((c) => `${c.anchor[0]},${c.anchor[1]}`)
  );

/* ------------------------------------------------------------------ */
/* 4a. BOREALIS — the authored plan for world 2                          */
/* ------------------------------------------------------------------ */

/**
 * Borealis is painted as THREE islands and the editor delivered it as 38 grids;
 * `world.ts` measures which cells actually touch, and the three connected
 * components it finds are exactly the three unlock levels the editor recorded.
 * So the editor's levels ARE the islands, and this table names them and says
 * what stands on each.
 *
 * WHY KEYS AND NOT LEVELS. As generated, `l2` gated on Keeper Level 2 and `l3`
 * on Level 3 — and the north opens at Level 3, which is the Chapter One cap. A
 * player crossing for the first time already satisfied both, so all 141 cells
 * unfogged in the frame they arrived and the world was spent before it started.
 * The alternative was to extend LEVEL_XP past 3, which would cost the XP bar its
 * "Chapter One complete" reading for the sake of a gate. Keys are the right
 * instrument: they are earned from Selyna's Ledger, so the north opens at the
 * pace the player works it, and it keeps the rule the south already follows —
 * keys gate story, levels gate power.
 *
 * SEEDS. Every island is bootstrapped on its OWN ground, and that is not
 * generosity — a merge cannot cross water, so an island with no producer is an
 * island where nothing can ever happen. `wrackline` is the north's Ancient Tree
 * (driftwood, plus a Broken Strake every third haul); `frostfont` feeds the
 * rime farm. Counts are chosen against the free space each island has: the
 * shore is deliberately cramped, because "there is no room here" is what sends
 * the player to the Ledger for the key.
 */
const BOREALIS_PLAN = {
  // ISLAND INDEX, south → north (`islandsOf`), NOT the editor's level.
  //
  // It was keyed by unlock level, which worked only while the editor happened
  // to have drawn one level per island. Re-levelling the map to stage the fog
  // broke that silently — see the note on `islandsOf`. An island is measured
  // now; the level says WHEN, this table says WHAT STANDS THERE.
  0: {
    id: 'borealis_shore',
    status: 'active',
    // 9 cells. One landmark and five spars leaves three free — enough to merge
    // in (a merge needs three touching) and not enough to sprawl. Both Bound
    // Faggots for Selyna's signal fire are one haul away, so the door quest
    // never stalls on the tide.
    seeds: [
      ['glasskiln', 3, 1],
      ['seaglass', 1, 5]
    ]
  },
  2: {
    id: 'borealis_keep',
    status: 'unlockable',
    unlock: { keys: 2 },
    // 29 cells — the keep with the door, where Selyna stands, and the LAST
    // fog to lift: the march is south → north (shore cy≈1509 → coast cy≈884 →
    // keep cy≈652 in world px), so her door is the arc's payoff, not its
    // second beat — "I have not decided anything about you" holds until the
    // coast has been worked. Two keys, which is exactly what the pitch and
    // frames orders have paid by then; at one banked key only the coast is
    // affordable, so the march cannot be spent out of order.
    // The loose rimebloom/driftwood stock came OFF this island: both are
    // renewable from the Font and the Wrack Line standing right here, and the
    // freed tiles carry the LAST of the five farms (merge-chains §2.4.1b)
    // instead — the Aurora Loom, the slowest machine in the game, which is why
    // it is the reward for the last fog rather than something the player is
    // handed early and watches. The Bench that used to stand beside it moved
    // to the coast: nothing in the north may be seeded twice, and its lenses
    // are wanted three quests before this door is affordable.
    // Selyna's two — the Cairn ready-built (it reseeds itself), the Wayfinder
    // as parts — and the Hearthlamp as parts salvaged among the wreck timbers,
    // because neither the lamp nor the compass ever reseeds its own tier-1:
    // 3 × t1 + 2 × t2 is exactly one build, with both Cookbook rows discovered
    // on the way (the dew_basin precedent). They are the two northern machines
    // the player BUILDS rather than finds, and that is the whole of the quests
    // `north_lodestones` and `north_lamplight`.
    seeds: [
      ['auroraloom', 3, 1],
      ['warhelm', 1, 3],
      ['manastone', 3, 1],
      ['wayfinder', 1, 3],
      ['wayfinder', 2, 2],
      ['hearthlamp', 1, 3],
      ['hearthlamp', 2, 2],
      ['chest', 1, 1]
    ]
  },
  1: {
    id: 'borealis_coast',
    status: 'unlockable',
    unlock: { keys: 1 },
    // 103 cells — the mainland, the second step of the south→north march and
    // one signal-fire key away. GENERATORS ONLY, and each on its own side: the
    // first key buys the player five working fixtures spread around the
    // island's rim (perimeter layout below), and the whole open middle is
    // theirs to farm into. No loose pieces — everything the coast asks for
    // comes off these: driftwood + a Broken Strake every third haul from the
    // Wrack Lines, rimebloom from the Fonts, and the chest's own gift table
    // (which pays Strakes too), so the frames order funds itself without a
    // scatter of freebies undercutting the farms.
    // The Cordial Cask joins the rim WORKING (tier 3): it reseeds its own
    // tier-1 (its own produce), so a seeded t3 here strands no Cookbook row —
    // the parts stream starts the moment the farm does. The Runestone SEED is
    // gone with its generator (owner, 2026-08-28): an inert monument standing
    // unearned beside the working machines read as a broken faucet, and the
    // one the player BREWS (`north_runeshards`) is the one that means
    // something.
    // ONE OF EACH, ACROSS THE WHOLE NORTH. A second Glass Kiln here (there were
    // two, on top of the shore's) was not a bigger farm, it was the same farm
    // twice: the north GROWS its generators — every twelfth firing drops a Fire
    // Brick, nine bricks are the next kiln — so a duplicate seed hands over the
    // reward the loop exists to pay and takes a rim tile the next farm wanted.
    // The Starwright's Bench belongs on THIS island rather than the keep:
    // `north_threadwork` brews Light Threads out of Spyglasses, and it is asked
    // three quests before the keep's two keys are affordable.
    seeds: [
      ['starbench', 3, 1],
      ['wreckforge', 3, 1],
      ['tarkiln', 3, 1],
      ['emberdram', 3, 1],
      ['chest', 1, 1]
    ]
  }
};

/**
 * THE MAINLAND OPENS BOTTOM-UP (owner, 2026-08-28).
 *
 * The editor's per-cell levels made the coast's key-door band the NORTH-WEST
 * corner and its rank waves a scatter: the Gold Key opened the top of the
 * island, level 4 opened the bottom, and the middle stayed clouded between
 * them — clouds taken at both ends, left in the centre. The march the game
 * teaches is south → north (shore → coast → keep), so the ISLAND must open
 * the same way: the key buys the SOUTHERN deck (and the seeds land there,
 * which is what puts the machines in the player's hands first), and each rank
 * lifts the next band up, the northern cloud last — falling exactly when the
 * Rune Way at the top of the island opens.
 *
 * GEOMETRY OVER AUTHORING, for this island only: the band a cell joins is
 * decided by its measured world Y, not its editor level — the door band keeps
 * the SIZE the editor priced the key at, the rest split as evenly as the cell
 * count allows across `waves` (south first, ascending). A re-export moves
 * every cell and this re-derives; nothing here names an address.
 */
const FOG_MARCH = {
  borealis: { island: 1, waves: [4, 5, 6] }
};

/** Tiers that hold a `generator` — the machines, read off the shipped chain
 *  data so this never drifts from what the game actually treats as a farm. */
const GENERATOR_TIERS = new Set(
  read('src/data/chains.json').chains.flatMap((c) =>
    c.tiers.filter((t) => t.generator).map((t) => `${c.id}:${t.tier}`)
  )
);
/** A permanent fixture: a machine, or the chest (a standing gift box that is
 *  never consumed). Both are furniture — they want the rim. */
const isFixture = (chain, tier) => GENERATOR_TIERS.has(`${chain}:${tier}`) || chain === 'chest';

/**
 * Lay a region's seeds out: FIXTURES around the rim, evenly; stock in the middle.
 *
 * Placement is DERIVED, never pasted: a re-export moves every cell, and a
 * hand-written `[col,row]` would then be either a hole in the sky or on top of
 * the landmark beside it.
 *
 * The rim rule is what keeps an island playable. A machine laid mid-out walls
 * off the exact tiles its own produce needs to land on, and two of them laid
 * mid-out land beside each other in the middle — which is what the keep
 * shipped as, the Loom and the Cairn ninety pixels apart on a 29-cell island.
 *
 * Even spacing is FARTHEST-POINT selection, not compass directions. The old
 * rule gave seed k the bearing k·(2π/N) and took the cell reaching furthest
 * that way, which assumes a roughly circular island: on the coast's real shape
 * three machines collapsed onto the southern shore 350 px apart and left a
 * 134° hole. Max-min asks a different question — "which free rim cell is
 * furthest from everything already placed?" — and that answers correctly for
 * any outline, because it never mentions a direction at all.
 */
/**
 * Seeds a region could not hold. A shortfall is CONTENT that did not land;
 * it must never cost the world its GEOMETRY. It used to throw, and the throw
 * rode up through the per-world catch — so re-drawing an island smaller than
 * its plan froze the ENTIRE world at its previous lattice, and every marker
 * in the game then disagreed with the grid the author was looking at in the
 * editor. The plan describes yesterday's islands by index; the author is
 * allowed to draw today's differently and hear about the mismatch, loudly,
 * without the map refusing to follow.
 */
const seedShortfalls = [];

function seedRegion(cells, seeds, taken) {
  if (!seeds?.length || !cells.length) return [];
  const cx = cells.reduce((n, c) => n + c.at.x, 0) / cells.length;
  const cy = cells.reduce((n, c) => n + c.at.y, 0) / cells.length;
  // A world character stands ON a cell (characters.json anchors), and she is
  // scenery rather than a board item — so nothing stops a Hoarfrost Font from
  // being dropped through her. Leave her cell alone.
  const free = cells.filter((c) => !taken.has(`${c.col},${c.row}`));
  // The RIM: the outermost cells by distance from the island's centre.
  //
  // Not "a cell with a neighbour off the island" — that is the ENGINE's rim
  // (adjacency never leaves a zone) and every zone seam satisfies it, so on
  // Borealis, which the editor delivered as 38 grids, cells in the dead middle
  // of the coast qualified. The Cordial Cask duly landed seven pixels from the
  // centroid: max-min had covered the four extremes and the most "isolated"
  // point left really was the middle.
  //
  // The band is sized off the island instead of a pixel threshold, so it holds
  // for a 9-cell shore and a 103-cell mainland alike, and always offers at
  // least three candidates per fixture for the spacing to choose between.
  const fixtures = seeds.reduce((n, [chain, tier, count]) => n + (isFixture(chain, tier) ? count : 0), 0);
  const rim = [...free]
    .sort(
      (a, b) =>
        Math.hypot(b.at.x - cx, b.at.y - cy) - Math.hypot(a.at.x - cx, a.at.y - cy) ||
        a.col - b.col ||
        a.row - b.row
    )
    .slice(0, Math.max(3 * fixtures, Math.ceil(free.length * 0.35)));

  // Ties broken by address so a rebuild is reproducible to the cell.
  const byAddress = (a, b) => a.col - b.col || a.row - b.row;
  const gap = (a, b) => Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y);
  const used = new Set();
  const placed = [];

  /** Take `n` rim cells, each as far as possible from everything placed. */
  const spread = (n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const candidates = rim.filter((c) => !used.has(c)).sort(byAddress);
      if (!candidates.length) return out;
      let best = null;
      let bestScore = -Infinity;
      for (const c of candidates) {
        // The first fixture on an empty island has nothing to be far from, so
        // it takes the furthest point OUT — a corner, never a centre.
        const score = placed.length
          ? Math.min(...placed.map((p) => gap(c, p)))
          : Math.hypot(c.at.x - cx, c.at.y - cy);
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      used.add(best);
      placed.push(best);
      out.push(best);
    }
    return out;
  };

  // Machines first, so the even spacing is THEIRS; the chest then falls into
  // the largest gap they left rather than stealing one of their sides.
  const units = seeds.flatMap(([chain, tier, count]) =>
    Array.from({ length: count }, () => ({ chain, tier }))
  );
  const out = [];
  for (const pass of [
    (u) => GENERATOR_TIERS.has(`${u.chain}:${u.tier}`),
    (u) => isFixture(u.chain, u.tier)
  ]) {
    const wanted = units.filter((u) => pass(u) && !u.at);
    const spots = spread(wanted.length);
    wanted.forEach((u, i) => {
      if (spots[i]) u.at = [spots[i].col, spots[i].row];
    });
  }

  // Everything else fills from the middle outwards — loose stock belongs where
  // the player is already merging, which is the centre the fixtures left clear.
  const mid = free
    .filter((c) => !used.has(c))
    .sort((a, b) => Math.hypot(a.at.x - cx, a.at.y - cy) - Math.hypot(b.at.x - cx, b.at.y - cy));
  let n = 0;
  const dropped = [];
  for (const unit of units) {
    if (!unit.at) {
      const cell = mid[n++];
      if (!cell) {
        dropped.push(`${unit.chain}:${unit.tier}`);
        continue;
      }
      unit.at = [cell.col, cell.row];
    }
    out.push({ chain: unit.chain, tier: unit.tier, at: unit.at });
  }
  if (dropped.length) {
    seedShortfalls.push(
      `island of ${cells.length} cell(s) had no room for ${dropped.length} seed(s): ${dropped.join(', ')}`
    );
  }
  return out;
}

/**
 * THE DOORS — every world's portal out, measured ON ITS BACKDROP.
 *
 * A portal is an invisible rectangle that travels when tapped, and the reason
 * it can be invisible is that each backdrop already PAINTS its gateway: the lit
 * stone arch on Emberkeep's north-east isle, the glowing keep door on
 * Borealis's, the vined archway onto Roothold's rope bridge. So these are
 * authored in BACKDROP PIXELS, read straight off the 2610×1632 art, and
 * converted below by the same `artToWorld` every zone origin goes through.
 * Anyone can re-measure one by opening the image; nobody has to reason in world
 * px, which is where a hand-authored rect would go wrong.
 *
 * `[x, y, w, h]`, top-left first.
 *
 * THE NETWORK — six doors, every one wearing a PortalFX coloured by its
 * DESTINATION (Constants PORTAL_TINTS: flame red/pink home to Emberkeep,
 * forest green to Roothold, ice blue north), every one story-gated by
 * WorldSystem, never by an authored level:
 *
 *   Emberkeep ─ the Ember Gate (green)      → Roothold   opens: Order 1 done
 *   Emberkeep ─ the North Crossing (ice)    → Borealis   opens: the Elder wakes
 *   Roothold  ─ the Vine Arch (flame)       → Emberkeep  always
 *   Borealis  ─ the Ash Road (flame)        → Emberkeep  always
 *   Borealis  ─ the Rune Way (ice)          → Hatchery   opens: 3 Selyna quests
 *   Hatchery  ─ the Rune Circle (ice)       → Borealis   always
 *
 * The North Crossing stands beside the Golden Altar because the Elder IS its
 * key — Eleanor speaks it open right after the finale. The Ash Road hovers by
 * the shore the player lands on, so the north can never strand them. The Rune
 * Way sits just above the circular inlay at the top of the mainland. The
 * editor's `teleport` record (hatch a tier-2 flame gem) is the same journey's
 * older phrasing and stays as registry data only.
 */
const PORTALS = {
  emberkeep: [
    { id: 'emberkeep_gate', to: 'roothold', label: 'The Ember Gate', art: [1768, 137, 229, 241] },
    // Beside the Golden Altar's crystal ring (the altar cell (-2,2) reads back
    // to art (635, 292)) — on the terrace flat, left of the ring.
    { id: 'emberkeep_altar_gate', to: 'borealis', label: 'The North Crossing', art: [380, 220, 190, 230] }
  ],
  roothold: [
    { id: 'roothold_arch', to: 'emberkeep', label: 'The Vine Arch', art: [1750, 215, 200, 400] }
  ],
  borealis: [
    // Hovering just west of the landing shore — the way home is visible from
    // the first nine tiles the player owns in the north.
    { id: 'borealis_shore_gate', to: 'emberkeep', label: 'The Ash Road', art: [1440, 1150, 150, 210] },
    // Over the circular inlay at the top-left of the mainland deck.
    { id: 'borealis_rune_gate', to: 'runevault', label: 'The Rune Way', art: [365, 235, 175, 205] }
  ],
  runevault: [
    // THE LANDING AT THE FOOT OF THE STAIR — the lit wooden deck, not the steps
    // above it and not the rune circle inlaid in the plateau (the spot the
    // Hatchery's door carried over, which read as floor decoration rather than
    // an exit and stood in the cauldron's own light).
    //
    // This rect is the DECK's own planking, measured off the painting: x
    // 1035..1220, y 1390..1498, between the railing and the two hanging
    // lanterns. It sat provisionally up on the steps because a door on the deck
    // was 740 world px from anything the player could stand on, and
    // `Zones.spec`'s "never out over open sky" was refusing it — correctly, on
    // the evidence it had: Runevault had 4 of its 187 drawn cells marked and all
    // four were up on the plateau.
    //
    // The fix is not a looser limit, it is real ground. `Grille 16`, the 1×1 he
    // drew on the deck, is now allocated, so the landing is a cell of the world
    // like any other and the door stands 19 px from its centre. The camera's
    // opening frame is the ACTIVE region's tiles, so the deck comes into view
    // with it — the way down is somewhere the player can see and reach.
    { id: 'runevault_circle', to: 'borealis', label: 'The Rune Stair', art: [1035, 1390, 185, 108] }
  ]
};

/**
 * AUTHORED MAP DECOR, placed the way the doors are: by a point ON THE BACKDROP.
 *
 * `at` is where the art's own anchor must land, in backdrop px — for a standing
 * prop that is the centre of its ground contact, so "on the rune circle" is
 * literally the circle's centre read off the image. The cell and the free
 * dx/dy nudge are DERIVED below, because the cell a point falls in is a
 * property of the fitted deck and would go stale the moment that fit changed.
 *
 * `anchor` is measured on the art itself: the horizontal centre of the foot
 * ring, and the height of the two side feet (in a 2:1 iso view the side feet
 * sit at the contact ellipse's vertical centre, the front foot at its bottom).
 */
const DECOR = {
  runevault: [
    {
      name: 'pink_cauldron',
      // WHERE THE EDITOR PUT IT. `at`/`scale` are filled in below from the
      // placed asset in `assets/map/nionja-worlds.json`, so moving the pot in
      // the editor and re-exporting moves it in the game — it is no longer a
      // point somebody read off the art by hand and typed here.
      fromEditorAsset: 'pink_cauldron',
      // Measured on the art itself and NOT the editor's business: the
      // horizontal centre of the foot ring, and the height of the two side feet
      // (the side feet sit at the contact ellipse's vertical centre, the front
      // foot at its bottom). The current art is the Runevault witch's pot at the
      // plaza's own ~40-degree camera (assets/raw/decor-sets/cauldron/), whose
      // swing handle hangs wide to the LEFT of the belly — which is why the
      // foot-ring centre sits at 0.543 of the alpha box, not 0.5 — measure the
      // TOE TIPS off the bottom profile, not the belly span, which the lid's
      // overhang drags right. Re-measure
      // with the same alpha-box pass whenever this art changes.
      anchor: { x: 0.543, y: 0.889 }
    }
  ]
};

/**
 * Pixel size of a WebP, from its header — no image library in this script.
 *
 * Needed because the editor scales the asset against the file IT was handed
 * (`art.w` in the export) and the game scales the copy in `assets/sprites`. They
 * are the same picture, but a re-encode can leave them different sizes, and a 5%
 * error on a prop the player taps is a prop that no longer sits on its own
 * shadow. Reading both means the conversion is exact instead of nearly right.
 */
function webpWidth(rel) {
  const b = readFileSync(resolve(ROOT, rel));
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const fourcc = b.toString('ascii', 12, 16);
  if (fourcc === 'VP8X') return 1 + b.readUIntLE(24, 3);
  if (fourcc === 'VP8 ') return b.readUInt16LE(26) & 0x3fff;
  if (fourcc === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return (bits & 0x3fff) + 1;
  }
  return null;
}

/**
 * An editor-placed asset → the `at`/`scale` the decor loop below wants.
 *
 * `scale` unwinds three changes of unit between the two programs, and there is
 * no fourth: the editor draws `art.w × asset.scale` in EDITOR px; dividing by
 * the fitted editor→backdrop scale gives backdrop px; the renderer multiplies
 * its own `cal.scale` by `ratio` against the GAME file's width, and the backdrop
 * itself is drawn at `unit` world px per backdrop px. `unit / ratio` is exactly
 * the backdrop's calibration scale, so the whole thing collapses to a factor of
 * two and a pair of measured widths.
 */
/**
 * THE PLACED ASSET, FROM WHICHEVER BUTTON WROTE THE EXPORT.
 *
 * There are two writers for `nionja-worlds.json` and they do not agree on what
 * an asset is. `scripts/export-editor-worlds.mjs` writes the pixel the editor
 * dropped it on (`world`), its source size (`art`) and its mirroring (`flipX`).
 * The editor's own Apply button — the one actually to hand while placing
 * things — writes none of the three: its asset row is `x`/`y` (a game CELL,
 * far too coarse to stand a pot on) plus `scale` and an `onGrid` pin.
 *
 * Requiring `world` therefore made the pot's survival depend on which button
 * was pressed, and pressing the near one silently deleted it — a warning in a
 * build log, and a cauldron missing from the game.
 *
 * Both writers do embed the RAW project (`project.assets[worldId]`), and that
 * is where the editor keeps the truth: `wx`/`wy` is the exact drop point,
 * `w`/`h` the source size. So read the pixel from there whenever the row itself
 * has not got it. The pot lands in the same place either way, which is the only
 * acceptable answer — the editor is where he puts it, not a staging area for a
 * second command he has to remember.
 */
function placedAsset(src, name) {
  const row = (src?.assets ?? []).find((a) => a.name === name);
  if (row?.world) return row;
  const raw = (source.project?.assets?.[src?.id] ?? []).find((a) => a.name === name);
  if (!raw || !Number.isFinite(raw.wx) || !Number.isFinite(raw.wy)) return null;
  return {
    ...(row ?? {}),
    scale: Number(raw.scale ?? row?.scale ?? 1),
    world: { x: Math.round(raw.wx), y: Math.round(raw.wy) },
    art: { w: raw.w, h: raw.h },
    flipX: raw.flipX === true
  };
}

function editorDecor(spec, d) {
  const src = source.worlds.find((w) => w.map === spec.editorMap);
  const placed = placedAsset(src, d.fromEditorAsset);
  if (!placed) {
    // WARN, do not throw. A prop that is not in the export is a prop somebody
    // has to go and place again, and it is worth being loud about — but the
    // world it stands on is still the ground the player walks, the doors they
    // travel through and the cells their pieces sit on. Refusing to build any
    // of that because a pot is missing takes a cosmetic loss and turns it into
    // no game at all.
    console.warn(
      `build-zones: ${spec.id} wants the editor's "${d.fromEditorAsset}", but neither the export's asset rows nor its ` +
        `embedded project has one by that name with a drop point — building the world WITHOUT it. Place it in the ` +
        `editor on the ${spec.editorMap} map and re-export.`
    );
    return null;
  }
  const art = editorToArt(placed.world);
  const gameW = webpWidth(`assets/sprites/environment/map/decor/${d.name}.webp`) ?? placed.art?.w;
  const scale = (2 * placed.scale * (placed.art?.w ?? gameW)) / (FIT.scale * gameW);
  return { ...d, at: [round2(art.x), round2(art.y)], scale: round2(scale), flipX: placed.flipX === true };
}

/** One authored door, in the world pixels the runtime hit-tests against. */
function portalOf(p) {
  const tl = artToWorld(p.art[0], p.art[1]);
  return {
    id: p.id,
    to: p.to,
    label: p.label,
    rect: [round2(tl.x), round2(tl.y), round2(p.art[2] * unit), round2(p.art[3] * unit)]
  };
}

const WORLDS = [
  {
    id: 'emberkeep',
    name: 'Emberkeep',
    level: 1,
    editorMap: 'nb2-4k-aligned',
    backdrop: 'emberkeep',
    /**
     * BUILT ON `src/data/map.json` — the authored isle is the zone `main`, and the
     * editor's cells are added BESIDE it.
     *
     * Adopting the hand-drawn grid wholesale was tried on 2026-08-11 and reverted the
     * same day. It is not a flag: `emberkeep` stops inheriting the authored map, and
     * the whole shipped payload goes with it — `startingItems`, `mapDecor` (the
     * charred stump the tutorial's first beat asks the player to tap) and the fog
     * regions all live in map.json. The board came up empty and Eleanor asked for a
     * stump that had nowhere to stand, so the tutorial could not advance at all.
     *
     * Making the drawn grid the real ground is an AUTHORING job, not a build flag:
     * the starting items, the map decor, the fog regions and every cell the tutorial
     * and the quest ladder name have to be re-anchored onto the new registry first.
     * Until that is done the isle stays authored and the editor's off-isle cells are
     * adopted beside it.
     */
    extendsAuthoredMap: true,
    /** Drop editor cells that land on ground the authored isle already owns —
     *  two lattices over one slab is how a save loses its board. */
    skipOnAuthoredIsle: true,
    /**
     * THE EDITOR'S LEVEL, VERBATIM — was `emberkeepLevel`, which added 2.
     *
     * The rebase existed because the drawn ground had no schedule of its own:
     * whatever the editor said, it had to land somewhere the campaign reached,
     * so `+BEYOND_BASE_LEVEL` slid all of it up. The owner now levels every
     * cell by hand to stage the weather — 31 cells at 1, 12 at 2, 20 at 3, 15
     * at 4 — and an offset applied on top of that means the cloud he cleared at
     * level 2 lifts at level 4. A schedule the author writes must be the
     * schedule the game plays.
     *
     * The cost, stated: his level-1 cells are open from the first frame instead
     * of arriving at the tutorial's level-up beat. That is the authored intent
     * (level 1 IS "open"), and the tutorial is unaffected — the one extension
     * cell it names, `board_room`'s (32,0), sits at editor level 1, so it is
     * open earlier than before and never later.
     */
    levelOf: plainLevel,
    regionPrefix: 'beyond',
    /**
     * WHAT IS UNDER THE CLOUD — one Frost Dragon Egg on the north-west island,
     * revealed the moment its level-4 band lifts.
     *
     * A keepsake, not a supply: frost is Borealis vocabulary (`chains.json`
     * `world`), so the egg cannot be farmed, cooked or hinted at here, and one
     * egg is short of the three a Frost Dragon takes. That is the whole point —
     * what the cloud hands over is a question about the north, not a dragon.
     *
     * ADDRESSED BY ISLAND AND LEVEL, never by the band's name: names are
     * derived (see `bandName`) and a re-export can rewrite them. The cell
     * inside the band is derived too, by `seedRegion`, for the same reason a
     * hand-written [col,row] would be a hole in the sky after the next export.
     * If the address ever stops resolving the BUILD FAILS — a gift that
     * silently stops being placed is worse than no gift.
     */
    gifts: [{ island: 3, level: 4, seeds: [['frost', 1, 1]] }]
  },
  {
    id: 'borealis',
    name: 'Borealis',
    level: 3,
    editorMap: 'borealis',
    backdrop: 'borealis',
    extendsAuthoredMap: false,
    skipOnAuthoredIsle: false,
    levelOf: plainLevel,
    regionPrefix: 'borealis',
    plan: BOREALIS_PLAN
  },
  {
    id: 'roothold',
    name: 'Roothold',
    // Eleanor's hub. The Ember Gate opens on her FIRST delivered order — which
    // the tutorial itself completes — so the level must never be the wall:
    // WorldSystem's story gate is the whole lock.
    level: 1,
    editorMap: 'roothold',
    backdrop: 'roothold',
    extendsAuthoredMap: false,
    skipOnAuthoredIsle: false,
    levelOf: plainLevel,
    regionPrefix: 'roothold'
  },
  {
    id: 'runevault',
    name: 'Runevault',
    // The Rune Way opens at the CAP (owner's call, 2026-08-26): level 6 is
    // the rank that clears the last clouds off Borealis's main island, and
    // the hub is the reward beyond them. worldGates carries no other latch
    // for it — the rank alone is the gate.
    level: 6,
    /**
     * WAS `hatchery`, MEASURED. This world had no editor grid, so its ground was
     * recovered from the painting by scripts/fit-deck-grid.py (`deck:`) — the
     * right answer while the only thing that existed was the art.
     *
     * On 2026-08-12 the editor replaced that map with `runevault` and drew 33
     * grids on it by hand, so the ground is authored again and comes back down
     * the ordinary editor path. The deck fitter stays in the tree: it is still
     * how a backdrop with no grid gets a board.
     */
    editorMap: 'runevault',
    backdrop: 'runevault',
    extendsAuthoredMap: false,
    skipOnAuthoredIsle: false,
    levelOf: plainLevel,
    regionPrefix: 'runevault'
  }
];

const built = [];
const report = [];

/** Already-built worlds, so a source this clone does not have keeps what it has.
 *  `assets/map/*.json` is gitignored (28 MB authoring artifacts), so a fresh clone
 *  has only `nionja-worlds.json` — and dropping a world on a re-run would silently
 *  delete ground the game ships with. */
const previous = new Map(
  (existsSync(resolve(ROOT, 'src/data/zones.json'))
    ? read('src/data/zones.json').worlds ?? []
    : []
  ).map((w) => [w.id, w])
);

/**
 * ONE WORLD'S FAILURE IS NOT EVERY WORLD'S.
 *
 * This loop used to throw straight out on the first world that would not
 * build, which meant an authoring change to ONE island stopped `zones.json`
 * being regenerated at all — every other world frozen at whatever the last
 * good run left, with no way to ship a fix to any of them until the broken one
 * was resolved. That is the same failure the deck-missing branch below already
 * refuses to accept ("dropping a world on a re-run would silently delete
 * ground the game ships with"); it just had no answer for a world whose source
 * is present but no longer fits its plan.
 *
 * So a world that throws KEEPS ITS LAST GOOD OUTPUT and says so, loudly, in the
 * report and on stderr. Nothing is silently degraded: the ground that shipped
 * still ships, the seeds it shipped with are untouched, and the build carries
 * on. The failure is a message to the author, not a wall in front of everyone.
 */
const failures = [];

for (const spec of WORLDS) {
 try {
  const deckPath = spec.deck ? `assets/map/${spec.deck}-deck.json` : null;
  const deckMissing = deckPath !== null && !existsSync(resolve(ROOT, deckPath));
  if (deckMissing) {
    const kept = previous.get(spec.id);
    if (!kept) throw new Error(`build-zones: ${deckPath} is missing and nothing was built for "${spec.id}" before`);
    console.warn(`build-zones: ${deckPath} not in this clone — keeping the ${spec.id} world already in zones.json`);
    built.push(kept);
    report.push({
      id: spec.id,
      zones: (kept.zones ?? []).length,
      cells: (kept.zones ?? []).reduce((n, z) => n + (z.cells?.length ?? 0), 0),
      dropped: 0,
      extent: 'kept',
      portals: (kept.portals ?? []).map((p) => `→${p.to}`).join(' ') || '—',
      regions: '(unchanged)'
    });
    continue;
  }
  const deck = deckPath ? read(deckPath) : null;
  const src = deck ? null : source.worlds.find((w) => w.map === spec.editorMap);
  if (!deck && !src) throw new Error(`build-zones: no editor world named "${spec.editorMap}"`);

  // Index blocks start past the authored lattice for emberkeep, at the origin
  // for a world that is nothing but zones.
  const standing = standingIn(spec.id);
  let nextCol = spec.extendsAuthoredMap ? authored.cols + BLOCK_GUTTER : 0;
  const zones = [];
  const playable = [];
  const invisible = [];
  const byLevel = new Map();
  let dropped = 0;

  // A MEASURED world: one zone per painted island, cells straight from the fit.
  for (const [n, island] of (deck?.islands ?? []).entries()) {
    const zone = deckZone(deck, island, n, { col: nextCol, row: 0 });
    for (const [i, j] of zone.cells) {
      const col = nextCol + i;
      const row = j;
      playable.push([col, row]);
      invisible.push([col, row]); // the backdrop already paints the flagstones
      const list = byLevel.get(1) ?? [];
      const p = { x: zone.origin[0] + i * zone.u[0] + j * zone.v[0], y: zone.origin[1] + i * zone.u[1] + j * zone.v[1] };
      list.push({ col, row, at: p });
      byLevel.set(1, list);
    }
    zones.push(zone);
    nextCol += zone.matrix[0] + BLOCK_GUTTER;
  }

  for (const grid of src?.grids ?? []) {
    if (!(grid.cells ?? []).length) continue;
    const keep = [];
    for (const c of grid.cells) {
      const art = editorCellWorld(grid, c.i, c.j);
      if (spec.skipOnAuthoredIsle) {
        const onIsle = artToCell(art.x, art.y);
        if (authoredPlayable.has(`${onIsle.col},${onIsle.row}`)) {
          dropped++;
          continue;
        }
      }
      keep.push({ cell: c, art });
    }
    if (!keep.length) continue;

    const zone = zoneOf(grid, { col: nextCol, row: 0 });
    for (const { cell: c, art } of keep) {
      const col = nextCol + c.i;
      const row = c.j;
      zone.cells.push([c.i, c.j]);
      playable.push([col, row]);
      invisible.push([col, row]); // the backdrop already paints these slabs
      const lvl = spec.levelOf(c.unlockLevel);
      const list = byLevel.get(lvl) ?? [];
      // The world point comes along: seeding orders cells by where they ARE,
      // which is the only address that survives a re-export (see seedRegion).
      list.push({ col, row, at: artToWorld(art.x, art.y) });
      byLevel.set(lvl, list);
    }
    zones.push(zone);
    nextCol += grid.matrix.cols + BLOCK_GUTTER;
  }

  /**
   * ONE ISLAND, SEVERAL WAVES — the fog bands, and which of them is the door.
   *
   * The editor's level per cell is the whole schedule: a band is every cell of
   * ONE island drawn at ONE level, so re-levelling a corner in the editor moves
   * exactly that corner's cloud and nothing else. That is the property the
   * owner is authoring against, and it is why the level is never rewritten here.
   *
   * An island's FIRST band — its lowest level, the ground the player reaches
   * first — inherits the plan: its name, its gate and its seeds. Every later
   * band on the same island is a plain level gate suffixed `_l<N>`. Three
   * things fall out of that, all of them wanted:
   *
   *   · `borealis_coast` and `borealis_keep` still exist and still cost the
   *     keys their quests name ("Use 1 Gold Key on the clouds by the coast").
   *     A door bought with a key stays bought with a key.
   *   · the SEEDS land on the band that opens first, so an island's farms are
   *     standing the moment the player can reach it — a generator sealed under
   *     a later band would be an island with nothing to do on it.
   *   · everything past the door opens on RANK. The mainland is four waves
   *     now: the key lets you in, and the island keeps giving ground back as
   *     the Keeper grows.
   */
  const islands = islandsOf([...byLevel.values()].flat());
  const islandOf = new Map();
  islands.forEach((cells, idx) => cells.forEach((c) => islandOf.set(`${c.col},${c.row}`, idx)));

  // The south-first fog march (FOG_MARCH above): re-band the named island's
  // cells by measured world Y before the bands are cut, so everything below —
  // names, gates, seeds-on-the-first-wave — runs on the corrected schedule
  // without knowing it exists.
  const marchSpec = FOG_MARCH[spec.id];
  if (marchSpec && islands[marchSpec.island]?.length) {
    const cells = islands[marchSpec.island];
    const lvlOf = new Map();
    for (const [lvl, list] of byLevel) for (const c of list) lvlOf.set(c, lvl);
    const doorLvl = Math.min(...cells.map((c) => lvlOf.get(c)));
    const doorCount = cells.filter((c) => lvlOf.get(c) === doorLvl).length;
    // South first: larger world Y is lower on screen. Ties by address, so a
    // rebuild is reproducible to the cell.
    const south = [...cells].sort((a, b) => b.at.y - a.at.y || a.col - b.col || a.row - b.row);
    south.slice(0, doorCount).forEach((c) => lvlOf.set(c, doorLvl));
    const rest = south.slice(doorCount);
    const per = Math.ceil(rest.length / marchSpec.waves.length);
    rest.forEach((c, i) =>
      lvlOf.set(c, marchSpec.waves[Math.min(Math.floor(i / per), marchSpec.waves.length - 1)])
    );
    const marched = new Set(cells);
    for (const [lvl, list] of byLevel) {
      byLevel.set(lvl, list.filter((c) => !marched.has(c)));
    }
    for (const c of cells) {
      const lvl = lvlOf.get(c);
      const list = byLevel.get(lvl) ?? [];
      list.push(c);
      byLevel.set(lvl, list);
    }
  }

  const bands = new Map(); // `${island}:${level}` → { island, lvl, cells }
  for (const [lvl, cells] of byLevel) {
    for (const c of cells) {
      const island = islandOf.get(`${c.col},${c.row}`) ?? 0;
      const k = `${island}:${lvl}`;
      const band = bands.get(k) ?? { island, lvl, cells: [] };
      band.cells.push(c);
      bands.set(k, band);
    }
  }
  /** The first wave of each island — the one the plan is about. */
  const firstWave = new Map();
  for (const b of bands.values()) {
    const seen = firstWave.get(b.island);
    if (seen === undefined || b.lvl < seen) firstWave.set(b.island, b.lvl);
  }

  /**
   * ONE NAME PER BAND, AND NEVER TWICE.
   *
   * `regionStatus` is one flat Map keyed by region id (GameState), so two bands
   * sharing a name are one region as far as the game is concerned: opening
   * either opens both, and the save persists a single entry for the pair. That
   * is not hypothetical — emberkeep's drawn ground is eight separate islets and
   * four of them are at level 3, so the plain `<prefix>_l<N>` scheme minted
   * `beyond_l3` four times over.
   *
   * So a band is named for its island as well as its level whenever the level
   * alone does not identify it. Islands are numbered south → north, which is
   * the order the player meets them.
   */
  const bandName = new Map();
  {
    const byName = new Map();
    for (const b of bands.values()) {
      const stem = spec.plan?.[b.island]?.id ?? spec.regionPrefix;
      const plain = firstWave.get(b.island) === b.lvl && spec.plan?.[b.island] ? stem : `${stem}_l${b.lvl}`;
      byName.set(plain, (byName.get(plain) ?? 0) + 1);
    }
    for (const b of bands.values()) {
      const stem = spec.plan?.[b.island]?.id ?? spec.regionPrefix;
      const planned = firstWave.get(b.island) === b.lvl && spec.plan?.[b.island];
      const plain = planned ? stem : `${stem}_l${b.lvl}`;
      bandName.set(
        `${b.island}:${b.lvl}`,
        byName.get(plain) === 1 ? plain : `${stem}_i${b.island}_l${b.lvl}`
      );
    }
  }

  const regions = [...bands.values()]
    .sort((a, b) => a.island - b.island || a.lvl - b.lvl)
    .map(({ island, lvl, cells }) => {
      const tiles = cells.map((c) => [c.col, c.row]);
      const planned = firstWave.get(island) === lvl ? spec.plan?.[island] : undefined;
      if (planned) {
        const contents = seedRegion(cells, planned.seeds, standing);
        return {
          id: planned.id,
          status: planned.status,
          ...(planned.unlock ? { unlock: planned.unlock } : {}),
          tiles,
          ...(contents.length ? { contents } : {})
        };
      }
      /**
       * A LATER WAVE MAY NOT OPEN BEFORE ITS ISLAND'S DOOR.
       *
       * The mainland's door costs a Gold Key and its three inner waves lift on
       * rank. Those are independent conditions, so a Keeper who banks the rank
       * first would clear twenty-five tiles in the middle of an island still
       * ringed by cloud, reachable by nothing. `after` names the door: the wave
       * still opens on its own level, it simply may not do so first.
       *
       * Only where the island HAS a door — an island whose first wave is plain
       * ground needs no precondition, because its later waves are behind
       * nothing but the rank they name.
       */
      const door = spec.plan?.[island];
      const gated = door?.unlock?.keys !== undefined;
      // An authored keepsake for THIS band — laid out by the same rule every
      // other seed is, and marked so the reveal lets a foreign chain through.
      const gift = (spec.gifts ?? []).find((g) => g.island === island && g.level === lvl);
      if (gift) gift.placed = true;
      const giftContents = gift
        ? seedRegion(cells, gift.seeds, standing).map((c) => ({ ...c, keepsake: true }))
        : [];
      return {
        id: bandName.get(`${island}:${lvl}`),
        // `unlockable`, not `locked`, for anything the campaign can actually reach.
        // UnlockSystem.unlockForLevel only lifts regions already standing at
        // `unlockable` — a `locked` one is not yet offered and no level-up touches
        // it — which is why every level-gated region built here (emberkeep's new
        // ground AND roothold_l2) stayed shut for ever, whatever its level said.
        // The authored map has always used `unlockable` for exactly this: see
        // map.json's `level_2` and `level_5`. Ground above the cap keeps `locked`,
        // where being shut is the intent rather than an accident.
        status: lvl <= 1 ? 'active' : lvl <= LEVEL_CAP ? 'unlockable' : 'locked',
        unlock: lvl <= 1 ? undefined : { level: lvl, ...(gated ? { after: door.id } : {}) },
        /**
         * A CLOUD ON EVERY LEVEL THIS GROUND IS NOT OPEN AT — and level 1 is
         * open, so it never wears one.
         *
         * This was `fog: false` for all generated ground, for two reasons that
         * were both about the cloud saying nothing. Above the cap it was a
         * promise the game cannot keep; below it, a grey lid arriving on the
         * first frame over ground the player never asked about, with no way to
         * tell one bank from another — so the board just looked buried.
         *
         * What changed is that the bank now READS as one. The clouds follow the
         * levels drawn in the map editor, so each one is a single coherent mass
         * with its own edge rather than an even lid over everything — which is
         * what makes it scenery you can see past instead of a grey ceiling.
         *
         * A floating "Niveau N" panel over each bank was tried on 2026-08-21 and
         * taken straight back out: with several banks on screen the panels
         * overlapped each other and the board, and reading the price mattered
         * far less than seeing the island. The level stays in the data, and the
         * refusal on tapping a cloud is where it gets said.
         *
         * Derived from the SAME per-cell `unlockLevel` the editor writes, so the
         * grid and the weather cannot disagree: one level, one region, one bank.
         */
        tiles,
        ...(giftContents.length ? { contents: giftContents } : {})
      };
    });

  // A GIFT THAT STOPPED BEING PLACED MUST SAY SO. Islands are numbered from the
  // ground the editor drew, so a redrawn map can renumber them — and a keepsake
  // whose band no longer exists would quietly never be found again.
  for (const g of spec.gifts ?? []) {
    if (!g.placed) {
      throw new Error(
        `build-zones: ${spec.id} gift ${g.seeds.map(([c, t]) => `${c}:${t}`).join(', ')} names island ` +
          `${g.island} level ${g.level}, and this export has no such band — re-address it`
      );
    }
  }

  // Decor: art px → the cell it stands on, plus the leftover as a free nudge.
  // Nearest cell rather than "the cell containing the point" because the anchor
  // may legitimately sit between two cells — the renderer takes any (col,row)
  // plus dx/dy, so the only thing the cell has to be is CLOSE, which keeps the
  // ground shadow (drawn on the cell) under the prop.
  const mapDecor = [];
  const decorCalibration = {};
  for (const raw of DECOR[spec.id] ?? []) {
    const d = raw.fromEditorAsset ? editorDecor(spec, raw) : raw;
    if (!d) continue; // the editor has not placed it (warned above)
    const target = artToWorld(d.at[0], d.at[1]);
    let home;
    for (const z of zones) {
      for (const [i, j] of z.cells) {
        // Through the zone's ROTATION, the same way `worldPointOf` will at
        // runtime. dx/dy is the gap between this point and the prop, so a point
        // computed the other way puts the pot back by exactly the rotation the
        // runtime then applies. Every zone drawn so far happens to sit at 0°,
        // which is the only reason the flat version was ever right.
        const p = rotate(
          {
            x: z.origin[0] + i * z.u[0] + j * z.v[0],
            y: z.origin[1] + i * z.u[1] + j * z.v[1]
          },
          { x: z.pivot[0], y: z.pivot[1] },
          z.rotation
        );
        const dist = Math.hypot(p.x - target.x, p.y - target.y);
        if (!home || dist < home.dist) home = { dist, col: z.block[0] + i, row: z.block[1] + j, p };
      }
    }
    if (!home) throw new Error(`build-zones: ${spec.id} has no ground for decor "${d.name}"`);
    mapDecor.push({
      name: d.name,
      col: home.col,
      row: home.row,
      z: 0,
      // `ratio` back out of world px, because that is the space MapDecorRender's
      // dx/dy is authored in — BoardScene multiplies it by TILE_W/tile.width.
      dx: round2((target.x - home.p.x) / ratio),
      dy: round2((target.y - home.p.y) / ratio)
    });
    decorCalibration[d.name] = { offsetX: 0, offsetY: 0, scale: d.scale, anchor: d.anchor };
  }

  const cols = Math.max(spec.extendsAuthoredMap ? authored.cols : 0, nextCol);
  const rows = Math.max(
    spec.extendsAuthoredMap ? authored.rows : 1,
    ...zones.map((z) => z.matrix[1]),
    1
  );

  /** For a world of its own, the whole MapData; for emberkeep, only what is
   *  ADDED to the authored map (which stays the file it is on disk). */
  const decor = mapDecor.length ? { mapDecor, decorCalibration } : {};
  const map = spec.extendsAuthoredMap
    ? { cols, rows, playable, invisible, regions, ...decor }
    : {
        cols,
        rows,
        playable,
        invisible,
        regions,
        ...decor,
        startingItems: [],
        tile: authored.tile,
        backgrounds: [{ name: spec.backdrop, col: bg.col, row: bg.row, z: 0, dx: bg.dx, dy: bg.dy }],
        backgroundCalibration: { [spec.backdrop]: cal },
        cameraZoom: authored.cameraZoom
      };

  built.push({
    id: spec.id,
    name: spec.name,
    level: spec.level,
    backdrop: spec.backdrop,
    extendsAuthoredMap: spec.extendsAuthoredMap,
    // Zone origins below are ABSOLUTE world pixels, derived from where the
    // authored map places its backdrop. Stamp the map they were measured
    // against so the runtime can refuse to graft them onto a different lattice
    // — a re-exported map.json with this file left stale would otherwise put
    // every new zone a silent few hundred pixels off its island.
    // The signature says "these zones were measured against THAT map" — which is
    // true whether or not the world extends it. It used to be stamped only when
    // extending, so the day emberkeep stopped extending, the 8x8 unit fixture
    // started inheriting the isle's absolute zone geometry.
    ...(spec.id === PRIMARY_WORLD_ID ? { baseSignature: signatureOf(spec.id, authored) } : {}),
    map,
    zones,
    portals: (PORTALS[spec.id] ?? []).map(portalOf)
  });
  report.push({
    id: spec.id,
    zones: zones.length,
    cells: playable.length,
    portals: (PORTALS[spec.id] ?? []).map((p) => `→${p.to}`).join(' ') || 'none',
    dropped,
    regions: regions.map((r) => `${r.id}(${r.tiles.length})`).join(' '),
    extent: `${cols}x${rows}`
  });
 } catch (err) {
  const kept = previous.get(spec.id);
  // Nothing built before AND nothing builds now: there is no world to ship and
  // no last-good one to fall back on. That is still fatal.
  if (!kept) throw err;
  failures.push({ id: spec.id, why: err.message });
  built.push(kept);
  report.push({
    id: spec.id,
    zones: (kept.zones ?? []).length,
    cells: (kept.zones ?? []).reduce((n, z) => n + (z.cells?.length ?? 0), 0),
    dropped: 0,
    extent: 'KEPT (build failed)',
    portals: (kept.portals ?? []).map((p) => `→${p.to}`).join(' ') || '—',
    regions: '(unchanged — see the failure below)'
  });
 }
}

// A door is dead input the moment it names a world this build cannot run, and a
// world with no door is one the player walks into and cannot leave. Both are
// invisible on screen — the rectangle is invisible by design — so they are
// caught here, where the data is written, rather than by someone tapping an
// arch that does nothing.
const knownWorlds = new Set(built.map((w) => w.id));
for (const w of built) {
  if (!w.portals.length) throw new Error(`build-zones: ${w.id} has no portal — nothing leads out of it`);
  for (const p of w.portals) {
    if (!knownWorlds.has(p.to)) throw new Error(`build-zones: ${w.id}/${p.id} leads to unknown world "${p.to}"`);
    if (p.to === w.id) throw new Error(`build-zones: ${w.id}/${p.id} leads to itself`);
  }
}

const acc = fitAccuracy();
const doc = {
  format: 'emberkeep-zones',
  version: 1,
  source: SOURCE,
  generatedBy: 'scripts/build-zones.mjs',
  /** The measured editor→backdrop transform, kept for provenance: anyone
   *  re-importing from the editor can check these numbers still hold. */
  editorToArt: {
    method: 'analytic (layer cover placement); least-squares kept as watchdog',
    scaleX: Math.round(((COVER * LAYER.w) / ART_W) * 1e5) / 1e5,
    scaleY: Math.round(((COVER * LAYER.h) / ART_H) * 1e5) / 1e5,
    offsetX: round2(LAYER_TL.x),
    offsetY: round2(LAYER_TL.y),
    fitted: { scale: Math.round(FIT.scale * 1e5) / 1e5, offsetX: round2(FIT.offsetX), offsetY: round2(FIT.offsetY), samples: FIT.samples },
    reproducesEditorCells: `${acc.hit}/${acc.total}`,
    worstErrorArtPx: Math.round(acc.worst)
  },
  worlds: built
};

writeFileSync(resolve(ROOT, OUT), `${JSON.stringify(doc, null, 2)}\n`);

console.log(`editor→art  scale ${doc.editorToArt.scaleX}/${doc.editorToArt.scaleY} (analytic)  offset (${doc.editorToArt.offsetX}, ${doc.editorToArt.offsetY})  [fit watchdog: ${doc.editorToArt.fitted.scale}]`);
console.log(`            reproduces the editor's own gameCell for ${acc.hit}/${acc.total} cells (worst ${Math.round(acc.worst)} art px)`);
for (const r of report) {
  console.log(
    `${r.id.padEnd(10)} zones ${String(r.zones).padStart(2)}  cells ${String(r.cells).padStart(3)}  ` +
      `dropped-onto-authored-isle ${String(r.dropped).padStart(2)}  extent ${r.extent.padEnd(8)}  ` +
      `door ${r.portals.padEnd(11)}  ${r.regions}`
  );
}
console.log(`wrote ${OUT}`);

// LOUD, and last, so it is the thing left on screen. A kept world is ground the
// player still gets; it is also authoring that did not land, and the two must
// never be confused with a clean run.
if (seedShortfalls.length) {
  console.error('');
  for (const w of seedShortfalls) console.error(`build-zones: SEED SHORTFALL — ${w}`);
  console.error(
    'build-zones: the geometry shipped anyway; re-fit BOREALIS_PLAN (or the island) to restore the missing contents.'
  );
}
if (failures.length) {
  console.error('');
  for (const f of failures) {
    console.error(`build-zones: ${f.id} DID NOT REBUILD — kept the world already in zones.json.`);
    console.error(`             ${f.why}`);
  }
  console.error(
    `build-zones: ${failures.length} world(s) are stale in ${OUT}. Everything else was rebuilt.`
  );
}
