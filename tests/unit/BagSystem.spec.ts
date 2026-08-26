import { describe, expect, it } from 'vitest';
import { BAG_SLOTS } from '../../src/core/Constants';
import chainsJson from '../../src/data/chains.json';
import { capture, createTestContext } from './helpers';

/** Put a piece on the board and hand back its id. */
function place(ctx: ReturnType<typeof createTestContext>, chain: string, tier: number): number {
  ctx.bus.emit('board:spawn', { chain, tier, count: 1 });
  return [...ctx.state.items.values()].at(-1)!.id;
}

describe('BagSystem (store on tap, retrieve from the panel)', () => {
  it('stores a board piece: it leaves the board and becomes a stack', () => {
    const ctx = createTestContext();
    const id = place(ctx, 'flame_gem', 1);
    const stored = capture(ctx.bus, 'bag:stored');

    ctx.bus.emit('ui:store_requested', { itemId: id });

    expect(ctx.state.items.has(id)).toBe(false);
    expect(ctx.state.bag).toEqual([{ chain: 'flame_gem', tier: 1, count: 1 }]);
    expect(stored.at(-1)).toMatchObject({ chain: 'flame_gem', tier: 1 });
  });

  it('identical pieces POOL into one slot rather than eating a second one', () => {
    const ctx = createTestContext();
    for (let i = 0; i < 3; i++) {
      ctx.bus.emit('ui:store_requested', { itemId: place(ctx, 'flame_gem', 1) });
    }
    expect(ctx.state.bag).toHaveLength(1);
    expect(ctx.state.bag[0]!.count).toBe(3);
  });

  it('retrieve puts one back on the board and debits the stack', () => {
    const ctx = createTestContext();
    ctx.bus.emit('ui:store_requested', { itemId: place(ctx, 'flame_gem', 1) });
    ctx.bus.emit('ui:store_requested', { itemId: place(ctx, 'flame_gem', 1) });
    const before = ctx.state.items.size;

    ctx.bus.emit('ui:bag_retrieve_requested', { chain: 'flame_gem', tier: 1 });

    expect(ctx.state.items.size).toBe(before + 1);
    expect(ctx.state.bag[0]!.count).toBe(1);
  });

  it('the last one out empties the slot entirely', () => {
    const ctx = createTestContext();
    ctx.bus.emit('ui:store_requested', { itemId: place(ctx, 'flame_gem', 1) });
    ctx.bus.emit('ui:bag_retrieve_requested', { chain: 'flame_gem', tier: 1 });
    expect(ctx.state.bag).toEqual([]);
  });

  it('a full bag refuses a NEW stack but still tops up an existing one', () => {
    const ctx = createTestContext();
    // Fill every slot with a distinct chain+tier.
    const chains = ['flame_gem', 'emerald', 'ember_dragon', 'lumber'];
    let filled = 0;
    outer: for (const chain of chains) {
      for (let tier = 1; tier <= 4; tier++) {
        if (filled >= BAG_SLOTS) break outer;
        ctx.state.bag.push({ chain, tier, count: 1 });
        filled++;
      }
    }
    expect(ctx.state.bag).toHaveLength(BAG_SLOTS);

    const failed = capture(ctx.bus, 'bag:store_failed');
    const newcomer = place(ctx, 'strawberry', 1); // a chain not in the bag
    ctx.bus.emit('ui:store_requested', { itemId: newcomer });

    expect(failed.at(-1)).toMatchObject({ reason: 'full' });
    expect(ctx.state.items.has(newcomer)).toBe(true); // never silently eaten
    expect(ctx.state.bag).toHaveLength(BAG_SLOTS);

    // Topping up a stack that already exists is always allowed.
    const dupe = place(ctx, 'flame_gem', 1);
    ctx.bus.emit('ui:store_requested', { itemId: dupe });
    expect(ctx.state.bag.find((s) => s.chain === 'flame_gem' && s.tier === 1)!.count).toBe(2);
  });

  it('storing is free — it never touches Warmth or Gold', () => {
    const ctx = createTestContext();
    ctx.state.coins = 100;
    const energy = ctx.state.energyCurrent;
    ctx.bus.emit('ui:store_requested', { itemId: place(ctx, 'flame_gem', 1) });
    ctx.bus.emit('ui:bag_retrieve_requested', { chain: 'flame_gem', tier: 1 });
    expect(ctx.state.coins).toBe(100);
    expect(ctx.state.energyCurrent).toBe(energy);
  });

  it('survives a save/load round trip', () => {
    const ctx = createTestContext();
    ctx.bus.emit('ui:store_requested', { itemId: place(ctx, 'flame_gem', 1) });
    const save = ctx.state.toSave(0, 8);
    expect(save.bag).toEqual([{ chain: 'flame_gem', tier: 1, count: 1 }]);

    const fresh = createTestContext();
    fresh.state.hydrate(save);
    expect(fresh.state.bag).toEqual([{ chain: 'flame_gem', tier: 1, count: 1 }]);
  });
});

/**
 * EGGS ARE PROMISES, NOT MERCHANDISE (owner's law, 2026-08-26): every dragon
 * egg goes IN the bag and never OUT through the till. The two used to be one
 * flag — `sellable:false` also made the brewed eggs unpocketable, so a tap on
 * an Ash Dragon Egg died silently. `storable` now carries the story-fixture
 * refusal on its own.
 */
describe('dragon eggs: pocketable, never sellable', () => {
  it('every tier named an Egg refuses the till, in data', () => {
    // The law is pinned on the DATA so a future breed cannot ship a sellable
    // egg by forgetting a flag.
    const chains = (chainsJson as { chains: Array<{ tiers: Array<{ name: string; sellable?: boolean }> }> }).chains;
    const leaks = chains
      .flatMap((c) => c.tiers)
      .filter((t) => /\bEgg\b/.test(t.name) && t.sellable !== false)
      .map((t) => t.name);
    expect(leaks).toEqual([]);
  });

  it('a brewed Ash Dragon Egg goes into the bag from a tap', () => {
    const ctx = createTestContext();
    ctx.bus.emit('ui:store_requested', { itemId: place(ctx, 'ashdrake', 1) });
    expect(ctx.state.bag).toEqual([{ chain: 'ashdrake', tier: 1, count: 1 }]);
  });

  it('a banked Red Dragon Egg cannot be sold — coins and stack untouched', () => {
    const ctx = createTestContext();
    ctx.bus.emit('bag:bank', { chain: 'ember_dragon', tier: 2, count: 2 });
    const coins = ctx.state.coins;

    ctx.bus.emit('ui:bag_sell_requested', { chain: 'ember_dragon', tier: 2, count: 2 });

    expect(ctx.state.coins).toBe(coins);
    expect(ctx.state.bag).toEqual([{ chain: 'ember_dragon', tier: 2, count: 2 }]);
  });

  it('the Golden Egg still refuses the satchel outright, at the bus', () => {
    const ctx = createTestContext();
    ctx.bus.emit('ui:store_requested', { itemId: place(ctx, 'golden_egg', 1) });
    expect(ctx.state.bag).toEqual([]);
  });
});
