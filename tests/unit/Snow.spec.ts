import { describe, expect, it } from 'vitest';

import snowDoc from '../../src/data/snow.json';
import {
  activePlaneCount,
  activePlanes,
  costEstimate,
  MAX_PLANES,
  SNOW_QUALITY,
  validateSnowFile,
  type SnowPresetFile
} from '../../src/render/fx/snowConfig';
import { TIER_ORDER } from '../../src/render/fx/emitterTypes';

const DOC = snowDoc as unknown as SnowPresetFile;

/** The game's canvas. Snow covers all of it. */
const W = 2560;
const H = 1600;

/**
 * The snowfield's quality contract, its depth grammar and its cost model.
 *
 * Snow has one lever and one only — how many depth planes each fragment walks —
 * because unlike the aurora it can be rendered neither at reduced resolution nor
 * at a reduced rate. These tests pin that lever, and they pin the parallax
 * grammar, which is what separates a snowfield from a sheet of confetti. The
 * GPU-side checks live in tools/checks/snowtest.mjs.
 */
describe('snow quality tiers', () => {
  it('covers every tier the FX layer can be in', () => {
    for (const tier of TIER_ORDER) expect(SNOW_QUALITY[tier]).toBeDefined();
  });

  it('drops a whole depth plane per step down', () => {
    const order = ['high', 'medium', 'low'] as const;
    for (let i = 1; i < order.length; i++) {
      expect(SNOW_QUALITY[order[i]].planes).toBeLessThan(SNOW_QUALITY[order[i - 1]].planes);
    }
  });

  it('draws nothing at all when off', () => {
    expect(SNOW_QUALITY.off.planes).toBe(0);
  });

  it('keeps enough planes at the lowest tier to still read as depth', () => {
    // Two planes is a foreground and a background; three is a field.
    expect(SNOW_QUALITY.low.planes).toBeGreaterThanOrEqual(3);
  });

  it('uses the shader\'s full unroll at the top tier', () => {
    expect(SNOW_QUALITY.high.planes).toBe(MAX_PLANES);
  });
});

describe('plane selection', () => {
  const p = DOC.presets.snowfall;

  it('drops the NEAREST planes first', () => {
    // The far planes carry the density; the near ones are a handful of big soft
    // flakes. Dropping the far planes would empty the sky.
    const low = activePlanes(p, SNOW_QUALITY.low);
    expect(low).toHaveLength(3);
    expect(low[0]).toEqual(p.planes[0]);
    expect(low[2]).toEqual(p.planes[2]);
  });

  it('splits a plane budget between a back and a front instance', () => {
    // Two SnowFX at two depths (flakes passing either side of a dragon) must
    // cost exactly what one costs — the slice is taken AFTER the tier cap.
    for (const tier of ['high', 'medium', 'low'] as const) {
      const q = SNOW_QUALITY[tier];
      const back = activePlaneCount(p, q, [0, 2]);
      const front = activePlaneCount(p, q, [2, MAX_PLANES]);
      expect(back + front, tier).toBe(q.planes);
    }
  });

  it('gives an empty slice no planes rather than a negative count', () => {
    expect(activePlaneCount(p, SNOW_QUALITY.low, [4, 5])).toBe(0);
  });
});

describe('costEstimate', () => {
  const p = DOC.presets.snowfall;

  it('gets cheaper and thinner as the tier drops', () => {
    const order = ['high', 'medium', 'low'] as const;
    for (let i = 1; i < order.length; i++) {
      const better = costEstimate(W, H, SNOW_QUALITY[order[i - 1]], p);
      const worse = costEstimate(W, H, SNOW_QUALITY[order[i]], p);
      expect(worse.fragmentsPerSecond, order[i]).toBeLessThan(better.fragmentsPerSecond);
      expect(worse.flakes, order[i]).toBeLessThan(better.flakes);
    }
  });

  it('costs nothing when off', () => {
    const c = costEstimate(W, H, SNOW_QUALITY.off, p);
    expect(c.fragmentsPerSecond).toBe(0);
    expect(c.flakes).toBe(0);
  });

  it('is the reason the effect is a shader and not particles', () => {
    // The whole case for this technique in one number: a sprite snowfield of
    // this density is six figures of transform writes a second, every second,
    // forever. The shader does none of them.
    const c = costEstimate(W, H, SNOW_QUALITY.high, p, 60);
    expect(c.flakes).toBeGreaterThan(1500);
    expect(c.spriteUpdatesAvoided).toBeGreaterThan(100_000);
  });

  it('charges one full-screen pass per active plane', () => {
    const c = costEstimate(W, H, SNOW_QUALITY.high, p, 60);
    expect(c.screenPasses).toBe(MAX_PLANES);
    expect(c.fragmentsPerSecond).toBe(W * H * 60 * MAX_PLANES);
  });

  it('counts a sliced instance as only its own planes', () => {
    const whole = costEstimate(W, H, SNOW_QUALITY.high, p, 60);
    const back = costEstimate(W, H, SNOW_QUALITY.high, p, 60, [0, 2]);
    const front = costEstimate(W, H, SNOW_QUALITY.high, p, 60, [2, MAX_PLANES]);
    expect(back.flakes + front.flakes).toBe(whole.flakes);
    expect(back.screenPasses + front.screenPasses).toBe(whole.screenPasses);
  });
});

describe('snow.json', () => {
  it('validates', () => {
    expect(validateSnowFile(DOC)).toEqual([]);
  });

  it('ships the standing weather plus a light and a heavy variant', () => {
    expect(Object.keys(DOC.presets).sort()).toEqual(['blizzard', 'flurry', 'snowfall']);
  });

  it('gives every preset the full depth stack', () => {
    for (const [id, p] of Object.entries(DOC.presets)) {
      expect(p.planes, id).toHaveLength(MAX_PLANES);
    }
  });

  it('grades every plane on every axis at once', () => {
    // Parallax on one axis and not the others is what makes 2-D weather look
    // like a decal on the lens. Near planes must be bigger AND faster AND
    // softer AND blown harder by the wind.
    for (const [id, p] of Object.entries(DOC.presets)) {
      for (let i = 1; i < p.planes.length; i++) {
        const a = p.planes[i - 1];
        const b = p.planes[i];
        expect(b.grid, `${id} plane ${i} grid`).toBeLessThan(a.grid);
        expect(b.radius, `${id} plane ${i} radius`).toBeGreaterThan(a.radius);
        expect(b.fall, `${id} plane ${i} fall`).toBeGreaterThan(a.fall);
        expect(b.softness, `${id} plane ${i} softness`).toBeGreaterThan(a.softness);
        expect(b.windGain, `${id} plane ${i} windGain`).toBeGreaterThan(a.windGain);
        expect(b.stretch, `${id} plane ${i} stretch`).toBeGreaterThan(a.stretch);
      }
    }
  });

  it('keeps the nearest plane defocused', () => {
    // It is 50-odd px across. Crisp, it is a snowball; soft, it is depth.
    for (const [id, p] of Object.entries(DOC.presets)) {
      expect(p.planes[p.planes.length - 1].softness, id).toBeGreaterThan(0.8);
    }
  });

  it('keeps every flake inside its own cell', () => {
    // The single-tap lookup — no 3×3 neighbourhood — depends entirely on this.
    for (const [id, p] of Object.entries(DOC.presets)) {
      p.planes.forEach((l, i) => {
        expect(l.radius * Math.max(1, l.stretch) + l.sway, `${id} plane ${i}`).toBeLessThan(0.5);
      });
    }
  });

  it('gives every plane its own flutter rate', () => {
    // Shared rates put the whole field on one beat, which the eye picks up
    // immediately as a loop.
    for (const [id, p] of Object.entries(DOC.presets)) {
      expect(new Set(p.planes.map((l) => l.swayHz)).size, id).toBe(p.planes.length);
    }
  });

  it('tints the flakes with the sky rather than pure white', () => {
    for (const [id, p] of Object.entries(DOC.presets)) {
      const v = parseInt(p.tint.slice(1), 16);
      const r = (v >> 16) & 255;
      const b = v & 255;
      expect(b, `${id} tint is cold`).toBeGreaterThan(r);
      expect(v, `${id} tint is not #FFFFFF`).not.toBe(0xffffff);
    }
  });

  it('makes the blizzard denser and faster than the flurry', () => {
    const flurry = costEstimate(W, H, SNOW_QUALITY.high, DOC.presets.flurry);
    const fall = costEstimate(W, H, SNOW_QUALITY.high, DOC.presets.snowfall);
    const blizz = costEstimate(W, H, SNOW_QUALITY.high, DOC.presets.blizzard);
    expect(flurry.flakes).toBeLessThan(fall.flakes);
    expect(fall.flakes).toBeLessThan(blizz.flakes);
    expect(DOC.presets.blizzard.windScale).toBeGreaterThan(DOC.presets.snowfall.windScale);
    expect(DOC.presets.flurry.windScale).toBeLessThan(DOC.presets.snowfall.windScale);
  });
});

describe('validateSnowFile', () => {
  const base = (): SnowPresetFile => JSON.parse(JSON.stringify(DOC)) as SnowPresetFile;

  it('rejects a malformed tint', () => {
    const doc = base();
    doc.presets.snowfall.tint = 'snow';
    expect(validateSnowFile(doc).join('\n')).toMatch(/tint "snow" is not #rrggbb/);
  });

  it('rejects planes that are not ordered far to near', () => {
    const doc = base();
    const p = doc.presets.snowfall.planes;
    [p[0], p[1]] = [p[1], p[0]];
    expect(validateSnowFile(doc).join('\n')).toMatch(/grid must decrease with depth/);
  });

  it('rejects a flake that would clip on its cell border', () => {
    const doc = base();
    doc.presets.snowfall.planes[4].sway = 0.4;
    expect(validateSnowFile(doc).join('\n')).toMatch(/must stay under 0\.5 cell/);
  });

  it('rejects a squashed flake', () => {
    const doc = base();
    doc.presets.snowfall.planes[0].stretch = 0.7;
    expect(validateSnowFile(doc).join('\n')).toMatch(/stretch must be >= 1/);
  });

  it('rejects coverage outside (0, 1]', () => {
    const doc = base();
    doc.presets.snowfall.planes[0].coverage = 1.4;
    expect(validateSnowFile(doc).join('\n')).toMatch(/coverage must be in \(0, 1\]/);
  });

  it('rejects more planes than the shader unrolls', () => {
    const doc = base();
    const p = doc.presets.snowfall.planes;
    doc.presets.snowfall.planes = [...p, { ...p[4], grid: 4, radius: 0.2, fall: 0.5 }];
    expect(validateSnowFile(doc).join('\n')).toMatch(new RegExp(`at most ${MAX_PLANES} planes`));
  });

  it('rejects a version it does not understand', () => {
    const doc = base();
    doc.version = 2;
    expect(validateSnowFile(doc).join('\n')).toMatch(/version must be 1/);
  });
});
