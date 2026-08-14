import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  DRAGON_HUNGER_GRACE_MS,
  DRAGON_NAP_CYCLE_MS,
  DRAGON_REST_MS,
  DRAGON_SLEEP_MAX_MS,
  DRAGON_WORK_MS,
  DRAGON_WANDER_EVERY_MS,
  DRAGON_WANDER_SPREAD_MS,
  PHASE_MS
} from '../../src/core/Constants';
import { capture, createTestContext } from './helpers';

type Ctx = ReturnType<typeof createTestContext>;

/** Long enough that every dragon's staggered wander slot has come round. */
const A_WHILE = DRAGON_WANDER_EVERY_MS + DRAGON_WANDER_SPREAD_MS + 1000;

function tick(ctx: Ctx, ms: number): void {
  ctx.clock.advance(ms);
  ctx.bus.emit('time:advanced', { ms });
}

/** A board dragon standing at (col,row) on a handed-over (post-tutorial) game. */
function dragonAt(ctx: Ctx, col: number, row: number, tier = 3) {
  ctx.state.tutorialDone = true;
  return ctx.state.addItem({ chain: 'ember_dragon', tier, col, row, kind: 'item' });
}

/** Park the clock at the start of a phase, so a test never straddles dusk. */
function atPhase(ctx: Ctx, index: number): void {
  const now = ctx.clock.now();
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  ctx.clock.advance(dayStart + DAY_MS + index * PHASE_MS + 1000 - now);
}

describe('DragonLifeSystem — a dragon that lives on the isle', () => {
  it('NEVER relocates itself — the board is the player’s arrangement', () => {
    // The guarantee behind "a rejoin lands on the board you left". Wandering
    // ran on the clock, and the clock keeps ticking while the tab is merely
    // hidden — so pieces walked off on their own while the player was in
    // another tab, which from the outside is indistinguishable from a save bug.
    const ctx = createTestContext();
    const dragon = dragonAt(ctx, 1, 1);
    const wandered = capture(ctx.bus, 'dragon:wandered');

    for (let i = 0; i < 12; i++) tick(ctx, A_WHILE);
    expect(wandered).toHaveLength(0);
    expect(ctx.state.items.get(dragon.id)).toMatchObject({ col: 1, row: 1 });
    expect(ctx.state.itemIdAt(1, 1)).toBe(dragon.id);
  });

  it('NEVER walks out of a group the player could merge', () => {
    const ctx = createTestContext();
    dragonAt(ctx, 1, 1);
    dragonAt(ctx, 2, 1); // its own kind, orthogonally adjacent
    const wandered = capture(ctx.bus, 'dragon:wandered');

    tick(ctx, 0);
    tick(ctx, A_WHILE * 3);
    expect(wandered).toHaveLength(0);
  });

  it('stays put for the whole tutorial — the board is the script’s stage', () => {
    const ctx = createTestContext();
    const dragon = ctx.state.addItem({ chain: 'ember_dragon', tier: 3, col: 1, row: 1, kind: 'item' });
    ctx.state.tutorialDone = false;
    const wandered = capture(ctx.bus, 'dragon:wandered');
    tick(ctx, 0);
    tick(ctx, A_WHILE * 3);
    expect(wandered).toHaveLength(0);
    expect(ctx.state.items.get(dragon.id)).toMatchObject({ col: 1, row: 1 });
  });

  it('never sleeps during the tutorial — night, nap or fatigue, she stays awake', () => {
    // A tutorial beat that points at the dragon cannot survive its subject
    // curling up under the arrow; the scripted advanceTime jumps land in
    // night/nap windows at random. Hunger is the one mood that may surface —
    // the feeding lesson depends on it.
    const ctx = createTestContext();
    const dragon = ctx.state.addItem({ chain: 'ember_dragon', tier: 3, col: 1, row: 1, kind: 'item' });
    ctx.state.tutorialDone = false;
    ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });
    atPhase(ctx, 3); // night — the strongest sleep pull there is
    tick(ctx, 0);
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).toBe('awake');
    // The moment the tutorial hands over, the same clock reads as bedtime.
    ctx.state.tutorialDone = true;
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).toBe('asleep');
  });

  it('tells the two sleeps apart: a shift-rest is earned, a nap is the player’s', () => {
    // The distinction is the whole point — one is a cost the player chose to
    // pay by working the dragon, the other is the animal being an animal. Only
    // the second may be shaken off.
    const ctx = createTestContext();
    const dragon = dragonAt(ctx, 1, 1);
    ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });

    atPhase(ctx, 3); // night
    tick(ctx, 0);
    expect(ctx.systems.dragonLife.sleepKindOf(dragon.id)).toBe('night');

    atPhase(ctx, 1); // daylight, so only a nap or fatigue can put it down
    // Worked a full shift → the rest outranks everything and is NOT a nap.
    const house = ctx.state.addItem({ chain: 'lumber', tier: 3, col: 3, row: 3, kind: 'item' });
    ctx.bus.emit('dragon:work', { dragonId: dragon.id, houseId: house.id });
    tick(ctx, DRAGON_WORK_MS + 1);
    ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });
    expect(ctx.systems.dragonLife.sleepKindOf(dragon.id)).toBe('rest');
  });

  it('keepAwake ends a sleep at once and announces it — the tap is answered now', () => {
    // A tap that waits for the next tick to uncurl the animal reads as a
    // dropped input, so the mood change rides the call itself.
    const ctx = createTestContext();
    const dragon = dragonAt(ctx, 1, 1);
    ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });
    atPhase(ctx, 3);
    tick(ctx, 0);
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).toBe('asleep');

    const moods = capture(ctx.bus, 'dragon:mood');
    ctx.systems.dragonLife.keepAwake(dragon.id, 60_000);
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).toBe('awake');
    expect(ctx.systems.dragonLife.sleepKindOf(dragon.id)).toBeNull();
    expect(moods.at(-1)).toMatchObject({ itemId: dragon.id, mood: 'awake', from: 'asleep' });

    // It is a WINDOW, not a flag: past it the same night puts it back down.
    ctx.clock.advance(60_001);
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).toBe('asleep');
  });

  it('is reproducible: the same clock lands the same dragon on the same tile', () => {
    const run = (): string => {
      const ctx = createTestContext();
      dragonAt(ctx, 1, 1);
      const wandered = capture(ctx.bus, 'dragon:wandered');
      tick(ctx, 0);
      tick(ctx, A_WHILE);
      return JSON.stringify(wandered.map((w) => w.to));
    };
    // Nothing here may read Math.random(): `window.advanceTime(ms)` has to
    // reproduce the same board, or a piece moving on its own makes the e2e
    // suite flaky in a way that is very hard to trace back to here.
    expect(run()).toBe(run());
  });

  it('sleeps at night and wakes with the light', () => {
    const ctx = createTestContext();
    const dragon = dragonAt(ctx, 1, 1);
    const moods = capture(ctx.bus, 'dragon:mood');
    // Fed, so hunger cannot outrank sleep in this test.
    ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });

    atPhase(ctx, 3); // night
    tick(ctx, 0);
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).toBe('asleep');
    expect(moods.at(-1)).toMatchObject({ mood: 'asleep' });

    // Morning: it wakes. Bounded loop rather than a single tick, because an
    // ambient nap can legitimately follow the night and this test is about the
    // NIGHT ending, not about the nap never happening.
    atPhase(ctx, 0);
    let woke = false;
    for (let i = 0; i < 60 && !woke; i++) {
      tick(ctx, DRAGON_NAP_CYCLE_MS / 60);
      ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });
      if (ctx.systems.dragonLife.moodOf(dragon.id) === 'awake') woke = true;
    }
    expect(woke).toBe(true);
  });

  it('a dragon nobody fed is HUNGRY, and hunger outranks sleep', () => {
    const ctx = createTestContext();
    const dragon = dragonAt(ctx, 1, 1);

    // Grace first: a hatchling that roars the instant it lands reads as a bug.
    // Asserted as "not hungry yet" rather than "awake": the clock is seeded from
    // real time, so an unpinned moment can legitimately be night or a nap, and a
    // test that demanded `awake` here would fail depending on the hour it ran.
    tick(ctx, 0);
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).not.toBe('hungry');

    tick(ctx, DRAGON_HUNGER_GRACE_MS + 1000);
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).toBe('hungry');

    // …even at night. The isle goes quiet except for the one nobody fed.
    atPhase(ctx, 3);
    tick(ctx, 0);
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).toBe('hungry');

    // Feeding settles it at once — the mood reads the SAME care record the
    // hunger gauge draws, so the two can never disagree.
    ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).not.toBe('hungry');
  });

  it('sleeps off a work shift — the same sleep, at any hour', () => {
    const ctx = createTestContext();
    ctx.state.tutorialDone = true;
    const dragon = ctx.state.addItem({ chain: 'ember_dragon', tier: 3, col: 1, row: 1, kind: 'item' });
    const house = ctx.state.addItem({ chain: 'lumber', tier: 3, col: 4, row: 4, kind: 'item' });
    // Broad daylight and fed — so fatigue is the ONLY thing that could put it to
    // sleep here. Fed AFTER the jump: `atPhase` lands on the next DAY, and the
    // care record rolls its meal tally over on a new day.
    atPhase(ctx, 1);
    ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });
    ctx.bus.emit('dragon:work', { dragonId: dragon.id, houseId: house.id });
    tick(ctx, 0);
    // On the job it is awake, whatever else is true.
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).toBe('awake');

    // Work it to exhaustion; it flies home and sleeps it off. The shift spans
    // feed CYCLES (hunger returns every DRAGON_CYCLE_MS now), so it is fed on
    // clocking off — hunger outranks sleep, and this test is about fatigue.
    tick(ctx, DRAGON_WORK_MS + 1000);
    ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });
    expect(ctx.systems.jobs.restRemaining(dragon.id)).toBeGreaterThan(0);
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).toBe('asleep');

    // …and it is up again once it is rested. Asserted as "wakes within a nap
    // cycle" rather than "is awake on the tick the rest ends": a dragon coming
    // off a shift can legitimately walk straight into an ambient nap, and a
    // test that forbade that would be testing the clock, not the behaviour.
    tick(ctx, DRAGON_REST_MS + 1000);
    expect(ctx.systems.jobs.restRemaining(dragon.id)).toBe(0);
    let woke = false;
    for (let i = 0; i < 60 && !woke; i++) {
      tick(ctx, DRAGON_NAP_CYCLE_MS / 60);
      // Keep it fed — hunger outranks sleep, and this test is about fatigue.
      ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });
      if (ctx.systems.dragonLife.moodOf(dragon.id) === 'awake') woke = true;
    }
    expect(woke).toBe(true);
  });

  it('naps of its own accord, and two dragons never doze in lockstep', () => {
    const ctx = createTestContext();
    const a = dragonAt(ctx, 1, 1);
    const b = dragonAt(ctx, 5, 5);
    atPhase(ctx, 1); // daylight, so only a NAP can close its eyes
    for (const d of [a, b]) {
      ctx.bus.emit('ui:feed_dragon_requested', { itemId: d.id, chain: 'emberberry', tier: 3 });
    }

    // Walk a whole nap cycle in slices and record when each one sleeps. Fed
    // every slice: the walk crosses feed cycles (hunger returns each
    // DRAGON_CYCLE_MS), and a hungry dragon never naps — this test is about
    // the nap windows, not the appetite. The slice has to be well under
    // DRAGON_NAP_LENGTH_MS (a doze is ten seconds now) or the sampling steps
    // straight over the whole nap and reports that it never happened.
    const seen = { a: 0, b: 0, together: 0 };
    const slice = 2500;
    const slices = Math.ceil(DRAGON_NAP_CYCLE_MS / slice);
    for (let i = 0; i < slices; i++) {
      tick(ctx, slice);
      for (const d of [a, b]) {
        ctx.bus.emit('ui:feed_dragon_requested', { itemId: d.id, chain: 'emberberry', tier: 3 });
      }
      const sa = ctx.systems.dragonLife.moodOf(a.id) === 'asleep';
      const sb = ctx.systems.dragonLife.moodOf(b.id) === 'asleep';
      if (sa) seen.a++;
      if (sb) seen.b++;
      if (sa && sb) seen.together++;
    }
    expect(seen.a).toBeGreaterThan(0); // it does nap
    expect(seen.b).toBeGreaterThan(0);
    // The whole point of hashing the offset off the id: their windows differ.
    expect(seen.together).toBeLessThan(Math.min(seen.a, seen.b));
  });

  it('never sleeps longer than the ceiling, whatever put it down', () => {
    // Ten seconds of real time is the whole budget. Night is a phase long and a
    // shift-rest is minutes; neither may park the animal as an unusable curled
    // painting, so the MOOD is capped even where its cause is not.
    const ctx = createTestContext();
    const dragon = dragonAt(ctx, 1, 1);
    ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });
    atPhase(ctx, 3); // night — the longest-standing cause there is

    let asleepFor = 0;
    let longest = 0;
    for (let i = 0; i < 200; i++) {
      tick(ctx, 500);
      ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });
      if (ctx.systems.dragonLife.moodOf(dragon.id) === 'asleep') {
        asleepFor += 500;
        longest = Math.max(longest, asleepFor);
      } else {
        asleepFor = 0;
      }
    }
    expect(longest).toBeGreaterThan(0); // it does still doze
    // One tick of slack: the cap is enforced on the tick that crosses it.
    expect(longest).toBeLessThanOrEqual(DRAGON_SLEEP_MAX_MS + 500);
  });

  it('a shift-rest still costs the shift — the cap shortens the NAP, not the timer', () => {
    // The rest timer is what the player paid for working the dragon; only the
    // curled-up look is capped. Blur the two and working becomes free.
    const ctx = createTestContext();
    const dragon = dragonAt(ctx, 1, 1);
    const house = ctx.state.addItem({ chain: 'lumber', tier: 3, col: 3, row: 3, kind: 'item' });
    ctx.bus.emit('dragon:work', { dragonId: dragon.id, houseId: house.id });
    tick(ctx, DRAGON_WORK_MS + 1);
    expect(ctx.systems.jobs.restRemaining(dragon.id)).toBeGreaterThan(0);

    // Past the sleep ceiling it is on its feet again...
    for (let i = 0; i < 40; i++) {
      tick(ctx, 500);
      ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });
    }
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).not.toBe('asleep');
    // ...and still owes the rest.
    expect(ctx.systems.jobs.restRemaining(dragon.id)).toBeGreaterThan(0);
  });

  it('announces a mood once per change, not once per tick', () => {
    const ctx = createTestContext();
    const dragon = dragonAt(ctx, 1, 1);
    const moods = capture(ctx.bus, 'dragon:mood');
    tick(ctx, 0); // first sight stamps the grace window
    tick(ctx, DRAGON_HUNGER_GRACE_MS + 1000);
    const afterFirst = moods.length;
    expect(moods.at(-1)).toMatchObject({ itemId: dragon.id, mood: 'hungry' });
    tick(ctx, 1000);
    tick(ctx, 1000);
    expect(moods).toHaveLength(afterFirst);
  });

  it('leaves everything that is not a dragon exactly where it stands', () => {
    const ctx = createTestContext();
    ctx.state.tutorialDone = true;
    const gem = ctx.state.addItem({ chain: 'flame_gem', tier: 1, col: 1, row: 1, kind: 'item' });
    const egg = ctx.state.addItem({ chain: 'ember_dragon', tier: 2, col: 3, row: 3, kind: 'item' });
    const wandered = capture(ctx.bus, 'dragon:wandered');
    tick(ctx, 0);
    tick(ctx, A_WHILE * 3);
    expect(wandered).toHaveLength(0);
    expect(ctx.state.items.get(gem.id)).toMatchObject({ col: 1, row: 1 });
    expect(ctx.state.items.get(egg.id)).toMatchObject({ col: 3, row: 3 });
  });
});
