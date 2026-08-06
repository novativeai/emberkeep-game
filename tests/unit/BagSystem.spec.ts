import { describe, expect, it } from 'vitest';
import { BAG_SLOTS } from '../../src/core/Constants';
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
