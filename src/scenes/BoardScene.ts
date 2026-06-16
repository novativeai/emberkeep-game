import Phaser from 'phaser';
import type { GameContext } from '../core/Context';
import {
  DEPTHS,
  DRAGON_ANIM,
  EMBER_MOTES,
  GAME_HEIGHT,
  GAME_WIDTH,
  num,
  PALETTE,
  SCENES,
  TAP_MAX_DISTANCE_PX,
  TAP_MAX_MS,
  TILE_H,
  TILE_W,
  TIMINGS
} from '../core/Constants';
import { lighten } from '../art/colors';
import { gridToWorld, worldToGrid } from '../core/iso';
import type { ItemSnapshot, TilePos, TutorialAllow } from '../core/types';
import { BoardItem } from '../entities/BoardItem';
import { RigPlayer } from '../render/RigPlayer';
import type { RigDoc } from '../render/rigTypes';
import { hopTo, popIn, scalePulse } from '../ui/tweens';

/** A featured live-rigged dragon overlaying its (invisible) interactive host. */
interface LiveDragon {
  player: RigPlayer;
  host: BoardItem;
  mode: 'celebrate' | 'idle';
  remainMs: number; // countdown until the next mode roll
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
const DRAGON_RIG_URL = 'sprites/characters/dragon/red-dragon/rig/dragon-red.rig.json';

const FONT = 'Trebuchet MS, Verdana, sans-serif';

const NO_ALLOW: Required<TutorialAllow> = {
  drag: [],
  tapGenerators: false,
  ledger: false,
  deliver: false,
  fog: false,
  sell: false
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
  private highlights: Phaser.GameObjects.Image[] = [];
  private allow: Required<TutorialAllow> = { ...NO_ALLOW };
  private tutorialDone = false;
  private dragFrom: TilePos | null = null;
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private shells!: Phaser.GameObjects.Particles.ParticleEmitter;
  private offBus: (() => void)[] = [];
  private regenAccum = 0;
  private coolAccum = 0;
  /** The ember-dragon rig, loaded once and reused for every hatchling/whelp. */
  private dragonRig: RigDoc | null = null;
  private liveDragons = new Map<number, LiveDragon>();
  /** Per-level camera framing + the active level-up glide. */
  private levelFrames = new Map<number, CameraFrame>();
  private flyTween?: Phaser.Tweens.Tween;
  private panFrom: { px: number; py: number; sx: number; sy: number } | null = null;

  constructor() {
    super(SCENES.board);
  }

  create(): void {
    this.ctx = this.registry.get('ctx') as GameContext;
    this.itemSprites.clear();
    this.pool = [];
    this.tiles.clear();
    this.fog.clear();
    this.highlights = [];
    this.allow = { ...NO_ALLOW };
    this.tutorialDone = this.ctx.state.tutorialDone;
    this.liveDragons.clear();
    void this.loadDragonRig(); // lazy + fault-tolerant; ready well before the hatch

    this.buildSky();
    this.buildGround();
    this.buildFog();
    this.buildEmitters();
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
    });
  }

  override update(time: number, delta: number): void {
    for (const sprite of this.itemSprites.values()) sprite.applyBob(time);
    this.updateLiveDragons(delta);

    this.coolAccum += delta;
    if (this.coolAccum >= 240) {
      this.coolAccum = 0;
      const now = this.ctx.clock.now();
      for (const sprite of this.itemSprites.values()) {
        if (!sprite.isGenerator) continue;
        const item = this.ctx.state.items.get(sprite.itemId);
        sprite.setCooling(item?.readyAt !== undefined && now < item.readyAt);
      }
    }

    this.regenAccum += delta;
    if (this.regenAccum >= 500) {
      this.regenAccum = 0;
      this.ctx.bus.emit('time:advanced', { ms: 0 }); // real-time regen tick
    }
  }

  /* ------------------------- live rigged dragons ------------------------- */

  /** Fetch + load the ember-dragon rig once. Any failure leaves dragons as the
   *  pooled placeholder sprite (graceful: the board still works). */
  private async loadDragonRig(): Promise<void> {
    if (this.dragonRig) return;
    try {
      const base = (import.meta.env.BASE_URL ?? './').replace(/\/?$/, '/');
      const res = await fetch(base + DRAGON_RIG_URL);
      if (!res.ok || !this.scene.isActive()) return;
      const rig = (await res.json()) as RigDoc;
      if (rig.format !== 'emberkeep-rig' || !rig.images || !this.scene.isActive()) return;
      await RigPlayer.loadTextures(this, rig, (layer) => `rig:${rig.character}:${layer}`);
      if (!this.scene.isActive()) return;
      this.dragonRig = rig;
      // Re-skin any dragons that hatched before the rig finished loading.
      for (const sprite of this.itemSprites.values()) {
        if (sprite.chain === DRAGON_CHAIN && sprite.isGenerator && !this.liveDragons.has(sprite.itemId)) {
          this.attachDragon(sprite, false);
        }
      }
    } catch {
      /* no rig available — pooled sprite stays */
    }
  }

  /** Mirror the source art (faces LEFT) to face RIGHT and mount it over `host`,
   *  which goes invisible but stays interactive/draggable. Returns false if the
   *  rig isn't ready yet (caller falls back to the sprite). */
  private attachDragon(host: BoardItem, intro: boolean): boolean {
    const rig = this.dragonRig;
    if (!rig || host.chain !== DRAGON_CHAIN) return false;
    this.removeDragonRig(host.itemId);
    const scale = host.tier >= 3 ? DRAGON_ANIM.whelpScale : DRAGON_ANIM.hatchlingScale;
    const player = new RigPlayer(this, rig, (layer) => `rig:${rig.character}:${layer}`, { scale });
    player.setFacing('right').play(intro ? 'celebrate' : 'idle');
    host.setArtVisible(false); // host is now just the invisible hit-target + bob anchor
    const ld: LiveDragon = {
      player,
      host,
      mode: intro ? 'celebrate' : 'idle',
      remainMs: intro ? DRAGON_ANIM.introCelebrateMs : this.idleSpanMs()
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
  }

  private updateLiveDragons(delta: number): void {
    for (const ld of this.liveDragons.values()) {
      this.syncDragon(ld);
      ld.player.update(delta);
      ld.remainMs -= delta;
      if (ld.remainMs > 0) continue;
      // Roll the next segment: mostly idle (~90% of the time), the rest a burst.
      if (ld.mode === 'idle' && Math.random() < DRAGON_ANIM.celebrateChance) {
        ld.mode = 'celebrate';
        ld.remainMs = DRAGON_ANIM.celebrateMs;
        ld.player.play('celebrate');
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
    const frame = this.frameForLevel(this.ctx.state.level);
    cam.setZoom(frame.zoom);
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
    const pct = (arr: number[]): number => arr[Math.floor(0.95 * (arr.length - 1))] ?? 0;
    const halfW = Math.max(TILE_W, pct(dxs) + TILE_W / 2);
    const halfH = Math.max(TILE_H, pct(dys) + TILE_H);
    const pad = 140;
    const zoom = Phaser.Math.Clamp(
      Math.min((GAME_WIDTH / 2 - pad) / halfW, (GAME_HEIGHT / 2 - pad) / halfH),
      0.28,
      1.0
    );
    return { x: center.x, y: center.y, zoom };
  }

  private frameForLevel(level: number): CameraFrame {
    for (let l = level; l >= 1; l--) {
      const f = this.levelFrames.get(l);
      if (f) return f;
    }
    return this.levelFrames.get(1) ?? { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2, zoom: 0.5 };
  }

  private flyToLevel(level: number): void {
    // Never yank the camera away mid-onboarding — the tutorial's scripted taps
    // all live in the L1 zone. Zones still unlock; the view just stays put.
    if (!this.tutorialDone) return;
    const target = this.frameForLevel(level);
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
        // Gentle mid-flight dolly-out for a premium, cinematic glide.
        const z = Phaser.Math.Linear(from.zoom, target.zoom, s) * (1 - 0.08 * Math.sin(Math.PI * proxy.t));
        cam.setZoom(z);
        cam.centerOn(x, y);
      }
    });
  }

  /* ----------------------------- build ------------------------------ */

  private buildSky(): void {
    // The sky is a fixed backdrop (scrollFactor 0) so it fills the viewport no
    // matter where the camera pans/zooms across the big board.
    const sky = this.add.graphics().setDepth(DEPTHS.sky).setScrollFactor(0);
    sky.fillGradientStyle(
      num(lighten(PALETTE.teal, 0.12)),
      num(PALETTE.teal),
      num(PALETTE.tealDeep),
      num(PALETTE.tealDeep),
      1
    );
    sky.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

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
            Phaser.Math.Between(60, GAME_HEIGHT * 0.45),
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
    for (const [col, row] of map.playable ?? []) {
      const { x, y } = gridToWorld(col, row);
      const artName = map.tilesByCell?.[`${col},${row}`];
      const cal = (artName && map.calibration?.[artName]) || {
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        anchor: { x: 0.5, y: 0.26 }
      };
      const tile = this.add
        .image(x + cal.offsetX * ratio, y + cal.offsetY * ratio, this.tileArtKey(col, row))
        .setOrigin(cal.anchor.x, cal.anchor.y)
        .setScale(cal.scale * ratio)
        // y-sorted within the floor band, always below items (itemBase=100).
        .setDepth(DEPTHS.tiles + y * 0.001);
      this.tiles.set(`${col},${row}`, tile);
    }
  }

  private buildFog(): void {
    for (const region of this.ctx.data.map.regions) {
      if (this.ctx.state.regionStatus.get(region.id) === 'active') continue;
      for (const [col, row] of region.tiles) {
        this.createFogSprite(region.id, col, row);
      }
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
        obj.setPosition(dragX, dragY - 24);
      }
    );
    this.input.on(
      Phaser.Input.Events.DRAG_END,
      (pointer: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
        if (!(obj instanceof BoardItem) || !this.dragFrom) return;
        const to = worldToGrid(pointer.worldX, pointer.worldY + 24);
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

  /**
   * Drag empty ground to pan the big board; wheel to zoom. A pointer that lands
   * on an item or fog is left to the drag/tap handlers, so navigation never
   * fights gameplay.
   */
  private wireCameraNav(): void {
    const cam = this.cameras.main;
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      const onObject = this.input
        .hitTestPointer(pointer)
        .some((o) => o instanceof BoardItem || o.getData?.('regionId') !== undefined);
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
        cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy < 0 ? 1.1 : 1 / 1.1), 0.2, 1.4));
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
    sprite.acquire(snap, this.ctx.data.anchors, this.textureFor(snap));
    this.itemSprites.set(snap.id, sprite);
    this.refreshDraggable(sprite);
    if (pop) popIn(this, sprite, { duration: TIMINGS.spawnPop });
    return sprite;
  }

  private onItemTapped(sprite: BoardItem): void {
    const item = this.ctx.state.items.get(sprite.itemId);
    if (!item) return;
    const isGenerator = item.readyAt !== undefined;
    if (isGenerator && !this.tutorialDone && !this.allow.tapGenerators) return;
    if (!isGenerator && !this.tutorialDone && !this.allow.sell) return;
    this.ctx.bus.emit('item:tapped', { itemId: sprite.itemId });
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
        // Any ember-dragon generator wears the live rig, however it arrived.
        if (item.chain === DRAGON_CHAIN && sprite.isGenerator) this.attachDragon(sprite, false);
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
          duration: 120,
          ease: 'Sine.easeOut',
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
      bus.on('region:unlocked', (payload) => this.onRegionUnlocked(payload.tiles, payload.revealed)),
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
          const isDragon = output.chain === DRAGON_CHAIN;
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
  private hatchSequence(snap: ItemSnapshot): void {
    const { x, y } = gridToWorld(snap.col, snap.row);
    const ghost = this.add
      .image(x, y, 'item_ember_dragon_1')
      .setOrigin(0.5, 0.85)
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
    this.time.delayedCall(TIMINGS.hatchShake, () => {
      ghost.destroy();
      this.glowFlash(x, y - 52, PALETTE.white, 0.95, 1.7);
      this.shells.explode(7, x, y - 52);
      this.sparks.explode(24, x, y - 48);
      this.burst.explode(12, x, y - 44);
      const sprite = this.acquireSprite(snap, false);
      // A live rigged dragon bursts in facing RIGHT, mid-celebration; the host
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

  /** Nudge a live rigged dragon into one celebration cycle (e.g. on a gift). */
  private celebrateDragon(itemId: number): void {
    const ld = this.liveDragons.get(itemId);
    if (!ld) return;
    ld.mode = 'celebrate';
    ld.remainMs = DRAGON_ANIM.celebrateMs;
    ld.player.play('celebrate');
  }

  private onRegionUnlocked(tiles: TilePos[], revealed: ItemSnapshot[]): void {
    const sorted = [...tiles].sort((a, b) => a.col + a.row - (b.col + b.row));
    const centroid = this.regionCentroid(sorted);

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
      if (snap.chain === DRAGON_CHAIN && sprite.isGenerator) this.attachDragon(sprite, false);
    }
    // Re-frame the camera on the loaded Keeper level (no glide).
    const frame = this.frameForLevel(this.ctx.state.level);
    this.cameras.main.setZoom(frame.zoom);
    this.cameras.main.centerOn(frame.x, frame.y);
    this.tutorialDone = this.ctx.state.tutorialDone;
  }

  /* ----------------------------- helpers ---------------------------- */

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
