import { DAY_PHASES } from '../core/Constants';
import { phaseAt, phaseEndAt, phaseIndexAt, phaseStartAt } from '../core/dayCycle';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { DayPhase } from '../core/types';

/**
 * The four-phase day (morning · day · dusk · night, 8 min each — DAY_CYCLE).
 * Owns nothing but the LAST ANNOUNCED phase: the phase itself is a pure function
 * of `GameClock.now()`, so there is no state to save, no drift, and
 * `window.advanceTime(ms)` walks the ring exactly.
 *
 * It rides the existing heartbeat (`time:advanced`, emitted every 500 ms by
 * BoardScene and by the agent hook) and announces `day:phase` on every crossing —
 * one event per phase even when a single jump skips several. Consumers:
 * BoardScene grades the sky, GeneratorSystem gates the Dew Basin, DragonFeedSystem
 * gates time-of-day food preferences.
 * Phaser-free — bus + virtual clock only, so it unit-tests in node.
 */
export class DayCycleSystem {
  private announced: DayPhase;

  constructor(
    private bus: EventBus,
    private clock: GameClock
  ) {
    this.announced = phaseAt(clock.now());
    bus.on('time:advanced', () => this.catchUp());
    bus.on('state:loaded', () => this.catchUp());
    // Scenes subscribe after construction — hand them the opening hour.
    bus.on('game:started', () => this.announce());
  }

  /** The phase right now (scenes read this when they build). */
  get phase(): DayPhase {
    return phaseAt(this.clock.now());
  }

  get index(): number {
    return phaseIndexAt(this.clock.now());
  }

  /** Ms left in the current phase. */
  get remainingMs(): number {
    return phaseEndAt(this.clock.now()) - this.clock.now();
  }

  is(phase: DayPhase): boolean {
    return this.phase === phase;
  }

  /** Re-emit the current phase without a crossing (fresh scene, load, reset). */
  announce(): void {
    this.announced = this.phase;
    this.emit(this.announced);
  }

  private catchUp(): void {
    const phase = this.phase;
    if (phase === this.announced) return;
    this.announced = phase;
    this.emit(phase);
  }

  private emit(phase: DayPhase): void {
    const now = this.clock.now();
    this.bus.emit('day:phase', {
      phase,
      index: DAY_PHASES.indexOf(phase),
      startedAt: phaseStartAt(now),
      endsAt: phaseEndAt(now)
    });
  }
}
