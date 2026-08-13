import { describe, expect, it } from 'vitest';
import { energyMaxForLevel, ENERGY_MAX, LEVELUP_REWARD, LEVEL_XP } from '../../src/core/Constants';
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
    expect(ctx.state.energyCurrent).toBe(energyMaxForLevel(2)); // refilled to the new, higher max (+3)
    expect(energyMaxForLevel(2)).toBe(ENERGY_MAX + 3);
    expect(ctx.state.coins).toBe(LEVELUP_REWARD.coinsBase + 2 * LEVELUP_REWARD.coinsPerLevel);
  });

  it('fires one level-up per level when a big XP grant skips multiple levels', () => {
    const ctx = createTestContext();
    const levels = capture(ctx.bus, 'keeper:leveled');
    ctx.bus.emit('economy:add', { xp: LEVEL_XP[2], reason: 'test' });
    expect(levels.map((l) => l.level)).toEqual([2, 3]);
    expect(ctx.state.level).toBe(3);
  });

  it('drops a Bronze Chest from chestFromLevel on — and NOT on the tutorial level', () => {
    const ctx = createTestContext();
    const spawned = capture(ctx.bus, 'item:spawned');
    // Level 2 fires mid-tutorial on the scripted beat: gold and warmth only.
    ctx.bus.emit('economy:add', { xp: LEVEL_XP[1], reason: 'test' });
    expect(spawned.filter((s) => s.item.chain === 'chest')).toHaveLength(0);
    // Level 3 is post-tutorial — the rank pays a chest onto the board.
    ctx.bus.emit('economy:add', { xp: LEVEL_XP[2] - LEVEL_XP[1], reason: 'test' });
    const chests = spawned.filter((s) => s.item.chain === 'chest');
    expect(chests).toHaveLength(1);
    expect(chests[0]!.item.tier).toBe(1);
  });

  it('coins-only adds never trigger a level-up (no feedback loop)', () => {
    const ctx = createTestContext();
    const levels = capture(ctx.bus, 'keeper:leveled');
    ctx.bus.emit('economy:add', { coins: 500, reason: 'test' });
    expect(levels).toHaveLength(0);
    expect(ctx.state.level).toBe(1);
  });
});
