import Phaser from 'phaser';
import type { GameContext } from '../core/Context';
import {
  ANIMATED_TILE_NAMES,
  COLLECTIBLE_REWARD,
  DECOR_SCALE,
  DEPTHS,
  DRAG,
  DRAGON_ANIM,
  DRAGON_RIG_SCALE,
  ITEM_SCALE,
  EMBER_MOTES,
  GAME_WIDTH,
  LIVE_GAME_HEIGHT,
  num,
  PALETTE,
  SCENES,
  skipEnergyCost,
  skipWarmthCost,
  TAP_MAX_DISTANCE_PX,
  TAP_MAX_MS,
  TILE_H,
  TILE_W,
  TIMINGS
} from '../core/Constants';
import { gridToWorld, setProjection, worldToGrid } from '../core/iso';
import { renderScale } from '../core/render-scale';
import type { BoardItemState, GeneratorConfig, ItemSnapshot, TilePos, TutorialAllow } from '../core/types';
import { BoardItem } from '../entities/BoardItem';
import { Crystal3D } from '../render/Crystal3D';
import { RigPlayer } from '../render/RigPlayer';
import type { RigDoc } from '../render/rigTypes';
import { hopTo, hoverBob, popIn, scalePulse } from '../ui/tweens';

/** A featured live-rigged dragon overlaying its (invisible) interactive host. */
interface LiveDragon {
  player: RigPlayer;
  host: BoardItem;
  shadow: Phaser.GameObjects.Image; // ground shadow scaled to the rig
  mode: 'hover' | 'idle';
  remainMs: number; // countdown until the next mode roll
  busy: boolean; // flying out to work a plant — pause idle rolls + further taps
}

/** Where the camera sits to frame a given Keeper level (world centre + zoom). */
interface CameraFrame {
  x: number;
  y: number;
  zoom: number;
}

/** Zero velocity AND acceleration at both ends — no perceptible start/stop. */
const smootherstep = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

const DRAGON_CHAIN = 'ember_dragon';
/** Chains whose generator tiers wear a live rig, and where to fetch each rig. */
const DRAGON_RIGS: Record<string, string> = {
  ember_dragon: 'sprites/characters/dragon/red-dragon/rig/dragon-red.rig.json',
  emerald: 'sprites/characters/dragon/emerald-dragon/rig/dragon-emerald.rig.json'
};

const FONT = 'Trebuchet MS, Verdana, sans-serif';

const NO_ALLOW: Required<TutorialAllow> = {
  drag: [],
  tapGenerators: false,
  ledger: false,
  deliver: false,
  fog: false,
  sell: false,
  dragonWork: false,
  marketplace: false
};

/**
 * Presentation of the isle: ground diamonds + cliff skirts, ash-fog over
 * locked regions, pooled BoardItems, drag/tap input (gated by the tutorial),
 * and every piece of merge/hatch/harvest/unlock juice. All game decisions
 * happen in systems — this scene only emits intents and reacts to events.
 */
export class BoardScene extends Phaser.Scene {
  private ctx!: GameContext;
  private itemSprites = new Map<number, BoardItem>();
  private pool: BoardItem[] = [];
  private tiles = new Map<string, Phaser.GameObjects.Image>();
  private fog = new Map<string, Phaser.GameObjects.Image>();
  /** Floating "skip cooldown" button + the generator it belongs to. */
  private skipButton?: Phaser.GameObjects.Container;
  private skipGoldLabel?: Phaser.GameObjects.Text;
  private skipWarmthLabel?: Phaser.GameObjects.Text;
  private skipForId = 0;
  private skipMaxGold?: number; // per-generator gold cap for the live skip price
  /** Dragon job menu (Work / Harvest) + the dragon it belongs to. */
  private dragonMenu?: Phaser.GameObjects.Container;
  private dragonMenuLabel?: Phaser.GameObjects.Text;
  private dragonMenuForId = 0;
  /** Home position a working dragon flies back to when it tires. */
  private dragonHomes = new Map<number, { x: number; y: number }>();
  /** Styled "Zzz" fatigue badge (Container) over a resting dragon. */
  private restBadges = new Map<number, Phaser.GameObjects.Container>();
  /** One floating key badge per key-locked region, so it reads as "needs a key". */
  private keyBadges = new Map<string, Phaser.GameObjects.Image>();
  private highlights: Phaser.GameObjects.Image[] = [];
  private allow: Required<TutorialAllow> = { ...NO_ALLOW };
  private tutorialDone = false;
  private dragFrom: TilePos | null = null;
  /** Live drag: the lifted sprite eases toward this pointer-tracked target. */
  private dragSprite: BoardItem | null = null;
  private dragTarget = { x: 0, y: 0 };
  private dragCell!: Phaser.GameObjects.Graphics;
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private shells!: Phaser.GameObjects.Particles.ParticleEmitter;
  private offBus: (() => void)[] = [];
  private regenAccum = 0;
  private coolAccum = 0;
  /** The ember-dragon rig, loaded once and reused for every hatchling/whelp. */
  private dragonRigs = new Map<string, RigDoc>();
  private liveDragons = new Map<number, LiveDragon>();
  /** Dragon item ids currently flying a cosmetic worker flourish. */
  private busyDragons = new Set<number>();
  /** Per-level camera framing + the active level-up glide. */
  private levelFrames = new Map<number, CameraFrame>();
  private flyTween?: Phaser.Tweens.Tween;
  private panFrom: { px: number; py: number; sx: number; sy: number } | null = null;
  /** Live Three.js emerald crystal driving the `item_crystal_1` texture (the
   *  Theme-Crystal generator's look) + any authored 3D-decor placement. */
  private crystal3d?: Crystal3D;
  private crystalTex?: Phaser.Textures.CanvasTexture;
  /** Lowest zoom the wheel/flights allow — raised so the camera can never show
   *  past the authored background image (the world border). */
  private minZoom = 0.2;

  constructor() {
    super(SCENES.board);
  }

  create(): void {
    this.ctx = this.registry.get('ctx') as GameContext;
    setProjection(this.ctx.data.map.tile); // adopt the world's authored grid perspective
    this.itemSprites.clear();
    this.pool = [];
    this.tiles.clear();
    this.fog.clear();
    this.keyBadges.clear();
    this.skipButton = undefined; // a fresh scene; old container died with the last
    this.skipForId = 0;
    this.dragonMenu = undefined;
    this.dragonMenuForId = 0;
    this.dragonHomes.clear();
    this.restBadges.clear();
    this.highlights = [];
    this.allow = { ...NO_ALLOW };
    this.tutorialDone = this.ctx.state.tutorialDone;
    this.liveDragons.clear();
    this.busyDragons.clear();
    void this.loadDragonRigs(); // lazy + fault-tolerant; ready well before the hatch

    this.ensureShadowTexture(); // soft radial shadow used by every object
    this.ensureCrystal3D(); // live 3D emerald → item_crystal_1 (before items build)
    this.buildSky();
    this.buildBackground(); // authored backdrop, below the floor (shows through invisible tiles)
    this.buildGround();
    this.buildMapDecor();
    this.buildMapDecor3d(); // authored Three.js 3D-decor placements
    this.buildFog();
    this.buildKeyBadges();
    this.buildEmitters();
    this.buildDragCell();
    this.wireInput();
    this.subscribe();
    this.setupCamera();

    this.cameras.main.fadeIn(320, 36, 27, 34);
    this.scene.launch(SCENES.ui);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.offBus.forEach((off) => off());
      this.offBus = [];
      for (const ld of this.liveDragons.values()) ld.player.destroy();
      this.liveDragons.clear();
      this.crystal3d?.dispose();
      this.crystal3d = undefined;
      this.crystalTex = undefined;
    });
  }

  override update(time: number, delta: number): void {
    for (const sprite of this.itemSprites.values()) sprite.applyBob(time);
    if (this.crystal3d && this.crystalTex) {
      this.crystal3d.update(time); // spin + render the live emerald
      this.crystalTex.refresh(); // re-upload to the GPU for this frame
    }
    this.updateDrag(delta);
    this.updateLiveDragons(delta);

    this.coolAccum += delta;
    if (this.coolAccum >= 240) {
      this.coolAccum = 0;
      if (this.dragonMenu) this.refreshDragonMenu(); // live rest/ruby countdown
      for (const [id, badge] of this.restBadges) {
        const sp = this.itemSprites.get(id);
        const rest = this.ctx.systems.jobs.restRemaining(id);
        if (!sp || rest <= 0) {
          badge.destroy();
          this.restBadges.delete(id);
          continue;
        }
        const s = Math.ceil(rest / 1000);
        badge.setPosition(sp.x, sp.y - 160);
        (badge.getData('label') as Phaser.GameObjects.Text).setText(
          `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
        );
      }
      for (const sprite of this.itemSprites.values()) {
        if (!sprite.isGenerator) continue;
        if (DRAGON_RIGS[sprite.chain]) continue; // dragons never show the timer pill
        const item = this.ctx.state.items.get(sprite.itemId);
        if (!item) continue;
        const timer = this.genTimer(item);
        sprite.setCooling(timer !== null);
        if (timer) {
          sprite.setCooldownRemaining(timer.remaining);
          if (this.skipForId === sprite.itemId) this.updateSkipCost(timer.remaining, timer.total);
        } else if (this.skipForId === sprite.itemId) {
          this.hideSkipButton(); // became ready
        }
      }
    }

    this.regenAccum += delta;
    if (this.regenAccum >= 500) {
      // Pass the REAL elapsed ms (not 0): regen/passive read the clock, but the
      // dragon-job speed-up advances House timers by this delta per worker.
      const elapsed = Math.round(this.regenAccum);
      this.regenAccum = 0;
      this.ctx.bus.emit('time:advanced', { ms: elapsed });
    }
  }

  /* ------------------------- live rigged dragons ------------------------- */

  /** True if this item is a dragon generator that should wear a live rig
   *  (ember hatchling/whelp, emerald dragon). */
  private wearsRig(chain: string, isGenerator: boolean): boolean {
    return DRAGON_RIGS[chain] !== undefined && isGenerator;
  }

  /** Same test from a chain+tier (a snapshot before its sprite is acquired). */
  private wearsRigTier(chain: string, tier: number): boolean {
    return DRAGON_RIGS[chain] !== undefined && this.generatorConfigFor(chain, tier) !== undefined;
  }

  /** Fetch + load every dragon rig once. Any failure leaves that dragon as the
   *  pooled placeholder sprite (graceful: the board still works). */
  private async loadDragonRigs(): Promise<void> {
    const base = (import.meta.env.BASE_URL ?? './').replace(/\/?$/, '/');
    for (const [chain, url] of Object.entries(DRAGON_RIGS)) {
      if (this.dragonRigs.has(chain)) continue;
      try {
        const res = await fetch(base + url);
        if (!res.ok || !this.scene.isActive()) continue;
        const rig = (await res.json()) as RigDoc;
        if (rig.format !== 'emberkeep-rig' || !rig.images || !this.scene.isActive()) continue;
        await RigPlayer.loadTextures(this, rig, (layer) => `rig:${rig.character}:${layer}`);
        if (!this.scene.isActive()) continue;
        this.dragonRigs.set(chain, rig);
        // Re-skin any dragons of this chain that spawned before the rig loaded.
        for (const sprite of this.itemSprites.values()) {
          if (sprite.chain === chain && this.wearsRig(sprite.chain, sprite.isGenerator) && !this.liveDragons.has(sprite.itemId)) {
            this.attachDragon(sprite, false);
          }
        }
      } catch {
        /* no rig available — pooled sprite stays */
      }
    }
  }

  /** Mirror the source art (faces LEFT) to face RIGHT and mount it over `host`,
   *  which goes invisible but stays interactive/draggable. Returns false if the
   *  rig isn't ready yet (caller falls back to the sprite). */
  private attachDragon(host: BoardItem, intro: boolean): boolean {
    const rig = this.dragonRigs.get(host.chain);
    if (!rig) return false;
    this.removeDragonRig(host.itemId);
    const scale =
      (host.tier >= 3 ? DRAGON_ANIM.whelpScale : DRAGON_ANIM.hatchlingScale) *
      (DRAGON_RIG_SCALE[host.chain] ?? 1);
    const player = new RigPlayer(this, rig, (layer) => `rig:${rig.character}:${layer}`, { scale });
    player.setFacing('left').play(intro ? 'hover' : 'idle'); // rig's original (un-mirrored) orientation
    host.setArtVisible(false); // host is now just the invisible hit-target + bob anchor
    // Ground shadow proportional to the rig (666px pieces × scale).
    const shadow = this.addGroundShadow(host.x, host.y, 666 * scale, host.depth - 0.5);
    const ld: LiveDragon = {
      player,
      host,
      shadow,
      mode: intro ? 'hover' : 'idle',
      remainMs: intro ? DRAGON_ANIM.introCelebrateMs : this.idleSpanMs(),
      busy: false
    };
    this.liveDragons.set(host.itemId, ld);
    this.syncDragon(ld);
    if (intro) {
      player.container.setAlpha(0);
      this.tweens.add({
        targets: player.container,
        alpha: 1,
        duration: DRAGON_ANIM.fadeInMs,
        ease: 'Sine.easeOut'
      });
    }
    return true;
  }

  private idleSpanMs(): number {
    return DRAGON_ANIM.idleMinMs + Math.random() * (DRAGON_ANIM.idleMaxMs - DRAGON_ANIM.idleMinMs);
  }

  /** Keep the rig glued to its (possibly bobbing/dragged) host + advance anim. */
  private syncDragon(ld: LiveDragon): void {
    ld.player.container.setPosition(ld.host.x, ld.host.y - DRAGON_ANIM.groundLift);
    ld.player.container.setDepth(ld.host.depth + 0.5);
    ld.shadow.setPosition(ld.host.x, ld.host.y).setDepth(ld.host.depth - 0.5);
  }

  private updateLiveDragons(delta: number): void {
    for (const ld of this.liveDragons.values()) {
      this.syncDragon(ld);
      ld.player.update(delta);
      if (ld.busy) continue; // flying/working: hold its current animation
      ld.remainMs -= delta;
      if (ld.remainMs > 0) continue;
      // Roll the next segment: mostly idle (~90% of the time), the rest a burst.
      if (ld.mode === 'idle' && Math.random() < DRAGON_ANIM.celebrateChance) {
        ld.mode = 'hover';
        ld.remainMs = DRAGON_ANIM.celebrateMs;
        ld.player.play('hover');
      } else {
        ld.mode = 'idle';
        ld.remainMs = this.idleSpanMs();
        ld.player.play('idle');
      }
    }
  }

  private removeDragonRig(itemId: number): void {
    const ld = this.liveDragons.get(itemId);
    if (!ld) return;
    ld.player.destroy();
    ld.shadow.destroy();
    this.liveDragons.delete(itemId);
  }

  /* ------------------------------ camera ------------------------------ */

  /**
   * The board is far larger than the screen, so the camera frames one Keeper
   * level at a time. On reaching a new level it glides — the world-builder's
   * extra-smooth smootherstep + gentle mid-dolly — to that zone's authored
   * focal point, the same move previewed in the camera-keyframe tool.
   */
  private setupCamera(): void {
    const map = this.ctx.data.map;
    const focusByLevel = new Map<number, { col: number; row: number }>();
    for (const kf of map.cameraKeyframes ?? []) {
      if (kf.focus) focusByLevel.set(kf.level, kf.focus);
    }
    // Tiles that belong to each level's view. The key-gated tutorial gate sits
    // right at the start clearing, so it frames with L1 (not its level-2 tag).
    const tilesByLevel = new Map<number, [number, number][]>();
    for (const region of map.regions) {
      const lvl = region.id === 'level_1' ? 1 : region.unlock?.keys ? 1 : region.unlock?.level ?? 1;
      const list = tilesByLevel.get(lvl) ?? [];
      list.push(...region.tiles);
      tilesByLevel.set(lvl, list);
    }
    for (const [lvl, tiles] of tilesByLevel) {
      this.levelFrames.set(lvl, this.computeFrame(tiles, focusByLevel.get(lvl)));
    }

    const cam = this.cameras.main;
    // Camera frontier — the authored BACKGROUND IMAGE is the world's border: the
    // camera roams ONLY inside it (pan + zoom), so no void is ever visible. Bound
    // to the image's exact world rect, and raise the minimum zoom to the image-fit
    // so the viewport can never grow past it (zoom-out stops at the full image).
    const bgRect = this.backgroundWorldRect();
    const zoomCfg = this.ctx.data.map.cameraZoom ?? { min: 0.2, max: 1.4 };
    if (bgRect) {
      cam.setBounds(bgRect.x, bgRect.y, bgRect.w, bgRect.h);
      const fitZoom = Math.max(GAME_WIDTH / bgRect.w, LIVE_GAME_HEIGHT / bgRect.h);
      this.minZoom = Math.max(zoomCfg.min, fitZoom);
    } else {
      // Fallback (no backdrop): hold to the playable extent, the old behaviour.
      this.minZoom = zoomCfg.min;
      const cells = map.playable ?? [];
      if (cells.length) {
        let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
        for (const [c, r] of cells) { minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r); }
        const pts = [[minC, minR], [maxC, minR], [minC, maxR], [maxC, maxR]].map(([c, r]) => gridToWorld(c, r));
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
        const x0 = Math.min(...xs) - TILE_W, y0 = Math.min(...ys) - TILE_H * 2;
        cam.setBounds(x0, y0, Math.max(...xs) - Math.min(...xs) + TILE_W * 2, Math.max(...ys) - Math.min(...ys) + TILE_H * 3);
      }
    }
    const frame = this.frameForLevel(this.ctx.state.level);
    // World framing stays logical (R cancels in world space); only the actual zoom
    // is ×renderScale so the same view renders into the larger hi-DPI backing.
    cam.setZoom(Math.max(frame.zoom, this.minZoom) * renderScale.value);
    cam.centerOn(frame.x, frame.y);

    this.offBus.push(
      this.ctx.bus.on('keeper:leveled', ({ level }) => this.flyToLevel(level))
    );
  }

  /** World centre + zoom that frames `tiles` around the focal cell. */
  private computeFrame(
    tiles: [number, number][],
    focus?: { col: number; row: number }
  ): CameraFrame {
    const center = focus
      ? gridToWorld(focus.col, focus.row)
      : (() => {
          let sx = 0, sy = 0;
          for (const [c, r] of tiles) {
            const w = gridToWorld(c, r);
            sx += w.x;
            sy += w.y;
          }
          return { x: sx / Math.max(1, tiles.length), y: sy / Math.max(1, tiles.length) };
        })();
    // Use a high percentile of the spread, not the max, so a couple of stray
    // authored cells can't blow the frame out to show the whole board.
    const dxs: number[] = [];
    const dys: number[] = [];
    for (const [c, r] of tiles) {
      const w = gridToWorld(c, r);
      dxs.push(Math.abs(w.x - center.x));
      dys.push(Math.abs(w.y - center.y));
    }
    dxs.sort((a, b) => a - b);
    dys.sort((a, b) => a - b);
    // CLOSER framing: the board sat too far back. Frame the DENSE CORE around the
    // focal cell (lower percentile = ignore the sparse outer cells) and pull in,
    // so the start cluster fills the view. The focal cell stays centred; pan/
    // wheel still reach the rest of the zone.
    const pct = (arr: number[]): number => arr[Math.floor(0.7 * (arr.length - 1))] ?? 0;
    const halfW = Math.max(TILE_W, pct(dxs) + TILE_W / 2);
    const halfH = Math.max(TILE_H, pct(dys) + TILE_H);
    const pad = 110;
    // The ceiling was 2.0 and the dense-core frame kept hitting it, so earlier
    // multiplier tweaks did nothing. Lower ceiling = a real zoom-out: the start
    // area fills the view comfortably without being right on top of it.
    const zoom = Phaser.Math.Clamp(
      Math.min((GAME_WIDTH / 2 - pad) / halfW, (LIVE_GAME_HEIGHT / 2 - pad) / halfH) * 1.15,
      0.45,
      1.05
    );
    return { x: center.x, y: center.y, zoom };
  }

  private frameForLevel(level: number): CameraFrame {
    for (let l = level; l >= 1; l--) {
      const f = this.levelFrames.get(l);
      if (f) return f;
    }
    return this.levelFrames.get(1) ?? { x: GAME_WIDTH / 2, y: LIVE_GAME_HEIGHT / 2, zoom: 0.5 };
  }

  private flyToLevel(level: number): void {
    // Never yank the camera away mid-onboarding — the tutorial's scripted taps
    // all live in the L1 zone. Zones still unlock; the view just stays put.
    if (!this.tutorialDone) return;
    const target = this.frameForLevel(level);
    // actual (×renderScale) zoom space — cam.zoom below is already scaled.
    const targetZoom = Math.max(target.zoom, this.minZoom) * renderScale.value; // stay inside the image
    const cam = this.cameras.main;
    const from = { x: cam.midPoint.x, y: cam.midPoint.y, zoom: cam.zoom };
    this.flyTween?.stop();
    const proxy = { t: 0 };
    this.flyTween = this.tweens.add({
      targets: proxy,
      t: 1,
      duration: 1500,
      ease: 'Linear',
      onUpdate: () => {
        const s = smootherstep(proxy.t);
        const x = Phaser.Math.Linear(from.x, target.x, s);
        const y = Phaser.Math.Linear(from.y, target.y, s);
        // Gentle mid-flight dolly-out for a premium, cinematic glide — but never
        // below the image-fit zoom, or the dip would flash the void.
        const z = Phaser.Math.Linear(from.zoom, targetZoom, s) * (1 - 0.08 * Math.sin(Math.PI * proxy.t));
        cam.setZoom(Math.max(z, this.minZoom * renderScale.value));
        cam.centerOn(x, y);
      }
    });
  }

  /* ----------------------------- build ------------------------------ */

  private buildSky(): void {
    // The board paints NO backdrop: the canvas is transparent (GameConfig) and
    // the water photo is a CSS background on #game (index.html). The isle floats
    // over it — cheaper than a full-viewport GPU texture and rock-solid.

    // Warm sun haze, upper-left.
    this.add
      .image(GAME_WIDTH * 0.3, 130, 'fx_glow')
      .setScale(7, 4.4)
      .setTint(num(PALETTE.goldAccent))
      .setAlpha(0.16)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScrollFactor(0)
      .setDepth(DEPTHS.sky + 1);

    // Occasional twinkles in the sky.
    this.time.addEvent({
      delay: 1700,
      loop: true,
      callback: () => {
        const star = this.add
          .image(
            Phaser.Math.Between(80, GAME_WIDTH - 80),
            Phaser.Math.Between(60, LIVE_GAME_HEIGHT * 0.45),
            'fx_spark'
          )
          .setScale(0.1)
          .setAlpha(0)
          .setScrollFactor(0)
          .setDepth(DEPTHS.sky + 4);
        this.tweens.add({
          targets: star,
          alpha: 0.85,
          scale: Phaser.Math.FloatBetween(0.5, 1),
          angle: 45,
          duration: 420,
          yoyo: true,
          ease: 'Sine.easeInOut',
          onComplete: () => star.destroy()
        });
      }
    });
  }

  /** The art key + placement for a playable cell, from the authored world. */
  private tileArtKey(col: number, row: number): string {
    const name = this.ctx.data.map.tilesByCell?.[`${col},${row}`];
    if (!name) return 'tile_moss';
    // Authored flower tiles ship as `tile_<artName>`; legacy border-grass-N
    // falls back to grass_N, then to plain moss.
    if (this.textures.exists(`tile_${name}`)) return `tile_${name}`;
    const n = Number(name.split('-').pop());
    return Number.isFinite(n) ? `grass_${n}` : 'tile_moss';
  }

  /**
   * The authored isle: every playable cell wears its hand-placed border-grass
   * tile (real art + per-asset calibration), y-sorted so the 3D grass edges
   * overlap correctly. Cells absent from `playable` are void — open sky — which
   * IS the isle silhouette. Fogged zones still get their grass here; it simply
   * sits hidden under the cloud until the zone wakes.
   */
  private buildGround(): void {
    const map = this.ctx.data.map;
    const ratio = TILE_W / (map.tile?.width ?? TILE_W); // authored 240 → game 256
    const invisible = new Set((map.invisible ?? []).map(([c, r]) => `${c},${r}`));
    for (const [col, row] of map.playable ?? []) {
      if (invisible.has(`${col},${row}`)) continue; // playable cell, no art — background shows through
      const { x, y } = gridToWorld(col, row);
      const artName = map.tilesByCell?.[`${col},${row}`];
      const cal = (artName && map.calibration?.[artName]) || {
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        anchor: { x: 0.5, y: 0.26 }
      };
      const tileY = y + cal.offsetY * ratio;
      const tile = this.add
        .image(x + cal.offsetX * ratio, tileY, this.tileArtKey(col, row))
        .setOrigin(cal.anchor.x, cal.anchor.y)
        .setScale(cal.scale * ratio)
        // y-sorted within the floor band, always below items (itemBase=100).
        .setDepth(DEPTHS.tiles + y * 0.001);
      this.tiles.set(`${col},${row}`, tile);
      // Trees authored as floor tiles spring-bounce like decor (15% faster).
      if (artName && ANIMATED_TILE_NAMES.includes(artName)) {
        this.settleSprite(tile, ((col + row) % 8) * 35);
      }
    }
  }

  /**
   * Authored backdrop (`map.backgrounds`, the world-builder's `background` tab):
   * a painted scene that sits BELOW the floor so invisible tiles reveal it. Laid
   * EXACTLY per the world JSON — cell + free-move dx/dy + calibration scale/anchor
   * (only the grid-unit ratio is applied, as for all decor) — and scrolls with the
   * camera as part of the world. Skipped cleanly if the art isn't present.
   */
  private buildBackground(): void {
    const map = this.ctx.data.map;
    if (!map.backgrounds?.length) return;
    const ratio = TILE_W / (map.tile?.width ?? TILE_W);
    for (const b of map.backgrounds) {
      const key = `background_${b.name}`;
      if (!this.textures.exists(key)) continue;
      const { x, y } = gridToWorld(b.col, b.row);
      const cal = map.backgroundCalibration?.[b.name] ?? {
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        anchor: { x: 0.5, y: 0.5 }
      };
      this.add
        .image(x + (cal.offsetX + (b.dx ?? 0)) * ratio, y + (cal.offsetY + (b.dy ?? 0)) * ratio, key)
        .setOrigin(cal.anchor?.x ?? 0.5, cal.anchor?.y ?? 0.5)
        .setScale((cal.scale ?? 1) * ratio)
        .setDepth(DEPTHS.tiles - 1); // below the floor tiles, above the sky FX
    }
  }

  /**
   * World-space rect of the FIRST authored backdrop image — placed exactly as
   * buildBackground draws it (cell + free-move + calibration) — or null if there's
   * no background art. The camera frontier is held to this so the image is the
   * world's border and nothing beyond it is ever shown.
   */
  private backgroundWorldRect(): { x: number; y: number; w: number; h: number } | null {
    const map = this.ctx.data.map;
    const b = map.backgrounds?.[0];
    if (!b) return null;
    const key = `background_${b.name}`;
    if (!this.textures.exists(key)) return null;
    const src = this.textures.get(key).getSourceImage() as HTMLImageElement;
    const ratio = TILE_W / (map.tile?.width ?? TILE_W);
    const cal = map.backgroundCalibration?.[b.name] ?? {
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      anchor: { x: 0.5, y: 0.5 }
    };
    const { x, y } = gridToWorld(b.col, b.row);
    const cx = x + (cal.offsetX + (b.dx ?? 0)) * ratio;
    const cy = y + (cal.offsetY + (b.dy ?? 0)) * ratio;
    const scale = (cal.scale ?? 1) * ratio;
    const w = src.width * scale;
    const h = src.height * scale;
    return { x: cx - w * (cal.anchor?.x ?? 0.5), y: cy - h * (cal.anchor?.y ?? 0.5), w, h };
  }

  /**
   * Static authored scenery (world-builder `decor` placements): huts, crystals,
   * landmarks. Painted like tiles — part of the MAP, not save state — so a
   * re-imported world refreshes the scene for everyone. Each uses its per-asset
   * calibration (offset/scale/anchor) and y-sorts in the item band so closer
   * scenery occludes farther; a piece on a fogged cell hides under the cloud
   * until that zone wakes (fog sits at +2 above this band).
   */
  private buildMapDecor(): void {
    const map = this.ctx.data.map;
    if (!map.mapDecor?.length) return;
    const ratio = TILE_W / (map.tile?.width ?? TILE_W);
    map.mapDecor.forEach((d, i) => {
      const key = `decor_${d.name}`;
      if (!this.textures.exists(key)) return; // art not extracted yet — skip cleanly
      const { x, y } = gridToWorld(d.col, d.row);
      const cal = map.decorCalibration?.[d.name] ?? {
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        anchor: { x: 0.5, y: 0 }
      };
      const baseY = y + (cal.offsetY + (d.dy ?? 0)) * ratio; // + free-move offset (Move tool)
      const sprite = this.add
        .image(x + (cal.offsetX + (d.dx ?? 0)) * ratio, baseY, key)
        .setOrigin(cal.anchor.x, cal.anchor.y)
        .setScale(cal.scale * ratio * (DECOR_SCALE[d.name] ?? 1))
        .setDepth(DEPTHS.itemBase + y);
      // Ground shadow sized to the art, on the cell so the spring lifts off it.
      this.addGroundShadow(x, y, sprite.displayWidth, DEPTHS.itemBase + y - 1);
      // Slow spring-bounce (not a smooth float): lazy spring, staggered, calm.
      this.settleSprite(sprite, (i % 8) * 35); // one-time landing settle
    });
  }

  /**
   * Build the live Three.js emerald crystal ONCE and graft it over the
   * `item_crystal_1` texture, so the Theme-Crystal generator (and every authored
   * 3D-decor placement) shows the spinning cel-shaded gem instead of the flat
   * PNG — same key, so the generator's anchor/scale/gameplay are untouched. The
   * spec comes from the world's `decor3d` (the world-builder's `model3d`), or a
   * default emerald. WebGL-less contexts keep the PNG (the try/catch falls back).
   */
  private ensureCrystal3D(): void {
    const map = this.ctx.data.map;
    const spec = map.decor3d?.find((d) => d.model3d)?.model3d ?? undefined;
    try {
      const crystal = new Crystal3D(spec ?? {});
      if (this.textures.exists('item_crystal_1')) this.textures.remove('item_crystal_1');
      this.crystalTex = this.textures.addCanvas('item_crystal_1', crystal.canvas) ?? undefined;
      if (!this.crystalTex) {
        crystal.dispose();
        return;
      }
      this.crystal3d = crystal;
    } catch (err) {
      console.warn('[Crystal3D] WebGL unavailable — keeping the 2D crystal art.', err);
    }
  }

  /**
   * Authored Three.js 3D-decor (`map.decor3d`, the world-builder's `3d` tab):
   * static scenery that wears the SAME live crystal texture as the generator.
   * Mirrors buildMapDecor — per-asset calibration + free-move dx/dy, y-sorted in
   * the item band, with a ground shadow. Skipped if the live texture never came
   * up (WebGL-less); the gem only shows where the world placed it.
   */
  private buildMapDecor3d(): void {
    const map = this.ctx.data.map;
    if (!map.decor3d?.length || !this.crystal3d || !this.textures.exists('item_crystal_1')) return;
    // The crystal GENERATOR already stands on the authored 3D-crystal spot (see
    // build-gamemap), so skip the scenery copy there — exactly ONE crystal renders.
    const genCells = new Set(
      (map.startingItems ?? [])
        .filter((i) => i.chain === 'crystal')
        .map((i) => `${i.at[0]},${i.at[1]}`)
    );
    const ratio = TILE_W / (map.tile?.width ?? TILE_W);
    map.decor3d.forEach((d, i) => {
      if (genCells.has(`${d.col},${d.row}`)) return; // generator covers this placement
      const { x, y } = gridToWorld(d.col, d.row);
      const cal = map.decor3dCalibration?.[d.name] ?? {
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        anchor: { x: 0.5, y: 0.72 }
      };
      const baseY = y + (cal.offsetY + (d.dy ?? 0)) * ratio;
      const sprite = this.add
        .image(x + (cal.offsetX + (d.dx ?? 0)) * ratio, baseY, 'item_crystal_1')
        .setOrigin(cal.anchor?.x ?? 0.5, cal.anchor?.y ?? 0.72)
        .setScale((cal.scale ?? 1) * ratio)
        .setDepth(DEPTHS.itemBase + y);
      this.addGroundShadow(x, y, sprite.displayWidth, DEPTHS.itemBase + y - 1);
      this.settleSprite(sprite, (i % 8) * 35); // one-time landing settle
    });
  }

  private buildFog(): void {
    for (const region of this.ctx.data.map.regions) {
      if (this.ctx.state.regionStatus.get(region.id) === 'active') continue;
      for (const [col, row] of region.tiles) {
        this.createFogSprite(region.id, col, row);
      }
    }
  }

  /**
   * Float a Bronze Key over each key-locked region so the player reads "spend a
   * key here". Sits above the cloud band at the region centroid; lifts away when
   * the region unlocks (see onRegionUnlocked).
   */
  private buildKeyBadges(): void {
    for (const region of this.ctx.data.map.regions) {
      if (this.ctx.state.regionStatus.get(region.id) === 'active') continue;
      if (!region.unlock?.keys) continue;
      const { x, y } = this.regionCentroid(region.tiles.map(([col, row]) => ({ col, row })));
      const badge = this.add
        .image(x, y - 64, 'icon_key_bronze')
        .setScale(1.2)
        .setDepth(DEPTHS.itemBase + y + 1000) // above this region's cloud band
        .setAlpha(this.tutorialDone ? 1 : 0); // hidden until key_unlock step
      hoverBob(this, badge, 10, 520);
      this.keyBadges.set(region.id, badge);
    }
  }

  private createFogSprite(regionId: string, col: number, row: number): void {
    const { x, y } = gridToWorld(col, row);
    // The real authored level-blocker cloud (the same tile the world builder
    // paints), placed uniformly on the grid so neighbours overlap into one
    // seamless blanket. Anchor 0.5/0.62 puffs it up over the tile.
    const puff = this.add
      .image(x, y, 'cloud_tile')
      .setOrigin(0.5, 0.62)
      .setDepth(DEPTHS.itemBase + y + 2)
      .setAlpha(0.995);
    puff.setData('regionId', regionId);
    // Hit area = just this tile's diamond, not the whole puffy frame —
    // otherwise the smoke drapes over (and steals input from) the active
    // tiles one row south. Hit-area coords are frame-local (origin-shifted).
    const ox = puff.displayOriginX;
    const oy = puff.displayOriginY;
    const diamond = new Phaser.Geom.Polygon([
      new Phaser.Geom.Point(ox, oy - TILE_H / 2),
      new Phaser.Geom.Point(ox + TILE_W / 2, oy),
      new Phaser.Geom.Point(ox, oy + TILE_H / 2),
      new Phaser.Geom.Point(ox - TILE_W / 2, oy)
    ]);
    puff.setInteractive({
      hitArea: diamond,
      hitAreaCallback: Phaser.Geom.Polygon.Contains,
      useHandCursor: true
    });
    puff.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!this.isTap(pointer)) return;
      this.onFogTapped(regionId, col, row);
    });
    // Slow rolling breath across the bank, phased by iso row.
    this.tweens.add({
      targets: puff,
      alpha: 0.9,
      scaleX: 1.02,
      scaleY: 1.035,
      duration: TIMINGS.fogPulsePeriodMs / 2,
      delay: ((col + row) % 6) * 230,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
    this.fog.set(`${col},${row}`, puff);
  }

  private buildEmitters(): void {
    this.burst = this.add
      .particles(0, 0, 'fx_ember', {
        speed: { min: 140, max: 420 },
        angle: { min: 0, max: 360 },
        gravityY: 460,
        lifespan: { min: 380, max: 680 },
        scale: { start: 0.95, end: 0 },
        alpha: { start: 1, end: 0 },
        blendMode: Phaser.BlendModes.ADD,
        emitting: false
      })
      .setDepth(DEPTHS.particles);
    this.sparks = this.add
      .particles(0, 0, 'fx_spark', {
        speed: { min: 220, max: 560 },
        angle: { min: 0, max: 360 },
        gravityY: 640,
        rotate: { min: 0, max: 360 },
        lifespan: { min: 500, max: 820 },
        scale: { start: 0.85, end: 0.1 },
        alpha: { start: 1, end: 0 },
        emitting: false
      })
      .setDepth(DEPTHS.particles);
    this.shells = this.add
      .particles(0, 0, 'fx_shell', {
        speed: { min: 180, max: 400 },
        angle: { min: 200, max: 340 },
        gravityY: 860,
        rotate: { min: 0, max: 360 },
        lifespan: { min: 550, max: 850 },
        scale: { start: 0.95, end: 0.45 },
        alpha: { start: 1, end: 0.2 },
        emitting: false
      })
      .setDepth(DEPTHS.particles);

    // Ambient ember motes, behind and in front of the isle.
    this.add
      .particles(0, 0, 'fx_ember', {
        x: { min: 80, max: GAME_WIDTH - 80 },
        y: { min: 1240, max: 1520 },
        speedY: { min: EMBER_MOTES.maxSpeedY, max: EMBER_MOTES.minSpeedY },
        speedX: { min: -EMBER_MOTES.driftX, max: EMBER_MOTES.driftX },
        lifespan: EMBER_MOTES.lifespanMs,
        scale: { start: EMBER_MOTES.minScale, end: 0 },
        alpha: { start: EMBER_MOTES.alpha * 0.8, end: 0 },
        frequency: 720,
        blendMode: Phaser.BlendModes.ADD
      })
      .setDepth(DEPTHS.cliffs + 1);
    this.add
      .particles(0, 0, 'fx_ember', {
        x: { min: 60, max: GAME_WIDTH - 60 },
        y: { min: 1400, max: 1580 },
        speedY: { min: -64, max: -36 },
        speedX: { min: -20, max: 20 },
        lifespan: EMBER_MOTES.lifespanMs,
        scale: { start: EMBER_MOTES.maxScale, end: 0 },
        alpha: { start: EMBER_MOTES.alpha * 0.55, end: 0 },
        frequency: 1500,
        blendMode: Phaser.BlendModes.ADD
      })
      .setDepth(DEPTHS.particles);
  }

  /** The iso-diamond that lights up the cell a dragged item is hovering over. */
  private buildDragCell(): void {
    const g = this.add.graphics().setDepth(DEPTHS.tileHighlight).setVisible(false);
    g.fillStyle(DRAG.cellHighlightColor, DRAG.cellHighlightAlpha);
    g.lineStyle(3, DRAG.cellHighlightColor, Math.min(1, DRAG.cellHighlightAlpha + 0.3));
    const pts = [0, -TILE_H / 2, TILE_W / 2, 0, 0, TILE_H / 2, -TILE_W / 2, 0];
    g.fillPoints(this.diamond(pts), true);
    g.strokePoints(this.diamond(pts), true);
    this.dragCell = g;
  }

  private diamond(flat: number[]): Phaser.Geom.Point[] {
    const pts: Phaser.Geom.Point[] = [];
    for (let i = 0; i < flat.length; i += 2) pts.push(new Phaser.Geom.Point(flat[i], flat[i + 1]));
    return pts;
  }

  /* ----------------------------- input ------------------------------ */

  private isTap(pointer: Phaser.Input.Pointer): boolean {
    return (
      pointer.getDistance() <= TAP_MAX_DISTANCE_PX + 2 && pointer.getDuration() <= TAP_MAX_MS
    );
  }

  private wireInput(): void {
    this.input.dragDistanceThreshold = TAP_MAX_DISTANCE_PX;
    this.wireCameraNav();

    this.input.on(
      Phaser.Input.Events.DRAG_START,
      (_pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
        if (!(obj instanceof BoardItem)) return;
        this.dragFrom = { col: obj.col, row: obj.row };
        obj.setData('dragged', true);
        obj.liftForDrag();
        // The sprite EASES toward this target in update() (Fairyland-style
        // weighted follow); seed it at the current pos so it doesn't jump.
        this.dragSprite = obj;
        this.dragTarget.x = obj.x;
        this.dragTarget.y = obj.y;
        this.dragCell.setVisible(true);
      }
    );
    this.input.on(
      Phaser.Input.Events.DRAG,
      (
        _pointer: Phaser.Input.Pointer,
        obj: Phaser.GameObjects.GameObject,
        dragX: number,
        dragY: number
      ) => {
        if (!(obj instanceof BoardItem)) return;
        this.dragTarget.x = dragX;
        this.dragTarget.y = dragY - 24;
      }
    );
    this.input.on(
      Phaser.Input.Events.DRAG_END,
      (pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
        if (!(obj instanceof BoardItem) || !this.dragFrom) return;
        this.dragSprite = null;
        this.dragCell.setVisible(false);
        const to = worldToGrid(pointer.worldX, pointer.worldY + 24);

        // Dragon dragged onto a passive generator (House) → start working directly.
        if (
          DRAGON_RIGS[obj.chain] &&
          (this.tutorialDone || this.allow.dragonWork) &&
          !this.ctx.systems.jobs.restRemaining(obj.itemId)
        ) {
          const tgt = [...this.itemSprites.values()].find(
            (s) => s.col === to.col && s.row === to.row && s.itemId !== obj.itemId
          );
          const tgtCfg = tgt ? this.generatorConfigFor(tgt.chain, tgt.tier) : null;
          if (tgt && tgtCfg?.tappable === false && !DRAGON_RIGS[tgt.chain]) {
            const home = gridToWorld(this.dragFrom.col, this.dragFrom.row);
            this.dragFrom = null;
            this.time.delayedCall(60, () => obj.setData('dragged', false));
            this.startDragonWork(obj, home);
            return;
          }
        }

        this.ctx.bus.emit('drag:dropped', {
          itemId: obj.itemId,
          from: this.dragFrom,
          to
        });
        this.dragFrom = null;
        this.time.delayedCall(60, () => obj.setData('dragged', false));
      }
    );
  }

  /** Exponential-smoothing follow + target-cell highlight for the live drag. */
  private updateDrag(delta: number): void {
    const s = this.dragSprite;
    if (!s) return;
    const k = 1 - Math.exp(-delta / DRAG.followTau);
    s.x += (this.dragTarget.x - s.x) * k;
    s.y += (this.dragTarget.y - s.y) * k;
    const cell = worldToGrid(this.dragTarget.x, this.dragTarget.y + 24);
    const { x, y } = gridToWorld(cell.col, cell.row);
    this.dragCell.setPosition(x, y);
  }

  /**
   * Drag empty ground to pan the big board; wheel to zoom. A pointer that lands
   * on an item or fog is left to the drag/tap handlers, so navigation never
   * fights gameplay.
   */
  private wireCameraNav(): void {
    const cam = this.cameras.main;
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      const hits = this.input.hitTestPointer(pointer);
      // Dismiss the skip button / dragon menu on any tap not on the popup itself.
      if (this.skipButton && !hits.some((o) => o === this.skipButton || o.parentContainer === this.skipButton)) {
        this.hideSkipButton();
      }
      if (this.dragonMenu && !hits.some((o) => o === this.dragonMenu || o.parentContainer === this.dragonMenu)) {
        this.hideDragonMenu();
      }
      const onObject = hits.some(
        (o) => o instanceof BoardItem || o.getData?.('regionId') !== undefined
      );
      if (onObject) return;
      this.flyTween?.stop();
      this.panFrom = { px: pointer.x, py: pointer.y, sx: cam.scrollX, sy: cam.scrollY };
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      if (!this.panFrom) return;
      cam.scrollX = this.panFrom.sx - (pointer.x - this.panFrom.px) / cam.zoom;
      cam.scrollY = this.panFrom.sy - (pointer.y - this.panFrom.py) / cam.zoom;
    });
    const endPan = (): void => {
      this.panFrom = null;
    };
    this.input.on(Phaser.Input.Events.POINTER_UP, endPan);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, endPan);
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
        this.flyTween?.stop();
        const z = this.ctx.data.map.cameraZoom ?? { min: 0.2, max: 1.4 }; // world-builder zoom lock
        // minZoom is raised to the background-image fit so you can't zoom out past it;
        // ×renderScale converts the logical bounds into the actual (scaled) zoom space.
        const r = renderScale.value;
        cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy < 0 ? 1.1 : 1 / 1.1), this.minZoom * r, z.max * r));
      }
    );
  }

  private canDrag(sprite: BoardItem): boolean {
    if (sprite.kind !== 'item') return false;
    if (this.tutorialDone) return true;
    return this.allow.drag.includes('*') || this.allow.drag.includes(sprite.chain);
  }

  private refreshDraggable(sprite: BoardItem): void {
    if (sprite.kind !== 'item') return;
    this.input.setDraggable(sprite, this.canDrag(sprite));
  }

  private refreshAllDraggable(): void {
    for (const sprite of this.itemSprites.values()) this.refreshDraggable(sprite);
  }

  /* ------------------------- sprite lifecycle ----------------------- */

  private textureFor(snap: ItemSnapshot): string {
    return snap.kind === 'decor' ? `decor_${snap.chain}` : `item_${snap.chain}_${snap.tier}`;
  }

  private generatorConfigFor(chain: string, tier: number): GeneratorConfig | undefined {
    return this.ctx.data.chains.chains
      .find((c) => c.id === chain)
      ?.tiers.find((t) => t.tier === tier)?.generator;
  }

  /** The live wait a generator is in — tap-cooldown or passive timer — for the
   *  countdown badge and the skip button. Null when it's ready/producing. */
  private genTimer(item: BoardItemState): { remaining: number; total: number } | null {
    const cfg = this.generatorConfigFor(item.chain, item.tier);
    if (!cfg) return null;
    const now = this.ctx.clock.now();
    if (item.readyAt !== undefined && now < item.readyAt) {
      return { remaining: item.readyAt - now, total: cfg.cooldownMs };
    }
    if (cfg.passiveMs && item.passiveAt !== undefined && now < item.passiveAt) {
      return { remaining: item.passiveAt - now, total: cfg.passiveMs };
    }
    return null;
  }

  /** Build the soft radial-gradient shadow texture once (a dark core fading to
   *  transparent → reads as a blurred, realistic ground shadow when squashed). */
  private ensureShadowTexture(): void {
    if (!this.textures.exists('fx_shadow')) {
      const S = 128;
      const tex = this.textures.createCanvas('fx_shadow', S, S);
      if (tex) {
        const ctx = tex.getContext();
        const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
        g.addColorStop(0, 'rgba(16,10,15,0.55)');
        g.addColorStop(0.5, 'rgba(16,10,15,0.3)');
        g.addColorStop(1, 'rgba(16,10,15,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);
        tex.refresh();
      }
    }
    // Warm plum pill behind the generator countdown (Emberkeep palette).
    if (!this.textures.exists('fx_timepill')) {
      const W = 168;
      const H = 60;
      const R = 30;
      const tex = this.textures.createCanvas('fx_timepill', W, H);
      if (tex) {
        const ctx = tex.getContext();
        const rr = (x: number, y: number, w: number, h: number, r: number): void => {
          ctx.beginPath();
          ctx.moveTo(x + r, y);
          ctx.arcTo(x + w, y, x + w, y + h, r);
          ctx.arcTo(x + w, y + h, x, y + h, r);
          ctx.arcTo(x, y + h, x, y, r);
          ctx.arcTo(x, y, x + w, y, r);
          ctx.closePath();
        };
        ctx.fillStyle = '#3A2B38'; // plumShade rim
        rr(0, 0, W, H, R);
        ctx.fill();
        ctx.strokeStyle = '#D9821F'; // goldShade border accent
        ctx.lineWidth = 3;
        rr(2, 2, W - 4, H - 4, R - 2);
        ctx.stroke();
        const g = ctx.createLinearGradient(0, 4, 0, H - 4);
        g.addColorStop(0, '#6A5468'); // plumHighlight
        g.addColorStop(1, '#4A3845'); // plum
        ctx.fillStyle = g;
        rr(5, 4, W - 10, H - 8, R - 4);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; // subtle top gloss
        rr(12, 8, W - 24, H * 0.4, R * 0.6);
        ctx.fill();
        tex.refresh();
      }
    }
  }

  /** A soft ground shadow whose size tracks the art's width (decor, trees,
   *  dragon). Squashed into an ellipse; sits on the cell ground so a bouncing
   *  sprite lifts off it. */
  private addGroundShadow(x: number, y: number, displayWidth: number, depth: number): Phaser.GameObjects.Image {
    const w = Math.max(70, displayWidth * 0.95);
    return this.add
      .image(x, y, 'fx_shadow')
      .setDisplaySize(w, w * 0.42)
      .setDepth(depth);
  }

  /** One-time landing settle for scenery (world-builder decor + animated tree
   *  tiles): a quick squash that springs back, so a piece reads as PLACED on the
   *  ground instead of endlessly floating. `delay` staggers neighbours. */
  private settleSprite(target: Phaser.GameObjects.Image, delay: number): void {
    const sx = target.scaleX;
    const sy = target.scaleY;
    target.setScale(sx * 1.08, sy * 0.84);
    this.tweens.add({
      targets: target,
      scaleX: sx,
      scaleY: sy,
      duration: 280,
      delay,
      ease: 'Back.easeOut'
    });
  }

  private acquireSprite(snap: ItemSnapshot, pop: boolean): BoardItem {
    let sprite = this.pool.find((s) => !s.active);
    if (!sprite) {
      sprite = new BoardItem(this);
      this.pool.push(sprite);
      // Footprint-sized hit area: anything taller than one iso row (64px above
      // the tile centre) would mask the tile behind it from pointer input.
      // Container hit areas are tested against local point + displayOrigin
      // (76,76 here from setSize(152,152)), so the rect is offset accordingly:
      // true local coverage is x -72..72, y -60..28.
      const hit = new Phaser.Geom.Rectangle(4, 16, 144, 88);
      sprite.setInteractive({
        hitArea: hit,
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true
      });
      sprite.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        if (sprite!.getData('dragged')) return;
        if (!this.isTap(pointer)) return;
        this.onItemTapped(sprite!);
      });
    }
    const artScale =
      snap.kind === 'decor'
        ? (DECOR_SCALE[snap.chain] ?? 1)
        : (ITEM_SCALE[`${snap.chain}_${snap.tier}`] ?? ITEM_SCALE[snap.chain] ?? 1);
    sprite.acquire(snap, this.ctx.data.anchors, this.textureFor(snap), artScale);
    // Phaser 3.90: calling setInteractive() on an already-interactive object
    // silently returns without updating hitArea. Mutate sprite.input.hitArea
    // directly instead. This also handles pool-reuse resets (else branch).
    if (snap.chain === 'crystal') {
      sprite.input!.hitArea = new Phaser.Geom.Rectangle(4, -324, 144, 428);
    } else if (snap.chain === 'chest') {
      // chest.png 537×511 @ scale 0.24, anchor 0.5/0.92 — full-sprite tap.
      // displayW≈129, displayH≈123; container origin +76 → rx=76−0.5·129, ry=76−0.92·123.
      sprite.input!.hitArea = new Phaser.Geom.Rectangle(12, -37, 129, 123);
    } else if (snap.chain === 'lumber' && snap.tier === 2) {
      // The House (house.png 361×380 @ scale 0.9, anchor 0.5/0.9) — full-sprite tap.
      // displayW≈325, displayH≈342; container origin +76 → rx=76−0.5·325, ry=76−0.9·342.
      sprite.input!.hitArea = new Phaser.Geom.Rectangle(-86, -232, 325, 342);
    } else if (snap.chain === 'bigtree') {
      // The Ancient Tree (bigtree.png 622×823 @ scale 0.31, anchor 0.5/0.92) — full-sprite
      // tap. displayW≈193, displayH≈255; origin +76 → rx=76−0.5·193, ry=76−0.92·255.
      sprite.input!.hitArea = new Phaser.Geom.Rectangle(-20, -159, 193, 255);
    } else {
      sprite.input!.hitArea = new Phaser.Geom.Rectangle(4, 16, 144, 88);
    }
    // Passive-only generators (house, big tree) have no readyAt, so the snapshot
    // doesn't flag them — recognise them by their chain config for the timer UI.
    if (snap.kind === 'item' && this.generatorConfigFor(snap.chain, snap.tier)) {
      sprite.isGenerator = true;
    }
    this.itemSprites.set(snap.id, sprite);
    this.refreshDraggable(sprite);
    // Every object gets the "placed on the ground" settle. With an entrance pop
    // the squash plays once the container has finished growing; without one
    // (initial board load) it plays immediately so starting items — e.g. the
    // default wood — plant onto the ground instead of appearing to float.
    const settleId = snap.id;
    if (pop) {
      popIn(this, sprite, { duration: TIMINGS.spawnPop });
      this.time.delayedCall(TIMINGS.spawnPop, () => {
        if (sprite.active && sprite.itemId === settleId) sprite.landSquash();
      });
    } else {
      sprite.landSquash();
    }
    return sprite;
  }

  private onItemTapped(sprite: BoardItem): void {
    const item = this.ctx.state.items.get(sprite.itemId);
    if (!item) return;
    // Collectible (a Gold coin): tap banks it — +Gold, a coin flies to the gauge
    // (UIScene), and the board coin is consumed.
    const collect = COLLECTIBLE_REWARD[`${item.chain}_${item.tier}`] ?? COLLECTIBLE_REWARD[item.chain];
    if (collect) {
      // Always collectable (even mid-tutorial) — banking a coin never interferes.
      this.ctx.bus.emit('economy:add', { coins: collect.coins, reason: 'collect' });
      this.ctx.bus.emit('gold:collected', { at: { col: item.col, row: item.row } });
      this.sparks.explode(8, sprite.x, sprite.y - 40);
      this.ctx.bus.emit('board:consume_items', { itemIds: [item.id], reason: 'sold' });
      return;
    }
    // A treasure chest: tap to open — ChestSystem grants a random gift (Gold,
    // Warmth, or a fan of Wood) and consumes the chest. Always tappable.
    if (item.chain === 'chest') {
      this.sparks.explode(10, sprite.x, sprite.y - 40);
      this.ctx.bus.emit('chest:open', { itemId: item.id });
      return;
    }
    // Merge-only items (no generator) are not interactable via tap beyond the sell path.
    // Emeralds (emerald t1), Green Eggs (emerald t2), Red Eggs (ember_dragon t2), and Rubies (ember_dragon t1) are pure merge pieces.
    if (item.chain === 'emerald' && item.tier < 3) return;
    if (item.chain === 'ember_dragon' && item.tier < 3) return;
    const cfg = this.generatorConfigFor(item.chain, item.tier);
    const isGenerator = cfg !== undefined;
    if (isGenerator && !this.tutorialDone && !this.allow.tapGenerators) return;
    if (!isGenerator && !this.tutorialDone && !this.allow.sell) return;
    // A DRAGON (with a generator) opens its Job menu (Work / Harvest, with rest & ruby timers).
    if (DRAGON_RIGS[item.chain] && isGenerator && (this.tutorialDone || this.allow.dragonWork)) {
      this.showDragonMenu(sprite);
      return;
    }
    // Tapping a COOLING/WAITING generator offers the skip buttons (cost scales
    // with the time left); a ready tap-generator harvests as usual.
    const timer = isGenerator ? this.genTimer(item) : null;
    if (timer) {
      this.showSkipButton(sprite, timer.remaining, timer.total, cfg?.skipMaxGold);
      return;
    }
    // Passive-only generators (house, big tree) never tap-harvest — they pay out
    // on their own timer; a ready tap does nothing.
    if (cfg?.tappable === false) return;
    // Harvest IMMEDIATELY (reliable — never coupled to an animation finishing),
    // then, for a plant, a nearby dragon flies over as a cosmetic "worker"
    // flourish. The harvest already happened, so a dropped frame can't stall it.
    this.ctx.bus.emit('item:tapped', { itemId: sprite.itemId });
    if (isGenerator && !DRAGON_RIGS[item.chain]) this.sendDragonFlourish(sprite);
  }

  /** Cosmetic only: the nearest idle dragon swoops to a just-harvested plant,
   *  breathes a few sparks, and flies home. Drives the dragon's BOARD ITEM so it
   *  works with or without a live rig (the rig is glued to the host). No game
   *  state depends on this completing. */
  private sendDragonFlourish(plant: BoardItem): void {
    const dragon = [...this.itemSprites.values()]
      .filter(
        (s) =>
          s.chain === DRAGON_CHAIN &&
          s.isGenerator &&
          s.itemId !== plant.itemId &&
          !this.busyDragons.has(s.itemId)
      )
      .sort(
        (a, b) =>
          Phaser.Math.Distance.Between(a.x, a.y, plant.x, plant.y) -
          Phaser.Math.Distance.Between(b.x, b.y, plant.x, plant.y)
      )[0];
    if (!dragon) return;

    this.busyDragons.add(dragon.itemId);
    const ld = this.liveDragons.get(dragon.itemId); // rig overlay, if attached
    const home = { x: dragon.x, y: dragon.y };
    const landX = plant.x + 70; // land to the plant's right so the un-mirrored rig still faces it (left)
    if (ld) {
      ld.busy = true;
      ld.player.setFacing(landX <= plant.x ? 'right' : 'left');
      ld.player.play('hover');
    }
    dragon.setDepth(DEPTHS.dragged);
    const land = (): void => {
      this.glowFlash(plant.x, plant.y - 36, PALETTE.goldAccent, 0.6, 1.2);
      this.sparks.explode(14, plant.x, plant.y - 34);
    };
    const done = (): void => {
      this.busyDragons.delete(dragon.itemId);
      dragon.settleDepth();
      if (ld) {
        ld.busy = false;
        ld.player.play('idle');
        ld.mode = 'idle';
        ld.remainMs = this.idleSpanMs();
      }
    };
    this.tweens.add({
      targets: dragon,
      x: landX,
      y: plant.y,
      duration: DRAGON_ANIM.flyToMs,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        land();
        this.tweens.add({
          targets: dragon,
          x: home.x,
          y: home.y,
          delay: DRAGON_ANIM.workMs,
          duration: DRAGON_ANIM.flyBackMs,
          ease: 'Sine.easeInOut',
          onComplete: done
        });
      }
    });
  }

  /** Two floating skip buttons under a waiting generator: GOLD (🪙) and the
   *  cheaper WARMTH (⚡). Hovering a button shows WHICH currency it spends ("Par
   *  or" / "Par énergie"). Both prices are dynamic and refresh live. */
  private showSkipButton(
    sprite: BoardItem,
    remaining: number,
    total: number,
    maxGold?: number
  ): void {
    this.hideSkipButton();
    this.skipMaxGold = maxGold; // per-generator gold cap (Crystal emeralds are dear)
    const btn = this.add.container(sprite.x, sprite.y + 100).setDepth(DEPTHS.dragged - 1);
    // Caption shown on hover, telling the player which payment a button uses.
    const caption = this.add
      .text(0, -58, '', {
        fontFamily: 'Trebuchet MS, Verdana, sans-serif',
        fontSize: '28px',
        fontStyle: 'bold',
        color: '#fff6e0',
        stroke: '#241b22',
        strokeThickness: 5,
        backgroundColor: 'rgba(28,20,26,0.78)',
        padding: { x: 12, y: 5 }
      })
      .setOrigin(0.5)
      .setVisible(false);
    const make = (
      dx: number,
      tint: number,
      currency: 'gold' | 'warmth',
      method: string,
      text: string
    ): Phaser.GameObjects.Text => {
      const bg = this.add.image(dx, 0, 'ui_btn_green').setScale(0.46, 0.52).setTint(tint);
      const label = this.add
        .text(dx, -2, text, {
          fontFamily: 'Segoe UI, sans-serif',
          fontSize: '30px',
          fontStyle: 'bold',
          color: '#fff6e0',
          stroke: '#1f3a14',
          strokeThickness: 5
        })
        .setOrigin(0.5);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => caption.setText(method).setX(dx).setVisible(true));
      bg.on('pointerout', () => caption.setVisible(false));
      bg.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        this.ctx.bus.emit('generator:skip', { itemId: sprite.itemId, currency });
        this.hideSkipButton();
      });
      btn.add([bg, label]);
      return label;
    };
    this.skipGoldLabel = make(-150, 0xffffff, 'gold', 'Par or', `🪙 ${skipEnergyCost(remaining, total, maxGold)}`);
    this.skipWarmthLabel = make(150, 0xa9d6ff, 'warmth', 'Par énergie', `⚡ ${skipWarmthCost(remaining, total, maxGold)}`);
    btn.add(caption); // on top of the buttons
    this.skipButton = btn;
    this.skipForId = sprite.itemId;
  }

  /** Keep both skip prices in step as the timer drains. */
  private updateSkipCost(remaining: number, total: number): void {
    this.skipGoldLabel?.setText(`🪙 ${skipEnergyCost(remaining, total, this.skipMaxGold)}`);
    this.skipWarmthLabel?.setText(`⚡ ${skipWarmthCost(remaining, total, this.skipMaxGold)}`);
  }

  private hideSkipButton(): void {
    this.skipButton?.destroy();
    this.skipButton = undefined;
    this.skipGoldLabel = undefined;
    this.skipWarmthLabel = undefined;
    this.skipForId = 0;
  }

  /** The dragon Job menu: WORK (fly to a House, speed its timer) and HARVEST
   *  (collect a Ruby), with the rest (fatigue) and ruby timers shown above. */
  private showDragonMenu(sprite: BoardItem): void {
    this.hideDragonMenu();
    const menu = this.add.container(sprite.x, sprite.y + 104).setDepth(DEPTHS.dragged - 1);
    this.dragonMenuLabel = this.add
      .text(0, -64, '', {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '28px',
        fontStyle: 'bold',
        color: '#fff6e0',
        align: 'center',
        stroke: '#241b22',
        strokeThickness: 5,
        backgroundColor: 'rgba(28,20,26,0.74)',
        padding: { x: 12, y: 5 }
      })
      .setOrigin(0.5);
    const mkBtn = (dx: number, text: string, onTap: () => void): void => {
      const bg = this.add.image(dx, 0, 'ui_btn_green').setScale(0.5, 0.54);
      const label = this.add
        .text(dx, -2, text, {
          fontFamily: 'Segoe UI, sans-serif',
          fontSize: '30px',
          fontStyle: 'bold',
          color: '#fff6e0',
          stroke: '#1f3a14',
          strokeThickness: 5
        })
        .setOrigin(0.5);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        onTap();
        this.hideDragonMenu();
      });
      menu.add([bg, label]);
    };
    mkBtn(-150, '⛏ Work', () => this.startDragonWork(sprite));
    mkBtn(150, '✋ Harvest', () => this.ctx.bus.emit('item:tapped', { itemId: sprite.itemId }));
    menu.add(this.dragonMenuLabel);
    this.dragonMenu = menu;
    this.dragonMenuForId = sprite.itemId;
    this.refreshDragonMenu();
  }

  /** Update the menu's rest/ruby countdown each tick while it's open. */
  private refreshDragonMenu(): void {
    if (!this.dragonMenuLabel || this.dragonMenuForId === 0) return;
    const item = this.ctx.state.items.get(this.dragonMenuForId);
    const now = this.ctx.clock.now();
    const rest = this.ctx.systems.jobs.restRemaining(this.dragonMenuForId);
    const cfg = item && this.generatorConfigFor(item.chain, item.tier);
    const rubyMs = item?.readyAt !== undefined ? Math.max(0, item.readyAt - now) : 0;
    const fmt = (ms: number): string => {
      const s = Math.ceil(ms / 1000);
      return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    const parts = [`Ruby ${cfg && rubyMs > 0 ? fmt(rubyMs) : 'ready'}`];
    parts.push(rest > 0 ? `Rest ${fmt(rest)}` : this.ctx.systems.jobs.isWorking(this.dragonMenuForId) ? 'Working' : 'Idle');
    this.dragonMenuLabel.setText(parts.join('   '));
  }

  private hideDragonMenu(): void {
    this.dragonMenu?.destroy();
    this.dragonMenu = undefined;
    this.dragonMenuLabel = undefined;
    this.dragonMenuForId = 0;
  }

  /** Send a dragon to WORK the nearest House: it flies over and stands by it,
   *  speeding its timer (+1× per worker) until it tires. */
  private startDragonWork(sprite: BoardItem, home?: { x: number; y: number }): void {
    if (this.ctx.systems.jobs.restRemaining(sprite.itemId) > 0) {
      this.floatText(sprite.x, sprite.y - 150, 'Resting…', PALETTE.cream);
      return;
    }
    // Work the NEAREST timed production building (House, Crystal, Ancient Tree —
    // any passive generator, not another dragon), so a 10-min object finishes in
    // 5 with one worker.
    const house = [...this.itemSprites.values()]
      .filter((s) => {
        const cfg = this.generatorConfigFor(s.chain, s.tier);
        return cfg?.tappable === false && !DRAGON_RIGS[s.chain] && s.itemId !== sprite.itemId;
      })
      .sort(
        (a, b) =>
          Phaser.Math.Distance.Between(a.x, a.y, sprite.x, sprite.y) -
          Phaser.Math.Distance.Between(b.x, b.y, sprite.x, sprite.y)
      )[0];
    if (!house) {
      this.floatText(sprite.x, sprite.y - 150, 'Nothing to work yet', PALETTE.cream);
      return;
    }
    this.busyDragons.add(sprite.itemId);
    this.dragonHomes.set(sprite.itemId, home ?? { x: sprite.x, y: sprite.y });
    const ld = this.liveDragons.get(sprite.itemId);
    if (ld) ld.busy = true;
    sprite.setDepth(DEPTHS.dragged);
    // Stand at a DISTINCT spot around the building (offset by how many dragons
    // already work it) so two dragons never overlap on the same place.
    const slots = [
      { dx: -110, dy: 24 },
      { dx: 110, dy: 24 },
      { dx: -120, dy: -48 },
      { dx: 120, dy: -48 },
      { dx: 0, dy: 70 },
      { dx: 0, dy: -78 }
    ];
    const slot = slots[this.ctx.systems.jobs.workersFor(house.itemId) % slots.length]!;
    const target = { x: house.x + slot.dx, y: house.y + slot.dy };
    this.tweens.add({
      targets: sprite,
      x: target.x,
      y: target.y,
      duration: DRAGON_ANIM.flyToMs,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        sprite.settleDepth();
        if (ld) ld.player.play('idle'); // "floats" by the house, working
      }
    });
    this.ctx.bus.emit('dragon:work', { dragonId: sprite.itemId, houseId: house.itemId });
  }

  /** Styled "💤 Zzz" fatigue pill floating above a resting dragon. */
  private showRestBadge(dragonId: number): void {
    this.restBadges.get(dragonId)?.destroy();
    const sprite = this.itemSprites.get(dragonId);
    if (!sprite) return;

    const W = 296, H = 118, R = 32;
    const pill = this.add.container(sprite.x, sprite.y - 160).setDepth(DEPTHS.flash);

    const g = this.add.graphics();
    // drop shadow
    g.fillStyle(num(PALETTE.night), 0.22);
    g.fillRoundedRect(-W / 2 + 5, -H / 2 + 5, W, H, R);
    // cream fill
    g.fillStyle(num(PALETTE.cream), 0.97);
    g.fillRoundedRect(-W / 2, -H / 2, W, H, R);
    // lava stroke
    g.lineStyle(8, num(PALETTE.lava), 1);
    g.strokeRoundedRect(-W / 2, -H / 2, W, H, R);
    pill.add(g);

    const font = 'Trebuchet MS, Verdana, sans-serif';
    const zzzText = this.add.text(0, -18, '💤 Zzz', {
      fontFamily: font,
      fontSize: '38px',
      fontStyle: 'bold',
      color: PALETTE.textBrown,
    }).setOrigin(0.5);

    const rest = this.ctx.systems.jobs.restRemaining(dragonId);
    const s0 = Math.ceil(rest / 1000);
    const countdown = this.add.text(0, 30, `${Math.floor(s0 / 60)}:${String(s0 % 60).padStart(2, '0')}`, {
      fontFamily: font,
      fontSize: '30px',
      fontStyle: 'bold',
      color: PALETTE.plum,
    }).setOrigin(0.5);

    pill.add([zzzText, countdown]);
    pill.setData('label', countdown);

    pill.setScale(0);
    this.tweens.add({ targets: pill, scale: 1, duration: 170, ease: 'Back.easeOut' });

    this.restBadges.set(dragonId, pill);
  }

  /** The fatigue lifted — pop the badge, sparkle, and a "Refreshed!" cue so the
   *  player SEES the dragon become available again. */
  private wakeDragon(dragonId: number): void {
    this.restBadges.get(dragonId)?.destroy();
    this.restBadges.delete(dragonId);
    const sprite = this.itemSprites.get(dragonId);
    if (!sprite) return;
    this.sparks.explode(14, sprite.x, sprite.y - 60);
    this.glowFlash(sprite.x, sprite.y - 50, PALETTE.goldAccent, 0.5, 1.0);
    this.floatText(sprite.x, sprite.y - 150, 'Refreshed!', PALETTE.goldAccent);
    const ld = this.liveDragons.get(dragonId);
    if (ld) {
      ld.player.play('hover');
      ld.mode = 'hover';
      ld.remainMs = DRAGON_ANIM.celebrateMs;
    }
  }

  /** A tired dragon flies back to its home tile to rest. */
  private returnDragonHome(dragonId: number): void {
    const sprite = this.itemSprites.get(dragonId);
    const home = this.dragonHomes.get(dragonId);
    if (!sprite || !home) return;
    sprite.setDepth(DEPTHS.dragged);
    this.tweens.add({
      targets: sprite,
      x: home.x,
      y: home.y,
      duration: DRAGON_ANIM.flyBackMs,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        sprite.settleDepth();
        this.busyDragons.delete(dragonId);
        const ld = this.liveDragons.get(dragonId);
        if (ld) ld.busy = false;
      }
    });
  }

  private onFogTapped(regionId: string, col: number, row: number): void {
    const status = this.ctx.state.regionStatus.get(regionId);
    const { x, y } = gridToWorld(col, row);
    if (status !== 'unlockable') {
      this.floatText(x, y - 120, 'Still sleeping…', PALETTE.cream);
      const puff = this.fog.get(`${col},${row}`);
      if (puff) scalePulse(this, puff, 1.07, 120);
      return;
    }
    if (!this.tutorialDone && !this.allow.fog) return;
    this.ctx.bus.emit('fog:tapped', { regionId });
  }

  /* --------------------------- reactions ---------------------------- */

  private subscribe(): void {
    const bus = this.ctx.bus;
    this.offBus.push(
      bus.on('item:spawned', ({ item }) => {
        const sprite = this.acquireSprite(item, false);
        // Any dragon generator (ember or emerald) wears its live rig.
        if (this.wearsRig(item.chain, sprite.isGenerator)) this.attachDragon(sprite, false);
      }),
      bus.on('item:moved', ({ itemId, to }) => {
        const sprite = this.itemSprites.get(itemId);
        if (!sprite) return;
        sprite.col = to.col;
        sprite.row = to.row;
        const { x, y } = gridToWorld(to.col, to.row);
        this.tweens.add({
          targets: sprite,
          x,
          y,
          duration: TIMINGS.dragReturn,
          ease: 'Back.easeOut',
          onComplete: () => sprite.settleDepth()
        });
        sprite.settleFromDrag();
      }),
      bus.on('item:move_bounced', ({ itemId, at }) => {
        const sprite = this.itemSprites.get(itemId);
        if (!sprite) return;
        const { x, y } = gridToWorld(at.col, at.row);
        this.tweens.add({
          targets: sprite,
          x,
          y,
          duration: TIMINGS.dragReturn,
          ease: 'Back.easeOut',
          onComplete: () => sprite.settleDepth()
        });
        sprite.settleFromDrag();
      }),
      bus.on('item:merged', (payload) => this.onMerged(payload)),
      bus.on('item:hatched', ({ item }) => this.hatchSequence(item)),
      bus.on('item:harvested', ({ generatorId, output }) => this.onHarvested(generatorId, output)),
      bus.on('item:produced', ({ generatorId, output }) => this.onProduced(generatorId, output)),
      bus.on('generator:reward', ({ generatorId, coins, xp, energy }) =>
        this.onGeneratorReward(generatorId, coins, xp, energy)
      ),
      bus.on('dragon:rest', ({ dragonId }) => {
        this.returnDragonHome(dragonId);
        this.showRestBadge(dragonId);
      }),
      bus.on('dragon:rested', ({ dragonId }) => this.wakeDragon(dragonId)),
      bus.on('item:harvest_failed', ({ generatorId, reason }) => {
        const sprite = this.itemSprites.get(generatorId);
        if (sprite) sprite.flashDenied();
        if (reason === 'no_space' && sprite) {
          this.floatText(sprite.x, sprite.y - 140, 'No room!', PALETTE.cream);
        }
      }),
      bus.on('item:removed', ({ itemId }) => {
        const sprite = this.itemSprites.get(itemId);
        if (!sprite) return;
        this.removeDragonRig(itemId);
        this.itemSprites.delete(itemId);
        this.tweens.add({
          targets: sprite,
          alpha: 0,
          scale: 0.6,
          duration: 150,
          ease: 'Sine.easeIn',
          onComplete: () => sprite.release()
        });
      }),
      bus.on('item:sold', ({ coins }) => {
        // Drift a "+N" toward the coin pill.
        this.floatText(320, 240, `+${coins}`, PALETTE.goldAccent);
      }),
      bus.on('region:unlocked', (payload) =>
        this.onRegionUnlocked(payload.tiles, payload.revealed, payload.regionId)
      ),
      bus.on('region:unlock_failed', ({ regionId, reason }) => {
        if (reason !== 'keys') return;
        const region = this.ctx.data.map.regions.find((r) => r.id === regionId);
        if (!region) return;
        const centroid = this.regionCentroid(region.tiles.map(([c, r]) => ({ col: c, row: r })));
        this.floatText(centroid.x, centroid.y - 100, 'Needs a Gold Key', PALETTE.goldAccent);
      }),
      bus.on('tutorial:step', (step) => {
        this.allow = step.allow;
        this.tutorialDone = step.done;
        this.refreshAllDraggable();
        this.setHighlights(step.highlight);
        // Key badges appear only on the key_unlock step (during tutorial); always
        // visible after tutorial is done.
        const showBadges = step.done || step.id === 'key_unlock';
        this.keyBadges.forEach((b) => b.setAlpha(showBadges ? 1 : 0));
        // Glide the camera to show the crystal when the player must tap it.
        if (step.id === 'emerald_tap') {
          const crystal = [...this.ctx.state.items.values()].find((i) => i.chain === 'crystal');
          if (crystal) {
            const w = gridToWorld(crystal.col, crystal.row);
            this.glideToWorld(w.x, w.y, 900);
          }
        }
        // The closer camera can leave a fog-gate lesson off-screen — glide to it.
        const fog =
          (step.arrow && 'fogRegion' in step.arrow && step.arrow.fogRegion) ||
          (step.hand && 'fogRegion' in step.hand && step.hand.fogRegion);
        if (fog) this.panToRegion(fog);
      }),
      bus.on('state:loaded', () => this.fullResync())
    );
  }

  private onMerged(payload: {
    chain: string;
    resultTier: number;
    at: TilePos;
    consumedIds: number[];
    outputs: ItemSnapshot[];
  }): void {
    const chainConfig = this.ctx.data.chains.chains.find((c) => c.id === payload.chain);
    const isHatch = chainConfig?.hatchAtTier === payload.resultTier;
    const drop = gridToWorld(payload.at.col, payload.at.row);

    for (const id of payload.consumedIds) {
      const sprite = this.itemSprites.get(id);
      if (!sprite) continue;
      this.removeDragonRig(id); // hatchlings merging into a whelp
      this.itemSprites.delete(id);
      this.tweens.add({
        targets: sprite,
        x: drop.x,
        y: drop.y,
        scale: 0.55,
        alpha: 0.5,
        duration: TIMINGS.mergeGather,
        ease: 'Sine.easeIn',
        onComplete: () => sprite.release()
      });
    }

    this.time.delayedCall(TIMINGS.mergeGather, () => {
      this.burst.explode(16, drop.x, drop.y - 36);
      this.glowFlash(drop.x, drop.y - 28, PALETTE.goldAccent, 0.55, 1.1);
      if (isHatch) return; // item:hatched runs the special ceremony
      payload.outputs.forEach((output, i) => {
        this.time.delayedCall(60 + i * 90, () => {
          // popIn's Back.easeOut overshoot IS the pop — never stack a second
          // scale tween on a spawning sprite, the longer one wins the final write.
          const isDragon = this.wearsRigTier(output.chain, output.tier);
          const sprite = this.acquireSprite(output, !isDragon);
          // A merged-up dragon (e.g. the Whelp) also wears the live rig and
          // celebrates its arrival; pop the sprite if the rig isn't ready.
          if (isDragon && !this.attachDragon(sprite, true)) {
            popIn(this, sprite, { duration: TIMINGS.spawnPop });
          }
        });
      });
    });
  }

  /** Shell-crack flash, spark confetti, then the hatchling pops in. */
  private hatchSequence(snap: ItemSnapshot): void {    const { x, y } = gridToWorld(snap.col, snap.row);
    const ghost = this.add
      .image(x, y, 'item_ember_dragon_1')
      .setOrigin(0.5, 0.85)
      .setScale(ITEM_SCALE.ember_dragon_1 ?? 1) // match the enlarged egg
      .setDepth(DEPTHS.itemBase + y);
    this.tweens.add({
      targets: ghost,
      x: x + 3,
      angle: 4,
      duration: 60,
      yoyo: true,
      repeat: Math.floor(TIMINGS.hatchShake / 120),
      ease: 'Sine.easeInOut'
    });
    this.time.delayedCall(TIMINGS.hatchShake, () => {      ghost.destroy();
      this.glowFlash(x, y - 52, PALETTE.white, 0.95, 1.7);
      this.shells.explode(7, x, y - 52);
      this.sparks.explode(24, x, y - 48);
      this.burst.explode(12, x, y - 44);
      const sprite = this.acquireSprite(snap, false);      // A live rigged dragon bursts in facing LEFT (un-mirrored), mid-celebration; the host
      // sprite becomes its invisible interactive anchor. Falls back to the
      // pooled sprite pop-in if the rig hasn't loaded.
      if (this.attachDragon(sprite, true)) return;
      sprite.setScale(0.05);
      sprite.setAlpha(0);
      this.tweens.add({
        targets: sprite,
        scale: 1,
        alpha: 1,
        duration: TIMINGS.hatchPop,
        ease: 'Back.easeOut',
        onComplete: () => scalePulse(this, sprite, 1.12, 150)
      });
    });
  }

  private onHarvested(generatorId: number, output: ItemSnapshot): void {
    const generator = this.itemSprites.get(generatorId);
    if (generator) {
      scalePulse(this, generator, 1.15, 130);
      this.burst.explode(5, generator.x, generator.y - 60);
      generator.setCooling(true);
    }
    const sprite = this.acquireSprite(output, false);
    const target = gridToWorld(output.col, output.row);
    if (generator) sprite.setPosition(generator.x, generator.y - 28);
    hopTo(this, sprite, target.x, target.y, {
      height: 76,
      duration: TIMINGS.harvestHop,
      onComplete: () => sprite.settleDepth()
    });
  }

  /** A dragon's PASSIVE gift: it celebrates, sparkles, and hops out an item —
   *  no cooldown tint (that's the tap path), this is free standing income. */
  private onProduced(generatorId: number, output: ItemSnapshot): void {
    const generator = this.itemSprites.get(generatorId);
    if (generator) {
      scalePulse(this, generator, 1.12, 160);
      this.sparks.explode(8, generator.x, generator.y - 52);
      this.glowFlash(generator.x, generator.y - 44, PALETTE.goldAccent, 0.4, 0.85);
      this.celebrateDragon(generatorId); // the rig cheers as it gifts
    }
    const sprite = this.acquireSprite(output, false);
    const target = gridToWorld(output.col, output.row);
    if (generator) sprite.setPosition(generator.x, generator.y - 28);
    hopTo(this, sprite, target.x, target.y, {
      height: 76,
      duration: TIMINGS.harvestHop,
      onComplete: () => sprite.settleDepth()
    });
  }

  /** The house paid out — pop it and float the coins/xp/energy it gave. */
  private onGeneratorReward(generatorId: number, coins: number, xp: number, energy: number): void {
    const gen = this.itemSprites.get(generatorId);
    if (!gen) return;
    scalePulse(this, gen, 1.12, 180);
    this.sparks.explode(12, gen.x, gen.y - 52);
    this.glowFlash(gen.x, gen.y - 44, PALETTE.goldAccent, 0.45, 0.95);
    const parts: string[] = [];
    if (coins) parts.push(`+${coins}🪙`);
    if (xp) parts.push(`+${xp} XP`);
    if (energy) parts.push(`+${energy}⚡`);
    if (parts.length) this.floatText(gen.x, gen.y - 150, parts.join('  '), PALETTE.goldAccent);
  }

  /** Nudge a live rigged dragon into one celebration cycle (e.g. on a gift). */
  private celebrateDragon(itemId: number): void {
    const ld = this.liveDragons.get(itemId);
    if (!ld) return;
    ld.mode = 'hover';
    ld.remainMs = DRAGON_ANIM.celebrateMs;
    ld.player.play('hover');
  }

  private onRegionUnlocked(tiles: TilePos[], revealed: ItemSnapshot[], regionId?: string): void {
    const sorted = [...tiles].sort((a, b) => a.col + a.row - (b.col + b.row));
    const centroid = this.regionCentroid(sorted);

    // Lift the key badge away with the fog (the lock is spent).
    const badge = regionId ? this.keyBadges.get(regionId) : undefined;
    if (badge) {
      this.keyBadges.delete(regionId!);
      this.tweens.killTweensOf(badge);
      this.tweens.add({
        targets: badge,
        y: badge.y - 90,
        alpha: 0,
        scale: badge.scale * 1.3,
        duration: TIMINGS.fogLift,
        ease: 'Sine.easeIn',
        onComplete: () => badge.destroy()
      });
    }

    // Diagonal sweep, but cap the total spread so a huge zone (hundreds of
    // tiles) still clears in a snappy couple of seconds rather than minutes.
    const maxSpread = 2200;
    const perTile = Math.min(TIMINGS.fogStaggerPerTile, maxSpread / Math.max(1, sorted.length - 1));
    sorted.forEach((tilePos, i) => {
      const key = `${tilePos.col},${tilePos.row}`;
      const delay = i * perTile;
      // Smoke curls up and fades.
      const puff = this.fog.get(key);
      if (puff) {
        this.fog.delete(key);
        this.tweens.killTweensOf(puff);
        puff.disableInteractive();
        this.tweens.add({
          targets: puff,
          y: puff.y - 104,
          alpha: 0,
          scale: puff.scale * 1.24,
          duration: TIMINGS.fogLift,
          delay,
          ease: 'Sine.easeIn',
          onComplete: () => puff.destroy()
        });
      }
      // The grass tile is already there beneath the cloud — brighten it as the
      // warmth floods back in.
      const base = this.tiles.get(key);
      if (base) {
        base.setTint(0xffffff);
        this.tweens.addCounter({
          from: 60,
          to: 100,
          duration: TIMINGS.tileBloom,
          delay: 250 + delay,
          ease: 'Sine.easeInOut',
          onUpdate: (tw) => {
            const v = Math.round((tw.getValue() ?? 100) * 2.55);
            base.setTint(Phaser.Display.Color.GetColor(v, v, v));
          },
          onComplete: () => base.clearTint()
        });
      }
    });

    // Warm light floods in.
    const glow = this.add
      .image(centroid.x, centroid.y - 24, 'fx_glow')
      .setTint(num(PALETTE.goldAccent))
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTHS.flash)
      .setScale(0.3)
      .setAlpha(0);
    this.tweens.add({
      targets: glow,
      scale: 4.6,
      alpha: 0.68,
      duration: TIMINGS.warmFlash * 0.45,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: glow,
          alpha: 0,
          scale: 5.4,
          duration: TIMINGS.warmFlash * 0.55,
          ease: 'Sine.easeIn',
          onComplete: () => glow.destroy()
        });
      }
    });
    this.time.delayedCall(350, () => {
      for (let i = 0; i < Math.min(sorted.length, 6); i++) {
        const t = sorted[Math.floor((i * sorted.length) / 6)]!;
        const { x, y } = gridToWorld(t.col, t.row);
        this.burst.explode(6, x, y - 8);
      }
    });

    // Revealed eggs + nest pop in once the light has bloomed.
    revealed.forEach((snap, i) => {
      this.time.delayedCall(520 + i * 150, () => {
        this.acquireSprite(snap, true);
        const { x, y } = gridToWorld(snap.col, snap.row);
        this.sparks.explode(6, x, y - 48);
      });
    });
  }

  private setHighlights(tiles: TilePos[]): void {
    for (const highlight of this.highlights) highlight.destroy();
    this.highlights = [];
    for (const tilePos of tiles) {
      const { x, y } = gridToWorld(tilePos.col, tilePos.row);
      const img = this.add
        .image(x, y, 'ui_tile_highlight')
        .setDepth(DEPTHS.tileHighlight)
        .setAlpha(0.5);
      this.tweens.add({
        targets: img,
        alpha: 1,
        scaleX: 1.05,
        scaleY: 1.05,
        duration: 540,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
      this.highlights.push(img);
    }
  }

  /** Rebuild everything visual from current state (after a save load). */
  private fullResync(): void {
    for (const ld of this.liveDragons.values()) ld.player.destroy();
    this.liveDragons.clear();
    for (const sprite of this.itemSprites.values()) sprite.release();
    this.itemSprites.clear();
    for (const tile of this.tiles.values()) tile.clearTint();
    // Remove fog over regions that are now active.
    for (const [key, puff] of [...this.fog]) {
      const [col, row] = key.split(',').map(Number) as [number, number];
      if (this.ctx.state.regionStatusAt(col, row) === 'active') {
        this.tweens.killTweensOf(puff);
        puff.destroy();
        this.fog.delete(key);
      }
    }
    const now = this.ctx.clock.now();
    for (const item of this.ctx.state.items.values()) {
      const snap = this.ctx.state.snapshot(item, now);
      const sprite = this.acquireSprite(snap, false);
      // Restore the live rig for dragons already on the board (resting, not
      // celebrating — they didn't just hatch).
      if (this.wearsRig(snap.chain, sprite.isGenerator)) this.attachDragon(sprite, false);
    }
    // Re-frame the camera on the loaded Keeper level (no glide).
    const frame = this.frameForLevel(this.ctx.state.level);
    this.cameras.main.setZoom(Math.max(frame.zoom, this.minZoom) * renderScale.value);
    this.cameras.main.centerOn(frame.x, frame.y);
    this.tutorialDone = this.ctx.state.tutorialDone;
    this.keyBadges.forEach((b) => b.setAlpha(this.tutorialDone ? 1 : 0));
  }

  /* ----------------------------- helpers ---------------------------- */

  /** Smooth tween to any world position (keeps current zoom). */
  private glideToWorld(worldX: number, worldY: number, duration = 900): void {
    const cam = this.cameras.main;
    const from = { x: cam.midPoint.x, y: cam.midPoint.y };
    this.flyTween?.stop();
    const proxy = { t: 0 };
    this.flyTween = this.tweens.add({
      targets: proxy,
      t: 1,
      duration,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        const s = smootherstep(proxy.t);
        cam.centerOn(Phaser.Math.Linear(from.x, worldX, s), Phaser.Math.Linear(from.y, worldY, s));
      }
    });
  }

  /** Glide the camera to centre a region (e.g. the key-fog gate the tutorial
   *  points at), keeping the current zoom. */
  private panToRegion(regionId: string): void {
    const region = this.ctx.data.map.regions.find((r) => r.id === regionId);
    if (!region || region.tiles.length === 0) return;
    const c = this.regionCentroid(region.tiles.map(([col, row]) => ({ col, row })));
    this.flyTween?.stop();
    this.cameras.main.centerOn(c.x, c.y); // reliable jump to the gate
  }

  private regionCentroid(tiles: TilePos[]): { x: number; y: number } {
    let sx = 0;
    let sy = 0;
    for (const tilePos of tiles) {
      const { x, y } = gridToWorld(tilePos.col, tilePos.row);
      sx += x;
      sy += y;
    }
    return { x: sx / Math.max(1, tiles.length), y: sy / Math.max(1, tiles.length) };
  }

  private glowFlash(x: number, y: number, colorHex: string, peak: number, scale: number): void {
    const glow = this.add
      .image(x, y, 'fx_glow')
      .setTint(num(colorHex))
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTHS.flash)
      .setScale(scale * 0.4)
      .setAlpha(0);
    this.tweens.add({
      targets: glow,
      alpha: peak,
      scale,
      duration: 120,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: glow,
          alpha: 0,
          scale: scale * 1.25,
          duration: 320,
          ease: 'Sine.easeIn',
          onComplete: () => glow.destroy()
        });
      }
    });
  }

  private floatText(x: number, y: number, message: string, color: string): void {
    const label = this.add
      .text(x, y, message, {
        fontFamily: FONT,
        fontSize: '40px',
        fontStyle: 'bold',
        color
      })
      .setOrigin(0.5)
      .setStroke(PALETTE.night, 8)
      .setDepth(DEPTHS.flash);
    this.tweens.add({
      targets: label,
      y: y - 88,
      alpha: 0,
      duration: 1000,
      ease: 'Sine.easeOut',
      onComplete: () => label.destroy()
    });
  }
}
