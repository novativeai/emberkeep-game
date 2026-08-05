import { describe, expect, it } from 'vitest';
import { PRIMARY_WORLD } from '../../src/core/GameState';
import { createTestContext } from './helpers';

/**
 * Each world owns its board outright.
 *
 * Before this, every world shared ONE item map and a visibility filter decided what
 * you saw. The consequences were exactly what the game showed: nb2's dragon could be
 * dragged while standing in roothold, an Emberberry appeared to "teleport" between
 * worlds when only its visibility had changed, and a cell taken in one world was
 * taken in all of them. A world you cannot reach into is the point of a world.
 */
describe('per-world boards', () => {
  it('a piece placed in one world does not exist in another', () => {
    const ctx = createTestContext();
    const home = ctx.state.addItem({ chain: 'ember_dragon', tier: 3, col: 2, row: 2, kind: 'item' });
    expect(ctx.state.items.has(home.id)).toBe(true);

    ctx.state.setActiveWorld('roothold');
    expect(ctx.state.items.size).toBe(0); // you cannot reach nb2's dragon from the lair
    expect(ctx.state.itemAt(2, 2)).toBeUndefined();

    ctx.state.setActiveWorld(PRIMARY_WORLD);
    expect(ctx.state.itemAt(2, 2)?.id).toBe(home.id); // and it never moved
  });

  it('occupancy is per world — the same cell is free in the other one', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'lumber', tier: 2, col: 3, row: 3, kind: 'item' });

    ctx.state.setActiveWorld('borealis');
    expect(ctx.state.itemIdAt(3, 3)).toBeNull();
    // Same cell, other world: allowed, and it does not disturb the first.
    const there = ctx.state.addItem({ chain: 'golden_egg', tier: 2, col: 3, row: 3, kind: 'item' });
    expect(ctx.state.itemAt(3, 3)?.id).toBe(there.id);

    ctx.state.setActiveWorld(PRIMARY_WORLD);
    expect(ctx.state.itemAt(3, 3)?.chain).toBe('lumber');
  });

  it('every world survives a save round trip, and you come back where you left off', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'lumber', tier: 2, col: 1, row: 1, kind: 'item' });
    ctx.state.setActiveWorld('borealis');
    ctx.state.addItem({ chain: 'golden_egg', tier: 2, col: 4, row: 4, kind: 'item' });

    const save = ctx.state.toSave(1000, 8);
    expect(save.activeWorld).toBe('borealis');
    expect(Object.keys(save.worlds ?? {}).sort()).toEqual([PRIMARY_WORLD, 'borealis'].sort());
    // The top level still mirrors the PRIMARY world, so an older build reads it.
    expect(save.items.map((i) => i.chain)).toEqual(['lumber']);

    ctx.state.hydrate(save);
    expect(ctx.state.activeWorld).toBe('borealis');
    expect(ctx.state.itemAt(4, 4)?.chain).toBe('golden_egg');
    ctx.state.setActiveWorld(PRIMARY_WORLD);
    expect(ctx.state.itemAt(1, 1)?.chain).toBe('lumber');
  });

  it('an OLD save is split onto the right boards by its ownership map', () => {
    const ctx = createTestContext();
    const house = ctx.state.addItem({ chain: 'lumber', tier: 2, col: 1, row: 1, kind: 'item' });
    const golden = ctx.state.addItem({ chain: 'golden_egg', tier: 2, col: 5, row: 5, kind: 'item' });
    const save = ctx.state.toSave(1000, 8);

    // Shape it like a pre-boards save: one board, plus the old "what to show where".
    const legacy = { ...save, worlds: undefined, activeWorld: undefined, itemWorlds: { [String(golden.id)]: 'borealis' } };
    ctx.state.hydrate(legacy as typeof save);

    // The Golden dragon is no longer a label on nb2's board — it is ON borealis'.
    expect(ctx.state.activeWorld).toBe(PRIMARY_WORLD);
    expect(ctx.state.items.has(golden.id)).toBe(false);
    expect(ctx.state.items.has(house.id)).toBe(true);

    ctx.state.setActiveWorld('borealis');
    expect(ctx.state.itemAt(5, 5)?.id).toBe(golden.id);
  });

  it('a new game leaves no world standing behind you', () => {
    const ctx = createTestContext();
    ctx.state.setActiveWorld('roothold');
    ctx.state.addItem({ chain: 'strawberry', tier: 1, col: 2, row: 2, kind: 'item' });

    ctx.state.reset(0);

    expect(ctx.state.activeWorld).toBe(PRIMARY_WORLD);
    expect(ctx.state.worldIds()).toEqual([PRIMARY_WORLD]);
    ctx.state.setActiveWorld('roothold');
    expect(ctx.state.items.size).toBe(0);
  });

  it('a world that draws its own ground shows nothing of the isle underneath', () => {
    const ctx = createTestContext();
    const isle = [...Array(ctx.state.rows).keys()]
      .flatMap((r) => [...Array(ctx.state.cols).keys()].map((c) => ({ c, r })))
      .filter(({ c, r }) => ctx.state.isTileActive(c, r));
    expect(isle.length).toBeGreaterThan(0); // the authored regions ARE the primary world's floor

    // A sub-world authors every cell it has: the isle's regions must not show through
    // at the same coordinates (both worlds share one coordinate space).
    ctx.state.setActiveWorld('roothold');
    ctx.state.setCellsFullyAuthored(true);
    for (const { c, r } of isle) expect(ctx.state.isTileActive(c, r)).toBe(false);

    const own = isle[0]!;
    ctx.state.setEditorTileOverride(own.c, own.r, 1); // …only what the lair itself drew
    expect(ctx.state.isTileActive(own.c, own.r)).toBe(true);

    ctx.state.setCellsFullyAuthored(false); // back on the isle: its regions are the floor again
    ctx.state.clearEditorTileOverrides();
    for (const { c, r } of isle) expect(ctx.state.isTileActive(c, r)).toBe(true);
  });

  it('walks stranded pieces back onto ground the world still offers', () => {
    const ctx = createTestContext();
    ctx.state.setActiveWorld('roothold');
    // The lair as it was drawn ONCE: three cells, three pieces standing on them.
    for (const [c, r] of [[2, 2], [3, 2], [4, 2]] as const) ctx.state.setEditorTileOverride(c, r, 1);
    ctx.state.setCellsFullyAuthored(true);
    const planted = ([[2, 2], [3, 2], [4, 2]] as const).map(([col, row]) =>
      ctx.state.addItem({ chain: 'strawberry', tier: 1, col, row, kind: 'item' })
    );

    // Redraw it somewhere else — the same coordinates now name different ground.
    ctx.state.clearEditorTileOverrides();
    for (const [c, r] of [[7, 7], [8, 7], [9, 7], [7, 8]] as const) {
      ctx.state.expandBoardTo(c, r);
      ctx.state.setEditorTileOverride(c, r, 1);
    }
    for (const p of planted) expect(ctx.state.isTileActive(p.col, p.row)).toBe(false); // stranded

    ctx.bus.emit('board:reconcile', {});

    for (const p of planted) {
      const live = ctx.state.items.get(p.id)!;
      expect(ctx.state.isTileActive(live.col, live.row)).toBe(true);
      expect(ctx.state.itemIdAt(live.col, live.row)).toBe(p.id); // occupancy followed it
    }
    // …and nothing was stacked: three pieces, three distinct cells.
    expect(new Set(planted.map((p) => `${ctx.state.items.get(p.id)!.col},${ctx.state.items.get(p.id)!.row}`)).size).toBe(3);

    const settled = planted.map((p) => ({ ...ctx.state.items.get(p.id)! }));
    ctx.bus.emit('board:reconcile', {}); // idempotent — a sound board is untouched
    for (const s of settled) {
      expect(ctx.state.items.get(s.id)!.col).toBe(s.col);
      expect(ctx.state.items.get(s.id)!.row).toBe(s.row);
    }
  });

  it('leaves the isle alone — its fixtures stand OFF the playable zone on purpose', () => {
    const ctx = createTestContext();
    // The Theme Crystal is a landmark on a non-active cell (see GeneratorSystem's
    // drop rule). The isle's cells never move, so nothing there is ever stranded —
    // and walking the crystal onto the nearest tile is not a repair, it is drift.
    const off = { col: 40, row: 40 };
    ctx.state.expandBoardTo(off.col, off.row);
    expect(ctx.state.isTileActive(off.col, off.row)).toBe(false);
    const crystal = ctx.state.addItem({ chain: 'crystal', tier: 1, ...off, kind: 'item' });

    ctx.bus.emit('board:reconcile', {});

    expect(ctx.state.items.get(crystal.id)).toMatchObject(off); // it did not budge
  });

  it('the Elder stands in ONE place — the altar reads borealis’ own board', () => {
    const ctx = createTestContext();
    expect(ctx.state.worldHolds('borealis', 'golden_egg')).toBe(false); // she has not flown yet
    ctx.state.setActiveWorld('borealis');
    ctx.state.addItem({ chain: 'golden_egg', tier: 2, col: 3, row: 3, kind: 'item' });
    ctx.state.setActiveWorld(PRIMARY_WORLD);
    // Read from the isle, about a world you are not standing in: that is the whole
    // point — the altar clears because she IS somewhere, not because a flag says so.
    expect(ctx.state.worldHolds('borealis', 'golden_egg')).toBe(true);
    expect(ctx.state.worldHolds('roothold', 'golden_egg')).toBe(false);
  });

  it('ids never collide across worlds after a reload', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'lumber', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.setActiveWorld('roothold');
    const a = ctx.state.addItem({ chain: 'strawberry', tier: 1, col: 1, row: 1, kind: 'item' });

    ctx.state.hydrate(ctx.state.toSave(1000, 8));
    ctx.state.setActiveWorld('roothold');
    const b = ctx.state.addItem({ chain: 'strawberry', tier: 1, col: 2, row: 2, kind: 'item' });
    expect(b.id).toBeGreaterThan(a.id); // the counter resumed, it did not restart
  });
});
