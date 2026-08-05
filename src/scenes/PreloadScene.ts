import Phaser from 'phaser';
import type { TextureFactory } from '../art/TextureFactory';
import type { GameContext } from '../core/Context';
import { GAME_WIDTH, LIVE_GAME_HEIGHT, num, PALETTE, SCENES } from '../core/Constants';
import { renderScale } from '../core/render-scale';
import { BUILTIN_SEQUENCES, builtinSequence, builtinSequenceFiles, type BuiltinSequence } from '../render/sequenceCatalog';
import { isLazyScreenArt } from '../core/lazyTextures';
import { applyUiReplacements, sequenceFrameKey, uiRegistry, uploadKey } from '../ui/theme';
import type { UiThemeDoc } from '../ui/themeCore';

/** Built-in sequences the saved theme references — anim layers in custom
 *  components AND `sequence` part patches on built-in elements (e.g. the
 *  bubble portrait playing a talk bank) — so the game loads only the heavy
 *  banks it actually needs. */
function referencedBuiltins(doc: UiThemeDoc): BuiltinSequence[] {
  const seen = new Map<string, BuiltinSequence>();
  const add = (name: string | null | undefined): void => {
    const seq = name ? builtinSequence(name) : undefined;
    if (seq) seen.set(seq.key, seq);
  };
  for (const comp of Object.values(doc.custom)) {
    for (const layer of comp.layers) {
      if (layer.kind === 'anim') add(layer.sequence);
    }
  }
  for (const patch of Object.values(doc.elements)) {
    for (const part of Object.values(patch.parts ?? {})) add(part.sequence);
  }
  return [...seen.values()];
}

/**
 * Loads real-art files for any assets.json entry flipped to source:"file"
 * (from assets/, the Vite public dir). A failed file falls back to its
 * generated placeholder so the build never blocks on art.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super(SCENES.preload);
  }

  preload(): void {
    this.cameras.main.setOrigin(0).setZoom(renderScale.value); // hi-DPI backing for the loading bar
    const ctx = this.registry.get('ctx') as GameContext;
    const factory = this.registry.get('textureFactory') as TextureFactory;

    const fileEntries = ctx.data.assets.images.filter((e) => e.source === 'file' && e.file);

    // Art the shipped map / code actually reference. Everything else in the huge
    // tile_/decor_ banks is UNPLACED weight (the current 13×12 map uses only the
    // `invisible` tile + no decor → ~29 MB of GPU textures never drawn), so we skip
    // uploading it. Rebuilt from the map each boot, so a re-exported world that DOES
    // place a tile/decor loads it automatically — nothing to hand-maintain.
    const map = ctx.data.map;
    const neededArt = new Set<string>(['tile_ash', 'tile_ash_alt']); // TextureFactory generators
    for (const v of Object.values(map.tilesByCell ?? {})) neededArt.add(`tile_${v}`);
    for (const d of map.mapDecor ?? []) neededArt.add(`decor_${d.name}`);
    for (const d of map.startingDecor ?? []) neededArt.add(`decor_${d.decor}`);
    for (const r of map.regions ?? []) for (const d of r.decor ?? []) neededArt.add(`decor_${d.decor}`);
    const isUnplacedArt = (key: string): boolean => /^(tile_|decor_)/.test(key) && !neededArt.has(key);

    if (fileEntries.length > 0) {
      const barBg = this.add
        .rectangle(GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2, 360, 18, num(PALETTE.plumShade), 0.9)
        .setStrokeStyle(2, num(PALETTE.gold));
      const bar = this.add.rectangle(
        GAME_WIDTH / 2 - 176,
        LIVE_GAME_HEIGHT / 2,
        4,
        10,
        num(PALETTE.gold)
      );
      bar.setOrigin(0, 0.5);
      this.load.on('progress', (value: number) => bar.setSize(4 + 348 * value, 10));
      this.load.on('complete', () => {
        barBg.destroy();
        bar.destroy();
      });
      this.load.on('loaderror', (file: Phaser.Loader.File) => {
        factory.generate(file.key);
      });
      for (const entry of fileEntries) {
        if (isUnplacedArt(entry.key)) continue; // unplaced tile/decor bank — skip the upload
        // `title_logo` is uploaded but never drawn in Phaser — the visible title
        // logo is a DOM <img id="title-logo"> (index.html). Skip the dead 6 MB texture.
        if (entry.key === 'title_logo') continue;
        // Rare-screen art (finale trailers/teasers, duel throws, level-up emblem) is
        // loaded on demand (ensureTextures) when its screen shows — keep it off boot.
        if (isLazyScreenArt(entry.key)) continue;
        this.load.image(entry.key, entry.file as string);
      }
    }
    // Animated dialogue portrait: every Laurah bank as 300x400 bust cutouts
    // (top 95% of each frame, natural alpha) in ONE 2100x2400 spritesheet
    // (scripts/bake-laurah-portrait.py) — idle pair first, then the talk banks
    // in catalog order. One fetch, one GPU texture.
    this.load.spritesheet('laurah_disc', 'sprites/laurah/disc-atlas.png', {
      frameWidth: 300,
      frameHeight: 400
    });
    // UI Builder uploads (ui-theme.json `assets`, self-contained data URLs).
    for (const [name, uri] of Object.entries(uiRegistry.doc.assets)) {
      if (!this.textures.exists(uploadKey(name))) this.load.image(uploadKey(name), uri);
    }
    // UI Builder PNG-sequence animations — every frame as its own texture, so
    // `anim` layers in custom components play in dev, preview and production.
    for (const [name, seq] of Object.entries(uiRegistry.doc.sequences)) {
      seq.frames.forEach((uri, i) => {
        const key = sequenceFrameKey(name, i);
        if (!this.textures.exists(key)) this.load.image(key, uri);
      });
    }
    // Built-in (Laurah) sequences are FILE-backed. The editor preloads ALL of
    // them so the Animations rail is instantly draggable; the game loads only
    // the banks a saved component actually references (they're heavy).
    const uiedit = new URLSearchParams(window.location.search).has('uiedit');
    const wanted = uiedit ? BUILTIN_SEQUENCES : referencedBuiltins(uiRegistry.doc);
    for (const seq of wanted) {
      builtinSequenceFiles(seq).forEach((file, i) => {
        const key = sequenceFrameKey(seq.key, i);
        if (!this.textures.exists(key)) this.load.image(key, file);
      });
    }
  }

  create(): void {
    // Saved art replacements repaint generated textures IN PLACE before any
    // scene builds objects — consumers get the new art with zero object churn.
    applyUiReplacements(this);
    // The UI Builder boots into its own document scene — the game NEVER runs.
    const uiedit = new URLSearchParams(window.location.search).has('uiedit');
    this.scene.start(uiedit ? SCENES.uiEditor : SCENES.title);
  }
}
