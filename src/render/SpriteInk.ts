import Phaser from 'phaser';
import { DRAGON_OUTLINE } from '../core/Constants';
import {
  ensureRigInkPipeline,
  frameBox,
  inkQuad,
  RIG_INK_PIPELINE,
  uvFence,
  type RigInkPipelineData
} from './rigInkShader';

/**
 * The keyline for FRAME-BASED characters — the Align-Studio clips and the standee
 * banks — drawn at run time by the same pipeline the dragon rigs use.
 *
 * WHY THESE NEED THEIR OWN PATH. `RigPlayer` outlines a rig by giving each of its
 * layers an ink twin. But playing a clip HIDES the rig outright
 * (`overlay.setVisible(true); player.container.setVisible(false)` in BoardScene),
 * so a whelp playing its 194-frame idle showed no keyline at all despite the rig
 * having one. Eleanor and Selyna never had a rig path in the first place.
 *
 * WHY IT IS SIMPLER THAN THE RIG'S. A clip frame is already one flat composited
 * character, so there is no union-of-layers argument to make and no internal seam
 * to hide: ONE ink twin behind the sprite is the whole silhouette. And because the
 * atlases are packed tight (0-2 texels of margin), the frame rect already is the
 * alpha box — so unlike a rig layer this needs no pixel readback, nothing cached,
 * and nothing recomputed when the animation advances. See `frameBox`.
 *
 * The quad reaches PAST the frame, which is where the line lives; `uvFence` stops
 * the taps sampling the pose packed next door.
 */
export interface SpriteInkOptions {
  /** Keyline width in on-board units. One value per character, so the line does
   *  not change weight between clips authored at different scales. */
  units: number;
}

interface InkState {
  twin: Phaser.GameObjects.Image;
  units: number;
  /** What the twin was last dressed for, so a frame that has not changed costs
   *  nothing but a few transform writes. */
  key: string;
}

const STATE = new WeakMap<Phaser.GameObjects.Sprite, InkState>();

/**
 * The frame the twin MUST wear — and must be asked for BY NAME.
 *
 * `uvScale`/`uvOffset` are derived against a `outTexCoord` that spans 0..1 across
 * the twin's quad, which is true only of `__BASE` (the frame covering the whole
 * source image). Every other frame hands the shader its OWN uv range, so the
 * remap is applied on top of a window that is already a cell — and the taps land
 * in a sliver of the wrong cell, which the fence then zeroes: no outline at all.
 *
 * The trap is that `add.image(x, y, key)` does NOT give you `__BASE`. A texture's
 * default frame is its `firstFrame`, and for a `load.spritesheet` texture that is
 * cell `'0'` — only a single-image texture (every rig layer) defaults to `__BASE`.
 * Which is exactly why the rigs wore their keyline while the clip sheets and the
 * standee banks silently wore none.
 */
const BASE_FRAME = '__BASE';

/**
 * Give `sprite` an ink twin, or hand back the one it has. The twin is created
 * invisible and inert; `syncSpriteInk` is what dresses and shows it.
 *
 * Returns null when there is no WebGL (canvas fallback — no outline) or the
 * outline is switched off.
 */
export function attachSpriteInk(
  scene: Phaser.Scene,
  sprite: Phaser.GameObjects.Sprite,
  opts: SpriteInkOptions
): Phaser.GameObjects.Image | null {
  if (!DRAGON_OUTLINE.enabled || !ensureRigInkPipeline(scene.game)) return null;
  const existing = STATE.get(sprite);
  if (existing) {
    existing.units = opts.units;
    return existing.twin;
  }
  const twin = scene.add
    .image(sprite.x, sprite.y, sprite.texture.key, BASE_FRAME)
    .setVisible(false)
    .setPipeline(RIG_INK_PIPELINE);
  STATE.set(sprite, { twin, units: opts.units, key: '' });

  // Re-dress on every frame the animation advances to. Without this the twin would
  // hold the pose it was last synced at while the sprite animated on beneath it —
  // an outline of the wrong frame, which reads far worse than none.
  const onFrame = () => syncSpriteInk(sprite);
  sprite.on(Phaser.Animations.Events.ANIMATION_UPDATE, onFrame);
  sprite.on(Phaser.Animations.Events.ANIMATION_START, onFrame);
  sprite.once(Phaser.GameObjects.Events.DESTROY, () => destroySpriteInk(sprite));
  return twin;
}

/**
 * Re-dress the ink twin from the sprite's CURRENT frame and transform. Call it
 * every frame from wherever the sprite's own transform is maintained — the clip
 * overlay and the standees are both re-seated per frame already, and a clip SWITCH
 * must never render once wearing the previous clip's geometry.
 */
export function syncSpriteInk(sprite: Phaser.GameObjects.Sprite): void {
  const state = STATE.get(sprite);
  if (!state) return;
  const { twin } = state;

  if (!sprite.visible || !sprite.active) {
    twin.setVisible(false);
    return;
  }

  const frame = sprite.frame;
  const sheetW = frame.source.width;
  const sheetH = frame.source.height;
  const box = frameBox(frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, sheetW, sheetH);
  // Board units -> texels of THIS frame. The width is already decided per
  // character (see SpriteInkOptions), so this is only the unit conversion — the
  // curve was applied once, upstream, and must not be re-applied per clip.
  // `sprite.scaleX` can be negative from a flip, and a radius is unsigned.
  const scale = Math.abs(sprite.scaleX) || 1;
  const radius = Math.min(state.units / scale, DRAGON_OUTLINE.maxRadiusTexels);
  if (!(radius > 0.25)) {
    twin.setVisible(false);
    return;
  }

  const q = inkQuad(box, radius, 0, 0, sprite.originX, sprite.originY);
  const fence = uvFence(box);
  const dressKey = `${frame.texture.key}|${frame.name}|${radius.toFixed(2)}`;
  if (state.key !== dressKey) {
    state.key = dressKey;
    // The twin wears the sheet's `__BASE` frame, never the animation's cell — see
    // BASE_FRAME. Checked on the frame too, not just the texture key: a sprite
    // that stays on one sheet still advances its cell every frame, and the twin
    // must not follow it there.
    if (twin.texture.key !== frame.texture.key || twin.frame.name !== BASE_FRAME) {
      twin.setTexture(frame.texture.key, BASE_FRAME);
    }
    const hex = DRAGON_OUTLINE.ink;
    twin.pipelineData = {
      uvScale: q.uvScale,
      uvOffset: q.uvOffset,
      uvMin: fence.min,
      uvMax: fence.max,
      texel: [1 / sheetW, 1 / sheetH],
      radius,
      ink: [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255],
      alpha: 1
    } satisfies RigInkPipelineData;
  }

  // The twin's quad is bigger than the sprite's frame, so its ORIGIN differs — but
  // it pivots on the same point, which is what keeps the two locked together under
  // the sprite's own flip, scale and depth.
  twin
    .setOrigin(q.originX, q.originY)
    .setDisplaySize(q.width * scale, q.height * Math.abs(sprite.scaleY || 1))
    .setFlipX(sprite.flipX)
    .setFlipY(sprite.flipY)
    .setPosition(sprite.x, sprite.y)
    .setRotation(sprite.rotation)
    .setAlpha(sprite.alpha)
    .setDepth(sprite.depth - 0.01) // immediately behind, never between two sprites
    .setScrollFactor(sprite.scrollFactorX, sprite.scrollFactorY)
    .setVisible(true);
}

/** Hide the twin — for when its sprite is hidden but kept around (pooled). */
export function hideSpriteInk(sprite: Phaser.GameObjects.Sprite): void {
  STATE.get(sprite)?.twin.setVisible(false);
}

/** Drop the twin with its sprite. */
export function destroySpriteInk(sprite: Phaser.GameObjects.Sprite): void {
  const state = STATE.get(sprite);
  if (!state) return;
  state.twin.destroy();
  STATE.delete(sprite);
}
