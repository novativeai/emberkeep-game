import {
  DRAGON_HUNGER_GRACE_MS,
  DRAGON_NAP_CYCLE_MS,
  DRAGON_NAP_LENGTH_MS,
  DRAGON_WANDER_EVERY_MS,
  DRAGON_WANDER_MAX_DIST,
  DRAGON_WANDER_MIN_DIST,
  DRAGON_WANDER_SPREAD_MS,
  HUNGRY_UNFED_EPS,
  phaseAt
} from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import type { BoardItemState, TilePos } from '../core/types';
import type { DragonJobSystem } from './DragonJobSystem';
import type { DragonSystem } from './DragonSystem';

/** What a dragon is doing when nobody is asking it for anything. */
export type DragonMood = 'awake' | 'hungry' | 'asleep';

/**
 * AMBIENT LIFE — the board dragons behaving like animals rather than furniture.
 *
 * Three things, and they are the whole of it: a dragon wanders the isle, it
 * sleeps at night, and it roars when it has not been fed. Everything else about
 * a dragon (what it produces, what it works, what it eats) belongs to the
 * systems that already own those, and this one never touches them.
 *
 * **Nothing here keeps a counter.** Hunger is `DragonSystem.careOf` — the same
 * record feeding writes and the status gauge draws — and sleep is the shipped
 * day clock's `night` phase (`phaseAt`). A second hunger clock would drift from
 * the gauge the player is looking at, and a private sleep timer would put one
 * dragon to bed while the sky said noon.
 *
 * **Ambience never costs the player anything.** Sleep does not pause
 * production, a roar is a mood and not a penalty, and a wander can never take a
 * piece the player was about to merge (see `mayWander`). If this system were
 * deleted the game would play identically — it would just feel dead.
 *
 * **Deterministic.** Every schedule is derived from the item id and the virtual
 * clock, never from `Math.random()`, so `window.advanceTime(ms)` reproduces the
 * same board. A randomly-timed piece MOVING is exactly the thing that would
 * make the e2e suite flaky.
 *
 * Phaser-free: it decides, emits, and lets BoardScene do the flying.
 */
export class DragonLifeSystem {
  /** Clock time each dragon may next wander. Rebuilt from the id on first
   *  sight, so it survives nothing and needs to survive nothing. */
  private nextWanderAt = new Map<number, number>();
  /** Clock time each dragon was first seen this session — the hunger grace. */
  private firstSeenAt = new Map<number, number>();
  /** Last mood announced per dragon, so `dragon:mood` fires on CHANGE only. */
  private lastMood = new Map<number, DragonMood>();
  /** Clock time until which a dragon is held AWAKE whatever the sky, the nap
   *  schedule or its fatigue say — the player shook it awake, or a cinematic
   *  needs it on its feet. Transient like every other schedule here: it lasts
   *  as long as the reason does and nothing persists it. */
  private awakeUntil = new Map<number, number>();

  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    private dragons: DragonSystem,
    private jobs: DragonJobSystem
  ) {
    bus.on('time:advanced', () => this.tick());
    bus.on('item:removed', ({ itemId }) => this.forget(itemId));
    bus.on('game:reset', () => {
      this.nextWanderAt.clear();
      this.firstSeenAt.clear();
      this.lastMood.clear();
      this.awakeUntil.clear();
    });
  }

  private forget(itemId: number): void {
    this.nextWanderAt.delete(itemId);
    this.firstSeenAt.delete(itemId);
    this.lastMood.delete(itemId);
    this.awakeUntil.delete(itemId);
  }

  /**
   * WHY this dragon is asleep — the two sleeps are not the same promise.
   *
   *   • `rest`  — it worked a shift and is sleeping it off (DragonJobSystem).
   *               Earned, timed, and NOT the player's to cancel: shaking it
   *               awake would hand back the cost of working it.
   *   • `night` — the sky. Also not cancellable; morning is what ends it.
   *   • `nap`   — it simply felt like it. This one IS the player's: a tap
   *               wakes it, because a nap the player cannot interrupt is an
   *               animal that ignores them.
   *
   * Null when awake (or hungry — a hungry dragon does not sleep through it).
   */
  sleepKindOf(itemId: number): 'rest' | 'night' | 'nap' | null {
    if (this.moodOf(itemId) !== 'asleep') return null;
    if (this.jobs.restRemaining(itemId) > 0) return 'rest';
    if (phaseAt(this.clock.now()) === 'night') return 'night';
    return 'nap';
  }

  /**
   * Hold this dragon awake for `ms`, whatever the sky or the nap schedule says.
   *
   * Two callers: the player shaking a napper awake, and a cinematic that needs
   * the animal on its feet before it starts (a sleeper flown at a portal
   * arrives as a curled painting and sticks there).
   *
   * A WINDOW rather than a flag, because both sleeps it overrides are windows
   * themselves: clearing a boolean would let the very next tick re-derive the
   * same nap and put it straight back down.
   */
  keepAwake(itemId: number, ms: number): void {
    const until = this.clock.now() + ms;
    if ((this.awakeUntil.get(itemId) ?? 0) >= until) return;
    this.awakeUntil.set(itemId, until);
    // Announce immediately rather than waiting for the next tick: the wake is
    // an answer to a tap, and an animal that uncurls a beat later reads as a
    // dropped input. `announceMood` is the same one-writer path the tick uses,
    // so the change is never reported twice.
    this.announceMood(itemId);
  }

  /** Emit `dragon:mood` if this dragon's derived mood has changed since the
   *  last announcement. The ONLY writer of `lastMood`. */
  private announceMood(itemId: number): void {
    const mood = this.moodOf(itemId);
    const from = this.lastMood.get(itemId) ?? 'awake';
    if (from === mood) return;
    this.lastMood.set(itemId, mood);
    this.bus.emit('dragon:mood', { itemId, mood, from });
  }

  /** Is this dragon inside a `keepAwake` window? */
  private heldAwake(itemId: number): boolean {
    const until = this.awakeUntil.get(itemId);
    if (until === undefined) return false;
    if (this.clock.now() < until) return true;
    this.awakeUntil.delete(itemId);
    return false;
  }

  /**
   * What this dragon is doing, derived fresh every time it is asked.
   *
   * THREE ways to be asleep, and they are all the same sleep — the same curled
   * painting, the same breath. That is the point: a dragon sleeping off a shift
   * at the House and a dragon napping in the afternoon should not look like two
   * different features.
   *
   *   • it is sleeping off a work shift (`DragonJobSystem`'s rest);
   *   • it is night;
   *   • it simply felt like it (`isNapping`).
   *
   * Order matters twice over. A dragon out WORKING is awake whatever the sky
   * says — it is on a job. And a HUNGRY dragon does not sleep through it, which
   * is the one interaction between the two states and the one that reads right:
   * the isle goes quiet at night except for the animal nobody fed.
   */
  moodOf(itemId: number): DragonMood {
    const item = this.state.items.get(itemId);
    if (!item || !this.dragons.isBoardDragon(item)) return 'awake';
    if (this.isHungry(itemId)) return 'hungry';
    // The TUTORIAL never sleeps. Its beats point the hand at the dragon and
    // gate on her answering — a lesson whose subject curls up under the arrow
    // (scripted advanceTime jumps land in night/nap windows at random) is a
    // lesson that soft-locks. Hunger stays: the feeding beat depends on it.
    if (!this.state.tutorialDone) return 'awake';
    // Shaken awake, or wanted on its feet by a cinematic — outranks all three
    // sleeps for the length of the window (see keepAwake).
    if (this.heldAwake(itemId)) return 'awake';
    // Fatigue outranks the sky: a dragon that just came off a shift sleeps at
    // noon, and this is the path the player sees most often.
    if (this.jobs.restRemaining(itemId) > 0) return 'asleep';
    if (this.jobs.isWorking(itemId)) return 'awake';
    if (phaseAt(this.clock.now()) === 'night') return 'asleep';
    if (this.isNapping(itemId)) return 'asleep';
    return 'awake';
  }

  /**
   * A nap of its own accord — "just when he wants to sleep".
   *
   * A window inside a repeating cycle, with the offset hashed off the item id so
   * two dragons never doze in lockstep. Stateless and derived, so it survives a
   * reload, needs no save field, and stays reproducible under `advanceTime`.
   */
  private isNapping(itemId: number): boolean {
    const offset = Math.abs((itemId * 2654435761) >>> 0) % DRAGON_NAP_CYCLE_MS;
    const into = (((this.clock.now() - offset) % DRAGON_NAP_CYCLE_MS) + DRAGON_NAP_CYCLE_MS) %
      DRAGON_NAP_CYCLE_MS;
    return into < DRAGON_NAP_LENGTH_MS;
  }

  /**
   * Hungry = it has had NOTHING today.
   *
   * Read straight off the care record, so feeding it settles it instantly and
   * the roar and the gauge can never say different things. The grace window
   * exists because a hatchling that roars the moment it lands reads as a bug
   * rather than as an appetite.
   */
  private isHungry(itemId: number): boolean {
    const seen = this.firstSeenAt.get(itemId);
    if (seen === undefined || this.clock.now() - seen < DRAGON_HUNGER_GRACE_MS) return false;
    return this.dragons.careOf(itemId).meals < HUNGRY_UNFED_EPS;
  }

  /** Every dragon standing on the active world's board. */
  private boardDragons(): BoardItemState[] {
    return [...this.state.items.values()].filter((i) => this.dragons.isBoardDragon(i));
  }

  /**
   * May this dragon wander right now?
   *
   * The load-bearing guard is the last one. A dragon that walks out of a group
   * the player was one piece away from merging has cost them something, and
   * ambience is never allowed to cost anything — so a dragon standing next to
   * its own kind stays exactly where it is.
   */
  private mayWander(item: BoardItemState): boolean {
    // The tutorial is a script and the board is its stage; a piece moving on its
    // own would walk out from under a scripted step.
    if (!this.state.tutorialDone) return false;
    if (this.jobs.isWorking(item.id) || this.jobs.restRemaining(item.id) > 0) return false;
    if (this.moodOf(item.id) === 'asleep') return false;
    for (const pos of this.state.neighbors(item.col, item.row)) {
      const near = this.state.itemAt(pos.col, pos.row);
      if (near && near.chain === item.chain && near.tier === item.tier) return false;
    }
    return true;
  }

  /**
   * Somewhere worth going: a free active tile far enough away to read as a
   * journey, near enough to stay on the part of the board the player is looking
   * at. Deterministic — the id picks which of the candidates it takes.
   */
  private wanderTarget(item: BoardItemState): TilePos | undefined {
    const candidates = this.state
      .freeActiveTilesNear(item.col, item.row, DRAGON_WANDER_MAX_DIST)
      .filter((p) => {
        const d = Math.abs(p.col - item.col) + Math.abs(p.row - item.row);
        return d >= DRAGON_WANDER_MIN_DIST;
      });
    if (!candidates.length) return undefined;
    // A cheap deterministic hash off the id AND the current schedule slot, so a
    // dragon does not pace between the same two tiles for ever.
    const slot = Math.floor(this.clock.now() / DRAGON_WANDER_EVERY_MS);
    const pick = Math.abs((item.id * 2654435761 + slot * 40503) >>> 0) % candidates.length;
    return candidates[pick];
  }

  /** The next wander time for a dragon, staggered by its id so a board of them
   *  never lifts off together. */
  private scheduleWander(itemId: number, from: number): number {
    const stagger = Math.abs((itemId * 2654435761) >>> 0) % DRAGON_WANDER_SPREAD_MS;
    return from + DRAGON_WANDER_EVERY_MS + stagger;
  }

  private tick(): void {
    const now = this.clock.now();
    for (const item of this.boardDragons()) {
      if (!this.firstSeenAt.has(item.id)) this.firstSeenAt.set(item.id, now);

      // ---- mood, announced only when it changes ------------------------
      this.announceMood(item.id);

      // ---- wandering ---------------------------------------------------
      const due = this.nextWanderAt.get(item.id);
      if (due === undefined) {
        this.nextWanderAt.set(item.id, this.scheduleWander(item.id, now));
        continue;
      }
      if (now < due) continue;
      this.nextWanderAt.set(item.id, this.scheduleWander(item.id, now));
      if (!this.mayWander(item)) continue;
      const to = this.wanderTarget(item);
      if (!to) continue;

      const from = { col: item.col, row: item.row };
      this.state.moveItem(item.id, to);
      this.bus.emit('dragon:wandered', { itemId: item.id, from, to });
    }
  }
}
