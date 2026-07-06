import { EMBERFONT } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import type { EmberfontData, EmberfontVein, TilePos } from '../core/types';

/**
 * The Emberfont — the anti-idle "Spark Well" (see EMBERFONT tunables). It is a
 * standing fixture with no board footprint: it lives as the StokeMeter HUD
 * widget. Two loops interlock so a keep is worth both idling AND grinding:
 *
 *  • SPARKS (idle spine): the well trickles one Spark every `rechargeMs`, capped
 *    at `maxSparks`. Tapping it spends a Spark to DRAW A VEIN — one tier-1 merge
 *    piece dropped onto the play area — so even an away player returns to fresh
 *    fodder. Regen is anchor-based (like EnergySystem) so it catches up exactly
 *    across `window.advanceTime` jumps and offline gaps.
 *
 *  • STOKE → SURGE (active reward): every merge stokes the well. Fill the Stoke
 *    bar (`stokeMax`) and it SURGES for `surgeMs`: Sparks recharge ~5× faster and
 *    each merge grants `surgeXpBonus` bonus XP. Idle and the Stoke cools off
 *    (`stokeDecayPerTick` / `stokeDecayMs`). Sustained merging keeps the flow.
 *
 * Dormant until the tutorial is done (`state.tutorialDone`), so it never
 * competes with the scripted first lesson. Phaser-free → runs in node tests.
 */
export class EmberfontSystem {
  /** Draw order expanded from the weighted veins, interleaved for a nice spread. */
  private readonly bag: EmberfontVein[];
  /** Last `active` (tutorialDone) value we announced — detects the wake-up flip. */
  private lastActive = false;

  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    data: EmberfontData
  ) {
    this.bag = EmberfontSystem.buildBag(data.veins);

    bus.on('emberfont:tap', () => this.tap());
    bus.on('time:advanced', () => this.catchUp(this.clock.now()));
    bus.on('item:merged', () => this.onMerge());
    bus.on('tutorial:step', () => this.catchUp(this.clock.now()));
    bus.on('state:loaded', () => this.catchUp(this.clock.now()));
    bus.on('game:reset', () => {
      this.lastActive = false;
      this.announce();
    });
  }

  /** Interleave the weighted veins so the draw cycle spreads types out
   *  (weights 4,3,3,2 → gem,ruby,emerald,bush,gem,ruby,emerald,bush,…). */
  private static buildBag(veins: EmberfontVein[]): EmberfontVein[] {
    const bag: EmberfontVein[] = [];
    const rem = veins.map((v) => ({ v, left: Math.max(1, Math.floor(v.weight)) }));
    let any = true;
    while (any) {
      any = false;
      for (const e of rem) {
        if (e.left > 0) {
          bag.push(e.v);
          e.left--;
          any = true;
        }
      }
    }
    return bag.length > 0 ? bag : [{ chain: 'flame_gem', tier: 1, weight: 1 }];
  }

  private surging(now: number): boolean {
    return this.state.emberSurgeUntil > 0 && now < this.state.emberSurgeUntil;
  }

  private nextVein(): EmberfontVein {
    return this.bag[this.state.emberVeinIndex % this.bag.length]!;
  }

  /** Recompute time-based drip/decay/surge-end against the clock; announce on
   *  any change (and every tick while Surging, for the live countdown). */
  catchUp(now: number, announce = true): void {
    // Credit the Spark drip FIRST — while the Surge window is still known — so a
    // gap that straddles the Surge boundary accrues its fast + idle portions
    // exactly (see accrueSparks). Closing the Surge before this would discard it.
    let changed = this.accrueSparks(now);

    // Close a Surge whose window has now elapsed.
    if (this.state.emberSurgeUntil > 0 && now >= this.state.emberSurgeUntil) {
      this.state.emberSurgeUntil = 0;
      this.bus.emit('emberfont:surge', { active: false, remainingMs: 0 });
      changed = true;
    }

    // Stoke cools while NOT surging.
    if (!this.surging(now)) {
      if (this.state.emberStokeAt > now) this.state.emberStokeAt = now;
      while (
        this.state.emberStoke > 0 &&
        now - this.state.emberStokeAt >= EMBERFONT.stokeDecayMs
      ) {
        this.state.emberStoke = Math.max(0, this.state.emberStoke - EMBERFONT.stokeDecayPerTick);
        this.state.emberStokeAt += EMBERFONT.stokeDecayMs;
        changed = true;
      }
      if (this.state.emberStoke <= 0) this.state.emberStokeAt = now;
    }

    const activeChanged = this.state.tutorialDone !== this.lastActive;
    if (announce && (changed || activeChanged || this.surging(now))) this.announce(now);
  }

  /** Anchor-based Spark drip. Each drip's rate honours the Surge window: a Spark
   *  whose anchor still sits inside the Surge costs `surgeRechargeMs`, the rest
   *  `rechargeMs`. Advancing per-Spark means an offline / `advanceTime` gap that
   *  straddles the Surge boundary credits its fast-then-idle portions exactly —
   *  the two-rate extension of EnergySystem.computeRegen. Returns whether the
   *  Spark count changed. */
  private accrueSparks(now: number): boolean {
    let changed = false;
    if (this.state.emberSparkAt > now) this.state.emberSparkAt = now; // clock rewound
    while (this.state.emberSparks < EMBERFONT.maxSparks) {
      const inSurge =
        this.state.emberSurgeUntil > 0 && this.state.emberSparkAt < this.state.emberSurgeUntil;
      const rate = inSurge ? EMBERFONT.surgeRechargeMs : EMBERFONT.rechargeMs;
      if (now - this.state.emberSparkAt < rate) break;
      this.state.emberSparks++;
      this.state.emberSparkAt += rate;
      changed = true;
    }
    if (this.state.emberSparks >= EMBERFONT.maxSparks) this.state.emberSparkAt = now;
    return changed;
  }

  /** Tap the well: spend one Spark to draw a vein onto the play area. */
  private tap(): void {
    if (!this.state.tutorialDone) return;
    const now = this.clock.now();
    this.catchUp(now, false);
    if (this.state.emberSparks < 1) {
      this.announce(now);
      return;
    }
    const cell = this.pickDropCell();
    if (!cell) {
      // Board is full — keep the Spark rather than burning it into nowhere.
      this.announce(now);
      return;
    }
    const wasFull = this.state.emberSparks >= EMBERFONT.maxSparks;
    this.state.emberSparks -= 1;
    if (wasFull) this.state.emberSparkAt = now; // start the drip clock now we're below max
    const vein = this.nextVein();
    this.state.emberVeinIndex++;

    const item = this.state.addItem({
      chain: vein.chain,
      tier: vein.tier,
      col: cell.col,
      row: cell.row,
      kind: 'item'
    });
    this.bus.emit('item:spawned', { item: this.state.snapshot(item, now), cause: 'generator' });
    this.bus.emit('emberfont:sparked', {
      at: { col: cell.col, row: cell.row },
      chain: vein.chain,
      tier: vein.tier
    });
    this.announce(now);
  }

  /** Every merge stokes the well; a full bar ignites a Surge. During a Surge
   *  merges pay bonus XP instead of stoking further. */
  private onMerge(): void {
    if (!this.state.tutorialDone) return;
    const now = this.clock.now();
    this.catchUp(now, false);
    if (this.surging(now)) {
      this.bus.emit('economy:add', { xp: EMBERFONT.surgeXpBonus, reason: 'emberfont_surge' });
    } else {
      this.state.emberStoke = Math.min(EMBERFONT.stokeMax, this.state.emberStoke + EMBERFONT.stokePerMerge);
      this.state.emberStokeAt = now;
      if (this.state.emberStoke >= EMBERFONT.stokeMax) this.startSurge(now);
    }
    this.announce(now);
  }

  private startSurge(now: number): void {
    this.state.emberSurgeUntil = now + EMBERFONT.surgeMs;
    this.state.emberStoke = 0;
    this.state.emberStokeAt = now;
    this.state.emberSparkAt = now; // fast drip starts clean
    this.bus.emit('emberfont:surge', { active: true, remainingMs: EMBERFONT.surgeMs });
  }

  /** Free active tile nearest the centre of the active play area, or null if the
   *  board is full. */
  private pickDropCell(): TilePos | null {
    let sumC = 0;
    let sumR = 0;
    let n = 0;
    for (let r = 0; r < this.state.rows; r++) {
      for (let c = 0; c < this.state.cols; c++) {
        if (this.state.isTileActive(c, r)) {
          sumC += c;
          sumR += r;
          n++;
        }
      }
    }
    if (n === 0) return null;
    const free = this.state.freeActiveTilesNear(Math.round(sumC / n), Math.round(sumR / n));
    return free[0] ?? null;
  }

  /** Broadcast the current well state to the StokeMeter HUD widget. */
  announce(now: number = this.clock.now()): void {
    this.lastActive = this.state.tutorialDone;
    const vein = this.nextVein();
    this.bus.emit('emberfont:changed', {
      sparks: this.state.emberSparks,
      maxSparks: EMBERFONT.maxSparks,
      stoke: this.state.emberStoke,
      maxStoke: EMBERFONT.stokeMax,
      surging: this.surging(now),
      surgeRemainingMs: Math.max(0, this.state.emberSurgeUntil - now),
      nextVein: { chain: vein.chain, tier: vein.tier },
      active: this.state.tutorialDone
    });
  }
}
