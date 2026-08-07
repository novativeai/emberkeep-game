/**
 * FxEmitterRig — one authored emitter preset, alive in a scene.
 *
 * Render-layer only: it never touches systems or GameState, and time arrives
 * through an injected `now()` (wire it to GameClock) so the whole stack replays
 * identically under `window.advanceTime(ms)`.
 *
 * ## The composition rule
 *
 * A layer is added only when it does a job no other layer can:
 *
 *   - three `sheet` layers of ONE flipbook at different sizes, rates and
 *     phases give a flame parallax and internal depth for zero extra VRAM,
 *     because they share a texture. Two instances at the same phase and fps are
 *     a rendering mistake, not a layer — `validatePresetFile` rejects them.
 *   - `glow` sampled at `now - lagMs` puts the ground light BEHIND the flame in
 *     time, which is what makes it read as light cast by the fire.
 *   - `puffs` exist because a particle has no internal motion. Scaling a
 *     smoke sprite up gives you a growing sprite; a flipbook puff churns while
 *     it grows, which is the entire difference between smoke and a balloon.
 *   - `particles` carry discrete matter — licks, embers, sparks — where the
 *     count and the per-item variation are the point.
 *
 * ## Degradation
 *
 * Every layer resolves its texture at build time and is SKIPPED if the art is
 * not loaded (`missing` records what). A rig with no bank deployed still runs
 * its particle layers; nothing throws, nothing renders magenta.
 */
import Phaser from 'phaser';

import { FlipbookFX, type FlipbookSheet } from '../FlipbookFX';
import { sheetOf } from '../vfxBank';
import {
  bell,
  clamp01,
  flicker,
  hash01,
  hexToInt,
  lerp,
  easeInQuad,
  easeOutCubic,
  easeOutQuad,
  modulate,
  valueNoise
} from './fxSignals';
import { STILL, type WindSample } from './fxWind';
import {
  LOD_MIN_TIER,
  TIER_ORDER,
  type DecalLayer,
  type FxLayer,
  type FxPreset,
  type FxTier,
  type GlowLayer,
  type ParticleLayer,
  type PuffLayer,
  type SheetLayer
} from './emitterTypes';

/**
 * Per-INSTANCE shaping, applied on top of the preset.
 *
 * The preset says what a fire is; this says what THIS fire is. A brazier on a
 * windy ledge, a low wide cook-fire, a tall thin torch and a chimney plume are
 * all the same two presets — separating them here is what stops the preset
 * roster growing a variant every time a placement needs to look slightly
 * different. Every field defaults to neutral, so an instance that sets nothing
 * is exactly the preset.
 */
export interface RigInstance {
  /** Horizontal extent multiplier — the emitter's base width. */
  widthScale: number;
  /** Vertical extent multiplier — how tall the flame or plume stands. */
  heightScale: number;
  /** Constant lean in degrees about the base, ADDED to the wind lean. A fire
   *  against a wall or on a slope leans even in still air. */
  tiltDeg: number;
  /** Mirror the stack. Source flame art is asymmetric, so this is a real look
   *  change and the cheapest way to stop two neighbours reading as copies. */
  flipX: boolean;
  /** Rotation of the GROUND-plane layers (scorch, light pool), degrees — so a
   *  burn mark can align to a wall instead of the world axes. */
  groundRotDeg: number;
  /** Emission-rate multiplier for BOTH particle layers and puff release.
   *  >1 = more, denser. It has to cover puffs: in a smoke-led emitter the puff
   *  layer is the density, so thinning only the particles changes nothing. */
  rate: number;
  /** Overrides the preset's wind sensitivity. `null` keeps the preset's. */
  windInfluence: number | null;
}

export const NEUTRAL_INSTANCE: RigInstance = {
  widthScale: 1,
  heightScale: 1,
  tiltDeg: 0,
  flipX: false,
  groundRotDeg: 0,
  rate: 1,
  windInfluence: null
};

export interface RigOptions extends Partial<RigInstance> {
  /** Clock the whole rig reads. Wire to GameClock.now in game. */
  now: () => number;
  /** Base depth; every layer adds its `z`. World emitters pass
   *  `DEPTHS.itemBase + screenY` so terrain in front still occludes them. */
  depth: number;
  /** Uniform scale on the stack. */
  scale?: number;
  /** Per-instance seed — two braziers of the same preset must not flicker
   *  in unison, and this is the only thing standing between them and that. */
  seed?: number;
  /** Recolour the whole emitter by overriding every layer's ramp. */
  ramp?: string;
  /**
   * Instance colour, dark → bright: `[rim, mid, core]`.
   *
   * Layers that declare `palette` take their tint from here instead of their
   * own, which is what lets ONE preset be five different dragons' auras rather
   * than five near-identical presets drifting apart in five places. Construction
   * -time, like `ramp`: a particle emitter's colour ramp is baked into its
   * config, so changing it means a new rig, and an egg never changes colour.
   */
  palette?: string[];
  /** Master opacity over the stack. */
  alpha?: number;
}

/** Per-particle scratch. Phaser hands the same object back on every update. */
interface FxParticle extends Phaser.GameObjects.Particles.Particle {
  fxSeed?: number;
  /** Sway already applied, so the next frame can add only the delta. */
  fxSway?: number;
}

/** Emission rate multiplier per tier — higher number, fewer particles. */
const TIER_FREQUENCY: Record<FxTier, number> = { off: 1, low: 2.8, medium: 1.7, high: 1 };
/** Fraction of the authored puff pool a tier is allowed to keep alive. */
const TIER_POOL: Record<FxTier, number> = { off: 0, low: 0.35, medium: 0.6, high: 1 };

const blendOf = (b: string | undefined): number =>
  b === 'normal' ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD;

interface DecalRT { kind: 'decal'; spec: DecalLayer; obj: Phaser.GameObjects.Image }
interface GlowRT { kind: 'glow'; spec: GlowLayer; obj: Phaser.GameObjects.Image }
interface SheetRT { kind: 'sheet'; spec: SheetLayer; obj: FlipbookFX; height: number }
interface ParticleRT { kind: 'particles'; spec: ParticleLayer; obj: Phaser.GameObjects.Particles.ParticleEmitter }
interface PuffSlot {
  fx: FlipbookFX;
  active: boolean;
  startMs: number;
  lifeMs: number;
  dx: number;
  dy: number;
  rise: number;
  widthA: number;
  widthB: number;
  spin: number;
  swayPhase: number;
}
interface PuffRT {
  kind: 'puffs';
  spec: PuffLayer;
  sheet: FlipbookSheet;
  slots: PuffSlot[];
  nextAt: number;
  released: number;
}
type LayerRT = DecalRT | GlowRT | SheetRT | ParticleRT | PuffRT;

export class FxEmitterRig {
  readonly preset: FxPreset;
  /** Layers whose art was not loaded, so the caller can say so out loud. */
  readonly missing: string[] = [];

  private readonly scene: Phaser.Scene;
  private readonly nowFn: () => number;
  private readonly seed: number;
  private readonly rampOverride?: string;
  private readonly paletteOverride?: string[];
  private readonly layers: LayerRT[] = [];

  private x: number;
  private y: number;
  private depth: number;
  private uniform: number;
  private master: number;
  private readonly inst: RigInstance;
  private tier: FxTier = 'high';
  /** Wind as of this frame; the particle emit closures read it. */
  private wind: WindSample = STILL;
  private emitCounter = 0;

  constructor(scene: Phaser.Scene, preset: FxPreset, x: number, y: number, opts: RigOptions) {
    this.scene = scene;
    this.preset = preset;
    this.nowFn = opts.now;
    this.x = x;
    this.y = y;
    this.depth = opts.depth;
    this.uniform = opts.scale ?? 1;
    this.master = opts.alpha ?? 1;
    this.seed = (opts.seed ?? 0) + preset.flicker.seed;
    this.rampOverride = opts.ramp;
    this.paletteOverride = opts.palette?.length ? opts.palette : undefined;
    this.inst = {
      widthScale: opts.widthScale ?? NEUTRAL_INSTANCE.widthScale,
      heightScale: opts.heightScale ?? NEUTRAL_INSTANCE.heightScale,
      tiltDeg: opts.tiltDeg ?? NEUTRAL_INSTANCE.tiltDeg,
      flipX: opts.flipX ?? NEUTRAL_INSTANCE.flipX,
      groundRotDeg: opts.groundRotDeg ?? NEUTRAL_INSTANCE.groundRotDeg,
      rate: opts.rate ?? NEUTRAL_INSTANCE.rate,
      windInfluence: opts.windInfluence ?? NEUTRAL_INSTANCE.windInfluence
    };

    for (const layer of [...preset.layers].sort((a, b) => a.z - b.z)) {
      const rt = this.build(layer);
      if (rt) this.layers.push(rt);
      else this.missing.push(layer.id);
    }
    this.applyTier('high');
    this.update(this.nowFn(), STILL, 'high');
  }

  /* ------------------------------- lifecycle ------------------------------- */

  setPosition(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  setDepth(depth: number): this {
    this.depth = depth;
    for (const l of this.layers) {
      if (l.kind === 'puffs') for (const s of l.slots) s.fx.setDepth(depth + l.spec.z);
      else l.obj.setDepth(depth + l.spec.z);
    }
    return this;
  }

  setScale(scale: number): this {
    this.uniform = scale;
    return this;
  }

  setMasterAlpha(alpha: number): this {
    this.master = alpha;
    return this;
  }

  /** Current per-instance shaping — the worldbuilder reads this back. */
  get instance(): Readonly<RigInstance> {
    return this.inst;
  }

  /**
   * Retune this instance LIVE. Sizes and angles are read fresh every frame, so
   * they take effect on the next one; `flipX` and `rate` are sticky GPU/emitter
   * state and are re-applied here. Nothing rebuilds — a tuning slider must not
   * restart the flame it is tuning.
   */
  setInstance(patch: Partial<RigInstance>): this {
    Object.assign(this.inst, patch);
    if (patch.flipX !== undefined) {
      for (const l of this.layers) {
        if (l.kind === 'sheet' || l.kind === 'decal' || l.kind === 'glow') l.obj.setFlipX(this.inst.flipX);
      }
    }
    if (patch.rate !== undefined) this.applyRates();
    return this;
  }

  /** Radius used for culling, in world px. */
  get radius(): number {
    return this.preset.radiusPx * this.uniform;
  }

  get position(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  /** Current quality tier — diagnostics and the lab's readout. */
  get currentTier(): FxTier {
    return this.tier;
  }

  destroy(): void {
    for (const l of this.layers) {
      if (l.kind === 'puffs') for (const s of l.slots) s.fx.destroy();
      else l.obj.destroy();
    }
    this.layers.length = 0;
  }

  /* --------------------------------- update -------------------------------- */

  /**
   * Advance the whole stack. Call once per frame from the director.
   *
   * `tier` is the only quality knob: it drops layers rather than dimming them,
   * because a fire missing its core still looks like fire, while a fire with
   * every layer at half opacity looks like a mistake.
   */
  update(now: number, wind: WindSample, tier: FxTier): void {
    this.wind = wind;
    if (tier !== this.tier) this.applyTier(tier);
    if (tier === 'off') {
      for (const l of this.layers) if (l.kind === 'puffs') this.stepPuffs(l, now, wind, true);
      return;
    }

    const oct = this.preset.flicker.octaves;
    const w = wind.x * this.windInfluence();
    const s = this.uniform;
    const sx = s * this.inst.widthScale;
    const sy = s * this.inst.heightScale;
    const mirror = this.inst.flipX ? -1 : 1;

    for (const l of this.layers) {
      if (!this.tierHas(l.spec.lod ?? 0)) continue;
      // The layer's own offset is part of the stack's shape, so it scales and
      // mirrors with it — otherwise flipping a fire leaves its licks behind.
      const lx = this.x + (l.spec.dx ?? 0) * sx * mirror;
      const ly = this.y + (l.spec.dy ?? 0) * sy;

      switch (l.kind) {
        case 'decal': {
          l.obj.setPosition(lx, ly);
          l.obj.setDisplaySize(l.spec.width * sx, l.spec.width * (l.spec.squash ?? 1) * sy);
          l.obj.setAngle(this.inst.groundRotDeg);
          l.obj.setAlpha((l.spec.alpha ?? 1) * this.master);
          break;
        }
        case 'glow': {
          // Sampling in the PAST is the whole trick: the light peaks after the
          // flame does, so it reads as cast by it rather than drawn with it.
          const f = flicker(now - (l.spec.lagMs ?? 0), oct, this.seed, l.spec.flickerPhase ?? 0);
          const k = 1 + (f - 0.5) * 2 * (l.spec.scaleAmp ?? 0);
          l.obj.setPosition(lx, ly);
          l.obj.setDisplaySize(l.spec.width * k * sx, l.spec.width * (l.spec.squash ?? 1) * k * sy);
          l.obj.setAngle(this.inst.groundRotDeg);
          l.obj.setAlpha(clamp01(modulate(l.spec.alpha.base, l.spec.alpha.amp, f)) * this.master);
          break;
        }
        case 'sheet': {
          const f = flicker(now, oct, this.seed, l.spec.flickerPhase ?? 0);
          // Width stays steady, height breathes: a flame stretches upward as it
          // surges, it does not inflate like a balloon.
          const h = l.height * (1 + (f - 0.5) * 2 * (l.spec.breathe ?? 0)) * sy;
          l.obj.setDisplaySize(l.spec.width * sx, h);
          l.obj.setPosition(lx + (f - 0.5) * 2 * (l.spec.swayPx ?? 0) * sx * mirror, ly);
          // Rooted at the base, so rotation IS a bend rather than a slide. The
          // instance tilt is a standing lean the wind then pushes further.
          l.obj.setAngle(this.inst.tiltDeg + w * (l.spec.leanDeg ?? 0));
          l.obj.setMasterAlpha(clamp01(l.spec.alpha * (1 + (f - 0.5) * 2 * (l.spec.flickerAmp ?? 0))) * this.master);
          break;
        }
        case 'particles': {
          l.obj.setPosition(lx, ly);
          break;
        }
        case 'puffs': {
          this.stepPuffs(l, now, wind, false);
          break;
        }
      }
    }
  }

  /** The preset's wind sensitivity, unless this instance overrides it. */
  private windInfluence(): number {
    return this.inst.windInfluence ?? this.preset.windInfluence;
  }

  /* ---------------------------------- tiers -------------------------------- */

  private tierHas(lod: 0 | 1 | 2): boolean {
    return TIER_ORDER.indexOf(this.tier) >= TIER_ORDER.indexOf(LOD_MIN_TIER[lod]);
  }

  private applyTier(tier: FxTier): void {
    this.tier = tier;
    for (const l of this.layers) {
      const on = tier !== 'off' && this.tierHas(l.spec.lod ?? 0);
      switch (l.kind) {
        case 'decal':
        case 'glow':
          l.obj.setVisible(on);
          break;
        case 'sheet':
          l.obj.setVisible(on);
          l.obj.setPaused(!on);
          break;
        case 'particles':
          l.obj.frequency = this.frequencyOf(l.spec);
          l.obj.emitting = on;
          break;
        case 'puffs':
          // Live puffs are allowed to finish; only new releases stop, so a
          // doze never snaps a column of smoke out of existence.
          for (const s of l.slots) s.fx.setPaused(!on && !s.active);
          break;
      }
    }
  }

  private puffCap(pool: number): number {
    return Math.max(0, Math.round(pool * TIER_POOL[this.tier]));
  }

  /** `frequency` is ms BETWEEN emissions, so a higher rate divides it. */
  private frequencyOf(spec: ParticleLayer): number {
    return (spec.frequency * TIER_FREQUENCY[this.tier]) / Math.max(0.05, this.inst.rate);
  }

  private applyRates(): void {
    for (const l of this.layers) if (l.kind === 'particles') l.obj.frequency = this.frequencyOf(l.spec);
  }

  /* --------------------------------- build --------------------------------- */

  private build(spec: FxLayer): LayerRT | undefined {
    switch (spec.kind) {
      case 'decal':
        return this.buildDecal(spec);
      case 'glow':
        return this.buildGlow(spec);
      case 'sheet':
        return this.buildSheet(spec);
      case 'particles':
        return this.buildParticles(spec);
      case 'puffs':
        return this.buildPuffs(spec);
    }
  }

  private image(texture: string, blend: string | undefined, z: number): Phaser.GameObjects.Image | undefined {
    if (!this.scene.textures.exists(texture)) return undefined;
    return this.scene.add
      .image(this.x, this.y, texture)
      .setDepth(this.depth + z)
      .setBlendMode(blendOf(blend));
  }

  /**
   * One stop of the instance palette, or undefined if this layer did not ask
   * for one (or no palette was supplied — every existing preset).
   */
  private paletteStop(want: FxLayer['palette']): string | undefined {
    const p = this.paletteOverride;
    if (!p?.length || !want || want === 'ramp') return undefined;
    const i = want === 'rim' ? 0 : want === 'mid' ? 1 : want === 'core' ? 2 : 3;
    return p[Math.min(i, p.length - 1)];
  }

  /** The colour a layer should wear: its palette stop if it asked for one,
   *  otherwise its authored tint, otherwise the art's own colours. */
  private tintOf(spec: FxLayer & { tint?: string }): number | undefined {
    const stop = this.paletteStop(spec.palette);
    if (stop !== undefined) return hexToInt(stop);
    return spec.tint ? hexToInt(spec.tint) : undefined;
  }

  private buildDecal(spec: DecalLayer): DecalRT | undefined {
    const obj = this.image(spec.texture, spec.blend ?? 'normal', spec.z);
    if (!obj) return undefined;
    const tint = this.tintOf(spec);
    if (tint !== undefined) obj.setTint(tint);
    obj.setFlipX(this.inst.flipX);
    return { kind: 'decal', spec, obj };
  }

  private buildGlow(spec: GlowLayer): GlowRT | undefined {
    const obj = this.image(spec.texture, spec.blend ?? 'add', spec.z);
    if (!obj) return undefined;
    const tint = this.tintOf(spec);
    if (tint !== undefined) obj.setTint(tint);
    obj.setFlipX(this.inst.flipX);
    return { kind: 'glow', spec, obj };
  }

  private buildSheet(spec: SheetLayer): SheetRT | undefined {
    const sheet = sheetOf(spec.sheet);
    if (!sheet || !this.scene.textures.exists(`${sheet.key}_pack`)) return undefined;
    const fps = spec.fps;
    const fx = new FlipbookFX(this.scene, sheet, this.x, this.y, this.nowFn, {
      ramp: this.rampOverride ?? spec.ramp,
      tint: this.tintOf(spec),
      fps,
      loop: true,
      emissive: spec.emissive,
      alpha: spec.alpha,
      blend: blendOf(spec.blend ?? 'add'),
      destroyOnComplete: false
    });
    // Phase is a FRACTION of the loop; converting here means the preset stays
    // readable when the sheet's frame count or rate changes.
    fx.replay(((spec.phase ?? 0) % 1) * (sheet.frames / fps) * 1000);
    // A flame is rooted: pin the bottom edge so breathing grows it upward and
    // rotation bends it, instead of scaling and pivoting about the middle.
    fx.setOrigin(0.5, spec.anchor === 'center' ? 0.5 : 1);
    fx.setFlipX(this.inst.flipX);
    fx.setDepth(this.depth + spec.z);
    this.scene.add.existing(fx);
    const height = spec.height ?? (spec.width * sheet.cellH) / sheet.cellW;
    return { kind: 'sheet', spec, obj: fx, height };
  }

  private buildParticles(spec: ParticleLayer): ParticleRT | undefined {
    if (!this.scene.textures.exists(spec.texture)) return undefined;
    const seed = this.seed;
    const rig = this;

    const sway = spec.sway;
    const twinkleHz = spec.alpha.twinkleHz ?? 0;
    const twinkleAmp = spec.alpha.twinkleAmp ?? 0;

    const cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig = {
      frequency: spec.frequency,
      quantity: Array.isArray(spec.quantity)
        ? { min: spec.quantity[0], max: spec.quantity[1] }
        : (spec.quantity ?? 1),
      lifespan: { min: spec.lifespan[0], max: spec.lifespan[1] },
      blendMode: blendOf(spec.blend ?? 'add'),
      // Stamp a per-particle seed so twinkle and sway differ item to item;
      // without it every ember pulses on the same beat and the swarm strobes.
      emitCallback: (p: Phaser.GameObjects.Particles.Particle) => {
        const q = p as FxParticle;
        q.fxSeed = hash01(seed + rig.emitCounter++ * 7919);
        q.fxSway = 0;
      },
      alpha: {
        onEmit: () => 0,
        onUpdate: (p: Phaser.GameObjects.Particles.Particle, _k: string, t: number) => {
          const q = p as FxParticle;
          let a = spec.alpha.peak * bell(t, spec.alpha.rise ?? 0.1, spec.alpha.tail ?? 1.3);
          if (twinkleHz > 0 && twinkleAmp > 0) {
            const tw = valueNoise(((t * p.life) / 1000) * twinkleHz + (q.fxSeed ?? 0) * 97, seed);
            a *= 1 - twinkleAmp + twinkleAmp * 2 * tw;
          }
          return clamp01(a * rig.master);
        }
      }
    };

    if (spec.speedX) cfg.speedX = { min: spec.speedX[0], max: spec.speedX[1] };
    if (spec.speedY) cfg.speedY = { min: spec.speedY[0], max: spec.speedY[1] };
    if (spec.gravityY !== undefined) cfg.gravityY = spec.gravityY;
    if (spec.accelerationY !== undefined) cfg.accelerationY = spec.accelerationY;
    if (spec.windGain) {
      // Wind as an ACCELERATION, sampled at emit: physically what wind does to
      // a mote, and it makes a gust visibly sweep through the column rather
      // than teleport every live particle sideways at once.
      const gain = spec.windGain;
      cfg.accelerationX = { onEmit: () => rig.wind.x * rig.windInfluence() * gain };
    }

    if (spec.scaleY) {
      cfg.scaleX = { start: spec.scale.start, end: spec.scale.end, ease: spec.scale.ease ?? 'Linear' };
      cfg.scaleY = { start: spec.scaleY.start, end: spec.scaleY.end, ease: spec.scaleY.ease ?? 'Linear' };
    } else {
      cfg.scale = { start: spec.scale.start, end: spec.scale.end, ease: spec.scale.ease ?? 'Linear' };
    }

    // A particle layer has no `tint` — its colour IS the ramp over its life, so
    // the palette lands here: the whole palette for 'ramp', a single stop for
    // one of the named stops.
    const stop = this.paletteStop(spec.palette);
    const colors =
      spec.palette === 'ramp' && this.paletteOverride?.length
        ? this.paletteOverride
        : stop !== undefined
          ? [stop]
          : spec.color;
    if (colors?.length) {
      cfg.color = colors.map(hexToInt);
      cfg.colorEase = spec.colorEase ?? 'linear';
    }

    if (spec.alignToVelocity) {
      cfg.rotate = {
        onEmit: () => 0,
        onUpdate: (p: Phaser.GameObjects.Particles.Particle) =>
          Phaser.Math.RadToDeg(Math.atan2(p.velocityY, p.velocityX))
      };
    } else if (spec.rotate) {
      cfg.rotate = { min: spec.rotate[0], max: spec.rotate[1] };
    }

    if (sway) {
      // Applied as a DELTA against the sway already on the particle, so the
      // oscillation rides on top of the velocity integration instead of
      // overwriting it — and stays frame-rate independent.
      cfg.x = {
        onEmit: () => 0,
        onUpdate: (p: Phaser.GameObjects.Particles.Particle, _k: string, t: number, v: number) => {
          const q = p as FxParticle;
          const cur =
            sway.px * Math.sin((t * sway.cycles + (q.fxSeed ?? 0)) * Math.PI * 2) * rig.uniform * rig.inst.widthScale;
          const prev = q.fxSway ?? 0;
          q.fxSway = cur;
          return v + (cur - prev);
        }
      };
    }

    if (spec.spread) {
      // An iso ground ELLIPSE, not a box: the footprint of a fire on this
      // camera's ground plane is 2:1, and a square one reads as a sprite sheet.
      // sqrt() on the radius is what makes it uniform by AREA — without it
      // emissions clump into a dense knot at the centre, which is the giveaway
      // of a naive polar sampler.
      const rx = spec.spread[0] / 2;
      const ry = spec.spread[1] / 2;
      const footprint = (): number => rig.uniform * rig.inst.widthScale;
      cfg.emitZone = {
        type: 'random',
        source: {
          getRandomPoint: (point: Phaser.Types.Math.Vector2Like): void => {
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * footprint();
            point.x = Math.cos(a) * r * rx;
            point.y = Math.sin(a) * r * ry;
          }
        }
      };
    }

    const obj = this.scene.add
      .particles(this.x + (spec.dx ?? 0), this.y + (spec.dy ?? 0), spec.texture, cfg)
      .setDepth(this.depth + spec.z);
    obj.frequency = this.frequencyOf(spec);
    return { kind: 'particles', spec, obj };
  }

  private buildPuffs(spec: PuffLayer): PuffRT | undefined {
    const sheet = sheetOf(spec.sheet);
    if (!sheet || !this.scene.textures.exists(`${sheet.key}_pack`)) return undefined;
    return { kind: 'puffs', spec, sheet, slots: [], nextAt: this.nowFn(), released: 0 };
  }

  /* --------------------------------- puffs --------------------------------- */

  private stepPuffs(rt: PuffRT, now: number, wind: WindSample, frozen: boolean): void {
    const s = rt.spec;
    const cap = frozen ? 0 : this.puffCap(s.pool);
    const live = rt.slots.reduce((n, slot) => n + (slot.active ? 1 : 0), 0);

    if (!frozen && now >= rt.nextAt) {
      // A big `advanceTime` jump must not fire a backlog of puffs all at once;
      // resync instead of emitting the debt.
      if (now - rt.nextAt > s.lifeMs[1]) rt.nextAt = now;
      if (live < cap) this.spawnPuff(rt, now, wind);
      const r = hash01(this.seed + rt.released * 6427);
      // `rate` governs puffs too, not just particles. For a smoke-led emitter
      // the puff layer IS the density, so a half-rate instance that only
      // thinned the particles would look identical to the full one.
      rt.nextAt = now + lerp(s.releaseMs[0], s.releaseMs[1], r) / Math.max(0.05, this.inst.rate);
    }

    const sx = this.uniform * this.inst.widthScale;
    const sy = this.uniform * this.inst.heightScale;
    const mirror = this.inst.flipX ? -1 : 1;
    const windX = wind.x * this.windInfluence();
    for (const slot of rt.slots) {
      if (!slot.active) continue;
      const p = (now - slot.startMs) / slot.lifeMs;
      if (p >= 1) {
        slot.active = false;
        slot.fx.setVisible(false).setPaused(true);
        continue;
      }
      // Buoyancy decays as the puff cools, so the climb eases out; the wind
      // grip grows the other way, because higher air moves faster.
      const rise = easeOutCubic(p) * slot.rise;
      const grip = easeInQuad(p);
      const width = lerp(slot.widthA, slot.widthB, easeOutQuad(p));
      const drift = (valueNoise(p * 2.3 + slot.swayPhase, this.seed) - 0.5) * 26;
      slot.fx.setPosition(
        this.x + ((s.dx ?? 0) + slot.dx + drift) * sx * mirror + windX * s.windLean * grip * sx,
        this.y + ((s.dy ?? 0) + slot.dy) * sy - rise * sy
      );
      slot.fx.setDisplaySize(
        width * sx,
        ((width * rt.sheet.cellH) / rt.sheet.cellW) * sy * (s.squash ?? 1)
      );
      slot.fx.setAngle(slot.spin * p);
      // Expanding smoke thins out: alpha falls as the volume grows, which is
      // mass conservation doing the art direction for us.
      slot.fx.setMasterAlpha(bell(p, s.alpha.peakAt, s.alpha.tail ?? 1.5) * s.alpha.peak * this.master);
    }
  }

  private spawnPuff(rt: PuffRT, now: number, _wind: WindSample): void {
    const s = rt.spec;
    let slot = rt.slots.find((x) => !x.active);
    if (!slot) {
      if (rt.slots.length >= s.pool) return;
      const fx = new FlipbookFX(this.scene, rt.sheet, this.x, this.y, this.nowFn, {
        ramp: this.rampOverride ?? s.ramp,
        tint: this.tintOf(s),
        fps: s.fps[0],
        loop: true,
        emissive: s.emissive ?? 0,
        blend: blendOf(s.blend ?? 'normal'),
        destroyOnComplete: false
      });
      fx.setDepth(this.depth + s.z);
      this.scene.add.existing(fx);
      slot = {
        fx,
        active: false,
        startMs: now,
        lifeMs: s.lifeMs[0],
        dx: 0,
        dy: 0,
        rise: s.risePx[0],
        widthA: s.width[0],
        widthB: s.width[1],
        spin: 0,
        swayPhase: 0
      };
      rt.slots.push(slot);
    }

    const n = rt.released++;
    const r = (k: number): number => hash01(this.seed + n * 104729 + k * 1299709);
    slot.active = true;
    slot.startMs = now;
    slot.lifeMs = lerp(s.lifeMs[0], s.lifeMs[1], r(1));
    // Seed on the iso ground ELLIPSE, area-uniform (sqrt on the radius), so a
    // wide low pool fills evenly instead of crowding its own centre. y takes
    // half, which is TILE_H / TILE_W.
    const ang = r(2) * Math.PI * 2;
    const rad = Math.sqrt(r(9)) * s.spreadPx;
    slot.dx = Math.cos(ang) * rad;
    slot.dy = Math.sin(ang) * rad * 0.5;
    slot.rise = lerp(s.risePx[0], s.risePx[1], r(3));
    slot.widthA = s.width[0] * lerp(0.85, 1.15, r(4));
    slot.widthB = s.width[1] * lerp(0.85, 1.15, r(5));
    slot.spin = lerp(s.spinDeg[0], s.spinDeg[1], r(6)) * (r(7) < 0.5 ? -1 : 1);
    slot.swayPhase = r(8) * 10;
    slot.fx.setVisible(true);
    // Its own rate AND its own entry point into the loop — a pool of puffs all
    // starting at frame 0 is the tell that betrays a pooled system instantly.
    slot.fx.setPaused(false);
    slot.fx.replay(r(9) * (rt.sheet.frames / lerp(s.fps[0], s.fps[1], r(10))) * 1000);
  }
}
