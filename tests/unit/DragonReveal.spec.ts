import { describe, expect, it } from 'vitest';
import chainsJson from '../../src/data/chains.json';
import assetsJson from '../../src/data/assets.json';
import { DRAGON_REVEAL } from '../../src/core/Constants';
import type { ChainsData } from '../../src/core/types';

/**
 * EVERY DRAGON GETS ITS CARD, AND EVERY CARD GETS ITS DRAGON.
 *
 * RevealSystem asks `DRAGON_REVEAL` and nothing else, so a breed missing from
 * that table hatches in silence — no card, no name, no epithet. Nothing looks
 * broken; there is simply no ceremony, which is why "the frost dragon's reveal
 * never happens" survived so long. `reveal_frost` and `reveal_frost_adult` had
 * shipped in assets.json the whole time; the four lines that hang them had not
 * been written.
 *
 * Both directions are checked, because both failures are silent:
 *   • a hatching tier with no card is a beat the player never gets;
 *   • a card naming art that does not exist is a magenta plate at the one
 *     moment the game is asking to be looked at.
 */
const chains = chainsJson as unknown as ChainsData;
const artKeys = new Set(
  (JSON.stringify(assetsJson).match(/"key":\s*"(reveal_[a-z_]+)"/g) ?? []).map((m) =>
    m.replace(/.*"(reveal_[a-z_]+)".*/, '$1')
  )
);

describe('the reveal roster', () => {
  it('gives every hatching chain a card at the tier it hatches', () => {
    for (const chain of chains.chains) {
      if (chain.hatchAtTier === undefined) continue;
      const key = `${chain.id}:${chain.hatchAtTier}`;
      expect(DRAGON_REVEAL[key], `${chain.id} hatches at t${chain.hatchAtTier} with no card`).toBeTruthy();
    }
  });

  it('gives every card art that actually ships', () => {
    for (const [key, card] of Object.entries(DRAGON_REVEAL)) {
      expect(artKeys, `${key} names missing art "${card.art}"`).toContain(card.art);
    }
  });

  it('names a real chain and a real tier for every card', () => {
    for (const key of Object.keys(DRAGON_REVEAL)) {
      const [id, tierText] = key.split(':');
      const chain = chains.chains.find((c) => c.id === id);
      expect(chain, `${key} names no chain`).toBeTruthy();
      const tier = Number(tierText);
      expect(chain!.tiers.some((t) => t.tier === tier), `${key} names no such tier`).toBe(true);
    }
  });

  it('says something in the epithet, and does not repeat a name', () => {
    const names = Object.values(DRAGON_REVEAL).map((c) => c.name);
    expect(new Set(names).size, 'two cards share a name').toBe(names.length);
    for (const [key, card] of Object.entries(DRAGON_REVEAL)) {
      expect(card.epithet.length, `${key} has no epithet`).toBeGreaterThan(10);
    }
  });
});
