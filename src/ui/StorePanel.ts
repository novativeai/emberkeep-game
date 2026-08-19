import Phaser from 'phaser';
import { FONT, INK } from '../art/design';
import {
  FOIL,
  IS_MOBILE,
  LIVE_GAME_WIDTH,
  LIVE_GAME_HEIGHT,
  num,
  panelFitScale,
  panelMobileScale,
  px,
  RARITY,
  TAP_SCALE
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
/**
 * THE DEVICE LAYOUT, and why the shelf needed one at all.
 *
 * The numbers below used to be one set, tuned against the authored 2560x1600
 * landscape space and then simply scaled up on a phone. That is what broke it:
 * the space is 2560 units wide WHATEVER the device, so on a handset those units
 * span ~390 real pixels instead of ~1280, and a 21-unit blurb arrives at 3.8px.
 * The panel was not too small — the TYPE was, by a factor the panel scale
 * cannot recover because the panel is already at 94% of the width.
 *
 * Worse, the landscape frame is 2032x1240 in a portrait space that is ~5500
 * tall: the store sat in a letterbox using a quarter of the screen and left the
 * rest black, then crammed four columns into it.
 *
 * So, exactly as the dark Codex does it (`CX` there): a phone gets the PORTRAIT
 * sheet, TWO columns, cards tall enough to hold stepped type, and a showcase
 * card that spans the full width at the top of the shelf rather than standing
 * beside the grid. Desktop keeps every number it had, to the unit.
 *
 * Plate geometry, measured off the PAINTED frames (both are logical x RES):
 *   ui_store_panel  1016x620 @ y+40  -> inside x -1016..1016, y -588..652
 *   ui_panel_tall   1180x2040 @ y 0  -> inside x -1136..1136, y -2008..1992
 *
 * THE PORTRAIT HEADER IS ONE COLUMN OF ARITHMETIC, and it used not to be.
 *
 * Every number in it was picked on its own, and two of them landed on top of
 * each other. `ui_btn_round_royal` is painted 68x68 logical = 136x136 game
 * units, its slab a r=29 circle at (34,38) and its face a r=28 at (34,31), so
 * with the 3.4 rims the ink runs x +-61.4, y -65.4..69.4 about the image
 * centre. At the 0.58 the art is drawn with, dropped 6, inside a container at
 * TAP_SCALE (2.2), that is x +-78 and y -70..+102 around `closeY` — and the
 * hit box around it is 96 x 2.2 = 211 square. Parked at (1010, -1900) the ink
 * therefore covered y -1970..-1798, while two rows of tabs at a 176 pitch put
 * the top row at -1853..-1703 and its right-hand column at x 34..1094. The
 * key was printed ON that tab over 55 units of it, across the tab's full
 * width — which is what the ✕ looked like it was sitting on, because it was.
 *
 * So the header is measured DOWN THE PLATE from its own inner rim now:
 *
 *   plate inner top (the gold rim)        -2008
 *   banner band, 270 = px(104)            -2143 .. -1873   straddles the rim, 135 either side
 *   title, centred on the rim             -2006            band centre + 2, as desktop's -586 = -588 + 2
 *   ✕ ink   (x 932..1088)                 -1978 .. -1806   30 inside the rim; the corner arc clears it by 28
 *   ✕ hit box                             -2014 .. -1802
 *   tab block, 2 rows of 216, pitch 284   -1762 .. -1262   40 under the ✕ hit box, 111 under the band
 *   section blurb, at most 4 lines of 78  -1194 ..  -794
 *   shelf window top                       -730
 *
 * The gutter down that tab block is 68 — the same 68 the two columns already
 * had (1128 pitch - 1060 tab), so the grid is spaced by one number, not two.
 * The shelf window pays for the header: 2660 instead of 3160. It is a SCROLLER,
 * and 500 units of it are worth a row of tabs the player can read.
 */
const CX = IS_MOBILE
  ? {
      frameKey: 'ui_panel_tall',
      frameY: 0,
      /** The plate's inner box. */
      plateX: 1136,
      titleY: -2006,
      bannerY: -2143,
      /** The cartouche may not reach the ✕, whose hit box starts at x 904 — so
       *  half the band has to stop 32 short of that. The band the authored
       *  title actually gets is the stepped floor, px(620) = 1612 (166px
       *  "KEEPER'S STORE" measures ~1280, + 200 = ~1480, under the floor), so
       *  the cap has 128 of slack today and is here for the day a font fallback
       *  measures the title wider than the plate can hold beside the key. */
      bannerMaxW: 1740,
      closeX: 1010,
      closeY: -1908,
      tabsY: -1512,
      tabCols: 2,
      tabW: 1060,
      tabH: 216,
      tabGapX: 1128,
      tabGapY: 284,
      /** STEPPED, at last. 56 units is 8.5 real pixels on a 390px handset: the
       *  tabs were the smallest type on a screen whose body blurb is px(30) and
       *  whose title is px(64) — the navigation was the one thing nobody could
       *  read. px(36) is 94, and the pill is 216 = 2.3x that, exactly the ratio
       *  the desktop pill has to its own 40. */
      tabFont: px(36),
      /** A 6-unit stroke is 0.9 real pixels in portrait — it disappears, and a
       *  rim is how the active pill is told from the sunken one. The pill is
       *  216/92 = 2.35x the desktop one, so its rim is 6 x 2.35 = 14. */
      tabRim: 14,
      blurbY: -994,
      blurbWrap: 2100,
      /** Four lines of px(30), whose line box is ~97: 4 x 97 = 388, so 400. The
       *  longest blurb is 173 characters and wraps to exactly four lines at
       *  2100. This is what makes the shelf's top edge a fact instead of a hope
       *  — see the fit in `buildBody`. */
      blurbMaxH: 400,
      cols: 2,
      cardW: 1040,
      cardH: 1040,
      viewTop: -730,
      viewBottom: 1930,
      /** Portrait stacks: the showcase card takes the full width above the
       *  grid rather than a column beside it. */
      heroStacked: true,
      heroW: 2144,
      heroH: 1500
    }
  : {
      frameKey: 'ui_store_panel',
      frameY: 40,
      plateX: 1016,
      titleY: -586,
      bannerY: -640,
      /** Never binds: the ✕ hit box starts at x 916 and today's band is 712
       *  wide. Same guard as portrait, same reason. */
      bannerMaxW: 1760,
      /** 924/-512, in from 964/-538: the disc's ink ended 6 units from the
       *  plate's face and sat on the corner arc. */
      closeX: 924,
      closeY: -512,
      tabsY: -430,
      tabCols: 4,
      tabW: 420,
      tabH: 92,
      tabGapX: 470,
      tabGapY: 0,
      tabFont: 40,
      /** The banner's own rim weight — the tabs are made of the same thing. */
      tabRim: 6,
      blurbY: -344,
      blurbWrap: 1860,
      /** Measured: the longest blurb is 2 lines of 30px = 72 units here, so the
       *  budget never binds on the landscape sheet. It is a guard against a
       *  future line of copy reaching the top row of cards, not a layout rule. */
      blurbMaxH: 200,
      cols: 4,
      cardW: 428,
      cardH: 380,
      viewTop: -300,
      viewBottom: 652,
      heroStacked: false,
      heroW: 592,
      heroH: 824
    };

/*
 * THE SHELF, DERIVED FROM ONE NUMBER — still true, on both layouts.
 *
 * AIR is the outer margin AND every gutter, and the card sizes are whatever is
 * left once it has been paid on all four sides.
 *
 *   desktop  4*428 + 3*64 = 1904, + 2*64 = 2032  ✓  (hero 592+64+592+64+592)
 *   phone    2*1040 + 64 = 2144,  + 2*64 = 2272  ✓  (hero spans all 2144)
 */
const AIR = 64;
const CARD_W = CX.cardW;
const CARD_H = CX.cardH;
const CARD_R = IS_MOBILE ? 46 : 34;
const COLS = CX.cols;
const COL_GAP = CARD_W + AIR; // a PITCH: the visible gutter is AIR
const VIEW_TOP = CX.viewTop;
const VIEW_BOTTOM = CX.viewBottom;
const VIEW_H = VIEW_BOTTOM - VIEW_TOP;
const GRID_MID = (VIEW_TOP + VIEW_BOTTOM) / 2;
/** Row PITCH, not row height — the gap between two rows is `ROW_GAP - CARD_H`. */
const ROW_GAP = CARD_H + AIR;

/** The showcase card. On desktop its height IS the whole grid, so it can never
 *  disagree with the cards beside it; in portrait it is a full-width banner
 *  above them and answers only to itself. */
const HERO_H = CX.heroStacked ? CX.heroH : ROW_GAP + CARD_H;
const HERO_W = CX.heroW;
const HERO_GAP = AIR;
/** Ordinary columns BESIDE a hero are hero-width — three equal columns, not a
 *  wide card beside two narrow ones. Meaningless when the hero is stacked. */
const HERO_COLS = 2;
const HERO_CARD_W = HERO_W;
const HERO_COL_GAP = HERO_CARD_W + AIR;

/**
 * THE TAB IS THE BANNER'S PILL, SHRUNK — the four layers, in the same order.
 *
 * `drawBanner` states the vocabulary this panel is built from: a `goldDeep`
 * SEAT 10 units below the face, the FACE, a `gold` RIM, then a gloss STRIP
 * inset 14 with its top 8 down and 34 tall. Every one of those is a fraction
 * of that band's 104, so a pill of any height can be made of the same thing:
 *
 *   seat  10/104 = 0.096      strip inset  14/104 = 0.135
 *   top    8/104 = 0.077      strip height 34/104 = 0.327
 *
 * On the desktop pill (92 tall) that comes to 9 / 12 / 7 / 30; on the portrait
 * one (216), to 21 / 29 / 17 / 71 — one object, twice the size.
 *
 * THE SEAT IS PAID FOR OUT OF THE FACE, NOT OUT OF THE AIR UNDER THE ROW —
 * and that rule is the whole reason this note exists.
 *
 * The banner can hang its seat 10 units below its face because nothing is
 * seated under the banner. A TAB has the section blurb 40 units beneath it,
 * and this repaint was declared as "no position moved" while quietly moving
 * the pill's lowest ink 9 units down into it. The desktop arithmetic, which is
 * the tight one:
 *
 *   tab rect (tabsY -430, halfH 46)        -476 .. -384
 *   seat drawn BELOW the face, +9          -467 .. -375   <- 9 units outside
 *   sectionBlurb, origin 0.5 at            -344
 *     longest shipped copy (store.json
 *     "decor", 173 chars) wraps to 2 lines
 *     at 30px in the 1860 wrap: 2 x 30 x
 *     1.16..1.25 = 70..75 tall, so its box  -379 .. -309  ..  -381 .. -306
 *
 * i.e. the gold seat's bottom edge landed 3.8 to 6.5 units INSIDE the blurb's
 * own layout box, on a container (`tabsRow`) that is added to the panel AFTER
 * the blurb and therefore paints over it. Measured to the visible ink — the
 * caps of the first line, which start (0.94 - 0.715) x 30 = 6.7 below the
 * box's top — the air went from 6.8..9.4 units down to 0.3..2.9. Nought point
 * three is touching.
 *
 * There is nowhere to put that 9 back. The blurb's box already ends 6.5 units
 * above the shelf window at -300, and above the tabs is a measured header. So
 * the four layers are drawn INSIDE the tab's own rect instead: the face is
 * `seat` units shorter and the seat fills the gap, bottom edge flush with the
 * rect. The pill's lowest ink is then -384, the box's own floor — 9.3..11.9
 * units of visible air, i.e. better than the stroke it replaced, and a
 * footprint that is exactly the box every other seat on this panel was
 * measured against (and exactly what `setSize` gives the pointer). On both
 * devices — which is also what keeps the portrait header column in `CX` true
 * to the unit: its tab block really does end at -1262, not 21 units lower.
 */
const TAB_SEAT = 0.096;
const TAB_STRIP_INSET = 0.135;
const TAB_STRIP_TOP = 0.077;
const TAB_STRIP_H = 0.327;

/** The SOON tab stacks two labels, and both offsets are fractions of the PILL:
 *  -0.1 lifts the title, +0.28 drops the sub-label, which is 0.55 of the tab's
 *  type. Fractions of the pill are safe on both devices because the pill is
 *  kept at 2.3x its own type on both (92/40 and 216/94), so the two glyph
 *  boxes stay exactly as far apart, relatively, as the desktop pair that
 *  already reads correctly. */
const TAB_LABEL_LIFT = 0.1;
const TAB_SOON_DROP = 0.28;
const TAB_SOON_FONT = 0.55;

/** Past this much drag the gesture is a scroll, and the card under the finger
 *  must not also be bought. */
const DRAG_SLOP = 12;

/**
 * THE CARD'S TYPE IS LAID OUT FROM ITS KEY UPWARDS, not from its top down.
 *
 * Nothing used to measure anything: a fixed name y, a fixed blurb y, and the
 * buy plate drawn afterwards at a fixed y of its own — which left the blurb 39
 * units on a 380-tall card and put every two-line description under the button.
 * The geometry is stated once here and the words are FITTED into what is left
 * (`fitBlurb`). The one number that has to be right is ACTION_TOP: everything
 * the player reads has to end above it.
 */

/** Where a BLED card's name sits — the scrim under it is placed FROM this, so
 *  it cannot move without the gradient moving with it. */
const NAME_Y = IS_MOBILE ? 60 : 8;
/** And where a PLAIN card's name sits: no scrim to answer to, only the art
 *  above and the key below, so it rides high and hands its slack to the blurb. */
const PLAIN_NAME_Y = IS_MOBILE ? -80 : -18;
/** The showcase card's name. */
const HERO_NAME_Y = IS_MOBILE ? 120 : 138;

/** `ui_btn_price`/`ui_btn_free` are painted 230x66 logical, so the plate is
 *  460x132 board units and its half-height is 66 x whatever scales it. */
const ACTION_PLATE_HALF_H = 66;
/** Reduced from 0.74 on desktop: at 340 wide the key ate 79% of the card and
 *  its top edge cut into the blurb. In portrait it grows with the card. */
const ACTION_SCALE = IS_MOBILE ? 1.5 : 0.58;
const ACTION_FONT = px(32);
/**
 * THE AIR UNDER THE KEY — a MARGIN, not an offset from the card's middle.
 *
 * It used to be written as "130 (or 50) up from the half-height", which says
 * nothing about the only thing that matters: how much card is left underneath.
 * Once the plate's own half-height was subtracted, the answer was 11.7 units on
 * the landscape card and 31 in portrait — against a 6-unit rim with an 8-unit
 * seat drawn below it, so the key was sitting ON the moulding rather than
 * inside it. Three per cent of the card's height is not a margin, it is a
 * rounding error that happened to be positive.
 *
 * Stated as a foot instead, and paid out of the gutter the shelf already uses:
 * AIR in portrait, where a 1040-tall card has it to spare, and 40% of AIR on
 * the 380-tall landscape one, which is the most it can give without eating a
 * line of blurb (`fitBlurb` shrinks to fit, and the budget is measured from
 * ACTION_TOP).
 */
const ACTION_FOOT = IS_MOBILE ? AIR : Math.round(AIR * 0.4);
const ACTION_Y = CARD_H / 2 - ACTION_FOOT - ACTION_PLATE_HALF_H * ACTION_SCALE;
const ACTION_TOP = ACTION_Y - ACTION_PLATE_HALF_H * ACTION_SCALE;
const HERO_ACTION_SCALE = IS_MOBILE ? 2 : 0.82;
const HERO_ACTION_FONT = px(40);
/** The showcase card's key gets the same foot. Its plate is bigger, so the
 *  number it used to carry (170 / 64) was even further from being a margin. */
const HERO_ACTION_Y = HERO_H / 2 - ACTION_FOOT - ACTION_PLATE_HALF_H * HERO_ACTION_SCALE;
const HERO_ACTION_TOP = HERO_ACTION_Y - ACTION_PLATE_HALF_H * HERO_ACTION_SCALE;

/** The blurb's preferred size, and the floor it may shrink to before the text
 *  is truncated instead. Stepped into the portrait space so the same sentence
 *  reads the same size on a phone as on a desktop.
 *
 *  25/17, up from 21/16 — the owner read the card copy at ~10 real px on a
 *  1080p screen and called it too small. Sized against the measured budgets:
 *  a PLAIN landscape card hands the blurb 68.2 units (3 lines at the 17 floor
 *  = 64.8, still fits) and a BLED one 42.2 (2 lines at 17 = 40.8, still fits),
 *  so the raise buys size where there is room and costs no line anywhere. */
const BLURB_PX = px(25);
const BLURB_MIN_PX = px(17);
/** The SECTION's blurb — the line under the tabs, not the one on a card. Its
 *  own constant because `buildBody` has to reset the size before re-fitting
 *  it, and a size that lives in two places is a size that drifts. */
const BLURB_SECTION_PX = px(30);
/** Air under the name's foot, and over the key's top edge. */
const BLURB_GAP = IS_MOBILE ? 12 : 8;
const BLURB_FOOT = IS_MOBILE ? 18 : 10;

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
  /**
   * The shortfall notice is up over this panel — the shelf holds still.
   *
   * Not politeness, and not something the scrim can do for us: the drag is read
   * off `scene.input`'s own POINTER_DOWN/MOVE/UP, which fire for every pointer
   * in the scene regardless of which object captured the event. Without this a
   * thumb sliding on the notice scrolls the shelf underneath it, which is
   * exactly the place the notice exists to keep.
   */
  private frozen = false;
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

    // THE DIM SWALLOWS; IT DOES NOT DISMISS.
    //
    // It stays interactive, because that is the whole reason it exists: Phaser
    // walks the live scenes top-down on every pointer event and stops at the
    // first one that captured it, so a screen-sized interactive rectangle in
    // UIScene is what keeps a tap meant for the shop off the board underneath.
    // What it must NOT do is close. It carried a `pointerup -> requestClose`,
    // and with a shelf that scrolls, that meant a drag that ended a few units
    // off a card, a tap in the gutter between two cards, or a thumb landing on
    // the plate's margin threw the whole panel away mid-browse. The ✕ is the
    // only way out — which is also the button Eleanor's walkthrough points at.
    //
    // AND IT DOES NOT CANCEL. Being interactive is the whole swallow: Phaser
    // walks the live scenes top-down and stops at the first that captured, and
    // WITHIN a scene `InputPlugin.topOnly` is true by default (this project
    // never overrides it), so the pointerup reaches the top object and nothing
    // under it. The HUD key beneath this scrim was never hearing it.
    //
    // Calling `stopPropagation` here is therefore free of upside and expensive:
    // it sets `_eventData.cancelled`, and `processUpEvents` skips its own
    // scene-level `POINTER_UP` emit once that is set. That emit is where THIS
    // panel releases its scroll drag (`onPointerUp` -> `dragFrom = null`), so
    // cancelling it leaves the shelf tracking a cursor with no button held, for
    // the rest of the session. A swallow that silences the whole scene is not a
    // swallow. It was tried, measured, and taken back out — hence this note.
    this.dim = scene.add
      .rectangle(0, 0, LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, num(INK.scrim), 0.62)
      .setInteractive();

    const frame = scene.add.image(0, CX.frameY, CX.frameKey);
    // Bound by BOTH axes in portrait: the tall sheet is 4080 units high in a
    // ~5500-unit space, and a width-only fit would let it run off the bottom on
    // a squarer handset. Desktop keeps the width-only rule it was tuned with.
    this.baseScale = IS_MOBILE
      ? panelFitScale(frame.width, frame.height)
      : panelMobileScale(frame.width);

    this.titleBg = scene.add.graphics();
    this.titleText = scene.add
      .text(0, CX.titleY, "KEEPER'S STORE", {
        fontFamily: FONT.ui, fontSize: `${px(64)}px`, fontStyle: 'bold', color: INK.onField
      })
      .setOrigin(0.5)
      .setShadow(0, 5, 'rgba(36,27,34,0.55)', 6);

    // The section's one-line pitch, ABOVE the grid rather than inside it: a
    // two-row section starts at -300, and a blurb parked in the shelf container
    // ended up behind the first row of cards.
    this.sectionBlurb = scene.add
      .text(0, CX.blurbY, '', {
        fontFamily: FONT.ui, fontSize: `${BLURB_SECTION_PX}px`, color: INK.onFieldDim,
        align: 'center', wordWrap: { width: CX.blurbWrap }
      })
      .setOrigin(0.5);

    // THE POCKET IS 101 UNITS WIDE, and that is what sizes this key.
    //
    // `ui_store_panel`'s inner plate runs x -1016..1016, y -588..652, and the
    // rightmost tab (`buildTabs`) ends at x 915 with its top edge at y -476. So
    // the free corner is 101 x 112 — a 0.92 disc is 125 across and cannot sit in
    // it without riding the frame, which is exactly what it was doing.
    //
    // In portrait the pocket is not the constraint, the THUMB is: 96 units of
    // hit box is 15 real pixels on a handset, well under the 44px platform
    // minimum. `TAP_SCALE` is the smallest multiplier that clears it — and it
    // grows the HIT BOX to 211 square, which is why the portrait key needed a
    // pocket of its own rather than the corner the landscape one is tucked in.
    // At `closeY` -1908 its ink runs y -1978..-1806 and its hit box -2014..
    // -1802: 30 below the plate's inner rim, clear of the rounded corner by 28
    // at its widest, and 40 above the first row of tabs. It used to be at -1900
    // with the tabs starting at -1853, i.e. printed on the right-hand tab.
    const close = scene.add.container(CX.closeX, CX.closeY);
    this.closeBtn = close;
    // The royal candy disc: a plum face in a gold rim, painted rather than a
    // cream HUD button under a flat tint.
    const closeBg = scene.add.image(0, 6, 'ui_btn_round_royal').setScale(0.58);
    const closeX = scene.add
      .text(0, -2, '✕', { fontFamily: FONT.ui, fontSize: '40px', fontStyle: 'bold', color: INK.onFieldGold })
      .setOrigin(0.5);
    close.add([closeBg, closeX]);
    // 96, not 120: on desktop the old hit box reached over the last tab.
    close.setSize(96, 96).setInteractive({ useHandCursor: true });
    close.setScale(TAP_SCALE);
    close.on('pointerover', () => close.setScale(TAP_SCALE * 1.08));
    close.on('pointerout', () => close.setScale(TAP_SCALE));
    close.on('pointerup', () => this.requestClose());

    this.tabsRow = scene.add.container(0, CX.tabsY);
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
    this.offBus.push(
      bus.on('ui:topup_toggled', ({ open }) => {
        this.frozen = open;
        // Drop any drag in flight, so the shelf does not resume a gesture that
        // started before the notice went up and ended somewhere else entirely.
        if (open) this.dragFrom = null;
      })
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

  /**
   * WHERE THE PLAYER WAS, as a value they can be put back at.
   *
   * A gold refusal here sends them to the Emporium, and the whole reason the
   * shortfall notice exists is that being sent somewhere must not cost them
   * their place. Section AND scroll, because the shelf is four tabs of a list
   * that scrolls: coming back to the right tab at the top of it is still
   * losing your place if the card you were reading was eight rows down.
   */
  viewState(): { section: number; scroll: number } {
    return { section: this.activeIndex, scroll: this.scrollY };
  }

  /**
   * Put the shelf back. Both halves are re-clamped rather than trusted: the
   * catalogue can have changed while the player was away (a purchase, a world
   * crossing), so the row they were looking at may no longer exist and the
   * remembered scroll may be past the end of a shorter shelf.
   */
  /**
   * Put the player back where they were — and SURVIVE the rebuild that follows.
   *
   * `setScroll` here is not enough on its own. `open()` kicks off
   * `ensureTextures(...)`, whose callback rebuilds the body when the art
   * arrives, and `buildBody()` ends with `setScroll(0)` in both layout
   * branches. On a warm cache the textures are already resident and the
   * callback runs before this line; on a cold one it runs after, and the
   * restored position is thrown away. The whole promise of the return ticket
   * is the second case, which is the one a player crossing into a new world
   * actually meets.
   *
   * So the position is PARKED as well as applied, and `buildBody` spends the
   * parked value instead of zeroing. One-shot: a rebuild the player caused by
   * changing tabs must still start at the top.
   */
  restoreView(view: { section: number; scroll: number }): void {
    this.activeIndex = Phaser.Math.Clamp(view.section, 0, this.sections.length - 1);
    this.pendingScroll = view.scroll;
    this.refresh();
  }

  /** A scroll offset owed to a restore, spent by the next `buildBody`. Null
   *  when a rebuild should land at the top, which is every other time. */
  private pendingScroll: number | null = null;

  /** Land the shelf: at the parked offset if a restore owes one, otherwise at
   *  the top. `setScroll` re-clamps, so a section with less content than the
   *  one we left cannot strand the view past its own floor. */
  private spendPendingScroll(): void {
    const owed = this.pendingScroll;
    this.pendingScroll = null;
    this.setScroll(owed ?? 0);
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

  /** A catalogue item by id, across every section — the shelf draws one section
   *  at a time, but a refusal can name any of them. */
  private itemById(itemId: string): StoreItem | undefined {
    for (const section of this.sections) {
      const found = section.items.find((item) => item.id === itemId);
      if (found) return found;
    }
    return undefined;
  }

  /** Where a padlocked card is sold, as the player would name it. */
  private lockedIn(item: StoreItem): string {
    return this.gameState.worlds.get(item.world ?? '')?.name ?? 'another world';
  }

  /** Shake + redden the refused price, so a denial is felt on the card the
   *  player tapped rather than announced somewhere else on screen. */
  private refuse(itemId: string, reason: 'gold' | 'owned' | 'no_room' | 'locked'): void {
    // OFFERED BEFORE THE SHAKE, and before the early return below.
    //
    // The shake needs the refused card to still be on screen; the notice does
    // not, and a purchase can be refused for an item the shelf has since
    // scrolled or re-tabbed away from (StoreSystem re-validates on its own
    // data, not on what is drawn). Whether the offer is ALLOWED is UIScene's
    // question, not this panel's — it holds the tutorial gate and `TOP_UP.offer`.
    if (reason === 'gold') {
      const item = this.itemById(itemId);
      if (item) {
        this.bus.emit('ui:topup_requested', { label: item.name, price: item.gold, source: 'store' });
      }
    }
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

  /**
   * The title cartouche — a candy band pinned ACROSS the plate's top rim.
   *
   * Its y was the literal -640, which is the landscape `bannerY` and nothing
   * else: on a handset the title text moved to the top of the tall sheet and
   * the band stayed behind, painting a 1480x104 gold-rimmed bar across the
   * middle of the shelf, under the cards, 590 units inside the scroll window.
   * It reads off `CX.bannerY` now, and every measurement in it is stepped, so
   * the band grows with the type it is a plate for: at px(64) = 166 the title's
   * line box is ~200 and a 104-tall band would have been a stripe behind a word
   * twice its height. 104 x 2.6 = 270, which is the 135-either-side-of-the-rim
   * the portrait header column is built on. Desktop steps by 1 — every number
   * below is the number it has always been, to the unit.
   */
  private drawBanner(width: number): void {
    const w = Math.min(CX.bannerMaxW, Math.max(px(620), width));
    const y = CX.bannerY;
    const h = px(104);
    const r = px(34);
    const g = this.titleBg;
    g.clear();
    g.fillStyle(num(INK.goldDeep), 1);
    g.fillRoundedRect(-w / 2, y + px(10), w, h, r);
    g.fillStyle(num(INK.field), 1);
    g.fillRoundedRect(-w / 2, y, w, h, r);
    g.lineStyle(px(6), num(INK.gold), 1);
    g.strokeRoundedRect(-w / 2, y, w, h, r);
    g.fillStyle(num(INK.fieldLift), 0.5);
    g.fillRoundedRect(-w / 2 + px(14), y + px(8), w - px(28), px(34), px(18));
  }

  /**
   * The shelf switcher — four SEATED pills, one of them plainly out of its hole.
   *
   * They were a flat fill and a 5-unit stroke: the only surface in the panel
   * that was not made of anything, which is why a row of them read as a browser
   * toolbar dropped onto a candy plate, and why the section you were on had to
   * be worked out from a colour. They are the banner's pill now (see TAB_SEAT
   * and friends), and the two states differ four ways at once:
   *
   *   ACTIVE   a goldDeep seat under the face, the lit `fieldLift` face, the
   *            full `gold` rim, a `fieldGlow` gloss along the top, cream ink.
   *   INACTIVE nothing under it, the `fieldDeep` face — darker than the plate
   *            it is cut into — a `goldDeep` rim, dim ink, and the same strip
   *            painted in scrim instead of light, which is what the top edge of
   *            a sunken thing looks like.
   *
   * Four differences means the live shelf is legible at arm's length on a
   * handset without reading a single colour. Both faces are painted at the SAME
   * rect, so switching tabs never moves one by a unit; the lift is entirely in
   * what is drawn around it.
   *
   * ALL FOUR LAYERS STAY INSIDE THE TAB'S OWN RECT — the face is `seat` units
   * shorter than the box and the gold fills the gap, rather than the gold
   * hanging below the box the way the banner's does. The rect is what the
   * section blurb 40 units below was measured against, and what `setSize`
   * hands the pointer; a pill that paints past it is a layout change wearing a
   * repaint's clothes. See TAB_SEAT for the arithmetic and for what it cost the
   * blurb before this.
   */
  private buildTabs(): void {
    this.tabsRow.removeAll(true);
    // FOUR ACROSS, OR TWO BY TWO. Four 420-wide tabs fit the landscape plate
    // exactly; in portrait a tab wide enough to hold "Manor Skins" at readable
    // type is 1060, and two of those are the whole plate — so the row wraps into
    // a grid rather than shrinking type nobody could read.
    const cols = CX.tabCols;
    const rows = Math.ceil(this.sections.length / cols);
    const startX = -((cols - 1) * CX.tabGapX) / 2;
    const startY = -((rows - 1) * CX.tabGapY) / 2;
    const halfW = CX.tabW / 2;
    const halfH = CX.tabH / 2;
    // The pill's own geometry, off its height: the corner is a third of it (the
    // banner's 34 on 104), and the seat and strip are the fractions above.
    const radius = CX.tabH / 3;
    const seat = Math.round(CX.tabH * TAB_SEAT);
    const stripX = Math.round(CX.tabH * TAB_STRIP_INSET);
    const stripY = Math.round(CX.tabH * TAB_STRIP_TOP);
    const stripH = Math.round(CX.tabH * TAB_STRIP_H);
    // THE FACE PAYS FOR THE SEAT (see TAB_SEAT). The face keeps the rect's top
    // edge and gives up `seat` at the bottom; the seat fills that gap and ends
    // flush with the rect. Desktop: a 92-tall box holds an 83-tall face with 9
    // of gold showing under it, and the pill's lowest ink is back at -384
    // where the blurb below was measured against it. Portrait: 195 and 21.
    //
    // The `tabFont` note's "the pill is 2.3x its own type on both devices"
    // survives this: it is stated of the BOX, which has not changed, and the
    // face keeps the equality anyway — 83/40 = 2.08 desktop, 195/94 = 2.07
    // portrait. Still one object at two sizes, with 9.6% less of it showing.
    const faceH = CX.tabH - seat;
    // Everything printed on the pill is centred on the FACE, not on the box, so
    // the type sits where it always did relative to the surface it is on: the
    // label was 2 units above the face's middle before this and is 2 units
    // above it now. Nothing on screen moves; the face moved out from under it
    // by `seat / 2` and the type follows.
    const faceMid = -seat / 2;
    this.sections.forEach((section, i) => {
      const active = i === this.activeIndex;
      const tab = this.scene.add.container(
        startX + (i % cols) * CX.tabGapX,
        startY + Math.floor(i / cols) * CX.tabGapY
      );
      const g = this.scene.add.graphics();
      // 1 — the seat, under the ACTIVE pill only. A lifted thing has something
      //     under it; a recessed one has nothing to cast onto. It ends on the
      //     rect's bottom edge, so the gold is the only thing in the pill that
      //     reaches it and nothing reaches past it.
      if (active) {
        g.fillStyle(num(INK.goldDeep), 1);
        g.fillRoundedRect(-halfW, -halfH + seat, CX.tabW, faceH, radius);
      }
      // 2 — the face, `seat` short of the rect's floor.
      g.fillStyle(num(active ? INK.fieldLift : INK.fieldDeep), 1);
      g.fillRoundedRect(-halfW, -halfH, CX.tabW, faceH, radius);
      // 3 — the rim. Same weight either way, so only its COLOUR moves and the
      //     pill's footprint is the same in both states.
      g.lineStyle(CX.tabRim, num(active ? INK.gold : INK.goldDeep), 1);
      g.strokeRoundedRect(-halfW, -halfH, CX.tabW, faceH, radius);
      // 4 — the strip along the top: the hall's own cool light (`fieldGlow`,
      //     the token that exists for exactly this) on the lifted pill, and the
      //     scrim on the sunken one.
      g.fillStyle(num(active ? INK.fieldGlow : INK.scrim), active ? 0.42 : 0.34);
      g.fillRoundedRect(-halfW + stripX, -halfH + stripY, CX.tabW - stripX * 2, stripH, stripH / 2);
      const label = this.scene.add
        .text(0, faceMid - 2, section.title, {
          fontFamily: FONT.ui,
          fontSize: `${CX.tabFont}px`,
          fontStyle: 'bold',
          color: active ? INK.onField : INK.onFieldDim
        })
        .setOrigin(0.5);
      // The live tab's type sits ON something, so it casts too. Stepped, or the
      // shadow is a third of a real pixel on a handset and simply is not there.
      if (active) label.setShadow(0, px(3), 'rgba(21,15,20,0.6)', px(4));
      tab.add([g, label]);
      // "Soon" sections still read as tabs — the shelf is the announcement.
      if (section.kind === 'soon') {
        tab.add(
          this.scene.add
            .text(0, faceMid + CX.tabH * TAB_SOON_DROP, 'SOON', {
              fontFamily: FONT.ui,
              fontSize: `${Math.round(CX.tabFont * TAB_SOON_FONT)}px`,
              fontStyle: 'bold',
              color: active ? INK.onFieldGold : INK.onFieldDim
            })
            .setOrigin(0.5)
        );
        label.setY(faceMid - CX.tabH * TAB_LABEL_LIFT);
      }
      tab.setSize(CX.tabW, CX.tabH).setInteractive({ useHandCursor: true });
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
    // THE BLURB IS FITTED TO ITS BAND, not hoped into it. The copy is authored
    // prose and the longest of the four is 173 characters: at px(30) = 78 that
    // wraps to four lines in portrait, and the header column budgeted exactly
    // four (CX.blurbMaxH). A fifth would print on the top row of cards, so the
    // same treatment a card's blurb gets applies here — shrink a point at a
    // time, truncate only if the floor still overflows. The size is reset first
    // because `fitBlurb` shrinks the object in place: a section opened after a
    // long one would otherwise keep the smaller type for the rest of the visit.
    this.sectionBlurb.setFontSize(BLURB_SECTION_PX).setText(section.blurb);
    this.fitBlurb(this.sectionBlurb, CX.blurbMaxH);

    if (section.kind === 'soon') {
      this.shelf.add(
        this.scene.add
          .text(0, -60, 'AVAILABLE SOON', {
            fontFamily: FONT.ui, fontSize: `${px(76)}px`, fontStyle: 'bold', color: INK.onFieldGold
          })
          .setOrigin(0.5)
          .setAlpha(0.85)
      );
      return;
    }

    const hero = section.items.find((item) => item.hero) ?? null;
    const rest = hero ? section.items.filter((item) => item !== hero) : section.items;

    if (CX.heroStacked) {
      /*
       * PORTRAIT: the showcase card is a BANNER, not a column.
       *
       * Beside-the-grid only works when the grid is wide enough to lose a
       * column to it. On a phone the shelf is two columns; giving one to the
       * hero leaves a single file of cards down half a screen, with the other
       * half a tall poster. So the hero takes the full width at the top and the
       * grid runs whole underneath it — the shelf scrolls anyway, and vertical
       * room is the one thing a portrait screen is not short of.
       */
      const rows = Math.ceil(rest.length / COLS);
      const gridH = rows > 0 ? (rows - 1) * ROW_GAP + CARD_H : 0;
      const contentH = (hero ? HERO_H + AIR : 0) + gridH;
      // Short sections stay optically centred; an overflowing one starts at the
      // top of the window, because a centred overflow hides its first row as
      // well as its last. Either way it pays AIR top and bottom.
      const top =
        contentH <= VIEW_H - 2 * AIR ? -contentH / 2 : -VIEW_H / 2 + AIR;
      this.maxScroll = Math.max(0, contentH + 2 * AIR - VIEW_H);
      if (hero) this.place(this.makeHeroCard(0, top + HERO_H / 2, hero, section), hero);
      const gridTop = top + (hero ? HERO_H + AIR : 0);
      const colStartX = -((COLS - 1) * COL_GAP) / 2;
      rest.forEach((item, i) => {
        this.place(
          this.makeCard(
            colStartX + (i % COLS) * COL_GAP,
            gridTop + Math.floor(i / COLS) * ROW_GAP + CARD_H / 2,
            item,
            section,
            CARD_W
          ),
          item
        );
      });
      this.spendPendingScroll();
      this.seatMask();
      return;
    }

    // LANDSCAPE: one showcase card may claim the left of the shelf at full grid
    // height; everything else falls into the columns left over. Both halves are
    // laid out from the same measured total, so the block stays centred whether
    // or not the section has a hero.
    const cols = hero ? HERO_COLS : COLS;
    // THE COLUMN WIDTH IS A PROPERTY OF THE LAYOUT, not of the card.
    //
    // A hero shelf is three equal columns and a plain shelf is four, and both
    // come to the same 1904 — so the block is the same width on every tab and
    // stops sliding sideways when the player changes shelf.
    const cardW = hero ? HERO_CARD_W : CARD_W;
    const colGap = hero ? HERO_COL_GAP : COL_GAP;
    const blockW = (cols - 1) * colGap + cardW;
    const total = hero ? HERO_W + HERO_GAP + blockW : blockW;
    const left = -total / 2;

    if (hero) this.place(this.makeHeroCard(left + HERO_W / 2, 0, hero, section), hero);

    const blockMidX = hero ? left + HERO_W + HERO_GAP + blockW / 2 : 0;
    const rows = Math.ceil(rest.length / cols);
    const contentH = (rows - 1) * ROW_GAP + CARD_H;
    const startY =
      contentH <= VIEW_H - 2 * AIR
        ? -((rows - 1) * ROW_GAP) / 2
        : -VIEW_H / 2 + AIR + CARD_H / 2;
    this.maxScroll = Math.max(0, contentH + 2 * AIR - VIEW_H);
    // Every row starts at the block's left edge — the BLOCK is centred, the rows
    // inside it are a grid. A short final row therefore leaves its gap on the
    // right rather than re-centring itself.
    const colStartX = blockMidX - ((cols - 1) * colGap) / 2;
    rest.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      this.place(
        this.makeCard(colStartX + col * colGap, startY + row * ROW_GAP, item, section, cardW),
        item
      );
    });
    this.spendPendingScroll();
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
    if (!this.isOpen || this.frozen || this.maxScroll <= 0) return;
    this.setScroll(this.scrollY + dy);
  };

  private onPointerDown = (p: Phaser.Input.Pointer): void => {
    if (!this.isOpen || this.frozen) return;
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
        fontFamily: FONT.ui, fontSize: `${px(22)}px`, fontStyle: 'bold', color: look.ink
      })
      .setLetterSpacing(4)
      .setOrigin(0.5)
      .setShadow(0, 2, 'rgba(36,27,34,0.5)', 3);
    const w = label.width + px(58);
    const h = px(44);
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
    // `!item.chain`: a CHAIN-GRANT card (frost/storm) sells a breed, not a
    // wardrobe — once owned there is nothing to WEAR, the animal is on the
    // board (or in the bag) already.
    const skinAction = (section.kind === 'skin' || section.kind === 'dragon_skin') && owned && !worn && !item.chain;
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

    if (item.rarity) card.add(this.makeRibbon(item.rarity, -HERO_H / 2 + px(46)));
    const name = this.scene.add
      .text(0, HERO_NAME_Y, item.name, {
        fontFamily: FONT.ui, fontSize: `${px(46)}px`, fontStyle: 'bold', color: INK.onField,
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
    if (this.isLocked(item)) this.addLockOverlay(card, art, -HERO_H * 0.16, px(132));
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
        // The stage is a fraction of the CARD, not a fixed rectangle: the
        // portrait card is 2.7x taller and an art box tuned for the landscape
        // one would float a thumbnail in the middle of it.
        const stageY = IS_MOBILE ? -325 : -114;
        const stageW = IS_MOBILE ? 760 : 300;
        const stageH = IS_MOBILE ? 360 : 140;
        art = this.scene.add.image(0, stageY, item.art);
        art.setScale(Math.min(stageW / art.width, stageH / art.height));
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
    if (item.rarity) card.add(this.makeRibbon(item.rarity, -CARD_H / 2 + px(8)));

    // A BLED card's name has to stay on its scrim; a PLAIN card's has only the
    // picture above it, so it rides higher and hands the slack to the blurb.
    const nameY = bleed ? NAME_Y : PLAIN_NAME_Y;
    const name = this.scene.add
      .text(0, nameY, item.name, {
        fontFamily: FONT.ui, fontSize: `${px(32)}px`, fontStyle: 'bold',
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
    if (this.isLocked(item)) this.addLockOverlay(card, art, bleed ? px(-60) : (IS_MOBILE ? -325 : -114), px(88));
    card.add(this.makeAction(item, section, owned, worn, ACTION_Y, ACTION_SCALE, ACTION_FONT));
    return card;
  }
}
