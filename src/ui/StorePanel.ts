import Phaser from 'phaser';
import { FONT, INK } from '../art/design';
import {
  FOIL,
  GAME_WIDTH,
  LIVE_GAME_HEIGHT,
  num,
  panelMobileScale,
  RARITY
} from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameContext } from '../core/Context';
import type { GameState } from '../core/GameState';
import type { StoreData, StoreItem, StoreRarity, StoreSection } from '../core/types';
import { ensureTextures } from '../core/lazyTextures';
import { addScrim, makeFoilPlate, PLATE_INSET, runSheen } from './foil';
import { uiRegistry } from './theme';


/** Card geometry, in the 2560-space. Four across inside the shop frame. */
const CARD_W = 452;
const CARD_H = 460;
const CARD_R = 34;
const COLS = 4;
const COL_GAP = 476;
/**
 * The grid window, measured off the PAINTED frame rather than off its texture:
 * the plate the storePanel painter fills is 1016×620 logical drawn at y+40, so
 * its inner floor sits at +652 — not +660, which is merely where the texture
 * ends. The shelf owns -300 (under the tabs) down to +640, keeping a 12-unit
 * air gap above the floor. That gap is the whole fix for "the bottom row
 * overflows the panel": the old window ran to +660, eight units PAST the
 * floor, so any layout that filled it exactly (the dragon-skin hero section,
 * Decorations at full scroll) stood its bottom row on the frame's bezel.
 */
const VIEW_TOP = -300;
const VIEW_BOTTOM = 640;
const VIEW_H = VIEW_BOTTOM - VIEW_TOP;
const GRID_MID = (VIEW_TOP + VIEW_BOTTOM) / 2;
/** Two rows of 460 + the 20 between them = 940, the window exactly — which is
 *  why CARD_H cannot grow: a taller card pushes row two onto the bezel again.
 *  A section with more than `COLS * 2` items SCROLLS instead of squeezing. */
const ROW_GAP = 480;
/** Past this much drag the gesture is a scroll, and the card under the finger
 *  must not also be bought. */
const DRAG_SLOP = 12;

/**
 * The showcase card. Its height IS the whole grid — both rows and the gap
 * between them — so it can never disagree with the cards beside it. Its width
 * is that height at 0.716, the proportion of a physical trading card, because
 * that is the thing a foiled legendary is pretending to be.
 */
const HERO_H = ROW_GAP + CARD_H;
const HERO_W = Math.round(HERO_H * 0.716);
const HERO_GAP = 96;
/** A section with a showcase card fits two ordinary columns beside it. */
const HERO_COLS = 2;

/**
 * The Keeper's Store — cosmetics, bought with earned Gold.
 *
 * Separate from `ShopPanel` on purpose: that one sells CURRENCY (Warmth refills,
 * Gold bundles) off a gauge's "+", and it is a sink. This one sells things that
 * change how the isle looks and nothing else. Merging them would put a real-money
 * bundle on the same shelf as a garden ornament.
 *
 * A section whose `kind` is `'soon'` shows its blurb and a badge instead of
 * cards. It carries no items at all — a priced card that cannot be bought reads
 * as broken, and the whole point of the shelf is that the player believes it.
 */
export class StorePanel extends Phaser.GameObjects.Container {
  isOpen = false;
  private dim: Phaser.GameObjects.Rectangle;
  private titleText: Phaser.GameObjects.Text;
  private titleBg: Phaser.GameObjects.Graphics;
  private tabsRow: Phaser.GameObjects.Container;
  private closeBtn: Phaser.GameObjects.Container;
  /** Named `shelf`, not `body`: GameObject.body is Phaser's physics slot. */
  private shelf: Phaser.GameObjects.Container;
  /** Clipped window the shelf scrolls inside. */
  private viewport: Phaser.GameObjects.Container;
  private shelfMask: Phaser.GameObjects.Graphics;
  private scrollY = 0;
  private maxScroll = 0;
  private dragFrom: number | null = null;
  private dragScrollFrom = 0;
  /** True once a pointer has travelled past DRAG_SLOP — consumed by the buy
   *  handler so a scroll that ends over a card does not also buy it. */
  private dragged = false;
  private sectionBlurb: Phaser.GameObjects.Text;
  private sections: StoreSection[];
  private activeIndex = 0;
  private baseScale = 1;
  private offBus: (() => void)[] = [];
  /** Price labels by item id — a refused purchase flashes the one it refused. */
  private priceLabels = new Map<string, Phaser.GameObjects.Text>();
  private priceCoins = new Map<string, Phaser.GameObjects.Image>();
  private cardsById = new Map<string, Phaser.GameObjects.Container>();
  /** Foil sheens currently running. A tween left alive on a closed panel is a
   *  wake source the battery governor has no way of seeing. */
  private sheens: Phaser.Tweens.Tween[] = [];

  constructor(
    scene: Phaser.Scene,
    private bus: EventBus,
    private gameState: GameState,
    data: StoreData,
    private ctx: GameContext
  ) {
    super(scene, GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2);
    this.sections = data.sections;

    this.dim = scene.add
      .rectangle(0, 0, GAME_WIDTH, LIVE_GAME_HEIGHT, num(INK.scrim), 0.62)
      .setInteractive();
    this.dim.on('pointerup', () => this.requestClose());

    const frame = scene.add.image(0, 40, 'ui_store_panel');
    this.baseScale = panelMobileScale(frame.width);

    this.titleBg = scene.add.graphics();
    this.titleText = scene.add
      .text(0, -586, "KEEPER'S STORE", {
        fontFamily: FONT.ui, fontSize: '64px', fontStyle: 'bold', color: INK.onField
      })
      .setOrigin(0.5)
      .setShadow(0, 5, 'rgba(36,27,34,0.55)', 6);

    // The section's one-line pitch, ABOVE the grid rather than inside it: a
    // two-row section starts at -300, and a blurb parked in the shelf container
    // ended up behind the first row of cards.
    this.sectionBlurb = scene.add
      .text(0, -344, '', {
        fontFamily: FONT.ui, fontSize: '30px', color: INK.onFieldDim,
        align: 'center', wordWrap: { width: 1860 }
      })
      .setOrigin(0.5);

    const close = scene.add.container(956, -540);
    this.closeBtn = close;
    const closeBg = scene.add.image(0, 6, 'ui_btn_round').setScale(0.92).setTint(num(INK.field));
    const closeX = scene.add
      .text(0, -2, '✕', { fontFamily: FONT.ui, fontSize: '54px', fontStyle: 'bold', color: INK.onFieldGold })
      .setOrigin(0.5);
    close.add([closeBg, closeX]);
    close.setSize(120, 120).setInteractive({ useHandCursor: true });
    close.on('pointerover', () => close.setScale(1.08));
    close.on('pointerout', () => close.setScale(1));
    close.on('pointerup', () => this.requestClose());

    this.tabsRow = scene.add.container(0, -430);
    this.viewport = scene.add.container(0, GRID_MID);
    this.shelf = scene.add.container(0, 0);
    this.viewport.add(this.shelf);
    // Geometry masks live in WORLD space, so this is re-seated from the
    // container's own world transform whenever the panel moves or scales.
    this.shelfMask = scene.make.graphics();
    this.shelf.setMask(this.shelfMask.createGeometryMask());

    this.add([this.dim, frame, this.titleBg, this.titleText, this.sectionBlurb, close, this.tabsRow, this.viewport]);
    scene.add.existing(this);
    this.setVisible(false);
    this.drawBanner(this.titleText.width + 200);

    // Repaint on anything that changes what a card should say.
    this.offBus.push(bus.on('store:purchased', () => this.isOpen && this.refresh()));
    this.offBus.push(bus.on('store:skin_changed', () => this.isOpen && this.refresh()));
    this.offBus.push(bus.on('store:dragon_skin_changed', () => this.isOpen && this.refresh()));
    this.offBus.push(
      bus.on('store:purchase_failed', ({ itemId, reason }) => this.refuse(itemId, reason))
    );
    // Scene-level input rather than an interactive Zone over the shelf: a Zone
    // big enough to catch the drag would sit on top of every card and swallow
    // the taps that buy them. The handlers gate on `isOpen` instead.
    scene.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const off of this.offBus) off();
      this.offBus = [];
      this.stopSheens();
      scene.input.off(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
      scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
      scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
      scene.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
      scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
      this.shelfMask.destroy();
    });

    uiRegistry.register(scene, 'panel.store', "Keeper's Store panel", 'Panels', this, {
      frame,
      title: this.titleText,
      tabs: this.tabsRow,
      cards: this.viewport
    });
  }

  open(): void {
    // The shelf's own art is NOT at boot. PreloadScene skips every `decor_` key
    // the live map does not use (they are pure GPU cost until a screen shows
    // them), and the Store is the one screen that shows the rest — so its cards
    // came up empty. `lazyTextures` exists for exactly this: fetch on the way
    // in, then rebuild so the cards pick the textures up.
    ensureTextures(this.scene, this.ctx, this.artKeys(), () => {
      if (this.isOpen) this.buildBody();
    });
    this.buildTabs();
    this.buildBody();
    this.isOpen = true;
    this.setVisible(true).setAlpha(0).setScale(this.baseScale * 0.92);
    this.seatMask();
    this.scene.tweens.add({
      targets: this,
      alpha: 1,
      scale: this.baseScale,
      duration: 200,
      ease: 'Back.easeOut',
      onUpdate: () => this.seatMask()
    });
    this.bus.emit('ui:store_toggled', { open: true });
  }

  /** Tour accessors — page-space anchors for the walkthrough's pointer.
   *  Null while the panel is closed, exactly like BagPanel's verb accessors. */
  getTabPos(i: number): { x: number; y: number } | null {
    if (!this.visible) return null;
    const tab = this.tabsRow.list[i] as Phaser.GameObjects.Container | undefined;
    if (!tab) return null;
    const m = tab.getWorldTransformMatrix();
    return { x: m.tx, y: m.ty };
  }

  getClosePos(): { x: number; y: number } | null {
    if (!this.visible) return null;
    const m = this.closeBtn.getWorldTransformMatrix();
    return { x: m.tx, y: m.ty };
  }

  /** Jump the shelf to a section — the tour walks them as Eleanor names them. */
  showSection(i: number): void {
    if (i < 0 || i >= this.sections.length || this.activeIndex === i) return;
    this.activeIndex = i;
    this.refresh();
  }

  requestClose(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.stopSheens();
    this.bus.emit('ui:store_toggled', { open: false });
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scale: this.baseScale * 0.94,
      duration: 150,
      ease: 'Sine.easeIn',
      onComplete: () => this.setVisible(false)
    });
  }

  /** Every texture the shelf can draw, across all sections. */
  private artKeys(): string[] {
    return this.sections.flatMap((section) => section.items.map((item) => item.art));
  }

  private refresh(): void {
    this.buildTabs();
    this.buildBody();
  }

  /** Shake + redden the refused price, so a denial is felt on the card the
   *  player tapped rather than announced somewhere else on screen. */
  private refuse(itemId: string, reason: 'gold' | 'owned' | 'no_room'): void {
    const label = this.priceLabels.get(itemId);
    const card = this.cardsById.get(itemId);
    if (!label || !card) return;
    const was = label.text;
    const coin = this.priceCoins.get(itemId);
    label.setColor(INK.spendDeep);
    if (reason === 'no_room') {
      label.setText('NO ROOM');
      coin?.setVisible(false); // "NO ROOM" is not a price — the coin would lie
    }
    this.scene.time.delayedCall(900, () => {
      if (label.active) label.setColor(INK.onPlate).setText(was);
      coin?.setVisible(true);
    });
    this.scene.tweens.add({ targets: card, x: card.x + 10, duration: 45, yoyo: true, repeat: 3 });
  }

  private drawBanner(width: number): void {
    const w = Math.max(620, width);
    const y = -640;
    const g = this.titleBg;
    g.clear();
    g.fillStyle(num(INK.goldDeep), 1);
    g.fillRoundedRect(-w / 2, y + 10, w, 104, 34);
    g.fillStyle(num(INK.field), 1);
    g.fillRoundedRect(-w / 2, y, w, 104, 34);
    g.lineStyle(6, num(INK.gold), 1);
    g.strokeRoundedRect(-w / 2, y, w, 104, 34);
    g.fillStyle(num(INK.fieldLift), 0.5);
    g.fillRoundedRect(-w / 2 + 14, y + 8, w - 28, 34, 18);
  }

  private buildTabs(): void {
    this.tabsRow.removeAll(true);
    const gap = 470;
    const startX = -((this.sections.length - 1) * gap) / 2;
    this.sections.forEach((section, i) => {
      const active = i === this.activeIndex;
      const tab = this.scene.add.container(startX + i * gap, 0);
      const g = this.scene.add.graphics();
      g.fillStyle(num(active ? INK.fieldLift : INK.fieldDeep), 1);
      g.fillRoundedRect(-210, -46, 420, 92, 30);
      g.lineStyle(5, num(active ? INK.gold : INK.goldDeep), 1);
      g.strokeRoundedRect(-210, -46, 420, 92, 30);
      const label = this.scene.add
        .text(0, -2, section.title, {
          fontFamily: FONT.ui,
          fontSize: '40px',
          fontStyle: 'bold',
          color: active ? INK.onField : INK.onFieldDim
        })
        .setOrigin(0.5);
      tab.add([g, label]);
      // "Soon" sections still read as tabs — the shelf is the announcement.
      if (section.kind === 'soon') {
        tab.add(
          this.scene.add
            .text(0, 34, 'SOON', {
              fontFamily: FONT.ui, fontSize: '22px', fontStyle: 'bold',
              color: active ? INK.onFieldGold : INK.onFieldDim
            })
            .setOrigin(0.5)
        );
        label.setY(-12);
      }
      tab.setSize(420, 92).setInteractive({ useHandCursor: true });
      tab.on('pointerup', () => {
        if (this.activeIndex === i) return;
        this.activeIndex = i;
        this.refresh();
      });
      this.tabsRow.add(tab);
    });
  }

  private stopSheens(): void {
    for (const tween of this.sheens) tween.stop();
    this.sheens = [];
  }

  private buildBody(): void {
    this.stopSheens(); // before removeAll — these tweens hold the tiles we destroy
    this.shelf.removeAll(true);
    this.priceLabels.clear();
    this.priceCoins.clear();
    this.cardsById.clear();
    const section = this.sections[this.activeIndex]!;
    this.sectionBlurb.setText(section.blurb);

    if (section.kind === 'soon') {
      this.shelf.add(
        this.scene.add
          .text(0, -60, 'AVAILABLE SOON', {
            fontFamily: FONT.ui, fontSize: '76px', fontStyle: 'bold', color: INK.onFieldGold
          })
          .setOrigin(0.5)
          .setAlpha(0.85)
      );
      return;
    }

    // One showcase card may claim the left of the shelf at full grid height;
    // everything else falls into the columns left over. Both halves are laid
    // out from the same measured total, so the block stays centred whether or
    // not the section has a hero.
    const hero = section.items.find((item) => item.hero) ?? null;
    const rest = hero ? section.items.filter((item) => item !== hero) : section.items;
    const cols = hero ? HERO_COLS : COLS;
    const blockW = (cols - 1) * COL_GAP + CARD_W;
    const total = hero ? HERO_W + HERO_GAP + blockW : blockW;
    const left = -total / 2;

    if (hero) this.place(this.makeHeroCard(left + HERO_W / 2, 0, hero, section), hero);

    const blockMidX = hero ? left + HERO_W + HERO_GAP + blockW / 2 : 0;
    const rows = Math.ceil(rest.length / cols);
    // Short sections stay optically centred; a section that overflows starts at
    // the top of the window instead, because a centred overflow hides its first
    // row as well as its last.
    const contentH = (rows - 1) * ROW_GAP + CARD_H;
    const startY =
      contentH <= VIEW_H
        ? -((rows - 1) * ROW_GAP) / 2
        : -VIEW_H / 2 + CARD_H / 2;
    this.maxScroll = Math.max(0, contentH - VIEW_H);
    // Every row starts at the block's left edge — the BLOCK is centred, the
    // rows inside it are a grid. A short final row therefore leaves its gap on
    // the right rather than re-centring itself, so columns line up top to
    // bottom and a lone last item sits under the first column, not adrift in
    // the middle.
    const colStartX = blockMidX - ((cols - 1) * COL_GAP) / 2;
    rest.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      this.place(
        this.makeCard(colStartX + col * COL_GAP, startY + row * ROW_GAP, item, section),
        item
      );
    });
    this.setScroll(0);
    this.seatMask();
  }

  /* ------------------------------- scrolling ------------------------------ */

  private setScroll(y: number): void {
    this.scrollY = Phaser.Math.Clamp(y, 0, this.maxScroll);
    this.shelf.setY(-this.scrollY);
  }

  /**
   * Re-seat the clip rect. A geometry mask is drawn in WORLD space, so it has
   * to be rebuilt from the viewport's live world transform — the panel is
   * centred, scaled by `panelMobileScale`, and scaled again by its own
   * open/close tween, and a mask left in local units clips the wrong band on
   * every one of those.
   */
  private seatMask(): void {
    const m = this.viewport.getWorldTransformMatrix();
    const h = VIEW_H * m.scaleY;
    const w = GAME_WIDTH * m.scaleX; // wider than the frame — only Y clips here
    this.shelfMask.clear();
    this.shelfMask.fillStyle(0xffffff, 1);
    this.shelfMask.fillRect(m.tx - w / 2, m.ty - h / 2, w, h);
  }

  /** Wheel and drag both scroll; neither may reach the board behind the panel. */
  private onWheel = (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number): void => {
    if (!this.isOpen || this.maxScroll <= 0) return;
    this.setScroll(this.scrollY + dy);
  };

  private onPointerDown = (p: Phaser.Input.Pointer): void => {
    if (!this.isOpen) return;
    this.dragFrom = p.y;
    this.dragScrollFrom = this.scrollY;
    this.dragged = false;
  };

  private onPointerMove = (p: Phaser.Input.Pointer): void => {
    if (this.dragFrom === null || this.maxScroll <= 0) return;
    const dy = p.y - this.dragFrom;
    if (Math.abs(dy) > DRAG_SLOP) this.dragged = true;
    // Pointer units are screen pixels; the shelf lives in the scaled panel.
    const scale = this.viewport.getWorldTransformMatrix().scaleY || 1;
    this.setScroll(this.dragScrollFrom - dy / scale);
  };

  private onPointerUp = (): void => {
    this.dragFrom = null;
    // Cleared a frame later so the buy handler, which fires on this same
    // pointerup, still sees that the gesture was a drag.
    this.scene.time.delayedCall(0, () => (this.dragged = false));
  };

  private place(card: Phaser.GameObjects.Container, item: StoreItem): void {
    this.shelf.add(card);
    this.cardsById.set(item.id, card);
  }

  /** Is this item's slot already wearing it? Worn is per WARDROBE SLOT: the
   *  Manor has one, and each dragon chain has its own — so Ashglass reading
   *  WORN says nothing about the emerald dragon. */
  private isWorn(item: StoreItem, section: StoreSection): boolean {
    if (section.kind === 'skin') return this.gameState.manorSkin === item.id;
    if (section.kind === 'dragon_skin') {
      return !!item.dragon && this.gameState.dragonSkins[item.dragon] === item.id;
    }
    return false;
  }

  /** The rarity tab that straddles a card's top edge. Presentation only — see
   *  `RARITY`: it says what the thing costs to feel like, never what it does. */
  private makeRibbon(rarity: StoreRarity, y: number): Phaser.GameObjects.Container {
    const look = RARITY[rarity];
    const ribbon = this.scene.add.container(0, y);
    const label = this.scene.add
      .text(0, 0, look.label, {
        fontFamily: FONT.ui, fontSize: '22px', fontStyle: 'bold', color: look.ink
      })
      .setLetterSpacing(4)
      .setOrigin(0.5)
      .setShadow(0, 2, 'rgba(36,27,34,0.5)', 3);
    const w = label.width + 58;
    const h = 44;
    const g = this.scene.add.graphics();
    g.fillStyle(num(INK.scrim), 0.45);
    g.fillRoundedRect(-w / 2, -h / 2 + 5, w, h, h / 2);
    g.fillStyle(num(look.ribbon), 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    g.lineStyle(4, num(look.ribbonEdge), 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    ribbon.add([g, label]);
    return ribbon;
  }

  /**
   * The one control on a card. It says exactly one of: a price, WEAR, WORN,
   * OWNED — and it is interactive only when tapping it would do something.
   */
  private makeAction(
    item: StoreItem,
    section: StoreSection,
    owned: boolean,
    worn: boolean,
    y: number,
    scale: number,
    fontPx: number
  ): Phaser.GameObjects.Container {
    const btn = this.scene.add.container(0, y);
    const skinAction = (section.kind === 'skin' || section.kind === 'dragon_skin') && owned && !worn;
    const isPrice = !worn && !owned;
    const text = worn ? 'WORN' : owned ? (skinAction ? 'WEAR' : 'OWNED') : `${item.gold}`;
    const btnImg = this.scene.add.image(0, 0, owned && !skinAction ? 'ui_btn_free' : 'ui_btn_price');
    btnImg.setScale(scale);
    const price = this.scene.add
      .text(0, -6, text, {
        fontFamily: FONT.ui, fontSize: `${fontPx}px`, fontStyle: 'bold', color: INK.onPlate
      })
      .setOrigin(0.5)
      .setShadow(0, 2, 'rgba(255,255,255,0.4)', 3);
    btn.add([btnImg, price]);
    // Real coin art, not the 🪙 emoji — that glyph is whatever the device ships
    // and never matched the coin the player actually earns.
    if (isPrice) {
      const coin = this.scene.add.image(0, -4, 'ui_icon_coin');
      coin.setScale((fontPx + 2) / Math.max(coin.width, coin.height));
      const total = coin.displayWidth + 10 + price.width;
      coin.setX(-total / 2 + coin.displayWidth / 2);
      price.setX(total / 2 - price.width / 2);
      btn.add(coin);
      // A refused price re-labels this text ("NO ROOM"); the coin goes with it.
      this.priceCoins.set(item.id, coin);
    }
    this.priceLabels.set(item.id, price);

    if (worn || (owned && section.kind === 'decor')) {
      btn.setAlpha(0.75);
      return btn; // nothing left to do to it
    }
    btnImg.setInteractive({ useHandCursor: true });
    btnImg.on('pointerover', () => btn.setScale(1.06));
    btnImg.on('pointerout', () => btn.setScale(1));
    btnImg.on('pointerup', () => {
      btn.setScale(1);
      if (this.dragged) return; // the player was scrolling the shelf, not buying
      if (skinAction) this.bus.emit('ui:store_equip_requested', { itemId: item.id });
      else this.bus.emit('ui:store_buy_requested', { itemId: item.id });
    });
    return btn;
  }

  /**
   * The showcase card: full grid height, key art bled to the edges, and the
   * name and blurb reading off a scrim rather than a panel. It exists because
   * one item in the shop is meant to be the reason the player opened it.
   */
  private makeHeroCard(
    x: number,
    y: number,
    item: StoreItem,
    section: StoreSection
  ): Phaser.GameObjects.Container {
    const card = this.scene.add.container(x, y);
    const owned = this.gameState.ownedCosmetics.includes(item.id);
    const worn = this.isWorn(item, section);
    const inner = { w: HERO_W - PLATE_INSET * 2, h: HERO_H - PLATE_INSET * 2 };

    const plate = makeFoilPlate(
      this.scene,
      HERO_W,
      HERO_H,
      CARD_R,
      worn ? INK.ember : undefined
    );
    card.add(plate.under);
    if (this.scene.textures.exists(item.art)) {
      card.add(this.scene.add.image(0, 0, item.art).setDisplaySize(inner.w, inner.h));
    }
    card.add(addScrim(this.scene, inner.w, inner.h / 2 - 30, 30));
    // The sheen crosses the ART as well as the plate — a foil card whose gloss
    // stops at the picture is a picture in a shiny frame, not a foil card.
    card.add(plate.sheen);
    card.add(plate.rim);
    this.sheens.push(runSheen(this.scene, plate.sheen));

    if (item.rarity) card.add(this.makeRibbon(item.rarity, -HERO_H / 2 + 46));
    card.add(
      this.scene.add
        .text(0, 206, item.name, {
          fontFamily: FONT.ui, fontSize: '46px', fontStyle: 'bold', color: INK.onField,
          align: 'center', wordWrap: { width: inner.w - 72 }
        })
        .setOrigin(0.5)
        .setShadow(0, 4, 'rgba(36,27,34,0.7)', 6)
    );
    card.add(
      this.scene.add
        .text(0, 246, item.blurb, {
          fontFamily: FONT.ui, fontSize: '22px', color: FOIL.rim,
          align: 'center', wordWrap: { width: inner.w - 84 }
        })
        .setOrigin(0.5, 0)
        .setShadow(0, 3, 'rgba(36,27,34,0.7)', 5)
    );
    card.add(this.makeAction(item, section, owned, worn, HERO_H / 2 - 84, 0.92, 46));
    return card;
  }

  private makeCard(
    x: number,
    y: number,
    item: StoreItem,
    section: StoreSection
  ): Phaser.GameObjects.Container {
    const card = this.scene.add.container(x, y);
    const owned = this.gameState.ownedCosmetics.includes(item.id);
    const worn = this.isWorn(item, section);
    // A legendary is printed on the foil plate; everything else keeps the cream
    // card. That is the only thing rarity changes about how a card behaves.
    const foil = !!item.rarity && RARITY[item.rarity].foil;
    // A dragon skin's art is a portrait, and a portrait in a letterboxed stage
    // reads as a thumbnail — so on this shelf every card is printed like the
    // hero: art bled to the plate's edges, the words on a scrim over it. The
    // Manor skins and Decorations keep the stage: their art is an OBJECT, and
    // an object wants a card around it, not a poster.
    const bleed = section.kind === 'dragon_skin';

    let rim: Phaser.GameObjects.Graphics | null = null;
    let sheen: Phaser.GameObjects.TileSprite | null = null;
    if (foil) {
      const plate = makeFoilPlate(
        this.scene,
        CARD_W,
        CARD_H,
        CARD_R,
        worn ? INK.ember : undefined
      );
      card.add(plate.under);
      rim = plate.rim;
      sheen = plate.sheen;
    } else {
      const g = this.scene.add.graphics();
      g.fillStyle(num(INK.goldDeep), 1);
      g.fillRoundedRect(-CARD_W / 2, -CARD_H / 2 + 8, CARD_W, CARD_H, CARD_R);
      g.fillStyle(num(INK.field), 1);
      g.fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, CARD_R);
      card.add(g);
      // The rim is its own layer so full-bleed art can slide UNDER it — a
      // stroke fused into the plate would be painted over by the art.
      rim = this.scene.add.graphics();
      rim.lineStyle(6, num(worn ? INK.ember : INK.gold), 1);
      rim.strokeRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, CARD_R);
    }

    if (this.scene.textures.exists(item.art)) {
      if (bleed) {
        const inner = { w: CARD_W - PLATE_INSET * 2, h: CARD_H - PLATE_INSET * 2 };
        card.add(this.scene.add.image(0, 0, item.art).setDisplaySize(inner.w, inner.h));
        // Scrim under everything the player must read — from just above the
        // name down to the plate's foot, same treatment as the hero.
        card.add(addScrim(this.scene, inner.w, inner.h / 2 - 12, -12));
      } else {
        // Contain-fit into the card's stage so a tall Manor and a squat rune
        // pad both sit inside the same rectangle, capped at 188 tall: the
        // blurb is the reason anyone reads a card twice, and it needs lines.
        const art = this.scene.add.image(0, -122, item.art);
        art.setScale(Math.min(300 / art.width, 188 / art.height));
        card.add(art);
      }
    }
    // The sheen crosses the ART as well as the plate (same law as the hero) —
    // staggered so two legendaries on one shelf do not flash in lockstep,
    // which reads as a screen glitch rather than a material.
    if (sheen) {
      card.add(sheen);
      this.sheens.push(runSheen(this.scene, sheen, this.sheens.length * 900));
    }
    if (rim) card.add(rim);
    if (item.rarity) card.add(this.makeRibbon(item.rarity, -CARD_H / 2 + 8));

    const name = this.scene.add
      .text(0, 8, item.name, {
        fontFamily: FONT.ui, fontSize: '32px', fontStyle: 'bold',
        color: INK.onField,
        align: 'center', wordWrap: { width: CARD_W - 56 }
      })
      .setOrigin(0.5);
    if (bleed) name.setShadow(0, 4, 'rgba(36,27,34,0.7)', 6);
    card.add(name);
    const blurb = this.scene.add
      .text(0, 40, item.blurb, {
        fontFamily: FONT.ui, fontSize: '22px',
        color: bleed || foil ? FOIL.rim : INK.onFieldDim,
        align: 'center', wordWrap: { width: CARD_W - 64 }
      })
      .setOrigin(0.5, 0)
      .setAlpha(bleed || foil ? 1 : 0.9);
    if (bleed) blurb.setShadow(0, 3, 'rgba(36,27,34,0.7)', 5);
    card.add(blurb);
    card.add(this.makeAction(item, section, owned, worn, CARD_H / 2 - 62, 0.74, 38));
    return card;
  }
}
