import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHEST_GIFTS, CHEST_INTERVAL_MS, chainHiddenIn, chestWildcardChains } from '../../src/core/Constants';
import { capture, createTestContext } from './helpers';

describe('ChestSystem (standing gift box)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('grants 15 Gold (random → coins), keeps the chest, and recharges its timer', () => {
    const ctx = createTestContext();
    vi.spyOn(Math, 'random').mockReturnValue(0); // index 0 → coins
    const chest = ctx.state.addItem({ chain: 'chest', tier: 1, col: 3, row: 3, kind: 'item' });
    const economy = capture(ctx.bus, 'economy:add');

    const before = ctx.clock.now();
    ctx.bus.emit('chest:open', { itemId: chest.id });

    expect(economy.some((e) => e.coins === 15 && e.reason === 'chest')).toBe(true);
    expect(ctx.state.items.get(chest.id)).toBeDefined(); // NOT consumed
    expect(chest.readyAt).toBeGreaterThanOrEqual(before + CHEST_INTERVAL_MS); // recharged
    expect(chest.readyAt).toBeLessThanOrEqual(ctx.clock.now() + CHEST_INTERVAL_MS);
  });

  it('pops ONE piece of this world (random → the wildcard), and never an Emerald', () => {
    const ctx = createTestContext();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // index 1 → the wildcard
    const chest = ctx.state.addItem({ chain: 'chest', tier: 1, col: 3, row: 3, kind: 'item' });
    const spawned = capture(ctx.bus, 'item:spawned');

    ctx.bus.emit('chest:open', { itemId: chest.id });

    expect(spawned).toHaveLength(1); // ONE piece, not a handful
    expect(spawned[0]!.item.tier).toBe(1); // always the bottom of a ladder
    expect(spawned[0]!.item.chain).not.toBe('emerald');
    expect(ctx.state.items.get(chest.id)).toBeDefined();
  });

  it('the wildcard roster is only real, live, non-legendary merge chains', () => {
    const ctx = createTestContext();
    const pool = chestWildcardChains(ctx.data.chains.chains, ctx.state.worldId);
    expect(pool.length).toBeGreaterThan(0);
    for (const chain of pool) {
      // Withheld rosters stay withheld — a chest is not a way around the
      // chapter gate or the world gate.
      expect(chainHiddenIn(chain, ctx.state.worldId)).toBe(false);
      // The Legendary Egg Directive: no producer ever pays an egg, chest least
      // of all. This is the assertion that keeps a random table from becoming
      // the hole in that rule.
      expect(chain.legendary ?? false).toBe(false);
      // A fixture (one tier) is not a merge element; a wildcard that dropped one
      // would hand the player a piece with nothing to do.
      expect(chain.tiers.length).toBeGreaterThan(1);
      expect(chain.tiers.some((t) => t.tier === 1)).toBe(true);
    }
    for (const id of ['emerald', 'coin', 'golden_egg', 'ember_dragon', 'lumber']) {
      expect(pool.some((c) => c.id === id)).toBe(false);
    }
  });

  it('grants 40 Gold at the rarer weight (random → the third face)', () => {
    const ctx = createTestContext();
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // index 2 → the second purse
    const chest = ctx.state.addItem({ chain: 'chest', tier: 1, col: 3, row: 3, kind: 'item' });
    const economy = capture(ctx.bus, 'economy:add');
    const spawned = capture(ctx.bus, 'item:spawned');

    ctx.bus.emit('chest:open', { itemId: chest.id });

    expect(economy.some((e) => e.coins === 40 && e.reason === 'chest')).toBe(true);
    expect(spawned).toHaveLength(0); // a purse, not a pile
  });

  /**
   * NEITHER FACE MAY PAY THE TWO PILES ALREADY ON THE FLOOR (owner, 2026-08-27).
   *
   * Asserted over the WHOLE table rather than at one mocked roll: `3 Rubies!`
   * was a fixed entry and `lumber` was reachable through the wildcard, so a test
   * that forced a single index would have kept passing while the other door
   * stayed open. The old wood test did exactly that — it forced the roll that
   * could not spawn wood in the first place and read as a guard for months.
   */
  it('never pays Rubies or Logs, from either the fixed table or the wildcard', () => {
    const ctx = createTestContext();
    const banned = new Set(['ember_dragon', 'lumber']);
    for (const gift of CHEST_GIFTS) {
      if (gift.kind === 'item') expect(banned.has(gift.chain)).toBe(false);
    }
    for (const chain of chestWildcardChains(ctx.data.chains.chains, ctx.state.worldId)) {
      expect(banned.has(chain.id)).toBe(false);
    }
    // And end to end, at every roll the table can produce.
    for (const r of [0, 0.34, 0.5, 0.67, 0.99]) {
      const fresh = createTestContext();
      vi.spyOn(Math, 'random').mockReturnValue(r);
      const chest = fresh.state.addItem({ chain: 'chest', tier: 1, col: 3, row: 3, kind: 'item' });
      const spawned = capture(fresh.bus, 'item:spawned');
      fresh.bus.emit('chest:open', { itemId: chest.id });
      for (const s of spawned) expect(banned.has(s.item.chain)).toBe(false);
      vi.restoreAllMocks();
    }
  });

  it('ignores a tap while the gift is still cooking (cooldown not elapsed)', () => {
    const ctx = createTestContext();
    const chest = ctx.state.addItem({ chain: 'chest', tier: 1, col: 3, row: 3, kind: 'item' });
    const ready = ctx.clock.now() + 60_000; // recharging
    chest.readyAt = ready;
    const economy = capture(ctx.bus, 'economy:add');
    const spawned = capture(ctx.bus, 'item:spawned');

    ctx.bus.emit('chest:open', { itemId: chest.id });

    expect(economy).toHaveLength(0);
    expect(spawned).toHaveLength(0);
    expect(chest.readyAt).toBe(ready); // untouched
  });

  it('pays GOLD instead when no free tile sits within the reward radius', () => {
    const ctx = createTestContext();
    const chest = ctx.state.addItem({ chain: 'chest', tier: 1, col: 3, row: 3, kind: 'item' });
    // Pack every free active tile so an item gift has nowhere NEAR to land.
    for (const cell of ctx.state.freeActiveTilesNear(3, 3)) {
      ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: cell.col, row: cell.row, kind: 'item' });
    }
    const economy = capture(ctx.bus, 'economy:add');
    const spawned = capture(ctx.bus, 'item:spawned');
    const origRandom = Math.random;
    // The WILDCARD, which is the only face that still resolves to pieces now
    // that `3 Rubies!` is gone. It used to be 0.99 — the last entry — and that
    // index has since become a purse, so this test was forcing the one gift
    // that never needed a tile and asserting Gold came out. It passed, and
    // proved nothing.
    Math.random = () => 0.5;
    try {
      ctx.bus.emit('chest:open', { itemId: chest.id });
    } finally {
      Math.random = origRandom;
    }

    expect(spawned).toHaveLength(0); // nothing teleports across the map
    expect(economy).toHaveLength(1); // the Gold gift pays out instead
    expect(economy[0]!.coins).toBe(15); // the FIRST coins face is the fallback
  });

  it('ignores a chest:open for a non-chest item', () => {
    const ctx = createTestContext();
    const weed = ctx.state.addItem({ chain: 'sparkweed', tier: 1, col: 2, row: 2, kind: 'item' });
    const economy = capture(ctx.bus, 'economy:add');

    ctx.bus.emit('chest:open', { itemId: weed.id });

    expect(economy).toHaveLength(0);
    expect(ctx.state.items.get(weed.id)).toBeDefined();
  });
});
