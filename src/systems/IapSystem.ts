import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { EventMap } from '../core/types';

/**
 * Applies hub-confirmed real-money purchases (`iap:grant`) exactly once.
 *
 * The latch is `stats['iap:<purchaseId>']`, which ships inside the save blob —
 * so the guard holds across every delivery path there is: the live in-game
 * bridge, the hub's page-load grant sweep (grants.ts reads the same stat off
 * the blob), and any replay caused by a lost ack. Grants go through the
 * owning systems' commands (`economy:add` / `energy:add`), never by touching
 * state here beyond the latch itself.
 */
export class IapSystem {
  constructor(
    private state: GameState,
    private bus: EventBus
  ) {
    bus.on('iap:grant', (grant) => this.apply(grant));
  }

  private apply(grant: EventMap['iap:grant']): void {
    const latch = `iap:${grant.purchaseId}`;
    if (this.state.stat(latch) > 0) return; // already delivered — absorb the replay
    this.state.addStat(latch, 1);
    if (grant.coins > 0 || grant.keys > 0) {
      this.bus.emit('economy:add', {
        coins: grant.coins > 0 ? grant.coins : undefined,
        keys: grant.keys > 0 ? grant.keys : undefined,
        reason: `iap:${grant.packId}`
      });
    }
    if (grant.energy > 0) {
      this.bus.emit('energy:add', { amount: grant.energy, reason: `iap:${grant.packId}` });
    }
    this.bus.emit('iap:completed', { ...grant });
  }
}
