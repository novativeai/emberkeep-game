/**
 * The live graphics profile, and the one place anything reads it.
 *
 * A mutable holder rather than an `export let`, for the same reason
 * `render-scale.ts` is one: scenes import it without a circular dependency on
 * GameConfig (which imports the scenes).
 *
 * The change signal rides `game.events`, not the typed `EventBus`. Graphics
 * quality is a RENDER-layer concern — no system reads it and no save records
 * it — and that is exactly the channel `POWER_STATE_EVENT` already uses for the
 * same kind of signal.
 */
import { IS_IOS, IS_LOW_END } from './Constants';
import {
  GRAPHICS_PROFILES,
  detectTier,
  loadQuality,
  profileFor,
  qualityLabel,
  resolveTier,
  saveQuality,
  type GraphicsProfile,
  type GraphicsQuality,
  type GraphicsTier
} from './graphics';

/** game.events channel for a graphics change. */
export const GRAPHICS_EVENT = 'graphics:profile';

const hints = (): { deviceMemory?: number; hardwareConcurrency?: number; lowEnd?: boolean } => ({
  deviceMemory:
    typeof navigator !== 'undefined'
      ? (navigator as { deviceMemory?: number }).deviceMemory
      : undefined,
  hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined,
  lowEnd: IS_LOW_END
});

const storage = (): Storage | undefined => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
};

let quality: GraphicsQuality = loadQuality(storage());

export const graphics = {
  get quality(): GraphicsQuality {
    return quality;
  },
  get tier(): GraphicsTier {
    return resolveTier(quality, hints());
  },
  get profile(): GraphicsProfile {
    return profileFor(quality, hints());
  },
  /** What `auto` would pick on this device. */
  get detected(): GraphicsTier {
    return detectTier(hints());
  },
  get label(): string {
    return qualityLabel(quality, hints());
  },
  /**
   * Set and persist. Returns true when the canvas BACKING changed, which is
   * fixed at boot — the caller tells the player a reload is needed rather than
   * pretending the change fully landed.
   */
  set(next: GraphicsQuality): boolean {
    const before = profileFor(quality, hints());
    quality = next;
    saveQuality(next, storage());
    const after = profileFor(quality, hints());
    return before.dprCap !== after.dprCap || before.backingCeiling !== after.backingCeiling;
  }
};

export { GRAPHICS_PROFILES };

/**
 * Whether the LIVE three.js emerald may run on this device — and therefore
 * whether the baked spin sheet is needed instead.
 *
 * One predicate, asked in two places that must never disagree: `BoardScene`
 * decides whether to build the renderer, and `PreloadScene` decides whether to
 * download the 0.46 MB sheet at all. If they drifted apart a device would either
 * pay for both or show a still gem with no sheet behind it.
 *
 * It lives here rather than beside `Crystal3D` because that module imports
 * three.js — asking this question must not be what pulls 600 KB of renderer into
 * the boot path of a device that will never use it.
 */
export function liveCrystalAvailable(): boolean {
  // iOS Safari's renderer process crashes under a SECOND live WebGL context plus
  // its per-frame GPU→CPU readback; the `low` profile declines it on cost.
  return graphics.profile.crystal3d && !IS_IOS;
}
