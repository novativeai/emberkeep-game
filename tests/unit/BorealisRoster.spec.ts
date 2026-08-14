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
const byId = new Map(chains.map((c) => [c.id, c]));
const keys = new Map(
  assetsDoc.images.filter((i) => i.source === 'file').map((i) => [i.key, i.file as string])
);

/**
 * THE FARM STRUCTURE — six pieces, and every northern farm has all six:
 *
 *   FIXTURE chain   part -> assembly -> THE MACHINE   (tier 3 is the generator)
 *   PRODUCT chain   small -> bigger  -> THE ICON      (what it makes)
 *
 * The machine produces the product's tier 1 on its cooldown, and every TWELFTH
 * production also drops the fixture's OWN tier 1 — so a working farm slowly
 * pays out the parts for a second farm, and three parts merge to an assembly,
 * three assemblies to a whole new machine. That loop is the only way the north
 * grows a generator, which is why a fixture ladder is two tiers and not one.
 */
const BONUS_EVERY = 12;
const FARMS: Array<[fixture: string, product: string]> = [
  ['glasskiln', 'seaglass'],
  ['starbench', 'orrery'],
  ['wreckforge', 'warhelm'],
  ['tarkiln', 'emberheart'],
  ['auroraloom', 'auroraweave'],
];
/**
 * The compass wave — the five that were already fixture-shaped and kept their
 * jobs. Each is a two-tier ladder under a generator, and each is now pointed at
 * one of the product chains above instead of at itself.
 */
const COMPASS: Array<[fixture: string, product: string | null]> = [
  ['runestone', 'emberheart'],
  ['emberdram', 'seaglass'],
  ['manastone', 'orrery'],
  // The two documented exceptions: `reward` short-circuits `produces` in
  // GeneratorSystem, so a machine either makes a thing or pays a currency, never
  // both. These two are the north's ONLY energy pump and its ONLY coin pump, so
  // they keep paying and take just the self-seed half of the structure.
  ['wayfinder', 'coin'],
  ['hearthlamp', null],
];

/**
 * Composited over the Borealis backdrop at their real on-board scale, the
 * north's original pieces sat in a narrow band of pale desaturated blue — the
 * same band as the ice they stand on. That is measurable, so it is a test
 * rather than an opinion:
 *
 *   THE ICE BAND: saturation 0.30–0.51 AND value 0.54–0.78.
 *
 * A piece escapes by being saturated (≥0.55), dark (≤0.52) or bright (≥0.80).
 */
const ICE = { satMax: 0.55, darkMax: 0.52, brightMin: 0.8 };
/**
 * What is left of the pale roster. Named rather than skipped, because the list
 * IS the problem the rule exists to stop growing — and it is now one dragon,
 * whose art comes off the breed pipeline rather than a chain sheet.
 */
const GRANDFATHERED = new Set(['rimewyrm']);

/** Mean saturation/value of a webp's opaque pixels, straight off the file. */
function meanHsv(file: string): { sat: number; val: number } {
  // Decoding a webp without a browser needs a real codec, so this leans on the
  // measurement the cut step already wrote out rather than re-deriving it.
  const meta = path.join(ROOT, 'assets/raw/merge-chains/borealis/colour-check.json');
  const table = JSON.parse(readFileSync(meta, 'utf8')) as Record<string, [number, number]>;
  const hit = table[file];
  if (!hit) throw new Error(`no colour measurement for ${file} — re-run gen-borealis-farms.py cut`);
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

  it('every farm is SIX pieces: a three-tier machine and a three-tier product', () => {
    for (const [fixtureId, productId] of FARMS) {
      const fixture = byId.get(fixtureId);
      const product = byId.get(productId);
      expect(fixture, `${fixtureId} missing`).toBeTruthy();
      expect(product, `${productId} missing`).toBeTruthy();
      expect(fixture!.tiers, `${fixtureId} is not a 3-tier ladder`).toHaveLength(3);
      expect(product!.tiers, `${productId} is not a 3-tier ladder`).toHaveLength(3);
      // Six pieces, and every one of them has a scale — an unscaled piece
      // renders at its authored 6x size and swallows the board.
      for (const c of [fixture!, product!]) {
        for (const t of c.tiers) {
          expect(ITEM_SCALE[`${c.id}_${t.tier}`], `${c.id}_${t.tier} has no scale`)
            .toBeGreaterThan(0);
        }
      }
      // Only the machine works. A product tier that generated would let the
      // player skip building the farm the whole structure exists to sell.
      expect(fixture!.tiers[0]!.generator, `${fixtureId} t1 generates`).toBeUndefined();
      expect(fixture!.tiers[1]!.generator, `${fixtureId} t2 generates`).toBeUndefined();
      for (const t of product!.tiers) {
        expect(t.generator, `${productId} t${t.tier} generates`).toBeUndefined();
      }
    }
  });

  it('every machine makes its product, and seeds its own replacement every 12', () => {
    for (const [fixtureId, productId] of [...FARMS, ...COMPASS]) {
      const gen = byId.get(fixtureId)!.tiers.at(-1)!.generator;
      expect(gen, `${fixtureId} tier 3 is not a generator`).toBeTruthy();
      if (productId) {
        expect(gen!.produces, `${fixtureId} produces nothing`).toEqual({
          chain: productId,
          tier: 1,
        });
      } else {
        // The documented exception pays a currency instead.
        expect(gen!.reward, `${fixtureId} neither produces nor pays`).toBeTruthy();
      }
      // The sub-generator drop — the whole reason a fixture has a ladder.
      expect(gen!.bonus?.every, `${fixtureId} has no every-${BONUS_EVERY} drop`)
        .toBe(BONUS_EVERY);
      expect(gen!.bonus?.produces, `${fixtureId}'s drop does not build a ${fixtureId}`)
        .toEqual({ chain: fixtureId, tier: 1 });
    }
  });

  it('no northern piece disappears into the ice it stands on', () => {
    for (const chain of chains.filter((c) => c.world === 'borealis')) {
      if (GRANDFATHERED.has(chain.id)) continue;
      for (const { tier } of chain.tiers) {
        const { sat, val } = meanHsv(`${chain.id}_${tier}`);
        const escapes = sat >= ICE.satMax || val <= ICE.darkMax || val >= ICE.brightMin;
        expect(
          escapes,
          `${chain.id}_${tier} sits in the ice band (sat ${sat.toFixed(2)}, val ${val.toFixed(2)}) — ` +
            'it must be saturated, dark or bright enough to read against pale blue-white'
        ).toBe(true);
      }
    }
  });

  it('the grandfathered pale roster is exactly what we think it is', () => {
    // A northern chain is measured or it is named here, never quietly neither.
    const northern = new Set(chains.filter((c) => c.world === 'borealis').map((c) => c.id));
    for (const id of GRANDFATHERED) expect(northern, `${id} is not northern`).toContain(id);
    const accounted = new Set([
      ...FARMS.flat(),
      ...COMPASS.map(([f]) => f),
      ...GRANDFATHERED,
    ]);
    for (const id of northern) expect(accounted, `${id} is in neither list`).toContain(id);
  });

  it("Selyna's materials are recipient-locked, and never dragon food", () => {
    // merge-chains §1.5: what belongs to a named character is hers end to end.
    for (const id of ['auroraweave', 'manastone', 'wayfinder']) {
      expect(isMageMaterial(id), `${id} is not locked to her`).toBe(true);
      expect(isDragonFood(id, 3), `${id} feeds a dragon`).toBe(false);
      expect(axisOf(id, 3), `${id} has a diet axis`).toBeNull();
    }
  });

  it('emberdram is the north\'s second fuel, and it is reachable there', () => {
    // Without a second fuel up here a dragon that refuses `emberheart` is
    // stranded, and a refusal nothing in the game can fix is a permanent bad
    // condition.
    expect(axisOf('emberdram', 1)).toBe('fuel');
    expect(axisOf('emberheart', 1)).toBe('fuel');
    expect(byId.get('emberdram')!.world).toBe('borealis');
  });

  it('every northern tier-3 is an object you can name, and no two are the same', () => {
    // The brief the whole roster was rebuilt against: each top tier owns a
    // silhouette no other piece owns, so no two can be confused at icon size.
    const t3 = chains
      .filter((c) => c.world === 'borealis' && !GRANDFATHERED.has(c.id))
      .map((c) => c.tiers.at(-1)!.name);
    expect(new Set(t3).size, 'two northern tier-3s share a name').toBe(t3.length);
    expect(new Set(t3)).toEqual(
      new Set([
        'The Glass Kiln', 'The Bottled Ship',
        "The Starwright's Bench", 'The Orrery',
        'The Wreck Forge', 'The Horned Helm',
        'The Tar Kiln', 'The Ember Heart',
        'The Aurora Loom', 'The Aurora Cloak',
        'Runestone', 'Cordial Cask', 'Hearthlamp', 'Manastone Cairn', 'The Wayfinder',
      ])
    );
  });

  it('every farm stands on the board, and every Cookbook row is finishable', () => {
    for (const [fixtureId, productId] of FARMS) {
      expect(HIDDEN_CHAINS.has(fixtureId), `${fixtureId} still hidden?`).toBe(false);
      expect(HIDDEN_CHAINS.has(productId), `${productId} still hidden?`).toBe(false);
    }

    const zones = JSON.parse(
      readFileSync(path.join(ROOT, 'src/data/zones.json'), 'utf8')
    ) as { worlds: Array<{ id: string; map?: { regions: Array<{ contents?: Array<{ chain: string; tier: number }> }> } }> };
    const north = zones.worlds.find((w) => w.id === 'borealis')!;
    const seeded = new Map<string, number>();
    for (const r of north.map!.regions) {
      for (const c of r.contents ?? []) {
        seeded.set(`${c.chain}:${c.tier}`, (seeded.get(`${c.chain}:${c.tier}`) ?? 0) + 1);
      }
    }
    // Every machine stands somewhere READY-BUILT. A farm that had to be built
    // before it could pay out its own build parts is a farm nobody ever gets.
    for (const [fixtureId] of FARMS) {
      expect(seeded.get(`${fixtureId}:3`) ?? 0, `${fixtureId} stands somewhere?`)
        .toBeGreaterThanOrEqual(1);
    }
    // Self-reseeding compass farms likewise stand ready-built.
    for (const id of ['runestone', 'emberdram', 'manastone']) {
      expect(seeded.get(`${id}:3`) ?? 0, `${id}:3 stands somewhere?`).toBeGreaterThanOrEqual(1);
    }
    // The lamp and the compass never reseed a tier-1, so they arrive as parts:
    // 3 × t1 + 2 × t2 is exactly one build with both rows discovered en route.
    for (const id of ['hearthlamp', 'wayfinder']) {
      expect(seeded.get(`${id}:1`) ?? 0, `${id} t1 parts?`).toBeGreaterThanOrEqual(3);
      expect(seeded.get(`${id}:2`) ?? 0, `${id} t2 parts?`).toBeGreaterThanOrEqual(2);
    }
  });
});
