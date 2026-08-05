import { energyMaxForLevel, levelForXp, SAVE_KEY, SAVE_VERSION } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import type { SaveDataV1 } from '../core/types';
import { computeRegen } from './EnergySystem';

/** Last save that hydrated cleanly. `peek` falls back to it when the main slot is
 *  unreadable, so one bad read can no longer cost the player their game. */
const BACKUP_KEY = `${SAVE_KEY}_backup`;
/** A save we failed to hydrate, set aside instead of deleted — recoverable by hand. */
const BROKEN_KEY = `${SAVE_KEY}_broken`;

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
    'tutorial:step',
    // The Emberfont mutates AFTER SaveSystem's item:merged autosave (later
    // subscriber), so a surge ignited by a merge needs its own save trigger.
    'emberfont:surge',
    // Dragon-duel gauge/level changes (energy spend already saves the set start).
    'duel:match'
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

  /** True when SOMETHING is stored, readable or not — the difference between "new
   *  player" and "this player has progress we failed to read". */
  hasRawSave(): boolean {
    return this.storage.getItem(SAVE_KEY) !== null || this.storage.getItem(BACKUP_KEY) !== null;
  }

  /**
   * The MAIN slot only. There is deliberately no fallback to an older copy: silently
   * resurrecting a previous save is worse than starting fresh, because the player
   * cannot tell which game they are in. The backup is kept on disk for a human to
   * restore by hand, never loaded behind your back.
   */
  peek(): SaveDataV1 | null {
    return this.parse(this.storage.getItem(SAVE_KEY));
  }

  private parse(raw: string | null): SaveDataV1 | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<SaveDataV1> & { version?: unknown };
      const v = parsed.version;
      // Accept THIS version OR any EARLIER one — `hydrate` fills newer fields with
      // defaults, so a SAVE_VERSION bump no longer WIPES the player's progress (the
      // old bug: a mismatched version was discarded → full newGame reset). Only a
      // save from a NEWER/unknown build, or one missing the core fields, is refused.
      const ok =
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof v === 'number' &&
        v <= SAVE_VERSION &&
        Array.isArray(parsed.items) &&
        parsed.energy != null;
      return ok ? (parsed as SaveDataV1) : null;
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
    try {
      this.suspend(() => {
        this.state.hydrate(data);
      });
    } catch (e) {
      // A save we could not read is NOT a save to throw away. It used to be deleted
      // here, and Context.beginRun then wrote a brand-new game straight over it — one
      // bad read and weeks of play were gone with no way back. Now it is set aside
      // under a separate key: the boot can still start fresh, and the bytes survive.
      console.warn('[SaveSystem] could not hydrate save — kept a copy under', BROKEN_KEY, e);
      const raw = this.storage.getItem(SAVE_KEY);
      if (raw) this.storage.setItem(BROKEN_KEY, raw);
      return false;
    }
    // This exact save loaded cleanly — keep it as the last known good one. If the
    // main slot is ever unreadable, `peek` falls back to this instead of to nothing.
    const raw = this.storage.getItem(SAVE_KEY);
    if (raw) this.storage.setItem(BACKUP_KEY, raw);
    this.bus.emit('state:loaded', { offlineMs, energyRecovered: regen.recovered });
    this.save();
    return true;
  }

  clear(): void {
    this.storage.removeItem(SAVE_KEY);
    this.storage.removeItem(BACKUP_KEY);
  }
}
