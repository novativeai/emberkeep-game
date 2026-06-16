import { describe, expect, it } from 'vitest';
import { capture, createTestContext } from './helpers';

describe('OrderSystem', () => {
  it('reports live progress from board counts', () => {
    const ctx = createTestContext();
    const progress = capture(ctx.bus, 'order:progress');

    ctx.systems.board.spawn('flame_gem', 2, 1, 1, 'init');
    expect(progress.at(-1)).toMatchObject({
      orderId: 'cindra_brazier',
      have: [1],
      need: [2],
      deliverable: false
    });

    ctx.systems.board.spawn('flame_gem', 2, 3, 3, 'init');
    expect(progress.at(-1)).toMatchObject({ have: [2], deliverable: true });
  });

  it('delivery consumes the required items and pays coins + key', () => {
    const ctx = createTestContext();
    ctx.systems.board.spawn('flame_gem', 2, 1, 1, 'init');
    ctx.systems.board.spawn('flame_gem', 2, 3, 3, 'init');
    ctx.systems.board.spawn('flame_gem', 1, 5, 5, 'init'); // bystander shard
    const completed = capture(ctx.bus, 'order:completed');
    const removed = capture(ctx.bus, 'item:removed');

    ctx.bus.emit('ui:deliver_requested', { orderId: 'cindra_brazier' });

    expect(completed).toHaveLength(1);
    expect(completed[0]!.rewards).toEqual({ coins: 50, keys: 1, xp: 20 });
    expect(removed).toHaveLength(2);
    expect(ctx.state.coins).toBe(50);
    expect(ctx.state.keys).toBe(1);
    expect(ctx.state.xp).toBe(20); // orders feed the level bar
    expect(ctx.state.countItems('flame_gem', 2)).toBe(0);
    expect(ctx.state.countItems('flame_gem', 1)).toBe(1);
    expect(ctx.state.completedOrderIds).toContain('cindra_brazier');
    expect(ctx.systems.order.activeOrder?.id).toBe('cindra_hearth'); // next in the queue
  });

  it('refuses delivery when requirements are not met', () => {
    const ctx = createTestContext();
    ctx.systems.board.spawn('flame_gem', 2, 1, 1, 'init');
    const completed = capture(ctx.bus, 'order:completed');

    ctx.bus.emit('ui:deliver_requested', { orderId: 'cindra_brazier' });

    expect(completed).toHaveLength(0);
    expect(ctx.state.coins).toBe(0);
    expect(ctx.state.countItems('flame_gem', 2)).toBe(1);
  });

  it('the order queue advances: completing one surfaces the next', () => {
    const ctx = createTestContext();
    expect(ctx.systems.order.activeOrder?.id).toBe('cindra_brazier');

    ctx.systems.board.spawn('flame_gem', 2, 1, 1, 'init');
    ctx.systems.board.spawn('flame_gem', 2, 3, 3, 'init');
    ctx.bus.emit('ui:deliver_requested', { orderId: 'cindra_brazier' });

    expect(ctx.state.completedOrderIds).toContain('cindra_brazier');
    expect(ctx.systems.order.activeOrder?.id).toBe('cindra_hearth'); // next goal in the ledger
  });

  it('ignores delivery for a non-active order id', () => {
    const ctx = createTestContext();
    ctx.systems.board.spawn('flame_gem', 2, 1, 1, 'init');
    ctx.systems.board.spawn('flame_gem', 2, 3, 3, 'init');

    ctx.bus.emit('ui:deliver_requested', { orderId: 'nonsense' });

    expect(ctx.state.coins).toBe(0);
    expect(ctx.state.countItems('flame_gem', 2)).toBe(2);
  });
});
