import { describe, expect, it } from 'vitest';
import { DAY_CYCLE, DAY_PHASES, DRAGON_FEED_PHASE } from '../../src/core/Constants';
import {
  DAY_CYCLE_MS,
  msUntilPhase,
  phaseAt,
  phaseEndAt,
  phaseIndexAt,
  phaseProgress,
  phaseStartAt
} from '../../src/core/dayCycle';
import type { DayPhase } from '../../src/core/types';
import { capture, createTestContext } from './helpers';
import type { GameContext } from '../../src/core/Context';

/** Advance the virtual clock exactly as `window.advanceTime` does. */
function advance(ctx: GameContext, ms: number): void {
  ctx.clock.advance(ms);
  ctx.bus.emit('time:advanced', { ms });
}

/**
 * Put the run at the START of `phase`. The clock is `Date.now()`-based, so a
 * suite that only stepped INTO the phase (msUntilPhase is 0 once you are already
 * in it) would begin at whatever offset the wall-clock minute happens to give —
 * and every assertion about the time LEFT in a phase would pass or fail by the
 * hour it ran at. Already inside it, we ride one full cycle to its next start,
 * so every test below starts on a boundary.
 */
function goToPhase(ctx: GameContext, phase: DayPhase): void {
  const now = ctx.clock.now();
  const wait = msUntilPhase(now, phase);
  advance(ctx, wait > 0 ? wait : DAY_CYCLE_MS - (now - phaseStartAt(now)));
}

describe('the four-phase day', () => {
  it('is four 8-minute phases — a 32-minute round', () => {
    expect(DAY_PHASES).toEqual(['morning', 'day', 'dusk', 'night']);
    expect(DAY_CYCLE.phaseMs).toBe(480_000);
    expect(DAY_CYCLE_MS).toBe(32 * 60_000);
  });

  it('derives the phase from the clock alone — no state, and it wraps', () => {
    const p = DAY_CYCLE.phaseMs;
    expect(phaseAt(0)).toBe('morning');
    expect(phaseAt(p - 1)).toBe('morning');
    expect(phaseAt(p)).toBe('day');
    expect(phaseAt(2 * p)).toBe('dusk');
    expect(phaseAt(3 * p)).toBe('night');
    expect(phaseAt(4 * p)).toBe('morning'); // the ring closes
    expect(phaseIndexAt(7 * p)).toBe(3);
    expect(phaseProgress(p * 2.5)).toBeCloseTo(0.5);
    expect(phaseEndAt(p * 2.5)).toBe(3 * p);
  });

  it('msUntilPhase is 0 inside the phase and reaches the next start otherwise', () => {
    const p = DAY_CYCLE.phaseMs;
    expect(msUntilPhase(p * 3.5, 'night')).toBe(0); // already night
    expect(msUntilPhase(0, 'night')).toBe(3 * p);
    expect(msUntilPhase(p * 0.5, 'day')).toBe(p * 0.5);
    // Whatever the moment, advancing by msUntilPhase lands IN that phase.
    for (const phase of DAY_PHASES) {
      for (const now of [0, 1234, p * 1.1, p * 3.9, p * 12.7]) {
        expect(phaseAt(now + msUntilPhase(now, phase))).toBe(phase);
      }
    }
  });

  it('advanceTime steps cleanly through all four phases, in order, once each', () => {
    const ctx = createTestContext();
    const phases = capture(ctx.bus, 'day:phase');
    goToPhase(ctx, 'morning'); // start from a known hour, whatever the wall clock says
    phases.length = 0;

    for (let i = 0; i < 4; i++) advance(ctx, DAY_CYCLE.phaseMs);

    expect(phases.map((p) => p.phase)).toEqual(['day', 'dusk', 'night', 'morning']);
    expect(phases.map((p) => p.index)).toEqual([1, 2, 3, 0]);
    expect(ctx.systems.day.phase).toBe('morning'); // a full round is back where it began
    // Each announcement carries its own window.
    for (const p of phases) expect(p.endsAt - p.startedAt).toBe(DAY_CYCLE.phaseMs);
  });

  it('announces once per crossing, and only once per phase', () => {
    const ctx = createTestContext();
    goToPhase(ctx, 'morning');
    const phases = capture(ctx.bus, 'day:phase');
    advance(ctx, DAY_CYCLE.phaseMs / 2); // still morning
    expect(phases).toHaveLength(0);
    advance(ctx, DAY_CYCLE.phaseMs / 2); // crosses into day
    expect(phases.map((p) => p.phase)).toEqual(['day']);
    advance(ctx, 1);
    expect(phases).toHaveLength(1); // no re-announcement mid-phase
  });

  it('a jump that skips phases lands on the phase it ends in', () => {
    const ctx = createTestContext();
    goToPhase(ctx, 'morning');
    const phases = capture(ctx.bus, 'day:phase');
    advance(ctx, DAY_CYCLE.phaseMs * 2.5); // morning → (day, dusk) → dusk
    expect(phases.map((p) => p.phase)).toEqual(['dusk']);
    expect(ctx.systems.day.phase).toBe('dusk');
    // ~half a phase left (the clock is Date.now()-based, so real ms tick by mid-test).
    expect(ctx.systems.day.remainingMs).toBeGreaterThan(DAY_CYCLE.phaseMs / 2 - 5_000);
    expect(ctx.systems.day.remainingMs).toBeLessThanOrEqual(DAY_CYCLE.phaseMs / 2);
  });
});

describe('the Dew Basin (a night-only generator)', () => {
  it('produces at night and stays dry every other hour', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'dew_basin', tier: 1, col: 2, row: 2, kind: 'item' });
    const produced = capture(ctx.bus, 'item:produced');

    goToPhase(ctx, 'morning');
    advance(ctx, 0); // arm the passive timer
    advance(ctx, DAY_CYCLE.phaseMs - 60_000); // almost the whole morning — nothing
    expect(produced).toHaveLength(0);

    goToPhase(ctx, 'night');
    advance(ctx, 1);
    expect(produced).toHaveLength(1);
    expect(produced[0]!.output.chain).toBe('strawberry'); // dew waters a berry
  });

  it('holds an overdue timer through the day and pays it out at nightfall', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'dew_basin', tier: 1, col: 2, row: 2, kind: 'item' });
    const produced = capture(ctx.bus, 'item:produced');
    goToPhase(ctx, 'day');
    advance(ctx, 0); // arm
    advance(ctx, DAY_CYCLE.phaseMs); // the timer comes due mid-day, unpaid
    expect(produced).toHaveLength(0);
    goToPhase(ctx, 'night');
    advance(ctx, 0); // the wait was never re-armed — it pays the moment night opens
    expect(produced).toHaveLength(1);
  });

  it('leaves un-phased generators (the House, the sprout) alone', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'strawberry', tier: 3, col: 4, row: 4, kind: 'item' });
    const produced = capture(ctx.bus, 'item:produced');
    goToPhase(ctx, 'day');
    advance(ctx, 0); // arm
    advance(ctx, 600_001); // the sprout's passive cycle
    expect(produced).toHaveLength(1);
  });
});

describe('time-of-day food preferences', () => {
  const preferred = DRAGON_FEED_PHASE['emerald']!;

  it('the Emerald only takes her berry at dusk', () => {
    const ctx = createTestContext();
    ctx.state.berryStock = 1; // feeding spends from the larder, not off the board
    const fed = capture(ctx.bus, 'dragon:fed');
    const failed = capture(ctx.bus, 'dragon:feed_failed');

    goToPhase(ctx, 'morning');
    ctx.bus.emit('dragon:feed', { chain: 'emerald' });
    expect(fed).toHaveLength(0);
    expect(failed[0]!.reason).toBe('phase');
    expect(failed[0]!.requiresPhase).toBe(preferred);
    expect(ctx.state.berryStock).toBe(1); // a refused feed spends nothing

    goToPhase(ctx, preferred);
    ctx.bus.emit('dragon:feed', { chain: 'emerald' });
    expect(fed).toHaveLength(1);
    expect(ctx.state.berryStock).toBe(0);
  });

  it('the Red Dragon stays unrestricted — the quest feed never waits on the sky', () => {
    expect(DRAGON_FEED_PHASE['ember_dragon']).toBeUndefined();
    const ctx = createTestContext();
    const fed = capture(ctx.bus, 'dragon:fed');
    ctx.state.berryStock = DAY_PHASES.length;
    for (const phase of DAY_PHASES) {
      goToPhase(ctx, phase);
      ctx.bus.emit('dragon:feed', { chain: 'ember_dragon' });
    }
    expect(fed).toHaveLength(DAY_PHASES.length);
  });
});
