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
 * 2. WHICH CELLS ARE ALREADY OURS. The `nb2` world is a re-grid of the SAME
 *    island our authored map.json covers, cut into 30 small grids. Adopting it
 *    wholesale would throw away the authored 46-tile isle the tutorial, the
 *    quest ladder and every save are written against. So the main isle stays
 *    exactly as authored — it is simply the zone named `main` now — and only the
 *    editor cells that land OFF it become new zones. That is the whole of the
 *    "same map, more zones" transition: nothing on the island moves.
 *
 * 3. WHEN THE NEW GROUND OPENS. The editor's unlock levels are 2 and 3, which
 *    are levels Chapter One actually reaches — new tiles would pop mid-campaign.
 *    Emberkeep's new zones are therefore rebased above the Chapter One cap
 *    (LEVEL_XP ends at 3), so the shipped chapter is bit-for-bit the game it was.
 *
 * Run: node scripts/build-zones.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));

const SOURCE = 'assets/map/nionja-worlds.json';
const OUT = 'src/data/zones.json';

/* ---- the engine's own numbers (src/core/Constants.ts) ---- */
const TILE_W = 256;
const BOARD_ORIGIN_X = 2560 / 2;
const BOARD_ORIGIN_Y = 316;
/** Every shipped backdrop is this size, and each world reuses the authored
 *  emberkeep placement, so one art→world transform serves all of them. */
const ART_W = 2610;
const ART_H = 1632;
/** First Keeper level a new emberkeep zone may open on — one past the Chapter
 *  One cap, so none of this ground can appear during the shipped campaign. */
const BEYOND_BASE_LEVEL = 4;
/** Blank columns between two zones' index blocks. One is enough to make a
 *  ±1 step fall in the gap, so adjacency can never leak between zones even
 *  before the same-zone rule in world.ts. */
const BLOCK_GUTTER = 1;
/** Highest Keeper level the shipped campaign reaches (Constants' LEVEL_XP). */
const LEVEL_CAP = 3;

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
/* 2. fit the editor→backdrop transform from the editor's own gameCells  */
/* ------------------------------------------------------------------ */

/** Least squares for `editor = scale·art + offset`, one uniform scale. */
function fitEditorToArt() {
  const rows = [];
  for (const w of source.worlds) {
    for (const g of w.grids ?? []) {
      for (const c of g.cells ?? []) {
        rows.push({
          art: {
            x: A0.x + c.gameCell.col * AU.x + c.gameCell.row * AV.x,
            y: A0.y + c.gameCell.col * AU.y + c.gameCell.row * AV.y
          },
          ed: c.world
        });
      }
    }
  }
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
  return { scale: b[0] / M[0][0], offsetX: b[1] / M[1][1], offsetY: b[2] / M[2][2], samples: n };
}

const FIT = fitEditorToArt();
const editorToArt = (p) => ({ x: (p.x - FIT.offsetX) / FIT.scale, y: (p.y - FIT.offsetY) / FIT.scale });

/** How faithfully the fit reproduces the editor's own cell assignment. */
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
        const dx = a.x - (A0.x + c.gameCell.col * AU.x + c.gameCell.row * AV.x);
        const dy = a.y - (A0.y + c.gameCell.col * AU.y + c.gameCell.row * AV.y);
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

/** Chapter One owns the isle; new emberkeep ground waits until after it. */
const emberkeepLevel = (editorUnlock) => BEYOND_BASE_LEVEL + Math.max(0, (editorUnlock ?? 1) - 2);
const plainLevel = (editorUnlock) => Math.max(1, editorUnlock ?? 1);

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
  // editor unlock level → the island it names
  1: {
    id: 'borealis_shore',
    status: 'active',
    // 9 cells. One landmark and five spars leaves three free — enough to merge
    // in (a merge needs three touching) and not enough to sprawl. Both Bound
    // Faggots for Selyna's signal fire are one haul away, so the door quest
    // never stalls on the tide.
    seeds: [
      ['wrackline', 1, 1],
      ['driftwood', 1, 5]
    ]
  },
  3: {
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
    seeds: [
      ['frostfont', 1, 1],
      ['wrackline', 1, 1],
      ['rimebloom', 1, 3],
      ['driftwood', 1, 3],
      ['keel', 1, 3],
      ['chest', 1, 1]
    ]
  },
  2: {
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
    layout: 'perimeter',
    seeds: [
      ['wrackline', 1, 2],
      ['frostfont', 1, 2],
      ['chest', 1, 1]
    ]
  }
};

/**
 * Lay a region's seeds out from its middle outwards.
 *
 * Placement is DERIVED, never pasted: a re-export moves every cell, and a
 * hand-written `[col,row]` would then be either a hole in the sky or on top of
 * the landmark beside it. Ordering by distance from the island's centre also
 * puts the producers where their output has somewhere to land, which is the
 * only thing the choice actually has to get right.
 */
function seedRegion(cells, seeds, taken, layout) {
  if (!seeds?.length || !cells.length) return [];
  const cx = cells.reduce((n, c) => n + c.at.x, 0) / cells.length;
  const cy = cells.reduce((n, c) => n + c.at.y, 0) / cells.length;
  // A world character stands ON a cell (characters.json anchors), and she is
  // scenery rather than a board item — so nothing stops a Hoarfrost Font from
  // being dropped through her. Leave her cell alone.
  const free = cells.filter((c) => !taken.has(`${c.col},${c.row}`));

  // PERIMETER layout: each seed on its own side of the island. Seed k gets the
  // compass direction k·(2π/N), and takes the free cell that reaches FURTHEST
  // from the centroid in that direction (max dot product) — which is the rim by
  // construction, derived from the cells like everything else here, so a
  // re-export moves the ring with the island. Generators belong on the rim:
  // laid mid-out they wall off the exact tiles their own produce needs.
  if (layout === 'perimeter') {
    const total = seeds.reduce((n, [, , count]) => n + count, 0);
    const used = new Set();
    const out = [];
    let k = 0;
    for (const [chain, tier, count] of seeds) {
      for (let i = 0; i < count; i++, k++) {
        const th = (k / total) * Math.PI * 2 - Math.PI / 2; // start north, go clockwise
        const dir = { x: Math.cos(th), y: Math.sin(th) };
        let best;
        let bestD = -Infinity;
        for (const c of free) {
          if (used.has(c)) continue;
          const d = (c.at.x - cx) * dir.x + (c.at.y - cy) * dir.y;
          if (d > bestD) {
            bestD = d;
            best = c;
          }
        }
        if (!best) throw new Error(`build-zones: ${chain} has no room — island holds ${cells.length}`);
        used.add(best);
        out.push({ chain, tier, at: [best.col, best.row] });
      }
    }
    return out;
  }

  const order = [...free].sort(
    (a, b) => Math.hypot(a.at.x - cx, a.at.y - cy) - Math.hypot(b.at.x - cx, b.at.y - cy)
  );
  const out = [];
  let n = 0;
  for (const [chain, tier, count] of seeds) {
    for (let k = 0; k < count; k++) {
      const cell = order[n++];
      if (!cell) throw new Error(`build-zones: ${chain} has no room — island holds ${cells.length}`);
      out.push({ chain, tier, at: [cell.col, cell.row] });
    }
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
    { id: 'borealis_rune_gate', to: 'hatchery', label: 'The Rune Way', art: [365, 235, 175, 205] }
  ],
  hatchery: [
    // The gold rune circle inlaid in the middle of the deck. It sits ON playable
    // ground, which is exactly right and costs nothing: a portal is the lowest
    // interactive band on the board, so a piece standing on the circle takes the
    // tap and only bare stone travels.
    { id: 'hatchery_circle', to: 'borealis', label: 'The Rune Circle', art: [1335, 605, 415, 275] }
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
  hatchery: [
    {
      name: 'pink_cauldron',
      at: [1542.5, 742.5], // the gold rune circle's centre
      anchor: { x: 0.5, y: 0.845 },
      scale: 1
    }
  ]
};

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
    /** Built ON src/data/map.json: the authored isle is the zone `main`, and
     *  everything below is added beside it. */
    extendsAuthoredMap: true,
    /** Drop editor cells that land on ground the authored isle already owns —
     *  two lattices over one slab is how a save loses its board. */
    skipOnAuthoredIsle: true,
    levelOf: emberkeepLevel,
    regionPrefix: 'beyond'
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
    id: 'hatchery',
    name: 'Hatchery',
    // Borealis's hub, so it opens with Borealis: a hub the player cannot reach
    // from the sanctuary it serves is a shop with the lights off.
    level: 3,
    // No editor grid exists for this world — its ground is MEASURED out of the
    // backdrop by scripts/fit-deck-grid.py. See `deckZone`.
    deck: 'hatchery',
    backdrop: 'hatchery',
    extendsAuthoredMap: false,
    skipOnAuthoredIsle: false,
    levelOf: plainLevel,
    regionPrefix: 'hatchery'
  }
];

const built = [];
const report = [];

for (const spec of WORLDS) {
  const deck = spec.deck ? read(`assets/map/${spec.deck}-deck.json`) : null;
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

  const regions = [...byLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lvl, cells]) => {
      const tiles = cells.map((c) => [c.col, c.row]);
      const planned = spec.plan?.[lvl];
      if (planned) {
        const contents = seedRegion(cells, planned.seeds, standing, planned.layout);
        return {
          id: planned.id,
          status: planned.status,
          ...(planned.unlock ? { unlock: planned.unlock } : {}),
          tiles,
          ...(contents.length ? { contents } : {})
        };
      }
      return {
        id: `${spec.regionPrefix}_l${lvl}`,
        status: lvl <= 1 ? 'active' : 'locked',
        unlock: lvl <= 1 ? undefined : { level: lvl },
        // Ground gated above the shipped level cap wears no cloud: it cannot be
        // opened this chapter, so a cloud there would be a promise the game
        // cannot keep, over scenery the player should be looking at. See
        // MapRegionConfig.fog.
        ...(lvl > LEVEL_CAP ? { fog: false } : {}),
        tiles
      };
    });

  // Decor: art px → the cell it stands on, plus the leftover as a free nudge.
  // Nearest cell rather than "the cell containing the point" because the anchor
  // may legitimately sit between two cells — the renderer takes any (col,row)
  // plus dx/dy, so the only thing the cell has to be is CLOSE, which keeps the
  // ground shadow (drawn on the cell) under the prop.
  const mapDecor = [];
  const decorCalibration = {};
  for (const d of DECOR[spec.id] ?? []) {
    const target = artToWorld(d.at[0], d.at[1]);
    let home;
    for (const z of zones) {
      for (const [i, j] of z.cells) {
        const p = {
          x: z.origin[0] + i * z.u[0] + j * z.v[0],
          y: z.origin[1] + i * z.u[1] + j * z.v[1]
        };
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
    ...(spec.extendsAuthoredMap ? { baseSignature: signatureOf(spec.id, authored) } : {}),
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
    scale: Math.round(FIT.scale * 1e5) / 1e5,
    offsetX: round2(FIT.offsetX),
    offsetY: round2(FIT.offsetY),
    samples: FIT.samples,
    reproducesEditorCells: `${acc.hit}/${acc.total}`,
    worstErrorArtPx: Math.round(acc.worst)
  },
  worlds: built
};

writeFileSync(resolve(ROOT, OUT), `${JSON.stringify(doc, null, 2)}\n`);

console.log(`editor→art  scale ${doc.editorToArt.scale}  offset (${doc.editorToArt.offsetX}, ${doc.editorToArt.offsetY})`);
console.log(`            reproduces the editor's own gameCell for ${acc.hit}/${acc.total} cells (worst ${Math.round(acc.worst)} art px)`);
for (const r of report) {
  console.log(
    `${r.id.padEnd(10)} zones ${String(r.zones).padStart(2)}  cells ${String(r.cells).padStart(3)}  ` +
      `dropped-onto-authored-isle ${String(r.dropped).padStart(2)}  extent ${r.extent.padEnd(8)}  ` +
      `door ${r.portals.padEnd(11)}  ${r.regions}`
  );
}
console.log(`wrote ${OUT}`);
