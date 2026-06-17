import { ENERGY_MAX } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import type { ChainsData, GeneratorConfig, MapData, SpawnCause } from '../core/types';

/**
 * Owns board lifecycle: initial population and removal commands.
 * Item movement/merging is resolved by MergeSystem; generators by
 * GeneratorSystem. All of them mutate the board through GameState
 * primitives and announce changes on the bus.
 */
export class BoardSystem {
  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    private chains: ChainsData,
    private map: MapData
  ) {
    bus.on('board:consume_items', ({ itemIds, reason }) => this.consume(itemIds, reason));
  }

  generatorConfig(chain: string, tier: number): GeneratorConfig | undefined {
    return this.chains.chains
      .find((c) => c.id === chain)
      ?.tiers.find((t) => t.tier === tier)?.generator;
  }

  /** Populate a brand-new board from map.json. */
  newGame(): void {
    this.state.reset(this.clock.now());
    for (const placement of this.map.startingItems) {
      this.spawn(placement.chain, placement.tier, placement.at[0], placement.at[1], 'init');
    }
    for (const decor of this.map.startingDecor ?? []) {
      this.spawnDecor(decor.decor, decor.at[0], decor.at[1], 'init');
    }
    this.bus.emit('energy:changed', { current: this.state.energyCurrent, max: ENERGY_MAX });
    this.bus.emit('economy:changed', {
      coins: this.state.coins,
      keys: this.state.keys,
      xp: this.state.xp,
      level: this.state.level
    });
  }

  spawn(chain: string, tier: number, col: number, row: number, cause: SpawnCause): void {
    const generator = this.generatorConfig(chain, tier);
    const item = this.state.addItem({
      chain,
      tier,
      col,
      row,
      kind: 'item',
      ...(generator ? { readyAt: this.clock.now() } : {})
    });
    this.bus.emit('item:spawned', { item: this.state.snapshot(item, this.clock.now()), cause });
  }

  spawnDecor(decor: string, col: number, row: number, cause: SpawnCause): void {
    const item = this.state.addItem({ chain: decor, tier: 1, col, row, kind: 'decor' });
    this.bus.emit('item:spawned', { item: this.state.snapshot(item), cause });
  }

  consume(itemIds: number[], reason: string): void {
    for (const id of itemIds) {
      const item = this.state.items.get(id);
      if (!item) continue;
      const at = { col: item.col, row: item.row };
      this.state.removeItem(id);
      this.bus.emit('item:removed', {
        itemId: id,
        at,
        reason: reason === 'sold' ? 'sold' : 'delivered'
      });
    }
  }

}
