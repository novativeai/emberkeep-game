import { CHEST_REWARDS } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';

type ChestReward = (typeof CHEST_REWARDS)[number];

/**
 * Treasure chests. Tapping one (BoardScene emits `chest:open`) grants ONE random
 * reward from CHEST_REWARDS — Gold or Warmth — then the chest is consumed. (Wood
 * is deliberately NOT a chest reward; lumber only appears when its cloud zone is
 * cleared.) The loot table lives in Constants so designers tune it without
 * touching code. Phaser-free, so it runs in the node unit tests.
 */
export class ChestSystem {
  constructor(
    private state: GameState,
    private bus: EventBus
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
    const reward = this.pick();
    // Consume the chest, then pay out its currency reward.
    this.bus.emit('board:consume_items', { itemIds: [itemId], reason: 'sold' });
    if (reward.kind === 'coins') {
      this.bus.emit('economy:add', { coins: reward.amount, reason: 'chest' });
    } else {
      this.bus.emit('energy:add', { amount: reward.amount, reason: 'chest' });
    }
  }
}
