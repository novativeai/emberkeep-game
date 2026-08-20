import Phaser from 'phaser';
import { LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, num, panelMobileScale } from '../core/Constants';
import { FONT, INK } from '../art/design';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import { coinOffers, priceOf } from '../core/coinPacks';
import { iapBridge } from '../core/iapBridge';
import { uiRegistry } from './theme';

type Currency = 'energy' | 'coins';

interface Product {
  amount: number;
  /** Real-money price tag, ALWAYS in EUR and always formatted by
   *  `coinPacks.priceOf` — the hub's catalog is EUR and so is the authored
   *  showcase that stands in for it. Empty on a Gold-priced row. */
  price: string;
  /** In-game GOLD price — the demo's Warmth refills are bought with the Gold
   *  the player earns (MECHANICS §7: Gold buys comfort, never progression). */
  gold?: number;
  best?: boolean;
  /** Shelf name, so a pack reads as a good rather than as a number. */
  name: string;
  /** Set when this row is a REAL hub pack — tapping it starts the purchase
   *  flow (`ui:iap_buy_requested`) instead of the mock grant. Its PRESENCE is
   *  the routing rule; `shelfItems()` is the only thing that sets it, from
   *  `coinOffers()` on the Gold shelf and `iapBridge.warmthPacks()` on Warmth. */
  packId?: string;
}
/**
 * The two shelves' CHROME. The WARMTH shelf's GOLD-SINK goods are authored
 * right here, because Gold is a game number; the GOLD shelf's are
 * NOT, because they are money. `src/data/coin-packs.json` is the one place a
 * coin pack is written down and `coinOffers()` is the one thing that reads it
 * (see src/core/coinPacks.ts) — the dollar-priced copy that used to live here
 * beside a EUR catalog was a divergence with a currency symbol on it.
 */
const SHOP: Record<Currency, { title: string; tab: string; icon: string; iconScale: number; items?: Product[] }> = {
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
    // A hub Warmth pack, when the hub sells one, is APPENDED to these by
    // `shelfItems()` — real money under the Gold sink, in that order, so the
    // earned way through is the one the eye reaches first.
  },
  coins: {
    title: 'Gold',
    tab: 'GOLD',
    icon: 'ui_icon_coin',
    iconScale: 0.34
  }
  // No Key shop: keys gate STORY and are never sold (MECHANICS §7 — monetise
  // impatience and friction, never progression).
};

/* ---------------------------------------------------------------------------
 * Geometry, in GAME units, measured off the `ui_shop_panel` texture. The
 * painter authors in logical units and Phaser draws at logical×RES, so one
 * logical unit is two game units — every number here is already doubled.
 * ------------------------------------------------------------------------ */
/** Title bar: name plate, wallet chips, close ring. */
const BAR_Y = -600;
/** Content box (the tabbed shelf) — the tabs bite into its top edge. */
const SHELF_TOP = -280;
/** Tab art is 148 tall and its bottom 28 are a borderless lip, so seating the
 *  centre here drops that lip OVER the shelf's top edge and the active tab
 *  reads as part of the shelf rather than as a button above it. */
const TAB_Y = SHELF_TOP - 60;

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
/** Inner height of the content box, from `ui_shop_panel`'s own geometry. */
const SHELF_H = 928;
const ROW_H = 224;
const ROW_GAP = 30;
/** Row slots, measured from the row's centre. */
const ROW_ART_X = -680;
const ROW_TEXT_X = -500;
const ROW_TAG_X = 150;
const ROW_PRICE_X = 640;

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
 * the one-time free Ember Spark, refills cost earned Gold) — and, when the hub
 * sells one, a real-money refill APPENDED under it. Both, in that order: the
 * earned way through is the one the eye reaches first, and the euro row is the
 * impatient way past it, never the only way. The GOLD shelf is the REAL IAP
 * shop when the game runs inside the EmberGames hub — packs and EUR prices
 * arrive over `iapBridge`, and tapping either shelf's pack starts the confirm →
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
    // ONLY THE ✕ CLOSES — the canonical note for all eight panels.
    //
    // Tap-outside-to-close is a mouse idiom. It survives a cursor, which lands
    // on one pixel and lifts from the same one; it does not survive a thumb on
    // a phone, where a scroll of the shelf is a press, a drag and a release,
    // and Phaser reports the release as a `pointerup` on whatever is under the
    // finger at the end — very often the dim, because the shelf is narrower
    // than the screen. So every attempt to browse shut the panel, and the
    // player never got to read a card. The close key is 96 units of gold in
    // the corner of every panel in this game; it is not hard to find, and it
    // is the only thing that should be able to take the panel away.
    //
    // THE DIM STILL SWALLOWS, AND IT SWALLOWS BY EXISTING. Being interactive is
    // the whole mechanism: Phaser walks the live scenes top-down on a pointer
    // event and stops at the first that captured, so a screen-sized interactive
    // rectangle in UIScene is what keeps a tap meant for the shop off the board.
    //
    // What it must NOT do is call `stopPropagation`. Within one scene
    // `InputPlugin.topOnly` is true by default and this project never overrides
    // it, so the pointerup reaches the top object and nothing beneath — the HUD
    // keys under a scrim were never hearing it, and there is nothing to cancel
    // for. What cancelling DOES reach is the scene-level `POINTER_UP`, which
    // `processUpEvents` skips once `_eventData.cancelled` is set — and that is
    // the event on which StorePanel, CookbookPanel and CauldronPanel release
    // their scroll drag. Cancel it and `dragFrom` is never nulled and the shelf
    // follows a cursor with no button held. Tried, measured, taken back out.
    this.dim = scene.add
      .rectangle(0, 0, LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, num(INK.fieldDeep), 0.88)
      .setInteractive();

    const frame = scene.add.image(0, 0, 'ui_shop_panel');
    this.baseScale = panelMobileScale(frame.width);

    // ---- Title bar: name plate left, wallet + close right ----
    const plaque = scene.add.image(-740, BAR_Y, 'ui_shop_plaque');
    this.plaqueText = scene.add
      .text(-740, BAR_Y - 2, 'EMPORIUM', {
        fontFamily: FONT.ui,
        fontSize: '58px',
        fontStyle: 'bold',
        color: INK.onPlate
      })
      .setOrigin(0.5);

    const [goldChip, goldText] = this.wallet(380, 'ui_icon_coin');
    const [warmthChip, warmthText] = this.wallet(760, 'ui_icon_bolt');
    this.walletGold = goldText;
    this.walletWarmth = warmthText;

    const close = scene.add.container(1040, BAR_Y);
    const closeRing = scene.add.image(0, 0, 'ui_shop_close');
    const closeX = scene.add
      .text(0, -2, '✕', { fontFamily: FONT.ui, fontSize: '52px', fontStyle: 'bold', color: INK.goldHi })
      .setOrigin(0.5);
    close.add([closeRing, closeX]);
    close.setSize(140, 140).setInteractive({ useHandCursor: true });
    close.on('pointerover', () => close.setScale(1.08));
    close.on('pointerout', () => close.setScale(1));
    close.on('pointerup', () => this.requestClose());

    this.tabs = scene.add.container(0, TAB_Y);
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
    this.bus.emit('ui:shop_toggled', { open: true, currency });
    this.setVisible(true).setAlpha(0).setScale(this.baseScale * 0.94);
    this.scene.tweens.add({
      targets: this,
      alpha: 1,
      scale: this.baseScale,
      duration: 220,
      ease: 'Back.easeOut'
    });
  }

  /**
   * `cause` SAYS WHO CLOSED IT, and the return ticket depends on the answer.
   *
   * The shortfall notice's ticket rides `ui:shop_toggled { open: false }`: the
   * player left the coin shop, so put them back on the shelf they came from.
   * But the game closes this panel on its own too — the finale calls
   * `requestClose()` on the Ledger, the Emporium and the Cookbook to clear the
   * stage, and a ticket fired from THAT re-opened the Keeper's Store, scroll
   * position and all, on top of the chapter's one irreversible story beat.
   *
   * So a system close says so, and the ticket only answers to `'player'`. The
   * default is `'player'` because the ✕ is what calls this in every other
   * place; the exceptions are the ones that have to be explicit.
   */
  requestClose(cause: 'player' | 'system' = 'player'): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    // Announced on the way OUT, before the fade: the shortfall notice's return
    // ticket rides this, and a player who has left the coin shop should be back
    // where they came from by the time the Emporium has finished dissolving.
    this.bus.emit('ui:shop_toggled', { open: false, currency: this.currency, cause });
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scale: this.baseScale * 0.96,
      duration: 150,
      ease: 'Sine.easeIn',
      onComplete: () => this.setVisible(false)
    });
  }

  /**
   * Switch shelves on an already-open Emporium.
   *
   * The WARMTH shelf's own Gold refusal raises the shortfall notice INSIDE this
   * panel, and the coin shop it has to send the player to is this same panel's
   * other tab — so the way across is a tab switch, never a second Emporium
   * opened over the first. A no-op when the panel is shut: the notice is
   * dismissed before its action runs, and nothing else may open a shelf without
   * opening the hall.
   */
  showCurrency(currency: Currency): void {
    if (!this.isOpen || this.currency === currency) return;
    this.currency = currency;
    this.build();
    this.bus.emit('ui:shop_toggled', { open: true, currency });
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
    const chip = this.scene.add.container(x, BAR_Y);
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
    const gap = 620;
    order.forEach((cur, i) => {
      const active = cur === this.currency;
      const tab = this.scene.add.container((i - (order.length - 1) / 2) * gap, 0);
      tab.add(this.scene.add.image(0, 0, active ? 'ui_shop_tab_on' : 'ui_shop_tab'));
      tab.add(
        this.scene.add
          .text(0, -6, SHOP[cur].tab, {
            fontFamily: FONT.ui,
            fontSize: '44px',
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

    // A LIVE GATEWAY THAT SELLS NO COIN PACKS. `coinOffers()` answers `[]`
    // rather than falling back to the free showcase (that fallback is only for
    // a build with no hub at all — see coinPacks.ts), so the honest shelf here
    // is an empty one that says so. Without this the row loop simply draws
    // nothing and the player reads a blank frame as a broken screen.
    if (order.length === 0) {
      this.shelf.add(
        this.scene.add
          .text(0, SHELF_TOP + SHELF_H / 2, 'No packs are on sale right now.', {
            fontFamily: FONT.ui,
            fontSize: '40px',
            color: INK.onFieldDim,
            align: 'center'
          })
          .setOrigin(0.5)
      );
      return;
    }

    const total = order.length * ROW_H + (order.length - 1) * ROW_GAP;
    const top = SHELF_TOP + (SHELF_H - total) / 2 + ROW_H / 2;
    order.forEach(({ item, tier }, i) => {
      const y = top + i * (ROW_H + ROW_GAP);
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
      return coinOffers().map((offer) => ({
        amount: offer.coins,
        price: offer.price,
        name: offer.name,
        best: offer.best,
        packId: offer.packId
      }));
    }
    // The Gold sink first, then whatever real-money Warmth the hub sells.
    //
    // Read straight off the bridge rather than through a resolver of its own:
    // `coinOffers()` exists because TWO surfaces have to agree about coin packs
    // (the shelf and the shortfall notice, which sends the player to it), and
    // there is no second surface for Warmth. A standalone build has an empty
    // catalog, so this adds nothing and the shelf is the authored one it has
    // always been.
    return [
      ...(SHOP[this.currency].items ?? []),
      ...iapBridge.warmthPacks().map((pack) => ({
        amount: pack.energy,
        price: priceOf(pack.amountEur),
        name: pack.name,
        packId: pack.id
      }))
    ];
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
    const first = this.kin(items, item)[0];
    if (!first) return 0;
    const base = rate(first);
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
    // Judged inside its own currency, and only where there is a judgement to
    // make: the best value of ONE pack is not a claim, it is a decoration, and
    // `bonusPercent` already answers 0 for a lone row so the tag had no number
    // behind it either.
    const kin = this.kin(items, item);
    if (kin.length > 1) {
      const bonuses = kin.map((i) => this.bonusPercent(items, i));
      if (kin[bonuses.indexOf(Math.max(...bonuses))] === item) return 'BEST VALUE';
    }
    return item.best ? 'MOST POPULAR' : null;
  }

  /**
   * Gold-priced, or money-priced.
   *
   * The Warmth shelf now carries both, and NOTHING that compares value may
   * cross that line: 50 Warmth for €1.99 and 5 Warmth for 20 Gold are not two
   * rates, they are two currencies. Divided anyway, the euro pack returns
   * "+9940% MORE" and takes BEST VALUE off a shelf whose whole point is that
   * the earned way is a real way.
   */
  private priceKind(item: Product): 'gold' | 'money' {
    return item.gold !== undefined ? 'gold' : 'money';
  }

  /** The rows this one may be measured against — its own currency, in shelf
   *  order, so `[0]` is still the entry pack of that currency. */
  private kin(items: Product[], item: Product): Product[] {
    return items.filter((i) => this.priceKind(i) === this.priceKind(item));
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
    row.add(this.scene.add.image(0, 0, item.best || isFree ? 'ui_shop_card_hot' : 'ui_shop_card'));

    // Goods, heaped in their own pool of light.
    row.add(
      this.scene.add.image(ROW_ART_X, -4, 'ui_shop_burst').setScale(1.9).setAlpha(isFree || item.best ? 0.95 : 0.6)
    );
    row.add(this.pile(ROW_ART_X, -8, cfg.icon, tier, 100));

    row.add(
      this.scene.add
        .text(ROW_TEXT_X, -34, item.name.toUpperCase(), {
          fontFamily: FONT.ui,
          fontSize: '46px',
          fontStyle: 'bold',
          color: INK.onField
        })
        .setOrigin(0, 0.5)
        .setShadow(0, 4, 'rgba(0,0,0,0.6)', 7)
    );
    // The sub-line carries the amount and, when there is one, the value bonus —
    // inline, so the shelf never needs a chip pinned to a corner to say it.
    const amount = this.scene.add
      .text(ROW_TEXT_X + 4, 34, `${cfg.title} ×${item.amount.toLocaleString()}`, {
        fontFamily: FONT.ui,
        fontSize: '34px',
        color: INK.onFieldDim
      })
      .setOrigin(0, 0.5);
    row.add(amount);
    const bonus = this.bonusPercent(items, item);
    if (!isFree && bonus >= 5) {
      row.add(
        this.scene.add
          .text(ROW_TEXT_X + 4 + amount.width + 26, 34, `+${bonus}% MORE`, {
            fontFamily: FONT.ui,
            fontSize: '32px',
            fontStyle: 'bold',
            color: INK.goldHi
          })
          .setOrigin(0, 0.5)
      );
    }

    const tag = this.tagFor(items, item, isFree);
    if (tag) row.add(this.ribbon(ROW_TAG_X, 0, tag));
    row.add(this.pricePlate(ROW_PRICE_X, 0, item, isFree, 1));
    return row;
  }

  /** The parchment tag, sitting in the row's flow rather than on its edge. */
  private ribbon(x: number, y: number, label: string): Phaser.GameObjects.Container {
    const tag = this.scene.add.container(x, y);
    tag.add(this.scene.add.image(0, 0, 'ui_shop_ribbon').setOrigin(0, 0.5));
    // The sash body runs x 8..216 in game units; its text rides the same
    // -0.11rad tilt the painter gave the cloth. Cream ink with a dark shadow,
    // because the sash is ember now — brown on orange was unreadable.
    tag.add(
      this.scene.add
        .text(112, 2, label, { fontFamily: FONT.ui, fontSize: '24px', fontStyle: 'bold', color: '#FFF3DC' })
        .setOrigin(0.5)
        .setAngle(-6.3)
        .setShadow(0, 2, 'rgba(94,36,10,0.75)', 3)
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
    // The plate is a plum face in a gold rim now, so its type is the rim's gold.
    const text = this.scene.add
      .text(item.gold !== undefined && !isFree ? 22 : 0, -2, label, {
        fontFamily: FONT.ui,
        fontSize: '46px',
        fontStyle: 'bold',
        color: INK.onFieldGold
      })
      .setOrigin(0.5)
      .setShadow(0, 3, 'rgba(24,16,22,0.5)', 4);
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
        /**
         * A FULL BAR TAKES NO MONEY.
         *
         * `energy:add` clamps at `energyMax` (EnergySystem.gain), and
         * `computeRegen` clamps again on every catch-up, so a Warmth pack
         * bought at the top of the bar charges in euros and delivers nothing.
         * This is the one refusal that has to land BEFORE the checkout window
         * opens rather than after the receipt.
         *
         * Same red-and-shake as the Gold shortfall below, and deliberately no
         * top-up notice: a shortfall has a way out to offer, a full bar has
         * nothing to fix.
         */
        if (this.currency === 'energy' && this.gameState.energyCurrent >= this.gameState.energyMax) {
          text.setColor('#C4361F');
          this.scene.time.delayedCall(450, () => text.setColor(INK.onFieldGold));
          this.scene.tweens.add({ targets: btn, x: btn.x + 10, duration: 45, yoyo: true, repeat: 3 });
          return;
        }
        this.bus.emit('ui:iap_buy_requested', { packId: item.packId });
        return;
      }
      // GOLD-priced pack: check the coffer; deny with a shake + red flash when
      // short (the coins never go negative), and offer the way out.
      if (!isFree && item.gold !== undefined) {
        if (this.gameState.coins < item.gold) {
          text.setColor('#C4361F');
          // Back to the colour it was BUILT with. This restored `INK.onPlate`,
          // a dark brown the plate never wore: one refused purchase left the
          // price near-unreadable on the plum face until the shelf rebuilt.
          this.scene.time.delayedCall(450, () => text.setColor(INK.onFieldGold));
          this.scene.tweens.add({ targets: btn, x: btn.x + 10, duration: 45, yoyo: true, repeat: 3 });
          // Source `warmth`, because this refusal happened INSIDE the coin
          // shop's own hall: the notice's action switches this panel to its
          // GOLD tab rather than opening a second Emporium over this one.
          // UIScene decides whether the offer is allowed at all.
          this.bus.emit('ui:topup_requested', {
            label: item.name,
            price: item.gold,
            source: 'warmth'
          });
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
