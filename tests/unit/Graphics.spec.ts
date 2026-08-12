import { describe, expect, it } from 'vitest';

import { POWER } from '../../src/core/Constants';
import {
  GRAPHICS_PROFILES,
  GRAPHICS_QUALITIES,
  cappedTier,
  detectTier,
  loadQuality,
  profileFor,
  qualityLabel,
  resolveTier,
  type GraphicsQuality,
  type GraphicsTier
} from '../../src/core/graphics';
import { TIER_ORDER } from '../../src/render/fx/emitterTypes';

const rank = (t: GraphicsTier): number => ['low', 'balanced', 'high'].indexOf(t);

/**
 * The whole feature rests on one promise: adding low-tier support must not cost
 * a capable device anything. These tests are that promise written down — the
 * `high` profile has to carry the engine's own pre-existing numbers, and every
 * lever has to be monotonic so a lower tier can never ask for MORE work.
 */
describe('the high profile changes nothing', () => {
  const high = GRAPHICS_PROFILES.high;

  it('runs the frame rate the engine always ran', () => {
    expect(high.activeFps).toBe(POWER.activeFps);
  });

  it('keeps the framebuffer the engine always allocated', () => {
    // GameConfig's own caps before this feature existed: dpr 3, ceiling 1.5.
    expect(high.dprCap).toBe(3);
    expect(high.backingCeiling).toBe(1.5);
  });

  it('leaves every effect on at full quality', () => {
    expect(high.fxCeiling).toBe('high');
    expect(high.weather).toBe(true);
    expect(high.crystal3d).toBe(true);
    expect(high.ambient).toBe(1);
  });
});

describe('the lower tiers only ever subtract', () => {
  const order: GraphicsTier[] = ['high', 'balanced', 'low'];

  it('never raises a cost as the tier drops', () => {
    for (let i = 1; i < order.length; i++) {
      const better = GRAPHICS_PROFILES[order[i - 1]];
      const worse = GRAPHICS_PROFILES[order[i]];
      expect(worse.dprCap, order[i]).toBeLessThanOrEqual(better.dprCap);
      expect(worse.backingCeiling, order[i]).toBeLessThanOrEqual(better.backingCeiling);
      expect(worse.ambient, order[i]).toBeLessThanOrEqual(better.ambient);
      expect(worse.activeFps, order[i]).toBeLessThanOrEqual(better.activeFps);
      expect(TIER_ORDER.indexOf(worse.fxCeiling), order[i])
        .toBeLessThanOrEqual(TIER_ORDER.indexOf(better.fxCeiling));
      expect(Number(worse.weather), order[i]).toBeLessThanOrEqual(Number(better.weather));
      expect(Number(worse.crystal3d), order[i]).toBeLessThanOrEqual(Number(better.crystal3d));
    }
  });

  it('actually cuts something at every step', () => {
    for (let i = 1; i < order.length; i++) {
      const better = GRAPHICS_PROFILES[order[i - 1]];
      const worse = GRAPHICS_PROFILES[order[i]];
      expect(JSON.stringify(worse), `${order[i]} is a real step down`).not.toBe(JSON.stringify(better));
    }
  });

  it('gives the lowest tier a genuinely cheap frame', () => {
    const low = GRAPHICS_PROFILES.low;
    expect(low.weather).toBe(false);
    expect(low.crystal3d).toBe(false);
    expect(low.activeFps).toBeLessThanOrEqual(30);
    expect(low.backingCeiling).toBeLessThan(1); // under-cuts device pixels
  });
});

describe('detectTier', () => {
  it('sends a capable device to high', () => {
    expect(detectTier({ deviceMemory: 16, hardwareConcurrency: 12 })).toBe('high');
  });

  it('sends the existing IS_LOW_END population to balanced, not low', () => {
    // They already ran the game; dropping them straight to Low would be a
    // downgrade of a working experience, not a rescue.
    expect(detectTier({ deviceMemory: 4, hardwareConcurrency: 4, lowEnd: true })).toBe('balanced');
  });

  it('sends genuinely weak hardware to low', () => {
    expect(detectTier({ deviceMemory: 2 })).toBe('low');
    expect(detectTier({ hardwareConcurrency: 2 })).toBe('low');
  });

  it('assumes an unknown device is modern', () => {
    // An unrecognised browser is far likelier to be current than a decade old;
    // guessing low would quietly degrade it with no way for the player to know.
    expect(detectTier({})).toBe('high');
  });

  it('never picks a tier above what the hints justify', () => {
    expect(rank(detectTier({ deviceMemory: 2, lowEnd: true }))).toBeLessThan(rank('balanced'));
  });
});

describe('resolveTier and the player override', () => {
  it('honours an explicit pick over the device', () => {
    for (const q of ['high', 'balanced', 'low'] as const) {
      expect(resolveTier(q, { deviceMemory: 1, hardwareConcurrency: 1 })).toBe(q);
    }
  });

  it('lets a strong device be forced down and a weak one forced up', () => {
    expect(profileFor('low', { deviceMemory: 32 }).weather).toBe(false);
    expect(profileFor('high', { deviceMemory: 1 }).weather).toBe(true);
  });

  it('offers auto plus one entry per tier, auto first', () => {
    expect(GRAPHICS_QUALITIES[0]).toBe('auto');
    expect([...GRAPHICS_QUALITIES].sort()).toEqual(['auto', 'balanced', 'high', 'low']);
  });

  it('says what auto resolved to, so the player is never guessing', () => {
    expect(qualityLabel('auto', { deviceMemory: 16 })).toBe('Graphics: Auto (High)');
    expect(qualityLabel('auto', { deviceMemory: 2 })).toBe('Graphics: Auto (Low)');
    expect(qualityLabel('low', { deviceMemory: 16 })).toBe('Graphics: Low');
  });
});

describe('loadQuality', () => {
  const store = (v: string | null): Pick<Storage, 'getItem'> => ({ getItem: () => v });

  it('defaults to auto', () => {
    expect(loadQuality(store(null))).toBe('auto');
    expect(loadQuality(undefined)).toBe('auto');
  });

  it('rejects a value it does not recognise', () => {
    expect(loadQuality(store('ultra'))).toBe('auto');
  });

  it('round-trips every real option', () => {
    for (const q of GRAPHICS_QUALITIES) expect(loadQuality(store(q))).toBe(q as GraphicsQuality);
  });

  it('survives storage that throws (private mode)', () => {
    expect(loadQuality({ getItem: () => { throw new Error('denied'); } })).toBe('auto');
  });
});

describe('cappedTier', () => {
  it('takes the lower of what was asked and what is allowed', () => {
    expect(cappedTier('high', 'medium')).toBe('medium');
    expect(cappedTier('low', 'high')).toBe('low');
    expect(cappedTier('high', 'high')).toBe('high');
  });

  it('never lets a ceiling RAISE a tier', () => {
    // doze asks for `off`; no profile may promote that back into rendering.
    expect(cappedTier('off', 'high')).toBe('off');
  });
});
