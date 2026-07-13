import Phaser from 'phaser';
import { BUILTIN_SEQUENCES, IDLE_HOLD_MS } from '../render/sequenceCatalog';
import { stepSequence, type SequenceState } from '../ui/partAnimator';

/** Disc spritesheet baked by scripts/bake-laurah-portrait.py: the two idle
 *  poses, then every talk bank in catalog order — all circle-cropped to the
 *  bubble-portrait framing. */
export const LAURAH_DISC_TEXTURE = 'laurah_disc';
const IDLE_ONE = 0;
const IDLE_TWO = 1;
const FIRST_TALK_FRAME = 2;
// NOTE: atlas frames 42/43 are synthesized blink poses (half/closed). The idle
// blink scheduler was removed for now — the painted lids didn't hold up — but
// the frames stay baked so a proper blink (real closed-eye art) can return.

interface DiscBank {
  /** Atlas frame indices: talk frames, then the trailing idle rest pose. */
  frames: number[];
  /** Per-frame holds parallel to frames (idle hold last). */
  durations: number[];
}

/** Atlas banks derived from the sequence catalog (same order, same timing) —
 *  the disc sheet is baked bank-after-bank, so offsets are cumulative. */
const BANKS: Record<string, DiscBank> = (() => {
  const banks: Record<string, DiscBank> = {};
  let offset = FIRST_TALK_FRAME;
  for (const seq of BUILTIN_SEQUENCES) {
    const frames = Array.from({ length: seq.count }, (_, i) => offset + i);
    frames.push(seq.endIdle.includes('idle_1') ? IDLE_ONE : IDLE_TWO);
    banks[seq.key] = { frames, durations: [...seq.durations, IDLE_HOLD_MS] };
    offset += seq.count;
  }
  return banks;
})();

/** Talk bank for a spoken line — longer lines get the longer mouth banks. */
const bankFor = (text: string): string =>
  text.length <= 70 ? 'laurah_talk_short' : text.length <= 170 ? 'laurah_talk_mid' : 'laurah_talk_long';

/** Subtle idle "breathing puppet" — a slow scaleY rise/fall (with a faint
 *  inverse scaleX for a touch of squash-stretch), pivoting from CharacterBubble's
 *  bottom-anchored origin so she grows upward from the frame, never side to
 *  side. Deliberately gentle: this is ambient life, not a gameplay animation. */
const BREATH_PERIOD_MS = 3400;
const BREATH_AMP_Y = 0.022;
const BREATH_AMP_X = 0.01;

/**
 * Drives the circular animated Laurah portrait in the dialogue bubble: plays a
 * talk bank once when a line appears (picked by line length), then rests on the
 * bank's trailing idle pose. Reuses partAnimator's stepSequence stepper (one
 * playback truth) but swaps FRAMES of the baked disc spritesheet instead of
 * whole textures. Also layers a continuous subtle breathing scale on top of
 * whatever "base" fit-scale CharacterBubble's layout pass computes, so the two
 * never fight over the image's scale. Purely presentational — ticks on the
 * scene clock, like the bubble's own tweens.
 */
export class PortraitAnimator {
  private state: SequenceState | null = null;
  private baseScaleX = 1;
  private baseScaleY = 1;
  private breathElapsed = 0;
  /** All layers stay frame- and scale-synced: CharacterBubble renders Laurah
   *  as TWO copies of the same sheet (head slice above the ring, body slice
   *  behind it), so every frame swap and breath tick hits each copy. */
  private imgs: Phaser.GameObjects.Image[];

  constructor(scene: Phaser.Scene, ...imgs: Phaser.GameObjects.Image[]) {
    this.imgs = imgs;
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
    imgs[0]!.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this);
    });
  }

  /** True while the primary image is showing the Laurah disc sheet (vs. a
   *  static speaker portrait like Cindra's) — playback and breathing only
   *  apply then. */
  private get onDiscSheet(): boolean {
    return this.imgs[0]!.texture.key === LAURAH_DISC_TEXTURE;
  }

  private setFrameAll(frame: number): void {
    for (const img of this.imgs) if (img.texture.key === LAURAH_DISC_TEXTURE) img.setFrame(frame);
  }

  /** CharacterBubble's layout pass calls this every relayout with the fit
   *  scale it wants (already including the UI Builder's offset multiplier);
   *  the breathing tick then oscillates ON TOP of it every frame. */
  applyBaseScale(x: number, y: number): void {
    this.baseScaleX = x;
    this.baseScaleY = y;
    for (const img of this.imgs) img.setScale(x, y);
  }

  /** Play the right talk bank for a line, once, then rest on its idle. */
  talk(text: string): void {
    const bank = BANKS[bankFor(text)];
    if (!bank || !this.onDiscSheet) return;
    this.state = {
      frameKeys: bank.frames.map(String),
      durations: bank.durations,
      idx: 0,
      elapsed: 0,
      loop: false
    };
    this.setFrameAll(bank.frames[0]!);
  }

  /** Stop talking and settle on the neutral idle pose. */
  rest(): void {
    this.state = null;
    if (this.onDiscSheet) this.setFrameAll(IDLE_ONE);
  }

  private tick(_time: number, delta: number): void {
    if (!this.onDiscSheet) return;
    if (this.state) {
      const idx = stepSequence(this.state, delta);
      if (idx !== null) this.setFrameAll(Number(this.state.frameKeys[idx]!));
    }
    this.breathElapsed += delta;
    const phase = (this.breathElapsed / BREATH_PERIOD_MS) * Math.PI * 2;
    const breatheY = 1 + Math.sin(phase) * BREATH_AMP_Y;
    const breatheX = 1 - Math.sin(phase) * BREATH_AMP_X;
    for (const img of this.imgs) img.setScale(this.baseScaleX * breatheX, this.baseScaleY * breatheY);
  }
}
