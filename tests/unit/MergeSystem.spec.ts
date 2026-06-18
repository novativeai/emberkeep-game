import { describe, expect, it } from 'vitest';
import { capture, createTestContext, drag } from './helpers';

describe('MergeSystem', () => {
  it('merges a group of 3 into one next-tier item at the drop tile', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 3, row: 3, kind: 'item' });
    const merges = capture(ctx.bus, 'item:merged');

    drag(ctx, [3, 3], [1, 3]);

    expect(merges).toHaveLength(1);
    expect(merges[0]!.consumedIds).toHaveLength(3);
    expect(merges[0]!.resultTier).toBe(2);
    expect(ctx.state.items.size).toBe(1);
    const result = ctx.state.itemAt(1, 3);
    expect(result?.chain).toBe('sparkweed');
    expect(result?.tier).toBe(2);
  });

  it('grants the configured XP for the produced tier', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 3, row: 3, kind: 'item' });

    drag(ctx, [3, 3], [1, 3]);

    const tier2 = ctx.data.chains.chains
      .find((c) => c.id === 'sparkweed')!
      .tiers.find((t) => t.tier === 2)!;
    expect(ctx.state.xp).toBe(tier2.xp);
  });

  it('does not merge a group of 2', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 3, row: 3, kind: 'item' });
    const merges = capture(ctx.bus, 'item:merged');
    const moves = capture(ctx.bus, 'item:moved');

    drag(ctx, [3, 3], [1, 2]);

    expect(merges).toHaveLength(0);
    expect(moves).toHaveLength(1);
    expect(ctx.state.items.size).toBe(2);
  });

  it('consumes exactly 3 nearest items from a group of 4', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 3, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 3, row: 4, kind: 'item' });

    drag(ctx, [3, 4], [1, 4]);

    // BFS from the drop tile consumes (1,4),(1,3),(1,2); the far (1,1) weed stays.
    expect(ctx.state.items.size).toBe(2);
    expect(ctx.state.itemAt(1, 1)?.tier).toBe(1);
    expect(ctx.state.itemAt(1, 4)?.tier).toBe(2);
  });

  it('a group of 5 consumes five and yields two next-tier items (config flag)', () => {
    const ctx = createTestContext();
    expect(ctx.data.chains.mergeRule.fiveBonus).toBe(true);
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 2, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 2, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 4, row: 4, kind: 'item' });
    const merges = capture(ctx.bus, 'item:merged');

    drag(ctx, [4, 4], [3, 1]);

    expect(merges).toHaveLength(1);
    expect(merges[0]!.consumedIds).toHaveLength(5);
    expect(merges[0]!.outputs).toHaveLength(2);
    expect(ctx.state.items.size).toBe(2);
    const tiers = [...ctx.state.items.values()].map((i) => i.tier);
    expect(tiers).toEqual([2, 2]);
  });

  it('never merges max-tier items', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'sparkweed', tier: 3, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 3, col: 1, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 3, col: 3, row: 3, kind: 'item' });
    const merges = capture(ctx.bus, 'item:merged');

    drag(ctx, [3, 3], [1, 3]);

    expect(merges).toHaveLength(0);
    expect(ctx.state.items.size).toBe(3);
  });

  it('rejects a drop whose claimed source tile does not hold the item', () => {
    const ctx = createTestContext();
    const weed = ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 1, kind: 'item' });
    const bounces = capture(ctx.bus, 'item:move_bounced');

    ctx.bus.emit('drag:dropped', {
      itemId: weed.id,
      from: { col: 2, row: 2 }, // lie about the source
      to: { col: 1, row: 3 }
    });

    expect(bounces).toHaveLength(1);
    expect(ctx.state.itemAt(1, 1)?.id).toBe(weed.id);
  });

  it('bounces drops onto occupied or inactive tiles', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'flame_gem', tier: 1, col: 2, row: 1, kind: 'item' });
    const bounces = capture(ctx.bus, 'item:move_bounced');

    drag(ctx, [1, 1], [2, 1]); // occupied
    drag(ctx, [1, 1], [0, 0]); // fogged region
    drag(ctx, [1, 1], [7, 7]); // locked rim

    expect(bounces).toHaveLength(3);
    expect(ctx.state.itemAt(1, 1)?.chain).toBe('sparkweed');
  });

  it('merges when the third piece is dropped directly ONTO a matching pair', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 3, row: 3, kind: 'item' });
    const merges = capture(ctx.bus, 'item:merged');

    drag(ctx, [3, 3], [1, 1]); // drop ON the occupied matching tile

    expect(merges).toHaveLength(1);
    expect(merges[0]!.consumedIds).toHaveLength(3);
    expect(ctx.state.items.size).toBe(1);
    const result = ctx.state.itemAt(1, 1); // output lands on the drop tile
    expect(result?.tier).toBe(2);
  });

  it('bounces a drop onto a single matching item (only 2 — below the threshold)', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 1, kind: 'item' });
    const weed = ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 3, row: 3, kind: 'item' });
    const bounces = capture(ctx.bus, 'item:move_bounced');

    drag(ctx, [3, 3], [1, 1]); // only 2 total → cannot merge, cannot stack

    expect(bounces).toHaveLength(1);
    expect(ctx.state.items.size).toBe(2);
    expect(ctx.state.itemAt(3, 3)?.id).toBe(weed.id); // bounced home
  });

  it('builds one House from five Wood (per-chain 5 → 1 override)', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'lumber', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'lumber', tier: 1, col: 1, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'lumber', tier: 1, col: 1, row: 3, kind: 'item' });
    ctx.state.addItem({ chain: 'lumber', tier: 1, col: 2, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'lumber', tier: 1, col: 3, row: 3, kind: 'item' });
    const merges = capture(ctx.bus, 'item:merged');

    drag(ctx, [3, 3], [2, 3]); // connects all five orthogonally

    expect(merges).toHaveLength(1);
    expect(merges[0]!.consumedIds).toHaveLength(5);
    expect(merges[0]!.outputs).toHaveLength(1); // the override yields 1, not the 5→2 bonus
    const house = ctx.state.itemAt(2, 3);
    expect(house?.chain).toBe('lumber');
    expect(house?.tier).toBe(2);
    expect(ctx.state.items.size).toBe(1);
  });

  it('does NOT build a House from only four Wood (below the 5 threshold)', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'lumber', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'lumber', tier: 1, col: 1, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'lumber', tier: 1, col: 2, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'lumber', tier: 1, col: 3, row: 3, kind: 'item' });
    const merges = capture(ctx.bus, 'item:merged');

    drag(ctx, [3, 3], [2, 3]); // only four connect

    expect(merges).toHaveLength(0);
    expect(ctx.state.items.size).toBe(4);
  });

  it('merging 3 eggs hatches: emits item:hatched and the result is a ready generator', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'ember_dragon', tier: 1, col: 2, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'ember_dragon', tier: 1, col: 3, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'ember_dragon', tier: 1, col: 4, row: 4, kind: 'item' });
    const hatches = capture(ctx.bus, 'item:hatched');

    drag(ctx, [4, 4], [2, 3]);

    expect(hatches).toHaveLength(1);
    expect(hatches[0]!.item.chain).toBe('ember_dragon');
    expect(hatches[0]!.item.tier).toBe(2);
    expect(hatches[0]!.item.ready).toBe(true);
    const hatchling = ctx.state.itemAt(2, 3);
    expect(hatchling?.readyAt).toBeDefined();
  });
});
