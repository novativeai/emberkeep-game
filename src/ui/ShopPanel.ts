import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, num, PALETTE } from '../core/Constants';
import type { EventBus } from '../core/EventBus';

const FONT = 'Trebuchet MS, Verdana, sans-serif';
type Currency = 'energy' | 'coins' | 'keys';

/** Recreated "Ruby-Shop" palette (matching theme-pay-reel, not the image). */
const PINK = 0xe8528a;
const PINK_DARK = 0xc63a73;
const CREAM = 0xfffdf2;
const ORANGE = 0xf5a01e;
const GREEN = 0x6cc24a;
const GREEN_DARK = 0x4e9a32;

interface Product {
  amount: number;
  price: string;
  best?: boolean;
}
const SHOP: Record<Currency, { title: string; icon: string; iconScale: number; items: Product[] }> = {
  energy: {
    title: 'Warmth Shop',
    icon: 'ui_icon_bolt',
    iconScale: 1.4,
    items: [
      { amount: 2, price: '$0.99' },
      { amount: 20, price: '$2.99', best: true },
      { amount: 50, price: '$9.99' }
    ]
  },
  coins: {
    title: 'Gold Shop',
    icon: 'ui_icon_coin',
    iconScale: 0.34,
    items: [
      { amount: 200, price: '$2.99' },
      { amount: 900, price: '$9.99', best: true },
      { amount: 2100, price: '$19.99' }
    ]
  },
  keys: {
    title: 'Key Shop',
    icon: 'ui_icon_key',
    iconScale: 1.4,
    items: [
      { amount: 1, price: '$0.99' },
      { amount: 5, price: '$2.99', best: true },
      { amount: 12, price: '$9.99' }
    ]
  }
};

/**
 * In-game currency shop. A gauge's "+" opens it; each card buys an amount for a
 * (mock) real-money price — tapping the green price button grants the currency.
 * Visual theme recreated from theme-pay-reel.jpeg with Phaser primitives.
 */
export class ShopPanel extends Phaser.GameObjects.Container {
  isOpen = false;
  private dim: Phaser.GameObjects.Rectangle;
  private titleText: Phaser.GameObjects.Text;
  private titleBg: Phaser.GameObjects.Graphics;
  private cards: Phaser.GameObjects.Container;

  constructor(
    scene: Phaser.Scene,
    private bus: EventBus
  ) {
    super(scene, GAME_WIDTH / 2, GAME_HEIGHT / 2);

    this.dim = scene.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, num(PALETTE.night), 0.55)
      .setInteractive();
    this.dim.on('pointerup', () => this.requestClose());

    // Pink scroll-banner title.
    this.titleBg = scene.add.graphics();
    this.titleText = scene.add
      .text(0, -440, '', { fontFamily: FONT, fontSize: '64px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5)
      .setShadow(0, 4, 'rgba(120,30,70,0.6)', 6);

    // Close button (red disc, top-right).
    const close = scene.add.container(820, -440);
    const closeBg = scene.add.circle(0, 0, 50, 0xe23b3b).setStrokeStyle(7, num(PALETTE.cream));
    const closeX = scene.add
      .text(0, -2, '✕', { fontFamily: FONT, fontSize: '52px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5);
    close.add([closeBg, closeX]);
    close.setSize(110, 110).setInteractive({ useHandCursor: true });
    close.on('pointerup', () => this.requestClose());

    this.cards = scene.add.container(0, 60);

    this.add([this.dim, this.titleBg, this.titleText, close, this.cards]);
    scene.add.existing(this);
    this.setVisible(false);
  }

  open(currency: Currency): void {
    const cfg = SHOP[currency];
    this.titleText.setText(cfg.title);
    this.drawBanner(this.titleText.width + 200);
    this.buildCards(currency, cfg);

    this.isOpen = true;
    this.setVisible(true).setAlpha(0).setScale(0.92);
    this.scene.tweens.add({ targets: this, alpha: 1, scale: 1, duration: 200, ease: 'Back.easeOut' });
  }

  requestClose(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scale: 0.94,
      duration: 150,
      ease: 'Sine.easeIn',
      onComplete: () => this.setVisible(false)
    });
  }

  private drawBanner(width: number): void {
    const w = Math.max(560, width);
    this.titleBg.clear();
    this.titleBg.fillStyle(PINK_DARK, 1);
    this.titleBg.fillRoundedRect(-w / 2, -484, w, 96, 28);
    this.titleBg.fillStyle(PINK, 1);
    this.titleBg.fillRoundedRect(-w / 2, -490, w, 92, 26);
    this.titleBg.lineStyle(6, ORANGE, 1);
    this.titleBg.strokeRoundedRect(-w / 2, -490, w, 92, 26);
  }

  private buildCards(currency: Currency, cfg: (typeof SHOP)[Currency]): void {
    this.cards.removeAll(true);
    const n = cfg.items.length;
    const gap = 430;
    const startX = -((n - 1) * gap) / 2;
    cfg.items.forEach((item, i) => {
      const isFreeFirst = currency === 'energy' && i === 0 && !sessionStorage.getItem('ek_energy_free_used');
      this.cards.add(this.makeCard(startX + i * gap, item, currency, cfg.icon, cfg.iconScale, isFreeFirst));
    });
  }

  private makeCard(
    x: number,
    item: Product,
    currency: Currency,
    icon: string,
    iconScale: number,
    isFreeFirst = false
  ): Phaser.GameObjects.Container {
    const W = 380;
    const H = 560;
    const card = this.scene.add.container(x, 0);
    const g = this.scene.add.graphics();
    g.fillStyle(PINK, 1);
    g.fillRoundedRect(-W / 2, -H / 2, W, H, 40);
    g.fillStyle(CREAM, 1);
    g.fillRoundedRect(-W / 2 + 16, -H / 2 + 16, W - 32, H - 32, 30);
    card.add(g);

    card.add(this.scene.add.image(0, -150, icon).setScale(iconScale));

    // Orange quantity ribbon.
    const ribbon = this.scene.add.graphics();
    ribbon.fillStyle(ORANGE, 1);
    ribbon.fillRect(-W / 2, 0, W, 84);
    card.add(ribbon);
    card.add(this.scene.add.image(-90, 42, icon).setScale(iconScale * 0.42));
    card.add(
      this.scene.add
        .text(-40, 42, `${item.amount.toLocaleString()}`, {
          fontFamily: FONT,
          fontSize: '52px',
          fontStyle: 'bold',
          color: '#ffffff'
        })
        .setOrigin(0, 0.5)
        .setShadow(0, 3, 'rgba(120,60,0,0.5)', 4)
    );

    // Green price button (mock purchase → grant the currency).
    const priceBtn = this.scene.add.container(0, 188);
    const pg = this.scene.add.graphics();
    const btnColor = isFreeFirst ? 0x22c55e : GREEN;
    const btnColorDark = isFreeFirst ? 0x16a34a : GREEN_DARK;
    pg.fillStyle(btnColorDark, 1);
    pg.fillRoundedRect(-130, -42 + 8, 260, 84, 42);
    pg.fillStyle(btnColor, 1);
    pg.fillRoundedRect(-130, -42, 260, 84, 42);
    const priceLabel = isFreeFirst ? 'FREE!' : item.price;
    const price = this.scene.add
      .text(0, -2, priceLabel, { fontFamily: FONT, fontSize: '46px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5)
      .setShadow(0, 3, 'rgba(30,80,10,0.7)', 4);
    priceBtn.add([pg, price]);
    priceBtn.setSize(260, 84).setInteractive({ useHandCursor: true });
    priceBtn.on('pointerover', () => priceBtn.setScale(1.05));
    priceBtn.on('pointerout', () => priceBtn.setScale(1));
    priceBtn.on('pointerup', () => {
      priceBtn.setScale(1);
      if (isFreeFirst) {
        sessionStorage.setItem('ek_energy_free_used', '1');
      }
      this.purchase(currency, item.amount, isFreeFirst);
    });
    card.add(priceBtn);

    if (item.best) {
      const badge = this.scene.add.container(-W / 2 + 30, -H / 2 + 24);
      const star = this.scene.add.star(0, 0, 12, 58, 74, 0xffd23f).setStrokeStyle(5, 0xe8a000);
      const txt = this.scene.add
        .text(0, 0, 'BEST\nSELLER', {
          fontFamily: FONT,
          fontSize: '22px',
          fontStyle: 'bold',
          color: '#b5402f',
          align: 'center'
        })
        .setOrigin(0.5);
      badge.add([star, txt]).setAngle(-12);
      card.add(badge);
    }
    return card;
  }

  private purchase(currency: Currency, amount: number, isFree = false): void {
    if (currency === 'energy') {
      this.bus.emit('energy:add', { amount, reason: 'shop' });
      this.bus.emit('marketplace:purchased', { energy: amount, free: isFree });
    } else if (currency === 'coins') {
      this.bus.emit('economy:add', { coins: amount, reason: 'shop' });
    } else {
      this.bus.emit('economy:add', { keys: amount, reason: 'shop' });
    }
    this.requestClose();
  }
}
