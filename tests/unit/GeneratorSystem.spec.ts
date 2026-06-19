import { describe, expect, it } from 'vitest';
import { GENERATOR_SKIP_MAX_ENERGY, skipEnergyCost } from '../../src/core/Constants';
import { capture, createTestContext } from './helpers';

describe('dragon passive generation (the standing advantage)', () => {
  it('a dragon gifts a Gem Shard once its passiveMs elapses — free, no tap', () => {
    const ctx = createTestContext();
    ctx.systems.board.spawn('ember_dragon', 3, 2, 2, 'init'); // Red Dragon: passive generator
    const produced = capture(ctx.bus, 'item:produced');
    const energyBefore = ctx.state.energyCurrent;

    // First tick only arms the timer; nothing is produced yet.
    ctx.bus.emit('time:advanced', { ms: 0 });
    expect(produced).toHaveLength(0);

    // Cross the 180s passive interval (tier 3 passiveMs).
    ctx.clock.advance(180_001);
    ctx.bus.emit('time:advanced', { ms: 180_001 });

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
    // Freshly cooled = full time left → the skip costs the MAX (most expensive).
    const fullCost = skipEnergyCost(gen.readyAt! - ctx.clock.now(), 10_000);
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
  it('produces one Gold coin every 5 minutes (passive, no tap)', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'lumber', tier: 2, col: 2, row: 2, kind: 'item' });
    const produced = capture(ctx.bus, 'item:produced');

    ctx.bus.emit('time:advanced', { ms: 0 }); // arm
    expect(produced).toHaveLength(0);

    ctx.clock.advance(300_001); // one 5-minute interval
    ctx.bus.emit('time:advanced', { ms: 300_001 });

    expect(produced).toHaveLength(1);
    expect(produced[0]!.output).toMatchObject({ chain: 'coin', tier: 1 });
  });

  it('a tap never harvests a passive-only House', () => {
    const ctx = createTestContext();
    const house = ctx.state.addItem({ chain: 'lumber', tier: 2, col: 2, row: 2, kind: 'item' });
    const produced = capture(ctx.bus, 'item:produced');
    ctx.bus.emit('item:tapped', { itemId: house.id });
    expect(produced).toHaveLength(0); // tapping pays nothing; it only offers a skip
  });
});

describe('the Theme Crystal (Emerald generator)', () => {
  it('does NOT passively produce — tap is required; no auto-generation after any interval', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'crystal', tier: 1, col: 2, row: 2, kind: 'item' });
    const produced = capture(ctx.bus, 'item:produced');

    ctx.bus.emit('time:advanced', { ms: 0 }); // arm
    ctx.clock.advance(600_001); // well past any passive interval
    ctx.bus.emit('time:advanced', { ms: 600_001 });

    expect(produced).toHaveLength(0); // tap-only — no passive output ever
  });

  it('produces one Emerald on tap and starts a cooldown', () => {
    const ctx = createTestContext();
    const crystal = ctx.state.addItem({ chain: 'crystal', tier: 1, col: 2, row: 2, kind: 'item' });
    const harvested = capture(ctx.bus, 'item:harvested');

    ctx.bus.emit('item:tapped', { itemId: crystal.id });

    expect(harvested).toHaveLength(1);
    expect(harvested[0]!.output).toMatchObject({ chain: 'emerald', tier: 1 });
    expect(crystal.readyAt).toBeDefined(); // cooldown armed
  });
});

describe('the Ancient Tree (wood generator)', () => {
  it('produces one Wood per passive interval', () => {
    const ctx = createTestContext();
    ctx.state.addItem({ chain: 'bigtree', tier: 1, col: 2, row: 2, kind: 'item' });
    const produced = capture(ctx.bus, 'item:produced');

    ctx.bus.emit('time:advanced', { ms: 0 }); // arm
    ctx.clock.advance(600_001);
    ctx.bus.emit('time:advanced', { ms: 600_001 });

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
    expect(ctx.state.energyCurrent).toBe(20); // ENERGY_MAX
  });
});
