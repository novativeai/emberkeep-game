import { describe, expect, it } from 'vitest';
import { unzoomedRect } from '../../src/render/fx/cameraFit';
import { GAME_WIDTH, LIVE_GAME_HEIGHT } from '../../src/core/Constants';

/**
 * WEATHER IS PINNED TO THE SCREEN, AND ZOOM IS THE HALF THAT `scrollFactor` MISSES.
 *
 * `setScrollFactor(0)` stops a quad sliding when the board camera pans. Phaser
 * still applies the camera ZOOM to it, about the camera's centre, so a
 * full-screen quad covers the viewport at zoom 1 and a shrinking box in the
 * middle at anything below it. Measured in Borealis before the fix: at zoom 0.5
 * the snowfield ran x 640→1920 of a 2560-wide viewport, at zoom 0.3 x 896→1664.
 *
 * `unzoomedRect` inverts Phaser's own line — `screen = (x − cx)·zoom + cx` — so
 * the test is that composing the two gets the screen rect back, at every zoom
 * the board allows (`map.json` cameraZoom 0.2 … 1.4).
 */
describe('a screen-pinned quad inside a zooming camera', () => {
  /** Only what `unzoomedRect` reads. The real camera brings 60 other fields. */
  const camera = (zoom: number) =>
    ({ zoom, width: GAME_WIDTH, height: LIVE_GAME_HEIGHT }) as unknown as Parameters<
      typeof unzoomedRect
    >[0];

  /** Phaser's transform for a scrollFactor-0 object, verbatim. */
  const toScreen = (zoom: number, v: number, centre: number) => (v - centre) * zoom + centre;

  const ZOOMS = [0.2, 0.3, 0.5, 1, 1.05, 1.4];

  it('covers the whole viewport at every zoom the board allows', () => {
    for (const zoom of ZOOMS) {
      const cam = camera(zoom);
      const r = unzoomedRect(cam, 0, 0, GAME_WIDTH, LIVE_GAME_HEIGHT);
      const cx = GAME_WIDTH / 2;
      const cy = LIVE_GAME_HEIGHT / 2;
      expect(toScreen(zoom, r.x, cx)).toBeCloseTo(0, 6);
      expect(toScreen(zoom, r.x + r.width, cx)).toBeCloseTo(GAME_WIDTH, 6);
      expect(toScreen(zoom, r.y, cy)).toBeCloseTo(0, 6);
      expect(toScreen(zoom, r.y + r.height, cy)).toBeCloseTo(LIVE_GAME_HEIGHT, 6);
    }
  });

  it('keeps a BAND at the top of the screen, where the sky is', () => {
    // The aurora is half-height: it must stay pinned to the top edge, not drift
    // toward the middle as the camera pulls back.
    const band = LIVE_GAME_HEIGHT * 0.5;
    for (const zoom of ZOOMS) {
      const r = unzoomedRect(camera(zoom), 0, 0, GAME_WIDTH, band);
      const cy = LIVE_GAME_HEIGHT / 2;
      expect(toScreen(zoom, r.y, cy)).toBeCloseTo(0, 6);
      expect(toScreen(zoom, r.y + r.height, cy)).toBeCloseTo(band, 6);
    }
  });

  it('is the identity at zoom 1, so nothing moves on the common case', () => {
    const r = unzoomedRect(camera(1), 0, 0, GAME_WIDTH, LIVE_GAME_HEIGHT);
    expect(r).toEqual({ x: 0, y: 0, width: GAME_WIDTH, height: LIVE_GAME_HEIGHT });
  });

  it('treats a zoom of 0 as 1 rather than dividing by it', () => {
    // A camera mid-transition can report 0; an infinite quad would take the
    // renderer down with it.
    const r = unzoomedRect(camera(0), 0, 0, GAME_WIDTH, LIVE_GAME_HEIGHT);
    expect(Number.isFinite(r.width)).toBe(true);
    expect(r.width).toBe(GAME_WIDTH);
  });
});
