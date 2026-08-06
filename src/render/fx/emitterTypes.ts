/**
 * The emitter preset schema — the whole authored surface of an FX emitter.
 *
 * An emitter is never one sprite. It is a STACK of layers of five kinds, each
 * doing a job no other kind can do, composited back-to-front by `z`:
 *
 *   decal      static ground contact (scorch, burn ring) — the thing that says
 *              "this effect belongs to that spot" rather than floating over it
 *   glow       a flicker-driven light pool, squashed onto the iso ground plane
 *   sheet      a looping motion-vector flipbook — the effect's actual identity
 *   particles  a Phaser emitter for discrete matter (licks, embers, sparks)
 *   puffs      pooled flipbook instances released on a timer — volumetric
 *              smoke, which particles alone cannot fake because a particle has
 *              no internal motion
 *
 * Every field is data, per the architecture law: presets live in
 * `src/data/fx-emitters.json` and nothing here reads a magic number.
 *
 * `lod` is the LEVEL-OF-DETAIL gate and it is a real one — the tier system
 * DROPS whole layers rather than dimming everything, because a fire with three
 * flame bodies at half opacity looks worse than a fire with two at full.
 *   0 = always present   1 = medium and high   2 = high only
 */
import type { FlickerOctave } from './fxSignals';

export type BlendName = 'add' | 'normal';

/** Quality tier. `off` is culled/dozing: nothing emits, nothing steps. */
export type FxTier = 'off' | 'low' | 'medium' | 'high';

export const TIER_ORDER: readonly FxTier[] = ['off', 'low', 'medium', 'high'];

/** `lod` gate -> the lowest tier at which the layer still exists. */
export const LOD_MIN_TIER: Record<0 | 1 | 2, FxTier> = { 0: 'low', 1: 'medium', 2: 'high' };

export interface LayerCommon {
  id: string;
  /** Draw order inside the stack; added to the rig's base depth. */
  z: number;
  /** Offset from the emitter anchor, in game-space px (2560×1600). */
  dx?: number;
  dy?: number;
  lod?: 0 | 1 | 2;
}

/** Static ground contact. Blend `normal` so it can DARKEN — ADD cannot. */
export interface DecalLayer extends LayerCommon {
  kind: 'decal';
  texture: string;
  width: number;
  /** Vertical squash. 0.5 lays a circle flat on the iso ground plane. */
  squash?: number;
  alpha?: number;
  tint?: string;
  blend?: BlendName;
}

/** Flicker-driven light pool. */
export interface GlowLayer extends LayerCommon {
  kind: 'glow';
  texture: string;
  width: number;
  squash?: number;
  tint?: string;
  blend?: BlendName;
  alpha: { base: number; amp: number };
  /** Radius modulation as a fraction of `width`. */
  scaleAmp?: number;
  /** Sample the flicker this far in the PAST, so the light trails the flame. */
  lagMs?: number;
  /** Offset into the shared flicker field. */
  flickerPhase?: number;
}

/** A looping motion-vector flipbook — the body of the effect. */
export interface SheetLayer extends LayerCommon {
  kind: 'sheet';
  sheet: string;
  ramp: string;
  /** Display width in px. */
  width: number;
  /**
   * Display height in px. Defaults to the sheet cell's own aspect, which for
   * `fb_flame_small` (64×128) is a narrow 1:2 column — a candle, not a
   * campfire. Setting it explicitly is not a hack: non-uniform scaling of
   * flame art is how every fire in this genre is shaped to its prop.
   */
  height?: number;
  fps: number;
  emissive: number;
  alpha: number;
  blend?: BlendName;
  tint?: string;
  /** `base` pins the bottom edge — a flame is rooted, it does not scale about
   *  its middle. `center` is right for anything airborne. */
  anchor?: 'base' | 'center';
  /** Start offset into the loop, 0..1. Siblings MUST differ or they lock step. */
  phase?: number;
  /** Offset into the shared flicker field. */
  flickerPhase?: number;
  /** Alpha swing from the flicker, ± this much. */
  flickerAmp?: number;
  /** Height breathing as a fraction, ± this much. */
  breathe?: number;
  /** Lateral wander in px at full flicker swing. */
  swayPx?: number;
  /** Degrees of lean about the anchor per unit of wind speed. A rooted flame
   *  bends; it does not slide. Rotating about the base IS the bend. */
  leanDeg?: number;
}

export interface ParticleAlphaSpec {
  peak: number;
  /** Fraction of the life spent fading in. */
  rise?: number;
  /** Aperiodic brightness scintillation. */
  twinkleHz?: number;
  twinkleAmp?: number;
  /** Shoulder of the fade-out; >1 fades gently then quickly. */
  tail?: number;
}

export interface ParticleLayer extends LayerCommon {
  kind: 'particles';
  texture: string;
  blend?: BlendName;
  /** ms between emissions. */
  frequency: number;
  quantity?: number | [number, number];
  lifespan: [number, number];
  speedX?: [number, number];
  speedY?: [number, number];
  /** Positive = decelerating rise: buoyancy bleeding off, not gravity. */
  accelerationY?: number;
  gravityY?: number;
  scale: { start: number; end: number; ease?: string };
  /** Separate Y scale streaks the sprite; pair with `alignToVelocity`. */
  scaleY?: { start: number; end: number; ease?: string };
  /** Colour over life — cooling, from white-hot to dead coal. */
  color?: string[];
  colorEase?: string;
  alpha: ParticleAlphaSpec;
  /** Emission footprint, px. Make y ≈ x/2: an iso ground ellipse, not a box. */
  spread?: [number, number];
  /** Per-particle lateral wander. Every particle gets its own phase. */
  sway?: { px: number; cycles: number };
  /** px/s² of sideways acceleration per unit of wind speed. */
  windGain?: number;
  /** Point the sprite along its velocity. */
  alignToVelocity?: boolean;
  rotate?: [number, number];
}

/** Pooled flipbook puffs — volumetric smoke. */
export interface PuffLayer extends LayerCommon {
  kind: 'puffs';
  sheet: string;
  ramp: string;
  blend?: BlendName;
  tint?: string;
  emissive?: number;
  /** Pool size; also the hard cap on simultaneous puffs. */
  pool: number;
  releaseMs: [number, number];
  lifeMs: [number, number];
  /** Display width at birth and at death — smoke expands as it cools, and its
   *  density (so its alpha) drops as it does. */
  width: [number, number];
  /** Climb over the life, px. Eased out: buoyancy decays. */
  risePx: [number, number];
  spreadPx: number;
  alpha: { peak: number; peakAt: number; tail?: number };
  /** Degrees of roll across the life; the sign is randomised per puff. */
  spinDeg: [number, number];
  /** Lateral drift in px at the top of the climb, per unit of wind speed.
   *  Applied on an easing curve so a puff catches more wind as it rises. */
  windLean: number;
  /** Playback rate range — each puff gets its own so none play in unison. */
  fps: [number, number];
}

export type FxLayer = DecalLayer | GlowLayer | SheetLayer | ParticleLayer | PuffLayer;

export interface FxPreset {
  label: string;
  /** What this emitter is for, in one line — shown in the lab. */
  note?: string;
  /** The shared flicker field every layer of this emitter samples. */
  flicker: { octaves: FlickerOctave[]; seed: number };
  /** How strongly this emitter reacts to the world wind field. */
  windInfluence: number;
  /** Cull radius in px around the anchor — the stack's furthest reach. */
  radiusPx: number;
  layers: FxLayer[];
}

export interface FxPresetFile {
  version: number;
  /** Bank sheets the presets reference; preload these before spawning. */
  sheets: string[];
  /** Bank particle stills, keyed by the texture name presets use. */
  textures: Record<string, string>;
  presets: Record<string, FxPreset>;
}

/* -------------------------------- validation ------------------------------- */

/**
 * Structural check with real messages — run by the unit test and by the lab on
 * every import, so a hand-edited preset fails loudly instead of rendering
 * nothing and leaving you to guess which field was misspelt.
 */
export function validatePresetFile(doc: FxPresetFile): string[] {
  const errors: string[] = [];
  if (doc.version !== 1) errors.push(`version must be 1, got ${String(doc.version)}`);
  if (!Array.isArray(doc.sheets)) errors.push('sheets must be an array');
  if (!doc.textures || typeof doc.textures !== 'object') errors.push('textures must be an object');

  const knownSheets = new Set(doc.sheets ?? []);
  const knownTextures = new Set(Object.keys(doc.textures ?? {}));

  for (const [id, preset] of Object.entries(doc.presets ?? {})) {
    const where = `preset "${id}"`;
    if (!preset.label) errors.push(`${where}: missing label`);
    if (!(preset.radiusPx > 0)) errors.push(`${where}: radiusPx must be > 0`);
    if (!preset.flicker?.octaves?.length) errors.push(`${where}: flicker needs at least one octave`);
    if (!preset.layers?.length) errors.push(`${where}: no layers`);

    const ids = new Set<string>();
    for (const layer of preset.layers ?? []) {
      const at = `${where} layer "${layer.id}"`;
      if (ids.has(layer.id)) errors.push(`${at}: duplicate id`);
      ids.add(layer.id);
      if (typeof layer.z !== 'number') errors.push(`${at}: z must be a number`);
      if (layer.lod !== undefined && ![0, 1, 2].includes(layer.lod)) errors.push(`${at}: lod must be 0, 1 or 2`);

      switch (layer.kind) {
        case 'decal':
        case 'glow':
          if (!knownTextures.has(layer.texture)) errors.push(`${at}: unknown texture "${layer.texture}"`);
          if (!(layer.width > 0)) errors.push(`${at}: width must be > 0`);
          break;
        case 'sheet':
          if (!knownSheets.has(layer.sheet)) errors.push(`${at}: sheet "${layer.sheet}" is not in the sheets list`);
          if (!(layer.width > 0)) errors.push(`${at}: width must be > 0`);
          if (!(layer.fps > 0)) errors.push(`${at}: fps must be > 0`);
          break;
        case 'particles':
          if (!knownTextures.has(layer.texture)) errors.push(`${at}: unknown texture "${layer.texture}"`);
          if (!(layer.frequency > 0)) errors.push(`${at}: frequency must be > 0`);
          if (!isRange(layer.lifespan)) errors.push(`${at}: lifespan must be [min, max] with min <= max`);
          break;
        case 'puffs':
          if (!knownSheets.has(layer.sheet)) errors.push(`${at}: sheet "${layer.sheet}" is not in the sheets list`);
          if (!(layer.pool > 0)) errors.push(`${at}: pool must be > 0`);
          for (const key of ['releaseMs', 'lifeMs', 'width', 'risePx', 'spinDeg', 'fps'] as const) {
            if (!isRange(layer[key])) errors.push(`${at}: ${key} must be [min, max] with min <= max`);
          }
          break;
        default:
          errors.push(`${at}: unknown kind "${(layer as { kind: string }).kind}"`);
      }
    }

    // Two flipbook instances of one sheet that share a phase play in perfect
    // unison and read as a single doubled sprite — the reason to layer at all.
    const byPhase = new Map<string, string[]>();
    for (const layer of preset.layers ?? []) {
      if (layer.kind !== 'sheet') continue;
      const key = `${layer.sheet}@${(layer.phase ?? 0).toFixed(3)}:${layer.fps}`;
      byPhase.set(key, [...(byPhase.get(key) ?? []), layer.id]);
    }
    for (const [key, members] of byPhase) {
      if (members.length > 1) errors.push(`${where}: layers ${members.join(', ')} share sheet phase+fps (${key})`);
    }
  }
  return errors;
}

const isRange = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && v[0] <= v[1];
