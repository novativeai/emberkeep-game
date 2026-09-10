import { UNLIMITED_WARMTH } from './Constants';

/**
 * UNLIMITED WARMTH — the pure layer (no Phaser, no state).
 *
 * The hub's Hearth Hoard carries 5 real days during which Warmth harvest taps
 * and Warmth skips cost nothing, except skips on a building (see
 * `GeneratorSystem.skipWarmthUse`). Every price site asks `warmthPrice` rather
 * than re-deriving "is it active and does it cover this", so the board's pin,
 * the bus-level spend and the recipe sheet can never disagree.
 *
 * `until` is REAL epoch ms and `wallNow` is `GameClock.wallNow()` — never
 * `now()`, which a load rebases and a hidden tab freezes.
 */

export type WarmthUse = 'harvest' | 'skip' | 'skip_building';

export const unlimitedWarmthActive = (until: number, wallNow: number): boolean => until > wallNow;

export function warmthPrice(base: number, use: WarmthUse, until: number, wallNow: number): number {
  return unlimitedWarmthActive(until, wallNow) && (UNLIMITED_WARMTH.covers as readonly string[]).includes(use)
    ? 0
    : base;
}

/** Rounds UP at the unit shown, so a fresh 5-day grant reads "5d 0h". */
export function formatUnlimitedLeft(ms: number): string {
  if (ms <= 0) return '0:00';
  const s = Math.ceil(ms / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const m = Math.ceil(ms / 60_000);
  if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m`;
  const h = Math.ceil(ms / 3_600_000);
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "15 Sep, 14:02", local time. A fixed table, not toLocaleString (en-GB prints "Sept"). */
export function formatUntil(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
