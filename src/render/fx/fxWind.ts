/**
 * The world wind field — one shared, slowly-evolving vector field that every
 * emitter reads. Phaser-free and clock-driven, so it unit-tests in node and
 * replays identically under `window.advanceTime(ms)`.
 *
 * ## Why a field and not a constant
 *
 * Two fires on opposite sides of the isle leaning in perfect lockstep reads as
 * one animation applied twice. Two fires leaning independently reads as two
 * unrelated toys. The truth in between is a field: gusts SWEEP, so nearby
 * emitters agree and distant ones lag. `sample()` decorrelates by feeding the
 * emitter's world position into the noise phase over a `cellPx` scale — inside
 * one cell everything moves together, across the map it does not.
 *
 * ## The 2.5-D part
 *
 * Wind blows along the GROUND. In this camera the ground plane is foreshortened
 * by the iso tile ratio (TILE_H / TILE_W = 0.5), so a world-horizontal gust must
 * project to screen with its vertical component squashed by the same factor —
 * that is `flatten`. Skip it and smoke drifts as if the world were seen from
 * straight on, which is exactly what makes bolted-on 2-D FX look bolted on.
 */
import { flicker, valueNoise, type FlickerOctave } from './fxSignals';

export interface WindSpec {
  /** Base direction in screen degrees (0 = +x, 90 = down). */
  dirDeg: number;
  /** Base speed in arbitrary units; layers scale it by their own gain. */
  speed: number;
  /** 0..1 — how much of the speed gusting adds and removes. */
  gust: number;
  /** How fast gusts evolve, Hz. Keep it low; wind is a slow signal. */
  gustHz: number;
  /** Maximum direction wander, degrees. */
  swirlDeg: number;
  /** World px over which the field decorrelates. */
  cellPx: number;
  /** Vertical foreshortening of the ground plane (iso TILE_H/TILE_W). */
  flatten: number;
  seed: number;
}

export interface WindSample {
  /** Screen-space drift, already flattened for the iso ground plane. */
  x: number;
  y: number;
  /** Magnitude before flattening — what layers scale their lean by. */
  speed: number;
  dirDeg: number;
}

export const DEFAULT_WIND: WindSpec = {
  dirDeg: -6,
  speed: 1,
  gust: 0.55,
  gustHz: 0.19,
  swirlDeg: 22,
  cellPx: 1400,
  flatten: 0.5,
  seed: 9137
};

/** Slow, wide-band gusting. Three octaves, no small-integer ratios. */
const GUST_OCTAVES: readonly FlickerOctave[] = [
  { hz: 1, amp: 1 },
  { hz: 0.37, amp: 0.8 },
  { hz: 0.11, amp: 0.6 }
];

const scaled = (hz: number): FlickerOctave[] => GUST_OCTAVES.map((o) => ({ hz: o.hz * hz, amp: o.amp }));

export const STILL: WindSample = { x: 0, y: 0, speed: 0, dirDeg: 0 };

/**
 * Sample the field at a world point and clock time.
 *
 * Position enters as a smooth noise offset rather than a quantised cell index —
 * quantising would put a hard seam between two braziers standing either side of
 * a cell boundary, and a seam in a wind field is instantly readable.
 */
export function sampleWind(spec: WindSpec, tMs: number, x = 0, y = 0): WindSample {
  const cell = Math.max(1, spec.cellPx);
  const place = valueNoise(x / cell, spec.seed ^ 0x51) * 3.1 + valueNoise(y / cell, spec.seed ^ 0x29) * 2.3;

  const octaves = scaled(spec.gustHz);
  const g = flicker(tMs, octaves, spec.seed, place);
  const s = flicker(tMs, octaves, spec.seed + 7, place + 3.3);

  const speed = spec.speed * (1 - spec.gust + spec.gust * 2 * g);
  const dirDeg = spec.dirDeg + (s - 0.5) * 2 * spec.swirlDeg;
  const rad = (dirDeg * Math.PI) / 180;

  return {
    x: Math.cos(rad) * speed,
    y: Math.sin(rad) * speed * spec.flatten,
    speed,
    dirDeg
  };
}
