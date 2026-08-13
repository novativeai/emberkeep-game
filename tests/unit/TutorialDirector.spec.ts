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
  'character:action_used': ['character']
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

  // (The `character:action_used` gate had its own case here, pinned on
  // `eleanor_helps`. That step was cut from the ladder — it turned the energy
  // lesson into a two-target errand — and a test that looks up a step by an id
  // no longer in the script asserts against index −1, which passes for the
  // wrong reason as easily as it fails. The DIRECTOR still handles the gate,
  // and `allows the verb every event gate demands` above still holds any
  // future step that uses it to allowing `character`.)

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
