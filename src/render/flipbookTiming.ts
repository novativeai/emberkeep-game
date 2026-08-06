/**
 * Flipbook frame maths — deliberately Phaser-free so it unit-tests in node.
 *
 * Everything is derived from ELAPSED TIME, never from a frame counter: the
 * power governor drops the render loop to 30 or 15 fps, and a counter-driven
 * flipbook would slow down with it. Driving off GameClock also keeps
 * `window.advanceTime(ms)` deterministic for the e2e run.
 */

export interface FlipbookFrame {
  /** Frame index to sample as A. */
  a: number;
  /** Frame index to sample as B. */
  b: number;
  /** 0..1 position between A and B — the shader's blend factor. */
  t: number;
  /** True once a one-shot has played out (always false while looping). */
  done: boolean;
}

/** Total play time of one pass, in ms. */
export function flipbookDurationMs(frames: number, fps: number): number {
  return (Math.max(1, frames) / Math.max(0.001, fps)) * 1000;
}

/**
 * Resolve the two frames to blend and how far between them we are.
 *
 * Looping sheets wrap A->B across the seam (the baker computes flow across it
 * too). One-shots freeze on the last frame with t = 0 so the final frame is
 * never warped toward a wrapped-around neighbour.
 */
export function flipbookFrameAt(
  elapsedMs: number,
  fps: number,
  frames: number,
  loop: boolean
): FlipbookFrame {
  const n = Math.max(1, Math.floor(frames));
  if (n === 1) return { a: 0, b: 0, t: 0, done: !loop && elapsedMs >= flipbookDurationMs(n, fps) };

  const pos = (Math.max(0, elapsedMs) / 1000) * fps; // in frames

  if (loop) {
    const wrapped = ((pos % n) + n) % n;
    const a = Math.floor(wrapped) % n;
    return { a, b: (a + 1) % n, t: wrapped - Math.floor(wrapped), done: false };
  }

  if (pos >= n - 1) return { a: n - 1, b: n - 1, t: 0, done: pos >= n };
  const a = Math.floor(pos);
  return { a, b: a + 1, t: pos - a, done: false };
}

/**
 * Erosion amount over a one-shot's life.
 *
 * `hold` is the fraction of the life that plays untouched before the burn-away
 * starts; the remainder ramps to 1 (fully dissolved). Looping effects pass
 * hold = 1 and never erode.
 */
export function flipbookErosion(progress01: number, hold: number): number {
  if (hold >= 1) return 0;
  const p = Math.min(1, Math.max(0, progress01));
  if (p <= hold) return 0;
  return (p - hold) / (1 - hold);
}
