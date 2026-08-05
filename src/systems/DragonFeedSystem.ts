import { DRAGON_FEED, DRAGON_FEED_PHASE } from '../core/Constants';
import { phaseAt } from '../core/dayCycle';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import type { ChainsData } from '../core/types';

/**
 * The dragon's LARDER and the feeding it pays for.
 *
 * The board is where food GROWS; the larder is where it waits. Tapping an Emberberry
 * BUSH (`DRAGON_FEED.stockTier`) banks it — the board piece is consumed and
 * `state.berryStock` goes up — exactly as a tapped coin is really banked. Feeding
 * then spends from the larder, never off the board: one visible stock, one place a
 * berry can be, and the HUD gauge is that number rather than a guess about what is
 * lying around.
 *
 * Feeding is a BIG beat — it jumps the dragon by `dragonLevelsPerFeed`, pays the
 * Keeper `keeperXpPerFeed`, and resets the hunger clock (`fedAt`). A dragon listed in
 * `DRAGON_FEED_PHASE` only accepts food during its hour (the Emerald takes hers at
 * dusk); the Red Dragon is unrestricted so the tutorial/quest feed never waits on the
 * sky. "Buy" spends Gold straight into the larder.
 *
 * Phaser-free — pure state + bus + virtual clock, so it unit-tests in node.
 */
export class DragonFeedSystem {
  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    private chains: ChainsData
  ) {
    bus.on('dragon:feed', ({ chain }) => this.feed(chain));
    bus.on('dragon:buy_food', ({ chain }) => this.buyFood(chain));
    bus.on('dragon:store_food', ({ itemId }) => this.store(itemId));
  }

  /** True for the ripe generator plant (the "main sprout") — never eaten, never banked. */
  private isGenerator(chain: string, tier: number): boolean {
    return !!this.chains.chains.find((c) => c.id === chain)?.tiers.find((t) => t.tier === tier)?.generator;
  }

  /** Bank one tapped bush. Silent no-op on anything that is not storable food, so a
   *  stray tap can never consume a piece the player meant to keep. */
  private store(itemId: number): void {
    const item = this.state.items.get(itemId);
    if (!item || item.kind !== 'item') return;
    if (item.chain !== DRAGON_FEED.chain || item.tier !== DRAGON_FEED.stockTier) return;
    if (this.isGenerator(item.chain, item.tier)) return;
    const at = { col: item.col, row: item.row };
    // The owning system (BoardSystem) removes it + emits item:removed.
    this.bus.emit('board:consume_items', { itemIds: [itemId], reason: 'store_food' });
    this.state.berryStock += 1;
    this.bus.emit('dragon:stock_changed', { stock: this.state.berryStock, gained: 1, at });
  }

  private feed(chain: string): void {
    // Time-of-day preference (DRAGON_FEED_PHASE): a listed dragon only takes food
    // during its hour ("she'll only take it at dusk"). Checked BEFORE the larder is
    // touched so a refused feed never spends anything.
    const wants = DRAGON_FEED_PHASE[chain];
    if (wants && phaseAt(this.clock.now()) !== wants) {
      this.bus.emit('dragon:feed_failed', { chain, reason: 'phase', requiresPhase: wants });
      return;
    }
    if (this.state.berryStock <= 0) {
      this.bus.emit('dragon:feed_failed', { chain, reason: 'no_berry' });
      return;
    }
    this.state.berryStock -= 1;
    this.bus.emit('dragon:stock_changed', { stock: this.state.berryStock, gained: -1 });
    const d = this.state.ensureDragon(chain);
    d.level += DRAGON_FEED.dragonLevelsPerFeed;
    d.gauge = 0;
    d.fedAt = this.clock.now(); // full → the hunger gauge empties, refills over hungerMs
    // Feeding also grows the game (Keeper) — XP that moves the bar where not capped.
    if (DRAGON_FEED.keeperXpPerFeed > 0) {
      this.bus.emit('economy:add', { xp: DRAGON_FEED.keeperXpPerFeed, reason: 'feed' });
    }
    this.bus.emit('dragon:fed', { chain, level: d.level });
  }

  /** Buy one berry for Gold, straight into the larder (the "via des achats" path for
   *  when the sprout's drip isn't ready). It goes where feeding looks — putting it on
   *  the board would just ask the player to tap it again. */
  private buyFood(chain: string): void {
    if (this.state.coins < DRAGON_FEED.buyGold) {
      this.bus.emit('dragon:feed_failed', { chain, reason: 'no_gold' });
      return;
    }
    this.bus.emit('economy:add', { coins: -DRAGON_FEED.buyGold, reason: 'buy_food' });
    this.state.berryStock += 1;
    this.bus.emit('dragon:stock_changed', { stock: this.state.berryStock, gained: 1 });
    this.bus.emit('dragon:food_bought', { chain });
  }
}
