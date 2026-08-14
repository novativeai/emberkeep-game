import { describe, expect, it } from 'vitest';
import chainsData from '../../src/data/chains.json';
import ordersData from '../../src/data/orders.json';
import questsData from '../../src/data/quests.json';
import { CHEST_GIFTS, GOLD_UNIT, LEVELUP_REWARD } from '../../src/core/Constants';
import type { ChainsData, OrdersData, QuestsData } from '../../src/core/types';
import { capture, createTestContext } from './helpers';

const chains = (chainsData as unknown as ChainsData).chains;
const quests = (questsData as unknown as QuestsData).quests;
const orders = (ordersData as unknown as OrdersData).orders;

/** A Gold Coin — the unit every Gold award is counted in. */
const UNIT = GOLD_UNIT;
/** What a coin tier is worth: its `sell`, because a Coin is a PIECE. */
const worth = (tier: number): number =>
  chains.find((c) => c.id === 'coin')!.tiers.find((t) => t.tier === tier)!.sell!;

/**
 * GOLD IS DENOMINATED, and the denomination is the Gold Coin.
 *
 * The board pays in coins — a House drops one each cycle, a Manor a Pouch — so
 * a balance the player holds has to be expressible in them: 35 Gold is seven
 * Coins. An award of 26 could never be handed over as money, which is why every
 * scripted payout is authored as a multiple of the unit and why the +30% pass on
 * the early ladder was rounded to fives rather than left at 143 and 117.
 */
describe('every scripted Gold award is payable in Coins', () => {
  it('quest and order rewards are whole Coins', () => {
    const odd: string[] = [];
    for (const quest of quests) {
      const coins = quest.rewards?.coins;
      if (coins !== undefined && coins % UNIT !== 0) odd.push(`quest ${quest.id}: ${coins}`);
    }
    for (const order of orders) {
      const coins = order.rewards?.coins;
      if (coins !== undefined && coins % UNIT !== 0) odd.push(`order ${order.id}: ${coins}`);
    }
    expect(odd).toEqual([]);
  });

  it('the level-up purse and the chest pay in whole Coins too', () => {
    expect(LEVELUP_REWARD.coinsBase % UNIT).toBe(0);
    expect(LEVELUP_REWARD.coinsPerLevel % UNIT).toBe(0);
    for (const gift of CHEST_GIFTS) {
      if (gift.kind === 'coins') expect(gift.amount % UNIT).toBe(0);
    }
  });

  it('a Coin is worth the unit, and a Pouch the Coins it was merged from', () => {
    // The Manor's product is three Coins joined. Paying less than three Coins
    // for it would make the one merge the Manor exists to feed lose money.
    const coin = chains.find((c) => c.id === 'coin')!;
    const group = coin.tiers.find((t) => t.tier === 2)?.merge?.group ?? 3;
    expect(worth(1)).toBe(UNIT);
    expect(worth(2)).toBe(UNIT * group);
  });

  it('keeps both coin tiers sellable — the Bag is where gold is realised', () => {
    // A Coin is a piece: the House drops one, the player pockets it, and the
    // Bag turns it back into money. A tier that cannot be sold would be a piece
    // of currency the player can hold and never spend.
    const coin = chains.find((c) => c.id === 'coin')!;
    for (const tier of coin.tiers) {
      expect(tier.sell, `coin t${tier.tier} cannot be sold`).toBeGreaterThan(0);
      expect(tier.sell! % UNIT, `coin t${tier.tier} is not whole Coins`).toBe(0);
    }
  });
});

/**
 * A COIN IS A PIECE — the Bag is where gold is realised.
 *
 * Coins used to be collectibles: a tap banked the gold and destroyed the piece,
 * so a Gold Coin could never reach the Bag. That is not a cosmetic gap. The
 * commission chooser reads the Bag, so a House that had been commissioned to
 * anything else could never be told to make Gold Coins again, and a Manor could
 * never be pointed at Gold Pouches at all — the two outputs the buildings exist
 * to make were the only two the player could not choose.
 */
describe('coins live in the Bag, and the buildings make their own rank of them', () => {
  it('pockets a Gold Coin like any other piece', () => {
    const ctx = createTestContext();
    ctx.systems.board.spawn('coin', 1, 1, 1, 'init');
    const coin = [...ctx.state.items.values()].find((i) => i.chain === 'coin')!;
    expect(ctx.systems.bag.canStore('coin', 1)).toBe(true);

    ctx.bus.emit('ui:store_requested', { itemId: coin.id });

    expect(ctx.systems.bag.countOf('coin', 1)).toBe(1);
    expect(ctx.state.countItems('coin', 1)).toBe(0); // off the board, into the satchel
  });

  it('lets a HOUSE be commissioned to Gold Coins, and refuses it the Pouch', () => {
    const ctx = createTestContext();
    ctx.systems.board.spawn('lumber', 3, 1, 1, 'init');
    const house = [...ctx.state.items.values()].find((i) => i.chain === 'lumber' && i.tier === 3)!;
    const refused = capture(ctx.bus, 'generator:produce_refused');
    ctx.bus.emit('bag:bank', { chain: 'coin', tier: 2, count: 1 });

    // A House works tier one. The Pouch is tier two — the rank rule, not a
    // shortage: the piece is right there in the bag.
    ctx.bus.emit('ui:produce_choice_requested', { itemId: house.id, chain: 'coin', tier: 2 });
    expect(refused.at(-1)).toMatchObject({ reason: 'tier_too_high' });
    expect(ctx.state.items.get(house.id)?.produces).toBeUndefined();

    ctx.bus.emit('bag:bank', { chain: 'coin', tier: 1, count: 1 });
    ctx.bus.emit('ui:produce_choice_requested', { itemId: house.id, chain: 'coin', tier: 1 });
    expect(ctx.state.items.get(house.id)?.produces).toEqual({ chain: 'coin', tier: 1 });
  });

  it('lets a MANOR be commissioned to Gold Pouches', () => {
    const ctx = createTestContext();
    ctx.systems.board.spawn('lumber', 4, 1, 1, 'init');
    const manor = [...ctx.state.items.values()].find((i) => i.chain === 'lumber' && i.tier === 4)!;
    ctx.bus.emit('bag:bank', { chain: 'coin', tier: 2, count: 1 });

    ctx.bus.emit('ui:produce_choice_requested', { itemId: manor.id, chain: 'coin', tier: 2 });

    expect(ctx.state.items.get(manor.id)?.produces).toEqual({ chain: 'coin', tier: 2 });
  });

  it('makes each building start on its own rank of coin', () => {
    // Uncommissioned, a House drops Coins and a Manor drops Pouches — the same
    // number of pieces, three times the money, which is what the Manor is for.
    const lumber = chains.find((c) => c.id === 'lumber')!;
    const house = lumber.tiers.find((t) => t.tier === 3)!.generator!;
    const manor = lumber.tiers.find((t) => t.tier === 4)!.generator!;
    expect(house.produces).toEqual({ chain: 'coin', tier: 1 });
    expect(manor.produces).toEqual({ chain: 'coin', tier: 2 });
    expect(worth(2)).toBeGreaterThan(worth(1));
  });
});
