import { describe, expect, it } from 'vitest';
import tutorial from '../../src/data/tutorial.json';
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
