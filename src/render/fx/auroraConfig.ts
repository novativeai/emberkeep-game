/**
 * The Phaser-free half of the aurora: its schema, its quality contract and its
 * cost model. Split out so the performance budget is something a unit test can
 * hold us to in node, rather than a claim in a comment.
 */
import type { FxTier } from './emitterTypes';

/**
 * Palette stops, bottom of the curtain to the top. Declared HERE rather than
 * beside the shader so this module stays Phaser-free and the config, the
 * validator and the cost model can all be unit-tested in node.
 */
export const RAMP_STOPS = 5;

/** One curtain of the display. */
export interface AuroraLayer {
  /** Decorrelates this curtain's noise from its siblings. */
  seed: number;
  /** Horizontal frequency of the ray striations. Higher = finer rays. */
  rayFreq: number;
  /** How far the lower border folds, in band heights. */
  foldAmp: number;
  brightness: number;
  /** Height of the curtain's lower border, 0 = bottom of the band. */
  baseY: number;
  /** Vertical extent of the curtain. */
  thickness: number;
  /** Horizontal travel of the ray structure. */
  drift: number;
  /** How fast the rays shimmer in place. */
  shimmer: number;
}

export interface AuroraPreset {
  label: string;
  note?: string;
  /** Curtain colour bottom → top. Exactly RAMP_STOPS entries. */
  ramp: string[];
  intensity: number;
  /** Detail of the fBm. 2 is soft, 4 is crisp; each step costs real time. */
  octaves: number;
  /** Sub-LSB output dither in 1/255 units — the anti-banding pass. */
  dither: number;
  surgeSpeed: number;
  surgeWidth: number;
  surgeGain: number;
  /** Fraction of the band over which the whole thing dissolves into the sky. */
  fadeBottom: number;
  layers: AuroraLayer[];
}

export interface AuroraPresetFile {
  version: number;
  presets: Record<string, AuroraPreset>;
}

/** The performance contract, per quality tier. */
export interface AuroraQuality {
  /** Render the band at 1/scale resolution, then blit it up. */
  scale: number;
  /** Re-renders per second. The blit stays at the game's frame rate. */
  fps: number;
  /** Cap on the preset's octaves. */
  maxOctaves: number;
}

/**
 * `high` and `medium` deliberately SHARE a resolution.
 *
 * They are the only two tiers the power governor moves between at runtime
 * (active ↔ idle), and a change of `scale` resizes the render target — which
 * destroys and reallocates a ~0.9 MB GPU texture. `pointermove` is a wake
 * source, so a player whose cursor drifts across the window every few seconds
 * would reallocate that texture every few seconds, forever. Making the two
 * share a scale means the governor's transition allocates nothing at all; the
 * saving comes from the re-render RATE and the octave count instead, which cost
 * nothing to change. A unit test pins this.
 *
 * `low` is never entered by the governor — it is for the lab and for a future
 * device tier chosen once at boot — so it is free to drop resolution too.
 */
export const AURORA_QUALITY: Record<FxTier, AuroraQuality> = {
  // `off` never renders; the values only keep the record total.
  off: { scale: 5, fps: 0, maxOctaves: 2 },
  low: { scale: 5, fps: 10, maxOctaves: 2 },
  medium: { scale: 3, fps: 15, maxOctaves: 3 },
  high: { scale: 3, fps: 20, maxOctaves: 4 }
};

/**
 * Fragment-shader work a configuration asks for, per second, relative to the
 * naive full-resolution every-frame version at 4 octaves. 1.0 = the naive cost.
 * Phaser-free and pure, so the budget is unit-testable rather than a claim.
 */
export function costEstimate(
  width: number,
  height: number,
  quality: AuroraQuality,
  octaves: number,
  frameRate = 60
): { fragmentsPerSecond: number; relativeToNaive: number } {
  const oct = Math.min(octaves, quality.maxOctaves);
  const px = (width / quality.scale) * (height / quality.scale);
  const fragments = px * quality.fps;
  // Octave count is the per-fragment multiplier; the naive baseline is the full
  // band, every frame, at the full octave count.
  const naive = width * height * frameRate * 4;
  return {
    fragmentsPerSecond: fragments * oct,
    relativeToNaive: (fragments * oct) / naive
  };
}

/* ------------------------------------------------------------- validation - */

export function validateAuroraFile(doc: AuroraPresetFile): string[] {
  const errors: string[] = [];
  if (doc.version !== 1) errors.push(`version must be 1, got ${String(doc.version)}`);
  for (const [id, p] of Object.entries(doc.presets ?? {})) {
    const at = `preset "${id}"`;
    if (!p.label) errors.push(`${at}: missing label`);
    if (p.ramp?.length !== RAMP_STOPS) errors.push(`${at}: ramp needs exactly ${RAMP_STOPS} stops`);
    for (const hex of p.ramp ?? []) {
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) errors.push(`${at}: "${hex}" is not #rrggbb`);
    }
    if (!(p.octaves >= 1 && p.octaves <= 5)) errors.push(`${at}: octaves must be 1..5`);
    if (!(p.intensity > 0)) errors.push(`${at}: intensity must be > 0`);
    if (p.dither < 0) errors.push(`${at}: dither must be >= 0`);
    if (!p.layers?.length) errors.push(`${at}: no layers`);
    if ((p.layers?.length ?? 0) > 3) errors.push(`${at}: at most 3 layers (the shader unrolls 3)`);
    const seeds = new Set<number>();
    for (const l of p.layers ?? []) {
      if (seeds.has(l.seed)) errors.push(`${at}: two layers share seed ${l.seed} — they will fold identically`);
      seeds.add(l.seed);
      if (!(l.thickness > 0)) errors.push(`${at}: a layer has thickness <= 0`);
      if (!(l.rayFreq > 0)) errors.push(`${at}: a layer has rayFreq <= 0`);
    }
  }
  return errors;
}
