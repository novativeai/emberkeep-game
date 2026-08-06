import { sequenceFrameKey } from '../ui/themeCore';

/**
 * Built-in PNG-sequence animations shipped WITH the game (Eleanor, the guide;
 * Selyna; the Golden Elder) — always available in the UI Builder's Animations
 * rail (no upload needed) and usable by exported components. Unlike uploaded
 * sequences (self-contained data URLs in ui-theme.json), these are FILE-backed:
 * frames live under `assets/` (Vite publicDir) and load by URL, so referencing
 * one costs nothing in the saved theme.
 *
 * Every talking bank ENDS on the character's rest pose — the last frame is an
 * idle image, held — so a talk resolves into a calm rest instead of freezing
 * mid-word. With `loop:false` (the default) it plays through once and settles on
 * the idle; toggling loop on makes her rest a beat, then talk again.
 */

/** How long the trailing idle pose is held before a looped bank talks again. */
export const IDLE_HOLD_MS = 1500;

export interface BuiltinSequence {
  /** Sequence name anim layers reference (doc-free — resolved from here). */
  key: string;
  label: string;
  /** publicDir-relative folder of the talk frames (indexed 0.png, 1.png, …). */
  dir: string;
  /** Frame extension in that folder. Banks re-encoded to lossless WebP by
   *  `scripts/optimize-art.py` say so here; the build drops a `.png` once its
   *  `.webp` sibling exists, so this is what keeps the two in step. */
  ext?: 'png' | 'webp';
  /** Talk frame count (idle frame is appended after these). */
  count: number;
  /** Per-frame hold (ms) for the talk frames, from the source frames.json. */
  durations: number[];
  /** Idle pose file appended as the final, resting frame. */
  endIdle: string;
  /** Default loop for a dropped layer (false ⇒ play once, rest on the idle). */
  loop: boolean;
}

export const BUILTIN_SEQUENCES: BuiltinSequence[] = [
  // Eleanor and Selyna, in the merge-game art style. Each character's four
  // banks come from TWO generations — a 3x1 blink sheet and a 4x2 mouth sheet,
  // both anchored on her rest plate (nano-banana `posesheet.py`) — so every pose
  // in a bank is drawn in one pass and the drawings agree by construction.
  //
  // THREE length-picked talk banks, the way Laurah's were: the mouth poses are
  // hers, described cell by cell so her hand-tuned per-frame timings still mean
  // what they meant, and the banks are re-orderings of those eight poses.
  // PortraitAnimator picks short / mid / long by line length.
  //
  // Both characters' banks are ALSO baked into the dialogue bubble's disc atlas
  // by `scripts/bake-portrait-disc.py` (cells: rest, rest, talk_short…,
  // talk_mid…, talk_long…, blink…). PortraitAnimator derives those offsets by
  // counting in that fixed order, so the COUNTS here and in the bake script are
  // the contract — the atlas carries no manifest. Regenerate the arrays with
  // `scripts/bake-character-runtime.py`, which prints them into
  // `assets/sprites/<name>-merge/catalog.json`.
  {
    key: 'eleanor_talk_short',
    label: 'Eleanor · Talk · short line',
    dir: 'sprites/eleanor-merge/talk_short',
    count: 5,
    durations: [90, 160, 140, 90, 160],
    endIdle: 'sprites/eleanor-merge/rest.png',
    loop: false
  },
  {
    key: 'eleanor_talk_mid',
    label: 'Eleanor · Talk · medium line',
    dir: 'sprites/eleanor-merge/talk_mid',
    count: 15,
    durations: [90, 160, 90, 140, 160, 90, 140, 90, 160, 90, 140, 90, 90, 160, 90],
    endIdle: 'sprites/eleanor-merge/rest.png',
    loop: false
  },
  {
    key: 'eleanor_talk_long',
    label: 'Eleanor · Talk · long line',
    dir: 'sprites/eleanor-merge/talk_long',
    count: 20,
    durations: [90, 160, 90, 140, 160, 90, 140, 90, 160, 90, 160, 90, 140, 160, 90, 140, 90, 160, 90, 90],
    endIdle: 'sprites/eleanor-merge/rest.png',
    loop: false
  },
  {
    key: 'eleanor_blink',
    label: 'Eleanor · Blink',
    dir: 'sprites/eleanor-merge/blink',
    count: 4,
    durations: [2600, 45, 70, 55],
    endIdle: 'sprites/eleanor-merge/rest.png',
    loop: true
  },
  {
    key: 'selyna_talk_short',
    label: 'Selyna · Talk · short line',
    dir: 'sprites/selyna-merge/talk_short',
    count: 5,
    durations: [90, 160, 140, 90, 160],
    endIdle: 'sprites/selyna-merge/rest.png',
    loop: false
  },
  {
    key: 'selyna_talk_mid',
    label: 'Selyna · Talk · medium line',
    dir: 'sprites/selyna-merge/talk_mid',
    count: 15,
    durations: [90, 160, 90, 140, 160, 90, 140, 90, 160, 90, 140, 90, 90, 160, 90],
    endIdle: 'sprites/selyna-merge/rest.png',
    loop: false
  },
  {
    key: 'selyna_talk_long',
    label: 'Selyna · Talk · long line',
    dir: 'sprites/selyna-merge/talk_long',
    count: 20,
    durations: [90, 160, 90, 140, 160, 90, 140, 90, 160, 90, 160, 90, 140, 160, 90, 140, 90, 160, 90, 90],
    endIdle: 'sprites/selyna-merge/rest.png',
    loop: false
  },
  {
    key: 'selyna_blink',
    label: 'Selyna · Blink',
    dir: 'sprites/selyna-merge/blink',
    count: 4,
    durations: [2600, 45, 70, 55],
    endIdle: 'sprites/selyna-merge/rest.png',
    loop: true
  },
  // The Golden Elder. Unlike Eleanor and Selyna, her talk bank is NOT a
  // phrase-specific viseme track — a dragon muzzle has no lip shapes to read, so
  // it is a generic jaw cycle (small → mid → wide → mid) that loops for as long
  // as a line is on screen, the same approach as the red dragon's roar_talk head
  // frames. Both banks are region-composited against `rest.png`
  // (nano-banana `composite.py`), so every frame is byte-identical to the rest
  // pose outside the eye / muzzle ellipse and a crossfade cannot ghost.
  {
    key: 'golden_elder_blink',
    label: 'Golden Elder · Blink',
    dir: 'sprites/golden-elder/blink',
    ext: 'webp',
    count: 4,
    durations: [2600, 45, 70, 55],
    endIdle: 'sprites/golden-elder/rest.webp',
    loop: true
  },
  {
    key: 'golden_elder_talk',
    label: 'Golden Elder · Speaking',
    dir: 'sprites/golden-elder/talk',
    ext: 'webp',
    count: 4,
    durations: [110, 90, 130, 90],
    endIdle: 'sprites/golden-elder/rest.webp',
    loop: true
  }
];

const BY_KEY = new Map(BUILTIN_SEQUENCES.map((s) => [s.key, s]));

export const builtinSequence = (key: string): BuiltinSequence | undefined => BY_KEY.get(key);
export const isBuiltinSequence = (key: string): boolean => BY_KEY.has(key);

/** Ordered publicDir-relative file paths: talk frames, then the idle pose. */
export function builtinSequenceFiles(seq: BuiltinSequence): string[] {
  const files = Array.from({ length: seq.count }, (_, i) => `${seq.dir}/${i}.${seq.ext ?? 'png'}`);
  files.push(seq.endIdle);
  return files;
}

/** Per-frame durations parallel to builtinSequenceFiles (idle hold last). */
export function builtinSequenceDurations(seq: BuiltinSequence): number[] {
  return [...seq.durations, IDLE_HOLD_MS];
}

/** Frame texture keys (same `seq_<name>_<i>` scheme as uploads). */
export function builtinSequenceFrameKeys(seq: BuiltinSequence): string[] {
  return builtinSequenceFiles(seq).map((_, i) => sequenceFrameKey(seq.key, i));
}
