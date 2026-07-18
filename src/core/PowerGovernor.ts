import Phaser from 'phaser';
import type { EventBus } from './EventBus';
import { POWER } from './Constants';

export type PowerState = 'active' | 'idle' | 'doze';

/** game.events channel BoardScene & co. subscribe to for state changes. */
export const POWER_STATE_EVENT = 'power:state';

/**
 * Keeps the render loop as quiet as the moment allows: full fps only while the
 * player is interacting, 30 fps after a short lull, 15 fps on a long one —
 * with ambient FX consumers (crystal, emitters) gating off the same state.
 * Battery is the whole point; gameplay is untouched because every timer in the
 * game reads the wall clock, not frame counts.
 *
 * Requires the game to BOOT with `fps: { limit: … }` (GameConfig does): Phaser
 * binds its limit-aware step once at start, after which the limit itself is a
 * mutable pair of instance fields we retune on state changes.
 */
export class PowerGovernor {
  state: PowerState = 'active';

  private readonly game: Phaser.Game;
  /** Timestamp until which the game counts as actively played. */
  private activeUntil: number;
  /** Rendered-steps counter for diagnostics (actualFps tracks rAF, not steps). */
  private stepCount = 0;
  private stepWindowStart = 0;
  private renderedFpsValue = 0;

  constructor(game: Phaser.Game, bus: EventBus) {
    this.game = game;
    this.activeUntil = performance.now() + POWER.eventHoldMs;

    const onInput = (): void => this.notifyActivity(POWER.idleAfterMs);
    for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'] as const) {
      window.addEventListener(type, onInput, { passive: true, capture: true });
    }

    // Scripted beats keep full fps even between touches (a tutorial line, an
    // unlock sweep). Player actions need no bus wiring — the pointer that
    // caused them is already a wake source. Autonomous ticks (passive dragon
    // production, energy regen) are deliberately NOT here: the game must not
    // keep itself awake, or an untouched board never throttles.
    bus.on('item:merged', () => this.notifyActivity(POWER.eventHoldMs));
    bus.on('item:hatched', () => this.notifyActivity(POWER.eventHoldMs));
    bus.on('tutorial:step', () => this.notifyActivity(POWER.eventHoldMs));
    bus.on('order:completed', () => this.notifyActivity(POWER.eventHoldMs));
    bus.on('region:unlocked', () => this.notifyActivity(POWER.eventHoldMs));
    // The finale/level-up choreography plays unattended — hold full fps for it.
    bus.on('keeper:leveled', () => this.notifyActivity(POWER.finaleHoldMs));

    game.events.on(Phaser.Core.Events.STEP, this.onStep, this);
    this.applyFps(POWER.activeFps);
  }

  /** Mark the game as actively played for at least `holdMs` from now. */
  notifyActivity(holdMs: number): void {
    this.activeUntil = Math.max(this.activeUntil, performance.now() + holdMs);
  }

  /** Crystal3D re-render interval for the current state; Infinity = paused. */
  crystalIntervalMs(): number {
    if (this.state === 'active') return POWER.crystalMs.active;
    if (this.state === 'idle') return POWER.crystalMs.idle;
    return Infinity;
  }

  /** Steps actually rendered per second (diagnostics/e2e). */
  renderedFps(): number {
    return this.renderedFpsValue;
  }

  private onStep(): void {
    const now = performance.now();

    this.stepCount++;
    if (now - this.stepWindowStart >= 1000) {
      this.renderedFpsValue = (this.stepCount * 1000) / (now - this.stepWindowStart);
      this.stepCount = 0;
      this.stepWindowStart = now;
    }

    const sinceActive = now - this.activeUntil;
    const next: PowerState =
      sinceActive < 0 ? 'active' : sinceActive < POWER.dozeAfterMs - POWER.idleAfterMs ? 'idle' : 'doze';
    if (next === this.state) return;
    this.state = next;
    this.applyFps(next === 'active' ? POWER.activeFps : next === 'idle' ? POWER.idleFps : POWER.dozeFps);
    this.game.events.emit(POWER_STATE_EVENT, next);
  }

  private applyFps(fps: number): void {
    const loop = this.game.loop as Phaser.Core.TimeStep & { _limitRate: number };
    loop.fpsLimit = fps;
    // _limitRate is the cadence stepLimitFPS gates on; it's derived from
    // fpsLimit only at construction, so retune it alongside.
    loop._limitRate = 1000 / fps;
  }
}
