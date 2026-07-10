import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { ChainsData } from '../core/types';

/**
 * Owns coins, keys and XP. Other systems request changes via
 * 'economy:add' / 'economy:spend_keys'; selling comes straight from the UI.
 */
export class EconomySystem {
  constructor(
    private state: GameState,
    private bus: EventBus,
    private chains: ChainsData
  ) {
    bus.on('economy:add', ({ coins, keys, xp }) => {
      const before = this.state.level;
      this.state.coins += coins ?? 0;
      this.state.keys += keys ?? 0;
      this.state.xp += xp ?? 0;
      this.announce();
      // XP can push the Keeper up one or more levels — fire one per level so
      // the reward + celebration land for each (coins-only adds never level).
      for (let lvl = before + 1; lvl <= this.state.level; lvl++) {
        this.bus.emit('keeper:leveled', { level: lvl, from: lvl - 1 });
      }
    });
    bus.on('economy:spend_keys', ({ keys }) => {
      if (this.state.keys < keys) return;
      this.state.keys -= keys;
      this.announce();
    });
    // The one-time free Ember Spark is a SAVE fact, not a browser-session one:
    // sessionStorage survived game resets, so replays lost their FREE card and
    // the tutorial's buy_energy step could never be completed.
    bus.on('marketplace:purchased', ({ free }) => {
      if (free && this.state.stat('freeSparkUsed') === 0) this.state.addStat('freeSparkUsed', 1);
    });
    bus.on('ui:sell_requested', ({ itemId }) => this.sell(itemId));
  }

  sellValue(chain: string, tier: number): number {
    return (
      this.chains.chains.find((c) => c.id === chain)?.tiers.find((t) => t.tier === tier)?.sell ?? 0
    );
  }

  private sell(itemId: number): void {
    const item = this.state.items.get(itemId);
    if (!item || item.kind !== 'item') return;
    // Story items (the Golden Egg/Elder) are promises, not merchandise.
    const tier = this.chains.chains
      .find((c) => c.id === item.chain)
      ?.tiers.find((t) => t.tier === item.tier);
    if (tier?.sellable === false) return;
    const value = this.sellValue(item.chain, item.tier);
    this.bus.emit('board:consume_items', { itemIds: [itemId], reason: 'sold' });
    this.state.coins += value;
    this.bus.emit('item:sold', { itemId, coins: value });
    this.announce();
  }

  private announce(): void {
    this.bus.emit('economy:changed', {
      coins: this.state.coins,
      keys: this.state.keys,
      xp: this.state.xp,
      level: this.state.level
    });
  }
}
