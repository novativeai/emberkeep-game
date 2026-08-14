import { LEVELUP_REWARD } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';

/**
 * Grants the level-up reward bundle. Leveling now PAYS: a full Warmth refill
 * (the genre's key beat — rescues the player exactly at the energy wall) plus
 * Gold scaling with the level reached — and, ONCE, a Bronze Chest drops onto
 * the board, carrying the ACTIVE world's gift table (a chest opened in the
 * north pays northern goods). The celebration itself is presented by the UI,
 * which also subscribes to `keeper:leveled`.
 *
 * ONE CHEST, EVER. The chest is a permanent fixture that recharges its own gift
 * every CHEST_INTERVAL_MS and is never consumed (ChestSystem), so a second one
 * is not a second reward — it is a duplicate of a thing the player already
 * owns, arriving unannounced on a board where space is the scarce resource.
 * Granting it per level from `chestFromLevel` up meant four of them by the
 * cap, each landing on the heels of whatever quest happened to cross the XP
 * line, which read as chests popping at random. So the grant is conditional on
 * there being none: the board is searched across EVERY world (the Keeper's
 * chest may be standing in Borealis while they level in Emberkeep) and so is
 * the bag, which is where a chest goes when the board is full.
 *
 * The chest still starts at Level 3 on purpose: Level 2 fires mid-tutorial on
 * the scripted `levelup` beat, and an unscripted interactive object there would
 * land on a stage the tutorial's allow-contract owns. `overflow: 'bag'` means a
 * full board banks it instead of eating it.
 *
 * Listening to `keeper:leveled` and emitting `economy:add` with coins only is
 * safe: coins never change the level, so this cannot re-trigger a level-up.
 */
export class RewardSystem {
  constructor(bus: EventBus, state: GameState) {
    bus.on('keeper:leveled', ({ level }) => {
      const coins = LEVELUP_REWARD.coinsBase + level * LEVELUP_REWARD.coinsPerLevel;
      bus.emit('economy:add', { coins, reason: `levelup:${level}` });
      bus.emit('energy:refill', { reason: `levelup:${level}` });
      if (level >= LEVELUP_REWARD.chestFromLevel && !RewardSystem.ownsChest(state)) {
        bus.emit('board:spawn', { chain: 'chest', tier: 1, count: 1, overflow: 'bag' });
      }
    });
  }

  /** Does the Keeper already have their chest — on any world's board, or banked
   *  in the bag? */
  private static ownsChest(state: GameState): boolean {
    for (const worldId of state.worlds.keys()) {
      for (const item of state.itemsIn(worldId)?.values() ?? []) {
        if (item.chain === 'chest') return true;
      }
    }
    return state.bag.some((stack) => stack.chain === 'chest' && stack.count > 0);
  }
}
