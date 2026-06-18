import Phaser from 'phaser';
import { ENERGY_MAX, GAME_HEIGHT, GAME_WIDTH, num, PALETTE } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';

const FONT = 'Trebuchet MS, Verdana, sans-serif';

interface Pill {
  container: Phaser.GameObjects.Container;
  value: Phaser.GameObjects.Text;
}

/**
 * Heads-up display: energy / coins / keys pills (top-left), settings gear
 * (top-right), level + XP bar (bottom-left), Cindra's Ledger button
 * (bottom-right, with an attention dot when an order is deliverable).
 */
export class Hud {
  ledgerButton: Phaser.GameObjects.Container;
  gearButton: Phaser.GameObjects.Container;
  private energyPill: Pill;
  private coinPill?: Pill; // hidden for now (per request)
  private keyPill: Pill;
  private xpFill: Phaser.GameObjects.Graphics;
  private levelText: Phaser.GameObjects.Text;
  private xpLabel: Phaser.GameObjects.Text;
  private ledgerDot: Phaser.GameObjects.Arc;
  private ledgerEnabled = true;

  constructor(
    private scene: Phaser.Scene,
    bus: EventBus,
    private state: GameState,
    callbacks: { onLedger: () => void; onGear: () => void }
  ) {
    this.energyPill = this.pill(224, 88, 'ui_icon_bolt', `${state.energyCurrent}/${ENERGY_MAX}`);
    // Coin pill removed for now (per request); keys take its slot. Coins still
    // accrue in state — re-add `this.coinPill = this.pill(572, …)` to show them.
    this.keyPill = this.pill(572, 88, 'ui_icon_key', `${state.keys}`);

    // Settings gear.
    this.gearButton = this.roundIconButton(GAME_WIDTH - 112, 104, 'ui_icon_gear', 1, callbacks.onGear);

    // Ledger button: bigger, with the scroll icon.
    this.ledgerButton = this.roundIconButton(
      GAME_WIDTH - 156,
      GAME_HEIGHT - 168,
      'ui_icon_scroll',
      1.5,
      () => {
        if (this.ledgerEnabled) callbacks.onLedger();
      }
    );
    this.ledgerDot = scene.add
      .circle(68, -68, 18, num(PALETTE.lava))
      .setStrokeStyle(5, num(PALETTE.cream));
    this.ledgerButton.add(this.ledgerDot);
    this.ledgerDot.setVisible(false);
    scene.tweens.add({
      targets: this.ledgerDot,
      scale: 1.3,
      duration: 460,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    // Level disc + XP bar.
    const xpY = GAME_HEIGHT - 92;
    const disc = scene.add.image(112, xpY, 'ui_btn_round').setScale(0.82);
    this.levelText = scene.add
      .text(112, xpY - 10, '1', {
        fontFamily: FONT,
        fontSize: '52px',
        fontStyle: 'bold',
        color: PALETTE.textBrown
      })
      .setOrigin(0.5);
    scene.add
      .text(112, xpY + 32, 'LVL', {
        fontFamily: FONT,
        fontSize: '20px',
        fontStyle: 'bold',
        color: PALETTE.goldShade
      })
      .setOrigin(0.5);
    const barBg = scene.add.graphics();
    barBg.fillStyle(num(PALETTE.plumShade), 0.85);
    barBg.fillRoundedRect(172, xpY - 18, 440, 36, 18);
    barBg.lineStyle(4, num(PALETTE.gold), 0.9);
    barBg.strokeRoundedRect(172, xpY - 18, 440, 36, 18);
    this.xpFill = scene.add.graphics();
    this.xpLabel = scene.add
      .text(392, xpY, '', {
        fontFamily: FONT,
        fontSize: '24px',
        fontStyle: 'bold',
        color: PALETTE.cream
      })
      .setOrigin(0.5);
    disc.setDepth(2);
    this.levelText.setDepth(3);

    this.refreshEconomy();
    this.refreshEnergy(state.energyCurrent);

    bus.on('energy:changed', ({ current }) => this.refreshEnergy(current));
    bus.on('economy:changed', () => this.refreshEconomy());
    bus.on('order:progress', ({ deliverable }) => this.ledgerDot.setVisible(deliverable));
    bus.on('order:completed', () => this.ledgerDot.setVisible(false));
    bus.on('item:harvest_failed', ({ reason }) => {
      if (reason === 'energy') this.shakeEnergy();
    });
  }

  setLedgerEnabled(enabled: boolean): void {
    this.ledgerEnabled = enabled;
    this.ledgerButton.setAlpha(enabled ? 1 : 0.55);
  }

  getLedgerPos(): { x: number; y: number } {
    return { x: this.ledgerButton.x, y: this.ledgerButton.y };
  }

  private pill(x: number, y: number, icon: string, value: string): Pill {
    const container = this.scene.add.container(x, y);
    const bg = this.scene.add.image(0, 0, 'ui_pill').setScale(0.95, 0.9);
    const iconImg = this.scene.add.image(-116, 0, icon).setScale(0.92);
    const text = this.scene.add
      .text(20, 0, value, {
        fontFamily: FONT,
        fontSize: '42px',
        fontStyle: 'bold',
        color: PALETTE.cream
      })
      .setOrigin(0.5);
    container.add([bg, iconImg, text]);
    return { container, value: text };
  }

  private roundIconButton(
    x: number,
    y: number,
    icon: string,
    scale: number,
    onTap: () => void
  ): Phaser.GameObjects.Container {
    const container = this.scene.add.container(x, y);
    const bg = this.scene.add.image(0, 0, 'ui_btn_round').setScale(scale);
    const iconImg = this.scene.add.image(0, -8 * scale, icon).setScale(scale * 0.95);
    container.add([bg, iconImg]);
    container.setSize(128 * scale, 128 * scale);
    container.setInteractive({ useHandCursor: true });
    container.on('pointerover', () => container.setScale(1.06));
    container.on('pointerout', () => container.setScale(1));
    container.on('pointerdown', () => container.setScale(0.94));
    container.on('pointerup', () => {
      container.setScale(1);
      onTap();
    });
    return container;
  }

  private refreshEnergy(current: number): void {
    this.energyPill.value.setText(`${current}/${ENERGY_MAX}`);
    this.scene.tweens.add({
      targets: this.energyPill.container,
      scale: { from: 1.08, to: 1 },
      duration: 140,
      ease: 'Sine.easeOut'
    });
  }

  private refreshEconomy(): void {
    this.coinPill?.value.setText(`${this.state.coins}`);
    this.keyPill.value.setText(`${this.state.keys}`);
    this.levelText.setText(`${this.state.level}`);
    const [gained, span] = this.state.levelProgress;
    const xpY = GAME_HEIGHT - 92;
    this.xpFill.clear();
    const width = Math.max(0.04, Math.min(1, gained / span)) * 424;
    this.xpFill.fillStyle(num(PALETTE.gold), 1);
    this.xpFill.fillRoundedRect(180, xpY - 11, width, 22, 11);
    this.xpFill.fillStyle(num(PALETTE.goldAccent), 0.65);
    this.xpFill.fillRoundedRect(180, xpY - 11, width, 9, 4.4);
    this.xpLabel.setText(`${gained} / ${span} XP`);
  }

  private shakeEnergy(): void {
    const container = this.energyPill.container;
    this.scene.tweens.add({
      targets: container,
      x: container.x + 12,
      duration: 50,
      yoyo: true,
      repeat: 3
    });
    this.energyPill.value.setColor(PALETTE.lavaHighlight);
    this.scene.time.delayedCall(600, () => this.energyPill.value.setColor(PALETTE.cream));
  }
}
