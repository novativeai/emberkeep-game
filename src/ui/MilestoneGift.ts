import Phaser from 'phaser';
import { num, PALETTE } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { EventMap } from '../core/types';

const FONT = 'Trebuchet MS, Verdana, sans-serif';
const R = 46; // round gift-button radius
const GIFT_ICON = 120; // gifts.png display size sitting on the round button
const PW = 624; // expanded panel width
const PH = 200;
const GAP = 16; // panel ↔ button gap
const SLOT = 120;
const CLAIM_W = 224;
const CLAIM_H = 96;

/**
 * The milestone "gift" as a collapsible pill styled to match Cindra's Ledger: a
 * round 🎁 button that, when tapped, unfolds a Magic-Orders card — cream board
 * with a warm-red frame, the target item in a `ui_slot`, its `have/need` count
 * in textBrown, the reward, and a glossy green `ui_btn_green` CLAIM button that
 * only lights up when the goal is met. Tapping CLAIM emits `milestone:claim`.
 * The round button pulses gold when a claim is ready. Pure subscriber.
 */
export class MilestoneGift extends Phaser.GameObjects.Container {
  private buttonGlow: Phaser.GameObjects.Graphics;
  private buttonBg: Phaser.GameObjects.Graphics;
  private buttonIcon: Phaser.GameObjects.Image;
  private buttonZone: Phaser.GameObjects.Zone;
  private panel: Phaser.GameObjects.Container;
  private itemIcon: Phaser.GameObjects.Image;
  private countText: Phaser.GameObjects.Text;
  private coinIcon: Phaser.GameObjects.Image;
  private rewardText: Phaser.GameObjects.Text;
  private claimImg: Phaser.GameObjects.Image;
  private claimLabel: Phaser.GameObjects.Text;
  private claimZone: Phaser.GameObjects.Zone;
  private expanded = false;
  private ready = false;
  private glowTween?: Phaser.Tweens.Tween;
  private offBus: () => void;

  private readonly panelX = -(R + GAP) - PW / 2;
  private readonly panelY = -20; // lift the big card clear of the corner buttons
  private readonly sx = -PW / 2 + 34 + SLOT / 2; // slot centre
  private readonly ccx = PW / 2 - 30 - CLAIM_W / 2; // CLAIM centre

  constructor(scene: Phaser.Scene, private bus: EventBus, x: number, y: number) {
    super(scene, x, y);

    // ---- round gift button (collapsed face — ledger lava+cream palette) ----
    this.buttonGlow = scene.add.graphics();
    this.buttonBg = scene.add.graphics();
    this.drawButton(false);
    this.buttonIcon = scene.add.image(0, 0, 'ui_gift').setDisplaySize(GIFT_ICON, GIFT_ICON);
    this.buttonZone = scene.add.zone(0, 0, R * 2, R * 2).setInteractive({ useHandCursor: true });
    this.buttonZone.on('pointerup', () => this.toggle());

    // ---- expandable quest card (Cindra's-Ledger style) ----
    this.panel = scene.add.container(this.panelX, this.panelY);

    const card = scene.add.graphics();
    // Warm-red frame.
    card.fillStyle(num(PALETTE.lavaShade), 1);
    card.fillRoundedRect(-PW / 2 - 4, -PH / 2 + 7, PW + 8, PH, 32);
    card.fillStyle(num(PALETTE.lava), 1);
    card.fillRoundedRect(-PW / 2, -PH / 2, PW, PH, 30);
    // Cream inner board.
    card.fillStyle(num(PALETTE.cream), 1);
    card.fillRoundedRect(-PW / 2 + 12, -PH / 2 + 12, PW - 24, PH - 24, 20);
    card.lineStyle(3, num(PALETTE.goldShade), 0.5);
    card.strokeRoundedRect(-PW / 2 + 12, -PH / 2 + 12, PW - 24, PH - 24, 20);

    // Header tag.
    const tag = scene.add
      .text(-PW / 2 + 34, -PH / 2 + 24, 'GIFT', {
        fontFamily: FONT, fontSize: '30px', fontStyle: 'bold', color: PALETTE.lavaShade
      })
      .setOrigin(0, 0);

    const slot = scene.add.image(this.sx, 12, 'ui_slot').setDisplaySize(SLOT, SLOT);
    this.itemIcon = scene.add.image(this.sx, 10, '__DEFAULT').setDisplaySize(SLOT - 24, SLOT - 24);

    const fx = -PW / 2 + 34 + SLOT + 30; // field left edge (right of slot)
    this.countText = scene.add
      .text(fx, -8, '0/0', {
        fontFamily: FONT, fontSize: '64px', fontStyle: 'bold', color: PALETTE.textBrown
      })
      .setOrigin(0, 0.5)
      .setShadow(0, 3, '#FFFFFF', 6);
    this.coinIcon = scene.add.image(fx + 22, 52, 'ui_icon_coin').setDisplaySize(44, 44);
    this.rewardText = scene.add
      .text(fx + 52, 52, '×0', {
        fontFamily: FONT, fontSize: '42px', fontStyle: 'bold', color: PALETTE.goldShade
      })
      .setOrigin(0, 0.5);

    this.claimImg = scene.add.image(this.ccx, 6, 'ui_btn_green').setDisplaySize(CLAIM_W, CLAIM_H);
    this.claimLabel = scene.add
      .text(this.ccx, 2, 'CLAIM', {
        fontFamily: FONT, fontSize: '44px', fontStyle: 'bold', color: '#FFFFFF'
      })
      .setOrigin(0.5)
      .setShadow(0, 4, 'rgba(36,27,34,0.5)', 6);
    this.claimZone = scene.add.zone(this.ccx, 6, CLAIM_W + 16, CLAIM_H + 12).setInteractive({ useHandCursor: true });
    this.claimZone.on('pointerdown', () => { if (this.expanded && this.ready) this.claimImg.setDisplaySize(CLAIM_W * 0.96, CLAIM_H * 0.96); });
    this.claimZone.on('pointerup', () => {
      this.claimImg.setDisplaySize(CLAIM_W, CLAIM_H);
      if (this.expanded && this.ready) this.bus.emit('milestone:claim', {});
    });

    this.panel.add([card, tag, slot, this.itemIcon, this.countText, this.coinIcon, this.rewardText, this.claimImg, this.claimLabel, this.claimZone]);
    this.panel.setVisible(false).setAlpha(0);

    this.add([this.panel, this.buttonGlow, this.buttonBg, this.buttonIcon, this.buttonZone]);
    scene.add.existing(this);

    this.setVisible(false); // hidden until the first milestone:changed
    this.offBus = bus.on('milestone:changed', (m) => this.render(m));
  }

  private drawButton(ready: boolean): void {
    const g = this.buttonBg;
    g.clear();
    g.fillStyle(num(PALETTE.lavaShade), 1);
    g.fillCircle(0, 4, R);
    g.fillStyle(num(ready ? PALETTE.gold : PALETTE.lava), 1);
    g.fillCircle(0, 0, R);
    g.lineStyle(6, num(PALETTE.cream), 0.95); // cream rim, like the ledger lozenges
    g.strokeCircle(0, 0, R);
  }

  private render(m: EventMap['milestone:changed']): void {
    if (m.done || m.id === null) {
      this.setVisible(false);
      return;
    }
    this.setVisible(true);
    const key = `item_${m.chain}_${m.tier}`;
    if (this.scene.textures.exists(key)) this.itemIcon.setTexture(key).setDisplaySize(SLOT - 24, SLOT - 24);
    this.countText.setText(`${m.have}/${m.need}`);
    this.rewardText.setText(`×${m.coins}`);
    this.ready = m.ready;
    this.claimImg.setDisplaySize(CLAIM_W, CLAIM_H);
    this.claimImg.setAlpha(m.ready ? 1 : 0.5);
    this.claimLabel.setAlpha(m.ready ? 1 : 0.6);
    this.drawButton(m.ready);
    this.setReadyGlow(m.ready);
  }

  private toggle(): void {
    this.expanded = !this.expanded;
    this.scene.tweens.add({ targets: this.buttonIcon, scaleX: '*=0.8', scaleY: '*=0.8', duration: 110, yoyo: true, ease: 'Sine.easeInOut' });
    this.scene.tweens.killTweensOf(this.panel);
    if (this.expanded) {
      this.panel.setVisible(true);
      this.scene.tweens.add({
        targets: this.panel, alpha: { from: 0.2, to: 1 }, x: { from: this.panelX + 46, to: this.panelX },
        duration: 240, ease: 'Back.easeOut'
      });
    } else {
      this.scene.tweens.add({
        targets: this.panel, alpha: 0, x: this.panelX + 34, duration: 150, ease: 'Sine.easeIn',
        onComplete: () => this.panel.setVisible(false)
      });
    }
  }

  /** Pulse the collapsed button gold when a claim is waiting. */
  private setReadyGlow(ready: boolean): void {
    this.glowTween?.stop();
    this.buttonGlow.clear();
    if (ready) {
      this.buttonGlow.fillStyle(num(PALETTE.goldAccent), 0.32);
      this.buttonGlow.fillCircle(0, 0, R + 14);
      this.glowTween = this.scene.tweens.add({
        targets: this.buttonGlow, alpha: { from: 0.35, to: 1 }, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
      });
    } else {
      this.buttonGlow.setAlpha(1);
    }
  }

  destroy(fromScene?: boolean): void {
    this.offBus?.();
    this.glowTween?.stop();
    super.destroy(fromScene);
  }
}
