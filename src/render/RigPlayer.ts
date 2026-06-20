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
const TAU = Math.PI * 2;
const WAVE_STRIPS = 16; // strips per wave-deformable layer
const WAVE_COUNT = 1.1; // sine cycles across the full layer (matches animator)

interface LayerSprite {
  name: string;
  img: Phaser.GameObjects.Image;
  isEyelid: boolean;
}

/** Pre-computed geometry for a pin-chain wave-deformable layer (e.g. body_tail). */
interface WaveLayerInfo {
  baseY: number;    // layer.y - root.y — rest Y for all strips in inner space
  horiz: boolean;   // true: horizontal sweep (y-offset per strip); false: vertical (x-offset)
  rootNorm: number; // chain's first-pin normalized position along the sweep axis
  tipNorm: number;  // chain's last-pin normalized position along the sweep axis
  strips: Phaser.GameObjects.Image[];
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
  /** Parts resolved as pin-chain fallback → layer name (no own layer = wave-deform only). */
  private wavePartToLayer = new Map<string, string>();
  /** Per-layer wave geometry and strip images. */
  private waveLayerInfo = new Map<string, WaveLayerInfo>();

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

    // Phase 1: identify wave-deformable parts (pin-chain fallback — no own layer).
    // These must NOT be driven by rigid rotation; build strips instead.
    const waveLayerToChain = new Map<string, typeof rig.pins>();
    for (const part of ANIM_PARTS) {
      const r = this.resolved[part]!;
      if (r.via !== 'pin' || !r.layer) continue;
      if (rig.layers.some((l) => l.name === part)) continue; // has own layer → rotation OK
      const chain = rig.pins
        .filter((p) => p.chain === part && p.name !== 'root_ground')
        .sort((a, b) => a.order - b.order);
      if (chain.length < 2) continue;
      waveLayerToChain.set(r.layer, chain);
      this.wavePartToLayer.set(part, r.layer);
    }

    // Phase 2: resolve which non-wave part drives each layer, and with what origin.
    const originByLayer = new Map<string, RigVec>();
    for (const part of ANIM_PARTS) {
      const r = this.resolved[part]!;
      if (r.via === 'skip' || !r.layer) continue;
      if (this.wavePartToLayer.has(part)) continue; // handled as wave
      this.partToLayer.set(part, r.layer);
      if (!originByLayer.has(r.layer)) originByLayer.set(r.layer, r.originNorm);
    }

    // Phase 3: build layer images in z-order (wave layers → strips; others → single image).
    for (const layer of [...rig.layers].sort((a, b) => a.z - b.z)) {
      if (layer.visible === false) continue;

      const chain = waveLayerToChain.get(layer.name);
      if (chain) {
        // Wave-deformable layer: N horizontal (or vertical) strips, y-offset updated per frame.
        const first = chain[0]!.norm;
        const last = chain[chain.length - 1]!.norm;
        const horiz = Math.abs(last.x - first.x) >= Math.abs(last.y - first.y);
        const rootNorm = horiz ? first.x : first.y;
        const tipNorm = horiz ? last.x : last.y;
        const sw = layer.width / WAVE_STRIPS;
        const baseY = layer.y - this.root.y;
        const strips: Phaser.GameObjects.Image[] = [];
        for (let i = 0; i < WAVE_STRIPS; i++) {
          const strip = scene.add
            .image(layer.x + i * sw - this.root.x, baseY, textureKey(layer.name))
            .setOrigin(0, 0)
            .setCrop(i * sw, 0, sw + 1, layer.height);
          this.inner.add(strip);
          strips.push(strip);
        }
        this.waveLayerInfo.set(layer.name, { baseY, horiz, rootNorm, tipNorm, strips });
        continue;
      }

      // Normal layer: single image, rotates around its resolved pivot.
      const origin = originByLayer.get(layer.name) ?? { x: 0.5, y: 0.92 };
      const pivotRigX = layer.x + origin.x * layer.width;
      const pivotRigY = layer.y + origin.y * layer.height;
      const img = scene.add
        .image(pivotRigX - this.root.x, pivotRigY - this.root.y, textureKey(layer.name))
        .setOrigin(origin.x, origin.y);
      this.inner.add(img);
      this.layers.push({
        name: layer.name,
        img,
        isEyelid: layer.name === 'eyelid_left' || layer.name === 'eyelid_right'
      });
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

    // Pin-chain wave deformation: slice the owning layer into strips and offset each.
    for (const [layerName, info] of this.waveLayerInfo.entries()) {
      const { baseY, horiz, rootNorm, tipNorm, strips } = info;
      // Collect wave params for this layer from the pose (zero if not driven this frame).
      let wvAmp = 0;
      let wvPhase = 0;
      if (pose.wave) {
        for (const [part, wv] of Object.entries(pose.wave)) {
          if (this.wavePartToLayer.get(part) === layerName) {
            wvAmp = wv.amp;
            wvPhase = wv.phase;
            break;
          }
        }
      }
      const N = strips.length;
      const span = tipNorm - rootNorm || 1;
      for (let i = 0; i < N; i++) {
        const u = (i + 0.5) / N;
        const ramp = Math.max(0, Math.min(1, (u - rootNorm) / span));
        const offset = wvAmp * ramp * Math.sin(wvPhase - u * WAVE_COUNT * TAU);
        if (horiz) {
          strips[i]!.y = baseY + offset;
        }
        // Vertical wave (future): strips[i]!.x = baseX_i + offset;
      }
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
