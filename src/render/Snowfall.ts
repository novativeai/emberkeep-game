import Phaser from 'phaser';
import { GAME_WIDTH, IS_MOBILE, LIVE_GAME_HEIGHT, SNOWFALL } from '../core/Constants';

/**
 * Borealis' snow — the whole of the world's weather, in one emitter.
 *
 * It lives in UIScene's fixed 2560×1600 camera rather than on the board, so the fall
 * stays vertical and covers the frame no matter what the board camera does (zoom,
 * the level-up glide, a drag pushing the view). Snow that scrolled with the ground
 * would read as a texture lying ON the isle instead of falling in front of it.
 *
 * Nothing is allocated until the first `start()`: a session that never travels north
 * never pays for the texture or the particle pool. Once built it is kept and simply
 * stopped — arriving in borealis a second time must not rebuild it.
 */
export class Snowfall {
  private emitter?: Phaser.GameObjects.Particles.ParticleEmitter;
  private falling = false;

  constructor(
    private scene: Phaser.Scene,
    private depth: number
  ) {}

  /** Alive at once. Phones get a fraction — the look survives it, the overdraw does not. */
  private get flakes(): number {
    return Math.round(SNOWFALL.flakes * (IS_MOBILE ? SNOWFALL.mobileFactor : 1));
  }

  start(): void {
    if (this.falling) return;
    this.falling = true;
    if (!this.emitter) this.emitter = this.build();
    this.emitter.start();
    this.prefill();
  }

  /**
   * Arriving in the north must not mean watching an empty sky while the first flakes
   * fall the height of the screen — an emitter only reaches its steady state after a
   * full lifespan, ten seconds here, which is most of a visit. `fastForward` runs the
   * emitter's own simulation forward instead, so the sky is already snowing on the
   * first frame, with the field it would have held had it been snowing all along.
   *
   * (Seeding it by hand with `emitParticleAt` does NOT work: the emit zone is an
   * offset from the emitter, so every hand-placed flake also got the zone's random
   * displacement and half the field landed off to the right of the world.)
   */
  private prefill(): void {
    const life = SNOWFALL.lifespanMs;
    this.emitter?.fastForward((life.min + life.max) / 2, 16);
  }

  /**
   * Stop, and take the flakes with us. A world switch happens behind a fade, so an
   * instant cut is invisible — whereas letting them drift out would leave snow
   * falling over the isle for the ten seconds of their lifespan.
   */
  stop(): void {
    if (!this.falling) return;
    this.falling = false;
    this.emitter?.stop();
    this.emitter?.killAll();
  }

  destroy(): void {
    this.emitter?.destroy();
    this.emitter = undefined;
    this.falling = false;
  }

  private build(): Phaser.GameObjects.Particles.ParticleEmitter {
    const life = SNOWFALL.lifespanMs;
    // Hold `flakes` alive: one flake every (mean lifespan / flakes) ms. Deriving the
    // frequency means the count is the only number anyone has to think about.
    const frequency = (life.min + life.max) / 2 / this.flakes;
    return this.scene.add
      .particles(0, 0, 'fx_snow', {
        // A band ABOVE the frame, wider than it: flakes blown in from the right edge
        // must already exist off-screen, or the wind starts at a visible seam.
        emitZone: {
          type: 'random',
          source: new Phaser.Geom.Rectangle(-160, -140, GAME_WIDTH + 320, 120) as Phaser.Types.GameObjects.Particles.RandomZoneSource
        },
        speedY: { min: SNOWFALL.speedY.min, max: SNOWFALL.speedY.max },
        speedX: { min: SNOWFALL.speedX.min, max: SNOWFALL.speedX.max },
        scale: { min: SNOWFALL.scale.min, max: SNOWFALL.scale.max },
        alpha: { min: SNOWFALL.alpha.min, max: SNOWFALL.alpha.max },
        rotate: { min: 0, max: 360 },
        lifespan: { min: life.min, max: life.max },
        tint: SNOWFALL.tint,
        frequency,
        quantity: 1,
        // Killed by the floor rather than by lifespan alone, so a fast flake does not
        // linger below the frame holding a slot in the pool.
        deathZone: {
          type: 'onEnter',
          source: {
            contains: (_x: number, y: number) => y > LIVE_GAME_HEIGHT + 80
          }
        },
        emitting: false
      })
      .setDepth(this.depth)
      .setScrollFactor(0);
  }
}
