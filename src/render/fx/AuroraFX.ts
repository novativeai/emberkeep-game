/**
 * AuroraFX — the Borealis world's sky, drawn once and blitted many times.
 *
 * ## Why it is not a full-screen shader
 *
 * The naive version of this effect runs the aurora shader over every pixel of
 * the band, every frame. On the game's 2560×1600 canvas the top half is 2.0M
 * fragments, each evaluating several multi-octave fBm calls — hundreds of ALU
 * ops apiece. That is a frame-rate problem on any phone and a real cost even on
 * desktop, for something the player is not looking at.
 *
 * Two facts about an aurora make it avoidable, and this class is built on them:
 *
 * 1. **It has no high-frequency detail.** It is soft light with no hard edge
 *    anywhere. Rendering at a third of the resolution and scaling back up with
 *    bilinear filtering is visually free — and it actively HELPS, because the
 *    interpolation smooths the 8-bit steps that cause banding.
 *
 * 2. **It is the slowest-moving thing on screen.** A curtain takes tens of
 *    seconds to fold. Re-rendering it 20 times a second instead of 60 is
 *    indistinguishable, and the composite never stutters because the BLIT still
 *    happens every frame — only the contents of the texture lag, by up to 50 ms,
 *    on an image that changes by a couple of pixels in that time.
 *
 * Together they cut the work by roughly 3× (resolution) × 3× (rate) ≈ **an order
 * of magnitude**, before the quality tier trims octaves on top. `costEstimate()`
 * reports what a configuration actually asks for, and the headless check
 * measures the real frame cost rather than trusting the arithmetic.
 *
 * The governor closes it out: `doze` stops re-rendering entirely and the last
 * frame stays on screen. A still aurora in a still painting costs nothing.
 */
import Phaser from 'phaser';

import { AURORA_PIPELINE, ensureAuroraPipeline, RAMP_STOPS, type AuroraPipelineData } from './auroraShader';
import {
  AURORA_QUALITY,
  costEstimate,
  type AuroraPreset,
  type AuroraQuality
} from './auroraConfig';
import type { FxTier } from './emitterTypes';
import { hexToInt } from './fxSignals';

// Re-exported so callers have one import for the whole effect.
export * from './auroraConfig';

export interface AuroraOptions {
  /** Clock the effect reads. Wire to GameClock.now. */
  now: () => number;
  /** Band size in game px. Height is normally half the canvas. */
  width: number;
  height: number;
  /** Top-left of the band. */
  x?: number;
  y?: number;
  depth?: number;
  alpha?: number;
  tier?: FxTier;
}

/** '#rrggbb' -> linear-ish 0..1 triple for the shader. */
const rgb01 = (hex: string): [number, number, number] => {
  const v = hexToInt(hex);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

export class AuroraFX {
  readonly preset: AuroraPreset;

  private readonly scene: Phaser.Scene;
  private readonly nowFn: () => number;
  /** Low-resolution target the shader actually draws into. */
  private readonly target: Phaser.Textures.DynamicTexture;
  /** Off-screen source carrying the aurora pipeline. Never added to the scene. */
  private readonly source: Phaser.GameObjects.Image;
  /** What the player sees: the target, stretched, additive. */
  private readonly view: Phaser.GameObjects.Image;
  private readonly textureKey: string;

  private width: number;
  private height: number;
  private tier: FxTier;
  private quality: AuroraQuality;
  private startMs: number;
  private lastRenderMs = -1e9;
  private renders = 0;
  private live = true;

  constructor(scene: Phaser.Scene, preset: AuroraPreset, opts: AuroraOptions) {
    this.scene = scene;
    this.preset = preset;
    this.nowFn = opts.now;
    this.width = opts.width;
    this.height = opts.height;
    this.tier = opts.tier ?? 'high';
    this.quality = AURORA_QUALITY[this.tier];
    this.startMs = opts.now();
    this.textureKey = `aurora_rt_${Math.round(opts.now()) % 1e6}_${scene.scene.key}`;

    const [tw, th] = this.targetSize();
    this.target = scene.textures.addDynamicTexture(this.textureKey, tw, th)!;
    // Linear, so the upscale smooths rather than blocks — half the reason the
    // low-resolution pass is invisible.
    this.target.setFilter(Phaser.Textures.FilterMode.LINEAR);

    // A 1×1 white frame is all the pipeline needs; every pixel comes from the
    // shader, and `outTexCoord` spans the quad regardless of texture size.
    this.source = scene.make.image({ key: '__WHITE', add: false }, false);
    this.source.setOrigin(0, 0).setDisplaySize(tw, th);
    this.source.pipelineData = this.buildData();
    if (ensureAuroraPipeline(scene.game)) this.source.setPipeline(AURORA_PIPELINE);

    this.view = scene.add
      .image(opts.x ?? 0, opts.y ?? 0, this.textureKey)
      .setOrigin(0, 0)
      .setDisplaySize(this.width, this.height)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(opts.depth ?? 0)
      .setAlpha(opts.alpha ?? 1)
      // A sky is not in the world: it must not slide when the board camera pans.
      .setScrollFactor(0);

    this.render(this.startMs);
  }

  /* -------------------------------------------------------------- control - */

  get gameObject(): Phaser.GameObjects.Image {
    return this.view;
  }

  /** Re-renders performed so far — the headless check reads this. */
  get renderCount(): number {
    return this.renders;
  }

  get currentTier(): FxTier {
    return this.tier;
  }

  setTier(tier: FxTier): this {
    if (tier === this.tier) return this;
    this.tier = tier;
    const before = this.quality.scale;
    this.quality = AURORA_QUALITY[tier];
    this.view.setVisible(tier !== 'off');
    // Only the resolution change needs the target rebuilt; fps and octaves are
    // read fresh on the next render.
    if (this.quality.scale !== before && tier !== 'off') this.resizeTarget();
    return this;
  }

  /** `doze` freezes the sky rather than clearing it — a still, not a blank. */
  setPowerState(state: 'active' | 'idle' | 'doze'): this {
    this.live = state !== 'doze';
    if (state !== 'doze') this.setTier(state === 'idle' ? 'medium' : 'high');
    return this;
  }

  setAlpha(alpha: number): this {
    this.view.setAlpha(alpha);
    return this;
  }

  setBand(x: number, y: number, width: number, height: number): this {
    this.width = width;
    this.height = height;
    this.view.setPosition(x, y).setDisplaySize(width, height);
    this.resizeTarget();
    return this;
  }

  /** What this configuration costs, relative to the naive full-res version. */
  cost(frameRate = 60): ReturnType<typeof costEstimate> {
    return costEstimate(this.width, this.height, this.quality, this.preset.octaves, frameRate);
  }

  /**
   * Call once per frame. Cheap: it usually does nothing but compare two
   * numbers, because the aurora only re-renders `quality.fps` times a second.
   */
  update(): void {
    if (!this.live || this.tier === 'off' || this.quality.fps <= 0) return;
    const now = this.nowFn();
    const interval = 1000 / this.quality.fps;
    if (now - this.lastRenderMs < interval) return;
    this.render(now);
  }

  destroy(): void {
    this.view.destroy();
    this.source.destroy();
    this.scene.textures.remove(this.textureKey);
  }

  /* --------------------------------------------------------------- render - */

  private targetSize(): [number, number] {
    return [
      Math.max(8, Math.round(this.width / this.quality.scale)),
      Math.max(8, Math.round(this.height / this.quality.scale))
    ];
  }

  private resizeTarget(): void {
    const [tw, th] = this.targetSize();
    if (this.target.width === tw && this.target.height === th) return;
    this.target.setSize(tw, th);
    this.source.setDisplaySize(tw, th);
    this.view.setDisplaySize(this.width, this.height);
    this.lastRenderMs = -1e9; // force a redraw at the new resolution
  }

  private render(now: number): void {
    this.lastRenderMs = now;
    this.renders++;
    const d = this.source.pipelineData as AuroraPipelineData;
    d.time = (now - this.startMs) / 1000;
    d.octaves = Math.min(this.preset.octaves, this.quality.maxOctaves);
    d.aspect = this.width / Math.max(1, this.height);
    this.target.clear();
    this.target.draw(this.source, 0, 0);
  }

  private buildData(): AuroraPipelineData {
    const p = this.preset;
    const ramp: number[] = [];
    for (let i = 0; i < RAMP_STOPS; i++) ramp.push(...rgb01(p.ramp[i] ?? p.ramp[p.ramp.length - 1] ?? '#000000'));

    const layerA: number[] = [];
    const layerB: number[] = [];
    for (let i = 0; i < 3; i++) {
      const l = p.layers[i];
      if (l) {
        layerA.push(l.seed, l.rayFreq, l.foldAmp, l.brightness);
        layerB.push(l.baseY, l.thickness, l.drift, l.shimmer);
      } else {
        // A missing layer must cost nothing, not render black: brightness 0 and
        // a thickness the early-out rejects immediately.
        layerA.push(0, 1, 0, 0);
        layerB.push(9, 0.001, 0, 0);
      }
    }

    return {
      time: 0,
      aspect: this.width / Math.max(1, this.height),
      ramp,
      intensity: p.intensity,
      octaves: Math.min(p.octaves, this.quality.maxOctaves),
      dither: p.dither,
      layerA,
      layerB,
      surgeSpeed: p.surgeSpeed,
      surgeWidth: p.surgeWidth,
      surgeGain: p.surgeGain,
      fadeBottom: p.fadeBottom,
      alpha: 1
    };
  }

  /** Push preset edits into the live effect (the lab's tuning path). */
  refresh(): void {
    this.source.pipelineData = this.buildData();
    this.lastRenderMs = -1e9;
    this.update();
  }
}

