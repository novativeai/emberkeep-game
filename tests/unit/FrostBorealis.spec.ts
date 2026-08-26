import { describe, expect, it } from 'vitest';
import chainsJson from '../../src/data/chains.json';
import storeJson from '../../src/data/store.json';
import { createTestContext } from './helpers';

/**
 * THE FROST DRAGON IS BOREALIS-BORN — the owner's call, made twice.
 *
 * The store card always said "Only in Borealis", but the CHAIN carried no
 * world, so the bag ferried the eggs anywhere: buy in the north, overflow to
 * the bag, place on a southern board, hatch. Three locks close that:
 * chains.json binds the chain, BagSystem refuses to land a world-bound piece
 * on foreign soil, and `exileForeignChains` heals the saves that already
 * carry a frost dragon abroad.
 */
describe('frost is bound to borealis', () => {
  it('the chain carries its world in data', () => {
    const frost = (chainsJson as { chains: Array<{ id: string; world?: string }> }).chains.find(
      (c) => c.id === 'frost'
    );
    expect(frost?.world).toBe('borealis');
  });

  it('the bag refuses to place a frost egg outside borealis, and allows it at home', () => {
    const ctx = createTestContext();
    expect(ctx.state.worldId).not.toBe('borealis');
    ctx.bus.emit('bag:bank', { chain: 'frost', tier: 1, count: 2 });

    const failures: string[] = [];
    ctx.bus.on('bag:store_failed', ({ reason, world }) => failures.push(`${reason}:${world}`));
    ctx.bus.emit('ui:bag_retrieve_requested', { chain: 'frost', tier: 1, count: 1 });
    expect(failures).toEqual(['wrong_world:borealis']);
    expect(ctx.state.countItems('frost', 1)).toBe(0);
    expect(ctx.state.bag.find((s) => s.chain === 'frost')?.count).toBe(2);

    // On its own soil the same request lands.
    if (ctx.state.worlds.has('borealis')) {
      ctx.state.switchWorld('borealis');
      ctx.bus.emit('ui:bag_retrieve_requested', { chain: 'frost', tier: 1, count: 1 });
      expect(ctx.state.countItems('frost', 1)).toBe(1);
      expect(ctx.state.bag.find((s) => s.chain === 'frost')?.count).toBe(1);
    }
  });

  it('exileForeignChains sends a stray frost dragon home and leaves natives alone', () => {
    const ctx = createTestContext();
    const home = ctx.state.worldId;
    ctx.bus.emit('board:spawn', { chain: 'frost', tier: 2, count: 1 });
    ctx.bus.emit('board:spawn', { chain: 'ashmoss', tier: 1, count: 1 });
    expect(ctx.state.countItems('frost', 2)).toBe(1);

    const moved = ctx.state.exileForeignChains((chain) => (chain === 'frost' ? 'borealis' : undefined));
    if (!ctx.state.worlds.has('borealis')) {
      // A fixture without the north cannot relocate — nothing may be lost.
      expect(moved).toBe(0);
      expect(ctx.state.countItems('frost', 2)).toBe(1);
      return;
    }
    expect(moved).toBe(1);
    expect(ctx.state.countItems('frost', 2), 'gone from the active board').toBe(0);
    expect(ctx.state.countItemsAnywhere('frost', 2), 'still owned').toBe(1);
    expect(ctx.state.countItems('ashmoss', 1), 'the unbound chain stayed').toBe(1);
    // And it landed on a real playable cell of the north.
    ctx.state.switchWorld('borealis');
    expect(ctx.state.countItems('frost', 2)).toBe(1);
    const item = [...ctx.state.items.values()].find((i) => i.chain === 'frost')!;
    expect(ctx.state.world.playable.has(`${item.col},${item.row}`)).toBe(true);
    expect(home).not.toBe('borealis');
  });
});

/**
 * THE STORM DRAGON IS BOREALIS-BORN TOO (owner's call, 2026-08-26). It had
 * frost's exact original defect: the store card sold it in EMBERKEEP and the
 * chain carried no world, so storm eggs stood on the southern isle. The same
 * three locks now hold it — the chain binds, the shelf sells it in the north
 * (and its Runevault shopfront), and `exileForeignChains` heals the saves
 * that already bought one in the south.
 */
describe('storm is bound to borealis', () => {
  it('the chain carries its world in data', () => {
    const storm = (chainsJson as { chains: Array<{ id: string; world?: string }> }).chains.find(
      (c) => c.id === 'storm'
    );
    expect(storm?.world).toBe('borealis');
  });

  it('the store card sells it in borealis, not emberkeep', () => {
    const card = (storeJson as { sections: Array<{ items: Array<{ id: string; world?: string }> }> }).sections
      .flatMap((s) => s.items)
      .find((i) => i.id === 'storm');
    expect(card?.world).toBe('borealis');
  });

  it('a southern storm egg is exiled home when the isle loads', () => {
    const ctx = createTestContext();
    expect(ctx.state.worldId).toBe('emberkeep');
    ctx.state.addItem({ chain: 'storm', tier: 1, col: 2, row: 2, kind: 'item' });

    const moved = ctx.state.exileForeignChains((chain) => (chain === 'storm' ? 'borealis' : undefined));

    expect(moved).toBeGreaterThan(0);
    expect([...ctx.state.items.values()].some((i) => i.chain === 'storm')).toBe(false);
    expect([...(ctx.state.itemsIn('borealis')?.values() ?? [])].some((i) => i.chain === 'storm')).toBe(true);
  });
});
