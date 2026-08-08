import Phaser from 'phaser';
import { PORTAL_TINTS, type PortalTints } from '../core/Constants';

/**
 * The Ember Gate's living portal — the one piece of scenery that is drawn ON
 * TOP of the painting, because it is the one piece of scenery that is NEWS:
 * the arch has stood shut for the whole chapter, and the moment the Golden
 * Elder wakes it has to read as changed from across the board.
 *
 * Built from the game's own FX vocabulary (fx_glow / fx_spark / fx_ember,
 * every layer ADD-blended per docs/vfx-textures.md), layered the way a
 * production portal is:
 *
 *   1. breath glow    — a wide warm halo behind the arch, breathing slowly
 *   2. molten core    — a tall gold lens, the "surface" of the door
 *   3. white heart    — a narrow hot slit inside it, flickering faster
 *   4. vortex in-fall — sparks born on the rim that converge on the centre
 *      (`moveToX/Y` — real convergence, not a texture pretending to spin)
 *   5. drift motes    — a few embers rising off the threshold
 *
 * plus a one-shot ignition (`bloom`): flash, shockwave shell, spark burst,
 * then the idle layers fade up. `standIdle` is the reload path — the Gate is
 * simply open, no ceremony twice.
 *
 * Budget: ~30 live particles across both emitters, three slow tweens. The
 * global fps governor throttles the rest; nothing here schedules its own wake.
 */
export class PortalFX extends Phaser.GameObjects.Container {
  private readonly h: number;
  private rim!: Phaser.GameObjects.Particles.ParticleEmitter;
  private motes!: Phaser.GameObjects.Particles.ParticleEmitter;
  private layers: Phaser.GameObjects.Image[] = [];
  private live = false;

  private readonly tints: PortalTints;

  constructor(scene: Phaser.Scene, x: number, y: number, height: number, destination?: string) {
    super(scene, x, y);
    scene.add.existing(this);
    this.h = height;
    // A door wears where it GOES (Constants PORTAL_TINTS): flame home, forest
    // green to Roothold, ice blue north. Unknown destinations run warm.
    this.tints = PORTAL_TINTS[destination ?? ''] ?? PORTAL_TINTS.emberkeep!;
    this.setVisible(false);
  }

  /** The rectangle a tap should count anywhere inside, in world px. */
  hitSize(): { width: number; height: number } {
    return { width: this.h * 0.82, height: this.h * 1.08 };
  }

  get isLive(): boolean {
    return this.live;
  }

  /** Reload path: the Gate has been open since a previous session. */
  standIdle(): void {
    if (this.live) return;
    this.buildIdle(1);
  }

  /** The ceremony path: ignition, then the idle portal establishes. */
  bloom(): void {
    if (this.live) return;
    const scene = this.scene;
    // Ignition flash — a hot core blown up and burned off.
    const flash = scene.add.image(0, 0, 'fx_glow').setBlendMode(Phaser.BlendModes.ADD);
    flash.setTint(this.tints.heart);
    flash.setDisplaySize(this.h * 0.3, this.h * 0.3);
    this.add(flash);
    scene.tweens.add({
      targets: flash,
      displayWidth: this.h * 1.7,
      displayHeight: this.h * 1.7,
      alpha: { from: 1, to: 0 },
      duration: 520,
      ease: 'Cubic.easeOut',
      onComplete: () => flash.destroy()
    });
    // Shockwave shell riding the flash.
    const shell = scene.add.image(0, 0, 'fx_shell').setBlendMode(Phaser.BlendModes.ADD);
    shell.setTint(this.tints.core);
    shell.setDisplaySize(this.h * 0.2, this.h * 0.2);
    this.add(shell);
    scene.tweens.add({
      targets: shell,
      displayWidth: this.h * 2.1,
      displayHeight: this.h * 2.1,
      alpha: { from: 0.9, to: 0 },
      duration: 680,
      ease: 'Sine.easeOut',
      onComplete: () => shell.destroy()
    });
    this.setVisible(true);
    this.buildIdle(0);
    // Spark burst once the emitters exist, so it shares their texture pool.
    this.rim.explode(26, 0, 0);
    // The idle layers fade up under the dying flash.
    scene.tweens.add({ targets: this.layers, alpha: '+=0', duration: 0 });
    this.layers.forEach((img, i) =>
      scene.tweens.add({
        targets: img,
        alpha: img.getData('restAlpha') as number,
        duration: 900,
        delay: 220 + i * 90,
        ease: 'Sine.easeIn'
      })
    );
  }

  /** The standing portal. `startAlpha` 1 = appear lit (reload), 0 = fade in. */
  private buildIdle(startAlpha: number): void {
    const scene = this.scene;
    const layer = (
      tint: number,
      w: number,
      h: number,
      restAlpha: number,
      breatheMs: number
    ): Phaser.GameObjects.Image => {
      const img = scene.add.image(0, 0, 'fx_glow').setBlendMode(Phaser.BlendModes.ADD);
      img.setTint(tint);
      img.setDisplaySize(w, h);
      img.setData('restAlpha', restAlpha);
      img.setAlpha(startAlpha * restAlpha);
      this.add(img);
      this.layers.push(img);
      scene.tweens.add({
        targets: img,
        displayWidth: w * 1.06,
        displayHeight: h * 1.06,
        duration: breatheMs,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
      return img;
    };
    layer(this.tints.glow, this.h * 1.1, this.h * 1.2, 0.72, 2600); // breath glow
    layer(this.tints.core, this.h * 0.54, this.h * 1.0, 0.95, 1900); // molten core
    const heart = layer(this.tints.heart, this.h * 0.22, this.h * 0.62, 1, 1300); // white heart
    scene.tweens.add({
      targets: heart,
      alpha: { from: Math.max(startAlpha, 0.01), to: 0.7 },
      duration: 480,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
    // Energy swirl: two elongated streaks counter-rotating around the core —
    // the cheap read of "this surface is turning" that a glow alone never has.
    for (const [dir, tint, alpha] of [
      [1, this.tints.streaks[0], 0.5],
      [-1, this.tints.streaks[1], 0.42]
    ] as const) {
      const streak = scene.add.image(0, 0, 'fx_glow').setBlendMode(Phaser.BlendModes.ADD);
      streak.setTint(tint);
      streak.setDisplaySize(this.h * 0.9, this.h * 0.22);
      streak.setData('restAlpha', alpha);
      streak.setAlpha(startAlpha * alpha);
      this.add(streak);
      this.layers.push(streak);
      scene.tweens.add({
        targets: streak,
        angle: 360 * dir,
        duration: dir > 0 ? 5200 : 7400,
        repeat: -1
      });
    }

    // Vortex in-fall: sparks born on the door's rim converge on its heart.
    const rimShape = new Phaser.Geom.Ellipse(0, 0, this.h * 0.62, this.h * 0.98);
    this.rim = scene.add.particles(0, 0, 'fx_spark', {
      emitZone: { type: 'random', source: rimShape, quantity: 1 },
      moveToX: { min: -12, max: 12 },
      moveToY: { min: -16, max: 16 },
      lifespan: { min: 850, max: 1350 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 1, end: 0 },
      rotate: { min: 0, max: 360 },
      tint: this.tints.sparks,
      frequency: 55,
      blendMode: Phaser.BlendModes.ADD
    });
    this.add(this.rim);

    // Drift motes: a few embers rising off the threshold.
    this.motes = scene.add.particles(0, this.h * 0.42, 'fx_ember', {
      x: { min: -this.h * 0.3, max: this.h * 0.3 },
      speedY: { min: -46, max: -18 },
      speedX: { min: -8, max: 8 },
      lifespan: { min: 1800, max: 2600 },
      scale: { start: 0.4, end: 0 },
      alpha: { start: 0.8, end: 0 },
      tint: this.tints.motes,
      frequency: 240,
      blendMode: Phaser.BlendModes.ADD
    });
    this.add(this.motes);

    this.setVisible(true);
    this.live = true;
  }
}
