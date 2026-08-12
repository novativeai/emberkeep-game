import { describe, expect, it } from 'vitest';
import { DRAGON_OUTLINE } from '../../src/core/Constants';
import {
  frameBox,
  inkQuad,
  inkRadiusTexels,
  keylineUnits,
  uvFence,
  type AlphaBounds
} from '../../src/render/rigInkGeometry';

/**
 * The dragons' runtime keyline (src/render/rigInkShader.ts) draws an ink twin of
 * every rig layer behind all of the art. The twin's quad is the layer's alpha box
 * grown by the outline radius — NOT the layer's full canvas — so it has a
 * different size and origin from the art sprite it shadows.
 *
 * That makes one invariant load-bearing, and invisible until it is wrong: a source
 * texel must land at the same rig-space position through the twin as through the
 * art. If it drifts, the outline slides off the dragon by a few pixels — which
 * reads as a shadow, not a keyline. These tests pin the arithmetic.
 */

/** Rig-space position of a source texel, as the ART sprite places it. */
function viaArt(texel: number, pivot: number, origin: number, texSize: number): number {
  return pivot - origin * texSize + texel;
}

/** Rig-space position of a source texel, as the INK twin places it: find the quad
 *  uv that samples this texel, then map that uv through the quad's own rect. */
function viaInk(
  texel: number,
  pivot: number,
  quadOrigin: number,
  quadSize: number,
  uvScale: number,
  uvOffset: number,
  texSize: number
): number {
  const u = (texel / texSize - uvOffset) / uvScale;
  const quadLeft = pivot - quadOrigin * quadSize;
  return quadLeft + u * quadSize;
}

const BOX: AlphaBounds = {
  x: 137,
  y: 88,
  width: 261,
  height: 402,
  texWidth: 666,
  texHeight: 666
};

describe('inkQuad', () => {
  it('places every source texel exactly where the art sprite places it', () => {
    const radius = 13.09; // the shipped whelp radius
    const pivotX = -41.5;
    const pivotY = 260.25;
    const originX = 0.5;
    const originY = 0.92;
    const q = inkQuad(BOX, radius, pivotX, pivotY, originX, originY);

    // Sample across the box, including its corners and outside it.
    for (const t of [0, 50, BOX.x, BOX.x + BOX.width, 400, 665]) {
      expect(
        viaInk(t, pivotX, q.originX, q.width, q.uvScale[0], q.uvOffset[0], BOX.texWidth)
      ).toBeCloseTo(viaArt(t, pivotX, originX, BOX.texWidth), 6);
      expect(
        viaInk(t, pivotY, q.originY, q.height, q.uvScale[1], q.uvOffset[1], BOX.texHeight)
      ).toBeCloseTo(viaArt(t, pivotY, originY, BOX.texHeight), 6);
    }
  });

  it('holds for any origin, radius and non-square texture', () => {
    const box: AlphaBounds = {
      x: 11,
      y: 3,
      width: 94,
      height: 277,
      texWidth: 122,
      texHeight: 311
    };
    for (const radius of [0.5, 7.13, 40]) {
      for (const [ox, oy] of [
        [0, 0],
        [0.5, 0.92],
        [1, 1],
        [0.31, 0.77]
      ]) {
        const q = inkQuad(box, radius, 17.5, -9.25, ox!, oy!);
        for (const t of [0, box.x, box.x + box.width, 121]) {
          expect(
            viaInk(t, 17.5, q.originX, q.width, q.uvScale[0], q.uvOffset[0], box.texWidth)
          ).toBeCloseTo(viaArt(t, 17.5, ox!, box.texWidth), 6);
        }
        for (const t of [0, box.y, box.y + box.height, 310]) {
          expect(
            viaInk(t, -9.25, q.originY, q.height, q.uvScale[1], q.uvOffset[1], box.texHeight)
          ).toBeCloseTo(viaArt(t, -9.25, oy!, box.texHeight), 6);
        }
      }
    }
  });

  it('grows the quad by exactly the radius on every side, so the ring has room', () => {
    const q = inkQuad(BOX, 10, 0, 0, 0.5, 0.5);
    expect(q.width).toBe(BOX.width + 20);
    expect(q.height).toBe(BOX.height + 20);
    // ...and the uv window starts one radius before the alpha box.
    expect(q.uvOffset[0]).toBeCloseTo((BOX.x - 10) / BOX.texWidth, 10);
    expect(q.uvOffset[1]).toBeCloseTo((BOX.y - 10) / BOX.texHeight, 10);
  });

  it('derives the shipped whelp and adult radii from the board-wide curve', () => {
    // The rules these reproduce live in scripts/unify-keyline.py; the point of the
    // test is that the dragons stay on the SAME curve as the item art beside them.
    const whelpScale = 0.46 * 0.448; // DRAGON_ANIM.whelpScale x DRAGON_RIG_SCALE.ember_dragon
    const adultScale = 0.46 * 0.93;
    const whelp = inkRadiusTexels(1074 * whelpScale, whelpScale, DRAGON_OUTLINE, 40);
    const adult = inkRadiusTexels(836 * adultScale, adultScale, DRAGON_OUTLINE, 40);

    // ~2.70 and ~3.04 on-board units respectively.
    expect(whelp * whelpScale).toBeCloseTo(2.7, 1);
    expect(adult * adultScale).toBeCloseTo(3.04, 1);
    // The bigger dragon carries the heavier line, but sub-linearly.
    expect(adult * adultScale).toBeGreaterThan(whelp * whelpScale);
    expect(adult).toBeLessThan(whelp); // ...and needs FEWER texels, being less scaled down
  });

  it('clamps a mis-derived scale to the ceiling instead of sampling half a layer', () => {
    expect(inkRadiusTexels(200, 0.0001, DRAGON_OUTLINE, 40)).toBe(40);
    expect(inkRadiusTexels(200, 0, DRAGON_OUTLINE, 40)).toBe(0);
    expect(inkRadiusTexels(0, 0.2, DRAGON_OUTLINE, 40)).toBe(0);
  });
});

/**
 * The same invariant for a SPRITESHEET frame, where it is harder: the quad's origin
 * is quoted against the FRAME while its uv window is quoted against the SHEET, and
 * the window deliberately reaches past the frame (that is where the outline goes).
 */
describe('inkQuad over a spritesheet frame', () => {
  // eleanor/idle: 200x320 cells on a 1600x2560 sheet, a frame from the middle so
  // neighbours surround it on every side.
  const SHEET = { w: 1600, h: 2560 };
  const FRAME = { w: 200, h: 320, x: 200 * 3, y: 320 * 2 };

  function localViaSprite(texel: number, origin: number, frameSize: number): number {
    return texel - origin * frameSize;
  }

  function localViaInk(
    sheetTexel: number,
    quadOrigin: number,
    quadSize: number,
    uvScale: number,
    uvOffset: number,
    sheetSize: number
  ): number {
    const u = (sheetTexel / sheetSize - uvOffset) / uvScale;
    return -quadOrigin * quadSize + u * quadSize; // pivot sits at local 0
  }

  it('lands each frame texel where the sprite lands it', () => {
    const box = frameBox(FRAME.x, FRAME.y, FRAME.w, FRAME.h, SHEET.w, SHEET.h);
    const radius = 4.53;
    const [ox, oy] = [0.5, 0.97];
    const q = inkQuad(box, radius, 0, 0, ox, oy);

    for (const t of [0, 1, 60, FRAME.w - 1]) {
      expect(
        localViaInk(FRAME.x + t, q.originX, q.width, q.uvScale[0], q.uvOffset[0], SHEET.w)
      ).toBeCloseTo(localViaSprite(t, ox, FRAME.w), 6);
    }
    for (const t of [0, 1, 200, FRAME.h - 1]) {
      expect(
        localViaInk(FRAME.y + t, q.originY, q.height, q.uvScale[1], q.uvOffset[1], SHEET.h)
      ).toBeCloseTo(localViaSprite(t, oy, FRAME.h), 6);
    }
  });

  it('reaches exactly one radius past the frame on every side', () => {
    const box = frameBox(FRAME.x, FRAME.y, FRAME.w, FRAME.h, SHEET.w, SHEET.h);
    const radius = 6;
    const q = inkQuad(box, radius, 0, 0, 0.5, 0.97);
    expect(q.width).toBe(FRAME.w + 12);
    expect(q.height).toBe(FRAME.h + 12);
    expect(q.uvOffset[0]).toBeCloseTo((FRAME.x - radius) / SHEET.w, 10);
    expect(q.uvOffset[1]).toBeCloseTo((FRAME.y - radius) / SHEET.h, 10);
    // ...and the window's far edge lands one radius past the frame too.
    expect(q.uvOffset[0] + q.uvScale[0]).toBeCloseTo((FRAME.x + FRAME.w + radius) / SHEET.w, 10);
  });

  it('fences sampling to the frame cell, never the neighbouring pose', () => {
    const box = frameBox(FRAME.x, FRAME.y, FRAME.w, FRAME.h, SHEET.w, SHEET.h);
    const f = uvFence(box);
    expect(f.min).toEqual([FRAME.x / SHEET.w, FRAME.y / SHEET.h]);
    expect(f.max).toEqual([(FRAME.x + FRAME.w) / SHEET.w, (FRAME.y + FRAME.h) / SHEET.h]);
    // The quad's own window is strictly WIDER than the fence — which is the whole
    // reason the fence has to exist.
    const q = inkQuad(box, 6, 0, 0, 0.5, 0.97);
    expect(q.uvOffset[0]).toBeLessThan(f.min[0]);
    expect(q.uvOffset[0] + q.uvScale[0]).toBeGreaterThan(f.max[0]);
  });

  it('a standalone texture fences to the whole image', () => {
    const f = uvFence(BOX);
    expect(f.min).toEqual([0, 0]);
    expect(f.max).toEqual([1, 1]);
  });

  it('keeps one width per character across clips authored at different scales', () => {
    // Eleanor's idle and cast are authored at different scales; fixing the width
    // ONCE in on-board units and dividing per clip is what stops her outline
    // changing weight when she raises her scepter.
    const units = keylineUnits(584 * 0.4971 * 0.7, {
      refUnits: 2.0,
      refSize: 66.8,
      exponent: 0.25
    });
    const idleTexels = units / 0.5671;
    const castTexels = units / 0.61371;
    expect(idleTexels * 0.5671).toBeCloseTo(units, 10);
    expect(castTexels * 0.61371).toBeCloseTo(units, 10);
    expect(idleTexels).toBeGreaterThan(castTexels); // the smaller-scaled clip needs more texels
  });
});
