import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_RATE,
  ADULT_SERVINGS,
  DAY_MS,
  DRAGON_DIET,
  NEST_POINTS_PER_DAY,
  NEST_POINTS_REQUIRED,
  TRUST_MAX
} from '../../src/core/Constants';
import chainsDoc from '../../src/data/chains.json';
import type { ChainsData } from '../../src/core/types';
import { dietIsSurvivable, isDragonFood } from '../../src/systems/DragonSystem';
import { capture, createTestContext } from './helpers';

type Ctx = ReturnType<typeof createTestContext>;

/** Give the nest its full daily allowance, then roll to the next day. */
function feedNestForADay(ctx: Ctx, col = 1, row = 1): void {
  for (let i = 0; i < NEST_POINTS_PER_DAY; i++) {
    ctx.bus.emit('ui:nest_offer_requested', { col, row, chain: 'emberberry', tier: 1 });
  }
  ctx.clock.advance(DAY_MS);
}

/** Warm a nest to hatching and return the new companion's id. */
function hatchOne(ctx: Ctx): string {
  const hatched = capture(ctx.bus, 'nest:hatched');
  for (let d = 0; d < NEST_POINTS_REQUIRED / NEST_POINTS_PER_DAY; d++) feedNestForADay(ctx);
  return hatched.at(-1)!.companionId;
}

describe('DragonSystem — the Cold Nest and named companions', () => {
  it('a dragon is COAXED: 9 points, capped at 3 a day, so it takes three days', () => {
    const ctx = createTestContext();
    const hatched = capture(ctx.bus, 'nest:hatched');
    const refused = capture(ctx.bus, 'nest:offer_refused');

    // Everything the player has, all at once, on day one.
    for (let i = 0; i < 12; i++) {
      ctx.bus.emit('ui:nest_offer_requested', { col: 1, row: 1, chain: 'emberberry', tier: 3 });
    }
    expect(ctx.systems.dragons.nestAt(1, 1).points).toBe(NEST_POINTS_PER_DAY);
    expect(refused.at(-1)).toMatchObject({ reason: 'daily_cap' });
    expect(hatched).toHaveLength(0); // currency and stockpiles cannot compress it

    ctx.clock.advance(DAY_MS);
    feedNestForADay(ctx);
    expect(hatched).toHaveLength(0); // 6 of 9

    for (let i = 0; i < NEST_POINTS_PER_DAY; i++) {
      ctx.bus.emit('ui:nest_offer_requested', { col: 1, row: 1, chain: 'emberberry', tier: 1 });
    }
    expect(hatched).toHaveLength(1);
  });

  it('the nest refuses anything that is not dragon food', () => {
    const ctx = createTestContext();
    const refused = capture(ctx.bus, 'nest:offer_refused');
    // A Crystal Ball is Eleanor's material, not a meal — recipient locking.
    ctx.bus.emit('ui:nest_offer_requested', { col: 1, row: 1, chain: 'quartz', tier: 3 });
    expect(refused.at(-1)).toMatchObject({ reason: 'not_food' });
    expect(ctx.systems.dragons.nestAt(1, 1).points).toBe(0);
    // Ashmoss is a dragon chain, so the nest takes it.
    ctx.bus.emit('ui:nest_offer_requested', { col: 1, row: 1, chain: 'ashmoss', tier: 1 });
    expect(ctx.systems.dragons.nestAt(1, 1).points).toBe(1);
  });

  it('a hatched dragon is a NAMED COMPANION and never a board item', () => {
    const ctx = createTestContext();
    const id = hatchOne(ctx);
    const before = ctx.state.items.size;

    ctx.bus.emit('ui:companion_named', { companionId: id, name: '  Ashling  ' });
    const c = ctx.systems.dragons.find(id)!;

    expect(c.name).toBe('Ashling'); // trimmed
    expect(c.trust).toBe(0); // naming begins the relationship, it is not its reward
    expect(ctx.state.items.size).toBe(before); // nothing was added to the merge board
    expect([...ctx.state.items.values()].some((i) => i.chain === c.chain && i.tier >= 3)).toBe(false);
  });

  it('an empty name is refused rather than stored', () => {
    const ctx = createTestContext();
    const id = hatchOne(ctx);
    ctx.bus.emit('ui:companion_named', { companionId: id, name: '   ' });
    expect(ctx.systems.dragons.find(id)!.name).toBe('');
  });

  it('Trust rises at most once a day, twice as fast on a favourite, and never decays', () => {
    const ctx = createTestContext();
    const id = hatchOne(ctx);
    const c = ctx.systems.dragons.find(id)!;
    // Neither its favourite nor its refusal — a plain, acceptable meal.
    const other = ['emberberry', 'resin', 'ashmoss'].find(
      (ch) => ch !== c.favourite && ch !== c.dislike
    )!;

    ctx.bus.emit('ui:feed_companion_requested', { companionId: id, chain: other, tier: 1 });
    expect(c.trust).toBe(1);
    ctx.bus.emit('ui:feed_companion_requested', { companionId: id, chain: other, tier: 1 });
    expect(c.trust).toBe(1); // same day — one gain only

    ctx.clock.advance(DAY_MS);
    ctx.bus.emit('ui:feed_companion_requested', { companionId: id, chain: c.favourite, tier: 2 });
    expect(c.trust).toBe(3); // +1, +1 favourite bonus

    ctx.clock.advance(DAY_MS * 5); // absence never punishes
    expect(ctx.systems.dragons.find(id)!.trust).toBe(3);
  });

  it('Trust stops at the cap', () => {
    const ctx = createTestContext();
    const id = hatchOne(ctx);
    const c = ctx.systems.dragons.find(id)!;
    for (let d = 0; d < 10; d++) {
      ctx.bus.emit('ui:feed_companion_requested', { companionId: id, chain: c.favourite, tier: 3 });
      ctx.clock.advance(DAY_MS);
    }
    expect(c.trust).toBe(TRUST_MAX);
  });

  it('15 favourite servings raise a LESSER dragon — raised, never merged', () => {
    const ctx = createTestContext();
    const id = hatchOne(ctx);
    const grew = capture(ctx.bus, 'companion:grew');
    const c = ctx.systems.dragons.find(id)!;
    const need = ADULT_SERVINGS.lesser;

    for (let i = 0; i < need - 1; i++) {
      ctx.bus.emit('ui:feed_companion_requested', { companionId: id, chain: c.favourite, tier: 1 });
    }
    expect(c.adult).toBe(false); // one short, however many days it took
    ctx.bus.emit('ui:feed_companion_requested', { companionId: id, chain: c.favourite, tier: 1 });
    expect(c.adult).toBe(true);
    expect(c.growth).toBeCloseTo(need);

    // Fires once, not once per further meal.
    ctx.bus.emit('ui:feed_companion_requested', { companionId: id, chain: c.favourite, tier: 3 });
    expect(grew).toHaveLength(1);
  });

  it('food it merely ACCEPTS grows it four times slower', () => {
    const ctx = createTestContext();
    const id = hatchOne(ctx);
    const c = ctx.systems.dragons.find(id)!;
    // Anything that is neither its favourite nor its refusal.
    const accepted = ctx.systems.dragons
      .edibleChains()
      .find((chain) => chain !== c.favourite && chain !== c.dislike)!;

    const need = ADULT_SERVINGS.lesser;
    for (let i = 0; i < need / ACCEPTED_RATE - 1; i++) {
      ctx.bus.emit('ui:feed_companion_requested', { companionId: id, chain: accepted, tier: 1 });
    }
    expect(c.adult).toBe(false); // 59 of the 60 an accepted diet costs
    ctx.bus.emit('ui:feed_companion_requested', { companionId: id, chain: accepted, tier: 1 });
    expect(c.adult).toBe(true);
  });

  it('a refusal feeds it nothing at all — no gauge, no growth, no serving', () => {
    const ctx = createTestContext();
    const id = hatchOne(ctx);
    const refused = capture(ctx.bus, 'companion:refused');
    const c = ctx.systems.dragons.find(id)!;
    ctx.bus.emit('ui:feed_companion_requested', { companionId: id, chain: c.dislike, tier: 3 });
    expect(refused).toHaveLength(1);
    expect(c.growth).toBe(0);
    expect(c.meals).toBe(0);
  });

  it('the hunger gauge moves at the food\'s taste rate, not its tier alone', () => {
    const ctx = createTestContext();
    const id = hatchOne(ctx);
    const c = ctx.systems.dragons.find(id)!;
    const accepted = ctx.systems.dragons
      .edibleChains()
      .find((chain) => chain !== c.favourite && chain !== c.dislike)!;

    ctx.bus.emit('ui:feed_companion_requested', { companionId: id, chain: c.favourite, tier: 2 });
    const onFavourite = c.meals;
    ctx.bus.emit('ui:feed_companion_requested', { companionId: id, chain: accepted, tier: 2 });
    const fromAccepted = c.meals - onFavourite;
    expect(fromAccepted).toBeCloseTo(onFavourite * ACCEPTED_RATE);
  });

  it('a legendary breed costs 25 servings where a lesser one costs 15', () => {
    expect(ADULT_SERVINGS.legendary).toBeGreaterThan(ADULT_SERVINGS.lesser);
    // Every rigged breed has a taste, and no breed refuses the only GREEN chain
    // — a dragon that could never cool would pant forever with no cure.
    for (const [breed, diet] of Object.entries(DRAGON_DIET)) {
      expect(diet.favourite, breed).not.toBe(diet.refuses);
      expect(diet.refuses, breed).not.toBe('ashmoss');
    }
  });

  it('a feast reveals a Book entry; the same entry never doubles up', () => {
    const ctx = createTestContext();
    const id = hatchOne(ctx);
    const found = capture(ctx.bus, 'companion:discovered');
    ctx.state.rollOverride = 0; // always reveal
    ctx.bus.emit('ui:feed_companion_requested', { companionId: id, chain: 'emberberry', tier: 3 });
    ctx.bus.emit('ui:feed_companion_requested', { companionId: id, chain: 'emberberry', tier: 3 });
    expect(found).toHaveLength(1);
    expect(ctx.systems.dragons.find(id)!.discovered).toEqual(['emberberry:3']);
  });

  it('companions and nest progress survive a save/load round trip', () => {
    const ctx = createTestContext();
    ctx.bus.emit('ui:nest_offer_requested', { col: 2, row: 2, chain: 'emberberry', tier: 2 });
    const id = hatchOne(ctx);
    ctx.bus.emit('ui:companion_named', { companionId: id, name: 'Ember' });

    const save = ctx.state.toSave(0, 9);
    const fresh = createTestContext();
    fresh.state.hydrate(save);

    expect(fresh.state.companions.map((c) => c.name)).toEqual(['Ember']);
    expect(fresh.state.nests['2,2']!.points).toBe(2);
    // Ids keep counting up rather than colliding with the loaded one.
    expect(fresh.state.nextCompanionId).toBeGreaterThan(1);
  });

  it('an old save with no companions loads clean', () => {
    const ctx = createTestContext();
    const save = ctx.state.toSave(0, 9);
    delete save.companions;
    delete save.nests;
    ctx.state.hydrate(save);
    expect(ctx.state.companions).toEqual([]);
    expect(ctx.state.nests).toEqual({});
  });
});

describe('DragonSystem — caretaking: three axes, a refusal, and Trust that pays', () => {
  it('a dislike is refused outright — nothing eaten, no Trust, no meal', () => {
    const ctx = createTestContext();
    const id = hatchOne(ctx);
    const c = ctx.systems.dragons.find(id)!;
    const refused = capture(ctx.bus, 'companion:refused');
    const fed = capture(ctx.bus, 'companion:fed');

    ctx.bus.emit('ui:feed_companion_requested', { companionId: id, chain: c.dislike, tier: 3 });

    expect(refused.at(-1)).toMatchObject({ chain: c.dislike });
    expect(fed).toHaveLength(0);
    expect(c.trust).toBe(0);
    expect(c.meals).toBe(0);
  });

  it('its refusal is never also its favourite', () => {
    const ctx = createTestContext();
    for (let i = 0; i < 3; i++) {
      const c = ctx.systems.dragons.find(hatchOne(ctx))!;
      expect(c.dislike).not.toBe(c.favourite);
    }
  });

  it('NO tier of Eleanor\'s chains is food — not even the raw pebble', () => {
    const ctx = createTestContext();
    const id = hatchOne(ctx);
    const fed = capture(ctx.bus, 'companion:fed');
    for (const chain of ['quartz', 'moonwater']) {
      for (const tier of [1, 2, 3]) {
        ctx.bus.emit('ui:feed_companion_requested', { companionId: id, chain, tier });
      }
    }
    expect(fed).toHaveLength(0);
    expect(ctx.systems.dragons.needs(id).meals).toBe(3); // it has not eaten a thing
  });

  it('the nest refuses Eleanor\'s chains at every tier too', () => {
    const ctx = createTestContext();
    const refused = capture(ctx.bus, 'nest:offer_refused');
    for (const tier of [1, 2, 3]) {
      ctx.bus.emit('ui:nest_offer_requested', { col: 4, row: 4, chain: 'quartz', tier });
    }
    expect(refused).toHaveLength(3);
    expect(ctx.systems.dragons.nestAt(4, 4).points).toBe(0);
  });

  it('condition reads back the axis that is missing', () => {
    const ctx = createTestContext();
    const id = hatchOne(ctx);
    expect(ctx.systems.dragons.needs(id).condition.sort()).toEqual(['listless', 'panting']);

    // Fuel alone fills the belly but never cools it.
    const fav = ctx.systems.dragons.find(id)!.favourite;
    for (let i = 0; i < 3; i++) {
      ctx.bus.emit('ui:feed_companion_requested', { companionId: id, chain: fav, tier: 2 });
    }
    expect(ctx.systems.dragons.needs(id).condition).toEqual(['panting']);

    ctx.bus.emit('ui:feed_companion_requested', { companionId: id, chain: 'ashmoss', tier: 1 });
    expect(ctx.systems.dragons.needs(id).condition).toEqual([]);
  });

  it('the day rolls over: yesterday’s full belly does not feed today', () => {
    const ctx = createTestContext();
    const id = hatchOne(ctx);
    const fav2 = ctx.systems.dragons.find(id)!.favourite;
    for (let i = 0; i < 3; i++) {
      ctx.bus.emit('ui:feed_companion_requested', { companionId: id, chain: fav2, tier: 2 });
    }
    expect(ctx.systems.dragons.needs(id).meals).toBe(0);
    ctx.clock.advance(DAY_MS);
    expect(ctx.systems.dragons.needs(id).meals).toBe(3);
  });

  it('Trust 2 digs exactly one pebble a day — its own grit, so it pays its way', () => {
    const ctx = createTestContext();
    const id = hatchOne(ctx);
    const gave = capture(ctx.bus, 'companion:gave');
    const c = ctx.systems.dragons.find(id)!;

    ctx.systems.dragons.tap(id);
    expect(gave).toHaveLength(0); // Trust 0 — it still backs away

    c.trust = 2;
    ctx.systems.dragons.tap(id);
    // A gift, not a meal — it digs up a thing it cannot use and you can.
    expect(gave.at(-1)).toMatchObject({ chain: 'quartz', tier: 1, kind: 'dug' });
    expect(ctx.systems.dragons.needs(id).meals).toBe(3); // digging is not eating
    ctx.systems.dragons.tap(id);
    expect(gave).toHaveLength(1); // once a day, not once a tap

    ctx.clock.advance(DAY_MS);
    ctx.systems.dragons.tap(id);
    expect(gave).toHaveLength(2);
  });

  it('Trust 4 also forages its favourite, and can get lucky with a tier 2', () => {
    const ctx = createTestContext();
    const id = hatchOne(ctx);
    const c = ctx.systems.dragons.find(id)!;
    c.trust = 4;
    const gave = capture(ctx.bus, 'companion:gave');

    ctx.state.rollOverride = 0.99; // unlucky
    ctx.systems.dragons.tap(id);
    const forage = gave.find((g) => g.kind === 'foraged')!;
    expect(forage).toMatchObject({ chain: c.favourite, tier: 1 });

    ctx.clock.advance(DAY_MS);
    ctx.state.rollOverride = 0; // lucky day
    ctx.systems.dragons.tap(id);
    expect(gave.filter((g) => g.kind === 'foraged').at(-1)!.tier).toBe(2);
  });

  it('what it digs lands on the board', () => {
    const ctx = createTestContext();
    const id = hatchOne(ctx);
    ctx.systems.dragons.find(id)!.trust = 2;
    const before = ctx.state.countItems('quartz', 1);
    ctx.systems.dragons.tap(id);
    expect(ctx.state.countItems('quartz', 1)).toBe(before + 1);
  });
});

/**
 * The food roster is authored in three places that have to agree — chains.json,
 * the FUEL/GREEN axes, and each breed's taste — and every way they can disagree
 * fails silently on a dragon the player has already spent a week raising.
 */
describe('the diet roster (Constants DRAGON_DIET × chains.json)', () => {
  const chains = chainsDoc as unknown as ChainsData;
  const ids = new Set(chains.chains.map((chain) => chain.id));
  const breeds = Object.entries(DRAGON_DIET);

  it('every breed has a favourite it can actually reach in its HOME world', () => {
    for (const [breed, diet] of breeds) {
      expect(ids, `${breed} favourite`).toContain(diet.favourite);
      expect(ids, `${breed} refusal`).toContain(diet.refuses);
      expect(isDragonFood(diet.favourite, 1), `${breed}'s favourite is not food`).toBe(true);
      // A favourite in another world is a favourite the dragon never gets: its
      // adult would cost 4x what the roster says it does. This is why tarknot
      // cannot be an Emberkeep breed's — it is Borealis vocabulary. The home
      // world is the BREED's chain world (a skin breed like frost/storm is not
      // a chain and lives on the Emberkeep red chain); the rimewyrm is
      // Borealis-born, so Borealis vocabulary is exactly its own.
      const home = chains.chains.find((c) => c.id === breed)?.world ?? 'emberkeep';
      const chain = chains.chains.find((c) => c.id === diet.favourite)!;
      expect(chain.world ?? 'emberkeep', `${breed} favours another world`).toBe(home);
    }
  });

  it('no two breeds share a favourite — a taste has to tell dragons apart', () => {
    const favourites = breeds.map(([, diet]) => diet.favourite);
    expect(new Set(favourites).size).toBe(favourites.length);
  });

  it('no refusal leaves a dragon without a fuel or without a green', () => {
    // The law that replaced "never refuse the green" once nightbloom gave the
    // roster a second cooling chain. Both worlds, because a breed travels.
    for (const [breed, diet] of breeds) {
      for (const world of ['emberkeep', 'borealis']) {
        expect(dietIsSurvivable(diet, chains, world), `${breed} in ${world}`).toBe(true);
      }
    }
  });
});
