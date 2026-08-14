import { orderGiveKey, WORLD_ID } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { OrderConfig, OrdersData } from '../core/types';

/** How many orders the Ledger surfaces at once (MECHANICS §11 says 3–4 in the
 *  full game; two gives the demo its choose-what-to-chase agency). */
export const VISIBLE_ORDERS = 2;

/**
 * Eleanor's Ledger. Up to VISIBLE_ORDERS uncompleted orders are active at once:
 * first the scripted list, then an endless encore queue synthesised from the
 * `repeatable` templates (ids `encore_1`, `encore_2`, …) so the Ledger never
 * dead-ends. Progress derives from live board counts; delivery consumes
 * matching items and pays out via the economy.
 */
export class OrderSystem {
  constructor(
    private state: GameState,
    private bus: EventBus,
    private orders: OrdersData
  ) {
    bus.on('ui:deliver_requested', ({ orderId }) => this.deliver(orderId));
    bus.on('order:give', ({ characterId, chain, tier }) => this.takeGive(characterId, chain, tier));
    bus.on('item:spawned', () => this.announceProgress());
    bus.on('item:merged', () => this.announceProgress());
    bus.on('item:produced', () => this.announceProgress());
    bus.on('item:removed', () => this.announceProgress());
    bus.on('region:unlocked', () => this.announceProgress());
    bus.on('state:loaded', () => this.announceProgress());
    // Travel changes BOTH the list and the board it is counted against, so the
    // Ledger has to re-announce or the north opens showing the south's tallies.
    bus.on('world:switched', () => this.announceProgress());
  }

  /** Is this order's giver standing where the Keeper is? */
  private here(order: { world?: string }): boolean {
    return (order.world ?? WORLD_ID) === this.state.worldId;
  }

  /**
   * Encore ids, namespaced per world past the authored one.
   *
   * `completedOrderIds` is one global list, so two worlds both minting
   * `encore_1` would have the north's first encore struck off by the south's.
   * Emberkeep keeps the bare form it has always written, because every save in
   * the wild has those ids in it and a rename would silently restart its Ledger.
   */
  private encoreId(n: number): string {
    return this.state.worldId === WORLD_ID
      ? `encore_${n}`
      : `encore_${this.state.worldId}_${n}`;
  }

  /** The nth not-yet-completed order: scripted first, then encore templates. */
  private orderAt(offset: number): OrderConfig | undefined {
    const remaining = this.orders.orders.filter(
      (o) => this.here(o) && !this.state.completedOrderIds.includes(o.id)
    );
    if (offset < remaining.length) return remaining[offset];

    const pool = (this.orders.repeatable ?? []).filter((o) => this.here(o));
    if (pool.length === 0) return undefined;
    // Walk the encore sequence, skipping ids already delivered (either visible
    // encore may complete first, so skip by id — not by count).
    let skip = offset - remaining.length;
    for (let n = 0; n < this.state.completedOrderIds.length + skip + 1; n++) {
      const id = this.encoreId(n + 1);
      if (this.state.completedOrderIds.includes(id)) continue;
      if (skip === 0) return { ...pool[n % pool.length]!, id };
      skip--;
    }
    return undefined;
  }

  /** The primary (first) active order — kept for the e2e text render. */
  get activeOrder(): OrderConfig | undefined {
    return this.orderAt(0);
  }

  /** The authored, once-only orders in ladder order. Read-only: QuestSystem and
   *  the availability audit resolve an order id through this rather than
   *  re-importing orders.json, so there is one definition of the scripted list. */
  get scripted(): readonly OrderConfig[] {
    return this.orders.orders;
  }

  /** The encore templates, with their synthesised-id shape stripped. The tail of
   *  the quest ladder tracks whichever of these the Ledger is showing, so its
   *  reachability audit has to cover EVERY template, not just the visible one. */
  get encorePool(): readonly Omit<OrderConfig, 'id'>[] {
    return this.orders.repeatable ?? [];
  }

  /**
   * Whose Ledger this is, in the world the Keeper is standing in — the giver of
   * this world's authored orders (Selyna in Borealis, Eleanor at home).
   * Data-derived so a third world with a third host needs no code change; the
   * fallback only matters for a world with no orders at all.
   */
  get giverHere(): string {
    const owned = [...this.orders.orders, ...(this.orders.repeatable ?? [])].find((o) =>
      this.here(o)
    );
    return owned?.giver ?? 'eleanor';
  }

  /** The orders the Ledger shows, in priority order. */
  get activeOrders(): OrderConfig[] {
    const out: OrderConfig[] = [];
    for (let i = 0; i < VISIBLE_ORDERS; i++) {
      const order = this.orderAt(i);
      if (order) out.push(order);
    }
    return out;
  }

  /** Pieces already GIVEN (hand to hand) toward one requirement of `order`. */
  private banked(order: OrderConfig, chain: string, tier: number): number {
    return this.state.stat(orderGiveKey(order.id, chain, tier));
  }

  /** Progress counts the board AND what has been given hand-to-hand — the two
   *  verbs pay into one tally, which is what makes them interchangeable. */
  progressFor(order: OrderConfig): { have: number[]; need: number[]; deliverable: boolean } {
    const have = order.requires.map((req) =>
      Math.min(
        this.state.countItems(req.chain, req.tier) + this.banked(order, req.chain, req.tier),
        req.count
      )
    );
    const need = order.requires.map((req) => req.count);
    const deliverable = order.requires.every(
      (req, i) => (have[i] ?? 0) >= req.count
    );
    return { have, need, deliverable };
  }

  /**
   * The visible order of this giver that still needs `chain:tier` beyond what
   * has already been given toward it — the read RegardSystem's give gesture
   * asks before turning a gift into a delivery payment. Null = no such order,
   * and the give falls through to a decline.
   */
  giveTarget(characterId: string, chain: string, tier: number): OrderConfig | null {
    for (const order of this.activeOrders) {
      if (order.giver !== characterId) continue;
      const open = order.requires.some(
        (req) =>
          req.chain === chain && req.tier === tier && this.banked(order, chain, tier) < req.count
      );
      if (open) return order;
    }
    return null;
  }

  /**
   * A give gesture paid one piece toward this giver's order (`order:give`).
   * Bank it; the moment every requirement is FULLY given the order completes on
   * the spot — handing over the last piece IS the delivery, no button needed.
   */
  private takeGive(characterId: string, chain: string, tier: number): void {
    const order = this.giveTarget(characterId, chain, tier);
    if (!order) return;
    this.state.addStat(orderGiveKey(order.id, chain, tier), 1);
    const fullyGiven = order.requires.every(
      (req) => this.banked(order, req.chain, req.tier) >= req.count
    );
    if (fullyGiven) this.complete(order, []);
    else this.announceProgress();
  }

  announceProgress(): void {
    for (const order of this.activeOrders) {
      const { have, need, deliverable } = this.progressFor(order);
      this.bus.emit('order:progress', { orderId: order.id, have, need, deliverable });
    }
  }

  private deliver(orderId: string): void {
    const order = this.activeOrders.find((o) => o.id === orderId);
    if (!order) return;
    const { deliverable } = this.progressFor(order);
    if (!deliverable) return;

    // Only the REMAINDER comes off the board: whatever was already given hand
    // to hand is banked and must not be collected twice.
    const consumeIds: number[] = [];
    for (const req of order.requires) {
      const remaining = Math.max(0, req.count - this.banked(order, req.chain, req.tier));
      const matches = this.state
        .itemsMatching(req.chain, req.tier)
        .sort((a, b) => a.id - b.id)
        .slice(0, remaining);
      consumeIds.push(...matches.map((m) => m.id));
    }
    this.complete(order, consumeIds);
  }

  /** Pay the order out — shared by the Deliver button and a fully-given order.
   *  Clears the give bank so a repeatable's encore starts from zero. */
  private complete(order: OrderConfig, consumeIds: number[]): void {
    if (consumeIds.length) {
      this.bus.emit('board:consume_items', { itemIds: consumeIds, reason: 'delivered' });
    }
    for (const req of order.requires) {
      const banked = this.banked(order, req.chain, req.tier);
      if (banked) this.state.addStat(orderGiveKey(order.id, req.chain, req.tier), -banked);
    }
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
      this.bus.emit('order:all_done', {}); // only possible with an empty repeatable pool
    } else {
      this.announceProgress();
    }
  }
}
