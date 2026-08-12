import type Phaser from 'phaser';

/**
 * WHERE A FULL-SCREEN QUAD HAS TO SIT INSIDE A CAMERA THAT ZOOMS.
 *
 * `setScrollFactor(0)` is only half of "pinned to the screen". It stops an
 * object sliding when the camera PANS; it does nothing about zoom, which Phaser
 * still applies, about the camera's centre:
 *
 *     screenX = (x − cx)·zoom + cx        cx = camera.width / 2
 *
 * So a 2560×1600 quad at (0,0) covers the viewport at zoom 1 and nothing like it
 * anywhere else. Measured in Borealis: at zoom 0.5 the snowfield ran from x 640
 * to 1920 of a 2560-wide viewport, at zoom 0.3 from 896 to 1664 — the weather
 * shrank into a box in the middle of the screen the moment the player pinched
 * out, which is exactly when they are looking at the most sky.
 *
 * Inverting that line gives the rect the quad must occupy in the camera's own
 * space to land on a chosen rect of the screen. Both weather layers re-fit
 * through this every frame the zoom changes, and nothing else about them moves:
 * the shader reads UV, so a quad that is twice as wide in world units still
 * draws the same flakes at the same size on screen.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The world-space rect a `scrollFactor 0` object must occupy so that it renders
 * exactly over the screen rect `(x, y, width, height)`, in game pixels.
 *
 * A zoom of 0 would be a camera showing nothing; it is treated as 1 rather than
 * dividing by it, so a mid-transition frame cannot produce an infinite quad.
 */
export function unzoomedRect(
  cam: Phaser.Cameras.Scene2D.Camera,
  x: number,
  y: number,
  width: number,
  height: number
): Rect {
  const zoom = cam.zoom || 1;
  const cx = cam.width / 2;
  const cy = cam.height / 2;
  return {
    x: cx + (x - cx) / zoom,
    y: cy + (y - cy) / zoom,
    width: width / zoom,
    height: height / zoom
  };
}
