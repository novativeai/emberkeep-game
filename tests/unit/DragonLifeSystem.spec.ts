import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  DRAGON_HUNGER_GRACE_MS,
  DRAGON_NAP_CYCLE_MAX_MS,
  DRAGON_NAP_LENGTH_MS,
  DRAGON_WORK_MS,
  DRAGON_WANDER_EVERY_MS,
  DRAGON_WANDER_MIN_DIST,
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

/**
 * Move the clock so that `spanMs` from now is NOT inside this dragon's nap.
 *
 * The nap cycle (10-15 min) and the day (32 min) are incommensurate, so where a
 * 15-second window falls inside a phase depends on the absolute clock — which
 * is anchored to real time. A test about what a WORK SHIFT costs would
 * therefore pass or fail by the hour it happened to be run at, and did. Asks
 * the system for the schedule rather than re-deriving the hashes here, for the
 * reason `napScheduleOf` is public at all.
 */
function clearOfNap(ctx: Ctx, itemId: number, spanMs: number): void {
  const { cycleMs, offsetMs, lengthMs } = ctx.systems.dragonLife.napScheduleOf(itemId);
  const end = ctx.clock.now() + spanMs;
  const into = (((end - offsetMs) % cycleMs) + cycleMs) % cycleMs;
  if (into < lengthMs) ctx.clock.advance(lengthMs - into);
}

/**
 * Park the clock at the first millisecond of THIS dragon's own nap window.
 *
 * Every dragon draws its own period (10-15 min) and its own offset inside it,
 * both from its id — so there is no shared moment when "the dragons are
 * asleep", and a test that wants one has to ask the system for the schedule
 * rather than re-implement the hashes here. A copy would keep passing after the
 * real one changed, which is the whole failure mode this avoids.
 */
function atNap(ctx: Ctx, itemId: number): void {
  const { cycleMs, offsetMs } = ctx.systems.dragonLife.napScheduleOf(itemId);
  const into = (((ctx.clock.now() - offsetMs) % cycleMs) + cycleMs) % cycleMs;
  ctx.clock.advance(cycleMs - into); // forward to the next window's first ms
}

describe('DragonLifeSystem — a dragon that lives on the isle', () => {
  it('wanders to a tile far enough away to read as a journey', () => {
    const ctx = createTestContext();
    const dragon = dragonAt(ctx, 1, 1);
    const wandered = capture(ctx.bus, 'dragon:wandered');

    tick(ctx, 0); // first sight: schedule only, never an instant departure
    expect(wandered).toHaveLength(0);

    tick(ctx, A_WHILE);
    expect(wandered).toHaveLength(1);
    const move = wandered[0]!;
    const dist = Math.abs(move.to.col - move.from.col) + Math.abs(move.to.row - move.from.row);
    expect(dist).toBeGreaterThanOrEqual(DRAGON_WANDER_MIN_DIST);
    // The MOVE is already applied — the scene only has to animate it.
    expect(ctx.state.items.get(dragon.id)).toMatchObject({ col: move.to.col, row: move.to.row });
    expect(ctx.state.itemIdAt(move.to.col, move.to.row)).toBe(dragon.id);
    expect(ctx.state.itemIdAt(move.from.col, move.from.row)).toBeNull();
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
    atNap(ctx, dragon.id); // squarely inside her own nap window
    tick(ctx, 0);
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).toBe('awake');
    // The moment the tutorial hands over, the same clock reads as bedtime.
    ctx.state.tutorialDone = true;
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).toBe('asleep');
  });

  it('has ONE sleep — the nap — and a finished shift is not one', () => {
    // There used to be two, and telling them apart was the point. There is one
    // now: the animal being an animal, for fifteen seconds, and the player may
    // always shake it off.
    const ctx = createTestContext();
    const dragon = dragonAt(ctx, 1, 1);
    ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });

    atNap(ctx, dragon.id);
    tick(ctx, 0);
    expect(ctx.systems.dragonLife.sleepKindOf(dragon.id)).toBe('nap');

    // Worked a full shift → it flies home, and NOTHING about that is a sleep.
    // There used to be a second sleep here, five minutes of shift-rest under a
    // countdown; two sleeps of wildly different lengths read as one broken
    // rule. One sentence describes the animal's day now — fifteen seconds every
    // ten to fifteen minutes — and this is what holds the rest of the code to it.
    const house = ctx.state.addItem({ chain: 'lumber', tier: 3, col: 3, row: 3, kind: 'item' });
    ctx.bus.emit('dragon:work', { dragonId: dragon.id, houseId: house.id });
    tick(ctx, DRAGON_WORK_MS + 1);
    ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });
    expect(ctx.systems.jobs.restRemaining(dragon.id)).toBe(0);
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).toBe('awake');
    expect(ctx.systems.dragonLife.sleepKindOf(dragon.id)).toBeNull();
  });

  it('keepAwake ends a sleep at once and announces it — the tap is answered now', () => {
    // A tap that waits for the next tick to uncurl the animal reads as a
    // dropped input, so the mood change rides the call itself.
    const ctx = createTestContext();
    const dragon = dragonAt(ctx, 1, 1);
    ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });
    atNap(ctx, dragon.id);
    tick(ctx, 0);
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).toBe('asleep');

    const moods = capture(ctx.bus, 'dragon:mood');
    // Held awake for a THIRD of the window, so the window is provably still
    // open when the hold lapses — the point being that the hold ended, not
    // that the nap did.
    ctx.systems.dragonLife.keepAwake(dragon.id, DRAGON_NAP_LENGTH_MS / 3);
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).toBe('awake');
    expect(ctx.systems.dragonLife.sleepKindOf(dragon.id)).toBeNull();
    expect(moods.at(-1)).toMatchObject({ itemId: dragon.id, mood: 'awake', from: 'asleep' });

    // It is a WINDOW, not a flag: past it the same nap puts it back down.
    ctx.clock.advance(DRAGON_NAP_LENGTH_MS / 3 + 1);
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

  it('naps for THIRTY SECONDS and is up again — and the night never puts it down', () => {
    // The shape the sleep is tuned to: short enough to be caught out of the
    // corner of an eye, never long enough to be in the player's way. The night
    // used to sleep the whole eight-minute phase, which is a quarter of every
    // day spent as a curled painting — the sky no longer decides this.
    const ctx = createTestContext();
    const dragon = dragonAt(ctx, 1, 1);
    const moods = capture(ctx.bus, 'dragon:mood');
    // Fed, so hunger cannot outrank sleep in this test.
    ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });

    atNap(ctx, dragon.id);
    tick(ctx, 0);
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).toBe('asleep');
    expect(moods.at(-1)).toMatchObject({ mood: 'asleep' });

    // One second short of the window: still down.
    tick(ctx, DRAGON_NAP_LENGTH_MS - 1000);
    ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).toBe('asleep');

    // One second past it: up, with no morning needed.
    tick(ctx, 2000);
    ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).toBe('awake');

    // And the deepest night is now just a colour: walk the whole phase and it
    // never closes its eyes for anything but its own window.
    atPhase(ctx, 3);
    const { cycleMs } = ctx.systems.dragonLife.napScheduleOf(dragon.id);
    let asleep = 0;
    const slices = 120;
    for (let i = 0; i < slices; i++) {
      tick(ctx, cycleMs / slices);
      ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });
      if (ctx.systems.dragonLife.moodOf(dragon.id) === 'asleep') asleep++;
    }
    // A 30 s window inside a 10-15 min period is at most a few slices out of
    // 120. Anything like a whole phase asleep would blow straight past this.
    expect(asleep).toBeLessThan(slices / 10);
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
    // …and clear of its own nap, which is a different mechanism with its own
    // test. Nothing else here moves the clock, so this fixes where the shift
    // ENDS — the instant the mood below is read.
    clearOfNap(ctx, dragon.id, DRAGON_WORK_MS + 1000);
    ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });
    ctx.bus.emit('dragon:work', { dragonId: dragon.id, houseId: house.id });
    tick(ctx, 0);
    // On the job it is awake, whatever else is true.
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).toBe('awake');

    // Work a full shift; it flies home and is available again at once. The
    // shift spans feed CYCLES (hunger returns every DRAGON_CYCLE_MS now), so it
    // is fed on clocking off: hunger outranks everything, and this test is
    // about what a finished shift costs — which is nothing.
    tick(ctx, DRAGON_WORK_MS + 1000);
    ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberberry', tier: 3 });
    expect(ctx.systems.jobs.restRemaining(dragon.id)).toBe(0);
    expect(ctx.systems.dragonLife.moodOf(dragon.id)).toBe('awake');
    expect(ctx.systems.jobs.isWorking(dragon.id)).toBe(false);
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
    // the nap windows, not the appetite.
    // Two full MAX periods in fine slices: each dragon's own period is shorter
    // than that, so both windows are guaranteed to come round, and a slice a
    // quarter of the window long cannot step over one.
    const seen = { a: 0, b: 0, together: 0 };
    const slice = DRAGON_NAP_LENGTH_MS / 4;
    const steps = Math.ceil((2 * DRAGON_NAP_CYCLE_MAX_MS) / slice);
    for (let i = 0; i < steps; i++) {
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
