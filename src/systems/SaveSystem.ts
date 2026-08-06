import { energyMaxForLevel, levelForXp, SAVE_KEY, SAVE_VERSION } from '../core/Constants';
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
  /**
   * Mutation notifications that trigger an autosave.
   *
   * THE RULE: if it changes anything `toSave` writes, it belongs here. There is
   * no periodic autosave and no save on close beyond the one main.ts installs,
   * so an event missing from this list is state the player can lose by walking
   * away — they come back to a board that is not the one they left.
   *
   * That is exactly what happened. The list had kept pace with merging and
   * spending but not with generators or dragons: passive production changed the
   * board every cycle and wrote nothing, so the timers in the save were stale
   * too and the offline catch-up re-paid gifts already collected. A name and a
   * House's commission — both given once and never again — could vanish
   * outright. Everything that mutates is now on it.
   */
  private static readonly SAVE_ON = [
    'item:spawned',
    'item:moved',
    'item:merged',
    'item:harvested',
    'item:removed',
    // Passive yield: the item AND the generator's next `passiveAt`. Without it
    // the board drifted forward all session and the save stayed behind.
    'item:produced',
    // Write-once, and the House cost real play to earn: what it is dedicated to.
    'generator:produce_set',
    'energy:changed',
    'economy:changed',
    'bag:changed',
    'order:completed',
    'region:unlocked',
    'story:chapter',
    'nest:warmed',
    'companion:named',
    'companion:fed',
    // Board dragons: her name, her belly and her trust all live on the item.
    'dragon:named',
    'dragon:fed',
    'dragon:trust_changed',
    // Regard and the quest ladder's latches both live in state the save carries.
    'regard:changed',
    'quest:completed',
    // Which board the Keeper is standing on (`activeWorld`).
    'world:switched',
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
    const max = energyMaxForLevel(levelForXp(data.xp ?? 0));
    const regen = computeRegen(data.energy.current, data.energy.lastRegenAt, now, max);
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
