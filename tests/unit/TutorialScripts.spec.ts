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
import { callerAllowed, dropReport, refuseDrop, TACIT_STEP_DROPS } from '../../tools/tutorial-api/server';
import type { IncomingMessage } from 'node:http';
import type { MarkerPoint, TutorialData, TutorialStepConfig } from '../../src/core/types';
import { capture, createTestContext, drag } from './helpers';

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

  it('refuses to rebuild the file from a list that dropped Chapter One', () => {
    // The shape a client PUTs when it sends back only the scripts it edited —
    // and the shape `{"scripts": []}` takes. It used to yield `{ steps: [] }`
    // and a cheerful 200 over all 64 beats; it must cost an exception instead.
    expect(() => dataOf(scriptsOf(fixture).filter((s) => s.id !== MAIN_SCRIPT_ID))).toThrow(/no "main" script/);
    expect(() => dataOf([])).toThrow(/without Chapter One/);
  });

  it('a partial PUT that keeps main still has to admit the lessons it drops', () => {
    // `dataOf` only catches the list that lost CHAPTER ONE. The list that kept
    // main and lost a mid-game LESSON is legal to rebuild — and rebuilding from
    // it DELETES that lesson — so the PUT boundary compares against disk
    // instead. Undeclared: refuse. Declared: delete, and say which.
    const before = scriptsOf(fixture);
    const partial = before.filter((s) => s.id === MAIN_SCRIPT_ID);
    const bare = dropReport(before, partial);
    expect(bare.scripts).toEqual(['pots', 'after_pots']);
    expect(bare.undeclared.scripts).toEqual(['pots', 'after_pots']);
    expect(refuseDrop(bare)).toMatch(/omits 2 script\(s\)[\s\S]*pots, after_pots/);
    // Declaring the scripts covers the beats that die WITH them — deleting a
    // lesson does not also mean listing its beats one by one.
    const said = dropReport(before, partial, ['pots', 'after_pots']);
    expect(said.steps).toEqual(['pots:p1', 'pots:p2', 'after_pots:a1']);
    expect(said.undeclared).toEqual({ scripts: [], steps: [] });
    expect(refuseDrop(said)).toBeNull();
    // Declaring one of two is still a caller that forgot the other.
    expect(dropReport(before, partial, ['pots']).undeclared.scripts).toEqual(['after_pots']);
    // The whole file back is not a deletion at all.
    expect(dropReport(before, before)).toEqual({ scripts: [], steps: [], dropped: [], undeclared: { scripts: [], steps: [] } });
  });

  it('accounts for BEATS, so a truncated script cannot ride in under a full script list', () => {
    // The measured hole: every script id present, `main` cut to its first beat,
    // answered ok:true with dropped:[] over the rest of Chapter One. The
    // accounting is per-BEAT now, so the same body is a 409 that names them.
    const before = scriptsOf(fixture);
    const truncated = before.map((s) => (s.id === MAIN_SCRIPT_ID ? { ...s, steps: s.steps.slice(0, 1) } : s));
    // One beat lost is an EDIT (the World Builder's delete button) and passes,
    // but it is never silent — `dropped` names it and `backup` holds it.
    const one = dropReport(before, truncated);
    expect(one.scripts).toEqual([]);
    expect(one.dropped).toEqual(['main:m2']);
    expect(one.undeclared.steps).toEqual(['main:m2']);
    expect(refuseDrop(one)).toBeNull();
    expect(TACIT_STEP_DROPS).toBe(1);

    // Two or more is a caller sending back something other than the file.
    const gutted = before.map((s) => (s.id === 'pots' ? { ...s, steps: [] } : { ...s, steps: s.steps.slice(0, 1) }));
    const many = dropReport(before, gutted);
    expect(many.undeclared.steps).toEqual(['main:m2', 'pots:p1', 'pots:p2']);
    expect(refuseDrop(many)).toMatch(/destroys 3 beats[\s\S]*main:m2, pots:p1, pots:p2/);
    // …and saying so is what makes it legal. Any of the three spellings works.
    expect(refuseDrop(dropReport(before, gutted, ['main:m2', 'p1', 'pots:p2']))).toBeNull();
  });

  it('does not call a beat MOVED between scripts a beat destroyed', () => {
    // Step ids are unique file-wide, so a beat that turns up under another
    // script is still in the file. Reporting it as dropped would refuse a
    // legitimate re-parent and teach callers to declare drops they did not make.
    const before = scriptsOf(fixture);
    const moved = before.map((s) =>
      s.id === MAIN_SCRIPT_ID ? { ...s, steps: [s.steps[0]!] } : s.id === 'pots' ? { ...s, steps: [...s.steps, before[0]!.steps[1]!] } : s
    );
    expect(dropReport(before, moved)).toEqual({ scripts: [], steps: [], dropped: [], undeclared: { scripts: [], steps: [] } });
  });

  it('a cross-site page cannot reach a dev API even with no Origin to judge', () => {
    // MEASURED against Chromium: a third-party page's <img>/<script>/<link>/
    // iframe/no-cors-fetch all arrive with NO Origin header — the shape the
    // guard lets through for curl — and all of them carry
    // `Sec-Fetch-Site: cross-site`, a forbidden header name no page can forge
    // or strip. That pair is the whole rule; `/__open-in-editor` spawns an
    // editor on this machine from exactly such a GET.
    const req = (headers: Record<string, string>): IncomingMessage =>
      ({ headers: { host: 'localhost:5173', ...headers } }) as unknown as IncomingMessage;

    for (const dest of ['image', 'script', 'style', 'iframe', 'empty']) {
      expect(callerAllowed(req({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': dest }))).toBe(false);
    }
    // A cross-site NAVIGATION (a link, window.open) is the same refusal.
    expect(callerAllowed(req({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' }))).toBe(false);

    // …and everything legitimate still passes.
    expect(callerAllowed(req({}))).toBe(true); // curl, tut.py, evt.py — not browsers
    expect(callerAllowed(req({ 'sec-fetch-site': 'same-origin' }))).toBe(true); // vite's error overlay
    expect(callerAllowed(req({ 'sec-fetch-site': 'none' }))).toBe(true); // a URL typed by hand
    // The World Builder on another loopback port: cross-SITE when it is served
    // from 127.0.0.1 while the game is on localhost, but it sends an Origin and
    // that Origin is loopback, so the origin rule still answers for it.
    expect(callerAllowed(req({ origin: 'http://127.0.0.1:8820', 'sec-fetch-site': 'cross-site' }))).toBe(true);
    expect(callerAllowed(req({ origin: 'http://localhost:8820', 'sec-fetch-site': 'same-site' }))).toBe(true);
    // A stranger that DOES send an Origin was already refused, and still is.
    expect(callerAllowed(req({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(callerAllowed(req({ origin: 'null' }))).toBe(false); // sandboxed iframe
  });

  it('refuses a main script with no steps, but keeps letting a lesson be empty', () => {
    // The rule sits in the validator, so it also catches the OTHER way to empty
    // Chapter One: a `remove_step` on its last beat through `POST /op`.
    const emptyMain: TutorialData = { steps: [], tutorials: fixture.tutorials };
    expect(validateTutorialData(emptyMain).join(';')).toMatch(/Chapter One must keep at least one step/);
    // A mid-game lesson with no beats is an author mid-draft, not a broken game.
    const emptyLesson: TutorialData = {
      steps: [tap('m1')],
      tutorials: [{ id: 'draft', trigger: { type: 'tutorial_done', tutorial: MAIN_SCRIPT_ID }, steps: [] }]
    };
    expect(validateTutorialData(emptyLesson)).toEqual([]);
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

/**
 * A LESSON'S POINTER IS AS LIVE AS THE MAIN SCRIPT'S.
 *
 * `refreshMarkers` used to bail on `state.tutorialDone`, which read as "no
 * script is running" back when `main` was the only script there was. Every
 * mid-game lesson plays with that flag TRUE, so the guard silenced exactly the
 * scripts that need re-aiming: the hand, arrow and highlight froze on whatever
 * the beat resolved on entry, and an arrow whose piece then left the board was
 * hidden by UIScene and never came back — the beat went on gating with nothing
 * on screen pointing at anything.
 */
describe('a mid-game lesson re-aims its pointer at the live board', () => {
  const pointing: TutorialData = {
    steps: [tap('m1')],
    tutorials: [
      {
        id: 'tidy',
        trigger: { type: 'tutorial_done', tutorial: MAIN_SCRIPT_ID },
        steps: [
          {
            ...tap('t1'),
            highlight: [{ chain: 'ashmoss', nth: 0 }],
            arrow: { tile: { chain: 'ashmoss', nth: 0 } }
          }
        ]
      }
    ]
  };

  /** Two tufts on the board, the main script answered, the lesson holding it. */
  function openLesson(): ReturnType<typeof createTestContext> {
    const ctx = createTestContext(undefined, { tutorial: pointing });
    ctx.state.addItem({ chain: 'ashmoss', tier: 1, col: 1, row: 1, kind: 'item' });
    ctx.state.addItem({ chain: 'ashmoss', tier: 1, col: 5, row: 4, kind: 'item' });
    ctx.systems.tutorial.begin();
    ctx.bus.emit('tutorial:advance_requested', { stepId: 'm1' });
    expect(ctx.systems.tutorial.activeScriptId).toBe('tidy');
    return ctx;
  }

  const arrowTile = (arrow: unknown): MarkerPoint | undefined =>
    (arrow as { tile?: MarkerPoint } | null | undefined)?.tile;

  it('follows the piece its arrow names when the player drags it away', () => {
    const ctx = openLesson();
    const steps = capture(ctx.bus, 'tutorial:step');
    const markers = capture(ctx.bus, 'tutorial:markers');
    ctx.systems.tutorial.begin(); // re-open with a listener attached
    const aimed = arrowTile(steps.at(-1)!.arrow)!;
    expect(aimed).toMatchObject({ col: 1, row: 1 });
    const itemId = aimed.item!;

    // Free ground well clear of the other tuft: a drop there is only a move.
    drag(ctx, [1, 1], [1, 4]);

    const after = arrowTile(markers.at(-1)?.arrow);
    expect(after, 'the lesson never re-aimed its arrow').toBeTruthy();
    expect(after).toMatchObject({ col: 1, row: 4, item: itemId });
    expect(markers.at(-1)!.highlight).toEqual([{ col: 1, row: 4 }]);
  });

  it('re-aims — rather than going dark — when that piece leaves the board', () => {
    const ctx = openLesson();
    const steps = capture(ctx.bus, 'tutorial:step');
    const markers = capture(ctx.bus, 'tutorial:markers');
    ctx.systems.tutorial.begin();
    const gone = arrowTile(steps.at(-1)!.arrow)!.item!;
    const survivor = ctx.state.itemAt(5, 4)!.id;

    // Merged, sold, pocketed — all of them reach the board the same way.
    ctx.bus.emit('board:consume_items', { itemIds: [gone], reason: 'delivered' });

    const after = arrowTile(markers.at(-1)?.arrow);
    expect(after, 'the arrow was left on a piece that no longer exists').toBeTruthy();
    // The rank re-resolves onto the tuft still standing: UIScene hides a
    // piece-anchored arrow whose piece is gone, and only a fresh marker event
    // can ever bring it back.
    expect(after).toMatchObject({ col: 5, row: 4, item: survivor });
    // The beat is still gating — nothing about the step itself was re-emitted.
    expect(steps.at(-1)!.id).toBe('t1');
  });

  it('does not call the tutorial done while a lesson holds the board', () => {
    const ctx = openLesson();
    expect(ctx.state.tutorialDone).toBe(true); // main is over...
    expect(ctx.systems.tutorial.isDone()).toBe(false); // ...but the board is not the player's
    ctx.bus.emit('tutorial:advance_requested', { stepId: 't1' });
    expect(ctx.systems.tutorial.activeScriptId).toBeNull();
    expect(ctx.systems.tutorial.isDone()).toBe(true);
  });
});
