import Phaser from 'phaser';
import { num, PALETTE } from '../core/Constants';
import type { EventBus } from '../core/EventBus';

const R = 46; // round button radius

/**
 * The Dragon-Duel launcher — a round ✌️ button parked just ABOVE the 🎁 gift
 * button. Hidden until the duel unlocks (every dragon hatched + Keeper Lv ≥ 2);
 * tapping it opens the DuelPanel. Pulses once when it first appears. Pure
 * subscriber (reads `duel:changed.unlocked`).
 */
export class DuelButton extends Phaser.GameObjects.Container {
  private glow: Phaser.GameObjects.Graphics;
  private bg: Phaser.GameObjects.Graphics;
  private emoji: Phaser.GameObjects.Text;
  private zone: Phaser.GameObjects.Zone;
  private unlocked = false;
  private offBus: () => void;

  constructor(scene: Phaser.Scene, bus: EventBus, x: number, y: number, private onOpen: () => void) {
    super(scene, x, y);

    this.glow = scene.add.graphics();
    this.glow.fillStyle(num(PALETTE.teal), 0.3);
    this.glow.fillCircle(0, 0, R + 14);
    this.glow.setAlpha(0);
    this.bg = scene.add.graphics();
    this.drawBg();
    this.emoji = scene.add.text(0, 1, '✌️', { fontSize: '42px' }).setOrigin(0.5);
    this.zone = scene.add.zone(0, 0, R * 2, R * 2).setInteractive({ useHandCursor: true });
    this.zone.on('pointerdown', () => this.setScale(0.94));
    this.zone.on('pointerup', () => { this.setScale(1); this.onOpen(); });
    this.zone.on('pointerout', () => this.setScale(1));

    this.add([this.glow, this.bg, this.emoji, this.zone]);
    scene.add.existing(this);
    this.setVisible(false);

    this.offBus = bus.on('duel:changed', (m) => this.setUnlocked(m.unlocked));
  }

  private drawBg(): void {
    const g = this.bg;
    g.clear();
    g.fillStyle(num(PALETTE.tealDeep), 1);
    g.fillCircle(0, 4, R);
    g.fillStyle(num(PALETTE.teal), 1);
    g.fillCircle(0, 0, R);
    g.lineStyle(6, num(PALETTE.cream), 0.95);
    g.strokeCircle(0, 0, R);
  }

  private setUnlocked(unlocked: boolean): void {
    if (unlocked === this.unlocked) {
      this.setVisible(unlocked);
      return;
    }
    this.unlocked = unlocked;
    this.setVisible(unlocked);
    if (unlocked) {
      // A one-shot attention pulse the first time the arena opens up.
      this.glow.setAlpha(0.9);
      this.scene.tweens.add({ targets: this.glow, alpha: 0, duration: 900, yoyo: true, repeat: 2, ease: 'Sine.easeInOut' });
      this.scene.tweens.add({ targets: this, scale: { from: 0.6, to: 1 }, duration: 320, ease: 'Back.easeOut' });
    }
  }

  destroy(fromScene?: boolean): void {
    this.offBus?.();
    super.destroy(fromScene);
  }
}
