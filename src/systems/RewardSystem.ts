import { LEVELUP_REWARD } from '../core/Constants';
import type { EventBus } from '../core/EventBus';

/**
 * Grants the level-up reward bundle. Leveling now PAYS: a full Warmth refill
 * (the genre's key beat — rescues the player exactly at the energy wall) plus
 * Gold scaling with the level reached — and from `chestFromLevel` on, a Bronze
 * Chest drops onto the board, carrying the ACTIVE world's gift table (a chest
 * opened in the north pays northern goods). The celebration itself is presented
 * by the UI, which also subscribes to `keeper:leveled`.
 *
 * The chest starts at Level 3 on purpose: Level 2 fires mid-tutorial on the
 * scripted `levelup` beat, and an unscripted interactive object there would
 * land on a stage the tutorial's allow-contract owns. `overflow: 'bag'` means a
 * full board banks the chest instead of eating it.
 *
 * Listening to `keeper:leveled` and emitting `economy:add` with coins only is
 * safe: coins never change the level, so this cannot re-trigger a level-up.
 */
export class RewardSystem {
  constructor(bus: EventBus) {
    bus.on('keeper:leveled', ({ level }) => {
      const coins = LEVELUP_REWARD.coinsBase + level * LEVELUP_REWARD.coinsPerLevel;
      bus.emit('economy:add', { coins, reason: `levelup:${level}` });
      bus.emit('energy:refill', { reason: `levelup:${level}` });
      if (level >= LEVELUP_REWARD.chestFromLevel) {
        bus.emit('board:spawn', { chain: 'chest', tier: 1, count: 1, overflow: 'bag' });
      }
    });
  }
}
