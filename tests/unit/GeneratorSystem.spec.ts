import { describe, expect, it } from 'vitest';
import { ENERGY_MAX, GENERATOR_SKIP_MAX_ENERGY, skipEnergyCost } from '../../src/core/Constants';
import { capture, createTestContext } from './helpers';

describe('dragon passive generation (the standing advantage)', () => {
  it('a dragon gifts a Gem Shard once its passiveMs elapses — free, no tap', () => {
    const ctx = createTestContext();
    ctx.systems.board.spawn('ember_dragon', 3, 2, 2, 'init'); // Red Dragon: passive generator
    const produced = capture(ctx.bus, 'item:produced');
    ctx.state.energyCurrent = ctx.state.energyMax; // start full so the 360s advance's regen can't confound the "no Warmth spent" check
    const energyBefore = ctx.state.energyCurrent;

    // First tick only arms the timer; nothing is produced yet.
    ctx.bus.emit('time:advanced', { ms: 0 });
    expect(produced).toHaveLength(0);

    // Cross the 360s passive interval (tier 3 passiveMs after the ×3 retune).
    ctx.clock.advance(360_001);
    ctx.bus.emit('time:advanced', { ms: 360_001 });

    expect(produced).toHaveLength(1);
    expect(produced[0]!.output).toMatchObject({ chain: 'flame_gem', tier: 1 });
    expect(ctx.state.energyCurrent).toBe(energyBefore); // passive costs no Warmth
    expect(ctx.state.countItems('flame_gem', 1)).toBe(1);
  });

  it('does not flood after a long jump: at most one gift per tick', () => {
    const ctx = createTestContext();
    ctx.systems.board.spawn('ember_dragon', 3, 2, 2, 'init');
    const produced = capture(ctx.bus, 'item:produced');
    ctx.bus.emit('time:advanced', { ms: 0 }); // arm

    ctx.clock.advance(600_000); // many intervals at once
    ctx.bus.emit('time:advanced', { ms: 600_000 });
    expect(produced).toHaveLength(1); // not many

    // A tick immediately after (timer just reset) produces nothing.
    ctx.bus.emit('time:advanced', { ms: 0 });
    expect(produced).toHaveLength(1);
  });

  it('a plain item (no generator) never produces passively', () => {
    const ctx = createTestContext();
    ctx.systems.board.spawn('sparkweed', 1, 2, 2, 'init');
    const produced = capture(ctx.bus, 'item:produced');
    ctx.bus.emit('time:advanced', { ms: 0 });
    ctx.clock.advance(300_000);
    ctx.bus.emit('time:advanced', { ms: 300_000 });
    expect(produced).toHaveLength(0);
  });
});

describe('skip cooldown for Warmth', () => {
  it('clears a cooling generator and spends Warmth', () => {
    const ctx = createTestContext();
    const gen = ctx.state.addItem({
      chain: 'ember_dragon',
      tier: 3,
      col: 2,
      row: 2,
      kind: 'item',
      readyAt: ctx.clock.now()
    });
    ctx.bus.emit('item:tapped', { itemId: gen.id }); // harvest → cooldown
    expect(gen.readyAt!).toBeGreaterThan(ctx.clock.now());
    ctx.state.coins = 20; // skip is paid in GOLD now
    // Freshly cooled = full time left (remaining == total) → the skip costs the
    // MAX, whatever the dragon's tuned cooldown happens to be.
    const remaining = gen.readyAt! - ctx.clock.now();
    const fullCost = skipEnergyCost(remaining, remaining);
    expect(fullCost).toBe(GENERATOR_SKIP_MAX_ENERGY);

    ctx.bus.emit('generator:skip', { itemId: gen.id, currency: 'gold' });

    expect(gen.readyAt!).toBeLessThanOrEqual(ctx.clock.now()); // ready now
    expect(ctx.state.coins).toBe(20 - fullCost);
  });

  it('cheapens the skip as the timer nears completion (dynamic price)', () => {
    expect(skipEnergyCost(10_000, 10_000)).toBe(GENERATOR_SKIP_MAX_ENERGY); // just started: dear
    expect(skipEnergyCost(500, 10_000)).toBe(1); // almost done: cheap
    expect(skipEnergyCost(5_000, 10_000)).toBeLessThan(GENERATOR_SKIP_MAX_ENERGY);
    expect(skipEnergyCost(0, 10_000)).toBe(0); // nothing left
  });

  /**
   * The Borealis contract, and the reason `activeTimer` refuses a tappable
   * generator's passive clock.
   *
   * Every Borealis generator carries BOTH `tappable: true` and a `passiveMs`,
   * so a fresh one — never tapped, `readyAt` unset — was sitting on a live
   * passive countdown. A skip bought against THAT set `passiveAt = now`, which
   * drops the item on the next tick with no tap at all: the piece produced
   * itself instead of returning to a tappable ready state. Emberkeep's Theme
   * Crystal never showed it because it has no passive clock to be sold.
   */
  it('a tappable generator skips its TAP cooldown, never its passive clock', () => {
    const ctx = createTestContext();
    const gen = ctx.state.addItem({
      chain: 'ember_dragon', // tappable AND passive — the Borealis shape
      tier: 3,
      col: 2,
      row: 2,
      kind: 'item',
      readyAt: ctx.clock.now()
    });
    // Never tapped, but its passive clock is already running. `now` is captured
    // ONCE: the clock is real time here, so reading it again in the assertion
    // below made the test fail by a millisecond whenever the suite ran hot.
    const armedAt = ctx.clock.now() + 120_000;
    gen.passiveAt = armedAt;
    ctx.state.coins = 999;
    const coinsBefore = ctx.state.coins;

    ctx.bus.emit('generator:skip', { itemId: gen.id, currency: 'gold' });

    // Nothing was pending to sell: it is tappable RIGHT NOW, so the skip is a
    // no-op rather than a purchase that hands the goods over.
    expect(ctx.state.coins).toBe(coinsBefore);
    expect(gen.passiveAt).toBe(armedAt); // passive clock untouched

    // Tap it: now there IS a tap cooldown, and THAT is what a skip clears —
    // back to ready, with the item still owed to a tap.
    ctx.bus.emit('item:tapped', { itemId: gen.id });
    expect(gen.readyAt!).toBeGreaterThan(ctx.clock.now());
    const produced = capture(ctx.bus, 'item:produced');

    ctx.bus.emit('generator:skip', { itemId: gen.id, currency: 'gold' });

    expect(gen.readyAt!).toBeLessThanOrEqual(ctx.clock.now()); // ready, not produced
    expect(produced).toEqual([]); // the skip itself handed over nothing
    expect(ctx.state.coins).toBeLessThan(coinsBefore); // this one was a real purchase
  });

  it('a PASSIVE-only generator (the House) still sells its passive wait', () => {
    // The tutorial's `house_skip` beat depends on this: a piece with no tap
    // verb has only its passive clock to skip, so that path must stay live.
    const ctx = createTestContext();
    const house = ctx.state.addItem({ chain: 'lumber', tier: 3, col: 2, row: 2, kind: 'item' });
    house.passiveAt = ctx.clock.now() + 210_000;
    ctx.state.coins = 999;
    const coinsBefore = ctx.state.coins;

    ctx.bus.emit('generator:skip', { itemId: house.id, currency: 'gold' });

    expect(house.passiveAt!).toBeLessThanOrEqual(ctx.clock.now());
    expect(ctx.state.coins).toBeLessThan(coinsBefore);
  });

  it('refuses to skip without enough Warmth (and keeps the cooldown)', () => {
    const ctx = createTestContext();
    const gen = ctx.state.addItem({
      chain: 'ember_dragon',
      tier: 3,
      col: 2,
      row: 2,
      kind: 'item',
      readyAt: ctx.clock.now()
    });
    ctx.bus.emit('item:tapped', { itemId: gen.id }); // cooling
    const cooldownEnds = gen.readyAt!;
    ctx.state.coins = GENERATOR_SKIP_MAX_ENERGY - 1; // not enough GOLD for a fresh skip
    const fails = capture(ctx.bus, 'item:harvest_failed');

    ctx.bus.emit('generator:skip', { itemId: gen.id, currency: 'gold' });

    expect(gen.readyAt!).toBe(cooldownEnds); // unchanged
    expect(fails.some((f) => f.reason === 'energy')).toBe(true);
  });
});

describe('the House (Gold generator)', () => {
  it('drops one Gold Coin per passive cycle (passive, no tap)', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'lumber', tier: 3, col: 2, row: 2, kind: 'item' });
    const produced = capture(ctx.bus, 'item:produced');

    ctx.bus.emit('time:advanced', { ms: 0 }); // arm
    expect(produced).toHaveLength(0);

    ctx.clock.advance(420_001); // one passive interval
    ctx.bus.emit('time:advanced', { ms: 420_001 });

    // A collectible Gold Coin lands on a nearby tile (worth +10 when tapped).
    expect(produced).toHaveLength(1);
    expect(produced[0]!.output).toMatchObject({ chain: 'coin', tier: 1 });
  });

  it('a tap never harvests a passive-only House', () => {
    const ctx = createTestContext();
    const house = ctx.state.addItem({ chain: 'lumber', tier: 3, col: 2, row: 2, kind: 'item' });
    const produced = capture(ctx.bus, 'item:produced');
    ctx.bus.emit('item:tapped', { itemId: house.id });
    expect(produced).toHaveLength(0); // tapping pays nothing; it only offers a skip
  });
});

describe('the Ripe Emberberry Plant (the bonus yield)', () => {
  const tapUntil = (ctx: ReturnType<typeof createTestContext>, plantId: number, n: number): void => {
    for (let i = 0; i < n; i++) {
      const item = ctx.state.items.get(plantId)!;
      item.readyAt = ctx.clock.now(); // the 20s cooldown isn't what's under test
      ctx.bus.emit('item:tapped', { itemId: plantId });
    }
  };

  it('pays an Emberberry every tap and one Emberberry Sprout per 12 of them', () => {
    const ctx = createTestContext();
    const plant = ctx.state.addItem({ chain: 'strawberry', tier: 3, col: 2, row: 2, kind: 'item' });

    tapUntil(ctx, plant.id, 11);
    expect(ctx.state.countItems('emberberry', 1)).toBe(11);
    expect(ctx.state.countItems('strawberry', 1)).toBe(0); // not yet — 12 is 12

    tapUntil(ctx, plant.id, 1);
    expect(ctx.state.countItems('emberberry', 1)).toBe(12);
    expect(ctx.state.countItems('strawberry', 1)).toBe(1); // the sprout, on the 12th berry

    // Clear the crop so the 8x8 fixture has room for another dozen — the
    // counter is per-generator and survives the board emptying.
    for (const item of [...ctx.state.items.values()]) {
      if (item.chain === 'emberberry') ctx.state.removeItem(item.id);
    }
    tapUntil(ctx, plant.id, 12);
    expect(ctx.state.countItems('strawberry', 1)).toBe(2); // and again on the 24th
  });

  it('a generator with no bonus never grows a yield counter', () => {
    const ctx = createTestContext();
    const crystal = ctx.state.addItem({ chain: 'crystal', tier: 1, col: 2, row: 2, kind: 'item' });
    ctx.bus.emit('item:tapped', { itemId: crystal.id });
    expect(ctx.state.items.get(crystal.id)!.yields).toBeUndefined();
  });
});

describe('the Theme Crystal (Quartz generator)', () => {
  it('does NOT passively produce — tap is required; no auto-generation after any interval', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'crystal', tier: 1, col: 2, row: 2, kind: 'item' });
    const produced = capture(ctx.bus, 'item:produced');

    ctx.bus.emit('time:advanced', { ms: 0 }); // arm
    ctx.clock.advance(600_001); // well past any passive interval
    ctx.bus.emit('time:advanced', { ms: 600_001 });

    expect(produced).toHaveLength(0); // tap-only — no passive output ever
  });

  it('produces one Quartz Pebble on tap and starts a cooldown', () => {
    const ctx = createTestContext();
    const crystal = ctx.state.addItem({ chain: 'crystal', tier: 1, col: 2, row: 2, kind: 'item' });
    const harvested = capture(ctx.bus, 'item:harvested');

    ctx.bus.emit('item:tapped', { itemId: crystal.id });

    expect(harvested).toHaveLength(1);
    // Eleanor's own stone — the Crystal shed Emeralds until the opening was
    // rebuilt around what quartz IS to her (Constants, HIDDEN_CHAINS).
    expect(harvested[0]!.output).toMatchObject({ chain: 'quartz', tier: 1 });
    expect(crystal.readyAt).toBeDefined(); // cooldown armed
  });
});

describe('the Ancient Tree (wood generator)', () => {
  it('produces one Cut Wood per passive interval', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'bigtree', tier: 1, col: 2, row: 2, kind: 'item' });
    const produced = capture(ctx.bus, 'item:produced');

    ctx.bus.emit('time:advanced', { ms: 0 }); // arm
    ctx.clock.advance(3_600_001); // 60min passive interval (×3 retune)
    ctx.bus.emit('time:advanced', { ms: 3_600_001 });

    expect(produced).toHaveLength(1);
    expect(produced[0]!.output).toMatchObject({ chain: 'lumber', tier: 1 });
  });
});

describe('energy gain (energy:add)', () => {
  it('tops up Warmth, capped at the max', () => {
    const ctx = createTestContext();
    ctx.state.energyCurrent = 3;
    ctx.state.energyLastRegenAt = ctx.clock.now(); // pin regen so it can't interfere
    ctx.bus.emit('energy:add', { amount: 2, reason: 'test' });
    expect(ctx.state.energyCurrent).toBe(5);
    ctx.bus.emit('energy:add', { amount: 999, reason: 'test' });
    expect(ctx.state.energyCurrent).toBe(ENERGY_MAX);
  });
});
