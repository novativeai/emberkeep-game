import { describe, expect, it } from 'vitest';
import { ENERGY_MAX, LEVELUP_REWARD, LEVEL_XP } from '../../src/core/Constants';
import { capture, createTestContext } from './helpers';

describe('level-up rewards (the addictive beat)', () => {
  it('crossing a level grants Gold + a full Warmth refill, and fires keeper:leveled', () => {
    const ctx = createTestContext();
    const levels = capture(ctx.bus, 'keeper:leveled');
    // drain some Warmth so the refill is observable.
    ctx.bus.emit('energy:spend', { amount: 8, reason: 'test' });
    expect(ctx.state.energyCurrent).toBe(ENERGY_MAX - 8);

    // earn enough XP to reach Keeper level 2 (LEVEL_XP[1]).
    ctx.bus.emit('economy:add', { xp: LEVEL_XP[1], reason: 'test' });

    expect(levels).toHaveLength(1);
    expect(levels[0]).toEqual({ level: 2, from: 1 });
    expect(ctx.state.level).toBe(2);
    expect(ctx.state.energyCurrent).toBe(ENERGY_MAX); // refilled
    expect(ctx.state.coins).toBe(LEVELUP_REWARD.coinsBase + 2 * LEVELUP_REWARD.coinsPerLevel);
  });

  it('fires one level-up per level when a big XP grant skips multiple levels', () => {
    const ctx = createTestContext();
    const levels = capture(ctx.bus, 'keeper:leveled');
    ctx.bus.emit('economy:add', { xp: LEVEL_XP[3], reason: 'test' }); // jump to level 4
    expect(levels.map((l) => l.level)).toEqual([2, 3, 4]);
    expect(ctx.state.level).toBe(4);
  });

  it('coins-only adds never trigger a level-up (no feedback loop)', () => {
    const ctx = createTestContext();
    const levels = capture(ctx.bus, 'keeper:leveled');
    ctx.bus.emit('economy:add', { coins: 500, reason: 'test' });
    expect(levels).toHaveLength(0);
    expect(ctx.state.level).toBe(1);
  });
});
