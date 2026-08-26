import Phaser from 'phaser';
import type { GameContext } from '../core/Context';
import {
  ATMOSPHERE,
  ENERGY_REGEN_MS,
  FINALE,
  EGG_GIFT,
  FIRST_CONTACT,
  FIRST_CONTACT_RETRY_MS,
  COOKBOOK_SEEN_KEY,
  GOLDEN_ALTAR,
  GOLDEN_TREMBLE_PROGRESS,
  HUD_COLUMN_ICON,
  HUD_COLUMN_PLATE,
  HUD_COLUMN_X,
  hudColumnY,
  IS_MOBILE,
  LIVE_GAME_HEIGHT,
  LIVE_GAME_WIDTH,
  MAP_EDITOR_IN_SETTINGS,
  num,
  OPENING_HOLD_MS,
  PALETTE,
  panelFitScale,
  SCENES,
  STORY_BEAT_HOLD_MS,
  TILE_W,
  TIMINGS,
  TOP_UP,
  TRAVEL_VEIL_TIMEOUT_MS,
  TRAVEL_WIPE,
  UI_SCALE,
  WELCOME_BACK_MIN_MS,
  WORLD_ID
} from '../core/Constants';
import { FONT } from '../art/design';
import { clipKey, clipsFor } from '../core/characterAnims';
import { guard } from '../core/crash';
import {
  ensureTravelWipePipeline,
  TRAVEL_WIPE_PIPELINE,
  wipeRgb,
  type TravelWipePipelineData
} from '../render/fx/travelWipeShader';
import { iapBridge } from '../core/iapBridge';
import { gridToWorld } from '../core/iso';
import type {
  EventMap,
  EventPanel,
  MarkerPoint,
  ResolvedArrow,
  ResolvedHand,
  SpeakerId,
  TilePos,
  TopUpSource,
  TutorialStepEvent,
  TutorialUiTarget
} from '../core/types';
// The two pure readers every board-anchored pointer goes through — the tutorial's
// hand, the idle merge hint and the carry lesson alike. They live beside the
// director because that is what decides WHICH piece a marker means; these decide
// where that piece is standing right now. Pure functions, no bus traffic.
import { markerPointAt, markerPointCell } from '../systems/TutorialDirector';
import type { BoardScene } from './BoardScene';
import { CharacterBubble } from '../entities/CharacterBubble';
import { BagPanel } from '../ui/BagPanel';
import { CommissionPanel } from '../ui/CommissionPanel';
import { CauldronPanel } from '../ui/CauldronPanel';
import { StorePanel } from '../ui/StorePanel';
import { CookbookPanel } from '../ui/CookbookPanel';
import { DragonCodexPanel } from '../ui/DragonCodexPanel';
import { Hud } from '../ui/Hud';
import { NamePanel } from '../ui/NamePanel';
import { TravelPrompt } from '../ui/TravelPrompt';
import { LedgerPanel } from '../ui/LedgerPanel';
import { RecipeHelpPanel } from '../ui/RecipeHelpPanel';
import { QuestTracker } from '../ui/QuestTracker';
import { StatusPanel } from '../ui/StatusPanel';
import { ShopPanel } from '../ui/ShopPanel';
import { TopUpNotice } from '../ui/TopUpNotice';
import { renderScale } from '../core/render-scale';
import { GRAPHICS_QUALITIES } from '../core/graphics';
import { GRAPHICS_EVENT, GRAPHICS_PROFILES, graphics } from '../core/graphicsState';
import { getMusicMuted, setMusicMuted } from '../audio/musicPref';
import { CustomUiManager } from '../ui/customUi';
import { uiRegistry } from '../ui/theme';
import { ChoicePrompt } from '../ui/ChoicePrompt';
import { DragonReveal } from '../ui/DragonReveal';
import { Tooltip } from '../ui/Tooltip';

const DEPTH_HUD = 10;
const DEPTH_PANEL = 60;
const DEPTH_TUTORIAL = 100;
const DEPTH_DIALOG = 200;
// On-screen heights (2560-space) for the tutorial pointer/arrow. The real art
// loads at its native pixel size, so each is scaled to these.
const HAND_MARKER_H = 172;
// +75% on the phone (owner's call): at 148 units the pointer renders ~23 real
// px on a 390px handset and disappears against the busy board.
const ARROW_MARKER_H = IS_MOBILE ? 259 : 148;

/**
 * WHAT a marker points at, as one comparable string.
 *
 * The distinction it draws is the whole reason the pointer stopped jumping: an
 * end that follows a PIECE is identified by that piece, not by the tile it is
 * standing on this second, so dragging the piece changes where the marker is
 * drawn without changing what it means. `tutorial:markers` fires on every board
 * change, and re-placing a marker restarts its gesture from the top — a hand
 * that re-poses itself every time the player nudges the very dragon it is
 * following looks broken. So the beat's markers are only re-placed when this
 * answer changes: a different piece, a different cell, a different button.
 */
function markerAim(marker: ResolvedHand | ResolvedArrow | null): string {
  if (!marker) return '-';
  const end = (p: MarkerPoint): string =>
    p.item !== undefined ? `#${p.item}` : `${p.col},${p.row}`;
  if ('from' in marker) return `drag ${end(marker.from)}>${end(marker.to)}`;
  if ('tile' in marker) return `tile ${end(marker.tile)}`;
  if ('ui' in marker) return `ui ${marker.ui}`;
  if ('character' in marker) return `char ${marker.character}`;
  return `fog ${marker.fogRegion}`;
}

/* ---------------------- the Settings plate ------------------------ */
/**
 * The Settings dialog is DRAWN, not textured — a rounded rect 900 units wide.
 * The number lives here rather than as four `-450`s and a `900` inside
 * `openResetDialog`, because the portrait sizing below is derived from it and
 * a plate whose width is stated twice is a plate that will disagree with its
 * own scale one day.
 */
const SETTINGS_W = 900;

/**
 * THE PLATE IS MEASURED, NOT RESERVED.
 *
 * It used to be a fixed 736 plus a slack constant sized for the worst case —
 * the graphics blurb growing to three lines after a quality change appends
 * "Reload the page to resize the canvas." — which meant the REST state carried
 * the worst case's emptiness as a permanent hole between the blurb and the
 * divider. The owner called it out twice. `openResetDialog` now flows its rows
 * top-down off their measured heights and redraws the plate to fit, and when
 * the blurb grows the plate grows WITH it instead of having paid for the room
 * in advance.
 */

/**
 * The graphics blurb is the smallest type on the plate and the only line on it
 * that fails to read once the panel is scaled for a phone.
 *
 * A unit of the 2560-wide space is 390/2560 = 0.152 real pixels on the handset
 * the TYPE_STEP note is written against; at the 2.2 panel scale that is 0.335.
 * So the original 26 arrived at 8.7 real px — under the 10.5 that same note
 * calls readable — while the button label right above it (32) arrives at 10.7
 * and passes. Handing the blurb that identical 32 is the smallest change that
 * clears the bar, and it puts no new size into the plate's type scale. NOT
 * `px()`: the container is already carrying 2.2, and 26 x 2.6 x 2.2 would land
 * a caption at 23 real px, larger than the heading above it.
 *
 * Desktop went 26 → 30 for the same reason at the other scale: FIT halves the
 * 2560 space on a 1080p screen, so 26 read at 13 real px there and the owner
 * called it too small. 30 keeps it under the 32px button label above it.
 */
const SETTINGS_NOTE_PX = IS_MOBILE ? 32 : 30;

/**
 * Runs in parallel above BoardScene: HUD, tooltip, Eleanor's Ledger, the
 * tutorial presentation layer (dialogue bubble, guiding hand, bouncing
 * arrow) and the reset-confirm dialog. Pure subscriber + intent emitter.
 */
/** Banners and toasts must land UNDER the burn, not over it. */
const DEPTH_TRAVEL_VEIL = 80000;

/** The travelling curtain's live state, spanning cover → hold → reveal. */
interface TravelVeil {
  root: Phaser.GameObjects.Container;
  /** Destination name, ornament and the breathing embers — faded as one. */
  chrome: Phaser.GameObjects.Container;
  /** The wipe shader's uniforms; absent on the Canvas fallback. */
  wipe?: TravelWipePipelineData;
  /** Every tween target that may still be animating when the veil dies — the
   *  ember dots repeat forever, so destroy must kill, not just drop. */
  pulse: Array<object>;
  covered: boolean;
  coveredAt: number;
  revealAsked: boolean;
  revealing: boolean;
}

export class UIScene extends Phaser.Scene {
  private ctx!: GameContext;
  private regenAccum = 0;
  private hud!: Hud;
  private reveal!: DragonReveal;
  private tooltip!: Tooltip;
  private ledger!: LedgerPanel;
  private recipeHelp!: RecipeHelpPanel;
  /** The hover twin of the `?` sheet — see where it is built. */
  private recipePeek!: RecipeHelpPanel;
  private shop!: ShopPanel;
  private bag!: BagPanel;
  /** "What shall it make?" — a finished House's one-time commission. */
  private commission!: CommissionPanel;
  private store!: StorePanel;
  private cauldron!: CauldronPanel;
  /** "You are 42 gold short" — raised over whatever refused, never on its own. */
  private topUp!: TopUpNotice;
  /**
   * THE RETURN TICKET, and why it is a VALUE rather than a callback.
   *
   * The shortfall notice's whole promise is that being sent to the coin shop
   * does not cost the player their place, so something has to remember where
   * they were while they are away. A stored closure over a panel is how that
   * leaks: it survives the panel being closed, reset or rebuilt underneath it,
   * and fires into a corpse. This is plain data — a section index and a scroll
   * offset — re-clamped by the panel when it is handed back, so the worst a
   * stale ticket can do is put the player at the top of the first tab.
   *
   * It is consumed on the first `ui:shop_toggled { open: false }` after it is
   * written, and dropped on a world crossing (the stall's catalogue changes
   * with the world, so the place it names has stopped meaning anything).
   */
  private topUpReturn: { store: { section: number; scroll: number } } | null = null;
  private tourUiArrow?: Phaser.GameObjects.Image;
  /** Self-driven: opens on `nest:hatched`. Held so it stays on the display
   *  list and the UI Builder can style it; never read back. */
  private naming!: NamePanel;
  private cookbook!: CookbookPanel;
  private questTracker!: QuestTracker;
  /** Who the player is looking at — under the tracker, same plate-free look. */
  private statusPanel!: StatusPanel;
  /** Has the tutorial reached the beat that teaches the readout? Latched — see
   *  where it is set. Re-created with the scene, so a reset clears it. */
  private statusTaught = false;
  private cookbookButton!: Phaser.GameObjects.Container;
  private codex!: DragonCodexPanel;
  private codexButton!: Phaser.GameObjects.Container;
  private cookbookDot!: Phaser.GameObjects.Arc;
  private bubble!: CharacterBubble;
  /** The awakening finale is running — suppress competing banners. */
  private finaleActive = false;
  /** One-shot Eleanor nudges (per session). */
  private hintShown = new Set<string>();
  /** Active recipe mini-tutorial (`chain:from>to`), if one is demonstrating. */
  private recipeHint: string | null = null;
  private recipeHintTimer: Phaser.Time.TimerEvent | null = null;
  private hand!: Phaser.GameObjects.Image;
  private arrow!: Phaser.GameObjects.Image;
  private dialog: Phaser.GameObjects.Container | null = null;
  /** Real-money purchase dialog (confirm, then the waiting card). */
  private iapDialog: Phaser.GameObjects.Container | null = null;
  /** The travelling curtain, while a destination world's art loads. */
  private travelVeil?: TravelVeil;
  /** Lifts the veil if `world:ready` never arrives — see `showTravelVeil`. */
  private travelWatchdog?: Phaser.Time.TimerEvent;
  private lastStep: TutorialStepEvent | null = null;
  /** Heart milestones banked while the tutorial owns the bubble (see playRegardBeats). */
  private pendingHearts: Array<{ characterId: string; hearts: number }> = [];
  /** Beats held because their speaker does not stand in the world the player is
   *  in (see `speakHere`). Flushed on `world:switched`. */
  private pendingAway: Array<{ speaker: SpeakerId; lines: string[] }> = [];
  /** Authored-event beats (`event:say` / `event:prompt`) held while a tutorial
   *  script owns the bubble, or while an unanswered prompt owns the screen —
   *  played, in order, the moment whichever gate holds them opens. */
  private pendingEvents: Array<{ say?: EventMap['event:say']; prompt?: EventMap['event:prompt'] }> = [];
  private choice!: ChoicePrompt;
  /** The opening's held silence is a one-shot: only the very first step of a
   *  run waits, and a resumed save never re-holds. */
  private openingHeld = false;
  private offBus: (() => void)[] = [];
  // Tutorial markers are anchored to BOARD CELLS, not the screen: the board
  // camera pans/zooms over the big map, so each frame we re-project the cell to
  // its current on-screen spot (update()). Otherwise a marker would appear glued
  // to the screen and slide off its target the moment the camera moves.
  //
  // And to the PIECE, not merely the cell, whenever a piece is what the marker
  // means: both ends are `MarkerPoint`s, so update() asks where that piece is
  // standing this frame rather than replaying where it stood when the hand went
  // up. That is the difference between a gauntlet that follows the dragon the
  // player is dragging and one left hovering over the tile it started on.
  private handDrag: { from: MarkerPoint; to: MarkerPoint } | null = null;
  /** True while the HAND is showing an idle merge hint rather than a tutorial
   *  beat — so the hint only ever takes back what the hint put there. */
  private hintHand = false;
  /**
   * WHO IS HOLDING THE HAND — stated, not inferred.
   *
   * It used to be deduced: "the hand is visible and `hintHand` is false, so the
   * tutorial must own it". That reading has no way back. Anything that raised
   * the hand without setting one of the two flags — a lesson that ended without
   * clearing, a beat interrupted by a crossing — left `visible` true with no
   * claimant, and from that moment `hint:merge` was refused for the rest of the
   * session, in every world. Which is exactly the shape of the bug: the merge
   * hint stopped appearing in Borealis AND on the isle you came back to.
   *
   * An owner is a fact. `placeHand` records one, `clearMarkers` clears it, and
   * the hint asks a question with an answer instead of guessing from a pixel.
   */
  private handOwner: 'tutorial' | 'hint' | 'carry' | null = null;

  /**
   * Is any modal panel out?
   *
   * Every panel in this scene is a full-screen scrim plus a plate, so "open"
   * and "the board is hidden" are the same fact. The idle merge hint asks this
   * before pointing at a cell; the tutorial deliberately does NOT, because its
   * hand's whole job is sometimes to point at a control ON one of these.
   *
   * Listed rather than derived: there is no registry of panels to walk, and a
   * panel missing from this list fails SILENTLY (a hand over a shelf), so the
   * list is the thing to update when a ninth panel arrives.
   */
  private panelUp(): boolean {
    return (
      this.ledger.isOpen ||
      this.shop.isOpen ||
      this.bag.isOpen ||
      this.commission.isOpen ||
      this.store.isOpen ||
      this.cauldron.isOpen ||
      this.cookbook.isOpen ||
      this.codex.isOpen ||
      this.topUp.isOpen ||
      // The two DIALOGS are over the board exactly as much as a panel is, and
      // were missing from a test whose whole point is that there be only one of
      // it. The Settings sheet is the one the player opens most, and it is the
      // one that is not a panel.
      this.dialog !== null ||
      this.iapDialog !== null
    );
  }
  /** The carry lesson holds the hand until the thing has been carried — see
   *  `hint:carry`. Kept apart from `hintHand` so the idle merge suggestion
   *  cannot take the hand out from under a lesson in progress. */
  private carryHand = false;
  private handProg = { t: 0 }; // 0..1 along from→to, driven by a looping tween
  private handPoint: (() => { x: number; y: number } | null) | null = null;
  /** `height` = how far the target extends below the anchor point (0 for a
   *  button, a full standee for a world character) — see update(). */
  private arrowAnchor: (() => { x: number; y: number; height?: number } | null) | null = null;
  /** The tile a tile-anchored arrow names (null for UI/character/fog arrows). */
  private arrowTile: MarkerPoint | null = null;
  /** The character a character-anchored arrow names. */
  private arrowCharacter: string | null = null;
  /** The UI target a ui-anchored arrow names. */
  private arrowUi: TutorialUiTarget | null = null;
  /** True while the arrow is anchored to a board PIECE — see update(): only
   *  those go quiet when their anchor stops answering. */
  private arrowOnPiece = false;
  /** A generator's skip offer is on screen, so it owns the pointer over the
   *  board (see `setSkipPinOpen`). */
  private skipPinOpen = false;
  private arrowLift = 128;
  private arrowBob = { v: 0 };
  private handBob = { v: 0 }; // tap-press offset for the point gesture
  // Real art loads at native pixel size — markers scale to a fixed screen
  // height, and every pulse/squash tween works RELATIVE to these bases (an
  // absolute `scale: 1` would balloon the 480px gauntlet to full size).
  private handBaseScale = 1;
  private arrowBaseScale = 1;
  // Looping marker tween-chains (bounce cycles); destroyed on every step
  // change — killTweensOf alone doesn't reliably reach chain children.
  private markerFx: Phaser.Tweens.TweenChain[] = [];

  constructor() {
    super(SCENES.ui);
  }

  create(): void {
    this.ctx = this.registry.get('ctx') as GameContext;
    this.cameras.main.setOrigin(0).setZoom(renderScale.value); // paint the 2560-space UI into the hi-DPI backing

    this.buildVignette(); // warm finishing grade under the HUD, over the board

    this.hud = new Hud(this, this.ctx.bus, this.ctx.state, {
      onLedger: () => (this.ledger.isOpen ? this.ledger.requestClose() : this.ledger.open()),
      onGear: () => this.openResetDialog(),
      // The satchel sits on screen from the first frame. Until its lesson, the
      // button answers by re-pointing at the current step rather than opening an
      // empty panel over the board (tutorial-design law 3).
      onBag: () => {
        if (!this.bagAllowed()) {
          this.nudgeMarkers();
          return;
        }
        return this.bag.isOpen ? this.bag.requestClose() : this.bag.open();
      },
      // Cosmetics only — nothing in there advances play, so it stays shut for
      // the whole tutorial rather than competing with the lesson on screen.
      onStore: () => {
        if (!this.storeAllowed()) {
          this.nudgeMarkers();
          return;
        }
        return this.store.isOpen ? this.store.requestClose() : this.store.open();
      }
    });
    this.hud.ledgerButton.setDepth(DEPTH_HUD);
    this.hud.bagButton.setDepth(DEPTH_HUD);
    this.hud.storeButton.setDepth(DEPTH_HUD);
    this.hud.storeButton.setVisible(this.ctx.state.tutorialDone && this.shopUnlocked());
    // SEEDED HERE AND RE-ASKED WHEN THE SAVE LANDS, for the reason the `{dragon}`
    // token below already gives: `create()` runs BEFORE `beginRun` loads the
    // save, so this reads an EMPTY bag on every boot and the badge hides itself.
    // Nothing re-announced it — `bag:changed` only fires when the bag is
    // touched — so a Keeper who reopened the game with six stacks in her satchel
    // saw no count at all until she pocketed a seventh. Crossing a world rebuilt
    // the scene against a loaded state and the number appeared, which is why it
    // looked like the badge disagreed with itself from world to world.
    this.hud.setBagCount(this.ctx.state.bag.length);
    this.hud.gearButton.setDepth(DEPTH_HUD);

    this.tooltip = new Tooltip(this, this.ctx.data.chains);
    this.tooltip.setDepth(DEPTH_PANEL - 5);

    this.ledger = new LedgerPanel(
      this,
      this.ctx.bus,
      this.ctx.systems.order,
      this.ctx.systems.tasks,
      this.ctx.state,
      this.ctx.data.chains
    );
    this.ledger.setDepth(DEPTH_PANEL);
    // The `?` sheet stands OVER the Ledger that opened it — the card it explains
    // has to still be there behind it when it closes.
    this.recipeHelp = new RecipeHelpPanel(
      this,
      this.ctx.bus,
      this.ctx.state,
      this.ctx.data.chains,
      this.ctx.data.cauldron
    );
    this.recipeHelp.setDepth(DEPTH_PANEL + 9);
    // The SAME ladder, raised under the cursor on a quest row instead of two
    // panels away. A second instance rather than a mode on the first: the
    // modal one owns a scrim and a ✕ that a hint must never have, and a panel
    // that puts those on and takes them off is a panel that will one day leave
    // a scrim over a live board. It seats itself under the modal's depth, so
    // the `?` always wins when both could speak.
    this.recipePeek = new RecipeHelpPanel(
      this,
      this.ctx.bus,
      this.ctx.state,
      this.ctx.data.chains,
      this.ctx.data.cauldron,
      'peek'
    );
    this.recipePeek.setDepth(DEPTH_PANEL + 8);

    this.bag = new BagPanel(this, this.ctx.bus, this.ctx.state, this.ctx.data.chains);
    // Opens on nest:hatched and cannot be dismissed — the dragon is waiting.
    this.naming = new NamePanel(this, this.ctx.bus);
    this.naming.resolveChain = (itemId) => this.ctx.state.items.get(itemId)?.chain;
    void this.naming;
    // Answers `ui:travel_requested` from a portal tap; owns its own bus release.
    new TravelPrompt(this, this.ctx.bus);
    this.choice = new ChoicePrompt(this, this.ctx.bus);
    this.bag.setDepth(DEPTH_PANEL + 6);
    this.commission = new CommissionPanel(this, this.ctx.bus, this.ctx.state, this.ctx.data.chains);
    // Above the Bag: it is asked ABOUT the bag's contents, and the two are never
    // usefully open at once.
    this.commission.setDepth(DEPTH_PANEL + 9);
    this.shop = new ShopPanel(this, this.ctx.bus, this.ctx.state);
    this.shop.setDepth(DEPTH_PANEL + 8); // above the ledger

    this.store = new StorePanel(this, this.ctx.bus, this.ctx.state, this.ctx.data.store, this.ctx);
    this.store.setDepth(DEPTH_PANEL + 7);

    // ABOVE EVERY PANEL (69 is the highest, the Commission's), because it is
    // always raised OVER one and its scrim is what keeps the shelf underneath
    // from taking a second tap. Still well under the tutorial band (100) and
    // the dialog band (200): it is post-tutorial-only, and the IAP confirm card
    // it hands the player on to must be able to sit on top of it.
    this.topUp = new TopUpNotice(this, this.ctx.bus, this.ctx.state, (source) =>
      this.goToCoinShop(source)
    );
    this.topUp.setDepth(DEPTH_PANEL + 15);

    // Selyna's Cauldron — opened by tapping the pot decor in the Runevault hub.
    this.cauldron = new CauldronPanel(this, this.ctx.bus, this.ctx);
    this.cauldron.setDepth(DEPTH_PANEL + 7);
    this.offBus.push(this.ctx.bus.on('ui:cauldron_tapped', () => this.cauldron.open()));

    this.cookbook = new CookbookPanel(this, this.ctx.bus, this.ctx.state, {
      ...this.ctx.data,
      worldId: this.ctx.state.worldId
    });
    this.cookbook.setDepth(DEPTH_PANEL + 4);
    this.cookbookButton = this.buildCookbookButton();

    // The Dragon Codex — the keepsake record behind the dragon-head button.
    // Both appear only once a dragon has been NAMED: the roster is the reason
    // the button exists, so an empty book never opens.
    this.codex = new DragonCodexPanel(
      this,
      this.ctx.bus,
      this.ctx.systems.dragons,
      this.ctx.data.dragondex,
      this.ctx.data.chains,
      this.ctx
    );
    this.codex.setDepth(DEPTH_PANEL + 4);
    this.codexButton = this.buildCodexButton();
    // A scripted reveal opens the book itself on the named dragon's page and
    // plays the favourite-meal beat. Deferred a breath so whatever celebration
    // triggered it lands first — the popup follows the moment, never overlaps it.
    this.offBus.push(
      this.ctx.bus.on('ui:codex_open_requested', ({ reveal, page }) => {
        const first = this.ctx.systems.dragons.namedDragons()[0];
        if (!first || this.codex.isOpen) return; // every lesson beat asks; the first one opens
        const at = page ?? 'roster';
        this.time.delayedCall(reveal ? 700 : 0, () => {
          if (this.codex.isOpen) return;
          if (reveal) this.codex.openReveal(first.itemId);
          else this.codex.openAt(first.itemId, at);
        });
      })
    );

    // On-screen quest readout, top-right. Backgroundless HUD summary of the
    // quest ladder — the active quest over its own ordered subquests.
    this.questTracker = new QuestTracker(this, this.ctx.bus, this.ctx.systems.quests);
    this.questTracker.setDepth(DEPTH_HUD);
    this.questTracker.setStoryVisible(this.ctx.state.tutorialDone);
    this.questTracker.setTasksVisible(this.ctx.state.tutorialDone);

    // Directly under the quest cluster: who the player is looking at, and how
    // that person or animal feels about them. Same backgroundless language.
    this.statusPanel = new StatusPanel(
      this,
      this.ctx.bus,
      this.ctx.state,
      this.ctx.data.chains,
      this.ctx.systems.regard,
      this.ctx.systems.dragons
    );
    this.statusPanel.setDepth(DEPTH_HUD);
    // Field initialisers run once per scene INSTANCE, and this scene is reused
    // across a restart — so the latch is seated here, where a resumed save gets
    // it from the one fact that survives: a mid-tutorial reload replays its
    // step, which re-latches on its own if that beat has been reached.
    this.statusTaught = this.ctx.state.tutorialDone;
    this.statusPanel.setEnabled(this.statusTaught);

    // The reveal card. It plays wherever it is earned, tutorial or not — the
    // one thing it must never do is arrive long after the moment it is about.
    this.reveal = new DragonReveal(this, this.ctx.bus, this.ctx);

    this.bubble = new CharacterBubble(this, this.ctx.bus, this.ctx.data.chains);
    // THE ONE DOOR onto lazily-fetched ring art (`ensureRingArt`). Hung on the
    // bubble's own speaker swap rather than on the call sites that were known
    // when the Elder got a voice, so every path that can name a speaker — a
    // tutorial beat authored in her voice included — fetches her face.
    this.bubble.onSpeakerArtNeeded((speaker) => this.ensureRingArt(speaker));
    // The phone bubble is anchored bottom-right and grows up-left — over the
    // level cluster's corner. The cluster yields for exactly as long as the
    // words are up. Desktop's bubble never reaches it; nothing changes there.
    if (IS_MOBILE) {
      this.bubble.onVisibilityChanged((visible) => {
        this.hud.setLevelVisible(!visible);
        // The tall sheets hold the upper seat only while the card speaks —
        // a card arriving or leaving mid-panel glides them between seats.
        this.codex.seatForDialogue(visible, true);
        this.store.seatForDialogue(visible, true);
      });
    }
    // The tall sheets ask this at every open: centred in the full screen,
    // unless a dialogue owns the bottom band right now.
    this.codex.dialogueUp = () => this.bubble.visible;
    this.store.dialogueUp = () => this.bubble.visible;
    // Sit low AND shifted right — clear of the front-left 3D Crystal it used to
    // cover, over the empty bottom-right margin during tutorial steps.
    this.bubble.setPosition(LIVE_GAME_WIDTH / 2 + 220, LIVE_GAME_HEIGHT - 150);
    this.bubble.setDepth(DEPTH_TUTORIAL);
    this.bubble.registerUi();
    // GIVE is a two-part act: the bag arms it, the board delivers it. The panel
    // has to get out of the way in between, or the recipient is behind it.
    //
    // Tracked in `offBus` because THIS SCENE restarts (Reset → Title → Play): an
    // untracked handler would still be listening on the next run, and a second
    // copy of this one would arm the same gift twice.
    this.offBus.push(
      this.ctx.bus.on('ui:bag_give_requested', ({ chain, tier }) => {
        this.bag.requestClose();
        this.ctx.bus.emit('bag:give_armed', { chain, tier });
      })
    );
    // `{dragon}` in any authored line resolves to what the player called her,
    // and the bubble paints it in lava. Kept live off the naming fact — and
    // re-asked when a SAVE lands, which is the only way a resumed run learns it.
    //
    // Seeding here alone was a beat too early: `create()` runs BEFORE
    // `beginRun` loads the save (the same ordering `buildPortals` and the key
    // badges already work around), so on a reopened game `firstNamed()` was
    // asked of an empty board, answered nothing, and every later line spoke the
    // token raw — "Drag {dragon} and drop her on the House". The name was never
    // lost; nobody had told the bubble.
    //
    // `namedDragons` backs `firstNamed` up because the token is WHAT THE PLAYER
    // CALLED HER, not who happens to be standing underfoot: `firstNamed` reads
    // the active board only, so a dragon that walked through the Ember Gate
    // would take her own name out of Eleanor's mouth for as long as the Keeper
    // stayed behind.
    const speakHerName = (): void => {
      const named = this.ctx.systems.dragons.firstNamed() ?? this.ctx.systems.dragons.namedDragons()[0];
      if (named) this.bubble.setToken('dragon', named.name);
    };
    speakHerName();
    this.offBus.push(
      this.ctx.bus.on('state:loaded', speakHerName),
      // The same beat, for the two badges that are also read out of a state the
      // scene was built before: the satchel's count and the Cookbook's dot.
      this.ctx.bus.on('state:loaded', () => {
        this.hud.setBagCount(this.ctx.state.bag.length);
        this.syncCookbookDot();
      }),
      this.ctx.bus.on('dragon:named', ({ name }) => {
        this.bubble.setToken('dragon', name);
        this.revealCodexButton();
      })
    );

    this.hand = this.add.image(0, 0, 'ui_hand').setDepth(DEPTH_TUTORIAL + 2).setVisible(false);
    // A replaced hand/arrow (UI Builder upload) may carry its own anchor so the
    // fingertip / arrow tip still lands exactly on the guided target.
    const [hx, hy] =
      uiRegistry.replacementAnchor('ui_hand') ?? this.ctx.data.anchors.byKey['ui_hand'] ?? [0.3, 0.12];
    this.hand.setOrigin(hx, hy);
    // The real gauntlet/arrow art loads at its native pixel size; scale each to a
    // fixed on-screen height (2560-space) so the markers read like tutorial
    // pointers regardless of source resolution.
    this.handBaseScale = HAND_MARKER_H / this.hand.height;
    this.hand.setScale(this.handBaseScale);
    this.arrow = this.add.image(0, 0, 'ui_arrow').setDepth(DEPTH_TUTORIAL + 1).setVisible(false);
    const [ax, ay] = uiRegistry.replacementAnchor('ui_arrow') ?? this.ctx.data.anchors.byKey['ui_arrow'] ?? [0.5, 1];
    this.arrow.setOrigin(ax, ay);
    this.arrowBaseScale = ARROW_MARKER_H / this.arrow.height;
    this.arrow.setScale(this.arrowBaseScale);

    // Close the tooltip on taps that land outside it.
    //
    // `getWorldPoint`, and it is not a flourish: the pointer arrives in the
    // CANVAS's space and this rect is built from the tooltip's own position in
    // the 2560-space the UI is authored in. The camera bridges them by
    // `renderScale` (GameConfig), which is 1 on an ordinary desktop and nowhere
    // else — 0.5 on iOS, 0.34 on a weak device. Compared raw, a tap INSIDE the
    // tooltip reads as outside on every one of those and shuts it under the
    // finger that was reaching for it.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.tooltip.visible) return;
      const bounds = new Phaser.Geom.Rectangle(
        this.tooltip.x - 240,
        this.tooltip.y - 264,
        480,
        304
      );
      const at = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      if (!bounds.contains(at.x, at.y)) this.tooltip.close();
    });

    this.subscribe();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.offBus.forEach((off) => off());
      this.offBus = [];
      // Clean up UI-class bus subscriptions (not tracked in offBus above).
      this.hud.teardown();
      this.ledger.teardown();
      this.recipeHelp.teardown();
      this.recipePeek.teardown();
      this.cookbook.teardown();
      this.codex.teardown();
      this.shop.teardown();
      this.topUp.teardown();
      this.commission.teardown();
      this.questTracker.teardown();
      this.statusPanel.teardown();
    });

    // Resuming past the tutorial: the key LESSON is over, but the pill still
    // follows the wallet (Hud.syncKeyPill) — Borealis buys its fog with keys.
    if (this.ctx.state.tutorialDone) this.hud.setKeyVisible(false);

    // Tool-authored components (ui-theme.json `custom`) — part of the real UI.
    new CustomUiManager(this).buildAll();

    // Everything is wired: load the save (or start fresh) and roll the tutorial.
    this.ctx.beginRun();
  }

  override update(_time: number, delta: number): void {
    this.reveal.tick(delta);
    // A PANEL OPENED OVER A STANDING HINT. The gate in `hint:merge` stops one
    // from going up while a panel is out; this is the other order of events,
    // and it is the common one — the hand appears on a quiet board, then the
    // player opens the shop it was waiting for them to afford. Withdrawn here
    // rather than on eight `*_opened` events, because the question is "is any
    // panel up", not "did this one just open", and one test cannot drift out
    // of sync with the others.
    if (this.hintHand && this.panelUp()) {
      this.hintHand = false;
      this.clearMarkers();
    }
    // Same question, same answer, one frame later: the quest tracker stops
    // reaching for the pointer while anything is over the board.
    this.questTracker.setSuppressed(this.panelUp());
    // Re-project board-anchored tutorial markers EVERY frame so they stay glued
    // to their cell as the board camera pans/zooms (they live on the UI scene's
    // own fixed camera, so without this they'd appear stuck to the screen).
    if (this.hand.visible) {
      if (this.handDrag) {
        // Both ends re-read from the live board. An end that answers `null` has
        // lost the piece it was aimed at — merged, sold, pocketed, or standing
        // on a board the player has left — and the honest response is to take
        // the hand back rather than let it finish its stroke over the tile a
        // piece used to occupy. (The tutorial re-aims itself an instant later
        // off `item:removed`; a lesson's hand simply goes.)
        const from = markerPointCell(this.ctx.state, this.handDrag.from);
        const to = markerPointCell(this.ctx.state, this.handDrag.to);
        if (!from || !to) {
          // Nothing to point at any more. clearMarkers() also drops the arrow
          // and the owner, so the block below finds nothing to re-anchor.
          this.clearMarkers();
        } else {
          const f = this.cellToScreen(from.col, from.row);
          const t = this.cellToScreen(to.col, to.row);
          this.hand.setPosition(
            Phaser.Math.Linear(f.x, t.x, this.handProg.t) + 16,
            Phaser.Math.Linear(f.y, t.y, this.handProg.t) - 12
          );
        }
      } else if (this.handPoint) {
        const p = this.handPoint();
        if (p) this.hand.setPosition(p.x, p.y + this.handBob.v);
      }
    }
    if (this.arrow.visible && this.arrowAnchor) {
      const a = this.arrowAnchor();
      // A PIECE-anchored arrow whose piece is gone points at nothing, so it
      // goes. A UI-anchored one answering null is a different thing entirely —
      // a control that is off-screen for a beat (the Codex's ✕ behind a held
      // page) — and that one keeps its place, exactly as it always has.
      if (!a && this.arrowOnPiece) this.arrow.setVisible(false);
      if (a) {
        // A target near the top of the screen (the ⚡+ Warmth button) would push
        // the down-pointing arrow off-screen above it — so flip it UP and sit it
        // just BELOW, pointing at the button. Mid/low targets keep the normal
        // above-and-pointing-down arrow. Re-evaluated each frame so the smart
        // marketplace target (top +button vs centred FREE card) is handled live.
        const nearTop = a.y < 220;
        this.arrow.setFlipY(nearTop);
        this.arrow.setPosition(
          a.x,
          nearTop
            // `a.height` is how far the target extends BELOW its anchor point —
            // 0 for a button, but a whole standee for a world character. Without
            // it the flipped arrow is drawn across the thing it is pointing at.
            ? a.y + (a.height ?? 0) + 18 + this.arrow.displayHeight + this.arrowBob.v
            : a.y - this.arrowLift + this.arrowBob.v
        );
      }
    }

    // ~Twice a second, refresh the "next +1 Warmth" countdown on the energy gauge.
    this.regenAccum += delta;
    if (this.regenAccum < 500) return;
    this.regenAccum = 0;
    const state = this.ctx.state;
    if (state.energyCurrent >= state.energyMax) {
      this.hud.setRegenText('');
      return;
    }
    const left = Math.max(0, state.energyLastRegenAt + ENERGY_REGEN_MS - this.ctx.clock.now());
    const s = Math.ceil(left / 1000);
    this.hud.setRegenText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  }

  /* --------------------------- subscriptions ------------------------ */

  private subscribe(): void {
    const bus = this.ctx.bus;
    this.offBus.push(
      bus.on('tutorial:step', (step) => this.onTutorialStep(step)),
      // The beat has not changed — only where it points. Markers only: the
      // bubble, the permissions and the staging all stay exactly as they are.
      bus.on('tutorial:markers', (markers) => {
        const step = this.lastStep;
        if (!step || step.done) return;
        const was = `${markerAim(step.hand)}|${markerAim(step.arrow)}`;
        step.highlight = markers.highlight;
        step.hand = markers.hand;
        step.arrow = markers.arrow;
        const now = `${markerAim(markers.hand)}|${markerAim(markers.arrow)}`;
        // THE PIECE MOVING IS NOT THE MARKER CHANGING. This event fires on every
        // board change so the BOARD can repaint its highlights, and a marker that
        // still names the same piece is already following it live in update() —
        // re-placing it here would restart the gesture from the top, mid-drag,
        // which is the flicker the old cell-anchored pointer had instead of a
        // fix. Only a marker that now names something ELSE is put up again.
        //
        // Unless nothing of ours is on screen to follow: a crossing or a panel
        // takes the hand down without the beat changing, and an unchanged aim
        // must not be the reason the pointer never comes back.
        const showing = markers.hand
          ? this.handOwner === 'tutorial' && this.hand.visible
          : markers.arrow
            ? this.arrow.visible
            : false;
        if (showing && now === was) return;
        // A hand mid-gesture over a piece the player has already picked up is
        // the thing being fixed, so this re-places rather than waiting for the
        // current sweep to finish.
        this.applyMarkers(step);
      }),
      // THE SECOND HALF OF A TWO-PART STEP. `eleanor_helps` says "tap me, then
      // tap the House" and carries an `arrowThen` naming that House — resolved
      // with the step since 0ce3efd and, until now, never drawn by anybody. The
      // player who did as they were told arrived at the second half with the
      // arrow still on her and nothing pointing at what to do next.
      bus.on('ui:character_armed', ({ armed }) => {
        const step = this.lastStep;
        if (!step || step.done || !step.arrowThen) return;
        this.clearMarkers();
        const next = armed ? step.arrowThen : step.arrow;
        if (next) this.placeArrow(next);
      }),
      bus.on('dragon:revealed', (card) => this.reveal.play(card)),
      bus.on('story:chapter', ({ chapter }) => this.playChapterBeats(chapter)),
      // The event system's outputs (docs/event-creator.md). Queued behind a
      // running tutorial script like every other unscripted beat.
      bus.on('event:say', (say) => this.playEventBeat({ say })),
      bus.on('event:prompt', (prompt) => this.playEventBeat({ prompt })),
      // THE ANSWER IS WHAT UNBLOCKS THE NEXT QUESTION. A beat held because a
      // prompt was already open used to wait on `tutorial:step`'s done beat —
      // the queue's only drain — and once the script and any mid-game lesson
      // have ended no `tutorial:step` ever arrives again: the beat, and the
      // branch behind it, were stranded for the rest of the session.
      //
      // Next tick, not inline: this fires INSIDE ChoicePrompt's emit, ahead of
      // EventSystem running the branch the player just chose, and that branch's
      // own line is a direct consequence of the answer — it speaks first.
      // Whatever is still blocked when the drain runs re-queues itself in
      // `playEventBeat`, in order, and waits for the next answer.
      bus.on('ui:event_choice', () => {
        if (!this.pendingEvents.length) return;
        this.time.delayedCall(0, () => this.drainEventQueue());
      }),
      bus.on('ui:panel_open_requested', ({ panel }) => this.openPanel(panel)),
      bus.on('story:arrival', ({ worldId }) => this.playArrivalBeats(worldId)),
      // The House's commission. The board decides WHEN to ask; the panel is the
      // UI's, so neither reaches into the other.
      bus.on('ui:commission_requested', ({ itemId }) => {
        this.commission.openFor(itemId);
        // Once ever: the panel says WHAT it wants, she says why it matters —
        // that the choice cannot be taken back, which is the part a title bar
        // cannot carry.
        this.showHint('houseCommission', 6500);
      }),
      bus.on('generator:produce_set', ({ chain, tier }) =>
        this.floatWarning(`This house now makes ${this.pieceName(chain, tier)}.`)
      ),
      bus.on('generator:produce_refused', ({ reason }) =>
        this.floatWarning(
          reason === 'not_in_bag'
            ? 'Pocket one first — a house can only make what you carry.'
            : reason === 'already_set'
              ? 'This house is already spoken for. Build another.'
              : 'That cannot be commissioned.'
        )
      ),
      // ---- Regard: the five hearts. She speaks for herself in all three cases;
      // a relationship gauge that only ever moved a row of icons would be a
      // scoreboard, and the icons are the LEAST of what is meant to change.
      bus.on('regard:gift_accepted', ({ characterId, chain, tier }) =>
        this.sayGiftLine(characterId, true, tier + chain.length)
      ),
      bus.on('regard:gift_declined', ({ characterId, chain, tier }) =>
        this.sayGiftLine(characterId, false, tier + chain.length)
      ),
      bus.on('regard:heart', ({ characterId, hearts }) => this.playRegardBeats(characterId, hearts)),
      bus.on('ui:ledger_toggled', () => {
        // applyMarkers() below wipes ALL markers — retire an active recipe
        // demonstration cleanly rather than leaving its state half-cleared.
        this.clearRecipeHint();
        if (this.lastStep) this.applyMarkers(this.lastStep);
        this.tooltip.close();
      }),
      bus.on('item:tapped', ({ itemId }) => this.maybeShowTooltip(itemId)),
      bus.on('item:removed', ({ itemId }) => {
        if (this.tooltip.openItemId === itemId) this.tooltip.close();
        this.refreshRecipeHint();
      }),
      bus.on('item:moved', () => this.refreshRecipeHint()),
      bus.on('item:merged', (payload) => {
        this.tooltip.close();
        // A fresh Flame Gem flies toward the Ledger (where the magic happens) —
        // pure juice, no game state depends on it.
        if (payload.chain === 'flame_gem' && payload.resultTier === 2) {
          this.flyGemToLedger(payload.at, payload.resultTier);
        }
        // A merge may have completed a 2→1 pair (2nd Dragon, 2nd House) — let
        // the pop settle, then offer the recipe demonstration.
        this.time.delayedCall(700, () => this.checkRecipeHints());
      }),
      // A Coin is a PIECE now, so gold arrives when one is sold out of the Bag
      // rather than when it is tapped on the board — the flight follows it.
      bus.on('item:sold', ({ chain, tier }) => {
        if (chain !== 'coin') return;
        this.flyCoinToGold(undefined, tier === 2 ? 3 : 1);
      }),
      bus.on('bag:stored', ({ chain, tier, at }) => this.flyItemToBag(chain, tier, at)),
      bus.on('bag:changed', ({ used }) => this.hud.setBagCount(used)),
      bus.on('bag:store_failed', ({ reason, world }) =>
        this.floatWarning(
          reason === 'full'
            ? 'Bag is full!'
            : reason === 'wrong_world'
              ? `Only in ${this.ctx.state.worlds.get(world ?? '')?.name ?? 'its own world'}!`
              : 'No room on the board!'
        )
      ),
      // A character's refusal is never silent. `not_mine` is the story one:
      // she cannot wake what is sleeping, and saying so every time is what
      // teaches the mystery long before chapter 8 explains it.
      // Husbandry feedback — a nest that refuses, a dragon that grows up.
      bus.on('nest:offer_refused', ({ reason }) =>
        this.floatWarning(
          reason === 'daily_cap'
            ? 'It has taken all it will today.'
            : 'It will not eat that.'
        )
      ),
      bus.on('nest:warmed', ({ points, required }) =>
        this.floatWarning(`The nest is warmer.  ${points} / ${required}`)
      ),
      bus.on('companion:named', ({ name }) => this.floatWarning(`${name}.  That's a real one, then.`)),
      bus.on('companion:refused', ({ companionId }) => {
        const c = this.ctx.systems.dragons.find(companionId);
        this.floatWarning(`${c?.name || 'It'} turns its head away.`);
      }),
      bus.on('companion:gave', ({ companionId, kind }) => {
        const c = this.ctx.systems.dragons.find(companionId);
        this.floatWarning(
          kind === 'dug' ? `${c?.name || 'It'} dug this up for you.` : `${c?.name || 'It'} brought you something.`
        );
      }),
      bus.on('companion:grew', ({ companionId }) => {
        const c = this.ctx.systems.dragons.find(companionId);
        this.floatWarning(`${c?.name || 'It'} has grown.`);
      }),
      bus.on('character:action_failed', ({ reason }) =>
        this.floatWarning(
          reason === 'cooldown'
            ? 'She needs to rest first.'
            : reason === 'not_mine'
              ? '“That one\u2019s yours.”'
              : 'Nothing there she can hurry.'
        )
      ),
      bus.on('ui:shop_requested', ({ currency }) => {
        if (!(this.tutorialOver() || (this.lastStep?.allow.marketplace ?? false))) return;
        this.shop.open(currency);
      }),
      // Real-money packs: strictly post-tutorial (the buy_energy beat allows
      // the Emporium, never a checkout — its gate is the free Warmth).
      bus.on('ui:iap_buy_requested', ({ packId }) => {
        if (!this.tutorialOver()) return;
        this.openIapConfirmDialog(packId);
      }),
      /*
       * THE SHORTFALL NOTICE, AND THE ONE GATE THAT CAN BRICK A PLAYTHROUGH.
       *
       * `!this.lastStep?.done` — the SAME test the checkout above uses, and for
       * a harder reason. Step 58 (`buy_energy`) has `allow: marketplace`, so
       * the Emporium is open mid-tutorial, and its WARMTH rows 2 and 3 cost 60
       * and 130 Gold. A player at that beat holding fewer than 60 taps "Hearth
       * Bundle" and gets a Gold refusal — mid-lesson, from a panel the script
       * put in front of them. Raise a modal over that and its scrim covers the
       * free Warmth plate (`ShopPanel.getFreeButtonPos`), which is the ONLY
       * thing that can fire `marketplace:purchased`, which is that step's gate.
       * The run would be unfinishable. So "the tutorial is over" is the test —
       * not "no lesson is on screen right now", which that beat would pass.
       *
       * The second half of the gate is `TOP_UP.offer`: a surface has to be
       * named there before it can put a paywall in front of anybody.
       */
      bus.on('ui:topup_requested', ({ label, price, source }) => {
        if (!this.tutorialOver()) return;
        if (!TOP_UP.offer[source]) return;
        if (this.topUp.isOpen || this.iapDialog || this.dialog) return;
        // A REFUSAL INSIDE A SHOP DOES NOT NEED TO BE ASKED TWICE. The player
        // came to spend, tapped a price and was told no; a card between them
        // and the till is a speed bump in an errand they already started. So
        // the shop surfaces go straight there, and the shortfall travels as a
        // floating line rather than as a panel — it is information, not a
        // question. `skip` keeps the card, because that refusal happens on the
        // board and switching halls there changes the subject (see TOP_UP.mode).
        if (TOP_UP.mode[source] === 'switch') {
          const short = Math.max(0, price - this.ctx.state.coins);
          this.goToCoinShop(source);
          if (short > 0) this.floatWarning(`${short} more gold for ${label}`);
          return;
        }
        this.topUp.open(label, price, source);
      }),
      /*
       * THE WAY BACK. Consumed on the first close after it was written, so a
       * ticket can never be spent twice, and dropped rather than followed when
       * the panel it names has since been closed by something else — the store
       * simply re-opens where it was, which is the whole promise.
       */
      bus.on('ui:shop_toggled', ({ open, cause }) => {
        if (open) return;
        // A close the game made on its own (the finale clearing the stage) is
        // not the player walking out of the coin shop. Drop the ticket rather
        // than follow it — re-opening the Store over the finale is worse than
        // losing a scroll position.
        if (cause === 'system') {
          this.topUpReturn = null;
          return;
        }
        const back = this.topUpReturn;
        this.topUpReturn = null;
        if (!back) return;
        this.store.open();
        this.store.restoreView(back.store);
      }),
      bus.on('iap:completed', (grant) => this.celebratePurchase(grant)),
      bus.on('iap:failed', ({ reason }) => this.onIapFailed(reason)),
      // A crossing changes the stall's catalogue (local goods are only on the
      // shelf in the world that makes them), so a ticket back to a section of
      // the old world's Store has stopped meaning anything — and a notice about
      // the price of skipping a House on the isle the player has just left is
      // about a piece that is no longer on the board.
      bus.on('world:switched', () => {
        this.topUpReturn = null;
        this.topUp.requestClose();
      }),
      bus.on('order:completed', ({ orderId, rewards }) => {
        this.time.delayedCall(650, () => {
          if (this.ledger.isOpen && this.lastStep?.gateType === 'tap') this.ledger.requestClose();
        });
        this.celebrateOrder(orderId, rewards);
      }),
      bus.on('keeper:leveled', ({ level }) => this.celebrateLevelUp(level)),
      bus.on('quest:completed', ({ questId }) => {
        // The Golden Elder's awakening — UIScene runs her voice, BoardScene the
        // camera and the egg, both off this one beat.
        if (questId === GOLDEN_ALTAR.awakenQuestId) {
          this.time.delayedCall(0, () => this.beat('trigger', () => this.runFinaleUi()));
        }
      }),
      bus.on('tasks:all_complete', () => this.celebrateTasksComplete()),
      bus.on('energy:changed', ({ current }) => {
        if (current === 0) this.showHint('zeroWarmth');
      }),
      bus.on('economy:changed', () => {
        // "The egg — look at the egg!" — fires once, when the altar egg exists
        // and Level 3 is close enough that it has started trembling.
        const [gained, span] = this.ctx.state.levelProgress;
        if (
          this.ctx.state.level === 2 &&
          gained / span >= GOLDEN_TREMBLE_PROGRESS &&
          this.ctx.state.completedOrderIds.includes(GOLDEN_ALTAR.orderId)
        ) {
          this.showHint('eggTrembles');
        }
      }),
      bus.on('item:harvest_failed', ({ reason }) => {
        if (reason === 'no_space') this.showHint('boardFull');
      }),
      bus.on('state:loaded', ({ offlineMs, energyRecovered }) => {
        this.maybeWelcomeBack(offlineMs, energyRecovered);
        // A returning save may already hold a ready 2→1 pair.
        this.time.delayedCall(2500, () => this.checkRecipeHints());
      }),
      bus.on('tutorial:step', (step) => {
        // Appears for its tutorial introduction, then permanently post-tutorial.
        this.cookbookButton.setVisible(step.done || step.allow.cookbook);
        // The Codex is a post-tutorial keepsake: the naming beat happens mid-
        // script, and a button appearing under the guided hand would compete
        // with it. It debuts with the rest of the HUD when the script ends.
        this.codexButton.setVisible(step.done && this.ctx.systems.dragons.namedDragons().length > 0);
        // (The Codex hold and its safety net moved into `onTutorialStep` —
        // `applyCodexHold` — because they have to run BEFORE the step's markers
        // are placed. This listener is registered after that one.)
        this.hud.storeButton.setVisible(step.done && this.shopUnlocked());
        // Safety net only — the cookbook_close step has the player close the
        // book themselves; any later step that disallows it just shuts it.
        if (!step.done && !step.allow.cookbook && this.cookbook.isOpen) {
          this.cookbook.requestClose();
        }
      }),
      bus.on('item:spawned', () => this.sweepFirstContact()),
      // A quest-reward egg never lands silently: while BoardScene flies the
      // camera to it (the shared EGG_GIFT timeline), the giver says what just
      // arrived. Line n of the chain's eggGift bank belongs to the n-th
      // spawning quest — derived from the done latches, so a reload can never
      // repeat or skip a line, and the last line covers any overflow.
      bus.on('item:spawned', ({ item, cause }) => {
        if (cause !== 'quest') return;
        const gift = this.ctx.data.dialogue.eggGift[item.chain];
        if (!gift || gift.lines.length === 0) return;
        const granted = this.ctx.data.quests.quests.filter(
          (q) => q.rewards?.spawn?.chain === item.chain && this.ctx.state.stat(`q:done:${q.id}`) > 0
        ).length;
        const line = gift.lines[Math.min(Math.max(granted - 1, 0), gift.lines.length - 1)]!;
        this.time.delayedCall(EGG_GIFT.sayDelayMs, () =>
          this.bubble.say(gift.speaker as SpeakerId, line, EGG_GIFT.sayHoldMs)
        );
      }),
      bus.on('tutorial:nudge', () => this.nudgeMarkers()),
      // The popup offers Gold AND Warmth; the tutorial only ever demonstrated
      // Warmth on the House, so name the cheaper option the first time it shows.
      bus.on('ui:skip_offered', () => {
        this.showHint('goldSkip');
        this.setSkipPinOpen(true);
      }),
      // …and the pointer comes back if the offer leaves unanswered.
      bus.on('ui:skip_dismissed', () => this.setSkipPinOpen(false)),
      bus.on('cookbook:discovered', ({ chain, fromTier, resultTier }) => {
        // The demonstrated recipe was performed — retire the guiding hand.
        if (`${chain}:${fromTier}>${resultTier}` === this.recipeHint) this.clearRecipeHint();
        if (!this.ctx.state.tutorialDone || this.cookbook.isOpen) return;
        this.syncCookbookDot();
        this.tweens.add({
          targets: this.cookbookButton,
          scale: { from: 1, to: 1.16 },
          duration: 140,
          yoyo: true,
          ease: 'Sine.easeOut'
        });
      }),
      bus.on('game:reset', () => {
        this.scene.stop(SCENES.board);
        this.scene.start(SCENES.title);
      }),
      // Travel: the veil goes up when the world flips and comes down when the
      // new board exists. Between those two the destination's backdrop is coming
      // over the network — without this the player taps a door and the game
      // simply does nothing for a second or two.
      bus.on('world:switched', ({ to }) => this.showTravelVeil(to)),
      bus.on('world:ready', () => {
        this.hideTravelVeil();
        this.sweepFirstContact();
      }),
      // The Roothold house is the Emporium's storefront — its tap opens the
      // same panel the (later-unlocked) HUD button does.
      bus.on('ui:emporium_requested', () => this.store.open()),
      bus.on('world:switched', ({ to }) => this.maybeStartTour(to)),
      // …and anything a speaker could not say from the world we just left. On
      // `world:ready`, not `world:switched`: the board has to exist under the
      // bubble, or she talks over the travelling curtain.
      bus.on('world:ready', () => this.flushAwayBeats()),
      // EVERY pointer drops at the door. BoardScene retracts its own on the way
      // out, but this scene is the one holding the hand and it does NOT restart
      // with the board — so this is the guarantee rather than the courtesy: a
      // hand left up after a journey points at cells that are not on screen any
      // more, and the arithmetic behind it (three rubies, over there) was true
      // of a board the player has left.
      bus.on('world:switched', () => {
        // UNCONDITIONAL. This used to be gated on the two flags this scene sets
        // itself, which only clears a hand THIS scene knows it raised — and the
        // symptom was a hand still pointing after the journey, so something was
        // getting past the gate. There is no pointer that should survive a
        // crossing: whatever raised it, it was aimed at cells on a board that is
        // being torn down. Clearing markers with nothing to clear is free.
        this.hintHand = false;
        this.carryHand = false;
        this.clearMarkers(); // also releases `handOwner`
      }),
      // The idle merge hint. UIScene owns the hand, so it — not the board —
      // is what decides the hand is free: the tutorial's own gestures always
      // win, and two hands pointing at different things is worse than none.
      bus.on('hint:merge', (hint) => {
        if (!hint) {
          if (!this.hintHand) return;
          this.hintHand = false;
          this.clearMarkers();
          return;
        }
        // A LESSON outranks an idle suggestion; nothing else does. The old test
        // asked whether the hand was visible, which is why an ownerless hand
        // silenced the hint forever.
        if (this.handOwner === 'tutorial' || this.handOwner === 'carry') return;
        // AND SO DOES AN OPEN PANEL — a hand pointing at a board the player
        // cannot see is not help, it is litter.
        //
        // The hand sits at DEPTH_TUTORIAL + 2 = 102 and the panels between 60
        // and 69, so it paints OVER every one of them. That is deliberate and
        // must stay: the tutorial's hand has to be able to point at the
        // Ledger's Deliver key and the Cookbook's ✕. But the idle hint points
        // at BOARD CELLS, and when a panel is up those cells are behind it —
        // so the gauntlet lands on a shop card, pointing at nothing, looking
        // exactly like a stray sprite. It was always possible (open a panel
        // while a hand is up); the 30s heartbeat is what made it likely,
        // because now the hint re-poses itself while you shop.
        if (this.panelUp()) return;
        // Same rule the board's tick uses: a beat can only be on screen in the
        // world the walkthrough is authored for, so `tutorialDone` alone was
        // silencing the hint for every save that left the isle early.
        if (!this.ctx.state.tutorialDone && this.ctx.state.worldId === WORLD_ID) return;
        this.hintHand = true;
        this.placeHand({ from: hint.from, to: hint.to }, 'hint');
      }),
      // The carry lesson — "pick it up and take it THERE". Outranks the idle
      // merge hint while it is up: the hint is a suggestion the player may
      // ignore, this is the one gesture a new mechanic is taught with.
      bus.on('hint:carry', (lesson) => {
        if (!lesson) {
          if (!this.carryHand) return;
          this.carryHand = false;
          this.hintHand = false;
          this.clearMarkers();
          return;
        }
        if (!this.ctx.state.tutorialDone) return;
        if (this.handOwner === 'tutorial') return; // only a beat outranks a lesson
        this.carryHand = true;
        this.hintHand = false;
        this.placeHand({ from: lesson.from, to: lesson.to }, 'carry');
      })
    );
  }

  /**
   * The travelling curtain: the old world burns away into iso diamonds, the
   * destination's name holds the dark while its art loads, and the same fire
   * reopens on the far side (technique notes in render/fx/travelWipeShader.ts;
   * every timing in Constants' TRAVEL_WIPE).
   *
   * It lives in UIScene rather than on the board because the board is exactly
   * what is being torn down and rebuilt — a veil parented to it would be
   * destroyed at the moment it is needed most. UIScene's camera is fixed and its
   * scene never restarts, so the curtain is the one thing on screen that spans
   * the whole journey.
   */
  private showTravelVeil(worldId: string): void {
    // A veil can only still exist here if a previous journey's reveal is
    // mid-flight; the new cover replaces it outright.
    if (this.travelVeil) this.destroyTravelVeil(this.travelVeil);

    const name = this.ctx.state.worlds.get(worldId)?.name ?? worldId;
    const root = this.add.container(0, 0).setDepth(DEPTH_TRAVEL_VEIL);
    // Input blocker from the very first frame — a Zone renders nothing but
    // swallows every tap, and the board a tap would reach is the one being
    // replaced. It spans the whole journey, reveal included.
    const block = this.add
      .zone(0, 0, LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT)
      .setOrigin(0)
      .setInteractive();
    root.add(block);

    const chrome = this.add.container(0, 0).setAlpha(0);
    const veil: TravelVeil = {
      root,
      chrome,
      pulse: [chrome],
      covered: false,
      coveredAt: 0,
      revealAsked: false,
      revealing: false
    };

    if (ensureTravelWipePipeline(this.game)) {
      // The burn: one fullscreen quad, one tweened uniform. The quad is a 1×1
      // white frame — every pixel comes from the shader.
      const wipe: TravelWipePipelineData = {
        progress: 0,
        invert: 0,
        time: this.time.now / 1000,
        aspect: LIVE_GAME_WIDTH / LIVE_GAME_HEIGHT,
        cellW: Math.min(LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT) / TRAVEL_WIPE.cellsShort / LIVE_GAME_HEIGHT,
        grow: TRAVEL_WIPE.growFrac,
        jitter: TRAVEL_WIPE.jitterFrac,
        edge: TRAVEL_WIPE.edge,
        alpha: 1,
        night: wipeRgb(PALETTE.night),
        deep: wipeRgb(PALETTE.plumShade),
        lava: wipeRgb(PALETTE.lava),
        accent: wipeRgb(PALETTE.goldAccent)
      };
      const quad = this.add
        .image(0, 0, '__WHITE')
        .setOrigin(0)
        .setDisplaySize(LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT);
      quad.pipelineData = wipe;
      quad.setPipeline(TRAVEL_WIPE_PIPELINE);
      root.add(quad);
      veil.wipe = wipe;
      veil.pulse.push(wipe);
      this.tweens.add({
        targets: wipe,
        progress: 1,
        duration: TRAVEL_WIPE.coverMs,
        ease: 'Sine.easeInOut',
        onUpdate: () => {
          wipe.time = this.time.now / 1000;
        },
        onComplete: () => this.travelVeilCovered(veil)
      });
    } else {
      // Canvas fallback: no pipelines, so the curtain is the plain fade it
      // always was.
      const scrim = this.add
        .rectangle(0, 0, LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, num(PALETTE.night), 0.97)
        .setOrigin(0)
        .setAlpha(0);
      root.add(scrim);
      veil.pulse.push(scrim);
      this.tweens.add({
        targets: scrim,
        alpha: 1,
        duration: 400,
        ease: 'Sine.easeOut',
        onComplete: () => this.travelVeilCovered(veil)
      });
    }

    // Destination name over an iso-diamond ornament — the ceremony of the
    // crossing. Sized against the live space so a portrait phone reads it.
    const s = IS_MOBILE ? 2.2 : 1;
    const cx = LIVE_GAME_WIDTH / 2;
    const cy = LIVE_GAME_HEIGHT / 2;
    const label = this.add
      .text(cx, cy - 46 * s, name.toUpperCase(), {
        fontFamily: FONT.display,
        fontSize: `${64 * s}px`,
        fontStyle: 'bold',
        color: PALETTE.cream
      })
      .setOrigin(0.5);
    const orn = this.add.graphics();
    const oy = cy + 26 * s;
    orn.lineStyle(3 * s, num(PALETTE.gold), 0.8);
    orn.lineBetween(cx - 170 * s, oy, cx - 34 * s, oy);
    orn.lineBetween(cx + 34 * s, oy, cx + 170 * s, oy);
    orn.fillStyle(num(PALETTE.goldAccent), 1);
    orn.fillPoints(
      [
        new Phaser.Geom.Point(cx - 18 * s, oy),
        new Phaser.Geom.Point(cx, oy - 10 * s),
        new Phaser.Geom.Point(cx + 18 * s, oy),
        new Phaser.Geom.Point(cx, oy + 10 * s)
      ],
      true
    );
    chrome.add([label, orn]);
    // Three breathing embers rather than a progress bar: the loader reports
    // bytes, not the scene rebuild that follows it, so a bar would fill and then
    // sit at full while the board was still being built — worse than no bar.
    // Drawn as circles, not `fx_glow`: that texture is a wide soft falloff (the
    // sun haze uses it at scale 7) and three of them this close smear into one
    // blob rather than reading as a count.
    for (let i = 0; i < 3; i++) {
      const dot = this.add.circle(cx + (i - 1) * 74 * s, cy + 108 * s, 13 * s, num(PALETTE.goldAccent)).setAlpha(0.22);
      this.tweens.add({
        targets: dot,
        alpha: 1,
        scale: 1.35,
        duration: 460,
        delay: i * 160,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
      chrome.add(dot);
      veil.pulse.push(dot);
    }
    // The name arrives once the burn owns most of the screen, rising a step —
    // it belongs to the curtain, not to the world still visible behind it.
    chrome.setY(26 * s);
    this.tweens.add({
      targets: chrome,
      alpha: 1,
      y: 0,
      delay: TRAVEL_WIPE.coverMs * 0.55,
      duration: 340,
      ease: 'Sine.easeOut'
    });
    root.add(chrome);
    this.travelVeil = veil;
    // A DEAD MAN'S SWITCH — kept from our own veil, which main's does not carry.
    // The curtain is interactive by design, so while it is up the player cannot
    // touch anything: it is the one overlay that must never outlive its cause.
    // If `world:ready` has not come by now the board is either broken or
    // unreachably slow, and a visible board the player can poke at beats a
    // burn they cannot leave. It says so in the console rather than failing
    // silently, because a veil that lifts on its own would otherwise hide
    // exactly the bug it is papering over.
    this.travelWatchdog?.remove();
    this.travelWatchdog = this.time.delayedCall(TRAVEL_VEIL_TIMEOUT_MS, () => {
      if (!this.travelVeil) return;
      console.warn(
        `[travel] no world:ready for "${worldId}" after ${TRAVEL_VEIL_TIMEOUT_MS}ms — lifting the veil anyway`
      );
      this.hideTravelVeil();
    });
  }

  /** The cover finished; if the destination is already built, reveal it. */
  private travelVeilCovered(veil: TravelVeil): void {
    veil.covered = true;
    veil.coveredAt = this.time.now;
    if (veil.revealAsked) this.beginTravelReveal(veil);
  }

  private hideTravelVeil(): void {
    const veil = this.travelVeil;
    if (!veil) return;
    veil.revealAsked = true;
    // `world:ready` can outrun the cover on a resident-art hop — the reveal
    // then waits for the cover to complete rather than fighting its tween.
    if (veil.covered) this.beginTravelReveal(veil);
  }

  private beginTravelReveal(veil: TravelVeil): void {
    if (veil.revealing) return;
    veil.revealing = true;
    // One delay serves two waits: the board camera's own 320ms fade-in (so the
    // curtain never lifts on a world still arriving out of black), and the
    // fully-covered floor that keeps an instant hop from reading as a flicker.
    const held = this.time.now - veil.coveredAt;
    const delay = Math.max(TRAVEL_WIPE.revealDelayMs, TRAVEL_WIPE.holdMinMs - held);
    this.tweens.add({
      targets: veil.chrome,
      alpha: 0,
      delay: Math.max(0, delay - 120),
      duration: 240,
      ease: 'Sine.easeIn'
    });
    if (veil.wipe) {
      const wipe = veil.wipe;
      // Flipped while fully covered — both ignition orders agree at progress 1,
      // so the swap cannot pop a pixel. Driven back to 0, the curtain now opens
      // at the centre first: the player arrives looking at the world's heart.
      wipe.invert = 1;
      this.tweens.add({
        targets: wipe,
        progress: 0,
        delay,
        duration: TRAVEL_WIPE.revealMs,
        ease: 'Sine.easeInOut',
        onUpdate: () => {
          wipe.time = this.time.now / 1000;
        },
        onComplete: () => this.destroyTravelVeil(veil)
      });
    } else {
      this.tweens.add({
        targets: veil.root,
        alpha: 0,
        delay,
        duration: 300,
        ease: 'Sine.easeIn',
        onComplete: () => this.destroyTravelVeil(veil)
      });
    }
  }

  private destroyTravelVeil(veil: TravelVeil): void {
    if (this.travelVeil === veil) this.travelVeil = undefined;
    this.travelWatchdog?.remove();
    this.travelWatchdog = undefined;
    // The ember dots pulse on repeat -1 — destroy must kill their tweens, not
    // orphan them onto dead objects.
    this.tweens.killTweensOf(veil.pulse);
    veil.root.destroy();
  }

  /** Emberkeep Cookbook button — bottom-right column, above the Bag; hidden
   *  during the tutorial. The lava dot marks new pages. */
  private buildCookbookButton(): Phaser.GameObjects.Container {
    // Slot 2 of the shared column (Ledger 0, Bag 1) — its own offsets used to sit
    // 36 units from the Bag's, so the satchel covered this button entirely.
    const button = this.add
      .container(HUD_COLUMN_X, hudColumnY(2))
      .setScale(UI_SCALE)
      .setDepth(DEPTH_HUD);
    // Plate, icon and dot all at the column's shared plate scale — this button
    // used to be built at 1.05 and read as a runt beside the Bag and the Ledger.
    const bg = this.add.image(0, 0, 'ui_btn_round').setScale(HUD_COLUMN_PLATE);
    const icon = this.textures.exists('ui_icon_cookbook')
      ? this.add.image(0, -8 * HUD_COLUMN_PLATE, 'ui_icon_cookbook').setDisplaySize(HUD_COLUMN_ICON, HUD_COLUMN_ICON)
      : this.add.text(0, -11, '📖', { fontSize: '68px' }).setOrigin(0.5);
    this.cookbookDot = this.add
      .circle(45 * HUD_COLUMN_PLATE, -45 * HUD_COLUMN_PLATE, 16, num(PALETTE.lava))
      .setStrokeStyle(5, num(PALETTE.cream))
      .setVisible(false);
    button.add([bg, icon, this.cookbookDot]);
    button.setSize(128 * HUD_COLUMN_PLATE, 128 * HUD_COLUMN_PLATE);
    button.setInteractive({ useHandCursor: true });
    button.on('pointerover', () => button.setScale(UI_SCALE * 1.06));
    button.on('pointerout', () => button.setScale(UI_SCALE));
    button.on('pointerup', () => {
      if (!(this.lastStep?.done ?? this.ctx.state.tutorialDone) && !(this.lastStep?.allow.cookbook ?? false)) return;
      if (this.cookbook.isOpen) {
        this.cookbook.requestClose();
      } else {
        this.markCookbookSeen();
        this.cookbook.open();
      }
    });
    button.setVisible(this.ctx.state.tutorialDone);
    this.syncCookbookDot();
    return button;
  }

  /**
   * THE DOT IS A FACT ABOUT THE SAVE, NOT ABOUT THIS SESSION.
   *
   * It used to be a boolean nobody wrote down: raised by `cookbook:discovered`,
   * lowered by opening the book. Discover a recipe and close the tab and it was
   * gone on the next boot — the Keeper had never looked, and the game had
   * stopped saying so. It could not come back either, because nothing outside
   * that one event could ever raise it again.
   *
   * `discoveredRecipes` is already in the save and only ever grows, so the
   * answer is a subtraction: how many pages exist against how many had been
   * written the last time the book was opened. Monotone on both sides, so it
   * survives a reload, agrees across worlds, and needs no new save field.
   */
  private syncCookbookDot(): void {
    if (!this.cookbookDot) return;
    const unseen =
      this.ctx.state.discoveredRecipes.length - this.ctx.state.stat(COOKBOOK_SEEN_KEY);
    this.cookbookDot.setVisible(this.ctx.state.tutorialDone && unseen > 0);
  }

  /** Opening the book is reading it. `addStat` is the only setter, and the two
   *  counters only ever grow, so the difference is never negative. */
  private markCookbookSeen(): void {
    const unseen =
      this.ctx.state.discoveredRecipes.length - this.ctx.state.stat(COOKBOOK_SEEN_KEY);
    if (unseen > 0) this.ctx.state.addStat(COOKBOOK_SEEN_KEY, unseen);
    this.cookbookDot.setVisible(false);
  }

  /**
   * The Dragon Codex button — slot 4 of the shared column, the top of it
   * (Ledger 0, Bag 1, Cookbook 2, Store 3). Same plate, same pitch, same gates
   * as its neighbours; the one difference is WHEN it exists: not until a dragon
   * has been named, because the book records dragons the Keeper knows, and
   * before the naming there is nothing it could open onto.
   */
  private buildCodexButton(): Phaser.GameObjects.Container {
    const button = this.add
      .container(HUD_COLUMN_X, hudColumnY(4))
      .setScale(UI_SCALE)
      .setDepth(DEPTH_HUD);
    const bg = this.add.image(0, 0, 'ui_btn_round').setScale(HUD_COLUMN_PLATE);
    const icon = this.textures.exists('ui_icon_dragondex')
      ? this.add.image(0, -8 * HUD_COLUMN_PLATE, 'ui_icon_dragondex').setDisplaySize(HUD_COLUMN_ICON, HUD_COLUMN_ICON)
      : this.add.text(0, -11, '🐉', { fontSize: '68px' }).setOrigin(0.5);
    button.add([bg, icon]);
    button.setSize(128 * HUD_COLUMN_PLATE, 128 * HUD_COLUMN_PLATE);
    button.setInteractive({ useHandCursor: true });
    button.on('pointerover', () => button.setScale(UI_SCALE * 1.06));
    button.on('pointerout', () => button.setScale(UI_SCALE));
    button.on('pointerup', () => {
      // Mid-tutorial the script owns the stage — same contract as the
      // Cookbook button beside it.
      if (!(this.lastStep?.done ?? this.ctx.state.tutorialDone)) return;
      if (this.codex.isOpen) this.codex.requestClose();
      else this.codex.open();
    });
    button.setVisible(
      this.ctx.state.tutorialDone && this.ctx.systems.dragons.namedDragons().length > 0
    );
    return button;
  }

  /** The button's debut — it pops in the moment the first dragon is named. */
  private revealCodexButton(): void {
    if (this.codexButton.visible) return;
    if (!(this.lastStep?.done ?? this.ctx.state.tutorialDone)) return;
    this.codexButton.setVisible(true);
    this.codexButton.setScale(UI_SCALE * 0.3);
    this.tweens.add({
      targets: this.codexButton,
      scale: UI_SCALE,
      duration: 420,
      ease: 'Back.easeOut'
    });
  }

  /** Cosmetic: a Flame Gem arcs from the merge cell into the Ledger button and
   *  pulses it — the "gems gathered toward the magic" beat. UIScene's camera is
   *  fixed, so the Ledger target and the board-cell start share one space. */
  private flyGemToLedger(at: TilePos, tier: number): void {
    const start = this.cellToScreen(at.col, at.row);
    const end = this.hud.getLedgerPos();
    const gem = this.add
      .image(start.x, start.y - 40, `item_flame_gem_${tier}`)
      .setScale(0.45)
      .setDepth(DEPTH_PANEL + 5);
    const proxy = { t: 0 };
    this.tweens.add({
      targets: proxy,
      t: 1,
      duration: 600,
      delay: 140,
      ease: 'Sine.easeIn',
      onUpdate: () => {
        const t = proxy.t;
        gem.x = Phaser.Math.Linear(start.x, end.x, t);
        gem.y = Phaser.Math.Linear(start.y - 40, end.y, t) - Math.sin(Math.PI * t) * 130;
        gem.rotation = t * Math.PI;
        gem.setScale(0.45 * (1 - 0.4 * t));
      },
      onComplete: () => {
        gem.destroy();
        this.tweens.add({
          targets: this.hud.ledgerButton,
          scale: { from: 1, to: 1.18 },
          duration: 120,
          yoyo: true,
          ease: 'Sine.easeOut'
        });
      }
    });
  }

  /** Tapped Gold arcs from its board cell up to the Gold gauge — one coin
   *  sprite per banked coin (the Pouch sends 3), staggered so each arrival
   *  lands separately and pulses the gauge on impact. */
  /**
   * The store beat: the piece leaves its tile, arcs to the satchel and the
   * button pulses as it lands. Deliberately the SAME motion as the coin flight
   * below — one curved hop, shrinking as it goes — so storing feels like
   * something the player already knows rather than a new mechanic.
   */
  private flyItemToBag(chain: string, tier: number, at: TilePos): void {
    const key = `item_${chain}_${tier}`;
    const start = this.cellToScreen(at.col, at.row);
    const end = this.hud.getBagPos();
    if (!this.textures.exists(key)) {
      this.hud.bumpBag();
      return;
    }
    const art = this.add.image(start.x, start.y - 30, key).setDepth(DEPTH_PANEL + 5);
    // Normalise: item art ranges from ~190px to ~760px, so a fixed scale would
    // send a moss tuft and a resin lump off at wildly different sizes.
    const fit = 96 / Math.max(art.width, art.height);
    art.setScale(fit * 0.6);
    this.tweens.add({ targets: art, scale: fit, duration: 140, ease: 'Back.easeOut' });
    const proxy = { t: 0 };
    this.tweens.add({
      targets: proxy,
      t: 1,
      duration: 520,
      delay: 120,
      ease: 'Sine.easeIn',
      onUpdate: () => {
        const t = proxy.t;
        art.x = Phaser.Math.Linear(start.x, end.x, t);
        art.y = Phaser.Math.Linear(start.y - 30, end.y, t) - Math.sin(Math.PI * t) * 140;
        art.rotation = t * Math.PI * 0.6;
        art.setScale(fit * (1 - 0.55 * t));
        art.setAlpha(1 - 0.25 * t);
      },
      onComplete: () => {
        art.destroy();
        this.hud.bumpBag();
      }
    });
  }

  /** A short cream line that rises and fades over the board — used when a store
   *  or a retrieval could not happen, so the tap is never silently ignored. */
  private floatWarning(text: string): void {
    const label = this.add
      .text(LIVE_GAME_WIDTH / 2, LIVE_GAME_HEIGHT * 0.62, text, {
        fontFamily: FONT.display,
        fontSize: '54px',
        fontStyle: 'bold',
        color: PALETTE.cream,
        stroke: PALETTE.night,
        strokeThickness: 8
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_PANEL + 20);
    this.tweens.add({
      targets: label,
      y: label.y - 90,
      alpha: 0,
      duration: 1100,
      ease: 'Sine.easeOut',
      onComplete: () => label.destroy()
    });
  }

  /** Coins arcing to the gauge. `at` is a board cell when something on the
   *  board paid out; without one the flight starts at the satchel, which is
   *  where a sold Coin leaves from. */
  private flyCoinToGold(at: TilePos | undefined, count = 1): void {
    const start = at ? this.cellToScreen(at.col, at.row) : this.hud.getBagPos();
    const end = this.hud.getCoinPos();
    for (let i = 0; i < count; i++) {
      const coin = this.add
        .image(start.x, start.y - 30, 'item_coin_1')
        .setScale(0.05)
        .setAlpha(0) // invisible until its turn in the stagger
        .setDepth(DEPTH_PANEL + 5);
      this.tweens.add({ targets: coin, scale: 0.16, alpha: 1, duration: 160, delay: i * 220, ease: 'Back.easeOut' });
      const proxy = { t: 0 };
      this.tweens.add({
        targets: proxy,
        t: 1,
        duration: 560,
        delay: 150 + i * 220, // stagger: each coin rises after the previous one
        ease: 'Sine.easeIn',
        onUpdate: () => {
          const t = proxy.t;
          coin.x = Phaser.Math.Linear(start.x, end.x, t);
          coin.y = Phaser.Math.Linear(start.y - 30, end.y, t) - Math.sin(Math.PI * t) * 120;
          coin.rotation = t * Math.PI * 1.5;
          coin.setScale(0.16 * (1 - 0.45 * t));
        },
        onComplete: () => {
          coin.destroy();
          this.hud.bumpCoin(); // one gauge pulse PER arriving coin
        }
      });
    }
  }

  /** The level-up reward beat: a warm banner — Warmth refilled + Gold. Deferred a
   *  frame: keeper:leveled can fire mid bus-emit (even from an external trigger),
   *  and allocating Text/particles right then can hit a not-yet-ready canvas.
   *  EVERY level gets the banner now — Level 3 used to be swallowed by the
   *  finale, which has moved onto `GOLDEN_ALTAR.awakenQuestId`. */
  private celebrateLevelUp(level: number): void {
    this.time.delayedCall(0, () => this.buildLevelUpBanner(level));
  }

  /**
   * UIScene's half of the finale timeline (BoardScene runs the board half off
   * the same `quest:completed` beat): the Golden Elder speaks, for the first
   * time in the whole game — and that is the end of it.
   *
   * Nothing follows her. The finale used to close on a "Beyond the demo"
   * roadmap and a Chapter One card offering Keep Playing / Play Again; both were
   * demo furniture, and a modal that interrupts a player to ask whether they
   * would like to keep playing is the wrong last thing a chapter says. Her line
   * lands, the camera comes home, and play continues uninterrupted.
   */
  /**
   * ONE BEAT OF THE FINALE, FENCED — BoardScene's twin, and needed for the same
   * reason: this scene runs the Elder's VOICE off the same timeline, out of
   * `delayedCall`s that Phaser steps outside any `update`. A throw while she
   * speaks ends the RAF chain (`core/crash.ts`), which is not "her line is
   * missing" but "the session is over, reload to get the board back" — and the
   * board it freezes belongs to BoardScene, which did nothing wrong.
   */
  private beat(where: string, fn: () => void): void {
    guard(`ui.finale.${where}`, fn, undefined);
  }

  /**
   * HER BUSTS ARRIVE HERE, AND NOWHERE EARLIER.
   *
   * She was the only speaker in the game who did not move while she talked:
   * Eleanor and Selyna have `stage:'portrait'` talking/blinking clips, so the
   * ring's split treatment falls out for them with no branch, and the Elder had
   * none — a still bust under a voice. Her clips are two big sheets, and she
   * cannot say a word before the endgame, so preloading them would spend that
   * decode on every session that never gets there. A line that outruns the
   * network still reads, because the ring degrades to `portrait_golden_elder`,
   * her own still bust — and re-seats itself onto the clips when they land.
   *
   * WHOEVER TAKES THE RING, not whoever was on a list. This is the far side of
   * the bubble's `onSpeakerArtNeeded` hook, so it is asked on every path that
   * can name a speaker — the finale ceremony, the LATE awakening (the golden
   * order delivered after Level 3, which cracks the egg outside the timeline),
   * an authored `say`, and a tutorial beat written in her voice, which the
   * three hand-placed calls this replaces did not cover. Idempotent by texture
   * residency, so a line by a resident speaker costs one `exists` per clip.
   *
   * The RING's clips only: `clipsFor` answers with everything a character has,
   * and Eleanor's board clips (idle/cast/laugh/happy) have no business being
   * pulled in because she opened her mouth.
   */
  private ensureRingArt(speaker: string): void {
    let added = 0;
    for (const [clipId, clip] of Object.entries(clipsFor(speaker))) {
      if (clip.stage !== 'portrait') continue;
      const key = clipKey(speaker, clipId);
      if (this.textures.exists(key)) continue;
      const before = this.load.list.size;
      this.load.spritesheet(key, clip.file, {
        frameWidth: clip.frameWidth,
        frameHeight: clip.frameHeight
      });
      // WHAT THE LOADER TOOK, not what was asked of it. `addFile` silently
      // REFUSES a key that is already resident, queued or inflight, so a second
      // line opened while the first fetch is still in the air adds nothing —
      // and counting the request counted work nobody was doing: it re-armed a
      // listener for a file already listened for, and could `start()` a batch
      // with no files in it (which on an idle loader emits COMPLETE at once,
      // spending every other module's pending COMPLETE listener). A file that
      // FAILED leaves the loader, so a later line asks again by itself.
      if (this.load.list.size === before) continue;
      added += 1;
      // KEYED TO HER OWN FILE. `Loader.Events.COMPLETE` belongs to whichever
      // batch happens to finish first, and this scene's loader is shared — the
      // Emporium, the Cauldron and the Codex all fetch through
      // `lazyTextures.ensureTextures` on it — so a one-shot COMPLETE listener
      // was routinely spent on somebody else's images, and the sheets landing
      // afterwards never re-seated the ring. Phaser emits
      // `filecomplete-<type>-<key>` per file, which is the only signal about
      // HER. Fired per sheet: the first finds the other still missing and does
      // nothing (`atlasReady` wants both), the last re-seats her mid-sentence.
      this.load.once(`${Phaser.Loader.Events.FILE_KEY_COMPLETE}spritesheet-${key}`, () =>
        // Guarded for the same reason every finale beat is: this runs out of a
        // loader callback, outside any `update`, and a throw there ends the RAF
        // chain — the session, not the line.
        guard('ui.ring.clips', () => this.bubble.onSpeakerArtLoaded(speaker), undefined)
      );
    }
    if (added === 0) return;
    this.load.start();
  }

  private runFinaleUi(): void {
    if (this.finaleActive) return;
    this.finaleActive = true;
    this.finaleReleased = false;
    // A PREFETCH, not the door: the bubble asks for her face by itself when she
    // opens her mouth (`ensureRingArt`), but her two sheets are big and the
    // camera pan to the altar is free time to spend on them.
    this.ensureRingArt('golden_elder');
    this.clearRecipeHint(); // the finale owns the stage — no competing pointers
    this.ledger.requestClose();
    this.shop.requestClose('system'); // clearing the stage is not the player leaving
    this.cookbook.requestClose();
    this.time.delayedCall(FINALE.elderAtMs, () =>
      this.beat('elder.speaks', () => {
        // No egg earned (Order 1 skipped)? Her words read as PROPHECY — selling
        // the promise the player hasn't collected yet, never claiming an
        // awakening that didn't happen. Read HERE, not hoisted: the variant is a
        // fact about the moment she opens her mouth.
        const eggEarned = this.ctx.state.completedOrderIds.includes(GOLDEN_ALTAR.orderId);
        const lines = eggEarned
          ? this.ctx.data.dialogue.finaleElder
          : this.ctx.data.dialogue.finaleElderProphecy;
        // TAP-ADVANCED, like every chapter beat: these are her first words in
        // the whole game and must not scroll past unread. `say()` was wrong on
        // both counts — it takes ONE string, and it times out.
        this.bubble.sequence('golden_elder', lines, () => this.releaseFinaleStage());
      })
    );
    // THE BACKSTOP, not the release. The stage is now handed back when SHE
    // finishes speaking (her sequence's `onDone`), because a tap-advanced beat
    // has no fixed length — a fixed `FINALE_ENDS_MS` timer would cut her off
    // mid-sentence the moment the player read slowly. This only covers the case
    // where she never speaks at all, so it is sized past her own per-line
    // safety net: she cannot still be talking after it.
    this.time.delayedCall(
      FINALE.elderAtMs +
        Math.max(
          this.ctx.data.dialogue.finaleElder.length,
          this.ctx.data.dialogue.finaleElderProphecy.length,
          1
        ) *
          STORY_BEAT_HOLD_MS +
        1000,
      () => this.beat('release.backstop', () => this.releaseFinaleStage())
    );
  }

  /** Set for the run, so the stage is handed back exactly once however the
   *  finale ends — her last line, or the backstop behind it. */
  private finaleReleased = false;

  /**
   * The finale lets go: the board is the player's again and the Gate ceremony
   * rides the tail. `finaleActive` is cleared FIRST, so a failure in the
   * ceremony behind it cannot leave the stage held — a stuck flag would silence
   * every later celebration for the rest of the session.
   */
  private releaseFinaleStage(): void {
    this.beat('release', () => {
      if (this.finaleReleased) return;
      this.finaleReleased = true;
      this.finaleActive = false;
      // The Gate ceremony rides the finale's tail: Eleanor speaks the arch
      // open (tap-advanced, STORY_BEAT_HOLD_MS backstop — it cannot strand),
      // and the last line blooming into `gate:opened` is what turns the portal
      // FX on and the door live. A reload after the finale skips the ceremony:
      // BoardScene derives the open Gate from the q:done latch.
      const beats = this.ctx.data.dialogue.gateOpens;
      if (beats?.lines.length) {
        this.time.delayedCall(TIMINGS.chapterBeatDelay, () =>
          this.beat('gate', () =>
            this.bubble.sequence(beats.speaker as SpeakerId, beats.lines, () =>
              this.ctx.bus.emit('gate:opened', {})
            )
          )
        );
      } else {
        this.ctx.bus.emit('gate:opened', {});
      }
    });
  }

  /** Order completion — the demo's primary reward beat — now celebrates at
   *  level-up parity: banner + spark burst + a rotating Eleanor quote stamped on
   *  the card (her VOICE stays reserved for the finale). The golden order gets
   *  its own beats: a dedicated arrival quote, and — delivered after Level 3 —
   *  The Golden Elder SPEAKS over the late awakening playing out at the altar. */
  private celebrateOrder(orderId: string, rewards: { coins: number; keys: number; xp?: number }): void {
    if (this.finaleActive || !this.ctx.state.tutorialDone) return;
    const golden = orderId === GOLDEN_ALTAR.orderId;
    this.time.delayedCall(0, () => {
      // Her banter is banked by story stage, so the Ledger says something new
      // as the campaign moves (docs/script-chapters.md, Part II).
      const quotes = this.ctx.systems.story.orderCompleteBank();
      const quote = golden
        ? this.ctx.data.dialogue.goldenArrival
        : quotes.length
          ? quotes[(this.ctx.state.completedOrderIds.length - 1) % quotes.length] ?? ''
          : '';
      const parts: string[] = [];
      if (rewards.coins) parts.push(`◎ +${rewards.coins} Gold`);
      if (rewards.xp) parts.push(`✦ +${rewards.xp} XP`);
      this.buildCelebrationBanner('ORDER COMPLETE', parts.join('    '), quote);
    });
    if (golden && this.ctx.state.level >= 3) {
      // ASKED NOW, SPOKEN IN 3.2s — the fetch rides the wait rather than racing
      // her line. Queued outside the `delayedCall` on purpose: this is the one
      // path with a free head start, and spending it is what left her a
      // photograph on the awakening she is the whole point of.
      this.ensureRingArt('golden_elder');
      // BoardScene's lateGoldenAwakening cracks the egg at ~2.4s — her line
      // lands right as the Elder rises.
      this.time.delayedCall(3200, () =>
        this.beat('late.elder', () =>
          this.bubble.say('golden_elder', this.ctx.data.dialogue.lateAwakening, 4600)
        )
      );
    }
  }

  private celebrateTasksComplete(): void {
    this.time.delayedCall(0, () => {
      this.buildCelebrationBanner('EVERY TASK COMPLETE', '◎ Gold  ⚡ Warmth — a golden thank-you', '');
      this.bubble.say('eleanor', this.ctx.data.dialogue.tasksComplete, 5200);
    });
  }

  /** Shared warm banner (order complete / tasks complete) — the level-up
   *  banner's language, one tier smaller. */
  private buildCelebrationBanner(title: string, rewardLine: string, quote: string): void {
    const cx = LIVE_GAME_WIDTH / 2;
    const cy = LIVE_GAME_HEIGHT * 0.3;
    const height = quote ? 236 : 180;
    const c = this.add.container(cx, cy).setDepth(DEPTH_DIALOG - 5).setAlpha(0);
    const g = this.add.graphics();
    g.fillStyle(num(PALETTE.night), 0.22);
    g.fillRoundedRect(-390, -height / 2 + 10, 780, height, 30);
    g.fillStyle(num(PALETTE.lava), 1);
    g.fillRoundedRect(-390, -height / 2, 780, height, 30);
    g.fillStyle(0xfffdf6, 1);
    g.fillRoundedRect(-378, -height / 2 + 12, 756, height - 24, 24);
    const ribbon = this.add
      .text(0, -height / 2 + 58, title, {
        fontFamily: FONT.ui, fontSize: '46px', fontStyle: 'bold', color: PALETTE.cream
      })
      .setOrigin(0.5)
      .setStroke(PALETTE.cream, 5);
    const sub = this.add
      .text(0, -height / 2 + 122, rewardLine, {
        fontFamily: FONT.ui, fontSize: '30px', fontStyle: 'bold', color: PALETTE.goldShade
      })
      .setOrigin(0.5);
    c.add([g, ribbon, sub]);
    if (quote) {
      c.add(
        this.add
          .text(0, -height / 2 + 182, quote, {
            fontFamily: FONT.ui, fontSize: '26px', fontStyle: 'italic', color: '#8A6248',
            wordWrap: { width: 700 }, align: 'center'
          })
          .setOrigin(0.5)
      );
    }
    this.add
      .particles(cx, cy, 'fx_spark', {
        speed: { min: 160, max: 420 }, angle: { min: 0, max: 360 }, gravityY: 240,
        lifespan: { min: 450, max: 800 }, scale: { start: 0.8, end: 0 },
        alpha: { start: 1, end: 0 }, quantity: 0, emitting: false
      })
      .setDepth(DEPTH_DIALOG - 6)
      .explode(20);
    this.tweens.add({ targets: c, alpha: 1, scale: { from: 0.84, to: 1 }, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: c, alpha: 0, scale: 1.04, delay: 2100, duration: 340, ease: 'Sine.easeIn',
      onComplete: () => c.destroy()
    });
  }

  /** Warm dark vignette hugging the screen edges — the AAA finishing grade.
   *  Painted once into a small canvas (radial falloff), stretched over the
   *  viewport UNDER the HUD; linear filtering hides the low source res. */
  private buildVignette(): void {
    const KEY = 'fx_vignette';
    if (!this.textures.exists(KEY)) {
      const w = 256;
      const h = 160;
      const tex = this.textures.createCanvas(KEY, w, h);
      if (!tex) return;
      const c = tex.getContext();
      // Elliptical radial falloff: fully clear across the middle ~70%, easing
      // into the warm dark corners.
      c.save();
      c.translate(w / 2, h / 2);
      c.scale(1, h / w);
      const g = c.createRadialGradient(0, 0, w * 0.30, 0, 0, w * 0.62);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.72, 'rgba(42,14,18,0.45)');
      g.addColorStop(1, ATMOSPHERE.vignette.color);
      c.fillStyle = g;
      c.fillRect(-w, -w, w * 2, w * 2);
      c.restore();
      tex.refresh();
    }
    this.add
      .image(0, 0, KEY)
      .setOrigin(0)
      .setDisplaySize(LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT)
      .setAlpha(ATMOSPHERE.vignette.alpha)
      .setDepth(DEPTH_HUD - 1); // over the board render, under every UI element
  }

  /** One-shot Eleanor nudge (post-tutorial guidance without a second tutorial). */
  private showHint(key: keyof GameContext['data']['dialogue']['hints'], holdMs = 5200): void {
    if (!this.ctx.state.tutorialDone || this.finaleActive || this.hintShown.has(key)) return;
    this.hintShown.add(key);
    this.bubble.say('eleanor', this.ctx.data.dialogue.hints[key], holdMs);
  }

  /**
   * Contextual recipe mini-tutorials: the moment the board first holds the TWO
   * pieces of a 2→1 recipe (two Red Dragons → Adult, two Houses → Manor),
   * Eleanor teases the merge and the guiding gauntlet demonstrates the drag
   * between the actual pieces. Purely presentational — nothing is gated, no
   * input is blocked; it clears itself on discovery, timeout, or the finale.
   */
  private checkRecipeHints(): void {
    if (!this.ctx.state.tutorialDone || this.finaleActive || this.recipeHint) return;
    const candidates = [
      { key: 'twoDragons', recipe: 'ember_dragon:3>4', chain: 'ember_dragon', tier: 3 },
      { key: 'twoHouses', recipe: 'lumber:3>4', chain: 'lumber', tier: 3 }
    ] as const;
    for (const c of candidates) {
      if (this.hintShown.has(c.key)) continue;
      if (this.ctx.state.discoveredRecipes.includes(c.recipe)) continue; // already learned
      const pieces = [...this.ctx.state.items.values()].filter(
        (i) => i.kind === 'item' && i.chain === c.chain && i.tier === c.tier
      );
      if (pieces.length < 2) continue;
      this.recipeHint = c.recipe;
      this.showHint(c.key, 6500);
      // The gauntlet demonstrates the exact drag: piece B onto piece A.
      this.placeHand({
        from: { col: pieces[1]!.col, row: pieces[1]!.row },
        to: { col: pieces[0]!.col, row: pieces[0]!.row }
      });
      this.recipeHintTimer?.remove();
      this.recipeHintTimer = this.time.delayedCall(9500, () => this.clearRecipeHint());
      return; // one guided beat at a time
    }
  }

  /** Stop the recipe demonstration (discovered / timed out / superseded). */
  private clearRecipeHint(): void {
    if (!this.recipeHint) return;
    this.recipeHint = null;
    this.recipeHintTimer?.remove();
    this.recipeHintTimer = null;
    this.clearMarkers();
  }

  /** The board changed under an active demonstration: re-aim the gauntlet at the
   *  pair the recipe is about, or retire it if that pair no longer exists. */
  private refreshRecipeHint(): void {
    if (!this.recipeHint) return;
    const [chain, tiers] = this.recipeHint.split(':') as [string, string];
    const fromTier = Number(tiers.split('>')[0]);
    const pieces = [...this.ctx.state.items.values()].filter(
      (i) => i.kind === 'item' && i.chain === chain && i.tier === fromTier
    );
    if (pieces.length < 2) {
      this.clearRecipeHint(); // sold/consumed — the discovery handler covers the merge case
      return;
    }
    const hand: ResolvedHand = {
      from: { col: pieces[1]!.col, row: pieces[1]!.row, item: pieces[1]!.id },
      to: { col: pieces[0]!.col, row: pieces[0]!.row, item: pieces[0]!.id }
    };
    // Still the same two pieces? Then there is nothing to re-place: the hand is
    // already following them frame by frame, and putting it up again would
    // restart its stroke every time either one is nudged.
    const shown = this.handDrag;
    if (shown && shown.from.item === hand.from.item && shown.to.item === hand.to.item) return;
    this.placeHand(hand);
  }

  /** "While you were away" — consumes the load payload nothing used to read:
   *  recovered Warmth + the passive gifts GeneratorSystem banked offline. */
  private maybeWelcomeBack(offlineMs: number, energyRecovered: number): void {
    if (offlineMs < WELCOME_BACK_MIN_MS || !this.ctx.state.tutorialDone) return;
    const gifts = this.ctx.systems.generator.lastOfflineGifts;
    if (energyRecovered <= 0 && gifts <= 0) return;
    const parts: string[] = [];
    if (energyRecovered > 0) parts.push(`⚡ +${energyRecovered} Warmth`);
    if (gifts > 0) parts.push(`🎁 ${gifts} gift${gifts > 1 ? 's' : ''} from your dragons`);
    this.time.delayedCall(600, () => {
      if (this.finaleActive) return;
      this.buildCelebrationBanner('WHILE YOU WERE AWAY', parts.join('    '), '');
    });
  }

  private buildLevelUpBanner(level: number): void {
    const cx = LIVE_GAME_WIDTH / 2;
    const cy = LIVE_GAME_HEIGHT * 0.34;
    const c = this.add.container(cx, cy).setDepth(DEPTH_DIALOG - 5).setAlpha(0);
    const g = this.add.graphics();
    g.fillStyle(num(PALETTE.night), 0.22);
    g.fillRoundedRect(-360, -96 + 10, 720, 192, 30);
    g.fillStyle(num(PALETTE.gold), 1);
    g.fillRoundedRect(-360, -96, 720, 192, 30);
    g.fillStyle(0xfffdf6, 1);
    g.fillRoundedRect(-348, -84, 696, 168, 24);
    const ribbon = this.add
      .text(0, -46, `KEEPER LEVEL ${level}`, {
        fontFamily: FONT.ui, fontSize: '64px', fontStyle: 'bold', color: PALETTE.cream
      })
      .setOrigin(0.5)
      .setStroke(PALETTE.cream, 6);
    const sub = this.add
      .text(0, 34, '⚡ Warmth refilled    ◎ Gold reward', {
        fontFamily: FONT.ui, fontSize: '34px', fontStyle: 'bold', color: PALETTE.goldShade
      })
      .setOrigin(0.5);
    c.add([g, ribbon, sub]);
    // burst of sparks behind the banner.
    this.add
      .particles(cx, cy, 'fx_spark', {
        speed: { min: 200, max: 520 }, angle: { min: 0, max: 360 }, gravityY: 240,
        lifespan: { min: 500, max: 900 }, scale: { start: 0.9, end: 0 },
        alpha: { start: 1, end: 0 }, quantity: 0, emitting: false
      })
      .setDepth(DEPTH_DIALOG - 6)
      .explode(28);
    this.tweens.add({ targets: c, alpha: 1, scale: { from: 0.82, to: 1 }, duration: 240, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: c, alpha: 0, scale: 1.04, delay: 1500, duration: 360, ease: 'Sine.easeIn',
      onComplete: () => c.destroy()
    });
  }

  private onTutorialStep(step: TutorialStepEvent): void {
    this.lastStep = step;
    if (step.done && this.pendingHearts.length) {
      for (const beat of this.pendingHearts.splice(0)) {
        this.playRegardBeats(beat.characterId, beat.hearts);
      }
    }
    if (step.done && this.pendingEvents.length) this.drainEventQueue();
    this.hud.setLedgerEnabled(step.done || step.allow.ledger);
    // The tracker is a readout of the Ledger, so BOTH halves ride the same gate
    // as the Ledger button.
    //
    // The sub-rows used to wait for `step.done`, which made quest one's
    // subquests dead UI: the tutorial delivers Eleanor's first order itself, so
    // that quest was already finished by the time the rows were allowed to
    // appear, and the player's first sight of the tracker was a bare title over
    // a number with nothing explaining what the number counted. Showing them on
    // the Ledger beats instead means the widget introduces itself at the moment
    // the tutorial is pointing at the Ledger anyway — one row, reading
    // "Deliver 6 Gem Shards to Eleanor", which is exactly the instruction.
    const ledgerBeat = step.done || step.allow.ledger;
    this.questTracker.setStoryVisible(ledgerBeat);
    this.questTracker.setTasksVisible(ledgerBeat);
    this.ledger.setDeliverAllowed(step.done || step.allow.deliver);
    this.bag.setSellAllowed(step.done || step.allow.sell);
    this.bag.setGiveAllowed(step.done || step.allow.give);
    // The status readout debuts on the beat that teaches feeding — it is the
    // surface that lesson's payoff is READ on — and then LATCHES for the rest of
    // the script. Every other `allow` flag is a permission that a later beat is
    // right to take back; this one is a concept that has been taught, and a
    // gauge that vanished again three beats later would read as a bug. The latch
    // also means the beats after it do not each have to remember `feed: true`.
    if (step.allow.status) this.statusTaught = true;
    this.statusPanel.setEnabled(step.done || this.statusTaught);
    // Safety net, same shape as the Cookbook's: a beat that does not allow the
    // satchel shuts it, so the panel's dim can never swallow the tap the next
    // step is waiting on (`sell_it` leaves the bag open behind it).
    if (!step.done && !step.allow.bag && this.bag.isOpen) this.bag.requestClose();
    // Show key pill only during the key_unlock step; hide it otherwise.
    this.hud.setKeyVisible(!step.done && step.id === 'key_unlock');
    // A step that no longer involves the Ledger closes it, so its dim never
    // sits over the board and swallows the next tap (e.g. the post-deliver fog).
    if (!step.done && !step.allow.ledger && this.ledger.isOpen) this.ledger.requestClose();
    // THE CODEX HOLD, AND IT HAS TO BE HERE — before `applyMarkers` below.
    //
    // The lesson holds the book open and the ✕ goes with the hold, so
    // `getClosePos` answers null while it is held. The beat that teaches
    // CLOSING drops the hold, and its arrow points at the ✕ — which means the
    // hold must be dropped BEFORE the arrow is resolved. It used to be dropped
    // in a second `tutorial:step` listener registered after this one, so on
    // `codex_shut` the arrow was resolved against a still-held book, came back
    // null, and the lesson ended with nothing pointing at the way out.
    this.applyCodexHold(step);
    if (step.done) {
      this.bubble.hide();
      this.clearMarkers();
      return;
    }
    // Beat 0 of the opening: the board is visible and SILENT before her first
    // line, so the player sees the ash before anyone frames it. Staging only —
    // the director has already emitted the step (docs/opening-scene.md).
    if (step.index === 0 && !this.openingHeld) {
      this.openingHeld = true;
      this.clearMarkers();
      this.time.delayedCall(OPENING_HOLD_MS, () => {
        if (this.lastStep?.id !== step.id) return;
        this.bubble.show(step);
        this.applyMarkers(step);
      });
      return;
    }
    this.bubble.show(step);
    this.applyMarkers(step);
  }

  /**
   * NOBODY SPEAKS FROM A WORLD THEY ARE NOT STANDING IN.
   *
   * A beat that can fire anywhere — a chapter turning, a heart earned — used to
   * open the bubble wherever the player happened to be. Cross into Borealis,
   * finish the thing that turns the chapter, and Eleanor talked over Selyna's
   * snow from an isle two doors away.
   *
   * Held, never dropped: these beats play once ever, so the queue empties the
   * next time the player is somewhere their speaker actually stands. The rule
   * itself lives in WorldCharacterSystem (`speakerBelongs`) because it is a
   * fact about the roster, not about the bubble — and a voice no body claims,
   * like the Golden Elder's, is welcome everywhere by design.
   */
  private speakHere(speaker: SpeakerId, lines: string[], done?: () => void): void {
    if (!this.ctx.systems.characters.speakerBelongs(speaker, this.ctx.state.worldId)) {
      this.pendingAway.push({ speaker, lines });
      done?.(); // the beat is deferred; whatever it unlocks is not
      return;
    }
    this.bubble.sequence(speaker, lines, done);
  }

  /** Back somewhere they can be heard: play what was held, one beat at a time. */
  private flushAwayBeats(): void {
    const next = this.pendingAway.find((b) =>
      this.ctx.systems.characters.speakerBelongs(b.speaker, this.ctx.state.worldId)
    );
    if (!next) return;
    this.pendingAway.splice(this.pendingAway.indexOf(next), 1);
    this.time.delayedCall(TIMINGS.chapterBeatDelay, () => {
      this.bubble.sequence(next.speaker, next.lines, () => this.flushAwayBeats());
    });
  }

  /** Replay what waited, in the order it arrived. Anything whose gate is still
   *  shut pushes itself straight back onto the queue from `playEventBeat`, so
   *  draining is safe at any moment and from either unblocking event. */
  private drainEventQueue(): void {
    for (const beat of this.pendingEvents.splice(0)) this.playEventBeat(beat);
  }

  /**
   * An authored event spoke or asked. While a tutorial script is on the bubble
   * the beat waits — `say()` would wipe the gate the beat is standing on — and
   * plays on the handover, in the order it arrived. A prompt is one at a time:
   * a second question while one is open waits for the answer.
   *
   * TWO gates, so TWO drains (`drainEventQueue`): the tutorial's done beat, and
   * `ui:event_choice`. A queue drained on only one of the events that fills it
   * strands everything held for the other.
   */
  private playEventBeat(beat: { say?: EventMap['event:say']; prompt?: EventMap['event:prompt'] }): void {
    const tutorialHolds = !(this.lastStep?.done ?? this.ctx.state.tutorialDone);
    if (tutorialHolds || (beat.prompt && this.choice.isOpen)) {
      this.pendingEvents.push(beat);
      return;
    }
    if (beat.say) this.speakHere(beat.say.speaker, beat.say.lines);
    if (beat.prompt) this.choice.open(beat.prompt);
  }

  /** The `open` action — every panel UIScene owns, by name. */
  private openPanel(panel: EventPanel): void {
    switch (panel) {
      case 'ledger': return this.ledger.open();
      case 'store': return this.store.open();
      case 'bag': return this.bag.open();
      case 'cauldron': return this.cauldron.open();
      case 'codex': return this.codex.open();
      case 'cookbook': {
        // Opening it from anywhere is still reading it — the button is not the
        // only door, and a dot that survives the panel it points at is noise.
        this.markCookbookSeen();
        return this.cookbook.open();
      }
    }
  }

  /** A chapter turned: play its beats, tap by tap. Fires once per chapter — the
   *  pointer is persisted, so a reload never replays them. */
  private playChapterBeats(chapter: number): void {
    const beats = this.ctx.systems.story.beatsFor(chapter);
    if (!beats) return;
    // Let the order-complete celebration land first; her reaction is TO it.
    this.time.delayedCall(TIMINGS.chapterBeatDelay, () => {
      this.speakHere(beats.speaker as SpeakerId, beats.lines, () => {
        this.ctx.bus.emit('story:beats_finished', { chapter });
      });
    });
  }

  /** A piece's authored name, for a line that has to say WHICH piece. Falls
   *  back to the key rather than to "item", so a missing name is debuggable. */
  private pieceName(chain: string, tier: number): string {
    return (
      this.ctx.data.chains.chains.find((c) => c.id === chain)?.tiers.find((t) => t.tier === tier)
        ?.name ?? `${chain} T${tier}`
    );
  }

  /**
   * A gift changed hands (or did not). One line, in her voice, immediately —
   * this is feedback on a gesture the player just made, so it does not queue
   * behind anything the way a chapter beat does.
   */
  private sayGiftLine(characterId: string, accepted: boolean, seed: number): void {
    // The tutorial owns the bubble until it's done — `say()` wipes the tap
    // gate, and the scripted gift beat already answers in her voice
    // (`eleanor_hearts` IS the thank-you). Overwriting it soft-locked the
    // tutorial on that step.
    if (!this.ctx.state.tutorialDone) return;
    const line = this.ctx.systems.story.giftLine(characterId, accepted, seed);
    if (!line) return;
    this.bubble.say(characterId as SpeakerId, line, accepted ? 3600 : 3000);
  }

  /**
   * A whole heart filled. The milestone scene, played once ever.
   *
   * Delayed by the same beat a chapter is: the gift's own line is on screen and
   * her reaction is TO it, not over it.
   */
  /**
   * The hub tours — Eleanor walks Roothold's Emporium, Selyna the Hatchery's
   * cauldron, each ONCE ever (stats `tour:<world>`, save-derivable). Not
   * TutorialDirector beats: the tutorial is long over, nothing here gates
   * input, and every wait state is armed on an event that stays live — a
   * player who wanders off mid-tour is never stuck, and an unfinished tour
   * simply re-runs on the next arrival.
   */
  private maybeStartTour(worldId: string): void {
    if (worldId === 'roothold' && this.ctx.state.stat('tour:roothold') === 0) {
      this.time.delayedCall(TIMINGS.chapterBeatDelay, () => this.runRootholdTour());
    }
    if (worldId === 'runevault' && this.ctx.state.stat('tour:runevault') === 0) {
      this.time.delayedCall(TIMINGS.chapterBeatDelay, () => this.runRunevaultTour());
    }
  }

  private runRootholdTour(): void {
    const t = this.ctx.data.dialogue.tours?.roothold;
    if (!t) return;
    const bus = this.ctx.bus;
    this.bubble.sequence('eleanor', t.intro, () => {
      bus.emit('tour:point', { target: 'roothold_house' });
      this.bubble.say('eleanor', t.house, 120000);
      const offOpen = bus.on('ui:store_toggled', ({ open }) => {
        if (!open) return;
        offOpen();
        bus.emit('tour:unpoint', {});
        this.runShopWalkthrough(t);
      });
      this.offBus.push(offOpen);
    });
  }

  /**
   * The 3 sections, then the ✕ — and ONE arrow in the whole walkthrough.
   *
   * The panel still follows her words (`showSection`), so eye and shelf agree
   * while she talks. What is gone is the little pointer that hopped tab to tab
   * with each line: an arrow means "do this", and there was nothing to do —
   * she is showing the shelves herself, the player only taps to read on. Three
   * arrows demanding nothing taught the player to ignore the fourth, which is
   * the one that matters.
   *
   * So the arrow appears exactly once, on the last line, over the button that
   * ends the visit — the only moment the walkthrough actually asks for a tap
   * on something.
   */
  private runShopWalkthrough(t: { sections: string[]; close: string; outro: string }): void {
    this.bubble.sequence('eleanor', [...t.sections, t.close], undefined, (i) => {
      if (i < t.sections.length) this.store.showSection(i);
      else this.pointUi(this.store.getClosePos());
    });
    const offClose = this.ctx.bus.on('ui:store_toggled', ({ open }) => {
      if (open) return;
      offClose();
      this.clearUiPointer();
      // Only AFTER the shop closes does she hand over the button — and only
      // after her line does it appear. Before this moment it never has.
      this.bubble.sequence('eleanor', [t.outro], () => {
        this.ctx.state.addStat('shop:unlocked', 1);
        this.ctx.state.addStat('tour:roothold', 1);
        this.hud.storeButton.setVisible(this.ctx.state.tutorialDone && this.shopUnlocked());
        this.ctx.bus.emit('tour:completed', { id: 'roothold' });
      });
    });
    this.offBus.push(offClose);
  }

  private runRunevaultTour(): void {
    const t = this.ctx.data.dialogue.tours?.runevault;
    if (!t) return;
    const bus = this.ctx.bus;
    this.bubble.sequence('selyna', t.intro, () => {
      bus.emit('tour:point', { target: 'runevault_cauldron' });
      this.bubble.say('selyna', t.cauldron, 120000);
      const offOpen = bus.on('ui:cauldron_toggled', ({ open }) => {
        if (!open) return;
        offOpen();
        bus.emit('tour:unpoint', {});
        this.bubble.sequence('selyna', [t.explain, t.close], undefined, (i) => {
          if (i === 1) this.pointUi(this.cauldron.getClosePos());
        });
        const offClose = bus.on('ui:cauldron_toggled', ({ open: o }) => {
          if (o) return;
          offClose();
          this.clearUiPointer();
          this.ctx.state.addStat('tour:runevault', 1);
          this.ctx.bus.emit('tour:completed', { id: 'runevault' });
        });
        this.offBus.push(offClose);
      });
      this.offBus.push(offOpen);
    });
  }

  private shopUnlocked(): boolean {
    return this.ctx.state.stat('shop:unlocked') > 0;
  }

  /** The tours' UI-space pointer (panel tabs, close buttons). */
  private pointUi(pos: { x: number; y: number } | null): void {
    this.clearUiPointer();
    if (!pos) return;
    const arrow = this.add.image(pos.x, pos.y - 96, 'ui_arrow').setScale(0.42).setDepth(DEPTH_TUTORIAL - 1);
    this.tweens.add({
      targets: arrow,
      y: pos.y - 62,
      duration: 420,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
    this.tourUiArrow = arrow;
  }

  private clearUiPointer(): void {
    if (!this.tourUiArrow) return;
    this.tweens.killTweensOf(this.tourUiArrow);
    this.tourUiArrow.destroy();
    this.tourUiArrow = undefined;
  }

  private playRegardBeats(characterId: string, hearts: number): void {
    // Mid-tutorial (the Crystal Ball pays exactly one heart) the sequence
    // would seize the bubble and end on hide(), stranding the tap-gated step
    // it interrupted. The milestone plays once ever, so it is deferred, not
    // dropped: `onTutorialStep` flushes the queue on the done beat.
    if (!this.ctx.state.tutorialDone) {
      this.pendingHearts.push({ characterId, hearts });
      return;
    }
    const beats = this.ctx.systems.story.regardBeats(characterId, hearts);
    if (!beats) return;
    this.time.delayedCall(TIMINGS.chapterBeatDelay, () => {
      this.speakHere(beats.speaker as SpeakerId, beats.lines);
    });
  }

  /** A world entered for the first time: whoever lives there speaks. Waits out
   *  the travelling curtain — she is not talking over a black screen. */
  private playArrivalBeats(worldId: string): void {
    const beats = this.ctx.systems.story.arrivalBeats(worldId);
    if (!beats) return;
    this.time.delayedCall(TIMINGS.chapterBeatDelay, () => {
      this.bubble.sequence(beats.speaker as SpeakerId, beats.lines);
    });
  }

  private maybeShowTooltip(itemId: number): void {
    const item = this.ctx.state.items.get(itemId);
    if (!item || item.kind !== 'item') return;
    if (item.readyAt !== undefined) return; // generators harvest instead
    // Story items (Golden Egg/Elder) are not merchandise — no card; the board
    // plays their own tap beat instead.
    const tier = this.ctx.data.chains.chains
      .find((c) => c.id === item.chain)
      ?.tiers.find((t) => t.tier === item.tier);
    if (tier?.sellable === false) return;
    // The card is the inspect half of the same gesture pair as tap-to-pocket, so
    // it rides the same permission rather than the retired board-sell one.
    if (!this.bagAllowed()) return;
    const { x, y } = this.cellToScreen(item.col, item.row);
    this.tooltip.openFor(itemId, item.chain, item.tier, x, y - 116);
  }

  /* ------------------------ hand & arrow markers -------------------- */

  /**
   * The UI scene has its own fixed camera, but the board camera pans/zooms over
   * the big map — so a board cell's on-screen spot is its world point pushed
   * through the board camera's worldView. All board-anchored markers (hand,
   * arrow, tooltip) go through here so they track wherever the camera sits.
   */
  /**
   * What the lesson's markers point at RIGHT NOW — the test bridge's
   * `pointers()` reads this so a harness can literally follow the pointer.
   * Board targets come back as CELLS (the bridge maps them to the piece's art,
   * which is what a player taps); UI targets come back as screen points.
   */
  markerTargets(): {
    hand:
      | { fromCell: TilePos | null; toCell: TilePos | null }
      | { at: { x: number; y: number } }
      | null;
    arrowCell: TilePos | null;
    arrowCharacter: string | null;
    arrow: { x: number; y: number } | null;
  } {
    let hand: ReturnType<UIScene['markerTargets']>['hand'] = null;
    // ASKED BEFORE THE MARKERS EXIST. The scene is in `scene.keys` from the
    // moment it is added, but `this.hand` is only built partway through
    // `create()` — and the bridge is POLLED, by a harness that reads it many
    // times a second across a scene restart. Throwing there is not a game bug
    // but it makes every check flaky, and a pointer nobody has put up yet has
    // an honest answer: nothing is being pointed at.
    if (!this.hand) return { hand: null, arrowCell: null, arrowCharacter: null, arrow: null };
    if (this.hand.visible && this.handDrag) {
      hand = {
        fromCell: markerPointCell(this.ctx.state, this.handDrag.from),
        toCell: markerPointCell(this.ctx.state, this.handDrag.to)
      };
    } else if (this.hand.visible && this.handPoint) {
      const p = this.handPoint();
      if (p) hand = { at: { x: p.x - 28, y: p.y - 32 } };
    }
    let arrowCell = this.arrowAnchor && this.arrowTile ? markerPointCell(this.ctx.state, this.arrowTile) : null;
    // The commission arrow sits on the House until its panel opens — answer
    // with the House's CELL so the bridge aims at its art, not its tile centre
    // (which a tree in front may be standing on).
    if (!arrowCell && this.arrowAnchor && this.arrowUi === 'commission' && !this.commission.isOpen) {
      const house = [...this.ctx.state.items.values()].find((i) => i.kind === 'item' && i.chain === 'lumber' && i.tier === 3);
      if (house) arrowCell = { col: house.col, row: house.row };
    }
    const arrow = this.arrowAnchor && !arrowCell ? this.arrowAnchor() : null;
    return { hand, arrowCell, arrowCharacter: this.arrowAnchor ? this.arrowCharacter : null, arrow: arrow ? { x: arrow.x, y: arrow.y } : null };
  }

  private cellToScreen(col: number, row: number): { x: number; y: number } {
    const w = gridToWorld(col, row);
    return this.worldToScreen(w.x, w.y);
  }

  private worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const view = this.scene.get(SCENES.board)?.cameras?.main?.worldView;
    if (view && view.width > 0 && view.height > 0) {
      return {
        x: ((wx - view.x) / view.width) * LIVE_GAME_WIDTH,
        y: ((wy - view.y) / view.height) * LIVE_GAME_HEIGHT
      };
    }
    return { x: wx, y: wy };
  }

  /**
   * The player touched something this step doesn't allow. Rather than swallow
   * it, re-point: a quick pop on whichever guidance marker is live, and a bump
   * on the bubble that says what the step wants. Purely additive — the marker's
   * own looping tween keeps running underneath (tutorial-design law 3).
   */
  /** The satchel is usable once the tutorial has taught it, and always after. */
  /** The Store is cosmetics — it opens the moment the tutorial is over and
   *  never during it. There is no `allow.store`: no beat teaches it, because
   *  nothing in it is a rule. */
  private storeAllowed(): boolean {
    return this.tutorialOver();
  }

  /**
   * THE TUTORIAL IS OVER — and `lastStep?.done` alone does NOT say so.
   *
   * `lastStep` is null until a `tutorial:step` event arrives, so the bare test
   * `!this.lastStep?.done` reads `undefined`, negates to TRUE, and refuses.
   * That is the right answer while a lesson runs and the WRONG one in every
   * state where no step is live — which includes the one that matters, a save
   * whose walkthrough finished long ago. Three gates were written that way and
   * all three were silently shut for exactly the player who had finished the
   * game: the real-money checkout, the currency shop, and the gold shortfall.
   * `storeAllowed` had the correct form all along; this is that form, named.
   *
   * `state.tutorialDone` is the persisted fact and the honest fallback. During
   * a lesson `lastStep.done` is false and wins, so the protection is unchanged.
   */
  private tutorialOver(): boolean {
    return this.lastStep?.done ?? this.ctx.state.tutorialDone;
  }


  private bagAllowed(): boolean {
    return (this.lastStep?.done ?? this.ctx.state.tutorialDone) || (this.lastStep?.allow.bag ?? false);
  }

  private nudgeMarkers(): void {
    if (this.lastStep?.done) return;
    const live = [this.hand, this.arrow].filter((m) => m.visible);
    for (const marker of live) {
      const base = marker === this.hand ? this.handBaseScale : this.arrowBaseScale;
      this.tweens.add({
        targets: marker,
        scale: { from: base * 1.28, to: base },
        duration: 220,
        ease: 'Back.easeOut'
      });
    }
    this.bubble.bump();
  }

  private clearMarkers(): void {
    for (const chain of this.markerFx) chain.destroy();
    this.markerFx = [];
    this.tweens.killTweensOf(this.hand);
    this.tweens.killTweensOf(this.arrow);
    this.tweens.killTweensOf(this.handProg);
    this.tweens.killTweensOf(this.arrowBob);
    this.tweens.killTweensOf(this.handBob);
    // Reset transforms a bounce cycle may have left mid-flight.
    this.hand.setScale(this.handBaseScale).setAngle(0);
    this.arrow.setScale(this.arrowBaseScale);
    this.handBob.v = 0;
    this.arrowBob.v = 0;
    this.hand.setVisible(false);
    this.arrow.setVisible(false);
    this.handDrag = null;
    this.handPoint = null;
    this.arrowAnchor = null;
    this.arrowTile = null;
    this.arrowCharacter = null;
    this.arrowUi = null;
    this.arrowOnPiece = false;
    this.hintHand = false;
    this.handOwner = null;
  }

  /** Register a looping marker tween-chain so clearMarkers() can destroy it.
   *  (Targets are stamped onto each child tween — the chain type wants them.) */
  private markerChain(cfg: {
    targets: object;
    loop?: number;
    loopDelay?: number;
    tweens: Array<Omit<Phaser.Types.Tweens.TweenBuilderConfig, 'targets'>>;
  }): void {
    this.markerFx.push(
      this.tweens.chain({
        ...cfg,
        tweens: cfg.tweens.map((t) => ({ ...t, targets: cfg.targets }))
      })
    );
  }

  /**
   * The Codex lesson holds its own book open — every beat of it is gated on
   * turning a page, and a tap on Eleanor's bubble also reaches the panel's
   * scrim. The beat that teaches CLOSING drops the hold, which is what puts the
   * ✕ back on the page for its arrow to point at.
   *
   * Called from `onTutorialStep` BEFORE `applyMarkers`, and the order is the
   * whole point: `getClosePos` answers null while the book is held, so an arrow
   * resolved first would resolve to nothing.
   */
  private applyCodexHold(step: TutorialStepEvent): void {
    this.codex.setHeld(!step.done && step.allow.codexHold === true);
    // The same safety net the satchel and the Ledger carry: a beat that is not
    // the lesson finds the book SHUT. The one exception is the beat that
    // teaches closing it — there the ✕ is the gate, and shutting the panel for
    // the player would answer their own lesson for them.
    if (
      !step.done &&
      !step.allow.codexHold &&
      !(step.arrow && 'ui' in step.arrow && step.arrow.ui === 'codex_close') &&
      this.codex.isOpen
    ) {
      this.codex.requestClose();
    }
  }

  /**
   * THE PIN OWNS THE POINTER WHILE IT IS UP.
   *
   * `house_skip` says "tap it, then spend Warmth", and stands an arrow on the
   * House so the player knows which roof to tap. They tap it, the skip pin
   * rises over that same roof — and the pin draws its OWN arrow on the ⚡ row.
   * The House arrow stayed, bouncing at a thing already done, right beside the
   * one pointing at what to do next. Two pointers is not twice the guidance; it
   * is the player wondering which of the two they got wrong.
   *
   * So a BOARD arrow stands down for as long as an offer is open, and comes
   * back if the offer leaves without being paid — the beat is still live and
   * would otherwise be left pointing at nothing.
   *
   * The flag is read inside `placeArrow` rather than here, because a step's
   * arrow is drawn from four places (the step itself, a marker refresh, the
   * `arrowThen` hand-off, a nudge) and a rule enforced at one caller is a rule
   * three callers break. Here it only asks the live step to re-assert itself,
   * which is what applies — or now withholds — the arrow.
   */
  private setSkipPinOpen(open: boolean): void {
    if (this.skipPinOpen === open) return;
    this.skipPinOpen = open;
    const step = this.lastStep;
    if (step && !step.done) this.applyMarkers(step);
  }

  private applyMarkers(step: TutorialStepEvent): void {
    this.clearMarkers();
    // The gauntlet demonstrates ACTIONS (drags); the arrow points at static
    // targets. They are mutually exclusive — a step defining both shows only
    // the hand (data should define exactly one).
    if (step.hand) this.placeHand(step.hand);
    else if (step.arrow) this.placeArrow(step.arrow);
  }

  /**
   * FIRST CONTACT — name a machine the first time one is standing on the board.
   *
   * The north has no tutorial by design and must not grow one, but that left
   * four of its five machines unnamed in every string the player could read,
   * while two quests asked for pieces off the fifth. These lines are the
   * introduction, spoken by the world's own giver: what it is called, what
   * comes out of it, and — on the first one only — that every twelfth firing
   * grows the next machine.
   *
   * Latched in `stats` (`fc:<chain>`), so it is said once ever and survives a
   * reload. A region can seed several farms at once, so the fresh ones are
   * spoken as ONE tap-advanced sequence per speaker rather than as a pile of
   * timed bubbles racing each other for the same card.
   */
  private sweepFirstContact(): void {
    if (!this.ctx.state.tutorialDone) return;
    // Somebody is already talking — the Borealis arrival speech owns the stage
    // on the very first visit, and the kiln's introduction belongs after it.
    if (this.bubble.visible) {
      this.time.delayedCall(FIRST_CONTACT_RETRY_MS, () => this.sweepFirstContact());
      return;
    }
    const fresh = FIRST_CONTACT.filter(
      (c) =>
        this.ctx.state.stat(`fc:${c.chain}`) === 0 &&
        [...this.ctx.state.items.values()].some(
          (i) => i.kind === 'item' && i.chain === c.chain && i.tier === c.tier
        )
    );
    if (!fresh.length) return;

    // Grouped by speaker and played back to back: the table is per world today,
    // but a shared region would otherwise interleave two voices in one bubble.
    const groups = new Map<string, string[]>();
    for (const c of fresh) {
      this.ctx.state.addStat(`fc:${c.chain}`, 1);
      const line = this.ctx.data.dialogue.hints[c.hint as keyof typeof this.ctx.data.dialogue.hints];
      if (!line) continue;
      groups.set(c.speaker, [...(groups.get(c.speaker) ?? []), line]);
    }
    const queue = [...groups.entries()];
    const playNext = (): void => {
      const next = queue.shift();
      if (!next) return;
      this.bubble.sequence(next[0] as SpeakerId, next[1], playNext);
    };
    playNext();
  }

  uiTarget(
    ref: { ui: TutorialUiTarget } | { fogRegion: string } | { character: string }
  ): { x: number; y: number; height?: number } | null {
    if ('character' in ref) {
      // Ask the board for her LIVE standee — she is authored in the World
      // Builder, so nothing here may remember where she stands.
      const board = this.scene.get(SCENES.board) as BoardScene | undefined;
      const point = board?.characterMarkerPoint?.(ref.character);
      if (point) {
        const head = this.worldToScreen(point.x, point.y);
        return { ...head, height: this.worldToScreen(point.x, point.bottom).y - head.y };
      }
      // Her art failed to load, so there is no standee to point at — fall back
      // to the cell + nudge she WOULD stand on, computed the same way the board
      // computes it, so the arrow still lands on the right patch of ground.
      const cfg = this.ctx.systems.characters.get(ref.character);
      if (!cfg) return null;
      const cell = gridToWorld(cfg.anchor[0], cfg.anchor[1]);
      const ratio = TILE_W / (this.ctx.state.map.tile?.width ?? TILE_W);
      return this.worldToScreen(cell.x + (cfg.dx ?? 0) * ratio, cell.y + (cfg.dy ?? 0) * ratio);
    }
    if ('ui' in ref) {
      // The ⚡+ button until the Emporium opens, then the FREE! card inside it —
      // handPoint/arrowAnchor re-evaluate each frame, so the marker follows live.
      if (ref.ui === 'marketplace') return this.shop.getFreeButtonPos() ?? this.hud.getEnergyPlusPos();
      if (ref.ui === 'ledger') return this.hud.getLedgerPos();
      // The status readout is a HUD block, not a button: the marker wants its
      // whole height so the arrow can sit clear of it rather than across the
      // hearts it is pointing at (same `height` contract the standee uses).
      if (ref.ui === 'status') return this.statusPanel.getMarkerPos();
      if (ref.ui === 'cookbook') return { x: this.cookbookButton.x, y: this.cookbookButton.y };
      // The Codex lesson's three pointers, each null off its own page so the
      // arrow walks the book (card → EVOLUTION → ✕) instead of hanging over a
      // spread that has already been turned.
      if (ref.ui === 'codex_card') return this.codex.getCardPos();
      if (ref.ui === 'codex_evolution') return this.codex.getEvolutionPos();
      if (ref.ui === 'codex_close') return this.codex.isOpen ? this.codex.getClosePos() : null;
      if (ref.ui === 'cookbook_close') return this.cookbook.isOpen ? this.cookbook.getClosePos() : null;
      // Same smart-target shape as `marketplace`: the satchel button until the
      // bag is open, then the chosen slot's Sell plate inside it. Re-evaluated
      // every frame, so the arrow walks the player through open → tap → Sell
      // instead of pointing at a button that is no longer the next thing to do.
      if (ref.ui === 'bag') return this.bag.getSellPos() ?? this.hud.getBagPos();
      // Same walk-the-player-through shape as `bag`, aimed at the third verb:
      // the satchel button until the bag is open, then the Give plate inside the
      // chosen slot's chooser.
      if (ref.ui === 'bag_give') return this.bag.getGivePos() ?? this.hud.getBagPos();
      if (ref.ui === 'commission') {
        // Panel up → the piece to pick, then its confirm. Panel shut → the
        // House itself, found live so the arrow survives the House moving.
        const inPanel = this.commission.getMarkerPos();
        if (inPanel) return inPanel;
        const house = [...this.ctx.state.items.values()].find(
          (i) => i.kind === 'item' && i.chain === 'lumber' && i.tier === 3
        );
        return house ? this.cellToScreen(house.col, house.row) : null;
      }
      return this.ledger.isOpen ? this.ledger.getDeliverPos() : null;
    }
    const region = this.ctx.state.map.regions.find((r) => r.id === ref.fogRegion);
    if (!region) return null;
    const tiles: TilePos[] = region.tiles.map(([c, r]) => ({ col: c, row: r }));
    let sx = 0;
    let sy = 0;
    for (const t of tiles) {
      const { x, y } = this.cellToScreen(t.col, t.row);
      sx += x;
      sy += y;
    }
    return { x: sx / tiles.length, y: sy / tiles.length - 52 };
  }

  /**
   * DECIDE ONCE WHAT AN END MEANS, then follow it.
   *
   * A marker end arrives either already aimed at a piece (the tutorial's
   * director pins which one, so a re-rank cannot swap the beat's dragon for its
   * neighbour) or as a bare cell — which is how every pointer the BOARD raises
   * arrives: the idle merge hint and the carry lesson that teaches world travel
   * both speak in cells. A bare cell with a piece standing on it means that
   * piece, and this is where it stops being a place and becomes a thing.
   *
   * Asked once, here, and never again: re-asking each frame would let the end
   * drift onto whatever wandered over the tile later, which is a pointer that
   * changes its mind — the failure this whole path exists to avoid.
   */
  private anchorEnd(point: MarkerPoint): MarkerPoint {
    return point.item !== undefined ? point : markerPointAt(this.ctx.state, point.col, point.row);
  }

  private placeHand(hand: ResolvedHand, owner: 'tutorial' | 'hint' | 'carry' = 'tutorial'): void {
    this.handOwner = owner;
    if ('from' in hand) {
      // Drag gesture: store the from/to ENDS and drive a 0→1 progress proxy;
      // update() lerps the live re-projected positions so the hand follows the
      // camera AND the pieces. (Alpha still fades on the hand itself; that's
      // screen-space.)
      this.handDrag = { from: this.anchorEnd(hand.from), to: this.anchorEnd(hand.to) };
      // A drag whose two ends turn out to be the same piece is the player having
      // already done the half of it that mattered; the destination reverts to
      // the ground it names so the gesture still says "put it HERE" rather than
      // collapsing onto the thing being carried. (The director applies the same
      // rule to its own beats — this catches the pointers that come from the
      // board, where the ends arrive as bare cells.)
      if (
        this.handDrag.from.item !== undefined &&
        this.handDrag.from.item === this.handDrag.to.item
      ) {
        this.handDrag.to = { col: hand.to.col, row: hand.to.row };
      }
      this.hand.setVisible(true);
      const base = this.handBaseScale;
      const run = (): void => {
        if (!this.hand.visible) return;
        this.handProg.t = 0;
        this.hand.setAlpha(0);
        // Puppet-style secondary motion: fade in slightly raised, PRESS down on
        // the item (squash), tilt back while pulling, then a springy settle.
        this.hand.setScale(base * 1.08).setAngle(-5);
        this.tweens.add({
          targets: this.hand,
          alpha: 1,
          scale: base,
          duration: 310,
          ease: 'Back.easeOut',
          onComplete: () => {
            // ONE STROKE, TWO TWEENS — the tilt and the travel must carry the
            // same duration or the hand finishes leaning before it arrives.
            this.tweens.add({ targets: this.hand, angle: 4, duration: 1200, ease: 'Sine.easeInOut' });
            this.tweens.add({
              targets: this.handProg,
              t: 1,
              duration: 1200,
              ease: 'Sine.easeInOut',
              onComplete: () => {
                // Release: tiny overshoot pop as the item "drops".
                this.tweens.add({ targets: this.hand, angle: 0, scale: base * 1.05, duration: 200, ease: 'Back.easeOut' });
                this.tweens.add({
                  targets: this.hand,
                  alpha: 0,
                  duration: 260,
                  delay: 220,
                  // A BEAT OF REST before the gesture starts over — it used to
                  // restart the instant it faded, which is what made the hand
                  // read as frantic rather than as a demonstration.
                  // `completeDelay`, never a `delayedCall`: `clearMarkers`
                  // kills TWEENS, so a timer would resurrect a hand after the
                  // step it belongs to has already gone.
                  completeDelay: 450,
                  onComplete: run
                });
              }
            });
          }
        });
      };
      run();
      return;
    }
    // Point gesture at a UI/fog target: re-evaluate the anchor each frame.
    this.handPoint = () => {
      const t = this.uiTarget(hand);
      return t ? { x: t.x + 28, y: t.y + 32 } : null;
    };
    const target = this.handPoint();
    if (!target) {
      this.hand.setVisible(false);
      this.handPoint = null;
      return;
    }
    this.hand.setVisible(true);
    this.hand.setAlpha(1);
    this.hand.setPosition(target.x, target.y);
    // Tap cycle, relative to the marker's BASE scale (absolute `scale: 1` was
    // the old painted texture's natural size — it ballooned the real gauntlet
    // art). Press in with a squash, release with a springy Back overshoot; the
    // matching handBob dip makes it read as a physical tap, not a zoom.
    const base = this.handBaseScale;
    this.handBob.v = 0;
    this.markerChain({
      targets: this.handBob,
      loop: -1,
      loopDelay: 200, // PAIRED with the other chain — equal, or the tap splits in two
      tweens: [
        { v: 14, duration: 260, ease: 'Quad.easeIn' },
        { v: 0, duration: 430, ease: 'Back.easeOut' }
      ]
    });
    this.markerChain({
      targets: this.hand,
      loop: -1,
      loopDelay: 200, // PAIRED with the other chain — equal, or the tap splits in two
      tweens: [
        { scale: base * 0.9, duration: 260, ease: 'Quad.easeIn' },
        { scale: base, duration: 430, ease: 'Back.easeOut' }
      ]
    });
  }

  private placeArrow(arrow: ResolvedArrow): void {
    // The skip offer hanging over a piece already points at what to do next
    // (see `setSkipPinOpen`); a second arrow on the piece under it is one
    // pointer too many. UI targets are unaffected — the Emporium's ⚡ + and the
    // satchel are nowhere near the pin.
    if (this.skipPinOpen && 'tile' in arrow) return;
    if ('tile' in arrow) {
      // Same law as the hand: decide once whether this names a piece or the
      // ground, then re-read its position every frame. An arrow over a tapped
      // generator has to stay over it when the player shuffles the board around
      // it, and go quiet when the thing it names is carried off.
      const end = this.anchorEnd(arrow.tile);
      this.arrowOnPiece = end.item !== undefined;
      this.arrowTile = end;
      this.arrowAnchor = () => {
        const at = markerPointCell(this.ctx.state, end);
        return at ? this.cellToScreen(at.col, at.row) : null;
      };
      this.arrowLift = 156;
    } else {
      this.arrowAnchor = () => this.uiTarget(arrow);
      this.arrowCharacter = 'character' in arrow ? arrow.character : null;
      this.arrowUi = 'ui' in arrow ? arrow.ui : null;
      // A character anchor is already the top of her head, so it wants the
      // smallest gap of the three; a fog region resolves to the middle of a
      // whole strip and wants the largest.
      this.arrowLift = 'character' in arrow ? 84 : 'ui' in arrow ? 116 : 192;
    }
    const target = this.arrowAnchor();
    if (!target) {
      // A PIECE that is not there is not coming. A UI control that is not
      // there yet usually is: the Codex opens a breath after the beat that
      // points into it, and turns its page after the beat that points at
      // EVOLUTION. Keep the anchor and let update() show the arrow the frame
      // the control exists — the lesson's pointer must not depend on the
      // panel's animation being faster than the bubble.
      if (this.arrowOnPiece || 'tile' in arrow) this.arrowAnchor = null;
      else this.armArrowLater();
      return;
    }
    this.showArrowAt(target);
  }

  /** The arrow's first frame: visible, and bobbing. */
  private showArrowAt(target: { x: number; y: number }): void {
    this.arrow.setVisible(true);
    this.arrow.setAlpha(1);
    this.arrow.setPosition(target.x, target.y - this.arrowLift);
    this.startArrowBob();
  }

  /** Poll a UI anchor that answered null until it answers; `clearMarkers`
   *  retires the poll by dropping `arrowAnchor`. */
  private armArrowLater(): void {
    const anchor = this.arrowAnchor;
    this.time.delayedCall(80, () => {
      if (this.arrowAnchor !== anchor || this.arrow.visible) return;
      const t = anchor!();
      if (t) this.showArrowAt(t);
      else this.armArrowLater();
    });
  }

  private startArrowBob(): void {
    // Bob via a proxy so update() can re-anchor the arrow to its cell each frame
    // while it bobs (a tween writing arrow.y directly would fight re-projection).
    // Puppet-style cycle: rise, then DROP toward the target with a tiny impact
    // squash and a springy Back-eased recovery — subtle, but reads as weight.
    this.arrowBob.v = 0;
    const base = this.arrowBaseScale;
    this.markerChain({
      targets: this.arrowBob,
      loop: -1,
      tweens: [
        { v: -22, duration: 380, ease: 'Quad.easeOut' }, // rise
        {
          v: 0,
          duration: 300,
          ease: 'Quad.easeIn', // accelerate down…
          onComplete: () => {
            // …impact: brief squash, then spring back to shape.
            this.tweens.add({
              targets: this.arrow,
              scaleX: base * 1.08,
              scaleY: base * 0.9,
              duration: 90,
              yoyo: true,
              ease: 'Quad.easeOut',
              onComplete: () => this.arrow.setScale(base)
            });
          }
        },
        { v: 0, duration: 240 } // settle beat before the next hop
      ]
    });
  }

  /* ----------------------------- dialogs ---------------------------- */

  /**
   * SETTINGS — music, graphics quality, and the reset confirmation.
   *
   * IT IS SCALED FOR PORTRAIT, like every other popup in the game. The plate is
   * 900 units of a 2560-unit-wide live space, which on a desktop window is a
   * comfortable card and on a handset is 35% of the screen — a stamp, with type
   * arriving at 2-5 real pixels. `panelFitScale` is the shared answer to that,
   * and this is the arithmetic it does here:
   *   width   2560 x 0.94 / 900   = 2.67
   *   height  the SHORTEST live portrait space is 2560 tall (a square screen;
   *           a real phone is ~5500), so 2560 x 0.92 / 796 = 2.96 — height
   *           cannot bind for a plate this short, on any handset or tablet
   *   cap     2.2
   * The cap wins on every device, so the sheet lands at 1980x1751 units: 77% of
   * the portrait width, up from 35%. On a 390px-wide phone, where a unit is
   * 390/2560 = 0.152 real px, that is a 302x267 real-pixel card.
   * (It is the CAP that holds it short of the 94% the width bound would allow —
   * raising it is a decision for the shared primitive, not for this panel.)
   *
   * `panelFitScale` rather than `panelMobileScale` even though the two return
   * the same 2.2 today: this plate MEASURES its own height (see `relayout`),
   * so the bound that watches the height is the one that keeps the promise
   * whenever the graphics blurb grows a line.
   *
   * Desktop gets exactly 1 from it and does not move by a unit.
   */
  private openResetDialog(): void {
    if (this.dialog) return;
    const container = this.add.container(LIVE_GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2).setDepth(DEPTH_DIALOG);
    // The dim stays a CHILD of the scaled container, the way the Codex and the
    // Store scrims do. Scaling it can only ever make it BIGGER than the screen
    // — the scale is 1 on desktop and >1 in portrait, never below 1 — so there
    // is no edge for the board to show through. Its default hit area is the
    // rectangle itself and is mapped through the very same transform, so what
    // it catches always matches what it paints.
    //
    // ONLY THE BUTTON ROW CLOSES THIS. The dim catches the tap — being
    // interactive is the whole of that, and it deliberately does NOT cancel the
    // event (see the note in `ShopPanel.ts`) — but it does not dismiss: a thumb
    // brushing the edge of the sheet must not throw away the settings the
    // player opened it to change. "Keep Playing" is the way out and it is the
    // widest, greenest thing on the plate.
    const dim = this.add
      .rectangle(0, 0, LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, num(PALETTE.night), 0.55)
      .setInteractive();
    // The SHEET: its (0,0) is the plate's TOP CENTRE. Content flows downward
    // in `relayout`, the plate is drawn to fit what the flow measured, and the
    // sheet is then lifted by half the result so the dialog stays centred.
    const panel = this.add.graphics();
    const sheet = this.add.container(0, 0);
    sheet.add(panel);

    const title = this.add
      .text(0, 0, 'Settings', {
        fontFamily: FONT.ui,
        fontSize: '54px',
        fontStyle: 'bold',
        // NOT PALETTE.cream — the panel is filled cream, so a cream heading is
        // invisible on it (it always was; nobody had reason to look).
        color: PALETTE.night
      })
      .setOrigin(0.5);
    sheet.add(title);

    /** Shrink a key's label until it fits its plate — "Graphics: Auto
     *  (Balanced)" overflowed the pill on phones and read as broken. */
    const fitLabel = (label: Phaser.GameObjects.Text, budget: number): void => {
      let px = Math.round(parseFloat(String(label.style.fontSize))) || 32;
      while (label.width > budget && px > 18) {
        px -= 1;
        label.setFontSize(px);
      }
    };

    // Background-music toggle (persists; the AudioManager applies it via the bus).
    const musicLabel = (): string => (getMusicMuted() ? 'Music: Off' : 'Music: On');
    const musicBtn = this.add.container(0, 0);
    const musicBg = this.add
      .image(0, 0, getMusicMuted() ? 'ui_btn_play' : 'ui_btn_green')
      .setScale(0.86, 0.62);
    const musicText = this.add
      .text(0, -8, musicLabel(), {
        fontFamily: FONT.ui,
        fontSize: '36px',
        fontStyle: 'bold',
        color: '#FFFFFF'
      })
      .setOrigin(0.5)
      .setShadow(0, 4, 'rgba(36,27,34,0.5)', 4);
    fitLabel(musicText, 315);
    musicBtn.add([musicBg, musicText]);
    musicBtn.setSize(370, 100).setInteractive({ useHandCursor: true });
    musicBtn.on('pointerup', () => {
      const muted = !getMusicMuted();
      setMusicMuted(muted);
      this.ctx.bus.emit('audio:set_music_muted', { muted });
      musicText.setText(musicLabel());
      musicBg.setTexture(muted ? 'ui_btn_play' : 'ui_btn_green');
    });
    sheet.add(musicBtn);

    // Graphics quality. Cycles Auto → High → Balanced → Low. `high` is the
    // engine unchanged, so nothing here can cost a capable device anything —
    // the lower tiers only ever subtract.
    const gfxBtn = this.add.container(0, 0);
    const gfxBg = this.add.image(0, 0, 'ui_btn_green').setScale(0.86, 0.62);
    const gfxText = this.add
      .text(0, -8, graphics.label, {
        fontFamily: FONT.ui,
        fontSize: '32px',
        fontStyle: 'bold',
        color: '#FFFFFF'
      })
      .setOrigin(0.5)
      .setShadow(0, 4, 'rgba(36,27,34,0.5)', 4);
    fitLabel(gfxText, 315);
    gfxBtn.add([gfxBg, gfxText]);
    gfxBtn.setSize(370, 100).setInteractive({ useHandCursor: true });
    sheet.add(gfxBtn);
    const gfxNote = this.add
      .text(0, 0, GRAPHICS_PROFILES[graphics.tier].note, {
        fontFamily: FONT.ui,
        fontSize: `${SETTINGS_NOTE_PX}px`,
        color: '#8A6248',
        align: 'center',
        lineSpacing: 6,
        wordWrap: { width: 780 }
      })
      .setOrigin(0.5, 0);
    sheet.add(gfxNote);

    const divider = this.add.rectangle(0, 0, 760, 3, num(PALETTE.lava), 0.22);
    sheet.add(divider);
    const resetTitle = this.add
      .text(0, 0, 'Reset Cinder Hollow?', {
        fontFamily: FONT.ui,
        fontSize: '40px',
        fontStyle: 'bold',
        color: PALETTE.night
      })
      .setOrigin(0.5);
    sheet.add(resetTitle);
    // 34px: the warning grew with the graphics blurb — 30 read at 15 real px
    // on a 1080p screen and the owner called both too small.
    const body = this.add
      .text(0, 0, 'The ash will settle back over everything\nyou have rekindled. This cannot be undone.', {
        fontFamily: FONT.ui,
        fontSize: '34px',
        color: '#8A6248',
        align: 'center',
        lineSpacing: 10
      })
      .setOrigin(0.5);
    sheet.add(body);

    const makeButton = (
      x: number,
      label: string,
      texture: string,
      scaleX: number,
      onTap: () => void
    ): Phaser.GameObjects.Container => {
      const button = this.add.container(x, 0);
      const bg = this.add.image(0, 0, texture).setScale(scaleX, 0.78);
      const text = this.add
        .text(0, -10, label, {
          fontFamily: FONT.ui,
          fontSize: '40px',
          fontStyle: 'bold',
          color: '#FFFFFF'
        })
        .setOrigin(0.5)
        .setShadow(0, 4, 'rgba(36,27,34,0.5)', 4);
      fitLabel(text, 380 * scaleX - 60);
      button.add([bg, text]);
      button.setSize(380 * scaleX, 112);
      button.setInteractive({ useHandCursor: true });
      button.on('pointerup', onTap);
      sheet.add(button);
      return button;
    };

    const resetButton = makeButton(-210, 'Reset', 'ui_btn_play', 0.72, () => {
      this.closeResetDialog();
      this.ctx.bus.emit('game:reset_requested', {});
    });
    const keepButton = makeButton(210, 'Keep Playing', 'ui_btn_green', 0.95, () =>
      this.closeResetDialog()
    );

    // Map Editor — the tool that authors the zone registry the engine runs
    // (`src/editor/`). Parked on the title row so it never crowds the reset
    // copy. HIDDEN by default (`MAP_EDITOR_IN_SETTINGS`); `?mapedit` on the
    // URL brings it back for whoever is actually authoring, the same way
    // `?uiedit` opens the UI Builder.
    const showEditor =
      MAP_EDITOR_IN_SETTINGS || new URLSearchParams(window.location.search).has('mapedit');
    const editorButton = showEditor
      ? makeButton(292, 'Map Editor', 'ui_btn_green', 0.68, () => {
          this.closeResetDialog();
          this.ctx.bus.emit('editor:open', {});
        })
      : null;

    /**
     * The flow. Every row is seated off the MEASURED bottom of the row above,
     * so there is never a reserve hole at rest — and when the blurb grows to
     * three lines the plate grows with it, right here, instead of having
     * carried the worst case's emptiness from the first frame.
     */
    const relayout = (): number => {
      let y = 26;
      title.setY(y + title.height / 2);
      editorButton?.setPosition(292, title.y);
      y = title.y + title.height / 2 + 24;
      musicBtn.setY(y + 47); // the pill plate is 94 tall at 0.62
      y = musicBtn.y + 47 + 18;
      gfxBtn.setY(y + 47);
      y = gfxBtn.y + 47 + 16;
      gfxNote.setY(y);
      y += gfxNote.height + 30;
      divider.setY(y);
      y += 40;
      resetTitle.setY(y + resetTitle.height / 2);
      y = resetTitle.y + resetTitle.height / 2 + 14;
      body.setY(y + body.height / 2);
      y = body.y + body.height / 2 + 26;
      resetButton.setY(y + 56);
      keepButton.setY(y + 56);
      y += 112 + 36;
      const h = y;
      panel.clear();
      panel.fillStyle(num(PALETTE.night), 0.25);
      panel.fillRoundedRect(-SETTINGS_W / 2, 16, SETTINGS_W, h, 52);
      panel.fillStyle(num(PALETTE.cream), 1);
      panel.fillRoundedRect(-SETTINGS_W / 2, 0, SETTINGS_W, h, 52);
      panel.lineStyle(8, num(PALETTE.lava), 1);
      panel.strokeRoundedRect(-SETTINGS_W / 2, 0, SETTINGS_W, h, 52);
      sheet.setY(-h / 2);
      return h;
    };

    gfxBtn.on('pointerup', () => {
      const order = GRAPHICS_QUALITIES;
      const next = order[(order.indexOf(graphics.quality) + 1) % order.length];
      const needsReload = graphics.set(next);
      gfxText.setFontSize(32);
      gfxText.setText(graphics.label);
      fitLabel(gfxText, 315);
      gfxNote.setText(
        needsReload
          ? `${GRAPHICS_PROFILES[graphics.tier].note}\nReload the page to resize the canvas.`
          : GRAPHICS_PROFILES[graphics.tier].note
      );
      // The blurb may have grown or shrunk a line: reflow the plate around it.
      container.setScale(panelFitScale(SETTINGS_W, relayout()));
      (this.registry.get('power') as { refreshFps?: () => void } | undefined)?.refreshFps?.();
      // Weather, the crystal and the ambient counts are decided when the board
      // is built, so the board rebuilds rather than half-applying.
      this.game.events.emit(GRAPHICS_EVENT);
    });

    const height = relayout();
    const scale = panelFitScale(SETTINGS_W, height);
    container.add([dim, sheet]);
    container.setAlpha(0);
    // The open pops from 94% to the PANEL scale, not to 1 — tweening to a bare
    // 1 would play the flourish and then shrink the portrait sheet back to the
    // stamp it was.
    container.setScale(0.94 * scale);
    this.tweens.add({ targets: container, alpha: 1, scale, duration: 170, ease: 'Back.easeOut' });
    this.dialog = container;
  }

  private closeResetDialog(): void {
    this.dialog?.destroy();
    this.dialog = null;
  }

  /* ------------------------- real-money packs ------------------------ */

  /** Shared chrome for the purchase dialogs — cream card, gold keyline. */
  private iapCard(height: number): Phaser.GameObjects.Container {
    const container = this.add.container(LIVE_GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2).setDepth(DEPTH_DIALOG);
    const dim = this.add
      .rectangle(0, 0, LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, num(PALETTE.night), 0.55)
      .setInteractive();
    const panel = this.add.graphics();
    panel.fillStyle(num(PALETTE.night), 0.25);
    panel.fillRoundedRect(-450, -height / 2 + 16, 900, height, 52);
    panel.fillStyle(num(PALETTE.cream), 1);
    panel.fillRoundedRect(-450, -height / 2, 900, height, 52);
    panel.lineStyle(8, num(PALETTE.gold), 1);
    panel.strokeRoundedRect(-450, -height / 2, 900, height, 52);
    container.add([dim, panel]);
    container.setAlpha(0).setScale(0.94);
    this.tweens.add({ targets: container, alpha: 1, scale: 1, duration: 170, ease: 'Back.easeOut' });
    return container;
  }

  private iapButton(
    x: number,
    y: number,
    label: string,
    texture: string,
    scaleX: number,
    onTap: () => void
  ): Phaser.GameObjects.Container {
    const button = this.add.container(x, y);
    const bg = this.add.image(0, 0, texture).setScale(scaleX, 0.78);
    const text = this.add
      .text(0, -10, label, { fontFamily: FONT.ui, fontSize: '40px', fontStyle: 'bold', color: '#FFFFFF' })
      .setOrigin(0.5)
      .setShadow(0, 4, 'rgba(36,27,34,0.5)', 4);
    button.add([bg, text]);
    button.setSize(380 * scaleX, 112).setInteractive({ useHandCursor: true });
    button.on('pointerup', onTap);
    return button;
  }

  private static describeGrant(grant: { coins: number; keys: number; energy: number }): string {
    const parts: string[] = [];
    if (grant.coins > 0) parts.push(`◎ +${grant.coins.toLocaleString()} Gold`);
    if (grant.keys > 0) parts.push(`🗝 +${grant.keys} Gold Key${grant.keys > 1 ? 's' : ''}`);
    if (grant.energy > 0) parts.push(`⚡ +${grant.energy} Warmth`);
    return parts.join('    ');
  }

  /**
   * THE SWITCH: the shortfall notice's one action, and the only thing on it
   * that leaves.
   *
   * It opens the coin shop — never a checkout. `iapBridge.beginCheckout` has to
   * run inside a user gesture or the payment window is popup-blocked, and this
   * runs at the end of a chain that STARTED with a refusal; the tap that opens
   * a window is the one the player makes on a pack in the Emporium, two screens
   * from here. That is not a detail of this method, it is the reason it exists.
   *
   * Three sources, two behaviours:
   *
   *   warmth  the refusal happened inside the Emporium already, so the coin
   *           shop is the tab next door — switch, do not stack a second copy of
   *           the same hall over the first.
   *   store   the Keeper's Store is a different panel, so it stands down and
   *           leaves a ticket back to the exact shelf and scroll it was on.
   *   skip    the refusal happened on the BOARD, which is where closing the
   *           Emporium returns the player anyway. No ticket, and none needed.
   */
  private goToCoinShop(source: TopUpSource): void {
    // Robust rather than assumed: `warmth` can only be raised from an open
    // Emporium, but if it somehow is not open the action must still do the
    // thing it promises rather than nothing at all.
    if (source === 'warmth' && this.shop.isOpen) {
      this.shop.showCurrency('coins');
      return;
    }
    // Read the place BEFORE closing the panel that holds it.
    this.topUpReturn = this.store.isOpen ? { store: this.store.viewState() } : null;
    if (this.store.isOpen) this.store.requestClose();
    this.shop.open('coins');
  }

  /**
   * VALIDATION BEFORE MONEY MOVES: exactly what the pack contains, exactly
   * what it costs, and where the payment will happen — Buy or Cancel. The Buy
   * tap itself opens the checkout window (it must: the popup needs the tap's
   * transient activation to clear the blocker).
   */
  private openIapConfirmDialog(packId: string): void {
    if (this.dialog || this.iapDialog) return;
    const pack = iapBridge.pack(packId);
    if (!pack) return;

    const card = this.iapCard(660);
    card.add(
      this.add
        .text(0, -262, 'CONFIRM PURCHASE', {
          fontFamily: FONT.ui, fontSize: '48px', fontStyle: 'bold', color: PALETTE.night
        })
        .setOrigin(0.5)
    );
    card.add(
      this.add
        .text(0, -168, pack.name, {
          fontFamily: FONT.ui, fontSize: '54px', fontStyle: 'bold', color: '#8A6248'
        })
        .setOrigin(0.5)
    );
    card.add(
      this.add
        .text(0, -92, UIScene.describeGrant(pack), {
          fontFamily: FONT.ui, fontSize: '40px', fontStyle: 'bold', color: PALETTE.goldShade
        })
        .setOrigin(0.5)
    );
    card.add(
      this.add
        .text(0, -6, `€${pack.amountEur.toFixed(2)}`, {
          fontFamily: FONT.ui, fontSize: '64px', fontStyle: 'bold', color: PALETTE.night
        })
        .setOrigin(0.5)
    );
    card.add(
      this.add
        .text(0, 96, 'Payment opens in a secure checkout window.\nYour pack is delivered the moment it completes.', {
          fontFamily: FONT.ui, fontSize: '28px', color: '#8A6248', align: 'center', lineSpacing: 8
        })
        .setOrigin(0.5)
    );
    card.add(
      this.iapButton(-210, 240, 'Cancel', 'ui_btn_play', 0.72, () => this.closeIapDialog())
    );
    card.add(
      this.iapButton(210, 240, `Buy €${pack.amountEur.toFixed(2)}`, 'ui_btn_green', 0.95, () => {
        // Synchronous, inside the tap: the checkout window opens now.
        const started = iapBridge.beginCheckout(pack.id);
        this.closeIapDialog();
        if (started) this.openIapWaitingDialog();
        else this.floatWarning('Purchases are available on the EmberGames page.');
      })
    );
    this.iapDialog = card;
  }

  /** The checkout is in flight in its own window; the board stays playable. */
  private openIapWaitingDialog(): void {
    if (this.iapDialog) return;
    const card = this.iapCard(420);
    const title = this.add
      .text(0, -120, 'Waiting for payment…', {
        fontFamily: FONT.ui, fontSize: '48px', fontStyle: 'bold', color: PALETTE.night
      })
      .setOrigin(0.5);
    card.add(title);
    this.tweens.add({ targets: title, alpha: 0.55, duration: 640, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    card.add(
      this.add
        .text(0, -32, 'Finish your purchase in the secure window.\nYour pack arrives here the moment it completes.', {
          fontFamily: FONT.ui, fontSize: '28px', color: '#8A6248', align: 'center', lineSpacing: 8
        })
        .setOrigin(0.5)
    );
    card.add(
      this.iapButton(0, 122, 'Continue playing', 'ui_btn_green', 0.95, () => this.closeIapDialog())
    );
    this.iapDialog = card;
  }

  private closeIapDialog(): void {
    this.iapDialog?.destroy();
    this.iapDialog = null;
  }

  /** CONGRATULATIONS: banner with exactly what was bought, confetti, and the
   *  purchase fanfare (AudioManager rides the same `iap:completed` fact). */
  private celebratePurchase(grant: EventMap['iap:completed']): void {
    this.closeIapDialog();
    this.buildCelebrationBanner(
      'PURCHASE COMPLETE!',
      UIScene.describeGrant(grant),
      `${grant.name} — thank you, Keeper!`
    );
    this.confettiBurst(LIVE_GAME_WIDTH / 2, LIVE_GAME_HEIGHT * 0.3);
  }

  /** Paper-slip confetti in the celebration palette, raining over the banner. */
  private confettiBurst(cx: number, cy: number): void {
    const tints = [0xffd75e, 0xe8593a, 0x7fc16a, 0x6fc3e0, 0xfff6e8];
    tints.forEach((tint, i) => {
      const burst = this.add
        .particles(cx, cy - 60, 'fx_confetti', {
          speed: { min: 280, max: 680 },
          angle: { min: 235, max: 305 },
          gravityY: 980,
          lifespan: { min: 1000, max: 1700 },
          scale: { start: 1, end: 0.6 },
          alpha: { start: 1, end: 0 },
          rotate: { min: 0, max: 720 },
          tint,
          quantity: 0,
          emitting: false
        })
        .setDepth(DEPTH_DIALOG - 6);
      burst.explode(14 + i * 2);
      this.time.delayedCall(2400, () => burst.destroy());
    });
    const sparks = this.add
      .particles(cx, cy, 'fx_spark', {
        speed: { min: 220, max: 540 }, angle: { min: 0, max: 360 }, gravityY: 260,
        lifespan: { min: 500, max: 900 }, scale: { start: 0.9, end: 0 },
        alpha: { start: 1, end: 0 }, quantity: 0, emitting: false
      })
      .setDepth(DEPTH_DIALOG - 6);
    sparks.explode(26);
    this.time.delayedCall(1400, () => sparks.destroy());
  }

  private onIapFailed(reason: EventMap['iap:failed']['reason']): void {
    this.closeIapDialog();
    this.floatWarning(
      reason === 'declined'
        ? 'The payment was declined — nothing was delivered.'
        : reason === 'pending'
          ? 'Payment still processing — your pack arrives once it confirms.'
          : reason === 'unavailable'
            ? 'Purchases are available on the EmberGames page.'
            : 'Payment cancelled — nothing was charged.'
    );
  }
}
