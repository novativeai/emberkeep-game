import { describe, expect, it } from 'vitest';
import { questGoalPiece, recipeHelp } from '../../src/core/recipeTree';
import { WORLD_ID } from '../../src/core/Constants';
import chains from '../../src/data/chains.json';
import type { ChainsData } from '../../src/core/types';

const CHAINS = chains as unknown as ChainsData;

/** A pocket: `chain:tier` → count. Anything not listed, the Keeper does not have. */
const pocket =
  (owned: Record<string, number> = {}) =>
  (chain: string, tier: number): number =>
    owned[`${chain}:${tier}`] ?? 0;

const help = (
  goal: { chain: string; tier: number; count: number },
  owned: Record<string, number> = {},
  worldId = WORLD_ID
) => recipeHelp(CHAINS, goal, pocket(owned), worldId);

/**
 * THE `?` ON A QUEST CARD, read as data. These are the promises the panel
 * prints, so each one is pinned here rather than trusted to the drawing.
 *
 * Read against the SHIPPED chains.json on purpose: the numbers a player sees
 * are the numbers the merge really uses, and a fixture would let the two drift.
 */
describe('recipeHelp — how do I make that?', () => {
  it("answers the owner's own example: one Sun Gem is nine Gem Chips and a Red Dragon", () => {
    const answer = help({ chain: 'flame_gem', tier: 3, count: 1 })!;
    expect(answer).toBeTruthy();
    expect(answer.goal.name).toBe('Sun Gem');
    expect(answer.rungs.map((r) => [r.tier, r.need, r.missing])).toEqual([
      [3, 1, 1], // the Sun Gem itself
      [2, 3, 3], // three Fire Gems
      [1, 9, 9] // nine Gem Chips
    ]);
    // Each rung says how many of the tier below make one of it; the base rung
    // is not made by merging and says nothing.
    expect(answer.rungs.map((r) => r.fromCount)).toEqual([3, 3, undefined]);
    expect(answer.baseMissing).toBe(9);
    expect(answer.source).toMatchObject({
      kind: 'tap',
      label: 'Red Dragon',
      producer: { chain: 'ember_dragon', tier: 3 },
      energyCost: 1,
      cooldownMs: 45_000
    });
  });

  it('subtracts what is already in the pocket, and the subtraction CASCADES', () => {
    // Two Fire Gems held: one more is wanted, so the shards owed are three,
    // not nine. This is the whole difference between the help and a recipe book.
    const answer = help({ chain: 'flame_gem', tier: 3, count: 1 }, { 'flame_gem:2': 2 })!;
    expect(answer.rungs.map((r) => [r.tier, r.need, r.have, r.missing])).toEqual([
      [3, 1, 0, 1],
      [2, 3, 2, 1],
      [1, 3, 0, 3]
    ]);
    expect(answer.baseMissing).toBe(3);
  });

  it('says nothing is owed when the goal is already in hand', () => {
    const answer = help({ chain: 'flame_gem', tier: 3, count: 1 }, { 'flame_gem:3': 1 })!;
    expect(answer.rungs.map((r) => r.missing)).toEqual([0, 0, 0]);
    expect(answer.baseMissing).toBe(0);
  });

  it('reads the merge count from the recipe, so a group-2 tier is not called three', () => {
    // Two Houses make a Mansion — the per-tier override in chains.json. A help
    // that hard-coded 3 would send the player to fell twice the forest.
    const answer = help({ chain: 'lumber', tier: 4, count: 1 })!;
    expect(answer.rungs.map((r) => [r.tier, r.need])).toEqual([
      [4, 1],
      [3, 2], // two Houses
      [2, 6], // three Planks each
      [1, 18] // three Logs each
    ]);
    expect(answer.rungs.map((r) => r.fromCount)).toEqual([2, 3, 3, undefined]);
  });

  it('scales with the quest count', () => {
    const one = help({ chain: 'flame_gem', tier: 3, count: 1 })!;
    const three = help({ chain: 'flame_gem', tier: 3, count: 3 })!;
    expect(one.baseMissing * 3).toBe(three.baseMissing);
    expect(three.goal.count).toBe(3);
  });

  it('names a producer the Keeper actually owns over one they do not', () => {
    // Eight dragons make Gem Chips. Telling a player who keeps a Green Dragon
    // to go and find a Red one is worse than saying nothing.
    const green = help({ chain: 'flame_gem', tier: 3, count: 1 }, { 'emerald:3': 1 })!;
    expect(green.source.label).toBe('Green Dragon');
    expect(green.source.producer).toEqual({ chain: 'emerald', tier: 3 });
  });

  it('never names a producer that belongs to another world', () => {
    // Glass Floats are the north's, and `chainHiddenIn` is the same gate the
    // Cookbook's pages use — the help cannot point somewhere the player is not.
    const north = help({ chain: 'seaglass', tier: 3, count: 1 }, {}, 'borealis');
    expect(north?.source.label).toBe('Glass Oven');
    const south = help({ chain: 'seaglass', tier: 3, count: 1 }, {}, WORLD_ID);
    expect(south?.source.kind).toBe('none');
  });

  it('stops at a piece a producer hands over, rather than descending past it', () => {
    // Moonwater: the Dew Fountain pours Dew Drops, so the ladder ends there.
    const answer = help({ chain: 'moonwater', tier: 3, count: 1 })!;
    expect(answer.rungs.map((r) => r.tier)).toEqual([3, 2, 1]);
    expect(answer.source).toMatchObject({ kind: 'tap', label: 'Dew Fountain' });
  });

  it('still answers a tier-1 goal, because "tap the Red Dragon" is help', () => {
    const answer = help({ chain: 'flame_gem', tier: 1, count: 3 })!;
    expect(answer.rungs.map((r) => [r.tier, r.need, r.missing])).toEqual([[1, 3, 3]]);
    expect(answer.rungs[0]!.fromCount).toBeUndefined();
    expect(answer.source).toMatchObject({ kind: 'tap', label: 'Red Dragon' });
  });

  it('stops early at a producer the Keeper HAS, rather than sending them to tier one', () => {
    // An Ash Dragon pours Fire Gems. Somebody who keeps one does not need to be
    // told about Gem Chips — but somebody who has never seen one must never be
    // sent to find it, which is why the stop is gated on holding it.
    const withDrake = help({ chain: 'flame_gem', tier: 3, count: 1 }, { 'ashdrake:2': 1 })!;
    expect(withDrake.rungs.map((r) => r.tier)).toEqual([3, 2]);
    expect(withDrake.source).toMatchObject({ kind: 'tap', label: 'Ash Dragon' });
    // Without one, the ladder goes all the way down.
    expect(help({ chain: 'flame_gem', tier: 3, count: 1 })!.rungs.map((r) => r.tier)).toEqual([3, 2, 1]);
  });

  it('offers nothing when there is neither a ladder nor a maker', () => {
    // A `?` that opens an empty panel is worse than no `?` — the card hides the
    // button on exactly this answer.
    expect(help({ chain: 'ember_dragon', tier: 1, count: 1 })).toBeNull();
    expect(help({ chain: 'not_a_chain', tier: 2, count: 1 })).toBeNull();
    expect(help({ chain: 'flame_gem', tier: 9, count: 1 })).toBeNull();
    expect(help({ chain: 'flame_gem', tier: 3, count: 0 })).toBeNull();
  });
});

/**
 * THE HOVER HINT'S OWN RULE — which quest steps have a ladder to show.
 *
 * The quest tracker raises the same sheet the Ledger's `?` opens when the
 * pointer rests on a row (`ui:recipe_peek`). Whether a row HAS anything to say
 * is this function, and it lives outside the Phaser container so it can be held
 * here rather than on a screenshot.
 */
describe('which quest steps name a piece worth explaining', () => {
  it('reads a piece straight off the goals that carry one', () => {
    expect(questGoalPiece({ kind: 'have', chain: 'emberberry', tier: 3, count: 1 })).toEqual({
      chain: 'emberberry',
      tier: 3,
      count: 1
    });
    expect(
      questGoalPiece({ kind: 'gift', characterId: 'eleanor', chain: 'flame_gem', tier: 2, count: 2 })
    ).toEqual({ chain: 'flame_gem', tier: 2, count: 2 });
  });

  it('explains the tier a recipe step wants MADE, not the one it starts from', () => {
    expect(questGoalPiece({ kind: 'recipe', chain: 'flame_gem', fromTier: 1, toTier: 2 })).toEqual({
      chain: 'flame_gem',
      tier: 2,
      count: 1
    });
  });

  it('follows a DELIVER step one hop, to the pieces the order requires', () => {
    // "Deliver 6 Gem Chips to Eleanor" should explain the Gem Chips. The needs
    // come from QuestSystem.needsFor — the same function `pnpm quests` audits
    // with, so the tracker and the offline proof cannot disagree.
    expect(
      questGoalPiece({ kind: 'order', orderId: 'eleanor_brazier' }, [
        { chain: 'flame_gem', tier: 1, count: 6 }
      ])
    ).toEqual({ chain: 'flame_gem', tier: 1, count: 6 });
    // An order whose needs cannot be resolved says nothing rather than guessing.
    expect(questGoalPiece({ kind: 'order', orderId: 'eleanor_brazier' })).toBeNull();
  });

  it('says nothing for the steps that count things instead of wanting them', () => {
    // There is no ladder for "merge 10 times", and a hint that invents one is a
    // hint that lies. These rows simply raise no sheet.
    expect(questGoalPiece({ kind: 'stat', stat: 'merges', count: 10 })).toBeNull();
    expect(questGoalPiece({ kind: 'level', level: 3 })).toBeNull();
    expect(questGoalPiece({ kind: 'region', regionId: 'level_2_gate' })).toBeNull();
    expect(questGoalPiece({ kind: 'brew', recipeId: 'moonwater', count: 1 })).toBeNull();
    expect(questGoalPiece({ kind: 'task', taskId: 'orders_5' })).toBeNull();
    expect(questGoalPiece({ kind: 'world', worldId: 'borealis' })).toBeNull();
    expect(questGoalPiece({ kind: 'regard', characterId: 'eleanor', hearts: 3 })).toBeNull();
  });
});
