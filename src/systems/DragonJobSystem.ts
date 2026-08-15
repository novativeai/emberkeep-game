import { DRAGON_REST_MS, DRAGON_WORK_MS, DRAGON_WORK_PER_DRAGON } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import type { ChainsData, GeneratorConfig } from '../core/types';

interface Job {
  houseId: number;
  state: 'working' | 'resting';
  sinceMs: number; // clock time the current state started
}

/**
 * Dragon jobs. A dragon can WORK a House: every worker standing by it speeds the
 * House's timer by +1× (1 dragon = 2×, 2 = 3×, …) — implemented by advancing the
 * House's `passiveAt` an extra `ms` per worker on each tick (the clock already
 * gives the base 1×). A dragon tires after DRAGON_WORK_MS, flies home and rests
 * DRAGON_REST_MS before it can work again. All timing reads the virtual clock.
 */
export class DragonJobSystem {
  private jobs = new Map<number, Job>(); // dragonId → job

  /**
   * Is this dragon asleep? Wired to `DragonLifeSystem` in Context.
   *
   * Sleep is DERIVED there from three causes (one of which is this system's own
   * rest), so this cannot be re-derived here without the two drifting — and the
   * construction order rules out a constructor reference. A no-op default keeps
   * the unit fixtures that build this system alone honest: they get a system
   * with no sleep in it, which is exactly what they have.
   */
  asleep: (dragonId: number) => boolean = () => false;

  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    private chains: ChainsData
  ) {
    bus.on('dragon:work', ({ dragonId, houseId }) => this.startWork(dragonId, houseId));
    bus.on('time:advanced', ({ ms }) => this.tick(ms));
    bus.on('item:removed', ({ itemId }) => this.jobs.delete(itemId));
    bus.on('game:reset', () => this.jobs.clear());
  }

  private generatorConfig(chain: string, tier: number): GeneratorConfig | undefined {
    return this.chains.chains
      .find((c) => c.id === chain)
      ?.tiers.find((t) => t.tier === tier)?.generator;
  }

  private startWork(dragonId: number, houseId: number): void {
    const dragon = this.state.items.get(dragonId);
    const house = this.state.items.get(houseId);
    if (!dragon || !house) return;
    // Only an actual DRAGON tier works — a TAP generator (the base/adult dragon
    // tiers; the chain's merge pieces — Rubies, Eggs — have no generator) — and
    // only a PASSIVE generator (House, Big Tree) can be worked.
    const dragonCfg = this.generatorConfig(dragon.chain, dragon.tier);
    if (!dragonCfg || dragonCfg.tappable === false) return;
    const houseCfg = this.generatorConfig(house.chain, house.tier);
    if (!houseCfg || houseCfg.tappable !== false) return;
    if (this.jobs.get(dragonId)?.state === 'resting') return; // still tired
    // A SLEEPER cannot be put to work — whatever put it down. The board already
    // refuses the drop, but the rule belongs here: this is the only door onto a
    // job, and a rule enforced only at the door the player happens to use is a
    // rule the next caller will walk around.
    if (this.asleep(dragonId)) return;
    this.jobs.set(dragonId, { houseId, state: 'working', sinceMs: this.clock.now() });
    this.bus.emit('dragon:working', { dragonId, houseId });
  }

  /** End a fatigue rest early — the dragon is hireable again at once. The one
   *  caller is the PAID sleep skip (DragonLifeSystem): nothing else may hand
   *  back the cost of a shift. */
  clearRest(dragonId: number): void {
    if (this.jobs.get(dragonId)?.state !== 'resting') return;
    this.jobs.delete(dragonId);
    this.bus.emit('dragon:rested', { dragonId });
  }

  /** Dragons currently working a given building (for spacing them out). */
  workersFor(houseId: number): number {
    let n = 0;
    for (const job of this.jobs.values()) if (job.state === 'working' && job.houseId === houseId) n++;
    return n;
  }

  /** Total dragons working anywhere — they speed up EVERY timed object. */
  workingCount(): number {
    let n = 0;
    for (const job of this.jobs.values()) if (job.state === 'working') n++;
    return n;
  }

  isWorking(dragonId: number): boolean {
    return this.jobs.get(dragonId)?.state === 'working';
  }

  /** Rest (fatigue) time left in ms, or 0 if the dragon isn't resting. */
  restRemaining(dragonId: number): number {
    const job = this.jobs.get(dragonId);
    if (!job || job.state !== 'resting') return 0;
    return Math.max(0, job.sinceMs + DRAGON_REST_MS - this.clock.now());
  }

  private tick(ms: number): void {
    const now = this.clock.now();
    // GLOBAL speed-up: with N working dragons every timed object advances at
    // PER × N seconds per real second (1 dragon = 2×, 2 = 4×, …). The base 1×
    // is the clock's own advance, so we add the remainder ((PER·N − 1) × ms).
    let bonusMs = 0;
    if (ms > 0) {
      const workers = this.workingCount();
      if (workers > 0) bonusMs = (DRAGON_WORK_PER_DRAGON * workers - 1) * ms;
    }
    if (bonusMs > 0) {
      for (const item of this.state.items.values()) {
        if (item.passiveAt !== undefined) item.passiveAt -= bonusMs;
      }
    }
    // Per-dragon fatigue: work DRAGON_WORK_MS → rest DRAGON_REST_MS.
    for (const [dragonId, job] of this.jobs) {
      if (job.state === 'working') {
        if (now - job.sinceMs >= DRAGON_WORK_MS) {
          job.state = 'resting';
          job.sinceMs = now;
          this.bus.emit('dragon:rest', { dragonId }); // tired → fly home
        }
      } else if (now - job.sinceMs >= DRAGON_REST_MS) {
        this.jobs.delete(dragonId);
        this.bus.emit('dragon:rested', { dragonId });
      }
    }
  }
}
