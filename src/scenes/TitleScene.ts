import Phaser from 'phaser';
import type { GameContext } from '../core/Context';
import { GAME_HEIGHT, GAME_WIDTH, PALETTE, SCENES } from '../core/Constants';
import { renderScale } from '../core/render-scale';

const FONT = 'Trebuchet MS, Verdana, sans-serif';

/**
 * Start screen: the logo (from /logo) COVERS the whole screen — nothing else.
 * It fades in, then the Play button springs in over it; tapping enters the game.
 * (The Play button stays at game (1280,768) — the e2e taps it there.)
 */
export class TitleScene extends Phaser.Scene {
  constructor() {
    super(SCENES.title);
  }

  create(): void {
    const ctx = this.registry.get('ctx') as GameContext;
    this.cameras.main.setOrigin(0).setZoom(renderScale.value); // hi-DPI backing

    // FULL-SCREEN logo: a real DOM <img> (object-fit:cover) that fills the WHOLE
    // window — including the FIT letterbox the canvas can't reach. We hide the
    // water photo and paint the page dark (for the logo's transparent gaps),
    // show the logo image, and the Play button below renders on the transparent
    // canvas ON TOP. Everything is restored for gameplay on scene shutdown.
    const waterBg = document.querySelector<HTMLElement>('.water-bg');
    const titleLogo = document.getElementById('title-logo');
    const prevBodyBg = document.body.style.background;
    if (waterBg) waterBg.style.display = 'none';
    document.body.style.background = '#180f15';
    if (titleLogo) {
      titleLogo.style.display = 'block';
      // next frame so the opacity transition runs
      requestAnimationFrame(() => (titleLogo.style.opacity = '1'));
    } else {
      // Fallback wordmark on the (transparent) canvas if the DOM logo is absent.
      this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 120, 'EMBERKEEP', {
          fontFamily: FONT,
          fontSize: '192px',
          fontStyle: 'bold',
          color: PALETTE.cream
        })
        .setOrigin(0.5)
        .setStroke(PALETTE.textBrown, 20);
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (waterBg) waterBg.style.display = '';
      if (titleLogo) {
        titleLogo.style.opacity = '0';
        titleLogo.style.display = 'none';
      }
      document.body.style.background = prevBodyBg;
    });

    // Play button — VISIBLE and interactive from the first frame (never gated on
    // a tween: a GPU stutter can stall a delayed tween, and an alpha-0 object is
    // skipped in hit-tests, which would leave Play unclickable). It only springs
    // in *scale* for flavour, so it stays tappable throughout.
    // Play sits low, in the clear sky below the banner (e2e taps it here).
    const hasSave = ctx.hasSave();
    const play = this.add.container(GAME_WIDTH / 2, 1340);
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
    // Spring-in: visible the whole time (alpha 1), only the scale pops. Then a
    // gentle perpetual bob. Even if the loop stalls the tween, the button stays
    // clickable (alpha 1, scale ≥ 0.78).
    play.setAlpha(1).setScale(0.78);
    this.tweens.add({
      targets: play,
      scale: 1,
      duration: 520,
      delay: 420,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: play,
          y: 1352,
          duration: 1500,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        });
      }
    });

    this.cameras.main.fadeIn(300, 36, 27, 34);
  }
}
