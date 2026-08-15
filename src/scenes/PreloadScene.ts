import Phaser from 'phaser';
import type { TextureFactory } from '../art/TextureFactory';
import type { GameContext } from '../core/Context';
import { clipKey, clipsFor } from '../core/characterAnims';
import {
  decorClipCharacter,
  LIVE_GAME_WIDTH,
  LIVE_GAME_HEIGHT,
  num,
  PALETTE,
  SCENES,
  STANDEE_BANKS
} from '../core/Constants';
import { CRYSTAL_SPIN, CRYSTAL_SPIN_KEY } from '../core/crystalSpin';
import { liveCrystalAvailable } from '../core/graphicsState';
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
 * Fired on `game.events` once every texture the BOARD needs is resident, and
 * mirrored into the registry so a listener that arrives late can still tell.
 * `TitleScene` holds the scene switch against it — see `queueBoardArt`.
 */
export const BOARD_ART_READY = 'bootload:ready';
/** Fired on `game.events` with 0..1 while the board art downloads behind the title. */
export const BOARD_ART_PROGRESS = 'bootload:progress';

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
    // The ONLY thing the title is gated on. These are self-contained data URLs
    // — no network — and `applyUiReplacements` in create() needs them before any
    // scene builds objects. Everything else moved to `queueBoardArt`.
    for (const [name, uri] of Object.entries(uiRegistry.doc.assets)) {
      if (!this.textures.exists(uploadKey(name))) this.load.image(uploadKey(name), uri);
    }
    for (const [name, seq] of Object.entries(uiRegistry.doc.sequences)) {
      seq.frames.forEach((uri, i) => {
        const key = sequenceFrameKey(name, i);
        if (!this.textures.exists(key)) this.load.image(key, uri);
      });
    }
  }

  /**
   * Everything the BOARD needs — queued AFTER the title is already on screen.
   *
   * This used to be the body of `preload()`, and that one fact is the whole bug:
   * Phaser does not call `create()` until the preload queue has landed, and
   * `create()` is what starts `TitleScene`. So the title — which loads nothing,
   * its logo and background being DOM `<img>`s and its Play button drawn with
   * Graphics — was held behind every megabyte of board art. On a phone that is a
   * minute of black screen with no Play button on it, and if the tab dies during
   * the upload the button never arrives at all.
   *
   * Worse, those two `<img>` fetches were competing with the queue for
   * connections, so even the title art came late.
   *
   * Now the title comes up as soon as the bundle parses and this downloads
   * behind it, in the time the player spends looking at the logo and reaching
   * for Play. Play stays tappable throughout; `TitleScene` waits on
   * `BOARD_ART_READY` before starting the board, so nothing enters a world whose
   * art has not arrived. (Ported from main, 782bac6.)
   */
  private queueBoardArt(): void {
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
    // The skins actually BEING WORN. `isLazyScreenArt` holds the whole `skin_`
    // bank back — fourteen plates for the at-most-two a save can be showing —
    // and these are the exceptions that come back, so a player who bought a
    // skin still sees it on the first frame instead of watching the base art
    // get replaced a moment later. Derived from the save, like `neededArt`
    // above, so nothing has to be kept in sync by hand.
    const wornSkins = new Set<string>();
    if (ctx.state.manorSkin) wornSkins.add(`skin_${ctx.state.manorSkin}`);
    for (const [, skin] of Object.entries(ctx.state.dragonSkins ?? {})) {
      if (!skin) continue;
      // Which tiers a skin covers is decided by which plates exist (BoardScene
      // `textureFor`), so ask for every tier and let the filter drop the rest.
      for (let tier = 1; tier <= 5; tier++) wornSkins.add(`skin_${skin}_${tier}`);
    }
    const skipAtBoot = (key: string): boolean =>
      (/^(tile_|decor_)/.test(key) && !neededArt.has(key)) ||
      (/^background_/.test(key) && !liveBackdrops.has(key)) ||
      // Uploaded but never drawn in Phaser — the visible title logo is the DOM
      // <img class="title-logo"> in index.html.
      key === 'title_logo' ||
      // Rare-screen art, fetched by `ensureTextures` when its screen opens.
      (isLazyScreenArt(key) && !wornSkins.has(key));

    // The bar belongs to the UI-Builder route only. On the game route this wave
    // runs BEHIND the title, and PreloadScene's canvas sits under TitleScene's —
    // so a bar drawn here would stripe the middle of the logo. The title shows
    // the wait itself, and only if the player taps Play before it lands.
    const showBar = new URLSearchParams(window.location.search).has('uiedit');
    if (showBar && fileEntries.length > 0) {
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
    }
    // OUTSIDE the bar block, deliberately: the fallback and the queue itself are
    // the load, not its decoration, and nesting them under a progress widget is
    // how gating that widget would have silently stopped loading the board.
    if (fileEntries.length > 0) {
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
    // Map-decor clips — the Runevault cauldron's boil loop. A decor piece's
    // clips live under a character id of the same name (character-anims.json
    // `cauldron`), and follow the characters' fetch discipline exactly: only
    // the ACTIVE map's decor is fetched, and travel exchanges them at the door.
    for (const d of ctx.state.map.mapDecor ?? []) {
      const art = decorClipCharacter(d.name);
      for (const [clipId, clip] of Object.entries(clipsFor(art))) {
        if (this.textures.exists(clipKey(art, clipId))) continue;
        this.load.spritesheet(clipKey(art, clipId), clip.file, {
          frameWidth: clip.frameWidth,
          frameHeight: clip.frameHeight
        });
      }
    }
    // BOARD-DRAGON clip sets are NOT preloaded — BoardScene fetches a breed's
    // when a dragon of that breed first stands on the board.
    //
    // They are the heaviest textures in the game by a distance, and it is frame
    // COUNT rather than frame size: the red whelp's `fly` is 240 frames of
    // 256×214, which Phaser uploads as one 4096×3210 sheet — 50 MB of video
    // memory. With `idle` (194 frames, 32 MB), `tosleep` (29 MB) and `roar`
    // (14 MB) that is 126 MB resident from the title screen, for ONE breed, in
    // a session that may never hatch anything. Every breed added multiplies it.
    //
    // Deferring is safe by construction rather than by care: `dragonClip`
    // already returns null when a sheet is not resident, and the dragon animates
    // with its rig — which is how it moved before these clips existed at all.
    // The clips take over the moment they land.
    // The crystal's baked spin sheet — ONLY where the live three.js gem is
    // declined (every touch device, the `low` profile). 0.46 MB on the wire and
    // 18 MB decoded, so a machine that renders the real gem must never pay for a
    // picture of it; `liveCrystalAvailable` is the single predicate BoardScene
    // asks too, so the two cannot drift into fetching both or neither.
    if (!liveCrystalAvailable()) {
      this.load.spritesheet(CRYSTAL_SPIN_KEY, 'sprites/items/crystal-spin.webp', {
        frameWidth: CRYSTAL_SPIN.frameWidth,
        frameHeight: CRYSTAL_SPIN.frameHeight
      });
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
    // (The UI Builder's own uploads and PNG sequences are data URLs and load in
    // `preload` — the title needs them; the board wave does not.)
    //
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
    const uiedit = new URLSearchParams(window.location.search).has('uiedit');
    if (uiedit) {
      // The UI Builder boots into its own document scene — the game NEVER runs,
      // so there is no title to race: take the whole wave and start when it has
      // landed, exactly as this scene always behaved.
      this.queueBoardArt();
      this.load.once(Phaser.Loader.Events.COMPLETE, () => this.scene.start(SCENES.uiEditor));
      this.load.start();
      return;
    }

    // The title is ready NOW — it draws its own button and its art is in the
    // DOM. `launch`, not `start`: this scene must stay alive to own the loader
    // that is still running, and a stopped scene's loader dies with it.
    this.scene.launch(SCENES.title);

    this.queueBoardArt();
    let announced = false;
    const done = (): void => {
      if (announced) return;
      announced = true;
      this.game.registry.set(BOARD_ART_READY, true);
      this.game.events.emit(BOARD_ART_READY);
      // Stop RENDERING but stay alive: this scene owns the loader, and it draws
      // nothing now, so hiding it costs the renderer one less pass.
      this.scene.setVisible(false);
    };
    this.load.on('progress', (value: number) => this.game.events.emit(BOARD_ART_PROGRESS, value));
    this.load.once(Phaser.Loader.Events.COMPLETE, done);
    this.load.start();
    // An empty queue completes INSIDE `start()`, before the handler above can be
    // reached on some paths (every texture already resident — a restart, or a
    // build with no file-backed art). Belt and braces, made idempotent by
    // `announced` so the ordinary path cannot fire it twice.
    if (this.load.totalToLoad === 0) done();
  }
}
