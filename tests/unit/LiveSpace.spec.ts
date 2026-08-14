import { describe, expect, it } from 'vitest';
import { GAME_HEIGHT, GAME_WIDTH, liveSpaceFor } from '../../src/core/Constants';

/**
 * The live coordinate space. FIT letterboxes whatever the window does not match,
 * so the space itself has to meet the window's aspect: the SHORT axis stays on
 * its authored constant and the LONG axis grows. These are the properties every
 * screen-space coordinate in the game now depends on.
 */
describe('liveSpaceFor', () => {
  const aspectOf = (s: { w: number; h: number }): number => s.w / s.h;

  it('is the authored space EXACTLY at 16:10 — the aspect e2e runs at', () => {
    for (const [w, h] of [
      [1280, 800],
      [2560, 1600],
      [1920, 1200]
    ]) {
      expect(liveSpaceFor(w, h, false)).toEqual({ w: GAME_WIDTH, h: GAME_HEIGHT });
    }
  });

  it('matches the window aspect, so FIT leaves no bars', () => {
    for (const [w, h] of [
      [1920, 1080], // 16:9
      [1366, 768], // 16:9 laptop
      [2560, 1080], // 21:9 ultrawide
      [1440, 960], // 3:2
      [900, 1200] // tall desktop window
    ]) {
      expect(aspectOf(liveSpaceFor(w, h, false))).toBeCloseTo(w / h, 2);
    }
  });

  it('grows the long axis and never shrinks below the authored space', () => {
    for (const [w, h] of [
      [1920, 1080],
      [2560, 1080],
      [900, 1200],
      [1440, 960]
    ]) {
      const s = liveSpaceFor(w, h, false);
      expect(s.w).toBeGreaterThanOrEqual(GAME_WIDTH);
      expect(s.h).toBeGreaterThanOrEqual(GAME_HEIGHT);
      // Exactly one axis grows: the short one stays pinned.
      expect(s.w === GAME_WIDTH || s.h === GAME_HEIGHT).toBe(true);
    }
  });

  it('a wider window is never a SHORTER space (16:9 keeps the full 1600)', () => {
    expect(liveSpaceFor(1920, 1080, false)).toEqual({ w: 2844, h: GAME_HEIGHT });
    expect(liveSpaceFor(1440, 960, false)).toEqual({ w: GAME_WIDTH, h: 1707 });
  });

  it('clamps an absurd aspect rather than inflating the backing', () => {
    const ultra = liveSpaceFor(5120, 1080, false); // 4.74:1
    expect(aspectOf(ultra)).toBeCloseTo(2.4, 2);
    const sliver = liveSpaceFor(400, 2000, false); // 1:5
    expect(aspectOf(sliver)).toBeCloseTo(1 / 2.4, 2);
  });

  it('mobile is PORTRAIT whichever way the phone is held', () => {
    const upright = liveSpaceFor(390, 844, true);
    const onItsSide = liveSpaceFor(844, 390, true);
    expect(upright).toEqual(onItsSide);
    expect(upright.w).toBe(GAME_WIDTH);
    expect(upright.h).toBeGreaterThan(GAME_HEIGHT);
  });

  it('caps the portrait space at 2.4x so a long phone cannot run the backing away', () => {
    expect(liveSpaceFor(400, 4000, true).h).toBe(Math.round(GAME_WIDTH * 2.4));
  });
});
