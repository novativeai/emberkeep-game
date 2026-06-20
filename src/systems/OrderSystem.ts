import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { OrderConfig, OrdersData } from '../core/types';

/**
 * Cindra's Ledger. The active order is the first one not yet completed.
 * Progress derives from live board counts; delivery consumes matching items
 * and pays out via the economy.
 */
export class OrderSystem {
  constructor(
    private state: GameState,
    private bus: EventBus,
    private orders: OrdersData
  ) {
    bus.on('ui:deliver_requested', ({ orderId }) => this.deliver(orderId));
    bus.on('item:spawned', () => this.announceProgress());
    bus.on('item:merged', () => this.announceProgress());
    bus.on('item:produced', () => this.announceProgress());
    bus.on('item:removed', () => this.announceProgress());
    bus.on('region:unlocked', () => this.announceProgress());
    bus.on('state:loaded', () => this.announceProgress());
  }

  get activeOrder(): OrderConfig | undefined {
    return this.orders.orders.find((o) => !this.state.completedOrderIds.includes(o.id));
  }

  progressFor(order: OrderConfig): { have: number[]; need: number[]; deliverable: boolean } {
    const have = order.requires.map((req) =>
      Math.min(this.state.countItems(req.chain, req.tier), req.count)
    );
    const need = order.requires.map((req) => req.count);
    const deliverable = order.requires.every(
      (req, i) => (have[i] ?? 0) >= req.count
    );
    return { have, need, deliverable };
  }

  announceProgress(): void {
    const order = this.activeOrder;
    if (!order) return;
    const { have, need, deliverable } = this.progressFor(order);
    this.bus.emit('order:progress', { orderId: order.id, have, need, deliverable });
  }

  private deliver(orderId: string): void {
    const order = this.activeOrder;
    if (!order || order.id !== orderId) return;
    const { deliverable } = this.progressFor(order);
    if (!deliverable) return;

    const consumeIds: number[] = [];
    for (const req of order.requires) {
      const matches = this.state
        .itemsMatching(req.chain, req.tier)
        .sort((a, b) => a.id - b.id)
        .slice(0, req.count);
      consumeIds.push(...matches.map((m) => m.id));
    }
    this.bus.emit('board:consume_items', { itemIds: consumeIds, reason: 'delivered' });
    this.bus.emit('economy:add', {
      coins: order.rewards.coins,
      keys: order.rewards.keys,
      xp: order.rewards.xp,
      reason: `order:${order.id}`
    });
    if (order.rewards.spawn) {
      this.bus.emit('board:spawn', { ...order.rewards.spawn });
    }
    this.state.completedOrderIds.push(order.id);
    this.bus.emit('order:completed', { orderId: order.id, rewards: order.rewards });
    if (!this.activeOrder) {
      this.bus.emit('order:all_done', {});
    } else {
      this.announceProgress();
    }
  }
}
