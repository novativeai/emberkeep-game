import Phaser from 'phaser';
import {
  ANIM_PARTS,
  makePresetContext,
  PRESET_BY_KEY,
  resolveRig,
  type PresetContext
} from './rigAnimations';
import type { Facing, RigDoc, RigPose, ResolvedPart, RigVec } from './rigTypes';

const D2R = Math.PI / 180;

interface LayerSprite {
  name: string;
  img: Phaser.GameObjects.Image;
  isEyelid: boolean;
}

/**
 * Optimal in-game rig runtime. Builds the layered character ONCE:
 *   container (scene placement + facing) → inner (animation root transform)
 *     → flat z-ordered layer Images (origin = resolved pivot)
 * so animating only writes `.rotation` on a few sprites plus the inner
 * container's `y`/`scale` — GPU-batched, zero per-frame allocation.
 * The source art is iso 3/4 facing LEFT; `setFacing('right')` mirrors with
 * `container.scaleX = -1` (a single flip — pivots and rotations flip with it).
 *
 * For the board's many pooled generators, `bake()` flattens the rest pose to
 * one texture so they can be plain Images with no runtime cost.
 */
export class RigPlayer {
  readonly container: Phaser.GameObjects.Container; // scene sets position / display scale
  private inner: Phaser.GameObjects.Container; // animation root transform lives here
  private root: RigVec;
  private layers: LayerSprite[] = [];
  private partToLayer = new Map<string, string>();
  private resolved: Record<string, ResolvedPart>;
  private ctx: PresetContext;
  private presetKey: string | null = null;
  private elapsed = 0;
  private displayScale: number;
  private scratchRot = new Map<string, number>();

  constructor(
    scene: Phaser.Scene,
    private rig: RigDoc,
    textureKey: (layerName: string) => string,
    opts: { scale?: number } = {}
  ) {
    this.resolved = resolveRig(rig);
    this.ctx = makePresetContext(rig);
    this.displayScale = opts.scale ?? 1;
    this.root = rig.root ?? {
      x: rig.bounds.x + rig.bounds.width / 2,
      y: rig.bounds.y + rig.bounds.height * 0.84
    };
    this.container = scene.add.container(0, 0).setScale(this.displayScale);
    this.inner = scene.add.container(0, 0);
    this.container.add(this.inner);

    // Resolve which part drives each layer, and with what origin.
    const originByLayer = new Map<string, RigVec>();
    for (const part of ANIM_PARTS) {
      const r = this.resolved[part]!;
      if (r.via === 'skip' || !r.layer) continue;
      this.partToLayer.set(part, r.layer);
      if (!originByLayer.has(r.layer)) originByLayer.set(r.layer, r.originNorm);
    }

    for (const layer of [...rig.layers].sort((a, b) => a.z - b.z)) {
      if (layer.visible === false) continue;
      const origin = originByLayer.get(layer.name) ?? { x: 0.5, y: 0.92 };
      const pivotRigX = layer.x + origin.x * layer.width;
      const pivotRigY = layer.y + origin.y * layer.height;
      const img = scene.add
        .image(pivotRigX - this.root.x, pivotRigY - this.root.y, textureKey(layer.name))
        .setOrigin(origin.x, origin.y);
      this.inner.add(img);
      const ls: LayerSprite = {
        name: layer.name,
        img,
        isEyelid: layer.name === 'eyelid_left' || layer.name === 'eyelid_right'
      };
      this.layers.push(ls);
    }
  }

  /** Queue every embedded layer image then resolve once the loader completes. */
  static loadTextures(
    scene: Phaser.Scene,
    rig: RigDoc,
    textureKey: (layerName: string) => string
  ): Promise<void> {
    const images = rig.images ?? {};
    const pending = rig.layers.filter((l) => images[l.file] && !scene.textures.exists(textureKey(l.name)));
    if (pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      for (const layer of pending) scene.load.image(textureKey(layer.name), images[layer.file]!);
      scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      scene.load.start();
    });
  }

  setFacing(facing: Facing): this {
    this.container.scaleX = (facing === 'right' ? -1 : 1) * this.displayScale;
    return this;
  }

  play(presetKey: string): this {
    this.presetKey = PRESET_BY_KEY[presetKey] ? presetKey : null;
    this.elapsed = 0;
    return this;
  }

  /** Drive from the scene's update(); deltaMs is Phaser's frame delta. */
  update(deltaMs: number): void {
    if (!this.presetKey) return;
    this.elapsed += deltaMs / 1000;
    const preset = PRESET_BY_KEY[this.presetKey];
    if (preset) this.applyPose(preset.fn(this.elapsed, this.ctx));
  }

  applyPose(pose: RigPose): void {
    // whole-rig transform on the INNER container (children inherit it).
    this.inner.y = pose.root.dy;
    this.inner.rotation = pose.root.rotDeg * D2R;
    this.inner.scaleX = Math.abs(pose.root.sx);
    this.inner.scaleY = pose.root.sy;

    // accumulate part rotations onto their resolved layers (usually 1:1).
    this.scratchRot.clear();
    for (const part in pose.partDeg) {
      const layer = this.partToLayer.get(part);
      if (!layer) continue; // part resolved to skip — adapt by ignoring it
      this.scratchRot.set(layer, (this.scratchRot.get(layer) ?? 0) + (pose.partDeg[part] ?? 0));
    }
    for (const ls of this.layers) {
      if (ls.isEyelid) { ls.img.scaleY = pose.eyelid ?? 1; continue; }
      ls.img.rotation = (this.scratchRot.get(ls.name) ?? 0) * D2R;
    }
  }

  /** Flatten the current pose into a single texture for cheap reuse. */
  bake(scene: Phaser.Scene, key: string): string {
    const b = this.rig.bounds;
    const rt = scene.add.renderTexture(0, 0, Math.ceil(b.width), Math.ceil(b.height)).setVisible(false);
    const sx = this.container.scaleX, sy = this.container.scaleY;
    const px = this.container.x, py = this.container.y;
    this.container.setScale(1, 1).setPosition(this.root.x - b.x, this.root.y - b.y);
    rt.draw(this.container);
    this.container.setScale(sx, sy).setPosition(px, py);
    rt.saveTexture(key);
    rt.destroy();
    return key;
  }

  destroy(): void {
    this.container.destroy(); // destroys inner + layer images
    this.layers = [];
  }
}
