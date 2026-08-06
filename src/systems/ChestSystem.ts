import type { ChestGift } from '../core/Constants';
import {
  CHEST_INTERVAL_MS,
  REWARD_SPAWN_RADIUS,
  chestGiftsIn,
  chestWildcardChains
} from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import type { ChainsData } from '../core/types';

/**
 * The standing treasure chest. It is a PERMANENT fixture — never consumed. Every
 * CHEST_INTERVAL_MS a gift readies; tapping the ready chest (BoardScene emits
 * `chest:open`) grants ONE random gift from CHEST_GIFTS — Gold, a handful of
 * Rubies, or one piece of whatever else this world makes — popped onto the tiles
 * beside it, then the chest recharges its timer and emits `chest:claimed` so the
 * scene can play the reveal. Tapping it while a gift is still cooking does
 * nothing. Phaser-free, so it runs in the node tests.
 */
export class ChestSystem {
  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    private chains: ChainsData
  ) {
    bus.on('chest:open', ({ itemId }) => this.open(itemId));
  }

  /** This world's gift table — a chest in the north pays northern goods. */
  private get gifts(): ReadonlyArray<ChestGift> {
    return chestGiftsIn(this.state.worldId);
  }

  /** Which gift to grant — split out so a test can force a branch. */
  protected pick(): ChestGift {
    const table = this.gifts;
    return table[Math.floor(Math.random() * table.length)]!;
  }

  /**
   * Roll the wildcard into a real piece, at OPEN time and not at authoring time.
   *
   * That is the whole point of the kind: the eligible roster is a property of
   * the world the chest is standing in and of which chapter is running, so a
   * table written once in Constants would go stale the moment a chain is hidden
   * or a world is added. An empty roster falls back to Gold rather than paying
   * nothing — the same rule the no-room-nearby case already uses.
   */
  private resolve(gift: ChestGift): ChestGift {
    if (gift.kind !== 'anyItem') return gift;
    const pool = chestWildcardChains(this.chains.chains, this.state.worldId);
    const chain = pool[Math.floor(Math.random() * pool.length)];
    const tier = chain?.tiers.find((t) => t.tier === 1);
    if (!chain || !tier) return this.gifts.find((g) => g.kind === 'coins') ?? gift;
    return { kind: 'item', chain: chain.id, tier: 1, count: 1, label: `${tier.name}!` };
  }

  private open(itemId: number): void {
    const chest = this.state.items.get(itemId);
    if (!chest || chest.chain !== 'chest') return;
    const now = this.clock.now();
    if (chest.readyAt !== undefined && now < chest.readyAt) return; // gift still cooking

    let gift = this.resolve(this.pick());
    if (gift.kind === 'item' && this.spawnItems(chest.col, chest.row, gift.chain, gift.tier, gift.count) === 0) {
      // No room NEAR the chest (REWARD_SPAWN_RADIUS): pay the Gold gift instead
      // of teleporting pieces across the map or dropping them off-platform.
      gift = this.gifts.find((g) => g.kind === 'coins') ?? gift;
    }
    if (gift.kind === 'coins') {
      this.bus.emit('economy:add', { coins: gift.amount, reason: 'chest' });
    }
    chest.readyAt = now + CHEST_INTERVAL_MS; // recharge; the chest is never consumed
    this.bus.emit('chest:claimed', { chestId: itemId, label: gift.label, coins: gift.kind === 'coins' });
  }

  /** Pop `count` merge pieces onto free tiles NEAR the chest; returns how many
   *  actually landed (0 = neighbourhood full → caller falls back to Gold). */
  private spawnItems(col: number, row: number, chain: string, tier: number, count: number): number {
    const now = this.clock.now();
    const cells = this.state.freeActiveTilesNear(col, row, REWARD_SPAWN_RADIUS).slice(0, count);
    for (const cell of cells) {
      const item = this.state.addItem({ chain, tier, col: cell.col, row: cell.row, kind: 'item' });
      this.bus.emit('item:spawned', { item: this.state.snapshot(item, now), cause: 'generator' });
    }
    return cells.length;
  }
}
