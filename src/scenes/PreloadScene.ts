import Phaser from 'phaser';
import type { TextureFactory } from '../art/TextureFactory';
import type { GameContext } from '../core/Context';
import { clipKey, clipsFor } from '../core/characterAnims';
import { bootChains, splitWaves } from '../core/assetWaves';
import { savedDragonClips } from '../core/clipResidency';
import { IS_LOW_END, SCENES, STANDEE_BANKS, WORLD_ID } from '../core/Constants';
import { CRYSTAL_SPIN, CRYSTAL_SPIN_KEY } from '../core/crystalSpin';
import { liveCrystalAvailable } from '../core/graphicsState';
import type { AssetEntry, SpeakerId } from '../core/types';
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
 * `TitleScene` holds Play against it — see `queueBoardArt`.
 */
export const BOARD_ART_READY = 'bootload:ready';
/** Fired on `game.events` with 0..1 while the board art downloads behind the title. */
export const BOARD_ART_PROGRESS = 'bootload:progress';
/** Fired on `game.events` once the streamed `play` wave has finished landing too. */
export const PLAY_ART_READY = 'bootload:play_ready';

/** The one dialogue speaker who is not a map character — see the fetch below. */
const ELDER_SPEAKER: SpeakerId = 'golden_elder';

/**
 * Files per streamed batch, and the breather between batches.
 *
 * The cost of the play wave is the texture UPLOAD, and spreading those out is
 * what keeps it invisible to a running board. The constrained pair is not a
 * tuning preference: at 6-per-220 ms this wave was uploading ~140 MB of decoded
 * texture into a live board in the first two seconds, on top of the board's own
 * footprint and the dragon clips arriving beside it, and iOS answered by killing
 * the renderer process. Slower here means the peak never stacks.
 */
const STREAM_BATCH = IS_LOW_END ? 2 : 6;
const STREAM_GAP_MS = IS_LOW_END ? 600 : 220;
/**
 * How long after the board says it is ready before streaming resumes.
 *
 * `world:ready` fires at the END of BoardScene.create, but the frames right
 * after it are the most expensive in the session — the camera settles, the
 * spawn tweens run, the FX rigs light up. Landing texture uploads in exactly
 * that window is what turned a memory problem into a crash, so the stream keeps
 * its hands off until the board has had a moment to itself.
 */
const STREAM_BOARD_GRACE_MS = 1500;

/** A spritesheet held back from the boot gate, queued again during play. */
interface DeferredSheet {
  key: string;
  file: string;
  frameWidth: number;
  frameHeight: number;
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
    // UI Builder uploads and PNG-sequence animations are self-contained data
    // URLs — no network, and `applyUiReplacements` in create() needs them before
    // any scene builds objects. They are the ONLY thing the title is gated on.
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
   * Everything the BOARD needs — queued after the title is already on screen.
   *
   * This used to be the body of `preload()`, which meant Phaser would not call
   * `create()` (and therefore would not start `TitleScene`) until all ~19.4 MB of
   * it had landed. The title screen loads NOTHING: its logo and background are
   * DOM `<img>`s in index.html and its Play button is drawn with `Graphics`. So
   * the player was staring at a loading bar for a screen that was ready
   * immediately — and worse, those two `<img>` fetches were competing with the
   * 19.4 MB queue for connections, so on a slow phone even the title art arrived
   * late.
   *
   * Now the title comes up as soon as the bundle parses and this downloads behind
   * it, in the time the player spends looking at the logo and reaching for Play.
   * Play stays tappable throughout; `TitleScene` waits on `BOARD_ART_READY`
   * before starting the board, so nothing can enter a world whose art is missing.
   */
  private queueBoardArt(): { images: AssetEntry[]; sheets: DeferredSheet[] } {
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
      // The untrimmed crystal still, on the devices that play the baked SPIN
      // instead. `textureFor` returns the sheet there, so the still is 2.9 MB of
      // texture that nothing can ever draw — and it was being uploaded on
      // exactly the devices with the least room for it.
      (key === 'item_crystal_1' && !liveCrystalAvailable()) ||
      // Rare-screen art, fetched by `ensureTextures` when its screen opens.
      isLazyScreenArt(key);

    // A failed file falls back to its generated placeholder so the build never
    // blocks on art. This is the ONLY thing the old in-scene loading bar shared
    // a block with — the bar itself is gone, because there is no longer a moment
    // where the player sits looking at this scene: the title is already up and
    // shows the wait on its own Play button.
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      factory.generate(file.key);
    });

    // The split. `boot` is queued here and gates Play; `play` is handed back to
    // stream behind the running board. See src/core/assetWaves.ts for why the
    // line falls where it does — in short, a new save has ONE item on the board
    // and 112 of the 116 item textures cannot be reached in the opening minute.
    /** Spritesheets held back to stream during play — see the character clips below. */
    const playSheets: DeferredSheet[] = [];

    const placed = new Set([...neededArt, ...liveBackdrops]);
    const waves = splitWaves(
      fileEntries.filter((e) => !skipAtBoot(e.key)),
      {
        placed,
        bootChains: bootChains(ctx.systems.save.peek(), map, ctx.data.tutorial, WORLD_ID)
      }
    );
    for (const entry of waves.boot) this.load.image(entry.key, entry.file as string);
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
    //
    // Split by clip, not by character: her IDLE is what the board draws the
    // moment it opens, and it is the only one of the six that cannot arrive
    // late. `talking` and `blinking` are the two biggest sheets she owns (72 and
    // 36 frames) and neither is wanted until a dialogue ring opens; `cast`,
    // `laugh` and `happy` answer events further out still. All of them degrade
    // to the static `char_<id>` texture until they land, so streaming them costs
    // nothing but an early beat played on the still.
    for (const c of ctx.data.characters.characters) {
      if (c.world !== ctx.state.worldId) continue;
      const art = c.art ?? c.id;
      for (const [clipId, clip] of Object.entries(clipsFor(art))) {
        if (this.textures.exists(clipKey(art, clipId))) continue;
        const sheet = {
          key: clipKey(art, clipId),
          file: clip.file,
          frameWidth: clip.frameWidth,
          frameHeight: clip.frameHeight
        };
        if (clipId === 'idle') this.load.spritesheet(sheet.key, sheet.file, sheet);
        else playSheets.push(sheet);
      }
    }
    // The Golden Elder's DIALOGUE BUST. She is the one speaker the loop above
    // cannot reach: `characters.json` lists who stands on a MAP, and she is an
    // altar fixture whose talking head only ever appears in the bubble's ring.
    //
    // Home world only, and deferred. She never speaks anywhere else — both
    // `UIScene.sayElderAsk` and `onElderQuestCompleted` return early off-world,
    // and Borealis does not open until her awakening quest is already done —
    // so a Borealis boot would be paying 3 MB for a ring she cannot fill. The
    // ring degrades to `portrait_golden_elder`, her still bust, until they land.
    if (ctx.state.worldId === WORLD_ID) {
      for (const [clipId, clip] of Object.entries(clipsFor(ELDER_SPEAKER))) {
        if (this.textures.exists(clipKey(ELDER_SPEAKER, clipId))) continue;
        playSheets.push({
          key: clipKey(ELDER_SPEAKER, clipId),
          file: clip.file,
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
    //
    // Read off the SAVE, not off `ctx.state`. The state's board is empty here —
    // `beginRun()` hydrates it from `UIScene.create()`, two scenes after this —
    // so deriving the list from `ctx.state.items` (as this did) produced an
    // empty set on every single boot and quietly moved the entire cost into
    // gameplay. `savedDragonClips` reads the persisted board instead, for the
    // world the save actually resumes in.
    for (const id of savedDragonClips(ctx.systems.save.peek(), WORLD_ID)) {
      for (const [clipId, clip] of Object.entries(clipsFor(id))) {
        if (this.textures.exists(clipKey(id, clipId))) continue;
        this.load.spritesheet(clipKey(id, clipId), clip.file, {
          frameWidth: clip.frameWidth,
          frameHeight: clip.frameHeight
        });
      }
    }
    // The crystal's baked spin sheet — ONLY where the live three.js gem is
    // declined (iOS, the `low` profile). 0.46 MB on the wire and 19 MB decoded,
    // so a machine that renders the real gem must never pay for a picture of it;
    // `liveCrystalAvailable` is the single predicate BoardScene asks too, so the
    // two cannot drift into fetching both or neither.
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
    return { images: waves.play, sheets: playSheets };
  }

  /**
   * Stream the `play` wave behind the running board, in small batches.
   *
   * The download itself is off-thread; what costs a frame is the texture UPLOAD
   * on completion, so the batching is the whole point — a few files at a time
   * with a gap between them spreads those uploads out instead of landing ~190 of
   * them in one hitch the moment the board opens. The gap is idle time for the
   * GPU, not a throttle on bandwidth: the next batch is queued the moment the
   * last one is resident.
   *
   * Nothing here is load-bearing. Everything in this wave has a fallback while it
   * is absent (generated placeholder art, the static `char_<id>` standee), so a
   * player on a dead connection gets a playable board rather than a stalled one —
   * which is the property that makes it safe to leave the boot gate as small as
   * it is.
   */
  private streamPlayWave(wave: { images: AssetEntry[]; sheets: DeferredSheet[] }): void {
    const queue: (() => void)[] = [
      ...wave.images.map((e) => () => this.load.image(e.key, e.file as string)),
      ...wave.sheets.map((s) => () => this.load.spritesheet(s.key, s.file, s))
    ];
    if (queue.length === 0) {
      this.scene.stop();
      return;
    }
    // Hold while the board is building. The stream starts on the TITLE, where it
    // has the device to itself and is free — but the moment the player taps Play
    // it would otherwise be uploading into BoardScene.create. `world:ready` is
    // the board telling us it is done; until it arrives (or if the player never
    // leaves the title) streaming continues as normal.
    const ctx = this.registry.get('ctx') as GameContext;
    let held = false;
    let resume: (() => void) | null = null;
    // The BOARD SCENE's own start, not a bus event: `world:switch` only fires on
    // travel, and the window that actually crashed iOS is the FIRST board build
    // — the one reached straight from the title, which no travel event
    // announces. START fires for both, and again for every restart.
    this.scene.manager.getScene(SCENES.board)?.events.on(Phaser.Scenes.Events.START, () => {
      held = true;
    });
    ctx.bus.on('world:ready', () => {
      // Not immediately: give the new board its opening frames unmolested.
      this.time.delayedCall(STREAM_BOARD_GRACE_MS, () => {
        held = false;
        const go = resume;
        resume = null;
        go?.();
      });
    });

    let at = 0;
    const pump = (): void => {
      if (!this.scene.isActive()) return;
      if (held) {
        resume = pump; // parked until the board settles
        return;
      }
      if (at >= queue.length) {
        this.game.registry.set(PLAY_ART_READY, true);
        this.game.events.emit(PLAY_ART_READY);
        this.scene.stop(); // the loader has nothing left to own
        return;
      }
      for (let n = 0; n < STREAM_BATCH && at < queue.length; n++, at++) queue[at]!();
      this.load.once(Phaser.Loader.Events.COMPLETE, () => {
        this.time.delayedCall(STREAM_GAP_MS, pump);
      });
      this.load.start();
    };
    pump();
  }

  create(): void {
    // Saved art replacements repaint generated textures IN PLACE before any
    // scene builds objects — consumers get the new art with zero object churn.
    applyUiReplacements(this);
    const uiedit = new URLSearchParams(window.location.search).has('uiedit');
    if (uiedit) {
      // The UI Builder boots into its own document scene — the game NEVER runs,
      // so there is no title to race and nothing to stream: take both waves at
      // once and start when the lot has landed.
      const rest = this.queueBoardArt();
      for (const e of rest.images) this.load.image(e.key, e.file as string);
      for (const s of rest.sheets) this.load.spritesheet(s.key, s.file, s);
      this.load.once(Phaser.Loader.Events.COMPLETE, () => this.scene.start(SCENES.uiEditor));
      this.load.start();
      return;
    }

    // The title is ready NOW — it draws its own button and its art is in the DOM.
    // `launch`, not `start`: this scene must stay alive to own the loader that is
    // still running. It is stopped once the play wave has finished streaming.
    this.scene.launch(SCENES.title);

    const playWave = this.queueBoardArt();
    let announced = false;
    const done = (): void => {
      if (announced) return;
      announced = true;
      this.game.registry.set(BOARD_ART_READY, true);
      this.game.events.emit(BOARD_ART_READY);
      // Stop RENDERING but keep updating: this scene still owns the loader that
      // streams the play wave, and a stopped scene's loader dies with it. It
      // draws nothing now, so hiding it costs the renderer one less pass.
      this.scene.setVisible(false);
      this.streamPlayWave(playWave);
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
