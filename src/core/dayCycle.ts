import { DAY_CYCLE, DAY_PHASES } from './Constants';
import type { DayPhase } from './types';

/**
 * Pure math for the four-phase day (morning · day · dusk · night, 8 min each).
 * Every function takes an absolute time — callers pass `GameClock.now()`, never
 * `Date.now()`, so `window.advanceTime(ms)` steps the whole cycle deterministically.
 *
 * The ring is anchored to absolute world time (not to the session): the phase is
 * simply `floor(now / phaseMs) % 4`. No state, nothing to persist, nothing to
 * drift — a reload or an offline gap lands on exactly the hour the world is at.
 */

const CYCLE_MS = DAY_CYCLE.phaseMs * DAY_PHASES.length;

/** 0..3 — the position in the ring at `now`. */
export function phaseIndexAt(now: number): number {
  const i = Math.floor(now / DAY_CYCLE.phaseMs) % DAY_PHASES.length;
  return i < 0 ? i + DAY_PHASES.length : i; // negative clocks still land in the ring
}

export function phaseAt(now: number): DayPhase {
  return DAY_PHASES[phaseIndexAt(now)]!;
}

/** Absolute time the phase holding `now` began. */
export function phaseStartAt(now: number): number {
  return Math.floor(now / DAY_CYCLE.phaseMs) * DAY_CYCLE.phaseMs;
}

/** Absolute time the phase holding `now` ends (= the next phase's start). */
export function phaseEndAt(now: number): number {
  return phaseStartAt(now) + DAY_CYCLE.phaseMs;
}

/** 0..1 through the current phase — for a countdown or a dial. */
export function phaseProgress(now: number): number {
  return (now - phaseStartAt(now)) / DAY_CYCLE.phaseMs;
}

/**
 * Ms to advance to be IN `phase`: 0 when it is already that phase, otherwise the
 * wait until that phase next begins. Tests and the QA hook advance by exactly
 * this, which is why the whole cycle stays reproducible without faking Date.
 */
export function msUntilPhase(now: number, phase: DayPhase): number {
  const want = DAY_PHASES.indexOf(phase);
  if (want < 0) return 0;
  const steps = (want - phaseIndexAt(now) + DAY_PHASES.length) % DAY_PHASES.length;
  return steps === 0 ? 0 : steps * DAY_CYCLE.phaseMs - (now - phaseStartAt(now));
}

/** True when `phases` is unset (always on) or contains the phase at `now`. */
export function phaseAllows(phases: readonly DayPhase[] | undefined, now: number): boolean {
  return !phases?.length || phases.includes(phaseAt(now));
}

export { CYCLE_MS as DAY_CYCLE_MS };
