import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { OrderConfig, OrderOption, OrdersData } from '../core/types';

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
    bus.on('ui:deliver_requested', ({ orderId, optionIndex }) => this.deliver(orderId, optionIndex));
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

  /** True if this option can be delivered right now (items on the board and/or
   *  enough coins in the purse). */
  optionDeliverable(opt: OrderOption): boolean {
    if (opt.requires) {
      for (const req of opt.requires) {
        if (this.state.countItems(req.chain, req.tier) < req.count) return false;
      }
    }
    if (opt.costCoins != null && this.state.coins < opt.costCoins) return false;
    return true;
  }

  private deliver(orderId: string, optionIndex?: number): void {
    const order = this.activeOrder;
    if (!order || order.id !== orderId) return;

    // Multi-option order: fulfil the chosen option (items and/or coins) and
    // complete the whole order — the player only ever picks one path.
    if (order.options && order.options.length > 0) {
      const opt = order.options[optionIndex ?? 0];
      if (!opt || !this.optionDeliverable(opt)) return;
      if (opt.requires) {
        const consumeIds: number[] = [];
        for (const req of opt.requires) {
          const matches = this.state
            .itemsMatching(req.chain, req.tier)
            .sort((a, b) => a.id - b.id)
            .slice(0, req.count);
          consumeIds.push(...matches.map((m) => m.id));
        }
        if (consumeIds.length > 0) {
          this.bus.emit('board:consume_items', { itemIds: consumeIds, reason: 'delivered' });
        }
      }
      // Pay the reward net of any coin cost, in one economy op (so the cost and
      // the payout settle atomically and a coins-only reward can't level up).
      this.bus.emit('economy:add', {
        coins: (opt.rewards.coins ?? 0) - (opt.costCoins ?? 0),
        keys: opt.rewards.keys ?? 0,
        xp: opt.rewards.xp,
        reason: `order:${order.id}:${optionIndex ?? 0}`
      });
      if (opt.rewards.spawn) {
        this.bus.emit('board:spawn', { ...opt.rewards.spawn });
      }
      this.completeOrder(order, {
        coins: opt.rewards.coins ?? 0,
        keys: opt.rewards.keys ?? 0,
        xp: opt.rewards.xp
      });
      return;
    }

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
    this.completeOrder(order, order.rewards);
  }

  /** Shared completion tail: record, announce, advance to the next order. */
  private completeOrder(
    order: OrderConfig,
    rewards: { coins: number; keys: number; xp?: number }
  ): void {
    this.state.completedOrderIds.push(order.id);
    this.bus.emit('order:completed', { orderId: order.id, rewards });
    if (!this.activeOrder) {
      this.bus.emit('order:all_done', {});
    } else {
      this.announceProgress();
    }
  }
}
