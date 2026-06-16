import { GENERATOR_PASSIVE_RETRY_MS } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import type { BoardItemState, ChainsData, GeneratorConfig, TilePos } from '../core/types';

/**
 * Hatchlings and whelps are generators in two ways:
 *   • TAP a ready one — spends energy, drops produce on a free neighbour, starts
 *     a short cooldown (the active, fast path).
 *   • PASSIVE — every `passiveMs` the dragon gifts one produce for free, no tap,
 *     no energy (the standing advantage of owning a dragon). Driven by the
 *     `time:advanced` tick, so it honours `window.advanceTime` deterministically.
 * All timing reads the virtual GameClock.
 */
export class GeneratorSystem {
  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    private chains: ChainsData
  ) {
    bus.on('item:tapped', ({ itemId }) => this.onTapped(itemId));
    bus.on('time:advanced', () => this.tickPassive());
  }

  private generatorConfig(chain: string, tier: number): GeneratorConfig | undefined {
    return this.chains.chains
      .find((c) => c.id === chain)
      ?.tiers.find((t) => t.tier === tier)?.generator;
  }

  private onTapped(itemId: number): void {
    const item = this.state.items.get(itemId);
    if (!item || item.kind !== 'item') return;
    const generator = this.generatorConfig(item.chain, item.tier);
    if (!generator) return; // not a generator; tooltip handling lives in UI

    const now = this.clock.now();
    if (item.readyAt !== undefined && now < item.readyAt) {
      this.bus.emit('item:harvest_failed', { generatorId: itemId, reason: 'cooldown' });
      return;
    }
    if (this.state.energyCurrent < generator.energyCost) {
      this.bus.emit('item:harvest_failed', { generatorId: itemId, reason: 'energy' });
      return;
    }
    const target = this.state.freeActiveNeighbors(item.col, item.row)[0];
    if (!target) {
      this.bus.emit('item:harvest_failed', { generatorId: itemId, reason: 'no_space' });
      return;
    }

    this.bus.emit('energy:spend', { amount: generator.energyCost, reason: 'harvest' });
    item.readyAt = now + generator.cooldownMs;
    const output = this.produce(generator, target, now);
    this.bus.emit('item:harvested', { generatorId: itemId, output: this.state.snapshot(output, now) });
  }

  /** Every generator with a `passiveMs` gifts one produce when its timer is due. */
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

      // Prefer a neighbour; otherwise the nearest free active tile anywhere.
      const target: TilePos | undefined =
        this.state.freeActiveNeighbors(item.col, item.row)[0] ??
        this.state.freeActiveTilesNear(item.col, item.row)[0];
      if (!target) {
        item.passiveAt = now + GENERATOR_PASSIVE_RETRY_MS; // board full — try again soon
        continue;
      }
      // One gift per tick even if long overdue (no flood after advanceTime).
      item.passiveAt = now + generator.passiveMs;
      const output = this.produce(generator, target, now);
      this.bus.emit('item:produced', { generatorId: item.id, output: this.state.snapshot(output, now) });
    }
  }

  /** Spawn the configured produce on `target`, arming it if it's itself a generator. */
  private produce(generator: GeneratorConfig, target: TilePos, now: number): BoardItemState {
    const producedGenerator = this.generatorConfig(generator.produces.chain, generator.produces.tier);
    return this.state.addItem({
      chain: generator.produces.chain,
      tier: generator.produces.tier,
      col: target.col,
      row: target.row,
      kind: 'item',
      ...(producedGenerator ? { readyAt: now } : {})
    });
  }
}
