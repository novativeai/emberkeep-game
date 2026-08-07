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
import { IS_LOW_END } from './Constants';
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
