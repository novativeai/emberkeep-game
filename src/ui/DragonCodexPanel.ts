import Phaser from 'phaser';
import { FONT, INK, RADIUS, TYPE } from '../art/design';
import {
  IS_MOBILE,
  LIVE_GAME_HEIGHT,
  LIVE_GAME_WIDTH,
  num,
  panelFitScale,
  panelMobileScale,
  panelSafeCenterY,
  TAP_SCALE,
  WELL_FED_EVOLUTION
} from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameContext } from '../core/Context';
import type { ChainsData, DragondexData, DragondexEntry } from '../core/types';
import { ensureTextures } from '../core/lazyTextures';
import type { DragonSystem } from '../systems/DragonSystem';
import { GaugeBar } from './GaugeBar';
import { uiRegistry } from './theme';

/** The three pages the Codex turns between. */
type Page = 'roster' | 'detail' | 'evolution';

/* ----------------------------------------------------------------------
 * Geometry, in the 2560-space, measured off the PAINTED frame.
 *
 * `ui_store_panel` draws its plate at 1016x620 LOGICAL, i.e. 2032x1240 game
 * units, and the frame image is seated at y+40 — so the plate's inside runs
 * x -1016..+1016 and y -588..+652. Every number below is derived from that
 * rather than guessed, which is what the old cream layout got wrong: it laid
 * a 520-wide text column down a 1230-wide page and then ran three lore
 * paragraphs off the bottom of the book.
 * -------------------------------------------------------------------- */
/**
 * Device layout. Desktop keeps the landscape book: specimen column BESIDE the
 * dossier, four roster columns, taste cards side by side. A phone gets the
 * portrait tall frame and everything STACKS — two roster columns, specimen
 * plate above the dossier, taste cards one under the other — and the type
 * steps up through `F()` because the tall frame's fit scale still leaves a
 * unit at a third of its desktop size.
 */
/**
 * THE PORTRAIT CHROME STEP — one dial, because it was four.
 *
 * The mobile sheet magnifies its CONTENTS (type 2.6x, the ✕ 2.2x, the back key
 * 2x, the EVOLUTION key 1.9x) on the reasoning that a unit is worth a third as
 * much on a phone. That reasoning is sound for TYPE and wrong for the chrome,
 * because the frame it all sits in does not grow to match: `ui_panel_tall` is
 * 2360 units wide against the landscape sheet's 2032, so the panel gains 16%
 * of relative width while the keys on it gained a hundred. The ✕ and the back
 * arrow ended up occupying twice the share of the sheet they hold on desktop,
 * and EVOLUTION ran the width of the page it was supposed to sit under.
 *
 * So the keys step by this instead, and the number is one place. It is the
 * middle of the two claims: enough magnification that a thumb still has 40-odd
 * real pixels of target, not so much that a button is furniture.
 */
const CHROME_STEP = 1.2;

const CX = IS_MOBILE
  ? {
      frameKey: 'ui_panel_tall', frameY: 0,
      edgeX: 990, headY: -1790, bodyTop: -1400, bodyFloor: 1740,
      /** closeDisc 1.05 / backScale 2.1, not 0.64 / 1.2: at those the pair
       *  rendered ~10 real px on a 390px handset — the owner called both keys
       *  too small. Ø143 disc and a 357x134 pill are matched weights (~17 real
       *  px), and the pair shares one row (CLOSE_ROW_Y = BACK_Y below). */
      bannerH: 208, closeDisc: 1.05, backScale: 2.1,
      specX: 0, specW: 1500, specH: 1000,
      // dossierTop -40, not -120: the specimen block ends with its WELL FED
      // gauge at y -170..-110 (top + specH + 130 + 100, 60 tall), and a story
      // that starts at -120 printed itself across the meter. 70 units of air.
      dossierX: -1040, dossierW: 2080, dossierTop: -40,
      cardW: 300, cardH: 380, cardScale: 2.1, gapX: 960, gapY: 880, rosterCols: 2, cardArtFit: 226,
      tasteScale: 2.05, tasteStack: true,
      stageW: 2080, stageH: 1440, evoArtW: 1880, evoArtH: 1050, gaugeW: 1400, gaugeH: 66,
      completionFont: 64
    }
  : {
      frameKey: 'ui_store_panel', frameY: 40,
      edgeX: 1000, headY: -586, bodyTop: -466, bodyFloor: 636,
      bannerH: 104, closeDisc: 0.5, backScale: 1,
      specX: -636, specW: 700, specH: 700,
      dossierX: -240, dossierW: 1180, dossierTop: -466,
      cardW: 300, cardH: 380, cardScale: 1, gapX: 336, gapY: 420, rosterCols: 4, cardArtFit: 226,
      tasteScale: 1, tasteStack: false,
      stageW: 1320, stageH: 680, evoArtW: 1160, evoArtH: 580, gaugeW: 760, gaugeH: 38,
      completionFont: TYPE.label
    };
const EDGE_X = CX.edgeX;
const HEAD_Y = CX.headY;
const BODY_TOP = CX.bodyTop;
const BODY_FLOOR = CX.bodyFloor;
const SPEC_X = CX.specX;
const SPEC_W = CX.specW;
const SPEC_PLATE_TOP = CX.bodyTop;
const SPEC_PLATE_H = CX.specH;
const DOSSIER_X = CX.dossierX;
const DOSSIER_W = CX.dossierW;
const CARD_W = CX.cardW;
const CARD_H = CX.cardH;
const CARD_GAP_X = CX.gapX;
const CARD_GAP_Y = CX.gapY;
const ROSTER_COLS = CX.rosterCols;
/**
 * THE CHROME ROW — ✕ on the right, ‹ BACK mirroring it on the left, one seat.
 *
 * They were two numbers (close HEAD_Y+74, back HEAD_Y+46) and they disagreed:
 * the BACK pill is 84 tall, so at +46 it ran y -582..-498 against a plate
 * whose inner face is -588 — six units of air, which is why it read as sitting
 * ON the frame's top rim. At this row it runs -554..-470, the same band the
 * close disc occupies (136 units painted, 0.58 scale, -551..-473).
 *
 * PORTRAIT KEEPS ITS OWN BACK SEAT. The tall frame's plaque is 208 units and
 * at least 1240 wide, so at this row the pill's right edge would come within
 * 10 units of the plaque's left edge; it drops below the banner instead.
 */
const CHROME_ROW_Y = HEAD_Y + 88;

/**
 * THE ✕ IS A FRACTION OF ITS DISC, not a step on the type ladder.
 *
 * It was `F(TYPE.title) * 0.74`, and `F` doubles on a phone: the glyph went
 * 40 -> 80 while the disc it sits in grew only by CHROME_STEP (78.9 -> 94.7).
 * A 80-unit ✕ in a 94.7 disc is the "trop grand" the owner saw — the mark had
 * outgrown the button by construction, because the two were stepped by
 * different ladders.
 *
 * One ladder now: the disc's painted 136 units carry a scale, and the glyph is
 * 0.507 of whatever that renders — the ratio the Ledger's key has always worn
 * (40 on 78.9) and which reads correctly on both devices. Nothing scales the
 * CONTAINER any more, so the two cannot drift apart again.
 *
 * The scale itself is per-panel (`CX.closeDisc`), because the CONSTRAINT is:
 * the Store's key lives over a tab row and tops out at 0.44 (Ø60, 16 units
 * above the pills); this panel and the Cauldron have no tab row, so they wear
 * 0.5 (Ø68, 48 clear) — the owner read Ø54 as too small next to the BACK
 * pill, and the pair is now sized as a pair (see `backButton`).
 */
const CLOSE_ART = 136;
const CLOSE_DISC_SCALE = CX.closeDisc;
const CLOSE_GLYPH_PX = Math.round(CLOSE_ART * CLOSE_DISC_SCALE * 0.507);
/**
 * THE ✕ SITS ON THE CORNER ARC'S OWN CENTRE.
 *
 * `ui_store_panel` rounds its plate by 42 logical, so the corner is an arc of
 * radius 84 about (932,-504) in panel space — and a disc AT that centre is 84
 * units from the ink in every corner direction. Sliding it inboard, which is
 * what "pull it away from the edge" means by instinct, walks it toward the
 * straight edges instead: the seat this replaces had 48 units, this one 49
 * from a disc that is also smaller. Landscape x is the arc centre; y stays on
 * the chrome row so the mark and the BACK pill still read as a pair.
 */
const CLOSE_SEAT_X = IS_MOBILE ? CX.edgeX - 130 : 932;
const BACK_Y = IS_MOBILE ? HEAD_Y + 230 : -508;
/** Portrait puts BOTH keys on the BACK row, under the plaque — they sat on two
 *  different rows (✕ on the banner, BACK below it) and the owner read the
 *  page as misaligned. Landscape keeps its corner-arc seat. */
const CLOSE_ROW_Y = IS_MOBILE ? BACK_Y : CHROME_ROW_Y;

const TASTE_W = 566;
const TASTE_H = 148;
const TASTE_GAP = 48;

/**
 * Font step: desktop sizes pass through; mobile steps every size up so a unit
 * that renders a third the size still lands as readable type.
 *
 * 2.0, down from 2.6. The old step was derived from the unit's on-screen worth
 * alone — a phone spans the 2560 space in ~390 real pixels, a third of a
 * desktop window's — and ignored that the SHEET does not get three times wider
 * to hold the result. At 2.6 a two-line blurb became five, the dossier's
 * columns ran into each other, and the roster cards carried names longer than
 * the cards. 2.0 still lands every size above the desktop's real pixel height;
 * what it stops doing is asking a page for room the page does not have.
 */
const F = (n: number): number => (IS_MOBILE ? Math.round(n * 2) : n);

/**
 * The Dragon Codex — the keepsake record of the dragons the Keeper has NAMED.
 *
 * Dressed in the design system's plum chrome (`src/art/design.ts`), like the
 * Emporium, the Store and the Cauldron. It used to wear the board's cream
 * `ui_panel`, which made the game's one *collection* screen read as another
 * Ledger; a codex is a thing you look INTO, and the dark hall is what lets the
 * dragon art be the light in the room.
 *
 * Three pages:
 *   • ROSTER — one specimen card per named dragon, art-forward.
 *   • DETAIL — the record: specimen plate + well-fed vitals on the left, the
 *     dossier (story, personality, ability, tastes) on the right.
 *   • EVOLUTION — the adult as a lit silhouette over its own glow, with the
 *     condition and a segmented progress gauge; full colour once earned.
 *
 * Reads only: DragonSystem owns the names and care records, dragondex.json
 * owns the words. Re-renders its live numbers off `dragon:well_fed` while
 * open, so the count can never lag a feeding.
 */
export class DragonCodexPanel extends Phaser.GameObjects.Container {
  isOpen = false;
  private readonly offBus: Array<() => void> = [];
  private baseScale = 1;
  private page: Page = 'roster';
  private pageRoster: Phaser.GameObjects.Container;
  private pageDetail: Phaser.GameObjects.Container;
  private pageEvolution: Phaser.GameObjects.Container;
  private title: Phaser.GameObjects.Text;
  private titleBg: Phaser.GameObjects.Graphics;
  private closeBtn!: Phaser.GameObjects.Container;
  /** The dragon the detail/evolution pages are showing. */
  private selected: { itemId: number; name: string; chain: string; tier: number } | null = null;
  /** Mid-cinematic (the tutorial's favourite-meal reveal): the favourite card is
   *  waiting to fade in, and `getClosePos` answers null so the tutorial arrow
   *  cannot point at the ✕ until the reveal has been SEEN. */
  private revealPending = false;
  /** The reveal is ARMED and waiting for the player to turn to the dragon's own
   *  page — the lesson opens on the roster, so the bloom belongs to the card
   *  they choose, not to a page that opened itself. */
  private revealArmed = false;
  private favouriteRow: Phaser.GameObjects.Container | null = null;
  /**
   * The tutorial is HOLDING the book open.
   *
   * The lesson walks three pages, and every beat of it is gated on the player
   * getting to the next one — so a book that could be dismissed is a book that
   * strands the script (tutorial-design law 4). While held, the close key is
   * off the page and the Back button is withheld, leaving exactly one thing to
   * do. The scrim no longer needs guarding at all — it stopped dismissing
   * anything when tap-outside-to-close was retired for the phone.
   */
  private held = false;
  /** Roster cards by chain, for the lesson's first pointer. */
  private cards = new Map<string, Phaser.GameObjects.Container>();
  /** The detail page's EVOLUTION button, for the lesson's second. */
  private evolutionBtn: Phaser.GameObjects.Container | null = null;
  /** Idle tweens owned by the live page — killed on every re-render, so a
   *  breathing sprite cannot outlive the page that started it. */
  private pageTweens: Phaser.Tweens.Tween[] = [];

  constructor(
    scene: Phaser.Scene,
    private bus: EventBus,
    private dragons: DragonSystem,
    private dex: DragondexData,
    private chains: ChainsData,
    private ctx: GameContext
  ) {
    // Centred in the SAFE region on a phone — the speech card owns the bottom
    // band, and the codex lesson talks the whole time the book is open, so a
    // full-height sheet parked EVOLUTION under the card (see
    // MOBILE_DIALOGUE_BAND). Air above the sheet = air below it, band excluded.
    super(scene, LIVE_GAME_WIDTH / 2, panelSafeCenterY());

    const dim = scene.add
      .rectangle(0, LIVE_GAME_HEIGHT / 2 - panelSafeCenterY(), LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, num(INK.scrim), 0.62)
      .setInteractive();
    // ONLY THE ✕ CLOSES — the dim swallows the tap but no longer dismisses.
    // A thumb scrolling the body releases ON the dim, and tap-outside-to-close
    // read that as "shut". See the long note in `ShopPanel.ts`. (This also
    // retires the `held` guard here: the lesson used to need protecting from a
    // stray tap-outside, and there is no longer such a thing.)
    this.add(dim);

    const frame = scene.add.image(0, CX.frameY, CX.frameKey);
    this.baseScale = IS_MOBILE ? panelFitScale(frame.width, frame.height) : panelMobileScale(frame.width);
    this.add(frame);

    // Title plaque — the same gold-seated cream banner the Store and Cauldron
    // wear, so the three dark screens read as one suite of furniture.
    this.titleBg = scene.add.graphics();
    this.add(this.titleBg);
    // A dragon's name is a proper noun, so the plaque speaks in the DISPLAY
    // serif. The plaque carries the page's title and nothing else — a kicker
    // line above it sat OUTSIDE the frame, on the board.
    this.title = scene.add
      .text(0, HEAD_Y, 'DRAGON CODEX', {
        fontFamily: FONT.display,
        fontSize: `${F(TYPE.title)}px`,
        fontStyle: 'bold',
        color: INK.onField
      })
      .setOrigin(0.5)
      .setShadow(0, 5, 'rgba(11,7,10,0.6)', 6);
    this.add(this.title);

    this.pageRoster = scene.add.container(0, 0);
    this.pageDetail = scene.add.container(0, 0);
    this.pageEvolution = scene.add.container(0, 0);
    this.add([this.pageRoster, this.pageDetail, this.pageEvolution]);

    // The ✕ — the close affordance the tutorial's pointer aims at.
    // ROYAL CANDY, seated INSIDE the plate's corner rather than riding its
    // frame: the Store, the Cauldron and the Ledger all wear this same disc at
    // this same size, and the Codex shares their frame, so it shares the seat.
    // (`CX.closeScale` still multiplies it — the portrait sheet needs a thumb.)
    // 92 in from the head corner, not 36: at the old seat the disc's ink ended
    // 6 units from the plate's inner face and read as pinned ON the corner arc.
    this.closeBtn = scene.add.container(CLOSE_SEAT_X, CLOSE_ROW_Y);
    const closeBg = scene.add.image(0, 6, 'ui_btn_round_royal').setScale(CLOSE_DISC_SCALE);
    const closeGlyph = scene.add
      .text(0, -2, '✕', {
        fontFamily: FONT.ui,
        fontSize: `${CLOSE_GLYPH_PX}px`,
        fontStyle: 'bold',
        color: INK.onFieldGold
      })
      .setOrigin(0.5);
    this.closeBtn.add([closeBg, closeGlyph]);
    // The container is NEVER scaled — it carries the TARGET, the disc carries
    // the paint. The thumb keeps its full budget whatever the mark weighs.
    this.closeBtn.setSize(96 * TAP_SCALE, 96 * TAP_SCALE);
    this.closeBtn.setInteractive({ useHandCursor: true });
    this.closeBtn.on('pointerover', () => this.closeBtn.setScale(1.06));
    this.closeBtn.on('pointerout', () => this.closeBtn.setScale(1));
    this.closeBtn.on('pointerup', () => {
      if (this.held) return;
      this.requestClose();
    });
    this.add(this.closeBtn);

    scene.add.existing(this);
    this.setVisible(false);

    // The count on screen follows the record: a feeding that completes a cycle
    // while the card is open updates the number in place.
    this.offBus.push(
      bus.on('dragon:well_fed', () => {
        if (!this.isOpen || this.page === 'roster') return;
        this.showPage(this.page);
      }),
      bus.on('game:reset', () => this.requestClose())
    );

    uiRegistry.register(scene, 'panel.dragondex', 'Dragon Codex', 'Panels', this, {
      frame,
      title: this.title
    });
  }

  open(): void {
    this.isOpen = true;
    this.revealPending = false;
    this.revealArmed = false;
    this.fetchEvolutionArt();
    this.showPage('roster');
    this.setVisible(true);
    this.setAlpha(0);
    this.setScale(this.baseScale * 0.96);
    this.scene.tweens.add({
      targets: this,
      alpha: 1,
      scale: this.baseScale,
      duration: 180,
      ease: 'Back.easeOut'
    });
    this.bus.emit('ui:codex_toggled', { open: true });
  }

  requestClose(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.revealPending = false;
    this.revealArmed = false;
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      duration: 150,
      ease: 'Sine.easeIn',
      onComplete: () => this.setVisible(false)
    });
    this.bus.emit('ui:codex_toggled', { open: false });
  }

  teardown(): void {
    this.offBus.forEach((off) => off());
    this.offBus.length = 0;
    this.killPageTweens();
  }

  // ------------------------------------------------------------------- pages

  private killPageTweens(): void {
    for (const tween of this.pageTweens) tween.stop();
    this.pageTweens = [];
  }

  private showPage(page: Page): void {
    this.killPageTweens();
    const turned = page !== this.page;
    this.page = page;
    this.pageRoster.setVisible(page === 'roster');
    this.pageDetail.setVisible(page === 'detail');
    this.pageEvolution.setVisible(page === 'evolution');
    if (page === 'roster') this.renderRoster();
    if (page === 'detail') this.renderDetail();
    if (page === 'evolution') this.renderEvolution();
    // Announced only when the book actually TURNS: the live re-render on
    // `dragon:well_fed` re-shows the page it is already on, and a gate that
    // fired on that would advance the lesson on a feeding somewhere else.
    if (turned && this.isOpen) this.bus.emit('ui:codex_page', { page });
  }

  /**
   * Hold the book open for the tutorial's lesson (or let it go again).
   *
   * Both exits go with it, rather than being left live-but-refusing: a ✕ that
   * answers nothing reads as a broken button, and the lesson's whole shape is
   * "there is one thing on this page to do".
   */
  setHeld(held: boolean): void {
    if (this.held === held) return;
    this.held = held;
    this.closeBtn.setVisible(!held);
    if (this.isOpen) this.showPage(this.page); // re-cuts the ‹ BACK pill
  }

  private entryFor(chain: string): DragondexEntry | undefined {
    return this.dex.dragons[chain];
  }

  /**
   * Pull in the evolution plates the moment the book opens.
   *
   * They are the same 1200x1400 reveal art the ceremony card uses, and holding
   * all sixteen resident cost 99 MB of a phone's GPU memory for a page most
   * sessions never turn to (`isLazyScreenArt`). The book opens on the ROSTER,
   * which needs none of them, so the fetch has the width of that page to
   * finish in — and `renderEvolution` already draws the shadow only when its
   * plate exists, so an unfinished fetch degrades to the page without the art
   * rather than to a broken one.
   *
   * Re-renders if the player got to the evolution page first: without that,
   * the plate would land into a page already drawn without it and the tutorial
   * beat that says "that shadow is what she grows into" would point at nothing.
   */
  private fetchEvolutionArt(): void {
    const keys = Object.values(this.dex.dragons)
      .map((e) => e?.evolution?.reveal)
      .filter((k): k is string => !!k && !this.scene.textures.exists(k));
    if (keys.length === 0) return;
    ensureTextures(this.scene, this.ctx, keys, () => {
      if (this.isOpen && this.page === 'evolution') this.renderEvolution();
    });
  }

  /** Set the plaque's line and re-cut the banner to it. */
  private setHeading(title: string): void {
    this.title.setText(title);
    const w = Math.max(IS_MOBILE ? 1240 : 620, this.title.width + 220);
    const h = CX.bannerH;
    const y = HEAD_Y - h / 2;
    const g = this.titleBg;
    g.clear();
    g.fillStyle(num(INK.goldDeep), 1);
    g.fillRoundedRect(-w / 2, y + 10, w, h, RADIUS.md);
    g.fillStyle(num(INK.field), 1);
    g.fillRoundedRect(-w / 2, y, w, h, RADIUS.md);
    g.lineStyle(6, num(INK.gold), 1);
    g.strokeRoundedRect(-w / 2, y, w, h, RADIUS.md);
    g.fillStyle(num(INK.fieldLift), 0.5);
    g.fillRoundedRect(-w / 2 + 14, y + 8, w - 28, h / 3, RADIUS.sm);
  }

  /* ------------------------------- roster -------------------------------- */

  /**
   * MAIN page — EVERY dragon you have named, then every breed you have not.
   *
   * A codex is a collection screen, and a collection screen with one card in a
   * two-thousand-unit panel reads as broken rather than as early. So the breeds
   * `dragondex.json` knows about fill the rest of the grid as locked
   * silhouettes: the page is full from the first dragon on, and it says what is
   * still out there — which is the whole reason to open a codex twice.
   *
   * ONE CARD PER DRAGON, NOT PER BREED, and that is the fix here. The roster
   * used to build `new Map(namedDragons().map((d) => [d.chain, d]))`, which
   * COLLAPSES two dragons of one breed into a single entry — the second red
   * dragon you name simply never appeared, and the map silently kept whichever
   * came last. A codex whose whole promise is "these are yours" cannot answer
   * "I hatched another one" with the same one card.
   *
   * So a named dragon is a slot, a breed nobody has named is a slot, and the
   * cards are keyed by the dragon's ITEM ID (breeds keep their chain id) —
   * because two entries that share a chain need two different keys or the
   * lesson's pointer lands on the wrong card.
   */
  private renderRoster(): void {
    this.pageRoster.removeAll(true);
    this.cards.clear();
    this.setHeading('Dragon Codex');
    const named = this.ownedForDisplay();
    const met = new Set(named.map((d) => d.chain));
    const breeds = Object.keys(this.dex.dragons);
    /** Yours first, in the order you named them; then what is still out there. */
    const slots: { key: string; chain: string; dragon: (typeof named)[number] | null }[] = [
      ...named.map((d) => ({ key: String(d.itemId), chain: d.chain, dragon: d })),
      ...breeds.filter((b) => !met.has(b)).map((b) => ({ key: b, chain: b, dragon: null }))
    ];

    const cols = Math.min(slots.length, ROSTER_COLS);
    const rows = Math.ceil(slots.length / cols);
    const gridH = (rows - 1) * CARD_GAP_Y + CARD_H * CX.cardScale;
    // Rows start at the block's left edge so the columns line up top to bottom
    // and a short last row leaves its gap on the right — the same rule the
    // Store's shelf follows.
    const startX = -((cols - 1) * CARD_GAP_X) / 2;
    // The grid plus its completion line, centred as ONE block in the body band.
    const blockTop = (BODY_TOP + BODY_FLOOR) / 2 - (gridH + 90) / 2;
    const startY = blockTop + (CARD_H * CX.cardScale) / 2;

    slots.forEach((slot, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const card = this.rosterCard(
        startX + col * CARD_GAP_X,
        startY + row * CARD_GAP_Y,
        slot.chain,
        slot.dragon
      );
      card.setScale(CX.cardScale);
      this.cards.set(slot.key, card);
      this.pageRoster.add(card);
    });

    // The completion line — the number that makes the locked slots a goal.
    this.pageRoster.add(
      this.scene.add
        .text(0, blockTop + gridH + 62, `${met.size} OF ${breeds.length} BREEDS MET`, {
          fontFamily: FONT.ui,
          fontSize: `${CX.completionFont}px`,
          fontStyle: 'bold',
          color: INK.onFieldGold
        })
        .setOrigin(0.5)
        .setLetterSpacing(8)
    );
  }

  /**
   * Every hatched dragon, wearing a DISPLAY name: its own if the player gave
   * one, its breed title otherwise. One list feeds the roster, the reveal
   * open, the reload re-open and the lesson pointer — a dragon that hatched
   * without meeting the naming prompt (frost, while its reveal entries were
   * missing) is still a dragon the codex owes a card.
   */
  private ownedForDisplay(): Array<{ itemId: number; name: string; chain: string; tier: number }> {
    return this.dragons
      .ownedDragons()
      .map((d) => ({ ...d, name: d.name ?? this.breedLabel(d.chain) }));
  }

  /** The breed's title — "Frost Dragon" — for a dragon nobody has named yet. */
  private breedLabel(chain: string): string {
    return this.dex.dragons[chain]?.title ?? chain;
  }

  /** The breed's young art — the form a codex card should show. */
  private youngArtKey(chain: string): string {
    const tier = this.chains.chains.find((c) => c.id === chain)?.hatchAtTier ?? 3;
    return `item_${chain}_${tier}`;
  }

  /**
   * One roster slot. `dragon` null means the breed is not yours yet: the same
   * card, drained of colour, its art a silhouette and its name withheld — a
   * locked slot that looks like the thing it will become, never a different
   * shape (the design system's rule for every disabled state).
   */
  private rosterCard(
    x: number,
    y: number,
    chain: string,
    dragon: { itemId: number; name: string; chain: string; tier: number } | null
  ): Phaser.GameObjects.Container {
    const card = this.scene.add.container(x, y);
    const half = { w: CARD_W / 2, h: CARD_H / 2 };
    const owned = dragon !== null;

    const plate = this.scene.add.graphics();
    plate.fillStyle(num(owned ? INK.goldDeep : INK.idleDeep), 1);
    plate.fillRoundedRect(-half.w, -half.h + 8, CARD_W, CARD_H, RADIUS.md);
    plate.fillStyle(num(INK.fieldDeep), 1);
    plate.fillRoundedRect(-half.w, -half.h, CARD_W, CARD_H, RADIUS.md);
    card.add(plate);

    // A pool of the hall's own light under the animal, so the card has depth
    // instead of being a sticker on a dark rectangle. A locked slot gets the
    // same pool, cooled — it is what lets a near-black silhouette read at all.
    card.add(this.glowPool(0, -30, 210, owned ? INK.gold : INK.fieldGlow, owned ? 0.16 : 0.22));

    const artKey = dragon ? `item_${dragon.chain}_${dragon.tier}` : this.youngArtKey(chain);
    const key = this.scene.textures.exists(artKey) ? artKey : 'ui_icon_dragondex';
    const art = this.scene.add.image(0, -30, key);
    art.setScale(Math.min(226 / art.width, 226 / art.height));
    if (!owned) art.setTintFill(num(INK.idleDeep)).setAlpha(0.95);
    card.add(art);

    // Name plate along the card's foot — a cream strip that carries dark type,
    // the system's rule for anything that must be read at a glance.
    //
    // SEATED ON A FOOT, not hung from a number. `half.h - 74` left 12 units
    // between the strip and the card's own 5-unit rim — three per cent of the
    // card, which is not a margin but the remainder of an arithmetic nobody
    // checked. The strip is inset 22 on each side; it now gets the same order
    // of air underneath, so the name sits INSIDE the card rather than on its
    // moulding.
    const NAME_STRIP_H = 62;
    const NAME_FOOT = 24;
    const nameY = half.h - NAME_FOOT - NAME_STRIP_H;
    const strip = this.scene.add.graphics();
    strip.fillStyle(num(owned ? INK.cream : INK.field), 1);
    strip.fillRoundedRect(-half.w + 22, nameY, CARD_W - 44, NAME_STRIP_H, RADIUS.sm);
    if (!owned) {
      strip.lineStyle(3, num(INK.idleDeep), 1);
      strip.strokeRoundedRect(-half.w + 22, nameY, CARD_W - 44, NAME_STRIP_H, RADIUS.sm);
    }
    card.add(strip);
    const name = this.scene.add
      .text(0, nameY + NAME_STRIP_H / 2, dragon ? dragon.name : '? ? ?', {
        fontFamily: FONT.display,
        fontSize: `${TYPE.label}px`,
        fontStyle: 'bold',
        color: owned ? INK.onPlate : INK.idle
      })
      .setOrigin(0.5);
    // A long name shrinks rather than spilling past its own strip.
    const maxW = CARD_W - 76;
    if (name.width > maxW) name.setScale(maxW / name.width);
    card.add(name);

    const rim = this.scene.add.graphics();
    rim.lineStyle(5, num(owned ? INK.gold : INK.idleDeep), 1);
    rim.strokeRoundedRect(-half.w, -half.h, CARD_W, CARD_H, RADIUS.md);
    card.add(rim);

    if (!dragon) return card; // a locked slot has nothing to open
    card.setSize(CARD_W, CARD_H);
    card.setInteractive({ useHandCursor: true });
    card.on('pointerover', () => card.setScale(CX.cardScale * 1.05));
    card.on('pointerout', () => card.setScale(CX.cardScale));
    card.on('pointerup', () => {
      this.selected = dragon;
      this.showPage('detail');
    });
    return card;
  }

  /* ------------------------------- detail -------------------------------- */

  /** The record: specimen + vitals left, dossier right, Evolution beneath. */
  private renderDetail(): void {
    this.pageDetail.removeAll(true);
    const dragon = this.selected;
    if (!dragon) {
      this.showPage('roster');
      return;
    }
    const entry = this.entryFor(dragon.chain);
    this.setHeading(dragon.name);
    if (!this.held) this.pageDetail.add(this.backButton(() => this.showPage('roster')));

    this.buildSpecimen(dragon, entry);
    this.buildDossier(dragon, entry);

    // The armed reveal belongs to the page the player TURNED TO — a breath
    // after it settles, so the bloom lands on a page they are already reading.
    if (this.revealArmed) {
      this.revealArmed = false;
      this.scene.time.delayedCall(600, () => this.playFavouriteReveal());
    }

    // The CTA closes the LEFT column's own story — art, species, progress,
    // then the thing that progress buys. Parked centre-bottom it both left the
    // left column trailing off into dead space and sat exactly where Eleanor's
    // dialogue bubble comes in.
    this.evolutionBtn = null;
    if (entry?.evolution) {
      // Mobile: centred under the taste stack (the specimen no longer owns a
      // column to close); the button itself doubles for a thumb.
      // PORTRAIT SEAT, MEASURED AGAINST THE FRAME'S OWN RHYTHM (ui-spacing-check).
      // The spacing law pairs the key's bottom gap with the TITLE PLAQUE's top
      // gap: the plaque's box tops out at -1894 against ink at -2008 — 114
      // units of air. `ui_panel_tall` paints its plate to y 1992, and at the
      // old BODY_FLOOR + 135 the key's bottom sat 64 off it — the owner read
      // the page as bottom-heavy (measured 160 vs 66 in game units). At +83
      // the 110.4-unit key's bottom lands at 1878: 114 off the ink, the
      // plaque's own number. The WON'T TOUCH card above (plate ends 1720)
      // keeps 48 units — twice the 24.8 the owner once called touching.
      this.evolutionBtn = this.emberButton(
        IS_MOBILE ? 0 : SPEC_X,
        IS_MOBILE ? BODY_FLOOR + 83 : BODY_FLOOR - 96,
        'EVOLUTION  ›',
        () => this.showPage('evolution')
      );
      if (IS_MOBILE) this.evolutionBtn.setScale(CHROME_STEP);
      this.pageDetail.add(this.evolutionBtn);
    }
  }

  /** Left column: the animal on a lit plate, its species, and its vitals. */
  private buildSpecimen(
    dragon: { itemId: number; name: string; chain: string; tier: number },
    entry: DragondexEntry | undefined
  ): void {
    const top = SPEC_PLATE_TOP;
    const h = SPEC_PLATE_H;
    const midY = top + h / 2;

    const plate = this.scene.add.graphics();
    plate.fillStyle(num(INK.fieldDeep), 1);
    plate.fillRoundedRect(SPEC_X - SPEC_W / 2, top, SPEC_W, h, RADIUS.lg);
    this.pageDetail.add(plate);
    this.pageDetail.add(this.glowPool(SPEC_X, midY, IS_MOBILE ? 520 : 300, INK.gold, 0.17));

    const artKey = `item_${dragon.chain}_${dragon.tier}`;
    if (this.scene.textures.exists(artKey)) {
      const sprite = this.scene.add.image(SPEC_X, midY, artKey);
      const fit = Math.min((SPEC_W - 130) / sprite.width, (h - 130) / sprite.height);
      sprite.setScale(fit);
      this.pageDetail.add(sprite);
      // The rest pose breathes — a keepsake, not a museum pin.
      this.pageTweens.push(
        this.scene.tweens.add({
          targets: sprite,
          scale: fit * 1.025,
          duration: 1800,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        })
      );
    }

    const rim = this.scene.add.graphics();
    rim.lineStyle(5, num(INK.goldMid), 1);
    rim.strokeRoundedRect(SPEC_X - SPEC_W / 2, top, SPEC_W, h, RADIUS.lg);
    this.pageDetail.add(rim);

    // Species chip, straddling the plate's foot like a museum label.
    if (entry?.title) {
      const label = this.scene.add
        .text(SPEC_X, top + h, entry.title.toUpperCase(), {
          fontFamily: FONT.ui,
          fontSize: `${F(TYPE.micro)}px`,
          fontStyle: 'bold',
          color: INK.onFieldGold
        })
        .setOrigin(0.5)
        .setLetterSpacing(6);
      const chipW = label.width + 76;
      const chip = this.scene.add.graphics();
      chip.fillStyle(num(INK.field), 1);
      chip.fillRoundedRect(SPEC_X - chipW / 2, top + h - 26, chipW, 52, 26);
      chip.lineStyle(4, num(INK.goldMid), 1);
      chip.strokeRoundedRect(SPEC_X - chipW / 2, top + h - 26, chipW, 52, 26);
      this.pageDetail.add([chip, label]);
    }

    // ---- vitals: the cycle record, as a gauge rather than a sentence ----
    const needed = WELL_FED_EVOLUTION[dragon.chain] ?? entry?.evolution?.wellFedCycles ?? 6;
    const cycles = this.dragons.wellFedCyclesOf(dragon.itemId);
    const vitalsY = top + h + (IS_MOBILE ? 130 : 104);
    this.pageDetail.add(
      this.scene.add
        .text(SPEC_X - SPEC_W / 2 + 10, vitalsY, 'WELL FED', {
          fontFamily: FONT.ui,
          fontSize: `${F(TYPE.micro)}px`,
          fontStyle: 'bold',
          color: INK.onFieldDim
        })
        .setLetterSpacing(6)
    );
    this.pageDetail.add(
      this.scene.add
        .text(SPEC_X + SPEC_W / 2 - 10, vitalsY, `${Math.min(cycles, needed)} / ${needed}`, {
          fontFamily: FONT.ui,
          fontSize: `${F(TYPE.label)}px`,
          fontStyle: 'bold',
          color: cycles >= needed ? INK.gain : INK.onFieldGold
        })
        .setOrigin(1, 0)
    );
    // The same segmented gauge the dragon's hunger uses — one meter language
    // for "how far along is this animal", wherever it is read.
    const gauge = new GaugeBar(this.scene, SPEC_X - SPEC_W / 2, vitalsY + (IS_MOBILE ? 100 : 70), SPEC_W, IS_MOBILE ? 60 : 34);
    gauge.set(Math.min(cycles / needed, 1), needed, cycles >= needed);
    this.pageDetail.add(gauge);
  }

  /** Right column: the words. Flowed top-down off MEASURED heights, then
   *  scaled as one block if a future lore entry ever outgrows the page. */
  private buildDossier(
    dragon: { itemId: number; name: string; chain: string; tier: number },
    entry: DragondexEntry | undefined
  ): void {
    // The taste cards are anchored to the FOOT of the column and the prose
    // flows from the top, so the spare room lands between them instead of
    // pooling under a top-heavy block.
    // Mobile: the dossier is BELOW the specimen block, and the taste cards are
    // scaled containers stacked one under the other above the page floor.
    const tasteHh = TASTE_H * CX.tasteScale;
    const tasteY = CX.tasteStack ? BODY_FLOOR - tasteHh * 2 - 60 : BODY_FLOOR - TASTE_H - 26;
    const group = this.scene.add.container(DOSSIER_X, CX.dossierTop);
    this.pageDetail.add(group);
    let y = 0;

    // The story is a QUOTE — indented behind a gold rule, the one piece of the
    // record that is voice rather than data.
    if (entry?.story) {
      const body = this.scene.add.text(28, 0, entry.story, {
        fontFamily: FONT.ui,
        fontSize: `${F(TYPE.body)}px`,
        fontStyle: 'italic',
        color: INK.onField,
        wordWrap: { width: DOSSIER_W - 28 },
        lineSpacing: 10
      });
      const rule = this.scene.add.graphics();
      rule.fillStyle(num(INK.gold), 0.9);
      rule.fillRoundedRect(0, 2, 6, body.height - 4, 3);
      group.add([rule, body]);
      y = body.height + 56;
    }

    const section = (label: string, text: string): void => {
      if (!text) return;
      const head = this.scene.add
        .text(0, y, label, {
          fontFamily: FONT.ui,
          fontSize: `${F(TYPE.micro)}px`,
          fontStyle: 'bold',
          color: INK.onFieldGold
        })
        .setLetterSpacing(6);
      group.add(head);
      y += 46;
      const body = this.scene.add.text(0, y, text, {
        fontFamily: FONT.ui,
        fontSize: `${F(TYPE.body)}px`,
        color: INK.onField,
        wordWrap: { width: DOSSIER_W },
        lineSpacing: 10
      });
      group.add(body);
      y += body.height + 52;
    };
    section('PERSONALITY', entry?.personality ?? '');
    section('SPECIAL ABILITY', entry?.ability ?? '');

    // The guard that makes the page overflow-proof for any future entry: the
    // prose is measured against the gap above the taste cards, and if it ever
    // outgrows it the block scales as ONE unit from its top-left, so the
    // columns stay aligned rather than the paragraphs colliding.
    const available = tasteY - 96 - CX.dossierTop;
    if (y > available) group.setScale(available / y);

    // ---- taste cards: written by EXPERIMENT, '???' until tested ----------
    this.pageDetail.add(
      this.scene.add
        .text(DOSSIER_X, tasteY - (IS_MOBILE ? 90 : 48), 'AT THE TABLE', {
          fontFamily: FONT.ui,
          fontSize: `${F(TYPE.micro)}px`,
          fontStyle: 'bold',
          color: INK.onFieldGold
        })
        .setLetterSpacing(6)
    );
    const taste = this.dragons.tasteKnowledge(dragon.itemId);
    if (CX.tasteStack) {
      // Stacked and magnified: each card is built at its authored size around
      // its own centre, then scaled — the reveal cinematic's centre-pop and the
      // glow inside the container ride the scale untouched.
      const mk = (label: string, t: { chain: string; known: boolean }, accent: string, cy: number) => {
        const card = this.tasteCard(-TASTE_W / 2, -TASTE_H / 2, label, t, accent);
        card.setScale(CX.tasteScale).setPosition(0, cy);
        return card;
      };
      this.favouriteRow = mk('FAVOURITE MEAL', taste.favourite, INK.gain, tasteY + tasteHh / 2);
      this.pageDetail.add(this.favouriteRow);
      if (this.revealPending) this.favouriteRow.setAlpha(0);
      this.pageDetail.add(mk('WON’T TOUCH', taste.dislike, INK.spend, tasteY + tasteHh * 1.5 + 40));
    } else {
      this.favouriteRow = this.tasteCard(DOSSIER_X, tasteY, 'FAVOURITE MEAL', taste.favourite, INK.gain);
      this.pageDetail.add(this.favouriteRow);
      if (this.revealPending) this.favouriteRow.setAlpha(0); // the cinematic owns its entrance
      this.pageDetail.add(
        this.tasteCard(DOSSIER_X + TASTE_W + TASTE_GAP, tasteY, 'WON’T TOUCH', taste.dislike, INK.spend)
      );
    }
  }

  /**
   * One taste card: the food's icon in a rimmed well, its name beside it —
   * or '???' until the player has actually TESTED it (fed the favourite /
   * been refused). The chain's tier-1 piece names the food family.
   */
  private tasteCard(
    x: number,
    y: number,
    label: string,
    taste: { chain: string; known: boolean },
    accent: string
  ): Phaser.GameObjects.Container {
    // Seated on its own CENTRE, with every child drawn around 0,0 — so the
    // reveal cinematic's scale-pop grows from the middle of the card instead
    // of shoving its bottom-right corner into the card beside it.
    const card = this.scene.add.container(x + TASTE_W / 2, y + TASTE_H / 2);
    const half = { w: TASTE_W / 2, h: TASTE_H / 2 };
    card.setData('rowAt', { w: TASTE_W, h: TASTE_H });

    const plate = this.scene.add.graphics();
    plate.fillStyle(num(INK.fieldDeep), 1);
    plate.fillRoundedRect(-half.w, -half.h, TASTE_W, TASTE_H, RADIUS.md);
    plate.lineStyle(4, num(taste.known ? accent : INK.idleDeep), taste.known ? 0.9 : 1);
    plate.strokeRoundedRect(-half.w, -half.h, TASTE_W, TASTE_H, RADIUS.md);
    card.add(plate);

    card.add(
      this.scene.add
        .text(-half.w + 122, -half.h + 30, label, {
          fontFamily: FONT.ui,
          fontSize: `${TYPE.micro}px`,
          fontStyle: 'bold',
          color: taste.known ? accent : INK.idle
        })
        .setLetterSpacing(5)
    );

    // The icon well — a rimmed disc on the left, holding the food or a '?'.
    const wellX = -half.w + 66;
    const wellY = 0;
    const well = this.scene.add.graphics();
    well.fillStyle(num(INK.field), 1);
    well.fillCircle(wellX, wellY, 46);
    well.lineStyle(4, num(taste.known ? accent : INK.idleDeep), 1);
    well.strokeCircle(wellX, wellY, 46);
    card.add(well);

    const iconKey = `item_${taste.chain}_1`;
    if (taste.known && this.scene.textures.exists(iconKey)) {
      const icon = this.scene.add.image(wellX, wellY, iconKey);
      icon.setScale(66 / Math.max(icon.width, icon.height));
      card.add(icon);
    } else {
      card.add(
        this.scene.add
          .text(wellX, wellY - 2, '?', {
            fontFamily: FONT.display,
            fontSize: `${TYPE.heading}px`,
            fontStyle: 'bold',
            color: INK.idle
          })
          .setOrigin(0.5)
      );
    }

    const foodName = taste.known
      ? this.chains.chains.find((c) => c.id === taste.chain)?.tiers.find((t) => t.tier === 1)?.name ??
        taste.chain
      : 'Not yet known';
    const nameText = this.scene.add.text(-half.w + 122, -half.h + 74, foodName, {
      fontFamily: FONT.ui,
      fontSize: `${TYPE.label}px`,
      fontStyle: taste.known ? 'bold' : 'italic',
      color: taste.known ? INK.onField : INK.idle
    });
    const maxW = TASTE_W - 146;
    if (nameText.width > maxW) nameText.setScale(maxW / nameText.width);
    card.add(nameText);
    return card;
  }

  /* ----------------------------- evolution ------------------------------- */

  /** The promise page: the adult as a silhouette over its own glow, the
   *  condition under it — full colour the moment the condition is met. */
  private renderEvolution(): void {
    this.pageEvolution.removeAll(true);
    const dragon = this.selected;
    const entry = dragon && this.entryFor(dragon.chain);
    if (!dragon || !entry?.evolution) {
      this.showPage('detail');
      return;
    }
    this.setHeading('Evolution');
    if (!this.held) this.pageEvolution.add(this.backButton(() => this.showPage('detail')));

    const needed = WELL_FED_EVOLUTION[dragon.chain] ?? entry.evolution.wellFedCycles;
    const cycles = this.dragons.wellFedCyclesOf(dragon.itemId);
    const met = cycles >= needed;

    const stageY = BODY_TOP + CX.stageH / 2;
    const stage = this.scene.add.graphics();
    stage.fillStyle(num(INK.fieldDeep), 1);
    stage.fillRoundedRect(-CX.stageW / 2, BODY_TOP, CX.stageW, CX.stageH, RADIUS.lg);
    stage.lineStyle(5, num(met ? INK.gold : INK.goldDeep), 1);
    stage.strokeRoundedRect(-CX.stageW / 2, BODY_TOP, CX.stageW, CX.stageH, RADIUS.lg);
    this.pageEvolution.add(stage);
    // A locked silhouette is painted near-black — on the plum hall that would
    // be a hole in the page, so the glow goes BEHIND it and the shape reads as
    // a shadow cast on light. Earned, the same pool becomes the ember halo.
    this.pageEvolution.add(
      this.glowPool(0, stageY, IS_MOBILE ? 640 : 360, met ? INK.ember : INK.gold, met ? 0.3 : 0.2)
    );

    if (this.scene.textures.exists(entry.evolution.reveal)) {
      const art = this.scene.add.image(0, stageY, entry.evolution.reveal);
      art.setScale(Math.min(CX.evoArtW / art.width, CX.evoArtH / art.height));
      if (met) {
        art.setAlpha(0);
        this.pageTweens.push(
          this.scene.tweens.add({ targets: art, alpha: 1, duration: 600, ease: 'Sine.easeOut' })
        );
      } else {
        art.setTintFill(num(INK.fieldDeep));
        art.setAlpha(0.96);
      }
      this.pageEvolution.add(art);
    }

    const nameY = BODY_TOP + CX.stageH + (IS_MOBILE ? 150 : 82);
    this.pageEvolution.add(
      this.scene.add
        .text(0, nameY, met ? entry.evolution.into : '? ? ? ? ?', {
          fontFamily: FONT.display,
          fontSize: `${F(TYPE.heading)}px`,
          fontStyle: 'bold',
          color: met ? INK.onFieldGold : INK.idle
        })
        .setOrigin(0.5)
        .setLetterSpacing(met ? 0 : 10)
    );
    this.pageEvolution.add(
      this.scene.add
        .text(0, nameY + (IS_MOBILE ? 110 : 58), entry.evolution.condition, {
          fontFamily: FONT.ui,
          fontSize: `${F(TYPE.tiny)}px`,
          fontStyle: 'italic',
          color: INK.onFieldDim
        })
        .setOrigin(0.5)
    );

    // The same gauge as the detail page's vitals — the player sees the very
    // meter they are filling, on the page that explains what filling it buys.
    const gaugeW = CX.gaugeW;
    const gauge = new GaugeBar(this.scene, -gaugeW / 2, nameY + (IS_MOBILE ? 240 : 138), gaugeW, CX.gaugeH);
    gauge.set(Math.min(cycles / needed, 1), needed, met);
    this.pageEvolution.add(gauge);
    this.pageEvolution.add(
      this.scene.add
        .text(0, nameY + (IS_MOBILE ? 360 : 198), met ? 'READY' : `${Math.min(cycles, needed)} / ${needed} cycles`, {
          fontFamily: FONT.ui,
          fontSize: `${F(TYPE.label)}px`,
          fontStyle: 'bold',
          color: met ? INK.gain : INK.onField
        })
        .setOrigin(0.5)
        .setLetterSpacing(met ? 8 : 0)
    );
  }

  /* ----------------------------- primitives ------------------------------ */

  /**
   * A soft pool of light. Phaser's Graphics has no radial gradient, so this is
   * a stack of thinning circles — cheap, and it never needs a texture that the
   * loader could fail to fetch.
   */
  private glowPool(x: number, y: number, radius: number, color: string, peak: number): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics();
    const rings = 7;
    for (let i = rings; i >= 1; i--) {
      g.fillStyle(num(color), peak / rings);
      g.fillCircle(x, y, (radius * i) / rings);
    }
    return g;
  }

  /** The screen's single warm call to action — the design system allows one
   *  ember element per surface, and on this page it is Evolution. */
  private emberButton(x: number, y: number, text: string, onTap: () => void): Phaser.GameObjects.Container {
    const btn = this.scene.add.container(x, y);
    const label = this.scene.add
      .text(0, 0, text, {
        fontFamily: FONT.ui,
        fontSize: `${F(TYPE.sub)}px`,
        fontStyle: 'bold',
        color: INK.onPlate
      })
      .setOrigin(0.5)
      .setLetterSpacing(4);
    const w = Math.max(420, label.width + 120);
    const h = 92;
    const g = this.scene.add.graphics();
    // Capsule radius spelled out, NOT RADIUS.pill: Phaser's Graphics does not
    // clamp an oversized corner radius (the Canvas2D painters in design.ts do),
    // and 999 on a 92-tall rect threw stray geometry across the whole screen.
    const r = h / 2;
    g.fillStyle(num(INK.emberDeep), 1);
    g.fillRoundedRect(-w / 2, -h / 2 + 8, w, h, r);
    g.fillStyle(num(INK.ember), 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    g.fillStyle(num(INK.emberLift), 0.55);
    g.fillRoundedRect(-w / 2 + 16, -h / 2 + 8, w - 32, 26, RADIUS.sm);
    g.lineStyle(5, num(INK.goldHi), 0.9);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
    btn.add([g, label]);
    // The TARGET keeps the old pill's footprint — the paint shrank, the thumb
    // budget must not (same split as every close key on this frame).
    btn.setSize(Math.max(w, 200), Math.max(h, 84));
    btn.setInteractive({ useHandCursor: true });
    const rest = IS_MOBILE ? CHROME_STEP : 1;
    btn.on('pointerover', () => btn.setScale(rest * 1.05));
    btn.on('pointerout', () => btn.setScale(rest));
    btn.on('pointerup', onTap);
    return btn;
  }

  /**
   * The ‹ Back pill every inner page carries, mirroring the ✕ — and now
   * genuinely mirroring it, which is what three rounds of nudging missed.
   *
   * The band this pill lives in is only 114 units tall: the plate's ink ends
   * at -580 and the specimen plate begins at -466. A 200x84 pill in a 114
   * band keeps at most 30 units of total slack WHEREVER it sits — it reads as
   * wedged against the frame because it very nearly is, and no seat can fix a
   * pill that fills 74% of its band. Meanwhile the ✕ across from it had gone
   * down to Ø54, so the pair read as one oversized key and one undersized one
   * — which is exactly how the owner described it.
   *
   * So the pair is sized as a pair: the pill drops to 170x64 (56% of the
   * band, the same share the Ø68 disc takes of its corner) and the ✕ comes
   * back up to 0.5. At (-836, -508) the pill keeps 38 units over it, 10
   * under, and 87 to the left ink — detached from the border on every side.
   * The label is a fixed 36 (0.56 of the pill, the ✕'s own ratio); it was
   * `F(TYPE.label)`, which doubles on a phone and filled 80% of the old pill.
   */
  private backButton(onTap: () => void): Phaser.GameObjects.Container {
    const btn = this.scene.add
      .container(IS_MOBILE ? -EDGE_X + 240 : -836, BACK_Y)
      .setScale(CX.backScale);
    const w = 170;
    const h = 64;
    const r = h / 2; // spelled out — see emberButton on why not RADIUS.pill
    const g = this.scene.add.graphics();
    g.fillStyle(num(INK.goldDeep), 1);
    g.fillRoundedRect(-w / 2, -h / 2 + 6, w, h, r);
    g.fillStyle(num(INK.field), 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    g.lineStyle(4, num(INK.goldMid), 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
    const label = this.scene.add
      .text(0, 0, '‹  BACK', {
        fontFamily: FONT.ui,
        fontSize: '36px',
        fontStyle: 'bold',
        color: INK.onFieldGold
      })
      .setOrigin(0.5)
      .setLetterSpacing(3);
    btn.add([g, label]);
    // The TARGET keeps the old pill's footprint — the paint shrank, the thumb
    // budget must not (same split as every close key on this frame).
    btn.setSize(Math.max(w, 200), Math.max(h, 84));
    btn.setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => btn.setScale(CX.backScale * 1.06));
    btn.on('pointerout', () => btn.setScale(CX.backScale));
    btn.on('pointerup', onTap);
    return btn;
  }

  /* ------------------------------ cinematic ------------------------------ */

  /**
   * The tutorial's cinematic: the book opens on the ROSTER with this dragon
   * already selected and her favourite card held back, so the lesson's first
   * gesture is the one worth teaching — the player opening her page. The card
   * blooms in THERE (`renderDetail` arms it), and only once it has settled does
   * `getClosePos` start answering, so the arrow points at the ✕ after the
   * reveal, never through it.
   *
   * It used to open straight onto the page, which meant the one screen in the
   * game that collects anything was never seen by the player who was being
   * taught it.
   */
  openReveal(itemId: number): void {
    const dragon =
      this.ownedForDisplay().find((d) => d.itemId === itemId) ?? this.ownedForDisplay()[0];
    if (!dragon) return;
    this.selected = dragon;
    this.revealPending = true;
    this.revealArmed = true;
    this.isOpen = true;
    this.showPage('roster');
    this.setVisible(true);
    this.setAlpha(0);
    this.setScale(this.baseScale * 0.96);
    this.scene.tweens.add({
      targets: this,
      alpha: 1,
      scale: this.baseScale,
      duration: 220,
      ease: 'Back.easeOut'
    });
    this.bus.emit('ui:codex_toggled', { open: true });
    this.bus.emit('ui:codex_page', { page: 'roster' });
  }

  /**
   * Open on a named dragon at a given page, with no cinematic — how a save
   * reloaded mid-lesson comes back to the spread its bubble is talking about.
   */
  openAt(itemId: number, page: Page): void {
    const dragon =
      this.ownedForDisplay().find((d) => d.itemId === itemId) ?? this.ownedForDisplay()[0];
    if (!dragon) return;
    this.selected = dragon;
    this.open();
    if (page !== 'roster') this.showPage(page);
  }

  /** The favourite card writing itself in, on the dragon's own page. */
  private playFavouriteReveal(): void {
    {
      const row = this.favouriteRow;
      if (!row?.active || !this.isOpen) {
        this.revealPending = false;
        return;
      }
      // The bloom behind the card — the book writing, made visible.
      const at = row.getData('rowAt') as { w: number; h: number };
      const glow = this.scene.add.graphics();
      glow.fillStyle(num(INK.goldHi), 0.4);
      glow.fillRoundedRect(-at.w / 2 - 14, -at.h / 2 - 14, at.w + 28, at.h + 28, RADIUS.lg);
      glow.setAlpha(0);
      row.addAt(glow, 0);
      this.scene.tweens.add({
        targets: glow,
        alpha: { from: 0, to: 1 },
        duration: 420,
        yoyo: true,
        hold: 500,
        ease: 'Sine.easeInOut',
        onComplete: () => glow.destroy()
      });
      row.setScale(1.1);
      this.scene.tweens.add({
        targets: row,
        alpha: 1,
        scale: 1,
        duration: 700,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.revealPending = false; // NOW the arrow may point at the ✕
        }
      });
    }
  }

  /** The ✕, for the tutorial's pointer — null while closed, while the book is
   *  HELD open (the button is off the page), or while the reveal is playing. */
  getClosePos(): { x: number; y: number } | null {
    if (!this.isOpen || this.held || this.revealPending || !this.visible) return null;
    return this.pointAt(this.closeBtn);
  }

  /**
   * The card the lesson's first pointer wants — the dragon's own.
   *
   * Null off the roster page, so the arrow follows the book rather than
   * hovering over the page that replaced it.
   *
   * AND IT NO LONGER NEEDS A SELECTION. `codex_meal` says "open your dragon's
   * page" and points here, but `selected` is only written when a card is
   * TAPPED — so at the exact moment the lesson was asking for that tap there
   * was nothing selected, this returned null, and the beat ran with no arrow on
   * a page full of cards. The pointer falls back to the first dragon on the
   * roster, which on the only board that ever sees this lesson is the dragon
   * the player just named.
   */
  getCardPos(): { x: number; y: number } | null {
    if (!this.isOpen || !this.visible || this.page !== 'roster') return null;
    // By item id, not chain: two dragons of one breed are two cards now, and
    // the pointer has to land on the one that is selected.
    const owned = this.ownedForDisplay();
    const wanted = this.selected ?? owned[0];
    const card = wanted ? this.cards.get(String(wanted.itemId)) : undefined;
    return card ? this.pointAt(card) : null;
  }

  /** The EVOLUTION button on the dragon's page — the lesson's second. */
  getEvolutionPos(): { x: number; y: number } | null {
    if (!this.isOpen || !this.visible || this.page !== 'detail') return null;
    return this.evolutionBtn?.active ? this.pointAt(this.evolutionBtn) : null;
  }

  /** Screen point of a child, through whatever scale the panel is wearing. */
  private pointAt(child: Phaser.GameObjects.Container): { x: number; y: number } {
    const m = child.getWorldTransformMatrix();
    return { x: m.tx, y: m.ty };
  }
}
