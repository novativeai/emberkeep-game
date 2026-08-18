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
 *   standalone        the authored showcase (`src/data/coin-packs.json`) — no
 *                     `packId` at all, so a tap can only take the mock path.
 *
 * THE TEST IS `isAvailable()`, NOT "the coin list came back empty", and the
 * difference is money. `isAvailable()` asks whether there is a HUB — a live
 * catalog of any shape. `coinPacks()` asks a narrower question, and a real hub
 * that happens to sell only a Warmth pack answers it with `[]`. Keying the
 * fallback on that emptiness would put a REAL-gateway build onto the standalone
 * path and hand out 200/900/2100 Gold for a tap. So a live hub with no coin
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

/** The one price format. EUR, two decimals, a dot — `bonusPercent` in the
 *  Emporium parses a price back out of this string, so the decimal separator
 *  is part of the contract, not a style choice. */
export function priceOf(amountEur: number): string {
  return `€${amountEur.toFixed(2)}`;
}

/** The authored showcase, as offers. No `packId`: see the note above. */
export function showcaseOffers(): CoinOffer[] {
  return SHOWCASE.map((pack) => ({
    name: pack.name,
    coins: pack.coins,
    price: priceOf(pack.amountEur),
    best: pack.best
  }));
}

/** The hub's real coin packs, as offers. Empty when the hub sells none. */
export function hubOffers(): CoinOffer[] {
  const packs = iapBridge.coinPacks();
  if (packs.length === 0) return [];
  // The hub authors no "most popular" flag, so the highlight goes to the
  // biggest pack — derived, and it moves on its own if the catalog changes.
  const biggest = Math.max(...packs.map((p) => p.coins));
  return packs.map((pack) => ({
    name: pack.name,
    coins: pack.coins,
    price: priceOf(pack.amountEur),
    packId: pack.id,
    best: packs.length > 1 && pack.coins === biggest
  }));
}

/** What the gold shelf sells RIGHT NOW. Every surface asks this and nothing
 *  else — and an empty answer is a real answer (see the note above). */
export function coinOffers(): CoinOffer[] {
  return iapBridge.isAvailable() ? hubOffers() : showcaseOffers();
}
