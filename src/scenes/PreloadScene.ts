import Phaser from 'phaser';
import type { TextureFactory } from '../art/TextureFactory';
import type { GameContext } from '../core/Context';
import { clipKey, clipsFor, dragonClipCharacter } from '../core/characterAnims';
import { LIVE_GAME_HEIGHT, LIVE_GAME_WIDTH, num, PALETTE, SCENES, STANDEE_BANKS } from '../core/Constants';
import { isLazyScreenArt } from '../core/lazyTextures';
import { renderScale } from '../core/render-scale';
import { ANIMATED_SPEAKERS, discTextureFor } from '../entities/PortraitAnimator';
import { preloadFlipbooks } from '../render/FlipbookFX';
import { BUILTIN_SEQUENCES, builtinSequence, builtinSequenceFiles, type BuiltinSequence } from '../render/sequenceCatalog';
import { preloadEmitterAssets } from '../render/fx/emitterAssets';
import { BANK_BASE, shippedSheets } from '../render/vfxBank';
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

    // Art the shipped map / code actually reference. A texture costs GPU memory
    // from the moment it is uploaded, drawn or not, and the `tile_`/`decor_` banks
    // are almost entirely UNPLACED weight — the authored 13×12 map uses the
    // `invisible` tile and one crystal, so 47 of the 49 entries were paying for
    // ground nothing stands on. Rebuilt from the map each boot rather than listed
    // by hand, so a re-exported world that DOES place a tile loads it automatically
    // and there is nothing to keep in sync.
    const map = ctx.state.map;
    // Backdrops are the single heaviest textures in the game (2610×1632 each)
    // and there is now one per world. Only the world we are about to show gets
    // uploaded; BoardScene fetches the others at the door when travel happens.
    const liveBackdrops = new Set((map.backgrounds ?? []).map((b) => `background_${b.name}`));
    const neededArt = new Set<string>(['tile_ash', 'tile_ash_alt']); // TextureFactory generators
    for (const v of Object.values(map.tilesByCell ?? {})) neededArt.add(`tile_${v}`);
    for (const d of map.mapDecor ?? []) neededArt.add(`decor_${d.name}`);
    for (const d of map.decor3d ?? []) neededArt.add(`decor_${d.name}`);
    for (const d of map.startingDecor ?? []) neededArt.add(`decor_${d.decor}`);
    for (const r of map.regions ?? []) for (const d of r.decor ?? []) neededArt.add(`decor_${d.decor}`);
    const skipAtBoot = (key: string): boolean =>
      (/^(tile_|decor_)/.test(key) && !neededArt.has(key)) ||
      (/^background_/.test(key) && !liveBackdrops.has(key)) ||
      // Uploaded but never drawn in Phaser — the visible title logo is the DOM
      // <img class="title-logo"> in index.html.
      key === 'title_logo' ||
      // Rare-screen art, fetched by `ensureTextures` when its screen opens.
      isLazyScreenArt(key);

    if (fileEntries.length > 0) {
      const barBg = this.add
        .rectangle(LIVE_GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2, 360, 18, num(PALETTE.plumShade), 0.9)
        .setStrokeStyle(2, num(PALETTE.gold));
      const bar = this.add.rectangle(
        LIVE_GAME_WIDTH / 2 - 176,
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
        if (skipAtBoot(entry.key)) continue;
        this.load.image(entry.key, entry.file as string);
      }
    }
    // Animated dialogue portrait: the guide's banks as 270x360 bust cutouts
    // (top 95% of each frame, natural alpha) in ONE 2160x2880 spritesheet
    // (scripts/bake-portrait-disc.py) — rest pair first, then talk, then blink.
    // One fetch, one GPU texture.
    // Cell size is fixed across characters; only the sheet's grid differs, and
    // Phaser derives the frame count from the image size, so a bigger atlas
    // needs no change here (scripts/bake-portrait-disc.py sizes the grid).
    for (const who of ANIMATED_SPEAKERS) {
      this.load.spritesheet(discTextureFor(who), `sprites/${who}-merge/disc-atlas.webp`, {
        frameWidth: 270,
        frameHeight: 360
      });
    }
    // World-standee banks for the characters who stand ON the map: an idle loop
    // and a one-shot scepter cast, both 8 frames on ONE shared canvas so the
    // sprite swaps between them without her body jumping. A missing sheet is
    // survivable — BoardScene falls back to the static `char_<id>` texture.
    //
    // Only THIS world's cast is fetched. `STANDEE_BANKS` is the whole roster
    // (Selyna is Borealis-only), and each bank is ~1 MB of spritesheet — loading
    // a character the board can never show would cost that for nothing.
    // `characters.json` stays the single owner of who belongs where.
    for (const [id, seq] of Object.entries(STANDEE_BANKS)) {
      // A bank is fetched when anyone in THIS world wears it — `art ?? id`, so
      // Eleanor-at-home (id eleanor_home, art eleanor) pulls Eleanor's sheets.
      if (!ctx.data.characters.characters.some((c) => (c.art ?? c.id) === id && c.world === ctx.state.worldId))
        continue;
      for (const [bank, key] of Object.entries(seq.keys)) {
        this.load.spritesheet(key, `sprites/${id}/world-${bank}.webp`, {
          frameWidth: seq.frameWidth,
          frameHeight: seq.frameHeight
        });
      }
    }
    // Align-Studio atlas clips (src/data/character-anims.json): every clip of
    // anyone standing in THIS world — idle/talk/cast/reactions for the board,
    // bust clips for the dialogue ring. Same fetch discipline as the standee
    // banks above — a character the board cannot show costs nothing, and
    // travel fetches the destination's at the door (fetchWorldArt).
    for (const c of ctx.data.characters.characters) {
      if (c.world !== ctx.state.worldId) continue;
      const art = c.art ?? c.id;
      for (const [clipId, clip] of Object.entries(clipsFor(art))) {
        if (this.textures.exists(clipKey(art, clipId))) continue;
        this.load.spritesheet(clipKey(art, clipId), clip.file, {
          frameWidth: clip.frameWidth,
          frameHeight: clip.frameHeight
        });
      }
    }
    // Map-decor clips — Runevault's boiling cauldron. A decor piece's clips live
    // under a character id of the same name (character-anims.json `cauldron`),
    // and follow the characters' discipline exactly: only the ACTIVE map's decor
    // is fetched, and travel exchanges them at the door (worldArt lists them).
    for (const d of ctx.state.map.mapDecor ?? []) {
      for (const [clipId, clip] of Object.entries(clipsFor(d.name))) {
        if (this.textures.exists(clipKey(d.name, clipId))) continue;
        this.load.spritesheet(clipKey(d.name, clipId), clip.file, {
          frameWidth: clip.frameWidth,
          frameHeight: clip.frameHeight
        });
      }
    }
    // …and the BOARD-DRAGON clip sets (idle / roar / fly / tosleep) — but ONLY
    // for the breeds already standing on this board.
    //
    // Dragons are merge pieces that can stand on any world's board, which is why
    // every breed's clips used to ride the boot preload. That reasoning is sound
    // and the conclusion was still wrong: these are the heaviest textures in the
    // game, and a spritesheet is uploaded as one 4096-wide RGBA surface, so the
    // eleven breeds together decode to ~1 GB resident — enough on its own for
    // WebKit to kill the tab, which is what iOS Chrome/Safari were doing right
    // after the loader finished. A board holds one or two breeds, not eleven.
    //
    // So they follow the standee rule above instead: fetch what this board can
    // actually show, and let `BoardScene.ensureDragonClips` pull a breed's set
    // the first time one of its dragons appears (spawn, merge or restore).
    const onBoard = new Set<string>();
    for (const item of ctx.state.items.values()) {
      const id = dragonClipCharacter(
        item.chain,
        item.tier,
        ctx.state.dragonSkins[item.chain] ?? null
      );
      if (id) onBoard.add(id);
    }
    for (const id of onBoard) {
      for (const [clipId, clip] of Object.entries(clipsFor(id))) {
        if (this.textures.exists(clipKey(id, clipId))) continue;
        this.load.spritesheet(clipKey(id, clipId), clip.file, {
          frameWidth: clip.frameWidth,
          frameHeight: clip.frameHeight
        });
      }
    }
    // VFX bank flipbooks for the payoff beats (hatch / finale / merge / chest).
    // Only the sheets in `SHIPPED` — see src/render/vfxBank.ts for the VRAM
    // reasoning. Each is a channel-packed frame sheet plus its motion vectors;
    // colour comes from the shared ramp LUT at draw time. A missing file is
    // survivable: BoardScene checks `hasFlipbook` and falls back to the
    // particle-only beat it has always played.
    preloadFlipbooks(this.load, shippedSheets(), BANK_BASE);
    // World FX emitters (docs/vfx-textures.md §7): the bank particle stills the
    // presets reference, under their own `fxb_*` keys so they never restyle the
    // game's existing fx_ember / fx_spark / fx_glow beats. The sheets they need
    // are already in SHIPPED above.
    preloadEmitterAssets(this.load, BANK_BASE, { sheets: false });
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
    // Built-in (guide/character) sequences are FILE-backed. The editor preloads ALL of
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
