import { describe, expect, it } from 'vitest';
import chainsData from '../../src/data/chains.json';
import ordersData from '../../src/data/orders.json';
import questsData from '../../src/data/quests.json';
import { CHEST_GIFTS, COLLECTIBLE_REWARD, LEVELUP_REWARD } from '../../src/core/Constants';
import type { ChainsData, OrdersData, QuestsData } from '../../src/core/types';

const chains = (chainsData as unknown as ChainsData).chains;
const quests = (questsData as unknown as QuestsData).quests;
const orders = (ordersData as unknown as OrdersData).orders;

/** A Gold Coin — the unit every Gold award is counted in. */
const UNIT = COLLECTIBLE_REWARD.coin!.coins;

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

  it('a Pouch is worth exactly the Coins it was merged from', () => {
    // The Manor's product is three Coins joined. Paying less than three Coins
    // for it would make the one merge the Manor exists to feed lose money.
    const coin = chains.find((c) => c.id === 'coin')!;
    const group = coin.tiers.find((t) => t.tier === 2)?.merge?.group ?? 3;
    expect(COLLECTIBLE_REWARD.coin_2!.coins).toBe(UNIT * group);
  });

  it('collecting and selling a Coin are worth the same', () => {
    // A coin banked in the Bag (the board was full when it dropped) and a coin
    // tapped on the board are the same money — a Sell price below the collect
    // value is a trap the player cannot see before taking it.
    const coin = chains.find((c) => c.id === 'coin')!;
    for (const tier of coin.tiers) {
      const collected = COLLECTIBLE_REWARD[`coin_${tier.tier}`] ?? COLLECTIBLE_REWARD.coin;
      expect(tier.sell, `coin t${tier.tier} sells for less than it collects`).toBe(collected!.coins);
    }
  });
});
