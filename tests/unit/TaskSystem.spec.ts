import { describe, expect, it } from 'vitest';
import { capture, createTestContext } from './helpers';

describe("TaskSystem (Keeper's Tasks — the encore checklist)", () => {
  it('counts hatches, merges, orders, gold and elder communes into GameState.stats', () => {
    const ctx = createTestContext();
    ctx.bus.emit('item:hatched', {
      item: { id: 1, chain: 'ember_dragon', tier: 3, col: 1, row: 1, kind: 'item' }
    });
    ctx.bus.emit('economy:add', { coins: 40, reason: 'test' });
    ctx.bus.emit('item:sold', { chain: 'cinder_vein', tier: 1, coins: 5 });
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
    const paid = capture(ctx.bus, 'economy:add');
    const item = { id: 1, chain: 'ember_dragon', tier: 3, col: 1, row: 1, kind: 'item' as const };

    // Drive every counter past its target.
    for (let i = 0; i < 20; i++) {
      ctx.bus.emit('cookbook:discovered', { chain: `c${i}`, fromTier: 1, resultTier: 2 });
    }
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
    // The golden bundle, measured on its OWN payout rather than on the wallet:
    // finishing every task also finishes the `keepers_tasks` QUEST, and that
    // pays its own reward into the same purse in the same frame.
    const bundle = paid.filter((p) => p.reason === 'tasks:complete');
    expect(bundle).toHaveLength(1);
    expect(bundle[0]!.coins).toBe(150);
    expect(ctx.state.coins).toBeGreaterThanOrEqual(coinsAtComplete + 150);

    // More activity never re-fires the reward.
    ctx.bus.emit('elder:tapped', { itemId: 2 });
    ctx.bus.emit('item:hatched', { item });
    expect(done).toHaveLength(1);
  });

  it('the Elder task reads locked until her order is delivered AND Level 3', () => {
    const ctx = createTestContext();
    const elderTask = ctx.systems.tasks.tasks.find((t) => t.kind === 'elderTaps')!;
    expect(elderTask.lockedUntil).toEqual({ order: 'eleanor_brazier', level: 3 });

    expect(ctx.systems.tasks.isLocked(elderTask)).toBe(true);
    ctx.state.completedOrderIds.push('eleanor_brazier');
    expect(ctx.systems.tasks.isLocked(elderTask)).toBe(true); // still below Level 3
    ctx.state.xp = 220; // LEVEL_XP[2] — Keeper Level 3
    expect(ctx.systems.tasks.isLocked(elderTask)).toBe(false);

    // Ungated tasks are never locked.
    const merges = ctx.systems.tasks.tasks.find((t) => t.kind === 'merges')!;
    expect(ctx.systems.tasks.isLocked(merges)).toBe(false);
  });
});

describe('the Cookbook task — the counter that replaced "Hatch 4 dragons"', () => {
  it('counts a first-time recipe, and nothing else', () => {
    const ctx = createTestContext();
    const task = ctx.systems.tasks.tasks.find((t) => t.id === 'recipes_20')!;
    expect(ctx.systems.tasks.progressFor(task)).toBe(0);

    for (let i = 0; i < 3; i++) {
      ctx.bus.emit('cookbook:discovered', { chain: 'flame_gem', fromTier: 1, resultTier: 2 });
    }
    expect(ctx.systems.tasks.progressFor(task)).toBe(3);

    // A merge that discovers nothing new must not move it. MergeSystem only
    // emits `cookbook:discovered` on a FIRST merge of that pair, which is what
    // makes the target safe to put a number on: it cannot be farmed.
    ctx.bus.emit('item:merged', {
      chain: 'flame_gem', fromTier: 1, resultTier: 2, at: { col: 0, row: 0 },
      consumedIds: [], consumedAt: [], outputs: [], xp: 0
    });
    expect(ctx.systems.tasks.progressFor(task)).toBe(3);
  });

  /** The bug this task exists to avoid: a checklist target that quietly stops
   *  being attainable when the design around it changes. */
  it('no Keeper’s Task asks for more dragons than the chapter means to give', () => {
    const hatchTasks = ctx0().systems.tasks.tasks.filter((t) => t.kind === 'hatches');
    expect(hatchTasks).toEqual([]);
  });
});

function ctx0(): ReturnType<typeof createTestContext> {
  return createTestContext();
}
