/**
 * SnowFX — the weather layer: one screen quad, five depth planes, no particles.
 *
 * ## What it costs, and why there is no cheaper shape
 *
 * The aurora gets to cheat twice: it has no high-frequency detail, so it renders
 * at a third of the resolution, and it barely moves, so it re-renders at 20 Hz.
 * Snow can do NEITHER. A 2 px flake rendered at 1/3 scale is a smudge, and
 * falling snow re-rendered at 20 Hz strobes — the two tricks that made the sky
 * nearly free are both unavailable here.
 *
 * So the honest position is: the fill is one screen-sized quad, every frame,
 * which is the irreducible cost of covering the screen with anything at all; and
 * the only lever is how many depth planes each fragment walks. The quality tier
 * pulls exactly that lever, and it drops WHOLE PLANES rather than thinning all
 * of them — three crisp depths look like snow, five faint ones look like dust.
 *
 * ## Doze HIDES it; it does not freeze it
 *
 * The aurora freezes on its last frame when the governor dozes, because a still
 * aurora is just a painting. Snow frozen in mid-air is visibly broken, so this
 * layer fades out instead and stops updating once it is invisible. Waking fades
 * it back in. The fade is the only thing `update()` does when dozing.
 */
import Phaser from 'phaser';

import { DEFAULT_WIND, sampleWind, type WindSpec } from './fxWind';
import { hexToInt } from './fxSignals';
import type { FxTier } from './emitterTypes';
import {
  activePlanes,
  MAX_PLANES,
  SNOW_QUALITY,
  costEstimate,
  type SnowCost,
  type SnowPreset,
  type SnowQuality
} from './snowConfig';
import { ensureSnowPipeline, SNOW_PIPELINE, type SnowPipelineData } from './snowShader';

// Re-exported so callers have one import for the whole effect.
export * from './snowConfig';

/** Seconds for the layer to fade fully in or out on a power-state change. */
const FADE_MS = 600;

export interface SnowOptions {
  /** Clock the effect reads. Wire to GameClock.now. */
  now: () => number;
  /** Band size in game px. Normally the whole canvas. */
  width: number;
  height: number;
  x?: number;
  y?: number;
  depth?: number;
  alpha?: number;
  tier?: FxTier;
  seed?: number;
  /** Override the shared world wind. Defaults to DEFAULT_WIND — leave it. */
  wind?: WindSpec;
  /**
   * Draw only planes [start, end) of the tier's active set, so a world can put
   * the far planes BEHIND the board and the near ones in front and have flakes
   * pass either side of a dragon. Two instances always share one plane budget:
   * the slice is taken after the tier cap, never before.
   */
  planeRange?: [number, number];
}

/** '#rrggbb' -> 0..1 triple. */
const rgb01 = (hex: string): [number, number, number] => {
  const v = hexToInt(hex);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

export class SnowFX {
  readonly preset: SnowPreset;

  private readonly nowFn: () => number;
  private readonly view: Phaser.GameObjects.Image;
  private readonly wind: WindSpec;
  private readonly range?: [number, number];
  private readonly seed: number;

  private width: number;
  private height: number;
  private tier: FxTier;
  private quality: SnowQuality;
  private data: SnowPipelineData;

  private startMs: number;
  private lastMs: number;
  private baseAlpha: number;
  /** 0..1 fade, driven by the power state. */
  private fade = 1;
  private fadeTo = 1;
  /** Integrated wind displacement in band-widths — a POSITION, not a speed. */
  private windOffset = 0;
  private frames = 0;
  /** Last viewport `coverCamera` fitted to, so a still camera costs nothing. */
  private coverZoom = -1;
  private coverW = -1;
  private coverH = -1;

  constructor(scene: Phaser.Scene, preset: SnowPreset, opts: SnowOptions) {
    this.preset = preset;
    this.nowFn = opts.now;
    this.width = opts.width;
    this.height = opts.height;
    this.tier = opts.tier ?? 'high';
    this.quality = SNOW_QUALITY[this.tier];
    this.wind = opts.wind ?? DEFAULT_WIND;
    this.range = opts.planeRange;
    this.seed = opts.seed ?? 0;
    this.baseAlpha = opts.alpha ?? 1;
    this.startMs = opts.now();
    this.lastMs = this.startMs;

    this.data = this.buildData();

    // A 1×1 white frame is all the pipeline needs: every pixel comes from the
    // shader, and outTexCoord spans the quad regardless of texture size.
    this.view = scene.add
      .image(opts.x ?? 0, opts.y ?? 0, '__WHITE')
      .setOrigin(0, 0)
      .setDisplaySize(this.width, this.height)
      .setDepth(opts.depth ?? 0)
      // Weather is not in the world: it must not slide when the board pans.
      .setScrollFactor(0)
      .setVisible(this.tier !== 'off');
    this.view.pipelineData = this.data;
    if (ensureSnowPipeline(scene.game)) this.view.setPipeline(SNOW_PIPELINE);
  }

  /* -------------------------------------------------------------- control - */

  get gameObject(): Phaser.GameObjects.Image {
    return this.view;
  }

  /** Frames stepped so far — the headless check reads this. */
  get frameCount(): number {
    return this.frames;
  }

  get currentTier(): FxTier {
    return this.tier;
  }

  /** Planes actually being drawn right now. */
  get planeCount(): number {
    return activePlanes(this.preset, this.quality, this.range).length;
  }

  setTier(tier: FxTier): this {
    if (tier === this.tier) return this;
    this.tier = tier;
    this.quality = SNOW_QUALITY[tier];
    this.data = this.buildData();
    this.view.pipelineData = this.data;
    this.view.setVisible(tier !== 'off' && this.planeCount > 0);
    return this;
  }

  /**
   * `doze` fades the snow out rather than freezing it — flakes stopped in
   * mid-air read as a broken game, where a still aurora just reads as a sky.
   */
  setPowerState(state: 'active' | 'idle' | 'doze'): this {
    this.fadeTo = state === 'doze' ? 0 : 1;
    if (state !== 'doze') {
      this.setTier(state === 'idle' ? 'medium' : 'high');
      this.view.setVisible(this.tier !== 'off' && this.planeCount > 0);
    }
    return this;
  }

  setAlpha(alpha: number): this {
    this.baseAlpha = alpha;
    return this;
  }

  setBand(x: number, y: number, width: number, height: number): this {
    this.width = width;
    this.height = height;
    this.view.setPosition(x, y).setDisplaySize(width, height);
    this.data.aspect = width / Math.max(1, height);
    this.data.resY = height;
    return this;
  }

  /**
   * Grow the quad to cover the whole viewport at the camera's CURRENT zoom.
   *
   * `setScrollFactor(0)` stops the band SLIDING when the board pans, but it
   * does not stop it SCALING: Phaser still applies the camera's zoom about the
   * viewport centre, so a band sized to the canvas shrinks with everything else
   * and leaves the screen bare around it the moment the player zooms out.
   *
   * Only the quad's transform moves. `aspect` and `resY` — the two uniforms the
   * flake field is built from — are deliberately NOT touched, so a flake stays
   * the same size on screen whatever the camera does: zooming out reveals MORE
   * snow rather than smaller snow, which is what weather does.
   */
  coverCamera(camera: Phaser.Cameras.Scene2D.Camera): this {
    const zoom = Math.max(1e-4, camera.zoom);
    if (zoom === this.coverZoom && camera.width === this.coverW && camera.height === this.coverH) {
      return this;
    }
    this.coverZoom = zoom;
    this.coverW = camera.width;
    this.coverH = camera.height;
    // A scrollFactor-0 point maps to `centre + (p - centre) * zoom`, so the quad
    // has to be 1/zoom oversized and re-centred to land back on the viewport.
    const w = camera.width / zoom;
    const h = camera.height / zoom;
    this.view.setPosition((camera.width - w) / 2, (camera.height - h) / 2).setDisplaySize(w, h);
    return this;
  }

  /** What this configuration costs and what it buys. */
  cost(frameRate = 60): SnowCost {
    return costEstimate(this.width, this.height, this.quality, this.preset, frameRate, this.range);
  }

  /**
   * Call once per frame. It writes four numbers — there is no per-flake work
   * on this side of the boundary, which is the whole point of the technique.
   */
  update(): void {
    const now = this.nowFn();
    // Clamped so a stalled tab does not teleport the field on the next frame.
    const dt = Math.min(200, Math.max(0, now - this.lastMs));
    this.lastMs = now;
    this.frames++;

    if (this.fade !== this.fadeTo) {
      const step = dt / FADE_MS;
      this.fade = this.fadeTo > this.fade ? Math.min(this.fadeTo, this.fade + step) : Math.max(this.fadeTo, this.fade - step);
      if (this.fade <= 0) this.view.setVisible(false);
      else if (this.tier !== 'off' && this.planeCount > 0) this.view.setVisible(true);
    }
    if (this.fade <= 0) return;

    // The SHARED world field, integrated into a displacement. Passing the
    // instantaneous wind instead would make every gust a position jump.
    const w = sampleWind(this.wind, now);
    this.windOffset += (w.x * this.preset.windScale * dt) / 1000;

    this.data.time = (now - this.startMs) / 1000;
    this.data.wind = this.windOffset;
    this.data.alpha = this.baseAlpha * this.fade;
  }

  destroy(): void {
    this.view.destroy();
  }

  /** Push preset edits into the live effect (the lab's tuning path). */
  refresh(): void {
    const time = this.data?.time ?? 0;
    const wind = this.data?.wind ?? 0;
    this.data = this.buildData();
    this.data.time = time;
    this.data.wind = wind;
    this.view.pipelineData = this.data;
    this.view.setVisible(this.tier !== 'off' && this.planeCount > 0 && this.fade > 0);
  }

  /* --------------------------------------------------------------- detail - */

  private buildData(): SnowPipelineData {
    const p = this.preset;
    const live = activePlanes(p, this.quality, this.range);

    const planeA: number[] = [];
    const planeB: number[] = [];
    const planeC: number[] = [];
    for (let i = 0; i < MAX_PLANES; i++) {
      const l = live[i];
      if (l) {
        planeA.push(l.grid, l.radius, l.fall, l.drift);
        planeB.push(l.coverage, l.brightness, l.softness, l.sway);
        planeC.push(l.swayHz, l.tumble, l.stretch, l.windGain);
      } else {
        // An unused slot must cost nothing: coverage 0 rejects every cell on
        // the first hash. The loop breaks before it anyway.
        planeA.push(1, 0.1, 0, 0);
        planeB.push(0, 0, 0, 0);
        planeC.push(0, 0, 1, 0);
      }
    }

    return {
      time: this.data?.time ?? 0,
      aspect: this.width / Math.max(1, this.height),
      resY: this.height,
      planes: live.length,
      intensity: p.intensity,
      alpha: this.baseAlpha * this.fade,
      seed: this.seed,
      wind: this.windOffset,
      tint: rgb01(p.tint),
      planeA,
      planeB,
      planeC
    };
  }
}
