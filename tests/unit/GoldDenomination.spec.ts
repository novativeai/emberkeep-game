import { describe, expect, it } from 'vitest';
import chainsData from '../../src/data/chains.json';
import ordersData from '../../src/data/orders.json';
import questsData from '../../src/data/quests.json';
import { CHEST_GIFTS, GOLD_UNIT, goldPurse, LEVELUP_REWARD, POUCH_UNIT } from '../../src/core/Constants';
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
 * THE PURSE — one pile of money, two ways to look at it.
 *
 * The number in the HUD and the coins in the satchel are the SAME Gold. Coins
 * used to be collectibles that vanished into a counter, so the Bag could never
 * show them; then they were storable pieces, which made a second balance the
 * player had to reconcile by hand. Neither could answer the question the
 * commission chooser asks — "what may this building be told to make?" — because
 * the answer depends on the building's RANK, and one pile of money has to be
 * able to read as Coins to a House and as Pouches to a Manor.
 */
describe('the purse is the Gold balance, in the coins it is made of', () => {
  it('shows the largest coin the balance fills', () => {
    expect(goldPurse(0)).toBeNull();
    expect(goldPurse(GOLD_UNIT - 1)).toBeNull(); // less than one Coin: nothing to show
    expect(goldPurse(GOLD_UNIT)).toEqual({ chain: 'coin', tier: 1, count: 1 });
    expect(goldPurse(POUCH_UNIT - GOLD_UNIT)).toEqual({ chain: 'coin', tier: 1, count: 2 });
    expect(goldPurse(500)).toEqual({ chain: 'coin', tier: 2, count: 33 }); // 33 Pouches
  });

  it('reads down to the rank of whoever is asking', () => {
    // A House works tier one, so the same 500 Gold reads to it as 100 Coins —
    // it is never offered a Pouch it could not make.
    expect(goldPurse(500, 1)).toEqual({ chain: 'coin', tier: 1, count: 100 });
    expect(goldPurse(500, 2)).toEqual({ chain: 'coin', tier: 2, count: 33 });
  });

  it('banks a tapped Coin into the balance instead of a satchel stack', () => {
    const ctx = createTestContext();
    ctx.systems.board.spawn('coin', 2, 1, 1, 'init');
    const pouch = [...ctx.state.items.values()].find((i) => i.chain === 'coin')!;

    ctx.bus.emit('ui:store_requested', { itemId: pouch.id });

    expect(ctx.state.coins).toBe(POUCH_UNIT); // straight to the purse
    expect(ctx.systems.bag.countOf('coin', 2)).toBe(0); // never a stack
    expect(ctx.state.countItems('coin', 2)).toBe(0); // and off the board
    expect(ctx.systems.bag.used).toBe(0); // money costs no capacity
  });

  it('lets a HOUSE be commissioned to Gold Coins out of the balance', () => {
    const ctx = createTestContext();
    ctx.systems.board.spawn('lumber', 3, 1, 1, 'init');
    const house = [...ctx.state.items.values()].find((i) => i.chain === 'lumber' && i.tier === 3)!;
    const refused = capture(ctx.bus, 'generator:produce_refused');
    ctx.bus.emit('economy:add', { coins: 500, reason: 'test' });

    // A House works tier one. The Pouch is tier two — the rank rule, not a
    // shortage: the balance would cover thirty-three of them.
    ctx.bus.emit('ui:produce_choice_requested', { itemId: house.id, chain: 'coin', tier: 2 });
    expect(refused.at(-1)).toMatchObject({ reason: 'tier_too_high' });
    expect(ctx.state.items.get(house.id)?.produces).toBeUndefined();

    ctx.bus.emit('ui:produce_choice_requested', { itemId: house.id, chain: 'coin', tier: 1 });
    expect(ctx.state.items.get(house.id)?.produces).toEqual({ chain: 'coin', tier: 1 });
  });

  it('lets a MANOR be commissioned to Gold Pouches, and refuses an empty purse', () => {
    const ctx = createTestContext();
    ctx.systems.board.spawn('lumber', 4, 1, 1, 'init');
    const manor = [...ctx.state.items.values()].find((i) => i.chain === 'lumber' && i.tier === 4)!;
    const refused = capture(ctx.bus, 'generator:produce_refused');

    // Nothing in the purse yet — the roster is what the player actually holds.
    ctx.bus.emit('ui:produce_choice_requested', { itemId: manor.id, chain: 'coin', tier: 2 });
    expect(refused.at(-1)).toMatchObject({ reason: 'not_in_bag' });

    ctx.bus.emit('economy:add', { coins: POUCH_UNIT, reason: 'test' });
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
