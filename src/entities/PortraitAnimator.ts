import Phaser from 'phaser';
import { BUILTIN_SEQUENCES, IDLE_HOLD_MS } from '../render/sequenceCatalog';
import { stepSequence, type SequenceState } from '../ui/partAnimator';

/** Disc spritesheet baked by `scripts/bake-portrait-disc.py`: the rest pose
 *  twice, then the talk bank, then the blink bank — all cropped to the
 *  bubble-portrait bust framing. Eleanor is the guide, so hers is the one the
 *  dialogue bubble animates; every other speaker uses a static portrait. */
export const ELEANOR_DISC_TEXTURE = 'eleanor_disc';
/** Speakers with a baked disc sheet — their lines animate. Anyone else falls
 *  back to a still `portrait_<id>` medallion. Adding one is a bake
 *  (scripts/bake-portrait-disc.py) plus a `load.spritesheet` in PreloadScene. */
export const ANIMATED_SPEAKERS = ['eleanor', 'selyna'] as const;
export type AnimatedSpeaker = (typeof ANIMATED_SPEAKERS)[number];
/** The guide — the speaker the bubble shows when nobody has spoken yet. */
export const ANIMATED_SPEAKER: AnimatedSpeaker = 'eleanor';

export const discTextureFor = (speaker: string): string => `${speaker}_disc`;
export const isAnimatedSpeaker = (speaker: string): speaker is AnimatedSpeaker =>
  (ANIMATED_SPEAKERS as readonly string[]).includes(speaker);

/** Expression stills, in the order the bake script appends them after the blink
 *  bank. Index here IS the offset from the first expression cell — the sheet
 *  carries no manifest, so this array and EXPRESSIONS in the bake script are one
 *  contract. */
export const EXPRESSIONS = [
  'angry', 'determined', 'happy', 'laughing', 'neutral', 'sad', 'surprised', 'worried'
] as const;
export type Expression = (typeof EXPRESSIONS)[number];

const IDLE_ONE = 0;
// Cell 1 is a duplicate of the rest pose. Laurah had two distinct idles and the
// sheet keeps both slots so her layout maths (and the bake script) still line
// up; a character with one rest pose simply repeats it.
const FIRST_TALK_FRAME = 2;

interface DiscBank {
  /** Atlas frame indices: bank frames, then the trailing idle rest pose. */
  frames: number[];
  /** Per-frame holds parallel to frames (idle hold last). */
  durations: number[];
}

/**
 * Atlas banks for the animated speaker. The bake script lays the sheet out as
 * rest, rest, talk…, blink… — so offsets are derived from THAT fixed order, not
 * from the catalog's ordering, and reordering `BUILTIN_SEQUENCES` cannot
 * silently desync the sheet. Durations still come from the catalog, so a
 * re-timed clip needs no change here.
 */
const seqFor = (key: string) => BUILTIN_SEQUENCES.find((s) => s.key === key);

/** Bank kinds in the exact order the bake script appends them to the sheet.
 *  Append-only: every offset below one is derived by counting the ones above. */
const BANK_KINDS = ['talk_short', 'talk_mid', 'talk_long', 'blink'] as const;

const BANKS: Record<string, DiscBank> = {};
/** First expression cell per speaker: 2 rest + every bank. */
const EXPRESSION_BASE: Record<string, number> = {};
for (const who of ANIMATED_SPEAKERS) {
  let offset = FIRST_TALK_FRAME;
  for (const kind of BANK_KINDS) {
    const seq = seqFor(`${who}_${kind}`);
    if (!seq) continue;
    const frames = Array.from({ length: seq.count }, (_, i) => offset + i);
    frames.push(IDLE_ONE);
    BANKS[`${who}_${kind}`] = { frames, durations: [...seq.durations, IDLE_HOLD_MS] };
    offset += seq.count;
  }
  EXPRESSION_BASE[who] = offset;
}

/** Longest line (in characters) each talk bank is allowed to cover. The banks
 *  are 0.64s / 1.78s / 2.42s of mouth movement, so the thresholds just keep the
 *  animation roughly as long as the line takes to read rather than cutting out
 *  early on a long one or over-running a two-word aside. */
const SHORT_MAX = 40;
const MID_MAX = 110;

/** Pick the talk bank by line length — the way Laurah's bubble did it. Her
 *  three banks are what this art reproduces (they are re-orderings of the same
 *  eight mouth poses), so the choice is hers to make again. Falls back down the
 *  list so a character who ships only one bank still speaks. */
const bankFor = (speaker: string, text: string): string => {
  const n = text.trim().length;
  const wanted = n <= SHORT_MAX ? 'talk_short' : n <= MID_MAX ? 'talk_mid' : 'talk_long';
  for (const kind of [wanted, 'talk_mid', 'talk_long', 'talk_short'] as const) {
    if (BANKS[`${speaker}_${kind}`]) return `${speaker}_${kind}`;
  }
  return `${speaker}_talk`;
};

/** Subtle idle "breathing puppet" — a slow scaleY rise/fall (with a faint
 *  inverse scaleX for a touch of squash-stretch), pivoting from CharacterBubble's
 *  bottom-anchored origin so she grows upward from the frame, never side to
 *  side. Deliberately gentle: this is ambient life, not a gameplay animation.
 *  Tuned DOWN from 3400ms/0.022/0.01 — at that amplitude the counter-phase X
 *  squash read as a rubbery wobble rather than breath. The X amp is now barely
 *  a quarter of Y, so the motion is almost pure vertical rise, and the longer
 *  period keeps it below the threshold where the eye tracks it as oscillation. */
const BREATH_PERIOD_MS = 5600;
const BREATH_AMP_Y = 0.009;
const BREATH_AMP_X = 0.0025;

/**
 * Drives the circular animated guide portrait in the dialogue bubble: plays her
 * talk bank once when a line appears, then rests on the
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
  /** All layers stay frame- and scale-synced: CharacterBubble renders the
   *  guide as TWO copies of the same sheet (head slice above the ring, body
   *  slice behind it), so every frame swap and breath tick hits each copy. */
  private imgs: Phaser.GameObjects.Image[];

  constructor(scene: Phaser.Scene, ...imgs: Phaser.GameObjects.Image[]) {
    this.imgs = imgs;
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
    imgs[0]!.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this);
    });
  }

  /** True while the primary image is showing the guide's disc sheet (vs. a
   *  static speaker portrait like the Golden Elder's) — playback and breathing
   *  only apply then. */
  private get onDiscSheet(): boolean {
    return this.imgs[0]!.texture.key.endsWith('_disc');
  }

  /** Whose sheet is currently mounted — banks and expression offsets are
   *  per-speaker, so playback always asks the images rather than a field that
   *  could drift from them. */
  private get speaker(): string {
    return this.imgs[0]!.texture.key.replace(/_disc$/, '');
  }

  private setFrameAll(frame: number): void {
    const key = this.imgs[0]!.texture.key;
    for (const img of this.imgs) if (img.texture.key === key) img.setFrame(frame);
  }

  /** CharacterBubble's layout pass calls this every relayout with the fit
   *  scale it wants (already including the UI Builder's offset multiplier);
   *  the breathing tick then oscillates ON TOP of it every frame. */
  applyBaseScale(x: number, y: number): void {
    this.baseScaleX = x;
    this.baseScaleY = y;
    for (const img of this.imgs) img.setScale(x, y);
  }

  /**
   * Hold a still expression. Punctuation, not mood lighting: one face per
   * bubble, set BEFORE the line reveals so it reads as a reaction to the moment
   * rather than a consequence of the words (docs/conversation-staging.md §3).
   * A speaker with no expression cells (or an unbaked face) simply keeps her
   * idle — a missing face degrades, it never blanks the portrait.
   */
  expression(face: Expression): void {
    if (!this.onDiscSheet) return;
    const base = EXPRESSION_BASE[this.speaker];
    const idx = EXPRESSIONS.indexOf(face);
    if (base === undefined || idx < 0) return;
    const frame = base + idx;
    if (frame >= this.imgs[0]!.texture.frameTotal) return;
    this.state = null;
    this.setFrameAll(frame);
  }

  /** Play the right talk bank for a line, once, then rest on its idle. */
  talk(text: string): void {
    const bank = BANKS[bankFor(this.speaker, text)];
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
