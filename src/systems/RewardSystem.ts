import { LEVELUP_REWARD } from '../core/Constants';
import type { EventBus } from '../core/EventBus';

/**
 * Grants the level-up reward bundle. Leveling now PAYS: a full Warmth refill
 * (the genre's key beat — rescues the player exactly at the energy wall) plus
 * Gold scaling with the level reached. The celebration itself is presented by
 * the UI, which also subscribes to `keeper:leveled`.
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
    });
  }
}
