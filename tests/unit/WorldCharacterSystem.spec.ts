import { describe, expect, it } from 'vitest';
import { capture, createTestContext } from './helpers';

/** Put a generator on the board with its timer RUNNING, and hand back its id. */
function runningGenerator(ctx: ReturnType<typeof createTestContext>): number {
  ctx.bus.emit('board:spawn', { chain: 'ember_dragon', tier: 3, count: 1 });
  const item = [...ctx.state.items.values()].at(-1)!;
  item.readyAt = ctx.clock.now() + 120_000;
  return item.id;
}

describe('WorldCharacterSystem (Eleanor standing in the world)', () => {
  it('only builds characters belonging to this world — Selyna is never in Emberkeep', () => {
    const ctx = createTestContext();
    const here = ctx.systems.characters.charactersIn('emberkeep').map((c) => c.id);
    expect(here).toContain('eleanor');
    expect(here).not.toContain('selyna');
  });

  it('Give Back finishes a running timer and costs the player nothing', () => {
    const ctx = createTestContext();
    const id = runningGenerator(ctx);
    ctx.state.coins = 100;
    const energy = ctx.state.energyCurrent;
    const skipped = capture(ctx.bus, 'generator:skipped');

    ctx.bus.emit('ui:character_action_requested', { characterId: 'eleanor', target: id });

    expect(skipped.at(-1)).toMatchObject({ itemId: id, currency: 'gift' });
    expect(ctx.state.items.get(id)!.readyAt).toBeLessThanOrEqual(ctx.clock.now());
    // Her help is help, not a shop.
    expect(ctx.state.coins).toBe(100);
    expect(ctx.state.energyCurrent).toBe(energy);
  });

  it('goes on cooldown, refuses while cooling, and comes back on the GameClock', () => {
    const ctx = createTestContext();
    const failed = capture(ctx.bus, 'character:action_failed');

    ctx.bus.emit('ui:character_action_requested', {
      characterId: 'eleanor',
      target: runningGenerator(ctx)
    });
    expect(ctx.systems.characters.isReady('eleanor')).toBe(false);

    ctx.bus.emit('ui:character_action_requested', {
      characterId: 'eleanor',
      target: runningGenerator(ctx)
    });
    expect(failed.at(-1)).toMatchObject({ reason: 'cooldown' });

    ctx.clock.advance(ctx.systems.characters.readyAt('eleanor') - ctx.clock.now());
    expect(ctx.systems.characters.isReady('eleanor')).toBe(true);
  });

  it('refuses a piece with no timer — and never silently', () => {
    const ctx = createTestContext();
    const failed = capture(ctx.bus, 'character:action_failed');
    ctx.bus.emit('board:spawn', { chain: 'flame_gem', tier: 1, count: 1 });
    const plain = [...ctx.state.items.values()].at(-1)!.id;

    ctx.bus.emit('ui:character_action_requested', { characterId: 'eleanor', target: plain });

    expect(failed.at(-1)).toMatchObject({ reason: 'invalid_target' });
    // A refused action must not burn the cooldown.
    expect(ctx.systems.characters.isReady('eleanor')).toBe(true);
  });

  it('refuses with no target at all rather than throwing', () => {
    const ctx = createTestContext();
    const failed = capture(ctx.bus, 'character:action_failed');
    ctx.bus.emit('ui:character_action_requested', { characterId: 'eleanor' });
    expect(failed.at(-1)).toMatchObject({ reason: 'invalid_target' });
  });

  it('ignores an unknown character instead of crashing', () => {
    const ctx = createTestContext();
    expect(() =>
      ctx.bus.emit('ui:character_action_requested', { characterId: 'nobody', target: 1 })
    ).not.toThrow();
  });

  it('the cooldown survives a save/load round trip', () => {
    const ctx = createTestContext();
    ctx.bus.emit('ui:character_action_requested', {
      characterId: 'eleanor',
      target: runningGenerator(ctx)
    });
    const readyAt = ctx.systems.characters.readyAt('eleanor');
    expect(readyAt).toBeGreaterThan(0);

    const save = ctx.state.toSave(0, 9);
    const fresh = createTestContext();
    fresh.state.hydrate(save);
    expect(fresh.state.characterCooldowns.eleanor).toBe(readyAt);
  });

  it('an old save with no cooldowns leaves her ready', () => {
    const ctx = createTestContext();
    const save = ctx.state.toSave(0, 9);
    delete save.characterCooldowns;
    ctx.state.hydrate(save);
    expect(ctx.systems.characters.isReady('eleanor')).toBe(true);
  });

  /**
   * A bubble names a SPEAKER, while the map holds BODIES — and Eleanor has two
   * of them (`eleanor` in Emberkeep, `eleanor_home` in Roothold) wearing one
   * voice. So "may she be heard here" cannot be answered by looking one id up.
   */
  describe('who may be heard where', () => {
    it('lets a voice speak from any world one of her bodies stands in', () => {
      const ctx = createTestContext();
      expect(ctx.systems.characters.speakerBelongs('eleanor', 'emberkeep')).toBe(true);
      expect(ctx.systems.characters.speakerBelongs('eleanor', 'roothold')).toBe(true);
    });

    it('keeps Eleanor out of Borealis and Selyna out of Emberkeep', () => {
      const ctx = createTestContext();
      expect(ctx.systems.characters.speakerBelongs('eleanor', 'borealis')).toBe(false);
      expect(ctx.systems.characters.speakerBelongs('selyna', 'emberkeep')).toBe(false);
      expect(ctx.systems.characters.speakerBelongs('selyna', 'borealis')).toBe(true);
    });

    it('lets a voice NO body claims be heard anywhere — the Golden Elder', () => {
      const ctx = createTestContext();
      // She speaks from her altar and is in no roster; a rule about roaming
      // characters must not silence the voice the chapter ends on.
      expect(ctx.systems.characters.speakerBelongs('golden_elder', 'emberkeep')).toBe(true);
      expect(ctx.systems.characters.speakerBelongs('golden_elder', 'borealis')).toBe(true);
    });
  });
});
