import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHEST_INTERVAL_MS } from '../../src/core/Constants';
import { capture, createTestContext } from './helpers';

describe('ChestSystem (standing gift box)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('grants 15 Gold (random → coins), keeps the chest, and recharges its timer', () => {
    const ctx = createTestContext();
    vi.spyOn(Math, 'random').mockReturnValue(0); // index 0 → coins
    const chest = ctx.state.addItem({ chain: 'chest', tier: 1, col: 3, row: 3, kind: 'item' });
    const economy = capture(ctx.bus, 'economy:add');

    const before = ctx.clock.now();
    ctx.bus.emit('chest:open', { itemId: chest.id });

    expect(economy.some((e) => e.coins === 15 && e.reason === 'chest')).toBe(true);
    expect(ctx.state.items.get(chest.id)).toBeDefined(); // NOT consumed
    expect(chest.readyAt).toBeGreaterThanOrEqual(before + CHEST_INTERVAL_MS); // recharged
    expect(chest.readyAt).toBeLessThanOrEqual(ctx.clock.now() + CHEST_INTERVAL_MS);
  });

  it('pops 3 Emeralds (random → emerald) without consuming the chest', () => {
    const ctx = createTestContext();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // index 1 → emerald
    const chest = ctx.state.addItem({ chain: 'chest', tier: 1, col: 3, row: 3, kind: 'item' });
    const spawned = capture(ctx.bus, 'item:spawned');

    ctx.bus.emit('chest:open', { itemId: chest.id });

    const gems = spawned.filter((s) => s.item.chain === 'emerald' && s.item.tier === 1);
    expect(gems).toHaveLength(3);
    expect(ctx.state.items.get(chest.id)).toBeDefined();
  });

  it('pops 3 Rubies (random → ember_dragon)', () => {
    const ctx = createTestContext();
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // index 2 → ember_dragon (ruby)
    const chest = ctx.state.addItem({ chain: 'chest', tier: 1, col: 3, row: 3, kind: 'item' });
    const spawned = capture(ctx.bus, 'item:spawned');

    ctx.bus.emit('chest:open', { itemId: chest.id });

    const rubies = spawned.filter((s) => s.item.chain === 'ember_dragon' && s.item.tier === 1);
    expect(rubies).toHaveLength(3);
  });

  it('never spawns wood — lumber appears only from cleared cloud zones', () => {
    const ctx = createTestContext();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const chest = ctx.state.addItem({ chain: 'chest', tier: 1, col: 3, row: 3, kind: 'item' });
    const spawned = capture(ctx.bus, 'item:spawned');

    ctx.bus.emit('chest:open', { itemId: chest.id });

    expect(spawned.some((s) => s.item.chain === 'lumber')).toBe(false);
  });

  it('ignores a tap while the gift is still cooking (cooldown not elapsed)', () => {
    const ctx = createTestContext();
    const chest = ctx.state.addItem({ chain: 'chest', tier: 1, col: 3, row: 3, kind: 'item' });
    const ready = ctx.clock.now() + 60_000; // recharging
    chest.readyAt = ready;
    const economy = capture(ctx.bus, 'economy:add');
    const spawned = capture(ctx.bus, 'item:spawned');

    ctx.bus.emit('chest:open', { itemId: chest.id });

    expect(economy).toHaveLength(0);
    expect(spawned).toHaveLength(0);
    expect(chest.readyAt).toBe(ready); // untouched
  });

  it('pays GOLD instead when no free tile sits within the reward radius', () => {
    const ctx = createTestContext();
    const chest = ctx.state.addItem({ chain: 'chest', tier: 1, col: 3, row: 3, kind: 'item' });
    // Pack every free active tile so an item gift has nowhere NEAR to land.
    for (const cell of ctx.state.freeActiveTilesNear(3, 3)) {
      ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: cell.col, row: cell.row, kind: 'item' });
    }
    const economy = capture(ctx.bus, 'economy:add');
    const spawned = capture(ctx.bus, 'item:spawned');
    const origRandom = Math.random;
    Math.random = () => 0.99; // force an ITEM gift (last CHEST_GIFTS entry)
    try {
      ctx.bus.emit('chest:open', { itemId: chest.id });
    } finally {
      Math.random = origRandom;
    }

    expect(spawned).toHaveLength(0); // nothing teleports across the map
    expect(economy).toHaveLength(1); // the Gold gift pays out instead
    expect(economy[0]!.coins).toBeGreaterThan(0);
  });

  it('ignores a chest:open for a non-chest item', () => {
    const ctx = createTestContext();
    const weed = ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 2, row: 2, kind: 'item' });
    const economy = capture(ctx.bus, 'economy:add');

    ctx.bus.emit('chest:open', { itemId: weed.id });

    expect(economy).toHaveLength(0);
    expect(ctx.state.items.get(weed.id)).toBeDefined();
  });
});
