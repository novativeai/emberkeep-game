import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import presetDoc from '../../src/data/fx-emitters.json';
import bankDoc from '../../src/data/vfx-flipbooks.json';
import placementDoc from '../../src/data/emitters.json';
import { LOD_MIN_TIER, TIER_ORDER, validatePresetFile, type FxPresetFile } from '../../src/render/fx/emitterTypes';
import {
  resolvePlacement,
  seedFromId,
  validatePlacementFile,
  type EmitterPlacementFile
} from '../../src/render/fx/emitterPlacements';
import { assignTiers, capTier, circleTouchesRect } from '../../src/render/fx/fxBudget';
import {
  bell,
  clamp01,
  easeOutCubic,
  flicker,
  hash01,
  modulate,
  valueNoise,
  type FlickerOctave
} from '../../src/render/fx/fxSignals';
import { DEFAULT_WIND, sampleWind } from '../../src/render/fx/fxWind';

const PRESETS = presetDoc as unknown as FxPresetFile;
const PLACEMENTS = placementDoc as unknown as EmitterPlacementFile;
const PRESET_IDS = Object.keys(PRESETS.presets);
const BANK_SHEETS = (bankDoc as unknown as { sheets: Record<string, unknown> }).sheets;
const ROOT = path.resolve(__dirname, '../..');

const OCT: FlickerOctave[] = [
  { hz: 11.7, amp: 0.3 },
  { hz: 4.3, amp: 0.44 },
  { hz: 1.13, amp: 0.26 }
];

/**
 * The FX emitter layer, pinned where it can be pinned.
 *
 * Everything here is the part that is invisible in a screenshot but wrong in
 * motion: a flicker that turns out to have a period, a wind field that moves
 * every emitter in lockstep, a tier assignment that flips between two rigs
 * every frame, a preset that references art nobody baked.
 */
describe('fxSignals', () => {
  describe('hash01', () => {
    it('is deterministic and in [0, 1)', () => {
      for (let i = -50; i < 50; i++) {
        const v = hash01(i);
        expect(v).toBe(hash01(i));
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });

    it('decorrelates neighbouring inputs', () => {
      // A hash that leaks its input's low bits gives sibling emitters visibly
      // similar seeds, which is exactly what seeding was meant to prevent.
      const deltas: number[] = [];
      for (let i = 0; i < 500; i++) deltas.push(Math.abs(hash01(i) - hash01(i + 1)));
      const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      expect(mean).toBeGreaterThan(0.25);
    });

    it('spreads roughly uniformly', () => {
      const buckets = new Array<number>(10).fill(0);
      for (let i = 0; i < 10000; i++) buckets[Math.floor(hash01(i) * 10)]++;
      for (const b of buckets) expect(b).toBeGreaterThan(700);
    });
  });

  describe('valueNoise', () => {
    it('stays in [0, 1]', () => {
      for (let x = 0; x < 200; x += 0.137) {
        const v = valueNoise(x, 7);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it('is continuous — no jump at the integer lattice', () => {
      // A kink here becomes a visible tick in the flame every 1/hz seconds.
      for (let i = 1; i < 30; i++) {
        const before = valueNoise(i - 1e-6, 3);
        const after = valueNoise(i + 1e-6, 3);
        expect(Math.abs(after - before)).toBeLessThan(1e-4);
      }
    });

    it('is smooth: the derivative vanishes at the lattice', () => {
      for (let i = 1; i < 10; i++) {
        const d = (valueNoise(i + 1e-4, 5) - valueNoise(i - 1e-4, 5)) / 2e-4;
        expect(Math.abs(d)).toBeLessThan(0.05);
      }
    });

    it('gives different fields for different seeds', () => {
      const a = valueNoise(3.5, 1);
      const b = valueNoise(3.5, 2);
      expect(a).not.toBeCloseTo(b, 3);
    });
  });

  describe('flicker', () => {
    it('stays in [0, 1] with a mean near 0.5', () => {
      let sum = 0;
      const n = 20000;
      for (let i = 0; i < n; i++) {
        const v = flicker(i * 3.1, OCT, 4211);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        sum += v;
      }
      expect(sum / n).toBeGreaterThan(0.42);
      expect(sum / n).toBeLessThan(0.58);
    });

    it('has no period at any lag — the whole point', () => {
      // Autocorrelation is the honest test: a signal that repeats at ANY lag
      // spikes back towards 1 there, and a player learns that rhythm. Perfect
      // self-correlation at lag 0, and nothing above 0.75 anywhere after.
      expect(autocorrelation(0)).toBeCloseTo(1, 6);
      let worst = -1;
      for (let lag = 150; lag <= 20000; lag += 37) worst = Math.max(worst, autocorrelation(lag));
      expect(worst).toBeLessThan(0.75);
    });

    it('decorrelates within one cycle of each octave', () => {
      for (const o of OCT) expect(autocorrelation(1000 / o.hz)).toBeLessThan(0.7);
    });

    it('actually moves at the fast octave', () => {
      // ~85ms apart at 11.7Hz is most of a cycle; a signal that barely changes
      // there is a fire that looks frozen.
      const a = flicker(0, OCT, 4211);
      const b = flicker(43, OCT, 4211);
      expect(Math.abs(a - b)).toBeGreaterThan(0.01);
    });

    it('phase offsets decorrelate siblings without divorcing them', () => {
      // The three flame bodies must not pulse identically (a doubled sprite)
      // nor independently (three unrelated flames). Correlated-but-different.
      const n = 4000;
      const a: number[] = [];
      const b: number[] = [];
      for (let i = 0; i < n; i++) {
        a.push(flicker(i * 7, OCT, 4211, 0));
        b.push(flicker(i * 7, OCT, 4211, 3.7));
      }
      const diff = a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / n;
      expect(diff).toBeGreaterThan(0.05);
      expect(diff).toBeLessThan(0.5);
    });

    it('is deterministic — the same clock reading gives the same value', () => {
      expect(flicker(12345.678, OCT, 4211, 1.5)).toBe(flicker(12345.678, OCT, 4211, 1.5));
    });

    it('lagging the sample gives a delayed copy, not a different signal', () => {
      // This is what makes the ground light read as CAST by the flame.
      const lag = 60;
      const now = flicker(5000, OCT, 4211);
      const lagged = flicker(5000 + lag, OCT, 4211, 0);
      expect(lagged).not.toBe(now);
      expect(flicker(5000 - lag + lag, OCT, 4211)).toBe(now);
    });

    it('degrades safely with no octaves', () => {
      expect(flicker(1000, [], 1)).toBe(0.5);
    });
  });

  describe('shaping curves', () => {
    it('modulate maps 0..1 onto base ± amp', () => {
      expect(modulate(0.3, 0.17, 0.5)).toBeCloseTo(0.3, 6);
      expect(modulate(0.3, 0.17, 1)).toBeCloseTo(0.47, 6);
      expect(modulate(0.3, 0.17, 0)).toBeCloseTo(0.13, 6);
    });

    it('bell rises to 1 at the peak and reaches 0 at the end', () => {
      expect(bell(0, 0.22)).toBeCloseTo(0, 6);
      expect(bell(0.22, 0.22)).toBeCloseTo(1, 6);
      expect(bell(1, 0.22)).toBeCloseTo(0, 6);
      for (let t = 0; t <= 1; t += 0.01) {
        const v = bell(t, 0.22);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1.0000001);
      }
    });

    it('bell fades out over more of the life than it fades in', () => {
      // Smoke and embers must LINGER; a symmetric envelope reads as a blink.
      // The property is a duration one, so measure durations: how long the
      // envelope stays above a level either side of its peak.
      const peakAt = 0.22;
      for (const level of [0.2, 0.5, 0.8]) {
        let before = 0;
        let after = 0;
        for (let t = 0; t <= 1; t += 0.0005) {
          if (bell(t, peakAt) < level) continue;
          if (t < peakAt) before += 0.0005;
          else after += 0.0005;
        }
        expect(after, `above ${level}`).toBeGreaterThan(before);
      }
    });

    it('easeOutCubic decelerates — buoyancy bleeding off', () => {
      const early = easeOutCubic(0.2) - easeOutCubic(0.1);
      const late = easeOutCubic(0.9) - easeOutCubic(0.8);
      expect(early).toBeGreaterThan(late * 3);
      expect(easeOutCubic(0)).toBe(0);
      expect(easeOutCubic(1)).toBe(1);
    });

    it('clamp01 clamps', () => {
      expect(clamp01(-3)).toBe(0);
      expect(clamp01(3)).toBe(1);
      expect(clamp01(0.4)).toBe(0.4);
    });
  });
});

describe('fxWind', () => {
  it('is deterministic for a given clock and place', () => {
    const a = sampleWind(DEFAULT_WIND, 4321, 100, 200);
    const b = sampleWind(DEFAULT_WIND, 4321, 100, 200);
    expect(a).toEqual(b);
  });

  it('flattens the vertical component onto the iso ground plane', () => {
    // Ground wind seen through a 2:1 iso camera must be foreshortened, or the
    // drift reads as if the world were viewed head-on.
    const spec = { ...DEFAULT_WIND, dirDeg: 45, gust: 0, swirlDeg: 0, speed: 1 };
    const w = sampleWind(spec, 0, 0, 0);
    expect(Math.abs(w.y / w.x)).toBeCloseTo(spec.flatten, 5);
  });

  it('keeps the gust inside the authored envelope', () => {
    const spec = { ...DEFAULT_WIND, speed: 1, gust: 0.55 };
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < 600000; t += 250) {
      const s = sampleWind(spec, t, 0, 0).speed;
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
    expect(lo).toBeGreaterThanOrEqual(1 - 0.55 - 1e-9);
    expect(hi).toBeLessThanOrEqual(1 + 0.55 + 1e-9);
    // …and actually uses it, rather than sitting near the mean forever.
    expect(hi - lo).toBeGreaterThan(0.4);
  });

  it('agrees locally and decorrelates across the map', () => {
    // Neighbours share a gust (it sweeps); opposite ends of the world do not.
    // Measured over the whole timeline, because at any single instant two
    // uncorrelated points can happen to agree.
    let adjacent = 0;
    let distant = 0;
    let n = 0;
    for (let t = 0; t < 600000; t += 997) {
      const here = sampleWind(DEFAULT_WIND, t, 0, 0).speed;
      adjacent += Math.abs(here - sampleWind(DEFAULT_WIND, t, 60, 40).speed);
      distant += Math.abs(here - sampleWind(DEFAULT_WIND, t, 9000, 5200).speed);
      n++;
    }
    expect(adjacent / n).toBeLessThan(0.01);
    expect(distant / n).toBeGreaterThan(0.02);
    expect(distant).toBeGreaterThan(adjacent * 20);
  });

  it('evolves slowly — wind is not flicker', () => {
    // A gust that changes materially inside a frame would jitter every ember.
    const a = sampleWind(DEFAULT_WIND, 100000, 0, 0);
    const b = sampleWind(DEFAULT_WIND, 100016, 0, 0);
    expect(Math.abs(a.speed - b.speed)).toBeLessThan(0.01);
  });

  it('a zero-gust, zero-swirl spec is a constant field', () => {
    const spec = { ...DEFAULT_WIND, gust: 0, swirlDeg: 0 };
    expect(sampleWind(spec, 0, 0, 0)).toEqual(sampleWind(spec, 500000, 4000, 3000));
  });
});

describe('fxBudget', () => {
  const view = { x: 0, y: 0, right: 1000, bottom: 800 };
  const at = (x: number, y: number, radius = 300) => ({ x, y, radius });

  it('circleTouchesRect catches an off-screen source whose reach is on-screen', () => {
    expect(circleTouchesRect(-200, 400, 300, view)).toBe(true);
    expect(circleTouchesRect(-400, 400, 300, view)).toBe(false);
    expect(circleTouchesRect(500, 400, 10, view)).toBe(true);
  });

  it('capTier never promotes above the ceiling', () => {
    expect(capTier('high', 'medium')).toBe('medium');
    expect(capTier('low', 'high')).toBe('low');
    expect(capTier('high', 'off')).toBe('off');
  });

  const opts = { highSlots: 2, mediumSlots: 2, cullPadPx: 100, ceiling: 'high' as const };

  it('spends the budget on what is nearest the view centre', () => {
    const targets = [at(900, 700), at(500, 400), at(520, 420), at(880, 90), at(100, 100)];
    const tiers = assignTiers(targets, view, opts);
    expect(tiers[1]).toBe('high');
    expect(tiers[2]).toBe('high');
    expect(tiers.filter((t) => t === 'high')).toHaveLength(2);
    expect(tiers.filter((t) => t === 'medium')).toHaveLength(2);
    expect(tiers.filter((t) => t === 'low')).toHaveLength(1);
  });

  it('returns tiers in input order, not in ranked order', () => {
    const targets = [at(990, 790), at(500, 400)];
    expect(assignTiers(targets, view, { ...opts, highSlots: 1, mediumSlots: 1 })).toEqual(['medium', 'high']);
  });

  it('culls what the padded view cannot reach', () => {
    const targets = [at(500, 400), at(9000, 9000)];
    expect(assignTiers(targets, view, opts)[1]).toBe('off');
  });

  it('the doze ceiling turns everything off', () => {
    const targets = [at(500, 400), at(520, 420)];
    expect(assignTiers(targets, view, { ...opts, ceiling: 'off' })).toEqual(['off', 'off']);
  });

  it('the idle ceiling caps the best rig at medium', () => {
    const targets = [at(500, 400), at(520, 420), at(100, 100)];
    const tiers = assignTiers(targets, view, { ...opts, ceiling: 'medium' });
    expect(tiers).toEqual(['medium', 'medium', 'medium']);
  });

  it('is stable for equidistant rigs — no per-frame tier flapping', () => {
    const targets = [at(400, 400), at(600, 400)];
    const once = assignTiers(targets, view, { ...opts, highSlots: 1, mediumSlots: 1 });
    for (let i = 0; i < 20; i++) {
      expect(assignTiers(targets, view, { ...opts, highSlots: 1, mediumSlots: 1 })).toEqual(once);
    }
  });

  it('degrades gracefully past the slots', () => {
    const targets = Array.from({ length: 30 }, (_, i) => at(500 + i, 400));
    const tiers = assignTiers(targets, view, opts);
    expect(tiers.filter((t) => t === 'low')).toHaveLength(26);
    expect(tiers).not.toContain('off');
  });

  it('LOD gates map onto the tier ladder in the right order', () => {
    expect(TIER_ORDER.indexOf(LOD_MIN_TIER[0])).toBeLessThan(TIER_ORDER.indexOf(LOD_MIN_TIER[1]));
    expect(TIER_ORDER.indexOf(LOD_MIN_TIER[1])).toBeLessThan(TIER_ORDER.indexOf(LOD_MIN_TIER[2]));
    expect(TIER_ORDER.indexOf(LOD_MIN_TIER[0])).toBeGreaterThan(TIER_ORDER.indexOf('off'));
  });
});

describe('fx-emitters.json', () => {
  it('validates', () => {
    expect(validatePresetFile(PRESETS)).toEqual([]);
  });

  it('ships the authored emitters', () => {
    // `fire` and `smokeEmbers` are world placements (the World Builder's 🔥 tab);
    // `eggAura` is attached per ITEM and is covered by tests/unit/EggAura.spec.ts.
    expect(Object.keys(PRESETS.presets).sort()).toEqual(['eggAura', 'fire', 'smokeEmbers']);
  });

  it('references only sheets the motion-vector bank actually baked', () => {
    for (const key of PRESETS.sheets) expect(Object.keys(BANK_SHEETS)).toContain(key);
  });

  it('references only particle art that exists on disk', () => {
    for (const rel of Object.values(PRESETS.textures)) {
      expect(existsSync(path.join(ROOT, 'assets/vfx-bank', rel))).toBe(true);
    }
  });

  it('keeps bank particles out of the game placeholders namespace', () => {
    // Loading these as `fx_ember` etc. would restyle every merge burst in the
    // game as a side effect of placing a brazier.
    for (const key of Object.keys(PRESETS.textures)) expect(key.startsWith('fxb_')).toBe(true);
  });

  it('gives every layer a distinct depth within its stack', () => {
    for (const [id, preset] of Object.entries(PRESETS.presets)) {
      const zs = preset.layers.map((l) => l.z);
      expect(new Set(zs).size, `${id} has colliding layer z`).toBe(zs.length);
    }
  });

  it('never lets a stack reach outside its own cull radius', () => {
    // A layer that draws past `radiusPx` pops out of existence at the view edge.
    for (const [id, preset] of Object.entries(PRESETS.presets)) {
      for (const layer of preset.layers) {
        const reach = Math.abs(layer.dy ?? 0) + layerReach(layer);
        expect(reach, `${id}/${layer.id} reaches ${reach} of ${preset.radiusPx}`).toBeLessThanOrEqual(
          preset.radiusPx
        );
      }
    }
  });

  it('keeps every emitter alive at the lowest tier', () => {
    // A preset whose every layer is lod 1 or 2 renders NOTHING on a distant or
    // idle rig, which reads as a bug rather than as an optimisation.
    for (const [id, preset] of Object.entries(PRESETS.presets)) {
      expect(preset.layers.some((l) => (l.lod ?? 0) === 0), `${id} vanishes at low tier`).toBe(true);
    }
  });

  it('gives the fire three phase-shifted bodies off one sheet', () => {
    const sheets = PRESETS.presets.fire.layers.filter((l) => l.kind === 'sheet');
    expect(sheets).toHaveLength(3);
    expect(new Set(sheets.map((l) => l.sheet)).size).toBe(1);
    expect(new Set(sheets.map((l) => l.phase)).size).toBe(3);
    expect(new Set(sheets.map((l) => l.fps)).size).toBe(3);
  });

  it('lags the fire ground light behind the flame', () => {
    const glow = PRESETS.presets.fire.layers.find((l) => l.id === 'groundLight');
    expect(glow?.kind).toBe('glow');
    if (glow?.kind === 'glow') expect(glow.lagMs ?? 0).toBeGreaterThan(0);
  });

  it('squashes every ground-plane layer towards the iso 2:1 ratio', () => {
    for (const preset of Object.values(PRESETS.presets)) {
      for (const l of preset.layers) {
        if (l.kind === 'glow' && (l.dy ?? 0) === 0) expect(l.squash ?? 1).toBeLessThan(0.75);
        if (l.kind === 'decal') expect(l.squash ?? 1).toBeLessThan(0.75);
        if (l.kind === 'particles' && l.spread) expect(l.spread[1]).toBeLessThanOrEqual(l.spread[0] * 0.6);
      }
    }
  });

  it('draws smoke through a blend that can darken', () => {
    // ADD can only ever brighten, so smoke under it is impossible.
    const smoke = PRESETS.presets.smokeEmbers.layers.find((l) => l.id === 'smoke');
    expect(smoke?.kind).toBe('puffs');
    if (smoke?.kind === 'puffs') expect(smoke.blend).toBe('normal');
  });

  it('cools its embers and sparks over their life', () => {
    for (const id of ['embers', 'sparks'] as const) {
      const layer = PRESETS.presets.smokeEmbers.layers.find((l) => l.id === id);
      expect(layer?.kind).toBe('particles');
      if (layer?.kind !== 'particles') continue;
      expect(layer.color?.length ?? 0).toBeGreaterThan(1);
      // Luminance must fall monotonically: hot to dead, never back again.
      const lum = (layer.color ?? []).map((hex) => {
        const v = parseInt(hex.slice(1), 16);
        return ((v >> 16) & 255) * 0.299 + ((v >> 8) & 255) * 0.587 + (v & 255) * 0.114;
      });
      for (let i = 1; i < lum.length; i++) expect(lum[i]).toBeLessThan(lum[i - 1]);
    }
  });

  it('separates sparks from embers by their fall', () => {
    // The distinction is physical: a spark is dense and arcs back down, an
    // ember is buoyant and hangs. Same art, opposite behaviour.
    const layers = PRESETS.presets.smokeEmbers.layers;
    const sparks = layers.find((l) => l.id === 'sparks');
    const embers = layers.find((l) => l.id === 'embers');
    if (sparks?.kind !== 'particles' || embers?.kind !== 'particles') throw new Error('missing layers');
    expect(sparks.gravityY ?? 0).toBeGreaterThan(200);
    expect(embers.gravityY ?? 0).toBe(0);
    expect(embers.accelerationY ?? 0).toBeGreaterThan(0);
    expect(embers.lifespan[0]).toBeGreaterThan(sparks.lifespan[1]);
  });

  it('expands smoke as it rises and thins it as it expands', () => {
    const smoke = PRESETS.presets.smokeEmbers.layers.find((l) => l.id === 'smoke');
    if (smoke?.kind !== 'puffs') throw new Error('missing smoke');
    expect(smoke.width[1]).toBeGreaterThan(smoke.width[0] * 2);
    expect(smoke.alpha.peakAt).toBeLessThan(0.4);
    expect(smoke.fps[0]).not.toBe(smoke.fps[1]);
    // The pool has to cover the worst case (longest life, fastest release) or
    // the column silently starves: releases get skipped and the plume gaps.
    expect(smoke.pool).toBeGreaterThanOrEqual(smoke.lifeMs[1] / smoke.releaseMs[0]);
  });

  it('rejects a preset whose flipbook layers would play in unison', () => {
    const broken: FxPresetFile = JSON.parse(JSON.stringify(PRESETS)) as FxPresetFile;
    const sheets = broken.presets.fire.layers.filter((l) => l.kind === 'sheet');
    sheets[1].phase = sheets[0].phase;
    sheets[1].fps = sheets[0].fps;
    expect(validatePresetFile(broken).join('\n')).toMatch(/share sheet phase\+fps/);
  });

  it('rejects a layer pointing at art nobody baked', () => {
    const broken: FxPresetFile = JSON.parse(JSON.stringify(PRESETS)) as FxPresetFile;
    const layer = broken.presets.fire.layers.find((l) => l.kind === 'glow');
    if (layer?.kind === 'glow') layer.texture = 'fxb_nope';
    expect(validatePresetFile(broken).join('\n')).toMatch(/unknown texture "fxb_nope"/);
  });

  it('rejects a malformed range', () => {
    const broken: FxPresetFile = JSON.parse(JSON.stringify(PRESETS)) as FxPresetFile;
    const smoke = broken.presets.smokeEmbers.layers.find((l) => l.kind === 'puffs');
    if (smoke?.kind === 'puffs') smoke.lifeMs = [9000, 100];
    expect(validatePresetFile(broken).join('\n')).toMatch(/lifeMs must be \[min, max\]/);
  });
});

/** Vertical half-reach of a layer from its own anchor, in px. */
function layerReach(layer: FxPresetFile['presets'][string]['layers'][number]): number {
  switch (layer.kind) {
    case 'decal':
    case 'glow':
      return (layer.width * (layer.squash ?? 1)) / 2;
    case 'sheet':
      // Base-anchored, so the whole height is upward reach. Falls back to the
      // cell aspect (fb_flame_small cells are 2:1 tall) when height is implicit.
      return layer.height ?? layer.width * 2;
    case 'particles': {
      // Ballistics, not v·t: every particle layer here decelerates, and taking
      // the straight-line distance would overstate the reach three-fold.
      const v0 = Math.abs(layer.speedY?.[0] ?? 0);
      const a = (layer.accelerationY ?? 0) + (layer.gravityY ?? 0);
      const t = layer.lifespan[1] / 1000;
      const tPeak = a > 0 ? Math.min(t, v0 / a) : t;
      return v0 * tPeak - 0.5 * a * tPeak * tPeak + (layer.spread?.[1] ?? 0) / 2;
    }
    case 'puffs':
      return layer.risePx[1] + layer.width[1] / 2;
  }
}

/**
 * Pearson autocorrelation of the flicker field at a given lag. A signal with a
 * period spikes back towards 1 at that period; this one must not.
 */
function autocorrelation(lagMs: number): number {
  const N = 6000;
  const dt = 7;
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < N; i++) {
    a.push(flicker(i * dt, OCT, 4211));
    b.push(flicker(i * dt + lagMs, OCT, 4211));
  }
  const ma = a.reduce((s, v) => s + v, 0) / N;
  const mb = b.reduce((s, v) => s + v, 0) / N;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < N; i++) {
    const p = a[i] - ma;
    const q = b[i] - mb;
    num += p * q;
    da += p * p;
    db += q * q;
  }
  return num / Math.sqrt(da * db);
}


/**
 * World emitter PLACEMENTS (src/data/emitters.json, authored by the World
 * Builder's 🔥 FX tab). The file the game bundles must always be loadable —
 * a broken placement doc means a scene that renders nothing and says nothing.
 */
describe('emitters.json', () => {
  it('validates against the shipped preset roster', () => {
    expect(validatePlacementFile(PLACEMENTS, PRESET_IDS)).toEqual([]);
  });

  it('references only presets that exist', () => {
    for (const e of PLACEMENTS.emitters) expect(PRESET_IDS).toContain(e.preset);
  });

  it('rejects an unknown preset', () => {
    const doc: EmitterPlacementFile = {
      version: 1,
      emitters: [{ id: 'a', preset: 'bonfire', world: 'emberkeep', anchor: [0, 0] }]
    };
    expect(validatePlacementFile(doc, PRESET_IDS).join('\n')).toMatch(/unknown preset "bonfire"/);
  });

  it('rejects a duplicate id', () => {
    const one = { id: 'a', preset: 'fire', world: 'emberkeep', anchor: [0, 0] as [number, number] };
    expect(validatePlacementFile({ version: 1, emitters: [one, { ...one, anchor: [1, 1] }] }, PRESET_IDS).join('\n'))
      .toMatch(/duplicate id/);
  });

  it('rejects a malformed anchor', () => {
    const doc = { version: 1, emitters: [{ id: 'a', preset: 'fire', world: 'emberkeep', anchor: [0] }] };
    expect(validatePlacementFile(doc as unknown as EmitterPlacementFile, PRESET_IDS).join('\n'))
      .toMatch(/anchor must be \[col, row\]/);
  });

  it('catches the same preset dropped twice on one cell', () => {
    // The double-drop. Two DIFFERENT presets on one cell is the campfire
    // pattern and must stay legal.
    const at = (id: string, preset: string) =>
      ({ id, preset, world: 'emberkeep', anchor: [3, 3] as [number, number] });
    expect(validatePlacementFile({ version: 1, emitters: [at('a', 'fire'), at('b', 'fire')] }, PRESET_IDS).join('\n'))
      .toMatch(/2× preset "fire" stacked/);
    expect(validatePlacementFile({ version: 1, emitters: [at('a', 'fire'), at('b', 'smokeEmbers')] }, PRESET_IDS))
      .toEqual([]);
  });

  it('rejects a non-positive scale', () => {
    const doc: EmitterPlacementFile = {
      version: 1,
      emitters: [{ id: 'a', preset: 'fire', world: 'emberkeep', anchor: [0, 0], widthScale: 0 }]
    };
    expect(validatePlacementFile(doc, PRESET_IDS).join('\n')).toMatch(/widthScale must be > 0/);
  });

  describe('resolvePlacement', () => {
    const bare = { id: 'fx_1', preset: 'fire', world: 'emberkeep', anchor: [2, 5] as [number, number] };

    it('fills every optional field with a neutral default', () => {
      const r = resolvePlacement(bare);
      expect(r.scale).toBe(1);
      expect(r.widthScale).toBe(1);
      expect(r.heightScale).toBe(1);
      expect(r.tiltDeg).toBe(0);
      expect(r.groundRotDeg).toBe(0);
      expect(r.rate).toBe(1);
      expect(r.alpha).toBe(1);
      expect(r.flipX).toBe(false);
      expect(r.ramp).toBeNull();
      expect(r.windInfluence).toBeNull();
      expect(r.dx).toBe(0);
      expect(r.dy).toBe(0);
    });

    it('keeps what the author set', () => {
      const r = resolvePlacement({ ...bare, widthScale: 2.2, tiltDeg: -12, flipX: true, ramp: 'teal' });
      expect(r.widthScale).toBe(2.2);
      expect(r.tiltDeg).toBe(-12);
      expect(r.flipX).toBe(true);
      expect(r.ramp).toBe('teal');
    });

    it('derives a seed from the id when none is authored', () => {
      // Derived, not random: a placement that flickers differently every launch
      // is not a placement.
      expect(resolvePlacement(bare).seed).toBe(seedFromId('fx_1'));
      expect(resolvePlacement(bare).seed).toBe(resolvePlacement(bare).seed);
      expect(resolvePlacement({ ...bare, seed: 77 }).seed).toBe(77);
    });

    it('gives different ids different seeds', () => {
      const seeds = new Set(['fx_1', 'fx_2', 'fx_3', 'fx_10', 'brazier'].map(seedFromId));
      expect(seeds.size).toBe(5);
      for (const s of seeds) expect(Number.isInteger(s) && s >= 0).toBe(true);
    });
  });
});
