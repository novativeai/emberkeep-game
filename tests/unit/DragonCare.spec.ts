import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_RATE,
  DAILY_GREEN,
  DRAGON_DIET,
  MEAL_VALUE,
  MEALS_PER_DAY,
  TRUST_MAX
} from '../../src/core/Constants';
import { capture, createTestContext } from './helpers';
import type { GameContext } from '../../src/core/Context';

/** Put a dragon of `chain` at `tier` on a free tile and hand back its id. */
function placeDragon(ctx: GameContext, chain = 'ember_dragon', tier = 3): number {
  const free = ctx.state.freeActiveTilesNear(0, 0)[0];
  if (!free) throw new Error('fixture board has no free tile');
  return ctx.state.addItem({ chain, tier, col: free.col, row: free.row, kind: 'item' }).id;
}

const feed = (ctx: GameContext, itemId: number, chain: string, tier: number): void =>
  ctx.bus.emit('ui:feed_dragon_requested', { itemId, chain, tier });

describe('feeding a dragon that stands on the board', () => {
  it('only an actual dragon can be fed — not its eggs, not a plain piece', () => {
    const ctx = createTestContext();
    const dragon = ctx.state.items.get(placeDragon(ctx))!;
    const egg = ctx.state.items.get(placeDragon(ctx, 'ember_dragon', 2))!;

    expect(ctx.systems.dragons.isBoardDragon(dragon)).toBe(true);
    // A Red Egg shares the chain but is not an animal — a player who could feed
    // one would reasonably expect it to hatch sooner for it.
    expect(ctx.systems.dragons.isBoardDragon(egg)).toBe(false);
  });

  it('eats its favourite at full rate and earns two trust for it', () => {
    const ctx = createTestContext();
    const id = placeDragon(ctx);
    const fed = capture(ctx.bus, 'dragon:fed');
    const trust = capture(ctx.bus, 'dragon:trust_changed');

    // Resin is the Red's favourite, and a Hearth Cake is a whole serving.
    expect(DRAGON_DIET.ember_dragon!.favourite).toBe('resin');
    feed(ctx, id, 'resin', 3);

    expect(fed).toHaveLength(1);
    expect(fed[0]).toMatchObject({ favourite: true, needs: MEALS_PER_DAY });
    expect(fed[0]!.meals).toBeCloseTo(MEAL_VALUE[3]!);
    expect(trust).toEqual([{ itemId: id, trust: 2 }]);
  });

  it('eats what it merely accepts at the reduced rate, for one trust', () => {
    const ctx = createTestContext();
    const id = placeDragon(ctx);
    const trust = capture(ctx.bus, 'dragon:trust_changed');

    feed(ctx, id, 'ashmoss', 2);

    const care = ctx.systems.dragons.careOf(id);
    expect(care.meals).toBeCloseTo(MEAL_VALUE[2]! * ACCEPTED_RATE);
    expect(trust).toEqual([{ itemId: id, trust: 1 }]);
    // Moss is the cooling axis, so it also answers the day's green.
    expect(care.green).toBe(DAILY_GREEN);
  });

  it('turns its head away from its refusal, and consumes nothing', () => {
    const ctx = createTestContext();
    const id = placeDragon(ctx);
    const refused = capture(ctx.bus, 'dragon:refused');
    const fed = capture(ctx.bus, 'dragon:fed');

    feed(ctx, id, DRAGON_DIET.ember_dragon!.refuses, 2);

    expect(refused).toEqual([
      { itemId: id, chain: DRAGON_DIET.ember_dragon!.refuses, reason: 'dislike' }
    ]);
    expect(fed).toHaveLength(0);
    expect(ctx.systems.dragons.careOf(id).meals).toBe(0);
  });

  it('refuses a thing that is not food at all, and says which refusal it is', () => {
    const ctx = createTestContext();
    const id = placeDragon(ctx);
    const refused = capture(ctx.bus, 'dragon:refused');

    // Moonwater is Eleanor's end to end — no tier of it feeds anyone.
    feed(ctx, id, 'moonwater', 1);

    expect(refused).toEqual([{ itemId: id, chain: 'moonwater', reason: 'not_food' }]);
    expect(ctx.systems.dragons.careOf(id).meals).toBe(0);
  });

  it('pays trust at most once a day, however much it is fed', () => {
    const ctx = createTestContext();
    const id = placeDragon(ctx);
    const trust = capture(ctx.bus, 'dragon:trust_changed');

    feed(ctx, id, 'resin', 3);
    feed(ctx, id, 'resin', 3);
    feed(ctx, id, 'resin', 3);

    expect(trust).toHaveLength(1);
    expect(ctx.systems.dragons.careOf(id).trust).toBe(2);
    // The belly, unlike trust, keeps filling.
    expect(ctx.systems.dragons.careOf(id).meals).toBeCloseTo(3 * MEAL_VALUE[3]!);
  });

  it('caps trust at five and never decays it', () => {
    const ctx = createTestContext();
    const id = placeDragon(ctx);

    // A day each: +2 for the favourite until the gauge is full.
    for (let day = 0; day < 6; day++) {
      feed(ctx, id, 'resin', 3);
      ctx.clock.advance(24 * 60 * 60 * 1000);
    }
    expect(ctx.systems.dragons.careOf(id).trust).toBe(TRUST_MAX);

    // Another whole day with nothing offered at all.
    ctx.clock.advance(24 * 60 * 60 * 1000);
    expect(ctx.systems.dragons.careOf(id).trust).toBe(TRUST_MAX);
  });

  it('rolls the day over: yesterday`s meals do not feed today', () => {
    const ctx = createTestContext();
    const id = placeDragon(ctx);

    feed(ctx, id, 'resin', 3);
    expect(ctx.systems.dragons.boardNeeds(id).meals).toBe(MEALS_PER_DAY - MEAL_VALUE[3]!);

    ctx.clock.advance(24 * 60 * 60 * 1000);
    const needs = ctx.systems.dragons.boardNeeds(id);
    expect(needs.meals).toBe(MEALS_PER_DAY);
    expect(needs.condition).toContain('listless');
    // Trust is the relationship and survives the night; the belly does not.
    expect(needs.trust).toBe(2);
  });

  it('reading a dragon that has never been fed writes nothing to the save', () => {
    const ctx = createTestContext();
    const id = placeDragon(ctx);

    expect(ctx.systems.dragons.careOf(id).trust).toBe(0);
    expect(ctx.systems.dragons.boardNeeds(id).meals).toBe(MEALS_PER_DAY);
    expect(ctx.state.items.get(id)!.care).toBeUndefined();
  });

  it('takes a name, once, and only for a real dragon', () => {
    const ctx = createTestContext();
    const id = placeDragon(ctx);
    const egg = placeDragon(ctx, 'ember_dragon', 2);
    const named = capture(ctx.bus, 'dragon:named');

    ctx.bus.emit('ui:dragon_named', { itemId: id, name: 'Cinder' });
    expect(named).toEqual([{ itemId: id, name: 'Cinder', chain: 'ember_dragon' }]);
    expect(ctx.systems.dragons.nameOf(id)).toBe('Cinder');

    // Write-once: the beat only lands if the choice is a choice.
    ctx.bus.emit('ui:dragon_named', { itemId: id, name: 'Ashling' });
    expect(ctx.systems.dragons.nameOf(id)).toBe('Cinder');
    expect(named).toHaveLength(1);

    // An egg is not an animal, so it cannot be named either.
    ctx.bus.emit('ui:dragon_named', { itemId: egg, name: 'Pyre' });
    expect(ctx.systems.dragons.nameOf(egg)).toBeUndefined();
  });

  it('trims a name and refuses an empty one', () => {
    const ctx = createTestContext();
    const id = placeDragon(ctx);

    ctx.bus.emit('ui:dragon_named', { itemId: id, name: '   ' });
    expect(ctx.systems.dragons.nameOf(id)).toBeUndefined();

    ctx.bus.emit('ui:dragon_named', { itemId: id, name: '  Sorrel  ' });
    expect(ctx.systems.dragons.nameOf(id)).toBe('Sorrel');
  });

  it('carries the best care record through the merge that grows the dragon', () => {
    const ctx = createTestContext();
    const a = placeDragon(ctx);
    const first = ctx.state.items.get(a)!;
    // Seat the second one right beside it: 2 Red Dragons → 1 Adult.
    const beside = ctx.state.freeActiveNeighbors(first.col, first.row)[0];
    if (!beside) throw new Error('fixture board has no free neighbour');
    const b = ctx.state.addItem({
      chain: 'ember_dragon',
      tier: 3,
      col: beside.col,
      row: beside.row,
      kind: 'item'
    }).id;

    feed(ctx, a, 'resin', 3); // a is trusted; b has never been fed
    ctx.bus.emit('ui:dragon_named', { itemId: a, name: 'Cinder' });
    ctx.bus.emit('drag:dropped', {
      itemId: b,
      from: { col: beside.col, row: beside.row },
      to: { col: first.col, row: first.row }
    });

    const adult = [...ctx.state.items.values()].find(
      (i) => i.chain === 'ember_dragon' && i.tier === 4
    );
    expect(adult).toBeDefined();
    // The grown dragon is the fed one grown up, not a stranger with an empty
    // record — a player who fed it every day must not be punished for merging.
    expect(adult!.care?.trust).toBe(2);
    // And she is still herself: losing the name here is the one way a board
    // dragon could break the naming law.
    expect(adult!.dragonName).toBe('Cinder');
  });
});
