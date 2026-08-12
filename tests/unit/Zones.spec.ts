import { describe, expect, it } from 'vitest';
import realMap from '../../src/data/map.json';
import { LEVEL_XP, SAVE_VERSION, WORLD_ID } from '../../src/core/Constants';
import { GameContext } from '../../src/core/Context';
import { GameState } from '../../src/core/GameState';
import type { TextureBin } from '../../src/core/worldArt';
import { releaseAwayWorldArt, worldArtKeys } from '../../src/core/worldArt';
import { project, projectionOf } from '../../src/core/iso';
import { mapSignature } from '../../src/core/mapSpace';
import type { MapData, SaveDataV1 } from '../../src/core/types';
import { createTestContext, MemoryStorage } from './helpers';
import {
  buildWorlds,
  cellAtWorldPoint,
  hasCell,
  neighborsOf,
  portalAtWorldPoint,
  worldPointOf,
  ZONES,
  zoneAt
} from '../../src/core/world';

const MAP = realMap as unknown as MapData;
const WORLDS = buildWorlds(MAP);
const EMBERKEEP = WORLDS.get(WORLD_ID)!;

/* ------------------------------------------------------------------ */
/* the guard the whole transition rests on                              */
/* ------------------------------------------------------------------ */

describe('zones — the authored isle did not move', () => {
  /**
   * THE regression test. Everything else in this change is new ground; this is
   * the one that says the old ground is untouched. If it ever fails, every save
   * in the wild is pointing at the wrong pixel.
   */
  it('projects every address as the single-lattice projection did', () => {
    const p = projectionOf(MAP.tile);
    let checked = 0;
    let worst = 0;
    // The authored rectangle, plus a margin of off-grid addresses: projection is
    // unbounded on purpose (the Golden Altar is authored at -2,2) and that has
    // to keep being true, not merely keep being tolerated.
    for (let col = -4; col < MAP.cols + 4; col++) {
      for (let row = -4; row < MAP.rows + 4; row++) {
        // Skip the columns the new zones now occupy — those are new ground with
        // geometry of their own, and nothing was ever addressed there.
        if (col >= MAP.cols) continue;
        const now = worldPointOf(EMBERKEEP, col, row);
        const before = project(p, col, row);
        worst = Math.max(worst, Math.abs(now.x - before.x), Math.abs(now.y - before.y));
        checked++;
      }
    }
    expect(checked).toBe((MAP.cols + 4) * (MAP.rows + 8)); // incl. the off-grid margin
    // Not asserted as bitwise equality, and deliberately so: the zone form sums
    // `col·u + row·v` where the old form summed `(col + row)·halfH`, which is the
    // same number reached by a different association and so lands within an ULP
    // of it. The claim worth making is the one that matters to the game — the
    // difference is thirteen orders of magnitude below one device pixel, so
    // nothing that was ever drawn, tapped or saved can tell the two apart.
    expect(worst).toBeLessThan(1e-9);
  });

  it('answers "is there ground here" exactly as the old bounds test did', () => {
    for (let col = -3; col < MAP.cols + 3; col++) {
      for (let row = -3; row < MAP.rows + 3; row++) {
        if (col >= MAP.cols && col < EMBERKEEP.cols) continue; // new zones' columns
        const wasInBounds = col >= 0 && row >= 0 && col < MAP.cols && row < MAP.rows;
        expect(hasCell(EMBERKEEP, col, row)).toBe(wasInBounds);
      }
    }
  });

  it('lists the same four neighbours, in the same order, on the isle', () => {
    const old = (col: number, row: number) =>
      [
        { col: col + 1, row },
        { col: col - 1, row },
        { col, row: row + 1 },
        { col, row: row - 1 }
      ].filter((p) => p.col >= 0 && p.row >= 0 && p.col < MAP.cols && p.row < MAP.rows);
    for (let col = 0; col < MAP.cols; col++) {
      for (let row = 0; row < MAP.rows; row++) {
        expect(neighborsOf(EMBERKEEP, col, row)).toEqual(old(col, row));
      }
    }
  });

  it('keeps the map signature of the authored lattice, so no save re-grids', () => {
    expect(EMBERKEEP.signature).toBe(mapSignature(WORLD_ID, MAP));
  });

  /** The generator stamps a signature; the runtime recomputes it. If these ever
   *  disagree the extra zones are quietly dropped, so say so loudly here. */
  it('has zone geometry built against the map.json actually on disk', () => {
    const spec = ZONES.worlds.find((w) => w.id === WORLD_ID)!;
    expect(spec.baseSignature).toBe(mapSignature(WORLD_ID, MAP));
    expect(EMBERKEEP.zones.length).toBeGreaterThan(1); // the graft was accepted
  });
});

/* ------------------------------------------------------------------ */
/* the new ground                                                       */
/* ------------------------------------------------------------------ */

describe('zones — new ground beside the isle', () => {
  it('adds zones only where the authored isle is not', () => {
    const isle = new Set((MAP.playable ?? []).map(([c, r]) => `${c},${r}`));
    const main = EMBERKEEP.zones[0]!;
    expect(main.id).toBe('main');
    for (const z of EMBERKEEP.zones.slice(1)) {
      expect(z.block.col).toBeGreaterThanOrEqual(MAP.cols);
      for (const cell of z.cells) {
        const [i, j] = cell.split(',').map(Number);
        const col = z.block.col + (i ?? 0);
        const row = z.block.row + (j ?? 0);
        expect(isle.has(`${col},${row}`)).toBe(false);
      }
    }
  });

  /**
   * The new ground OPENS during Chapter One — a product decision (2026-08-11),
   * taken with its cost known, and the reason this test changed shape.
   *
   * It used to assert the opposite: every added region had to unlock ABOVE
   * `LEVEL_XP.length`, so that no tile could pop onto the shipped board
   * mid-campaign and the tutorial would keep teaching the game it was written
   * for. The cost of that safety was total — `LEVEL_XP` ends at 3 and
   * `UnlockSystem` only lifts a level region when the Keeper reaches its level,
   * so 36 cells drawn in the map editor were ground no player could ever stand
   * on. The editor showed them; the game did not; "my grid doesn't match" was
   * exactly that gap. `BEYOND_BASE_LEVEL` now lands them on 2 and 3.
   *
   * What still has to hold, and is what this test now pins:
   *   - `unlockable`, never `active` — the ground is offered under cloud, not
   *     standing on the board at boot;
   *   - and never `locked` either, which is the trap this whole change was:
   *     `UnlockSystem.unlockForLevel` only lifts a region already at
   *     `unlockable`, so a locked one ignores every level-up for ever no matter
   *     what its `unlock.level` says;
   *   - none opens below level 2 — the isle the tutorial is written against is
   *     the board the player is handed;
   *   - none opens above the cap either, or it is unreachable ground again.
   * The tutorial's own level-up beat IS level 2, so the first region surfaces
   * while the tutorial still runs: the full-tutorial e2e is the check that
   * matters here, not this test.
   */
  it('opens its new ground inside Chapter One, never before level 2', () => {
    const added = EMBERKEEP.map.regions.filter((r) => !MAP.regions.some((a) => a.id === r.id));
    expect(added.length).toBeGreaterThan(0);
    for (const region of added) {
      expect(region.status).toBe('unlockable');
      const level = region.unlock?.level ?? 0;
      expect(level).toBeGreaterThanOrEqual(2);
      expect(level).toBeLessThanOrEqual(LEVEL_XP.length);
    }
  });

  /**
   * The merge law, measured the way a player reads it: you may merge with the
   * tile beside you and not with one across the water.
   *
   * This deliberately does NOT assert that a neighbour shares your zone. It used
   * to, and that was a proxy for the real rule which the art does not honour: the
   * map editor cuts one painted island into as many grids as it likes, so
   * Borealis's three islands arrive as 38 zones and 96 of its 141 cells had their
   * true neighbour ruled out by an editor artefact. What must hold is geometric.
   */
  it('never lets a merge reach across the gap between two slabs', () => {
    let crossZone = 0;
    for (const world of WORLDS.values()) {
      for (const z of world.zones) {
        for (const cell of z.cells) {
          const [i, j] = cell.split(',').map(Number);
          const col = z.block.col + (i ?? 0);
          const row = z.block.row + (j ?? 0);
          const here = worldPointOf(world, col, row);
          // The LONGER of the two axes: a zone's cells need not be square, and a
          // step along the long axis is still one step.
          const step = Math.max(Math.hypot(z.u.x, z.u.y), Math.hypot(z.v.x, z.v.y));
          const ns = neighborsOf(world, col, row);
          // Four sides to a tile. More would mean the diagonal had crept in.
          expect(ns.length).toBeLessThanOrEqual(4);
          for (const n of ns) {
            const there = worldPointOf(world, n.col, n.row);
            const d = Math.hypot(there.x - here.x, there.y - here.y);
            // One step, give or take the pitch mismatch between two editor grids.
            expect(d).toBeLessThan(step * 1.6);
            if (zoneAt(world, n.col, n.row) !== z) crossZone++;
          }
        }
      }
    }
    // And it does heal the seams rather than merely permitting it to.
    expect(crossZone).toBeGreaterThan(0);
  });

  /**
   * THE reason the rule above changed. Borealis is drawn as three islands — the
   * southern platform you land on, the keep with the door, and the mainland —
   * and the editor delivered them as 38 grids. If this ever reports more than
   * three, some island has been severed from itself and two thirds of the
   * world's cells cannot merge with the tile they are touching.
   */
  it('leaves Borealis as the three islands it is painted as', () => {
    const world = WORLDS.get('borealis')!;
    const all = world.map.regions.flatMap((r) => r.tiles.map(([c, r2]) => `${c},${r2}`));
    const seen = new Set<string>();
    const islands: number[] = [];
    for (const start of all) {
      if (seen.has(start)) continue;
      let size = 0;
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const [c = 0, r = 0] = stack.pop()!.split(',').map(Number);
        size++;
        for (const n of neighborsOf(world, c, r)) {
          const k = `${n.col},${n.row}`;
          if (seen.has(k)) continue;
          seen.add(k);
          stack.push(k);
        }
      }
      islands.push(size);
    }
    expect(islands.sort((a, b) => b - a)).toEqual([103, 29, 9]);
    // …and each island is exactly one region, which is what lets fog gate them.
    for (const region of world.map.regions) {
      const ids = new Set(region.tiles.map(([c, r]) => `${c},${r}`));
      for (const [c, r] of region.tiles) {
        for (const n of neighborsOf(world, c, r)) expect(ids.has(`${n.col},${n.row}`)).toBe(true);
      }
    }
  });

  /** The authored isle must never gain a neighbour it was not drawn with — a
   *  `beyond` slab sits 80 px from it, a third of the isle's own 242 px step. */
  it('never grafts new ground onto the authored lattice', () => {
    const main = EMBERKEEP.zones[0]!;
    for (let col = 0; col < MAP.cols; col++) {
      for (let row = 0; row < MAP.rows; row++) {
        for (const n of neighborsOf(EMBERKEEP, col, row)) {
          expect(zoneAt(EMBERKEEP, n.col, n.row)).toBe(main);
        }
      }
    }
  });

  it('round-trips every cell of every world through world pixels', () => {
    let checked = 0;
    for (const world of WORLDS.values()) {
      for (const z of world.zones) {
        if (z.dense) continue; // the isle is covered by the identity test above
        for (const cell of z.cells) {
          const [i, j] = cell.split(',').map(Number);
          const col = z.block.col + (i ?? 0);
          const row = z.block.row + (j ?? 0);
          const p = worldPointOf(world, col, row);
          expect(cellAtWorldPoint(world, p.x, p.y)).toEqual({ col, row });
          checked++;
        }
      }
    }
    // emberkeep's new ground + borealis + roothold + hatchery's measured deck
    expect(checked).toBe(36 + 141 + 141 + 246);
  });

  it('gives every world unique region ids, so status can stay one map', () => {
    const ids = [...WORLDS.values()].flatMap((w) => w.map.regions.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ------------------------------------------------------------------ */
/* the doors out                                                        */
/* ------------------------------------------------------------------ */

describe('portals — every world has a way out of it', () => {
  /** The nearest playable cell to a world point, in world px. */
  const distToGround = (world: (typeof WORLDS) extends Map<string, infer W> ? W : never, x: number, y: number): number => {
    let best = Infinity;
    for (const z of world.zones) {
      const cells = z.dense
        ? [...Array(z.matrix.cols * z.matrix.rows).keys()].map((n) => [n % z.matrix.cols, Math.floor(n / z.matrix.cols)])
        : [...z.cells].map((c) => c.split(',').map(Number));
      for (const [i = 0, j = 0] of cells) {
        const p = worldPointOf(world, z.block.col + i, z.block.row + j);
        best = Math.min(best, Math.hypot(p.x - x, p.y - y));
      }
    }
    return best;
  };

  /**
   * The whole point of the feature, stated as an invariant. A world with no door
   * is one the player walks into and cannot leave — and because a portal is an
   * INVISIBLE rectangle, there is nothing on screen that would ever show it is
   * missing.
   */
  it('gives every world at least one door', () => {
    for (const world of WORLDS.values()) {
      expect(world.portals.length).toBeGreaterThan(0);
    }
  });

  it('never lets a door lead nowhere, or back into its own world', () => {
    const ids = new Set(WORLDS.keys());
    const seen = new Set<string>();
    for (const world of WORLDS.values()) {
      for (const p of world.portals) {
        expect(ids.has(p.to)).toBe(true);
        expect(p.to).not.toBe(world.id);
        expect(seen.has(p.id)).toBe(false); // one id, one door, across the whole doc
        seen.add(p.id);
        expect(p.width).toBeGreaterThan(0);
        expect(p.height).toBeGreaterThan(0);
      }
    }
  });

  /** A tap inside the rectangle must find the door the author drew there — the
   *  one thing the runtime does with a portal, asserted against the data. */
  it('answers a tap anywhere inside its rectangle', () => {
    for (const world of WORLDS.values()) {
      for (const p of world.portals) {
        for (const [fx, fy] of [[0.5, 0.5], [0.02, 0.02], [0.98, 0.98]] as const) {
          const hit = portalAtWorldPoint(world, p.x + p.width * fx, p.y + p.height * fy);
          expect(hit?.id).toBe(p.id);
        }
        // …and nothing outside it.
        expect(portalAtWorldPoint(world, p.x - 1, p.y - 1)).toBeUndefined();
        expect(portalAtWorldPoint(world, p.x + p.width + 1, p.y + p.height + 1)).toBeUndefined();
      }
    }
  });

  /**
   * A door in open sky is a door the camera may never reach. Each is authored
   * over the gateway its backdrop paints, and every one of those gateways stands
   * on an island — so the measure that catches a mis-typed coordinate is
   * distance to the nearest ground. Measured: the furthest of the shipped three
   * is 239 px from a cell centre, ~0.57 of the authored 420 px tile. Allowing
   * one and a half tiles leaves an author room to hang a door off a rim without
   * letting a rect that landed hundreds of pixels out over open cloud through.
   */
  it('puts every door beside the ground, never out over open sky', () => {
    const TILE = MAP.tile?.width ?? 256;
    for (const world of WORLDS.values()) {
      for (const p of world.portals) {
        const d = distToGround(world, p.x + p.width / 2, p.y + p.height / 2);
        expect(d).toBeLessThan(TILE * 1.5);
      }
    }
  });

  /**
   * The full network: six doors, no world a dead end, every door a round trip.
   *
   *   Emberkeep → Roothold (the Ember Gate) and → Borealis (the North
   *   Crossing); Roothold → Emberkeep (the Vine Arch); Borealis → Emberkeep
   *   (the Ash Road) and → Hatchery (the Rune Way); Hatchery → Borealis (the
   *   Rune Circle). WorldSystem's story gates decide WHEN each opens — the
   *   topology's job is only that nowhere can strand the Keeper.
   */
  it('leaves no world a dead end — a door out and a door in, each', () => {
    const into = new Set([...WORLDS.values()].flatMap((w) => w.portals.map((p) => p.to)));
    for (const world of WORLDS.values()) {
      expect(world.portals.length).toBeGreaterThan(0);
      expect(into.has(world.id)).toBe(true);
    }
  });

  it('pairs every door with its return', () => {
    for (const world of WORLDS.values()) {
      for (const p of world.portals) {
        const back = WORLDS.get(p.to)!.portals.some((q) => q.to === world.id);
        expect(back).toBe(true);
      }
    }
  });

  it('routes exactly the authored network', () => {
    const routes = [...WORLDS.values()]
      .flatMap((w) => w.portals.map((p) => `${w.id}->${p.to}`))
      .sort();
    expect(routes).toEqual([
      'borealis->emberkeep',
      'borealis->hatchery',
      'emberkeep->borealis',
      'emberkeep->roothold',
      'hatchery->borealis',
      'roothold->emberkeep'
    ]);
  });

  /**
   * A door is an INTENT, never a shortcut. WorldSystem owns whether the journey
   * happens, so tapping the Ember Gate mid-tutorial must leave the player
   * exactly where they were — otherwise the first door authored onto the board
   * would be a hole in the shipped onboarding.
   */
  it('cannot carry the player out of the tutorial', () => {
    const ctx = createTestContext();
    expect(ctx.state.tutorialDone).toBe(false);
    // The shipped door's destination, driven through a fixture context — that
    // context's own emberkeep is the 8×8 unit map, which by design carries no
    // zones and so no portals.
    const door = EMBERKEEP.portals[0]!;
    ctx.bus.emit('world:switch', { to: door.to });
    expect(ctx.state.worldId).toBe(WORLD_ID);
  });

  /**
   * The Gate opens on the STORY, not the cap: Borealis stays shut at Level 3
   * until the Golden Elder has woken (`q:done:keepers_hoard` — the same latch
   * the altar derives her presence from). A level the player crosses mid-merge
   * is the wrong key for the chapter's one crossing.
   */
  it('holds Borealis shut until the Golden Elder has woken', () => {
    const ctx = createTestContext();
    ctx.state.tutorialDone = true;
    ctx.state.xp = LEVEL_XP[LEVEL_XP.length - 1]!;
    expect(ctx.systems.worlds.available().map((w) => w.id)).not.toContain('borealis');
    const failures: string[] = [];
    ctx.bus.on('world:switch_failed', ({ reason }) => failures.push(reason));
    ctx.bus.emit('world:switch', { to: 'borealis' });
    expect(ctx.state.worldId).toBe(WORLD_ID);
    expect(failures).toEqual(['story']);

    ctx.state.addStat('q:done:keepers_hoard', 1);
    expect(ctx.systems.worlds.available().map((w) => w.id)).toContain('borealis');
    ctx.bus.emit('world:switch', { to: 'borealis' });
    expect(ctx.state.worldId).toBe('borealis');
  });

  /** The Ember Gate: Roothold opens on Eleanor's FIRST delivered order — which
   *  the tutorial itself delivers, so a finished tutorial can always walk in. */
  it('holds Roothold shut until Order 1 is delivered', () => {
    const ctx = createTestContext();
    ctx.state.tutorialDone = true;
    expect(ctx.systems.worlds.available().map((w) => w.id)).not.toContain('roothold');
    ctx.bus.emit('world:switch', { to: 'roothold' });
    expect(ctx.state.worldId).toBe(WORLD_ID);

    ctx.state.completedOrderIds.push('eleanor_brazier');
    expect(ctx.systems.worlds.available().map((w) => w.id)).toContain('roothold');
    ctx.bus.emit('world:switch', { to: 'roothold' });
    expect(ctx.state.worldId).toBe('roothold');
  });

  /** The Rune Way: Hatchery opens on the per-world quest counter QuestSystem
   *  keeps, never on an id list that could drift. */
  it('holds the Hatchery shut until three Selyna quests are done', () => {
    const ctx = createTestContext();
    ctx.state.tutorialDone = true;
    ctx.state.xp = LEVEL_XP[LEVEL_XP.length - 1]!;
    ctx.state.addStat('q:world:borealis:done', 2);
    expect(ctx.systems.worlds.available().map((w) => w.id)).not.toContain('hatchery');
    ctx.bus.emit('world:switch', { to: 'hatchery' });
    expect(ctx.state.worldId).toBe(WORLD_ID);

    ctx.state.addStat('q:world:borealis:done', 1);
    expect(ctx.systems.worlds.available().map((w) => w.id)).toContain('hatchery');
    ctx.bus.emit('world:switch', { to: 'hatchery' });
    expect(ctx.state.worldId).toBe('hatchery');
  });
});

/* ------------------------------------------------------------------ */
/* per-world boards                                                     */
/* ------------------------------------------------------------------ */

describe('worlds — a board each, and travel between them', () => {
  const freeCell = (state: GameState, world: string): { col: number; row: number } => {
    const w = state.worlds.get(world)!;
    for (const z of w.zones) {
      for (const cell of z.cells) {
        const [i, j] = cell.split(',').map(Number);
        return { col: z.block.col + (i ?? 0), row: z.block.row + (j ?? 0) };
      }
    }
    throw new Error(`no cell in ${world}`);
  };

  it('leaves the board you left exactly as it was', () => {
    const state = new GameState(MAP, WORLD_ID);
    const home = state.addItem({ chain: 'lumber', tier: 1, col: 6, row: 4, kind: 'item' });
    expect(state.items.size).toBe(1);

    expect(state.switchWorld('borealis')).toBe(true);
    // A different world is a different board — not a cleared one.
    expect(state.items.size).toBe(0);
    const away = freeCell(state, 'borealis');
    const cold = state.addItem({ chain: 'lumber', tier: 1, ...away, kind: 'item' });
    expect(state.items.size).toBe(1);

    state.switchWorld(WORLD_ID);
    expect(state.items.size).toBe(1);
    expect(state.itemAt(6, 4)?.id).toBe(home.id);
    state.switchWorld('borealis');
    expect(state.itemAt(away.col, away.row)?.id).toBe(cold.id);
    // Item ids are global, so nothing can collide across worlds.
    expect(cold.id).not.toBe(home.id);
  });

  it('addresses the same numbers as different places on different worlds', () => {
    const state = new GameState(MAP, WORLD_ID);
    // (6,4) is real ground on the isle and its own pixel; on Borealis the same
    // pair is a hole between slabs.
    expect(state.inBounds(6, 4)).toBe(true);
    const emberPoint = worldPointOf(state.world, 6, 4);
    state.switchWorld('borealis');
    expect(state.inBounds(6, 4)).toBe(false);
    const away = freeCell(state, 'borealis');
    expect(worldPointOf(state.world, away.col, away.row)).not.toEqual(emberPoint);
  });

  it('saves and reloads every world it has been to', () => {
    const state = new GameState(MAP, WORLD_ID);
    state.addItem({ chain: 'lumber', tier: 1, col: 6, row: 4, kind: 'item' });
    state.switchWorld('borealis');
    const away = freeCell(state, 'borealis');
    state.addItem({ chain: 'lumber', tier: 2, ...away, kind: 'item' });
    state.nests[`${away.col},${away.row}`] = { points: 2, pointsToday: 1, day: 1 };
    const save = state.toSave(1000, SAVE_VERSION);
    expect(save.activeWorld).toBe('borealis');
    expect(Object.keys(save.boards ?? {})).toEqual(['borealis']);

    const back = new GameState(MAP, WORLD_ID);
    back.hydrate(save);
    // Resumes where the player stood, with that world's board intact…
    expect(back.worldId).toBe('borealis');
    expect(back.itemAt(away.col, away.row)?.tier).toBe(2);
    expect(back.nests[`${away.col},${away.row}`]?.points).toBe(2);
    // …and home is still exactly as it was left.
    back.switchWorld(WORLD_ID);
    expect(back.itemAt(6, 4)?.tier).toBe(1);
    expect(back.bag).toEqual([]);
    expect(back.relocated).toEqual([]);
  });

  it('loads a save written before worlds, unchanged, into the authored world', () => {
    const state = new GameState(MAP, WORLD_ID);
    state.addItem({ chain: 'lumber', tier: 1, col: 6, row: 4, kind: 'item' });
    const save = state.toSave(1000, SAVE_VERSION);
    // Exactly what a pre-travel save looks like: no active world, no boards.
    const legacy: SaveDataV1 = { ...save, activeWorld: undefined, boards: undefined };

    const back = new GameState(MAP, WORLD_ID);
    back.hydrate(legacy);
    expect(back.worldId).toBe(WORLD_ID);
    expect(back.itemAt(6, 4)?.tier).toBe(1);
    expect(back.relocated).toEqual([]);
    expect(back.bag).toEqual([]);
  });

  it('refuses a world this build does not have', () => {
    const state = new GameState(MAP, WORLD_ID);
    expect(state.switchWorld('atlantis')).toBe(false);
    expect(state.worldId).toBe(WORLD_ID);
  });
});

/* ------------------------------------------------------------------ */
/* no world may cost another anything                                   */
/* ------------------------------------------------------------------ */

describe('world art — visiting a world never leaves the others worse off', () => {
  /** A stand-in for Phaser's texture manager, holding every world's backdrop. */
  const bin = (held: string[]): TextureBin & { held: Set<string> } => {
    const set = new Set(held);
    return { held: set, exists: (k) => set.has(k), remove: (k) => void set.delete(k) };
  };
  const backdrops = ['background_emberkeep', 'background_borealis', 'background_roothold'];

  it('scopes a world’s art to that world and nothing shared', () => {
    const ctx = new GameContext(new MemoryStorage());
    expect(worldArtKeys(ctx, 'emberkeep')).toContain('background_emberkeep');
    // Borealis is Selyna's: its art is the backdrop AND her standee banks, which
    // is the whole point of the one list — she is fetched on arrival and freed
    // on departure with the ground she stands on, never separately.
    expect(worldArtKeys(ctx, 'borealis').sort()).toEqual([
      'background_borealis',
      'selyna_world_cast',
      'selyna_world_idle'
    ]);
    // Shared art (tiles, items, UI, VFX) must never appear — it is not any one
    // world's to release, and releasing it would break the world we are ON.
    for (const id of ctx.state.worlds.keys()) {
      for (const key of worldArtKeys(ctx, id)) {
        // Backdrop, standee banks, and (since the Hatchery cauldron) map decor.
        expect(key).toMatch(/^(background_|decor_|[a-z]+_world_)/);
      }
    }
  });

  it('frees the worlds it is not showing, and keeps the one it is', () => {
    const ctx = new GameContext(new MemoryStorage());
    const b = bin(backdrops);
    expect(releaseAwayWorldArt(b, ctx).sort()).toEqual([
      'background_borealis',
      'background_roothold'
    ]);
    expect([...b.held]).toEqual(['background_emberkeep']);
  });

  it('keeps the world you are standing on while freeing the rest', () => {
    const ctx = new GameContext(new MemoryStorage());
    ctx.state.switchWorld('borealis');
    const b = bin(backdrops);
    expect(releaseAwayWorldArt(b, ctx)).toEqual(['background_roothold']);
    // The authored world is deliberately exempt: its backdrop is in the boot
    // preload, so it is the baseline every session already pays, and evicting it
    // would only buy a re-fetch on the commonest journey there is — coming home.
    expect([...b.held].sort()).toEqual(['background_borealis', 'background_emberkeep']);
  });

  it('can always re-fetch whatever it released — one list, both directions', () => {
    const ctx = new GameContext(new MemoryStorage());
    const freed = releaseAwayWorldArt(bin(backdrops), ctx);
    // The anti-leak property: eviction and loading read the SAME list, so nothing
    // can be dropped that arriving would not bring back.
    const fetchable = new Set([...ctx.state.worlds.keys()].flatMap((id) => worldArtKeys(ctx, id)));
    for (const key of freed) expect(fetchable.has(key)).toBe(true);
  });

  it('is idempotent — a second sweep frees nothing', () => {
    const ctx = new GameContext(new MemoryStorage());
    const b = bin(backdrops);
    releaseAwayWorldArt(b, ctx);
    expect(releaseAwayWorldArt(b, ctx)).toEqual([]);
  });

  /**
   * The case that matters most, because it is the one every session runs: the
   * sweep is called at the end of EVERY board build, including the very first.
   * A boot has only ever loaded the authored world's art, so a session that
   * never travels must be untouched by any of this.
   */
  it('does nothing at all on a session that never leaves home', () => {
    const ctx = new GameContext(new MemoryStorage());
    const b = bin(['background_emberkeep']);
    expect(releaseAwayWorldArt(b, ctx)).toEqual([]);
    expect([...b.held]).toEqual(['background_emberkeep']);
  });
});

/* ------------------------------------------------------------------ */
/* arriving somewhere for the first time                                */
/* ------------------------------------------------------------------ */

describe('worlds — a first arrival puts the opening board out', () => {
  const atCap = (ctx: ReturnType<typeof createTestContext>): void => {
    ctx.state.tutorialDone = true;
    ctx.state.xp = LEVEL_XP[LEVEL_XP.length - 1]!;
    // The north opens on the STORY, not the cap: the Ember Gate holds Borealis
    // shut until the Golden Elder has woken. These tests are about arrival
    // mechanics, so they arrive the way a real save does — latch set.
    ctx.state.addStat('q:done:keepers_hoard', 1);
  };

  /**
   * `BoardSystem.newGame` seeds the authored world and nothing else, so without
   * the arrival seed the north opens as bare ground — and because a merge
   * cannot cross to the island that has a producer, bare ground there is
   * permanent. This is the test that says the north is a game and not a picture.
   */
  it('seeds the island you land on, and only that one', () => {
    const ctx = createTestContext();
    atCap(ctx);
    ctx.bus.emit('world:switch', { to: 'borealis' });

    const standing = [...ctx.state.items.values()].map((i) => i.chain).sort();
    expect(standing).toEqual([
      'driftwood',
      'driftwood',
      'driftwood',
      'driftwood',
      'driftwood',
      'wrackline'
    ]);
    // Every piece is on ground that is actually open…
    for (const item of ctx.state.items.values()) {
      expect(ctx.state.isTileActive(item.col, item.row)).toBe(true);
      expect(ctx.state.regionIdAt(item.col, item.row)).toBe('borealis_shore');
    }
    // …and the fogged islands keep their contents for the day they lift.
    expect(ctx.state.regionStatus.get('borealis_keep')).toBe('unlockable');
    expect(ctx.state.regionStatus.get('borealis_coast')).toBe('unlockable');
  });

  it('does not seed twice — coming back is a change of view', () => {
    const ctx = createTestContext();
    atCap(ctx);
    ctx.bus.emit('world:switch', { to: 'borealis' });
    const first = ctx.state.items.size;
    ctx.bus.emit('world:switch', { to: WORLD_ID });
    ctx.bus.emit('world:switch', { to: 'borealis' });
    expect(ctx.state.items.size).toBe(first);
  });

  /** The north's islands cost Gold Keys, and a level the player already has
   *  must not open them — that was the defect that spent the world on arrival. */
  it('never lifts a northern fog just for arriving at the Keeper cap', () => {
    const ctx = createTestContext();
    atCap(ctx);
    expect(ctx.state.level).toBe(LEVEL_XP.length);
    ctx.bus.emit('world:switch', { to: 'borealis' });
    const open = ctx.state.world.map.regions.filter(
      (r) => ctx.state.regionStatus.get(r.id) === 'active'
    );
    expect(open.map((r) => r.id)).toEqual(['borealis_shore']);
  });
});
