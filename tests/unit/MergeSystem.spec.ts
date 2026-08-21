import { describe, expect, it } from 'vitest';
import { capture, createTestContext, drag } from './helpers';

describe('MergeSystem', () => {
  it('merges a group of 3 into one next-tier item at the drop tile', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 3, row: 3, kind: 'item' });
    const merges = capture(ctx.bus, 'item:merged');

    drag(ctx, [3, 3], [1, 2]); // ON a member of the pair

    expect(merges).toHaveLength(1);
    expect(merges[0]!.consumedIds).toHaveLength(3);
    expect(merges[0]!.resultTier).toBe(2);
    expect(ctx.state.items.size).toBe(1);
    const result = ctx.state.itemAt(1, 2); // the output stands where the drop landed
    expect(result?.chain).toBe('sparkweed');
    expect(result?.tier).toBe(2);
  });

  it('grants the configured XP for the produced tier', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 3, row: 3, kind: 'item' });

    drag(ctx, [3, 3], [1, 2]);

    const tier2 = ctx.data.chains.chains
      .find((c) => c.id === 'sparkweed')!
      .tiers.find((t) => t.tier === 2)!;
    expect(ctx.state.xp).toBe(tier2.xp);
  });

  it('NEVER merges on free ground — three alike in a row stay three pieces', () => {
    // The rule in one test. Adjacency prepares a merge; only a drop ON a
    // matching piece performs one. A piece set down beside a pair is a move,
    // however the three now stand.
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 3, row: 3, kind: 'item' });
    const merges = capture(ctx.bus, 'item:merged');
    const moves = capture(ctx.bus, 'item:moved');

    drag(ctx, [3, 3], [1, 3]); // free, and touching the pair

    expect(merges).toHaveLength(0);
    expect(moves).toEqual([{ itemId: expect.any(Number), from: { col: 3, row: 3 }, to: { col: 1, row: 3 } }]);
    expect(ctx.state.items.size).toBe(3);
    expect(ctx.state.itemAt(1, 3)?.tier).toBe(1);
  });

  it('merges the complete row when any member is dropped on any other — the middle included', () => {
    // A·D·B in a row: the flood is walked on the board AS IT STANDS, so the
    // middle piece dropped on an end still counts the far end through its own
    // cell. The hint may point any member at any other; none of them fails.
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 3, kind: 'item' });
    const merges = capture(ctx.bus, 'item:merged');

    drag(ctx, [1, 2], [1, 1]); // the MIDDLE onto an end

    expect(merges).toHaveLength(1);
    expect(merges[0]!.consumedIds).toHaveLength(3);
    expect(ctx.state.items.size).toBe(1);
    expect(ctx.state.itemAt(1, 1)?.tier).toBe(2);
  });

  it('consumes exactly 3 nearest items from a group of 4', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 3, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 3, row: 4, kind: 'item' });

    drag(ctx, [3, 4], [1, 3]); // ON the end of the column

    // The dragged piece first, then the target's cluster nearest-first from the
    // target: (1,3),(1,2) — the far (1,1) weed stays.
    expect(ctx.state.items.size).toBe(2);
    expect(ctx.state.itemAt(1, 1)?.tier).toBe(1);
    expect(ctx.state.itemAt(1, 3)?.tier).toBe(2);
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

    drag(ctx, [4, 4], [2, 1]); // ON the 2x2 block

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
    const bounces = capture(ctx.bus, 'item:move_bounced');

    drag(ctx, [3, 3], [1, 1]); // ON a match — and the ladder has no next rung

    expect(merges).toHaveLength(0);
    expect(bounces).toHaveLength(1); // not a gather either: there is nothing to prepare
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

  it('GATHERS a drop onto a single matching item: the piece is seated beside it, no merge', () => {
    const ctx = createTestContext();
    const anchor = ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 2, row: 2, kind: 'item' });
    const weed = ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 5, row: 2, kind: 'item' });
    const bounces = capture(ctx.bus, 'item:move_bounced');
    const merges = capture(ctx.bus, 'item:merged');
    const moves = capture(ctx.bus, 'item:moved');

    drag(ctx, [5, 2], [2, 2]); // only 2 total → they pair up

    expect(merges).toHaveLength(0);
    expect(bounces).toHaveLength(0);
    expect(moves).toHaveLength(1);
    const landed = ctx.state.items.get(weed.id)!;
    // Beside the target, on the side it came from: (3,2) is the neighbour
    // nearest to (5,2).
    expect({ col: landed.col, row: landed.row }).toEqual({ col: 3, row: 2 });
    expect(moves[0]!.to).toEqual({ col: 3, row: 2 }); // state and the announced move agree
    expect(ctx.state.neighbors(anchor.col, anchor.row)).toContainEqual({ col: 3, row: 2 });
    // And the pair is now ONE drop from a merge.
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 6, row: 6, kind: 'item' });
    drag(ctx, [6, 6], [2, 2]);
    expect(merges).toHaveLength(1);
  });

  it('goes home when the target is boxed in and has no cluster to sit beside', () => {
    const ctx = createTestContext();
    // (1,1) has two neighbours on the fixture — (2,1) and (1,2); the rim is
    // locked — and both are taken by strangers. No mate of its own, so ring two
    // is empty too: nowhere to seat the newcomer, and the board stays as it was.
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'flame_gem', tier: 1, col: 2, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'flame_gem', tier: 1, col: 1, row: 2, kind: 'item' });
    const weed = ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 4, row: 4, kind: 'item' });
    const bounces = capture(ctx.bus, 'item:move_bounced');
    const moves = capture(ctx.bus, 'item:moved');

    drag(ctx, [4, 4], [1, 1]);

    expect(moves).toHaveLength(0);
    expect(bounces).toHaveLength(1);
    expect(ctx.state.itemAt(4, 4)?.id).toBe(weed.id);
  });

  it('a piece already touching its target goes home, not round to the far side', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 2, row: 2, kind: 'item' });
    const weed = ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 3, row: 2, kind: 'item' });
    const bounces = capture(ctx.bus, 'item:move_bounced');
    const moves = capture(ctx.bus, 'item:moved');

    drag(ctx, [3, 2], [2, 2]); // a pair, dropped on itself

    expect(moves).toHaveLength(0);
    expect(bounces).toHaveLength(1);
    expect(ctx.state.itemAt(3, 2)?.id).toBe(weed.id);
  });

  it('builds one Plank Set from three Cut Wood (standard 3→1 merge)', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'lumber', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'lumber', tier: 1, col: 1, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'lumber', tier: 1, col: 2, row: 2, kind: 'item' });
    const merges = capture(ctx.bus, 'item:merged');

    drag(ctx, [2, 2], [1, 2]); // ON a member of the pair

    expect(merges).toHaveLength(1);
    expect(merges[0]!.consumedIds).toHaveLength(3);
    expect(merges[0]!.outputs).toHaveLength(1);
    expect(ctx.state.items.size).toBe(1);
    const planks = [...ctx.state.items.values()][0];
    expect(planks?.chain).toBe('lumber');
    expect(planks?.tier).toBe(2);
  });

  it('five Cut Wood merge into two Plank Sets (standard 5-bonus rule)', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'lumber', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'lumber', tier: 1, col: 1, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'lumber', tier: 1, col: 1, row: 3, kind: 'item' });
    ctx.state.addItem({ chain: 'lumber', tier: 1, col: 2, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'lumber', tier: 1, col: 3, row: 3, kind: 'item' });
    const merges = capture(ctx.bus, 'item:merged');

    drag(ctx, [3, 3], [2, 2]); // ON the cluster of four

    expect(merges).toHaveLength(1);
    expect(merges[0]!.consumedIds).toHaveLength(5);
    expect(merges[0]!.outputs).toHaveLength(2); // 5-bonus yields 2
    expect(ctx.state.items.size).toBe(2);
    for (const item of ctx.state.items.values()) {
      expect(item.chain).toBe('lumber');
      expect(item.tier).toBe(2);
    }
  });

  it('merges TWO Houses into one Manor (per-tier 2→1 override, Planks still need 3)', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'lumber', tier: 3, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'lumber', tier: 3, col: 1, row: 2, kind: 'item' });
    const merges = capture(ctx.bus, 'item:merged');

    drag(ctx, [1, 2], [1, 1]); // drop one House onto the other — only two needed

    expect(merges).toHaveLength(1);
    expect(merges[0]!.consumedIds).toHaveLength(2); // the House override consumes TWO
    expect(merges[0]!.resultTier).toBe(4);
    expect(ctx.state.items.size).toBe(1);
    const manor = [...ctx.state.items.values()][0];
    expect(manor).toMatchObject({ chain: 'lumber', tier: 4 });
    expect(manor?.readyAt).toBeDefined(); // the Manor is a passive gold generator
  });

  it('merges TWO Red Dragons into one Adult Red Dragon (per-tier 2→1 override)', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'ember_dragon', tier: 3, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'ember_dragon', tier: 3, col: 1, row: 2, kind: 'item' });
    const merges = capture(ctx.bus, 'item:merged');
    const hatches = capture(ctx.bus, 'item:hatched');

    drag(ctx, [1, 2], [1, 1]); // two dragons meet — the elder rises

    expect(merges).toHaveLength(1);
    expect(merges[0]!.consumedIds).toHaveLength(2);
    expect(merges[0]!.resultTier).toBe(4);
    expect(hatches).toHaveLength(0); // hatchAtTier stays 3 — this is an ascension, not a hatch
    const adult = [...ctx.state.items.values()][0];
    expect(adult).toMatchObject({ chain: 'ember_dragon', tier: 4 });
    expect(adult?.readyAt).toBeDefined(); // the Adult is a faster ruby generator
  });

  it('emerald chain: 3 Emeralds → Green Egg — no item:hatched, no generator', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'emerald', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'emerald', tier: 1, col: 1, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'emerald', tier: 1, col: 3, row: 3, kind: 'item' });
    const hatches = capture(ctx.bus, 'item:hatched');
    const merges = capture(ctx.bus, 'item:merged');

    drag(ctx, [3, 3], [1, 2]); // merge 3 → emerald_2 (Green Egg) — hatchAtTier:3

    expect(hatches).toHaveLength(0); // tier 2 is not the hatch tier
    expect(merges).toHaveLength(1);
    expect(merges[0]!.resultTier).toBe(2);
    const greenEgg = ctx.state.itemAt(1, 2);
    expect(greenEgg).toMatchObject({ chain: 'emerald', tier: 2 });
    expect(greenEgg?.readyAt).toBeUndefined(); // no generator on tier 2
  });

  it('emerald chain: 3 Green Eggs → Green Dragon — item:hatched fires, generator ready', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'emerald', tier: 2, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'emerald', tier: 2, col: 1, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'emerald', tier: 2, col: 1, row: 3, kind: 'item' });
    const hatches = capture(ctx.bus, 'item:hatched');

    drag(ctx, [1, 3], [1, 1]); // merge 3 → emerald_3 (Green Dragon) — hatchAtTier:3

    expect(hatches).toHaveLength(1);
    expect(hatches[0]!.item.chain).toBe('emerald');
    expect(hatches[0]!.item.tier).toBe(3);
    expect(hatches[0]!.item.ready).toBe(true);
    const dragon = ctx.state.itemAt(1, 1);
    expect(dragon?.readyAt).toBeDefined(); // Green Dragon is a generator
  });

  it('merging 3 rubies produces a Red Egg — no item:hatched, no generator', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'ember_dragon', tier: 1, col: 2, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'ember_dragon', tier: 1, col: 3, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'ember_dragon', tier: 1, col: 4, row: 4, kind: 'item' });
    const hatches = capture(ctx.bus, 'item:hatched');
    const merges = capture(ctx.bus, 'item:merged');

    drag(ctx, [4, 4], [3, 2]);

    // hatchAtTier:3 — tier 2 (Red Egg) is a pure merge piece, not a hatch event
    expect(hatches).toHaveLength(0);
    expect(merges).toHaveLength(1);
    expect(merges[0]!.resultTier).toBe(2);
    const redEgg = ctx.state.itemAt(3, 2);
    expect(redEgg).toMatchObject({ chain: 'ember_dragon', tier: 2 });
    expect(redEgg?.readyAt).toBeUndefined();
  });

  it('merging 3 Red Eggs hatches the Red Dragon: emits item:hatched and result is a generator', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'ember_dragon', tier: 2, col: 2, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'ember_dragon', tier: 2, col: 3, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'ember_dragon', tier: 2, col: 4, row: 4, kind: 'item' });
    const hatches = capture(ctx.bus, 'item:hatched');

    drag(ctx, [4, 4], [3, 2]);

    expect(hatches).toHaveLength(1);
    expect(hatches[0]!.item.chain).toBe('ember_dragon');
    expect(hatches[0]!.item.tier).toBe(3);
    expect(hatches[0]!.item.ready).toBe(true); // Red Dragon is a generator, immediately ready
    const dragon = ctx.state.itemAt(3, 2);
    expect(dragon?.readyAt).toBeDefined();
  });

  it('a drop two tiles from a pair is a move — there is no magnet', () => {
    // The old board reached two rings for "the merge the player clearly
    // meant". Under the drop rule the board never guesses: a piece lands where
    // it is set down, and the reticle said so before the finger let go.
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 4, row: 2, kind: 'item' });
    ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 5, row: 2, kind: 'item' });
    const dragged = ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 5, kind: 'item' });
    const merges = capture(ctx.bus, 'item:merged');
    const moves = capture(ctx.bus, 'item:moved');

    drag(ctx, [1, 5], [4, 4]);

    expect(merges).toHaveLength(0);
    expect(moves).toHaveLength(1);
    const item = ctx.state.items.get(dragged.id)!;
    expect({ col: item.col, row: item.row }).toEqual({ col: 4, row: 4 });
    expect(ctx.state.itemIdAt(4, 4)).toBe(dragged.id); // state and the announced move agree
  });

  it('writes a Cookbook page on the FIRST merge of a recipe — and only once', () => {
    const ctx = createTestContext();
    const discovered = capture(ctx.bus, 'cookbook:discovered');
    const setup = (): void => {
      ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 1, kind: 'item' });
      ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 1, row: 2, kind: 'item' });
      ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 3, row: 3, kind: 'item' });
    };

    setup();
    drag(ctx, [3, 3], [1, 2]);
    expect(discovered).toHaveLength(1);
    expect(discovered[0]).toMatchObject({ chain: 'sparkweed', fromTier: 1, resultTier: 2 });
    expect(ctx.state.discoveredRecipes).toEqual(['sparkweed:1>2']);

    // The same recipe again — the page is already written.
    ctx.state.removeItem(ctx.state.itemAt(1, 2)!.id);
    setup();
    drag(ctx, [3, 3], [1, 2]);
    expect(discovered).toHaveLength(1);
    expect(ctx.state.discoveredRecipes).toEqual(['sparkweed:1>2']);
  });
});
