import { describe, expect, it } from 'vitest';
import { DRAGON_FEED } from '../../src/core/Constants';
import { capture, createTestContext } from './helpers';

/**
 * The dragon's larder. The rule under every case here: the board is where food
 * GROWS, the larder is where it waits. A bush is banked by tapping it, and feeding
 * spends from the bank — never off the board — so the HUD gauge is the truth rather
 * than a guess about what is lying around.
 */
describe('DragonFeedSystem — the larder', () => {
  it('banks a tapped bush: the board piece is consumed and the stock rises', () => {
    const ctx = createTestContext();
    const bush = ctx.state.addItem({
      chain: DRAGON_FEED.chain,
      tier: DRAGON_FEED.stockTier,
      col: 3,
      row: 3,
      kind: 'item'
    });
    const changed = capture(ctx.bus, 'dragon:stock_changed');

    ctx.bus.emit('dragon:store_food', { itemId: bush.id });

    expect(ctx.state.berryStock).toBe(1);
    expect(ctx.state.itemIdAt(3, 3)).toBeNull(); // really taken off the board
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ stock: 1, gained: 1, at: { col: 3, row: 3 } });
  });

  it('refuses anything that is not a bush, without consuming it', () => {
    const ctx = createTestContext();
    const sprout = ctx.state.addItem({ chain: DRAGON_FEED.chain, tier: 1, col: 2, row: 2, kind: 'item' });
    const ruby = ctx.state.addItem({ chain: 'ember_dragon', tier: 1, col: 4, row: 4, kind: 'item' });

    ctx.bus.emit('dragon:store_food', { itemId: sprout.id }); // a sprout is not yet food
    ctx.bus.emit('dragon:store_food', { itemId: ruby.id }); // nor is a Dragon Ruby
    ctx.bus.emit('dragon:store_food', { itemId: 9999 }); // nor is a stale id

    expect(ctx.state.berryStock).toBe(0);
    expect(ctx.state.itemIdAt(2, 2)).toBe(sprout.id);
    expect(ctx.state.itemIdAt(4, 4)).toBe(ruby.id);
  });

  it('feeds from the STOCK, not from the board, and fails cleanly when empty', () => {
    const ctx = createTestContext();
    const fed = capture(ctx.bus, 'dragon:fed');
    const failed = capture(ctx.bus, 'dragon:feed_failed');
    const before = ctx.state.dragonStat('ember_dragon').level;

    // A bush sitting on the board is NOT reachable food — it has to be banked first.
    ctx.state.addItem({ chain: DRAGON_FEED.chain, tier: DRAGON_FEED.stockTier, col: 3, row: 3, kind: 'item' });
    ctx.bus.emit('dragon:feed', { chain: 'ember_dragon' });
    expect(fed).toHaveLength(0);
    expect(failed.at(-1)?.reason).toBe('no_berry');
    expect(ctx.state.itemIdAt(3, 3)).not.toBeNull(); // and it was not quietly eaten
    expect(ctx.state.dragonStat('ember_dragon').level).toBe(before);

    ctx.state.berryStock = 2;
    ctx.bus.emit('dragon:feed', { chain: 'ember_dragon' });
    expect(fed).toHaveLength(1);
    expect(ctx.state.berryStock).toBe(1); // exactly one spent
    expect(fed[0]!.level).toBe(before + DRAGON_FEED.dragonLevelsPerFeed);
    expect(ctx.state.dragonStat('ember_dragon').fedAt).toBeTypeOf('number'); // hunger clock stamped
  });

  it('feeding also pays the Keeper XP', () => {
    const ctx = createTestContext();
    ctx.state.berryStock = 1;
    const xp0 = ctx.state.xp;
    ctx.bus.emit('dragon:feed', { chain: 'ember_dragon' });
    expect(ctx.state.xp).toBe(xp0 + DRAGON_FEED.keeperXpPerFeed);
  });

  it('buys straight into the larder; refuses when broke', () => {
    const ctx = createTestContext();
    const bought = capture(ctx.bus, 'dragon:food_bought');
    const failed = capture(ctx.bus, 'dragon:feed_failed');

    ctx.state.coins = 0;
    ctx.bus.emit('dragon:buy_food', { chain: 'ember_dragon' });
    expect(bought).toHaveLength(0);
    expect(failed.at(-1)?.reason).toBe('no_gold');
    expect(ctx.state.berryStock).toBe(0);

    // A purchase lands where feeding LOOKS — putting it on the board would only ask
    // the player to tap it again.
    ctx.state.coins = DRAGON_FEED.buyGold + 5;
    ctx.bus.emit('dragon:buy_food', { chain: 'ember_dragon' });
    expect(bought).toHaveLength(1);
    expect(ctx.state.coins).toBe(5);
    expect(ctx.state.berryStock).toBe(1);
  });

  it('survives a save round trip, and an older save simply starts empty', () => {
    const ctx = createTestContext();
    ctx.state.berryStock = 4;
    const save = ctx.state.toSave(1000, 8);
    expect(save.berryStock).toBe(4);

    ctx.state.hydrate(save);
    expect(ctx.state.berryStock).toBe(4);

    const { berryStock: _dropped, ...preLarder } = save;
    ctx.state.hydrate(preLarder as typeof save);
    expect(ctx.state.berryStock).toBe(0); // no NaN, no crash — an empty larder
  });
});
