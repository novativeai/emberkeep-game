import { describe, expect, it } from 'vitest';

import chainsDoc from '../../src/data/chains.json';
import eggAuraDoc from '../../src/data/egg-aura.json';
import presetDoc from '../../src/data/fx-emitters.json';
import {
  AURA_PALETTE_STOPS,
  auraInstanceFor,
  auraKey,
  validateEggAuraFile,
  type EggAuraFile
} from '../../src/render/fx/eggAura';
import { validatePresetFile, type FxPresetFile, type PuffLayer } from '../../src/render/fx/emitterTypes';

const DOC = eggAuraDoc as unknown as EggAuraFile;
const PRESETS = presetDoc as unknown as FxPresetFile;
const CHAINS = chainsDoc as unknown as {
  chains: { id: string; legendary?: boolean; tiers: { tier: number; id: string }[] }[];
};

const ITEM_IDS = CHAINS.chains.flatMap((c) => c.tiers.map((t) => t.id));
const PRESET_IDS = Object.keys(PRESETS.presets);

describe('egg-aura.json', () => {
  it('validates', () => {
    expect(validateEggAuraFile(DOC, PRESET_IDS, ITEM_IDS)).toEqual([]);
  });

  it('gives every legendary dragon\'s egg the full-weight aura', () => {
    // A new legendary chain with no aura would ship a story object that looks
    // like any other piece on the board. Fail here instead.
    const legendaries = CHAINS.chains.filter((c) => c.legendary);
    expect(legendaries.length).toBeGreaterThan(0);
    for (const c of legendaries) {
      const egg = auraKey(c.id, 1);
      expect(DOC.eggs[egg], `${c.id} tier 1`).toBeDefined();
      expect(DOC.eggs[egg].weight, `${c.id} is legendary`).toBe(1);
    }
  });

  it('gives the ordinary chain eggs exactly half', () => {
    for (const id of ['ember_dragon_2', 'emerald_2']) {
      expect(DOC.eggs[id], id).toBeDefined();
      expect(DOC.eggs[id].weight, id).toBe(0.5);
    }
  });

  it('never dresses a non-legendary egg as heavily as a legendary', () => {
    const legendaryIds = new Set(CHAINS.chains.filter((c) => c.legendary).map((c) => auraKey(c.id, 1)));
    for (const [id, e] of Object.entries(DOC.eggs)) {
      if (!legendaryIds.has(id)) expect(e.weight, id).toBeLessThan(1);
    }
  });

  it('colours each egg from its own art', () => {
    for (const [id, e] of Object.entries(DOC.eggs)) {
      expect(e.palette, id).toHaveLength(AURA_PALETTE_STOPS);
      for (const hex of e.palette) expect(hex, id).toMatch(/^#[0-9A-F]{6}$/i);
    }
    // Two eggs sharing a palette means one of them is wearing the other's
    // dragon — the whole point is that the aura identifies the sleeper.
    const seen = Object.values(DOC.eggs).map((e) => e.palette.join(','));
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe('auraInstanceFor', () => {
  it('is neutral at full weight', () => {
    expect(auraInstanceFor(1)).toEqual({ rate: 1, alpha: 1, widthScale: 1, heightScale: 1 });
  });

  it('halves the density and the weight at half weight', () => {
    const half = auraInstanceFor(0.5);
    expect(half.rate).toBe(0.5);
    expect(half.alpha).toBe(0.5);
  });

  it('does NOT halve the size', () => {
    // A half-size aura reads as a smaller egg rather than a lesser one.
    const half = auraInstanceFor(0.5);
    expect(half.widthScale).toBeGreaterThan(0.7);
    expect(half.widthScale).toBeLessThan(1);
    expect(half.heightScale).toBe(half.widthScale);
  });

  it('is monotonic and clamped', () => {
    expect(auraInstanceFor(0).rate).toBe(0);
    expect(auraInstanceFor(2).rate).toBe(1);
    expect(auraInstanceFor(0.25).alpha).toBeLessThan(auraInstanceFor(0.75).alpha);
  });
});

describe('the eggAura preset', () => {
  const preset = PRESETS.presets.eggAura;

  it('is a valid preset file', () => {
    expect(validatePresetFile(PRESETS)).toEqual([]);
  });

  it('exists and is the one the table names', () => {
    expect(preset).toBeDefined();
    expect(DOC.preset).toBe('eggAura');
  });

  it('takes ALL of its colour from the instance palette', () => {
    // Any layer carrying its own hard-coded tint would stay that colour on
    // every dragon, which defeats one-preset-many-eggs silently.
    const coloured = preset.layers.filter((l) => 'tint' in l || 'color' in l || l.kind === 'particles');
    expect(coloured.length).toBeGreaterThan(0);
    for (const l of coloured) {
      expect(l.palette, `layer "${l.id}" must read the palette`).toBeDefined();
      expect((l as { tint?: string }).tint, `layer "${l.id}" must not hard-code a tint`).toBeUndefined();
    }
  });

  it('lays its smoke ON THE SURFACE rather than in a column', () => {
    const puffs = preset.layers.filter((l): l is PuffLayer => l.kind === 'puffs');
    expect(puffs.length, 'the effect is smoke-led').toBeGreaterThan(0);
    for (const p of puffs) {
      // Squashed onto the iso ground plane…
      expect(p.squash, `${p.id} squash`).toBeLessThan(0.6);
      // …barely climbing…
      expect(p.risePx[1], `${p.id} rise`).toBeLessThan(40);
      // …and spreading wider than it rises. That inequality IS "surface smoke".
      expect(p.width[1], `${p.id} spread`).toBeGreaterThan(p.risePx[1] * 4);
    }
  });

  it('is heavy and dense', () => {
    const puffs = preset.layers.filter((l): l is PuffLayer => l.kind === 'puffs');
    const pool = puffs.reduce((n, p) => n + p.pool, 0);
    expect(pool, 'total puff pool').toBeGreaterThanOrEqual(24);
    // Release faster than the other emitters' smoke (620–900ms) — that gap is
    // the difference between a wisp and a bank of it.
    expect(Math.min(...puffs.map((p) => p.releaseMs[0]))).toBeLessThan(300);
  });

  it('keeps the ground pool under the egg and the motes over it', () => {
    const z = (id: string): number => preset.layers.find((l) => l.id === id)!.z;
    expect(z('groundPool')).toBeLessThan(0);
    expect(z('motes')).toBeGreaterThan(0);
  });
});
