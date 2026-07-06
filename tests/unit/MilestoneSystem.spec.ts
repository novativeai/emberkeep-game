import { describe, expect, it } from 'vitest';
import { capture, createTestContext } from './helpers';

// The first milestone in src/data/milestones.json is "houses_3": 3 × lumber t2 → 50 coins.

describe('MilestoneSystem (Farmland-style gift)', () => {
  it('announces the active gift + live progress, ready only at the target', () => {
    const ctx = createTestContext();
    const changes = capture(ctx.bus, 'milestone:changed');

    ctx.state.addItem({ chain: 'lumber', tier: 2, col: 2, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'lumber', tier: 2, col: 3, row: 3, kind: 'item' });
    ctx.systems.milestone.announce();
    let last = changes.at(-1)!;
    expect(last).toMatchObject({ id: 'houses_3', chain: 'lumber', tier: 2, have: 2, need: 3, coins: 50, ready: false });

    ctx.state.addItem({ chain: 'lumber', tier: 2, col: 4, row: 4, kind: 'item' });
    ctx.systems.milestone.announce();
    last = changes.at(-1)!;
    expect(last).toMatchObject({ have: 3, need: 3, ready: true });
  });

  it('claiming a READY gift pays the coins, marks it, and advances to the next', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'lumber', tier: 2, col: 2, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'lumber', tier: 2, col: 3, row: 3, kind: 'item' });
    ctx.state.addItem({ chain: 'lumber', tier: 2, col: 4, row: 4, kind: 'item' });
    const economy = capture(ctx.bus, 'economy:add');
    const claimed = capture(ctx.bus, 'milestone:claimed');
    const changes = capture(ctx.bus, 'milestone:changed');

    ctx.bus.emit('milestone:claim', {});

    expect(economy.some((e) => e.coins === 50 && e.reason === 'milestone')).toBe(true);
    expect(claimed[0]).toMatchObject({ id: 'houses_3', coins: 50 });
    expect(ctx.state.claimedMilestoneIds).toContain('houses_3');
    // Next gift surfaced (no longer houses_3).
    expect(changes.at(-1)!.id).not.toBe('houses_3');
    expect(ctx.systems.milestone.active?.id).not.toBe('houses_3');
  });

  it('does nothing when the gift is not yet ready', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'lumber', tier: 2, col: 2, row: 2, kind: 'item' }); // only 1/3
    const economy = capture(ctx.bus, 'economy:add');

    ctx.bus.emit('milestone:claim', {});

    expect(economy).toHaveLength(0);
    expect(ctx.state.claimedMilestoneIds).toHaveLength(0);
  });
});
