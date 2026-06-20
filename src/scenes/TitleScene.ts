import Phaser from 'phaser';
import { GAME_WIDTH, LIVE_GAME_HEIGHT, num, PALETTE, SCENES } from '../core/Constants';
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
    this.cameras.main.setOrigin(0).setZoom(renderScale.value); // hi-DPI backing

    // FULL-SCREEN logo: a real DOM <img> (object-fit:cover) that fills the WHOLE
    // window — including the FIT letterbox the canvas can't reach. We hide the
    // water photo and paint the page dark (for the logo's transparent gaps),
    // show the logo image, and the Play button below renders on the transparent
    // canvas ON TOP. Everything is restored for gameplay on scene shutdown.
    const waterBg = document.querySelector<HTMLElement>('.water-bg');
    const titleBg = document.getElementById('title-bg');
    const titleLogo = document.getElementById('title-logo');
    const prevBodyBg = document.body.style.background;
    if (waterBg) waterBg.style.display = 'none';
    document.body.style.background = '#180f15';
    // Title-only cloud background behind the logo + button.
    if (titleBg) {
      titleBg.style.display = 'block';
      requestAnimationFrame(() => (titleBg.style.opacity = '1'));
    }
    if (titleLogo) {
      titleLogo.style.display = 'block';
      // next frame so the opacity transition runs
      requestAnimationFrame(() => (titleLogo.style.opacity = '1'));
    } else {
      // Fallback wordmark on the (transparent) canvas if the DOM logo is absent.
      this.add
        .text(GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2 - 120, 'EMBERKEEP', {
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
      if (titleBg) {
        titleBg.style.opacity = '0';
        titleBg.style.display = 'none';
      }
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
    // 1340/1600 = 0.8375 — same ratio keeps the button in the sky on any AR.
    const playY = Math.round(LIVE_GAME_HEIGHT * 0.8375);
    const play = this.add.container(GAME_WIDTH / 2, playY);
    // A ROUND button (drawn — the round-button PNG is only a placeholder): a gold
    // disc with a darker rim + inner ring, with the PLAY triangle on top. No text.
    const R = 116;
    const playBg = this.add.graphics();
    playBg.fillStyle(num(PALETTE.gold), 1);
    playBg.fillCircle(0, 0, R);
    playBg.lineStyle(12, num(PALETTE.goldShade), 1);
    playBg.strokeCircle(0, 0, R);
    playBg.lineStyle(6, num(PALETTE.goldAccent), 0.85);
    playBg.strokeCircle(0, 0, R - 18);
    const playIcon = this.add.graphics();
    playIcon.fillStyle(num(PALETTE.cream), 1);
    playIcon.lineStyle(7, num(PALETTE.textBrown), 1);
    playIcon.beginPath();
    playIcon.moveTo(-30, -52);
    playIcon.lineTo(-30, 52);
    playIcon.lineTo(52, 0);
    playIcon.closePath();
    playIcon.fillPath();
    playIcon.strokePath();
    play.add([playBg, playIcon]);
    play.setSize(R * 2, R * 2);
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
          y: playY + 12,
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
