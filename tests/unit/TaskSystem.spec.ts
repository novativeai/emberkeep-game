import { describe, expect, it } from 'vitest';
import { capture, createTestContext } from './helpers';

describe("TaskSystem (Keeper's Tasks — the encore checklist)", () => {
  it('counts hatches, merges, orders, gold and elder communes into GameState.stats', () => {
    const ctx = createTestContext();
    ctx.bus.emit('item:hatched', {
      item: { id: 1, chain: 'ember_dragon', tier: 3, col: 1, row: 1, kind: 'item' }
    });
    ctx.bus.emit('economy:add', { coins: 40, reason: 'test' });
    ctx.bus.emit('item:sold', { itemId: 9, coins: 5 });
    ctx.bus.emit('elder:tapped', { itemId: 3 });

    expect(ctx.state.stat('hatches')).toBe(1);
    expect(ctx.state.stat('goldEarned')).toBe(45);
    expect(ctx.state.stat('elderTaps')).toBe(1);
  });

  it('negative coin adds (skip costs) never count as gold earned', () => {
    const ctx = createTestContext();
    ctx.state.coins = 50;
    ctx.bus.emit('economy:add', { coins: -9, reason: 'skip_cooldown' });
    expect(ctx.state.stat('goldEarned')).toBe(0);
  });

  it('pays the reward bundle exactly ONCE when every task completes', () => {
    const ctx = createTestContext();
    const done = capture(ctx.bus, 'tasks:all_complete');
    const item = { id: 1, chain: 'ember_dragon', tier: 3, col: 1, row: 1, kind: 'item' as const };

    // Drive every counter past its target.
    for (let i = 0; i < 4; i++) ctx.bus.emit('item:hatched', { item });
    for (let i = 0; i < 30; i++)
      ctx.bus.emit('item:merged', {
        chain: 'sparkweed', fromTier: 1, resultTier: 2, at: { col: 1, row: 1 },
        consumedIds: [], consumedAt: [], outputs: [], xp: 0
      });
    for (let i = 0; i < 5; i++)
      ctx.bus.emit('order:completed', { orderId: `o${i}`, rewards: { coins: 0, keys: 0 } });
    ctx.bus.emit('economy:add', { coins: 500, reason: 'test' });
    const coinsAtComplete = ctx.state.coins;
    for (let i = 0; i < 10; i++) ctx.bus.emit('elder:tapped', { itemId: 2 });

    expect(done).toHaveLength(1);
    expect(ctx.state.stat('tasksClaimed')).toBe(1);
    expect(ctx.state.coins).toBe(coinsAtComplete + 150); // the golden bundle

    // More activity never re-fires the reward.
    ctx.bus.emit('elder:tapped', { itemId: 2 });
    ctx.bus.emit('item:hatched', { item });
    expect(done).toHaveLength(1);
  });

  it('the Elder task reads locked until her order is delivered AND Level 3', () => {
    const ctx = createTestContext();
    const elderTask = ctx.systems.tasks.tasks.find((t) => t.kind === 'elderTaps')!;
    expect(elderTask.lockedUntil).toEqual({ order: 'cindra_brazier', level: 3 });

    expect(ctx.systems.tasks.isLocked(elderTask)).toBe(true);
    ctx.state.completedOrderIds.push('cindra_brazier');
    expect(ctx.systems.tasks.isLocked(elderTask)).toBe(true); // still below Level 3
    ctx.state.xp = 220; // LEVEL_XP[2] — Keeper Level 3
    expect(ctx.systems.tasks.isLocked(elderTask)).toBe(false);

    // Ungated tasks are never locked.
    const merges = ctx.systems.tasks.tasks.find((t) => t.kind === 'merges')!;
    expect(ctx.systems.tasks.isLocked(merges)).toBe(false);
  });
});
