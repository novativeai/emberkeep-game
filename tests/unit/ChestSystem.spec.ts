import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHEST_INTERVAL_MS, chainHiddenIn, chestWildcardChains } from '../../src/core/Constants';
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

  it('pops THREE tier-1 pieces of ONE chain of this world (random → the wildcard)', () => {
    const ctx = createTestContext();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // index 1 → the wildcard
    const chest = ctx.state.addItem({ chain: 'chest', tier: 1, col: 3, row: 3, kind: 'item' });
    const spawned = capture(ctx.bus, 'item:spawned');

    ctx.bus.emit('chest:open', { itemId: chest.id });

    expect(spawned).toHaveLength(3); // three is a merge — the gift is a move
    const chains = new Set(spawned.map((s) => s.item.chain));
    expect(chains.size).toBe(1); // ONE rolled chain, three of it
    for (const s of spawned) {
      expect(s.item.tier).toBe(1); // always the bottom of a ladder
      expect(s.item.chain).not.toBe('emerald');
      expect(s.item.chain).not.toBe('ember_dragon'); // eggs come from the story, never a box
    }
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
      // No producer ever pays an egg, chest least of all — neither a legendary
      // egg nor an ordinary hatching chain (Dragon Rubies hatch dragons). This
      // is the assertion that keeps a random table from becoming the hole in
      // that rule.
      expect(chain.legendary ?? false).toBe(false);
      expect(chain.hatchAtTier).toBeUndefined();
      // A fixture (one tier) is not a merge element; a wildcard that dropped one
      // would hand the player a piece with nothing to do.
      expect(chain.tiers.length).toBeGreaterThan(1);
      expect(chain.tiers.some((t) => t.tier === 1)).toBe(true);
    }
    for (const id of ['emerald', 'coin', 'golden_egg', 'ember_dragon', 'ashdrake', 'rimewyrm']) {
      expect(pool.some((c) => c.id === id)).toBe(false);
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
    Math.random = () => 0.99; // force an ITEM gift (last CHEST_GIFTS entry)
    try {
      ctx.bus.emit('chest:open', { itemId: chest.id });
    } finally {
      Math.random = origRandom;
    }

    expect(spawned).toHaveLength(0); // nothing teleports across the map
    expect(economy).toHaveLength(1); // the Gold gift pays out instead
    expect(economy[0]!.coins).toBeGreaterThan(0);
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
