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


/**
 * The level-gated bands the authored isle actually carries, by rank.
 *
 * Main named one (`beyond_l4`) because its isle grew one band per level. Ours
 * measures the ISLANDS the editor drew and cuts each into waves, so the same
 * ground is `beyond_i1_l4` and `beyond_i3_l4` — and the names move again the
 * next time the map is re-exported. What is being proved here is the LADDER,
 * not a string, so the ladder is read off the map the same way the fourth test
 * already did.
 */
const bandsByLevel = (ctx: GameContext): Map<number, string[]> => {
  const out = new Map<number, string[]>();
  for (const region of ctx.state.map.regions) {
    const level = region.unlock?.level;
    // Key doors are bought, never ranked into; an `after` band waits on one.
    if (level === undefined || region.unlock?.keys !== undefined || region.unlock?.after) continue;
    out.set(level, [...(out.get(level) ?? []), region.id]);
  }
  return out;
};

/** Every band at or below `level`, and every band above it. */
const split = (ctx: GameContext, level: number): { at: string[]; above: string[] } => {
  const at: string[] = [];
  const above: string[] = [];
  for (const [lvl, ids] of bandsByLevel(ctx)) (lvl <= level ? at : above).push(...ids);
  return { at, above };
};

describe('the beyond ground — the extended curve actually hands it out', () => {
  it('ranking up to 4 at home lifts every band the rank covers, with the standard reveal', () => {
    const ctx = createRealContext();
    ctx.state.tutorialDone = true;
    const unlocked = capture(ctx.bus, 'region:unlocked');
    ctx.bus.emit('economy:add', { xp: LEVEL_XP[3], reason: 'test' });
    expect(ctx.state.level).toBe(4);
    const { at, above } = split(ctx, 4);
    expect(at.length, 'the isle carries level-gated ground at or below rank 4').toBeGreaterThan(0);
    for (const id of at) expect(ctx.state.regionStatus.get(id), id).toBe('active');
    // Nothing beyond the rank opens, and nothing beyond it is `locked` either —
    // a locked band ignores every level-up for ever.
    for (const id of above) expect(ctx.state.regionStatus.get(id), id).toBe('unlockable');
    // Each one arrived through the reveal, not by a status written behind the
    // scene: the fog has to be told to lift.
    for (const id of at) expect(unlocked.map((u) => u.regionId)).toContain(id);
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
    const home = split(ctx, 4).at;
    for (const id of home) expect(ctx.state.regionStatus.get(id), id).toBe('unlockable');

    // Walking home settles it — and never waives a key price along the way.
    ctx.bus.emit('world:switch', { to: 'emberkeep' });
    for (const id of home) expect(ctx.state.regionStatus.get(id), id).toBe('active');
    expect(ctx.state.regionStatus.get('level_2_gate')).toBe('unlockable');
  });

  it('a save banked past a threshold under the OLD cap lifts its ground on load', () => {
    const ctx = createRealContext();
    ctx.state.tutorialDone = true;
    ctx.bus.emit('economy:add', { xp: 500, reason: 'test' }); // level 4 under the new curve
    const { at, above } = split(ctx, 4);
    const save = ctx.state.toSave(0, 99);
    // Forge what an old-build save actually carries: the ground was 'locked'
    // demo scenery then, and no keeper:leveled will replay for a held rank.
    for (const id of at) save.regions[id] = 'locked';

    const fresh = createRealContext();
    fresh.state.hydrate(save);
    // The authored status wins over the stale non-active echo…
    for (const id of at) expect(fresh.state.regionStatus.get(id), id).toBe('unlockable');
    // …and the load-time settle lifts everything the held rank covers.
    fresh.bus.emit('state:loaded', { offlineMs: 0, energyRecovered: 0 });
    for (const id of at) expect(fresh.state.regionStatus.get(id), id).toBe('active');
    for (const id of above) expect(fresh.state.regionStatus.get(id), id).toBe('unlockable');
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
