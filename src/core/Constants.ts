/**
 * Every tunable in Emberkeep lives here or in src/data/*.json.
 * Systems and scenes must not contain magic numbers.
 */
import type { SpeakerId, TopUpSource } from './types';

/** Emberkeep palette (string form for Canvas2D, use num() for Phaser). */
export const PALETTE = {
  lava: '#E8503C',
  lavaShade: '#C73A2E',
  lavaHighlight: '#FF8A66',
  gold: '#F7A437',
  goldShade: '#D9821F',
  goldAccent: '#FFD84D',
  plum: '#4A3845',
  plumShade: '#3A2B38',
  plumHighlight: '#6A5468',
  teal: '#3FA8D9',
  tealDeep: '#2E7FA6',
  ash: '#8E8A93',
  ashShade: '#6E6A75',
  moss: '#7ECB4F',
  mossShade: '#5FA63D',
  cream: '#FFF6E8',
  textBrown: '#B5602F',
  white: '#FFFFFF',
  night: '#241B22'
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** '#RRGGBB' -> 0xRRGGBB for Phaser tint/fill APIs. */
export const num = (hex: string): number => parseInt(hex.slice(1), 16);

/**
 * Internal render resolution. The canvas renders at 2560x1600 and FIT-scales
 * to the window, so the game is crisp on retina/2x displays ("1440p feel").
 * RES is the multiplier applied to the texture painter; all world/UI
 * coordinates are already expressed in this hi-res space.
 */
export const RES = 2;
export const GAME_WIDTH = 2560;
export const GAME_HEIGHT = 1600;

/** True when the primary input is touch (phone/tablet). */
export const IS_MOBILE: boolean =
  typeof window !== 'undefined' &&
  (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);

/**
 * True on iOS/iPadOS Safari (incl. iPadOS masquerading as Mac + touch). WebKit
 * caps a tab's renderer-process memory FAR lower than Android Chrome, so the
 * heaviest GPU paths are trimmed here (skip the second live WebGL context, render
 * at a leaner backing) to stay under the "A problem repeatedly occurred" crash.
 */
export const IS_IOS: boolean =
  typeof window !== 'undefined' &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent)));

/**
 * Weak device (low RAM or few CPU cores) — a cheap Android or an old/GPU-less PC.
 * `deviceMemory` (GB, capped at 8; unset on Safari) and `hardwareConcurrency` are
 * the only coarse signals a browser exposes; either being low is enough to trip
 * the aggressive downgrade (leaner backing, fewer ambient particles) that keeps
 * the tab under its GPU-memory budget instead of crashing the page. iOS is always
 * treated as at-least this constrained. When neither signal is present we assume
 * capable (desktop/high-end) so we never needlessly degrade a strong machine.
 *
 * This is the SIZE axis — how much GPU memory the device can hold. `PowerGovernor`
 * is the RATE axis — how often we redraw. They are independent: a strong laptop on
 * battery wants the governor and not this; a cheap phone wants both.
 */
export const IS_LOW_END: boolean =
  IS_IOS ||
  (typeof navigator !== 'undefined' &&
    ((typeof (navigator as { deviceMemory?: number }).deviceMemory === 'number' &&
      (navigator as { deviceMemory?: number }).deviceMemory! <= 4) ||
      (typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 4)));

/**
 * HUD / popup magnification on mobile portrait. The UI is authored in the fixed
 * 2560-wide space; on a phone that space FIT-scales to ~15%, so gauges/buttons
 * render at half the size a thumb needs. Clusters multiply by this (anchored to
 * their screen corner) and popups fill the portrait width. `1` on desktop — the
 * landscape layout is untouched. See `panelMobileScale`.
 */
export const UI_SCALE: number = IS_MOBILE ? 1.5 : 1;

/**
 * The quest tracker reads bigger than the other clusters on a phone (owner's
 * call, 2026-08-27): it is the one instruction most players ever read, and at
 * the shared UI_SCALE its rows were the smallest live type on screen. One
 * factor over the whole cluster — text, piece icons and row pitch grow
 * together, and RecipeHelpPanel's peek seat multiplies by THIS, not UI_SCALE,
 * so the sheet keeps clearing the row it explains.
 *
 * BOTH LAYOUTS GREW 20% on 2026-08-28 (owner's call): 1.3 → 1.56 on a phone,
 * and desktop left 1 for the first time. The landscape number is the one with
 * a ceiling — the tracker magnifies DOWN-LEFT from its top-right anchor, so
 * its foot travels: `QUEST_TRACKER_BOTTOM` (292 local units) reaches y 546 at
 * 1.2 against the five-door column's 674.2 top, which `HudColumn.spec`
 * measures. Past ~1.6 the list would print across the Dragon Codex button.
 */
export const QUEST_TRACKER_SCALE: number = IS_MOBILE ? UI_SCALE * 1.56 : 1.2;

/**
 * Does Settings offer the Map Editor?
 *
 * OFF — hidden, not removed. The tool is the whole authoring pipeline for the
 * zone registry and it goes on being built; what it should not be is a green
 * button on a player's settings panel, one tap from a screen that can repaint
 * the world. Nothing else changes: the scene still builds the button and the
 * `editor:open` intent still exists, so turning this back on is one word.
 *
 * The way in while it is off is `?mapedit` on the URL — the same convention the
 * UI Builder already uses for `?uiedit` (see PreloadScene). Read at the settings
 * panel rather than here, because this module is imported by systems that run in
 * node unit tests, where there is no `window`.
 */
export const MAP_EDITOR_IN_SETTINGS = false;

/** Uniform scale so a centred popup FRAME of `frameWidth` fills ~94% of the
 *  portrait width. `1` on desktop. Capped so a small frame never balloons. */
export function panelMobileScale(frameWidth: number): number {
  if (!IS_MOBILE) return 1;
  return Math.min(2.2, (GAME_WIDTH * 0.94) / frameWidth);
}

/**
 * THE PORTRAIT TYPE STEP — why a phone needs its own number at all.
 *
 * The UI is authored in a fixed 2560-unit-wide space and FIT-scales, so a unit
 * is worth whatever the screen is wide. On a 1280px-wide desktop window a unit
 * is half a pixel and a 21-unit blurb lands at a readable 10.5px. On a phone
 * the SAME 2560 units span ~390 real pixels, so that blurb arrives at 3.8px —
 * not small, unreadable, and no amount of panel scaling fixes it because the
 * panel is already at 94% of the width.
 *
 * 2560/390 over 2560/1280 is 3.3; 2.6 is that ratio held back to where the
 * type still fits the plates it sits on. It is the same constant main's dark
 * Codex arrived at independently (its private `F()`), promoted here so every
 * screen steps by the same amount instead of each one guessing.
 *
 * Use it for TYPE. For a control the thumb has to hit, use `TAP_SCALE`.
 */
export const TYPE_STEP: number = IS_MOBILE ? 2.6 : 1;

/** Step a font size into the portrait space. `px(21)` is 21 on a desktop and
 *  55 on a phone — the same apparent size on both. */
export const px = (n: number): number => Math.round(n * TYPE_STEP);

/**
 * How much a TAP TARGET grows in portrait.
 *
 * Lower than the type step on purpose: type has to stay readable at any size,
 * a control only has to be reachable. 44 CSS px is the platform minimum for a
 * thumb, which on a 390px phone is 289 units — and the panels' ✕ disc is 96,
 * so 2.2 is the smallest honest multiplier that clears the bar (211 units of
 * hit box around a 148-unit disc). Bigger would start eating the plate corner
 * the disc was carefully seated inside.
 */
export const TAP_SCALE: number = IS_MOBILE ? 2.2 : 1;

/**
 * Like `panelMobileScale`, but bound by width AND height, whichever binds: a
 * phone gets a near-full-screen sheet, a squarer tablet gets the same sheet
 * held to its shorter height instead of spilling. `1` on desktop, where the
 * landscape frames keep their authored size. (Ported with the dark Codex —
 * its portrait tall frame is sized by both axes.)
 */
/**
 * THE SPEECH CARD OWNS THE BOTTOM OF A PHONE SCREEN.
 *
 * The mobile bubble is anchored bottom-right (CharacterBubble: card bottom 40
 * units off the floor, 1.65x scale, the portrait ring rising ~495 above the
 * floor; a four-line card tops out near 600). A tutorial beat can hold a panel
 * open WHILE the card speaks — the Codex walk, the Emporium's free Spark — and
 * a panel laid out over the full height parks its bottom controls (EVOLUTION,
 * the checkout row) exactly under the card. So on a phone this band is
 * reserved: height-fitted panels size and centre themselves in the space ABOVE
 * it, with equal air top and bottom.
 */
export const MOBILE_DIALOGUE_BAND = 640;

/** The vertical space a full-height mobile panel may use — the screen minus
 *  the speech card's band. The full height on desktop. */
export const panelSafeHeight = (): number =>
  IS_MOBILE ? LIVE_GAME_HEIGHT - MOBILE_DIALOGUE_BAND : LIVE_GAME_HEIGHT;

/** Where a height-fitted panel centres: the middle of the safe region, so the
 *  air above the sheet equals the air between the sheet and the speech band. */
export const panelSafeCenterY = (): number => panelSafeHeight() / 2;

export function panelFitScale(frameW: number, frameH: number): number {
  if (!IS_MOBILE) return 1;
  return Math.min(2.2, (LIVE_GAME_WIDTH * 0.94) / frameW, (panelSafeHeight() * 0.94) / frameH);
}

/**
 * The LIVE coordinate space, in game-space units.
 *
 * The space is AUTHORED at 2560×1600, but a window is rarely 16:10 and FIT just
 * letterboxes whatever does not match: a 16:9 desktop threw away 10% of the
 * screen to pillarbox bars and a 21:9 monitor a full third of it.
 *
 * So the SHORT axis is pinned to its design constant and the LONG axis GROWS to
 * meet the real aspect — a 16:9 window is 2844×1600, a 3:2 window 2560×1706,
 * and a 16:10 window is 2560×1600 exactly as before (which is why the e2e run,
 * authored at 16:10, is byte-identical). Growing rather than shrinking means the
 * reclaimed space shows MORE of the world instead of scaling the art down, and
 * nothing has to be re-tuned for it: the board camera already refuses to look
 * past the authored backdrop (`minZoom` is the backdrop-fit), so a wider
 * viewport simply holds a slightly closer frame.
 *
 * Mobile is unchanged. There the game is PORTRAIT: GAME_WIDTH spans the phone's
 * SHORT side whichever way it is held, the space grows taller to match, and 2.4
 * caps a near-square tablet (or an extreme aspect) from a runaway backing.
 *
 * Both axes are read at BOOT. A desktop window resized afterwards re-FITs (and
 * re-letterboxes) until reload — the scenes lay out once.
 */
/** The pure half of the rule above — exported so the invariants (short axis
 *  pinned, 16:10 identity, clamp) are unit-testable without a DOM. */
export function liveSpaceFor(
  winW: number,
  winH: number,
  isMobile: boolean
): { w: number; h: number } {
  if (isMobile) {
    const shortSide = Math.min(winW, winH); // portrait width
    const longSide = Math.max(winW, winH); // portrait height
    return { w: GAME_WIDTH, h: Math.round(GAME_WIDTH * Math.min(2.4, longSide / shortSide)) };
  }
  // Clamped the same 2.4 either way, so one absurd axis cannot inflate the
  // backing; past the clamp the leftover simply letterboxes as it always did.
  const aspect = Math.min(2.4, Math.max(1 / 2.4, winW / winH));
  return {
    w: Math.round(Math.max(GAME_WIDTH, GAME_HEIGHT * aspect)),
    h: Math.round(Math.max(GAME_HEIGHT, GAME_WIDTH / aspect))
  };
}

const LIVE_SPACE: { w: number; h: number } =
  typeof window === 'undefined'
    ? { w: GAME_WIDTH, h: GAME_HEIGHT }
    : liveSpaceFor(window.innerWidth, window.innerHeight, IS_MOBILE);

/** Viewport WIDTH in game-space units. Anchor every screen-space x to this —
 *  `GAME_WIDTH` is the authoring constant and is only correct at 16:10. */
export const LIVE_GAME_WIDTH: number = LIVE_SPACE.w;
/** Viewport HEIGHT in game-space units. See LIVE_GAME_WIDTH. */
export const LIVE_GAME_HEIGHT: number = LIVE_SPACE.h;

/**
 * The bottom-right button column — Ledger, Bag, Cookbook, Store, Dragon Codex,
 * bottom-up (slots 0..4).
 *
 * It lives here because it is built in two files (Hud owns the Ledger, the Bag
 * and the Store, UIScene the Cookbook) and so drifts apart when each picks its
 * own offsets: the Bag was slotted in between the other two at a spacing that
 * put its plate straight on top of the Cookbook's.
 *
 * Slots 0–1 are live from the first frame; the Cookbook and the Store surface
 * when the tutorial hands the game over, so the column grows upward and never
 * reflows the buttons already under the player's thumb.
 *
 * `ui_btn_round` is painted 68 logical units wide around a disc of radius 29,
 * so at the column's 1.5× plate scale the VISIBLE disc is ~174 units across and
 * anything closer than that overlaps its neighbour. UI_SCALE magnifies each
 * button about its own centre, so the pitch scales with it.
 */
/**
 * THE TOP-RIGHT CLUSTER — the quest tracker, and the status readout that hangs
 * under it.
 *
 * Seated here rather than inside their own files because the HUD COLUMN has to
 * clear them, and a clearance nothing can compute is a collision waiting to
 * happen. It already happened once: a fifth column button landed inside the
 * readout and printed a dragon's name across the Dragon Codex plate. Both
 * cluster and column now derive from these, so `HudColumn.spec` can do the
 * arithmetic in node instead of the player doing it on screen.
 *
 * The values are LOCAL units where noted — the cluster is right-anchored and
 * scaled by UI_SCALE about that anchor, so its screen height is these × scale.
 */
export const QUEST_TRACKER_TOP_Y: number = IS_MOBILE ? 300 : 196;
export const QUEST_TRACKER_RIGHT: number = IS_MOBILE ? 64 : 56;
/** The main line's counter rides BESIDE its title, so the sub-row list starts
 *  here rather than a full title-height down. */
export const QUEST_LIST_TOP_Y = 62;
/** Sub-row pitch, and how many are on screen before the list scrolls. */
export const QUEST_ROW_H = 68; // follows the tracker's 32px sub-row type
/**
 * HOW MUCH OF THE LADDER YOU CAN SEE AT ONCE — and why the two layouts differ
 * by a factor of two.
 *
 * Three rows is a keyhole. A quest with five subquests showed three of them and
 * a half-faded sliver, so the one HUD that says what to do next said a third of
 * it, and the player had to drag a list they had no reason to know was a list.
 *
 * PORTRAIT HAS THE ROOM AND ALWAYS DID. Its live space is ~5540 units tall
 * against the landscape 1600, and the measured slack between the status
 * readout's foot and the top seat of the HUD column is 3771 units — fifty-five
 * rows' worth. Six is simply as many as a quest ever has.
 *
 * LANDSCAPE HAS 14.2 UNITS, and a row costs 68. That is not a number anyone
 * chose; it is what is left after the settings gear (bottom edge ~y 172) sets
 * the tracker's ceiling at 196 and the five-door column sets its floor at
 * 674.2. A fourth row overruns the Dragon Codex button and prints a subquest
 * across it — the exact collision `HudColumn.spec` exists to catch.
 * Making it fit means moving the gear or re-cutting the column, which is a
 * different job than this one; until then the landscape list scrolls, and the
 * peek row below is what says so.
 */
export const QUEST_VISIBLE_ROWS: number = IS_MOBILE ? 6 : 3;
/** A sliver of the FOURTH row stays inside the viewport, half-faded — the only
 *  scroll affordance a background-free cluster gets. */
export const QUEST_PEEK_H = 26;
export const QUEST_VIEW_H = QUEST_ROW_H * QUEST_VISIBLE_ROWS + QUEST_PEEK_H;
/** The tracker's own height in LOCAL units — where the list's viewport ends,
 *  and therefore the first free y under the whole tracker. */
export const QUEST_TRACKER_BOTTOM = QUEST_LIST_TOP_Y + QUEST_VIEW_H;
/**
 * Air between the tracker's last row and the name line under it.
 *
 * 44 → 18 when the caption came down on the Dragon Codex plate. The gap was
 * never the culprit — the two numbers below were — but once they told the truth
 * there was no longer room for 44, and this is the one dial that lifts the
 * READOUT rather than moving a button. What it is really air between is the
 * VIEWPORT's floor and the name: with fewer than four subquests the list does
 * not reach that floor and the visible gap is much larger.
 */
export const STATUS_READOUT_GAP = 18;

/* THE READOUT'S OWN ROWS — declared here, drawn by StatusPanel.
 *
 * They lived in StatusPanel and STATUS_READOUT_H was a hand-typed summary of
 * them. So when the heart row moved down 14 units to stop the name's descenders
 * touching the meter, the summary stayed at 140 and the guard below went to
 * zero margin without failing — and the caption came down on the Codex plate,
 * which is the EXACT collision this constant exists to prevent. A summary that
 * can disagree with what it summarises is not a guard, so the rows are the
 * declaration now and the height is derived from them. */
export const STATUS_NAME_Y = 0;
export const STATUS_HEARTS_Y = 72;
export const STATUS_LINE_Y = 110;
/**
 * What the caption actually OCCUPIES, not what its font is called.
 *
 * The old height took the caption to be 30 units tall because `TYPE.label` is
 * 30 — but a 30px bold face renders 38 units of ink, and this readout wears a
 * 5-unit stroke for legibility over bright cloud. Measured on the live HUD at
 * 2560×1600: box top 642, ink bottom 680. 44 is that, rounded up past the
 * stroke.
 */
export const STATUS_LINE_INK = 44;
/** The readout's own height in LOCAL units — derived, never retyped. */
export const STATUS_READOUT_H = STATUS_LINE_Y + STATUS_LINE_INK;
/** Where the readout ENDS on screen — the ceiling the HUD column may not cross. */
export const STATUS_READOUT_BOTTOM_Y: number =
  QUEST_TRACKER_TOP_Y + (QUEST_TRACKER_BOTTOM + STATUS_READOUT_GAP + STATUS_READOUT_H) * UI_SCALE;

export const HUD_COLUMN_X: number = LIVE_GAME_WIDTH - (IS_MOBILE ? 190 : 156);

/**
 * FIVE DOORS, AND A CEILING THEY MAY NOT CROSS.
 *
 * The column grew a fifth seat when the Dragon Codex arrived, and a fifth seat
 * at the old 200-unit pitch landed the top button INSIDE the status readout —
 * the who-am-I-looking-at line that hangs under the quest tracker and reaches
 * to y 660 on desktop (StatusPanel: seated at QUEST_TRACKER_TOP_Y +
 * QUEST_TRACKER_BOTTOM + STATUS_READOUT_GAP, and STATUS_READOUT_H tall). A
 * dragon's name printed across the Codex button is what that looks like — and
 * it came back in 2026-08 when both of those numbers turned out to be
 * under-declared, which is why they are derived now rather than typed.
 *
 * So the column was re-fitted rather than extended. Two dials moved together:
 *
 *   • the base seat drops, which is nearly free — the bottom-right corner holds
 *     nothing else, and the plate's 89.8-unit reach still clears the canvas
 *     edge at 1597.8 of 1600. There is no third step here: that is the floor.
 *   • the pitch tightens (200 → 186), which is the most that can come off: the
 *     painted plate is 179.5 units, so anything under that has them touching.
 *
 * Which puts the top seat at 1508 − 4×186 = 764, its plate starting at 674.2 —
 * clear of the readout (660) with 14.2 units of air, and 28 units between the
 * caption's ink and the plate's. `HudColumn.spec` does that arithmetic so a
 * sixth door, or a taller readout, fails in node.
 *
 * `ui_btn_round` is painted 68 logical units wide around a disc of radius 29,
 * so at the column's 1.5× plate scale the VISIBLE disc is ~174 units across.
 * UI_SCALE magnifies each button about its own centre, so both dials scale
 * with it.
 */
export const HUD_COLUMN_SLOTS = 5;
/**
 * The plate scale every door in the column wears.
 *
 * 1.5 put a 174-unit disc on a 186-unit pitch — twelve units of board between
 * two plates, which at arm's length is no gap at all: the five read as one
 * welded strip. The pitch cannot grow (the top seat is already close to the
 * status readout), so the PLATE is what gives: 1.32 draws a 153-unit disc and
 * leaves 33 units of air between neighbours, and the icons scale with it.
 */
export const HUD_COLUMN_PLATE = 1.32;
/**
 * WHAT THE BUTTON ACTUALLY OCCUPIES — the painted TEXTURE, not the disc in it.
 *
 * `ui_btn_round` is painted 68×68 LOGICAL units (TextureFactory paints ×RES, so
 * a 136-unit texture) around a disc of radius 29. This used to be 116 — the
 * disc alone — which made every clearance computed from it 13.2 units
 * optimistic per seat, and `HudColumn.spec` green while the Codex plate and the
 * status caption visibly overlapped on screen. What Phaser lays out and bounds
 * is the texture, so the texture is what the arithmetic gets.
 */
export const HUD_COLUMN_DISC: number = 136 * HUD_COLUMN_PLATE * UI_SCALE;
/** What an icon is fitted to on one of those plates. Icons arrive at two
 *  resolutions (painted at 44 logical units, file-backed at whatever the PNG
 *  is), so both are fitted to this rather than multiplied by a shared factor. */
export const HUD_COLUMN_ICON: number = 88 * HUD_COLUMN_PLATE * 0.95;
export const HUD_COLUMN_PITCH: number = 186 * UI_SCALE;
/**
 * The column's bottom seat, measured up from the canvas floor.
 *
 * Moved 14 units closer to it when the quest tracker's type stepped up: a
 * taller tracker pushes the status readout down, and the readout is the ceiling
 * this column may not cross (`STATUS_READOUT_BOTTOM_Y`). The spare room was at
 * the BOTTOM — 33 units of it — so the whole column takes a step down rather
 * than the tracker giving back the legibility it just gained. HudColumn.spec
 * holds both ends: the top seat still clears the readout, the bottom seat is
 * still inside the canvas.
 *
 * 106 → 92 for the same reason a second time, once `HUD_COLUMN_DISC` and
 * `STATUS_READOUT_H` stopped under-declaring. Between them they had hidden 21
 * units of overlap behind 1.44 units of declared air, and no single dial could
 * absorb that: the readout gave 26 (`STATUS_READOUT_GAP` 44 → 18) and the
 * column takes the last 14 out of the canvas floor it was never using. The
 * pitch could not give any — 186 is already inside 6.5 units of the plate.
 */
export const HUD_COLUMN_BASE_Y: number = LIVE_GAME_HEIGHT - (IS_MOBILE ? 186 : 92);
export const hudColumnY = (slot: number): number =>
  HUD_COLUMN_BASE_Y - slot * HUD_COLUMN_PITCH;

/** Isometric 2:1 projection. */
export const TILE_W = 256;
export const TILE_H = 128;
export const BOARD_COLS = 8;
export const BOARD_ROWS = 8;
/** World position of the centre of tile (0,0). */
export const BOARD_ORIGIN_X = GAME_WIDTH / 2;
export const BOARD_ORIGIN_Y = 316;

/** Render depth bands (within BoardScene). */
export const DEPTHS = {
  sky: 0,
  cliffs: 4,
  // Procedural SKY effects (the Borealis aurora). The authored backdrop is
  // drawn at `tiles - 1` and covers everything the camera can reach, so a sky
  // shader below it would never be seen: this sits just above the painting and
  // just below the floor, where the isles and everything standing on them
  // still draw over it.
  skyFx: 9.5,
  tiles: 10,
  tileHighlight: 40,
  itemBase: 100, // + screenY
  fogBase: 1300, // + screenY — shared by board fog AND the world cloud field
  // WEATHER falls in front of the whole board — snow passes between the player
  // and the isles — so it clears fogBase + screenY (~6400 at the widest board),
  // but stays under the always-on-top bands: a flake must never fall in front
  // of the piece in the player's hand.
  weather: 20000,
  /**
   * PERSISTENT READOUTS floating over a piece — a generator's countdown, a
   * dragon's 💤 rest pill. Above the board and above the weather, because a
   * number the player is waiting on must not be read through falling snow; and
   * BELOW `dragged`, because it must not be read over the thing the player just
   * opened.
   *
   * They used to sit on `flash`, the top band of all, which put a countdown in
   * front of the skip offer pinned over the very piece it belongs to — the ⚡
   * row was behind the seconds ticking down on it. A badge is state, not a
   * flash: `flash` is for the glows and the floating "+12" that live for half a
   * second and are gone before anything can be hidden by them.
   */
  badge: 30000,
  // The authored 51×24 board pushes screenY (and so itemBase+y) up to ~5100,
  // so the always-on-top bands sit far above that.
  dragged: 50000,
  particles: 52000,
  flash: 54000
} as const;

/** When a dragon's passive gift has nowhere to land, retry this soon (ms). */
export const GENERATOR_PASSIVE_RETRY_MS = 8000;

/** Most GOLD a skip can cost — paid when the timer has just started. Skips are
 *  the demo's PREMIUM gold sink: a full skip should feel like a real spend
 *  (roughly one order reward / four banked House coins), not pocket change —
 *  the price still melts away as the timer drains, so patience is always the
 *  free alternative. (Was 6 — skipping cost barely more than the coin the
 *  House pays out, an almost-free loop.) */
export const GENERATOR_SKIP_MAX_ENERGY = 20;

/** Warmth skip premium over the Gold price. Gold is the sink-starved plentiful
 *  currency, so it is the CHEAP way to skip; Warmth is the session meter and
 *  must never be the discount option (it was 0.55× — an inverted incentive). */
export const SKIP_WARMTH_MULTIPLIER = 1.5;

/**
 * Skip a generator's remaining wait. Two ways: GOLD (the default, cheaper) or
 * WARMTH (premium). Both are EXPENSIVE near the start and CHEAPEN as the timer
 * runs down (cost ∝ fraction remaining). Always ≥ 1 while anything remains.
 */
export function skipEnergyCost(
  remainingMs: number,
  totalMs: number,
  maxGold: number = GENERATOR_SKIP_MAX_ENERGY
): number {
  if (remainingMs <= 0) return 0;
  if (totalMs <= 0) return 1;
  const frac = Math.min(1, Math.max(0, remainingMs / totalMs));
  return Math.min(maxGold, Math.max(1, Math.ceil(maxGold * frac)));
}
/** Warmth (energy) price of a skip — dearer than the Gold price (never let the
 *  session meter be the discount skip). Scales with the SAME per-generator
 *  `maxGold`, so a dearer skip can't be dodged by switching currency. */
export function skipWarmthCost(
  remainingMs: number,
  totalMs: number,
  maxGold: number = GENERATOR_SKIP_MAX_ENERGY
): number {
  const gold = skipEnergyCost(remainingMs, totalMs, maxGold);
  return gold <= 0 ? 0 : Math.max(1, Math.round(gold * SKIP_WARMTH_MULTIPLIER));
}

/**
 * Spring-bounce timing for scenery (world-builder decor + tree tiles). The Back
 * ease overshoots like a lazy spring; a long rest between hops keeps it calm.
 * Trees animate 15% FASTER (durations ÷ 1.15) on request.
 */
export const DECOR_BOUNCE = { riseMs: 820, hold: 90, restMs: 1700, rise: 18 } as const;
export const TREE_BOUNCE_SPEEDUP = 1.15;
/** Tile-art names (in tilesByCell) that should spring-bounce like decor. */
export const ANIMATED_TILE_NAMES = ['tree-1', 'tree-2', 'tree-3', 'tree-4', 'sapin'];

/**
 * On-board render scale for file-based decor, keyed by decor chain. Placeholder
 * decor (nest/brazier) is painted at tile size, but real-art files can be huge
 * (the baked dragon is 1054px ≈ 4 tiles), so they need fitting. ~0.42 lands the
 * guardian dragon at ~1.7 tiles wide. Anything absent renders at scale 1.
 */
export const DECOR_SCALE: Record<string, number> = {
  dragon: 0.42,
  // Landmark trees read too tall in the higher zones — halve them (−50%).
  tree_2: 0.5,
  // The purchasable prop sets (store.json). Each is drawn standing on its own
  // small plinth, so the art IS the tile footprint — these land the plinth at
  // ~250 units, a hair under one tile (TILE_W 256), which is what stops two
  // neighbouring props from visually butting together.
  ash_urn: 0.6,
  watch_bell: 0.6,
  rekindled_step: 0.61,
  chain_anchor: 0.61,
  ice_lantern: 0.6,
  frozen_spill: 0.62,
  rune_pad: 0.64,
  drift_cairn: 0.62,
  // The LANDMARKS are a different class of prop and are scaled by a different
  // rule. An ornament is scaled so its plinth lands just under one tile, which
  // is what keeps a shelf of them from butting together — but doing that to a
  // monument makes a ruined gatehouse the size of an urn. These are scaled so
  // the FOOTPRINT still fits its tile while the thing standing on it rises well
  // above one: a whelp (ITEM_SCALE ember_dragon_3 ≈ 221 units tall) should read
  // as small beside every one of them, which is the entire point of buying one.
  keeper_statue: 0.72, // 392x683 -> 282 tall, on a ~200-wide base
  broken_arch: 0.4, // 725x900 — the widest of them; the base sets the cap
  ember_beacon: 0.62, // 461x709 -> 440 tall, the tallest silhouette
  elder_bones: 0.34, // 900x665 — a low, WIDE mound; width is the constraint
  tethered_isle: 0.44, // 458x898 — floats, so its mooring block is the footprint
  /**
   * SELYNA'S POT, TRIMMED BY 65% — an authored call, not a correction.
   *
   * The editor→game size conversion is exact and stays that way: the pot he
   * placed measures what he drew it as, and build-zones hands the renderer the
   * calibration that reproduces exactly that against the painting. But exact is
   * not the same as right. At full size it stands 1.55 tiles wide, half again as
   * wide as the cell it is meant to sit on and wider than the whelps that walk
   * past it, so Runevault's one interactive fixture read as scenery the plateau
   * was built around.
   *
   * Raise it here rather than in the editor — the editor's number is WHERE and
   * HOW BIG on the PAINTING, which is the frame he places in; this is what the
   * board makes of it, which is the frame the dragons are in.
   *
   * THE SIZE IS A PRODUCT, and this is only one of its two halves: the other is
   * the calibration build-zones derives from the editor's own scale. The pot
   * stands ~368 world units today — nearly a tile and a half, feet on the
   * bullseye of the rune circle, which is the size he settled on with it in
   * front of him. Size changes go in the EDITOR, not here: the plate was redrawn
   * (1050px → 822px) and the editor scale moved with it, because the drawing
   * changing is not a reason for the pot to change size. `Zones.spec` measures
   * the PRODUCT against the plate on disk, so touching either half alone fails
   * there rather than on his screen.
   */
  pink_cauldron: 0.35
};

/**
 * On-board render scale for file-based ITEM art, keyed by `<chain>_<tier>`
 * (preferred) or bare `<chain>`. Absent → 1. Lets a single PNG read bigger
 * without re-exporting art (e.g. the red dragon egg looks small at native size).
 */
export const ITEM_SCALE: Record<string, number> = {
  // reward/egg.png (396×501) and reward/ruby.png (474×382) are ~2× the old
  // placeholder art — scale down so a gem reads ~1 tile wide (SVG-sized).
  // Egg + ruby reduced 70% on request (small speckled egg / small ruby shard).
  ember_dragon_1: 0.13, // Dragon Ruby — reduced ~28% on request (0.18 → 0.13)
  ember_dragon_2: 0.064, // Red Egg (red-egg.png 1162×1437) — −20% again on request (0.08 → 0.064)
  ember_dragon_3: 0.21, // Red Dragon: real baked rig art (1054px) at the live rig's on-board size
  ember_dragon_4: 0.45, // Adult Red Dragon: baked adult rig (836px) — +50% on request (0.3 → 0.45); must read clearly bigger than the whelp
  // Flame Gems (chains/flame_gem_{1,2,3}: 320×300, 400×380, 480×470). Scales are
  // set so a Gem Shard reads at ~61px — the same on-board size as a Dragon Ruby,
  // its sibling collectible — and the tier ramp stays legible above it. (The old
  // 0.12 was tuned for the 518px generic `diamond.webp` this chain used to
  // borrow; keeping it would have shrunk the shard by nearly 40%.)
  flame_gem_1: 0.19,
  flame_gem_2: 0.21,
  // Radiant Gem: 462px bbox × 0.195 ≈ 90 units — the same width class as its
  // tier-3 peers (Crystal Ball 90, Preserve 96, Dew Vial 86). At the old 0.24
  // it was 111 wide AND 110 tall, and a square silhouette at that width reads
  // bulkier than the taller-than-wide pieces beside it.
  flame_gem_3: 0.195,
  // Timber loop art. The chain gained a milling step — Cut Wood → Plank Set →
  // House → Manor — so the House and the Manor each moved DOWN one tier and
  // keep their tuned sizes under their new keys. Tiers 1–2 are new art cut from
  // assets/raw/merge-chains/lumber_t1_t2-seedream-pro.png; every scale here is
  // `target / longest side of the alpha bbox`, and the two new pieces sit on
  // the 74 → 100 step so the House at 274 still reads as the payoff.
  lumber_1: 0.187, // Cut Wood, 395×337 → 74 units (the old log's exact size)
  lumber_2: 0.217, // Plank Set, 460×454 → 100 units
  lumber_3: 0.72, // the House — reduced 20% on request (0.9 → 0.72)
  lumber_4: 0.82, // the Manor (manor.png 430×450) — a touch bigger than the House
  // Curled sleep paintings (their own pose, their own resolution). Each scale
  // reproduces the on-board width of the LIVE RIG the painting stands in for,
  // so the dragon that lies down is the same animal that was standing there.
  //
  // Derive it from the rig, never from a tile: the rig's own art is the baked
  // sheet (`item_ember_dragon_*`, which IS the rig at native resolution), and it
  // renders at `DRAGON_ANIM.whelpScale × DRAGON_RIG_SCALE[chain(:tier)]`.
  //   whelp  776px bbox × (0.46 × 0.448) = 160 units → 160 / 1193 = 0.134
  //   adult  809px bbox × (0.46 × 0.93)  = 346 units → 346 / 1602 = 0.216
  // These were 0.256 / 0.262, from a first pass that read the 666 in
  // `addGroundShadow(…, 666 * scale, …)` as the rig's width and dropped
  // DRAGON_RIG_SCALE — which put the sleeping whelp at 306 units, nearly twice
  // the dragon it replaced. 666 is a SHADOW width. The rig art is 776/809.
  sleep_ember_dragon_3: 0.134, // curled whelp, alpha bbox 1193 → 160 units
  sleep_ember_dragon_4: 0.216, // curled adult, 1602 → 346 units
  bigtree_1: 0.17, // the level-2 wood tree — reduced again on request (0.22 → 0.17)
  // The Fir loop. Retuned on playtest: the three steps must read as SEED →
  // SAPLING → LANDMARK at a glance, and at 66/88/140 the grain out-bulked a
  // berry while the trees under-read. Now 43 → 120 → 181 units — the grain is
  // pocket-sized, the Small Fir is a real sapling, and the Fir Tree reads as
  // the landmark it is (the only tree Chapter One has).
  firgrain_1: 0.12, // Fir Grain, alpha bbox 291×360 → 43 units
  firgrain_2: 0.158, // Small Fir Tree, 617×758 → 120 units
  firgrain_3: 0.22, // Fir Tree — shares bigtree.webp (823px → 181 units)
  chest_1: 0.19, // a treasure chest (chest.png) — reduced again on request (0.24 → 0.19)
  // The Emberberry plant, redrawn so its fruit IS the shipped Emberberry (cut
  // from assets/raw/merge-chains/emberberry_plant-seedream-pro.png). Each scale
  // reproduces the previous art's on-board size exactly, so nothing about the
  // board's read changes — only the painting.
  strawberry_1: 0.233, // sprout, 323×331 → 77 units
  strawberry_2: 0.217, // bush, 534×488 → 116 units
  strawberry_3: 0.252, // the ripe plant, 620×618 → 156 units; t3 reads biggest
  // Crystal landmark (803×902), diamond reward (518×387), gold coin (432×357).
  crystal_1: 0.4, // ~1.3 tiles
  // The Ash Moss farm (emberbark.png 340×641) — a STANDING silver reliquary
  // vase, not the burned stump it used to be. The isle was a field of magic
  // grass the dragons rested in and ate; it burned, and what stands here is the
  // last of it, in a vessel somebody thought was worth the silver.
  //
  // 102 units on its LONGEST axis, which is now its height rather than its
  // width — halved (from main, b4ff20e) from the 205 the upright vase first
  // shipped at, so the farm reads as a vessel standing on its tile rather than
  // a landmark filling it. The anchor is unchanged, so its foot stays on the
  // same ground contact and only the size moves. Its anchor (anchors.json)
  // moved 0.66 → 0.94 with the shape: 0.66 was eyeballed for a low wide stump
  // whose mass sat well above its alpha bottom, and a vase contacts the ground
  // at its own foot. Re-derived the same way and for the same reason — an
  // isometric object's visual ground contact is where its mass meets the
  // shadow's CENTRE, not where its alpha ends, so the foot's base ellipse is
  // centred on the tile diamond. When a landmark floats, composite
  // art-over-shadow and EYEBALL it; deriving this from the bbox has failed
  // three times now.
  emberbark_1: 0.16,
  emerald_1: 0.144, // Emerald gem (emerald.png 467×392) — reduced 20% again on request (0.18 → 0.144)
  emerald_2: 0.064, // Green Egg (green-egg.png 1147×1438) — −20% again on request (0.08 → 0.064)
  emerald_3: 0.21, // Green Dragon: baked rig art (1054px), same treatment as the red
  emerald_4: 0.45, // Adult Emerald Dragon: baked adult rig (836px) — same treatment as the adult red
  golden_egg_1: 0.10, // Golden Egg (golden-egg.png 1176×1451) — same scale as red/green egg
  ashdrake_1: 0.064, // Ashdrake Egg (ashdrake-egg.png 1160×1440) — same scale as red/green egg
  ashdrake_2: 0.21, // young ashdrake: static art (1054px) at the board dragons' size
  rimewyrm_1: 0.064, // Rimewyrm Egg (rimewyrm-egg.png 1160×1440) — same scale as red/green egg
  rimewyrm_2: 0.21, // young rimewyrm: static art (1054px) at the board dragons' size
  // The store breeds as their OWN chains (egg → baby → adult). Tiers 2–3 reuse
  // the baked skin art, which bake-dragon-skin.py fitted onto the ember rig's
  // canvases — so they wear ember's own scales, and the clip overlays (aligned
  // at those same board scales) land exactly on the art they replace.
  frost_1: 0.064, // Frost Egg (frost-egg.png 1109×1440)
  frost_2: 0.21, // Frost Dragon: skin bake on the whelp canvas (1054px)
  frost_3: 0.45, // Adult Frost Dragon: skin bake on the adult canvas (836px)
  storm_1: 0.064, // Storm Egg (storm-egg.png 1127×1440)
  storm_2: 0.21, // Storm Dragon: skin bake on the whelp canvas (1054px)
  storm_3: 0.45, // Adult Storm Dragon: skin bake on the adult canvas (836px)
  coin_1: 0.12, // SMALLER than an egg, per spec
  coin_2: 0.15, // Gold Pouch — reduced 25% on request (0.20 → 0.15); still bigger than the coin (0.12)
  // ---- merge-chains.md roster (art registered in assets.json) ----
  // These shipped with no entry here, so they drew at scale 1 and a Cracked
  // Stone came out ~260px on the board — four times a Gem Shard. Every scale
  // below is `target / longest side of the art's ALPHA BBOX`, tiered
  // 66 / 88 / 112 units, which is where the tuned chains already sit (a Gem
  // Shard is 59, a log 74, an Emberberry Sprout 65). Canvas size is not the
  // measure: item_strawberry_1.png is a 240px canvas holding a 100px sprout.
  firepine_1: 0.26,
  firepine_2: 0.26,
  firepine_3: 0.14, // shares bigtree.webp with the landmark bigtree_1 (0.17)
  cinder_vein_1: 0.25,
  cinder_vein_2: 0.27,
  cinder_vein_3: 0.12, // shares crystal.webp with the landmark crystal_1 (0.4)
  dew_basin_1: 0.25,
  dew_basin_2: 0.26,
  dew_basin_3: 0.30,
  emberberry_1: 0.21,
  emberberry_2: 0.17,
  emberberry_3: 0.19,
  resin_1: 0.12,
  resin_2: 0.12,
  resin_3: 0.22,
  ashmoss_1: 0.24,
  ashmoss_2: 0.27,
  ashmoss_3: 0.24,
  // Stormcap and Nightbloom sit on the food ladder every sibling chain uses —
  // ~66 / 88 / 112 units on the longest side, so a tier reads at the same size
  // whichever chain it came from. Each scale is `target / longest side`.
  stormcap_1: 0.236, // Storm Cap, 263×280
  stormcap_2: 0.222, // Cap Cluster, 371×396
  stormcap_3: 0.245, // Charged Cap, 458×454
  nightbloom_1: 0.21, // Night Bud, 235×314 — the tall one, matched on height
  nightbloom_2: 0.263, // Night Bloom, 335×304
  nightbloom_3: 0.224, // Cooling Wreath, 501×426
  // The five Borealis farms. Same 66 → 88 ladder as every other chain at tiers
  // 1–2, but their tier 3 is a WORKING FIXTURE — a standing stone, a cask, a
  // lamp post, a cairn, an instrument on its block — so it goes to 118 rather
  // than 112: it has to read as something standing on the land, not as the
  // biggest of three collectibles.
  //
  // One number for all fifteen, because the cut step now RESAMPLES each cell to
  // exactly six times its on-board size (gen-borealis-chains.py, `TARGET * 6`)
  // instead of leaving whatever the sheet happened to return. The scale is
  // therefore 1/6 by construction, and a re-cut can never silently resize a
  // piece on the board. Older chains above still carry per-piece values because
  // their art was cut before that rule existed.
  runestone_1: 0.1667, // Rune Shard
  runestone_2: 0.1667, // Carved Stone
  runestone_3: 0.1667, // Runestone
  emberdram_1: 0.1667, // Dram Vial
  emberdram_2: 0.1667, // Cordial Flask
  emberdram_3: 0.1667, // Cordial Cask
  hearthlamp_1: 0.1667, // Oil Lamp
  hearthlamp_2: 0.1667, // Storm Lantern
  hearthlamp_3: 0.1667, // Hearthlamp
  manastone_1: 0.1667, // Mana Pebble
  manastone_2: 0.1667, // Mana Nodule
  manastone_3: 0.1667, // Manastone Cairn
  wayfinder_1: 0.1667, // Lodestone
  wayfinder_2: 0.1667, // Boxed Needle
  wayfinder_3: 0.1667, // The Wayfinder
  quartz_1: 0.20,
  quartz_2: 0.19,
  quartz_3: 0.21,
  moonwater_1: 0.16,
  moonwater_2: 0.20,
  moonwater_3: 0.20,
  nest_1: 0.33, // a Cold Nest is furniture a dragon sits in, not a merge piece
  // ---- The north's FIVE FARMS (docs/merge-chains.md §2.4.1c) ----
  // Every piece is authored at 6x its on-board size, so the scale is 1/6 flat
  // and the LADDER lives in the art instead: `gen-borealis-farms.py` cuts a
  // product to 66 / 88 / 118 units and a fixture to 66 / 92 / 170, because the
  // top of a fixture chain is a machine you build a farm around and the top of
  // a product chain is a thing you carry.
  glasskiln_1: 0.1667, // Fire Brick
  glasskiln_2: 0.1667, // Kiln Grate
  glasskiln_3: 0.1667, // The Glass Kiln
  seaglass_1: 0.1667, // Glass Float
  seaglass_2: 0.1667, // Glass Buoy
  seaglass_3: 0.1667, // The Bottled Ship
  starbench_1: 0.1667, // Brass Cog
  starbench_2: 0.1667, // Gear Ring
  starbench_3: 0.1667, // The Starwright's Bench
  orrery_1: 0.1667, // Ground Lens
  orrery_2: 0.1667, // Spyglass
  orrery_3: 0.1667, // The Orrery
  wreckforge_1: 0.1667, // Iron Billet
  wreckforge_2: 0.1667, // Forge Bellows
  wreckforge_3: 0.1667, // The Wreck Forge
  warhelm_1: 0.1667, // Iron Cap
  warhelm_2: 0.1667, // Banded Helm
  warhelm_3: 0.1667, // The Horned Helm
  tarkiln_1: 0.1667, // Tar Spile
  tarkiln_2: 0.1667, // Tar Bucket
  tarkiln_3: 0.1667, // The Tar Kiln
  emberheart_1: 0.1667, // Pitch Bead
  emberheart_2: 0.1667, // Pitch Loaf
  emberheart_3: 0.1667, // The Ember Heart
  auroraloom_1: 0.1667, // Silver Spindle
  auroraloom_2: 0.1667, // Loom Comb
  auroraloom_3: 0.1667, // The Aurora Loom
  auroraweave_1: 0.1667, // Light Thread
  auroraweave_2: 0.1667, // Woven Bolt
  auroraweave_3: 0.1667 // The Aurora Cloak
};

/**
 * The DENOMINATION of Gold: a Gold Coin is five Gold.
 *
 * It is the unit the whole currency is counted in, so any balance the player
 * holds can be handed over as coins (35 Gold is seven of them) and a House pays
 * in the same money the player spends. Every scripted Gold award is authored as
 * a multiple of it — a quest paying 26 could not be handed over. The per-piece
 * worth lives in `chains.json` as each coin tier's `sell`, because a Coin is a
 * PIECE now: the House drops one, the player pockets it like anything else, and
 * the Bag is where it turns back into money.
 *
 * The Pouch is three Coins merged, so it sells for three Coins. It used to pay
 * ten, which quietly burned five Gold every time the player made one — the
 * merge the Manor exists to feed was the one merge in the game that lost money.
 *
 * Coins used to be COLLECTIBLES: a tap banked the gold and destroyed the piece,
 * which meant they could never reach the Bag — and the commission chooser reads
 * the Bag, so a House could never be told to make Gold Coins again once it had
 * been commissioned to anything else. A currency you cannot hold is a currency
 * the rest of the game cannot see.
 */
export const GOLD_UNIT = 5;
/** A Gold Pouch — three Coins merged, and worth exactly that. */
export const POUCH_UNIT = GOLD_UNIT * 3;

/**
 * The PURSE: the Gold balance, expressed as the coins it is made of.
 *
 * There is one pile of money in this game and two ways to look at it. The
 * number in the HUD and the coins in the satchel are the SAME Gold — a purse
 * that had to be filled by pocketing pieces would be a second, shadow balance
 * the player has to reconcile by hand.
 *
 * The denomination depends on who is looking. The Bag shows the largest that
 * fills: 500 Gold is 33 Pouches. A commission chooser shows the rank the
 * BUILDING can work — a House caps at tier one, so the same money reads to it
 * as 100 Gold Coins, and a House is never offered a Pouch it could not make.
 */
export function goldPurse(
  coins: number,
  maxTier = 2
): { chain: 'coin'; tier: 1 | 2; count: number } | null {
  const tier: 1 | 2 = maxTier >= 2 && coins >= POUCH_UNIT ? 2 : 1;
  const count = Math.floor(coins / (tier === 2 ? POUCH_UNIT : GOLD_UNIT));
  return count > 0 ? { chain: 'coin', tier, count } : null;
}

/**
 * Chains that exist in chains.json (the unit tests use `sparkweed` as their
 * generic merge chain) but must NEVER spawn in the live game. The map can still
 * reference them; `BoardSystem`/`UnlockSystem` skip them at spawn, so we erase
 * the flower (Spark Weed → Ember Bloom) WITHOUT editing the authored map.
 */
export const HIDDEN_CHAINS = new Set<string>([
  'sparkweed',
  // The husbandry roster (docs/merge-chains.md §2). Authored, drawn and wired,
  // and it belongs to the chapter that opens the Cold Nest — not to this one.
  // Chapter One has no nest, no feeding and no recipient for any of it, its
  // seeds sit in `level_5` — whose land opens at the Level-3 cap now, so THIS
  // SET is the only thing still holding them off the board — and
  // Eleanor's orders ask for Gem Shards. Left visible they were 12 permanent
  // "· · ·" rows in the Cookbook — a completion counter the chapter can never
  // let the player finish. Same rule, same fix, same one-line switch as the
  // Borealis block below.
  'firepine',
  'nest',
  // NOT 'dew_basin' — it is the moonwater farm, and moonwater has a Chapter One
  // recipient now: Eleanor's `eleanor_moonwater` order ("Catch the Moonwater"),
  // the promise the tutorial's `moonwater_merge` line makes. `level_5` seeds it
  // as parts (Hollow Stone ×3 + Dew Hollow ×2), so the player MERGES the Basin
  // into being and both of its Cookbook rows are discoverable — a seeded t3
  // would have left them permanent "· · ·" rows.
  // NOT 'emberberry' — the Ripe Emberberry Plant the tutorial grants now yields
  // the berry itself (berry ×3 → basket ×3 → preserve), so this chapter both
  // produces the chain and can finish its two Cookbook rows. It stays husbandry
  // FUEL for the nest chapter; it is simply reachable a chapter earlier.
  // NOT 'resin' — the tutorial now TEACHES it, and teaches it end to end: three
  // beads off the old tree's bark become a Lump, three Lumps a Hearth Cake, and
  // the Cake goes to the Red Dragon, whose favourite it is (DRAGON_DIET). Both
  // its Cookbook rows are discovered inside the lesson, so it is not a "· · ·"
  // row the chapter cannot finish — it is the chapter's one worked example of
  // the whole husbandry idea. It stays RENEWABLE afterwards because the same
  // lesson commissions the House to press beads (`house_commission`), which is
  // the point of putting the two beats next to each other.
  // NOT 'ashmoss' — Chapter One owns it end to end: the Emberbark Stump
  // (`emberbark`, a single-tier landmark like the Crystal) farms it from the
  // first frame, and `moss_stump` → `ash_green` open the game on it. Her
  // arrival asks for "the warmth, the green, and whatever's still asleep",
  // and the green is the first thing the isle gives back. (merge-chains.md
  // §2's old "restoration IS the moss supply" rule retired with the stump.)
  // NOT 'emberbark' — the stump IS that farm; hiding it would strand the
  // opening beat.
  // NOT 'quartz' — the Theme Crystal sheds it now (it used to shed Emeralds),
  // which makes it the one MAGE_ONLY chain Chapter One has a live producer for.
  // The opening teaches it end to end in place of the old Emerald ladder:
  // `crystal_tap` → `quartz_merge` → `quartz_ball`, both Cookbook rows
  // discovered, and RENEWABLE afterwards off the same Crystal. It stays
  // recipient-locked to Eleanor (DragonSystem's MAGE_ONLY) — no tier of it ever
  // feeds a dragon, which is exactly the lore the new beats are about.
  // The two chains that give Storm and Moonwhisker a favourite of their own.
  // Same reason as `resin`: husbandry roster, no Chapter One source, so they
  // would sit in the Cookbook as permanent "· · ·" rows. They turn on with the
  // nest chapter, alongside the farms that will supply them.
  'stormcap',
  'nightbloom'
  // Selyna's Borealis roster USED to sit here. It does not belong here: this set
  // is "not this CHAPTER", and those four are "not this WORLD". They now carry
  // `world: "borealis"` in chains.json, which withholds them from Emberkeep and
  // — unlike a line in this set — turns them on by itself the moment the player
  // is standing in the north, with no second edit to forget. See `chainHiddenIn`
  // and docs/merge-chains.md §2.4.
]);

/**
 * Is this chain withheld from the world the player is standing in?
 *
 * Two unrelated reasons, deliberately kept apart:
 *   • **Wrong world** — the chain names a `world` that is not this one. Selyna's
 *     frozen roster is Borealis's vocabulary and must never appear in Emberkeep;
 *     Emberkeep's must never appear in hers.
 *   • **Wrong chapter** — `HIDDEN_CHAINS`. Authored, drawn and wired, but its
 *     recipient (the Cold Nest, the feeding loop) belongs to a later chapter of
 *     THIS world. Left visible they are permanent "· · ·" rows in the Cookbook.
 *
 * Structurally typed on purpose so this file stays free of chains.json.
 */
export function chainHiddenIn(
  chain: { id: string; world?: string },
  worldId: string,
  /** Let a foreign chain through — an authored KEEPSAKE (MapItemPlacement),
   *  never a general spawn. The chapter half of the rule below still applies:
   *  a later chapter's chain is not made shippable by being a gift. */
  allowForeign = false
): boolean {
  if (!allowForeign && chain.world !== undefined && chain.world !== worldId) return true;
  return HIDDEN_CHAINS.has(chain.id);
}

/**
 * The Bag — the player's off-board pocket. TAP a plain merge piece to store it,
 * open the bag and tap a slot to put it back. Storing is free and instantly
 * reversible on purpose: drag and tap are now two verbs on the same object, so a
 * player who taps when they meant to drag must lose nothing.
 *
 * Capacity counts DISTINCT stacks, not items — identical pieces pool into one
 * slot, so a full bag means "twelve different things", which is far rarer (and
 * far easier to reason about) than twelve objects.
 */
export const BAG_SLOTS = 12;

/** World-character action cooldown floor. Authored per character in
 *  `characters.json`; Regard shortens it later (docs/world-characters.md §4).
 *  Help is FREE — she is help, not a shop — so the cooldown is the only limit,
 *  which is why it is long. */
export const CHARACTER_COOLDOWN_MIN_MS = 60_000;

/* ---------------- Regard: the five hearts (docs/quests.md §1.3) -------------
 *
 * The relationship gauge for the two PEOPLE — Eleanor in the south, Selyna in
 * the north. Five hearts, and it is meant to be full at the very end of the
 * campaign and not one quest before it. That is a pacing number, so it is
 * derived rather than felt:
 *
 *   5 hearts × REGARD_POINTS_PER_HEART = 60 points to fill.
 *   A chapter quest pays REGARD_QUEST_POINTS ...... 60 / 3 = 20 quests.
 *   Each accepted gift pays REGARD_GIFT_POINTS .... ≈ 1 per quest that has a
 *                                                    gift subquest.
 *
 * So a player who only fills the Ledger gets there in 20 quests, and one who
 * also gives her the things she asks for gets there in about 15 — the range the
 * twelve-chapter ladder is written to (docs/quests.md §3, ~25 days floor).
 *
 * Two properties this shape buys, both deliberate:
 *   • **It never decays.** Absence never punishes. Regard is a record of what
 *     the player did, exactly like Trust (merge-chains §4.1).
 *   • **It cannot be bought.** Nothing pays Regard but a completed quest and a
 *     gift she asked for, so it can never gate story behind a purchase
 *     (docs/quests.md §7 rule 6).
 *
 * The points live in `GameState.stats` — already persisted, so the gauge adds
 * no save field and needs no SAVE_VERSION bump.
 */
export const REGARD_HEARTS = 5;
export const REGARD_POINTS_PER_HEART = 12;
export const REGARD_MAX_POINTS = REGARD_HEARTS * REGARD_POINTS_PER_HEART;
/** Paid to a quest's `giver` when the quest completes. Overridable per quest
 *  (`QuestConfig.regard`) — a 0 there means "this one is not about her". */
export const REGARD_QUEST_POINTS = 3;
/** Paid per item accepted by a live `gift` subquest. */
export const REGARD_GIFT_POINTS = 1;

/** Where a character's Regard points live in `stats`. */
export const regardKey = (characterId: string): string => `regard:${characterId}`;
/** Lifetime count of one piece given to one character — what a `gift` goal
 *  reads. A counter, so the goal keeps no state of its own (QuestSystem law 1). */
export const giftKey = (characterId: string, chain: string, tier: number): string =>
  `gift:${characterId}:${chain}:${tier}`;
/** Latch so a quest's Regard is paid exactly once, however often
 *  `quest:completed` is re-derived. */
/** Pieces GIVEN (hand to hand, out of the satchel) toward one requirement of
 *  one order — the deliver verb's twin. Counted per order so a repeatable can
 *  clear it on completion, and a stat so it survives a reload like any other
 *  handing-over the game remembers. */
export const orderGiveKey = (orderId: string, chain: string, tier: number): string =>
  `ogive:${orderId}:${chain}:${tier}`;
export const regardPaidKey = (questId: string): string => `regard:paid:${questId}`;
/** Lifetime count of one cauldron recipe brewed — what a `brew` goal reads.
 *  Same shape and same reason as `giftKey`: the goal keeps no state of its own,
 *  and spending the output cannot un-brew it. */
export const brewKey = (recipeId: string): string => `brew:${recipeId}`;

export const heartsForPoints = (points: number): number =>
  Math.min(REGARD_HEARTS, Math.floor(Math.max(0, points) / REGARD_POINTS_PER_HEART));

/**
 * The status readout under the quest tracker (`src/ui/StatusPanel.ts`).
 *
 * `FLASH` is how long an unasked-for reveal holds before it fades: long enough
 * to read one line and a row of hearts, short enough that a busy merge session
 * is not narrated at the player. The two fades are asymmetric on purpose — it
 * arrives quickly enough to catch the eye and leaves slowly enough not to snatch
 * itself away mid-read.
 */
export const STATUS_FLASH_MS = 3000;
export const STATUS_FADE_IN_MS = 220;
export const STATUS_FADE_OUT_MS = 420;

/** The "makes this" disc over a commissioned House: its radius, and how far it
 *  floats above the sprite's anchor. Sized to read at a glance without becoming
 *  a second item on the tile. */
export const PRODUCE_BADGE_R = 44;
export const PRODUCE_BADGE_LIFT = 190;

/** Which map this build renders. The engine is single-world; `characters.json`
 *  tags each character with a world so Borealis-only cast can never be built
 *  into Emberkeep by accident. */
export const WORLD_ID = 'emberkeep';

/**
 * How far the re-grid recovery searches for a home when a saved piece's art
 * position lands on ground the new map does not have (`GameState.nearestFree`,
 * see src/core/mapSpace.ts). Three rings is ~1.5 tiles of slack — enough to
 * absorb a re-cut coastline or a zone seam, small enough that a piece never
 * teleports somewhere the player would not recognise. Past it, the satchel is
 * the honest answer.
 */
export const REGRID_SEARCH_RINGS = 3;

/**
 * Animation banks for the characters who stand ON the map (not on the merge
 * board). Each is an 8-frame horizontal strip under `sprites/<id>/`.
 *
 * `idle` loops for as long as she is standing there, and is deliberately almost
 * motionless — a breath, a drift in the braid, a pulse in the scepter crystal.
 * `cast` plays ONCE when she is actually asked for something and then hands back
 * to the idle: she never walks to what she helps, she works at a distance with
 * the scepter (docs/world-characters.md §1).
 *
 * GENERATED by `scripts/bake-standee.py` (it prints this block) — do not hand-
 * tune the geometry. That script registers every frame of BOTH banks onto one
 * reference by her FEET and bakes them into one shared frame box, which is what
 * stops the idle sliding across the tile and the cast popping when it takes
 * over. Read its header before changing any number here.
 *
 * `anchorX`/`anchorY` are her FEET as a fraction of that frame — the sprite
 * origin, not (0.5, 1). The box is the union of every frame plus a thin
 * transparent margin (nothing may sit flush against an edge, or the scepter's
 * glow gets sliced square), and the cast's ember bolt reaches far to her left,
 * so its bottom-centre is empty space and only the explicit anchor puts her
 * shoes on the tile. Padding the box moves her on screen by ZERO: the anchor and
 * `body` are stored relative to it and `scale` is derived from body height.
 *
 * `body` is her silhouette inside the frame, in TEXTURE space — the hit rect is
 * derived from it, never from the frame (the frame includes the spell FX).
 *
 * `scale` is solved so her body renders 256 hi-res units tall, roughly the
 * on-board size of a whelp dragon (ITEM_SCALE `ember_dragon_3` ≈ 221px), so a
 * person reads as a person beside one instead of towering over the board.
 */
export interface StandeeBank {
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  /** Feet, as a fraction of the frame — the sprite's origin. */
  anchorX: number;
  anchorY: number;
  /** Her silhouette within the frame (texture space), for the hit rect. */
  body: { x: number; y: number; width: number; height: number };
  scale: number;
  fps: { idle: number; cast: number };
  keys: { idle: string; cast: string };
}

export const STANDEE_BANKS: Record<string, StandeeBank> = {
  eleanor: {
    frameWidth: 438,
    frameHeight: 584,
    frameCount: 8,
    anchorX: 0.7099,
    anchorY: 0.9709,
    body: { x: 128, y: 52, width: 293, height: 515 },
    scale: 0.4971,
    fps: { idle: 12, cast: 14 },
    keys: { idle: 'eleanor_world_idle', cast: 'eleanor_world_cast' }
  },
  selyna: {
    frameWidth: 456,
    frameHeight: 543,
    frameCount: 8,
    anchorX: 0.6992,
    anchorY: 0.9982,
    body: { x: 120, y: 28, width: 335, height: 514 },
    scale: 0.4981,
    fps: { idle: 12, cast: 14 },
    keys: { idle: 'selyna_world_idle', cast: 'selyna_world_cast' }
  }
};

/**
 * Authored size trim applied ON TOP of a bank's baked `scale`, per character.
 *
 * The bake solves `scale` so her body lands at a target height (256 hi-res units
 * by default); this is the art-direction adjustment on top of that solve, and it
 * lives OUT here rather than in the generated block above so re-running
 * `scripts/bake-standee.py` cannot silently undo it.
 *
 * Scaling is anchored at her FEET — the bake puts the sprite origin there
 * (`anchorX`/`anchorY`), not at the frame's bottom-centre — so a trim changes her
 * height and nothing else: her shoes stay on the same tile, and the breath, the
 * arm pulse, the cooldown nudge, the ground shadow and the tutorial marker all
 * re-derive from the trimmed scale rather than fighting it.
 */
export const STANDEE_SCALE_TRIM: Record<string, number> = {
  // 0.7 → her body renders ~179 units instead of 256. She read as too large
  // standing beside the whelps at the ward line.
  eleanor: 0.7,
  // Same trim, and for the same reason: the two are the same kind of figure and
  // a person must read at one size across worlds. Borealis's slabs are drawn at
  // the same backdrop calibration as Emberkeep's, so a standee that matched
  // there and not here would just be an inconsistency.
  selyna: 0.7
};

/**
 * Standing still IS the breath — a puppet-style vertical squash about her FEET
 * (her origin), so nothing but her height moves and her shoes stay on the tile.
 * The baked `idle` bank is NOT played: she rests on its frame 0 and this is the
 * only thing moving. The frame loop under the breath read as a fidget, and two
 * idles at once read as two different people. The bank stays loaded because it
 * owns her resting still and the cast hands back to it; `fps.idle` is now just
 * the rate the frames were captured at. The `cast` bank still plays in full —
 * that one is a deliberate gesture, not idling.
 *
 * `amount` is peak scaleY deviation: 0.008 is ~2px of head travel at her on-board
 * size, which reads as alive without ever reading as an animation. It composes on
 * top of whatever scale she is at (arm pulse, cooldown nudge) rather than
 * fighting it, and `phaseSpread` staggers the cast off one another so two
 * standees in frame never inhale in unison — the same rule the blink follows.
 * Starts after the landing settle so the two never write scaleY on one frame.
 */
export const STANDEE_BREATH = {
  amount: 0.008,
  periodMs: 4200,
  phaseSpread: 1.7,
  startDelayMs: 460
} as const;

/**
 * Cadence of the Align-Studio BLINK clip during a standee's atlas idle: the
 * blinking clip is a full idle segment with a blink in it (~3 s), not a
 * 100 ms eyelid frame, so it plays far less often than a rig blink would.
 */
export const STANDEE_CLIP_BLINK = {
  minMs: 7000,
  maxMs: 14000
} as const;

/**
 * Portrait-ring atlas clips (the bust-framed talking/blinking sets): how long
 * the TALKING loop holds per spoken line before settling back onto the
 * blinking rest loop. Mirrors the disc animator's read-length feel.
 */
export const PORTRAIT_CLIP_TALK = {
  msPerChar: 55,
  minMs: 1400,
  maxMs: 6500
} as const;

/**
 * THE TYPEWRITER — dialogue arrives a letter at a time, in every world.
 *
 * The lines used to appear whole and then sit for `readMs`, which is why the
 * game read as hurried even after the HOLD was fixed: a paragraph that is
 * simply THERE has no pace of its own, so the eye finishes it long before the
 * bubble moves and the wait feels like a wait.
 *
 * `msPerChar` is deliberately well under `READING.perChar` (55): the reveal has
 * to finish comfortably before the hold expires or a line would be taken away
 * mid-word. At 26 a 200-character beat types in 5.2 s and its hold is 11.9 s.
 * `maxMs` caps the longest line so a rare 400-character speech cannot crawl.
 *
 * A TAP NEVER PAYS FOR THE ANIMATION. Tapping snaps the line whole and does
 * whatever the tap already did in the same gesture — one tap is still one beat,
 * which is what the tutorial e2e drives and what a replaying player expects.
 */
export const TYPEWRITER = {
  msPerChar: 26,
  maxMs: 7000,
  /** Repaint cadence. 2 characters a frame at 60fps reads as continuous while
   *  costing a sixth of the `setText` calls a per-character timer would. */
  charsPerTick: 2,
  tickMs: 32
} as const;

/**
 * The full-screen DRAGON REVEAL — the card a player is shown the first time a
 * dragon form is theirs.
 *
 * Keyed by `<chain>:<tier>`, so a breed is ready here the moment it is given a
 * chain and needs no code to switch on. `golden_egg:2` earned its card when
 * Selyna's Cauldron made Golden Eggs brewable: merging three is now a real
 * player act, distinct from the altar's finale — which stays choreographed off
 * `FINALE` on its quest trigger and never shows this card.
 */
export const DRAGON_REVEAL: Record<string, { art: string; name: string; epithet: string }> = {
  'ember_dragon:3': {
    art: 'reveal_ember',
    name: 'Red Dragon',
    epithet: 'the first fire to come back to Emberkeep'
  },
  'ember_dragon:4': {
    art: 'reveal_ember_adult',
    name: 'Big Red Dragon',
    epithet: 'all grown up, and very loud about it'
  },
  'emerald:3': {
    art: 'reveal_emerald',
    name: 'Green Dragon',
    epithet: 'hatched green, which the old books say is lucky'
  },
  'emerald:4': {
    art: 'reveal_emerald_adult',
    name: 'Big Green Dragon',
    epithet: 'the moss and the ash both listen to her now'
  },
  // The legendary breeds hatch AT tier 2 — egg to animal in one merge — so
  // their one card is the young form. Brewed at Selyna's Cauldron or paid out
  // by the ladder's egg arc; either road ends on this same screen.
  'ashdrake:2': {
    art: 'reveal_ashdrake',
    name: 'Ash Dragon',
    epithet: 'what the fire keeps when everything else has burned'
  },
  'rimewyrm:2': {
    art: 'reveal_rimewyrm',
    name: 'Ice Dragon',
    epithet: 'the cold came back curious, and glad to be held'
  },
  // Present since the Cauldron made the Golden Egg brewable: a player can now
  // MERGE three into an Elder outside the finale, and that hatch deserves the
  // same ceremony. The finale's own altar beat is untouched — it is a QUEST
  // trigger, and it still refuses a teaser.
  'golden_egg:2': {
    art: 'reveal_golden',
    name: 'Golden Elder',
    epithet: 'older than the island, and awake because you asked'
  },
  /*
   * FROST AND STORM — the two breeds whose cards were painted and never hung.
   *
   * `reveal_frost`, `reveal_frost_adult`, `reveal_storm` and
   * `reveal_storm_adult` have shipped in assets.json all along; what was
   * missing was these eight lines. RevealSystem asks this table and nothing
   * else, so a breed absent from it hatches in silence — which is the whole of
   * "the frost dragon's reveal never happens". Nothing was broken; nothing was
   * mounted. `DragonReveal.spec` now fails if a hatching chain is left out
   * again.
   */
  'frost:2': {
    art: 'reveal_frost',
    name: 'Frost Dragon',
    epithet: 'hatched out of a snowstorm, and in no hurry to warm up'
  },
  'frost:3': {
    art: 'reveal_frost_adult',
    name: 'Big Frost Dragon',
    epithet: 'all grown up; the air around her stays cool'
  },
  'storm:2': {
    art: 'reveal_storm',
    name: 'Storm Dragon',
    epithet: 'the quiet one, and the sky has not stopped watching'
  },
  'storm:3': {
    art: 'reveal_storm_adult',
    name: 'Big Storm Dragon',
    epithet: 'all grown up, and the weather asks HER first'
  }
};

/**
 * The reveal's choreography, in ms from the moment the card opens. Every beat
 * lives here because they have to stay in step with each other AND with the
 * roar: move the plate's entrance and the sound is early.
 */
export const REVEAL = {
  /** Scrim in — the board is dimmed, never hidden: it is still your isle. */
  scrimMs: 260,
  scrimAlpha: 0.88,
  /** The plate flies in from below, overshooting once. */
  plateInMs: 520,
  plateFromScale: 0.52,
  plateFromY: 190,
  /** The roar lands ON the overshoot, not on the first frame of movement. */
  roarAtMs: 300,
  /** Nameplate rises after the animal has landed. */
  nameAtMs: 620,
  nameRiseMs: 380,
  /** How long the card holds once assembled, before it lets go by itself. */
  holdMs: 2400,
  outMs: 420,
  /** A tap skips straight to the exit, but not before the roar has landed. */
  skipAfterMs: 700,
  /** Idle breath on the held plate — alive, not floating. */
  breathScale: 0.018,
  breathMs: 1500,
  /** The godray disc behind the animal, and how fast it turns (deg/sec). */
  raySpin: 9,
  rayAlpha: 0.34,
  /** Plate height on screen, as a fraction of the live viewport height, and
   *  where its centre sits. Above the middle on purpose: the nameplate rises
   *  UNDER the animal, and centring the plate puts the text across its feet. */
  plateHeightFrac: 0.66,
  /** …and its width cap. Portrait phones are the reason this exists. */
  plateWidthFrac: 0.86,
  plateCentreFrac: 0.42
} as const;

/**
 * How a shelf item's rarity is DRESSED — the Emporium's only use of it. Rarity
 * buys nothing: a legendary dragon skin re-textures a dragon exactly the way an
 * epic one does. It changes the plate the card is printed on, the ribbon it
 * wears and what it costs, and that is the whole of it.
 *
 * `foil` is the switch for the violet plate and its travelling sheen, so making
 * a future tier foiled is a one-line edit here.
 */
export const RARITY: Record<
  'epic' | 'legendary',
  { label: string; ribbon: string; ribbonEdge: string; ink: string; foil: boolean }
> = {
  epic: {
    label: 'EPIC',
    ribbon: '#5B3E8C',
    ribbonEdge: '#9B7CE0',
    ink: '#FFF6E8',
    foil: false
  },
  legendary: {
    label: 'LEGENDARY',
    ribbon: '#2E1147',
    ribbonEdge: '#FFD84D',
    ink: '#FFF6E8',
    foil: true
  }
};

/**
 * The foil plate under a legendary card: a brushed violet metal, a holographic
 * streak that crosses it, and a gold rim.
 *
 * The sheen is a TileSprite scrolling its own texture inside a FIXED rectangle,
 * never a sprite sliding across a masked card. Phaser's geometry masks resolve
 * against world space and lose the transform of a nested container, which the
 * store's cards are three deep in; a scrolling tile needs no mask at all and
 * cannot leak past the plate. `tileScale` stretches the 256px tile so one
 * streak crosses at a time — under ~3 the card wears stripes instead.
 */
export const FOIL = {
  base: '#1D0A2E',
  mid: '#4B1C7E',
  high: '#8E51CE',
  rim: '#E7C6FF',
  edge: '#FFD84D',
  /** One full pass of the streak, corner to corner. */
  sweepMs: 3400,
  /** Beat between passes, so the card glints rather than strobes. */
  sweepGapMs: 1100,
  tileScale: 4,
  sheenAlpha: 0.5,
  /** Thickness of the rim stroke, in the 2560-space. */
  rimWidth: 7
} as const;

/** Her ground shadow, as a fraction of her BODY width (never the frame — that
 *  also spans the cast's ember bolt). Under 1 so it reads as contact under her
 *  feet rather than a puddle she is floating over. */
export const STANDEE_SHADOW_WIDTH = 0.9;
/** Its height, as a fraction of its own final width — the standee's override of
 *  the shared 0.42. Widening a contact patch must not also deepen it: a person's
 *  shadow on a near-flat sunset light spreads sideways, and 0.9 × 0.34 keeps the
 *  vertical extent where 0.72 × 0.42 had it. */
export const STANDEE_SHADOW_SQUASH = 0.34;
/** And its horizontal nudge, in fractions of that width — negative is LEFT.
 *  An authored correction, not physics: the shadow is centred on her anchor,
 *  but the baked BODY box is the UNION of both banks and the cast pose swings
 *  her arm out to one side, so the box's centre sits right of the feet actually
 *  bearing her weight. Small on purpose — past ~0.1 she reads as detached. */
export const STANDEE_SHADOW_DX = -0.05;
/** And its vertical nudge, in fractions of its own HEIGHT — negative is UP.
 *  The shadow is centred on her anchor, and the bake puts that anchor at the
 *  BOTTOM of her body box (her soles), so a centred ellipse spends half its
 *  height BELOW the lowest pixel of her — reading as a puddle she hovers over
 *  rather than the patch she stands on. Lifting it tucks most of the ellipse
 *  back under her feet while leaving enough below to still read as ground.
 *  Fractions of height, not width like `DX`, because that is what it moves
 *  against: the nudge holds its meaning if the squash is ever retuned. */
export const STANDEE_SHADOW_DY = -0.3;

/* ---------------- The day clock (merge-chains.md §3) ----------------
 * Four coarse phases, 8 minutes each — a full day is 32 minutes of real time.
 * Enough for "she'll only take it at dusk", visible in the sky art each world
 * already ships, and a player sees all four in one sitting. Everything reads
 * GameClock.now() so advanceTime(ms) stays deterministic. */
export const DAY_PHASES = ['morning', 'day', 'dusk', 'night'] as const;
export type DayPhase = (typeof DAY_PHASES)[number];
export const PHASE_MS = 8 * 60_000;
export const DAY_MS = PHASE_MS * DAY_PHASES.length;

export const dayIndexAt = (ms: number): number => Math.floor(ms / DAY_MS);
export const phaseAt = (ms: number): DayPhase =>
  DAY_PHASES[Math.floor((((ms % DAY_MS) + DAY_MS) % DAY_MS) / PHASE_MS)]!;

/* ---------------- The Cold Nest (merge-chains.md §4) ----------------
 * A dragon is coaxed, not merged, bought or dropped. 9 goods total, at most 3
 * points per day, so the minimum is THREE in-game days spread across sessions —
 * currency cannot compress it, which is the whole point. */
export const NEST_POINTS_REQUIRED = 9;
export const NEST_POINTS_PER_DAY = 3;

/* ---------------- Trust & Growth ----------------
 * Trust 0-5, earned by feeding (max +1/day) and by feeding a KNOWN favourite
 * (+1 bonus). It never decays: absence never punishes, presence always rewards.
 * Growth is a separate axis — a dragon that gets all its meals in a day is
 * well-fed that day, and five of those make it an adult. Dragons stop becoming
 * adults by merging and start becoming adults by being raised. */
export const TRUST_MAX = 5;
export const MEALS_PER_DAY = 3;

/* ---------------- Feed cycles (the Dragon Codex's clock) ----------------
 *
 * A CYCLE is the window a board dragon must be fed inside: when it rolls over,
 * the hunger gauge returns to zero and the window starts again. It is the
 * period the care record's meal/green tallies live on (DragonSystem.careOf) —
 * ONE clock, shared by the gauge, the roar and the Codex, because a second
 * hunger clock would drift from the gauge the player is looking at. Trust
 * stays on the slower `dayIndexAt` day: a relationship is not an appetite.
 *
 * A cycle in which the dragon reached a FULL gauge (MEALS_PER_DAY) is a
 * WELL-FED cycle, counted once per cycle into its lifetime record — the number
 * the Codex shows, and the coin the evolution condition is priced in.
 */
export const DRAGON_CYCLE_MS = 10 * 60_000;
export const cycleIndexAt = (ms: number): number => Math.floor(ms / DRAGON_CYCLE_MS);
/** Well-fed cycles a breed needs before it can evolve (the Codex's condition
 *  page). Absent = the Codex shows no evolution for that breed. */
export const WELL_FED_EVOLUTION: Record<string, number> = {
  ember_dragon: 6,
  // One bar for every breed: the Codex teaches "fully fed for 6 cycles" once
  // (the Red Dragon's page) and every other page keeps that promise identical.
  emerald: 6,
  frost: 6,
  storm: 6,
  moonwhisker: 6,
  // The two egg-quest breeds keep the same promise: their adult reveal plates
  // ship (reveal_ashdrake_adult / reveal_rimewyrm_adult), so the Codex shows
  // every dragon what it grows into.
  ashdrake: 6,
  rimewyrm: 6
};
/** Meal value by tier: a snack, a meal, a feast (merge-chains §1.4). */
export const MEAL_VALUE: Record<number, number> = { 1: 1 / 3, 2: 1, 3: 1 };

/* ---------------- Diet: taste, the hunger gauge, and growing up ------------
 *
 * Every dragon sorts the food roster into exactly three boxes, fixed at birth
 * and HIDDEN until the player experiments (the Dragon Book fills in by
 * discovery, never by being told — merge-chains §2.1):
 *
 *   • its FAVOURITE — one chain. Fills the hunger gauge at full rate.
 *   • its REFUSAL — one chain. It turns its head away; nothing is consumed and
 *     the gauge does not move.
 *   • everything else it ACCEPTS, at `ACCEPTED_RATE` of the favourite.
 *
 * The old law was "the refusal is always a FUEL, never the green", because
 * `ashmoss` was the only cooling chain and a dragon that refused it could never
 * stop panting — a permanent bad condition nothing in the game could fix.
 * `nightbloom` retires it: with a SECOND cooling chain, refusing one green is
 * an inconvenience the player can cook around instead of a dead end. The law
 * that replaces it is the real one all along, and `dietIsSurvivable`
 * (DragonSystem, which owns the axis rosters) is its statement: whatever a
 * breed refuses, it must still be able to reach at least one fuel AND one
 * green in the world it lives in.
 */
export const ACCEPTED_RATE = 0.25;

/**
 * How much of a dragon it takes to raise one. A serving is ONE feed; its
 * favourite is worth a whole serving, anything it merely accepts is worth
 * `ACCEPTED_RATE` of one. So a lesser dragon is 15 favourite servings or 60
 * accepted ones, a legendary 25 or 100 — cooking to its taste is the difference
 * between a week and a month, which is the whole point of the Book.
 *
 * Growth counts SERVINGS, not calories: tier only sizes the daily hunger gauge
 * (MEAL_VALUE), so a stack of Hearth Cakes feeds a dragon well today and does
 * not shortcut raising it. Showing up is the currency.
 */
export type DragonRarity = 'lesser' | 'legendary';
export const ADULT_SERVINGS: Record<DragonRarity, number> = { lesser: 15, legendary: 25 };

/** Every rigged breed, by the chain key its companion carries. */
export const DRAGON_RARITY: Record<string, DragonRarity> = {
  ember_dragon: 'lesser',
  emerald: 'lesser',
  frost: 'legendary',
  storm: 'legendary',
  moonwhisker: 'legendary'
};

/**
 * Taste per breed. `favourite` must be a chain that exists in the world the
 * breed lives in, or its adult is 4× dearer than authored; the pair must pass
 * `dietIsSurvivable`.
 *
 * Every breed now has a favourite of its OWN — five breeds, five reachable
 * chains — which is what `stormcap` and `nightbloom` were added for. Before
 * them the roster held three usable favourites for five dragons (`emberheart` is
 * Borealis-only, so an Emberkeep dragon could never reach it), and two pairs of
 * breeds shared a taste. A favourite the player has to discover is only worth
 * discovering if it tells one dragon apart from another.
 */
/**
 * A QUEST-REWARD EGG NEVER LANDS SILENTLY — the shared timeline for the two
 * halves of its arrival, so the camera and the voice cannot drift apart.
 *
 * BoardScene flies the camera and flares; UIScene speaks the giver's line off
 * the same numbers. They live here rather than in either scene because a beat
 * split across two scenes is exactly the kind of thing that gets re-tuned in
 * one of them.
 */
export const EGG_GIFT = {
  /** After `item:spawned` — the quest-complete banner gets its beat first. */
  glideDelayMs: 700,
  glideMs: 900,
  /** glideDelayMs + glideMs: the flash lands exactly as the camera arrives. */
  flareDelayMs: 1600,
  /** The giver starts speaking over the flare. */
  sayDelayMs: 1600,
  sayHoldMs: 5600,
  /** Long enough to read the float text, short enough to hand the board back. */
  homeDelayMs: 3600
} as const;

export const DRAGON_DIET: Record<string, { favourite: string; refuses: string }> = {
  ember_dragon: { favourite: 'resin', refuses: 'emberheart' },
  emerald: { favourite: 'emberberry', refuses: 'emberheart' },
  // The frost dragon is BOREALIS-BORN (chains.json `world`), so its favourite
  // is northern vocabulary: an ember heart, the one warm thing on the ice —
  // not ashmoss, which grows a world away and would price its adult at 4x.
  frost: { favourite: 'emberheart', refuses: 'resin' },
  storm: { favourite: 'stormcap', refuses: 'emberberry' },
  moonwhisker: { favourite: 'nightbloom', refuses: 'emberheart' },
  // THE LEGENDARIES, and they are not optional: three quests hand out an
  // ashdrake egg and three a rimewyrm's, and a dragon absent from this record
  // is not a dragon `DragonSystem.isBoardDragon` can see — it hatches, stands
  // on the board and can never be fed, named or read about. Each favours a food
  // of its HOME world (the ashdrake eats the isle's cinders; the rimewyrm, a
  // cold thing, craves the one warm drop the north distils) and refuses what
  // the other side of the map grows.
  ashdrake: { favourite: 'cinder_vein', refuses: 'emberberry' },
  rimewyrm: { favourite: 'emberdram', refuses: 'resin' }
};
/* ---------------- Ambient life: what a dragon does when nobody asks --------
 *
 * A merge board is a grid of objects that wait. A dragon that only ever waits
 * is furniture with good art on it, so the board dragons keep a life of their
 * own: they wander the isle, they sleep at night, and they say something about
 * it when they are hungry.
 *
 * Two rules hold the whole thing together:
 *   • **Ambience never costs the player anything.** Wandering cannot break a
 *     merge, sleep does not stop production, and a roar is a mood, not a
 *     penalty. Nothing here is a gate.
 *   • **Nothing here keeps a counter.** Hunger is `DragonSystem.careOf` — the
 *     same record feeding writes and the status readout draws — and sleep is
 *     the shipped day clock's `night` phase. A second hunger clock would drift
 *     from the gauge the player is looking at.
 */

/**
 * A dragon is HUNGRY when it has eaten nothing at all today. Anything settles
 * it — a snack, a scrap, food it merely tolerates.
 *
 * Deliberately NOT "under a full meal". `MEAL_VALUE` scales a serving by tier
 * and taste, so one tier-3 fruit a dragon merely ACCEPTS is worth 0.25 — and at
 * a one-meal threshold a player who fed it correctly would still be roared at
 * all day, which reads as the feeding being broken. The roar's job is to say
 * "nobody has fed this animal", and being fed must be enough to stop it.
 *
 * The hunger GAUGE still reads the full `MEALS_PER_DAY`; the two are different
 * granularities of the same record, and both are honest.
 */
export const HUNGRY_UNFED_EPS = 0.01;
/** How long after a dragon first appears before it may be hungry at all. A
 *  hatchling that roars the instant it lands reads as broken, not as hungry. */
export const DRAGON_HUNGER_GRACE_MS = 90_000;
/** Gap between hungry roars. Rare on purpose — it is a mood, and a dragon that
 *  roars every few seconds is a nuisance rather than a character. */
export const DRAGON_ROAR_EVERY_MS = 64_000;

/** Base gap between one dragon's wanders, and the per-dragon spread added on
 *  top so a board of them never moves in lockstep. Derived from the item id
 *  rather than `Math.random()` — `window.advanceTime(ms)` has to stay
 *  reproducible, and a randomly-timed board move is exactly what would break it. */
export const DRAGON_WANDER_EVERY_MS = 72_000;
export const DRAGON_WANDER_SPREAD_MS = 48_000;
/** A wander must actually GO somewhere: the target tile is at least this many
 *  cells away, so the dragon crosses the isle instead of shuffling sideways. */
export const DRAGON_WANDER_MIN_DIST = 3;
/** …and no further than this, so it stays in the neighbourhood the player is
 *  looking at rather than vanishing to the far side of the board. */
export const DRAGON_WANDER_MAX_DIST = 9;
/** How long the flight itself takes, and the hop height at its apex. */
export const DRAGON_WANDER_FLIGHT_MS = 1700;
export const DRAGON_WANDER_ARC = 175;

/**
 * The sleeping breath. The calmest movement on the board, so it is slow and
 * small: a 3.4-second cycle, a 3.5% rise, and the body widens a little LESS
 * than it heightens so the silhouette breathes instead of pulsing.
 */
export const SLEEP_BREATH = {
  periodMs: 3400,
  amount: 0.035,
  /**
   * How far the body drifts up at the top of the breath, in game units — **0,
   * and it should stay 0.** The curled art is anchored on its own belly line
   * (anchors.json), so `amount` already lifts the ribcage while the belly stays
   * planted, which is what breathing on the ground looks like. Any lift here
   * moves the whole animal off its shadow instead, and a dragon that leaves the
   * floor once every 3.4 s is not asleep, it is hovering.
   */
  lift: 0
} as const;

/**
 * A dragon naps of its own accord: a SHORT window, on a period of its own.
 *
 * Fifteen seconds, once every ten to fifteen minutes. Both halves are the tuning
 * and both matter: a sleep long enough to be in the player's way is a sleep the
 * player has to work around, and a sleep on a fixed period is a schedule rather
 * than an animal. The nap is meant to be caught out of the corner of an eye —
 * you look over, it is curled up, you look again and it is not.
 *
 * 30 s → 15 s (2026-08-15), by the owner's call after playing it: half a minute
 * is long enough to walk up to a dragon, want something from it, and wait. The
 * curl-up and the uncurl are ~1.4 s each at either length, so the nap still
 * reads as a full gesture rather than a flicker — it simply stops being a wait.
 *
 * The PERIOD is drawn per dragon from its id (`napCycleOf`), so no two share a
 * rhythm; the OFFSET inside it is drawn the same way, so no two doze in
 * lockstep even when their periods happen to be close. Both are derived rather
 * than stored: nothing to save, reproducible under `advanceTime`, and a reload
 * puts the animal exactly where it was.
 *
 * This is now the ONLY sleep a dragon chooses. The night used to put the whole
 * roster down for its eight-minute phase, which is not "a short window" by any
 * reading — the sky still turns, the Dew Basin still only runs after dark, but
 * it no longer decides whether an animal is on its feet. What remains beside
 * the nap is the shift-rest, and that one the player asked for by working it.
 */
/**
 * THE GATE CROSSING — the hatchling goes ahead, and stays gone.
 *
 * When a door first opens, the named dragon flies into the light and comes out
 * on the OTHER side: the piece leaves this world's board and stands on the
 * destination's (`dragon:cross_gate`). It is not a flourish that loops back —
 * a flight that says "he went" and then unsays it is the same picture with the
 * meaning removed, and the player who follows him through must find him there.
 */
export const GATE_FLIGHT = {
  /** After the door's ignition has played out — his beat, not the door's. */
  startDelayMs: 2100,
  /** Wake first, fly after: long enough for the uncurl to read as its own beat. */
  wakeLeadMs: 2000,
  /** Held awake across the whole crossing, so a nap cannot re-assert mid-air. */
  keepAwakeMs: 12_000,
  /** Out to the door, and the fade as the light takes him. */
  flyMs: 1500,
  fadeMs: 420
} as const;

export const DRAGON_NAP_LENGTH_MS = 15_000;
export const DRAGON_NAP_CYCLE_MIN_MS = 600_000;
export const DRAGON_NAP_CYCLE_MAX_MS = 900_000;

/** One bellow, and the stretch it takes to get up afterwards. */
export const DRAGON_ROAR_MS = 1500;
export const DRAGON_WAKE_MS = 1400;
/** Fallback scale for a curled sleep painting with no tuned ITEM_SCALE entry —
 *  the sleep art is its own pose at its own resolution, so it can never inherit
 *  the standing rig's scale. */
export const DRAGON_SLEEP_SCALE = 0.26;

/** Chance a feed of this tier reveals a Dragon Book entry. Tier 3 is an
 *  OPTIMISATION, never a gate — scarcity lives in knowledge, not nutrition. */
export const BOOK_REVEAL_CHANCE: Record<number, number> = { 1: 0.1, 2: 0.25, 3: 0.6 };

/* ---------------- The two axes of a dragon's day (merge-chains.md §2.1) ------
 * A dragon is a furnace with a heartbeat: it does not hunt, it burns. So it eats
 * no meat, and its diet has two axes — FUEL (calories) and GREEN (a furnace that
 * never cools cooks itself). Missing either shows on the dragon, which is how a
 * player learns the rule without being told it.
 *
 * There is no grit axis: quartz is Eleanor's chain end to end and no tier of it
 * is food. Recipient locking is absolute. */
export const DAILY_GREEN = 1;
/** Trust levels that pay out something mechanical (merge-chains §4.1). */
export const TRUST_DIGS = 2;
export const TRUST_FORAGES = 4;
export const TRUST_FOLLOWS = 5;
/** A forage is tier 1, or tier 2 on a lucky day — the same 8% that makes a
 *  producer drop occasionally jump a tier (merge-chains §1.3b). */
export const LUCKY_TIER2_CHANCE = 0.08;

/** A standing treasure chest readies a fresh gift every this-many ms (5 min —
 *  the demo's "something free arrives on a rhythm" beat, DEMO-PLAN §3). */
export const CHEST_INTERVAL_MS = 300_000;

/**
 * Recurring treasure-chest gifts. The chest is a PERMANENT fixture: every
 * CHEST_INTERVAL_MS a gift is ready; claiming it grants ONE of these at random,
 * then the chest recharges (it never disappears). `coins` is currency; `item`
 * pops that many merge pieces onto free tiles by the chest; `anyItem` rolls a
 * single tier-1 piece from whatever this world actually makes
 * (`chestWildcardChains`). Designers tune it here, not in code.
 *
 * "No wood — lumber appears only when its cloud zone clears" was written here
 * as a statement of intent and was FALSE for as long as it stood: nothing
 * stopped the wildcard rolling `lumber`, and a chest that did put a fourth pile
 * of Logs beside a lesson whose line promises three. What a comment asserts,
 * `CHEST_WILDCARD_NEVER` now enforces.
 */
/** How far (manhattan tiles) a reward drop may land from its source. Beyond
 *  this the drop is BLOCKED (harvest fails / chest pays Gold / passive skips)
 *  — rewards must never teleport across the map or off the platforms. */
export const REWARD_SPAWN_RADIUS = 3;

export type ChestGift =
  | { kind: 'coins'; amount: number; label: string }
  | { kind: 'item'; chain: string; tier: number; count: number; label: string }
  /** One tier-1 piece, of a chain rolled from THIS world at open time. */
  | { kind: 'anyItem'; label: string };

export const CHEST_GIFTS: ReadonlyArray<ChestGift> = [
  { kind: 'coins', amount: 15, label: '+15' }, // the scene draws the coin art beside it
  // Was `3 × emerald` — the green dragon is dropped, and the chest was the last
  // thing on the board still handing its chain out. Replaced by the wildcard
  // rather than by another fixed chain: a named third gift would just be a
  // second Ruby drop with a different sprite, and the chest's job is to be the
  // one place the isle surprises you.
  // A SECOND PURSE, NOT A SECOND STARTER CHAIN (owner's call, 2026-08-27: the
  // chest "must not give gifts like Rubies, and wood"). `3 Rubies!` stood here
  // and it was the dullest thing the box could do: the opening hands the player
  // Rubies for the whole ruby lesson and the Old Tree sheds Logs for ever, so
  // the one moment the isle is allowed to surprise you paid out the two piles
  // already on the floor. Gold at a second, rarer weight keeps the table at
  // three faces — a chest that only ever paid `+15` or the wildcard would read
  // as two outcomes, and the third face is what makes opening it feel graded.
  { kind: 'anyItem', label: 'A find!' },
  { kind: 'coins', amount: 40, label: '+40' }
];

/** Never rolled by the `anyItem` wildcard, whatever world it opens in. */
export const CHEST_WILDCARD_NEVER = new Set<string>([
  'coin', // currency, and the chest already has a Gold face
  'golden_egg', // the finale's — placed by the altar, brewed at Selyna's Cauldron, and by nothing else
  'emerald', // the dropped green-dragon chain — the whole point of the change
  // The two the player is never short of, barred from the WILDCARD as well —
  // taking the Ruby gift off the table above and leaving the joker free to roll
  // it back would have moved the boredom, not removed it. `lumber` also closes
  // the hole that put a FOURTH pile of Logs on the board during `wood_merge`,
  // where the lesson's own line promises three.
  'ember_dragon',
  'lumber'
]);

/**
 * What the wildcard may roll in `worldId`: a real MERGE chain of this world.
 *
 * Four filters, each load-bearing. Not withheld from this world
 * (`chainHiddenIn` — a chest must never leak the next chapter's roster or the
 * north's onto the isle). Not `legendary`: the Egg Directive above says *no
 * producer ever makes an egg, not a chest*, and a random table is exactly the
 * hole that rule exists to close. More than one tier, so the drop is something
 * the player can DO something with rather than a lone fixture. And a tier 1,
 * because the wildcard always pays the bottom of a ladder — a chest that
 * occasionally handed out a tier-3 would outrank every generator on the board.
 */
export function chestWildcardChains<
  T extends { id: string; world?: string; legendary?: boolean; tiers: ReadonlyArray<{ tier: number }> }
>(chains: readonly T[], worldId: string): T[] {
  return chains.filter(
    (c) =>
      !chainHiddenIn(c, worldId) &&
      !c.legendary &&
      !CHEST_WILDCARD_NEVER.has(c.id) &&
      c.tiers.length > 1 &&
      c.tiers.some((t) => t.tier === 1)
  );
}

/**
 * A chest pays in the currency of the world it stands in.
 *
 * The table above is Emberkeep's, and it is made of Emberkeep chains — neither
 * `emerald` nor `ember_dragon` carries a `world`, so `chainHiddenIn` does NOT
 * withhold them in the north. A chest opened in Borealis would cheerfully drop
 * Dragon Rubies onto an island with no dragon to want them, no order that asks
 * for them and no producer to continue the chain: dead weight, on a board where
 * a tile is the scarcest thing there is, and a silent contradiction of the rule
 * that each world has its own roster.
 *
 * Borealis pays what Borealis makes. Gold is shared vocabulary and stays.
 */
/* ------------------------------------------------------------------ */
/* THE LEGENDARY EGG DIRECTIVE                                          */
/* ------------------------------------------------------------------ */

/**
 * **Every zone gives up exactly one legendary dragon, and the quest ladder is
 * the only thing that can hand it over.**
 *
 * The rule, in full — enforced by `auditLegendaryArc` (`pnpm quests`), so a
 * ladder that breaks it fails the build rather than being found in play:
 *
 *  1. A world has **at most one** chain marked `legendary` in `chains.json`.
 *     Its egg is tier 1, the dragon is tier 2, and `LEGENDARY_EGG_COUNT` eggs
 *     merge into it.
 *  2. **No producer ever makes an egg.** Not a generator, not a region seed,
 *     not a chest, not an order. The ONLY source is a quest `rewards.spawn`,
 *     which is what makes the dragon a story object rather than a grind.
 *  3. Exactly `LEGENDARY_EGG_COUNT` eggs are paid across the zone, one per
 *     quest — never two from the same quest, and never from the endless tail
 *     (which does not finish, so it cannot pay).
 *  4. **They are spaced.** Between two egg quests there are
 *     `LEGENDARY_EGG_GAP_MIN`–`LEGENDARY_EGG_GAP_MAX` quests that pay something
 *     else. Back-to-back eggs make the dragon a formality; a gap longer than
 *     four and the player forgets there is an arc at all.
 *  5. **The last egg is the zone's last completable quest.** Assembling the
 *     dragon IS the end of the zone. That is why the arc is described from the
 *     end backwards and not from the start forwards.
 *
 * Consequence worth stating out loud: a zone needs at least
 * `1 + 2·(LEGENDARY_EGG_GAP_MIN + 1)` = 9 completable quests before it can hold
 * a legendary arc at all. A shorter ladder is not "mostly compliant", it is a
 * zone that cannot have a dragon, and the audit says so in those words.
 */
export const LEGENDARY_EGG_COUNT = 3;
/** Quests paying something OTHER than an egg, between two egg quests. */
export const LEGENDARY_EGG_GAP_MIN = 3;
export const LEGENDARY_EGG_GAP_MAX = 4;

/** The legendary chain of a world, or undefined where none is authored yet. */
export function legendaryChainIn<T extends { id: string; world?: string; legendary?: boolean }>(
  chains: readonly T[],
  worldId: string
): T | undefined {
  return chains.find((c) => c.legendary && !chainHiddenIn(c, worldId));
}

export const CHEST_GIFTS_BY_WORLD: Readonly<Record<string, ReadonlyArray<ChestGift>>> = {
  borealis: [
    { kind: 'coins', amount: 15, label: '+15' },
    // Migrated tier for tier with the roster (migrate-borealis-farms.py's map):
    // driftwood → seaglass, rimebloom → orrery, keel → warhelm. The northern
    // chest still pays northern stock, which is the whole point of it being a
    // per-world table.
    { kind: 'item', chain: 'seaglass', tier: 1, count: 3, label: '3 Glass Balls!' },
    { kind: 'item', chain: 'orrery', tier: 1, count: 3, label: '3 Glass Lenses!' },
    { kind: 'item', chain: 'warhelm', tier: 1, count: 2, label: '2 Iron Hats!' },
    // Second faucets for the two slowest tier-1s (2026-08-27): Magic Pebbles
    // and Fire Juice otherwise trickle ONLY from one seeded machine's every-5th
    // bonus yield, and the compass/lamp brews would be an hours-long wall.
    { kind: 'item', chain: 'manastone', tier: 1, count: 2, label: '2 Magic Pebbles!' },
    { kind: 'item', chain: 'emberdram', tier: 1, count: 2, label: '2 Fire Juices!' }
  ]
};

/** The gift table for the world the Keeper is standing in. */
export const chestGiftsIn = (worldId: string): ReadonlyArray<ChestGift> =>
  CHEST_GIFTS_BY_WORLD[worldId] ?? CHEST_GIFTS;

/** Energy. */
export const ENERGY_MAX = 30;
/** Warmth a brand-new game starts with — 2 below max, so the tutorial's free
 *  free Warmth visibly tops the gauge back toward full. */
export const ENERGY_START = 28;
export const ENERGY_REGEN_MS = 60_000; // 1 Warmth every minute (cozy session gate, not a wall)
export const ENERGY_REGEN_AMOUNT = 1;

/**
 * Cumulative XP to reach each Keeper level (index 0 = level 1 = 0 xp).
 * The scripted tutorial earns exactly 60 XP (26 + 24 hatches + 10 scripted), so
 * the Level-2 beat lands ON the tutorial's `levelup` step. Level 3 (220) is the
 * demo's finale and is tuned so it lands on Order 3's delivery (DEMO-PLAN §Act
 * IV XP ledger: 60 tutorial + O1 30 + merges ~24 + O2 35 + optional hatch ~24
 * + merges ~34 + O3 50 ≈ 257 — orders pay XP in big chunks, so the level-up
 * fires on a delivery, the right beat).
 *
 * PAST 3 THE LADDER KEEPS GOING. It used to stop there, on the argument that
 * the chapter was complete and a bar should never fill toward nothing. What
 * that actually produced is a Keeper who goes on earning XP and stays Level 3
 * for the rest of the save — every merge, every delivery, every hatch counting
 * toward a number that cannot move. A finished chapter is a reason to stop
 * telling STORY at the player, not a reason to stop counting what they do.
 *
 *   L4   420 — a few deliveries past the finale
 *   L5  1000 — the long middle of a post-chapter board
 *   L6  1400 — the cap, and far enough out that reaching it is an achievement
 *
 * No threshold sits inside the `keepers_hoard` window (~550–810): a level-up
 * camera glide must never fight the finale choreography, which fires on that
 * quest's completion.
 *
 * These levels FIRE nothing on this map — the land they open in the other
 * lineage (`beyond_l4`, `beyond_l5`) is authored in ITS ground, and ours is its
 * own. Here they are warmth (ENERGY_PER_LEVEL) and a bar that still moves.
 *
 * Level 3 FIRES nothing either. It opens `level_5`'s land, but the Golden
 * Elder's awakening lives on `GOLDEN_ALTAR.awakenQuestId` — a level the player
 * crosses mid-merge is the wrong trigger for the chapter's one irreversible
 * story beat.
 *
 * The steps must ASCEND (each level costs more than the last): the old 1000
 * made Level 5 cost 580 and Level 6 only 400. 850 keeps the curve monotonic
 * (60 · 160 · 200 · 430 · 550) and stays out of the finale window above.
 */
export const LEVEL_XP = [0, 60, 220, 420, 850, 1400] as const;

/** Max Warmth grows by this much per Keeper level (level 1 = ENERGY_MAX). */
export const ENERGY_PER_LEVEL = 3;
export function levelForXp(xp: number): number {
  let level = 1;
  for (let i = 0; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]!) level = i + 1;
  return level;
}
export function energyMaxForLevel(level: number): number {
  return ENERGY_MAX + Math.max(0, level - 1) * ENERGY_PER_LEVEL;
}

/** Level-up reward: full Warmth refill (handled by EnergySystem) + this Gold. */
export const LEVELUP_REWARD = {
  coinsBase: 25,
  coinsPerLevel: 15
} as const;

/* ------------------------- the Chapter One finale ------------------------- */

/** The Golden Egg MacGuffin: chain + the tier the finale AWAKENS it into —
 *  not a hatchling but the legendary Golden Elder, asleep since the Great
 *  Flame was taken. */
export const GOLDEN_CHAIN = 'golden_egg';
export const GOLDEN_ELDER_TIER = 2;
/** Gold tint worn by the Golden Elder's stand-in art (red-dragon bake) if the
 *  golden rig fails to load — remove alongside the assets.json swap. */
export const GOLDEN_TINT = 0xffd84d;
/** The fogged region the finale glimpses into (the "south terrace" promise). */
/**
 * How many Cookbook pages the Keeper had read the last time she opened it.
 *
 * A stats counter rather than a save field, so it needs no SAVE_VERSION and an
 * old save simply reads 0 — every page it already holds counts as unread once,
 * which is the harmless direction to be wrong in. The dot on the button is the
 * subtraction against `discoveredRecipes.length` (UIScene.syncCookbookDot);
 * both sides only grow, so it can never go negative.
 */
export const COOKBOOK_SEEN_KEY = 'cookbook:seen';

export const FINALE_REGION = 'level_5';
/** XP progress within level 2 past which the Golden Egg starts trembling. */
export const GOLDEN_TREMBLE_PROGRESS = 0.8;

/**
 * The GOLDEN ALTAR — the scenic, NON-playable ledge west of the isle where the
 * whole golden lore plays out: the egg appears there when Eleanor's first order
 * completes, trembles there as Level 3 nears, AWAKENS into the Golden Elder
 * there, and the Elder stands there for the encore (communing taps).
 * Authored in the world builder (`golden-egg.json`: decor `golden-egg` at
 * world cell (-8,-2) = current-map cell (-2,2) after the +6,+4 normalization);
 * `calibration` is the builder's measured placement for the egg art. It is a
 * SCENE FIXTURE, not a board item — never merges, sells, drags, or works.
 */
export const GOLDEN_ALTAR = {
  cell: { col: -2, row: 2 }, // off-grid is fine — gridToWorld is unbounded
  /**
   * The egg is 20% bigger than it was (0.13), and `offsetY` moved WITH it.
   *
   * `anchor.y` is 0 — the art hangs from its TOP — so scaling it up adds every
   * new pixel BELOW the old foot: at 0.156 alone the egg and its ground shadow
   * would sink 23px through the altar ledge. Worse, `eggBottom` is the line the
   * Golden Elder, her shadow and her fallback are all seated on
   * (BoardScene.showAltarElder), so she would stand 23px low for the rest of
   * the session — on the one beat of the chapter that cannot be replayed.
   *
   * -175 is -137 minus the added height in AUTHORED px (1451 x 0.026 = 38), so
   * the foot lands exactly where it lands today: the egg grows UPWARD, and the
   * ledge contact, the shadow and the Elder's ground line do not move.
   */
  calibration: { offsetX: 135, offsetY: -175, scale: 0.156, anchor: { x: 0.5, y: 0 } },
  /** Elder rig display scale at the altar (rig pieces ~550px) — the legendary
   *  Golden Elder reads bigger than a board dragon (upsized on request). */
  elderScale: 0.44,
  /** The egg is authored decor and sits there from the start. Completing THIS
   *  order is half the gate on the awakening — delivered AND `awakenQuestId`
   *  complete puts the Elder on the altar instead (BoardScene.syncGoldenAltar).
   *  The tutorial's `ledger_deliver` beat is what delivers it. */
  orderId: 'eleanor_brazier',
  /**
   * The other half: the quest whose completion WAKES her. This used to be
   * "reach Keeper Level 3", which was demo scaffolding — it made the chapter's
   * one irreversible story beat fire off a number the player crosses while
   * doing something else entirely. It is earned now: the Keeper's Hoard is the
   * last gathering quest before `keepers_tasks` asks the player to commune with
   * her, so she is awake exactly when something first needs her to be.
   */
  awakenQuestId: 'keepers_hoard'
} as const;

/**
 * Keeper Level 3 finale choreography. One timeline, shared by BoardScene (camera
 * to the altar → the Golden Egg cracks → camera home) and UIScene (the Elder's
 * first line) so the two scenes stay in step without cross-scene calls. All ms
 * from the keeper:leveled(3) beat.
 *
 * It used to run on past the awakening into a teaser: a fly to the south
 * terrace, the ash-fog parting halfway, and Chapter-Two silhouettes fading in
 * under the clouds — then a card offering Keep Playing / Play Again. All of that
 * was demo scaffolding and is gone; the finale now ENDS on the Elder and hands
 * the board straight back, so the timeline is half as long.
 */
export const FINALE = {
  hatchAtMs: 900, // camera glides WEST to the Golden Altar…
  // 2300, not 2000: the westward glide grew to 1150 and departs at `hatchAtMs`,
  // so it now SETTLES at 2050 — the egg used to start cracking while the camera
  // was still arriving. 2300 keeps the authored 200ms of stillness before the
  // crack, and the crack's own 600ms still ends at 2900, clear of `elderAtMs`.
  awakenAtMs: 2300, // …where the Golden Egg cracks: the Elder AWAKENS
  elderAtMs: 3200, // she speaks — her first words in the whole game
  returnAtMs: 6000, // camera returns to the player's zone while she finishes
  elderHoldMs: 5200 // her line holds, then play simply continues
} as const;

/** When the finale is over — her line's last frame. Both scenes measure "is the
 *  finale still running?" against this; it used to be the chapter card's cue. */
export const FINALE_ENDS_MS = FINALE.elderAtMs + FINALE.elderHoldMs;

/**
 * Air after the last word of the Gate ceremony before the North Crossing gives
 * up on being spoken open and simply lights. One second, and it is a BACKSTOP's
 * second: by the time it is asked, the ceremony has already overrun every
 * safety net it owns.
 */
export const GATE_LIGHT_GRACE_MS = 1000;

/**
 * WHEN THE NORTH CROSSING MAY LIGHT ITSELF — the latest instant, in ms from the
 * `keeper:leveled(3)`… no: from the `quest:completed` beat that starts the
 * finale, at which the whole ceremony must be over however slowly it ran.
 *
 * The door is the ONE piece of chrome in the chapter whose lit state is not
 * derived from the save within a session: `syncPortalFx` deliberately skips it
 * on live syncs so the awakening is not scooped, and `gate:opened` — emitted
 * from the completion callback of Eleanor's gate speech, itself started from
 * the completion callback of the Elder's — is all that turns it on. Two nested
 * one-shot callbacks: interrupt either (a panel, a scene teardown, a travel
 * mid-sentence) and the arch stays dark for the rest of the session, on a board
 * where the only thing left to do is walk through it. A reload fixes it, which
 * is exactly why it reads as "sometimes there, sometimes not".
 *
 * So it is COMPUTED, not chosen — and computed from the same numbers the two
 * ceremonies are actually paced by, so adding a line to either moves it:
 *
 *   the Elder's release backstop   elderAtMs + max(her lines) * hold + 1000
 * + the Gate speech's own budget   chapterBeatDelay + gate lines * hold
 * + a second of air                GATE_LIGHT_GRACE_MS
 *
 * The first term mirrors `UIScene.runFinaleUi`'s own backstop exactly: it is
 * the last moment `releaseFinaleStage` can run, and the gate speech starts from
 * there. A door lit at this instant can never cut Eleanor off — she cannot
 * still be talking, by her own per-line net.
 */
export function gateLightBackstopMs(
  elderLines: number,
  prophecyLines: number,
  gateLines: number
): number {
  const releaseLatest =
    FINALE.elderAtMs + Math.max(elderLines, prophecyLines, 1) * STORY_BEAT_HOLD_MS + 1000;
  const ceremony = TIMINGS.chapterBeatDelay + gateLines * STORY_BEAT_HOLD_MS;
  return releaseLatest + ceremony + GATE_LIGHT_GRACE_MS;
}

/**
 * How long the travelling curtain may stay up without the board saying it is
 * ready before UIScene lifts it anyway and complains in the console.
 *
 * Generous on purpose: this is a floor under a failure, not a load budget. The
 * destination's backdrop is one 2610×1632 image and the veil normally lifts in
 * well under a second, so anything past twenty is a broken build rather than a
 * slow one — and a board the player can see and poke at beats a black scrim
 * they cannot dismiss.
 */
export const TRAVEL_VEIL_TIMEOUT_MS = 20_000;

/** Portal FX height in world px — sized to Eleanor's standee, so a door reads
 *  as tall as the people who use it. The tap area is the FX's own bounds
 *  (PortalFX.hitSize), never a smaller rectangle inside the glow. */
export const GATE_FX_HEIGHT = 380;

/**
 * Where an arriving dragon comes out: clear of the ARCH, and clear of the
 * PERSON standing by it.
 *
 * Both halves are load-bearing, and the second was learned the hard way. A
 * dragon used to come out ON the door — measured, the six crossings landed
 * 0.19..2.69 tiles from their own arch. Pushing it four tiles down the road
 * then seated it on Eleanor's doorstep instead, because Roothold's arch and
 * Roothold's innkeeper are 3.4 tiles apart: "four from the door" is BEHIND her,
 * not away from her. So the rule is stated against both landmarks.
 *
 * A TILE IS THE TILE BY THE DOOR, not the candidate's own. That sounds like a
 * detail and is the entire bug the first version shipped: measuring each
 * candidate against ITS OWN zone let a small-tiled slab qualify at a shorter
 * real distance, and Eleanor's two-cell slab (89px tiles against the plaza's
 * 95.6) cleared a 4-tile bar at 357px — 1.6px over its own threshold, and
 * therefore NEARER than the honest candidates, so the sweep chose it. The
 * dragon landed one tile from her and the owner reported, correctly, that
 * nothing had changed. One unit for the whole sweep, taken from the ground the
 * arch actually opens onto.
 *
 * `slackCells` is the ceiling, and it is not a nicety. The Rune Way's door
 * stands on a ONE-CELL island: past two tiles the nearest ground it could
 * legally take is 8 tiles away across open sky, which is exactly the "he came
 * out miles away" the door anchor exists to prevent. So all of this is a
 * PREFERENCE — honoured only when a cell satisfies every part of it — and a
 * door with no such cell keeps the old answer, beside the arch.
 *
 * Probed against the shipped data. Roothold now lands (74,0): 4.53 tiles from
 * its arch and 4.57 from Eleanor, out on the open plaza. Emberkeep→Roothold
 * 4.62, Emberkeep→Borealis 4.08, Borealis→Emberkeep 4.41, Borealis→Runevault
 * 4.04 — none of them moved, their people being nowhere near their doors. The
 * Rune Way's island keeps its 0.19 and its cell.
 */
/**
 * `residentCells`: a world with somebody home RECEIVES an arriving dragon —
 * it seats this many of the resident's own tiles from her anchor (nearest
 * qualifying ground), which is "beside her" without standing on her slab
 * (the slab's far half sits 1.26 tiles out). The standoff pair below is the
 * fallback law for a world with nobody home: a few paces clear of the arch.
 */
export const GATE_LANDING = { residentCells: 1.5, standoffCells: 4, slackCells: 2, folkCells: 3 } as const;

/**
 * Portal colours, keyed by DESTINATION — the door wears where it goes, so the
 * player learns the routes by colour before they learn them by name:
 * flame red/pink carries you home to Emberkeep, forest green to Roothold,
 * ice blue north (Borealis and Selyna's Hatchery both).
 */
export interface PortalTints {
  glow: number;
  core: number;
  heart: number;
  streaks: [number, number];
  sparks: number[];
  motes: number[];
}
export const PORTAL_TINTS: Record<string, PortalTints> = {
  emberkeep: {
    glow: 0xd63a5f,
    core: 0xff7a95,
    heart: 0xffe8ee,
    streaks: [0xff9ab0, 0xe84f70],
    sparks: [0xffe0e8, 0xff9ab0, 0xf05f80],
    motes: [0xff9ab0, 0xf07090]
  },
  roothold: {
    glow: 0x2f8f4a,
    core: 0x66cf7a,
    heart: 0xeaffe8,
    streaks: [0x8fe8a0, 0x3fae5c],
    sparks: [0xeaffdd, 0x9fe8a0, 0x4fbf6a],
    motes: [0x9fe8a0, 0x63c979]
  },
  borealis: {
    glow: 0x2f7fd6,
    core: 0x6fd0ff,
    heart: 0xeafaff,
    streaks: [0xa9e7ff, 0x4fa8e8],
    sparks: [0xe8fbff, 0xa9e7ff, 0x5fb8f0],
    motes: [0xa9e7ff, 0x6fc0f0]
  },
  runevault: {
    glow: 0x2f7fd6,
    core: 0x6fd0ff,
    heart: 0xeafaff,
    streaks: [0xa9e7ff, 0x4fa8e8],
    sparks: [0xe8fbff, 0xa9e7ff, 0x5fb8f0],
    motes: [0xa9e7ff, 0x6fc0f0]
  }
};

/**
 * THE CAULDRON-REACHED LATCH (owner's law, 2026-08-26): the moment any world's
 * quest ladder puts its FIRST brew quest at the head — the player is being
 * ASKED to use the pot — is a story fact with a second key on it. It is the
 * alternative to rank for everything the Rune Way stands behind: Borealis's
 * level-gated cloud slabs and the Runevault door itself open on Keeper level
 * OR on this latch (`worldGates.cloudLevelMet`), so the ladder can never ask
 * for a brew the player cannot reach, and a max-rank player never waits on
 * quests either.
 *
 * QuestSystem derives and writes it (once, monotonic — `q:cauldron:reached`
 * in `stats`, so it ships in the save with no schema change) and announces it
 * as `quest:cauldron_reached`.
 */
export const CAULDRON_REACHED_STAT = 'q:cauldron:reached';

/**
 * THE ELDER WAKES ON RANK (owner's call, 2026-08-27). Reaching the level that
 * opens Borealis IS the awakening now: the finale — camera to the altar, the
 * egg cracking, her first words, Eleanor speaking the Gate open — rides the
 * `story:elder_wakes` fact, which StorySystem emits exactly once when the
 * Keeper's level reaches the north's own `level`. This latch records that the
 * ceremony has PLAYED (monotonic, in `stats`, so it ships in the save): the
 * altar derives her standing from it (or from the legacy `q:done` latch), and
 * a reload can never replay the chapter's one irreversible beat.
 */
export const ELDER_WOKEN_STAT = 'story:elder_woken';

/** The Roothold house — the Emporium's painted storefront — as a world-px
 *  rect: roothold.webp [755, 205, 330, 340] through the shared art→world
 *  transform (build-zones: origin (1584.8, 954.2), unit 1.2190). Tapping it
 *  opens the shop; the arrival tour points at it. */
export const ROOTHOLD_HOUSE = { x: 915, y: 209, width: 402, height: 414 };

/* --------------------------- welcome-back moment -------------------------- */

/** Only show the "While you were away" card after a real absence. */
export const WELCOME_BACK_MIN_MS = 300_000;
/** Passive producers bank up to this many overdue cycles while offline — a
 *  small waiting harvest (never 1, never unlimited; MECHANICS §4.3). */
export const OFFLINE_BANK_CYCLES = 3;

/** How one world's blocker clouds look and behave. */
export interface FogStyle {
  /** Texture key for the per-tile cloud cap. */
  tile: string;
  /** Whether lightning flickers inside the banks. */
  storm: boolean;
}

/**
 * The cloud a world's blockers wear. A world names its own here; the ones that
 * don't get the pale blanket the world builder paints, and no weather.
 * Keyed by world id (`WorldRuntime.id`), NOT by anything the editor re-exports,
 * so a re-export of the worlds never silently repaints the sky.
 */
export const FOG_STYLE_BY_WORLD: Readonly<Record<string, FogStyle>> = {
  // `emberkeep` is the world built from the nb2-4k-aligned editor map
  // (scripts/build-zones.mjs `editorMap`) — the board the player lands on.
  emberkeep: { tile: 'cloud_tile', storm: true }
};
export const FOG_STYLE_DEFAULT: FogStyle = { tile: 'cloud_tile', storm: false };

/**
 * How the per-tile cloud caps become ONE bank instead of a grid of stamps.
 *
 * The projection's width reference is fixed at `TILE_W` (iso.ts `projectionOf`)
 * and the cap art is exactly `TILE_W` wide, so at scale 1 neighbouring clouds
 * abut EDGE TO EDGE — never overlapping, never gapping. That is the staircase:
 * identical silhouettes tiling perfectly. Overlap plus per-cell variation is
 * what dissolves it.
 *
 * NO MIRRORING here, deliberately. Flipping alternate caps is the obvious way
 * to break the repetition, and it is closed to us: BOTH caps are lit from one
 * side. Measured off the art, the white cap's highlight runs 7:1 to the RIGHT
 * and the dark cap's gold rim 10:1 to the LEFT — mirroring either would put
 * the sun on both sides of the same bank. Any future cap wants the same check
 * before the idea comes back.
 */
export const FOG_BLANKET = {
  /** Cap size as a multiple of its tile. >1 so neighbours overlap. */
  overlap: 1.22,
  /** Per-cell size variation, ± this fraction. */
  scaleJitter: 0.07,
  /** Per-cell offset, ± this fraction of a tile. Kept small: the tap target is
   *  shifted back by the same amount, but the cap still has to cover its cell. */
  offsetXFrac: 0.08,
  offsetYFrac: 0.05,
  /**
   * Exposure is GRADED, not a threshold: `(interiorNeighbours − sides) / 4`,
   * so a cap frays in proportion to how much open sky it faces.
   *
   * A yes/no test looks right and is wrong. `level_2` is eight cells in two
   * thin arms and its most enclosed cap has THREE neighbours — under a
   * "4 neighbours = interior" rule not one cap in the region counted as
   * interior, so the whole bank frayed and kept its staircase while the fat
   * regions beside it fused. Most authored banks are arms and elbows, not
   * blobs; almost nothing has four neighbours.
   */
  interiorNeighbours: 4,
  /** Shrink at FULL exposure (no neighbours at all); scaled down by exposure. */
  edgeShrink: 0.07,
  /**
   * Alpha at full exposure. An enclosed cap sits at `coreAlpha`.
   *
   * Kept HIGH on purpose. Fading exposed caps was the first attempt at a soft
   * rim and it is the wrong lever: a bank made of thin arms is nearly all
   * exposed cells, so the whole thing went see-through — lava reading straight
   * through the cloud, next to a fat bank that stayed solid. A cloud you can
   * see through does not read as a cloud. The rim softens by SIZE; opacity
   * barely moves.
   */
  edgeAlpha: 0.96,
  /** A cap needs at least this many neighbours to be worth an under-pass —
   *  below it it is a lone puff and the broad pass would spill onto open
   *  ground. At 1, a thin arm still gets its mass: `underExposureShrink` has
   *  already pulled the pass down to barely wider than the cap by then. */
  underNeighbours: 1,
  /** How much of the under-pass's size exposure takes away, at full exposure. */
  underExposureShrink: 0.3,
  /** Opacity of a cap deep inside the bank. */
  coreAlpha: 0.995,
  /**
   * The UNDER-PASS: one bigger, dimmer copy of the cap drawn behind the bank,
   * INTERIOR CELLS ONLY.
   *
   * Overlap alone does not close the bank. Each cap is a dome, so between two
   * crowns in a row there is a valley, and through it you see the bright ember
   * base of the row behind — the red seams that make the bank read as stacked
   * rows rather than as weather. Pushing `overlap` up far enough to close them
   * just makes the stamps bigger and their repetition MORE obvious; a broad
   * dim pass behind plugs the valleys and costs nothing in silhouette.
   *
   * Interior only, deliberately: on the rim that exposed ember base is the
   * thing that makes the bank look lit from beneath, and an under-cap there
   * would only make the outline blobbier.
   */
  underScale: 1.5,
  underAlpha: 0.85,
  /** The breathing tween's targets, as multiples of the cap's own base. */
  breathScaleX: 1.02,
  breathScaleY: 1.035,
  breathAlpha: 0.905
} as const;

/**
 * The storm inside a cloud bank — pure ambience, and deliberately SPARSE.
 *
 * A strike is rolled per tick rather than fired on a fixed period: a bolt every
 * exactly-N-seconds reads as a metronome, and weather has to feel like it might
 * not happen. At these numbers a given bank flashes roughly every 7 s.
 */
export const FOG_STORM = {
  tickMs: 1400,
  /** Probability a tick strikes at all. */
  chance: 0.2,
  /**
   * Every size below is a FRACTION of the cloud the bolt strikes, never a pixel
   * count: the cap art is 240x300 painted but 174 tall on screen, zones scale
   * their art from 0.90 to 1.17, and a fixed number would be twice too big on
   * the authored isle and wrong again on the next zone.
   */
  /** Lateral spread of the strike, as a fraction of the cloud's width. */
  jitterFrac: 0.35,
  /** Bolt height, as a multiple of the cloud's — >1 so the fork clears the base. */
  boltHeightRatio: 1.35,
  /** How far ABOVE the cloud's anchor the fork hangs from, as a fraction of its height. */
  hangFrac: 0.2,
  /** Glow width, as a multiple of the cloud's. */
  glowWidthRatio: 1.2,
  /**
   * Deliberately low. This cloud is dark on purpose, and an additive gold disc
   * strong enough to "light it up" washes it back to the pale blanket the art
   * was made to replace. The flash has to read as light INSIDE a dark cloud.
   */
  glowPeakAlpha: 0.3,
  /**
   * The flicker, as [alpha, hold-ms] beats. Real lightning is a strike, a gap
   * and a brighter restrike — a single fade in and out reads as a lamp.
   */
  beats: [
    [1, 45],
    [0, 55],
    [1, 80],
    [0.5, 60]
  ] as ReadonlyArray<readonly [number, number]>
} as const;

/** Item motion & juice timings (ms unless noted). */
export const TIMINGS = {
  dragReturn: 290,
  mergeGather: 170,
  spawnPop: 310,
  hatchShake: 540,
  hatchPop: 380,
  fogLift: 900,
  fogStaggerPerTile: 50,
  warmFlash: 1100,
  tileBloom: 700,
  harvestHop: 330,
  bubbleIn: 310,
  /** Wait after an order celebration before a chapter beat opens — her
   *  reaction has to land AFTER the thing she is reacting to. */
  chapterBeatDelay: 2600,
  bobPeriodMs: 2400,
  bobAmplitudePx: 5.2,
  fogPulsePeriodMs: 4200,
  readyPulse: 600
} as const;

/**
 * Drag feel (Fairyland / Merge-Dragons style — see docs/research/drag-feel.md).
 * The dragged item EASES toward the pointer (exponential smoothing) instead of
 * locking 1:1, lifts with a ground shadow, and the target cell lights up.
 */
/**
 * THE SKIP KEYS — the pair of plates a waiting generator floats under itself.
 *
 * They are ONE offer in two currencies, so they have to read as a pair. At 150
 * apart on a 193-wide plate they sat with 107px of board showing between them,
 * which reads as two unrelated buttons that happened to appear together, and
 * the pair was wider than the House it belonged to. Every number here is that
 * pair's geometry, in board pixels; `coinDx`/`labelDx` are measured from each
 * plate's own centre.
 */
export const SKIP_KEYS = {
  dx: 92,
  scaleX: 0.38,
  scaleY: 0.44,
  fontPx: 26,
  coinDx: -28,
  labelDx: 18
} as const;

/**
 * EDGE CARRY — holding a dragged piece against the screen's edge scrolls the
 * world under it, so a piece can cross a board wider than the view in ONE
 * gesture. The margin is a fraction of the viewport's short side; the speed is
 * screen pixels per second (converted through the live zoom), ramping from 0
 * at the margin's inner lip to full at the screen edge so entering the zone
 * never jerks.
 */
export const EDGE_SCROLL = {
  marginFrac: 0.09,
  speedPxPerSec: 1500
} as const;

/**
 * HOLD-TO-PAN — on touch, the finger's first meaning is the PIECE, not the
 * camera. A swipe that begins on empty ground does nothing; holding still on
 * empty ground for `holdMs` arms the pan (confirmed by a light haptic), and
 * only then does dragging move the view. `slopPx` is how far the held finger
 * may wander (game-space px — the phone maps ~6.5 of them to one CSS px) and
 * still count as holding; `announcePx` is how far an armed pan must actually
 * travel before it is announced as the fact `camera:panned` (the mobile
 * tutorial beat's gate). Desktop mice keep the immediate drag-pan.
 */
export const HOLD_TO_PAN = {
  holdMs: 350,
  slopPx: 60,
  announcePx: 90
} as const;

/**
 * THE SOFT GROUND SHADOW every board item casts, as the numbers that decide it.
 *
 * These were four magic numbers spread across `BoardItem` — the fit width, its
 * floor, the squash and the seat — and they are the whole of "does this piece
 * look like it is standing on the tile". A piece whose art is drawn with its
 * feet high in the frame, or whose silhouette is much narrower than its plate,
 * needs its own; that is what `anchors.json`'s `shadowByKey` is for, and these
 * are the defaults it overrides one key at a time (the worldbuilder's 🪞 Seat
 * page writes them).
 */
export const ITEM_SHADOW = {
  /** Ellipse width as a fraction of the art's on-board footprint. */
  ofWidth: 0.92,
  /** Floor, so a tiny piece still casts something a player can read. */
  minWidth: 64,
  /** Height as a fraction of width — the isle's light is near-flat, so the
   *  contact patch spreads sideways rather than pooling under the piece. */
  squash: 0.42,
  /** Where the ellipse sits under the art, in container px. The lean puts it
   *  back exactly here (`clearLean`), so nothing may write it by hand. */
  seatX: 0,
  seatY: 8
} as const;

export const DRAG = {
  /** Pick-up scale-up and how high the art floats above the finger (px). */
  liftScale: 1.16,
  liftY: -34,
  liftMs: 120,
  settleMs: 210,
  /**
   * WHERE A CARRIED PIECE IS CONSIDERED TO BE STANDING.
   *
   * `dropCellUnderDrag` samples the board a little BELOW the art it is carrying,
   * so a piece lands on the cell its feet are over rather than the one its
   * middle crosses. As a fraction of the piece's own displayed height rather
   * than a flat number of pixels: the roster runs from a 48 px Dew Drop to
   * pieces well past 120, and one constant that suits the tall ones is half a
   * body on the short ones — the sample clears the art entirely and answers
   * with the next cell down. The cap keeps the tallest pieces (Manors, adult
   * dragons) from reaching a cell away.
   */
  dropBiasOfHeight: 0.28,
  dropBiasMaxPx: 24,
  /**
   * How much the item's own SOFT ground shadow swells while it is held.
   *
   * There is deliberately NO second drag-only shadow shape. A lifted piece used
   * to light a sharp dark ellipse (shadowRX/RY/Y/Alpha/Color) on top of the soft
   * one every item already casts — two shadows for one object, which reads as a
   * rendering bug rather than as weight. One shadow, and lifting makes it grow.
   */
  shadowGrow: 1.32,
  shadowFadeMs: 175,
  /**
   * The drop-target reticle on the cell under the dragged item.
   *
   * A RETICLE, not a slab. It used to be the whole diamond filled at half alpha
   * with a line round it, which is the honest first version of "show the cell"
   * and reads as a coloured tile: it competes with the art it is under, and at
   * the pitch of the smaller zones two neighbouring highlights look like ground
   * rather than like a choice.
   *
   * Corner brackets say the same thing in a quarter of the ink — the four
   * vertices are marked, the edges between them are left open, and the eye
   * closes the shape by itself. It is the targeting frame every action game
   * uses for exactly this, and it stays legible over dark rock and pale
   * flagstone alike because it is line rather than wash.
   *
   * `bracketSpan` is the fraction of ONE EDGE each arm covers, so the geometry
   * follows the zone's own diamond rather than a fixed pixel length — Runevault's
   * 133px tile gets the same proportion as the authored isle's 256px one.
   */
  cellHighlightColor: 0xffd27a,
  /** The brackets themselves: near-opaque, so the frame is the thing you see. */
  cellHighlightAlpha: 0.9,
  cellBracketWidth: 5,
  cellBracketSpan: 0.32,
  /** A breath of wash inside, only enough to say WHICH side of the line is the cell. */
  cellFillAlpha: 0.12,
  /**
   * THE RETICLE KNOWS WHAT THE DROP WILL DO, before the finger lets go.
   *
   * With the magnet gone, the only thing that fuses is a drop ON a matching
   * piece — so the one question a player has mid-drag is "am I over one?".
   * Hovering a matching piece whose cluster plus this one reaches the recipe
   * paints the brackets in the merge green and swells the wash; hovering a
   * match that falls short (the drop will GATHER, seating the piece beside it)
   * paints them in the ember. Free ground keeps the neutral gold, and a drop the
   * board will REFUSE — an occupied cell that is not a merge question, or a
   * match walled in with nowhere to seat the piece — goes grey and quiet.
   * Four colours, four verbs, read off the frame alone.
   *
   * The refusal is the one that had to be added rather than designed: the
   * neutral gold means "it lands here", and painting it over a stranger's tile
   * was the frame promising a landing that bounces. Grey is not a warning, it
   * is an absence — the frame stops offering, which is the whole message.
   */
  mergeColor: 0x8fe8a0,
  gatherColor: 0xff9ab0,
  refuseColor: 0x8d8189,
  verbFillAlpha: 0.28
} as const;

/**
 * THE LEAN — a complete cluster showing it wants finishing.
 *
 * Three alike in a row no longer fuse by themselves; they are the board's way
 * of saying "one drop, here". Every member but the centre STRAINS toward the
 * centre and back, all of them together. A player who has not noticed the rule
 * sees three things pulled toward one, which is the rule. The hint's hand takes
 * over at `MERGE_HINT.idleMs` if the strain was not enough.
 *
 * IT IS ALSO HOW THE GAME POINTS. Whatever the player is being ASKED to carry
 * — the tutorial beat's hand, the idle hint's first step — strains toward the
 * cell it is being sent to, on these same numbers at the hint volume. That
 * replaced a vertical hop on the single named piece, which said "this one" and
 * nothing about where; and it is why the very first lesson, where no cluster is
 * complete yet, now has a magnet at all.
 *
 * ONE CLUSTER, AND IT KEEPS THE FLOOR. Three Eggs and three Gems both complete
 * is two things the board wants to say, and saying them at once is saying
 * neither: the eye reads a board that shivers rather than a group that belongs
 * together. So only the OLDEST ready cluster leans, and it goes on leaning
 * until the player finishes it or breaks it up — no rotation, nothing else
 * moving in the corner of the eye. `periodMs` is that one cluster's pulse.
 *
 * TUNED BY EYE, TWICE. The first pass was a 14 px nudge over a 2.4 s cycle —
 * correct, invisible, and reported as missing. What reads as a magnet is not a
 * bigger translation on its own but translation PLUS stretch: the art elongates
 * along the line it is being pulled down, the way a body leans into a rope.
 * `stretch` is that elongation at full reach, spent along the lean's own axis
 * (mostly horizontal in iso) and paid for by a little thinning across it, so
 * the piece strains instead of merely swelling.
 *
 * `fraction` is the share of the gap between a member and the centre that the
 * lean covers, capped by `amplitudePx` so a zone with big tiles does not get a
 * bigger lean than one with small. The piece still never leaves its cell:
 * a quarter of the way to its neighbour is as far as it goes.
 */
export const MERGE_READY = {
  // The whole rhythm, 15% slower than it first shipped (owner's call, watched
  // rather than reasoned about: 300/1500/240 read as a twitch rather than as a
  // pull). Scaled together on purpose — slowing the stroke while keeping the
  // cadence would only have eaten the rest between pulses.
  periodMs: 1765,
  leanMs: 353,
  fraction: 0.24,
  amplitudePx: 30,
  /**
   * THE SAME STRAIN, SAID LOUDER, while the hint's hand is up on that cluster.
   *
   * The resting lean is an invitation you can ignore; ten seconds of not
   * touching the board (`MERGE_HINT.idleMs`) is the game deciding you did.
   * From there the hand and the board have to say ONE thing — the hand names
   * the piece to carry, the rest of its cluster pulls visibly toward where it
   * is going — so the pull reaches further, on a shorter rest, until the offer
   * is answered or withdrawn. Same geometry, same direction; only the volume
   * changes, because a second, different gesture would be a second message.
   */
  hintFraction: 0.38,
  hintAmplitudePx: 48,
  hintRestMs: 282,
  /** Elongation along the lean axis at full reach (see above). */
  stretch: 0.13
} as const;

/** The authored decor piece (zones.json `decor` name) that opens Selyna's
 *  Cauldron when tapped. It stands in the Runevault hub; the panel itself is
 *  world-agnostic because the cauldron trades only in the Bag. */
/**
 * THE IDLE MERGE HINT — how long a board sits untouched before the hand offers
 * a move, and how long it waits again after one is made.
 *
 * Ten seconds is long enough that a player who is thinking is never
 * interrupted, and short enough that one who looked away comes back to help
 * rather than to a puzzle. The two numbers are separate on purpose: the first
 * is the cost of distraction, the second the cost of interrupting momentum,
 * and they are free to diverge if either turns out wrong in play.
 */
/**
 * `followUpMs` is the third: how long the hand waits before showing the NEXT
 * drag of a plan the player is already following. A merge on a spread board is
 * two or three gestures, and making someone idle ten seconds between them
 * turns help into a stutter — they have just proved they are cooperating. Long
 * enough only for the piece to finish landing.
 */
/**
 * `repulseMs` is the HEARTBEAT — how often a hint that is already up says it
 * again.
 *
 * An offered hint used to be a one-shot: the board set it and then returned
 * early on every tick for ever, so a player who did not act got ONE answer,
 * computed once, and nothing after it. Two things go wrong with that and both
 * read as "the hint does not really work". The plan goes STALE — it is only
 * re-derived on a board change, so a hand raised while the board was crowded
 * goes on asking for the gather it worked out then. And the offer can be
 * REFUSED without the board hearing: UIScene owns the hand, and a tutorial
 * beat or a carry lesson holding it makes `hint:merge` a no-op — the board
 * still believes a hand is up, so it never offers again for the rest of the
 * session. A heartbeat repairs both without either side knowing about the
 * other: whatever went wrong, the next pulse re-plans and re-asks.
 *
 * Thirty seconds, not ten. `idleMs` is the cost of DISTRACTION — how long a
 * quiet board waits before anyone is offered anything — and it is short because
 * arriving to help is the whole point. This is the cost of INSISTENCE, paid by
 * someone who has already been shown the answer and has not taken it, and at
 * ten seconds that is three re-poses a minute of a gesture they are ignoring,
 * which is nagging. Thirty is roughly the span the hand's own loop takes to
 * play out several times (`placeHand`'s cycle is ~1.6s), so a pulse lands as a
 * fresh reading of the board rather than as an interruption of one.
 */
// followUpMs 5000, up from 490 (owner's call): the half-second follow-up hand
// after a plan's first merge read as the hint "showing up too fast" — every
// appearance of the hand now waits at least five seconds of idle.
export const MERGE_HINT = { idleMs: 10_000, restMs: 10_000, followUpMs: 5_000, repulseMs: 30_000 } as const;

/**
 * WHAT THE HAND WEIGHS — the merge hint's decision, written as numbers.
 *
 * The planner (src/core/mergeHints.ts) can usually make several merges. Which
 * one it OFFERS used to be settled by effort alone — fewest drags, then the
 * shortest swipe, then whichever set had waited longest. That is a fine model
 * of what a move COSTS and says nothing about what it is WORTH, and measured
 * over 1200 generated mid-session boards on the three exported worlds it is
 * daft on a fifth to a half of them: it points across the isle when an equally
 * cheap merge sits under the player's hand (20.7% / 23.0% / 22.5% of boards
 * more than half a screen further away than it had to be), off the edge of the
 * screen while an equally cheap one is in frame (17.9% / 14.8% / 1.5%), at two
 * tier-1 trinkets while a tier-2 pair costs exactly the same (17.1% / 48.3% /
 * 43.5%), and at a chain no standing order asks for while an equally cheap one
 * would fill the Ledger (2.5% / 8.0% / 13.0%).
 *
 * So the offer is SCORED, in merit points, and these are the terms. Every one
 * of them is a claim about what a thinking player would do next, and every one
 * of them is arguable — which is the point of writing them as eight numbers
 * rather than as a sort order. Raising one is a design decision, not a tuning
 * accident.
 *
 * THE ONE STRUCTURAL RULE: `drag` alone is larger than every other weight
 * added together, so no combination of merit can ever talk the hand into
 * asking for an extra drag. Effort is not one voice among several — it is the
 * floor the rest of the argument stands on, and a hint that asks for two drags
 * while a one-drag merge sits on the board is the exact defect the effort
 * ranking was introduced to remove. `MergeHints.spec.ts` asserts the
 * inequality so a future weight cannot quietly break it.
 */
export const MERGE_HINT_WEIGHTS = {
  /** Per drag BEYOND THE FIRST. Dominant by construction: > the sum of the
   *  rest, so fewer drags always wins whatever else is true. */
  drag: 120,
  /**
   * Being near where the player last acted.
   *
   * The largest soft term, because it is the one the player reads as
   * intelligence. Two one-drag merges are not equally good if one is a nudge
   * beside the piece they just dropped and the other is across the isle: the
   * hand that stays in the neighbourhood of the work looks like it is watching,
   * and the hand that teleports looks like it is guessing. Falls off
   * hyperbolically (`nearHalfTiles`), never to a cliff — there is no distance
   * at which a merge stops counting, only one at which it stops being handy.
   */
  near: 30,
  /** The swipe the plan asks for, in tiles. Costs less than a whole extra drag
   *  (that is what `drag` is for) and more than any single merit below it: a
   *  cross-map haul is real work even when it is only one gesture. */
  haul: 20,
  /** Any of it visible on screen right now. A hand pointing off the edge of
   *  the viewport is an instruction the player cannot follow without first
   *  finding what it means — and only the FIRST offer moves the camera, so
   *  every re-aim and every heartbeat after it speaks from where the player
   *  chose to be looking. */
  frame: 14,
  /** How deep into its chain the merge is, as a fraction (tier 1 scores 0, the
   *  last mergeable tier scores 1). Three Gem Shards are always available and
   *  always coming; two Flame Gems standing idle are an opportunity the player
   *  worked for and has forgotten. Worth less than proximity, because a deep
   *  merge across the isle is still a trek. */
  tier: 12,
  /** Offered, seen, and left alone. Not a ban — `skip` is the ban — but enough
   *  merit to hand the turn to a different merge once the player has declined
   *  this one `declineCap` times. A hand that insists is nagging. */
  declined: 12,
  /** It MAKES something a live order or quest still asks for. What the player
   *  is trying to do is worth more than what happens to be lying around. */
  order: 10,
  /** It EATS something a live order still asks for — three Gem Shards merged
   *  away from an order that wants six. Slightly smaller than `order` so a
   *  merge that both feeds a deeper goal and spends a shallower one still
   *  reads as progress. */
  orderSpend: 8,
  /** Distance at which the proximity merit is halved, in tiles. Four is about
   *  a quarter of the visible board at the framing the camera holds — near
   *  enough to mean "by your hand", far enough that the whole neighbourhood
   *  counts. */
  nearHalfTiles: 4,
  /** Swipe length at which the haul penalty is half-spent, in tiles. Three is
   *  roughly the reach of one comfortable drag. */
  haulHalfTiles: 3,
  /** Declines past this stop making it worse — the penalty saturates rather
   *  than burying a merge for ever. */
  declineCap: 3,
  /**
   * How many candidate SETS one chain:tier may put forward.
   *
   * A bucket of six Gem Shards holds twenty possible trios. The planner used to
   * consider exactly one of them — the tightest — which is why it could point
   * at a huddle across the isle while three of the same kind sat around the
   * player's last move (15.9% of Emberkeep boards, 16.0% of Borealis). It now
   * puts forward the tightest trio around EACH piece, deduped, and keeps the
   * cheapest few by their proven drag floor. Four is where the measured defect
   * flattens; every extra one is a planning pass that almost never wins.
   */
  groupsPerBucket: 4,
  /** Scores are compared as integers on this grid. Floating point ties are
   *  exact when the arithmetic is identical, but quantising first means two
   *  plans that differ by a rounding artefact fall to the stable tie-break
   *  (first-completed, then the set's own ids) instead of to iteration order. */
  quantum: 1_000_000
} as const;

/**
 * The travel wipe — the screen burns away into iso diamonds when the Keeper
 * crosses worlds, and reassembles on the far side (UIScene's veil; shader in
 * render/fx/travelWipeShader.ts, which documents the technique). The cover
 * hides the old board before the scene restart tears it down; the reveal waits
 * out `world:ready` PLUS the new board camera's own 320ms fade-in, so lifting
 * the curtain never shows a world still arriving out of black.
 */
export const TRAVEL_WIPE = {
  coverMs: 780,
  /** Fully-covered floor even on an instant (resident-art) hop — a
   *  same-session return journey loads in one frame, and a veil that blinked
   *  would read as a glitch, not a crossing. */
  holdMinMs: 480,
  /** After `world:ready`, before the reveal starts — spans the board camera's
   *  fade-in closely enough that nothing arrives out of black. */
  revealDelayMs: 340,
  revealMs: 760,
  /** Diamonds across the SHORT screen axis — cell size follows the device, so
   *  a portrait phone gets the same chunky tiles as a desktop. */
  cellsShort: 7,
  /** Fraction of the wipe timeline one diamond takes to grow to full size. */
  growFrac: 0.3,
  /** Per-diamond ignition jitter (timeline fraction) — fire catching, not an
   *  iris closing. */
  jitterFrac: 0.14,
  /** Ember rim thickness in cell units (goldAccent -> lava, cools at hold). */
  edge: 0.16
} as const;

/**
 * THE TUTORIAL CAMERA FOLLOWING ITS OWN POINTER.
 *
 * `INSET` is the margin, as a fraction of the view, inside which a target
 * counts as already comfortably in frame — the camera holds still for anything
 * within it. It is not zero because "technically on screen" is not the same as
 * "seen": a cell hugging the bottom edge sits under the HUD, and one at the far
 * right is where the eye looks last. A sixth of the view in from each side puts
 * the pointer in the middle two-thirds, which is where a lesson belongs.
 *
 * `MS` is the glide. Long enough to read as the world turning rather than
 * cutting — a jump loses the player's place, which is the whole thing the
 * follow exists to protect.
 */
/**
 * THE TUTORIAL HAND — the gauntlet that demonstrates a drag or a tap.
 *
 * It is a puppet, not a cursor: it fades in slightly raised, PRESSES down on
 * the piece, tilts back as it pulls, and pops on release. Every beat of that
 * used to be a literal inside `UIScene.placeHand`, which is exactly the kind of
 * number nobody can find when the gesture reads as frantic — the rest between
 * loops was added for that reason and had to be hunted for. Named here so the
 * worldbuilder's ⏱ Tuning page can drive them.
 *
 * `travelMs` is ONE stroke carried by two tweens (the tilt and the travel); they
 * must stay equal or the hand finishes leaning before it arrives.
 */
export const TUTORIAL_HAND = {
  /** Drag gesture: fade in from a raised, tilted pose. */
  fadeInMs: 310,
  /** How long the hand takes to carry the piece across. */
  travelMs: 1200,
  /** The overshoot pop as the item drops. */
  releaseMs: 200,
  fadeOutMs: 260,
  fadeOutDelayMs: 220,
  /** A beat of rest before the gesture starts over. Without it the hand reads
   *  as frantic rather than as a demonstration. */
  restMs: 450,
  /** Tap gesture: press in, then a springy release. Paired with the bob's own
   *  chain — equal loop delays, or the tap splits in two. */
  tapDownMs: 260,
  tapUpMs: 430,
  tapLoopDelayMs: 200,
  /** Pose: the raised start, the press, and the release pop, as scale factors
   *  of the marker's base size. */
  startScale: 1.08,
  pressScale: 0.9,
  releaseScale: 1.05,
  /** How far the hand dips on a tap, in live px. */
  bobPx: 14,
  /** Tilt as it starts, and as it pulls, in degrees. */
  startAngle: -5,
  pullAngle: 4
} as const;

/**
 * THE TUTORIAL ARROW — the pointer that names a piece or a control.
 *
 * The same puppet law as the hand: rise, drop with weight, land with a squash,
 * then a settle beat before the next hop. A bob that merely oscillates reads as
 * a screensaver; the impact is what makes it point.
 */
export const TUTORIAL_ARROW = {
  /** How far it rises before the drop, in live px (negative is up). */
  riseBy: -22,
  riseMs: 380,
  /** Accelerating fall onto the target. */
  dropMs: 300,
  /** The landing squash, and how wide/flat it goes. */
  impactMs: 90,
  impactScaleX: 1.08,
  impactScaleY: 0.9,
  /** Rest before the next hop. */
  settleMs: 240
} as const;

export const TUTORIAL_FOLLOW_INSET = 1 / 6;
export const TUTORIAL_FOLLOW_MS = 880;

/** The save latch for the gate lesson — the hand that teaches world travel by
 *  drawing "carry the dragon to the arch" once, after Eleanor's Emporium visit.
 *  A `stats` counter like the tours', so it is taught once ever and a player who
 *  ignored it still finds it waiting next session. */
export const GATE_LESSON_STAT = 'lesson:gate_carry';

export const CAULDRON_DECOR = 'pink_cauldron';

/**
 * MAP DECOR THAT MOVES → the character id its Align-Studio clips live under.
 *
 * The two namespaces are genuinely different and were assumed to be the same:
 * a decor piece is named by its ART FILE (`pink_cauldron`, the texture key the
 * map places), while a staged clip is filed under a CHARACTER id chosen in the
 * Studio (`cauldron`). Every step of the cauldron's animation path looked the
 * clip up by the decor's own name — so `clipsFor('pink_cauldron')` came back
 * empty, the boil sheet was never listed for loading, never preloaded, and
 * `playDecorClip` returned on its first line. The pot has never boiled.
 *
 * An explicit map rather than a rename, because `character-anims.json` is
 * GENERATED (scripts/apply-anim-align.mjs) and a rename there would be undone
 * by the next push from the Studio.
 */
export const DECOR_CLIP_CHARACTER: Record<string, string> = {
  pink_cauldron: 'cauldron'
};

/** The clip character dressing a decor piece — itself unless mapped above. */
export const decorClipCharacter = (decorName: string): string =>
  DECOR_CLIP_CHARACTER[decorName] ?? decorName;

// (The bespoke dragon Job menu — Work ⛏️ / Harvest ✋ under a tapped dragon —
// is GONE, and its DRAGON_MENU block with it: a dragon now offers the same two
// skip buttons every generator does. Work is the drag onto a House the tutorial
// teaches; harvest is the tap itself.)

/** Pointer forgiveness (game px) around the exact hit point when alpha-testing
 *  board-item art: near-misses on thin/holey sprites (sprout stems) still land,
 *  while big transparent corners keep yielding to the item behind. */
export const HIT_FORGIVENESS_PX = 14;

/**
 * Live rigged dragon on the board (hatchling/whelp). Enters in the rig's original
 * (un-mirrored, facing LEFT) orientation celebrating, then alternates idle/celebrate
 * weighted so it is idle ~90% of the time. Durations in ms; scales are RigPlayer
 * display scales.
 */
export const DRAGON_ANIM = {
  introCelebrateMs: 2400, // the grand entrance after hatching
  /* ---- COZY CADENCE ----
   * The board is meant to be pleasant to leave running. Every number below was
   * roughly doubled from its first pass, where a whelp rolled a new segment
   * every ~5s and read as fidgeting rather than living. The rule the retune
   * follows: a dragon should be STILL most of the time, and the thing it does
   * when it stops being still should be long enough to watch.
   */
  celebrateMs: 3000, // one unhurried low-flight during the alternation
  idleMinMs: 9000,
  idleMaxMs: 15000,
  // P(low flight) per cycle. At 0.1 the cadence was cozy to the point of
  // hiding the fly clip: one flight per ~9 idle rolls is over two minutes of
  // stillness between wing-beats, and a player watching the board for a while
  // could reasonably conclude their dragon does not fly. Raised so a flight
  // lands every ~70-80s — still ~85% of the time at rest.
  celebrateChance: 0.15,
  /** ADULT dragons (the tier-4 Red Adult, the Golden Elder) are calm, wise
   *  elders: the same idle + low-flight repertoire, but rolled far less often,
   *  held longer, and played slower — a whelp fidgets, an elder breathes. */
  adultIdleMinMs: 16000,
  adultIdleMaxMs: 26000,
  adultCelebrateChance: 0.08,
  adultCelebrateMs: 3800, // a single unhurried low-flight when it does happen
  adultSpeed: 0.55, // preset playback rate (breathing/wing-beat cadence)
  /** …and the whelp is slowed too. At 1.0 its wing-beat was the fastest thing
   *  on a screen where nothing else hurries. */
  whelpSpeed: 0.82,
  fadeInMs: 220,
  hatchlingScale: 0.34,
  whelpScale: 0.46,
  groundLift: -20, // px: negative moves rig DOWN so dragon feet land on the tile floor
  /** Worker harvest (Phase 3): the dragon flies to a tapped plant, works, returns. */
  flyToMs: 520, // glide out to the plant
  workMs: 700, // breathing magic onto the plant before the loot drops
  flyBackMs: 480, // glide home
  // How far BEFORE a journey's touchdown the fly clip's landing phase starts —
  // the wings fold through the touchdown and finish on the tile, so a landing
  // never plays out mid-air and a touchdown never happens mid-cruise.
  landingLeadMs: 650,
  /**
   * HOW FAST THE WINGS OPEN AND FOLD — and why it is not the authored rate.
   *
   * The fly clip is authored as one cinematic ramp at 24 fps: ~2.5 s to open
   * the wings, ~2 s to fold them. That is right for a scripted journey the
   * player only watches, and wrong for a piece the player is HOLDING — the
   * hand moves a full second before the animal does, so a pick-up reads as a
   * dragon being slid around rather than one taking off. Played faster on the
   * gesture, the wings answer the finger.
   *
   * A rate, never a re-cut: the frames stay the authored ones, so the takeoff
   * still ends exactly where the cruise loop begins and the fold still ends on
   * the pose the idle starts from. Nothing about the clip's continuity moves.
   */
  takeoffRate: 1.8, // 61 frames → ~1.4 s of wings-open
  landingRate: 1.5, // 48 frames → ~1.3 s of wing-fold
  /**
   * A RELEASED dragon glides to its cell instead of snapping to it like an
   * inanimate piece. Long enough that the fold and the descent are one motion
   * (the wings are still closing as it touches down), short enough that moving
   * a dragon around the board still feels like moving a piece.
   */
  dropGlideMs: 850,
  /** Ambient bellow: after every 3–5 full idle-clip loops (rolled fresh each
   *  time the idle starts), the roar clip plays once and hands back to idle.
   *  The idle loop runs ~8s, so a bellow lands every ~24–40s of stillness. */
  idleRoarMinLoops: 3,
  idleRoarMaxLoops: 5
} as const;

/**
 * THE CEILING ON DRAGON FRAME SHEETS — the one number that keeps six breeds
 * from costing what six breeds cost.
 *
 * A staged clip is stored decoded, so the Emporium's whole roster resident at
 * once is 718 MB against a device budget the audit put at ~174 MB. The policy
 * that avoids that lives in `src/core/dragonClips.ts`; these are its dials.
 *
 * `budgetMb` is sized off the realistic BOARD, not the roster's total weight —
 * the catalogue was never meant to be resident, which is the whole reason the
 * eviction pass exists. What has to fit without eviction is the set of breeds
 * that can be STANDING at once, and that is measured two ways:
 *
 *   • PER WORLD. `GameState` holds a board per world and BoardScene reconciles
 *     residency against the ACTIVE board, so the two legendaries never meet:
 *     the Ashdrake is Emberkeep's, the Rimewyrm the north's.
 *   • PER SKIN. A Keeper wears one skin per chain, so what is askable is a
 *     wardrobe rather than the shop's whole rail.
 *
 * The heaviest THREE breeds that can share a board, over every (world × skin),
 * is 234 MB — the whelp, the Moonwhisker adult and the Golden Elder. So 288
 * sits about one breed above it, which keeps the ceiling doing the job it was
 * drawn for: three animals standing together never evict anything, and the
 * FOURTH gives back the sheets of whatever nobody is wearing any more. It was
 * 224 when the roster was four breeds; the legendaries and the Moonwhisker are
 * what moved it. `DragonClips.spec` pins both halves — the three-breed fit and
 * the give-back — so a new breed fails in node rather than on the device.
 *
 * `leanBudgetMb` is DELIBERATELY UNCHANGED. The weak tier's eager wave is the
 * idle alone (`clipLoadTiers`) and the rig covers flight as it always did, so
 * nothing about the legendaries makes a weak device hold more at once — raising
 * its ceiling alongside the desktop's would hand back the protection for free.
 */
export const DRAGON_CLIPS = {
  budgetMb: 288,
  leanBudgetMb: 96,
  /**
   * LEAN: fetch a breed's idle when it appears, and nothing else until it is
   * needed. Every other sheet arrives on the beat that uses it — the roar when
   * the dragon goes hungry, the fly on takeoff (`ensureMoodClip`).
   *
   * This used to read "weak devices load the idle only and fly on the rig",
   * and that sentence stopped being true the day the rigs were switched off:
   * there is no puppet left to cover a missing fly sheet, so deferring it is
   * now a real decision rather than a free one. It is still the right one,
   * because the fetch is triggered at takeoff and a first glide is a far
   * smaller cost than 3 MB down the wire before the animal has ever flown.
   *
   * Widened from IS_LOW_END to every HANDSET. A modern phone with 8 cores and
   * 8 GB is not "weak" by either signal, so it was pulling the full eager wave
   * — idle AND fly, 6-9 MB per breed — over a mobile connection at the moment
   * a dragon first stood on the board. The size axis was never the reason to
   * defer here; the WIRE is.
   */
  lean: IS_LOW_END || IS_MOBILE
} as const;

/** Per-dragon-chain rig scale factor so different art reads at the SAME on-board
 *  size. The emerald rig renders larger, so it's taken down 40% to match red. */
export const DRAGON_RIG_SCALE: Record<string, number> = {
  emerald: 0.486, // green dragon −10% again on request (0.54 → 0.486)
  ember_dragon: 0.448, // red dragon −20% again on request (0.56 → 0.448)
  // Adult Red Dragon (tier-4 rig override; adult rig pieces are ~836px wide vs
  // the whelp's 1054) — sized to read clearly BIGGER than the whelp on-board.
  // +50% on request (0.62 → 0.93): at 0.62 the adult read SMALLER than the baby.
  'ember_dragon:4': 0.93,
  // Adult Emerald Dragon: same rig geometry as the adult red (identical part
  // canvases/bounds), so it wears the same on-board scale.
  'emerald:4': 0.93
  // (The Golden Elder is NOT a board dragon — her altar scale lives in
  //  GOLDEN_ALTAR.elderScale.)
};

/**
 * The dark keyline the dragon rigs wear, added at DRAW TIME (src/render/rigInkShader.ts).
 *
 * The board's item art carries its keyline in the file, put there by
 * `scripts/unify-keyline.py`. A rig cannot: it is 6-8 separately posed layers, so
 * ink baked into the art would draw a line along every internal seam the moment a
 * limb moved. The rigs are therefore outlined by a shader instead — and the
 * measured fact that forced it is that the dragon layer art has NO keyline at all
 * (0.5px, i.e. nothing, on every whelp and adult layer), so the full width is
 * added rather than topped up.
 *
 * THE WIDTH RULE IS THE ITEMS' RULE. Thickness is quoted in on-board units (the
 * hi-res 2560x1600 space, so post-rig-scale), because that is the only thickness
 * the player sees — rig art is ~666-1054px of source for a 221-unit whelp:
 *
 *     units = refUnits * (onboardSize / refSize) ** exponent
 *
 * `refUnits`/`refSize`/`exponent` MUST match the constants at the top of
 * scripts/unify-keyline.py, or the dragons will not match the board they stand on.
 * As shipped that puts the whelp (221 units) on a 2.70-unit line and the adult
 * (358 units) on 3.04.
 */
export const DRAGON_OUTLINE = {
  enabled: true,
  /** Anchored on emberberry_1, the piece whose native line is the art direction. */
  refUnits: 2.0,
  refSize: 66.8,
  exponent: 0.25,
  /**
   * THE canonical keyline ink for the whole game, and never flat black.
   *
   * Sampled from the keyline of `assets/sprites/items/chains/emberberry_plant_1.png`
   * — the piece the board's outline pass is calibrated on. Its line is a dark warm
   * brown-grey, (39,29,28) at V 0.153, holding that value consistently from one
   * texel deep to eight. Anything that draws an outline reads this.
   */
  ink: 0x271d1c,
  /** Per-character override, so a frost breed could take a colder line than a red
   *  one. Empty on purpose: the canonical ink above is the art direction. */
  inkByCharacter: {} as Record<string, number>,
  /** Sanity ceiling on the dilation radius in texels — a mis-derived scale must
   *  cost a fat line, not a shader that samples half a layer per pixel. */
  maxRadiusTexels: 40
};

/**
 * Dragon Job system. A working dragon stands by a House and speeds every timed
 * object: each worker advances it DRAGON_WORK_PER_DRAGON seconds per real second,
 * so the rate is PER × workers (1 dragon = 2×, 2 = 4×, …). It tires after WORK_MS,
 * returns home and rests REST_MS before it can work again.
 */
export const DRAGON_WORK_MS = 180_000; // 3 minutes of work
/**
 * NO FATIGUE (0, 2026-08-15 — owner's call, and the second half of the sleep
 * decision above).
 *
 * A shift used to be followed by five minutes in which the dragon could not be
 * hired again. Making it stop being a SLEEP fixed the picture; it did not fix
 * the rule, because the animal was still unusable for five minutes out of
 * every eight. One sentence now describes a dragon's whole day: it sleeps
 * fifteen seconds every ten to fifteen minutes, and it is available the rest of
 * the time.
 *
 * The shift itself is untouched — DRAGON_WORK_MS still ends it and the dragon
 * still flies home on `dragon:rest`. It simply lands ready.
 *
 * (Briefly reverted to 300_000 as a bisect against the finale freeze. Cleared:
 * the freeze was `dialogue.finaleElder` being an array where the bubble wanted
 * a string. The zero was never involved.)
 */
export const DRAGON_REST_MS = 0;

/** Seconds a single working dragon advances timers per real second. Total rate =
 *  PER × workers; the base 1× already comes from the clock, so the job system
 *  adds the remainder ((PER × workers − 1) × ms). */
export const DRAGON_WORK_PER_DRAGON = 2;

/** Input (game-resolution pixels; CSS pixels are half of these under FIT). */
export const TAP_MAX_DISTANCE_PX = 16;
export const TAP_MAX_MS = 350;

/** Ambient juice. */
export const EMBER_MOTES = {
  count: 14,
  minSpeedY: -28,
  maxSpeedY: -60,
  driftX: 24,
  minScale: 0.35,
  maxScale: 0.9,
  alpha: 0.5,
  lifespanMs: 9000
} as const;

/**
 * Ambient world atmosphere — the layered "the isle is alive" pass, near→far:
 * ember-flies drifting around the player's view, slow ember updrafts off the
 * lava seams, high mist sliding across the isles, and a warm vignette grade
 * over everything. Pure presentation: no state, no input, no gameplay timing.
 */
export const ATMOSPHERE = {
  /** Near layer: small orange ember-flies twinkling around the current view.
   *  MANY tiny sparks (a swarm, not a few bugs) — subtlety comes from the small
   *  scale and the sine-bell alpha, not from scarcity. */
  fireflies: {
    frequency: 320, // ms between spawns (emitter-paced; ~21 alive at a time)
    lifespanMs: 6800,
    speedMin: 6,
    speedMax: 22,
    scaleMin: 0.18,
    scaleMax: 0.4,
    alphaPeak: 0.5, // fades 0 → peak → 0 across the life (slow twinkle)
    tint: 0xffb03a
  },
  /** High mist drifting across the view — a soft depth-haze between the camera
   *  and the isles (the isles are baked into the backdrop, so "beneath" layers
   *  are impossible; overhead haze is what reads at this camera angle). */
  wisps: {
    count: 3,
    scale: [3.4, 4.6] as const,
    alpha: [0.045, 0.075] as const,
    crossMs: [260000, 420000] as const, // minutes per crossing — barely perceptible
    bobPx: 40,
    tint: 0xfff2e2, // sunset-warmed white
    depth: 48800
  },
  /** Finishing grade: warm dark vignette hugging the screen edges (UIScene). */
  vignette: {
    alpha: 0.16,
    color: '#2a0e12'
  }
} as const;

/**
 * Battery governor (PowerGovernor): the loop runs at full rate only while the
 * player is interacting; an untouched board throttles down in two steps. All
 * gameplay timing is wall-clock (GameClock.now), so render fps never affects
 * logic or determinism.
 *
 * activeFps is 62, not 60, on purpose: Phaser's fps.limit skips a step when the
 * accumulated delta is a hair under the limit-rate, so 60 on a 60 Hz display
 * micro-stutters (~55 real fps). 62 fires every vsync at 60 Hz and halves a
 * 120 Hz display to 60 — the cap costs nothing on standard screens.
 */
export const POWER = {
  activeFps: 62,
  idleFps: 30,
  dozeFps: 15,
  /** No input/gameplay for this long → idle (30 fps). */
  idleAfterMs: 10_000,
  /** …and for this long → doze (15 fps, ambient FX + crystal paused). */
  dozeAfterMs: 45_000,
  /** Gameplay bus events hold ACTIVE this long (finale beats hold longer). */
  eventHoldMs: 10_000,
  finaleHoldMs: 45_000,
  /**
   * Crystal3D re-render cadence per state; it PAUSES entirely in doze.
   *
   * Each tick is a three.js render, a GPU→CPU readback of the gem's canvas, and
   * a full re-upload of that canvas as a Phaser texture — 2.9 MB a frame, by
   * far the most expensive idle cost in the game. It used to run at 33 ms (30
   * fps, ~87 MB/s of texture traffic) for one decoration. The gem turns at
   * 50°/s, so 66 ms is 3.3° a step: still a smooth turn, half the traffic.
   */
  crystalMs: { active: 66, idle: 200 }
} as const;

/**
 * Graft the live three.js emerald over `item_crystal_1`?
 *
 * ON — the spinning cel-shaded gem is the Theme Crystal, and the flag exists
 * only so a run can fall back to the painted grotto without touching code.
 * What the gem must never do is MOVE: it is a fixture of the map (see
 * `authoredFixtures` in GameState), so no drag, no scripted beat and no reload
 * can take it off the cell map.json authored for it.
 */
export const CRYSTAL_3D = true;

/** Save. Bump SAVE_VERSION whenever the map/chains change incompatibly, so old
 *  localStorage saves are discarded on load (Context.beginRun → newGame) instead
 *  of layering stale items onto the new map. v1→v2: map/items reshuffled (red
 *  dragon→ruby, golden egg, region contents) left phantom wood + a duplicate
 *  House on deployed saves; v2 forced a clean départ-0 for them. v2→v3: chests no
 *  longer drop wood — wipe saves that already banked that loose wood / 2nd House.
 *  v3→v4: the chest is now a PERMANENT recurring gift box — wipe saves whose
 *  one-shot chest was already consumed so it comes back. v4→v5: tutorial reworked
 *  (House energy-skip, repositioned dragons/chest) — wipe so deployed players get
 *  the same fresh départ-0 as a local run. v5→v6: Chapter One demo retune —
 *  stats/finale counters added to the save, LEVEL_XP re-curved, golden_egg grew
 *  an Elder tier — wipe so every save carries the new fields + curve.
 *  v6→v7: the cast changed — Cindra and Laurah are gone and Eleanor is both the
 *  guide and the quest giver, so every order id was renamed `cindra_*` →
 *  `eleanor_*`. A v6 save's `completedOrderIds` hold the OLD ids, which would
 *  re-offer finished orders and leave the Golden Altar's `orderId` gate unmet —
 *  wipe rather than migrate. v7→v8: the Bag arrived — saves gain a `bag` array.
 *  It defaults to [] on load so a v7 save would survive, but the tap gesture on
 *  the board changed meaning in the same release, so a clean start keeps the
 *  tutorial's scripted board honest.
 *  v8→v9: the story chapter pointer arrived, and the tutorial's opening was
 *  rewritten (2 steps → 7, new ids). A v8 save's `tutorial.index` points into
 *  the OLD step list, so resuming would drop the player mid-scene on the wrong
 *  line — wipe rather than migrate.
 *  v9→v10: six beats were inserted into the tutorial (the satchel, selling,
 *  Eleanor's help, and the whole Ledger arc — see docs/tutorial-coverage.md).
 *  `tutorial.index` is a position in that list, so a v9 save mid-tutorial would
 *  resume on a different beat than it left — wipe rather than migrate.
 *  v10→v11: region CONTENTS changed — quartz and moonwater are seeded on the
 *  board and level_2 carries five Cracked Stones instead of two — and a beat
 *  (`isle_materials`) was inserted after `sell_it`. Region contents are laid
 *  down when a region unlocks, so a v10 save that already opened level_2 would
 *  never see the new pieces, and its `tutorial.index` again points into the old
 *  list — wipe rather than migrate.
 *
 *  NOT bumped for map space (`src/core/mapSpace.ts`). Every field it adds —
 *  `world`, `mapSignature`, per-item `place`, `nestPlaces` — is optional and
 *  additive: a v11 save without them hydrates down the identical grid path it
 *  always did (`MapSpace.spec` asserts exactly that), and a v11 save WITH them
 *  is still a v11 save to any build that ignores them. Bumping would wipe every
 *  player's board to add a field they cannot yet benefit from, which is the
 *  opposite of what the field is for. The bump that matters comes with the
 *  zone system, and by then the saves in the wild already carry the pixels
 *  needed to migrate rather than discard them. */
export const SAVE_KEY = 'emberkeep_save';
// v12: the Emberbark Stump beat (`moss_stump`) shifts every persisted
// tutorialIndex, and the stump itself is a new startingItem older boards lack.
// v13: the stump is no longer a startingItem — `moss_stump` SPAWNS it, so the
// isle stays bare through Eleanor's arrival lines. A v12 save paused inside
// those lines already carries the stump as a board item, and the new spawn
// effect firing over it would seed a SECOND free generator — wipe, same rule
// as v12 itself.
// v14: the north's seven old chains are DELETED and five farms stand in their
// place, so any board holding a Drift Spar, a Broken Strake or a Hoarfrost Font
// is holding pieces no chain can name — and the Codex lesson grew from one beat
// to six, which moves every persisted `tutorialIndex` after it.
export const SAVE_VERSION = 14;

/** The opening's held silence: the board is visible and quiet before Eleanor's
 *  first line, so the player sees the ash before anyone frames it
 *  (docs/opening-scene.md, beat 0). Presentation-only — UIScene defers the very
 *  first bubble by this much; the director has already emitted the step. */
export const OPENING_HOLD_MS = 1500;

/** How long a post-tutorial story beat rests on screen if the player never taps
 *  it. Chapter beats are tap-advanced; this is the safety net so a bubble can
 *  never strand the board. A FLOOR now — `readMs` lengthens it for a long
 *  line, because a safety net cut to the average sentence strands the ones
 *  above average. */
export const STORY_BEAT_HOLD_MS = 9000;

/**
 * HOW LONG A LINE STAYS UP, FROM HOW LONG IT TAKES TO READ.
 *
 * Every un-tapped bubble used to hold for a flat count — 4.2 seconds for a
 * nudge, 9 for a story beat — whatever it said. So a four-word aside sat there
 * long after it was finished and a thirty-word one was taken away mid-sentence,
 * and the second is the one the player notices: text that "appears too fast" is
 * almost always text that LEAVES too fast.
 *
 * 55ms a character is about 18 characters a second — roughly 200 words a minute,
 * the pace of comfortable adult reading, and deliberately not the pace of
 * skimming. `lead` is the moment before reading starts at all: the eye has to
 * find the bubble, which just popped in somewhere it was not before.
 */
export const READING = { perChar: 55, lead: 900, minMs: 3600, maxMs: 16000 } as const;

/** Reading time for one line, clamped. Pure — the bubble and anything else that
 *  puts words on screen for a fixed while should ask this rather than pick a
 *  number. */
export function readMs(text: string, floorMs: number = READING.minMs): number {
  const want = READING.lead + text.length * READING.perChar;
  return Math.min(READING.maxMs, Math.max(floorMs, want));
}

/** Host-page IAP bridge — real-money packs; the EmberGames hub does the
 *  charging, the game only confirms, celebrates and applies the grant.
 *  Real wall-clock, deliberately NOT GameClock: a payment happens in the
 *  world outside the simulation and must not fast-forward with it. */
/**
 * Empty ON PURPOSE, and kept rather than deleted.
 *
 * It held four numbers that sized and watched a checkout POPUP: the window's
 * width and height, the cadence for polling its `closed` flag, and the grace
 * period after it closed before calling the purchase cancelled. The payment is
 * shown in a panel over the game now (`iapBridge.beginCheckout` → the hub's
 * `GamePlayer`), so the game opens no window, and every one of those four
 * described machinery that no longer exists. The hub owns the panel, its Cancel
 * key and the poll for the gateway's verdict.
 *
 * The export stays because the shape is the right home for whatever the bridge
 * next needs to tune, and a re-added constant should land here rather than
 * somewhere new.
 */
export const IAP = {} as const;

/**
 * THE SHORTFALL NOTICE — the answer to "you cannot afford this".
 *
 * A gold refusal used to end at a red price and a shake: the player was told
 * no and given nowhere to go. This is the compact notice that opens OVER
 * whatever refused — over, not instead of, because the shelf they were
 * browsing (and its scroll position) is the thing they came for, and losing it
 * is a second punishment. It says how short they are OF WHAT, and offers two
 * ways out: the one that takes them to the coin shop, and the one that costs
 * nothing.
 *
 * IT SELLS NOTHING ITSELF. There is exactly one coin shop in this game — the
 * Emporium's GOLD tab — and a second list of packs floating over a panel would
 * be a second coin shop to keep in step with the hub catalog and with
 * `coin-packs.json`. The notice's action SWITCHES the player to the real one;
 * `ui:shop_toggled` carries them back when they leave it. So there are no pack
 * rows here, no prices, and nothing in this block that money depends on.
 *
 * ── THE DEVICE LAYOUT, and why it is two sets of numbers rather than one
 *
 * The rule the Store's `CX` block states: the space is 2560 units wide
 * WHATEVER the device, so on a handset a unit is ~0.15 real pixels instead of
 * ~0.5, and type authored for the landscape notice arrives at a third of its
 * apparent size. Scaling the whole plate cannot repay that — it is already at
 * 94% of the portrait width. So portrait gets its own frame, its own stepped
 * type (`px`) and keys tall enough for a thumb; desktop keeps the landscape
 * numbers.
 *
 * THE HEIGHT IS DERIVED, NOT LISTED. `shortLine` x `shortMaxLines` is the
 * RESERVE the arithmetic below is budgeted against, but the notice lays itself
 * out from the text object's own measured height — a one-line shortfall must
 * not leave a line of dead plate under it, and a three-line one must not run
 * off the bottom. Everything else here is a fixed part, and the parts are what
 * these numbers are.
 *
 * Every number is stated from the PAINTED art upward. Art is painted at
 * LOGICAL units x RES (2), so:
 *
 *   `ui_btn_green` is painted 210x76 logical = 420x152 game units
 *   `ui_btn_play`  is painted 264x96 logical = 528x192 game units
 *   `ui_icon_coin` is fitted to the wallet line's own box, never upscaled
 *
 * DESKTOP   width 1040, pad 44  ->  content 952 wide
 *   title    46px type in a 58 line box
 *   short    36px type, 47 per line, 2 lines reserved            = 94
 *   wallet   28px type in a 36 line box
 *   keys     ONE ROW: the green 420x152 primary, 44 of air, the
 *            royal 380x150 secondary                     = 844 wide, 152 tall
 *            844 <= 952, so the row never touches the pad.
 *   height   44 + 58 + 18 + 94 + 16 + 36 + 40 + 152 + 44 = 502   (of 1600) ✓
 *
 * PORTRAIT  width 2400, pad 88  ->  content 2224 wide
 *   title    px(46) = 120 type in a 150 line box
 *   short    px(36) = 94 type, 122 per line, 2 reserved           = 244
 *   wallet   px(28) = 73 type in a 92 line box
 *   keys     STACKED, and the stack is the platform minimum rather than a
 *            taste: 44 CSS px is the floor, a 390px-wide handset runs the
 *            2560-unit space at 6.56 units to the pixel, so 44px is 289 units.
 *            The primary is 1400x340 (51.8px) and the secondary 1120x300
 *            (45.7px) — both clear it before the fit scale is applied, and a
 *            thumb picks one of two rows far more reliably than one of two
 *            columns.
 *   height   88 + 150 + 44 + 244 + 36 + 92 + 90 + 340 + 36 + 300 + 88 = 1508
 *
 *   fit      panelFitScale(2400, 1508)
 *            = min(2.2, 2560x0.94/2400, LIVE_HEIGHTx0.92/1508)
 *            = min(2.2, 1.003, >=2.07) = 1.003
 *            -> 2407 x 1512 units. On a 390x844 phone the live space is
 *               2560x5539, so the notice is 94% of the width and 27% of the
 *               height. The squarest device the mobile path allows is a 4:3
 *               tablet at 2560x3413, where the height bound is 2.08 — the
 *               width binds on everything, which is what keeps the notice the
 *               same shape on every handset.
 */
export const TOP_UP = {
  /**
   * WHICH REFUSALS OFFER IT. A paywall in the wrong place is worse than a dead
   * end, so this is a list of named surfaces rather than "anywhere gold is
   * spent" — see `TopUpSource`. Turning one off leaves that refusal exactly as
   * it was (the shake, the red price) and costs nothing else.
   */
  offer: { store: true, warmth: true, skip: true } as Record<TopUpSource, boolean>,
  /**
   * AND HOW IT ANSWERS — the difference between a card and a door.
   *
   * `'switch'` takes the player straight to the coin shop. `'notice'` raises
   * the shortfall card first and lets them choose.
   *
   * The split is about WHERE the refusal happened, not about how much we want
   * the sale. A refusal inside a shop is a request that was already made: the
   * player came to spend, tapped a price, and was told no. Putting a card
   * between them and the till is a speed bump in the middle of an errand they
   * started — so `store` and `warmth` switch. `warmth` barely even moves: the
   * coin shelf is the tab next door.
   *
   * `skip` is the other case. That refusal happens on the BOARD, mid-merge,
   * from a timer bubble the player tapped in passing. Yanking the whole
   * Emporium over the board there is the game changing the subject, so it
   * keeps the card: it names the piece, says how short they are, and offers.
   */
  mode: { store: 'switch', warmth: 'switch', skip: 'notice' } as Record<
    TopUpSource,
    'switch' | 'notice'
  >,
  /** Scrim over whatever is underneath. Lighter than a panel's own (0.62): the
   *  shelf has to stay legible behind it, because not losing your place is the
   *  entire reason this is a notice and not the whole Emporium. */
  dimAlpha: 0.5,
  /** Open/close flourish, matching the panels' own (Back.easeOut in, Sine.easeIn out). */
  openMs: 190,
  closeMs: 150,
  /** Geometry, per device. See the arithmetic above. */
  box: IS_MOBILE
    ? {
        width: 2400,
        pad: 88,
        radius: 96,
        /** The gold seat under the face, and the rim around it — the plate is
         *  the banner's four layers at notice size (see `drawBanner`). */
        seat: 28,
        rim: 16,
        /** The gloss strip: inset from the sides, dropped from the top, tall. */
        glossInset: 64,
        glossTop: 30,
        glossH: 100,
        titleBox: 150,
        gapTitle: 44,
        shortLine: 122,
        gapShort: 36,
        walletBox: 92,
        gapKeys: 90,
        keyPrimaryW: 1400,
        keyPrimaryH: 340,
        keySecondaryW: 1120,
        keySecondaryH: 300,
        keyGap: 36,
        /** Portrait stacks the two keys; landscape sets them side by side. */
        keysStacked: true
      }
    : {
        width: 1040,
        pad: 44,
        radius: 48,
        seat: 12,
        rim: 8,
        glossInset: 28,
        glossTop: 14,
        glossH: 44,
        titleBox: 58,
        gapTitle: 18,
        shortLine: 47,
        gapShort: 16,
        walletBox: 36,
        gapKeys: 40,
        keyPrimaryW: 420,
        keyPrimaryH: 152,
        keySecondaryW: 380,
        keySecondaryH: 150,
        keyGap: 44,
        keysStacked: false
      },
  /** How many lines of shortfall copy the height is BUDGETED for. The notice
   *  measures the real thing and grows or shrinks to it; this is what the
   *  arithmetic above was checked against, not a clamp. */
  shortMaxLines: 2,
  /**
   * TYPE, in AUTHORED units — the notice steps every one through `px()`, so
   * `title: 46` is 46 on a desktop and 120 on a handset and reads the same
   * apparent size on both. Device-INDEPENDENT on purpose: stating them once is
   * what keeps the two `box` blocks honest, since both header columns above are
   * measured from exactly these stepped line boxes.
   */
  type: {
    title: 46,
    short: 36,
    wallet: 28,
    key: 36
  },
  /**
   * Copy. `{n}` is the shortfall and `{what}` the thing that was refused — both
   * filled from LIVE state, because "not enough gold" is a shrug and "42 more
   * gold for the Mushroom Cottage" is an answer.
   */
  copy: {
    title: 'NOT ENOUGH GOLD',
    short: '{n} more gold for {what}',
    /** Once the wallet covers it the offer is ANSWERED, not withdrawn: the
     *  notice never closes itself, because a modal that vanishes while a thumb
     *  is travelling towards it hands the tap to whatever was underneath. Both
     *  lines change together — a green headline over "42 more gold" would be
     *  two states of one fact on screen at once. */
    titleCovered: 'YOU HAVE ENOUGH',
    /** Phrased so it reads with EVERY `{what}` the three sources produce — a
     *  Store item's own name ("Mushroom Cottage"), an Emporium pack's ("Hearth
     *  Bundle"), and the board's verb phrase ("skipping the House"). */
    covered: 'Your purse covers {what} now',
    wallet: 'You have',
    /** The one call to action, and the only thing on screen that leaves. */
    go: 'GET GOLD',
    exit: 'Not now'
  }
} as const;

/** Audio master volumes 0..1. */
export const AUDIO = {
  master: 0.8,
  sfx: 0.9,
  ambient: 0.16,
  music: 0.45 // looping background track (Dragonsland.mp3)
} as const;

export const SCENES = {
  boot: 'BootScene',
  preload: 'PreloadScene',
  title: 'TitleScene',
  board: 'BoardScene',
  ui: 'UIScene',
  uiEditor: 'UiEditorScene'
} as const;

/**
 * Display names, one table for every surface that prints a person's name —
 * the bubble's name tag, a subquest's "Deliver … to Eleanor", a HUD line.
 * A second copy of this table drifts the first time somebody is renamed.
 */
/**
 * The mark a giver's quest titles wear on the tracker, so a glance says whose
 * page is open when two tracks share a board. Absent = unmarked: the world's
 * HOST giver owns the plain title (Eleanor in the south, Selyna in the north),
 * and the Elder — who gives from the altar in both — is the one who needs
 * telling apart. Twelve of her quests share the ladder with Eleanor's twelve.
 */
export const GIVER_MARK: Partial<Record<SpeakerId, string>> = {
  golden_elder: '✦ '
};

export const SPEAKER_NAMES: Record<SpeakerId, string> = {
  eleanor: 'Eleanor',
  selyna: 'Selyna',
  golden_elder: 'The Golden Elder'
};

/**
 * Hard cap for any single line in `dialogue.json` — a bubble is one breath,
 * not a paragraph, and past this length the card grows tall enough to crowd
 * the board. A longer speech is authored as an ARRAY of lines (a tap-advanced
 * sequence, or the finale's chained says). Enforced by
 * `tests/unit/Dialogue.spec.ts`, so an over-long line fails the build rather
 * than shipping as a wall of text.
 */
export const DIALOGUE_MAX_CHARS = 190;

/**
 * FIRST CONTACT — the line a world's own giver says the first time a machine of
 * theirs is standing on the player's board.
 *
 * The north is entered by a taught player and must not grow a tutorial
 * (`docs/tutorial-coverage.md`), but "no tutorial" was read as "no words": its
 * five farms shipped with four of the five machines never named anywhere the
 * player could read them, while `north_terms` asked for an Orrery and
 * `what_she_will_take` gifted three Ground Lenses. A quest that asks for an
 * object nobody has named is the defect the coverage ledger exists to catch.
 *
 * These are INTRODUCTIONS, not rules. The structure needs no lesson — parts
 * merging into a building is `wood_merge`→`plank_merge`, and a generator whose
 * rarer yield becomes another generator is `emberberry_merge`, the same
 * every-twelfth drop and all. So the first machine says the growth rule out
 * loud once (nine bricks, a second kiln) and the rest simply say their name and
 * what comes out of them.
 *
 * `tier` is the MACHINE — the fixture ladder's top, the piece that produces.
 * Latched once ever in `stats` under `fc:<chain>`, so the line survives a
 * reload without repeating. Each row's speaker is the giver whose world seeds
 * that machine; UIScene groups a multi-machine reveal by speaker, so a mixed
 * table is legal (a region can seed several farms at once — `borealis_coast`
 * seeds three).
 */
export const FIRST_CONTACT: ReadonlyArray<{
  chain: string;
  tier: number;
  /** Key into `dialogue.json` → `hints`. */
  hint: string;
  speaker: string;
}> = [
  { chain: 'glasskiln', tier: 3, hint: 'glassKiln', speaker: 'selyna' },
  { chain: 'starbench', tier: 3, hint: 'starBench', speaker: 'selyna' },
  { chain: 'wreckforge', tier: 3, hint: 'wreckForge', speaker: 'selyna' },
  { chain: 'tarkiln', tier: 3, hint: 'tarKiln', speaker: 'selyna' },
  { chain: 'auroraloom', tier: 3, hint: 'auroraLoom', speaker: 'selyna' }
];

/** How long a first-contact line holds, and how long the sweep waits when the
 *  bubble is busy — the Borealis arrival speech owns the stage on the very
 *  first visit, and the kiln's introduction belongs after it, not over it. */
export const FIRST_CONTACT_HOLD_MS = 6200;
export const FIRST_CONTACT_RETRY_MS = 1500;
