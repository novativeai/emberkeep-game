import { beforeEach, describe, expect, it } from 'vitest';
import type { GameContext } from '../../src/core/Context';
import { eventStatKeys, validateEventsData } from '../../src/core/gameEvents';
import type { EventsData } from '../../src/core/types';
import { fixture } from './GameEvents.spec';
import { capture, createTestContext, MemoryStorage } from './helpers';

/**
 * The runtime, through a real GameContext in node: the fixture's events fire
 * on taps, prompts, property edges, facts and the clock, and their latches
 * survive a reload because they are stats.
 */
describe('EventSystem (the runtime)', () => {
  let ctx: GameContext;
  let storage: MemoryStorage;

  const boot = (s = new MemoryStorage()): GameContext => {
    const c = createTestContext(s, { events: fixture });
    c.beginRun();
    return c;
  };
  const fired = (c: GameContext, id: string): number => c.state.stat(eventStatKeys(id).fired);

  beforeEach(() => {
    storage = new MemoryStorage();
    ctx = boot(storage);
  });

  it('nothing fires on boot, and a guard that fails consumes nothing', () => {
    expect(ctx.systems.events.status().filter((e) => e.fired > 0)).toEqual([]);
    // greet asks for the tutorial to be done; it is not.
    ctx.bus.emit('ui:character_tapped', { characterId: 'eleanor' });
    expect(fired(ctx, 'greet')).toBe(0);
    expect(ctx.systems.events.status().find((e) => e.id === 'greet_ask')?.armed).toBe(false);
  });

  it('a tap fires the parent once, arms the children, and speaks', () => {
    ctx.state.tutorialDone = true;
    const said = capture(ctx.bus, 'event:say');
    const facts = capture(ctx.bus, 'event:fired');
    ctx.bus.emit('ui:character_tapped', { characterId: 'selyna' });
    expect(fired(ctx, 'greet')).toBe(0); // wrong person
    ctx.bus.emit('ui:character_tapped', { characterId: 'eleanor' });
    expect(fired(ctx, 'greet')).toBe(1);
    expect(said).toEqual([{ eventId: 'greet', speaker: 'eleanor', lines: ['You came back.'] }]);
    expect(facts).toEqual([{ id: 'greet', count: 1 }]);
    expect(ctx.state.stat('flag:greeted')).toBe(1);
    expect(ctx.systems.events.status().find((e) => e.id === 'greet_ask')?.armed).toBe(true);
    // once: a second tap reaches the CHILD now, not the parent again
    const prompts = capture(ctx.bus, 'event:prompt');
    ctx.bus.emit('ui:character_tapped', { characterId: 'eleanor' });
    expect(fired(ctx, 'greet')).toBe(1);
    expect(fired(ctx, 'greet_ask')).toBe(1);
    expect(prompts[0]).toMatchObject({ eventId: 'greet_ask', promptId: 'stay', choices: [{ id: 'yes', label: 'Stay' }, { id: 'no', label: 'Go' }] });
  });

  it('a prompt runs the chosen branch and only that one', () => {
    ctx.state.tutorialDone = true;
    ctx.bus.emit('ui:character_tapped', { characterId: 'eleanor' });
    ctx.bus.emit('ui:character_tapped', { characterId: 'eleanor' });
    const coins = ctx.state.coins;
    ctx.bus.emit('ui:event_choice', { eventId: 'greet_ask', promptId: 'stay', choice: 'yes' });
    expect(ctx.state.coins).toBe(coins + 5);
    expect(ctx.state.stat('flag:stayed')).toBe(1);
    // an answer to a prompt that is no longer open does nothing
    ctx.bus.emit('ui:event_choice', { eventId: 'greet_ask', promptId: 'stay', choice: 'no' });
    expect(ctx.state.stat('flag:stayed')).toBe(1);
  });

  it('a time trigger counts from the parent\'s firing, on the game clock', () => {
    ctx.state.tutorialDone = true;
    ctx.clock.advance(5000);
    ctx.bus.emit('time:advanced', { ms: 5000 });
    expect(fired(ctx, 'greet_later')).toBe(0); // not armed yet
    ctx.bus.emit('ui:character_tapped', { characterId: 'eleanor' });
    ctx.clock.advance(600);
    ctx.bus.emit('time:advanced', { ms: 600 });
    expect(fired(ctx, 'greet_later')).toBe(0);
    ctx.clock.advance(600);
    ctx.bus.emit('time:advanced', { ms: 600 });
    expect(fired(ctx, 'greet_later')).toBe(1);
    expect(ctx.state.stat('flag:later')).toBe(1);
  });

  it('a property trigger is an EDGE, bounded by limit, and not an edge on load', () => {
    const said = capture(ctx.bus, 'event:say');
    ctx.bus.emit('economy:add', { coins: 150, reason: 'test' });
    expect(fired(ctx, 'rich')).toBe(1);
    // still >= 100 — no new edge
    ctx.bus.emit('economy:add', { coins: 1, reason: 'test' });
    expect(fired(ctx, 'rich')).toBe(1);
    // drop below, rise again → second edge; limit 2 then holds
    ctx.bus.emit('economy:spend_keys', { keys: 0, reason: 'noop' });
    ctx.state.coins = 10;
    ctx.bus.emit('economy:changed', { coins: 10, keys: 0, xp: 0, level: 1 });
    ctx.bus.emit('economy:add', { coins: 200, reason: 'test' });
    expect(fired(ctx, 'rich')).toBe(2);
    ctx.state.coins = 10;
    ctx.bus.emit('economy:changed', { coins: 10, keys: 0, xp: 0, level: 1 });
    ctx.bus.emit('economy:add', { coins: 200, reason: 'test' });
    expect(fired(ctx, 'rich')).toBe(2);
    expect(said.length).toBe(2);

    // Reload with a full purse: true on load is a baseline, not an edge.
    ctx.systems.save.save();
    const again = boot(storage);
    const saidAgain = capture(again.bus, 'event:say');
    again.bus.emit('economy:add', { coins: 1, reason: 'test' });
    expect(saidAgain).toEqual([]);
    expect(fired(again, 'rich')).toBe(2); // the latch travelled in stats
  });

  it('a fact trigger narrows on its payload and honours the cooldown', () => {
    ctx.bus.emit('item:merged', { chain: 'strawberry', fromTier: 1, resultTier: 2, at: { col: 0, row: 0 }, consumedIds: [], consumedAt: [], outputs: [], xp: 0 });
    expect(fired(ctx, 'merged_moss')).toBe(0);
    const merged = { chain: 'sparkweed', fromTier: 1, resultTier: 2, at: { col: 0, row: 0 }, consumedIds: [], consumedAt: [], outputs: [], xp: 0 };
    ctx.bus.emit('item:merged', merged);
    ctx.bus.emit('item:merged', merged);
    expect(fired(ctx, 'merged_moss')).toBe(1); // inside the 500 ms cooldown
    ctx.clock.advance(500);
    ctx.bus.emit('item:merged', merged);
    expect(fired(ctx, 'merged_moss')).toBe(2);
    expect(ctx.state.stat('flag:moss_merges')).toBe(2);
  });

  it('fire() runs a manual event whose `fire` action runs another, guards intact', () => {
    expect(ctx.systems.events.fire('nope')).toBe(false);
    expect(ctx.systems.events.fire('chained')).toBe(true);
    expect(ctx.state.stat('flag:chained')).toBe(1);
    // rich's property edge was not crossed, but `fire` asks its guards (none) and latches only
    expect(fired(ctx, 'rich')).toBe(1);
  });

  it('reports itself through render_game_to_text\'s shape', () => {
    ctx.systems.events.fire('chained');
    const rows = ctx.systems.events.status();
    expect(rows.find((r) => r.id === 'chained')).toEqual({ id: 'chained', armed: true, fired: 1, depth: 0 });
    expect(rows.find((r) => r.id === 'greet_ask')).toMatchObject({ armed: false, fired: 0, depth: 1 });
  });
});

/**
 * THE CASCADE IS BOUNDED.
 *
 * An event's outputs come straight back in as inputs — `event:fired` is itself
 * an observable trigger, a written flag re-reads every property edge — and all
 * of it happens synchronously, inside the firing that caused it. Left alone
 * that recursed ~1160 frames into a RangeError thrown INSIDE a bus handler,
 * which also abandoned every subscriber queued after it on that emit.
 *
 * A re-entrancy guard (the event on the stack may not fire again) does not fix
 * it: it bounds ONE event, not the cascade. Measured against the guard alone,
 * N listeners on `event:fired` each fired 1 / 2 / 5 / 16 times for a single
 * poke at N = 1 / 2 / 3 / 4 — the blow-up these tests pin shut.
 *
 * The invariant asserted here is: ONE STIMULUS FROM OUTSIDE = ONE CASCADE, AND
 * EACH EVENT FIRES AT MOST ONCE INSIDE IT. So the work is at most N firings for
 * a roster of N, whatever shape the graph has — and the honest chains (a `fire`
 * script, a parent → child → grandchild ladder) still run in full.
 */
describe('EventSystem (the cascade is bounded)', () => {
  const boot = (events: EventsData): GameContext => {
    const c = createTestContext(new MemoryStorage(), { events });
    c.beginRun();
    return c;
  };
  const fired = (c: GameContext, id: string): number => c.state.stat(eventStatKeys(id).fired);

  /** N events that each listen for EVERY firing, plus something to poke. */
  const listeners = (n: number): EventsData => {
    const data: EventsData = { events: [{ id: 'poke', when: [{ type: 'manual' }], then: [{ add: 'flag.poked', amount: 1 }] }] };
    for (let i = 0; i < n; i++) {
      data.events.push({ id: `c${i}`, when: [{ type: 'event', event: 'event:fired' }], then: [{ add: `flag.n${i}`, amount: 1 }] });
    }
    return data;
  };

  it.each([1, 2, 3, 4])('N=%i listeners on every firing: one turn each, per stimulus', (n) => {
    const events = listeners(n);
    // The validator refuses this shape now — the runtime must survive it anyway,
    // because a mutual `match: { id }` ring is the same graph wearing a legal hat.
    expect(validateEventsData(events).length).toBe(n);
    const ctx = boot(events);
    const facts = capture(ctx.bus, 'event:fired');

    expect(ctx.systems.events.fire('poke')).toBe(true);
    for (let i = 0; i < n; i++) expect(fired(ctx, `c${i}`)).toBe(1);
    // Exactly one fact per firing: poke's own, then one per listener.
    expect(facts.map((f) => f.id)).toEqual(['poke', ...Array.from({ length: n }, (_, i) => `c${i}`)]);

    // A SECOND poke is a SECOND cascade — the bound is per stimulus, not for life.
    ctx.systems.events.fire('poke');
    for (let i = 0; i < n; i++) expect(ctx.state.stat(`flag:n${i}`)).toBe(2);
    expect(facts.length).toBe(2 * (n + 1));
  });

  it('two events on ONE outside fact are one cascade, not one cascade each', () => {
    // Each also listens for every firing, so under a per-event cascade the
    // second event fired once for the fact and once more inside the first's
    // cascade. The whole `onFact` sweep is one cascade now.
    const events: EventsData = {
      events: [
        { id: 'a', when: [{ type: 'event', event: 'keeper:leveled' }, { type: 'event', event: 'event:fired' }], then: [{ add: 'flag.a', amount: 1 }] },
        { id: 'b', when: [{ type: 'event', event: 'keeper:leveled' }, { type: 'event', event: 'event:fired' }], then: [{ add: 'flag.b', amount: 1 }] }
      ]
    };
    const ctx = boot(events);
    ctx.bus.emit('keeper:leveled', { level: 2, from: 1 });
    expect([fired(ctx, 'a'), fired(ctx, 'b')]).toEqual([1, 1]);
    ctx.bus.emit('keeper:leveled', { level: 3, from: 2 });
    expect([fired(ctx, 'a'), fired(ctx, 'b')]).toEqual([2, 2]);
  });

  it('an event listening for `event:fired` never matches its OWN firing', () => {
    const ctx = boot(listeners(1));
    expect(ctx.systems.events.fire('poke')).toBe(true);
    expect(ctx.state.stat('flag:n0')).toBe(1);
    expect(fired(ctx, 'c0')).toBe(1);
  });

  it('an event that watches ITSELF by id fires once and stops', () => {
    const events: EventsData = {
      events: [
        { id: 'ouroboros', when: [{ type: 'manual' }, { type: 'event', event: 'event:fired', match: { id: 'ouroboros' } }], then: [{ add: 'flag.o', amount: 1 }] }
      ]
    };
    expect(validateEventsData(events)).toEqual([]);
    const ctx = boot(events);
    expect(ctx.systems.events.fire('ouroboros')).toBe(true);
    expect(ctx.state.stat('flag:o')).toBe(1);
  });

  it('two events naming each other by id trade once and stop', () => {
    const events: EventsData = {
      events: [
        { id: 'ping', when: [{ type: 'event', event: 'event:fired', match: { id: 'pong' } }], then: [{ add: 'flag.ping', amount: 1 }] },
        { id: 'pong', when: [{ type: 'event', event: 'event:fired', match: { id: 'ping' } }], then: [{ add: 'flag.pong', amount: 1 }] },
        { id: 'kick', when: [{ type: 'manual' }], then: [{ fire: 'ping' }] }
      ]
    };
    expect(validateEventsData(events)).toEqual([]);
    const ctx = boot(events);

    expect(ctx.systems.events.fire('kick')).toBe(true);
    expect(ctx.state.stat('flag:ping')).toBe(1);
    expect(ctx.state.stat('flag:pong')).toBe(1);
    expect(fired(ctx, 'ping')).toBe(1);
    expect(fired(ctx, 'pong')).toBe(1);
  });

  it('a RING of three, each armed by the last one\'s firing, goes round once', () => {
    // Nobody mentions themselves and every `match` narrows, so the validator is
    // content: only the cascade bound closes this loop.
    const events: EventsData = {
      events: [
        { id: 'r0', when: [{ type: 'manual' }, { type: 'event', event: 'event:fired', match: { id: 'r2' } }], then: [{ add: 'flag.r0', amount: 1 }] },
        { id: 'r1', when: [{ type: 'event', event: 'event:fired', match: { id: 'r0' } }], then: [{ add: 'flag.r1', amount: 1 }] },
        { id: 'r2', when: [{ type: 'event', event: 'event:fired', match: { id: 'r1' } }], then: [{ add: 'flag.r2', amount: 1 }] }
      ]
    };
    expect(validateEventsData(events)).toEqual([]);
    const ctx = boot(events);
    const facts = capture(ctx.bus, 'event:fired');
    expect(ctx.systems.events.fire('r0')).toBe(true);
    expect([ctx.state.stat('flag:r0'), ctx.state.stat('flag:r1'), ctx.state.stat('flag:r2')]).toEqual([1, 1, 1]);
    expect(facts.map((f) => f.id)).toEqual(['r0', 'r1', 'r2']);
  });

  it('a flag an event writes cannot bounce back into that same event', () => {
    // `add: flag.*` re-reads every property edge synchronously; without the
    // bound, a property trigger on the flag the action writes re-entered here.
    const events: EventsData = {
      events: [
        {
          id: 'spiral',
          when: [{ type: 'property', prop: 'flag.n', op: '>=', value: 1 }],
          then: [{ add: 'flag.n', amount: 1 }]
        },
        { id: 'seed', when: [{ type: 'manual' }], then: [{ add: 'flag.n', amount: 1 }] }
      ]
    };
    expect(validateEventsData(events)).toEqual([]);
    const ctx = boot(events);
    ctx.systems.events.fire('seed');
    // seed's +1 crosses the edge once; spiral's own +1 does not re-enter it.
    expect(ctx.state.stat('flag:n')).toBe(2);
    expect(fired(ctx, 'spiral')).toBe(1);
  });

  it('two events writing each other\'s flag settle instead of ping-ponging', () => {
    const events: EventsData = {
      events: [
        { id: 'x', when: [{ type: 'property', prop: 'flag.y', op: '>=', value: 1 }], then: [{ add: 'flag.y', amount: 1 }, { add: 'flag.x', amount: 1 }] },
        { id: 'y', when: [{ type: 'property', prop: 'flag.x', op: '>=', value: 1 }], then: [{ add: 'flag.x', amount: 1 }, { add: 'flag.y', amount: 1 }] },
        { id: 'start', when: [{ type: 'manual' }], then: [{ add: 'flag.x', amount: 1 }] }
      ]
    };
    expect(validateEventsData(events)).toEqual([]);
    const ctx = boot(events);
    ctx.systems.events.fire('start');
    expect(fired(ctx, 'x')).toBe(1);
    expect(fired(ctx, 'y')).toBe(1);
  });

  /* ---- and the honest chains must still run in full ------------------ */

  it('a parent → child → grandchild ladder still runs, all three, in order', () => {
    const events: EventsData = {
      events: [
        {
          id: 'p',
          when: [{ type: 'manual' }],
          then: [{ add: 'flag.p', amount: 1 }],
          children: [
            {
              id: 'c',
              when: [{ type: 'event', event: 'event:fired', match: { id: 'p' } }],
              then: [{ add: 'flag.c', amount: 1 }],
              children: [
                { id: 'g', when: [{ type: 'event', event: 'event:fired', match: { id: 'c' } }], then: [{ add: 'flag.g', amount: 1 }] }
              ]
            }
          ]
        }
      ]
    };
    expect(validateEventsData(events)).toEqual([]);
    const ctx = boot(events);
    const facts = capture(ctx.bus, 'event:fired');
    expect(ctx.systems.events.fire('p')).toBe(true);
    expect([ctx.state.stat('flag:p'), ctx.state.stat('flag:c'), ctx.state.stat('flag:g')]).toEqual([1, 1, 1]);
    expect(facts.map((f) => f.id)).toEqual(['p', 'c', 'g']);
  });

  it('a `fire` runs INLINE, so the rest of the `then` reads what it did', () => {
    const events: EventsData = {
      events: [
        { id: 'lead', when: [{ type: 'manual' }], then: [{ fire: 'sets' }, { fire: 'needs' }] },
        { id: 'sets', when: [{ type: 'manual' }], then: [{ set: 'flag.ready', value: 1 }] },
        { id: 'needs', when: [{ type: 'manual' }], if: [{ prop: 'flag.ready', op: '>=', value: 1 }], then: [{ add: 'flag.done', amount: 1 }] }
      ]
    };
    expect(validateEventsData(events)).toEqual([]);
    const ctx = boot(events);
    expect(ctx.systems.events.fire('lead')).toBe(true);
    // `needs` only fires because `sets` already ran on the stack, not later.
    expect(ctx.state.stat('flag:done')).toBe(1);
    expect([fired(ctx, 'lead'), fired(ctx, 'sets'), fired(ctx, 'needs')]).toEqual([1, 1, 1]);
  });

  it('a guard that REFUSED does not spend the event\'s turn', () => {
    // `late` is raised before its condition is true and again after: the
    // once-per-cascade bound counts firings, not attempts.
    const events: EventsData = {
      events: [
        { id: 'late', when: [{ type: 'event', event: 'event:fired', match: { id: 'opener' } }, { type: 'event', event: 'event:fired', match: { id: 'closer' } }], if: [{ prop: 'flag.gate', op: '>=', value: 1 }], then: [{ add: 'flag.late', amount: 1 }] },
        { id: 'opener', when: [{ type: 'manual' }], then: [{ fire: 'closer' }] },
        { id: 'closer', when: [{ type: 'manual' }], then: [{ set: 'flag.gate', value: 1 }] }
      ]
    };
    expect(validateEventsData(events)).toEqual([]);
    const ctx = boot(events);
    ctx.systems.events.fire('opener');
    expect(fired(ctx, 'late')).toBe(1);
  });
});

/**
 * TWO QUESTIONS AT ONCE. UIScene shows one card and QUEUES the rest, so the
 * reply for the FIRST arrives after the second has already been raised. The
 * system used to keep one slot: the reply found the wrong promptId, returned,
 * and the branch the player had chosen never ran — with the card already
 * closed, they could not answer it again.
 */
describe('EventSystem (two prompts open at once)', () => {
  const ask = (id: string, flag: string): EventsData['events'][number]['then'][number] => ({
    prompt: {
      id,
      speaker: 'eleanor',
      text: `Well, ${id}?`,
      choices: [
        { id: 'yes', label: 'Yes', then: [{ set: `flag.${flag}`, value: 1 }] },
        { id: 'no', label: 'No', then: [{ set: `flag.${flag}`, value: 2 }] }
      ]
    }
  });
  const events: EventsData = {
    events: [{ id: 'both', when: [{ type: 'manual' }], then: [ask('a', 'a'), ask('b', 'b')] }]
  };
  let ctx: GameContext;

  beforeEach(() => {
    expect(validateEventsData(events)).toEqual([]);
    ctx = createTestContext(new MemoryStorage(), { events });
    ctx.beginRun();
  });

  it('asks both and runs BOTH branches, whichever answer comes back first', () => {
    const asked = capture(ctx.bus, 'event:prompt');
    ctx.systems.events.fire('both');
    expect(asked.map((p) => p.promptId)).toEqual(['a', 'b']);

    // The player answers the card in front of them — the first one — while the
    // second is still queued in UIScene.
    ctx.bus.emit('ui:event_choice', { eventId: 'both', promptId: 'a', choice: 'yes' });
    expect(ctx.state.stat('flag:a')).toBe(1);
    ctx.bus.emit('ui:event_choice', { eventId: 'both', promptId: 'b', choice: 'no' });
    expect(ctx.state.stat('flag:b')).toBe(2);
  });

  it('answers out of order too, and never twice', () => {
    ctx.systems.events.fire('both');
    ctx.bus.emit('ui:event_choice', { eventId: 'both', promptId: 'b', choice: 'yes' });
    expect(ctx.state.stat('flag:b')).toBe(1);
    expect(ctx.state.stat('flag:a')).toBe(0);
    // b is spent; a is still owed an answer.
    ctx.bus.emit('ui:event_choice', { eventId: 'both', promptId: 'b', choice: 'no' });
    expect(ctx.state.stat('flag:b')).toBe(1);
    ctx.bus.emit('ui:event_choice', { eventId: 'both', promptId: 'a', choice: 'no' });
    expect(ctx.state.stat('flag:a')).toBe(2);
    // Nothing is left open, and an unknown question is still a no-op.
    ctx.bus.emit('ui:event_choice', { eventId: 'both', promptId: 'a', choice: 'yes' });
    ctx.bus.emit('ui:event_choice', { eventId: 'both', promptId: 'ghost', choice: 'yes' });
    expect(ctx.state.stat('flag:a')).toBe(2);
  });

  it('the same question asked twice is two answers, oldest first', () => {
    ctx.systems.events.fire('both');
    ctx.systems.events.fire('both');
    ctx.bus.emit('ui:event_choice', { eventId: 'both', promptId: 'a', choice: 'yes' });
    expect(ctx.state.stat('flag:a')).toBe(1);
    ctx.bus.emit('ui:event_choice', { eventId: 'both', promptId: 'a', choice: 'no' });
    expect(ctx.state.stat('flag:a')).toBe(2);
  });
});

/**
 * A FACT THAT IS IN BOTH LISTS IS STILL ONE CASCADE.
 *
 * Nine facts are both observable `event` triggers and property-watch facts —
 * `item:merged`, `item:spawned`, `item:sold`, `bag:stored`, `quest:completed`,
 * `keeper:leveled`, `world:ready`, `tutorial:step`, `event:fired`. The system
 * subscribed once per LIST, so each of those opened two top-level cascades:
 * the fact match drained to the end, then a property sweep started over with a
 * fresh `spent`. Measured on one external `keeper:leveled`: four top-level
 * cascades (three property sweeps and one fact match). The bound was therefore
 * stated per subscription, not per fact.
 *
 * These pin the shape: ONE fact, ONE cascade, both raises inside it — and the
 * property edges read where the fact LANDS, before anything it matched has run.
 */
describe('EventSystem (a fact in both trigger lists opens ONE cascade)', () => {
  const boot = (events: EventsData): GameContext => {
    const c = createTestContext(new MemoryStorage(), { events });
    c.beginRun();
    return c;
  };
  const fired = (c: GameContext, id: string): number => c.state.stat(eventStatKeys(id).fired);
  const stored = { chain: 'sparkweed', tier: 1, at: { col: 0, row: 0 } };

  /**
   * How many TOP-LEVEL cascades the system opens from here on.
   *
   * The claim is about the SHAPE of the subscription, and a second cascade
   * leaves no public trace of its own — it re-runs the same bounded drain — so
   * the count is taken at the one place a cascade can open. The probe keeps its
   * OWN nesting depth rather than reading the system's, so it measures entries
   * from outside and nothing else.
   */
  const countCascades = (ctx: GameContext): { opened: number } => {
    const sys = ctx.systems.events as unknown as { cascade(raise: () => void): void };
    const inner = sys.cascade.bind(sys);
    const probe = { opened: 0 };
    let depth = 0;
    sys.cascade = (raise: () => void): void => {
      if (depth === 0) probe.opened++;
      depth++;
      try {
        inner(raise);
      } finally {
        depth--;
      }
    };
    return probe;
  };

  /** `event`, `property` and `tap` triggers in one roster, poked by one fact. */
  const mixed: EventsData = {
    events: [
      { id: 'shelved', when: [{ type: 'event', event: 'bag:stored', match: { chain: 'sparkweed' } }], then: [{ add: 'flag.shelved', amount: 1 }] },
      { id: 'hoarder', when: [{ type: 'property', prop: 'flag.shelved', op: '>=', value: 1 }], then: [{ add: 'flag.hoarder', amount: 1 }] },
      { id: 'greeter', when: [{ type: 'tap', target: 'character:eleanor' }], then: [{ add: 'flag.greeter', amount: 1 }] },
      {
        id: 'both',
        when: [{ type: 'event', event: 'bag:stored' }, { type: 'property', prop: 'flag.hoarder', op: '>=', value: 1 }],
        then: [{ add: 'flag.both', amount: 1 }]
      }
    ]
  };

  it('one `bag:stored` opens one cascade, whichever lists the fact is in', () => {
    expect(validateEventsData(mixed)).toEqual([]);
    const ctx = boot(mixed);
    const cascades = countCascades(ctx);
    const facts = capture(ctx.bus, 'event:fired');

    ctx.bus.emit('bag:stored', stored);

    // ONE cascade — it was two, the fact match and then the property sweep.
    expect(cascades.opened).toBe(1);
    // `both` is raised by BOTH lists and still takes one turn; the tap event was
    // never poked; `hoarder` rides in on the flag `shelved` wrote.
    expect([fired(ctx, 'shelved'), fired(ctx, 'both'), fired(ctx, 'hoarder'), fired(ctx, 'greeter')]).toEqual([1, 1, 1, 0]);
    expect(facts.map((f) => f.id)).toEqual(['shelved', 'both', 'hoarder']);
  });

  it('the SAME fact again is a second cascade — the bound is per fact, not for life', () => {
    const ctx = boot(mixed);
    const cascades = countCascades(ctx);
    const facts = capture(ctx.bus, 'event:fired');

    ctx.bus.emit('bag:stored', stored);
    ctx.bus.emit('bag:stored', stored);

    expect(cascades.opened).toBe(2);
    // `hoarder` only had an edge the first time — its flag never fell back.
    expect([fired(ctx, 'shelved'), fired(ctx, 'both'), fired(ctx, 'hoarder')]).toEqual([2, 2, 1]);
    expect(facts.map((f) => f.id)).toEqual(['shelved', 'both', 'hoarder', 'shelved', 'both']);
  });

  it('a fact the roster only property-watches opens one cascade too', () => {
    // `economy:changed` is watched but is not an observable trigger: the same
    // handler must raise the properties alone, without a fact match.
    const ctx = boot({
      events: [{ id: 'rich', when: [{ type: 'property', prop: 'keeper.coins', op: '>=', value: 100 }], then: [{ add: 'flag.rich', amount: 1 }] }]
    });
    const cascades = countCascades(ctx);
    ctx.state.coins = 150;
    ctx.bus.emit('economy:changed', { coins: 150, keys: 0, xp: 0, level: 1 });
    expect(cascades.opened).toBe(1);
    expect(fired(ctx, 'rich')).toBe(1);
  });

  it('the edge the fact arrived on is read where the fact LANDS, not after it', () => {
    // The property is true and its last look was false when `bag:stored`
    // arrives, so `watcher` is owed a firing. `closer` answers the same fact
    // and shuts the window. While the property sweep was a SECOND cascade it
    // ran after `closer` had already drained, read a closed window, and the
    // edge was lost in silence — `watcher` never fired at all.
    const events: EventsData = {
      events: [
        { id: 'closer', when: [{ type: 'event', event: 'bag:stored' }], then: [{ set: 'flag.window', value: 0 }] },
        { id: 'watcher', when: [{ type: 'property', prop: 'flag.window', op: '>=', value: 1 }], then: [{ add: 'flag.seen', amount: 1 }] }
      ]
    };
    expect(validateEventsData(events)).toEqual([]);
    const ctx = boot(events);
    const facts = capture(ctx.bus, 'event:fired');
    // Written straight into stats: a flag change carries no fact of its own, so
    // this leaves the property TRUE with its last look still FALSE — the exact
    // race the fact then walks into.
    ctx.state.stats['flag:window'] = 1;

    ctx.bus.emit('bag:stored', stored);

    expect([fired(ctx, 'closer'), fired(ctx, 'watcher')]).toEqual([1, 1]);
    expect(ctx.state.stat('flag:seen')).toBe(1);
    // The fact's own match still goes first; the edge queues behind it.
    expect(facts.map((f) => f.id)).toEqual(['closer', 'watcher']);
  });
});
