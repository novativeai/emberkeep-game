/**
 * FxDirector — the orchestration layer. One per scene; it owns every emitter
 * rig, the shared wind field, and the decision of how much each rig is allowed
 * to cost this frame.
 *
 * Rigs never decide their own quality. Left to themselves, twelve braziers each
 * "reasonably" running their full stack is twelve times the cost of one, and
 * the eleven off-screen ones pay it for nothing. The director resolves it once
 * per frame, in three passes:
 *
 *   1. CULL — anything whose radius does not reach the padded camera view goes
 *      to `off`: no emission, flipbooks frozen, live smoke still allowed to
 *      finish so re-entering the view never snaps a column out of existence.
 *   2. BUDGET — surviving rigs are ranked by distance from the view centre.
 *      The nearest `highSlots` run `high`, the next `mediumSlots` run `medium`,
 *      the rest run `low`. Attention is a finite resource and it belongs to
 *      whatever the player is actually looking at.
 *   3. CEILING — the power governor caps the whole thing: idle can be no better
 *      than `medium`, doze is `off`. Battery wins over beauty, always.
 *
 * Everything reads the injected `now()`, so `window.advanceTime(ms)` replays
 * the field, the flicker and the puff release schedule identically.
 */
import Phaser from 'phaser';

import type { PowerState } from '../../core/PowerGovernor';
import { FxEmitterRig, type RigOptions } from './EmitterFX';
import type { FxPreset, FxPresetFile, FxTier } from './emitterTypes';
import { assignTiers, type BudgetTarget } from './fxBudget';
import { DEFAULT_WIND, sampleWind, type WindSample, type WindSpec } from './fxWind';

export interface DirectorOptions {
  now: () => number;
  wind?: Partial<WindSpec>;
  /** How many rigs may run the full stack. */
  highSlots?: number;
  /** …and how many the middle one, after the high slots are taken. */
  mediumSlots?: number;
  /** Extra px around the camera view before a rig is culled. Generous, so a
   *  smoke column is already running when its source scrolls in. */
  cullPadPx?: number;
}

/** The governor's ceiling on quality. Doze stops ambient FX outright. */
const POWER_CEILING: Record<PowerState, FxTier> = { active: 'high', idle: 'medium', doze: 'off' };

export class FxDirector {
  wind: WindSpec;

  private readonly scene: Phaser.Scene;
  private readonly file: FxPresetFile;
  private readonly nowFn: () => number;
  private readonly rigs: FxEmitterRig[] = [];
  private readonly highSlots: number;
  private readonly mediumSlots: number;
  private readonly cullPad: number;
  private ceiling: FxTier = 'high';
  /** Scratch, reused every frame so the update loop allocates nothing. */
  private readonly targets: BudgetTarget[] = [];

  constructor(scene: Phaser.Scene, file: FxPresetFile, opts: DirectorOptions) {
    this.scene = scene;
    this.file = file;
    this.nowFn = opts.now;
    this.wind = { ...DEFAULT_WIND, ...opts.wind };
    this.highSlots = opts.highSlots ?? 3;
    this.mediumSlots = opts.mediumSlots ?? 5;
    this.cullPad = opts.cullPadPx ?? 420;
  }

  /** Preset ids available in the loaded file. */
  get presetIds(): string[] {
    return Object.keys(this.file.presets);
  }

  preset(id: string): FxPreset | undefined {
    return this.file.presets[id];
  }

  /**
   * Place an emitter. `depth` should be `DEPTHS.itemBase + screenY` for a world
   * prop so terrain in front still occludes it — the always-on-top particle
   * band is for gameplay beats, not for scenery that lives somewhere.
   */
  spawn(presetId: string, x: number, y: number, opts: Omit<RigOptions, 'now'>): FxEmitterRig | undefined {
    const preset = this.file.presets[presetId];
    if (!preset) return undefined;
    const rig = new FxEmitterRig(this.scene, preset, x, y, { ...opts, now: this.nowFn });
    this.rigs.push(rig);
    return rig;
  }

  remove(rig: FxEmitterRig): void {
    const i = this.rigs.indexOf(rig);
    if (i >= 0) this.rigs.splice(i, 1);
    rig.destroy();
  }

  setPowerState(state: PowerState): void {
    this.ceiling = POWER_CEILING[state];
  }

  /** Sample the shared field — the lab and any caller that wants to draw it. */
  sample(x = 0, y = 0, now = this.nowFn()): WindSample {
    return sampleWind(this.wind, now, x, y);
  }

  /** Call once per frame, from the scene's update. */
  update(view?: Phaser.Geom.Rectangle): void {
    const now = this.nowFn();
    const cam = view ?? this.scene.cameras.main.worldView;

    this.targets.length = 0;
    for (const rig of this.rigs) {
      const p = rig.position;
      this.targets.push({ x: p.x, y: p.y, radius: rig.radius });
    }
    const tiers = assignTiers(this.targets, cam, {
      highSlots: this.highSlots,
      mediumSlots: this.mediumSlots,
      cullPadPx: this.cullPad,
      ceiling: this.ceiling
    });

    for (let i = 0; i < this.rigs.length; i++) {
      const rig = this.rigs[i];
      const p = rig.position;
      // Wind is sampled per rig POSITION, not once for the scene: a gust that
      // reaches every emitter on the same frame is a global animation, and it
      // reads as one. The field is what makes it sweep.
      rig.update(now, sampleWind(this.wind, now, p.x, p.y), tiers[i]);
    }
  }

  destroy(): void {
    for (const rig of this.rigs) rig.destroy();
    this.rigs.length = 0;
    this.targets.length = 0;
  }
}
