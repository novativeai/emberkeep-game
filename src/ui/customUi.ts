import Phaser from 'phaser';
import { FONT } from '../art/design';
import { UI_NINESLICE } from '../art/TextureFactory';
import { CHARACTER_FACES, faceTextureKeyFor, loadCharacterRig } from '../render/characterCatalog';
import { RigPlayer } from '../render/RigPlayer';
import { PartAnimator, resolveSequence, stepSequence } from './partAnimator';
import { uiRegistry } from './theme';
import type { CustomLayer } from './themeCore';
import { hexToNum } from './themeCore';

const DEFAULT_DEPTH = 40; // above the HUD (10), below modal panels (60)

interface LiveRigLayer {
  layer: CustomLayer;
  player: RigPlayer;
}

/** A playing PNG-sequence layer: an Image whose texture is swapped frame by
 *  frame on the scene clock, honouring each frame's own duration. */
interface LiveAnimLayer {
  layer: CustomLayer;
  img: Phaser.GameObjects.Image;
  frameKeys: string[];
  durations: number[]; // ms per frame, parallel to frameKeys
  idx: number;
  elapsed: number; // ms held on the current frame
  loop: boolean;
}

interface LiveComponent {
  id: string;
  root: Phaser.GameObjects.Container;
  rigs: LiveRigLayer[];
  anims: LiveAnimLayer[];
  objByName: Map<string, Phaser.GameObjects.GameObject>;
}

/**
 * Instantiates the UI Builder's tool-authored components (ui-theme.json
 * `custom` section) inside the game. This is what makes the exported JSON
 * "digestible": image/text layers become plain game objects, `rig` layers
 * become LIVE RigPlayers wearing the chosen body preset (idle, low flight,
 * roar…) and face mode (ambient blink / looping talk). Runs in EVERY build —
 * dev, preview, production — not just the editor.
 */
export class CustomUiManager {
  private live = new Map<string, LiveComponent>();
  /** Animates `sequence` part patches on BUILT-IN elements (e.g. the bubble
   *  portrait replaced by a talk bank) — shares this scene's tick. */
  readonly partAnimator: PartAnimator;

  constructor(private scene: Phaser.Scene) {
    this.partAnimator = new PartAnimator(scene);
    uiRegistry.partSequenceHook = this.partAnimator.hook;
    // Elements registered BEFORE this manager existed re-apply so their saved
    // sequence patches attach (scenes construct components first).
    this.partAnimator.resyncAll();
    // Rigs animate on the scene clock; talk loops re-arm if they ever run out.
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this);
      for (const id of [...this.live.keys()]) this.destroyComponent(id);
      if (uiRegistry.partSequenceHook === this.partAnimator.hook) uiRegistry.partSequenceHook = null;
      this.partAnimator.destroy();
    });
  }

  private tick(_t: number, delta: number): void {
    for (const comp of this.live.values()) {
      for (const rig of comp.rigs) {
        rig.player.update(delta);
        if (rig.layer.face === 'talk') rig.player.playFaceIfIdle();
      }
      for (const anim of comp.anims) {
        if (stepSequence(anim, delta) !== null) {
          const key = anim.frameKeys[anim.idx]!;
          if (anim.img.scene && anim.img.scene.textures.exists(key)) anim.img.setTexture(key);
        }
      }
    }
    this.partAnimator.update(delta);
  }

  buildAll(): void {
    for (const id of Object.keys(uiRegistry.doc.custom)) this.build(id);
  }

  /** Tear down every live component and rebuild from the current doc —
   *  used by the editor's undo/redo restore. */
  syncAll(): void {
    for (const id of [...this.live.keys()]) this.destroyComponent(id);
    this.buildAll();
  }

  /** (Re)build one component from its JSON definition. */
  build(id: string): void {
    this.destroyComponent(id);
    const def = uiRegistry.doc.custom[id];
    if (!def) return;
    const root = this.scene.add.container(def.x, def.y).setDepth(def.depth ?? DEFAULT_DEPTH);
    root.setScale(def.scale ?? 1);
    if (def.visible === false) root.setVisible(false);
    const comp: LiveComponent = { id, root, rigs: [], anims: [], objByName: new Map() };
    this.live.set(id, comp);
    for (const layer of def.layers) this.buildLayer(comp, layer);
    this.syncZOrder(comp);
    // Register with the theme registry: the editor selects/drag-drills it like
    // any built-in element (parts = the layers).
    const parts: Record<string, Phaser.GameObjects.GameObject> = {};
    for (const [name, obj] of comp.objByName) parts[name] = obj;
    uiRegistry.register(this.scene, `custom.${id}`, def.label, 'Custom', root, parts);
  }

  /** Container children must mirror the layer array (bottom → top). Skipped
   *  layers and ASYNC rig loads would otherwise scramble the stacking — the
   *  panel's layer order IS the z hierarchy, so re-stack whenever anything
   *  lands or the array is reordered. */
  private syncZOrder(comp: LiveComponent): void {
    const def = uiRegistry.doc.custom[comp.id];
    if (!def || !comp.root.scene) return;
    for (const layer of def.layers) {
      const obj = comp.objByName.get(layer.name);
      if (obj) comp.root.bringToTop(obj);
    }
  }

  private buildLayer(comp: LiveComponent, layer: CustomLayer): void {
    if (layer.kind === 'image') {
      if (!layer.texture || !this.scene.textures.exists(layer.texture)) return;
      let img: Phaser.GameObjects.Image | Phaser.GameObjects.NineSlice;
      const slice = UI_NINESLICE[layer.texture];
      const isWebGL = this.scene.game.renderer.type === Phaser.WEBGL;
      if (layer.w && layer.h && layer.slice !== false && slice && isWebGL) {
        // Scalable FRAME: 9-slice keeps corners/borders crisp at any size.
        img = this.scene.add.nineslice(
          layer.x, layer.y, layer.texture, undefined,
          layer.w, layer.h, slice.l, slice.r, slice.t, slice.b
        );
      } else {
        img = this.scene.add.image(layer.x, layer.y, layer.texture);
        if (layer.w && layer.h) img.setDisplaySize(layer.w, layer.h);
        else img.setScale((layer.scaleX ?? layer.scale ?? 1), (layer.scaleY ?? layer.scale ?? 1));
      }
      img.setAlpha(layer.alpha ?? 1);
      img.setAngle(layer.angle ?? 0);
      if (layer.visible === false) img.setVisible(false);
      if (layer.tint) img.setTint(hexToNum(layer.tint));
      comp.root.add(img);
      comp.objByName.set(layer.name, img);
      return;
    }
    if (layer.kind === 'text') {
      const st = layer.style ?? {};
      const txt = this.scene.add
        .text(layer.x, layer.y, layer.text ?? '', {
          fontFamily: st.fontFamily ?? FONT.ui,
          fontSize: `${st.fontSize ?? 40}px`,
          fontStyle: st.fontStyle ?? 'bold',
          color: st.color ?? '#FFF6E8',
          stroke: st.stroke ?? '#241B22',
          strokeThickness: st.strokeThickness ?? 0
        })
        .setOrigin(0.5);
      txt.setScale(layer.scale ?? 1);
      txt.setAlpha(layer.alpha ?? 1);
      txt.setAngle(layer.angle ?? 0);
      if (layer.visible === false) txt.setVisible(false);
      comp.root.add(txt);
      comp.objByName.set(layer.name, txt);
      return;
    }
    if (layer.kind === 'anim') {
      const resolved = layer.sequence ? resolveSequence(this.scene, layer.sequence) : null;
      if (!resolved || !resolved.frameKeys.length) return;
      const { frameKeys } = resolved;
      // Per-frame timing: the sequence's own holds, or an even fps cadence when
      // the layer overrides fps.
      const evenMs = 1000 / (layer.fps ?? resolved.fps ?? 12);
      const durations = frameKeys.map((_, i) => (layer.fps ? evenMs : resolved.durations[i] ?? evenMs));
      const firstReady = this.scene.textures.exists(frameKeys[0]!);
      // add.image tolerates a not-yet-decoded key (shows nothing until ready);
      // size it once frame 0 lands so w/h/scale measure against real pixels.
      const img = this.scene.add.image(layer.x, layer.y, frameKeys[0]!);
      const sizeIt = (): void => {
        if (!img.scene) return;
        if (layer.w && layer.h) img.setDisplaySize(layer.w, layer.h);
        else img.setScale(layer.scaleX ?? layer.scale ?? 1, layer.scaleY ?? layer.scale ?? 1);
      };
      if (firstReady) sizeIt();
      else this.scene.textures.once(Phaser.Textures.Events.ADD_KEY + frameKeys[0]!, () => {
        img.setTexture(frameKeys[0]!);
        sizeIt();
      });
      img.setAlpha(layer.alpha ?? 1);
      img.setAngle(layer.angle ?? 0);
      if (layer.visible === false) img.setVisible(false);
      if (layer.tint) img.setTint(hexToNum(layer.tint));
      comp.root.add(img);
      comp.objByName.set(layer.name, img);
      comp.anims.push({ layer, img, frameKeys, durations, idx: 0, elapsed: 0, loop: layer.loop !== false });
      return;
    }
    // rig — a live animated character; loads async, degrades to nothing.
    const character = layer.character ?? 'dragon-red';
    void loadCharacterRig(this.scene, character).then((rig) => {
      if (!rig || !comp.root.scene || this.live.get(comp.id) !== comp) return;
      const player = new RigPlayer(this.scene, rig, (l) => `rig:${rig.character}:${l}`, {
        scale: layer.scale ?? 0.3
      });
      const face = CHARACTER_FACES[rig.character];
      if (face && layer.face && layer.face !== 'none') {
        player.attachFace(this.scene, face, faceTextureKeyFor(rig.character));
        if (layer.face === 'talk') player.playFace(Number.POSITIVE_INFINITY);
      }
      player.setFacing(layer.facing ?? 'left');
      player.play(layer.body ?? 'idle');
      player.container.setPosition(layer.x, layer.y);
      player.container.setAlpha(layer.alpha ?? 1);
      player.container.setAngle(layer.angle ?? 0);
      if (layer.visible === false) player.container.setVisible(false);
      comp.root.add(player.container);
      comp.rigs.push({ layer, player });
      comp.objByName.set(layer.name, player.container);
      this.syncZOrder(comp); // async arrival — restore the authored stacking
    });
  }

  destroyComponent(id: string): void {
    const comp = this.live.get(id);
    if (!comp) return;
    for (const rig of comp.rigs) rig.player.destroy();
    comp.root.destroy();
    this.live.delete(id);
    uiRegistry.elements.delete(`custom.${id}`);
  }

  has(id: string): boolean {
    return this.live.has(id);
  }
}
