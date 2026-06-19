import { CHEST_REWARDS } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';

type ChestReward = (typeof CHEST_REWARDS)[number];

/**
 * Treasure chests. Tapping one (BoardScene emits `chest:open`) grants ONE random
 * reward from CHEST_REWARDS — Gold, Warmth, or a fan of fresh Wood logs dropped
 * on the tiles around it — then the chest is consumed. The loot table lives in
 * Constants so designers tune it without touching code. Phaser-free, so it runs
 * in the node unit tests.
 */
export class ChestSystem {
  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock
  ) {
    bus.on('chest:open', ({ itemId }) => this.open(itemId));
  }

  /** Which reward to grant — split out so a test can force a branch. */
  protected pick(): ChestReward {
    return CHEST_REWARDS[Math.floor(Math.random() * CHEST_REWARDS.length)]!;
  }

  private open(itemId: number): void {
    const chest = this.state.items.get(itemId);
    if (!chest || chest.chain !== 'chest') return;
    const { col, row } = chest;
    const reward = this.pick();
    // Remove the chest FIRST so its own tile can host a reward log.
    this.bus.emit('board:consume_items', { itemIds: [itemId], reason: 'sold' });
    if (reward.kind === 'coins') {
      this.bus.emit('economy:add', { coins: reward.amount, reason: 'chest' });
    } else if (reward.kind === 'energy') {
      this.bus.emit('energy:add', { amount: reward.amount, reason: 'chest' });
    } else {
      this.spawnWood(col, row, reward.amount);
    }
  }

  private spawnWood(col: number, row: number, count: number): void {
    const now = this.clock.now();
    const cells = this.state.freeActiveTilesNear(col, row).slice(0, count);
    for (const cell of cells) {
      const item = this.state.addItem({
        chain: 'lumber',
        tier: 1,
        col: cell.col,
        row: cell.row,
        kind: 'item'
      });
      this.bus.emit('item:spawned', { item: this.state.snapshot(item, now), cause: 'generator' });
    }
  }
}
