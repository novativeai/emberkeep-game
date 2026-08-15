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
      expect(liveSpaceFor(w, h)).toEqual({ w: GAME_WIDTH, h: GAME_HEIGHT });
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
      expect(aspectOf(liveSpaceFor(w, h))).toBeCloseTo(w / h, 2);
    }
  });

  it('grows the long axis and never shrinks below the authored space', () => {
    for (const [w, h] of [
      [1920, 1080],
      [2560, 1080],
      [900, 1200],
      [1440, 960]
    ]) {
      const s = liveSpaceFor(w, h);
      expect(s.w).toBeGreaterThanOrEqual(GAME_WIDTH);
      expect(s.h).toBeGreaterThanOrEqual(GAME_HEIGHT);
      // Exactly one axis grows: the short one stays pinned.
      expect(s.w === GAME_WIDTH || s.h === GAME_HEIGHT).toBe(true);
    }
  });

  it('a wider window is never a SHORTER space (16:9 keeps the full 1600)', () => {
    expect(liveSpaceFor(1920, 1080)).toEqual({ w: 2844, h: GAME_HEIGHT });
    expect(liveSpaceFor(1440, 960)).toEqual({ w: GAME_WIDTH, h: 1707 });
  });

  it('clamps an absurd aspect rather than inflating the backing', () => {
    const ultra = liveSpaceFor(5120, 1080); // 4.74:1
    expect(aspectOf(ultra)).toBeCloseTo(2.4, 2);
    const sliver = liveSpaceFor(400, 2000); // 1:5
    expect(aspectOf(sliver)).toBeCloseTo(1 / 2.4, 2);
  });

  // Phones. The rule used to special-case them into an always-portrait space,
  // which is what forced the "rotate to portrait" overlay; these pin that the
  // upright result did not change when that exception went away, and that a
  // sideways phone now gets a space of its own instead of a nag.
  it('an upright phone still gets the portrait space the old rule built', () => {
    for (const [w, h] of [
      [390, 844], // iPhone 14/15
      [393, 852], // iPhone 15 Pro
      [430, 932], // iPhone 15 Pro Max
      [375, 667] // iPhone SE
    ]) {
      const s = liveSpaceFor(w, h);
      expect(s.w).toBe(GAME_WIDTH); // width is pinned — the phone's short side
      expect(s.h).toBe(Math.round(GAME_WIDTH * Math.min(2.4, h / w)));
      expect(s.h).toBeGreaterThan(GAME_HEIGHT);
    }
  });

  it('a phone held sideways gets a LANDSCAPE space, not a squeezed portrait one', () => {
    const onItsSide = liveSpaceFor(844, 390);
    expect(aspectOf(onItsSide)).toBeCloseTo(844 / 390, 2);
    expect(onItsSide.h).toBe(GAME_HEIGHT); // height pinned now — it is the short side
    expect(onItsSide.w).toBeGreaterThan(GAME_WIDTH);
  });

  it('caps the portrait space at 2.4x so a long phone cannot run the backing away', () => {
    expect(liveSpaceFor(400, 4000).h).toBe(Math.round(GAME_WIDTH * 2.4));
  });
});
