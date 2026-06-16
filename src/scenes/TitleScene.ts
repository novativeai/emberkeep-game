import Phaser from 'phaser';
import type { GameContext } from '../core/Context';
import { GAME_HEIGHT, GAME_WIDTH, num, PALETTE, SCENES } from '../core/Constants';
import { RigPlayer } from '../render/RigPlayer';
import type { RigDoc } from '../render/rigTypes';

const FONT = 'Trebuchet MS, Verdana, sans-serif';
/** Featured rig shown idling on the title (optional — falls back to the egg). */
const TITLE_RIG_URL = 'sprites/characters/dragon/red-dragon/rig/dragon-red.rig.json';

/** Title card: warm sky, a lone speckled egg on a mossy outcrop, one Play button. */
export class TitleScene extends Phaser.Scene {
  private rigPlayer?: RigPlayer;
  private alive = true;

  constructor() {
    super(SCENES.title);
  }

  override update(_time: number, delta: number): void {
    this.rigPlayer?.update(delta);
  }

  create(): void {
    this.alive = true;
    this.rigPlayer = undefined;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.alive = false;
      this.rigPlayer = undefined;
    });
    const ctx = this.registry.get('ctx') as GameContext;

    // Sky.
    const sky = this.add.graphics();
    sky.fillGradientStyle(
      num(PALETTE.teal),
      num(PALETTE.teal),
      num(PALETTE.tealDeep),
      num(PALETTE.tealDeep),
      1
    );
    sky.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Warm halo behind the title.
    this.add
      .image(GAME_WIDTH / 2, 480, 'fx_glow')
      .setScale(4.6, 3.2)
      .setTint(num(PALETTE.gold))
      .setAlpha(0.4)
      .setBlendMode(Phaser.BlendModes.ADD);

    // Distant clouds — the real authored level-blocker cloud, drifting.
    for (const [x, y, s, a] of [
      [360, 1160, 1.4, 0.85],
      [2160, 1040, 1.1, 0.72],
      [480, 400, 0.8, 0.6],
      [2020, 320, 0.95, 0.66]
    ] as const) {
      const puff = this.add.image(x, y, 'cloud_tile').setOrigin(0.5, 0.62).setScale(s).setAlpha(a);
      this.tweens.add({
        targets: puff,
        x: x + (x > 1200 ? -52 : 52),
        duration: 9000 + x,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    }

    // Little isle: a real grass outcrop + nest + the first egg, gently bobbing.
    const isle = this.add.container(GAME_WIDTH / 2, 1080);
    const tile = this.add.image(0, 44, 'grass_10').setOrigin(0.5, 0.333).setScale(2.0);
    const nest = this.add.image(0, 64, 'decor_nest').setScale(1.25);
    const egg = this.add.image(0, 28, 'item_ember_dragon_1').setScale(1.35);
    const eggGlow = this.add
      .image(0, -20, 'fx_glow')
      .setScale(1.1)
      .setTint(num(PALETTE.goldAccent))
      .setAlpha(0.35)
      .setBlendMode(Phaser.BlendModes.ADD);
    isle.add([tile, eggGlow, nest, egg]);
    this.tweens.add({
      targets: isle,
      y: 1096,
      duration: 2600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
    this.tweens.add({
      targets: eggGlow,
      alpha: 0.16,
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    // Featured live-rigged dragon idling over the isle. Fully optional and
    // non-blocking: if the rig isn't present, the egg above stays as-is.
    void this.mountFeaturedDragon(isle, egg);

    // Drifting motes.
    this.add.particles(0, 0, 'fx_ember', {
      x: { min: 120, max: GAME_WIDTH - 120 },
      y: { min: GAME_HEIGHT - 120, max: GAME_HEIGHT },
      lifespan: 9000,
      speedY: { min: -68, max: -32 },
      speedX: { min: -20, max: 20 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 0.55, end: 0 },
      frequency: 420,
      blendMode: Phaser.BlendModes.ADD
    });

    // Title.
    const title = this.add
      .text(GAME_WIDTH / 2, 400, 'EMBERKEEP', {
        fontFamily: FONT,
        fontSize: '192px',
        fontStyle: 'bold',
        color: PALETTE.cream
      })
      .setOrigin(0.5)
      .setStroke(PALETTE.textBrown, 20)
      .setShadow(0, 14, 'rgba(36,27,34,0.45)', 20);
    this.add
      .text(GAME_WIDTH / 2, 544, '— The Dragon Hatchery —', {
        fontFamily: FONT,
        fontSize: '56px',
        fontStyle: 'bold italic',
        color: PALETTE.goldAccent
      })
      .setOrigin(0.5)
      .setShadow(0, 6, 'rgba(36,27,34,0.5)', 8);
    this.tweens.add({
      targets: title,
      scale: 1.02,
      duration: 2200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    // Play button.
    const hasSave = ctx.hasSave();
    const play = this.add.container(GAME_WIDTH / 2, 768);
    const playBg = this.add.image(0, 0, 'ui_btn_play');
    const playLabel = this.add
      .text(0, -16, hasSave ? 'Continue' : 'Play', {
        fontFamily: FONT,
        fontSize: '76px',
        fontStyle: 'bold',
        color: '#FFFFFF'
      })
      .setOrigin(0.5)
      .setShadow(0, 6, 'rgba(181,96,47,0.85)', 6);
    play.add([playBg, playLabel]);
    play.setSize(528, 192);
    play.setInteractive({ useHandCursor: true });
    play.on('pointerover', () => this.tweens.add({ targets: play, scale: 1.05, duration: 110 }));
    play.on('pointerout', () => this.tweens.add({ targets: play, scale: 1, duration: 110 }));
    play.on('pointerdown', () => play.setScale(0.96));
    play.on('pointerup', () => {
      play.disableInteractive();
      this.cameras.main.fadeOut(260, 36, 27, 34);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start(SCENES.board);
      });
    });
    this.tweens.add({
      targets: play,
      y: 780,
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    this.add
      .text(28, GAME_HEIGHT - 44, 'Emberkeep v0.1 — Level 1: Cinder Hollow', {
        fontFamily: FONT,
        fontSize: '26px',
        color: PALETTE.cream
      })
      .setAlpha(0.6);

    this.cameras.main.fadeIn(300, 36, 27, 34);
  }

  /**
   * Lazy, fault-tolerant: fetch the rig, load its embedded textures, build a
   * RigPlayer and idle it where the egg sits. Any failure (missing rig, scene
   * already left) is swallowed so the title always works.
   */
  private async mountFeaturedDragon(
    isle: Phaser.GameObjects.Container,
    egg: Phaser.GameObjects.Image
  ): Promise<void> {
    try {
      const base = (import.meta.env.BASE_URL ?? './').replace(/\/?$/, '/');
      const res = await fetch(base + TITLE_RIG_URL);
      if (!res.ok || !this.alive) return;
      const rig = (await res.json()) as RigDoc;
      if (!this.alive || rig.format !== 'emberkeep-rig' || !rig.images) return;

      const key = (layer: string): string => `rig:${rig.character}:${layer}`;
      await RigPlayer.loadTextures(this, rig, key);
      if (!this.alive) return;

      const player = new RigPlayer(this, rig, key, { scale: 0.42 });
      // Reparent into the isle so the dragon bobs with it; egg coords are local.
      isle.add(player.container);
      player.container.setPosition(egg.x, egg.y - 36);
      player.setFacing('left').play('idle');
      this.rigPlayer = player;

      // Cross-fade the egg out for the dragon.
      this.tweens.add({ targets: egg, alpha: 0, duration: 400, ease: 'Sine.easeIn' });
      player.container.setAlpha(0);
      this.tweens.add({ targets: player.container, alpha: 1, duration: 400, ease: 'Sine.easeOut' });
    } catch {
      /* no rig available — the egg remains. */
    }
  }
}
