import { BAG_SLOTS } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { BagStack } from '../core/types';

/**
 * The Bag — the player's off-board pocket.
 *
 * Drag still means merge. A TAP on a plain merge piece stores it here; opening
 * the bag and tapping a slot puts one back on the board. Both directions are
 * free and instant: drag and tap are now two verbs on the same object, so a
 * player who taps when they meant to drag must lose nothing. There is no cost,
 * no cooldown and no confirmation anywhere in this system, and that is a design
 * rule rather than an omission.
 *
 * Capacity counts DISTINCT stacks, not items — identical chain+tier pieces pool
 * into one slot. "Twelve different things" is a far rarer (and far more
 * legible) wall than twelve objects.
 *
 * The bag never merges. It stores; the board merges. Keeping those separate is
 * what stops the bag quietly becoming a second board.
 */
export class BagSystem {
  constructor(
    private state: GameState,
    private bus: EventBus
  ) {
    bus.on('ui:store_requested', ({ itemId }) => this.store(itemId));
    bus.on('ui:bag_retrieve_requested', ({ chain, tier }) => this.retrieve(chain, tier));
    // EconomySystem owns selling and coins; the bag owns the stack. It sends
    // this command the way selling a board piece used to send
    // `board:consume_items`, so exactly one system ever writes `state.bag`.
    bus.on('bag:consume', ({ chain, tier, count }) => this.consume(chain, tier, count));
    // A reward with nowhere to land. It never stood on the board, so there is
    // nothing to consume — this is the one way into the bag that does not come
    // through it, and it exists so a finite piece cannot be lost to a full board.
    bus.on('bag:bank', ({ chain, tier, count }) => this.bank(chain, tier, count));
  }

  /** Distinct stacks held (what the capacity readout shows). */
  get used(): number {
    return this.state.bag.length;
  }

  get capacity(): number {
    return BAG_SLOTS;
  }

  get stacks(): readonly BagStack[] {
    return this.state.bag;
  }

  countOf(chain: string, tier: number): number {
    return this.state.bag.find((s) => s.chain === chain && s.tier === tier)?.count ?? 0;
  }

  /** True when this piece could be stored right now — a new stack needs a free
   *  slot, but topping up an existing stack never can be blocked. */
  canStore(chain: string, tier: number): boolean {
    return this.countOf(chain, tier) > 0 || this.state.bag.length < BAG_SLOTS;
  }

  /**
   * Put pieces straight into the bag, board untouched.
   *
   * Deliberately IGNORES `BAG_SLOTS` when the stack already exists, and refuses
   * only when a brand-new stack has no slot — the same rule `canStore` states.
   * A refusal here is a real loss, so it is announced rather than swallowed.
   */
  private bank(chain: string, tier: number, count: number): void {
    if (count <= 0) return;
    if (!this.canStore(chain, tier)) {
      this.bus.emit('bag:store_failed', { reason: 'full' });
      return;
    }
    const stack = this.state.bag.find((s) => s.chain === chain && s.tier === tier);
    if (stack) stack.count += count;
    else this.state.bag.push({ chain, tier, count });
    this.emitChanged();
  }

  /**
   * Move a board piece into the bag. The piece is consumed through BoardSystem
   * like any other removal, so the board stays the single owner of the grid —
   * this system only ever touches `state.bag`.
   */
  private store(itemId: number): void {
    const item = this.state.items.get(itemId);
    if (!item || item.kind !== 'item') return;
    if (!this.canStore(item.chain, item.tier)) {
      this.bus.emit('bag:store_failed', { reason: 'full' });
      return;
    }
    const at = { col: item.col, row: item.row };
    const stack = this.state.bag.find((s) => s.chain === item.chain && s.tier === item.tier);
    if (stack) stack.count += 1;
    else this.state.bag.push({ chain: item.chain, tier: item.tier, count: 1 });

    this.bus.emit('board:consume_items', { itemIds: [itemId], reason: 'stored' });
    this.bus.emit('bag:stored', { chain: item.chain, tier: item.tier, at });
    this.emitChanged();
  }

  /**
   * Put one back on the board. It lands on the nearest free ACTIVE tile — the
   * piece's original cell is not remembered on purpose: by the time a player
   * reopens the bag that tile is usually occupied, and a retrieval that
   * silently fails is worse than one that lands somewhere sensible.
   */
  private retrieve(chain: string, tier: number): void {
    const idx = this.state.bag.findIndex((s) => s.chain === chain && s.tier === tier);
    if (idx < 0) return;
    const stack = this.state.bag[idx]!;

    const before = this.state.items.size;
    this.bus.emit('board:spawn', { chain, tier, count: 1 });
    // BoardSystem is synchronous: if nothing appeared the board had no free
    // active tile, so the stack must NOT be debited.
    if (this.state.items.size === before) {
      this.bus.emit('bag:store_failed', { reason: 'no_room' });
      return;
    }

    stack.count -= 1;
    if (stack.count <= 0) this.state.bag.splice(idx, 1);

    const spawned = [...this.state.items.values()].at(-1)!;
    this.bus.emit('bag:retrieved', { chain, tier, at: { col: spawned.col, row: spawned.row } });
    this.emitChanged();
  }

  /** Take pieces out of the bag without putting them anywhere — the debit half
   *  of a sale. Whoever sent the command owns what happens next. */
  private consume(chain: string, tier: number, count: number): void {
    const idx = this.state.bag.findIndex((s) => s.chain === chain && s.tier === tier);
    if (idx < 0) return;
    const stack = this.state.bag[idx]!;
    stack.count -= count;
    if (stack.count <= 0) this.state.bag.splice(idx, 1);
    this.emitChanged();
  }

  private emitChanged(): void {
    this.bus.emit('bag:changed', { used: this.used, capacity: this.capacity });
  }
}
