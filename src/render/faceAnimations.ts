import type { RigPose } from './rigTypes';

/**
 * Pure (Phaser-free) face-frame brain for rigs whose head expression lives in
 * pre-rendered frame sets (head-animation PNG sequences) instead of separate
 * eyelid/jaw layers.
 *
 * It follows the same adaptive philosophy as rigAnimations: the PUPPET pose is
 * the single source of truth. Presets emit `mouth` (via the jaw() helper) and
 * RigPlayer injects `eyelid` from a randomized BlinkScheduler (below); rigs WITH
 * eyelid/jaw layers consume those directly, rigs WITHOUT them fall back to head
 * tilt — and rigs that also ship face frame sets render them here. Nothing about
 * the puppet motion changes: the face channel only decides which head TEXTURE is
 * worn each frame.
 *
 * Selection precedence (first match wins):
 *   1. explicit talk override (scripted beats: hatch roar, gift celebrate)
 *   2. pose.mouth   — jaw influence from presets (roar / stretch)
 *   3. pose.eyelid  — scheduled blink dips (BlinkScheduler, injected by RigPlayer)
 *   4. null         — the rig's own base head texture
 */

export interface FaceFrame {
  file: string;
  durationMs: number;
}

/** One frame set, pre-calibrated by scripts/calibrate-faces.mjs so a frame can
 *  replace the rig's head texture without the head moving or resizing. */
export interface FaceSet {
  dir: string;
  /** display scale that makes the frame's content match the rig piece 1:1 */
  textureScale: number;
  /** normalized origin placing the anchor pivot on the same content point */
  originX: number;
  originY: number;
  frames: FaceFrame[];
}

export interface FaceDoc {
  layer: string;
  basePath: string;
  sets: Record<string, FaceSet>;
}

export type FacesData = Record<string, FaceDoc>;

/** What the head should wear this frame; null = the rig's base texture. */
export interface FaceSelection {
  setKey: string;
  frameIndex: number;
}

/* ----------------------------- blink timing ----------------------------- */

/** Seconds between blinks, min/max. A blink fires at a fresh random point in
 *  this range every time — never a fixed metronome — and each rig instance
 *  seeds its own, so a crowd of dragons never blinks in unison. */
export interface BlinkGap {
  minMs: number;
  maxMs: number;
}

/** Calm idle cadence (~human resting rate, a touch slower for a serene look). */
export const BLINK_GAP_CALM: BlinkGap = { minMs: 2800, maxMs: 6500 };
/** Excited cadence (celebrating / mid-flight) — blinks come quicker. */
export const BLINK_GAP_EXCITED: BlinkGap = { minMs: 1400, maxMs: 3000 };

// Blink SHAPE (ms) — close fast, hold shut a beat, open a little slower. Tuned
// to the AE export feel (45/70/55) while reading naturally on a 60fps tick.
const CLOSE_MS = 45;
const HOLD_MS = 60;
const OPEN_MS = 95;
const EYELID_SHUT = 0.05; // 1 = wide open
const DOUBLE_BLINK_CHANCE = 0.14; // occasionally a quick double-blink
const DOUBLE_BLINK_GAP_MS = 150; // pause between the pair

type BlinkPhase = 'wait' | 'closing' | 'closed' | 'opening';

/**
 * Stateful, randomized blink clock. Pure (no Phaser) and rng-injectable so the
 * cadence is unit-testable; RigPlayer owns one per rig and injects its output
 * into `pose.eyelid`, so BOTH the eyelid-layer path and the face-frame path see
 * the same natural blink — no preset needs a hard-coded period any more.
 */
export class BlinkScheduler {
  private phase: BlinkPhase = 'wait';
  private timer = 0;
  private waitMs: number;
  private eventIsDouble: boolean;
  private blinkIndex = 0;

  constructor(private rng: () => number = Math.random, gap: BlinkGap = BLINK_GAP_CALM) {
    // Stagger the FIRST blink across a wide window so freshly spawned dragons
    // (which all start at t=0) don't fire their opening blink together.
    this.waitMs = this.pickGap(gap) * (0.25 + 0.75 * this.rng());
    this.eventIsDouble = this.rng() < DOUBLE_BLINK_CHANCE;
  }

  private pickGap(gap: BlinkGap): number {
    return gap.minMs + (gap.maxMs - gap.minMs) * this.rng();
  }

  /** Force eyes open and re-arm — used by bake() and when a blink is suppressed. */
  reset(gap: BlinkGap = BLINK_GAP_CALM): void {
    this.phase = 'wait';
    this.timer = 0;
    this.blinkIndex = 0;
    this.waitMs = this.pickGap(gap);
    this.eventIsDouble = this.rng() < DOUBLE_BLINK_CHANCE;
  }

  /** Advance and return eyelid openness 0..1 (1 = open). `suppress` (e.g. a
   *  wide-open roaring mouth) holds the eyes open and defers the next blink. */
  update(deltaMs: number, suppress: boolean, gap: BlinkGap): number {
    if (suppress) {
      if (this.phase !== 'wait') this.reset(gap);
      return 1;
    }
    this.timer += deltaMs;
    switch (this.phase) {
      case 'wait':
        if (this.timer >= this.waitMs) { this.timer = 0; this.phase = 'closing'; }
        return 1;
      case 'closing':
        if (this.timer >= CLOSE_MS) { this.timer = 0; this.phase = 'closed'; return EYELID_SHUT; }
        return 1 - (1 - EYELID_SHUT) * (this.timer / CLOSE_MS);
      case 'closed':
        if (this.timer >= HOLD_MS) { this.timer = 0; this.phase = 'opening'; }
        return EYELID_SHUT;
      case 'opening': {
        if (this.timer < OPEN_MS) return EYELID_SHUT + (1 - EYELID_SHUT) * (this.timer / OPEN_MS);
        this.timer = 0;
        this.phase = 'wait';
        this.blinkIndex++;
        if (this.eventIsDouble && this.blinkIndex < 2) {
          this.waitMs = DOUBLE_BLINK_GAP_MS; // fire the pair's second blink
        } else {
          this.blinkIndex = 0;
          this.eventIsDouble = this.rng() < DOUBLE_BLINK_CHANCE;
          this.waitMs = this.pickGap(gap);
        }
        return 1;
      }
    }
    return 1; // unreachable — all BlinkPhase cases return
  }
}

/* Blink set frame meaning (see scripts/calibrate-faces.mjs frame order):
 * 0 = open (≈ base art, unused — base texture IS the open state),
 * 1 = half-open, 2 = closed, 3 = half-open (duplicate of 1). */
const BLINK_HALF = 1;
const BLINK_CLOSED = 2;
/* Talk set: 0 = mouth closed (≈ base), 1 = half open, 2 = wide open, 3 = dup of 1. */
const TALK_HALF = 1;
const TALK_WIDE = 2;

/** eyelid 1 → open … 0 → shut (same scale the eyelid-layer path squashes by). */
const EYELID_HALF_BELOW = 0.85;
const EYELID_CLOSED_BELOW = 0.35;
/** pose.mouth 0..1 (jaw() normalizes preset jaw degrees). */
const MOUTH_OPEN_ABOVE = 0.12;
const MOUTH_WIDE_ABOVE = 0.45;

export class FaceChannel {
  private overrideActive = false;
  private overrideLoops = 0;
  private overrideFrame = 0;
  private overrideElapsed = 0;

  constructor(private doc: FaceDoc) {}

  /** Loop the talk/roar mouth flap `loops` times (scripted beat), overriding
   *  the pose-driven face until it finishes. No-op if the rig has no talk set. */
  playTalk(loops: number): void {
    if (!this.doc.sets['talk'] || loops <= 0) return;
    this.overrideActive = true;
    this.overrideLoops = loops;
    this.overrideFrame = 0;
    this.overrideElapsed = 0;
  }

  stopTalk(): void {
    this.overrideActive = false;
  }

  get talking(): boolean {
    return this.overrideActive;
  }

  /** Advance timers and pick this frame's face. Pose may be absent (no preset
   *  playing) — the override still runs so a talk burst always completes. */
  update(deltaMs: number, pose: RigPose | null): FaceSelection | null {
    if (this.overrideActive) {
      const talk = this.doc.sets['talk']!;
      this.overrideElapsed += deltaMs;
      let dur = talk.frames[this.overrideFrame]!.durationMs;
      while (this.overrideElapsed >= dur) {
        this.overrideElapsed -= dur;
        this.overrideFrame++;
        if (this.overrideFrame >= talk.frames.length) {
          this.overrideFrame = 0;
          this.overrideLoops--;
          if (this.overrideLoops <= 0) {
            this.overrideActive = false;
            break;
          }
        }
        dur = talk.frames[this.overrideFrame]!.durationMs;
      }
      if (this.overrideActive) return { setKey: 'talk', frameIndex: this.overrideFrame };
    }
    if (!pose) return null;

    // Puppet jaw influence (roar/stretch presets) → real mouth frames.
    const mouth = pose.mouth ?? 0;
    if (mouth > MOUTH_OPEN_ABOVE && this.doc.sets['talk']) {
      return { setKey: 'talk', frameIndex: mouth > MOUTH_WIDE_ABOVE ? TALK_WIDE : TALK_HALF };
    }

    // Scheduled blink (RigPlayer injects pose.eyelid) → real eyelid frames.
    const eyelid = pose.eyelid ?? 1;
    if (eyelid < EYELID_HALF_BELOW && this.doc.sets['blink']) {
      return {
        setKey: 'blink',
        frameIndex: eyelid < EYELID_CLOSED_BELOW ? BLINK_CLOSED : BLINK_HALF
      };
    }

    return null; // base head (eyes open, mouth closed)
  }
}
