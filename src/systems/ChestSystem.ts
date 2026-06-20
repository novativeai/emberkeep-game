import { CHEST_GIFTS, CHEST_INTERVAL_MS } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';

type ChestGift = (typeof CHEST_GIFTS)[number];

/**
 * The standing treasure chest. It is a PERMANENT fixture — never consumed. Every
 * CHEST_INTERVAL_MS a gift readies; tapping the ready chest (BoardScene emits
 * `chest:open`) grants ONE random gift from CHEST_GIFTS — Gold, or a few Emeralds
 * / Rubies popped onto the tiles beside it — then the chest recharges its timer
 * and emits `chest:claimed` so the scene can play the reveal. Tapping it while a
 * gift is still cooking does nothing. Phaser-free, so it runs in the node tests.
 */
export class ChestSystem {
  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock
  ) {
    bus.on('chest:open', ({ itemId }) => this.open(itemId));
  }

  /** Which gift to grant — split out so a test can force a branch. */
  protected pick(): ChestGift {
    return CHEST_GIFTS[Math.floor(Math.random() * CHEST_GIFTS.length)]!;
  }

  private open(itemId: number): void {
    const chest = this.state.items.get(itemId);
    if (!chest || chest.chain !== 'chest') return;
    const now = this.clock.now();
    if (chest.readyAt !== undefined && now < chest.readyAt) return; // gift still cooking

    const gift = this.pick();
    if (gift.kind === 'coins') {
      this.bus.emit('economy:add', { coins: gift.amount, reason: 'chest' });
    } else {
      this.spawnItems(chest.col, chest.row, gift.chain, gift.tier, gift.count);
    }
    chest.readyAt = now + CHEST_INTERVAL_MS; // recharge; the chest is never consumed
    this.bus.emit('chest:claimed', { chestId: itemId, label: gift.label });
  }

  /** Pop `count` merge pieces onto the free tiles nearest the chest. */
  private spawnItems(col: number, row: number, chain: string, tier: number, count: number): void {
    const now = this.clock.now();
    const cells = this.state.freeActiveTilesNear(col, row).slice(0, count);
    for (const cell of cells) {
      const item = this.state.addItem({ chain, tier, col: cell.col, row: cell.row, kind: 'item' });
      this.bus.emit('item:spawned', { item: this.state.snapshot(item, now), cause: 'generator' });
    }
  }
}
