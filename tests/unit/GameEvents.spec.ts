import { describe, expect, it } from 'vitest';
import eventsJson from '../../src/data/events.json';
import {
  actionSentence,
  compare,
  eventStatKeys,
  flattenEvents,
  propertySpec,
  readProperty,
  tapFactOf,
  triggerSentence,
  validateEventsData,
  type PropertyFacts
} from '../../src/core/gameEvents';
import type { EventsData, GameEventConfig } from '../../src/core/types';
import { applyOp } from '../../tools/events-api/server';

const shipped = eventsJson as unknown as EventsData;

const say = (id: string, text = id): GameEventConfig => ({
  id,
  when: [{ type: 'manual' }],
  then: [{ say: { speaker: 'eleanor', lines: [text] } }]
});

/** A parent with a prompt, a child armed by it, and a sibling on a property edge. */
export const fixture: EventsData = {
  events: [
    {
      id: 'greet',
      title: 'Greeting',
      when: [{ type: 'tap', target: 'character:eleanor' }],
      if: [{ prop: 'keeper.tutorialDone', op: '==', value: 1 }],
      then: [
        { say: { speaker: 'eleanor', lines: ['You came back.'] } },
        { add: 'flag.greeted', amount: 1 }
      ],
      once: true,
      children: [
        {
          id: 'greet_ask',
          when: [{ type: 'tap', target: 'character:eleanor' }],
          then: [
            {
              prompt: {
                id: 'stay',
                speaker: 'eleanor',
                text: 'Will you stay the night?',
                choices: [
                  { id: 'yes', label: 'Stay', then: [{ add: 'keeper.coins', amount: 5 }, { set: 'flag.stayed', value: 1 }] },
                  { id: 'no', label: 'Go', then: [{ set: 'flag.stayed', value: 0 }] }
                ]
              }
            }
          ],
          once: true
        },
        { id: 'greet_later', when: [{ type: 'time', afterMs: 1000 }], then: [{ add: 'flag.later', amount: 1 }], once: true }
      ]
    },
    {
      id: 'rich',
      when: [{ type: 'property', prop: 'keeper.coins', op: '>=', value: 100 }],
      then: [{ say: { speaker: 'eleanor', lines: ['A full purse.'] } }],
      limit: 2
    },
    {
      id: 'merged_moss',
      when: [{ type: 'event', event: 'item:merged', match: { chain: 'sparkweed' } }],
      then: [{ add: 'flag.moss_merges', amount: 1 }],
      cooldownMs: 500
    },
    { id: 'chained', when: [{ type: 'manual' }], then: [{ fire: 'rich' }, { add: 'flag.chained', amount: 1 }] }
  ]
};

describe('gameEvents (the model)', () => {
  it('the shipped events.json validates clean, and so does the fixture', () => {
    expect(validateEventsData(shipped)).toEqual([]);
    expect(validateEventsData(fixture, { chains: ['sparkweed'], characters: ['eleanor'] })).toEqual([]);
  });

  it('flattens parents before children with depth', () => {
    const flat = flattenEvents(fixture.events);
    expect(flat.map((f) => `${f.event.id}@${f.depth}`)).toEqual([
      'greet@0', 'greet_ask@1', 'greet_later@1', 'rich@0', 'merged_moss@0', 'chained@0'
    ]);
    expect(flat[1].parent?.id).toBe('greet');
  });

  it('knows its property catalogue and reads every path as a number', () => {
    expect(propertySpec('keeper.coins')?.write).toBe('add');
    expect(propertySpec('character.eleanor.hearts')?.write).toBe('none');
    expect(propertySpec('flag.kept')?.write).toBe('add+set');
    expect(propertySpec('board.sparkweed.2')).toBeDefined();
    expect(propertySpec('keeper.nope')).toBeUndefined();
    expect(propertySpec('flag')).toBeUndefined();

    const facts: PropertyFacts = {
      level: 3, xp: 250, coins: 40, keys: 1, energy: 12, tutorialDone: true, worldId: 'borealis',
      regardPoints: (id) => (id === 'eleanor' ? 7 : 0),
      hearts: (id) => (id === 'eleanor' ? 2 : 0),
      dragonTrust: (chain) => (chain === 'ember_dragon' ? 4 : 0),
      dragonCount: (chain) => (chain === 'ember_dragon' ? 1 : 0),
      boardCount: (chain, tier) => (chain === 'sparkweed' && tier === 2 ? 3 : 0),
      stat: (key) => ({ 'q:done:first_fire': 1, merges: 12, 'flag:kept': 1, 'evt:greet:fired': 2 })[key] ?? 0
    };
    expect(readProperty(facts, 'keeper.level')).toBe(3);
    expect(readProperty(facts, 'keeper.tutorialDone')).toBe(1);
    expect(readProperty(facts, 'keeper.world.borealis')).toBe(1);
    expect(readProperty(facts, 'keeper.world.emberkeep')).toBe(0);
    expect(readProperty(facts, 'character.eleanor.hearts')).toBe(2);
    expect(readProperty(facts, 'character.eleanor.regard')).toBe(7);
    expect(readProperty(facts, 'dragon.ember_dragon.trust')).toBe(4);
    expect(readProperty(facts, 'dragon.ember_dragon.count')).toBe(1);
    expect(readProperty(facts, 'board.sparkweed.2')).toBe(3);
    expect(readProperty(facts, 'quest.first_fire.done')).toBe(1);
    expect(readProperty(facts, 'stat.merges')).toBe(12);
    expect(readProperty(facts, 'flag.kept')).toBe(1);
    expect(readProperty(facts, 'event.greet.fired')).toBe(2);
    expect(compare(3, '>=', 3)).toBe(true);
    expect(compare(3, '!=', 3)).toBe(false);
  });

  it('lowers the tap sugar to the fact it listens for', () => {
    expect(tapFactOf('character:eleanor')).toEqual({ event: 'ui:character_tapped', key: 'characterId', value: 'eleanor' });
    expect(tapFactOf('item:sparkweed')).toEqual({ event: 'item:tapped', key: 'chain', value: 'sparkweed' });
    expect(tapFactOf('elder')).toEqual({ event: 'elder:tapped' });
    expect(tapFactOf('house:1')).toBeNull();
  });

  it('refuses what the docs say it refuses', () => {
    const bad = (patch: Partial<GameEventConfig>, ctx = {}): string =>
      validateEventsData({ events: [{ ...say('x'), ...patch }] }, ctx).join('; ');
    expect(bad({ when: [] })).toMatch(/at least one trigger/);
    expect(bad({ then: [] })).toMatch(/at least one action/);
    expect(bad({ when: [{ type: 'event', event: 'economy:add' }] })).toMatch(/not an observable bus fact/);
    expect(bad({ when: [{ type: 'event', event: 'item:merged', match: { colour: 'red' } }] })).toMatch(/no payload key "colour"/);
    expect(bad({ when: [{ type: 'property', prop: 'keeper.mood', op: '>', value: 1 }] })).toMatch(/unknown property/);
    expect(bad({ when: [{ type: 'tap', target: 'character:nobody' }] }, { characters: ['eleanor'] })).toMatch(/unknown character/);
    expect(bad({ then: [{ add: 'keeper.level', amount: 1 }] })).toMatch(/read-only/);
    expect(bad({ then: [{ set: 'keeper.coins', value: 1 }] })).toMatch(/only writes flag/);
    expect(bad({ then: [{ fire: 'ghost' }] })).toMatch(/names no event/);
    expect(bad({ then: [{ emit: 'state:saved' }] })).toMatch(/not an emittable command/);
    expect(bad({ then: [{ open: 'wardrobe' as 'bag' }] })).toMatch(/open must be one of/);
    expect(bad({ then: [{ prompt: { id: 'p', speaker: 'eleanor', text: 'Well?', choices: [{ id: 'a', label: 'A', then: [] }] } }] })).toMatch(/at least one action/);
    expect(bad({ once: true, limit: 2 })).toMatch(/once cannot be combined/);
    expect(validateEventsData({ events: [say('dup'), say('dup')] }).join('; ')).toMatch(/duplicate event id/);
    expect(validateEventsData({ events: [say('Bad-Id')] }).join('; ')).toMatch(/lowercase/);
  });

  it('says what a trigger and an action do, in one line each', () => {
    expect(triggerSentence({ type: 'event', event: 'item:merged', match: { chain: 'sparkweed' } })).toBe('on item:merged where chain = sparkweed');
    expect(triggerSentence({ type: 'property', prop: 'keeper.coins', op: '>=', value: 100 })).toBe('when keeper.coins becomes >= 100');
    expect(actionSentence({ add: 'keeper.coins', amount: 5 })).toBe('keeper.coins +5');
    expect(actionSentence({ spawn: { chain: 'sparkweed', tier: 1, count: 2 } })).toBe('spawn 2× sparkweed t1');
  });

  it('keeps its latches under evt:<id>:*', () => {
    expect(eventStatKeys('greet')).toEqual({ fired: 'evt:greet:fired', last: 'evt:greet:last', armed: 'evt:greet:armed' });
  });
});

describe('events API ops (pure, validated)', () => {
  const base = fixture;
  const ctx = { chains: ['sparkweed'], characters: ['eleanor'] };

  it('adds, nests, patches, moves, reorders and removes', () => {
    let d = applyOp(base, { op: 'add_event', event: say('tail') }, ctx);
    expect(d.events.at(-1)?.id).toBe('tail');
    d = applyOp(d, { op: 'add_event', event: say('inner'), parent: 'greet', after: 'greet_ask' }, ctx);
    expect(d.events[0].children?.map((c) => c.id)).toEqual(['greet_ask', 'inner', 'greet_later']);
    d = applyOp(d, { op: 'update_event', id: 'inner', patch: { title: 'Inside', once: true } }, ctx);
    expect(d.events[0].children?.[1]).toMatchObject({ title: 'Inside', once: true });
    d = applyOp(d, { op: 'move_event', id: 'inner', parent: null, to: 0 }, ctx);
    expect(d.events[0].id).toBe('inner');
    d = applyOp(d, { op: 'reorder', parent: 'greet', order: ['greet_later', 'greet_ask'] }, ctx);
    expect(d.events[1].children?.map((c) => c.id)).toEqual(['greet_later', 'greet_ask']);
    d = applyOp(d, { op: 'remove_event', id: 'greet_later' }, ctx);
    expect(d.events[1].children?.map((c) => c.id)).toEqual(['greet_ask']);
    expect(validateEventsData(d, ctx)).toEqual([]);
  });

  it('refuses with the reason and leaves the input untouched', () => {
    const before = JSON.stringify(base);
    expect(() => applyOp(base, { op: 'add_event', event: say('greet') }, ctx)).toThrow(/already exists/);
    expect(() => applyOp(base, { op: 'remove_event', id: 'nope' }, ctx)).toThrow(/no event "nope"/);
    expect(() => applyOp(base, { op: 'move_event', id: 'greet', parent: 'greet_ask', to: 0 }, ctx)).toThrow(/inside itself/);
    expect(() => applyOp(base, { op: 'reorder', parent: null, order: ['greet'] }, ctx)).toThrow(/every sibling/);
    expect(() => applyOp(base, { op: 'update_event', id: 'rich', patch: { then: [] } }, ctx)).toThrow(/at least one action/);
    expect(() => applyOp(base, { op: 'remove_event', id: 'rich' }, ctx)).toThrow(/fire names no event "rich"/);
    expect(JSON.stringify(base)).toBe(before);
  });
});
