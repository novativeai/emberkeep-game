import Phaser from 'phaser';
import { FONT, INK } from '../art/design';
import {
  FOIL,
  LIVE_GAME_WIDTH,
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


/*
 * THE SHELF, DERIVED FROM ONE NUMBER.
 *
 * Every constant here used to be tuned against a different reference — a card
 * width picked to fit four across, a hero width picked from a trading-card
 * ratio, a hero gap picked by eye — so nothing agreed with anything and the
 * grid read as crowded on one side and loose on the other. There is one number
 * now: AIR. It is the outer margin AND every gutter, and the card sizes are
 * whatever is left over once it has been paid on all four sides.
 *
 * The band it divides is measured off the PAINTED frame, not its texture:
 * `storePanel` fills 1016x620 logical at y+40, so the plate's inside is
 * x -1016..1016 (2032 wide) and y -588..652. The top of that is spoken for by
 * the banner, the tabs and the section blurb, so the shelf owns y -300..652 —
 * 2032 x 952.
 *
 *   across   4*428 + 3*64 = 1904, + 2*64 margin = 2032  ✓
 *   down     2*380 + 1*64 =  824, + 2*64 margin =  952  ✓
 *   hero row  592 + 64 + 592 + 64 + 592        = 1904   ✓
 *
 * The last line is the one that matters most: the hero is simply the first of
 * three equal columns, so the block is the same 1904 wide on every tab and
 * stops jumping sideways when the player changes shelf.
 */
const AIR = 64;
const CARD_W = 428; // (1904 - 3*AIR) / 4
const CARD_H = 380; // (824 - AIR) / 2
const CARD_R = 34;
const COLS = 4;
const COL_GAP = CARD_W + AIR; // a PITCH: the visible gutter is AIR
const VIEW_TOP = -300;
/** The plate's true inner floor. The shelf may use all of it, because the air
 *  is now paid by the layout rather than by leaving the window short. */
const VIEW_BOTTOM = 652;
const VIEW_H = VIEW_BOTTOM - VIEW_TOP;
const GRID_MID = (VIEW_TOP + VIEW_BOTTOM) / 2;
/** Row PITCH, not row height — the gap between two rows is `ROW_GAP - CARD_H`. */
const ROW_GAP = CARD_H + AIR;

/**
 * The showcase card. Its height IS the whole grid — both rows and the gap
 * between them — so it can never disagree with the cards beside it, and its
 * width is one column of the hero layout. 592/824 = 0.718, which is the
 * trading-card proportion a foiled legendary is pretending to be, arrived at
 * by the arithmetic rather than imposed on it.
 */
const HERO_H = ROW_GAP + CARD_H;
const HERO_W = 592;
const HERO_GAP = AIR;
/** A section with a showcase card fits two ordinary columns beside it, and in
 *  that layout those columns are HERO-width — three equal columns, not a wide
 *  card beside two narrow ones. */
const HERO_COLS = 2;
const HERO_CARD_W = HERO_W;
const HERO_COL_GAP = HERO_CARD_W + AIR;

/** Past this much drag the gesture is a scroll, and the card under the finger
 *  must not also be bought. */
const DRAG_SLOP = 12;

/**
 * THE CARD'S TYPE IS LAID OUT FROM ITS KEY UPWARDS, not from its top down.
 *
 * Every one of these used to be a y picked by eye, and nothing measured
 * anything: the name sat at a fixed height, the blurb started at a fixed
 * height below it, and the buy key was drawn afterwards at a fixed height of
 * its own. On a 380-tall card that left the blurb 39 units — one and a half
 * lines — and every two-line blurb in the shop had its second line sliced in
 * half by the plate. That is what shipped, on all three tabs.
 *
 * So the geometry is stated once, here, and the words are FITTED into what is
 * left over (`fitBlurb`). The one number that has to be right is ACTION_TOP:
 * everything the player reads has to end above it.
 */

/** Where a BLED card's name sits — the scrim under it is placed FROM this, so
 *  it cannot move without the gradient moving with it. */
const NAME_Y = 8;
/** And where a PLAIN card's name sits: there is no scrim to answer to here,
 *  only the art above and the key below, so the name rides as high as the
 *  picture allows and hands its slack to the blurb. */
const PLAIN_NAME_Y = -18;
/** The showcase card's name. Sized off the WORST case rather than the one on
 *  screen: at four lines the blurb still ends clear of the key. */
const HERO_NAME_Y = 138;

/** `ui_btn_price`/`ui_btn_free` are painted 230x66 logical, so the plate is
 *  460x132 board units and its half-height is 66 x whatever scales it. */
const ACTION_PLATE_HALF_H = 66;
/** Reduced from 0.74: at 340 wide the key ate 79% of the card and its top edge
 *  cut into the blurb. 267 is 62% — a key, not a drawer front. */
const ACTION_SCALE = 0.58;
const ACTION_FONT = 32;
const ACTION_Y = CARD_H / 2 - 50;
const ACTION_TOP = ACTION_Y - ACTION_PLATE_HALF_H * ACTION_SCALE;
const HERO_ACTION_SCALE = 0.82;
const HERO_ACTION_FONT = 40;
const HERO_ACTION_Y = HERO_H / 2 - 64;
const HERO_ACTION_TOP = HERO_ACTION_Y - ACTION_PLATE_HALF_H * HERO_ACTION_SCALE;

/** The blurb's preferred size, and the floor it may shrink to before the text
 *  is truncated instead. Below 16 the type stops being readable at all, and an
 *  unreadable full sentence is worth less than a readable half one. */
const BLURB_PX = 21;
const BLURB_MIN_PX = 16;
/** Air under the name's foot, and over the key's top edge. */
const BLURB_GAP = 8;
const BLURB_FOOT = 10;

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
    super(scene, LIVE_GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2);
    this.sections = data.sections;

    this.dim = scene.add
      .rectangle(0, 0, LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, num(INK.scrim), 0.62)
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

    // THE POCKET IS 101 UNITS WIDE, and that is what sizes this key.
    //
    // `ui_store_panel`'s inner plate runs x -1016..1016, y -588..652, and the
    // rightmost tab (`buildTabs`: 4 tabs, 420 wide, 470 apart) ends at x 915
    // with its top edge at y -476. So the free corner is 101 x 112 — a 0.92
    // disc is 125 across and cannot sit in it without riding the frame, which
    // is exactly what it was doing.
    const close = scene.add.container(964, -538);
    this.closeBtn = close;
    // The royal candy disc: a plum face in a gold rim, painted rather than a
    // cream HUD button under a flat tint.
    const closeBg = scene.add.image(0, 6, 'ui_btn_round_royal').setScale(0.58);
    const closeX = scene.add
      .text(0, -2, '✕', { fontFamily: FONT.ui, fontSize: '40px', fontStyle: 'bold', color: INK.onFieldGold })
      .setOrigin(0.5);
    close.add([closeBg, closeX]);
    // 96, not 120: the old hit box reached over the last tab.
    close.setSize(96, 96).setInteractive({ useHandCursor: true });
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
    // Travelling changes the STOCK: local goods are on the shelf only in the
    // world that makes them, so the same stall carries a different catalogue
    // in Borealis than it does here.
    this.offBus.push(bus.on('world:switched', () => this.isOpen && this.refresh()));
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

  /**
   * Is this thing sold somewhere else? A card tagged with a `world` is LOCAL
   * goods — Borealis ice is cut in Borealis — so it is on the shelf only while
   * the Keeper is standing in that world, and padlocked everywhere else.
   *
   * Deliberately the CURRENT world and not "has that world's door opened":
   * travelling has to change what the stall carries, or the four hubs sell one
   * identical catalogue and being somewhere means nothing.
   */
  private isLocked(item: StoreItem): boolean {
    return !!item.world && item.world !== this.gameState.worldId;
  }

  /**
   * Fill a card's plate with its art WITHOUT squashing it.
   *
   * `setDisplaySize(w, h)` was doing the filling, and it distorts by
   * construction: the four ordinary dragon cards are 900×506 key art — 16:9,
   * landscape — and the plate they bleed into is 452×460, very nearly square.
   * That is a 1.8× horizontal squeeze, and a squeezed dragon is the one thing a
   * card whose whole job is the picture cannot afford.
   *
   * So: scale to COVER, then crop the overflow in texture space. A crop leaves
   * the object centred on its own origin, so what survives is the middle of the
   * art — no mask, no second draw, and the plate is still filled edge to edge.
   * (The hero card is authored at the hero slot's own ratio, so it comes
   * through this untouched.)
   */
  private coverFit(art: Phaser.GameObjects.Image, boxW: number, boxH: number): void {
    const tw = art.width;
    const th = art.height;
    if (tw <= 0 || th <= 0) return;
    const scale = Math.max(boxW / tw, boxH / th);
    const cropW = Math.min(tw, boxW / scale);
    const cropH = Math.min(th, boxH / scale);
    art.setScale(scale);
    art.setCrop((tw - cropW) / 2, (th - cropH) / 2, cropW, cropH);
  }

  /**
   * FIT THE BLURB TO THE ROOM THE CARD HAS, and never one line more.
   *
   * The catalogue is authored prose: some items get a clause, some get two
   * sentences, and the card is the same size for all of them. Laying that out
   * at a fixed size and hoping is how "the way a roof sheds rain" ended up
   * underneath a buy button — the text overflowed and nothing was watching.
   *
   * Two stages, in order of what the player loses:
   *   1. shrink a point at a time (21 -> 16), which costs nothing but size;
   *   2. only if the floor size STILL overflows, keep the lines that fit and
   *      end them in an ellipsis, which costs words but never legibility.
   *
   * Stage 2 re-wraps: the ellipsis can push the last line past the wrap width
   * and hand back the line we just saved, so words come off the tail until the
   * count holds. A truncated sentence is a small loss; a sentence cut in half
   * by a plate is a broken screen.
   */
  private fitBlurb(text: Phaser.GameObjects.Text, budget: number): void {
    let px = Math.round(parseFloat(String(text.style.fontSize))) || BLURB_PX;
    while (text.height > budget && px > BLURB_MIN_PX) {
      px -= 1;
      text.setFontSize(px);
    }
    if (text.height <= budget) return;

    const lines = text.getWrappedText();
    const lineH = text.height / Math.max(1, lines.length);
    const keep = Math.max(1, Math.floor(budget / lineH));
    if (keep >= lines.length) return;
    const head = lines.slice(0, keep - 1);
    let tail = lines[keep - 1]!.replace(/[\s.,;:—-]+$/, '');
    const write = (): void => {
      text.setText([...head, `${tail}…`].join('\n'));
    };
    write();
    while (text.getWrappedText().length > keep && /\s/.test(tail)) {
      tail = tail.replace(/\s+\S*$/, '');
      write();
    }
  }

  /** Where a padlocked card is sold, as the player would name it. */
  private lockedIn(item: StoreItem): string {
    return this.gameState.worlds.get(item.world ?? '')?.name ?? 'another world';
  }

  /** Shake + redden the refused price, so a denial is felt on the card the
   *  player tapped rather than announced somewhere else on screen. */
  private refuse(itemId: string, reason: 'gold' | 'owned' | 'no_room' | 'locked'): void {
    const label = this.priceLabels.get(itemId);
    const card = this.cardsById.get(itemId);
    if (!label || !card) return;
    const was = label.text;
    const wasColor = label.style.color ?? INK.onFieldGold;
    const coin = this.priceCoins.get(itemId);
    label.setColor(INK.spend);
    if (reason === 'no_room') {
      label.setText('NO ROOM');
      coin?.setVisible(false); // "NO ROOM" is not a price — the coin would lie
    }
    this.scene.time.delayedCall(900, () => {
      // Back to the colour it actually had — the plate is dark now, so the old
      // hardcoded plate-ink turned a restored price invisible.
      if (label.active) label.setColor(wasColor).setText(was);
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
    // THE COLUMN WIDTH IS A PROPERTY OF THE LAYOUT, not of the card.
    //
    // A hero shelf is three equal columns and a plain shelf is four, and both
    // come to the same 1904 — so the block is the same width on every tab and
    // stops sliding sideways when the player changes shelf. The old code used
    // one card width for both, which is why the two-up rows beside the hero
    // were narrow cards adrift in a wide gap.
    const cardW = hero ? HERO_CARD_W : CARD_W;
    const colGap = hero ? HERO_COL_GAP : COL_GAP;
    const blockW = (cols - 1) * colGap + cardW;
    const total = hero ? HERO_W + HERO_GAP + blockW : blockW;
    const left = -total / 2;

    if (hero) this.place(this.makeHeroCard(left + HERO_W / 2, 0, hero, section), hero);

    const blockMidX = hero ? left + HERO_W + HERO_GAP + blockW / 2 : 0;
    const rows = Math.ceil(rest.length / cols);
    // Short sections stay optically centred; a section that overflows starts at
    // the top of the window instead, because a centred overflow hides its first
    // row as well as its last. Either way it pays AIR at the top and bottom —
    // the window is the plate's whole inner floor now, so the margin has to
    // come from the layout rather than from leaving the window short.
    const contentH = (rows - 1) * ROW_GAP + CARD_H;
    const startY =
      contentH <= VIEW_H - 2 * AIR
        ? -((rows - 1) * ROW_GAP) / 2
        : -VIEW_H / 2 + AIR + CARD_H / 2;
    this.maxScroll = Math.max(0, contentH + 2 * AIR - VIEW_H);
    // Every row starts at the block's left edge — the BLOCK is centred, the
    // rows inside it are a grid. A short final row therefore leaves its gap on
    // the right rather than re-centring itself, so columns line up top to
    // bottom and a lone last item sits under the first column, not adrift in
    // the middle.
    const colStartX = blockMidX - ((cols - 1) * colGap) / 2;
    rest.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      this.place(
        this.makeCard(colStartX + col * colGap, startY + row * ROW_GAP, item, section, cardW),
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
    const w = LIVE_GAME_WIDTH * m.scaleX; // wider than the frame — only Y clips here
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
  /**
   * The padlock a shut world's card wears: a brass lock over the art, and the
   * card's own words dimmed under it.
   *
   * The art stays VISIBLE, only darkened. A locked card whose picture is hidden
   * is an advertisement for nothing; the whole job here is to make the player
   * want the thing and know where it lives.
   */
  private addLockOverlay(
    card: Phaser.GameObjects.Container,
    art: Phaser.GameObjects.Image | null,
    y: number,
    size: number
  ): void {
    art?.setTint(0x6f7d92).setAlpha(0.72);
    // A soft disc under the lock: brass on a bright card is brass on nothing.
    const disc = this.scene.add.graphics();
    disc.fillStyle(num(INK.scrim), 0.42);
    disc.fillCircle(0, y, size * 0.62);
    card.add(disc);
    const lock = this.scene.add.image(0, y, 'ui_icon_lock');
    lock.setScale(size / Math.max(lock.width, lock.height));
    card.add(lock);
  }

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
    // A shut world's plate names the place instead of a price, and does nothing
    // when tapped. It is checked BEFORE owned/worn on purpose: nothing behind a
    // locked door can have been bought, so no other state can be true here.
    if (this.isLocked(item)) {
      // FULLY OPAQUE. The plate was drawn at 0.9 over a lit card, which is what
      // put a translucent haze on every shut door in the shop — a key that is
      // inert says so with its colour, never by half-vanishing.
      const plate = this.scene.add.image(0, 0, 'ui_btn_free').setScale(scale);
      const label = this.scene.add
        .text(0, -6, `Only in ${this.lockedIn(item)}`, {
          fontFamily: FONT.ui,
          // 0.68, not 0.62: the plate is smaller now, and a name of a place is
          // the whole message on a shut card — it may not shrink with the key.
          fontSize: `${Math.round(fontPx * 0.68)}px`,
          fontStyle: 'bold',
          color: INK.onFieldDim
        })
        .setOrigin(0.5);
      const lock = this.scene.add.image(0, -4, 'ui_icon_lock');
      lock.setScale((fontPx * 0.8) / Math.max(lock.width, lock.height));
      const total = lock.displayWidth + 10 + label.width;
      lock.setX(-total / 2 + lock.displayWidth / 2);
      label.setX(total / 2 - label.width / 2);
      btn.add([plate, lock, label]);
      this.priceLabels.set(item.id, label);
      return btn;
    }
    const skinAction = (section.kind === 'skin' || section.kind === 'dragon_skin') && owned && !worn;
    const isPrice = !worn && !owned;
    const text = worn ? 'WORN' : owned ? (skinAction ? 'WEAR' : 'OWNED') : `${item.gold}`;
    const btnImg = this.scene.add.image(0, 0, owned && !skinAction ? 'ui_btn_free' : 'ui_btn_price');
    btnImg.setScale(scale);
    // The plate is a dark plum face now, so its type is the rim's gold — and its
    // shadow is a dark one. A white shadow under pale type is a halo.
    const price = this.scene.add
      .text(0, -6, text, {
        fontFamily: FONT.ui,
        fontSize: `${fontPx}px`,
        fontStyle: 'bold',
        color: isPrice ? INK.onFieldGold : INK.onFieldDim
      })
      .setOrigin(0.5)
      .setShadow(0, 2, 'rgba(24,16,22,0.45)', 3);
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
      // Opaque, like the locked plate: `ui_btn_free` is already the drained
      // face of the same key, and fading it as well was the second half of the
      // haze the shop's buttons were sitting under.
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
    let art: Phaser.GameObjects.Image | null = null;
    if (this.scene.textures.exists(item.art)) {
      art = this.scene.add.image(0, 0, item.art);
      this.coverFit(art, inner.w, inner.h);
      card.add(art);
    }
    /* Same rule as the small cards: the 0.55 stop lands ON the name and the
     * foot on the plate's inner floor. The hero is 92 units shorter than it
     * was, so a scrim placed by eye would have drifted off its own type. */
    const heroFloor = inner.h / 2;
    const heroScrimTop = Math.round((HERO_NAME_Y - 0.45 * heroFloor) / 0.55);
    card.add(addScrim(this.scene, inner.w, heroFloor - heroScrimTop, heroScrimTop));
    // The sheen crosses the ART as well as the plate — a foil card whose gloss
    // stops at the picture is a picture in a shiny frame, not a foil card.
    card.add(plate.sheen);
    card.add(plate.rim);
    this.sheens.push(runSheen(this.scene, plate.sheen));

    if (item.rarity) card.add(this.makeRibbon(item.rarity, -HERO_H / 2 + 46));
    const name = this.scene.add
      .text(0, HERO_NAME_Y, item.name, {
        fontFamily: FONT.ui, fontSize: '46px', fontStyle: 'bold', color: INK.onField,
        align: 'center', wordWrap: { width: inner.w - 72 }
      })
      .setOrigin(0.5)
      .setShadow(0, 4, 'rgba(36,27,34,0.7)', 6);
    card.add(name);
    // Off the name's MEASURED foot, so a legendary whose name wraps to two
    // lines pushes its own blurb down instead of printing on top of it.
    const blurbTop = HERO_NAME_Y + name.height / 2 + BLURB_GAP;
    const blurb = this.scene.add
      .text(0, blurbTop, item.blurb, {
        fontFamily: FONT.ui, fontSize: `${BLURB_PX + 3}px`, color: FOIL.rim,
        align: 'center', wordWrap: { width: inner.w - 84 }
      })
      .setOrigin(0.5, 0)
      .setShadow(0, 3, 'rgba(36,27,34,0.7)', 5);
    this.fitBlurb(blurb, HERO_ACTION_TOP - blurbTop - BLURB_FOOT);
    card.add(blurb);
    if (this.isLocked(item)) this.addLockOverlay(card, art, -HERO_H * 0.16, 132);
    card.add(
      this.makeAction(item, section, owned, worn, HERO_ACTION_Y, HERO_ACTION_SCALE, HERO_ACTION_FONT)
    );
    return card;
  }

  private makeCard(
    x: number,
    y: number,
    item: StoreItem,
    section: StoreSection,
    /** The column width of the layout this card is being placed into — three
     *  equal columns beside a hero, four without one. */
    w: number
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
        w,
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
      g.fillRoundedRect(-w / 2, -CARD_H / 2 + 8, w, CARD_H, CARD_R);
      g.fillStyle(num(INK.field), 1);
      g.fillRoundedRect(-w / 2, -CARD_H / 2, w, CARD_H, CARD_R);
      card.add(g);
      // The rim is its own layer so full-bleed art can slide UNDER it — a
      // stroke fused into the plate would be painted over by the art.
      rim = this.scene.add.graphics();
      rim.lineStyle(6, num(worn ? INK.ember : INK.gold), 1);
      rim.strokeRoundedRect(-w / 2, -CARD_H / 2, w, CARD_H, CARD_R);
    }

    let art: Phaser.GameObjects.Image | null = null;
    if (this.scene.textures.exists(item.art)) {
      if (bleed) {
        const inner = { w: w - PLATE_INSET * 2, h: CARD_H - PLATE_INSET * 2 };
        art = this.scene.add.image(0, 0, item.art);
        this.coverFit(art, inner.w, inner.h);
        card.add(art);
        /*
         * THE SCRIM HAS TO REACH THE TYPE, and it did not.
         *
         * It ran from y -12 to the card's middle, so the name at 8 sat in its
         * palest 6% and the blurb below it sat on bare art — a dark dragon
         * against a dark sky, which is exactly where "Storm" and "Ashglass"
         * disappeared. The gradient is 0 -> 0.55 by 45% -> 0.94 at its foot, so
         * the fix is to place it by that shape rather than by eye: put the 0.55
         * stop ON the name, and the foot on the plate's inner floor.
         *
         *   floor = inner.h / 2, top = (NAME_Y - 0.45*floor) / 0.55
         *
         * which is the same relationship the hero gets for free by keeping its
         * words in its bottom third.
         */
        const floor = inner.h / 2;
        const scrimTop = Math.round((NAME_Y - 0.45 * floor) / 0.55);
        card.add(addScrim(this.scene, inner.w, floor - scrimTop, scrimTop));
      } else {
        // Contain-fit into the card's stage so a tall Manor and a squat rune
        // pad both sit inside the same rectangle. The cap is 140, not 156, and
        // the stage rides 12 higher: the picture gave up 16 units so the words
        // under it could have three lines instead of one and a half. A stage
        // that fills the card and a blurb nobody can finish reading is the
        // wrong trade on a shelf whose whole job is to describe things.
        art = this.scene.add.image(0, -114, item.art);
        art.setScale(Math.min(300 / art.width, 140 / art.height));
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

    // A BLED card's name has to stay on its scrim; a PLAIN card's has only the
    // picture above it, so it rides higher and hands the slack to the blurb.
    const nameY = bleed ? NAME_Y : PLAIN_NAME_Y;
    const name = this.scene.add
      .text(0, nameY, item.name, {
        fontFamily: FONT.ui, fontSize: '32px', fontStyle: 'bold',
        color: INK.onField,
        align: 'center', wordWrap: { width: w - 56 }
      })
      .setOrigin(0.5);
    if (bleed) name.setShadow(0, 4, 'rgba(36,27,34,0.7)', 6);
    card.add(name);
    const blurbTop = nameY + name.height / 2 + BLURB_GAP;
    const blurb = this.scene.add
      .text(0, blurbTop, item.blurb, {
        fontFamily: FONT.ui, fontSize: `${BLURB_PX}px`,
        // Cream, not the dim token. On a plum plate `onFieldDim` at 0.9 is a
        // grey whisper — and a card whose description cannot be read is a card
        // that only ever sold its own picture.
        color: bleed || foil ? FOIL.rim : INK.onField,
        align: 'center', wordWrap: { width: w - 64 }
      })
      .setOrigin(0.5, 0)
      .setAlpha(bleed || foil ? 1 : 0.88);
    if (bleed) blurb.setShadow(0, 3, 'rgba(36,27,34,0.7)', 5);
    this.fitBlurb(blurb, ACTION_TOP - blurbTop - BLURB_FOOT);
    card.add(blurb);
    if (this.isLocked(item)) this.addLockOverlay(card, art, bleed ? -60 : -114, 88);
    card.add(this.makeAction(item, section, owned, worn, ACTION_Y, ACTION_SCALE, ACTION_FONT));
    return card;
  }
}
