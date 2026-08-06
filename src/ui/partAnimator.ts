import Phaser from 'phaser';
import {
  builtinSequence,
  builtinSequenceDurations,
  builtinSequenceFiles,
  builtinSequenceFrameKeys
} from '../render/sequenceCatalog';
import { ensureSequenceTextures, uiRegistry } from './theme';

/**
 * Sequence playback shared by anim LAYERS (custom components) and animated
 * PARTS of built-in elements (a `sequence` part patch — e.g. the dialogue bubble
 * portrait replaced by a talking bank). One resolver + one stepper, one truth.
 */

/** Resolve a sequence name → ordered frame texture keys + per-frame durations.
 *  Uploaded sequences (doc.sequences) carry data-URL frames materialised on
 *  demand; BUILT-IN banks are file-backed — preloaded by PreloadScene, with a
 *  lazy load-on-miss here for editor drops of a not-yet-needed bank. */
export function resolveSequence(
  scene: Phaser.Scene,
  name: string
): { frameKeys: string[]; durations: number[]; fps?: number; defaultLoop: boolean } | null {
  const up = uiRegistry.doc.sequences[name];
  if (up && up.frames.length) {
    return {
      frameKeys: ensureSequenceTextures(scene, name, up.frames),
      durations: up.frames.map((_, i) => up.durations?.[i] ?? 1000 / (up.fps ?? 12)),
      fps: up.fps,
      defaultLoop: true
    };
  }
  const seq = builtinSequence(name);
  if (seq) {
    const frameKeys = builtinSequenceFrameKeys(seq);
    if (!scene.textures.exists(frameKeys[0]!)) {
      const files = builtinSequenceFiles(seq);
      frameKeys.forEach((key, i) => {
        if (!scene.textures.exists(key)) scene.load.image(key, files[i]!);
      });
      if (!scene.load.isLoading()) scene.load.start();
    }
    return { frameKeys, durations: builtinSequenceDurations(seq), fps: 12, defaultLoop: seq.loop };
  }
  return null;
}

/** Mutable playback state advanced by stepSequence. */
export interface SequenceState {
  frameKeys: string[];
  durations: number[]; // ms per frame, parallel to frameKeys
  idx: number;
  elapsed: number; // ms held on the current frame
  loop: boolean;
}

/** Step playback by `delta` ms. Returns the new frame index when it changed
 *  (a long hold spans several ticks and returns null). Non-looping playback
 *  parks on the final frame. */
export function stepSequence(state: SequenceState, delta: number): number | null {
  if (state.frameKeys.length < 2) return null;
  state.elapsed += delta;
  let changed = false;
  let guard = 0;
  while (state.elapsed >= state.durations[state.idx]! && guard++ < state.frameKeys.length + 1) {
    state.elapsed -= state.durations[state.idx]!;
    const last = state.idx === state.frameKeys.length - 1;
    if (last && !state.loop) {
      state.elapsed = 0;
      break; // hold on the final frame (the trailing idle pose)
    }
    state.idx = last ? 0 : state.idx + 1;
    changed = true;
  }
  return changed ? state.idx : null;
}

interface PartAnim extends SequenceState {
  img: Phaser.GameObjects.Image;
  /** The part's ORIGINAL footprint (display px) — every frame contain-fits into
   *  it, so an animated portrait stays exactly icon-sized. */
  box: { w: number; h: number };
}

/**
 * Animates image PARTS of registered built-in elements that carry a `sequence`
 * part patch. Owned + ticked by CustomUiManager (present in both the game's
 * UIScene and the editor scene), attached via uiRegistry.partSequenceHook so
 * applyPart drives attach/detach directly from patch state.
 */
export class PartAnimator {
  private anims = new Map<string, PartAnim>();

  constructor(private scene: Phaser.Scene) {}

  /** applyPart calls this for every image part it styles. */
  readonly hook = (
    elementId: string,
    partName: string,
    img: Phaser.GameObjects.Image,
    sequence: string | null,
    loop: boolean | undefined
  ): void => {
    const key = `${elementId}:${partName}`;
    if (!sequence) {
      this.anims.delete(key); // applyPart's static path restores texture/scale
      return;
    }
    const resolved = resolveSequence(this.scene, sequence);
    if (!resolved) {
      this.anims.delete(key);
      return;
    }
    const prior = this.anims.get(key);
    const sameSeq = prior && prior.frameKeys[0] === resolved.frameKeys[0];
    // Footprint: measure BEFORE the first frame swap (or reuse the captured
    // box — the current texture is already a sequence frame on re-apply).
    const box = sameSeq || prior ? prior!.box : { w: img.displayWidth, h: img.displayHeight };
    const anim: PartAnim = {
      img,
      box,
      frameKeys: resolved.frameKeys,
      durations: resolved.durations,
      idx: sameSeq ? prior!.idx : 0,
      elapsed: sameSeq ? prior!.elapsed : 0,
      loop: loop ?? resolved.defaultLoop,
      };
    this.anims.set(key, anim);
    this.showFrame(anim);
  };

  private showFrame(anim: PartAnim): void {
    const key = anim.frameKeys[anim.idx]!;
    const tm = this.scene.textures;
    const apply = (): void => {
      if (!anim.img.scene || !tm.exists(key)) return;
      anim.img.setTexture(key);
      const src = tm.get(key).getSourceImage() as { width: number; height: number };
      if (src.width && src.height) {
        const fit = Math.min(anim.box.w / src.width, anim.box.h / src.height);
        anim.img.setScale(fit);
      }
    };
    if (tm.exists(key)) apply();
    else tm.once(Phaser.Textures.Events.ADD_KEY + key, apply);
  }

  update(delta: number): void {
    for (const [key, anim] of this.anims) {
      if (!anim.img.scene) {
        this.anims.delete(key); // element torn down
        continue;
      }
      if (stepSequence(anim, delta) !== null) this.showFrame(anim);
      else if (anim.img.texture.key === anim.frameKeys[anim.idx]) {
        // Re-assert the contain-fit even between swaps: a component's own
        // relayout may have restyled the part (bubble layout owns its icon).
        const src = this.scene.textures.get(anim.frameKeys[anim.idx]!).getSourceImage() as { width: number; height: number };
        if (src.width && src.height) anim.img.setScale(Math.min(anim.box.w / src.width, anim.box.h / src.height));
      }
    }
  }

  /** Re-attach every sequence part patch in the doc (elements may have
   *  registered before this animator existed, or after an undo restore). */
  resyncAll(): void {
    for (const id of uiRegistry.elements.keys()) uiRegistry.applyElement(id);
  }

  destroy(): void {
    this.anims.clear();
  }
}
