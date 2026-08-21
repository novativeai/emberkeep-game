import { beforeEach, describe, expect, it } from 'vitest';
import type { GameContext } from '../../src/core/Context';
import { eventStatKeys } from '../../src/core/gameEvents';
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
