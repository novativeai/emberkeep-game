import { describe, expect, it } from 'vitest';
import { GameContext } from '../../src/core/Context';
import { LEVEL_XP } from '../../src/core/Constants';
import type { MapData } from '../../src/core/types';
import realMap from '../../src/data/map.json';
import { capture, MemoryStorage } from './helpers';

/** These tests need the REAL authored map: the fixture 8×8 fails the zones'
 *  baseSignature, which degrades emberkeep to a plain world with no grafted
 *  `beyond_*` ground — exactly the regions under test. */
const createRealContext = (): GameContext =>
  new GameContext(new MemoryStorage(), { map: realMap as unknown as MapData });

describe('the beyond ground — the extended curve actually hands it out', () => {
  it('ranking up to 4 at home lifts beyond_l4 with the standard reveal', () => {
    const ctx = createRealContext();
    ctx.state.tutorialDone = true;
    const unlocked = capture(ctx.bus, 'region:unlocked');
    ctx.bus.emit('economy:add', { xp: LEVEL_XP[3], reason: 'test' });
    expect(ctx.state.level).toBe(4);
    expect(ctx.state.regionStatus.get('beyond_l4')).toBe('active');
    expect(ctx.state.regionStatus.get('beyond_l5')).toBe('unlockable');
    expect(unlocked.map((u) => u.regionId)).toContain('beyond_l4');
  });

  it('a rank earned in the north still lifts the home ground on return', () => {
    const ctx = createRealContext();
    ctx.state.tutorialDone = true;
    ctx.state.addStat('q:done:keepers_hoard', 1); // the Elder is awake — Borealis is open
    ctx.bus.emit('economy:add', { xp: LEVEL_XP[2], reason: 'test' }); // rank 3, the door's floor
    ctx.bus.emit('world:switch', { to: 'borealis' });
    expect(ctx.state.worldId).toBe('borealis');

    // Cross Level 4 while standing in the north: emberkeep is not loaded, so
    // its level region cannot hear keeper:leveled.
    ctx.bus.emit('economy:add', { xp: LEVEL_XP[3] - LEVEL_XP[2], reason: 'test' });
    expect(ctx.state.level).toBe(4);
    expect(ctx.state.regionStatus.get('beyond_l4')).toBe('unlockable');

    // Walking home settles it — and never waives a key price along the way.
    ctx.bus.emit('world:switch', { to: 'emberkeep' });
    expect(ctx.state.regionStatus.get('beyond_l4')).toBe('active');
    expect(ctx.state.regionStatus.get('level_2_gate')).toBe('unlockable');
  });

  it('a save banked past a threshold under the OLD cap lifts its ground on load', () => {
    const ctx = createRealContext();
    ctx.state.tutorialDone = true;
    ctx.bus.emit('economy:add', { xp: 500, reason: 'test' }); // level 4 under the new curve
    const save = ctx.state.toSave(0, 99);
    // Forge what an old-build save actually carries: the ground was 'locked'
    // demo scenery then, and no keeper:leveled will replay for a held rank.
    save.regions['beyond_l4'] = 'locked';

    const fresh = createRealContext();
    fresh.state.hydrate(save);
    // The authored status wins over the stale non-active echo…
    expect(fresh.state.regionStatus.get('beyond_l4')).toBe('unlockable');
    // …and the load-time settle lifts everything the held rank covers.
    fresh.bus.emit('state:loaded', { offlineMs: 0, energyRecovered: 0 });
    expect(fresh.state.regionStatus.get('beyond_l4')).toBe('active');
    expect(fresh.state.regionStatus.get('beyond_l5')).toBe('unlockable');
    expect(fresh.state.regionStatus.get('level_2_gate')).toBe('unlockable');
  });

  it("future ground past the curve's cap stays locked at the cap", () => {
    const ctx = createRealContext();
    ctx.state.tutorialDone = true;
    ctx.bus.emit('economy:add', { xp: LEVEL_XP[LEVEL_XP.length - 1]!, reason: 'test' });
    expect(ctx.state.level).toBe(LEVEL_XP.length);
    // Every graft within the curve is open at the cap; none beyond it is.
    for (const region of ctx.state.map.regions) {
      const level = region.unlock?.level;
      if (level === undefined || region.unlock?.keys !== undefined) continue;
      expect(ctx.state.regionStatus.get(region.id)).toBe(
        level <= LEVEL_XP.length ? 'active' : 'locked'
      );
    }
  });
});
