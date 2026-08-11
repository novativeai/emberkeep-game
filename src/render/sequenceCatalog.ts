import { sequenceFrameKey } from '../ui/themeCore';

/**
 * Built-in PNG-sequence animations shipped WITH the game (Laurah, the guide) —
 * always available in the UI Builder's Animations rail (no upload needed) and
 * usable by exported components. Unlike uploaded sequences (self-contained data
 * URLs in ui-theme.json), these are FILE-backed: frames live under `assets/`
 * (Vite publicDir) and load by URL, so referencing one costs nothing in the
 * saved theme.
 *
 * Every talking bank ENDS on one of Laurah's two idle poses — the last frame is
 * an idle image, held — so a talk resolves into a calm rest instead of freezing
 * mid-word. With `loop:false` (the default) it plays through once and settles on
 * the idle; toggling loop on makes her rest a beat, then talk again.
 */

const IDLE = {
  one: 'sprites/laurah/idle_1.png',
  two: 'sprites/laurah/idle_2.png'
} as const;

/** Eleanor has ONE rest pose, not Laurah's pair — her banks all settle on it. */
const ELEANOR_REST = 'sprites/eleanor-merge/rest.webp';

/** How long the trailing idle pose is held before a looped bank talks again. */
export const IDLE_HOLD_MS = 1500;

export interface BuiltinSequence {
  /** Sequence name anim layers reference (doc-free — resolved from here). */
  key: string;
  label: string;
  /** publicDir-relative folder of the talk frames (indexed 0.png, 1.png, …). */
  dir: string;
  /** Talk frame count (idle frame is appended after these). */
  count: number;
  /** Per-frame hold (ms) for the talk frames, from the source frames.json. */
  durations: number[];
  /** Idle pose file appended as the final, resting frame. */
  endIdle: string;
  /** Frame file extension (default 'png'). Eleanor's banks are baked as webp. */
  ext?: string;
  /** Default loop for a dropped layer (false ⇒ play once, rest on the idle). */
  loop: boolean;
}

export const BUILTIN_SEQUENCES: BuiltinSequence[] = [
  {
    key: 'laurah_talk_short',
    label: 'Laurah · Hey hey!',
    dir: 'sprites/laurah/talk_short',
    count: 5,
    durations: [90, 160, 140, 90, 160],
    endIdle: IDLE.one,
    loop: false
  },
  {
    key: 'laurah_talk_mid',
    label: 'Laurah · This is so great',
    dir: 'sprites/laurah/talk_mid',
    count: 15,
    durations: [90, 160, 90, 140, 160, 90, 140, 90, 160, 90, 140, 90, 90, 160, 90],
    // idle_2 (IDLE.two) has an open, talking mouth — every bank must rest on a
    // CLOSED mouth, so this ends on idle_1 like the others.
    endIdle: IDLE.one,
    loop: false
  },
  {
    key: 'laurah_talk_long',
    label: 'Laurah · What is going on guys',
    dir: 'sprites/laurah/talk_long',
    count: 20,
    durations: [90, 160, 90, 140, 160, 90, 140, 90, 160, 90, 160, 90, 140, 160, 90, 140, 90, 160, 90, 90],
    endIdle: IDLE.one,
    loop: false
  },
  // ── Eleanor ──────────────────────────────────────────────────────────────
  // Her banks, from main (2026-08-06). The ORDER matters and is not cosmetic:
  // `PortraitAnimator` walks this list to compute each bank's offset into the
  // baked disc atlas, which is laid out rest-pair-then-banks in exactly this
  // sequence. Regenerating her art means regenerating both together —
  // `assets/sprites/eleanor-merge/catalog.json` is the contract, the atlas
  // itself carries no manifest.
  //
  // `blink` is a real bank here (Laurah has none): it occupies frames in the
  // atlas, so it must be listed to keep the offsets honest, even though
  // `bankFor` never selects it for a spoken line.
  {
    key: 'eleanor_talk_short',
    label: 'Eleanor · Talk · short line',
    dir: 'sprites/eleanor-merge/talk_short',
    ext: 'webp',
    count: 5,
    durations: [90, 160, 140, 90, 160],
    endIdle: ELEANOR_REST,
    loop: false
  },
  {
    key: 'eleanor_talk_mid',
    label: 'Eleanor · Talk · medium line',
    dir: 'sprites/eleanor-merge/talk_mid',
    ext: 'webp',
    count: 15,
    durations: [90, 160, 90, 140, 160, 90, 140, 90, 160, 90, 140, 90, 90, 160, 90],
    endIdle: ELEANOR_REST,
    loop: false
  },
  {
    key: 'eleanor_talk_long',
    label: 'Eleanor · Talk · long line',
    dir: 'sprites/eleanor-merge/talk_long',
    ext: 'webp',
    count: 20,
    durations: [90, 160, 90, 140, 160, 90, 140, 90, 160, 90, 160, 90, 140, 160, 90, 140, 90, 160, 90, 90],
    endIdle: ELEANOR_REST,
    loop: false
  },
  {
    key: 'eleanor_blink',
    label: 'Eleanor · Blink',
    dir: 'sprites/eleanor-merge/blink',
    ext: 'webp',
    count: 4,
    durations: [2600, 45, 70, 55],
    endIdle: ELEANOR_REST,
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
