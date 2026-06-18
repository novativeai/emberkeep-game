import {
  ENERGY_MAX,
  ENERGY_REGEN_AMOUNT,
  ENERGY_REGEN_MS
} from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';

export interface RegenResult {
  current: number;
  lastRegenAt: number;
  recovered: number;
}

/**
 * Pure regen math shared by the live tick and the offline catch-up on load.
 * Regen is anchored to `lastRegenAt`; while at max the anchor follows `now`
 * so no regen is banked.
 */
export function computeRegen(
  current: number,
  lastRegenAt: number,
  now: number,
  max: number = ENERGY_MAX
): RegenResult {
  let cur = Math.min(current, max);
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
  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock
  ) {
    bus.on('energy:spend', ({ amount }) => this.spend(amount));
    bus.on('energy:add', ({ amount }) => this.gain(amount));
    bus.on('energy:refill', () => this.refill());
    bus.on('time:advanced', () => this.catchUp());
    bus.on('state:loaded', () => this.catchUp());
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
  }

  canAfford(amount: number): boolean {
    this.catchUp();
    return this.state.energyCurrent >= amount;
  }

  /** Add Warmth (a reward gift, e.g. the house), capped at the max. */
  private gain(amount: number): void {
    this.catchUp();
    const max = this.state.energyMax;
    if (amount <= 0 || this.state.energyCurrent >= max) return;
    this.state.energyCurrent = Math.min(max, this.state.energyCurrent + amount);
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
