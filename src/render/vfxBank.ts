/**
 * VFX bank — which flipbook plays on which game beat.
 *
 * The bank (assets/vfx-bank/) holds nine motion-vector flipbooks; the game ships
 * only the ones a beat actually earns, because each costs real VRAM (a decoded
 * pack + motion-vector pair is ~3.4MB for the 192px sheets). SHIPPED is the
 * budget, BEATS is the placement.
 *
 * Every beat is ADDITIVE — the existing particle bursts stay exactly as they
 * were and the flipbook layers on top. If the bank is missing (it is pruned from
 * `dist` unless explicitly kept, see vite.config.ts) `hasFlipbook` returns false
 * and the beat plays as it always did. Nothing breaks; it just looks like it did
 * before.
 */
import type { FlipbookOptions, FlipbookSheet } from './FlipbookFX';
import bank from '../data/vfx-flipbooks.json';

interface BankFile {
  base: string;
  ramps: string;
  sheets: Record<string, Omit<FlipbookSheet, 'key'>>;
}
const BANK = bank as unknown as BankFile;

/**
 * The sheets the GAME loads. Everything else in the bank stays a workspace
 * asset. Loading all nine would be ~19.8MB, which the old-device budget will
 * not wear, so this list is the budget and it is deliberately short:
 *
 *   fb_fireburst / fb_dustburst  the payoff beats (hatch, finale, merge, chest)
 *   fb_flame / fb_smoke_wispy    the world emitters (docs/vfx-textures.md §7)
 *
 * ~10.8MB of texture memory in total. The dist prune reads this list directly
 * (vite.config.ts), so adding a sheet here is all it takes to ship it — and
 * `fb_flame_small` must never be added: it is baked with its art overflowing
 * its own cell borders. `python3 scripts/audit-sheet-bleed.py`.
 */
export const SHIPPED = ['fb_fireburst', 'fb_dustburst', 'fb_flame', 'fb_smoke_wispy'] as const;

export type BeatKey = 'hatch' | 'elder' | 'merge' | 'chest' | 'favourite';

/** Placement per beat, in GAME-SPACE px (the 2560x1600 canvas). */
export interface BeatSpec {
  sheet: (typeof SHIPPED)[number];
  /** Width on screen; height follows the cell aspect. */
  size: number;
  /** Offset from the beat's anchor point — matched to the existing glowFlash. */
  dy: number;
  opts: FlipbookOptions;
}

export const BEATS: Record<BeatKey, BeatSpec> = {
  /** Egg cracks open. The game's signature beat — the biggest non-finale FX. */
  hatch: {
    sheet: 'fb_fireburst',
    size: 340,
    dy: -60,
    opts: { ramp: 'ember', fps: 15, emissive: 0.9, erodeHold: 0.6, alpha: 0.95 }
  },
  /** The finale's Elder rising at the altar — same sheet, bigger and gold. */
  elder: {
    sheet: 'fb_fireburst',
    size: 520,
    dy: -40,
    opts: { ramp: 'gold', fps: 11, emissive: 1.15, erodeHold: 0.7, alpha: 1 }
  },
  /**
   * Every ordinary merge: a small ash puff under the pop, not a fireball.
   * This one fires constantly, so it is deliberately the faintest in the set —
   * at alpha 0.5 it read as a solid white cloud on the dark board rather than
   * dust, and an effect the player sees hundreds of times has to whisper.
   */
  merge: {
    sheet: 'fb_dustburst',
    size: 190,
    dy: -30,
    opts: { ramp: 'smoke', fps: 20, emissive: 0.05, erodeHold: 0.35, alpha: 0.3 }
  },
  /**
   * A dragon gets the ONE thing its breed loves. Between a merge and a hatch on
   * purpose: bigger than an everyday beat, because a favourite is rare and moves
   * trust twice as fast — and smaller than a hatch, which happens once.
   */
  favourite: {
    sheet: 'fb_fireburst',
    size: 240,
    dy: -80,
    opts: { ramp: 'ember', fps: 17, emissive: 0.8, erodeHold: 0.5, alpha: 0.85 }
  },
  /** Chest pops its lid — gold dust. */
  chest: {
    sheet: 'fb_dustburst',
    size: 230,
    dy: -52,
    opts: { ramp: 'gold', fps: 18, emissive: 0.5, erodeHold: 0.5, alpha: 0.7 }
  }
};

export const RAMPS_URL = BANK.ramps;
export const BANK_BASE = BANK.base;

/** Sheet metadata, or undefined if the bank was not built. */
export function sheetOf(key: string): FlipbookSheet | undefined {
  const s = BANK.sheets[key];
  return s ? { key, ...s } : undefined;
}

/** The sheets the game should preload — metadata resolved, unknowns dropped. */
export function shippedSheets(): FlipbookSheet[] {
  return SHIPPED.map(sheetOf).filter((s): s is FlipbookSheet => !!s);
}
