import { afterEach, describe, expect, it, vi } from 'vitest';
import { DUEL } from '../../src/core/Constants';
import { capture, createTestContext } from './helpers';
import type { GameContext } from '../../src/core/Context';

/** Put the game in the duel's unlocked state: both dragons hatched + Keeper Lv2. */
function unlock(ctx: GameContext): void {
  ctx.state.addItem({ chain: 'ember_dragon', tier: 3, col: 2, row: 2, kind: 'item' }); // red
  ctx.state.addItem({ chain: 'emerald', tier: 3, col: 3, row: 2, kind: 'item' }); // green
  ctx.state.xp = 60; // LEVEL_XP[1] → Keeper level 2
  ctx.state.energyLastRegenAt = ctx.clock.now(); // pin: no spurious catch-up regen
}

afterEach(() => vi.restoreAllMocks());

describe('DragonDuelSystem (rock-paper-scissors)', () => {
  it('stays locked until every dragon is hatched AND Keeper level ≥ 2', () => {
    const ctx = createTestContext();
    const changes = capture(ctx.bus, 'duel:changed');

    ctx.state.addItem({ chain: 'ember_dragon', tier: 3, col: 2, row: 2, kind: 'item' });
    ctx.state.xp = 60; // only one dragon
    ctx.systems.duel.announce();
    expect(changes.at(-1)!.unlocked).toBe(false);

    ctx.state.addItem({ chain: 'emerald', tier: 3, col: 3, row: 2, kind: 'item' }); // now both
    ctx.systems.duel.announce();
    expect(changes.at(-1)!.unlocked).toBe(true);

    ctx.state.xp = 0; // drop below level 2
    ctx.systems.duel.announce();
    expect(changes.at(-1)!.unlocked).toBe(false);
  });

  it('starting a set pays energy and arms matchesPerSet matches', () => {
    const ctx = createTestContext();
    unlock(ctx);
    const started = capture(ctx.bus, 'duel:set_started');
    const energyBefore = ctx.state.energyCurrent;

    ctx.bus.emit('duel:choose', { chain: 'ember_dragon' });
    ctx.bus.emit('duel:start', {});

    expect(started.at(-1)).toMatchObject({ chain: 'ember_dragon', matches: DUEL.matchesPerSet });
    expect(ctx.state.energyCurrent).toBe(energyBefore - DUEL.energyCost);
  });

  it('refuses to start without enough energy', () => {
    const ctx = createTestContext();
    unlock(ctx);
    ctx.state.energyCurrent = DUEL.energyCost - 1;
    const failed = capture(ctx.bus, 'duel:start_failed');
    const started = capture(ctx.bus, 'duel:set_started');

    ctx.bus.emit('duel:choose', { chain: 'ember_dragon' });
    ctx.bus.emit('duel:start', {});

    expect(failed.at(-1)).toMatchObject({ reason: 'energy' });
    expect(started).toHaveLength(0);
  });

  it('a won match adds winGauge; the throws actually realise the outcome', () => {
    const ctx = createTestContext();
    unlock(ctx);
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // r<winRate → win, throw index 0 = rock
    const matches = capture(ctx.bus, 'duel:match');

    ctx.bus.emit('duel:choose', { chain: 'ember_dragon' });
    ctx.bus.emit('duel:start', {});
    ctx.bus.emit('duel:play', { move: 'rock' });

    const m = matches.at(-1)!;
    expect(m.outcome).toBe('win');
    expect(m.chain).toBe('ember_dragon');
    expect(m.oppChain).toBe('emerald');
    expect(m.gauge).toBe(DUEL.winGauge);
    // rock beats scissors → the reveal is coherent with a win.
    expect(m.playerThrow).toBe('rock');
    expect(m.oppThrow).toBe('scissors');
    expect(ctx.state.dragonStat('ember_dragon').gauge).toBe(DUEL.winGauge);
  });

  it('a lost match adds nothing to the gauge', () => {
    const ctx = createTestContext();
    unlock(ctx);
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // > winRate+tieRate → lose
    const matches = capture(ctx.bus, 'duel:match');

    ctx.bus.emit('duel:choose', { chain: 'ember_dragon' });
    ctx.bus.emit('duel:start', {});
    ctx.bus.emit('duel:play', { move: 'rock' });

    expect(matches.at(-1)!.outcome).toBe('lose');
    expect(ctx.state.dragonStat('ember_dragon').gauge).toBe(0);
  });

  it('plays exactly matchesPerSet matches per set, then stops', () => {
    const ctx = createTestContext();
    unlock(ctx);
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // all wins
    const matches = capture(ctx.bus, 'duel:match');

    ctx.bus.emit('duel:choose', { chain: 'ember_dragon' });
    ctx.bus.emit('duel:start', {});
    for (let i = 0; i < DUEL.matchesPerSet + 2; i++) ctx.bus.emit('duel:play', { move: 'rock' }); // over-play

    expect(matches).toHaveLength(DUEL.matchesPerSet); // extra plays ignored
    expect(matches.at(-1)!.matchesLeft).toBe(0);
    expect(ctx.state.dragonStat('ember_dragon').gauge).toBe(DUEL.winGauge * DUEL.matchesPerSet);
  });

  it('filling the gauge levels the dragon up, pays a reward, and carries the overflow', () => {
    const ctx = createTestContext();
    unlock(ctx);
    ctx.state.ensureDragon('ember_dragon').gauge = DUEL.gaugeMax - 1; // one win from full
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // win
    const economy = capture(ctx.bus, 'economy:add');
    const matches = capture(ctx.bus, 'duel:match');

    ctx.bus.emit('duel:choose', { chain: 'ember_dragon' });
    ctx.bus.emit('duel:start', {});
    ctx.bus.emit('duel:play', { move: 'rock' });

    const stat = ctx.state.dragonStat('ember_dragon');
    expect(stat.level).toBe(2);
    expect(stat.gauge).toBe(DUEL.winGauge - 1); // (99 + 3) - 100 = 2
    expect(matches.at(-1)!.leveledUp).toBe(true);
    expect(economy.some((e) => e.reason === 'duel_levelup' && (e.coins ?? 0) > 0)).toBe(true);
  });

  it('a dragon\'s passive production drips the gauge (its "work")', () => {
    const ctx = createTestContext();
    unlock(ctx);
    const redId = ctx.state.itemsMatching('ember_dragon', 3)[0]!.id;

    ctx.bus.emit('item:produced', {
      generatorId: redId,
      output: { id: 999, chain: 'ember_dragon', tier: 1, col: 4, row: 4, kind: 'item' }
    });

    expect(ctx.state.dragonStat('ember_dragon').gauge).toBe(DUEL.workGauge);
  });

  it('persists dragon levels across save/load', () => {
    const ctx = createTestContext();
    ctx.state.ensureDragon('ember_dragon').gauge = 42;
    ctx.state.ensureDragon('ember_dragon').level = 3;
    ctx.state.ensureDragon('emerald').gauge = 7;
    const save = ctx.state.toSave(1000, 7);

    const ctx2 = createTestContext();
    ctx2.state.hydrate(save);
    expect(ctx2.state.dragonStat('ember_dragon')).toEqual({ level: 3, gauge: 42 });
    expect(ctx2.state.dragonStat('emerald')).toEqual({ level: 1, gauge: 7 });
    expect(ctx2.state.dragonStat('never_trained')).toEqual({ level: 1, gauge: 0 });
  });
});
