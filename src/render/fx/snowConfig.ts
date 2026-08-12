/**
 * The Phaser-free half of the snowfall: its schema, its parallax contract, its
 * quality tiers and its cost model. Split out so the budget and the depth
 * ordering are things a unit test can hold us to in node, rather than claims in
 * a comment.
 */
import type { FxTier } from './emitterTypes';

/** Depth planes the shader unrolls. Raising this costs a uniform slot per array. */
export const MAX_PLANES = 5;

/**
 * One depth plane of the snowfield.
 *
 * A plane is a grid of cells, at most one flake per cell, scrolling downward.
 * Everything about it — size, speed, focus, flutter — is a function of how far
 * away it is meant to be, and the preset's planes are ordered FAR to NEAR.
 */
export interface SnowPlane {
  /** Cells down the height of the band. Higher = smaller, denser, further. */
  grid: number;
  /** Flake radius in cell units. */
  radius: number;
  /** Fall speed in band-heights per second. */
  fall: number;
  /** Constant sideways lean, band-widths per second, before wind. */
  drift: number;
  /** 0..1 — fraction of cells that actually hold a flake. */
  coverage: number;
  brightness: number;
  /** 0 = crisp dot, 1 = fully out of focus. The near planes want this high. */
  softness: number;
  /** Sideways flutter amplitude, cell units. */
  sway: number;
  /** How fast that flutter cycles, Hz. */
  swayHz: number;
  /** 0..1 — brightness flutter as the plate turns edge-on and back. */
  tumble: number;
  /** Vertical elongation. >1 is the motion blur a fast near flake really has. */
  stretch: number;
  /** How much of the shared world wind this plane takes. Near planes take more. */
  windGain: number;
}

export interface SnowPreset {
  label: string;
  note?: string;
  /** Flake colour. Snow is never pure white — it takes the sky's blue. */
  tint: string;
  intensity: number;
  /** Band-widths per second per unit of world wind (see fxWind.ts). */
  windScale: number;
  /** Planes, FAR to NEAR. The validator enforces that ordering. */
  planes: SnowPlane[];
}

export interface SnowPresetFile {
  version: number;
  presets: Record<string, SnowPreset>;
}

/**
 * The performance contract, per quality tier.
 *
 * Unlike the aurora, snow has NO cheap axis but this one. It cannot be rendered
 * at a third of the resolution (a 2 px flake becomes a smudge) and it cannot be
 * re-rendered at 20 Hz (falling snow at 20 Hz strobes). The fill is one screen
 * quad — irreducible for anything covering the screen — so the only lever is how
 * many planes each fragment walks, and dropping a plane drops the whole depth
 * layer rather than thinning every layer into mush.
 */
export interface SnowQuality {
  planes: number;
}

export const SNOW_QUALITY: Record<FxTier, SnowQuality> = {
  off: { planes: 0 },
  low: { planes: 3 },
  medium: { planes: 4 },
  high: { planes: MAX_PLANES }
};

export interface SnowCost {
  /** Flakes on screen at this tier. */
  flakes: number;
  /** Worst-case fragment work per second: the screen, once per active plane.
   *  A ceiling, not a measurement — the coverage test drops most cells after
   *  two hashes. */
  fragmentsPerSecond: number;
  /** Active plane count — full-screen passes' worth of ALU per frame. */
  screenPasses: number;
  /** Per-sprite CPU updates a second the shader never has to do. This is the
   *  number that decides the technique: a sprite snowfield of this density is
   *  six figures of transform writes per second. */
  spriteUpdatesAvoided: number;
}

/** How many planes are live, given the preset, the tier and an optional slice. */
export function activePlaneCount(
  preset: SnowPreset,
  quality: SnowQuality,
  range?: [number, number]
): number {
  const capped = Math.min(preset.planes.length, quality.planes);
  if (!range) return capped;
  return Math.max(0, Math.min(capped, range[1]) - Math.min(capped, range[0]));
}

/** Which planes are live, given the preset, the tier and an optional slice. */
export function activePlanes(
  preset: SnowPreset,
  quality: SnowQuality,
  range?: [number, number]
): SnowPlane[] {
  const capped = preset.planes.slice(0, Math.min(preset.planes.length, quality.planes));
  return range ? capped.slice(range[0], range[1]) : capped;
}

/**
 * What a configuration costs and what it buys. Pure and Phaser-free, so the
 * budget is unit-testable; the REAL frame cost is measured against a plain quad
 * in tools/checks/snowtest.mjs, because only a GPU can answer that.
 */
export function costEstimate(
  width: number,
  height: number,
  quality: SnowQuality,
  preset: SnowPreset,
  frameRate = 60,
  range?: [number, number]
): SnowCost {
  const aspect = width / Math.max(1, height);
  const planes = activePlanes(preset, quality, range);
  let flakes = 0;
  for (const p of planes) flakes += Math.round(p.grid * p.grid * aspect * p.coverage);
  return {
    flakes,
    fragmentsPerSecond: width * height * frameRate * planes.length,
    screenPasses: planes.length,
    spriteUpdatesAvoided: flakes * frameRate
  };
}

/* ------------------------------------------------------------- validation - */

export function validateSnowFile(doc: SnowPresetFile): string[] {
  const errors: string[] = [];
  if (doc.version !== 1) errors.push(`version must be 1, got ${String(doc.version)}`);
  for (const [id, p] of Object.entries(doc.presets ?? {})) {
    const at = `preset "${id}"`;
    if (!p.label) errors.push(`${at}: missing label`);
    if (!/^#[0-9a-fA-F]{6}$/.test(p.tint ?? '')) errors.push(`${at}: tint "${p.tint}" is not #rrggbb`);
    if (!(p.intensity > 0)) errors.push(`${at}: intensity must be > 0`);
    if (!(p.windScale >= 0)) errors.push(`${at}: windScale must be >= 0`);
    if (!p.planes?.length) errors.push(`${at}: no planes`);
    if ((p.planes?.length ?? 0) > MAX_PLANES) {
      errors.push(`${at}: at most ${MAX_PLANES} planes (the shader unrolls ${MAX_PLANES})`);
    }

    (p.planes ?? []).forEach((l, i) => {
      const w = `${at} plane ${i}`;
      if (!(l.grid > 0)) errors.push(`${w}: grid must be > 0`);
      if (!(l.radius > 0)) errors.push(`${w}: radius must be > 0`);
      if (!(l.coverage > 0 && l.coverage <= 1)) errors.push(`${w}: coverage must be in (0, 1]`);
      if (!(l.brightness > 0)) errors.push(`${w}: brightness must be > 0`);
      if (!(l.softness >= 0 && l.softness <= 1)) errors.push(`${w}: softness must be 0..1`);
      if (!(l.tumble >= 0 && l.tumble <= 1)) errors.push(`${w}: tumble must be 0..1`);
      if (!(l.stretch >= 1)) errors.push(`${w}: stretch must be >= 1 (a flake is never squashed)`);
      if (!(l.windGain >= 0)) errors.push(`${w}: windGain must be >= 0`);

      // A flake lives entirely inside its own cell — that is what buys the
      // single-tap lookup instead of a 3×3 neighbourhood search. Blow this
      // budget and flakes get clipped at cell borders, which reads as a grid.
      const reach = l.radius * Math.max(1, l.stretch) + l.sway;
      if (reach >= 0.5) {
        errors.push(
          `${w}: radius*stretch + sway = ${reach.toFixed(3)} must stay under 0.5 cell, ` +
            'or flakes clip at the cell border'
        );
      }

      // The parallax contract: nearer planes are bigger, faster and coarser.
      // Break it and the field reads as one flat sheet of confetti.
      if (i > 0) {
        const prev = p.planes[i - 1];
        if (!(l.grid < prev.grid)) errors.push(`${w}: grid must decrease with depth (far → near)`);
        if (!(l.radius > prev.radius)) errors.push(`${w}: radius must increase with depth`);
        if (!(l.fall > prev.fall)) errors.push(`${w}: fall must increase with depth`);
      }
    });
  }
  return errors;
}
