/**
 * Graphics quality — the device tier, and the player's override of it.
 *
 * ## The contract that shapes everything here
 *
 * `high` MUST reproduce today's behaviour exactly. Every number in the `high`
 * profile is the value the engine already used on a capable device, so a strong
 * machine sees no change of any kind. Low-tier support is added strictly BELOW
 * it — `balanced` and `low` are new floors, never a ceiling brought down.
 *
 * ## Why the tier is not just `IS_LOW_END`
 *
 * `IS_LOW_END` already existed but only ever tuned the canvas backing. Nothing
 * else scaled with the device: a four-year-old phone ran the same particle
 * counts, the same procedural sky and the same live three.js crystal as a
 * desktop. The backing is the biggest single lever, but it is not the only one,
 * and it is the one the player can least afford to lose (it costs sharpness
 * everywhere). Cutting effects first, resolution last, is the right order.
 *
 * ## What each lever actually buys
 *
 * - `dprCap` / `backingCeiling` — framebuffer pixels, the #1 GPU-memory and
 *   fill-rate cost. Boot-time only: the canvas backing is fixed when Phaser
 *   starts, so a change here needs a reload.
 * - `fxCeiling` — caps the tier the power governor may ask for, so emitters,
 *   aurora and snow all run cheaper. Live.
 * - `weather` — skips the procedural sky and snowfall entirely. Live (the board
 *   rebuilds).
 * - `crystal3d` — the offscreen three.js render. Live.
 * - `ambient` — multiplier on ambient emitter emission. Live.
 * - `activeFps` — halving the frame rate roughly halves GPU work and is the
 *   bluntest, most reliable win on a weak device. Live.
 *
 * Phaser-free, so the profiles and the resolution rules are unit-testable.
 */
import type { FxTier } from '../render/fx/emitterTypes';

/** What the player picks. `auto` reads the device. */
export type GraphicsQuality = 'auto' | 'high' | 'balanced' | 'low';

/** What `auto` resolves to, and what the engine actually runs. */
export type GraphicsTier = 'high' | 'balanced' | 'low';

export const GRAPHICS_QUALITIES: readonly GraphicsQuality[] = ['auto', 'high', 'balanced', 'low'];

export interface GraphicsProfile {
  label: string;
  /** One line, shown under the setting. */
  note: string;
  /** devicePixelRatio cap. */
  dprCap: number;
  /** Upper bound on the supersample backing. */
  backingCeiling: number;
  /** Highest FX tier the power governor may ask for. */
  fxCeiling: FxTier;
  /** Procedural sky + weather at all. */
  weather: boolean;
  /** The live three.js crystal (an offscreen render every few frames). */
  crystal3d: boolean;
  /** Multiplier on ambient emitter emission — <1 means fewer motes. */
  ambient: number;
  /** Frame-rate cap while the player is active. */
  activeFps: number;
  /**
   * How much DECODED dragon-clip texture the board may keep resident, in MB.
   * Breeds past this are released oldest-first once they leave the board
   * (`src/core/clipResidency.ts`). One breed is 40–130 MB, so this is the
   * difference between a long session and a killed tab — it is a budget for
   * what is KEPT, never a cap on what may be shown.
   */
  clipBudgetMb: number;
}

/**
 * `high` is today's engine, unchanged — see the contract above. The other two
 * only ever subtract.
 */
export const GRAPHICS_PROFILES: Record<GraphicsTier, GraphicsProfile> = {
  high: {
    label: 'High',
    note: 'Everything on, full resolution.',
    dprCap: 3,
    backingCeiling: 1.5,
    fxCeiling: 'high',
    weather: true,
    crystal3d: true,
    ambient: 1,
    activeFps: 62,
    clipBudgetMb: 640
  },
  balanced: {
    label: 'Balanced',
    note: 'Lighter effects and a smaller framebuffer. Everything still there.',
    dprCap: 2,
    backingCeiling: 1,
    fxCeiling: 'medium',
    weather: true,
    crystal3d: true,
    ambient: 0.6,
    activeFps: 62,
    clipBudgetMb: 320
  },
  low: {
    label: 'Low',
    note: 'For older phones: no weather, simplest effects, 30 fps.',
    dprCap: 1.5,
    backingCeiling: 0.6,
    fxCeiling: 'low',
    weather: false,
    crystal3d: false,
    ambient: 0.25,
    activeFps: 30,
    clipBudgetMb: 160
  }
};

/** localStorage key. Deliberately NOT in the save — resetting the hollow must
 *  not throw the player back to a quality their device cannot run. */
export const GRAPHICS_KEY = 'emberkeep:graphics';

interface DeviceHints {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  lowEnd?: boolean;
}

/**
 * What `auto` picks.
 *
 * Two bands below `high`. The severe band (≤2 GB or ≤2 cores) is the hardware
 * that cannot hold the framebuffer at all; the middle band is the existing
 * `IS_LOW_END` population, which until now got a smaller canvas and nothing
 * else. Anything unknown resolves to `high` — an unrecognised device is far
 * more likely to be a current one than a decade-old one, and guessing low would
 * quietly degrade it.
 */
export function detectTier(hints: DeviceHints): GraphicsTier {
  const mem = hints.deviceMemory;
  const cores = hints.hardwareConcurrency;
  if ((typeof mem === 'number' && mem <= 2) || (typeof cores === 'number' && cores <= 2)) return 'low';
  if (hints.lowEnd) return 'balanced';
  return 'high';
}

export function resolveTier(quality: GraphicsQuality, hints: DeviceHints): GraphicsTier {
  return quality === 'auto' ? detectTier(hints) : quality;
}

export function profileFor(quality: GraphicsQuality, hints: DeviceHints): GraphicsProfile {
  return GRAPHICS_PROFILES[resolveTier(quality, hints)];
}

/** Read the player's choice. Anything unrecognised falls back to `auto`. */
export function loadQuality(storage?: Pick<Storage, 'getItem'>): GraphicsQuality {
  try {
    const raw = storage?.getItem(GRAPHICS_KEY);
    return GRAPHICS_QUALITIES.includes(raw as GraphicsQuality) ? (raw as GraphicsQuality) : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveQuality(quality: GraphicsQuality, storage?: Pick<Storage, 'setItem'>): void {
  try {
    storage?.setItem(GRAPHICS_KEY, quality);
  } catch {
    /* private mode — the setting simply does not persist */
  }
}

/** Label for the settings button, e.g. `Graphics: Auto (High)`. */
export function qualityLabel(quality: GraphicsQuality, hints: DeviceHints): string {
  if (quality === 'auto') return `Graphics: Auto (${GRAPHICS_PROFILES[detectTier(hints)].label})`;
  return `Graphics: ${GRAPHICS_PROFILES[quality].label}`;
}

/** The tier a governor state may reach, once the profile's ceiling applies. */
export function cappedTier(want: FxTier, ceiling: FxTier): FxTier {
  const order: FxTier[] = ['off', 'low', 'medium', 'high'];
  return order[Math.min(order.indexOf(want), order.indexOf(ceiling))] ?? 'off';
}
