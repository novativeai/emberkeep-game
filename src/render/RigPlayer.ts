import Phaser from 'phaser';
import {
  BlinkScheduler,
  BLINK_GAP_CALM,
  BLINK_GAP_EXCITED,
  FaceChannel,
  type BlinkGap,
  type FaceDoc,
  type FaceSelection
} from './faceAnimations';
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

/** The face-frame wardrobe attached to one layer (usually the head). */
interface FaceWear {
  doc: FaceDoc;
  channel: FaceChannel;
  textureKey: (setKey: string, frameIndex: number) => string;
  layer: LayerSprite;
  baseTexture: string;
  baseOrigin: RigVec;
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
  /** Preset playback rate — <1 slows the whole pose cycle (calm adult dragons). */
  private speed: number;
  private scratchRot = new Map<string, number>();
  private face: FaceWear | null = null;
  private faceCurrent: string | null = null; // "set:index" worn now (null = base)
  private blink = new BlinkScheduler(); // per-instance → dragons never blink in unison

  constructor(
    scene: Phaser.Scene,
    private rig: RigDoc,
    textureKey: (layerName: string) => string,
    opts: { scale?: number; speed?: number } = {}
  ) {
    this.resolved = resolveRig(rig);
    this.ctx = makePresetContext(rig);
    this.displayScale = opts.scale ?? 1;
    this.speed = opts.speed ?? 1;
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

  /** Queue every face-frame PNG (served files, not embedded) then resolve when
   *  the loader completes. Mirrors loadTextures; failures leave frames absent
   *  and attachFace() degrades gracefully set-by-set. */
  static loadFaceTextures(
    scene: Phaser.Scene,
    doc: FaceDoc,
    textureKey: (setKey: string, frameIndex: number) => string,
    urlBase: string
  ): Promise<void> {
    const pending: Array<{ key: string; url: string }> = [];
    for (const [setKey, set] of Object.entries(doc.sets)) {
      set.frames.forEach((frame, i) => {
        const key = textureKey(setKey, i);
        if (!scene.textures.exists(key)) {
          pending.push({ key, url: `${urlBase}${doc.basePath}/${set.dir}/${frame.file}` });
        }
      });
    }
    if (pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      for (const p of pending) scene.load.image(p.key, p.url);
      scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      scene.load.start();
    });
  }

  /**
   * Wear pre-rendered face frame sets (blink / talk) on the rig's face layer.
   * Only sets whose EVERY frame texture actually loaded are kept, and the
   * whole attach is skipped when the layer is missing — a rig without face
   * art keeps its current behaviour (adaptive, like everything else here).
   */
  attachFace(
    scene: Phaser.Scene,
    doc: FaceDoc,
    textureKey: (setKey: string, frameIndex: number) => string
  ): this {
    const layer = this.layers.find((l) => l.name === doc.layer);
    if (!layer) return this;
    const sets: FaceDoc['sets'] = {};
    for (const [setKey, set] of Object.entries(doc.sets)) {
      if (set.frames.every((_, i) => scene.textures.exists(textureKey(setKey, i)))) {
        sets[setKey] = set;
      }
    }
    if (Object.keys(sets).length === 0) return this;
    const usable: FaceDoc = { ...doc, sets };
    this.face = {
      doc: usable,
      channel: new FaceChannel(usable),
      textureKey,
      layer,
      baseTexture: layer.img.texture.key,
      baseOrigin: { x: layer.img.originX, y: layer.img.originY }
    };
    return this;
  }

  /** Scripted mouth-flap burst (hatch roar, gift celebrate). No-op without a
   *  loaded talk set, so callers never need to know if face art exists. */
  playFace(loops = 1): this {
    this.face?.channel.playTalk(loops);
    return this;
  }

  /** Re-arm a perpetual talk loop if it ever stopped (custom-UI 'talk' mode). */
  playFaceIfIdle(): this {
    if (this.face && !this.face.channel.talking) this.face.channel.playTalk(Number.POSITIVE_INFINITY);
    return this;
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
    let pose: RigPose | null = null;
    if (this.presetKey) {
      this.elapsed += (deltaMs / 1000) * this.speed;
      const preset = PRESET_BY_KEY[this.presetKey];
      if (preset) pose = preset.fn(this.elapsed, this.ctx);
    }
    // Blink is centralized here (not baked into presets): one randomized clock
    // feeds pose.eyelid, which BOTH the eyelid-layer path and the face-frame
    // path read. Suppressed while the mouth is open (you don't blink mid-roar).
    if (pose) {
      const suppress = (pose.mouth ?? 0) > 0.12;
      pose.eyelid = this.blink.update(deltaMs, suppress, this.blinkGap());
      this.applyPose(pose);
    } else {
      this.blink.update(deltaMs, true, BLINK_GAP_CALM); // keep the clock ticking, eyes open
    }
    // Face runs even without a preset so a scripted talk burst always finishes.
    if (this.face) this.applyFace(this.face.channel.update(deltaMs, pose));
  }

  /** Blink faster while celebrating / mid-flight, calmly the rest of the time. */
  private blinkGap(): BlinkGap {
    return this.presetKey === 'celebrate' || this.presetKey === 'hover'
      ? BLINK_GAP_EXCITED
      : BLINK_GAP_CALM;
  }

  /** Swap the face layer's texture — origin/scale come from the calibration so
   *  the head neither moves nor resizes; anchor rotation keeps applying because
   *  the sprite (and its pivot position) are untouched. */
  private applyFace(sel: FaceSelection | null): void {
    const face = this.face;
    if (!face) return;
    const wearing = sel ? `${sel.setKey}:${sel.frameIndex}` : null;
    if (wearing === this.faceCurrent) return;
    this.faceCurrent = wearing;
    const img = face.layer.img;
    if (!sel) {
      img.setTexture(face.baseTexture).setOrigin(face.baseOrigin.x, face.baseOrigin.y).setScale(1);
      return;
    }
    const set = face.doc.sets[sel.setKey]!;
    img
      .setTexture(face.textureKey(sel.setKey, sel.frameIndex))
      .setOrigin(set.originX, set.originY)
      .setScale(set.textureScale);
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
    // Rest face for the flattened copy: eyes open (not mid-blink), mouth closed.
    this.face?.channel.stopTalk();
    this.applyFace(null);
    this.blink.reset();
    for (const ls of this.layers) if (ls.isEyelid) ls.img.scaleY = 1;
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
