import { describe, expect, it } from 'vitest';
import { MemoryStorage, capture, createTestContext } from './helpers';

const POUCH = {
  purchaseId: 'purch_1',
  packId: 'coin_pouch',
  name: 'Pouch of Coins',
  coins: 300,
  keys: 0,
  energy: 0
};

describe('IapSystem (real-money grant delivery)', () => {
  it('applies a grant once: coins land, the latch is set, iap:completed fires', () => {
    const ctx = createTestContext();
    const before = ctx.state.coins;
    const completed = capture(ctx.bus, 'iap:completed');

    ctx.bus.emit('iap:grant', POUCH);

    expect(ctx.state.coins).toBe(before + 300);
    expect(ctx.state.stat('iap:purch_1')).toBe(1);
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ packId: 'coin_pouch', coins: 300 });
  });

  it('absorbs a replayed delivery of the same purchase (no double grant)', () => {
    const ctx = createTestContext();
    const before = ctx.state.coins;
    const completed = capture(ctx.bus, 'iap:completed');

    ctx.bus.emit('iap:grant', POUCH);
    ctx.bus.emit('iap:grant', POUCH); // lost ack → hub re-delivers

    expect(ctx.state.coins).toBe(before + 300);
    expect(completed).toHaveLength(1);
  });

  it('distinct purchases of the same pack each deliver', () => {
    const ctx = createTestContext();
    const before = ctx.state.coins;

    ctx.bus.emit('iap:grant', POUCH);
    ctx.bus.emit('iap:grant', { ...POUCH, purchaseId: 'purch_2' });

    expect(ctx.state.coins).toBe(before + 600);
  });

  it('energy packs grant through EnergySystem (capped at the max)', () => {
    const ctx = createTestContext();
    ctx.bus.emit('energy:spend', { amount: 5, reason: 'test' });
    const drained = ctx.state.energyCurrent;

    ctx.bus.emit('iap:grant', {
      purchaseId: 'purch_3',
      packId: 'energy_surge',
      name: 'Energy Surge',
      coins: 0,
      keys: 0,
      energy: 30
    });

    expect(ctx.state.energyCurrent).toBe(Math.min(drained + 30, ctx.state.energyMax));
  });

  it('the latch survives the save round-trip', () => {
    const storage = new MemoryStorage();
    const ctx = createTestContext(storage);
    ctx.bus.emit('iap:grant', POUCH);
    ctx.systems.save.save();

    const revived = createTestContext(storage);
    revived.systems.save.load();
    expect(revived.state.stat('iap:purch_1')).toBe(1);
  });
});
