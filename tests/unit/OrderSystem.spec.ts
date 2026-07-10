import { describe, expect, it } from 'vitest';
import { capture, createTestContext } from './helpers';

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
    const brazier = progress.filter((p) => p.orderId === 'cindra_brazier').at(-1);
    expect(brazier).toMatchObject({
      orderId: 'cindra_brazier',
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
    const done = progress.filter((p) => p.orderId === 'cindra_brazier').at(-1);
    expect(done).toMatchObject({ have: [6], deliverable: true });
  });

  it('surfaces TWO orders at once (choose what to chase)', () => {
    const ctx = createTestContext();
    const visible = ctx.systems.order.activeOrders;
    expect(visible.map((o) => o.id)).toEqual(['cindra_brazier', 'cindra_hearth']);
  });

  it('delivery consumes the required items; the golden egg is an ALTAR event, not a board spawn', () => {
    const ctx = createTestContext();
    spawnGemShards(ctx, 6);
    ctx.systems.board.spawn('sparkweed', 1, 1, 5, 'init'); // bystander — must not be consumed
    const completed = capture(ctx.bus, 'order:completed');
    const removed = capture(ctx.bus, 'item:removed');
    const spawned = capture(ctx.bus, 'board:spawn');

    ctx.bus.emit('ui:deliver_requested', { orderId: 'cindra_brazier' });

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
    expect(ctx.state.completedOrderIds).toContain('cindra_brazier');
    expect(ctx.systems.order.activeOrder?.id).toBe('cindra_hearth');
  });

  it('either visible order can be delivered first', () => {
    const ctx = createTestContext();
    // Fill the SECOND order (3× flame_gem t2) while the first stays open.
    for (let i = 0; i < 3; i++) ctx.systems.board.spawn('flame_gem', 2, i + 1, 1, 'init');
    ctx.bus.emit('ui:deliver_requested', { orderId: 'cindra_hearth' });
    expect(ctx.state.completedOrderIds).toEqual(['cindra_hearth']);
    // The first order remains active; the third slides into view.
    expect(ctx.systems.order.activeOrders.map((o) => o.id)).toEqual([
      'cindra_brazier',
      'cindra_centerpiece'
    ]);
  });

  it('refuses delivery when requirements are not met', () => {
    const ctx = createTestContext();
    spawnGemShards(ctx, 2); // only 2 of the 6 required
    const completed = capture(ctx.bus, 'order:completed');

    ctx.bus.emit('ui:deliver_requested', { orderId: 'cindra_brazier' });

    expect(completed).toHaveLength(0);
    expect(ctx.state.coins).toBe(0);
    expect(ctx.state.countItems('flame_gem', 1)).toBe(2);
  });

  it('the order queue advances: completing one surfaces the next', () => {
    const ctx = createTestContext();
    expect(ctx.systems.order.activeOrder?.id).toBe('cindra_brazier');

    spawnGemShards(ctx, 6);
    ctx.bus.emit('ui:deliver_requested', { orderId: 'cindra_brazier' });

    expect(ctx.state.completedOrderIds).toContain('cindra_brazier');
    expect(ctx.systems.order.activeOrder?.id).toBe('cindra_hearth');
  });

  it('NEVER dead-ends: encore orders generate after the scripted list', () => {
    const ctx = createTestContext();
    // Complete all four scripted orders directly (state-level shortcut).
    for (const o of ['cindra_brazier', 'cindra_hearth', 'cindra_centerpiece', 'cindra_hoard']) {
      ctx.state.completedOrderIds.push(o);
    }
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
    for (const o of ['cindra_brazier', 'cindra_hearth', 'cindra_centerpiece', 'cindra_hoard']) {
      ctx.state.completedOrderIds.push(o);
    }
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
