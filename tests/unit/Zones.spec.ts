import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import realMap from '../../src/data/map.json';
import {
  CAULDRON_DECOR,
  CAULDRON_REACHED_STAT,
  chainHiddenIn,
  DECOR_SCALE,
  decorClipCharacter,
  LEVEL_XP,
  SAVE_VERSION,
  WORLD_ID
} from '../../src/core/Constants';
import { cloudLevelMet } from '../../src/core/worldGates';
import { clipFor } from '../../src/core/characterAnims';
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
   * THE EDITOR'S SCHEDULE IS THE GAME'S SCHEDULE (2026-08-23).
   *
   * This test has changed shape twice, and both times because the question
   * underneath it changed.
   *
   * First it asserted that every added region unlocked ABOVE `LEVEL_XP.length`,
   * so no tile could pop onto the shipped board mid-campaign. The cost was
   * total: the ladder ended at 3 and `UnlockSystem` only lifts a level region
   * when the Keeper reaches its level, so 36 cells drawn in the map editor were
   * ground nobody could ever stand on. Then `BEYOND_BASE_LEVEL` rebased them
   * onto 2 and 3 — reachable, but still not what the editor said.
   *
   * Now the owner levels every cell BY HAND to stage the weather, so an offset
   * on top of his numbers is a bug wearing a policy's clothes: the cloud he
   * cleared at level 2 would lift at 4. `levelOf` is `plainLevel` for emberkeep
   * and the editor's number is played verbatim — including level 1, which means
   * "already open" and is the one honest reading of a cell drawn at the level
   * the game starts on.
   *
   * What must still hold, and is what this pins:
   *   - level 1 ⇒ `active`. Open is open; a cloud that lifts on a level already
   *     held would flash on the first frame and never be a gate.
   *   - level ≥ 2 ⇒ `unlockable`, NEVER `locked`. This is the trap the whole
   *     change was: `UnlockSystem.unlockForLevel` only lifts a region already
   *     at `unlockable`, so a `locked` one ignores every level-up for ever, no
   *     matter what its `unlock.level` says. `LEVEL_CAP` is read from
   *     `LEVEL_XP` now precisely so a band the player can reach is never minted
   *     locked — which is what levels 4-6 shipped as while the cap said 3.
   *   - nothing above the cap, or it is unreachable ground again.
   *   - and no two bands share a name: `regionStatus` is one flat Map, so a
   *     duplicate id is one region wearing two banks and opening both at once.
   */
  it('plays the level the editor drew, and never mints a band no level-up can lift', () => {
    const added = EMBERKEEP.map.regions.filter((r) => !MAP.regions.some((a) => a.id === r.id));
    expect(added.length).toBeGreaterThan(0);
    for (const region of added) {
      const level = region.unlock?.level ?? 1;
      expect(level).toBeLessThanOrEqual(LEVEL_XP.length);
      expect(region.status).toBe(level <= 1 ? 'active' : 'unlockable');
    }
    const ids = added.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
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
    // 103/29/9 — and these are the SAME three components `build-zones`
    // measures for itself when it decides which island a band belongs to
    // (`islandsOf`). Two independent implementations, one answer: the script
    // works in editor/art pixels before zones exist, the engine works in world
    // pixels through `neighborsOf`, and they agree cell for cell. If this line
    // and the script's report ever disagree, one of them has stopped
    // describing the painting.
    expect(islands.sort((a, b) => b - a)).toEqual([103, 29, 9]);
  });

  /**
   * NO BAND MAY STRADDLE TWO ISLANDS — fog gates by region, so one that spans a
   * gap lifts cloud in two places at once, the far one with no path to it and
   * no warning.
   *
   * This used to be an exception list. Regions were grouped BY LEVEL alone, so
   * the five mainland cells the editor marked level 1 joined `borealis_shore`
   * and the landing platform's cloud also cleared five tiles adrift in the
   * middle of the coast. It was pinned rather than repaired, on the grounds
   * that which cell opens when is level design.
   *
   * That was the right call and the wrong diagnosis: the bug was never the
   * level marking, it was that ONE NUMBER was naming the island AND setting the
   * schedule. `build-zones` measures the island now (`islandsOf`) and bands are
   * cut per island × level, so the editor may mark any cell any level and a
   * region still cannot span open water. The exception is gone, and the rule is
   * the whole rule.
   */
  it('never lets one region straddle two islands', () => {
    const world = WORLDS.get('borealis')!;
    const regionOf = new Map<string, string>();
    for (const r of world.map.regions) for (const [c, x] of r.tiles) regionOf.set(`${c},${x}`, r.id);

    const straddle = new Map<string, Set<number>>();
    const seen = new Set<string>();
    let island = 0;
    for (const start of regionOf.keys()) {
      if (seen.has(start)) continue;
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const cur = stack.pop()!;
        const [c = 0, r = 0] = cur.split(',').map(Number);
        const ids = straddle.get(regionOf.get(cur)!) ?? new Set<number>();
        ids.add(island);
        straddle.set(regionOf.get(cur)!, ids);
        for (const n of neighborsOf(world, c, r)) {
          const k = `${n.col},${n.row}`;
          if (!seen.has(k)) {
            seen.add(k);
            stack.push(k);
          }
        }
      }
      island++;
    }
    const spread = [...straddle].filter(([, on]) => on.size > 1).map(([id]) => id);
    expect(spread).toEqual([]);
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
    // emberkeep's new ground + borealis + roothold + runevault, all four now
    // drawn in the editor (Runevault replaced the measured Hatchery deck).
    // Runevault's fifth is the wooden landing at the foot of the stair: the Rune
    // Stair door stands on it, and a door needs ground under it to be reachable.
    // Emberkeep 38 → 40 on 2026-08-20: Grille 27 (the 2×1 south-east of the lava
    // well) got its second cell and Grille 28 — a 1×1 beside it, empty until
    // then — its first. Both sit on painted flagstone (audit:ground is clean on
    // them); the drawing shifted the derived editor→art fit by 1–3 px everywhere.
    // 40 → 36 on 2026-08-21, four cells taken back out of the emberkeep draw.
    // 36 → 37 and borealis 140 → 141 on 2026-08-23, the re-level pass that gave
    // every cell its own fog band (one cell drawn on each, and no cell lost).
    expect(checked).toBe(37 + 141 + 144 + 5);
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
      'borealis->runevault',
      'emberkeep->borealis',
      'emberkeep->roothold',
      'roothold->emberkeep',
      'runevault->borealis'
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
   * The Gate opens on the KEEPER'S RANK (owner's call, 2026-08-26: "unlock
   * the portal to borealis at level"): the world's own `level` in zones.json
   * is the whole gate. It replaced the `q:done:keepers_hoard` story latch —
   * the Elder's awakening stays a quest beat, but the door no longer waits
   * on it.
   */
  it('holds Borealis shut below its level, and opens it on rank alone', () => {
    const ctx = createTestContext();
    ctx.state.tutorialDone = true;
    expect(ctx.state.level).toBeLessThan(3);
    expect(ctx.systems.worlds.available().map((w) => w.id)).not.toContain('borealis');
    const failures: string[] = [];
    ctx.bus.on('world:switch_failed', ({ reason }) => failures.push(reason));
    ctx.bus.emit('world:switch', { to: 'borealis' });
    expect(ctx.state.worldId).toBe(WORLD_ID);
    expect(failures).toEqual(['level']);

    // No quest, no latch — the rank alone turns the key.
    ctx.state.xp = LEVEL_XP[2]!;
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

  /** The Rune Way opens at the CAP (owner's call, 2026-08-26): Level 6 is the
   *  rank that clears the last clouds off Borealis's main island, and the hub
   *  is what stands beyond them. No quest counter, no latch — rank alone. */
  it('holds Runevault shut below Level 6, and opens it at the cap', () => {
    const ctx = createTestContext();
    ctx.state.tutorialDone = true;
    ctx.state.xp = LEVEL_XP[LEVEL_XP.length - 2]!; // Level 5
    ctx.state.addStat('q:world:borealis:done', 19); // quests no longer turn this key
    expect(ctx.systems.worlds.available().map((w) => w.id)).not.toContain('runevault');
    ctx.bus.emit('world:switch', { to: 'runevault' });
    expect(ctx.state.worldId).toBe(WORLD_ID);

    ctx.state.xp = LEVEL_XP[LEVEL_XP.length - 1]!; // Level 6, the cap
    expect(ctx.systems.worlds.available().map((w) => w.id)).toContain('runevault');
    ctx.bus.emit('world:switch', { to: 'runevault' });
    expect(ctx.state.worldId).toBe('runevault');
  });

  /** THE DOUBLE KEY (owner's law, 2026-08-26): the ladder reaching its first
   *  cauldron quest opens the Rune Way just as the cap would — a quester is
   *  never handed a brew with the pot's door shut. */
  it('the cauldron latch is the Rune Way’s second key, below the cap', () => {
    const ctx = createTestContext();
    ctx.state.tutorialDone = true;
    ctx.state.xp = LEVEL_XP[2]!; // Level 3 — Borealis open, Runevault shut
    expect(ctx.systems.worlds.available().map((w) => w.id)).not.toContain('runevault');

    ctx.state.addStat(CAULDRON_REACHED_STAT, 1);
    expect(ctx.systems.worlds.available().map((w) => w.id)).toContain('runevault');
    ctx.bus.emit('world:switch', { to: 'runevault' });
    expect(ctx.state.worldId).toBe('runevault');
  });

  /** …and it blows the level clouds off Borealis's main island, on BOTH
   *  paths: settling on arrival, and live the moment the latch flips. The
   *  latch is scoped — `cloudLevelMet` answers false for the southern isle,
   *  so Emberkeep's own level land never rides along. */
  /** The level slabs BY THE DATA, not by name: a world re-export regroups the
   *  clouds (it already dissolved `borealis_coast_l4` once), and a test that
   *  hardcodes slab ids goes stale with it. */
  const borealisSlabs = (ctx: ReturnType<typeof createTestContext>): string[] =>
    ctx.state.worlds
      .get('borealis')!
      .map.regions.filter((r) => r.unlock?.level !== undefined)
      .map((r) => r.id);

  it('the cauldron latch lifts the main island’s level slabs at level 3', () => {
    const ctx = createTestContext();
    ctx.state.tutorialDone = true;
    ctx.state.xp = LEVEL_XP[2]!; // Level 3 — below every slab's own rank
    const slabs = borealisSlabs(ctx);
    expect(slabs.length).toBeGreaterThan(0);

    // Arrive WITHOUT the latch: the slabs stand fogged, offered.
    ctx.state.regionStatus.set('borealis_coast', 'active'); // their `after` door
    ctx.bus.emit('world:switch', { to: 'borealis' });
    for (const id of slabs) expect(ctx.state.regionStatus.get(id)).toBe('unlockable');

    // The latch flips mid-session → the fact sweeps them open where she stands.
    ctx.state.addStat(CAULDRON_REACHED_STAT, 1);
    ctx.bus.emit('quest:cauldron_reached', {});
    for (const id of slabs) expect(ctx.state.regionStatus.get(id)).toBe('active');
  });

  it('arriving with the latch already earned settles the slabs open', () => {
    const ctx = createTestContext();
    ctx.state.tutorialDone = true;
    ctx.state.xp = LEVEL_XP[2]!;
    ctx.state.regionStatus.set('borealis_coast', 'active');
    ctx.state.addStat(CAULDRON_REACHED_STAT, 1);
    ctx.bus.emit('world:switch', { to: 'borealis' });
    for (const id of borealisSlabs(ctx)) {
      expect(ctx.state.regionStatus.get(id)).toBe('active');
    }
  });

  it('the latch is scoped: it is not rank anywhere south of the clouds', () => {
    const ctx = createTestContext();
    ctx.state.addStat(CAULDRON_REACHED_STAT, 1);
    expect(cloudLevelMet(ctx.state, 'emberkeep', 3)).toBe(false);
    expect(cloudLevelMet(ctx.state, 'roothold', 3)).toBe(false);
    expect(cloudLevelMet(ctx.state, 'borealis', 6)).toBe(true);
    expect(cloudLevelMet(ctx.state, 'runevault', 6)).toBe(true);
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
    // Borealis is Selyna's: its art is the backdrop AND everything she is drawn
    // with ON THE BOARD — her standee banks and her board-stage clips. That is
    // the whole point of the one list: she is fetched on arrival and freed on
    // departure with the ground she stands on, never separately. The clips are
    // the expensive half (a frame sheet is held DECODED), so leaving them off
    // the list meant travel only ever added.
    //
    // Her PORTRAIT clips (talking, blinking) are absent on purpose. They belong
    // to the dialogue bubble in UIScene, which never restarts and so still holds
    // the last portrait it showed after the board is gone. Evicting a texture
    // under a live sprite null-crashes the renderer and hangs the whole game —
    // Borealis → Runevault froze on the travel veil for exactly that reason.
    expect(worldArtKeys(ctx, 'borealis').sort()).toEqual([
      'background_borealis',
      'canim_selyna_cast',
      'canim_selyna_idle',
      'selyna_world_cast',
      'selyna_world_idle'
    ]);
    // Said as its own rule, so a future clip cannot rejoin the list quietly.
    for (const id of ctx.state.worlds.keys()) {
      expect(worldArtKeys(ctx, id)).not.toContain('canim_selyna_talking');
      expect(worldArtKeys(ctx, id)).not.toContain('canim_eleanor_talking');
      expect(worldArtKeys(ctx, id)).not.toContain('canim_eleanor_blinking');
    }
    // Shared art (tiles, items, UI, VFX) must never appear — it is not any one
    // world's to release, and releasing it would break the world we are ON.
    for (const id of ctx.state.worlds.keys()) {
      for (const key of worldArtKeys(ctx, id)) {
        // Backdrop, standee banks, character clips, and (since the Hatchery
        // cauldron) map decor.
        expect(key).toMatch(/^(background_|decor_|canim_|[a-z]+_world_)/);
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

  it('never takes a texture out from under a live sprite, whatever the rule says', () => {
    // The rule above is about which WORLD owns a texture, and it is only as
    // good as the list it reads: anything holding world art OUTSIDE that list —
    // a scene that never restarts, an overlay left standing, a tween in flight —
    // is invisible to it. Being wrong is not a leak and not a blank sprite; it
    // is a null in the renderer, which ends Phaser's RAF chain and freezes the
    // session with the veil still up. So the texture manager gets the last word.
    const ctx = new GameContext(new MemoryStorage());
    const b = bin(backdrops);
    const drawn = 'background_borealis';
    const freed = releaseAwayWorldArt({ ...b, inUse: (key: string) => key === drawn }, ctx);
    expect(freed).not.toContain(drawn);
    expect(b.held.has(drawn)).toBe(true);
    // …and it withholds ONLY that one — a veto, not an amnesty.
    expect(freed).toContain('background_roothold');
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
    // The shore's own farm: the Glass Kiln and the five Floats it makes. The
    // boat-and-timber roster it replaced was deleted wholesale — a heap of wood,
    // a heap of weed and a heap of crystals were the same kind of thing.
    expect(standing).toEqual([
      'glasskiln',
      'seaglass',
      'seaglass',
      'seaglass',
      'seaglass',
      'seaglass'
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

/* ------------------------------------------------------------------ */
/* the pot on the rune circle                                           */
/* ------------------------------------------------------------------ */

/**
 * THE CAULDRON IS THE ONLY THING IN RUNEVAULT YOU CAN TAP, and it went missing
 * without a word.
 *
 * The editor keeps a two-way sync between a placement and its file in
 * `asset3d/`: delete the file and the next restore prunes every placement that
 * names it, then persists the prune (mapEditor.restoreToGame). So one removed
 * `.webp` silently emptied `gameObjects`, the world's `assets` row and
 * `project.assets` — and build-zones, which WARNS rather than throws so a
 * missing prop can never cost a whole world, wrote a Runevault with no pot in
 * it. A warning in a build log is not a thing anyone reads; the plateau just
 * had nothing on it.
 *
 * And it went missing a SECOND way, which is the one that lasted. Re-solving the
 * editor drop point by inverting the fitted affine moved it from (1078.7, 763.5)
 * — the spot on the plateau he dropped it on — to (-1404.3, 66.6), which lands
 * at world x -1388, some 2200 px left of the four cells the board camera frames.
 * Nothing warned: the pot existed, stood on a cell, kept its anchor, boiled. It
 * was simply somewhere nobody can look. `dx/dy` is a NUDGE off the nearest cell,
 * and a nudge of nine tiles is not a nudge, it is a different place — so that is
 * what the reader below measures.
 *
 * `zones.json` is generated, so none of this pins the numbers the editor chose.
 * It pins that a pot exists, that it stands on ground, that it stands NEAR that
 * ground, and that it is a size a player can see.
 */
describe('runevault — the cauldron is still on the rune circle', () => {
  const RUNEVAULT = WORLDS.get('runevault')!;
  const TILE = RUNEVAULT.map.tile?.width ?? 256;
  /** World px per authored map px — BoardScene's own `ratio` for this world. */
  const RATIO = 256 / TILE;
  const pot = () => (RUNEVAULT.map.mapDecor ?? []).find((d) => d.name === CAULDRON_DECOR)!;

  /** Pixel width of the shipped plate, from the WebP header — same trick as
   *  scripts/build-zones.mjs, and for the same reason: the size the player sees
   *  is the calibration times THIS, so a number typed here would only pin half
   *  of it and would keep passing through the swap it exists to catch. */
  const plateWidth = (): number => {
    const b = readFileSync(`assets/sprites/environment/map/decor/${CAULDRON_DECOR}.webp`);
    const fourcc = b.toString('ascii', 12, 16);
    if (fourcc === 'VP8X') return 1 + b.readUIntLE(24, 3);
    if (fourcc === 'VP8 ') return b.readUInt16LE(26) & 0x3fff;
    if (fourcc === 'VP8L') return (b.readUInt32LE(21) & 0x3fff) + 1;
    throw new Error('not a WebP the header reader understands');
  };

  it('places exactly one cauldron, and CAULDRON_DECOR is what names it', () => {
    const decor = RUNEVAULT.map.mapDecor ?? [];
    expect(decor.filter((d) => d.name === CAULDRON_DECOR)).toHaveLength(1);
  });

  it('stands it on a cell of the world, so its shadow has ground under it', () => {
    expect(hasCell(RUNEVAULT, pot().col, pot().row)).toBe(true);
  });

  it('stands it NEAR that cell — the guard the off-screen pot walked past', () => {
    // build-zones picks the NEAREST cell, so a prop the editor put on the ground
    // the world was fitted to is always within about a tile of it. The pot that
    // vanished was 2311 px out; this one is under 200.
    const d = pot();
    const off = Math.hypot((d.dx ?? 0) * RATIO, (d.dy ?? 0) * RATIO);
    expect(off).toBeLessThan(TILE);
  });

  it('carries the anchor measured off the art — without it the pot floats', () => {
    // Contact point, not centre: the swing handle hangs wide to the LEFT, which
    // is why the foot ring is at 0.543 rather than 0.5 (scripts/build-zones.mjs).
    expect(RUNEVAULT.map.decorCalibration?.[CAULDRON_DECOR]).toMatchObject({
      anchor: { x: 0.543, y: 0.889 }
    });
  });

  it('draws it at the size it was tuned to, measured against the real plate', () => {
    // BoardScene: dispScale = cal.scale × ratio × DECOR_SCALE, against the art's
    // OWN width — so the plate is read off disk rather than typed here. The two
    // halves of that product live in different files and have twice been changed
    // one at a time: re-solving the placement left the calibration at 2.99 (530
    // units, two tiles across), and redrawing the plate 1050 → 822 px would have
    // shrunk the pot by a fifth on its own. ~368 units is the authored answer.
    const cal = RUNEVAULT.map.decorCalibration![CAULDRON_DECOR]!;
    const units = cal.scale * RATIO * (DECOR_SCALE[CAULDRON_DECOR] ?? 1) * plateWidth();
    expect(units).toBeGreaterThan(310);
    expect(units).toBeLessThan(430);
  });

  it('has a boil to play, filed under the CHARACTER id and not the art name', () => {
    // The two namespaces are different and were once assumed to be the same, so
    // the lookup came back empty and the pot never boiled. Both halves pinned.
    expect(decorClipCharacter(CAULDRON_DECOR)).toBe('cauldron');
    expect(clipFor(decorClipCharacter(CAULDRON_DECOR), 'boil')).toBeTruthy();
  });
});

describe('the keepsake under the cloud', () => {
  /** The one authored gift: a Frost Dragon Egg on the north-west island,
   *  handed over when its level-4 band lifts. */
  const bandOf = (): { id: string; contents: Array<{ chain: string; keepsake?: boolean }> } => {
    const world = ZONES.worlds.find((w) => w.id === 'emberkeep')!;
    const band = world.map.regions!.find((r) => (r.contents ?? []).some((c) => c.chain === 'frost'));
    expect(band, 'emberkeep no longer seeds a frost keepsake').toBeDefined();
    return band as never;
  };

  it('rides a level-4 band, on a cell that band actually owns', () => {
    const world = ZONES.worlds.find((w) => w.id === 'emberkeep')!;
    const band = world.map.regions!.find((r) => (r.contents ?? []).some((c) => c.chain === 'frost'))!;
    expect(band.unlock?.level, `${band.id} is not level-gated at 4`).toBe(4);
    // Derived placement, so the only thing worth pinning is that it is INSIDE.
    // A hand-written cell would be a hole in the sky after the next export.
    for (const c of band.contents!) {
      expect(
        band.tiles.some(([col, row]) => col === c.at[0] && row === c.at[1]),
        `${c.chain} at ${c.at.join(',')} is not on ${band.id}`
      ).toBe(true);
    }
  });

  it('is exactly ONE egg, and marked as a keepsake', () => {
    // "un seul" is the design: one egg is short of the three a Frost Dragon
    // takes, which is what keeps the find a question about the north rather
    // than a supply line opening at home.
    const eggs = bandOf().contents.filter((c) => c.chain === 'frost');
    expect(eggs).toHaveLength(1);
    expect(eggs[0]!.keepsake, 'without this the reveal drops it silently').toBe(true);
  });

  it('is actually ON THE BOARD once the Keeper reaches rank 4', () => {
    // The end-to-end claim, and the only one that would have caught the silent
    // drop: rank up on the real map and look for the egg among the pieces.
    const ctx = new GameContext(new MemoryStorage(), { map: realMap as never });
    ctx.state.tutorialDone = true;
    expect([...ctx.state.items.values()].some((i) => i.chain === 'frost')).toBe(false);
    ctx.bus.emit('economy:add', { xp: LEVEL_XP[3]!, reason: 'test' });
    expect(ctx.state.level).toBe(4);
    const eggs = [...ctx.state.items.values()].filter((i) => i.chain === 'frost');
    expect(eggs, 'the cloud lifted and handed over nothing').toHaveLength(1);
    expect(eggs[0]!.tier).toBe(1);
  });

  it('survives the reveal — and an unmarked northern piece still does not', () => {
    // The whole point of the flag. `frost` names Borealis in chains.json, so
    // the reveal withholds it in Emberkeep; the keepsake is the author saying
    // this one placement is not that accident.
    const foreign = { id: 'frost', world: 'borealis' };
    expect(chainHiddenIn(foreign, 'emberkeep')).toBe(true); // the rule, unchanged
    expect(chainHiddenIn(foreign, 'emberkeep', true)).toBe(false); // the exception
    // …and the exception lifts the WORLD half only: a later chapter's chain is
    // not made shippable by being a gift.
    expect(chainHiddenIn({ id: 'nest' }, 'emberkeep', true)).toBe(true);
  });
});
