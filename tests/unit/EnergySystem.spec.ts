import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ENERGY_MAX,
  ENERGY_REGEN_MS,
  MS_PER_DAY
} from '../../src/core/Constants';
import { computeRegen } from '../../src/systems/EnergySystem';
import { capture, createTestContext } from './helpers';

describe('computeRegen (pure math)', () => {
  it('regenerates 1 energy per interval', () => {
    const result = computeRegen(10, 0, ENERGY_REGEN_MS * 3);
    expect(result.current).toBe(13);
    expect(result.lastRegenAt).toBe(ENERGY_REGEN_MS * 3);
  });

  it('keeps partial progress toward the next point', () => {
    const result = computeRegen(10, 0, ENERGY_REGEN_MS * 2.5);
    expect(result.current).toBe(12);
    expect(result.lastRegenAt).toBe(ENERGY_REGEN_MS * 2);
  });

  it('caps at max and anchors to now when full', () => {
    const result = computeRegen(ENERGY_MAX - 1, 0, ENERGY_REGEN_MS * 500);
    expect(result.current).toBe(ENERGY_MAX);
    expect(result.recovered).toBe(1);
    expect(result.lastRegenAt).toBe(ENERGY_REGEN_MS * 500);
  });

  it('handles huge offline gaps without banking beyond max', () => {
    const week = 7 * 24 * 60 * 60 * 1000;
    const result = computeRegen(0, 0, week);
    expect(result.current).toBe(ENERGY_MAX);
    expect(result.recovered).toBe(ENERGY_MAX);
  });

  it('never regens when the clock runs backwards', () => {
    const result = computeRegen(5, 100_000, 50_000);
    expect(result.current).toBe(5);
    expect(result.recovered).toBe(0);
  });

  it('never cuts Warmth bought above the bar, and banks no regen over it', () => {
    // The €100 Hearth Hoard carries 1,250 Warmth. This used to clamp every
    // catch-up to the max, so the paid reserve melted on the next frame.
    const result = computeRegen(ENERGY_MAX + 1250, 0, ENERGY_REGEN_MS * 10);
    expect(result.current).toBe(ENERGY_MAX + 1250);
    expect(result.recovered).toBe(0);
    expect(result.lastRegenAt).toBe(ENERGY_REGEN_MS * 10);
  });
});

describe('EnergySystem (via bus + virtual clock)', () => {
  // Freeze Date.now so the virtual clock is the only thing moving.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('spending reduces energy and re-anchors regen when leaving full', () => {
    const ctx = createTestContext();
    const changes = capture(ctx.bus, 'energy:changed');

    ctx.bus.emit('energy:spend', { amount: 3, reason: 'test' });
    expect(ctx.state.energyCurrent).toBe(ENERGY_MAX - 3);
    expect(changes.at(-1)?.current).toBe(ENERGY_MAX - 3);

    // One tick short of the interval: nothing yet.
    ctx.clock.advance(ENERGY_REGEN_MS - 1);
    ctx.bus.emit('time:advanced', { ms: ENERGY_REGEN_MS - 1 });
    expect(ctx.state.energyCurrent).toBe(ENERGY_MAX - 3);

    // Crossing the interval regenerates exactly one.
    ctx.clock.advance(1);
    ctx.bus.emit('time:advanced', { ms: 1 });
    expect(ctx.state.energyCurrent).toBe(ENERGY_MAX - 2);
  });

  it('ignores spends it cannot afford', () => {
    const ctx = createTestContext();
    ctx.state.energyCurrent = 0;
    ctx.state.energyLastRegenAt = ctx.clock.now(); // just drained, no banked regen
    ctx.bus.emit('energy:spend', { amount: 1, reason: 'test' });
    expect(ctx.state.energyCurrent).toBe(0);
  });

  it('does not bank regen while sitting at max', () => {
    const ctx = createTestContext();
    ctx.clock.advance(ENERGY_REGEN_MS * 10);
    ctx.bus.emit('time:advanced', { ms: ENERGY_REGEN_MS * 10 });
    expect(ctx.state.energyCurrent).toBe(ENERGY_MAX);

    // Spend right after a long idle: the next point must take a full interval.
    ctx.bus.emit('energy:spend', { amount: 1, reason: 'test' });
    ctx.clock.advance(ENERGY_REGEN_MS - 1);
    ctx.bus.emit('time:advanced', { ms: ENERGY_REGEN_MS - 1 });
    expect(ctx.state.energyCurrent).toBe(ENERGY_MAX - 1);
    ctx.clock.advance(1);
    ctx.bus.emit('time:advanced', { ms: 1 });
    expect(ctx.state.energyCurrent).toBe(ENERGY_MAX);
  });
});

/**
 * UNLIMITED WARMTH — purchased calendar time. EnergySystem owns the window
 * (`energy:unlimited_add`) and announces when it lands, loads and ends. Time is
 * REAL (`clock.wallNow()`), so these freeze the wall and move it only through
 * `advance`, exactly as `window.advanceTime` does.
 */
describe('EnergySystem — Unlimited Warmth', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const FIVE_DAYS = 5 * MS_PER_DAY;

  it('a grant from nothing runs from now', () => {
    const ctx = createTestContext();
    const changed = capture(ctx.bus, 'energy:unlimited_changed');
    const wall = ctx.clock.wallNow();

    ctx.bus.emit('energy:unlimited_add', { ms: FIVE_DAYS, reason: 'test' });

    expect(ctx.state.energyUnlimitedUntil).toBe(wall + FIVE_DAYS);
    expect(changed).toEqual([{ until: wall + FIVE_DAYS, active: true, cause: 'granted' }]);
  });

  it('ignores a non-positive grant', () => {
    const ctx = createTestContext();
    const changed = capture(ctx.bus, 'energy:unlimited_changed');
    ctx.bus.emit('energy:unlimited_add', { ms: 0, reason: 'test' });
    expect(ctx.state.energyUnlimitedUntil).toBe(0);
    expect(changed).toHaveLength(0);
  });

  it('stacking while active extends from the running end', () => {
    const ctx = createTestContext();
    const wall = ctx.clock.wallNow();
    ctx.bus.emit('energy:unlimited_add', { ms: FIVE_DAYS, reason: 'test' });
    ctx.clock.advance(MS_PER_DAY);
    ctx.bus.emit('energy:unlimited_add', { ms: FIVE_DAYS, reason: 'test' });
    expect(ctx.state.energyUnlimitedUntil).toBe(wall + 2 * FIVE_DAYS);
  });

  it('stacking after expiry extends from now', () => {
    const ctx = createTestContext();
    ctx.bus.emit('energy:unlimited_add', { ms: FIVE_DAYS, reason: 'test' });
    ctx.clock.advance(6 * MS_PER_DAY);
    const wall = ctx.clock.wallNow();
    ctx.bus.emit('energy:unlimited_add', { ms: FIVE_DAYS, reason: 'test' });
    expect(ctx.state.energyUnlimitedUntil).toBe(wall + FIVE_DAYS);
  });

  it('announces the end exactly once when time runs past it', () => {
    const ctx = createTestContext();
    ctx.state.energyCurrent = ctx.state.energyMax; // full, so regen cannot confound the check
    ctx.state.energyLastRegenAt = ctx.clock.now();
    ctx.bus.emit('energy:unlimited_add', { ms: FIVE_DAYS, reason: 'test' });
    const changed = capture(ctx.bus, 'energy:unlimited_changed');
    const energy = capture(ctx.bus, 'energy:changed');

    ctx.clock.advance(FIVE_DAYS);
    ctx.bus.emit('time:advanced', { ms: FIVE_DAYS });
    ctx.bus.emit('time:advanced', { ms: 0 });
    ctx.clock.advance(1_000);
    ctx.bus.emit('time:advanced', { ms: 1_000 });

    expect(changed).toEqual([
      { until: ctx.state.energyUnlimitedUntil, active: false, cause: 'expired' }
    ]);
    expect(energy).toHaveLength(0); // the bar was full; the end is not a Warmth change
  });

  it('state:loaded announces the loaded window', () => {
    const ctx = createTestContext();
    ctx.state.energyUnlimitedUntil = ctx.clock.wallNow() + MS_PER_DAY;
    const changed = capture(ctx.bus, 'energy:unlimited_changed');

    ctx.bus.emit('state:loaded', { offlineMs: 0, energyRecovered: 0 });

    expect(changed).toEqual([{ until: ctx.state.energyUnlimitedUntil, active: true, cause: 'loaded' }]);
  });

  it('game:reset emits nothing — New Game keeps paid time', () => {
    const ctx = createTestContext();
    ctx.bus.emit('energy:unlimited_add', { ms: FIVE_DAYS, reason: 'test' });
    const changed = capture(ctx.bus, 'energy:unlimited_changed');

    ctx.bus.emit('game:reset', {});

    expect(changed).toHaveLength(0);
  });
});
