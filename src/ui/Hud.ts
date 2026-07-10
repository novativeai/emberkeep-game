import Phaser from 'phaser';
import { GAME_WIDTH, LEVEL_XP, LIVE_GAME_HEIGHT, num, PALETTE } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import { uiRegistry } from './theme';

const FONT = 'Trebuchet MS, Verdana, sans-serif';

interface Pill {
  container: Phaser.GameObjects.Container;
  value: Phaser.GameObjects.Text;
  bg: Phaser.GameObjects.Image;
  icon: Phaser.GameObjects.Image;
  plus?: Phaser.GameObjects.Container;
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
  private coinPill?: Pill;
  private keyPill: Pill;
  private regenLabel: Phaser.GameObjects.Text;
  private xpFill: Phaser.GameObjects.Graphics;
  private levelText: Phaser.GameObjects.Text;
  private xpLabel: Phaser.GameObjects.Text;
  private ledgerDot: Phaser.GameObjects.Arc;
  private ledgerEnabled = true;
  /** Deliverability per visible order — the dot shows while ANY is ready. */
  private deliverableByOrder = new Map<string, boolean>();
  private readonly offBus: Array<() => void> = [];

  constructor(
    private scene: Phaser.Scene,
    bus: EventBus,
    private state: GameState,
    callbacks: { onLedger: () => void; onGear: () => void }
  ) {
    this.energyPill = this.pill(224, 88, 'ui_icon_bolt', `${state.energyCurrent}/${this.state.energyMax}`);
    // coin.png is a big detailed coin — shrink the icon ~85% so the Gold gauge
    // reads like the others (icon + value), not an oversized coin.
    this.coinPill = this.pill(572, 88, 'ui_icon_coin', `${state.coins}`, 0.14);
    this.keyPill = this.pill(920, 88, 'ui_icon_key', `${state.keys}`);
    // A green "+" on the Warmth/Gold gauges opens their shop. Keys are STORY
    // gates and are never sold (MECHANICS §7: monetise impatience, never
    // progression) — the key pill gets no shop button.
    this.addPlus(this.energyPill, 'energy', bus);
    this.addPlus(this.coinPill, 'coins', bus);
    // Small countdown to the next +1 Warmth, just under the energy gauge.
    this.regenLabel = scene.add
      .text(224, 138, '', { fontFamily: FONT, fontSize: '27px', fontStyle: 'bold', color: PALETTE.cream })
      .setOrigin(0.5)
      .setAlpha(0.9);

    // Settings gear.
    this.gearButton = this.roundIconButton(GAME_WIDTH - 112, 104, 'ui_icon_gear', 1, callbacks.onGear);

    // Ledger button: bigger, with the scroll icon.
    this.ledgerButton = this.roundIconButton(
      GAME_WIDTH - 156,
      LIVE_GAME_HEIGHT - 168,
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

    // Level disc + XP bar — one container so the whole cluster moves as one
    // (children keep their authored absolute coords; the group sits at 0,0).
    const xpY = LIVE_GAME_HEIGHT - 92;
    const levelGroup = scene.add.container(0, 0);
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
    const lvlTag = scene.add
      .text(112, xpY + 32, 'LVL', {
        fontFamily: FONT,
        fontSize: '20px',
        fontStyle: 'bold',
        color: PALETTE.goldShade
      })
      .setOrigin(0.5);
    const disc = scene.add.image(112, xpY, 'ui_btn_round').setScale(0.82);
    this.levelText = scene.add
      .text(112, xpY - 10, '1', {
        fontFamily: FONT,
        fontSize: '52px',
        fontStyle: 'bold',
        color: PALETTE.textBrown
      })
      .setOrigin(0.5);
    // Same paint order the old depth values produced: bar under disc, number on top.
    levelGroup.add([barBg, this.xpFill, this.xpLabel, lvlTag, disc, this.levelText]);

    this.refreshEconomy();
    this.refreshEnergy(state.energyCurrent);

    // ---- UI Builder registration (theme overrides apply on register) ----
    uiRegistry.register(scene, 'hud.energy', 'Warmth gauge', 'HUD', this.energyPill.container, {
      bg: this.energyPill.bg, icon: this.energyPill.icon, value: this.energyPill.value, plus: this.energyPill.plus!
    });
    if (this.coinPill) {
      uiRegistry.register(scene, 'hud.gold', 'Gold gauge', 'HUD', this.coinPill.container, {
        bg: this.coinPill.bg, icon: this.coinPill.icon, value: this.coinPill.value, plus: this.coinPill.plus!
      });
    }
    uiRegistry.register(scene, 'hud.keys', 'Keys gauge', 'HUD', this.keyPill.container, {
      bg: this.keyPill.bg, icon: this.keyPill.icon, value: this.keyPill.value
    });
    uiRegistry.register(scene, 'hud.regen', 'Warmth regen countdown', 'HUD', this.regenLabel, {
      label: this.regenLabel
    });
    uiRegistry.register(scene, 'hud.gear', 'Settings button', 'HUD', this.gearButton, {
      bg: this.gearButton.getAt(0), icon: this.gearButton.getAt(1)
    });
    uiRegistry.register(scene, 'hud.ledger', 'Ledger button', 'HUD', this.ledgerButton, {
      bg: this.ledgerButton.getAt(0), icon: this.ledgerButton.getAt(1)
    });
    uiRegistry.register(scene, 'hud.level', 'Level badge + XP bar', 'HUD', levelGroup, {
      disc, level: this.levelText, tag: lvlTag, xp: this.xpLabel
    });

    this.offBus.push(
      bus.on('energy:changed', ({ current }) => this.refreshEnergy(current)),
      bus.on('economy:changed', () => this.refreshEconomy()),
      bus.on('order:progress', ({ orderId, deliverable }) => {
        this.deliverableByOrder.set(orderId, deliverable);
        this.refreshLedgerDot();
      }),
      bus.on('order:completed', ({ orderId }) => {
        this.deliverableByOrder.delete(orderId);
        this.refreshLedgerDot();
      }),
      bus.on('item:harvest_failed', ({ reason }) => { if (reason === 'energy') this.shakeEnergy(); })
    );

    // Key pill hidden until the tutorial unlock step makes it relevant.
    this.keyPill.container.setVisible(false);
  }

  /** Unsubscribe all bus listeners — call on scene shutdown to prevent stale handlers. */
  teardown(): void {
    this.offBus.forEach((off) => off());
    this.offBus.length = 0;
  }

  /** Show or hide the key pill (hidden after tutorial in demo mode). */
  setKeyVisible(visible: boolean): void {
    this.keyPill.container.setVisible(visible);
  }

  private refreshLedgerDot(): void {
    this.ledgerDot.setVisible([...this.deliverableByOrder.values()].some(Boolean));
  }

  setLedgerEnabled(enabled: boolean): void {
    this.ledgerEnabled = enabled;
    this.ledgerButton.setAlpha(enabled ? 1 : 0.55);
  }

  getLedgerPos(): { x: number; y: number } {
    return { x: this.ledgerButton.x, y: this.ledgerButton.y };
  }

  /** Screen position of the Gold gauge (for the coin-collect fly). */
  getCoinPos(): { x: number; y: number } {
    return { x: this.coinPill?.container.x ?? 572, y: this.coinPill?.container.y ?? 88 };
  }

  /** A little bump when Gold lands. */
  bumpCoin(): void {
    if (!this.coinPill) return;
    this.scene.tweens.add({
      targets: this.coinPill.container,
      scale: { from: 1.16, to: 1 },
      duration: 160,
      ease: 'Sine.easeOut'
    });
  }

  /** A green "+" button hanging off a gauge's right edge → opens its shop. */
  private addPlus(pill: Pill, currency: 'energy' | 'coins', bus: EventBus): void {
    const btn = this.scene.add.container(150, 0);
    pill.plus = btn;
    const ring = this.scene.add.circle(0, 0, 31, 0x5fb43a).setStrokeStyle(6, num(PALETTE.cream));
    const plus = this.scene.add
      .text(0, -4, '+', { fontFamily: FONT, fontSize: '52px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5);
    btn.add([ring, plus]);
    btn.setSize(70, 70);
    btn.setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => btn.setScale(1.1));
    btn.on('pointerout', () => btn.setScale(1));
    btn.on('pointerup', () => {
      btn.setScale(1);
      bus.emit('ui:shop_requested', { currency });
    });
    pill.container.add(btn);
  }

  private pill(x: number, y: number, icon: string, value: string, iconScale = 0.92): Pill {
    const container = this.scene.add.container(x, y);
    const bg = this.scene.add.image(0, 0, 'ui_pill').setScale(0.95, 0.9);
    const iconImg = this.scene.add.image(-116, 0, icon).setScale(iconScale);
    const text = this.scene.add
      .text(20, 0, value, {
        fontFamily: FONT,
        fontSize: '42px',
        fontStyle: 'bold',
        color: PALETTE.cream
      })
      .setOrigin(0.5);
    container.add([bg, iconImg, text]);
    return { container, value: text, bg, icon: iconImg };
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

  /** Show the time to the next +1 Warmth (m:ss), or hide it when full. */
  setRegenText(text: string): void {
    this.regenLabel.setText(text ? `⏱ ${text}` : '').setVisible(text !== '');
  }

  private refreshEnergy(current: number): void {
    this.energyPill.value.setText(`${current}/${this.state.energyMax}`);
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
    const atCap = this.state.level >= LEVEL_XP.length;
    const [gained, span] = this.state.levelProgress;
    const xpY = LIVE_GAME_HEIGHT - 92;
    this.xpFill.clear();
    const width = (atCap ? 1 : Math.max(0.04, Math.min(1, gained / span))) * 424;
    this.xpFill.fillStyle(num(PALETTE.gold), 1);
    this.xpFill.fillRoundedRect(180, xpY - 11, width, 22, 11);
    this.xpFill.fillStyle(num(PALETTE.goldAccent), 0.65);
    this.xpFill.fillRoundedRect(180, xpY - 11, width, 9, 4.4);
    // The chapter ends at the cap — the bar never fills toward nothing.
    this.xpLabel.setText(atCap ? 'Chapter One complete ✦' : `${gained} / ${span} XP`);
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
