import { describe, expect, it } from 'vitest';
import { clusterOf, gatherSeat, readyClusters, recipeFor, verdictOnto } from '../../src/core/mergeRule';
import { createTestContext } from './helpers';

type Ctx = ReturnType<typeof createTestContext>;

const weed = (ctx: Ctx, col: number, row: number, tier = 1) =>
  ctx.state.addItem({ chain: 'sparkweed', tier, col, row, kind: 'item' });

/**
 * THE MERGE RULE, read on its own — no MergeSystem, no scene. These are the
 * promises the planner, the tutorial hand and the reticle all lean on, so each
 * is pinned here once rather than rediscovered by every reader.
 */
describe('mergeRule — the one predicate', () => {
  it('reads the recipe with the same precedence as the merge: tier, then chain, then the global rule', () => {
    const ctx = createTestContext();
    const chains = ctx.data.chains;
    expect(recipeFor(chains, 'sparkweed', 1)).toMatchObject({ need: 3, outputs: 1, mergeable: true, fiveGroup: 5 });
    // Houses merge two for one, and a tier with its own recipe never gets the five-bonus.
    expect(recipeFor(chains, 'lumber', 3)).toMatchObject({ need: 2, outputs: 1, fiveGroup: null });
    // The top of a ladder cannot merge at all.
    expect(recipeFor(chains, 'sparkweed', 3).mergeable).toBe(false);
    expect(recipeFor(chains, 'not_a_chain', 1).mergeable).toBe(false);
  });

  it('walks the cluster orthogonally, never diagonally, never across a stranger', () => {
    const ctx = createTestContext();
    const a = weed(ctx, 1, 1);
    weed(ctx, 2, 1);
    weed(ctx, 2, 2); // touches (2,1) — in
    weed(ctx, 3, 3); // diagonal to (2,2) — out
    ctx.state.addItem({ chain: 'flame_gem', tier: 1, col: 1, row: 2, kind: 'item' });
    weed(ctx, 1, 3); // behind the gem — out
    expect(clusterOf(ctx.state, a).map((p) => `${p.col},${p.row}`)).toEqual(['1,1', '2,1', '2,2']);
  });

  it('says MERGE when the dragged piece plus the target cluster reach the need, GATHER when they fall short', () => {
    const ctx = createTestContext();
    const lone = weed(ctx, 1, 1);
    const far = weed(ctx, 5, 5);
    expect(verdictOnto(ctx.state, ctx.data.chains, far, lone).kind).toBe('gather');
    weed(ctx, 1, 2);
    const merge = verdictOnto(ctx.state, ctx.data.chains, far, lone);
    expect(merge.kind).toBe('merge');
    if (merge.kind === 'merge') {
      expect(merge.consume).toBe(3);
      expect(merge.outputs).toBe(1);
      // The dragged piece first, then the cluster nearest the target.
      expect(merge.members.map((p) => p.id)[0]).toBe(far.id);
    }
  });

  it('says NONE for a stranger, for itself, and for the top of a ladder', () => {
    const ctx = createTestContext();
    const a = weed(ctx, 1, 1);
    const gem = ctx.state.addItem({ chain: 'flame_gem', tier: 1, col: 2, row: 2, kind: 'item' });
    expect(verdictOnto(ctx.state, ctx.data.chains, a, gem).kind).toBe('none');
    expect(verdictOnto(ctx.state, ctx.data.chains, a, a).kind).toBe('none');
    const top1 = weed(ctx, 3, 3, 3);
    const top2 = weed(ctx, 3, 4, 3);
    const top3 = weed(ctx, 5, 5, 3);
    expect(clusterOf(ctx.state, top1)).toHaveLength(2);
    expect(verdictOnto(ctx.state, ctx.data.chains, top3, top2).kind).toBe('none');
  });

  it('counts the row as it stands: the middle piece dropped on an end still merges', () => {
    const ctx = createTestContext();
    const a = weed(ctx, 1, 1);
    const d = weed(ctx, 1, 2);
    weed(ctx, 1, 3);
    const v = verdictOnto(ctx.state, ctx.data.chains, d, a);
    expect(v.kind).toBe('merge');
  });

  it('finishes five for two when the cluster is that big', () => {
    const ctx = createTestContext();
    weed(ctx, 1, 1);
    weed(ctx, 2, 1);
    weed(ctx, 1, 2);
    const t = weed(ctx, 2, 2);
    const far = weed(ctx, 5, 5);
    const v = verdictOnto(ctx.state, ctx.data.chains, far, t);
    expect(v).toMatchObject({ kind: 'merge', consume: 5, outputs: 2 });
  });

  describe('gatherSeat', () => {
    it('seats the piece beside the target on the side it came from', () => {
      const ctx = createTestContext();
      const target = weed(ctx, 3, 3);
      const fromEast = weed(ctx, 6, 3);
      expect(gatherSeat(ctx.state, fromEast, target)).toEqual({ col: 4, row: 3 });
      const fromNorth = weed(ctx, 3, 0 + 1);
      expect(gatherSeat(ctx.state, fromNorth, target)).toEqual({ col: 3, row: 2 });
    });

    it('answers null for a piece already touching the target — there is no better seat than its own', () => {
      const ctx = createTestContext();
      const target = weed(ctx, 3, 3);
      const beside = weed(ctx, 4, 3);
      expect(gatherSeat(ctx.state, beside, target)).toBeNull();
    });

    it('answers null when every side of the target is taken and it has no cluster to lean on', () => {
      const ctx = createTestContext();
      const target = weed(ctx, 3, 3);
      for (const [c, r] of [
        [2, 3],
        [4, 3],
        [3, 2],
        [3, 4]
      ] as const) {
        ctx.state.addItem({ chain: 'flame_gem', tier: 1, col: c, row: r, kind: 'item' });
      }
      const far = weed(ctx, 6, 6);
      expect(gatherSeat(ctx.state, far, target)).toBeNull();
    });

    it('never seats on fogged or locked ground', () => {
      const ctx = createTestContext();
      // (1,1) is the fixture's north-west corner of the active field: (0,1) and
      // (1,0) are fog. Only (2,1) and (1,2) are live seats.
      const target = weed(ctx, 1, 1);
      const far = weed(ctx, 5, 5);
      const seat = gatherSeat(ctx.state, far, target)!;
      expect(seat).not.toBeNull();
      expect(ctx.state.isTileActive(seat.col, seat.row)).toBe(true);
      expect([`2,1`, `1,2`]).toContain(`${seat.col},${seat.row}`);
    });
  });

  describe('readyClusters', () => {
    it('lists a complete-but-unmerged row with its best-connected member as the centre', () => {
      const ctx = createTestContext();
      const a = weed(ctx, 1, 1);
      const mid = weed(ctx, 1, 2);
      const c = weed(ctx, 1, 3);
      weed(ctx, 5, 5); // a loner is not a cluster
      const ready = readyClusters(ctx.state, ctx.data.chains, ctx.state.items.values());
      expect(ready).toHaveLength(1);
      expect(ready[0]!.centre.id).toBe(mid.id);
      expect(ready[0]!.members.map((p) => p.id).sort()).toEqual([a.id, mid.id, c.id].sort());
    });

    it('ignores a pair that needs three, and reports a pair that needs two', () => {
      const ctx = createTestContext();
      weed(ctx, 1, 1);
      weed(ctx, 1, 2);
      ctx.state.addItem({ chain: 'lumber', tier: 3, col: 4, row: 4, kind: 'item' });
      ctx.state.addItem({ chain: 'lumber', tier: 3, col: 5, row: 4, kind: 'item' });
      const ready = readyClusters(ctx.state, ctx.data.chains, ctx.state.items.values());
      expect(ready.map((r) => `${r.chain}:${r.tier}`)).toEqual(['lumber:3']);
    });

    it('breaks centre ties toward the oldest piece, so the lean never flickers between frames', () => {
      const ctx = createTestContext();
      // A 2x2 block: every member has degree 2. The centre must be the lowest id.
      const first = weed(ctx, 1, 1);
      weed(ctx, 2, 1);
      weed(ctx, 1, 2);
      weed(ctx, 2, 2);
      const ready = readyClusters(ctx.state, ctx.data.chains, ctx.state.items.values());
      expect(ready).toHaveLength(1);
      expect(ready[0]!.centre.id).toBe(first.id);
      // And the same answer, whatever order the items arrive in.
      const reversed = readyClusters(ctx.state, ctx.data.chains, [...ctx.state.items.values()].reverse());
      expect(reversed[0]!.centre.id).toBe(first.id);
    });
  });
});
