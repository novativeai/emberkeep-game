import Phaser from 'phaser';
import type { EventBus } from '../core/EventBus';
import { GAME_HEIGHT, GAME_WIDTH, num, PALETTE } from '../core/Constants';

const FONT = 'Trebuchet MS, Verdana, sans-serif';

/**
 * Full-screen "thank you" overlay shown when the scripted tutorial completes.
 * "Play Again" resets to a fresh game; "Leave" dismisses the screen so the
 * player can keep exploring freely (tutorial is already marked done).
 */
export class EndScreen extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, bus: EventBus, variant: 'tutorial' | 'level3' = 'tutorial') {
    super(scene, 0, 0);

    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    const panelW = 1100;
    const panelH = 680;

    const titleText = variant === 'level3' ? 'Keeper Level 3!' : 'Thank You, Keeper!';
    const bodyText = variant === 'level3'
      ? 'You have mastered the basics of Emberkeep!\nThe adventure is just beginning — the full world awaits.'
      : 'You have lit the first flame.\nYour dragons are stirring — Emberkeep awaits.';

    // Dim overlay
    const dim = scene.add
      .rectangle(cx, cy, GAME_WIDTH, GAME_HEIGHT, num(PALETTE.night), 0.72)
      .setInteractive();
    this.add(dim);

    // Panel shadow + fill + border
    const g = scene.add.graphics();
    g.fillStyle(num(PALETTE.night), 0.22);
    g.fillRoundedRect(cx - panelW / 2 + 4, cy - panelH / 2 + 16, panelW, panelH, 52);
    g.fillStyle(num(PALETTE.cream), 1);
    g.fillRoundedRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH, 52);
    g.lineStyle(8, num(PALETTE.lava), 1);
    g.strokeRoundedRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH, 52);
    this.add(g);

    // Title lozenge
    const lo = scene.add.graphics();
    lo.fillStyle(num(PALETTE.lava), 1);
    lo.fillRoundedRect(cx - 320, cy - panelH / 2 - 52, 640, 104, 52);
    lo.lineStyle(6, num(PALETTE.cream), 1);
    lo.strokeRoundedRect(cx - 320, cy - panelH / 2 - 52, 640, 104, 52);
    this.add(lo);

    const title = scene.add
      .text(cx, cy - panelH / 2, titleText, {
        fontFamily: FONT,
        fontSize: '52px',
        fontStyle: 'bold',
        color: PALETTE.white,
        shadow: { offsetX: 4, offsetY: 4, color: 'rgba(36,27,34,0.5)', fill: true }
      })
      .setOrigin(0.5);
    this.add(title);

    // Body
    const body = scene.add
      .text(
        cx,
        cy - 80,
        bodyText,
        {
          fontFamily: FONT,
          fontSize: '38px',
          fontStyle: 'bold',
          color: PALETTE.textBrown,
          align: 'center',
          wordWrap: { width: 960 }
        }
      )
      .setOrigin(0.5);
    this.add(body);

    // "Play Again" green button
    const btnPlayImg = scene.add.image(cx - 240, cy + 200, 'ui_btn_green').setScale(0.9);
    const btnPlayLabel = scene.add
      .text(cx - 240, cy + 200, 'Play Again', {
        fontFamily: FONT,
        fontSize: '46px',
        fontStyle: 'bold',
        color: PALETTE.white,
        shadow: { offsetX: 4, offsetY: 4, color: 'rgba(36,27,34,0.5)', fill: true }
      })
      .setOrigin(0.5);
    btnPlayImg.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      bus.emit('game:reset_requested', {});
    });
    btnPlayImg.on('pointerover', () =>
      scene.tweens.add({ targets: btnPlayImg, scale: 0.94, duration: 110 })
    );
    btnPlayImg.on('pointerout', () =>
      scene.tweens.add({ targets: btnPlayImg, scale: 0.9, duration: 110 })
    );
    this.add(btnPlayImg);
    this.add(btnPlayLabel);

    // "Leave" lava button (dismiss — keep exploring)
    const btnLeaveImg = scene.add.image(cx + 240, cy + 200, 'ui_btn_play').setScale(0.9);
    const btnLeaveLabel = scene.add
      .text(cx + 240, cy + 200, 'Leave', {
        fontFamily: FONT,
        fontSize: '46px',
        fontStyle: 'bold',
        color: PALETTE.white,
        shadow: { offsetX: 4, offsetY: 4, color: 'rgba(36,27,34,0.5)', fill: true }
      })
      .setOrigin(0.5);
    btnLeaveImg.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      this.destroy();
    });
    btnLeaveImg.on('pointerover', () =>
      scene.tweens.add({ targets: btnLeaveImg, scale: 0.94, duration: 110 })
    );
    btnLeaveImg.on('pointerout', () =>
      scene.tweens.add({ targets: btnLeaveImg, scale: 0.9, duration: 110 })
    );
    this.add(btnLeaveImg);
    this.add(btnLeaveLabel);

    // Pop-in
    this.setScale(0.94);
    this.setAlpha(0);
    scene.tweens.add({
      targets: this,
      scale: 1,
      alpha: 1,
      duration: 170,
      ease: 'Back.easeOut'
    });
  }
}
