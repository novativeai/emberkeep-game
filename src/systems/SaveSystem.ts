import { SAVE_KEY, SAVE_VERSION } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import type { SaveDataV1 } from '../core/types';
import { computeRegen } from './EnergySystem';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Versioned localStorage persistence. Autosaves on every state-changing
 * notification; on load, offline energy regen is applied via the shared
 * computeRegen math (EnergySystem also reacts to 'state:loaded').
 */
export class SaveSystem {
  /** Mutation notifications that trigger an autosave. */
  private static readonly SAVE_ON = [
    'item:spawned',
    'item:moved',
    'item:merged',
    'item:harvested',
    'item:removed',
    'energy:changed',
    'economy:changed',
    'order:completed',
    'region:unlocked',
    'tutorial:step'
  ] as const;

  private suspended = false;

  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    private storage: StorageLike
  ) {
    for (const event of SaveSystem.SAVE_ON) {
      bus.on(event, () => this.save());
    }
  }

  /** Suspend autosave during bulk hydration. */
  suspend(fn: () => void): void {
    this.suspended = true;
    try {
      fn();
    } finally {
      this.suspended = false;
    }
  }

  save(): void {
    if (this.suspended) return;
    const data = this.state.toSave(this.clock.now(), SAVE_VERSION);
    this.storage.setItem(SAVE_KEY, JSON.stringify(data));
    this.bus.emit('state:saved', { at: data.savedAt });
  }

  hasSave(): boolean {
    return this.peek() !== null;
  }

  peek(): SaveDataV1 | null {
    const raw = this.storage.getItem(SAVE_KEY);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        (parsed as { version?: unknown }).version === SAVE_VERSION
      ) {
        return parsed as SaveDataV1;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** @returns true when a valid save was hydrated. */
  load(): boolean {
    const data = this.peek();
    if (!data) return false;
    const now = this.clock.now();
    const offlineMs = Math.max(0, now - data.savedAt);
    const regen = computeRegen(data.energy.current, data.energy.lastRegenAt, now);
    this.suspend(() => {
      this.state.hydrate(data);
    });
    this.bus.emit('state:loaded', { offlineMs, energyRecovered: regen.recovered });
    this.save();
    return true;
  }

  clear(): void {
    this.storage.removeItem(SAVE_KEY);
  }
}
