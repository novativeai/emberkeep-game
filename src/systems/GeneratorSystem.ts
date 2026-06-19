import { GENERATOR_PASSIVE_RETRY_MS, skipEnergyCost, skipWarmthCost } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import type { BoardItemState, ChainsData, GeneratorConfig, TilePos } from '../core/types';

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
  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    private chains: ChainsData
  ) {
    bus.on('item:tapped', ({ itemId }) => this.onTapped(itemId));
    bus.on('generator:skip', ({ itemId, currency }) => this.onSkip(itemId, currency));
    bus.on('time:advanced', () => this.tickPassive());
  }

  private generatorConfig(chain: string, tier: number): GeneratorConfig | undefined {
    return this.chains.chains
      .find((c) => c.id === chain)
      ?.tiers.find((t) => t.tier === tier)?.generator;
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
  private onSkip(itemId: number, currency: 'gold' | 'warmth'): void {
    const item = this.state.items.get(itemId);
    if (!item || item.kind !== 'item') return;
    const cfg = this.generatorConfig(item.chain, item.tier);
    if (!cfg) return;
    const now = this.clock.now();
    const timer = this.activeTimer(item, cfg, now);
    if (!timer) return; // already ready

    // Two ways to skip: GOLD (default) or WARMTH (cheaper). Both expensive at the
    // start, ~1 near the end.
    if (currency === 'warmth') {
      const cost = skipWarmthCost(timer.at - now, timer.total);
      if (this.state.energyCurrent < cost) {
        this.bus.emit('item:harvest_failed', { generatorId: itemId, reason: 'energy' });
        return;
      }
      this.bus.emit('energy:spend', { amount: cost, reason: 'skip_cooldown' });
    } else {
      const cost = skipEnergyCost(timer.at - now, timer.total);
      if (this.state.coins < cost) {
        this.bus.emit('item:harvest_failed', { generatorId: itemId, reason: 'energy' });
        return;
      }
      this.bus.emit('economy:add', { coins: -cost, reason: 'skip_cooldown' });
    }
    if (timer.kind === 'ready') item.readyAt = now;
    else item.passiveAt = now; // next passive tick fires immediately
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
    // Prefer an immediate neighbour; fall back to the nearest free active tile so
    // out-of-zone fixtures (e.g. the crystal fixture at a non-playable position)
    // can still drop produce somewhere reachable on the active board.
    const target =
      this.state.freeActiveNeighbors(item.col, item.row)[0] ??
      this.state.freeActiveTilesNear(item.col, item.row)[0];
    if (!target) {
      this.bus.emit('item:harvest_failed', { generatorId: itemId, reason: 'no_space' });
      return;
    }

    this.bus.emit('energy:spend', { amount: generator.energyCost, reason: 'harvest' });
    item.readyAt = now + generator.cooldownMs;
    const output = this.produceItem(generator, target, now);
    this.bus.emit('item:harvested', { generatorId: itemId, output: this.state.snapshot(output, now) });
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
        item.passiveAt = now + generator.passiveMs; // arm on first sight
        continue;
      }
      if (now < item.passiveAt) continue;

      if (generator.reward) {
        item.passiveAt = now + generator.passiveMs;
        this.payReward(item, generator);
        continue;
      }

      // Item producer: prefer a neighbour; otherwise the nearest free active tile.
      const target: TilePos | undefined =
        this.state.freeActiveNeighbors(item.col, item.row)[0] ??
        this.state.freeActiveTilesNear(item.col, item.row)[0];
      if (!target) {
        item.passiveAt = now + GENERATOR_PASSIVE_RETRY_MS; // board full — try again soon
        continue;
      }
      item.passiveAt = now + generator.passiveMs; // one gift per tick even if overdue
      const output = this.produceItem(generator, target, now);
      this.bus.emit('item:produced', { generatorId: item.id, output: this.state.snapshot(output, now) });
    }
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

  /** Spawn the configured produce on `target`, arming it if it's itself a generator. */
  private produceItem(generator: GeneratorConfig, target: TilePos, now: number): BoardItemState {
    const produces = generator.produces!;
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
