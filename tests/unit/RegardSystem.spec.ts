import { describe, expect, it } from 'vitest';
import {
  REGARD_GIFT_POINTS,
  REGARD_HEARTS,
  REGARD_MAX_POINTS,
  REGARD_POINTS_PER_HEART,
  REGARD_QUEST_POINTS,
  regardKey
} from '../../src/core/Constants';
import dialogueDoc from '../../src/data/dialogue.json';
import questsDoc from '../../src/data/quests.json';
import type { DialogueData, QuestsData } from '../../src/core/types';
import { capture, createTestContext } from './helpers';

const quests = questsDoc as unknown as QuestsData;
const dialogue = dialogueDoc as unknown as DialogueData;

describe('RegardSystem — the five hearts', () => {
  it('starts at nothing: a relationship is earned, never granted', () => {
    const ctx = createTestContext();
    expect(ctx.systems.regard.hearts('eleanor')).toBe(0);
    expect(ctx.systems.regard.hearts('selyna')).toBe(0);
  });

  it('takes a gift a live subquest asks for, and refuses everything else', () => {
    const ctx = createTestContext();
    const accepted = capture(ctx.bus, 'regard:gift_accepted');
    const declined = capture(ctx.bus, 'regard:gift_declined');

    // `what_she_will_take` asks Selyna for Ground Lenses. Eleanor's baskets are
    // a DELIVERY now — the keepsake asks are what stayed gifts, and a gift step
    // is the only thing `wants()` is derived from.
    expect(ctx.systems.regard.wants('selyna', 'orrery', 1)).toBe(true);
    ctx.bus.emit('ui:gift_requested', { characterId: 'selyna', chain: 'orrery', tier: 1 });
    expect(accepted).toHaveLength(1);
    expect(ctx.systems.regard.given('selyna', 'orrery', 1)).toBe(1);
    expect(ctx.systems.regard.points('selyna')).toBe(REGARD_GIFT_POINTS);

    // A Gem Shard is not on her gift list — but her own live ORDER (the
    // brazier) asks for six, so the give is taken as a delivery in singles:
    // the given-counter moves, and no Regard is paid (the Deliver button pays
    // none either — the two verbs stay worth the same).
    ctx.bus.emit('ui:gift_requested', { characterId: 'eleanor', chain: 'flame_gem', tier: 1 });
    expect(declined).toHaveLength(0);
    expect(ctx.systems.regard.given('eleanor', 'flame_gem', 1)).toBe(1);
    expect(ctx.systems.regard.points('eleanor')).toBe(0); // a delivery pays no Regard

    // A Quartz Pebble is on NOBODY's list — no gift step, no live order.
    ctx.bus.emit('ui:gift_requested', { characterId: 'eleanor', chain: 'quartz', tier: 1 });
    expect(declined.at(-1)).toMatchObject({ reason: 'not_wanted' });
    expect(ctx.systems.regard.given('eleanor', 'quartz', 1)).toBe(0);
  });

  it('stops wanting a piece once the subquest that asked for it is satisfied', () => {
    const ctx = createTestContext();
    const need = 3; // what_she_will_take → take_flowers
    for (let i = 0; i < need; i++) {
      ctx.bus.emit('ui:gift_requested', { characterId: 'selyna', chain: 'orrery', tier: 1 });
    }
    expect(ctx.systems.regard.given('selyna', 'orrery', 1)).toBe(need);
    expect(ctx.systems.regard.wants('selyna', 'orrery', 1)).toBe(false);

    // …and one more offering is politely handed back rather than eaten.
    const declined = capture(ctx.bus, 'regard:gift_declined');
    ctx.bus.emit('ui:gift_requested', { characterId: 'selyna', chain: 'orrery', tier: 1 });
    expect(declined).toHaveLength(1);
    expect(ctx.systems.regard.given('selyna', 'orrery', 1)).toBe(need);
  });

  it('a gift step locked behind hearts is neither asked for nor accepted', () => {
    const ctx = createTestContext();
    const step = quests.quests
      .find((q) => q.id === 'what_she_keeps')!
      .steps.find((s) => s.id === 'keeps_preserve')!;

    expect(step.lockedUntil?.regard).toEqual({ characterId: 'eleanor', hearts: 1 });
    expect(ctx.systems.quests.isLocked(step)).toBe(true);
    expect(ctx.systems.regard.wants('eleanor', 'emberberry', 3)).toBe(false);

    // Cross the first heart and she starts asking.
    ctx.state.stats[regardKey('eleanor')] = REGARD_POINTS_PER_HEART;
    expect(ctx.systems.quests.isLocked(step)).toBe(false);
    expect(ctx.systems.regard.wants('eleanor', 'emberberry', 3)).toBe(true);
  });

  it('pays the giver when a quest completes — once, however often it is re-derived', () => {
    const ctx = createTestContext();
    const changed = capture(ctx.bus, 'regard:changed');

    ctx.bus.emit('quest:completed', { questId: 'warm_the_hearth' });
    expect(ctx.systems.regard.points('eleanor')).toBe(REGARD_QUEST_POINTS);

    ctx.bus.emit('quest:completed', { questId: 'warm_the_hearth' });
    expect(ctx.systems.regard.points('eleanor')).toBe(REGARD_QUEST_POINTS);
    expect(changed).toHaveLength(1);
  });

  it('the endless Ledger tail pays nothing — it never ends, so it is not a rung', () => {
    const ctx = createTestContext();
    ctx.bus.emit('quest:completed', { questId: 'keep_the_ledger' });
    expect(ctx.systems.regard.points('eleanor')).toBe(0);
  });

  it('announces each whole heart as it fills, and never more than five', () => {
    const ctx = createTestContext();
    const hearts = capture(ctx.bus, 'regard:heart');

    // One point short of the first heart: nothing has been crossed yet.
    ctx.state.stats[regardKey('selyna')] = REGARD_POINTS_PER_HEART - 1;
    expect(ctx.systems.regard.hearts('selyna')).toBe(0);

    ctx.bus.emit('ui:gift_requested', { characterId: 'selyna', chain: 'orrery', tier: 1 });
    expect(hearts).toEqual([{ characterId: 'selyna', hearts: 1 }]);

    // The cap holds, and nothing beyond the fifth heart is ever announced.
    ctx.state.stats[regardKey('selyna')] = REGARD_MAX_POINTS;
    ctx.bus.emit('quest:completed', { questId: 'north_landing' });
    expect(ctx.systems.regard.points('selyna')).toBe(REGARD_MAX_POINTS);
    expect(ctx.systems.regard.hearts('selyna')).toBe(REGARD_HEARTS);
    expect(hearts).toHaveLength(1);
  });

  it('a full gauge declines gifts as SATED, not as unwanted', () => {
    const ctx = createTestContext();
    const declined = capture(ctx.bus, 'regard:gift_declined');
    ctx.state.stats[regardKey('eleanor')] = REGARD_MAX_POINTS;
    // A wanted piece is still taken at the cap — the subquest asking for it has
    // to be finishable. What changes is the sentence she declines the REST with:
    // "I have everything I need from you" is a different refusal from "that
    // isn't what I asked for", and at five hearts it is the only true one.
    // (Quartz: her orders never ask for it either, so it is a pure decline.)
    ctx.bus.emit('ui:gift_requested', { characterId: 'eleanor', chain: 'quartz', tier: 1 });
    expect(declined.at(-1)).toMatchObject({ reason: 'complete' });
    // Her keepsake ask (the Preserve) is unlocked long before five hearts, so
    // the wanted piece is still taken at the cap.
    ctx.bus.emit('ui:gift_requested', { characterId: 'eleanor', chain: 'emberberry', tier: 3 });
    expect(ctx.systems.regard.given('eleanor', 'emberberry', 3)).toBe(1);
  });

  it('survives a reload: the points persist and unpaid quests settle silently', () => {
    const ctx = createTestContext();
    ctx.bus.emit('quest:completed', { questId: 'warm_the_hearth' });
    const save = ctx.state.toSave(0, 99);

    const fresh = createTestContext();
    const hearts = capture(fresh.bus, 'regard:heart');
    fresh.state.hydrate(save);
    fresh.bus.emit('state:loaded', { offlineMs: 0, energyRecovered: 0 });

    expect(fresh.systems.regard.points('eleanor')).toBe(REGARD_QUEST_POINTS);
    // A load re-derives; it must never replay the milestone scenes.
    expect(hearts).toEqual([]);
  });

  /**
   * The pacing claim in Constants, checked rather than believed: the gauge is
   * meant to be full at the END of the campaign, and the only way that stays
   * true as quests are added is if someone counts.
   */
  it('is paced to fill in 15–20 quests, which is the whole campaign', () => {
    const perQuest = REGARD_QUEST_POINTS;
    const questsOnly = Math.ceil(REGARD_MAX_POINTS / perQuest);
    expect(questsOnly).toBe(20);

    // A player who also gives her what she asks for gets there sooner — but not
    // so much sooner that the last two hearts land in the first act.
    const withOneGiftPerQuest = Math.ceil(REGARD_MAX_POINTS / (perQuest + REGARD_GIFT_POINTS));
    expect(withOneGiftPerQuest).toBe(15);
  });

  /**
   * Every heart is a scene. A milestone with no lines is a heart that fills in
   * silence, which is the one thing this system must never do — the icons are
   * the least of what is supposed to change.
   */
  it('every character who can hold Regard has all five milestone scenes authored', () => {
    const ctx = createTestContext();
    for (const id of ctx.systems.regard.characterIds) {
      const bank = dialogue.regard?.[id];
      expect(bank, `${id} has no regard dialogue`).toBeTruthy();
      expect(bank!.giftAccepted.length, `${id} gift-accepted lines`).toBeGreaterThan(0);
      expect(bank!.giftDeclined.length, `${id} gift-declined lines`).toBeGreaterThan(0);
      for (let h = 1; h <= REGARD_HEARTS; h++) {
        expect(ctx.systems.story.regardBeats(id, h), `${id} heart ${h}`).toBeTruthy();
      }
    }
  });

  /**
   * A `regard` GOAL is the one goal a player cannot grind for directly, so an
   * authored one that outruns its own ladder would stall the HUD forever.
   */
  it('no quest asks for more hearts than its own ladder can have paid by then', () => {
    for (const quest of quests.quests) {
      const world = quest.world ?? 'emberkeep';
      const ladder = quests.quests.filter((q) => (q.world ?? 'emberkeep') === world);
      const before = ladder.slice(0, ladder.indexOf(quest));
      for (const step of quest.steps) {
        const goal = step.goal;
        const wanted =
          goal.kind === 'regard' ? goal.hearts : step.lockedUntil?.regard?.hearts ?? 0;
        if (!wanted) continue;
        const who = goal.kind === 'regard' ? goal.characterId : step.lockedUntil!.regard!.characterId;
        const banked = before
          .filter((q) => q.giver === who)
          .reduce((sum, q) => sum + (q.regard ?? REGARD_QUEST_POINTS), 0);
        expect(
          Math.floor(banked / REGARD_POINTS_PER_HEART),
          `${step.id} wants ${wanted} heart(s) from ${who}, but only ${banked} point(s) are payable before it`
        ).toBeGreaterThanOrEqual(wanted);
      }
    }
  });

  it('takes a gift the TUTORIAL staged, at the price that beat named', () => {
    const ctx = createTestContext();
    const accepted = capture(ctx.bus, 'regard:gift_accepted');

    // Nothing on the ladder asks for a Crystal Ball...
    expect(ctx.systems.regard.wants('eleanor', 'quartz', 3)).toBe(false);

    // ...until a beat stages the want. The Ledger is not open during the
    // tutorial, so this stands in for the `gift` subquest that would normally
    // answer `wants()`.
    ctx.bus.emit('tutorial:want_gift', {
      characterId: 'eleanor',
      chain: 'quartz',
      tier: 3,
      count: 1,
      points: REGARD_POINTS_PER_HEART
    });
    expect(ctx.systems.regard.wants('eleanor', 'quartz', 3)).toBe(true);

    ctx.bus.emit('ui:gift_requested', { characterId: 'eleanor', chain: 'quartz', tier: 3 });
    expect(accepted).toHaveLength(1);
    // A whole heart, so the beat that follows has something lit to point at.
    expect(ctx.systems.regard.hearts('eleanor')).toBe(1);
  });

  it('spends the scripted want, so one lesson cannot be farmed', () => {
    const ctx = createTestContext();
    ctx.bus.emit('tutorial:want_gift', {
      characterId: 'eleanor',
      chain: 'quartz',
      tier: 3,
      count: 1,
      points: REGARD_POINTS_PER_HEART
    });
    ctx.bus.emit('ui:gift_requested', { characterId: 'eleanor', chain: 'quartz', tier: 3 });
    const after = ctx.systems.regard.points('eleanor');

    ctx.bus.emit('ui:gift_requested', { characterId: 'eleanor', chain: 'quartz', tier: 3 });
    expect(ctx.systems.regard.wants('eleanor', 'quartz', 3)).toBe(false);
    expect(ctx.systems.regard.points('eleanor')).toBe(after);
  });
});
