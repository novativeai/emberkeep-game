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

    // 10 gem shards — progress but not yet deliverable
    spawnGemShards(ctx, 10);
    expect(progress.at(-1)).toMatchObject({
      orderId: 'cindra_brazier',
      have: [10],
      need: [20],
      deliverable: false
    });

    // 10 more — exactly 20, now deliverable
    for (let i = 10; i < 20; i++) {
      const col = (i % 5) + 1;
      const row = Math.floor(i / 5) + 1;
      ctx.systems.board.spawn('flame_gem', 1, col, row, 'init');
    }
    expect(progress.at(-1)).toMatchObject({ have: [20], deliverable: true });
  });

  it('delivery consumes the required items and awards a golden egg', () => {
    const ctx = createTestContext();
    spawnGemShards(ctx, 20);
    ctx.systems.board.spawn('sparkweed', 1, 1, 5, 'init'); // bystander — must not be consumed
    const completed = capture(ctx.bus, 'order:completed');
    const removed = capture(ctx.bus, 'item:removed');
    const spawned = capture(ctx.bus, 'board:spawn');

    ctx.bus.emit('ui:deliver_requested', { orderId: 'cindra_brazier' });

    expect(completed).toHaveLength(1);
    expect(completed[0]!.rewards).toMatchObject({ coins: 0, keys: 0, xp: 30, spawn: { chain: 'golden_egg', tier: 1, count: 1 } });
    expect(removed).toHaveLength(20);
    expect(ctx.state.coins).toBe(0);
    expect(ctx.state.keys).toBe(0);
    expect(ctx.state.xp).toBe(30);
    expect(ctx.state.countItems('flame_gem', 1)).toBe(0);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ chain: 'golden_egg', tier: 1, count: 1 });
    expect(ctx.state.completedOrderIds).toContain('cindra_brazier');
    expect(ctx.systems.order.activeOrder?.id).toBe('cindra_hearth');
  });

  it('refuses delivery when requirements are not met', () => {
    const ctx = createTestContext();
    spawnGemShards(ctx, 5); // only 5 of the 20 required
    const completed = capture(ctx.bus, 'order:completed');

    ctx.bus.emit('ui:deliver_requested', { orderId: 'cindra_brazier' });

    expect(completed).toHaveLength(0);
    expect(ctx.state.coins).toBe(0);
    expect(ctx.state.countItems('flame_gem', 1)).toBe(5);
  });

  it('the order queue advances: completing one surfaces the next', () => {
    const ctx = createTestContext();
    expect(ctx.systems.order.activeOrder?.id).toBe('cindra_brazier');

    spawnGemShards(ctx, 20);
    ctx.bus.emit('ui:deliver_requested', { orderId: 'cindra_brazier' });

    expect(ctx.state.completedOrderIds).toContain('cindra_brazier');
    expect(ctx.systems.order.activeOrder?.id).toBe('cindra_hearth');
  });

  it('ignores delivery for a non-active order id', () => {
    const ctx = createTestContext();
    spawnGemShards(ctx, 20);

    ctx.bus.emit('ui:deliver_requested', { orderId: 'nonsense' });

    expect(ctx.state.coins).toBe(0);
    expect(ctx.state.countItems('flame_gem', 1)).toBe(20);
  });
});
