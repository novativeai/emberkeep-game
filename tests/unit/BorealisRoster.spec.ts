import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HIDDEN_CHAINS, ITEM_SCALE } from '../../src/core/Constants';
import assetsDoc from '../../src/data/assets.json';
import chainsDoc from '../../src/data/chains.json';
import type { ChainsData } from '../../src/core/types';
import { axisOf, isDragonFood, isMageMaterial } from '../../src/systems/DragonSystem';

const ROOT = path.resolve(__dirname, '../..');
const chains = (chainsDoc as unknown as ChainsData).chains;
const keys = new Map(
  assetsDoc.images.filter((i) => i.source === 'file').map((i) => [i.key, i.file as string])
);

/**
 * The five farms added to break the north's value monoculture — and, since the
 * redraw, its SHAPE monoculture. A heap of wood, a heap of crystals and a heap
 * of salt are all the same kind of thing; these five are made objects a player
 * can name from across the board: a runestone, a bottle, a lamp, a cairn, a
 * compass.
 */
const NEW_FARMS = ['runestone', 'emberdram', 'hearthlamp', 'manastone', 'wayfinder'];

/**
 * Composited over the Borealis backdrop at their real on-board scale, the
 * north's shipped pieces sit in a narrow band of pale desaturated blue — the
 * same band as the ice they stand on — and only `tarknot` escapes it, by being
 * much darker. That is measurable, so it is a test rather than an opinion:
 *
 *   THE ICE BAND: saturation 0.30–0.51 AND value 0.54–0.78.
 *
 * A piece escapes by being saturated (≥0.55), dark (≤0.52) or bright (≥0.80).
 */
const ICE = { satMax: 0.55, darkMax: 0.52, brightMin: 0.8 };
/**
 * The pieces that predate the rule. Named rather than skipped, because the list
 * IS the problem the rule exists to stop growing — every one of them is a pale
 * blue-white object on pale blue-white ground.
 */
const GRANDFATHERED = new Set([
  'driftwood', 'keel', 'rimebloom', 'wrackline', 'frostfont', 'frostsilk', 'rimewyrm'
]);

/** Mean saturation/value of a webp's opaque pixels, straight off the file. */
function meanHsv(file: string): { sat: number; val: number } {
  // Decoding a webp without a browser needs a real codec, so this leans on the
  // measurement the cut step already wrote out rather than re-deriving it.
  const meta = path.join(ROOT, 'assets/raw/merge-chains/borealis/colour-check.json');
  const table = JSON.parse(readFileSync(meta, 'utf8')) as Record<string, [number, number]>;
  const hit = table[file];
  if (!hit) throw new Error(`no colour measurement for ${file} — re-run gen-borealis-chains.py cut`);
  return { sat: hit[0], val: hit[1] };
}

describe('the Borealis roster', () => {
  it('every northern chain has art on disk for every tier', () => {
    for (const chain of chains.filter((c) => c.world === 'borealis')) {
      for (const tier of chain.tiers) {
        const key = `item_${chain.id}_${tier.tier}`;
        const file = keys.get(key);
        expect(file, `${key} not registered`).toBeTruthy();
        expect(existsSync(path.join(ROOT, 'assets', file!)), `${file} missing`).toBe(true);
      }
    }
  });

  it('each new farm is a 3-tier chain whose tier 3 works for you', () => {
    for (const id of NEW_FARMS) {
      const chain = chains.find((c) => c.id === id)!;
      expect(chain, `${id} missing`).toBeTruthy();
      expect(chain.world).toBe('borealis');
      expect(chain.tiers).toHaveLength(3);
      const gen = chain.tiers[2]!.generator;
      expect(gen, `${id} tier 3 is not a generator`).toBeTruthy();
      // A generator either hands you an item or pays you something.
      expect(Boolean(gen!.produces) || Boolean(gen!.reward), `${id} produces nothing`).toBe(true);
      for (const tier of chain.tiers) {
        expect(ITEM_SCALE[`${id}_${tier.tier}`], `${id}_${tier.tier} has no scale`).toBeGreaterThan(0);
      }
    }
  });

  it('no new northern piece disappears into the ice it stands on', () => {
    for (const id of NEW_FARMS) {
      for (const tier of [1, 2, 3]) {
        const { sat, val } = meanHsv(`${id}_${tier}`);
        const escapes = sat >= ICE.satMax || val <= ICE.darkMax || val >= ICE.brightMin;
        expect(
          escapes,
          `${id}_${tier} sits in the ice band (sat ${sat.toFixed(2)}, val ${val.toFixed(2)}) — ` +
            'it must be saturated, dark or bright enough to read against pale blue-white'
        ).toBe(true);
      }
    }
  });

  it('the grandfathered pale roster is exactly what we think it is', () => {
    // If a chain leaves this set it should be because it was REDRAWN, and the
    // rule above then applies to it. This keeps the list from quietly growing.
    const northern = new Set(chains.filter((c) => c.world === 'borealis').map((c) => c.id));
    for (const id of GRANDFATHERED) expect(northern, `${id} is not northern`).toContain(id);
    for (const id of NEW_FARMS) expect(GRANDFATHERED.has(id), `${id} is not old art`).toBe(false);
  });

  it("Selyna's materials are recipient-locked, and never dragon food", () => {
    // merge-chains §1.5: what belongs to a named character is hers end to end.
    for (const id of ['frostsilk', 'manastone', 'wayfinder']) {
      expect(isMageMaterial(id), `${id} is not locked to her`).toBe(true);
      expect(isDragonFood(id, 3), `${id} feeds a dragon`).toBe(false);
      expect(axisOf(id, 3), `${id} has a diet axis`).toBeNull();
    }
  });

  it('emberdram is the north\'s second fuel, and it is reachable there', () => {
    // Without a second fuel up here a dragon that refuses `tarknot` is stranded,
    // and a refusal nothing in the game can fix is a permanent bad condition.
    expect(axisOf('emberdram', 1)).toBe('fuel');
    expect(chains.find((c) => c.id === 'emberdram')!.world).toBe('borealis');
  });

  it('every new northern piece is a made object, not another pile', () => {
    // The redraw's actual brief: each tier-3 owns a silhouette no other piece on
    // either board owns, so no two of them can be confused at icon size.
    const t3 = NEW_FARMS.map((id) => chains.find((c) => c.id === id)!.tiers[2]!.name);
    expect(new Set(t3).size).toBe(NEW_FARMS.length);
    expect(t3).toEqual(['Runestone', 'Cordial Cask', 'Hearthlamp', 'Manastone Cairn', 'The Wayfinder']);
  });

  it('the new farms stay out of the Cookbook until their seeds are placed', () => {
    // They have working generators but no authored tier-1 source yet, and an
    // unreachable row is a completion counter the player can never finish.
    for (const id of NEW_FARMS) expect(HIDDEN_CHAINS.has(id), `${id} is reachable?`).toBe(true);
  });
});
