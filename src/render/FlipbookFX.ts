/**
 * FlipbookFX — a motion-vector flipbook as a Phaser Game Object.
 *
 * An Image drawn through `FlipbookPipeline`, interpolating between frames along
 * baked optical flow instead of cross-dissolving. Colour comes from the shared
 * palette LUT at draw time, so the same sheet plays as ember, ash or arcane by
 * naming a different ramp.
 *
 * Render-layer only: it never touches systems or GameState. Time arrives
 * through an injected `now()` — wire it to GameClock so `advanceTime` stays
 * deterministic — and playback is elapsed-time based, so the power governor can
 * drop the loop to 15fps without slowing the effect down.
 */
import Phaser from 'phaser';

import { ensureFlipbookPipeline, FLIPBOOK_PIPELINE, type FlipbookPipelineData } from './flipbookShader';
import { flipbookDurationMs, flipbookErosion, flipbookFrameAt } from './flipbookTiming';

/** One entry of assets/vfx-bank/bank.mv.json. */
export interface FlipbookSheet {
  key: string;
  cols: number;
  rows: number;
  frames: number;
  cellW: number;
  cellH: number;
  mvScale: number;
  loop: boolean;
}

export interface FlipbookOptions {
  /** Palette row from ramps.json — 'ember' | 'ash' | 'teal' | … */
  ramp?: string;
  /** Multiplies the ramp colour. */
  tint?: number;
  alpha?: number;
  /** Playback rate. Defaults to one pass per second. */
  fps?: number;
  /** Force looping; defaults to the sheet's own flag. */
  loop?: boolean;
  /** Fraction of a one-shot's life before burn-away starts (1 = never). */
  erodeHold?: number;
  /** Extra gain on the packed emissive channel. */
  emissive?: number;
  /** Turn motion-vector interpolation off — for A/B comparison. */
  useMotionVectors?: boolean;
  /** Destroy when a one-shot finishes. Default true. */
  destroyOnComplete?: boolean;
  onComplete?: () => void;
  /**
   * Blend mode. Defaults to ADD, which is right for anything hot and the only
   * thing the payoff beats ever wanted. Smoke and dust need NORMAL: ADD can
   * only ever brighten, so dark smoke is impossible under it. The shader emits
   * PREMULTIPLIED alpha, which is exactly what Phaser's NORMAL expects.
   */
  blend?: number;
}

export const RAMP_TEXTURE = 'vfx_ramps';

/** Row v-coordinates from ramps.json. Keep in sync with bake-vfx-ramps.py. */
export const RAMP_V: Record<string, number> = {
  ember: 0.0625, lava: 0.1875, gold: 0.3125, ash: 0.4375,
  smoke: 0.5625, moss: 0.6875, teal: 0.8125, plum: 0.9375
};

export class FlipbookFX extends Phaser.GameObjects.Image {
  private readonly sheet: FlipbookSheet;
  private readonly nowFn: () => number;
  private readonly fps: number;
  private readonly looping: boolean;
  private readonly erodeHold: number;
  private readonly destroyOnComplete: boolean;
  private readonly onDone?: () => void;
  private startMs: number;
  private finished = false;
  private paused = false;
  /** Elapsed time at the moment of pausing, so resuming does not jump. */
  private pausedAtMs = 0;

  constructor(
    scene: Phaser.Scene,
    sheet: FlipbookSheet,
    x: number,
    y: number,
    now: () => number,
    opts: FlipbookOptions = {}
  ) {
    super(scene, x, y, `${sheet.key}_pack`);

    this.sheet = sheet;
    this.nowFn = now;
    this.fps = opts.fps ?? sheet.frames;
    this.looping = opts.loop ?? sheet.loop;
    this.erodeHold = opts.erodeHold ?? (this.looping ? 1 : 0.55);
    this.destroyOnComplete = opts.destroyOnComplete ?? true;
    this.onDone = opts.onComplete;
    this.startMs = now();

    // The Image samples ONE cell, not the whole sheet — size it to a cell and
    // let the shader pick which cell.
    this.setDisplaySize(sheet.cellW, sheet.cellH);

    const c = Phaser.Display.Color.IntegerToRGB(opts.tint ?? 0xffffff);
    this.pipelineData = {
      grid: [sheet.cols, sheet.rows],
      cell: [sheet.cellW, sheet.cellH],
      frames: [0, Math.min(1, sheet.frames - 1)],
      t: 0,
      mvScale: sheet.mvScale,
      useMV: opts.useMotionVectors === false ? 0 : 1,
      rampV: RAMP_V[opts.ramp ?? 'ember'] ?? RAMP_V.ember,
      tint: [c.r / 255, c.g / 255, c.b / 255, opts.alpha ?? 1],
      erode: 0,
      emissive: opts.emissive ?? 0.6,
      alpha: 1,
      mvTexture: `${sheet.key}_mv`,
      rampTexture: RAMP_TEXTURE
    } satisfies FlipbookPipelineData;

    if (ensureFlipbookPipeline(scene.game)) this.setPipeline(FLIPBOOK_PIPELINE);
    this.setBlendMode(opts.blend ?? Phaser.BlendModes.ADD);

    this.step();
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.step, this);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.events.off(Phaser.Scenes.Events.UPDATE, this.step, this);
    });
  }

  private get data_(): FlipbookPipelineData {
    return this.pipelineData as FlipbookPipelineData;
  }

  /**
   * Restart playback.
   *
   * `offsetMs` starts the effect already that far into its loop — how a pool of
   * puffs avoids the giveaway of every instance playing the same frame at the
   * same moment.
   */
  replay(offsetMs = 0): this {
    this.startMs = this.nowFn() - offsetMs;
    this.finished = false;
    this.paused = false;
    this.step();
    return this;
  }

  /**
   * Freeze the playhead where it is. The governor's doze state stops ambient
   * FX entirely, and a pooled instance waiting in the pool must not tick.
   */
  setPaused(paused: boolean): this {
    if (!paused && this.paused) this.startMs = this.nowFn() - this.pausedAtMs;
    else if (paused && !this.paused) this.pausedAtMs = this.nowFn() - this.startMs;
    this.paused = paused;
    return this;
  }

  setRamp(name: string): this {
    this.data_.rampV = RAMP_V[name] ?? RAMP_V.ember;
    return this;
  }

  /** `setTint` is taken by Phaser's own vertex tint, which this shader ignores. */
  setVfxTint(color: number, alpha = 1): this {
    const c = Phaser.Display.Color.IntegerToRGB(color);
    this.data_.tint = [c.r / 255, c.g / 255, c.b / 255, alpha];
    return this;
  }

  setMasterAlpha(a: number): this {
    this.data_.alpha = a;
    return this;
  }

  /** Compare against the no-motion-vector path. */
  setMotionVectors(on: boolean): this {
    this.data_.useMV = on ? 1 : 0;
    return this;
  }

  get durationMs(): number {
    return flipbookDurationMs(this.sheet.frames, this.fps);
  }

  /** Advance to whatever the clock says. Idempotent. */
  private step(): void {
    if (this.finished || this.paused) return;
    const elapsed = this.nowFn() - this.startMs;
    const f = flipbookFrameAt(elapsed, this.fps, this.sheet.frames, this.looping);
    const d = this.data_;
    d.frames = [f.a, f.b];
    d.t = f.t;
    if (!this.looping) d.erode = flipbookErosion(elapsed / this.durationMs, this.erodeHold);
    if (f.done) {
      this.finished = true;
      this.onDone?.();
      if (this.destroyOnComplete) this.destroy();
    }
  }
}

/** Preload every texture a set of bank sheets needs, plus the shared ramp LUT. */
export function preloadFlipbooks(
  load: Phaser.Loader.LoaderPlugin,
  sheets: FlipbookSheet[],
  base = 'vfx-bank/'
): void {
  load.image(RAMP_TEXTURE, `${base}ramps.png`);
  for (const s of sheets) {
    load.image(`${s.key}_pack`, `${base}flipbooks/${s.key}_pack.png`);
    load.image(`${s.key}_mv`, `${base}flipbooks/${s.key}_mv.png`);
  }
}
