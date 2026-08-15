import Phaser from 'phaser';
import { IS_MOBILE, LIVE_GAME_HEIGHT, LIVE_GAME_WIDTH, num, panelFitScale, panelMobileScale } from '../core/Constants';
import { FONT, INK } from '../art/design';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import { iapBridge } from '../core/iapBridge';
import { uiRegistry } from './theme';

type Currency = 'energy' | 'coins';

interface Product {
  amount: number;
  /** Real-money price tag ("€2.99"). Mock values when the hub isn't there. */
  price: string;
  /** In-game GOLD price — the demo's Warmth refills are bought with the Gold
   *  the player earns (MECHANICS §7: Gold buys comfort, never progression). */
  gold?: number;
  best?: boolean;
  /** Shelf name, so a pack reads as a good rather than as a number. */
  name: string;
  /** Set when this row is a REAL hub pack — tapping it starts the purchase
   *  flow (`ui:iap_buy_requested`) instead of the mock grant. */
  packId?: string;
}
const SHOP: Record<Currency, { title: string; tab: string; icon: string; iconScale: number; items: Product[] }> = {
  energy: {
    title: 'Warmth',
    tab: 'WARMTH',
    icon: 'ui_icon_bolt',
    iconScale: 1.4,
    items: [
      { amount: 5, price: '', gold: 20, name: 'Ember Spark' },
      { amount: 20, price: '', gold: 60, best: true, name: 'Hearth Bundle' },
      { amount: 50, price: '', gold: 130, name: 'Keeper’s Blaze' }
    ]
  },
  coins: {
    title: 'Gold',
    tab: 'GOLD',
    icon: 'ui_icon_coin',
    iconScale: 0.34,
    items: [
      { amount: 200, price: '$2.99', name: 'Coin Purse' },
      { amount: 900, price: '$9.99', best: true, name: 'Merchant’s Chest' },
      { amount: 2100, price: '$19.99', name: 'Dragon’s Hoard' }
    ]
  }
  // No Key shop: keys gate STORY and are never sold (MECHANICS §7 — monetise
  // impatience and friction, never progression).
};

/* ---------------------------------------------------------------------------
 * Geometry, in GAME units, measured off the `ui_shop_panel` texture. The
 * painter authors in logical units and Phaser draws at logical×RES, so one
 * logical unit is two game units — every number here is already doubled.
 * ------------------------------------------------------------------------ */
/**
 * Device layout. Desktop is the landscape hall; a phone gets the PORTRAIT hall
 * (`ui_shop_panel_tall`) with every pack as a two-line card — goods left, name
 * and amount stacked, price plate riding low-right — because the landscape
 * row's single-line flow has no room at phone width.
 */
const SL = IS_MOBILE
  ? {
      frameKey: 'ui_shop_panel_tall',
      cardKey: 'ui_shop_card_tall', cardHotKey: 'ui_shop_card_tall_hot',
      plaqueX: 0, plaqueY: -1790, plaqueScale: 1.5, plaqueFont: 76,
      walletY: -1520, walletX: [-430, 430] as const, walletScale: 1.6,
      closeX: 960, closeY: -1790, closeScale: 1.5,
      tabY: -1236, tabGap: 1150, tabScale: 1.5, tabFont: 58,
      shelfTop: -1150, shelfH: 2700, rowH: 560, rowGap: 70,
      artX: -660, pileUnit: 170, burstScale: 2.6,
      textX: -360, nameY: -116, nameFont: 66, amountY: -8, amountFont: 54, bonusFont: 50,
      tagX: -360, tagY: 116, tagScale: 1.5,
      priceX: 620, priceY: 84, priceScale: 1.5
    }
  : {
      frameKey: 'ui_shop_panel',
      cardKey: 'ui_shop_card', cardHotKey: 'ui_shop_card_hot',
      plaqueX: -740, plaqueY: -600, plaqueScale: 1, plaqueFont: 58,
      walletY: -600, walletX: [380, 760] as const, walletScale: 1,
      closeX: 1040, closeY: -600, closeScale: 1,
      tabY: -280 - 60, tabGap: 620, tabScale: 1, tabFont: 44,
      shelfTop: -280, shelfH: 928, rowH: 224, rowGap: 30,
      artX: -680, pileUnit: 100, burstScale: 1.9,
      textX: -500, nameY: -34, nameFont: 46, amountY: 34, amountFont: 34, bonusFont: 32,
      tagX: 150, tagY: 0, tagScale: 1,
      priceX: 640, priceY: 0, priceScale: 1
    };

/* ---------------------------------------------------------------------------
 * The shelf is a LIST OF ROWS, which is the shape a currency shop actually
 * wants. Showcase cards were the wrong furniture: three of them left the panel
 * mostly empty and the only place left to hang a tag was a corner, where the
 * ribbon and the value chip both ended up riding ON the frame.
 *
 * Every row is the same height and every label sits in FLOW along it — goods,
 * name, sub-line, tag, price, left to right — so nothing is positioned against
 * an edge and nothing can collide with its neighbour.
 * ------------------------------------------------------------------------ */


/** Painted glyphs (the ⚡ bolt) are authored at 44 logical units; blowing one up
 *  to fill a shop plate turns it to mush. Art is fitted to the slot but never
 *  upscaled past this, so a small source stays crisp and leans on its glow pool
 *  for presence instead. */
const MAX_ART_UPSCALE = 1.5;

function fitArt(img: Phaser.GameObjects.Image, slot: number): void {
  const natural = Math.max(img.width, img.height);
  img.setScale(Math.min(slot / natural, MAX_ART_UPSCALE));
}

/**
 * The Ember Emporium — the currency shop, and the one screen in Emberkeep that
 * does not wear the board's chrome.
 *
 * Its look is taken from the Seedream concept at
 * `assets/raw/shop-concept/generations/bakeoff-seedream-pro.png`: a deep plum
 * hall lit from above, milled gold frames with corner clasps, goods standing in
 * pools of warm light, and one bright cream plate carrying the price. That
 * contrast is the whole point — a shop should feel like somewhere you have
 * WALKED INTO, not like another sheet of the same parchment the Ledger is
 * printed on. `SHOP_INK` (TextureFactory) holds the sampled values.
 *
 * Content is still MECHANICS §7: the WARMTH shelf is a real GOLD SINK (after
 * the one-time free Ember Spark, refills cost earned Gold). The GOLD shelf is
 * the REAL IAP shop when the game runs inside the EmberGames hub — packs and
 * EUR prices arrive over `iapBridge`, and tapping one starts the confirm →
 * secure-checkout flow (`ui:iap_buy_requested`). Standalone builds keep the
 * authored mock tags as the showcase, since there is no gateway to charge.
 * The two are tabs of one hall, which is what lets a player who came for
 * Warmth see what Gold is for.
 */
export class ShopPanel extends Phaser.GameObjects.Container {
  isOpen = false;
  private dim: Phaser.GameObjects.Rectangle;
  private plaqueText: Phaser.GameObjects.Text;
  private shelf: Phaser.GameObjects.Container;
  private tabs: Phaser.GameObjects.Container;
  private walletGold: Phaser.GameObjects.Text;
  private walletWarmth: Phaser.GameObjects.Text;
  /** The current "FREE" purchase plate, while the Warmth shelf shows one — the
   *  tutorial points its guiding hand here once the Emporium opens. */
  private freeBtn?: Phaser.GameObjects.Container;
  /** Pulse tweens on the live shelf — killed before every rebuild. */
  private fxTweens: Phaser.Tweens.Tween[] = [];
  /** Open/rest scale — >1 on mobile so the frame fills the portrait width. */
  private baseScale = 1;
  private currency: Currency = 'energy';
  private readonly offBus: Array<() => void> = [];

  constructor(
    scene: Phaser.Scene,
    private bus: EventBus,
    private gameState: GameState
  ) {
    super(scene, LIVE_GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2);

    // Near-opaque scrim. The concept shows the world reduced to a dark blur
    // beyond the frame; a light dim would leave the board competing with goods
    // it is not selling.
    this.dim = scene.add
      .rectangle(0, 0, LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, num(INK.fieldDeep), 0.88)
      .setInteractive();
    this.dim.on('pointerup', () => this.requestClose());

    const frame = scene.add.image(0, 0, SL.frameKey);
    this.baseScale = IS_MOBILE ? panelFitScale(frame.width, frame.height) : panelMobileScale(frame.width);

    // ---- Title bar: name plate left, wallet + close right ----
    const plaque = scene.add.image(SL.plaqueX, SL.plaqueY, 'ui_shop_plaque').setScale(SL.plaqueScale);
    this.plaqueText = scene.add
      .text(SL.plaqueX, SL.plaqueY - 2, 'EMPORIUM', {
        fontFamily: FONT.ui,
        fontSize: `${SL.plaqueFont}px`,
        fontStyle: 'bold',
        color: INK.onPlate
      })
      .setOrigin(0.5);

    const [goldChip, goldText] = this.wallet(SL.walletX[0], 'ui_icon_coin');
    const [warmthChip, warmthText] = this.wallet(SL.walletX[1], 'ui_icon_bolt');
    this.walletGold = goldText;
    this.walletWarmth = warmthText;

    const close = scene.add.container(SL.closeX, SL.closeY);
    const closeRing = scene.add.image(0, 0, 'ui_shop_close');
    const closeX = scene.add
      .text(0, -2, '✕', { fontFamily: FONT.ui, fontSize: '52px', fontStyle: 'bold', color: INK.goldHi })
      .setOrigin(0.5);
    close.add([closeRing, closeX]);
    close.setScale(SL.closeScale);
    close.setSize(140, 140).setInteractive({ useHandCursor: true });
    close.on('pointerover', () => close.setScale(SL.closeScale * 1.08));
    close.on('pointerout', () => close.setScale(SL.closeScale));
    close.on('pointerup', () => this.requestClose());

    this.tabs = scene.add.container(0, SL.tabY);
    this.shelf = scene.add.container(0, 0);

    this.add([this.dim, frame, plaque, this.plaqueText, goldChip, warmthChip, close, this.tabs, this.shelf]);
    scene.add.existing(this);
    this.setVisible(false);

    uiRegistry.register(scene, 'panel.shop', 'Ember Emporium panel', 'Panels', this, {
      frame,
      title: this.plaqueText,
      plaque,
      cards: this.shelf
    });

    this.offBus.push(bus.on('economy:changed', () => this.refreshWallet()));
    this.offBus.push(bus.on('energy:changed', () => this.refreshWallet()));
    // The hub's pack catalog can arrive after the panel was opened.
    this.offBus.push(
      bus.on('iap:catalog_changed', () => {
        if (this.isOpen && this.currency === 'coins') this.build();
      })
    );
  }

  teardown(): void {
    this.offBus.forEach((off) => off());
    this.offBus.length = 0;
  }

  open(currency: Currency): void {
    this.currency = currency;
    this.build();

    this.isOpen = true;
    this.setVisible(true).setAlpha(0).setScale(this.baseScale * 0.94);
    this.scene.tweens.add({
      targets: this,
      alpha: 1,
      scale: this.baseScale,
      duration: 220,
      ease: 'Back.easeOut'
    });
  }

  requestClose(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scale: this.baseScale * 0.96,
      duration: 150,
      ease: 'Sine.easeIn',
      onComplete: () => this.setVisible(false)
    });
  }

  /** Screen position of the live FREE plate (UIScene camera is fixed, so the
   *  container's world transform IS its screen point), or null when the Emporium
   *  is closed or showing no free offer. Drives the tutorial's guiding hand. */
  getFreeButtonPos(): { x: number; y: number } | null {
    if (!this.isOpen || !this.freeBtn?.active) return null;
    const m = this.freeBtn.getWorldTransformMatrix();
    return { x: m.tx, y: m.ty };
  }

  /* --------------------------------------------------------------- chrome */

  /** One wallet chip in the title bar: dark lozenge, icon, live count. */
  private wallet(x: number, icon: string): [Phaser.GameObjects.Container, Phaser.GameObjects.Text] {
    const chip = this.scene.add.container(x, SL.walletY).setScale(SL.walletScale);
    const bg = this.scene.add.image(0, 0, 'ui_shop_wallet');
    // Icons arrive at wildly different authored sizes (the coin is a big
    // detailed PNG, the bolt a 44-unit painted glyph) — fit both to the chip's
    // socket rather than trusting a per-icon multiplier.
    const iconImg = this.scene.add.image(-118, 0, icon);
    fitArt(iconImg, 76);
    const text = this.scene.add
      .text(30, 0, '0', { fontFamily: FONT.ui, fontSize: '42px', fontStyle: 'bold', color: INK.onField })
      .setOrigin(0.5);
    chip.add([bg, iconImg, text]);
    return [chip, text];
  }

  private refreshWallet(): void {
    this.walletGold.setText(`${this.gameState.coins.toLocaleString()}`);
    this.walletWarmth.setText(`${this.gameState.energyCurrent}/${this.gameState.energyMax}`);
  }

  private buildTabs(): void {
    this.tabs.removeAll(true);
    const order: Currency[] = ['energy', 'coins'];
    const gap = SL.tabGap;
    order.forEach((cur, i) => {
      const active = cur === this.currency;
      const tab = this.scene.add.container((i - (order.length - 1) / 2) * gap, 0).setScale(SL.tabScale);
      tab.add(this.scene.add.image(0, 0, active ? 'ui_shop_tab_on' : 'ui_shop_tab'));
      tab.add(
        this.scene.add
          .text(0, -6, SHOP[cur].tab, {
            fontFamily: FONT.ui,
            fontSize: `${SL.tabFont}px`,
            fontStyle: 'bold',
            color: active ? INK.onField : INK.onFieldDim
          })
          .setOrigin(0.5)
      );
      if (!active) {
        tab.setSize(600, 108).setInteractive({ useHandCursor: true });
        tab.on('pointerup', () => {
          this.currency = cur;
          this.build();
        });
      }
      this.tabs.add(tab);
    });
  }

  /* ---------------------------------------------------------------- shelf */

  /**
   * The shelf is a FEATURE over a pair of plates. Which pack is featured is not
   * cosmetic: while the one-time free Ember Spark is unclaimed it takes the
   * banner, because a gift the player has to hunt for on a shelf is a gift that
   * gets missed (and the tutorial's guiding hand points at it). Once it is
   * spent, the best-value pack inherits the spot.
   */
  private build(): void {
    for (const t of this.fxTweens) t.remove();
    this.fxTweens = [];
    this.shelf.removeAll(true);
    this.freeBtn = undefined;
    this.buildTabs();
    this.refreshWallet();

    const cfg = SHOP[this.currency];
    const items = this.shelfItems();
    // The one-time free Ember Spark leads the shelf while it is unclaimed — a
    // gift further down a list is a gift that gets missed, and the tutorial's
    // guiding hand points at it. Otherwise the order is as authored.
    const freeIndex =
      this.currency === 'energy' && this.gameState.stat('freeSparkUsed') === 0 ? 0 : -1;
    const order = items.map((item, tier) => ({ item, tier }));
    if (freeIndex >= 0) order.unshift(...order.splice(freeIndex, 1));

    const total = order.length * SL.rowH + (order.length - 1) * SL.rowGap;
    const top = SL.shelfTop + (SL.shelfH - total) / 2 + SL.rowH / 2;
    order.forEach(({ item, tier }, i) => {
      const y = top + i * (SL.rowH + SL.rowGap);
      this.shelf.add(this.makeRow(item, cfg, items, tier, y, freeIndex >= 0 && i === 0));
    });
  }

  /**
   * What the current shelf actually sells. The WARMTH shelf is always the
   * authored gold-sink. The GOLD shelf is the REAL hub catalog whenever the
   * game runs inside EmberGames (prices in EUR, checkout via the bridge) and
   * falls back to the authored mock showcase standalone, where there is no
   * gateway to charge anyone.
   */
  private shelfItems(): Product[] {
    if (this.currency === 'coins') {
      const packs = iapBridge.coinPacks();
      if (packs.length > 0) {
        const biggest = Math.max(...packs.map((p) => p.coins));
        return packs.map((p) => ({
          amount: p.coins,
          price: `€${p.amountEur.toFixed(2)}`,
          name: p.name,
          best: packs.length > 1 && p.coins === biggest,
          packId: p.id
        }));
      }
    }
    return SHOP[this.currency].items;
  }

  /**
   * Goods drawn as a PILE rather than as one icon.
   *
   * Two problems, one answer. A painted glyph is authored at 44 logical units
   * and cannot be blown up to fill a shop plate without going to mush
   * (MAX_ART_UPSCALE), and a single small icon adrift in a wide bay reads as a
   * placeholder rather than as merchandise. Several of the thing solves both —
   * and the count doing the work means the size of the heap IS the size of the
   * bundle, which is the fastest read of "this one gives you more" there is.
   */
  private pile(
    cx: number,
    cy: number,
    icon: string,
    tier: number,
    unit: number
  ): Phaser.GameObjects.Container {
    const heap = this.scene.add.container(cx, cy);
    // Back row first (higher, smaller, dimmer) so the front row overlaps it.
    const LAYOUTS: Array<Array<[number, number, number]>> = [
      [[-0.34, -0.2, 0.88], [0.34, -0.2, 0.88], [0, 0.16, 1.06]],
      [[-0.58, -0.22, 0.82], [0, -0.34, 0.9], [0.58, -0.22, 0.82], [-0.3, 0.17, 1.06], [0.3, 0.17, 1.06]],
      [
        [-0.72, -0.2, 0.78], [-0.24, -0.35, 0.86], [0.24, -0.35, 0.86], [0.72, -0.2, 0.78],
        [-0.46, 0.18, 1.02], [0, 0.27, 1.12], [0.46, 0.18, 1.02]
      ]
    ];
    const layout = LAYOUTS[Math.min(tier, LAYOUTS.length - 1)]!;
    layout.forEach(([dx, dy, s], i) => {
      const img = this.scene.add.image(dx * unit, dy * unit, icon);
      const natural = Math.max(img.width, img.height);
      img.setScale(Math.min(unit / natural, MAX_ART_UPSCALE) * s);
      // The back of a heap sits in its own shadow. A LIGHT tint reads as faded
      // paper, not as depth — this has to actually darken.
      if (dy < 0) img.setTint(0x8a6f63);
      img.setAngle((i % 2 === 0 ? -1 : 1) * (4 + (i % 3) * 3));
      heap.add(img);
    });
    return heap;
  }

  /**
   * How much further the same money goes on this pack than on the entry one,
   * as a percentage. DERIVED from the amounts and prices already in `SHOP` —
   * nothing here touches the economy, it just stops the shelf asking the player
   * to do the division in their head.
   *
   * A shop that asserts "BEST VALUE" without ever showing the number is the
   * thing that makes a store read as placeholder art, so the claim and the
   * arithmetic behind it ship together or not at all.
   */
  private bonusPercent(items: Product[], item: Product): number {
    const rate = (p: Product): number => {
      const cost = p.gold ?? Number(p.price.replace(/[^0-9.]/g, ''));
      return cost > 0 ? p.amount / cost : 0;
    };
    const base = rate(items[0]!);
    if (!base) return 0;
    return Math.round((rate(item) / base - 1) * 100);
  }

  /**
   * Which pack may wear which tag.
   *
   * Printing the bonus percentages caught the shelf contradicting itself: the
   * ×20 pack carried "BEST VALUE" while the ×50 beside it returned a better
   * rate (+54% vs +33%). The tag was decoration, and the arithmetic exposed it.
   *
   * So the two claims are now separate and both true. BEST VALUE is DERIVED —
   * it goes to whichever pack actually returns the most per unit spent, and
   * moves on its own if pricing ever changes. The authored `best` flag keeps
   * doing what it was really for (the highlight and the banner slot) under its
   * honest name, MOST POPULAR.
   */
  private tagFor(items: Product[], item: Product, isFree: boolean): string | null {
    if (isFree) return 'GIFT';
    const bonuses = items.map((i) => this.bonusPercent(items, i));
    const topValue = items[bonuses.indexOf(Math.max(...bonuses))];
    if (item === topValue) return 'BEST VALUE';
    return item.best ? 'MOST POPULAR' : null;
  }

  private makeRow(
    item: Product,
    cfg: (typeof SHOP)[Currency],
    items: Product[],
    tier: number,
    y: number,
    isFree: boolean
  ): Phaser.GameObjects.Container {
    const row = this.scene.add.container(0, y);
    row.add(this.scene.add.image(0, 0, item.best || isFree ? SL.cardHotKey : SL.cardKey));

    // Goods, heaped in their own pool of light.
    row.add(
      this.scene.add.image(SL.artX, -4, 'ui_shop_burst').setScale(SL.burstScale).setAlpha(isFree || item.best ? 0.95 : 0.6)
    );
    row.add(this.pile(SL.artX, -8, cfg.icon, tier, SL.pileUnit));

    row.add(
      this.scene.add
        .text(SL.textX, SL.nameY, item.name.toUpperCase(), {
          fontFamily: FONT.ui,
          fontSize: `${SL.nameFont}px`,
          fontStyle: 'bold',
          color: INK.onField
        })
        .setOrigin(0, 0.5)
        .setShadow(0, 4, 'rgba(0,0,0,0.6)', 7)
    );
    // The sub-line carries the amount and, when there is one, the value bonus —
    // inline, so the shelf never needs a chip pinned to a corner to say it.
    const amount = this.scene.add
      .text(SL.textX + 4, SL.amountY, `${cfg.title} ×${item.amount.toLocaleString()}`, {
        fontFamily: FONT.ui,
        fontSize: `${SL.amountFont}px`,
        color: INK.onFieldDim
      })
      .setOrigin(0, 0.5);
    row.add(amount);
    const bonus = this.bonusPercent(items, item);
    if (!isFree && bonus >= 5) {
      row.add(
        this.scene.add
          .text(SL.textX + 4 + amount.width + 26, SL.amountY, `+${bonus}% MORE`, {
            fontFamily: FONT.ui,
            fontSize: `${SL.bonusFont}px`,
            fontStyle: 'bold',
            color: INK.goldHi
          })
          .setOrigin(0, 0.5)
      );
    }

    const tag = this.tagFor(items, item, isFree);
    if (tag) row.add(this.ribbon(SL.tagX, SL.tagY, tag));
    row.add(this.pricePlate(SL.priceX, SL.priceY, item, isFree, SL.priceScale));
    return row;
  }

  /** The parchment tag, sitting in the row's flow rather than on its edge. */
  private ribbon(x: number, y: number, label: string): Phaser.GameObjects.Container {
    const tag = this.scene.add.container(x, y).setScale(SL.tagScale);
    tag.add(this.scene.add.image(0, 0, 'ui_shop_ribbon').setOrigin(0, 0.5));
    // The parchment body runs x 6..214 in game units; its text rides the same
    // -0.11rad tilt the painter gave the paper.
    tag.add(
      this.scene.add
        .text(108, 2, label, { fontFamily: FONT.ui, fontSize: '24px', fontStyle: 'bold', color: '#6B4A2A' })
        .setOrigin(0.5)
        .setAngle(-6.3)
    );
    return tag;
  }

  /**
   * The cream price plate — the only bright element on the panel, and the one
   * the player is actually deciding about. Tapping it buys.
   */
  private pricePlate(
    x: number,
    y: number,
    item: Product,
    isFree: boolean,
    scale: number
  ): Phaser.GameObjects.Container {
    const btn = this.scene.add.container(x, y).setScale(scale);
    const bg = this.scene.add.image(0, 0, 'ui_shop_price');
    btn.add(bg);

    const label = isFree ? 'FREE' : item.gold !== undefined ? `${item.gold}` : item.price;
    // A gold-priced pack shows the coin it costs; the IAP tags read as money.
    if (!isFree && item.gold !== undefined) {
      const coin = this.scene.add.image(-96, 0, 'ui_icon_coin');
      fitArt(coin, 54);
      btn.add(coin);
    }
    const text = this.scene.add
      .text(item.gold !== undefined && !isFree ? 22 : 0, -2, label, {
        fontFamily: FONT.ui,
        fontSize: '46px',
        fontStyle: 'bold',
        color: INK.onPlate
      })
      .setOrigin(0.5);
    btn.add(text);

    if (isFree) this.freeBtn = btn; // tutorial hand anchors here
    btn.setSize(420, 112);
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => btn.setScale(scale * 1.06));
    bg.on('pointerout', () => btn.setScale(scale));
    bg.on('pointerup', () => {
      btn.setScale(scale);
      // A REAL hub pack: hand the intent to UIScene (confirm dialog → secure
      // checkout). The Emporium stays open — the wallet updates live when the
      // grant lands, which is the shop's own receipt.
      if (item.packId) {
        this.bus.emit('ui:iap_buy_requested', { packId: item.packId });
        return;
      }
      // GOLD-priced pack: check the coffer; deny with a shake + red flash when
      // short (the coins never go negative).
      if (!isFree && item.gold !== undefined) {
        if (this.gameState.coins < item.gold) {
          text.setColor('#C4361F');
          this.scene.time.delayedCall(450, () => text.setColor(INK.onPlate));
          this.scene.tweens.add({ targets: btn, x: btn.x + 10, duration: 45, yoyo: true, repeat: 3 });
          return;
        }
        this.bus.emit('economy:add', { coins: -item.gold, reason: 'shop:warmth' });
      }
      this.purchase(this.currency, item.amount, isFree);
    });

    if (isFree) {
      // A gentle heartbeat so the gift reads as tappable.
      this.fxTweens.push(
        this.scene.tweens.add({
          targets: btn,
          scale: { from: scale, to: scale * 1.07 },
          duration: 560,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        })
      );
    }
    return btn;
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
