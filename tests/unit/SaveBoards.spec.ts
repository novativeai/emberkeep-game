import { describe, expect, it } from 'vitest';
import { GameContext } from '../../src/core/Context';
import { LEVEL_XP, SAVE_KEY, SAVE_VERSION } from '../../src/core/Constants';
import type { MapData, SaveDataV1 } from '../../src/core/types';
import realMap from '../../src/data/map.json';
import { MemoryStorage } from './helpers';

/** Travel needs the REAL authored map: the 8×8 fixture fails the zones'
 *  baseSignature, so emberkeep degrades to a lone world with nowhere to go. */
const ctxWith = (storage: MemoryStorage): GameContext =>
  new GameContext(storage, { map: realMap as unknown as MapData });

/** A run standing in the north, with a save written from there. */
function travelledNorth(storage: MemoryStorage): GameContext {
  const ctx = ctxWith(storage);
  ctx.beginRun();
  ctx.state.tutorialDone = true;
  ctx.state.addStat('q:done:keepers_hoard', 1); // the Elder is awake — Borealis is open
  ctx.bus.emit('economy:add', { xp: LEVEL_XP[2], reason: 'test' });
  ctx.bus.emit('world:switch', { to: 'borealis' });
  expect(ctx.state.worldId).toBe('borealis');
  ctx.systems.save.save();
  return ctx;
}

const read = (storage: MemoryStorage): SaveDataV1 =>
  JSON.parse(storage.getItem(SAVE_KEY) ?? 'null') as SaveDataV1;

const write = (storage: MemoryStorage, save: SaveDataV1): void =>
  storage.setItem(SAVE_KEY, JSON.stringify(save));

/** Cells that hold more than one piece, on any world. */
function superposed(ctx: GameContext): string[] {
  const clashes: string[] = [];
  for (const worldId of ctx.state.worlds.keys()) {
    const seen = new Set<string>();
    for (const item of ctx.state.itemsIn(worldId)?.values() ?? []) {
      const cell = `${worldId}@${item.col},${item.row}`;
      if (seen.has(cell)) clashes.push(cell);
      seen.add(cell);
    }
  }
  return clashes;
}

/**
 * TWO WORLDS MUST NEVER LAND ON ONE MAP.
 *
 * A board per world is the whole travel model: leaving one is a change of view,
 * and the board left behind keeps standing. A reload is where that model is
 * actually tested, because it is the one moment every board is rebuilt at once
 * from a single file — and the file's SHAPE (the home world at the top level,
 * the rest under `boards`) is history, not proof of what belongs where.
 */
describe('a reload rebuilds each world onto its own board', () => {
  it('comes back standing where the Keeper closed the tab', () => {
    const storage = new MemoryStorage();
    travelledNorth(storage);

    const fresh = ctxWith(storage);
    fresh.beginRun();
    expect(fresh.state.worldId).toBe('borealis');
  });

  it('keeps the two boards apart, and puts nothing on top of anything', () => {
    const storage = new MemoryStorage();
    const ctx = travelledNorth(storage);
    const home = [...(ctx.state.itemsIn('emberkeep')?.keys() ?? [])].sort();
    const north = [...(ctx.state.itemsIn('borealis')?.keys() ?? [])].sort();
    expect(home.length).toBeGreaterThan(0);
    expect(north.length).toBeGreaterThan(0);

    const fresh = ctxWith(storage);
    fresh.beginRun();
    expect([...(fresh.state.itemsIn('emberkeep')?.keys() ?? [])].sort()).toEqual(home);
    expect([...(fresh.state.itemsIn('borealis')?.keys() ?? [])].sort()).toEqual(north);
    expect(superposed(fresh)).toEqual([]);
  });

  it('files a piece by the world it names, not the section it sits in', () => {
    // `place.world` is written beside every piece's art position for exactly
    // this question. A save whose sections got crossed — for any reason a
    // loader cannot audit — must sort itself out rather than drop the northern
    // board onto the isle.
    const storage = new MemoryStorage();
    travelledNorth(storage);
    const save = read(storage);
    const strays = save.boards!.borealis!.items.splice(0, 2);
    expect(strays[0]!.place?.world).toBe('borealis');
    save.items.push(...strays); // filed under the HOME board, claiming the north
    write(storage, save);

    const fresh = ctxWith(storage);
    fresh.beginRun();
    for (const stray of strays) {
      expect(fresh.state.itemsIn('borealis')?.has(stray.id), `${stray.id} went north`).toBe(true);
      expect(fresh.state.itemsIn('emberkeep')?.has(stray.id)).toBe(false);
    }
    expect(superposed(fresh)).toEqual([]);
  });

  it('never stacks two pieces on one cell, whatever the save says', () => {
    // ONE PIECE PER CELL is what merging, dragging, the grid's reverse lookup
    // and every hit test assume. The loader used to write both and let the grid
    // remember only the last — an invisible-to-the-rules piece under a visible
    // one, which is what a scrambled board is made of.
    const storage = new MemoryStorage();
    travelledNorth(storage);
    const save = read(storage);
    const [first, second] = save.items;
    expect(second, 'the home board needs two pieces to stack').toBeTruthy();
    // Second piece dropped exactly on top of the first, place and all.
    save.items[1] = { ...second!, col: first!.col, row: first!.row, place: first!.place };
    write(storage, save);

    const fresh = ctxWith(storage);
    fresh.beginRun();
    expect(superposed(fresh)).toEqual([]);
    // …and it is not simply thrown away: it is standing somewhere, or banked.
    const onBoard = fresh.state.itemsIn('emberkeep')?.has(second!.id) ?? false;
    const banked = fresh.state.bag.some((s) => s.chain === second!.chain && s.count > 0);
    expect(onBoard || banked).toBe(true);
  });

  it('never hands a new piece an id something on the board is already using', () => {
    // The item map is keyed by id: a counter that has fallen behind lets the
    // next spawn REPLACE a piece the player owns while the grid still points at
    // the old one.
    const storage = new MemoryStorage();
    travelledNorth(storage);
    const save = read(storage);
    const highest = Math.max(...save.items.map((i) => i.id));
    save.nextItemId = 1; // a counter behind its own board
    write(storage, save);

    const fresh = ctxWith(storage);
    fresh.beginRun();
    expect(fresh.state.nextItemId).toBeGreaterThan(highest);
  });

  it('writes a save the current build will actually open', () => {
    // Version is the gate on every one of the above: a save the loader rejects
    // starts a new game, which is the loudest possible version of this bug.
    const storage = new MemoryStorage();
    travelledNorth(storage);
    expect(read(storage).version).toBe(SAVE_VERSION);
    expect(ctxWith(storage).systems.save.peek()).not.toBeNull();
  });
});
