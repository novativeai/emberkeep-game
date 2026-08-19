import { describe, expect, it } from 'vitest';
import { createTestContext } from './helpers';

/**
 * A QUEST IS THE KEEPER'S BUSINESS, NOT A BOARD'S.
 *
 * The ladder used to be filtered to the world the player was standing in, and
 * the reason given was correctness rather than tidiness: `countItems` read the
 * ACTIVE board, so an Emberkeep quest asking for six Gem Shards sat at `0 / 6`
 * the whole time the player was in the north. Hiding those quests was the
 * honest response to a count that lied.
 *
 * The count no longer lies, so the hiding is gone too. What replaces it is
 * "have you been there" rather than "are you there now": a ladder she has
 * walked into follows her home, and one she has never seen stays out of sight —
 * otherwise Selyna joins the roster during the tutorial, a chapter before the
 * player learns she exists.
 */
describe('quests across worlds', () => {
  it('counts pieces left on another board', () => {
    const ctx = createTestContext();
    ctx.bus.emit('board:spawn', { chain: 'ashmoss', tier: 1, count: 3 });
    const home = ctx.state.worldId;
    const before = ctx.state.countItemsAnywhere('ashmoss', 1);
    expect(before).toBeGreaterThanOrEqual(3);
    expect(ctx.state.countItems('ashmoss', 1)).toBe(before);

    // Travel somewhere else. The pieces stay where they were left.
    const elsewhere = [...ctx.state.worlds.keys()].find((id) => id !== home);
    expect(elsewhere, 'the fixture map has a second world to travel to').toBeTruthy();
    ctx.state.switchWorld(elsewhere!);

    expect(ctx.state.countItems('ashmoss', 1), 'the active board is empty').toBe(0);
    expect(ctx.state.countItemsAnywhere('ashmoss', 1), 'the Keeper still owns them').toBe(before);
  });

  it('can reach and remove a piece standing on a board it is not looking at', () => {
    const ctx = createTestContext();
    ctx.bus.emit('board:spawn', { chain: 'ashmoss', tier: 1, count: 1 });
    const home = ctx.state.worldId;
    const found = ctx.state.itemsMatchingAnywhere('ashmoss', 1);
    expect(found.length).toBe(1);
    expect(found[0]!.worldId).toBe(home);

    const elsewhere = [...ctx.state.worlds.keys()].find((id) => id !== home)!;
    ctx.state.switchWorld(elsewhere);

    // `worldOfItem` is what lets a delivery made in the north be paid for out
    // of the home isle — the lookup BoardSystem.consume does before removing.
    const id = found[0]!.item.id;
    expect(ctx.state.worldOfItem(id)).toBe(home);
    expect(ctx.state.removeItemIn(home, id)).toBeTruthy();
    expect(ctx.state.countItemsAnywhere('ashmoss', 1)).toBe(0);
    // …and the cell it stood on is free again on ITS board, not on this one.
    ctx.state.switchWorld(home);
    expect(ctx.state.countItems('ashmoss', 1)).toBe(0);
  });

  it('tracks a ladder for every world visited, and none for a world unseen', () => {
    const ctx = createTestContext();
    const home = ctx.state.worldId;
    const worldsOf = (): Set<string> =>
      new Set(ctx.systems.quests.tracked.map((q) => q.world ?? 'emberkeep'));

    expect(worldsOf(), 'only the world she has stood in').toEqual(new Set([home]));

    const elsewhere = [...ctx.state.worlds.keys()].find((id) => id !== home)!;
    ctx.state.switchWorld(elsewhere);
    // Both now: the far ladder is reachable, and the home one FOLLOWED her.
    const after = worldsOf();
    expect(after.has(home), 'the home ladder followed her north').toBe(true);
  });
});
