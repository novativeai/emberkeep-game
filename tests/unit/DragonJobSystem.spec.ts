import { describe, expect, it } from 'vitest';
import { createTestContext } from './helpers';

describe('DragonJobSystem (dragon jobs)', () => {
  it('a working dragon pulls the House timer forward (+1× per worker), then tires → rests', () => {
    const ctx = createTestContext();
    const house = ctx.state.addItem({ chain: 'lumber', tier: 2, col: 2, row: 2, kind: 'item' });
    const dragon = ctx.state.addItem({ chain: 'emerald', tier: 3, col: 4, row: 4, kind: 'item' });

    ctx.bus.emit('time:advanced', { ms: 0 }); // arm the House passive timer
    const before = house.passiveAt!;
    expect(before).toBeGreaterThan(ctx.clock.now());

    ctx.bus.emit('dragon:work', { dragonId: dragon.id, houseId: house.id });
    expect(ctx.systems.jobs.workersFor(house.id)).toBe(1);
    expect(ctx.systems.jobs.isWorking(dragon.id)).toBe(true);

    // 10s pass → one worker advances the timer an EXTRA 10s (global speed-up).
    ctx.clock.advance(10_000);
    ctx.bus.emit('time:advanced', { ms: 10_000 });
    expect(house.passiveAt!).toBe(before - 10_000);

    // After the 3-minute work shift it tires and starts resting.
    ctx.clock.advance(180_001);
    ctx.bus.emit('time:advanced', { ms: 180_001 });
    expect(ctx.systems.jobs.isWorking(dragon.id)).toBe(false);
    expect(ctx.systems.jobs.restRemaining(dragon.id)).toBeGreaterThan(0);
  });

  it('the speed-up is GLOBAL — it advances every timed object, not just the assigned one', () => {
    const ctx = createTestContext();
    const house = ctx.state.addItem({ chain: 'lumber', tier: 2, col: 2, row: 2, kind: 'item' });
    const tree = ctx.state.addItem({ chain: 'bigtree', tier: 1, col: 6, row: 6, kind: 'item' });
    const dragon = ctx.state.addItem({ chain: 'emerald', tier: 3, col: 4, row: 4, kind: 'item' });
    ctx.bus.emit('time:advanced', { ms: 0 }); // arm both buildings
    const houseBefore = house.passiveAt!;
    const treeBefore = tree.passiveAt!;

    ctx.bus.emit('dragon:work', { dragonId: dragon.id, houseId: house.id }); // assigned to the house
    ctx.clock.advance(10_000);
    ctx.bus.emit('time:advanced', { ms: 10_000 });

    expect(house.passiveAt!).toBe(houseBefore - 10_000); // the assigned one
    expect(tree.passiveAt!).toBe(treeBefore - 10_000); // AND the tree it never touched
  });

  it('a tired (resting) dragon cannot be put back to work until it has rested', () => {
    const ctx = createTestContext();
    const house = ctx.state.addItem({ chain: 'lumber', tier: 2, col: 2, row: 2, kind: 'item' });
    const dragon = ctx.state.addItem({ chain: 'emerald', tier: 3, col: 4, row: 4, kind: 'item' });
    ctx.bus.emit('dragon:work', { dragonId: dragon.id, houseId: house.id });
    ctx.clock.advance(180_001);
    ctx.bus.emit('time:advanced', { ms: 180_001 }); // 3 min work → resting
    expect(ctx.systems.jobs.restRemaining(dragon.id)).toBeGreaterThan(0);

    ctx.bus.emit('dragon:work', { dragonId: dragon.id, houseId: house.id }); // ignored while tired
    expect(ctx.systems.jobs.isWorking(dragon.id)).toBe(false);

    // Once the 5-minute rest elapses it becomes available again.
    ctx.clock.advance(300_001);
    ctx.bus.emit('time:advanced', { ms: 300_001 });
    expect(ctx.systems.jobs.restRemaining(dragon.id)).toBe(0);
  });
});
