import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { MilestoneConfig, MilestonesData } from '../core/types';

/**
 * Milestone "gifts" (Farmland-style). The active milestone is the first one not
 * yet claimed; progress derives from the live board count of its chain+tier. When
 * the player has enough, the gift is READY — tapping it (a `milestone:claim`
 * intent from the HUD) pays out the coins, marks it claimed, and advances to the
 * next one. Phaser-free, so it runs in the node unit tests.
 */
export class MilestoneSystem {
  constructor(
    private state: GameState,
    private bus: EventBus,
    private data: MilestonesData
  ) {
    bus.on('milestone:claim', () => this.claim());
    bus.on('item:spawned', () => this.announce());
    bus.on('item:merged', () => this.announce());
    bus.on('item:produced', () => this.announce());
    bus.on('item:removed', () => this.announce());
    bus.on('state:loaded', () => this.announce());
  }

  /** The first milestone the player hasn't claimed yet (undefined when all done). */
  get active(): MilestoneConfig | undefined {
    return this.data.milestones.find((m) => !this.state.claimedMilestoneIds.includes(m.id));
  }

  /** Board count toward the active milestone, capped at its target. */
  private have(m: MilestoneConfig): number {
    return Math.min(this.state.countItems(m.chain, m.tier), m.count);
  }

  /** Broadcast the current gift state so the HUD can render/animate it. */
  announce(): void {
    const m = this.active;
    if (!m) {
      this.bus.emit('milestone:changed', {
        id: null,
        chain: '',
        tier: 0,
        have: 0,
        need: 0,
        coins: 0,
        ready: false,
        done: true
      });
      return;
    }
    const have = this.have(m);
    this.bus.emit('milestone:changed', {
      id: m.id,
      chain: m.chain,
      tier: m.tier,
      have,
      need: m.count,
      coins: m.coins,
      ready: have >= m.count,
      done: false
    });
  }

  private claim(): void {
    const m = this.active;
    if (!m || this.have(m) < m.count) return; // nothing ready to claim
    this.bus.emit('economy:add', { coins: m.coins, reason: 'milestone' });
    this.state.claimedMilestoneIds.push(m.id);
    this.bus.emit('milestone:claimed', { id: m.id, coins: m.coins });
    this.announce(); // surface the next gift
  }
}
