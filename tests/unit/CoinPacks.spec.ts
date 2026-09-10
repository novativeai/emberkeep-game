import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOP_UP } from '../../src/core/Constants';
import packsDoc from '../../src/data/coin-packs.json';
import type { CoinPacksData, IapPackInfo, TopUpSource } from '../../src/core/types';

/**
 * The bridge is a singleton whose catalog only arrives over `postMessage`, so
 * the three questions this module routes on are stubbed directly. They are
 * DIFFERENT questions and the whole point of these tests is that they stay so:
 *
 *   isAvailable()  is there a hub catalog at all?
 *   isEmbedded()   is there a hub parent (whose catalog may still be coming)?
 *   coinPacks()    does that hub sell coins?
 */
const bridge = {
  available: false,
  embedded: false,
  packs: [] as IapPackInfo[],
  isAvailable(): boolean {
    return bridge.available;
  },
  isEmbedded(): boolean {
    return bridge.embedded;
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
  energy: 0,
  unlimitedWarmthMs: 0
});

// Imported after the mock is registered (vi.mock is hoisted, but the module
// graph is still resolved lazily here for clarity).
const { coinOffers, offerTap, priceOf, showcaseOffers } = await import('../../src/core/coinPacks');

describe('coin packs — one source of truth, and the gateway test', () => {
  beforeEach(() => {
    bridge.available = false;
    bridge.embedded = false;
    bridge.packs = [];
  });

  it('standalone: the shelf is the authored showcase, priced in EUR, id-less', () => {
    const offers = coinOffers();
    expect(offers.length).toBeGreaterThan(0);
    expect(offers).toEqual(showcaseOffers());
    for (const offer of offers) {
      expect(offer.price.startsWith('€')).toBe(true);
      // No `packId` means a tap CANNOT reach a checkout — and `offerTap` only
      // lets it grant on a DEV build.
      expect(offer.packId).toBeUndefined();
    }
  });

  it('embedded with no catalog yet: nothing to tap (never the showcase)', () => {
    bridge.embedded = true;
    expect(coinOffers()).toEqual([]);
  });

  it('a live hub replaces the showcase entirely, and every row can be bought', () => {
    bridge.available = true;
    bridge.embedded = true;
    bridge.packs = [
      pack('gold_pouch', 250, 2.5),
      pack('gold_chest', 1100, 10),
      { ...pack('hearth_hoard', 13000, 100), energy: 1250 }
    ];

    const offers = coinOffers();
    expect(offers.map((o) => o.packId)).toEqual(['gold_pouch', 'gold_chest', 'hearth_hoard']);
    expect(offers.map((o) => o.price)).toEqual(['€2.50', '€10', '€100']);
    expect(offers.map((o) => o.energy)).toEqual([0, 0, 1250]);
  });

  it('hub offers never set `best` — no nudge toward the dearest pack', () => {
    bridge.available = true;
    bridge.packs = [pack('gold_pouch', 250, 2.5), pack('hearth_hoard', 13000, 100)];
    for (const offer of coinOffers()) expect(offer.best).toBeFalsy();
  });

  /**
   * THE ONE THAT COSTS MONEY.
   *
   * A live hub that happens to sell only a Warmth pack has `isAvailable()` true
   * and `coinPacks()` empty. Routing the fallback on that emptiness would drop
   * a REAL-gateway build onto the standalone path and hand out the showcase's
   * Gold for a tap. An empty gold shelf is the correct answer.
   */
  it('a live hub that sells no coin packs sells NO coin packs (never the free showcase)', () => {
    bridge.available = true;
    bridge.embedded = true;
    bridge.packs = []; // it sells Warmth only

    expect(coinOffers()).toEqual([]);
    // ...and the showcase is still there for the build that has no hub, so the
    // emptiness above is routing, not a missing file.
    expect(showcaseOffers().length).toBeGreaterThan(0);
  });

  it('the showcase is the four tiers: ascending prices, never less Gold per euro, the Hoard last', () => {
    const rows = (packsDoc as CoinPacksData).showcase;
    expect(rows).toHaveLength(4);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.amountEur).toBeGreaterThan(rows[i - 1]!.amountEur);
      expect(rows[i]!.coins / rows[i]!.amountEur).toBeGreaterThanOrEqual(
        rows[i - 1]!.coins / rows[i - 1]!.amountEur
      );
    }
    expect(rows.at(-1)!.energy).toBe(1250);
    expect(showcaseOffers().at(-1)!.energy).toBe(1250);
    for (const row of rows) expect(row.best).toBeUndefined();
  });

  it('both sources print through the same formatter: whole euros bare, the dot as the decimal', () => {
    expect(priceOf(10)).toBe('€10');
    expect(priceOf(2.5)).toBe('€2.50');
    expect(priceOf(2.99)).toBe('€2.99');
    // The Emporium's value badge parses the number back OUT of this string, so
    // the dot is contract, not style.
    expect(Number(priceOf(9.99).replace(/[^0-9.]/g, ''))).toBe(9.99);
    expect(Number(priceOf(10).replace(/[^0-9.]/g, ''))).toBe(10);
  });

  it('offerTap: a real pack checks out; a showcase row grants only on a dev build', () => {
    expect(offerTap({ packId: 'x' }, false)).toBe('checkout');
    expect(offerTap({}, true)).toBe('mock');
    expect(offerTap({}, false)).toBe('unavailable');
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
