import {
  GENERATOR_PASSIVE_RETRY_MS,
  OFFLINE_BANK_CYCLES,
  REWARD_SPAWN_RADIUS,
  skipEnergyCost,
  skipWarmthCost
} from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import type {
  BoardItemState,
  ChainsData,
  ChainTierConfig,
  GeneratorConfig,
  TilePos
} from '../core/types';

/**
 * Generators come in two flavours:
 *   • TAP generators (dragons): tap a ready one → spend energy, drop produce on a
 *     free neighbour, start a cooldown. Also gift one produce passively.
 *   • PASSIVE generators (big tree, house — `tappable:false`): never tap-harvest;
 *     they auto-produce every `passiveMs` (item, or a coins/xp/energy reward), and
 *     a tap only offers the energy SKIP.
 * The skip costs energy proportional to the time still remaining (expensive at
 * the start, nearly free at the end). All timing reads the virtual GameClock.
 */
export class GeneratorSystem {
  /** Gifts banked by the last offline catch-up (state:loaded) — the UI's
   *  "While you were away" card reads it right after load. */
  lastOfflineGifts = 0;

  /**
   * Is a scripted tutorial step on screen right now?
   *
   * Learned from the bus rather than read off `state.tutorialDone`, and the
   * difference is not cosmetic: `tutorialDone` is false both mid-script AND in
   * any bare context that never ran a tutorial at all — every unit test, and any
   * future harness that seeds a board directly. Gating on the flag would have
   * silenced generators for all of them. A live step is the fact this actually
   * cares about, and it is the same signal the scenes gate on.
   */
  private tutorialActive = false;

  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    private chains: ChainsData
  ) {
    bus.on('item:tapped', ({ itemId }) => this.onTapped(itemId));
    bus.on('generator:skip', ({ itemId, currency }) => this.onSkip(itemId, currency));
    bus.on('time:advanced', () => this.tickPassive());
    bus.on('generator:set_timer', ({ chain, tier, remainingMs }) =>
      this.setTimer(chain, tier, remainingMs)
    );
    bus.on('state:loaded', ({ offlineMs }) => this.bankOffline(offlineMs));
    bus.on('ui:produce_choice_requested', ({ itemId, chain, tier }) =>
      this.commission(itemId, chain, tier)
    );
    bus.on('tutorial:step', ({ done }) => {
      this.tutorialActive = !done;
    });
  }

  /** Is this generator commissionable and still undecided — i.e. is the chooser
   *  the right answer to a tap on it? The board asks before it opens a panel. */
  awaitingChoice(item: BoardItemState): boolean {
    if (item.kind !== 'item' || item.produces) return false;
    return this.tierConfig(item.chain, item.tier)?.chooseProduce === true;
  }

  /** What a generator actually makes: its own commission if it has one, else
   *  whatever its tier makes by default. ONE resolver, so the passive tick, the
   *  offline catch-up and a tap can never disagree about a House's output. */
  private producesOf(
    item: BoardItemState,
    generator: GeneratorConfig
  ): { chain: string; tier: number } | undefined {
    return item.produces ?? generator.produces;
  }

  /**
   * Dedicate a commissioned generator to one piece, for good.
   *
   * Write-once by design: a House the player can re-point is a menu, and the
   * whole shape of the feature is that a second output costs a second House.
   * The Bag is the roster — only a piece the player is actually holding can be
   * commissioned, which is also what stops a chooser from promising an output
   * this chapter cannot supply.
   */
  private commission(itemId: number, chain: string, tier: number): void {
    const item = this.state.items.get(itemId);
    if (!item || item.kind !== 'item') return;
    if (this.tierConfig(item.chain, item.tier)?.chooseProduce !== true) {
      this.bus.emit('generator:produce_refused', { itemId, reason: 'not_commissionable' });
      return;
    }
    if (item.produces) {
      this.bus.emit('generator:produce_refused', { itemId, reason: 'already_set' });
      return;
    }
    if (!this.state.bag.some((s) => s.chain === chain && s.tier === tier && s.count > 0)) {
      this.bus.emit('generator:produce_refused', { itemId, reason: 'not_in_bag' });
      return;
    }
    item.produces = { chain, tier };
    // Its first commissioned yield starts NOW rather than finishing the cycle it
    // began as a coin press — the commission is the moment the House becomes
    // what the player asked for, and a leftover Gold drop would undercut it.
    const generator = this.generatorConfig(item.chain, item.tier);
    if (generator?.passiveMs) item.passiveAt = this.clock.now() + generator.passiveMs;
    this.bus.emit('generator:produce_set', { itemId, chain, tier });
  }

  /** Offline harvest: each passive producer pays up to OFFLINE_BANK_CYCLES
   *  overdue gifts on load — a small waiting harvest, never a flood
   *  (MECHANICS §4.3: "you return to a small harvest waiting"). */
  private bankOffline(offlineMs: number): void {
    this.lastOfflineGifts = 0;
    if (offlineMs <= 0) return;
    const now = this.clock.now();
    for (const item of [...this.state.items.values()]) {
      if (item.kind !== 'item') continue;
      const generator = this.generatorConfig(item.chain, item.tier);
      const produces = generator && this.producesOf(item, generator);
      if (!generator?.passiveMs || !produces) continue;
      if (item.passiveAt === undefined || now < item.passiveAt) continue;
      const overdue = Math.min(
        OFFLINE_BANK_CYCLES,
        Math.floor((now - item.passiveAt) / generator.passiveMs) + 1
      );
      for (let i = 0; i < overdue; i++) {
        const target: TilePos | undefined = this.dropTileFor(item);
        if (!target) break; // board full — the live retry loop takes over
        const output = this.produceItem(produces, target, now);
        this.lastOfflineGifts++;
        this.bus.emit('item:produced', { generatorId: item.id, output: this.state.snapshot(output, now) });
        this.payBonus(item, generator, now);
      }
      item.passiveAt = now + generator.passiveMs;
    }
  }

  /** Tutorial staging: put the first generator of chain+tier into a wait with
   *  `remainingMs` left, so a scripted step can offer an affordable skip. Passive
   *  generators (house, big tree) wait on passiveAt; tap generators on readyAt. */
  private setTimer(chain: string, tier: number, remainingMs: number): void {
    const item = [...this.state.items.values()].find(
      (i) => i.kind === 'item' && i.chain === chain && i.tier === tier
    );
    if (!item) return;
    const at = this.clock.now() + remainingMs;
    if (this.generatorConfig(chain, tier)?.tappable === false) item.passiveAt = at;
    else item.readyAt = at;
  }

  private tierConfig(chain: string, tier: number): ChainTierConfig | undefined {
    return this.chains.chains.find((c) => c.id === chain)?.tiers.find((t) => t.tier === tier);
  }

  private generatorConfig(chain: string, tier: number): GeneratorConfig | undefined {
    return this.tierConfig(chain, tier)?.generator;
  }

  /** The timer a tap should offer to skip: a live tap-cooldown, else a live
   *  passive wait. Returns null when nothing is pending. */
  private activeTimer(
    item: BoardItemState,
    cfg: GeneratorConfig,
    now: number
  ): { at: number; total: number; kind: 'ready' | 'passive' } | null {
    if (item.readyAt !== undefined && now < item.readyAt) {
      return { at: item.readyAt, total: cfg.cooldownMs, kind: 'ready' };
    }
    if (cfg.passiveMs && item.passiveAt !== undefined && now < item.passiveAt) {
      return { at: item.passiveAt, total: cfg.passiveMs, kind: 'passive' };
    }
    return null;
  }

  /** Spend Warmth to clear a generator's remaining wait. The cost scales with the
   *  fraction of time still left (see skipEnergyCost). */
  private onSkip(itemId: number, currency: 'gold' | 'warmth' | 'gift'): void {
    const item = this.state.items.get(itemId);
    if (!item || item.kind !== 'item') return;
    const cfg = this.generatorConfig(item.chain, item.tier);
    if (!cfg) return;
    const now = this.clock.now();
    const timer = this.activeTimer(item, cfg, now);
    if (!timer) return; // already ready

    // Two ways to skip: GOLD (default) or WARMTH (cheaper). Both expensive at the
    // start, ~1 near the end.
    // A character's help costs the player nothing — the cooldown already paid
    // for it, and WorldCharacterSystem has already spent that.
    if (currency === 'gift') {
      if (timer.kind === 'ready') item.readyAt = now;
      else item.passiveAt = now;
      this.bus.emit('generator:skipped', { itemId, chain: item.chain, currency });
      return;
    }
    if (currency === 'warmth') {
      const cost = skipWarmthCost(timer.at - now, timer.total, cfg.skipMaxGold);
      if (this.state.energyCurrent < cost) {
        this.bus.emit('item:harvest_failed', { generatorId: itemId, reason: 'energy' });
        return;
      }
      this.bus.emit('energy:spend', { amount: cost, reason: 'skip_cooldown' });
    } else {
      const cost = skipEnergyCost(timer.at - now, timer.total, cfg.skipMaxGold);
      if (this.state.coins < cost) {
        this.bus.emit('item:harvest_failed', { generatorId: itemId, reason: 'energy' });
        return;
      }
      this.bus.emit('economy:add', { coins: -cost, reason: 'skip_cooldown' });
    }
    if (timer.kind === 'ready') item.readyAt = now;
    else item.passiveAt = now; // next passive tick fires immediately
    this.bus.emit('generator:skipped', { itemId, chain: item.chain, currency });
  }

  private onTapped(itemId: number): void {
    const item = this.state.items.get(itemId);
    if (!item || item.kind !== 'item') return;
    const generator = this.generatorConfig(item.chain, item.tier);
    if (!generator) return; // not a generator; tooltip handling lives in UI
    if (generator.tappable === false) return; // passive-only: tap only skips (board-side)

    const now = this.clock.now();
    if (item.readyAt !== undefined && now < item.readyAt) {
      this.bus.emit('item:harvest_failed', { generatorId: itemId, reason: 'cooldown' });
      return;
    }
    if (this.state.energyCurrent < generator.energyCost) {
      this.bus.emit('item:harvest_failed', { generatorId: itemId, reason: 'energy' });
      return;
    }
    const target = this.dropTileFor(item);
    if (!target) {
      this.bus.emit('item:harvest_failed', { generatorId: itemId, reason: 'no_space' });
      return;
    }

    this.bus.emit('energy:spend', { amount: generator.energyCost, reason: 'harvest' });
    item.readyAt = now + generator.cooldownMs;
    const output = this.produceItem(this.producesOf(item, generator)!, target, now);
    this.bus.emit('item:harvested', { generatorId: itemId, output: this.state.snapshot(output, now) });
    this.payBonus(item, generator, now);
  }

  /** Where a generator's produce may land: an adjacent tile, else a NEARBY
   *  free active tile (REWARD_SPAWN_RADIUS — a crowded neighbourhood blocks
   *  the drop rather than teleporting it across the map). Out-of-zone fixtures
   *  (the crystal at a non-active cell) keep the unbounded search: their whole
   *  neighbourhood is non-active, and their produce must reach the board.
   */
  private dropTileFor(item: BoardItemState): TilePos | undefined {
    return (
      this.state.freeActiveNeighbors(item.col, item.row)[0] ??
      this.state.freeActiveTilesNear(item.col, item.row, REWARD_SPAWN_RADIUS)[0] ??
      (!this.state.isTileActive(item.col, item.row)
        ? this.state.freeActiveTilesNear(item.col, item.row)[0]
        : undefined)
    );
  }

  /** Every generator with a `passiveMs` pays out when its timer is due — an item
   *  (dragons, big tree) or a currency reward (the house). */
  private tickPassive(): void {
    const now = this.clock.now();
    // Snapshot first — producing mutates the items map mid-loop.
    for (const item of [...this.state.items.values()]) {
      if (item.kind !== 'item') continue;
      const generator = this.generatorConfig(item.chain, item.tier);
      if (!generator?.passiveMs) continue;
      if (item.passiveAt === undefined) {
        // NOTHING VOLUNTEERS WHILE THE TUTORIAL IS RUNNING.
        //
        // The scripted opening is a queue of one idea at a time, and every piece
        // on the board during it should be the piece the current beat is about.
        // Passive producers do not know that: the Ancient Tree drops a log every
        // five minutes, the Red Dragon a Gem Shard every three, the House its
        // yield every three and a half. By the middle of the script the board
        // carried a drift of items no beat had introduced — bad teaching on its
        // own, and also what starves the scripted spawns of room, because a
        // congested neighbourhood is exactly when a lesson's own three pieces
        // cannot find three connected tiles and land scattered instead.
        //
        // Leaving `passiveAt` UNSET is what holds them, rather than an early
        // return, and the difference matters: a generator the script staged
        // itself — `setTimer` for `house_skip`, or the payout owed after a skip —
        // has an explicit `passiveAt` and still fires on time. Only the ones
        // nobody asked for stay quiet. They arm on the first tick after handover,
        // so the player also never walks into a pile of overdue gifts.
        if (this.tutorialActive) continue;
        item.passiveAt = now + generator.passiveMs; // arm on first sight
        continue;
      }
      if (now < item.passiveAt) continue;

      if (generator.reward) {
        item.passiveAt = now + generator.passiveMs;
        this.payReward(item, generator);
        continue;
      }

      // Item producer: nearby tiles only (see dropTileFor).
      const target: TilePos | undefined = this.dropTileFor(item);
      if (!target) {
        item.passiveAt = now + GENERATOR_PASSIVE_RETRY_MS; // board full — try again soon
        continue;
      }
      item.passiveAt = now + generator.passiveMs; // one gift per tick even if overdue
      const output = this.produceItem(this.producesOf(item, generator)!, target, now);
      this.bus.emit('item:produced', { generatorId: item.id, output: this.state.snapshot(output, now) });
      this.payBonus(item, generator, now);
    }
  }

  /**
   * Count one production and, once `bonus.every` have banked, drop the bonus
   * piece too — a SECOND, rarer yield from the same generator (the Emberberry
   * patch's sprout). The counter is decremented, never zeroed, so a board with
   * no free tile defers the drop to the next yield instead of swallowing it.
   */
  private payBonus(item: BoardItemState, generator: GeneratorConfig, now: number): void {
    const bonus = generator.bonus;
    if (!bonus) return;
    item.yields = (item.yields ?? 0) + 1;
    if (item.yields < bonus.every) return;
    const target = this.dropTileFor(item);
    if (!target) return; // no room — try again on the next yield
    item.yields -= bonus.every;
    const output = this.produceItem(bonus.produces, target, now);
    this.bus.emit('item:produced', {
      generatorId: item.id,
      output: this.state.snapshot(output, now)
    });
  }

  /** Pay a reward generator's coins/xp/energy (the house). */
  private payReward(item: BoardItemState, generator: GeneratorConfig): void {
    const r = generator.reward!;
    const coins = r.coins ?? 0;
    const xp = r.xp ?? 0;
    const energy = r.energy ?? 0;
    if (coins || xp) this.bus.emit('economy:add', { coins, xp, reason: 'generator' });
    if (energy) this.bus.emit('energy:add', { amount: energy, reason: 'generator' });
    this.bus.emit('generator:reward', { generatorId: item.id, coins, xp, energy });
  }

  /** Spawn `produces` on `target`, arming it if it's itself a generator. */
  private produceItem(
    produces: { chain: string; tier: number },
    target: TilePos,
    now: number
  ): BoardItemState {
    const producedGenerator = this.generatorConfig(produces.chain, produces.tier);
    return this.state.addItem({
      chain: produces.chain,
      tier: produces.tier,
      col: target.col,
      row: target.row,
      kind: 'item',
      ...(producedGenerator ? { readyAt: now } : {})
    });
  }
}
