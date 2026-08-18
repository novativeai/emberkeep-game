import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOP_UP } from '../../src/core/Constants';
import packsDoc from '../../src/data/coin-packs.json';
import type { CoinPacksData, IapPackInfo, TopUpSource } from '../../src/core/types';

/**
 * The bridge is a singleton whose catalog only arrives over `postMessage`, so
 * the two questions this module routes on are stubbed directly. They are
 * DIFFERENT questions and the whole point of these tests is that they stay so:
 *
 *   isAvailable()  is there a hub at all?
 *   coinPacks()    does that hub sell coins?
 */
const bridge = {
  available: false,
  packs: [] as IapPackInfo[],
  isAvailable(): boolean {
    return bridge.available;
  },
  coinPacks(): IapPackInfo[] {
    return bridge.packs;
  }
};
vi.mock('../../src/core/iapBridge', () => ({ iapBridge: bridge }));

const pack = (id: string, coins: number, amountEur: number): IapPackInfo => ({
  id,
  name: id,
  blurb: '',
  amountEur,
  coins,
  keys: 0,
  energy: 0
});

// Imported after the mock is registered (vi.mock is hoisted, but the module
// graph is still resolved lazily here for clarity).
const { coinOffers, priceOf, showcaseOffers } = await import('../../src/core/coinPacks');

describe('coin packs — one source of truth, and the gateway test', () => {
  beforeEach(() => {
    bridge.available = false;
    bridge.packs = [];
  });

  it('standalone: the shelf is the authored showcase, priced in EUR, id-less', () => {
    const offers = coinOffers();
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      expect(offer.price.startsWith('€')).toBe(true);
      // No `packId` means a tap CANNOT reach a checkout — which is the only
      // thing that makes the mock grant safe.
      expect(offer.packId).toBeUndefined();
    }
  });

  it('a live hub replaces the showcase entirely, and every row can be bought', () => {
    bridge.available = true;
    bridge.packs = [pack('coin_small', 200, 2.99), pack('coin_big', 900, 9.99)];

    const offers = coinOffers();
    expect(offers.map((o) => o.packId)).toEqual(['coin_small', 'coin_big']);
    expect(offers.map((o) => o.price)).toEqual(['€2.99', '€9.99']);
    // The highlight is DERIVED (the hub authors no "popular" flag) and lands on
    // the biggest pack.
    expect(offers.find((o) => o.best)?.packId).toBe('coin_big');
  });

  /**
   * THE ONE THAT COSTS MONEY.
   *
   * A live hub that happens to sell only a Warmth pack has `isAvailable()` true
   * and `coinPacks()` empty. Routing the fallback on that emptiness would drop
   * a REAL-gateway build onto the standalone path and hand out 200/900/2100
   * Gold for a tap. An empty gold shelf is the correct answer.
   */
  it('a live hub that sells no coin packs sells NO coin packs (never the free showcase)', () => {
    bridge.available = true;
    bridge.packs = []; // it sells Warmth only

    expect(coinOffers()).toEqual([]);
    // ...and the showcase is still there for the build that has no hub, so the
    // emptiness above is routing, not a missing file.
    expect(showcaseOffers().length).toBeGreaterThan(0);
  });

  it('both sources print through the same formatter', () => {
    expect(priceOf(2.99)).toBe('€2.99');
    expect(priceOf(20)).toBe('€20.00');
    // The Emporium's value badge parses the number back OUT of this string, so
    // the dot is contract, not style.
    expect(Number(priceOf(9.99).replace(/[^0-9.]/g, ''))).toBe(9.99);
  });

  it('the authored showcase is written down in EUR, once, with no ids to route on', () => {
    const doc = packsDoc as CoinPacksData;
    expect(doc.showcase.length).toBeGreaterThan(0);
    for (const row of doc.showcase) {
      expect(typeof row.amountEur).toBe('number');
      expect(row.amountEur).toBeGreaterThan(0);
      expect(row).not.toHaveProperty('id');
      expect(row).not.toHaveProperty('price');
    }
  });
});

describe('the shortfall notice — policy and geometry', () => {
  const SOURCES: TopUpSource[] = ['store', 'warmth', 'skip'];

  it('every named source has an explicit policy (a new one cannot appear silently)', () => {
    for (const source of SOURCES) expect(typeof TOP_UP.offer[source]).toBe('boolean');
    expect(Object.keys(TOP_UP.offer).sort()).toEqual([...SOURCES].sort());
  });

  it('the copy keeps the placeholders it is filled from', () => {
    expect(TOP_UP.copy.short).toContain('{n}');
    expect(TOP_UP.copy.short).toContain('{what}');
    expect(TOP_UP.copy.covered).toContain('{what}');
    // The answered wording must NOT still ask for a number.
    expect(TOP_UP.copy.covered).not.toContain('{n}');
  });

  /**
   * Node has no `window`, so `IS_MOBILE` is false and `TOP_UP.box` is the
   * LANDSCAPE branch — which is the one this can check. The portrait branch's
   * arithmetic is stated and checked in the `TOP_UP` note itself.
   */
  it('the landscape key row fits inside the plate it is drawn on', () => {
    const box = TOP_UP.box;
    const content = box.width - box.pad * 2;
    expect(box.keyPrimaryW + box.keyGap + box.keySecondaryW).toBeLessThanOrEqual(content);
    // The gloss strip is a strip, not a second face.
    expect(box.glossH).toBeLessThan(box.titleBox);
    expect(box.glossInset * 2).toBeLessThan(box.width);
  });
});
