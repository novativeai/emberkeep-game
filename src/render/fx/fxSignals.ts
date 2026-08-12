/**
 * The signal layer every FX emitter reads — deliberately Phaser-free so it
 * unit-tests in node and stays deterministic under `window.advanceTime(ms)`.
 *
 * ## Why noise and not a sine
 *
 * The single most recognisable tell of amateur fire is a flame that pulses on a
 * period. A real flame is aperiodic: it is a turbulent process with energy at
 * many frequencies and no repeat. `flicker()` sums value-noise octaves at
 * DELIBERATELY INCOMMENSURATE rates (11.7 / 4.3 / 1.13 Hz — no small integer
 * ratio between any pair), so the composite has no finite period a player can
 * learn. A sum of sines at those rates would eventually realign; value noise
 * never does, because each octave is itself already non-repeating.
 *
 * ## Why one field, sampled at offsets
 *
 * Every layer of one fire (core, body, ground light, licks) samples the SAME
 * field at a different phase. That is what makes three sprites read as one
 * flame instead of three: they are correlated — the whole fire surges together
 * on the slow octave — but never identical, because the fast octave lands
 * differently for each. Independent random flicker per layer reads as noise;
 * identical flicker per layer reads as a single flashing sprite.
 *
 * Sampling at `t - lagMs` gives the third piece: a ground light that reaches
 * its peak a frame or two AFTER the flame does, so the light appears caused by
 * the fire rather than co-moving with it.
 */

/** Deterministic 32-bit integer hash -> [0, 1). No Math.random anywhere. */
export function hash01(n: number): number {
  let h = Math.imul(n | 0, 0x27d4eb2d) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Smooth 1-D value noise in [0, 1]: hash the integer lattice, smoothstep
 * between neighbours. C1-continuous, so nothing driven by it ever kinks.
 */
export function valueNoise(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const at = (n: number): number => hash01((Math.imul(n, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca77)) | 0);
  const a = at(i);
  const b = at(i + 1);
  return a + (b - a) * u;
}

/** One band of the flicker spectrum. */
export interface FlickerOctave {
  /** Rate in Hz. Keep the ratios between octaves irrational-ish. */
  hz: number;
  /** Relative weight; the sum is normalised, so only ratios matter. */
  amp: number;
}

/**
 * Aperiodic 0..1 signal with mean ≈ 0.5, evaluated at an absolute clock time.
 *
 * `phase` shifts the sample point along the field — the same field seen from
 * elsewhere. That is how sibling layers stay correlated without being equal.
 */
export function flicker(tMs: number, octaves: readonly FlickerOctave[], seed = 0, phase = 0): number {
  let sum = 0;
  let total = 0;
  for (let i = 0; i < octaves.length; i++) {
    const o = octaves[i];
    sum += o.amp * valueNoise((tMs / 1000) * o.hz + phase + i * 13.7, seed + i * 101);
    total += o.amp;
  }
  return total > 0 ? sum / total : 0.5;
}

/** Map a 0..1 flicker onto `base ± amp`. */
export function modulate(base: number, amp: number, f: number): number {
  return base + (f - 0.5) * 2 * amp;
}

/* ------------------------------ shaping curves ----------------------------- */

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Decelerating rise — buoyancy bleeding off as a puff cools. */
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);

export const easeOutQuad = (t: number): number => 1 - Math.pow(1 - clamp01(t), 2);

export const easeInQuad = (t: number): number => clamp01(t) * clamp01(t);

/**
 * Life-envelope for anything that fades in fast and out slow: rises over
 * `[0, peakAt]`, then decays over the remainder with a soft shoulder.
 *
 * `tail` > 1 makes the fade-out start gently and finish quickly (smoke
 * thinning out); `tail` < 1 makes it drop fast then linger.
 */
export function bell(t: number, peakAt: number, tail = 1.4): number {
  const p = clamp01(t);
  const k = clamp01(peakAt);
  if (k <= 0) return Math.pow(1 - p, tail);
  if (k >= 1) return easeOutQuad(p / k);
  return p < k ? easeOutQuad(p / k) : Math.pow(1 - (p - k) / (1 - k), tail);
}

/** '#rrggbb' -> 0xrrggbb, tolerant of a missing hash. */
export const hexToInt = (hex: string): number => parseInt(hex.replace('#', ''), 16) | 0;
