import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GOLDEN_AWAKENED_STAT, goldenAwakened, goldenPromiseKept } from '../../src/core/goldenPromise';
import { PRIMARY_WORLD, sameLattice } from '../../src/core/GameState';
import { getLattice, projectIn, setLattice, setProjection, type Lattice } from '../../src/core/iso';
import { auditSave } from '../../src/core/saveAudit';
import { createTestContext, MemoryStorage } from './helpers';
import map8x8 from '../fixtures/map-8x8.json';

/** The authored lattice, and one two-thirds its pitch — the exact relationship
 *  between nb2 and the hand-drawn worlds that lost half their cells to it. */
const AUTHORED = (): Lattice => {
  setProjection((map8x8 as { tile?: { width: number; height: number } }).tile);
  return getLattice();
};
const COARSER = (): Lattice => {
  const a = AUTHORED();
  return { ...a, halfW: a.halfW * 1.5, halfH: a.halfH * 1.5 };
};

/**
 * A saved (col,row) is meaningless without the lattice it was written in.
 *
 * Every world's playable cells are re-derived from hand-drawn grids that live
 * OUTSIDE the save, so redrawing a grid — or shipping an update that moves one —
 * silently changes what every stored coordinate names. The save now carries the unit
 * alongside the number, and the conversion is exact rather than a nearest-cell guess.
 */
describe('coordinates carry the lattice they were written in', () => {
  beforeEach(() => setProjection((map8x8 as { tile?: { width: number; height: number } }).tile));

  it('a world records its lattice, and the save round-trips it', () => {
    const ctx = createTestContext();
    ctx.state.setActiveWorld('roothold');
    const lattice = COARSER();
    ctx.state.setWorldLattice(lattice);

    const save = ctx.state.toSave(0, 8);
    expect(save.worlds?.roothold?.lattice).toBeDefined();

    ctx.state.hydrate(save);
    expect(sameLattice(ctx.state.worldLattice('roothold')!, lattice)).toBe(true);
  });

  it('re-projects pieces EXACTLY — the same world point, read in the new unit', () => {
    const ctx = createTestContext();
    ctx.state.setActiveWorld('roothold');
    const from = AUTHORED();
    const to = COARSER();

    const cells: [number, number][] = [[1, 1], [3, 2], [5, 4]];
    const planted = cells.map(([col, row]) =>
      ctx.state.addItem({ chain: 'strawberry', tier: 1, col, row, kind: 'item' })
    );
    // Where each piece STANDS, in world pixels — the thing that must not move.
    const before = planted.map((p) => projectIn(from, p.col, p.row));

    ctx.state.relattice(from, to);

    for (let i = 0; i < planted.length; i++) {
      const live = ctx.state.items.get(planted[i]!.id)!;
      const after = projectIn(to, live.col, live.row);
      // Within half a cell of the new lattice: a cell is a cell, not a point.
      expect(Math.abs(after.x - before[i]!.x)).toBeLessThan(to.halfW);
      expect(Math.abs(after.y - before[i]!.y)).toBeLessThan(to.halfH);
      // …and occupancy followed, which is what a hand-rolled move always forgets.
      expect(ctx.state.itemIdAt(live.col, live.row)).toBe(planted[i]!.id);
    }
  });

  it('never stacks two pieces on one cell, however coarse the new lattice', () => {
    const ctx = createTestContext();
    ctx.state.setActiveWorld('roothold');
    const from = AUTHORED();
    // Six times coarser: whole neighbourhoods fold onto one cell.
    const to: Lattice = { ...from, halfW: from.halfW * 6, halfH: from.halfH * 6 };

    const planted = ([[1, 1], [1, 2], [2, 1], [2, 2], [3, 3]] as const).map(([col, row]) =>
      ctx.state.addItem({ chain: 'lumber', tier: 1, col, row, kind: 'item' })
    );
    ctx.state.relattice(from, to);

    const seats = planted.map((p) => {
      const live = ctx.state.items.get(p.id)!;
      return `${live.col},${live.row}`;
    });
    expect(new Set(seats).size).toBe(planted.length); // five pieces, five cells
    for (const p of planted) {
      const live = ctx.state.items.get(p.id)!;
      expect(ctx.state.itemIdAt(live.col, live.row)).toBe(p.id);
    }
  });

  it('board:reconcile converts the units BEFORE it repairs anything', () => {
    const ctx = createTestContext();
    ctx.state.setActiveWorld('roothold');
    const from = AUTHORED();
    ctx.state.setWorldLattice(from);
    const piece = ctx.state.addItem({ chain: 'strawberry', tier: 1, col: 3, row: 2, kind: 'item' });
    const stood = projectIn(from, 3, 2);

    // The world is re-entered under its own, coarser lattice.
    const to = COARSER();
    setLattice(to);
    ctx.bus.emit('board:reconcile', {});

    const live = ctx.state.items.get(piece.id)!;
    const now = projectIn(to, live.col, live.row);
    expect(Math.abs(now.x - stood.x)).toBeLessThan(to.halfW);
    expect(Math.abs(now.y - stood.y)).toBeLessThan(to.halfH);
    // The world now records the unit it was just read in, so this happens once.
    expect(sameLattice(ctx.state.worldLattice('roothold')!, to)).toBe(true);

    // Idempotent: a board already in its own units does not budge.
    const settled = { ...live };
    ctx.bus.emit('board:reconcile', {});
    expect(ctx.state.items.get(piece.id)).toMatchObject({ col: settled.col, row: settled.row });
  });

  it('leaves the isle alone even when it reconciles — its fixtures stand off-zone', () => {
    const ctx = createTestContext();
    // The Theme Crystal: a landmark parked on a non-active cell on purpose.
    const off = { col: 7, row: 7 };
    ctx.state.expandBoardTo(off.col, off.row);
    const crystal = ctx.state.addItem({ chain: 'crystal', tier: 1, ...off, kind: 'item' });
    expect(ctx.state.isTileActive(off.col, off.row)).toBe(false);

    ctx.bus.emit('board:reconcile', {}); // the isle's lattice never changed
    expect(ctx.state.items.get(crystal.id)).toMatchObject(off);
    // …and it still recorded the unit, so a future authored-tile change is detectable.
    expect(ctx.state.worldLattice(PRIMARY_WORLD)).toBeDefined();
  });
});

/**
 * What the board grows on its own has to survive the tab closing. A generator's gift
 * announces itself as `item:produced` and as nothing else, so it used to sit in
 * memory until some unrelated action happened to write a save — and a player who
 * left at the wrong moment came back to a board missing pieces.
 */
describe('a generator’s gift is on disk the moment it appears', () => {
  it('survives a reload with no other action in between', async () => {
    const storage = new MemoryStorage();
    const ctx = createTestContext(storage);
    await ctx.beginRun();

    // A ripe Emberberry patch: a passive producer, one gift every 10 minutes.
    ctx.bus.emit('board:spawn', { chain: 'strawberry', tier: 3, count: 1, at: [1, 1] });
    const tick = (ms: number): void => {
      ctx.clock.advance(ms);
      ctx.bus.emit('time:advanced', { ms });
    };
    tick(1); // passive timers arm on first sight
    const before = ctx.state.items.size;
    tick(11 * 60 * 1000); // …and pay on the next tick past due
    const grown = ctx.state.items.size;
    expect(grown).toBeGreaterThan(before); // the patch did produce a berry

    // Close the tab HERE. Reopen: the save must already hold them.
    const reopened = createTestContext(storage);
    expect(reopened.systems.save.load()).toBe(true);
    expect(reopened.state.items.size).toBe(grown);
  });
});

/**
 * The awakening is a MOMENT. It has to survive as a fact, because the rules that
 * produced it differ between worlds — and on a custom map they gave the opposite
 * answer on reload, so the egg grew back on the Elder's empty ledge.
 */
describe('the Golden Elder’s awakening is recorded, not re-derived', () => {
  it('a custom world keeps her risen after a reload — the egg does not grow back', () => {
    const storage = new MemoryStorage();
    const ctx = createTestContext(storage);
    const baseHidden = true; // the authored map was deleted: Cindra's order is unreachable

    ctx.bus.emit('economy:add', { xp: 500, reason: 'test' });
    expect(ctx.state.level).toBeGreaterThanOrEqual(3);
    expect(goldenPromiseKept(ctx.state, baseHidden)).toBe(true);
    expect(ctx.state.stat(GOLDEN_AWAKENED_STAT)).toBe(0); // she has not risen yet

    ctx.bus.emit('golden:awakened', {});
    expect(ctx.state.stat(GOLDEN_AWAKENED_STAT)).toBe(1);

    // Reload. This is where the altar used to decide she had never woken.
    const reopened = createTestContext(storage);
    expect(reopened.systems.save.load()).toBe(true);
    expect(goldenAwakened(reopened.state, baseHidden)).toBe(true);
  });

  it('rising twice is still once', () => {
    const ctx = createTestContext();
    ctx.bus.emit('golden:awakened', {});
    ctx.bus.emit('golden:awakened', {});
    expect(ctx.state.stat(GOLDEN_AWAKENED_STAT)).toBe(1);
  });

  it('an OLD save that plainly saw her rise still reads as risen', () => {
    const ctx = createTestContext();
    // Authored game: order delivered, Level 3 — no recorded flag (pre-fix save).
    ctx.state.completedOrderIds.push('cindra_brazier');
    ctx.bus.emit('economy:add', { xp: 500, reason: 'test' });
    expect(ctx.state.stat(GOLDEN_AWAKENED_STAT)).toBe(0);
    expect(goldenAwakened(ctx.state, false)).toBe(true);
  });
});

/** The instrument itself: it has to find the faults it exists to find. */
describe('the save audit', () => {
  it('reports a clean board as clean', () => {
    const ctx = createTestContext();
    ctx.bus.emit('board:reconcile', {}); // stamp the isle's unit
    const report = auditSave(ctx.state, false);
    expect(report.activeWorld).toBe(PRIMARY_WORLD);
    expect(report.activeCells).toBeGreaterThan(0);
    expect(report.problems).toEqual([]);
  });

  it('catches the Golden dragon standing in two worlds at once', () => {
    const ctx = createTestContext();
    ctx.bus.emit('board:reconcile', {});
    ctx.state.addItem({ chain: 'golden_egg', tier: 2, col: 1, row: 1, kind: 'item' });
    ctx.state.setActiveWorld('borealis');
    ctx.state.setWorldLattice(getLattice());
    ctx.state.addItem({ chain: 'golden_egg', tier: 3, col: 1, row: 1, kind: 'item' });
    ctx.state.setActiveWorld(PRIMARY_WORLD);

    const report = auditSave(ctx.state, false);
    expect(report.golden.standsIn.sort()).toEqual([PRIMARY_WORLD, 'borealis'].sort());
    expect(report.problems.some((p) => p.includes('unique'))).toBe(true);
  });

  it('catches a board still written in a lattice the world no longer uses', () => {
    const ctx = createTestContext();
    ctx.state.setWorldLattice(COARSER()); // as if saved under another pitch
    setProjection((map8x8 as { tile?: { width: number; height: number } }).tile);

    const report = auditSave(ctx.state, false);
    expect(report.worlds.find((w) => w.live)?.latticeMatchesLive).toBe(false);
    expect(report.problems.some((p) => p.includes('lattice'))).toBe(true);
  });
});

/**
 * The boot order. Everything a save stores is a coordinate; everything that says
 * what those coordinates MEAN is restored asynchronously, from another file. The run
 * must not begin until that restore has finished.
 */
describe('the run waits for the world its coordinates stand on', () => {
  beforeEach(() => setProjection((map8x8 as { tile?: { width: number; height: number } }).tile));

  it('prepares the world BEFORE announcing the loaded save', async () => {
    const storage = new MemoryStorage();
    const first = createTestContext(storage);
    first.state.setActiveWorld('roothold');
    first.state.addItem({ chain: 'strawberry', tier: 1, col: 2, row: 2, kind: 'item' });
    first.systems.save.save();

    const ctx = createTestContext(storage);
    const order: string[] = [];
    ctx.worldPreparer = async (activeWorld) => {
      // The preparer already knows which world the save was standing in — that is
      // the whole point: it restores THAT world's cells and lattice, not the isle's.
      order.push(`prepare:${activeWorld}`);
      await Promise.resolve();
      order.push('prepare:done');
    };
    ctx.bus.on('state:loaded', () => order.push('state:loaded'));
    ctx.bus.on('game:started', () => order.push('game:started'));

    await ctx.beginRun();

    expect(order).toEqual(['prepare:roothold', 'prepare:done', 'state:loaded', 'game:started']);
  });

  it('the offline harvest banks nothing until the ground is real', async () => {
    const storage = new MemoryStorage();
    const seed = createTestContext(storage);
    seed.systems.board.newGame();
    seed.systems.save.save();

    const ctx = createTestContext(storage);
    // A generator's gifts are dropped onto ACTIVE cells. Assert the catch-up cannot
    // run while the preparer still has the floor: `state:loaded` is what wakes it.
    let loadedDuringPrepare = false;
    ctx.bus.on('state:loaded', () => {
      if (!prepared) loadedDuringPrepare = true;
    });
    let prepared = false;
    ctx.worldPreparer = async () => {
      await Promise.resolve();
      prepared = true;
    };
    await ctx.beginRun();
    expect(loadedDuringPrepare).toBe(false);
    expect(prepared).toBe(true);
  });

  it('a brand-new game also waits, then starts', async () => {
    const ctx = createTestContext();
    const seen: string[] = [];
    ctx.worldPreparer = async () => {
      seen.push('prepare');
      await Promise.resolve();
    };
    ctx.bus.on('game:started', () => seen.push('started'));
    await ctx.beginRun();
    expect(seen).toEqual(['prepare', 'started']);
    expect(ctx.state.items.size).toBeGreaterThan(0); // newGame ran
  });

  it('runs without a preparer at all (the shipped game has no editor project)', async () => {
    const ctx = createTestContext();
    const started = vi.fn();
    ctx.bus.on('game:started', started);
    await ctx.beginRun();
    expect(started).toHaveBeenCalledOnce();
  });
});
