import {
  GENERATOR_PASSIVE_RETRY_MS,
  OFFLINE_BANK_CYCLES,
  REWARD_SPAWN_RADIUS
} from '../core/Constants';
import { phaseAllows } from '../core/dayCycle';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import type { BoardItemState, ChainsData, GeneratorConfig, TilePos } from '../core/types';

/**
 * Generators come in two flavours:
 *   • TAP generators (dragons): tap a ready one → spend energy, drop produce on a
 *     free neighbour, start a cooldown. Also gift one produce passively.
 *   • PASSIVE generators (big tree, house — `tappable:false`): never tap-harvest;
 *     they auto-produce every `passiveMs` (item, or a coins/xp/energy reward).
 *     Their wait is simply waited out — the countdown pill says how long.
 * All timing reads the virtual GameClock.
 */
export class GeneratorSystem {
  /** Gifts banked by the last offline catch-up (state:loaded) — the UI's
   *  "While you were away" card reads it right after load. */
  lastOfflineGifts = 0;

  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    private chains: ChainsData
  ) {
    bus.on('item:tapped', ({ itemId }) => this.onTapped(itemId));
    bus.on('time:advanced', () => this.tickPassive());
    bus.on('generator:set_timer', ({ chain, tier, remainingMs }) =>
      this.setTimer(chain, tier, remainingMs)
    );
    bus.on('state:loaded', ({ offlineMs }) => this.bankOffline(offlineMs));
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
      if (!generator?.passiveMs || !generator.produces) continue;
      // Phase-gated producers only pay the waiting harvest if you return DURING
      // their hour — the dew is there when you come back at night, not at noon.
      if (!this.phaseOpen(generator)) continue;
      if (item.passiveAt === undefined || now < item.passiveAt) continue;
      const overdue = Math.min(
        OFFLINE_BANK_CYCLES,
        Math.floor((now - item.passiveAt) / generator.passiveMs) + 1
      );
      for (let i = 0; i < overdue; i++) {
        const target: TilePos | undefined = this.dropTileFor(item);
        if (!target) break; // board full — the live retry loop takes over
        const output = this.produceItem(generator, target, now);
        this.lastOfflineGifts++;
        this.bus.emit('item:produced', { generatorId: item.id, output: this.state.snapshot(output, now) });
      }
      item.passiveAt = now + generator.passiveMs;
    }
  }

  /** Tutorial staging: put the first generator of chain+tier into a wait with
   *  `remainingMs` left, so a scripted step can land on a timer of known length.
   *  Passive generators (house, big tree) wait on passiveAt; tap ones on readyAt. */
  private setTimer(chain: string, tier: number, remainingMs: number): void {
    const item = [...this.state.items.values()].find(
      (i) => i.kind === 'item' && i.chain === chain && i.tier === tier
    );
    if (!item) return;
    const at = this.clock.now() + remainingMs;
    if (this.generatorConfig(chain, tier)?.tappable === false) item.passiveAt = at;
    else item.readyAt = at;
  }

  private generatorConfig(chain: string, tier: number): GeneratorConfig | undefined {
    return this.chains.chains
      .find((c) => c.id === chain)
      ?.tiers.find((t) => t.tier === tier)?.generator;
  }

  /** Time-of-day gate (`generator.phases`): the Dew Basin only fills at night.
   *  A gated generator whose timer came due off-hours simply HOLDS — the wait is
   *  never re-armed, so it pays out the moment its phase comes round again. */
  private phaseOpen(cfg: GeneratorConfig): boolean {
    return phaseAllows(cfg.phases, this.clock.now());
  }

  private onTapped(itemId: number): void {
    const item = this.state.items.get(itemId);
    if (!item || item.kind !== 'item') return;
    const generator = this.generatorConfig(item.chain, item.tier);
    if (!generator) return; // not a generator; tooltip handling lives in UI
    if (generator.tappable === false) return; // passive-only: it pays out on its own timer
    if (!this.phaseOpen(generator)) {
      this.bus.emit('item:harvest_failed', {
        generatorId: itemId,
        reason: 'phase',
        requiresPhase: generator.phases![0]
      });
      return;
    }

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
    const output = this.produceItem(generator, target, now);
    this.bus.emit('item:harvested', { generatorId: itemId, output: this.state.snapshot(output, now) });
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
      // A generator standing on ground the world no longer offers still pays out, but
      // WITHIN REACH. Unbounded, this branch was a teleporter: it only ever asked
      // "am I on a live cell?", and on a board whose cells had not been restored yet
      // every generator answered no — so each offline gift was flung to the far side
      // of the map and autosaved there. The boot now waits for the world (Context
      // .beginRun), and this can no longer turn a bad moment into a scattered board.
      (!this.state.isTileActive(item.col, item.row)
        ? this.state.freeActiveTilesNear(item.col, item.row, REWARD_SPAWN_RADIUS * 2)[0]
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
        item.passiveAt = now + generator.passiveMs; // arm on first sight
        continue;
      }
      if (now < item.passiveAt) continue;

      if (!this.phaseOpen(generator)) continue; // off-hours: hold the due timer, pay at its phase

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
