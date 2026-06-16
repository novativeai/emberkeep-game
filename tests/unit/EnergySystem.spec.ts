import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ENERGY_MAX,
  ENERGY_REGEN_MS
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
