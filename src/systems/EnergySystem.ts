import {
  ENERGY_MAX,
  ENERGY_REGEN_AMOUNT,
  ENERGY_REGEN_MS
} from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import { unlimitedWarmthActive } from '../core/warmth';

export interface RegenResult {
  current: number;
  lastRegenAt: number;
  recovered: number;
}

/**
 * Pure regen math shared by the live tick and the offline catch-up on load.
 * Regen is anchored to `lastRegenAt`; while at max the anchor follows `now`
 * so no regen is banked.
 *
 * WARMTH ABOVE THE BAR IS NEVER CUT. It only gets there by purchase (the €100
 * Hearth Hoard carries 1,250), and this used to clamp every catch-up to the max
 * — a paid reserve would have melted to 33 on the next frame. Regen simply does
 * not run while the bar is at or over its max.
 */
export function computeRegen(
  current: number,
  lastRegenAt: number,
  now: number,
  max: number = ENERGY_MAX
): RegenResult {
  let cur = current;
  let anchor = lastRegenAt;
  let recovered = 0;
  if (anchor > now) anchor = now; // clock went backwards; never regen negatively
  while (cur < max && now - anchor >= ENERGY_REGEN_MS) {
    cur = Math.min(max, cur + ENERGY_REGEN_AMOUNT);
    anchor += ENERGY_REGEN_MS;
    recovered += ENERGY_REGEN_AMOUNT;
  }
  if (cur >= max) anchor = now;
  return { current: cur, lastRegenAt: anchor, recovered };
}

export class EnergySystem {
  /** Was Unlimited Warmth running at the last look — so its END is announced
   *  exactly once, on the first catch-up past `until`. */
  private wasActive = false;

  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock
  ) {
    bus.on('energy:spend', ({ amount }) => this.spend(amount));
    bus.on('energy:add', ({ amount, overflow }) => this.gain(amount, overflow === true));
    bus.on('energy:set', ({ value }) => this.setTo(value));
    bus.on('energy:refill', () => this.refill());
    bus.on('energy:unlimited_add', ({ ms }) => this.addUnlimited(ms));
    bus.on('time:advanced', () => this.catchUp());
    bus.on('state:loaded', () => this.catchUp());
    bus.on('state:loaded', () => {
      const until = this.state.energyUnlimitedUntil;
      const active = unlimitedWarmthActive(until, this.clock.wallNow());
      this.wasActive = active;
      this.bus.emit('energy:unlimited_changed', { until, active, cause: 'loaded' });
    });
    // No emit: New Game keeps paid time, and the HUD reads state every tick.
    bus.on('game:reset', () => {
      this.wasActive = unlimitedWarmthActive(this.state.energyUnlimitedUntil, this.clock.wallNow());
    });
  }

  /** Called every frame by BoardScene and after time jumps. */
  catchUp(): void {
    const max = this.state.energyMax;
    const result = computeRegen(this.state.energyCurrent, this.state.energyLastRegenAt, this.clock.now(), max);
    const changed = result.current !== this.state.energyCurrent;
    this.state.energyCurrent = result.current;
    this.state.energyLastRegenAt = result.lastRegenAt;
    if (changed) {
      this.bus.emit('energy:changed', { current: this.state.energyCurrent, max });
    }
    const until = this.state.energyUnlimitedUntil;
    if (this.wasActive && !unlimitedWarmthActive(until, this.clock.wallNow())) {
      this.wasActive = false;
      this.bus.emit('energy:unlimited_changed', { until, active: false, cause: 'expired' });
    }
  }

  /** Purchased calendar time. Stacks from the later of the running end and
   *  NOW, so a second pack bought mid-window adds its full length. */
  private addUnlimited(ms: number): void {
    if (!(ms > 0)) return;
    this.state.energyUnlimitedUntil = Math.max(this.state.energyUnlimitedUntil, this.clock.wallNow()) + ms;
    this.wasActive = true;
    this.bus.emit('energy:unlimited_changed', {
      until: this.state.energyUnlimitedUntil,
      active: true,
      cause: 'granted'
    });
  }

  canAfford(amount: number): boolean {
    this.catchUp();
    return this.state.energyCurrent >= amount;
  }

  /**
   * Add Warmth. A gift or a Gold refill fills the bar up to its max and stops
   * there; PURCHASED Warmth (`overflow`) is kept whole above it.
   *
   * And nothing here ever LOWERS the bar: a +5 refill landing on a bought
   * reserve of 1,283 leaves 1,283. The old `Math.min(max, …)` would have taken
   * it straight back to 33 — the refill costing the player 1,250 Warmth.
   */
  private gain(amount: number, overflow = false): void {
    this.catchUp();
    const max = this.state.energyMax;
    if (amount <= 0) return;
    const cur = this.state.energyCurrent;
    const next = overflow ? cur + amount : Math.max(cur, Math.min(max, cur + amount));
    if (next === cur) return;
    this.state.energyCurrent = next;
    this.bus.emit('energy:changed', { current: next, max });
  }

  /** Set Warmth to an exact value, clamped to [0, max] (the tutorial scripts the
   *  gauge to 18/20 before the "claim your free Warmth" step). Pins the regen
   *  clock so the next +1 counts from now. */
  private setTo(value: number): void {
    const max = this.state.energyMax;
    const next = Math.max(0, Math.min(max, value));
    if (next === this.state.energyCurrent) return;
    this.state.energyCurrent = next;
    this.state.energyLastRegenAt = this.clock.now();
    this.bus.emit('energy:changed', { current: this.state.energyCurrent, max });
  }

  /** Top Warmth back to full (the level-up reward beat — to the new, higher max). */
  private refill(): void {
    const max = this.state.energyMax;
    if (this.state.energyCurrent >= max) return;
    this.state.energyCurrent = max;
    this.state.energyLastRegenAt = this.clock.now();
    this.bus.emit('energy:changed', { current: this.state.energyCurrent, max });
  }

  private spend(amount: number): void {
    this.catchUp();
    const max = this.state.energyMax;
    if (this.state.energyCurrent < amount) return;
    const wasFull = this.state.energyCurrent >= max;
    this.state.energyCurrent -= amount;
    if (wasFull) this.state.energyLastRegenAt = this.clock.now();
    this.bus.emit('energy:changed', { current: this.state.energyCurrent, max });
  }
}
