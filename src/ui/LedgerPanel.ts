import Phaser from 'phaser';
import { FONT, INK } from '../art/design';
import {
  IS_MOBILE,
  LIVE_GAME_HEIGHT,
  LIVE_GAME_WIDTH,
  num,
  panelMobileScale,
  px,
  TAP_SCALE
} from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import { speakerName } from '../entities/CharacterBubble';
import { discTextureFor } from '../entities/PortraitAnimator';
import type { GameState } from '../core/GameState';
import type { OrderConfig } from '../core/types';
import type { OrderSystem } from '../systems/OrderSystem';
import type { TaskSystem } from '../systems/TaskSystem';
import { uiRegistry } from './theme';

// ---------------------------------------------------------------------------
// THE PAINTED BOXES EVERY SEAT IN THIS FILE IS MEASURED FROM
//
// Art is painted in LOGICAL units and the canvas is RES=2, so a `paint(k, w, h)`
// call in TextureFactory yields a 2w x 2h GAME-unit texture. The two frames this
// page is built out of:
//
//   `ui_quest_panel` — paint(660, 510) => 1320x1020 game units, with its chrome
//   plate drawn at logical (14,10)+632x480, i.e. game (28,20)+1264x960. Around
//   the image's own centre that plate is x -632..632, y -490..470, and the image
//   is seated at panel y 86 (it grew DOWNWARD — see the constructor), so in
//   PANEL space the frame's inner face is x -632..632, y -404..556.
//
//   `ui_card` — paint(320, 350) => 640x700 game units, plate at logical
//   (6,6)+308x338, i.e. game (12,12)+616x676: x ±308, y ±338 around the image's
//   centre. The card is drawn at 0.9, so its plate is x ±277.2, y ±304.2.
//
// Anything that GROWS WITH CONTENT — a title, a reward line, a count, a blurb,
// a task label — is budgeted against one of those boxes below and fitted at
// paint time. Text with no budget is the whole reason this panel spilled: the
// order blurb was stepped to `px(30)` for portrait readability while its wrap
// and its seat still assumed the desktop 30, and seven lines of Eleanor at 78px
// ran clean out of the frame's floor and up over both Deliver buttons.
// ---------------------------------------------------------------------------

/** The quest frame's inner plate, in PANEL space (see the header). */
const PANEL_PLATE_BOTTOM = 556;

// Card centres: half the card art (640×0.9 → ±288) + this must stay inside the
// ui_panel's inner face (~±612) — at 330/0.96 the cards overflowed the frame.
const CARD_X = 300;
/** Both cards hang 16 below the frame's middle. */
const CARD_Y = 16;
const CARD_ART_SCALE = 0.9;
/** Half the card's PLATE (not its texture): 308 x 0.9 and 338 x 0.9. Everything
 *  on a card is budgeted against these, so re-scaling the card is one number. */
const CARD_PLATE_HALF_W = 308 * CARD_ART_SCALE;
const CARD_PLATE_HALF_H = 338 * CARD_ART_SCALE;
/** `ui_slot` is paint(72,72) => 144 game units, seated at card-local y 36. */
const SLOT_Y = 36;
const SLOT_ART = 144;
/** The requirement icon contain-fits this box — the `ui_slot` backdrop is 144
 *  units, so the art sits inside it with a small air gap all round. */
const SLOT_ICON_FIT = 128;
const TAB_W = 520;
const TAB_H = 104;
const TAB_Y = -384;

/** The Keeper's Tasks checklist, in panel space. Shared by the page that BUILDS
 *  the rows and the one that repaints them — two copies of the same two numbers
 *  is how a row and its progress bar end up in different places. They spread
 *  into the frame's new height rather than leaving it empty above the footer. */
const TASK_ROW_TOP = -240;
const TASK_ROW_GAP = 140;
/** A row's label starts here, and its progress bar there. */
const TASK_LABEL_X = -548;
const TASK_BAR_X = 160;
const TASK_BAR_W = 320;
/** Air between the longest a label may run and the bar's left edge. The wrap is
 *  DERIVED from it (160 - 68 - -548 = 640, what it has always been) so a label
 *  can never be widened into the bar by editing one of the two numbers and not
 *  the other. */
const TASK_LABEL_GAP = 68;
const TASK_LABEL_WRAP = TASK_BAR_X - TASK_LABEL_GAP - TASK_LABEL_X;
const TASK_LABEL_PX = 31;
const TASK_LABEL_MIN_PX = 22;
/** A row owns its 140 of pitch less 24 of air, so a wrapped label can grow to
 *  three lines (3 x ~37 = 111) and still never touch the row under it. */
const TASK_ROW_AIR = 24;
const TASK_ROW_BUDGET = TASK_ROW_GAP - TASK_ROW_AIR;
const TASK_HINT_X = 340;
const TASK_HINT_WRAP = 430;
const TASK_HINT_PX = 24;
const TASK_HINT_MIN_PX = 18;

// ---- The active order's flavour line, along the frame's floor ----
const BLURB_Y = 440;
/**
 * Stepped into the portrait space, because at a flat 30 this line is 8.3 real
 * pixels on a handset — which is the whole reason the order's own words were
 * unreadable there.
 *
 * (That figure used to read 4.6, which forgot the panel's own magnification.
 * A unit of this space is 390/2560 = 0.152 real px on a 390px-wide handset AND
 * the whole panel is drawn at `panelMobileScale(1320)` = 1.823, so a unit of
 * PANEL space is 0.278 real px — the same conversion the CLOSE_HIT note below
 * already uses. 30 x 0.278 = 8.3. The conclusion is unchanged either way, and
 * the number is used again for the floor, where being 1.8x out would matter.)
 *
 * It is a PREFERRED size — `fitBlock` takes it down toward the floor below
 * when the paragraph will not fit its band.
 */
const BLURB_PX = px(30);
/** 1100 of the plate's 1264 on desktop, exactly as authored — three lines of the
 *  longest order blurb at 30px. In portrait the type is 2.6x bigger and has to
 *  earn every unit back, so it takes 1200 of the 1264 instead (32 units of air
 *  each side) rather than shrink further than it must. */
const BLURB_WRAP = IS_MOBILE ? 1200 : 1100;
/** Air the paragraph keeps off the cards above it and the frame's floor below. */
const BLURB_AIR = 10;
/**
 * THE BAND THE BLURB OWNS, stated from the furniture on both sides.
 *
 * It is set at origin 0.5 on y 440, so it grows UP as well as DOWN and the
 * binding side is whichever is nearer: the cards' plates end at
 * CARD_Y + CARD_PLATE_HALF_H = 320.2 (109.8 above the seat) and the frame's
 * floor is 556 (106 below it). 106 is the smaller, so the paragraph's budget is
 * 2 x 106 = 212 units — five lines of desktop 30px type (5 x 37.5 + 4 x 6 =
 * 211.5, half a unit inside), which is why nothing moves there, and two lines
 * of the portrait 78px (2 x 97.5 + 6 = 201), which is where the shrink starts.
 *
 * AND IT CANNOT HONESTLY BE MADE BIGGER, which is the other half of the story
 * the floor below tells. The seat is the only free variable and it is already
 * near the optimum: the band is 2 x min(BLURB_Y - 330.2, 546 - BLURB_Y), which
 * peaks where the two are equal, at BLURB_Y = 438.1, for 215.8 units. Moving
 * the line 1.9 units up to win 3.8 units of budget would move a desktop layout
 * that is correct, for 1.8% more room. The air is the other lever and it is 10
 * units off a painted frame edge — spending it is how a paragraph ends up
 * touching the chrome. So: 212 units, and a floor derived from them.
 */
const BLURB_BUDGET =
  2 *
  Math.min(
    BLURB_Y - (CARD_Y + CARD_PLATE_HALF_H) - BLURB_AIR,
    PANEL_PLATE_BOTTOM - BLURB_AIR - BLURB_Y
  );
/**
 * PHASER'S LINE BOX, which is the unit every height budget here is counted in.
 *
 * `GetTextSize` builds a block's height as
 *     h = n x metrics.fontSize + (n - 1) x lineSpacing
 * and `metrics.fontSize` is NOT the nominal size: `MeasureText` reports the
 * ascent + descent of the test string `|MÉqgy` in the MOUNTED font. For the
 * `Trebuchet MS, Verdana, sans-serif` stack that is 1.16 (Trebuchet: 0.94em of
 * ascender over the acute + 0.22em of descender) to ~1.22 (Verdana), and a
 * handset's generic-sans fallback sits inside that range.
 *
 * 1.25 is the conservative bound every number in this block is computed at, so
 * a font that measures TALLER than the one this was tuned on shrinks the type
 * a step earlier rather than overflowing the frame. It is deliberately not a
 * measurement of one machine's font: nothing here can measure a handset.
 */
const LINE_BOX = 1.25;
/** The blurb's leading. Named because the budget arithmetic counts it and the
 *  text style sets it — a lineSpacing living in two places is one that drifts. */
const BLURB_LEAD = 6;
/**
 * How many lines the longest SHIPPED blurb needs, and therefore how many the
 * floor below has to keep whole.
 *
 * Measured over `src/data/orders.json` (11 orders): the longest is
 * `selyna_signal` at 216 characters — 218 once `refresh()` wraps it in curly
 * quotes — and the longest one the HOME isle can show is `eleanor_moonwater`
 * at 196 (198 quoted). At an average advance of ~0.5em, 218 characters at 38
 * units is 4142 units of type in the 1200 wrap: four lines, the fourth not
 * quite half full.
 */
const BLURB_LINES = 4;
/**
 * THE FLOOR — how small her words may be set before they are cut instead.
 *
 * WHAT WAS FALSE HERE: this said "the longest order blurb is 194 characters",
 * and no such blurb exists (see BLURB_LINES for the real ones). The runtime was
 * never in danger — `fitBlock` MEASURES, so nothing has ever overflowed the
 * frame — but the headroom the floor was chosen from was ~12% short of the
 * paragraph it has to hold, and the promise that "only the last clause or so is
 * ever cut" was wrong by a whole line: at the old px(16) = 42 the 218-character
 * blurb is 4 x (1.25 x 42) + 3 x 6 = 228 units against a 212-unit band, so
 * `fitBlock` fell out of the shrink loop into the truncation branch and kept
 * floor(212 / 57) = 3 of the 4 lines. `eleanor_moonwater` (198) and
 * `selyna_spindle` (184) went the same way, and on a font 10% wider than the
 * model `selyna_pitch` (161) joined them while the longest lost TWO of its
 * five. Nobody sees any of it from a desktop, where the loop runs zero times.
 *
 * So the floor is DERIVED from the band rather than picked: the largest whole
 * size at which BLURB_LINES lines still fit BLURB_BUDGET,
 *     n x LINE_BOX x f + (n - 1) x BLURB_LEAD <= 212  =>  f <= 194/5 = 38.8
 * i.e. 38 on a phone. That is 10.6 real pixels once the panel's own 1.823 is
 * applied on a 390px-wide handset, against 11.7 at the old 42 — 1.1 real pixels
 * of type, traded for a line of Selyna. On the font this was tuned against
 * (1.16) the loop never reaches it anyway: 4 x 48.7 + 18 = 213 at 42 and 208 at
 * 41, so the paragraph settles at 41 and the floor is only what a WIDER
 * fallback falls back to.
 *
 * `px(16)` caps it so the DESKTOP floor stays the 16 it has always been. There
 * the line is 30px, three lines of it is 3 x 37.5 + 12 = 124.5 of the 212, and
 * the loop has never run — a derived 38 there would only make a hypothetical
 * future overflow truncate immediately instead of shrinking first.
 *
 * IT IS STILL NOT A PROMISE, and this is the honest version of the sentence
 * that used to sit here. At 38 every shipped blurb fits whole at an average
 * advance of 0.5em AND at 0.55em (Verdana's, the widest thing in the stack).
 * The wall is 4 x 1200 / (218 x 38) = 0.579em: a fallback wider than that
 * wraps the longest to five lines, five lines is 5 x 47.5 + 24 = 262 units,
 * and `fitBlock` cuts the last one. The band is 212 units and there is no
 * materially bigger seat for it (see BLURB_BUDGET), so on a wide enough font
 * the longest blurb still loses its tail — it is now a font nothing in the
 * stack reaches, rather than the font the game ships on.
 */
const BLURB_MIN_PX = Math.min(
  px(16),
  Math.floor((BLURB_BUDGET - (BLURB_LINES - 1) * BLURB_LEAD) / (BLURB_LINES * LINE_BOX))
);
/** The no-orders notice: two authored lines with a speaker's name in them. The
 *  wrap is a guard, not a layout — 1200 of the plate's 1264 — so a longer host
 *  name can never push the sentence off the frame. */
const EMPTY_WRAP = 1200;

// ---- The Close key, and the pocket it has to fit in ----
/** `ui_btn_round_royal` is paint(68,68) => a 136x136 game-unit texture, so
 *  `setScale(s)` paints a disc 136 x s across. */
const CLOSE_ART = 136;
/** The disc's authored scale, and the pocket that measured it: the frame's plate
 *  runs to x 632 and the Tasks lozenge ends at x 530, so the pocket in the
 *  top-right is 102 units wide and 136 x 0.58 = 78.9 sits in it with ~12 units
 *  of air either side. */
const CLOSE_DESKTOP_SCALE = 0.58;
/**
 * MOBILE — the pocket did not get any wider, so the disc may not either.
 *
 * The whole panel is already magnified by `panelMobileScale` (1.82 on a phone),
 * which carries the pocket AND the disc together. What broke the seat was
 * `TAP_SCALE` being applied to the CONTAINER on top of that: it multiplied the
 * PAINT as well as the target, so the disc became 136 x 0.58 x 2.2 = 173.5
 * across and hung 34.8 units past the frame's right edge and 32.8 above its top
 * one, over the Tasks tab. A thumb target and a painted disc are two different
 * things and now they are two different numbers.
 *
 * 0.647 is the biggest disc the pocket takes. Its three walls, all measured off
 * the art rather than guessed:
 *   • the frame's plate is rounded by RADIUS_TEX.xl — 30 logical = 60 game
 *     units — so its top-right arc centre is (632-60, -404+60) = (572, -344);
 *   • the Tasks lozenge is a 520x104 capsule at (270, -384): the segment
 *     (62,-384)..(478,-384) swollen by TAB_H/2 = 52;
 *   • the right order card's plate corner is (577.2, -288.2), rounded by
 *     14 logical x 2 x 0.9 = 25.2.
 * Seated at (578, -354) a disc of radius 44 clears the frame's corner arc by 4.3
 * units (11.7 from the arc centre + 44 ≤ 60), the tab by 8.4 and the card by 25.
 * 2 x 44 / 136 = 0.647.
 */
const CLOSE_DISC_SCALE = IS_MOBILE ? 0.647 : CLOSE_DESKTOP_SCALE;
/** Pulled IN from (580, -350): the disc's edge rode the frame's rounded
 *  corner (owner: "il touche le bord du cadre"). Same face, 48 further in. */
const CLOSE_SEAT_X = IS_MOBILE ? 530 : 532;
const CLOSE_SEAT_Y = IS_MOBILE ? -332 : -328;
/** The ✕ is 40 units of type on the desktop disc's 78.9, so it keeps that
 *  proportion whatever scales the disc — 40 exactly on desktop, 45 in portrait. */
const CLOSE_GLYPH_PX = Math.round(
  CLOSE_ART * CLOSE_DISC_SCALE * (40 / (CLOSE_ART * CLOSE_DESKTOP_SCALE))
);
/** A 2-unit optical lift, so the glyph's mass reads centred in the candy dome. */
const CLOSE_GLYPH_LIFT = -2;
/**
 * THE THUMB, WHICH IS NOT THE DISC.
 *
 * 96 units of hit box is ~27 CSS px once the panel's own 1.82 is applied on a
 * 390px-wide handset — well under the 44px every platform asks for — so the
 * TARGET keeps the full `TAP_SCALE` step (211 units, ~59 CSS px) while the paint
 * stays inside the pocket. That box's left edge (578 - 106 = 472) laps the last
 * 58 units of the Tasks lozenge, which is its bare rounded cap: the label is
 * centred at x 270 and never reaches past ~500, and the close key is added after
 * the tabs so it wins the overlap. A tab cap nobody aims at, traded for a Close
 * key a thumb can actually hit.
 */
const CLOSE_HIT = 96 * TAP_SCALE;

// ---- Order-card portrait medallion ----
// Eleanor sits in the SAME gold ring the dialogue bubble frames her with
// (`portrait_ring`, 512px art), so the quest book and her bubble read as one
// medallion language rather than two unrelated treatments. Every radius below
// is a ratio of that art's own geometry — the window hole ends at 200/512 and
// the gold's outer edge at 250/512 — so re-sizing is one constant.
// 164, not 184. The band it has to live in is fixed — the card's painted plate
// starts at -304 and the requirement slot at -36 — and at 184 the ring filled
// it almost exactly: 18 units of air above the gold and 5 below it, before the
// title. Both edges read as touching, because 18 units at this size IS
// touching. A smaller ring is the only thing that buys air at both ends.
const MEDALLION_SIZE = 164;
/** Centred in the band between the card's top edge and the title, with 30
 *  units of air above the gold and 30 below it. */
const MEDALLION_Y = -194;
const RING_HOLE_R = MEDALLION_SIZE * (200 / 512);
const RING_OUTER_R = MEDALLION_SIZE * (250 / 512);
/** Portrait clip radius — just inside the gold, so the crop's edge hides UNDER
 *  the band and never reads as a hard circle against the moss. */
const RING_MASK_R = MEDALLION_SIZE * (247 / 512);
/** Bust height as a multiple of the window's diameter. Just over 1 — the same
 *  proportion the dialogue bubble frames her at, so the crop lands on her robe
 *  hem and her shoulders and braid still read. Scaling to COVER the window's
 *  width instead cropped her at the jaw and lost the bust entirely. */
const MEDALLION_FILL = 1.1;
/** Headroom between the window's top and the top of the art, so her hair has
 *  air instead of butting into the frame. */
const MEDALLION_HEAD_INSET = 6;
/** Moss interior — the same two greens CharacterBubble fills its ring window
 *  with, so the gaps beside her silhouette read as the medallion's inside. */
const MOSS_BACK = 0x3e745b;
const MOSS_LIGHT = 0x549270;

// ---- The order title, and the band it is allowed to grow in ----
/**
 * The card is FULL — plate -304.2 .. 304.2, and every unit of it is spoken for:
 *   -304.2 .. -274.1  air over the medallion  (30.1)
 *   -274.1 .. -113.9  the medallion's gold    (160.2)
 *   -113.9 ..  -36    THE TITLE'S BAND        ( 77.9)
 *     -36   ..  108   the requirement slot    (144)
 *     108   ..  166   the reward line         ( 58)
 *     172.8 .. 279.2  the Deliver key         (106.4)
 *     279.2 .. 304.2  air under it            ( 25.0)
 * The key used to sit at 175.75..288.25 and leave 15.9 — but the card art
 * paints its own rim inside the plate's edge, so on screen the key's foot sat
 * ON the moulding, exactly the defect the Store's ACTION_FOOT fixed. The 25 is
 * that same foot; it is paid for by the key giving up 4 units of height
 * (scaleY 0.74 → 0.70) and riding 6 higher, not by any line above it moving.
 * so the title's 77.9 is all there is. It is set at origin 0.5, which means a
 * second line grows 19 units UP into the medallion's gold as well as 19 down —
 * that, and not the wrap, is why a wrapped title read as touching the ring.
 */
const CARD_TITLE_BAND_TOP = MEDALLION_Y + RING_OUTER_R;
const CARD_TITLE_BAND_BOTTOM = SLOT_Y - SLOT_ART / 2;
/** Where a ONE-LINE title sits — 30 units under the gold, exactly as authored,
 *  and where every shipped title still sits. */
const CARD_TITLE_Y = -84;
const CARD_TITLE_PX = 30;
const CARD_TITLE_MIN_PX = 22;
/**
 * 500 of the plate's 554.4, leaving 27 units of air each side.
 *
 * It was 400, which put 77 units of air each side of a title that is at most 29
 * characters ("Craft the Radiant Centerpiece", ~452 units at 30px bold) — so the
 * ONE title long enough to wrap did so for want of margin the card already had.
 * Widening it is the fix for the wrap; the band below is the fix for a title
 * that wraps anyway.
 */
const CARD_TITLE_WRAP = 500;
/** Air the title keeps off the gold above and the slot below. */
const CARD_TITLE_AIR = 5;
const CARD_TITLE_BUDGET =
  CARD_TITLE_BAND_BOTTOM - CARD_TITLE_AIR - (CARD_TITLE_BAND_TOP + CARD_TITLE_AIR);

// ---- The requirement count badge ----
const CARD_COUNT_X = 48;
const CARD_COUNT_Y = 80;
const CARD_COUNT_PX = 30;
const CARD_COUNT_MIN_PX = 20;
/** The badge is centred at x 48 and grows both ways. Left it may not reach the
 *  slot's centre, where the requirement icon is; right it may not reach the
 *  plate's edge less air. min(48 - 0, 277.2 - 10 - 48) = 48, so its line has 96
 *  units — "1200/60" at 30px is ~105 and is the first thing that would shrink. */
const CARD_COUNT_AIR = 10;
const CARD_COUNT_BUDGET_W =
  2 * Math.min(CARD_COUNT_X, CARD_PLATE_HALF_W - CARD_COUNT_AIR - CARD_COUNT_X);

// ---- The reward line ----
const CARD_REWARD_Y = 148;
const CARD_REWARD_PX = 28;
const CARD_REWARD_MIN_PX = 20;
/** The coin art contain-fits this box, and hangs off the line's left edge by
 *  this gap — so the pair reaches 24 + 34/2 = 41 units further left than the
 *  text's own half-width does. */
const CARD_REWARD_COIN_FIT = 34;
const CARD_REWARD_COIN_GAP = 24;
/** 2 x (277.2 plate half - 10 air - 41 coin) = 452.4 units for the line itself.
 *  The richest shipped reward — "240   ✦ 85 XP   🎁 ???   🥚 ???" — is ~369, so
 *  this never bites today; it is what stops the day it does. */
const CARD_REWARD_BUDGET_W =
  2 *
  (CARD_PLATE_HALF_W - CARD_COUNT_AIR - (CARD_REWARD_COIN_GAP + CARD_REWARD_COIN_FIT / 2));

type LedgerTab = 'orders' | 'tasks';

/**
 * Seat a block of `h` units at `preferred`, then slide it just far enough to sit
 * inside `top..bottom`. A one-line title never moves (its half-height clears the
 * gold from y -84 already); a wrapped one is pushed down off the medallion
 * instead of being drawn through it. A band too small for the block at all is
 * left where it was — `fitBlock` has already done what it can, and shoving it is
 * only choosing which edge it crosses.
 */
function seatInBand(h: number, preferred: number, top: number, bottom: number): number {
  if (bottom - top < h) return preferred;
  return Math.min(Math.max(preferred, top + h / 2), bottom - h / 2);
}

interface OrderCard {
  root: Phaser.GameObjects.Container;
  /** The face in the medallion ring — retargeted to each order's `giver` on
   *  refresh, so Selyna's orders wear Selyna and Eleanor's wear Eleanor. */
  medallion: Phaser.GameObjects.Image;
  title: Phaser.GameObjects.Text;
  slotIcon: Phaser.GameObjects.Image;
  slotCount: Phaser.GameObjects.Text;
  rewardText: Phaser.GameObjects.Text;
  /** Real coin art in front of the reward line — shown only when the order pays
   *  Gold, and re-seated on every refresh because the line's width changes. */
  rewardCoin: Phaser.GameObjects.Image;
  deliverButton: Phaser.GameObjects.Container;
  order: OrderConfig | null;
  deliverable: boolean;
}

interface TaskRow {
  label: Phaser.GameObjects.Text;
  count: Phaser.GameObjects.Text;
  barBg: Phaser.GameObjects.Graphics;
  fill: Phaser.GameObjects.Graphics;
  check: Phaser.GameObjects.Text;
  hint: Phaser.GameObjects.Text;
}

interface TabHandle {
  root: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

/**
 * Eleanor's Ledger — the game's single quest board. Two tabs under one frame:
 *   • Orders — the two-slot order board (DEMO-PLAN §Act III): both active
 *     orders visible at once, so the player CHOOSES what to chase.
 *   • Tasks — the Keeper's Tasks chapter checklist (DEMO-PLAN §Act V) with
 *     live progress bars; TaskSystem owns the reward, this page only renders.
 * The Tasks tab appears once the tutorial ends (the checklist is the encore's
 * spine, not a tutorial concern) — until then the Orders header sits centred
 * and the panel reads exactly like the tutorial's original Ledger.
 */
export class LedgerPanel extends Phaser.GameObjects.Container {
  isOpen = false;
  /** Open/rest scale — >1 on mobile so the frame fills the portrait width. */
  private baseScale = 1;
  private readonly offBus: Array<() => void> = [];
  private dim: Phaser.GameObjects.Rectangle;
  private blurb: Phaser.GameObjects.Text;
  /** The RAW string the blurb was last fitted from — not `blurb.text`, which
   *  `fitBlock` may have rewritten into a shorter, ellipsised form. It is the
   *  key that says whether the (expensive) fit has to be walked again. */
  private blurbSource: string | null = null;
  private emptyText: Phaser.GameObjects.Text;
  private cards: OrderCard[] = [];
  private deliverAllowed = true;
  private activeTab: LedgerTab = 'orders';
  private ordersPage: Phaser.GameObjects.Container;
  private tasksPage: Phaser.GameObjects.Container;
  private ordersTab: TabHandle;
  private tasksTab: TabHandle;
  private taskRows: TaskRow[] = [];
  /** Per-card portrait clip circles, re-seated in world space each frame. */
  private portraitMasks: Array<{ g: Phaser.GameObjects.Graphics; root: Phaser.GameObjects.Container }> = [];
  /** The owning scene, held separately from the GameObject's own `this.scene`.
   *  Phaser's DisplayList destroys every child during scene shutdown, and a
   *  destroyed GameObject has `scene === undefined` — but our SHUTDOWN listener
   *  is registered in create(), so it runs AFTER that. `teardown()` therefore
   *  cannot reach the scene through `this.scene`; it would throw and abort the
   *  whole teardown chain (the panels after it would keep their subscriptions). */
  private readonly owner: Phaser.Scene;

  constructor(
    scene: Phaser.Scene,
    private bus: EventBus,
    private orderSystem: OrderSystem,
    private taskSystem: TaskSystem,
    private gameState: GameState
  ) {
    super(scene, LIVE_GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2);
    this.owner = scene;

    // THE SCRIM SWALLOWS; IT DOES NOT CLOSE.
    //
    // It stays interactive so nothing falls through to the board behind it, but
    // its `pointerup` no longer calls requestClose(). On a phone the panel is
    // magnified 1.82x and its scrim is the whole screen, so reading the board —
    // a thumb resting beside a card, a drag that starts as a scroll — kept
    // dismissing the one page the player had opened to read. The ✕ closes it,
    // and the HUD's own Ledger key toggles it. The scrim does NOT cancel the
    // event — see the note in `ShopPanel.ts` for why that would break the
    // scrolling panels' drag release — it simply no longer listens for a close.
    //
    // NOTHING SCRIPTED DEPENDED ON THE TAP-OUTSIDE. The tutorial's two Ledger
    // beats gate on `ui:ledger_opened` and `order:completed`, never on a close;
    // UIScene force-closes the panel on any later beat that stops allowing it
    // (`onTutorialStep`) and again 650ms after `order:completed` when the next
    // gate is a tap, so the scrim can still never swallow a tap a beat is
    // waiting on.
    this.dim = scene.add
      .rectangle(0, 0, LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, num(INK.scrim), 0.55)
      .setInteractive();

    // SEATED SO THE FRAME GREW DOWNWARD, not outward from its middle.
    //
    // `ui_quest_panel` is 136 game units taller than it was, and a centred image
    // would have split that between the top and the bottom — moving the frame's
    // top edge up under the tabs, which straddle it, and re-cutting the header
    // for a problem that is entirely at the floor. At y 86 the inner plate still
    // starts at -404, exactly where every number in this file expects it, and
    // all 136 units land where the blurb needed them.
    const panel = scene.add.image(0, 86, 'ui_quest_panel');
    this.baseScale = panelMobileScale(panel.width);

    // Tab lozenges along the top edge — Orders sits centred (classic Ledger
    // header) until the tutorial ends and the Tasks tab joins it.
    this.ordersTab = this.buildTab(scene, 'Eleanor’s Orders', () => this.switchTab('orders'));
    this.tasksTab = this.buildTab(scene, 'Keeper’s Tasks', () => this.switchTab('tasks'));

    // Close button — INSIDE the board, not straddling its corner.
    //
    // The frame's inner rect is x -632..632, y -404..556; the Tasks tab ends at
    // x 530 and the right order card's plate starts at y -288. That leaves one
    // clear pocket, and the key is sized to sit in it with air on all four sides
    // rather than hung on the rim like a sticker. See the CLOSE_* block above
    // for the arithmetic, and for why the disc and its hit box are now sized
    // separately in portrait.
    const closeButton = scene.add.container(CLOSE_SEAT_X, CLOSE_SEAT_Y);
    // The royal candy disc — the same Close key every other panel wears, and
    // deliberately NOT the cream HUD disc, which means "open something".
    const closeBg = scene.add.image(0, 0, 'ui_btn_round_royal').setScale(CLOSE_DISC_SCALE);
    const closeX = scene.add
      .text(0, CLOSE_GLYPH_LIFT, '✕', {
        fontFamily: FONT.ui,
        fontSize: `${CLOSE_GLYPH_PX}px`,
        fontStyle: 'bold',
        color: INK.onFieldGold
      })
      .setOrigin(0.5);
    closeButton.add([closeBg, closeX]);
    // The container carries the TARGET only — it is never scaled, or the paint
    // would grow with it and leave the pocket again. 96 on desktop, unchanged.
    closeButton.setSize(CLOSE_HIT, CLOSE_HIT);
    closeButton.setInteractive({ useHandCursor: true });
    closeButton.on('pointerup', () => this.requestClose());

    // ---- Orders page: two cards side by side + blurb + empty text. ----
    this.ordersPage = scene.add.container(0, 0);
    this.cards.push(this.buildCard(scene, -CARD_X), this.buildCard(scene, CARD_X));

    // The active card's flavor line runs along the bottom of the board.
    // BOLD, and in the field's full ink. It is Eleanor's own line about the
    // order the player is looking at — the one piece of writing on this board
    // that is neither a label nor a number — and it was set dim, small and
    // italic, which is how you set a footnote nobody is meant to read.
    // Sized and wrapped from the BLURB_* block: a preferred size, a wrap taken
    // from the plate's width, and a 212-unit band it is fitted into whenever
    // the ORDER CHANGES (see `refresh`) — because the longest order blurb is
    // `selyna_signal`'s 216 characters, 218 with the quotes this adds, and at
    // the portrait 78px that is seven lines: 7 x (1.25 x 78) + 6 x 6 = 719
    // units. Centred on 440 that box runs panel y 80..800 — 244 past the
    // frame's floor at 556, and up across both Deliver keys, which sit at
    // 248..304. (This note used to say 194 characters and 697 units. The blurb
    // it was measured against does not exist; the arithmetic that matters is
    // in BLURB_MIN_PX now, stated from the file the strings actually ship in.)
    this.blurb = scene.add
      .text(0, BLURB_Y, '', {
        fontFamily: FONT.ui,
        fontSize: `${BLURB_PX}px`,
        fontStyle: 'bold italic',
        color: INK.onField,
        align: 'center',
        lineSpacing: BLURB_LEAD,
        wordWrap: { width: BLURB_WRAP }
      })
      .setOrigin(0.5);

    this.emptyText = scene.add
      .text(0, 20, 'The brazier roars again!\nEleanor will have new work for you soon.', {
        fontFamily: FONT.ui,
        fontSize: '38px',
        fontStyle: 'bold',
        color: INK.onField,
        align: 'center',
        lineSpacing: 12,
        wordWrap: { width: EMPTY_WRAP }
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.ordersPage.add([...this.cards.map((c) => c.root), this.blurb, this.emptyText]);

    // ---- Tasks page: the chapter checklist. ----
    this.tasksPage = scene.add.container(0, 0).setVisible(false);
    this.buildTasksPage(scene);

    this.add([this.dim, panel, this.ordersTab.root, this.tasksTab.root, closeButton, this.ordersPage, this.tasksPage]);
    scene.add.existing(this);
    this.setVisible(false);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.syncPortraitMasks, this);

    uiRegistry.register(scene, 'panel.ledger', 'Eleanor’s Ledger panel', 'Panels', this, {
      frame: panel,
      title: this.ordersTab.label,
      orderTitle: this.cards[0]!.title,
      blurb: this.blurb,
      card: this.cards[0]!.root
    });

    // `order:progress` is a FIRE HOSE, not a notification: OrderSystem emits it
    // once PER ACTIVE ORDER from `announceProgress`, which is subscribed to
    // `item:spawned`, `item:merged`, `item:produced`, `item:removed`,
    // `region:unlocked`, `state:loaded` and `world:switched`. With the two
    // orders this board shows, ONE merge is two of them, one producer tick is
    // two more, and a bag sale that removes six pieces is twelve. `refresh` is
    // guarded accordingly — see its own note.
    this.offBus.push(
      bus.on('order:progress', () => this.refresh()),
      bus.on('order:completed', () => this.refresh())
    );
    // The checklist counts merges/hatches/orders/gold/elder-taps — refresh the
    // Tasks page (and its tab counter) whenever any of those move while open.
    for (const event of ['item:merged', 'item:hatched', 'order:completed', 'elder:tapped', 'economy:changed', 'tasks:all_complete'] as const) {
      this.offBus.push(bus.on(event, () => this.isOpen && this.refreshTasks()));
    }
  }

  /** One header lozenge — restyled active/inactive by layoutTabs(). */
  private buildTab(scene: Phaser.Scene, text: string, onTap: () => void): TabHandle {
    const root = scene.add.container(0, TAB_Y);
    const bg = scene.add.graphics();
    const label = scene.add
      .text(0, 0, text, {
        fontFamily: FONT.ui,
        fontSize: '40px',
        fontStyle: 'bold',
        color: INK.onField
      })
      .setOrigin(0.5)
      .setShadow(0, 4, 'rgba(36,27,34,0.5)', 6);
    root.add([bg, label]);
    root.setSize(TAB_W, TAB_H);
    root.setInteractive({ useHandCursor: true });
    root.on('pointerup', onTap);
    return { root, bg, label };
  }

  /** Five checklist rows + the reward footer, in panel space. */
  private buildTasksPage(scene: Phaser.Scene): void {
    const rowTop = TASK_ROW_TOP;
    const rowGap = TASK_ROW_GAP;
    this.taskSystem.tasks.forEach((task, i) => {
      const y = rowTop + i * rowGap;
      // The label is the one thing on a row that comes from data, so it is the
      // one thing that can grow: the wrap keeps it out of the bar's column and
      // `fitBlock` keeps it out of the row underneath (three lines of 31px is
      // 111 of the row's 116-unit budget; a fourth shrinks the type, and a
      // label that still will not fit is truncated rather than drawn through
      // its neighbour). No shipped label reaches even two lines.
      const label = scene.add
        .text(TASK_LABEL_X, y, task.label, {
          fontFamily: FONT.ui,
          fontSize: `${TASK_LABEL_PX}px`,
          fontStyle: 'bold',
          color: INK.onField,
          wordWrap: { width: TASK_LABEL_WRAP }
        })
        .setOrigin(0, 0.5);
      this.fitBlock(label, TASK_ROW_BUDGET, TASK_LABEL_MIN_PX);
      const barX = TASK_BAR_X;
      const barBg = scene.add.graphics();
      barBg.fillStyle(num(INK.fieldDeep), 0.85);
      barBg.fillRoundedRect(barX, y + 18, TASK_BAR_W, 22, 11);
      const fill = scene.add.graphics();
      const count = scene.add
        .text(barX + TASK_BAR_W / 2, y - 14, '', {
          fontFamily: FONT.ui,
          fontSize: '27px',
          fontStyle: 'bold',
          color: INK.onFieldGold
        })
        .setOrigin(0.5);
      const check = scene.add
        .text(548, y, '✓', {
          fontFamily: FONT.ui,
          fontSize: '46px',
          fontStyle: 'bold',
          color: INK.gain
        })
        .setOrigin(0.5)
        .setVisible(false);
      // Replaces the bar while the task's subject doesn't exist yet. Same
      // budget as the label — it stands in the same row, and the shipped hint
      // ("🔒 Locked until Keeper Level 3, after Eleanor's first order") already
      // runs to two lines at 24px inside its 430 wrap.
      const hint = scene.add
        .text(TASK_HINT_X, y, task.lockedHint ? `🔒 ${task.lockedHint}` : '', {
          fontFamily: FONT.ui,
          fontSize: `${TASK_HINT_PX}px`,
          fontStyle: 'italic',
          color: INK.onFieldDim,
          align: 'center',
          wordWrap: { width: TASK_HINT_WRAP }
        })
        .setOrigin(0.5)
        .setVisible(false);
      this.fitBlock(hint, TASK_ROW_BUDGET, TASK_HINT_MIN_PX);
      this.tasksPage.add([label, barBg, fill, count, check, hint]);
      this.taskRows.push({ label, count, barBg, fill, check, hint });
    });

    // Follows the frame's new floor (556) rather than staying at the old one.
    const footer = scene.add
      .text(0, 462, `Finish all ${this.taskSystem.tasks.length} → a golden reward from Eleanor`, {
        fontFamily: FONT.ui,
        fontSize: '28px',
        fontStyle: 'bold',
        color: INK.onFieldGold
      })
      .setOrigin(0.5);
    this.tasksPage.add(footer);
  }

  /**
   * Fit a WRAPPED block of type into `budget` units of height: shrink the size
   * first, and only truncate once it has hit the floor.
   *
   * The order matters. A smaller sentence is a far smaller loss than a shorter
   * one — Eleanor's blurb is the one piece of writing on this board that is
   * neither a label nor a number — so the type gives way before her words do.
   * The truncation re-measures after every cut because dropping a word can pull
   * the following line up and change how many lines there are; without that
   * guard the "…" lands mid-paragraph and a line still hangs below the budget.
   *
   * (The same routine the Store's card blurb uses. Copied rather than shared:
   * these two panels have no reason to own a common module, and a helper that
   * one of them can silently retune for the other is worse than two copies.)
   *
   * IT STILL STEPS ONE UNIT AT A TIME, on purpose. A binary search over the
   * size, or a first guess of `size x budget / height`, would land in three or
   * four measurements instead of forty — but only if `height(size)` is
   * MONOTONE, and this loop does not assume that: it takes the first size that
   * fits on the way down, whatever shape the font's measurements have. The
   * result is shipped layout, so a search that landed one pixel off on some
   * fallback font would silently re-flow a screen nobody re-measures. The
   * forty rungs were never the problem — walking them on a panel the player
   * cannot see, hundreds of times a minute, was. That is fixed at the callers
   * (`refresh` runs only on screen, and only re-fits when the words change),
   * which leaves this at a handful of walks per session: once per distinct
   * order blurb the player is shown.
   */
  private fitBlock(text: Phaser.GameObjects.Text, budget: number, minPx: number): void {
    let size = Math.round(parseFloat(String(text.style.fontSize))) || minPx;
    while (text.height > budget && size > minPx) {
      size -= 1;
      text.setFontSize(size);
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

  /**
   * Fit a SINGLE unwrapped line into `budget` units of width — same shape as
   * `fitBlock`, but the axis a line without a wrap can run off in.
   *
   * Used for the reward line and the requirement count: both are built from
   * numbers the player's own play produces, so neither has a longest form the
   * card was measured against. Clipping the tail is the right failure for them
   * — a count reading "1200/6…" is still a count, a count drawn off the plate
   * is not.
   */
  private fitLine(text: Phaser.GameObjects.Text, budget: number, minPx: number): void {
    let size = Math.round(parseFloat(String(text.style.fontSize))) || minPx;
    while (text.width > budget && size > minPx) {
      size -= 1;
      text.setFontSize(size);
    }
    let body = text.text;
    while (text.width > budget && body.length > 1) {
      body = body.slice(0, -1);
      text.setText(`${body}…`);
    }
  }

  /** One order card: portrait, title, requirement slot, reward line, Deliver. */
  private buildCard(scene: Phaser.Scene, x: number): OrderCard {
    const root = scene.add.container(x, CARD_Y);
    const cardBg = scene.add.image(0, 0, 'ui_card').setScale(CARD_ART_SCALE);
    const { layers: medallion, portrait } = this.buildMedallion(scene, root);
    const title = scene.add
      .text(0, CARD_TITLE_Y, '', {
        fontFamily: FONT.ui,
        fontSize: `${CARD_TITLE_PX}px`,
        fontStyle: 'bold',
        color: INK.onField,
        align: 'center',
        wordWrap: { width: CARD_TITLE_WRAP }
      })
      .setOrigin(0.5);
    const slot = scene.add.image(0, SLOT_Y, 'ui_slot');
    const slotIcon = scene.add.image(0, 28, 'item_flame_gem_2').setScale(0.72);
    const slotCount = scene.add
      .text(CARD_COUNT_X, CARD_COUNT_Y, '0/0', {
        fontFamily: FONT.ui,
        fontSize: `${CARD_COUNT_PX}px`,
        fontStyle: 'bold',
        color: INK.onField
      })
      .setOrigin(0.5)
      .setShadow(0, 2, '#FFFFFF', 4);
    const rewardCoin = scene.add.image(0, CARD_REWARD_Y, 'ui_icon_coin').setVisible(false);
    rewardCoin.setScale(CARD_REWARD_COIN_FIT / Math.max(rewardCoin.width, rewardCoin.height));
    const rewardText = scene.add
      .text(0, CARD_REWARD_Y, '', {
        fontFamily: FONT.ui,
        fontSize: `${CARD_REWARD_PX}px`,
        fontStyle: 'bold',
        color: INK.onFieldGold
      })
      .setOrigin(0.5);

    const deliverButton = scene.add.container(0, 226);
    // WIDER THAN IT IS TALL, on purpose. At a uniform 0.72 the word filled the
    // pill end to end and the rounded caps ate what padding was left, so the
    // key looked shut. 0.70 tall and seated at 226 so its foot clears the
    // card's painted rim by a real 25 units — see the card map above.
    const deliverBg = scene.add.image(0, 0, 'ui_btn_green').setScale(0.88, 0.7);
    const deliverText = scene.add
      .text(0, -8, 'Deliver', {
        fontFamily: FONT.ui,
        fontSize: '44px',
        fontStyle: 'bold',
        color: '#FFFFFF'
      })
      .setOrigin(0.5)
      .setShadow(0, 4, 'rgba(36,27,34,0.5)', 6);
    deliverButton.add([deliverBg, deliverText]);
    // The bg image carries the interaction so the nested-container transform
    // doesn't muddle the hit test (see the original single-card notes).
    deliverBg.setInteractive({ useHandCursor: true });
    deliverButton.setSize(360, 124);

    const card: OrderCard = {
      root,
      medallion: portrait,
      title,
      slotIcon,
      slotCount,
      rewardText,
      rewardCoin,
      deliverButton,
      order: null,
      deliverable: false
    };
    deliverBg.on('pointerup', () => this.onDeliverPressed(card));
    root.add([cardBg, ...medallion, title, slot, slotIcon, slotCount, rewardCoin, rewardText, deliverButton]);
    return card;
  }

  /**
   * Eleanor framed in the dialogue bubble's gold ring: drop shadow, moss
   * interior, her bust cropped to the window, ring on top. Returns the layers in
   * back-to-front order for the card to add.
   *
   * The bust art is TALLER than it is wide (391×560), so it is COVER-fit and
   * top-anchored — the window takes her head and shoulders and the crop falls at
   * the chest, the way a portrait medallion should read. (The card previously
   * forced it into a 178px square with `setDisplaySize`, which squashed her to
   * 70% height.) The painted fallback is square, so the same cover rule centres
   * it instead of top-anchoring — either way the art can never under-fill the
   * window and let moss show through as a gap.
   */
  private buildMedallion(
    scene: Phaser.Scene,
    root: Phaser.GameObjects.Container
  ): { layers: Phaser.GameObjects.GameObject[]; portrait: Phaser.GameObjects.Image } {
    // Lift: a soft dark disc under the gold so the medallion sits ON the card
    // rather than floating flat against it.
    const shadow = scene.add.graphics();
    shadow.fillStyle(num(INK.scrim), 0.4);
    shadow.fillCircle(0, MEDALLION_Y + 5, RING_OUTER_R + 2);

    // Moss interior, filled past the hole to the clip radius so no card colour
    // survives as a sliver under the ring's inner antialiased edge.
    const back = scene.add.graphics();
    back.fillStyle(MOSS_BACK, 1);
    back.fillCircle(0, MEDALLION_Y, RING_MASK_R);
    back.fillStyle(MOSS_LIGHT, 1);
    back.fillCircle(0, MEDALLION_Y - RING_HOLE_R * 0.085, RING_HOLE_R * 0.915);

    // Her face comes from the DISC ATLAS the bubble already animates — frame 0
    // is the rest bust. 'portrait_eleanor' died when the cast art moved to the
    // atlases: nothing loads that key any more, so the medallion was showing
    // Phaser's missing-texture mark in a gold ring.
    const discKey = discTextureFor('eleanor');
    const portrait = scene.textures.exists(discKey)
      ? scene.add.image(0, MEDALLION_Y, discKey, 0)
      : scene.add.image(0, MEDALLION_Y, 'portrait_ring'); // never the green mark
    this.seatMedallion(portrait);

    // Geometry masks live in WORLD space, so the circle is re-seated every frame
    // against the panel's position and its open/close scale tween (the same
    // treatment CharacterBubble gives its ring window).
    const maskG = scene.make.graphics();
    maskG.fillStyle(0xffffff, 1);
    maskG.fillCircle(0, 0, RING_MASK_R);
    portrait.setMask(maskG.createGeometryMask());
    this.portraitMasks.push({ g: maskG, root });

    const ring = scene.add.image(0, MEDALLION_Y, 'portrait_ring');
    ring.setDisplaySize(MEDALLION_SIZE, MEDALLION_SIZE);

    return { layers: [shadow, back, portrait, ring], portrait };
  }

  /** Fit whatever face is mounted into the ring window — run on build AND after
   *  every texture swap, because the fit depends on the mounted art's size. */
  private seatMedallion(portrait: Phaser.GameObjects.Image): void {
    const window = RING_MASK_R * 2;
    if (portrait.height > portrait.width * 1.15) {
      // Bust art: size by HEIGHT and hang it from the window's top, so the
      // window takes her head, shoulders and braid and the crop falls on the
      // robe. Moss shows at her sides — that is the frame reading as a window.
      const fit = (window * MEDALLION_FILL) / portrait.height;
      portrait.setScale(fit);
      portrait.y = MEDALLION_Y - RING_MASK_R + MEDALLION_HEAD_INSET + (portrait.height * fit) / 2;
    } else {
      // Square art — the painted fallback, itself a little framed medallion.
      // Contain it and centre it; a fallback should look plain, never cropped.
      portrait.setScale(window / Math.max(1, portrait.width));
      portrait.y = MEDALLION_Y;
    }
  }

  /** Mount `giver`'s face in a card's medallion (frame 0 of their disc atlas =
   *  the rest bust). A giver with no disc keeps the current face rather than
   *  showing the missing-texture mark — art failures degrade, never block. */
  private setMedallionGiver(card: OrderCard, giver: string): void {
    const discKey = discTextureFor(giver);
    if (!this.owner.textures.exists(discKey) || card.medallion.texture.key === discKey) return;
    card.medallion.setTexture(discKey, 0);
    this.seatMedallion(card.medallion);
  }

  /** Keep every card's portrait clip circle over its ring window. */
  private syncPortraitMasks(): void {
    if (!this.visible) return;
    for (const { g, root } of this.portraitMasks) {
      g.setPosition(this.x + root.x * this.scaleX, this.y + (root.y + MEDALLION_Y) * this.scaleY);
      g.setScale(this.scaleX, this.scaleY);
    }
  }

  teardown(): void {
    this.offBus.forEach((off) => off());
    this.offBus.length = 0;
    this.owner.events.off(Phaser.Scenes.Events.UPDATE, this.syncPortraitMasks, this);
    this.portraitMasks.forEach(({ g }) => g.destroy());
    this.portraitMasks.length = 0;
  }

  /** World position of the FIRST card's Deliver button (tutorial hand target). */
  getDeliverPos(): { x: number; y: number } {
    const card = this.cards[0]!;
    // Local offsets scaled by the panel's own scale (>1 on mobile) so the pointer
    // tracks the Deliver button through the portrait magnification.
    return {
      x: this.x + (card.root.x + card.deliverButton.x) * this.scaleX,
      y: this.y + (card.root.y + card.deliverButton.y) * this.scaleY
    };
  }

  setDeliverAllowed(allowed: boolean): void {
    this.deliverAllowed = allowed;
  }

  /** Deliver a card's order, or shake its button if it isn't ready. */
  private onDeliverPressed(card: OrderCard): void {
    if (card.deliverable && this.deliverAllowed && card.order) {
      this.bus.emit('ui:deliver_requested', { orderId: card.order.id });
    } else if (!card.deliverable) {
      this.scene.tweens.add({
        targets: card.deliverButton,
        x: card.deliverButton.x + 10,
        duration: 45,
        yoyo: true,
        repeat: 3
      });
    }
  }

  open(tab: LedgerTab = 'orders'): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.activeTab = this.gameState.tutorialDone ? tab : 'orders';
    this.refresh();
    this.refreshTasks();
    this.layoutTabs();
    // A still-running close tween would re-hide the panel from its onComplete.
    this.scene.tweens.killTweensOf(this);
    this.setVisible(true);
    this.setAlpha(0);
    this.setScale(this.baseScale * 0.92);
    this.syncPortraitMasks(); // seat the clip circles before the first frame renders
    this.scene.tweens.add({ targets: this, alpha: 1, scale: this.baseScale, duration: 200, ease: 'Back.easeOut' });
    this.bus.emit('ui:ledger_toggled', { open: true });
  }

  requestClose(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scale: this.baseScale * 0.94,
      duration: 150,
      ease: 'Sine.easeIn',
      onComplete: () => this.setVisible(false)
    });
    this.bus.emit('ui:ledger_toggled', { open: false });
  }

  private switchTab(tab: LedgerTab): void {
    if (tab === this.activeTab || (tab === 'tasks' && !this.gameState.tutorialDone)) return;
    this.activeTab = tab;
    if (tab === 'tasks') this.refreshTasks();
    else this.refresh();
    this.layoutTabs();
    // A soft pop as the page lands.
    const page = tab === 'tasks' ? this.tasksPage : this.ordersPage;
    page.setAlpha(0);
    this.scene.tweens.add({ targets: page, alpha: 1, duration: 140, ease: 'Sine.easeOut' });
  }

  /** Position + restyle the header tabs, and flip page visibility. The Tasks
   *  tab only exists post-tutorial; before that the Orders lozenge sits alone,
   *  centred, exactly like the tutorial's original Ledger title. */
  private layoutTabs(): void {
    const twoTabs = this.gameState.tutorialDone;
    this.tasksTab.root.setVisible(twoTabs);
    this.ordersTab.root.x = twoTabs ? -270 : 0;
    this.tasksTab.root.x = 270;
    this.paintTab(this.ordersTab, this.activeTab === 'orders');
    this.paintTab(this.tasksTab, this.activeTab === 'tasks');
    this.ordersPage.setVisible(this.activeTab === 'orders');
    this.tasksPage.setVisible(this.activeTab === 'tasks');
  }

  /** A header tab. State is LIGHT, not hue: the selected tab is a lit lozenge,
   *  the unselected one the same shape sunk into the frame. */
  private paintTab(tab: TabHandle, active: boolean): void {
    tab.bg.clear();
    tab.bg.fillStyle(num(active ? INK.fieldLift : INK.fieldDeep), active ? 1 : 0.9);
    tab.bg.fillRoundedRect(-TAB_W / 2, -TAB_H / 2, TAB_W, TAB_H, TAB_H / 2);
    tab.bg.lineStyle(6, num(active ? INK.gold : INK.goldDeep), active ? 1 : 0.75);
    tab.bg.strokeRoundedRect(-TAB_W / 2, -TAB_H / 2, TAB_W, TAB_H, TAB_H / 2);
    tab.label.setColor(active ? INK.onField : INK.onFieldDim);
    tab.label.setAlpha(active ? 1 : 0.85);
    tab.root.setScale(active ? 1 : 0.94);
  }

  /**
   * Repaint the Orders page from OrderSystem.
   *
   * IT ONLY RUNS WHEN THE PAGE IS ON SCREEN, and that is not a micro-
   * optimisation — it is the difference between a playable phone and a slide
   * show. `refresh` is the most expensive method on this panel: `fitBlock`
   * steps the blurb's size down ONE UNIT AT A TIME from BLURB_PX toward
   * BLURB_MIN_PX, and in portrait that ladder is 78 -> 38, forty rungs. Every
   * rung is `Text.setFontSize` -> `TextStyle.update(true)` -> `MeasureText`
   * (which paints and scans a canvas) + `Text.updateText` (which re-runs the
   * word wrap, RESIZES the text canvas — 1200 x 719 at the top of the ladder,
   * where the paragraph is seven lines — fillTexts every line and re-uploads
   * the GL texture that backs it). Its callers
   * are the `order:progress` hose above, which fires once per active order on
   * every spawn/merge/produce/remove: two orders x forty rungs on a merge the
   * player made with this panel shut. Desktop never saw it because there the
   * ladder is empty (30px in a 212-unit band fits at the first try), which is
   * exactly why it survived review.
   *
   * The early return is safe because of a CONTRACT, not because a stale panel
   * is acceptable: the two places that put this page on screen — `open()` and
   * `switchTab('orders')` — both set `isOpen`/`activeTab` FIRST and then call
   * `refresh()`, so the page is always repainted on the way in, from live
   * OrderSystem state rather than from anything kept here. Nothing else reads
   * what this method writes: `card.order` is only consulted by a Deliver tap,
   * and Phaser will not hit-test a child of an invisible container. If a third
   * way to show the page is ever added, it repaints the same way or it shows
   * yesterday's board.
   *
   * (The Tasks page has always been guarded like this — see the subscriptions
   * in the constructor. This is the Orders page catching up.)
   */
  private refresh(): void {
    if (!this.isOpen || this.activeTab !== 'orders') return;
    const orders = this.orderSystem.activeOrders;
    this.emptyText.setVisible(orders.length === 0);
    this.blurb.setVisible(orders.length > 0);
    // AND THE LADDER IS ONLY WALKED WHEN THE WORDS CHANGE. A refresh while the
    // page IS open — a producer ticking over, a piece leaving the bag — asks
    // for the same paragraph it is already showing, and re-deriving a size we
    // already derived costs the whole forty rungs again: `setFontSize` back to
    // the preferred size is a real re-layout (Phaser only early-outs when the
    // size is UNCHANGED, and `fitBlock` has just shrunk it), and then every
    // rung down is another. Keyed on the raw string, because `fitBlock` may
    // have rewritten `blurb.text` into a truncated form and that form is not
    // what the next comparison is against.
    const blurb = orders[0] ? `”${orders[0].blurb}”` : '';
    if (blurb !== this.blurbSource) {
      this.blurbSource = blurb;
      // Back to the preferred size FIRST: `fitBlock` may have shrunk the line
      // for the order that was on the board a moment ago, and a size is not
      // something the next order should inherit.
      this.blurb.setFontSize(BLURB_PX);
      this.blurb.setText(blurb);
      this.fitBlock(this.blurb, BLURB_BUDGET, BLURB_MIN_PX);
    }

    // The Ledger belongs to whoever keeps it HERE: Selyna's board in the north
    // wears her name and her face, Eleanor's at home wears hers. Derived from
    // the orders data (OrderSystem.giverHere), never from a world-id table.
    const host = this.orderSystem.giverHere;
    this.ordersTab.label.setText(`${speakerName(host)}’s Orders`);
    this.emptyText.setText(
      `The brazier roars again!\n${speakerName(host)} will have new work for you soon.`
    );

    this.cards.forEach((card, i) => {
      const order = orders[i] ?? null;
      card.order = order;
      card.root.setVisible(order !== null);
      if (!order) {
        card.deliverable = false;
        return;
      }
      this.setMedallionGiver(card, order.giver ?? host);
      const requirement = order.requires[0];
      if (!requirement) return;
      const { have, deliverable } = this.orderSystem.progressFor(order);
      card.deliverable = deliverable;
      // The title, fitted into its band (see CARD_TITLE_*): preferred size back
      // first, then shrink-and-truncate, then seated so a wrapped title is
      // pushed DOWN off the medallion's gold rather than drawn through it.
      //
      // No memo here, unlike the blurb, and the difference is the ladder's
      // depth: CARD_TITLE_PX is NOT stepped (30 on both devices) and one line
      // of it is 37.5 of the band's 67.9, so every shipped title fits at the
      // first try and the loop never runs. With the size unchanged and the
      // string unchanged, `setFontSize` and `setText` both early-out inside
      // Phaser and the whole block costs two property reads. The blurb's
      // ladder is forty rungs deep only because its preferred size is stepped.
      card.title.setFontSize(CARD_TITLE_PX);
      card.title.setText(order.title);
      this.fitBlock(card.title, CARD_TITLE_BUDGET, CARD_TITLE_MIN_PX);
      card.title.y = seatInBand(
        card.title.height,
        CARD_TITLE_Y,
        CARD_TITLE_BAND_TOP + CARD_TITLE_AIR,
        CARD_TITLE_BAND_BOTTOM - CARD_TITLE_AIR
      );
      const slotKey = `item_${requirement.chain}_${requirement.tier}`;
      // Contain-fit into the requirement SLOT, never the item's board scale:
      // board scale is tuned to a tile footprint, and doubling it put a
      // Radiant Gem at 230 units on a 144-unit slot — over the card's title.
      card.slotIcon.setTexture(slotKey);
      card.slotIcon.setScale(
        SLOT_ICON_FIT / Math.max(card.slotIcon.width, card.slotIcon.height)
      );
      card.slotCount.setFontSize(CARD_COUNT_PX);
      card.slotCount.setText(`${have[0] ?? 0}/${requirement.count}`);
      this.fitLine(card.slotCount, CARD_COUNT_BUDGET_W, CARD_COUNT_MIN_PX);
      const parts: string[] = [];
      if (order.rewards.coins) parts.push(`${order.rewards.coins}`);
      if (order.rewards.xp) parts.push(`✦ ${order.rewards.xp} XP`);
      if (order.rewards.spawn) parts.push('🎁 ???');
      if (order.rewards.tease) parts.push(order.rewards.tease);
      card.rewardText.setFontSize(CARD_REWARD_PX);
      card.rewardText.setText(parts.join('   '));
      this.fitLine(card.rewardText, CARD_REWARD_BUDGET_W, CARD_REWARD_MIN_PX);
      // The Gold figure leads the line, so its coin hangs off the line's left
      // edge — measured after the fit, since the width moves with the rewards
      // AND with whatever size the fit settled on.
      const paysGold = !!order.rewards.coins;
      card.rewardCoin.setVisible(paysGold);
      if (paysGold) {
        const half = card.rewardText.width / 2;
        card.rewardCoin.setX(-half - CARD_REWARD_COIN_GAP);
        card.rewardText.setX(card.rewardCoin.displayWidth / 2 + 2);
      } else {
        card.rewardText.setX(0);
      }
      card.slotIcon.setAlpha(deliverable ? 1 : 0.75);
      card.deliverButton.setAlpha(deliverable ? 1 : 0.55);
    });
  }

  /** Repaint the checklist rows AND the tab's live done-counter. */
  private refreshTasks(): void {
    const rowTop = TASK_ROW_TOP;
    const rowGap = TASK_ROW_GAP;
    const barX = TASK_BAR_X;
    let doneCount = 0;
    this.taskSystem.tasks.forEach((task, i) => {
      const row = this.taskRows[i];
      if (!row) return;
      const y = rowTop + i * rowGap;
      const progress = this.taskSystem.progressFor(task);
      const done = progress >= task.target;
      if (done) doneCount += 1;
      const locked = !done && this.taskSystem.isLocked(task);
      row.barBg.setVisible(!locked);
      row.count.setVisible(!locked);
      row.hint.setVisible(locked);
      row.count.setText(`${progress} / ${task.target}`);
      row.check.setVisible(done);
      row.fill.clear();
      if (!locked) {
        row.fill.fillStyle(num(done ? INK.gain : INK.gold), 1);
        row.fill.fillRoundedRect(
          barX,
          y + 18,
          Math.max(12, (progress / task.target) * TASK_BAR_W),
          22,
          11
        );
      }
      row.label.setAlpha(done ? 0.62 : locked ? 0.5 : 1);
    });
    this.tasksTab.label.setText(`Keeper’s Tasks  ${doneCount}/${this.taskSystem.tasks.length}`);
  }
}
