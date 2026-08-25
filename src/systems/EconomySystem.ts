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
    // The one-time free Warmth gift is a SAVE fact, not a browser-session one:
    // sessionStorage survived game resets, so replays lost their FREE card and
    // the tutorial's buy_energy step could never be completed.
    bus.on('marketplace:purchased', ({ free }) => {
      if (free && this.state.stat('freeWarmthUsed') === 0) this.state.addStat('freeWarmthUsed', 1);
    });
    bus.on('ui:bag_sell_requested', ({ chain, tier, count }) => this.sellFromBag(chain, tier, count ?? 1));
    /**
     * A LOADED save is a wallet that changed, and nothing was saying so.
     *
     * Every gauge in the HUD is painted from `economy:changed`; a fresh game got
     * one from `BoardSystem.newGame`, but a load got none at all — so the pills
     * kept the zeros they were CONSTRUCTED with while the state underneath held
     * the player's real gold, keys and XP. It read as "the game lost my
     * progress", and it made the board and the HUD contradict each other: the
     * Gold Key badge floats off `state.keys` and correctly appeared over the
     * gate, beside a wallet insisting there were no keys.
     */
    bus.on('state:loaded', () => this.announce());
  }

  sellValue(chain: string, tier: number): number {
    return (
      this.chains.chains.find((c) => c.id === chain)?.tiers.find((t) => t.tier === tier)?.sell ?? 0
    );
  }

  /**
   * Sell one piece OUT OF THE BAG. Nothing on the board can be sold: the board's
   * verbs are drag, merge and pocket, all of them recoverable, and the one
   * irreversible verb lives behind a deliberate act of putting something aside.
   * A mis-tap can therefore never cost the player a piece.
   *
   * This system owns coins, so it owns selling; the Bag owns the stack, so the
   * debit goes out as the `bag:consume` command rather than a direct write —
   * the same split as `board:consume_items` on the board side.
   */
  /**
   * Sell `count` of a banked stack in ONE transaction.
   *
   * Clamped to what is actually held, so a stale panel — a stepper left at ten
   * while a merge ate four — pays for what exists and no more. One `item:sold`
   * carrying the whole take rather than one per piece: the event drives a
   * celebration and a quest counter, and ten of them for one gesture would
   * spam the first and is not what the second means by "a sale".
   */
  private sellFromBag(chain: string, tier: number, count = 1): void {
    const held = this.state.bag.find((s) => s.chain === chain && s.tier === tier)?.count ?? 0;
    const n = Math.min(Math.max(1, count), held);
    if (n <= 0) return;
    // Story items (the Golden Egg/Elder) are promises, not merchandise.
    const tierConfig = this.chains.chains.find((c) => c.id === chain)?.tiers.find((t) => t.tier === tier);
    if (!tierConfig || tierConfig.sellable === false) return;
    const value = this.sellValue(chain, tier) * n;
    this.bus.emit('bag:consume', { chain, tier, count: n });
    this.state.coins += value;
    this.bus.emit('item:sold', { chain, tier, coins: value });
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
