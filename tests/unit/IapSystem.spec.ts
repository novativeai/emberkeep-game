import { describe, expect, it } from 'vitest';
import { MS_PER_DAY } from '../../src/core/Constants';
import { MemoryStorage, capture, createTestContext } from './helpers';

/** A retired pack id, kept as the LEGACY case: delivery reads the stored grant,
 *  never the catalog, so an old purchase still lands. */
const POUCH = {
  purchaseId: 'purch_1',
  packId: 'coin_pouch',
  name: 'Pouch of Coins',
  coins: 300,
  keys: 0,
  energy: 0,
  unlimitedWarmthMs: 0
};

const HOARD = {
  purchaseId: 'purch_h',
  packId: 'hearth_hoard',
  name: 'Hearth Hoard',
  coins: 13000,
  keys: 0,
  energy: 0,
  unlimitedWarmthMs: 5 * MS_PER_DAY
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
    expect(ctx.state.energyUnlimitedUntil).toBe(0); // a legacy pack carries no time
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

  it('legacy Warmth packs (warmth_blaze) still grant — kept whole above the max, since they were paid for', () => {
    const ctx = createTestContext();
    ctx.bus.emit('energy:spend', { amount: 5, reason: 'test' });
    const drained = ctx.state.energyCurrent;

    ctx.bus.emit('iap:grant', {
      purchaseId: 'purch_3',
      packId: 'warmth_blaze',
      name: "Keeper's Blaze",
      coins: 0,
      keys: 0,
      energy: 50,
      unlimitedWarmthMs: 0
    });

    expect(ctx.state.energyCurrent).toBe(drained + 50);
  });

  it("today's Hearth Hoard: 13,000 Gold and 1,250 Warmth above the bar, and a refill after it cuts nothing", () => {
    const ctx = createTestContext();
    const gold = ctx.state.coins;
    // Pin the bar first: a grant catches regen up before it adds, so a baseline
    // read off an untouched context is already a few points stale.
    ctx.bus.emit('energy:set', { value: 10, reason: 'test' });
    const warmth = ctx.state.energyCurrent;

    ctx.bus.emit('iap:grant', { ...HOARD, purchaseId: 'purch_h1250', energy: 1250, unlimitedWarmthMs: 0 });

    expect(ctx.state.coins).toBe(gold + 13000);
    expect(ctx.state.energyCurrent).toBe(warmth + 1250);
    expect(ctx.state.energyCurrent).toBeGreaterThan(ctx.state.energyMax);
    // A gift or a Gold refill landing on a paid reserve must never lower it…
    ctx.bus.emit('energy:add', { amount: 5, reason: 'shop:gold_refill' });
    expect(ctx.state.energyCurrent).toBe(warmth + 1250);
    // …and the reserve is spent like any other Warmth.
    ctx.bus.emit('energy:spend', { amount: 3, reason: 'test' });
    expect(ctx.state.energyCurrent).toBe(warmth + 1247);
    expect(ctx.state.energyUnlimitedUntil).toBe(0);
  });

  it('the Hearth Hoard: Gold lands, the window opens, and the window lands BEFORE the Gold', () => {
    const ctx = createTestContext();
    const before = ctx.state.coins;
    const order: string[] = [];
    ctx.bus.on('energy:unlimited_changed', () => order.push('energy:unlimited_changed'));
    ctx.bus.on('economy:changed', () => order.push('economy:changed'));
    const wallBefore = ctx.clock.wallNow();

    ctx.bus.emit('iap:grant', HOARD);

    expect(ctx.state.coins).toBe(before + 13000);
    expect(ctx.state.energyUnlimitedUntil).toBeGreaterThanOrEqual(wallBefore + HOARD.unlimitedWarmthMs);
    expect(ctx.state.energyUnlimitedUntil).toBeLessThanOrEqual(ctx.clock.wallNow() + HOARD.unlimitedWarmthMs);
    // So the autosave `economy:changed` triggers already carries the new end.
    expect(order.indexOf('energy:unlimited_changed')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('energy:unlimited_changed')).toBeLessThan(order.indexOf('economy:changed'));
  });

  it('a replayed Hoard does not extend the window twice', () => {
    const ctx = createTestContext();
    ctx.bus.emit('iap:grant', HOARD);
    const until = ctx.state.energyUnlimitedUntil;

    ctx.bus.emit('iap:grant', HOARD);

    expect(ctx.state.energyUnlimitedUntil).toBe(until);
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
