import { describe, expect, it } from 'vitest';
import tutorial from '../../src/data/tutorial.json';
import { skipEnergyCost } from '../../src/core/Constants';
import type { TutorialAllow, TutorialStepConfig } from '../../src/core/types';
import { capture, createTestContext } from './helpers';

const steps = tutorial.steps as unknown as TutorialStepConfig[];

/**
 * The verb each event gate needs in its OWN step's allow-list. A gate whose
 * verb is not allowed is an unwinnable step — the player is asked for an action
 * the tutorial is simultaneously refusing, with no way out but a reinstall.
 * (tutorial-design law 5; the skill's ftuecheck.py checks the same table, this
 * keeps it in CI.)
 */
const GATE_REQUIRES: Record<string, Array<keyof TutorialAllow>> = {
  'item:merged': ['drag'],
  'item:hatched': ['drag'],
  'item:harvested': ['tapGenerators'],
  'chest:open': ['tapGenerators'],
  'generator:skipped': ['tapGenerators'],
  // Paying a sleeping dragon awake goes through the tap that offers any other
  // skip, so it needs the same verb.
  'dragon:sleep_skipped': ['tapGenerators'],
  'dragon:working': ['dragonWork', 'drag'],
  'region:unlocked': ['fog'],
  'marketplace:purchased': ['marketplace'],
  'ui:cookbook_opened': ['cookbook'],
  'ui:cookbook_closed': ['cookbook'],
  'ui:ledger_opened': ['ledger'],
  'order:completed': ['ledger', 'deliver'],
  'bag:stored': ['bag'],
  // Selling lives in the Bag, so a sale needs the satchel open AND the verb on.
  'item:sold': ['bag', 'sell'],
  'character:action_used': ['character'],
  // A beat waiting for the next page of the Codex needs the book HELD open:
  // Phaser delivers the bubble's tap to the panel's scrim too, so an unheld
  // book shuts under the very step that is waiting on it.
  'ui:codex_dragon_opened': ['codexHold'],
  'ui:codex_evolution_opened': ['codexHold']
};

const stepAt = (id: string): number => steps.findIndex((s) => s.id === id);

describe('the tutorial script (no unwinnable step)', () => {
  it('allows the verb every event gate demands', () => {
    const broken: string[] = [];
    for (const step of steps) {
      if (step.gate.type !== 'event') continue;
      const allow = (step.allow ?? {}) as TutorialAllow;
      for (const need of GATE_REQUIRES[step.gate.event] ?? []) {
        if (need === 'drag') {
          const wanted = step.gate.chain;
          const got = allow.drag ?? [];
          if (!got.length) broken.push(`${step.id}: gate needs drag, allow.drag is empty`);
          else if (wanted && !got.includes('*') && !got.includes(wanted)) {
            broken.push(`${step.id}: gate wants '${wanted}' but allow.drag is [${got}]`);
          }
        } else if (!allow[need]) {
          broken.push(`${step.id}: gate '${step.gate.event}' needs allow.${need}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('teaches every concept the ledger claims, in the order it claims', () => {
    // The satchel and selling must be taught only once the pieces they use are
    // revealed AND nothing scripted still needs them — pocketing one of the three
    // Bushes before `bush_merge` would strand that gate forever.
    expect(stepAt('pocket_it')).toBeGreaterThan(stepAt('bush_merge'));
    expect(stepAt('sell_it')).toBeGreaterThan(stepAt('pocket_it'));
    // The Ledger arc needs a shard source, so it follows the Green Dragon.
    expect(stepAt('gem_harvest')).toBeGreaterThan(stepAt('green_dragon_hatch'));
    expect(stepAt('ledger_open')).toBeGreaterThan(stepAt('gem_harvest'));
    expect(stepAt('ledger_deliver')).toBeGreaterThan(stepAt('ledger_open'));
    // Her tease pays off the order she was just delivered.
    expect(stepAt('golden_tease')).toBeGreaterThan(stepAt('ledger_deliver'));
  });

  it('pays no order XP before the scripted level-up beat', () => {
    // LEVEL_XP[1] is 60 and the scripted merges deliver exactly that by
    // `levelup`. An order delivered earlier (+30) fires Level 2 off its beat.
    const deliver = stepAt('ledger_deliver');
    expect(deliver).toBeGreaterThan(stepAt('levelup'));
  });

  it('keeps every bubble inside the 180-character budget', () => {
    const over = steps.filter((s) => s.text.length > 180).map((s) => `${s.id} (${s.text.length})`);
    expect(over).toEqual([]);
  });
});

describe('TutorialDirector (the new gates advance)', () => {
  it('advances a bag:stored gate only for the chain it names', () => {
    const ctx = createTestContext();
    const index = stepAt('pocket_it');
    ctx.state.tutorialIndex = index;

    ctx.bus.emit('bag:stored', { chain: 'lumber', tier: 1, at: { col: 0, row: 0 } });
    expect(ctx.state.tutorialIndex).toBe(index); // wrong chain — still waiting

    ctx.bus.emit('bag:stored', { chain: 'cinder_vein', tier: 1, at: { col: 0, row: 0 } });
    expect(ctx.state.tutorialIndex).toBe(index + 1);
  });

  it('advances the sell gate on item:sold', () => {
    const ctx = createTestContext();
    const index = stepAt('sell_it');
    ctx.state.tutorialIndex = index;

    ctx.bus.emit('item:sold', { chain: 'cinder_vein', tier: 1, coins: 3 });
    expect(ctx.state.tutorialIndex).toBe(index + 1);
  });

  it("advances Eleanor's beat when her help is actually used", () => {
    const ctx = createTestContext();
    const index = stepAt('eleanor_helps');
    ctx.state.tutorialIndex = index;

    ctx.bus.emit('character:action_used', {
      characterId: 'eleanor',
      action: 'give_back',
      readyAt: 1
    });
    expect(ctx.state.tutorialIndex).toBe(index + 1);
  });

  it('emits an allow-list carrying the new verbs', () => {
    const ctx = createTestContext();
    const emitted = capture(ctx.bus, 'tutorial:step');
    ctx.state.tutorialIndex = stepAt('pocket_it');
    ctx.systems.tutorial.begin();

    const step = emitted.at(-1)!;
    expect(step.id).toBe('pocket_it');
    expect(step.allow.bag).toBe(true);
    expect(step.allow.character).toBe(false);
    expect(step.allow.sell).toBe(false); // one verb per beat
  });
});

/**
 * The Codex lesson is a WALK through the book — roster card, the taste row,
 * Evolution, then the ✕ — and every beat of it is gated on a page turning.
 * Three things have to hold or the player is locked inside a panel: the pages
 * advance the script, the book is held open until the beat that teaches
 * closing, and a reload knows which spread its bubble is talking about.
 */
describe('the Codex lesson walks the book', () => {
  const LESSON = ['codex_meal', 'codex_taste', 'codex_evolution', 'codex_cycles', 'codex_reward', 'codex_shut'];

  it('turns page by page, and only on the page each beat is waiting for', () => {
    const ctx = createTestContext();
    ctx.state.tutorialIndex = stepAt('codex_meal');

    // The book opens on the roster: that is the page the beat STARTS on, so it
    // must not also be the page that ends it.
    ctx.bus.emit('ui:codex_page', { page: 'roster' });
    expect(ctx.state.tutorialIndex).toBe(stepAt('codex_meal'));

    ctx.bus.emit('ui:codex_page', { page: 'detail' });
    expect(ctx.state.tutorialIndex).toBe(stepAt('codex_taste'));
    // Reading the page is not opening Evolution.
    ctx.bus.emit('ui:codex_page', { page: 'detail' });
    expect(ctx.state.tutorialIndex).toBe(stepAt('codex_taste'));

    ctx.bus.emit('ui:codex_page', { page: 'evolution' });
    expect(ctx.state.tutorialIndex).toBe(stepAt('codex_evolution'));

    // Three tap-gated bubbles: what the shadow is, how cycles bank, the payoff.
    for (const id of ['codex_evolution', 'codex_cycles', 'codex_reward']) {
      ctx.bus.emit('tutorial:advance_requested', { stepId: id });
    }
    expect(ctx.state.tutorialIndex).toBe(stepAt('codex_shut'));

    ctx.bus.emit('ui:codex_toggled', { open: false });
    expect(ctx.state.tutorialIndex).toBe(stepAt('codex_shut') + 1);
  });

  it('holds the book open for every beat but the one that closes it', () => {
    for (const id of LESSON) {
      const step = steps[stepAt(id)]!;
      const held = (step.allow ?? {}).codexHold === true;
      // `codex_shut` teaches the ✕ — holding it there would be a beat asking
      // for an action the panel is simultaneously refusing (law 3).
      expect(held, `${id} hold`).toBe(id !== 'codex_shut');
    }
  });

  it('names the page each beat stands on, so a reload comes back to it', () => {
    // `openCodex` is replayed on resume (it opens a panel and leaves nothing in
    // the save). Each beat's page must be the one BEFORE its own gate, or the
    // replay would satisfy the step it just restored.
    const pageOf = (id: string): string | undefined => {
      const effects = (steps[stepAt(id)]!.effects ?? []) as Array<{ openCodex?: { page?: string } }>;
      return effects.find((e) => e.openCodex)?.openCodex?.page;
    };
    expect(pageOf('codex_meal')).toBe('roster');
    expect(pageOf('codex_taste')).toBe('detail');
    for (const id of ['codex_evolution', 'codex_cycles', 'codex_reward', 'codex_shut']) {
      expect(pageOf(id), `${id} page`).toBe('evolution');
    }
  });

  it('re-opens the book on resume — a gate on a panel that is not there is a dead save', () => {
    const ctx = createTestContext();
    const asked = capture(ctx.bus, 'ui:codex_open_requested');
    ctx.state.tutorialIndex = stepAt('codex_cycles');
    ctx.systems.tutorial.begin();
    expect(asked).toEqual([{ page: 'evolution' }]);
  });
});

/**
 * THE CROSSING — the one sleep the tutorial allows.
 *
 * The gate to the hub blooms on the Brazier delivery and the named hatchling
 * flies through it. She cannot cross curled up, so the beat between the two
 * scripts her asleep and teaches the verb that ends any wait in this game:
 * pay for it. Everything about it is deliberate — the sleep is scripted (a
 * clock jump would land it wherever it liked), the beat is affordable out of
 * the delivery it follows, and the flight waits for the wake rather than
 * forcing it.
 */
describe('the gate_wake beat — a dragon paid awake for the crossing', () => {
  const step = () => steps[stepAt('gate_wake')]!;

  it('stands between the delivery that opens the gate and the tease that follows', () => {
    expect(stepAt('gate_wake')).toBe(stepAt('ledger_deliver') + 1);
    expect(stepAt('golden_tease')).toBe(stepAt('gate_wake') + 1);
  });

  it('scripts the sleep it asks the player to end', () => {
    // Without this the beat waits on a dragon the tutorial keeps awake by rule
    // (`moodOf` suppresses sleep for the whole script) — an unwinnable step.
    const effects = step().effects ?? [];
    const sleep = effects.find((e) => 'sleepDragon' in e) as { sleepDragon: { ms: number } };
    expect(sleep?.sleepDragon.ms).toBeGreaterThan(0);
    // …and clears her cooldown, or the tap would sell the GENERATOR's timer
    // (checked first) and the beat's own gate would never hear about it.
    expect(effects.some((e) => 'setTimer' in e && e.setTimer.chain === 'ember_dragon')).toBe(true);
  });

  it('puts her down, and the gold she was just paid covers waking her', () => {
    const ctx = createTestContext();
    const dragon = ctx.state.addItem({ chain: 'ember_dragon', tier: 3, col: 1, row: 1, kind: 'item' });
    ctx.bus.emit('ui:dragon_named', { itemId: dragon.id, name: 'Ember' });
    ctx.state.tutorialIndex = stepAt('gate_wake') - 1;
    ctx.state.coins = 0;

    // The delivery that opens the gate pays 25 Gold; the skip is capped at 20.
    ctx.bus.emit('economy:add', { coins: 25, reason: 'test' });
    ctx.bus.emit('order:completed', {
      orderId: 'eleanor_brazier',
      rewards: { coins: 0, keys: 0 }
    });
    expect(ctx.state.tutorialIndex).toBe(stepAt('gate_wake'));
    expect(ctx.systems.dragonLife.asleep(dragon.id)).toBe(true);
    expect(ctx.systems.dragonLife.sleepKindOf(dragon.id)).toBe('scripted');

    const timer = ctx.systems.dragonLife.sleepTimer(dragon.id)!;
    expect(skipEnergyCost(timer.remaining, timer.total)).toBeLessThanOrEqual(ctx.state.coins);

    ctx.bus.emit('dragon:sleep_skip', { itemId: dragon.id, currency: 'gold' });
    expect(ctx.systems.dragonLife.asleep(dragon.id)).toBe(false);
    expect(ctx.state.tutorialIndex).toBe(stepAt('golden_tease'));
  });

  it('re-scripts the sleep on resume — a reload must not leave her standing', () => {
    // Nothing in DragonLifeSystem is persisted, so a save reloaded on this beat
    // comes back to a dragon who is awake and a gate that can never fire.
    const ctx = createTestContext();
    const dragon = ctx.state.addItem({ chain: 'ember_dragon', tier: 3, col: 1, row: 1, kind: 'item' });
    ctx.bus.emit('ui:dragon_named', { itemId: dragon.id, name: 'Ember' });
    ctx.state.tutorialIndex = stepAt('gate_wake');
    ctx.systems.tutorial.begin();
    expect(ctx.systems.dragonLife.asleep(dragon.id)).toBe(true);
  });
});
