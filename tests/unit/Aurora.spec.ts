import { describe, expect, it } from 'vitest';

import auroraDoc from '../../src/data/aurora.json';
import {
  AURORA_QUALITY,
  costEstimate,
  RAMP_STOPS,
  validateAuroraFile,
  type AuroraPresetFile
} from '../../src/render/fx/auroraConfig';
import { TIER_ORDER } from '../../src/render/fx/emitterTypes';

const DOC = auroraDoc as unknown as AuroraPresetFile;

/** Band the Borealis world actually asks for: the top half of the canvas. */
const BAND_W = 2560;
const BAND_H = 800;

/**
 * The aurora's config, quality contract and cost model.
 *
 * The performance budget is the reason this file exists. "It is optimised" is a
 * claim; a test that fails when a tier stops being cheaper than the one above
 * it, or when the whole thing creeps past a fraction of the naive cost, is a
 * contract. The GPU-side checks live in tools/checks/auroratest.mjs.
 */
describe('aurora quality tiers', () => {
  it('covers every tier the FX layer can be in', () => {
    for (const tier of TIER_ORDER) expect(AURORA_QUALITY[tier]).toBeDefined();
  });

  it('gets strictly cheaper as the tier drops', () => {
    const order = ['high', 'medium', 'low'] as const;
    for (let i = 1; i < order.length; i++) {
      const better = AURORA_QUALITY[order[i - 1]];
      const worse = AURORA_QUALITY[order[i]];
      expect(worse.scale, `${order[i]} resolution`).toBeGreaterThanOrEqual(better.scale);
      expect(worse.fps, `${order[i]} rate`).toBeLessThanOrEqual(better.fps);
      expect(worse.maxOctaves, `${order[i]} detail`).toBeLessThanOrEqual(better.maxOctaves);
      // …and cheaper overall, not merely cheaper on one axis.
      expect(costEstimate(BAND_W, BAND_H, worse, 4).fragmentsPerSecond)
        .toBeLessThan(costEstimate(BAND_W, BAND_H, better, 4).fragmentsPerSecond);
    }
  });

  it('never re-renders while dozing', () => {
    expect(AURORA_QUALITY.off.fps).toBe(0);
  });

  it('never reallocates the render target on a governor transition', () => {
    // active ↔ idle is the ONLY tier change that happens at runtime, and
    // `pointermove` is a wake source — a drifting cursor would otherwise
    // destroy and rebuild a ~0.9MB GPU texture every few seconds, forever.
    // Same resolution ⇒ AuroraFX.setTier skips resizeTarget() entirely.
    expect(AURORA_QUALITY.medium.scale).toBe(AURORA_QUALITY.high.scale);
    // …and the tier must still be cheaper, just on the other two axes.
    expect(AURORA_QUALITY.medium.fps).toBeLessThan(AURORA_QUALITY.high.fps);
    expect(AURORA_QUALITY.medium.maxOctaves).toBeLessThan(AURORA_QUALITY.high.maxOctaves);
  });

  it('renders below full resolution at every tier', () => {
    // Full-resolution would defeat the entire design.
    for (const tier of TIER_ORDER) expect(AURORA_QUALITY[tier].scale).toBeGreaterThan(1);
  });

  it('re-renders slowly enough to be cheap and often enough to look continuous', () => {
    // Below ~8/s the surge starts to step; above ~30/s is spending for nothing
    // on a field that takes tens of seconds to fold.
    for (const tier of ['high', 'medium', 'low'] as const) {
      expect(AURORA_QUALITY[tier].fps).toBeGreaterThanOrEqual(8);
      expect(AURORA_QUALITY[tier].fps).toBeLessThanOrEqual(30);
    }
  });
});

describe('costEstimate', () => {
  it('reports the naive full-res every-frame version as 1.0', () => {
    const naive = { scale: 1, fps: 60, maxOctaves: 4 };
    expect(costEstimate(BAND_W, BAND_H, naive, 4, 60).relativeToNaive).toBeCloseTo(1, 6);
  });

  it('keeps the shipped high tier under a twentieth of naive', () => {
    const c = costEstimate(BAND_W, BAND_H, AURORA_QUALITY.high, 4, 60);
    expect(c.relativeToNaive).toBeLessThan(0.05);
  });

  it('keeps the low tier under a hundredth of naive', () => {
    expect(costEstimate(BAND_W, BAND_H, AURORA_QUALITY.low, 4, 60).relativeToNaive).toBeLessThan(0.01);
  });

  it('scales quadratically with the resolution divisor', () => {
    const a = costEstimate(BAND_W, BAND_H, { scale: 2, fps: 20, maxOctaves: 4 }, 4);
    const b = costEstimate(BAND_W, BAND_H, { scale: 4, fps: 20, maxOctaves: 4 }, 4);
    expect(a.fragmentsPerSecond / b.fragmentsPerSecond).toBeCloseTo(4, 5);
  });

  it('is capped by the tier, not by the preset', () => {
    const q = { scale: 3, fps: 20, maxOctaves: 2 };
    expect(costEstimate(BAND_W, BAND_H, q, 5).fragmentsPerSecond)
      .toBe(costEstimate(BAND_W, BAND_H, q, 2).fragmentsPerSecond);
  });

  it('every shipped preset fits the budget at every tier', () => {
    for (const [id, p] of Object.entries(DOC.presets)) {
      for (const tier of ['high', 'medium', 'low'] as const) {
        const c = costEstimate(BAND_W, BAND_H, AURORA_QUALITY[tier], p.octaves, 60);
        expect(c.relativeToNaive, `${id} @ ${tier}`).toBeLessThan(0.05);
      }
    }
  });
});

describe('aurora.json', () => {
  it('validates', () => {
    expect(validateAuroraFile(DOC)).toEqual([]);
  });

  it('ships the world preset plus a quiet and an active variant', () => {
    expect(Object.keys(DOC.presets).sort()).toEqual(['borealis', 'calm', 'storm']);
  });

  it('gives every preset a full ramp of real colours', () => {
    for (const [id, p] of Object.entries(DOC.presets)) {
      expect(p.ramp, id).toHaveLength(RAMP_STOPS);
      for (const hex of p.ramp) expect(hex, id).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('puts the oxygen green in the body and the fringes at the edges', () => {
    // The physics the ramp encodes: nitrogen violet UNDER, oxygen green through
    // the middle, red-violet fading off the TOP. A ramp that is green all the
    // way through renders a flat smear rather than a curtain.
    for (const [id, p] of Object.entries(DOC.presets)) {
      const greenness = p.ramp.map((hex) => {
        const v = parseInt(hex.slice(1), 16);
        const r = (v >> 16) & 255;
        const g = (v >> 8) & 255;
        const b = v & 255;
        return g - Math.max(r, b);
      });
      const core = greenness[2];
      expect(core, `${id} core is the greenest`).toBeGreaterThan(greenness[0]);
      expect(core, `${id} core is greener than the top`).toBeGreaterThan(greenness[4]);
      expect(greenness[0], `${id} bottom fringe is not green`).toBeLessThan(0);
      expect(greenness[4], `${id} top fringe is not green`).toBeLessThan(0);
    }
  });

  it('dithers by at least one 8-bit step', () => {
    // Below ~2/255 the dither only breaks a band part of the time, and the
    // contour lines come back. This is the anti-banding contract.
    for (const [id, p] of Object.entries(DOC.presets)) {
      expect(p.dither, id).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives each curtain of a preset its own seed', () => {
    for (const [id, p] of Object.entries(DOC.presets)) {
      expect(new Set(p.layers.map((l) => l.seed)).size, id).toBe(p.layers.length);
    }
  });

  it('stacks its curtains at different heights and rates', () => {
    // Three identical curtains are one curtain drawn three times.
    const p = DOC.presets.borealis;
    expect(p.layers).toHaveLength(3);
    expect(new Set(p.layers.map((l) => l.baseY)).size).toBe(3);
    expect(new Set(p.layers.map((l) => l.rayFreq)).size).toBe(3);
    expect(new Set(p.layers.map((l) => l.drift)).size).toBe(3);
  });

  it('makes the nearer curtains move faster than the far ones', () => {
    // Parallax: the near curtain drifts and shimmers more than the distant one,
    // or the sky reads as a flat backdrop.
    const l = DOC.presets.borealis.layers;
    for (let i = 1; i < l.length; i++) {
      expect(l[i].drift, `curtain ${i + 1} drift`).toBeGreaterThan(l[i - 1].drift);
      expect(l[i].shimmer, `curtain ${i + 1} shimmer`).toBeGreaterThan(l[i - 1].shimmer);
    }
  });

  it('keeps the surge slow enough to read as a sweep', () => {
    for (const [id, p] of Object.entries(DOC.presets)) {
      // A full traversal must take at least ten seconds; faster reads as a flash.
      expect(1 / p.surgeSpeed, id).toBeGreaterThan(10);
    }
  });
});

describe('validateAuroraFile', () => {
  const base = (): AuroraPresetFile => JSON.parse(JSON.stringify(DOC)) as AuroraPresetFile;

  it('rejects a short ramp', () => {
    const doc = base();
    doc.presets.borealis.ramp = ['#FFFFFF', '#000000'];
    expect(validateAuroraFile(doc).join('\n')).toMatch(/ramp needs exactly 5 stops/);
  });

  it('rejects a malformed colour', () => {
    const doc = base();
    doc.presets.borealis.ramp[1] = 'mint';
    expect(validateAuroraFile(doc).join('\n')).toMatch(/"mint" is not #rrggbb/);
  });

  it('rejects two curtains sharing a seed', () => {
    const doc = base();
    doc.presets.borealis.layers[1].seed = doc.presets.borealis.layers[0].seed;
    expect(validateAuroraFile(doc).join('\n')).toMatch(/share seed/);
  });

  it('rejects more layers than the shader unrolls', () => {
    const doc = base();
    const l = doc.presets.borealis.layers;
    doc.presets.borealis.layers = [...l, { ...l[0], seed: 99 }];
    expect(validateAuroraFile(doc).join('\n')).toMatch(/at most 3 layers/);
  });

  it('rejects an octave count the shader loop cannot honour', () => {
    const doc = base();
    doc.presets.borealis.octaves = 9;
    expect(validateAuroraFile(doc).join('\n')).toMatch(/octaves must be 1\.\.5/);
  });

  it('rejects a zero-thickness curtain', () => {
    const doc = base();
    doc.presets.borealis.layers[0].thickness = 0;
    expect(validateAuroraFile(doc).join('\n')).toMatch(/thickness <= 0/);
  });
});
