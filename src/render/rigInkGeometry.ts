/**
 * Geometry for the dragons' runtime keyline — the part with no Phaser in it, so it
 * can be unit-tested in node (see tests/unit/RigInk.spec.ts). The pipeline and the
 * texture reads live in ./rigInkShader.
 */

export interface AlphaBounds {
  /** The box to outline, in texels, relative to the FRAME it belongs to. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The frame's own size — what the sprite's origin fraction is quoted against. */
  texWidth: number;
  texHeight: number;
  /** Where the frame sits in its sheet, and the sheet's size. Both default to a
   *  standalone texture (frame at 0,0 filling the whole sheet), which is what a
   *  rig layer is. A spritesheet frame sets them so the uv window lands on the
   *  right cell — and so sampling can be fenced to that cell, see `uvFence`. */
  frameX?: number;
  frameY?: number;
  sheetWidth?: number;
  sheetHeight?: number;
}

/**
 * The box for a whole spritesheet frame.
 *
 * Unlike a rig layer — a 666x666 canvas holding a third-sized subject, where the
 * quad has to be trimmed to the alpha or the shader runs its taps over a quarter
 * million empty texels — the Align-Studio atlases and the standee banks are packed
 * TIGHT. Their frames have 0-2 texels of margin, so the frame rect already IS the
 * alpha box to within a pixel or two. Taking it as given means no per-frame pixel
 * readback at all: no getImageData over a 4096x3210 sheet, nothing to cache, and
 * nothing to recompute when the animation advances a frame.
 */
export function frameBox(
  frameX: number,
  frameY: number,
  frameWidth: number,
  frameHeight: number,
  sheetWidth: number,
  sheetHeight: number
): AlphaBounds {
  return {
    x: 0,
    y: 0,
    width: frameWidth,
    height: frameHeight,
    texWidth: frameWidth,
    texHeight: frameHeight,
    frameX,
    frameY,
    sheetWidth,
    sheetHeight
  };
}

/**
 * The uv rectangle sampling must stay inside: the frame's own cell.
 *
 * The ink quad deliberately reaches PAST the frame — that is where the outline
 * lives — so without a fence its taps would wander into whatever frame is packed
 * next door and dilate a neighbouring pose into this one's outline.
 */
export function uvFence(box: AlphaBounds): { min: [number, number]; max: [number, number] } {
  const sw = box.sheetWidth ?? box.texWidth;
  const sh = box.sheetHeight ?? box.texHeight;
  const fx = box.frameX ?? 0;
  const fy = box.frameY ?? 0;
  return {
    min: [fx / sw, fy / sh],
    max: [(fx + box.texWidth) / sw, (fy + box.texHeight) / sh]
  };
}

export interface InkQuad {
  width: number;
  height: number;
  originX: number;
  originY: number;
  uvScale: [number, number];
  uvOffset: [number, number];
}

/**
 * Where an ink twin's quad goes, and the uv window that puts the layer's texture
 * back where the art has it.
 *
 * Pure and separately tested because the whole effect hangs on ONE invariant that
 * is invisible until it is wrong: every source texel must land at the same
 * rig-space position through the ink twin as through the art sprite. The twin has
 * a different quad size (the alpha box grown by the radius, not the full canvas)
 * and therefore a different origin, so the two paths agree only if the origin and
 * the uv window are derived from each other — which is what this does. Get it
 * wrong and the outline slides off the dragon, reading as a shadow.
 *
 * `pivot` is the art sprite's position, `origin` its origin fraction, and the box
 * carries the texture size. One texel is one rig pixel: a layer image is drawn at
 * its texture's natural size.
 */
export function inkQuad(
  box: AlphaBounds,
  radius: number,
  pivotX: number,
  pivotY: number,
  originX: number,
  originY: number
): InkQuad {
  const { texWidth: tw, texHeight: th } = box;
  const sw = box.sheetWidth ?? tw;
  const sh = box.sheetHeight ?? th;
  const fx = box.frameX ?? 0;
  const fy = box.frameY ?? 0;
  const width = box.width + radius * 2;
  const height = box.height + radius * 2;
  // The quad's top-left, in the space the art sprite sits in. Frame-local, because
  // the sprite's origin is a fraction of its FRAME, not of the sheet.
  const left = pivotX - originX * tw + box.x - radius;
  const top = pivotY - originY * th + box.y - radius;
  return {
    width,
    height,
    // Pivot on the ART's pivot, so one copied `rotation` keeps the two locked.
    originX: (pivotX - left) / width,
    originY: (pivotY - top) / height,
    // ...but the uv window is in SHEET space, since that is what the sampler reads.
    uvScale: [width / sw, height / sh],
    uvOffset: [(fx + box.x - radius) / sw, (fy + box.y - radius) / sh]
  };
}

/**
 * The keyline width for something of this on-board size, in on-board units.
 *
 * One curve for the whole game — the same one scripts/unify-keyline.py bakes into
 * the item art — so a dragon, a standee and a berry all carry a line of the same
 * weight for their size. Callers convert to texels themselves, because a character
 * whose clips are authored at different scales must fix the width ONCE and divide
 * per clip, or her line changes weight when she raises her scepter.
 */
export function keylineUnits(
  onboardSize: number,
  curve: { refUnits: number; refSize: number; exponent: number }
): number {
  if (!(onboardSize > 0)) return 0;
  return curve.refUnits * (onboardSize / curve.refSize) ** curve.exponent;
}

/**
 * The same width, converted to the SOURCE TEXELS the shader dilates by — divided
 * back down by the display scale, because that is the space the shader works in.
 * `onboardSize` is the rig's longest bound already multiplied by scale.
 */
export function inkRadiusTexels(
  onboardSize: number,
  displayScale: number,
  curve: { refUnits: number; refSize: number; exponent: number },
  maxTexels: number
): number {
  if (!(displayScale > 0) || !(onboardSize > 0)) return 0;
  return Math.min(keylineUnits(onboardSize, curve) / displayScale, maxTexels);
}
