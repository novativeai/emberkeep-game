import { describe, expect, it } from 'vitest';
import tutorialJson from '../../src/data/tutorial.json';
import {
  dataOf,
  MAIN_SCRIPT_ID,
  scriptsOf,
  scriptStatKeys,
  triggerMet,
  validateTutorialData,
  type TriggerFacts
} from '../../src/core/tutorialScripts';
import type { TutorialData, TutorialStepConfig } from '../../src/core/types';
import { capture, createTestContext } from './helpers';

const shipped = tutorialJson as unknown as TutorialData;

const tap = (id: string, text = id): TutorialStepConfig => ({ id, speaker: 'eleanor', text, gate: { type: 'tap' } });

/** A two-beat main script and two mid-game lessons with different triggers. */
const fixture: TutorialData = {
  steps: [tap('m1'), tap('m2')],
  tutorials: [
    {
      id: 'pots',
      title: 'The pot',
      trigger: { type: 'quest_done', quest: 'north_landing' },
      steps: [
        { ...tap('p1'), effects: [{ grantKeys: 1 }], allow: { cookbook: false } },
        tap('p2')
      ]
    },
    {
      id: 'after_pots',
      trigger: { type: 'step_done', tutorial: 'pots', step: 'p1' },
      allowBase: 'nothing',
      steps: [tap('a1')]
    }
  ]
};

const facts = (over: Partial<TriggerFacts> = {}): TriggerFacts => ({
  stat: () => 0,
  level: 1,
  worldId: 'emberkeep',
  mainDone: true,
  mainIndex: 0,
  ...over
});

describe('tutorialScripts (the file, read once)', () => {
  it('presents the main script first, as `main` with trigger start', () => {
    const scripts = scriptsOf(fixture);
    expect(scripts.map((s) => s.id)).toEqual([MAIN_SCRIPT_ID, 'pots', 'after_pots']);
    expect(scripts[0]!.trigger).toEqual({ type: 'start' });
    expect(scripts[0]!.allowBase).toBe('nothing');
    expect(scripts[1]!.allowBase).toBe('everything'); // the mid-game default
    expect(scripts[2]!.allowBase).toBe('nothing'); // an author's choice survives
  });

  it('round-trips through dataOf without inventing fields', () => {
    expect(dataOf(scriptsOf(fixture))).toEqual(fixture);
    expect(dataOf(scriptsOf(shipped))).toEqual(shipped);
  });

  it('the shipped tutorial.json validates clean', () => {
    expect(validateTutorialData(shipped)).toEqual([]);
    expect(validateTutorialData(fixture)).toEqual([]);
  });

  it('refuses dangling triggers, duplicate ids and a second start', () => {
    const bad: TutorialData = {
      steps: [tap('m1')],
      tutorials: [
        { id: 'x', trigger: { type: 'start' }, steps: [tap('m1')] },
        { id: 'y', trigger: { type: 'step_done', tutorial: 'x', step: 'nope' }, steps: [tap('y1')] },
        { id: 'y', trigger: { type: 'tutorial_done', tutorial: 'ghost' }, steps: [] }
      ]
    };
    const errors = validateTutorialData(bad);
    expect(errors.some((e) => e.includes("only the main script may start at 'start'"))).toBe(true);
    expect(errors.some((e) => e.includes('duplicate step id "m1"'))).toBe(true);
    expect(errors.some((e) => e.includes('no step "nope"'))).toBe(true);
    expect(errors.some((e) => e.includes('duplicate script id "y"'))).toBe(true);
    expect(errors.some((e) => e.includes('unknown tutorial "ghost"'))).toBe(true);
  });

  it('a move gate needs a chain and a region and/or an [col,row] cell', () => {
    const withGate = (gate: unknown): TutorialData => ({
      steps: [{ ...tap('m1'), gate: gate as TutorialStepConfig['gate'] }]
    });
    expect(validateTutorialData(withGate({ type: 'move', chain: 'emberbark', at: [32, 0] }))).toEqual([]);
    expect(validateTutorialData(withGate({ type: 'move', chain: 'emberbark', region: 'home' }))).toEqual([]);
    expect(validateTutorialData(withGate({ type: 'move', chain: 'emberbark' })).join(';')).toMatch(/region and\/or/);
    expect(validateTutorialData(withGate({ type: 'move', region: 'home' })).join(';')).toMatch(/needs a chain/);
    expect(validateTutorialData(withGate({ type: 'move', chain: 'emberbark', at: [1] })).join(';')).toMatch(/\[col, row\]/);
  });

  it('no mid-game trigger is met before the main script is done', () => {
    const scripts = scriptsOf(fixture);
    const pots = scripts[1]!;
    expect(triggerMet(scripts, facts({ mainDone: false, stat: () => 1 }), pots)).toBe(false);
    expect(triggerMet(scripts, facts({ stat: (k) => (k === 'q:done:north_landing' ? 1 : 0) }), pots)).toBe(true);
  });

  it('step_done reads the other script\'s progress, main included', () => {
    const scripts = scriptsOf(fixture);
    const after = scripts[2]!;
    const potsStep = scriptStatKeys('pots').step;
    expect(triggerMet(scripts, facts(), after)).toBe(false);
    expect(triggerMet(scripts, facts({ stat: (k) => (k === potsStep ? 1 : 0) }), after)).toBe(true);
    const onMain = { ...after, trigger: { type: 'step_done', tutorial: 'main', step: 'm1' } as const };
    expect(triggerMet(scripts, facts({ mainDone: false, mainIndex: 0 }), onMain)).toBe(false);
    expect(triggerMet(scripts, facts({ mainDone: true }), onMain)).toBe(true);
  });
});

describe('TutorialDirector (mid-game lessons on their triggers)', () => {
  function finishMain(ctx: ReturnType<typeof createTestContext>): void {
    ctx.systems.tutorial.begin();
    for (const id of ['m1', 'm2']) ctx.bus.emit('tutorial:advance_requested', { stepId: id });
    expect(ctx.state.tutorialDone).toBe(true);
  }

  it('a lesson waits for its quest, then takes the board with its own allow base', () => {
    const ctx2 = createTestContext(undefined, { tutorial: fixture });
    const steps = capture(ctx2.bus, 'tutorial:step');
    finishMain(ctx2);
    expect(steps.at(-1)).toMatchObject({ done: true, tutorial: 'main' });
    expect(ctx2.systems.tutorial.activeScriptId).toBeNull();

    const keysBefore = ctx2.state.keys;
    ctx2.state.addStat('q:done:north_landing', 1);
    ctx2.bus.emit('quest:completed', { questId: 'north_landing' });

    const live = steps.at(-1)!;
    expect(live).toMatchObject({ id: 'p1', tutorial: 'pots', index: 0, total: 2, done: false });
    // Mid-game default: everything stays allowed except what the step holds back.
    expect(live.allow.drag).toEqual(['*']);
    expect(live.allow.cookbook).toBe(false);
    expect(live.allow.bag).toBe(true);
    // The first step's effects fired once, on the start.
    expect(ctx2.state.keys).toBe(keysBefore + 1);
    expect(ctx2.systems.tutorial.activeScriptId).toBe('pots');
  });

  it('progress lives in stats and resumes after a reload on the same beat', () => {
    const ctx = createTestContext(undefined, { tutorial: fixture });
    finishMain(ctx);
    ctx.state.addStat('q:done:north_landing', 1);
    ctx.bus.emit('quest:completed', { questId: 'north_landing' });
    ctx.bus.emit('tutorial:advance_requested', { stepId: 'p1' });
    expect(ctx.state.stat(scriptStatKeys('pots').step)).toBe(1);

    // "Reload": a fresh director over the same state resumes on p2, not p1,
    // and does not re-fire p1's effects.
    const again = createTestContext(undefined, { tutorial: fixture });
    for (const [k, v] of Object.entries(ctx.state.stats)) again.state.addStat(k, v);
    again.state.tutorialDone = true;
    again.state.tutorialIndex = 2;
    const steps = capture(again.bus, 'tutorial:step');
    const keysBefore = again.state.keys;
    again.systems.tutorial.begin();
    expect(steps.at(-1)).toMatchObject({ id: 'p2', tutorial: 'pots', index: 1 });
    expect(again.state.keys).toBe(keysBefore);
  });

  it('finishing a lesson hands the board back and lets the next met trigger start', () => {
    const ctx = createTestContext(undefined, { tutorial: fixture });
    const steps = capture(ctx.bus, 'tutorial:step');
    finishMain(ctx);
    ctx.state.addStat('q:done:north_landing', 1);
    ctx.bus.emit('quest:completed', { questId: 'north_landing' });
    ctx.bus.emit('tutorial:advance_requested', { stepId: 'p1' });
    // p1 is done, so `after_pots` is ARMED — but pots still holds the board.
    expect(ctx.systems.tutorial.activeScriptId).toBe('pots');
    ctx.bus.emit('tutorial:advance_requested', { stepId: 'p2' });
    // pots hands back (done latch), and after_pots takes its turn at once.
    expect(ctx.state.stat(scriptStatKeys('pots').done)).toBe(1);
    expect(steps.at(-1)).toMatchObject({ id: 'a1', tutorial: 'after_pots', done: false });
    expect(steps.at(-1)!.allow.drag).toEqual([]); // allowBase: nothing
    ctx.bus.emit('tutorial:advance_requested', { stepId: 'a1' });
    expect(steps.at(-1)).toMatchObject({ done: true });
    expect(ctx.systems.tutorial.activeScriptId).toBeNull();
    // A finished lesson never replays.
    ctx.bus.emit('quest:completed', { questId: 'north_landing' });
    expect(ctx.systems.tutorial.activeScriptId).toBeNull();
  });

  it('an event trigger is latched when observed, so a reload still knows', () => {
    const data: TutorialData = {
      steps: [tap('m1')],
      tutorials: [{ id: 'hatch_tip', trigger: { type: 'event', event: 'item:merged', chain: 'lumber' }, steps: [tap('h1')] }]
    };
    const ctx = createTestContext(undefined, { tutorial: data });
    ctx.systems.tutorial.begin();
    // Observed BEFORE main is done: latched, not started.
    ctx.bus.emit('item:merged', { chain: 'lumber', fromTier: 1, resultTier: 2 } as never);
    expect(ctx.state.stat(scriptStatKeys('hatch_tip').trigger)).toBe(1);
    expect(ctx.systems.tutorial.activeScriptId).toBe('main');
    ctx.bus.emit('tutorial:advance_requested', { stepId: 'm1' });
    // Main done → the latched observation starts the lesson immediately.
    expect(ctx.systems.tutorial.activeScriptId).toBe('hatch_tip');
  });
});
