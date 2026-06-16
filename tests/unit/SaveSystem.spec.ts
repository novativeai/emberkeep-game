import { describe, expect, it } from 'vitest';
import { ENERGY_MAX, ENERGY_REGEN_MS, SAVE_KEY } from '../../src/core/Constants';
import { capture, createTestContext, drag, MemoryStorage } from './helpers';

describe('SaveSystem', () => {
  it('round-trips full mid-game state through storage', () => {
    const storage = new MemoryStorage();
    const ctx1 = createTestContext(storage);
    ctx1.beginRun(); // fresh board from map.json

    // Play a little: merge the tutorial weeds, spend some energy.
    drag(ctx1, [3, 4], [1, 4]);
    ctx1.bus.emit('energy:spend', { amount: 4, reason: 'test' });
    ctx1.bus.emit('economy:add', { coins: 7, reason: 'test' });
    ctx1.state.tutorialIndex = 3;
    ctx1.systems.save.save();

    const ctx2 = createTestContext(storage);
    const loadedEvents = capture(ctx2.bus, 'state:loaded');
    expect(ctx2.systems.save.load()).toBe(true);

    expect(loadedEvents).toHaveLength(1);
    expect(ctx2.state.items.size).toBe(ctx1.state.items.size);
    expect(ctx2.state.itemAt(1, 4)?.chain).toBe('sparkweed');
    expect(ctx2.state.itemAt(1, 4)?.tier).toBe(2);
    expect(ctx2.state.coins).toBe(7);
    expect(ctx2.state.xp).toBe(ctx1.state.xp);
    expect(ctx2.state.tutorialIndex).toBe(3);
    expect(ctx2.state.regionStatus.get('north_fog')).toBe('unlockable');
    expect(ctx2.state.nextItemId).toBe(ctx1.state.nextItemId);
  });

  it('applies offline energy regen on load', () => {
    const storage = new MemoryStorage();
    const ctx1 = createTestContext(storage);
    ctx1.beginRun();
    ctx1.bus.emit('energy:spend', { amount: 5, reason: 'test' });
    ctx1.systems.save.save();

    const ctx2 = createTestContext(storage);
    ctx2.clock.advance(ENERGY_REGEN_MS * 3 + 500); // "offline" for ~3 intervals
    const loadedEvents = capture(ctx2.bus, 'state:loaded');
    ctx2.systems.save.load();

    expect(loadedEvents[0]?.energyRecovered).toBe(3);
    expect(ctx2.state.energyCurrent).toBe(ENERGY_MAX - 5 + 3);
  });

  it('autosaves on mutations (merge updates storage without an explicit save)', () => {
    const storage = new MemoryStorage();
    const ctx = createTestContext(storage);
    ctx.beginRun();
    const before = storage.getItem(SAVE_KEY);

    drag(ctx, [3, 4], [1, 4]);

    const after = storage.getItem(SAVE_KEY);
    expect(after).not.toBeNull();
    expect(after).not.toEqual(before);
    const parsed = JSON.parse(after!) as { items: { chain: string; tier: number }[] };
    expect(parsed.items.some((i) => i.chain === 'sparkweed' && i.tier === 2)).toBe(true);
  });

  it('discards saves with a mismatched version', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 999, items: [] }));
    const ctx = createTestContext(storage);
    expect(ctx.systems.save.hasSave()).toBe(false);
    expect(ctx.systems.save.load()).toBe(false);
  });

  it('discards corrupt saves', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, '{not json');
    const ctx = createTestContext(storage);
    expect(ctx.systems.save.load()).toBe(false);
  });

  it('reset clears the save and rewinds state', () => {
    const storage = new MemoryStorage();
    const ctx = createTestContext(storage);
    ctx.beginRun();
    ctx.bus.emit('economy:add', { coins: 99, reason: 'test' });
    const resets = capture(ctx.bus, 'game:reset');

    ctx.bus.emit('game:reset_requested', {});

    expect(resets).toHaveLength(1);
    expect(storage.getItem(SAVE_KEY)).toBeNull();
    expect(ctx.state.coins).toBe(0);
    expect(ctx.state.items.size).toBe(0);
    expect(ctx.running).toBe(false);
  });
});
