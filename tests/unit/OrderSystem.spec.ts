import { describe, expect, it } from 'vitest';
import ordersDoc from '../../src/data/orders.json';
import type { OrdersData } from '../../src/core/types';
import { capture, createTestContext } from './helpers';

/** Every scripted order, in file order — the list the encore begins after.
 *  Derived, because the ladder gains orders as it grows and a hard-coded five
 *  turns this invariant into a stale literal. */
const SCRIPTED_ORDER_IDS = (ordersDoc as unknown as OrdersData).orders.map((o) => o.id);

/** Spawn `count` flame_gem tier 1 items filling the active cells (cols 1-5, rows 1-5). */
function spawnGemShards(ctx: ReturnType<typeof createTestContext>, count: number): void {
  for (let i = 0; i < count; i++) {
    const col = (i % 5) + 1;
    const row = Math.floor(i / 5) + 1;
    ctx.systems.board.spawn('flame_gem', 1, col, row, 'init');
  }
}

describe('OrderSystem', () => {
  it('reports live progress from board counts', () => {
    const ctx = createTestContext();
    const progress = capture(ctx.bus, 'order:progress');

    // 3 gem shards — progress but not yet deliverable
    spawnGemShards(ctx, 3);
    const brazier = progress.filter((p) => p.orderId === 'eleanor_brazier').at(-1);
    expect(brazier).toMatchObject({
      orderId: 'eleanor_brazier',
      have: [3],
      need: [6],
      deliverable: false
    });

    // 3 more — exactly 6, now deliverable
    for (let i = 3; i < 6; i++) {
      const col = (i % 5) + 1;
      const row = Math.floor(i / 5) + 1;
      ctx.systems.board.spawn('flame_gem', 1, col, row, 'init');
    }
    const done = progress.filter((p) => p.orderId === 'eleanor_brazier').at(-1);
    expect(done).toMatchObject({ have: [6], deliverable: true });
  });

  it('surfaces TWO orders at once (choose what to chase)', () => {
    const ctx = createTestContext();
    const visible = ctx.systems.order.activeOrders;
    expect(visible.map((o) => o.id)).toEqual(['eleanor_brazier', 'eleanor_hearth']);
  });

  it('delivery consumes the required items; the golden egg is an ALTAR event, not a board spawn', () => {
    const ctx = createTestContext();
    spawnGemShards(ctx, 6);
    ctx.systems.board.spawn('sparkweed', 1, 1, 5, 'init'); // bystander — must not be consumed
    const completed = capture(ctx.bus, 'order:completed');
    const removed = capture(ctx.bus, 'item:removed');
    const spawned = capture(ctx.bus, 'board:spawn');

    ctx.bus.emit('ui:deliver_requested', { orderId: 'eleanor_brazier' });

    expect(completed).toHaveLength(1);
    expect(completed[0]!.rewards).toMatchObject({ coins: 25, keys: 0, xp: 30, tease: '🥚 ???' });
    expect(removed).toHaveLength(6);
    expect(ctx.state.coins).toBe(25);
    expect(ctx.state.keys).toBe(0);
    expect(ctx.state.xp).toBe(30);
    expect(ctx.state.countItems('flame_gem', 1)).toBe(0);
    // The Golden Egg appears on the scenic ALTAR (BoardScene fixture, derived
    // from completedOrderIds) — nothing is spawned onto the merge board.
    expect(spawned).toHaveLength(0);
    expect(ctx.state.countItems('golden_egg', 1)).toBe(0);
    expect(ctx.state.completedOrderIds).toContain('eleanor_brazier');
    expect(ctx.systems.order.activeOrder?.id).toBe('eleanor_hearth');
  });

  it('either visible order can be delivered first', () => {
    const ctx = createTestContext();
    // Fill the SECOND order (3× flame_gem t2) while the first stays open.
    for (let i = 0; i < 3; i++) ctx.systems.board.spawn('flame_gem', 2, i + 1, 1, 'init');
    ctx.bus.emit('ui:deliver_requested', { orderId: 'eleanor_hearth' });
    expect(ctx.state.completedOrderIds).toEqual(['eleanor_hearth']);
    // The first order remains active; the third slides into view.
    expect(ctx.systems.order.activeOrders.map((o) => o.id)).toEqual([
      'eleanor_brazier',
      'eleanor_moonwater'
    ]);
  });

  it('refuses delivery when requirements are not met', () => {
    const ctx = createTestContext();
    spawnGemShards(ctx, 2); // only 2 of the 6 required
    const completed = capture(ctx.bus, 'order:completed');

    ctx.bus.emit('ui:deliver_requested', { orderId: 'eleanor_brazier' });

    expect(completed).toHaveLength(0);
    expect(ctx.state.coins).toBe(0);
    expect(ctx.state.countItems('flame_gem', 1)).toBe(2);
  });

  it('the order queue advances: completing one surfaces the next', () => {
    const ctx = createTestContext();
    expect(ctx.systems.order.activeOrder?.id).toBe('eleanor_brazier');

    spawnGemShards(ctx, 6);
    ctx.bus.emit('ui:deliver_requested', { orderId: 'eleanor_brazier' });

    expect(ctx.state.completedOrderIds).toContain('eleanor_brazier');
    expect(ctx.systems.order.activeOrder?.id).toBe('eleanor_hearth');
  });

  it('NEVER dead-ends: encore orders generate after the scripted list', () => {
    const ctx = createTestContext();
    // Complete every scripted order directly (state-level shortcut). Derived
    // from orders.json rather than listed: the ladder gains orders as it grows,
    // and a hard-coded five turns this invariant into a stale literal.
    for (const o of SCRIPTED_ORDER_IDS) ctx.state.completedOrderIds.push(o);
    const encore = ctx.systems.order.activeOrders;
    expect(encore.map((o) => o.id)).toEqual(['encore_1', 'encore_2']);
    expect(encore[0]!.requires.length).toBeGreaterThan(0);

    // Deliver encore_1 (8× flame_gem t1 per the repeatable pool).
    spawnGemShards(ctx, 8);
    ctx.bus.emit('ui:deliver_requested', { orderId: 'encore_1' });
    expect(ctx.state.completedOrderIds).toContain('encore_1');
    expect(ctx.systems.order.activeOrders.map((o) => o.id)).toEqual(['encore_2', 'encore_3']);
  });

  it('encore ids skip completed ones even out of order', () => {
    const ctx = createTestContext();
    for (const o of SCRIPTED_ORDER_IDS) ctx.state.completedOrderIds.push(o);
    // Deliver the SECOND visible encore first (encore_2 = 2× flame_gem t2).
    for (let i = 0; i < 2; i++) ctx.systems.board.spawn('flame_gem', 2, i + 1, 1, 'init');
    ctx.bus.emit('ui:deliver_requested', { orderId: 'encore_2' });
    expect(ctx.systems.order.activeOrders.map((o) => o.id)).toEqual(['encore_1', 'encore_3']);
  });

  it('ignores delivery for a non-active order id', () => {
    const ctx = createTestContext();
    spawnGemShards(ctx, 6);

    ctx.bus.emit('ui:deliver_requested', { orderId: 'nonsense' });

    expect(ctx.state.coins).toBe(0);
    expect(ctx.state.countItems('flame_gem', 1)).toBe(6);
  });
});

describe('give and Deliver are one verb in two grammars', () => {
  /** Pocket a shard and hand it to Eleanor, the way the bag's Give does. */
  const giveShard = (ctx: ReturnType<typeof createTestContext>): void => {
    ctx.bus.emit('ui:gift_requested', { characterId: 'eleanor', chain: 'flame_gem', tier: 1 });
  };

  it('a give banks toward the giver’s live order and lights the Deliver button', () => {
    const ctx = createTestContext();
    const progress = capture(ctx.bus, 'order:progress');
    // Two given hand to hand + four standing on the board = a full brazier.
    giveShard(ctx);
    giveShard(ctx);
    spawnGemShards(ctx, 4);
    const brazier = progress.filter((p) => p.orderId === 'eleanor_brazier').at(-1);
    expect(brazier).toMatchObject({ have: [6], need: [6], deliverable: true });

    // The button consumes only the REMAINDER — what was given is not on the
    // board and must not be collected twice.
    ctx.bus.emit('ui:deliver_requested', { orderId: 'eleanor_brazier' });
    expect(ctx.state.completedOrderIds).toContain('eleanor_brazier');
    expect(ctx.state.countItems('flame_gem', 1)).toBe(0);
  });

  it('giving EVERY required piece completes the order by itself — no button', () => {
    const ctx = createTestContext();
    const completed = capture(ctx.bus, 'order:completed');
    for (let i = 0; i < 6; i++) giveShard(ctx);
    expect(completed.map((c) => c.orderId)).toContain('eleanor_brazier');
    // The reward pays exactly as a button delivery would.
    expect(ctx.state.coins).toBe(25);
    // The bank is spent by the completion: the NEXT order of the same piece
    // starts from zero, not from the old change.
    const hearth = ctx.systems.order.activeOrders.find((o) => o.id === 'eleanor_hearth')!;
    expect(ctx.systems.order.progressFor(hearth).have.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('a give never pays a piece the giver’s orders do not ask for', () => {
    const ctx = createTestContext();
    const declined = capture(ctx.bus, 'regard:gift_declined');
    ctx.bus.emit('ui:gift_requested', { characterId: 'eleanor', chain: 'quartz', tier: 1 });
    expect(declined.at(-1)).toMatchObject({ reason: 'not_wanted' });
    expect(ctx.state.completedOrderIds).toHaveLength(0);
  });

  it('the Deliver verb pays a GIFT step straight off the board', () => {
    const ctx = createTestContext();
    // `what_she_will_take` asks Selyna for 3 Ground Lenses — the keepsake ask
    // that stays a GIFT (Eleanor's baskets are a delivery now).
    expect(ctx.systems.regard.wants('selyna', 'orrery', 1)).toBe(true);
    for (let i = 0; i < 3; i++) ctx.systems.board.spawn('orrery', 1, i + 1, 1, 'init');
    const accepted = capture(ctx.bus, 'regard:gift_accepted');

    ctx.bus.emit('ui:gift_deliver_requested', { characterId: 'selyna', chain: 'orrery', tier: 1 });

    // Every piece handed over exactly as three bag gives would be: counter,
    // Regard points per piece, and the board is clear of them.
    expect(accepted).toHaveLength(3);
    expect(ctx.systems.regard.given('selyna', 'orrery', 1)).toBe(3);
    expect(ctx.state.countItems('orrery', 1)).toBe(0);
    expect(ctx.systems.regard.wants('selyna', 'orrery', 1)).toBe(false);
  });

  it('a board deliver takes only what she still wants, and a dry board takes nothing', () => {
    const ctx = createTestContext();
    for (const col of [1, 2, 3, 4]) ctx.systems.board.spawn('orrery', 1, col, 1, 'init');
    ctx.bus.emit('ui:gift_deliver_requested', { characterId: 'selyna', chain: 'orrery', tier: 1 });
    expect(ctx.state.countItems('orrery', 1)).toBe(1); // the fourth stays — she asked for three
    ctx.bus.emit('ui:gift_deliver_requested', { characterId: 'selyna', chain: 'quartz', tier: 1 });
    expect(ctx.systems.regard.given('selyna', 'quartz', 1)).toBe(0);
  });
});
