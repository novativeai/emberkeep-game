import { describe, expect, it } from 'vitest';
import assetsDoc from '../../src/data/assets.json';
import cauldronJson from '../../src/data/cauldron.json';
import chainsJson from '../../src/data/chains.json';
import { DRAGON_REVEAL } from '../../src/core/Constants';
import type { CauldronData, ChainsData } from '../../src/core/types';
import { capture, createTestContext, drag } from './helpers';

const data = cauldronJson as CauldronData;
const chains = chainsJson as unknown as ChainsData;

/** The egg recipes — every output whose chain hatches into a dragon. */
const eggs = data.recipes
  .map((r) => r.output)
  .filter((o) => chains.chains.find((c) => c.id === o.chain)?.hatchAtTier !== undefined);

/**
 * The whole road a brewed egg travels: out of the Bag onto the board, three of
 * a kind into the animal, and the reveal card on the hatch. Exercised per
 * breed, because each leg is data-driven and a missing tier, diet gate or
 * reveal entry breaks exactly one chain while the others keep working.
 */
describe('brewed eggs → board → dragon (the whole road)', () => {
  it('covers every dragon egg the cauldron can brew', () => {
    expect(eggs.map((e) => e.chain).sort()).toEqual(
      ['ashdrake', 'ember_dragon', 'emerald', 'golden_egg', 'rimewyrm'].sort()
    );
  });

  for (const egg of eggs) {
    const chain = chains.chains.find((c) => c.id === egg.chain)!;
    const hatchTier = chain.hatchAtTier!;

    it(`${egg.chain}: a banked egg DROPS from the bag onto the board`, () => {
      const ctx = createTestContext();
      ctx.bus.emit('bag:bank', { chain: egg.chain, tier: egg.tier, count: 3 });
      for (let i = 0; i < 3; i++) {
        ctx.bus.emit('ui:bag_retrieve_requested', { chain: egg.chain, tier: egg.tier });
      }
      const onBoard = [...ctx.state.items.values()].filter(
        (item) => item.chain === egg.chain && item.tier === egg.tier
      );
      expect(onBoard).toHaveLength(3);
      expect(ctx.state.bag).toEqual([]); // all three left the bag
    });

    it(`${egg.chain}: three eggs merge into the dragon and the hatch fires`, () => {
      const ctx = createTestContext();
      ctx.state.addItem({ chain: egg.chain, tier: egg.tier, col: 1, row: 1, kind: 'item' });
      ctx.state.addItem({ chain: egg.chain, tier: egg.tier, col: 1, row: 2, kind: 'item' });
      ctx.state.addItem({ chain: egg.chain, tier: egg.tier, col: 3, row: 3, kind: 'item' });
      const hatched = capture(ctx.bus, 'item:hatched');
      const revealed = capture(ctx.bus, 'dragon:revealed');

      drag(ctx, [3, 3], [1, 3]);

      const result = ctx.state.itemAt(1, 3);
      expect(result?.chain).toBe(egg.chain);
      expect(result?.tier).toBe(egg.tier + 1);
      // Every egg in the roster sits exactly one merge under its animal —
      // which is what makes "3 eggs → the dragon" true for all of them.
      expect(egg.tier + 1).toBe(hatchTier);
      expect(hatched).toHaveLength(1);
      // The ceremony: first hatch of this form shows its reveal card.
      expect(revealed.at(-1)).toMatchObject({ chain: egg.chain, tier: hatchTier });
    });
  }
});

describe('the reveal roster covers the brewable dragons', () => {
  const registered = new Set((assetsDoc.images as Array<{ key: string }>).map((e) => e.key));

  it('every egg chain has a DRAGON_REVEAL card at its hatch tier', () => {
    for (const egg of eggs) {
      const hatchTier = chains.chains.find((c) => c.id === egg.chain)!.hatchAtTier!;
      expect(DRAGON_REVEAL[`${egg.chain}:${hatchTier}`], `${egg.chain}:${hatchTier}`).toBeDefined();
    }
  });

  it("every card's art key is registered in assets.json", () => {
    for (const card of Object.values(DRAGON_REVEAL)) {
      expect(registered.has(card.art), `${card.art} unregistered`).toBe(true);
    }
  });
});
