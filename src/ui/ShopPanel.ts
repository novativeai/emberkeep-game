import Phaser from 'phaser';
import { GAME_WIDTH, LIVE_GAME_HEIGHT, num, PALETTE } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import { uiRegistry } from './theme';

const FONT = 'Trebuchet MS, Verdana, sans-serif';
type Currency = 'energy' | 'coins';

/** Card height in game units (the ui_shop_card texture is 420×620). */
const CARD_H = 620;

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
  }
  // No Key shop: keys gate STORY and are never sold (MECHANICS §7 — monetise
  // impatience and friction, never progression).
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
  /** The current "FREE!" purchase button, while the energy shop shows one — the
   *  tutorial points its guiding hand here once the Emporium opens. */
  private freeBtn?: Phaser.GameObjects.Container;
  /** Sparkle/pulse tweens on the current cards — killed before every rebuild. */
  private fxTweens: Phaser.Tweens.Tween[] = [];

  constructor(
    scene: Phaser.Scene,
    private bus: EventBus
  ) {
    super(scene, GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2);

    this.dim = scene.add
      .rectangle(0, 0, GAME_WIDTH, LIVE_GAME_HEIGHT, num(PALETTE.night), 0.62)
      .setInteractive();
    this.dim.on('pointerup', () => this.requestClose());

    // The framed Emporium board (TextureFactory ui_shop_panel — themable).
    const frame = scene.add.image(0, 40, 'ui_shop_panel');

    // Title banner: gold-trimmed lava lozenge riding the panel's top edge.
    this.titleBg = scene.add.graphics();
    this.titleText = scene.add
      .text(0, -586, '', { fontFamily: FONT, fontSize: '64px', fontStyle: 'bold', color: PALETTE.cream })
      .setOrigin(0.5)
      .setShadow(0, 5, 'rgba(36,27,34,0.55)', 6);

    // Close button: gold disc chrome with a lava ✕.
    const close = scene.add.container(956, -540);
    const closeBg = scene.add.image(0, 6, 'ui_btn_round').setScale(0.92).setTint(num(PALETTE.lavaHighlight));
    const closeX = scene.add
      .text(0, -2, '✕', { fontFamily: FONT, fontSize: '54px', fontStyle: 'bold', color: PALETTE.lavaShade })
      .setOrigin(0.5);
    close.add([closeBg, closeX]);
    close.setSize(120, 120).setInteractive({ useHandCursor: true });
    close.on('pointerover', () => close.setScale(1.08));
    close.on('pointerout', () => close.setScale(1));
    close.on('pointerup', () => this.requestClose());

    this.cards = scene.add.container(0, 60);

    this.add([this.dim, frame, this.titleBg, this.titleText, close, this.cards]);
    scene.add.existing(this);
    this.setVisible(false);

    uiRegistry.register(scene, 'panel.shop', 'Ember Emporium panel', 'Panels', this, {
      frame,
      title: this.titleText,
      cards: this.cards
    });
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

  /** Screen position of the live "FREE!" button (UIScene camera is fixed, so the
   *  container's world transform IS its screen point), or null when the Emporium
   *  is closed or showing no free card. Drives the tutorial's guiding hand. */
  getFreeButtonPos(): { x: number; y: number } | null {
    if (!this.isOpen || !this.freeBtn?.active) return null;
    const m = this.freeBtn.getWorldTransformMatrix();
    return { x: m.tx, y: m.ty };
  }

  private drawBanner(width: number): void {
    const w = Math.max(620, width);
    const y = -640; // banner top (panel top edge is ≈ -620)
    const g = this.titleBg;
    g.clear();
    // Plate shadow, lava body, gold trim — the pseudo-3D language of the HUD.
    g.fillStyle(num(PALETTE.lavaShade), 1);
    g.fillRoundedRect(-w / 2, y + 10, w, 104, 34);
    g.fillStyle(num(PALETTE.lava), 1);
    g.fillRoundedRect(-w / 2, y, w, 104, 34);
    g.lineStyle(6, num(PALETTE.gold), 1);
    g.strokeRoundedRect(-w / 2, y, w, 104, 34);
    g.fillStyle(0xffffff, 0.22);
    g.fillRoundedRect(-w / 2 + 14, y + 8, w - 28, 34, 18);
    // Wing gems flanking the banner.
    for (const side of [-1, 1]) {
      const gx = side * (w / 2 + 44);
      g.fillStyle(num(PALETTE.gold), 1);
      g.save();
      g.translateCanvas(gx, y + 52);
      g.rotateCanvas(Math.PI / 4);
      g.fillRect(-16, -16, 32, 32);
      g.lineStyle(4, num(PALETTE.goldShade), 1);
      g.strokeRect(-16, -16, 32, 32);
      g.restore();
    }
  }

  private buildCards(currency: Currency, cfg: (typeof SHOP)[Currency]): void {
    for (const t of this.fxTweens) t.remove();
    this.fxTweens = [];
    this.cards.removeAll(true);
    this.freeBtn = undefined; // rebuilt below only if this open shows a FREE! card
    const n = cfg.items.length;
    const gap = 470;
    const startX = -((n - 1) * gap) / 2;
    cfg.items.forEach((item, i) => {
      const isFreeFirst = currency === 'energy' && i === 0 && !sessionStorage.getItem('ek_energy_free_used');
      const card = this.makeCard(startX + i * gap, item, currency, cfg.icon, cfg.iconScale, isFreeFirst, i);
      // The BEST VALUE card is the hero of the shelf: a touch larger + raised.
      if (item.best) card.setScale(1.07).setY(-10);
      this.cards.add(card);
    });
  }

  private makeCard(
    x: number,
    item: Product,
    currency: Currency,
    icon: string,
    iconScale: number,
    isFreeFirst = false,
    tier = 0
  ): Phaser.GameObjects.Container {
    const card = this.scene.add.container(x, 0);

    // Textured card face (gold rim, cream face, gloss, stitching).
    card.add(this.scene.add.image(0, 0, 'ui_shop_card'));

    // The product on a lit stage: radial sunburst behind a BIG icon.
    const burst = this.scene.add.image(0, -128, 'ui_shop_burst').setScale(1.35);
    card.add(burst);
    // Bigger bundle → bigger goods on the stage (reads at a glance).
    const tierScale = [1.05, 1.3, 1.55][tier] ?? 1.3;
    const productIcon = this.scene.add.image(0, -128, icon).setScale(iconScale * tierScale);
    card.add(productIcon);
    // Slow ambient spin on the rays sells the "prize" feel.
    this.fxTweens.push(
      this.scene.tweens.add({ targets: burst, angle: 360, duration: 24000, repeat: -1 })
    );

    // Amount on a chevron-notched gold ribbon.
    const ribbon = this.scene.add.image(0, 52, 'ui_shop_ribbon');
    card.add(ribbon);
    card.add(
      this.scene.add
        .text(0, 50, `×${item.amount.toLocaleString()}`, {
          fontFamily: FONT,
          fontSize: '48px',
          fontStyle: 'bold',
          color: '#FFFFFF'
        })
        .setOrigin(0.5)
        .setShadow(0, 3, 'rgba(120,60,0,0.55)', 4)
    );

    // Beveled price button (TextureFactory pseudo-3D chrome; FREE! is gold).
    const priceBtn = this.scene.add.container(0, 208);
    const btnImg = this.scene.add.image(0, 0, isFreeFirst ? 'ui_btn_free' : 'ui_btn_price');
    const priceLabel = isFreeFirst ? 'FREE!' : item.price;
    const price = this.scene.add
      .text(0, -8, priceLabel, { fontFamily: FONT, fontSize: '48px', fontStyle: 'bold', color: '#FFFFFF' })
      .setOrigin(0.5)
      .setShadow(0, 3, 'rgba(36,27,34,0.55)', 4);
    priceBtn.add([btnImg, price]);
    if (isFreeFirst) this.freeBtn = priceBtn; // tutorial hand anchors here
    priceBtn.setSize(460, 132);
    btnImg.setInteractive({ useHandCursor: true });
    btnImg.on('pointerover', () => priceBtn.setScale(1.06));
    btnImg.on('pointerout', () => priceBtn.setScale(1));
    btnImg.on('pointerup', () => {
      priceBtn.setScale(1);
      if (isFreeFirst) {
        sessionStorage.setItem('ek_energy_free_used', '1');
      }
      this.purchase(currency, item.amount, isFreeFirst);
    });
    card.add(priceBtn);
    if (isFreeFirst) {
      // A gentle heartbeat so the tutorial's free gift reads as tappable.
      this.fxTweens.push(
        this.scene.tweens.add({
          targets: priceBtn,
          scale: { from: 1, to: 1.07 },
          duration: 560,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        })
      );
    }

    // BEST VALUE sash pill riding the card's top edge.
    if (item.best) {
      const badge = this.scene.add.container(0, -CARD_H / 2 + 6);
      badge.add(this.scene.add.image(0, 0, 'ui_shop_badge').setScale(1.15));
      badge.add(
        this.scene.add
          .text(0, -3, 'BEST VALUE', {
            fontFamily: FONT,
            fontSize: '26px',
            fontStyle: 'bold',
            color: PALETTE.cream
          })
          .setOrigin(0.5)
          .setShadow(0, 2, 'rgba(36,27,34,0.5)', 3)
      );
      card.add(badge);
    }

    // Sparkles on the hero cards (best seller + the free gift).
    if (item.best || isFreeFirst) {
      for (const [sx, sy, d] of [[-150, -240, 0], [150, -70, 400], [120, -250, 800]]) {
        const spark = this.scene.add.image(sx!, sy!, 'fx_spark').setScale(0.9).setAlpha(0);
        card.add(spark);
        this.fxTweens.push(
          this.scene.tweens.add({
            targets: spark,
            alpha: { from: 0, to: 1 },
            scale: { from: 0.4, to: 1.05 },
            angle: 90,
            delay: d!,
            duration: 900,
            yoyo: true,
            repeat: -1,
            repeatDelay: 700,
            ease: 'Sine.easeInOut'
          })
        );
      }
    }
    return card;
  }

  private purchase(currency: Currency, amount: number, isFree = false): void {
    if (currency === 'energy') {
      this.bus.emit('energy:add', { amount, reason: 'shop' });
      this.bus.emit('marketplace:purchased', { energy: amount, free: isFree });
    } else {
      this.bus.emit('economy:add', { coins: amount, reason: 'shop' });
    }
    this.requestClose();
  }
}
