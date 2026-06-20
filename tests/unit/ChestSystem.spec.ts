import { afterEach, describe, expect, it, vi } from 'vitest';
import { capture, createTestContext } from './helpers';

describe('ChestSystem', () => {
  afterEach(() => vi.restoreAllMocks());

  it('grants 2 Gold and consumes the chest (random → coins)', () => {
    const ctx = createTestContext();
    vi.spyOn(Math, 'random').mockReturnValue(0); // index 0 → coins
    const chest = ctx.state.addItem({ chain: 'chest', tier: 1, col: 3, row: 3, kind: 'item' });
    const economy = capture(ctx.bus, 'economy:add');

    ctx.bus.emit('chest:open', { itemId: chest.id });

    expect(economy.some((e) => e.coins === 2 && e.reason === 'chest')).toBe(true);
    expect(ctx.state.items.get(chest.id)).toBeUndefined();
  });

  it('grants Warmth (random → energy)', () => {
    const ctx = createTestContext();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // index 1 → energy
    const chest = ctx.state.addItem({ chain: 'chest', tier: 1, col: 3, row: 3, kind: 'item' });
    const energy = capture(ctx.bus, 'energy:add');

    ctx.bus.emit('chest:open', { itemId: chest.id });

    expect(energy.some((e) => e.amount === 3 && e.reason === 'chest')).toBe(true);
    expect(ctx.state.items.get(chest.id)).toBeUndefined();
  });

  it('never spawns wood (lumber appears only from cleared cloud zones, never from a chest)', () => {
    const ctx = createTestContext();
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // the old "wood" roll
    const chest = ctx.state.addItem({ chain: 'chest', tier: 1, col: 3, row: 3, kind: 'item' });
    const spawned = capture(ctx.bus, 'item:spawned');

    ctx.bus.emit('chest:open', { itemId: chest.id });

    expect(spawned.some((s) => s.item.chain === 'lumber')).toBe(false);
    expect(ctx.state.items.get(chest.id)).toBeUndefined();
  });

  it('ignores a chest:open for a non-chest item', () => {
    const ctx = createTestContext();
    const weed = ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 2, row: 2, kind: 'item' });
    const economy = capture(ctx.bus, 'economy:add');

    ctx.bus.emit('chest:open', { itemId: weed.id });

    expect(economy).toHaveLength(0);
    expect(ctx.state.items.get(weed.id)).toBeDefined(); // untouched
  });
});
