import packsJson from '../data/coin-packs.json';
import { iapBridge } from './iapBridge';
import type { CoinOffer, CoinPacksData } from './types';

/**
 * WHAT A GOLD SHELF SELLS — resolved in ONE place, for every surface.
 *
 * The Emporium's GOLD tab is the only coin shop in the game, but it is no
 * longer the only thing that has to KNOW about coin packs: the shortfall
 * notice sends the player there, and the day the notice starts naming a pack
 * it must name the same one the shelf is about to show. They must agree about
 * which packs exist, what they cost, what currency the price is in, and (the
 * load-bearing one) what a tap DOES when there is no gateway. Two answers to
 * that last question is worse than either answer, so the rule lives here:
 *
 *   gateway present   `iapBridge.coinPacks()` — real packs, real EUR prices,
 *                     each carrying a `packId`, so a tap goes to the checkout.
 *   embedded, no      nothing yet — the hub's catalog is on its way, and a
 *   catalog yet       showcase row shown there would be a free-Gold button in
 *                     the one build that has real buyers (`Loading packs…`).
 *   standalone        the authored showcase (`src/data/coin-packs.json`) — no
 *                     `packId` at all, so a tap can only take `offerTap`'s
 *                     mock path, and that path exists only on a DEV build.
 *
 * THE TEST IS `isAvailable()`, NOT "the coin list came back empty", and the
 * difference is money. `isAvailable()` asks whether there is a HUB — a live
 * catalog of any shape. `coinPacks()` asks a narrower question, and a real hub
 * that happens to sell only a Warmth pack answers it with `[]`. Keying the
 * fallback on that emptiness would put a REAL-gateway build onto the standalone
 * path and hand out the showcase's Gold for a tap. So a live hub with no coin
 * packs sells no coin packs — an empty shelf, which the Emporium says out loud
 * — and only a build with no hub at all falls back to the showcase.
 *
 * The showcase is PLACEHOLDER content: on a dev server or the e2e preview there
 * is no parent page and nothing to charge anyone with, and that is the build
 * the owner actually runs. Its prices used to be `$` strings buried in a UI
 * file while the hub's arrived in EUR; they are EUR numbers in data now,
 * formatted by `priceOf` — the same function the hub's packs go through, so the
 * two sources cannot print differently even if someone edits one of them.
 */

const SHOWCASE = (packsJson as CoinPacksData).showcase;

/** The one price format. EUR; whole euros print bare; the dot stays the decimal
 *  separator — `bonusPercent` in the Emporium parses a price back out of this
 *  string, so the separator is part of the contract, not a style choice.
 *  Identical to the hub's `formatEur`. */
export function priceOf(amountEur: number): string {
  return Number.isInteger(amountEur) ? `€${amountEur}` : `€${amountEur.toFixed(2)}`;
}

/** The authored showcase, as offers. No `packId`: see the note above. */
export function showcaseOffers(): CoinOffer[] {
  return SHOWCASE.map((pack) => ({
    name: pack.name,
    coins: pack.coins,
    price: priceOf(pack.amountEur),
    ...(pack.unlimitedWarmthMs ? { unlimitedWarmthMs: pack.unlimitedWarmthMs } : {}),
    ...(pack.energy ? { energy: pack.energy } : {}),
    best: pack.best
  }));
}

/** The hub's real coin packs, as offers. Empty when the hub sells none. */
export function hubOffers(): CoinOffer[] {
  const packs = iapBridge.coinPacks();
  if (packs.length === 0) return [];
  // The hub authors no highlight and none is derived (no nudge toward the
  // dearest pack): `best` is never set on a real pack.
  return packs.map((pack) => ({
    name: pack.name,
    coins: pack.coins,
    price: priceOf(pack.amountEur),
    packId: pack.id,
    unlimitedWarmthMs: pack.unlimitedWarmthMs,
    energy: pack.energy
  }));
}

/** What the gold shelf sells RIGHT NOW. Every surface asks this and nothing
 *  else — and an empty answer is a real answer (see the note above). */
export function coinOffers(): CoinOffer[] {
  if (iapBridge.isAvailable()) return hubOffers();
  return iapBridge.isEmbedded() ? [] : showcaseOffers(); // embedded, catalog not in yet → nothing to tap
}

export type OfferTap = 'checkout' | 'mock' | 'unavailable';

/** A showcase row hands out Gold ONLY on a dev build; production has nothing to charge. */
export function offerTap(offer: Pick<CoinOffer, 'packId'>, dev: boolean): OfferTap {
  return offer.packId ? 'checkout' : dev ? 'mock' : 'unavailable';
}
