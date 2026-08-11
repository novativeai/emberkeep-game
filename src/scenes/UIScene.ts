import Phaser from 'phaser';
import type { GameContext } from '../core/Context';
import {
  ATMOSPHERE,
  DRAGON_FEED,
  ENERGY_REGEN_MS,
  FINALE,
  GAME_WIDTH,
  GOLDEN_ALTAR,
  GOLDEN_TREMBLE_PROGRESS,
  HUD_WIDGETS,
  LEVELUP_REWARD,
  LIVE_GAME_HEIGHT,
  num,
  PALETTE,
  SCENES,
  IS_MOBILE,
  UI_SCALE,
  WELCOME_BACK_MIN_MS,
  WORLD_TELEPORT,
  WORLD_TELEPORT_BOREALIS,
  WORLD_WEATHER
} from '../core/Constants';
import { editorStore } from '../editor/editorStore';
import { goldenPromiseKept } from '../core/goldenPromise';
import { gridToWorld } from '../core/iso';
import { ensureTextures } from '../core/lazyTextures';
import type { ResolvedArrow, ResolvedHand, TilePos, TutorialStepEvent } from '../core/types';
import { CharacterBubble } from '../entities/CharacterBubble';
import { BeyondDemoPanel } from '../ui/BeyondDemoPanel';
import { CookbookPanel } from '../ui/CookbookPanel';
import { QuestPanel } from '../ui/QuestPanel';
import { Snowfall } from '../render/Snowfall';
import { EndScreen } from '../ui/EndScreen';
import { Hud } from '../ui/Hud';
import { LedgerPanel } from '../ui/LedgerPanel';
import { MilestoneGift } from '../ui/MilestoneGift';
import { DragonGauges } from '../ui/DragonGauges';
import { DuelButton } from '../ui/DuelButton';
import { DuelPanel } from '../ui/DuelPanel';
import { ShopPanel } from '../ui/ShopPanel';
import { StokeMeter } from '../ui/StokeMeter';
import { renderScale } from '../core/render-scale';
import { getMusicMuted, setMusicMuted } from '../audio/musicPref';
import { CustomUiManager } from '../ui/customUi';
import { uiRegistry } from '../ui/theme';
import { Tooltip } from '../ui/Tooltip';

const FONT = 'Trebuchet MS, Verdana, sans-serif';
/** Ambient weather sits above the whole board (UIScene renders after BoardScene)
 *  and below every HUD element — snow must never fall in front of a button. */
const DEPTH_WEATHER = 5;
const DEPTH_HUD = 10;
const DEPTH_PANEL = 60;
const DEPTH_TUTORIAL = 100;
const DEPTH_DIALOG = 200;
// On-screen heights (2560-space) for the tutorial pointer/arrow. The real art
// loads at its native pixel size, so each is scaled to these.
const HAND_MARKER_H = 172;
const ARROW_MARKER_H = 148;

/**
 * Runs in parallel above BoardScene: HUD, tooltip, Cindra's Ledger, the
 * tutorial presentation layer (Pip/Cindra bubble, guiding hand, bouncing
 * arrow) and the reset-confirm dialog. Pure subscriber + intent emitter.
 */
export class UIScene extends Phaser.Scene {
  private ctx!: GameContext;
  private regenAccum = 0;
  private hud!: Hud;
  private tooltip!: Tooltip;
  private ledger!: LedgerPanel;
  private shop!: ShopPanel;
  private milestoneGift?: MilestoneGift; // hidden via HUD_WIDGETS (code kept)
  private stokeMeter?: StokeMeter;
  private duelButton?: DuelButton;
  private duelPanel?: DuelPanel;
  private dragonGauges?: DragonGauges; // fixed HUD — off (gauges now show per-dragon on tap)
  private cookbook!: CookbookPanel;
  private cookbookButton!: Phaser.GameObjects.Container;
  private returnButton?: Phaser.GameObjects.Container; // "⟵ Niveau 1" — only after a world switch
  private weather?: Snowfall; // borealis' snow — built on first arrival, never before
  private questPanel!: QuestPanel; // objective tracker (top-right)
  private lairPreview?: Phaser.GameObjects.Container; // roothold thumbnail (travel back to the lair)
  private borealisPreview?: Phaser.GameObjects.Container; // borealis thumbnail (travel back to the aurora world)
  private borealisPreviewImg?: Phaser.GameObjects.Image;
  // Top feed HUD (shown in the lair): the dragon's fullness + the Emberberry stock,
  // built as HUD PILLS so they read as the same instrument as Warmth and Gold.
  private feedHud?: Phaser.GameObjects.Container;
  private feedEnergyVal?: Phaser.GameObjects.Text;
  private feedBerryVal?: Phaser.GameObjects.Text;
  private feedAccumMs = 0;
  private questArrow?: Phaser.GameObjects.Container; // one-off "open your quest" pointer
  private questArrowShown = false;
  private cookbookDot!: Phaser.GameObjects.Arc;
  private bubble!: CharacterBubble;
  /** The Level-3 finale is running — suppress competing banners. */
  private finaleActive = false;
  /** One-shot Laurah nudges (per session). */
  private hintShown = new Set<string>();
  /** Active recipe mini-tutorial (`chain:from>to`), if one is demonstrating. */
  private recipeHint: string | null = null;
  private recipeHintTimer: Phaser.Time.TimerEvent | null = null;
  private hand!: Phaser.GameObjects.Image;
  private arrow!: Phaser.GameObjects.Image;
  private dialog: Phaser.GameObjects.Container | null = null;
  private endScreen: EndScreen | null = null;
  private lastStep: TutorialStepEvent | null = null;
  private offBus: (() => void)[] = [];
  // Tutorial markers are anchored to BOARD CELLS, not the screen: the board
  // camera pans/zooms over the big map, so each frame we re-project the cell to
  // its current on-screen spot (update()). Otherwise a marker would appear glued
  // to the screen and slide off its target the moment the camera moves.
  private handDrag: { from: TilePos; to: TilePos } | null = null;
  private handProg = { t: 0 }; // 0..1 along from→to, driven by a looping tween
  private handPoint: (() => { x: number; y: number } | null) | null = null;
  private arrowAnchor: (() => { x: number; y: number } | null) | null = null;
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
      onGear: () => this.openResetDialog()
    });
    this.hud.ledgerButton.setDepth(DEPTH_HUD);
    this.hud.gearButton.setDepth(DEPTH_HUD);

    this.tooltip = new Tooltip(this, this.ctx.bus, this.ctx.data.chains);
    this.tooltip.setDepth(DEPTH_PANEL - 5);

    this.ledger = new LedgerPanel(this, this.ctx.bus, this.ctx.systems.order, this.ctx.systems.tasks, this.ctx.state);
    this.ledger.setDepth(DEPTH_PANEL);

    this.shop = new ShopPanel(this, this.ctx.bus, this.ctx.state);
    this.shop.setDepth(DEPTH_PANEL + 8); // above the ledger

    // Milestone "gift" — a round button on the right edge that unfolds the quest
    // field to its left. Sits directly ABOVE the Cookbook (gift top / cookbook
    // bottom, one vertical column). Hidden via HUD_WIDGETS (code kept).
    if (HUD_WIDGETS.milestoneGift) {
      this.milestoneGift = new MilestoneGift(this, this.ctx.bus, GAME_WIDTH - 96, LIVE_GAME_HEIGHT - 470);
      this.milestoneGift.setDepth(DEPTH_HUD);
    }

    // The Emberfont "Spark Well" — a round orb parked in the bottom-left corner.
    // Hidden until the tutorial finishes (the well wakes post-tutorial).
    if (HUD_WIDGETS.sparkWell) {
      this.stokeMeter = new StokeMeter(this, this.ctx.bus, 132, LIVE_GAME_HEIGHT - 300);
      this.stokeMeter.setDepth(DEPTH_HUD);
    }

    // Dragon Duel arena — the modal + a round ✌️ launcher just above the gift.
    if (HUD_WIDGETS.dragonDuel) {
      this.duelPanel = new DuelPanel(this, this.ctx.bus);
      this.duelPanel.setDepth(DEPTH_PANEL + 20);
      this.duelButton = new DuelButton(this, this.ctx.bus, GAME_WIDTH - 96, LIVE_GAME_HEIGHT - 610, () =>
        // Duel throw art is lazy (off boot) — load it, then open the panel.
        ensureTextures(
          this,
          this.ctx,
          ['duel_rock_red', 'duel_paper_red', 'duel_scissors_red', 'duel_rock_green', 'duel_paper_green', 'duel_scissors_green'],
          () => this.duelPanel?.open()
        )
      );
      this.duelButton.setDepth(DEPTH_HUD);
    }

    // The two dragons' duel gauges as a fixed bottom-left HUD — OFF: they now appear
    // per-dragon, floated above the dragon when you tap it (BoardScene.addDragonGauge),
    // and hide when you tap away. Code kept behind the flag.
    if (HUD_WIDGETS.dragonGauges) {
      this.dragonGauges = new DragonGauges(this, this.ctx.bus, 176, LIVE_GAME_HEIGHT - 250);
      this.dragonGauges.setDepth(DEPTH_HUD);
    }

    // Cindra's Cookbook — the recipe/discovery panel + its HUD button (main).
    this.cookbook = new CookbookPanel(this, this.ctx.bus, this.ctx.state, this.ctx.data.chains);
    this.cookbook.setDepth(DEPTH_PANEL + 4);
    this.cookbookButton = this.buildCookbookButton();

    // "⟵ Niveau 1" — appears only after a REAL world switch (the dev's Level-3 world);
    // tapping returns the game to the primary world. Hidden in the base game.
    this.returnButton = this.buildReturnButton();
    this.ctx.bus.on('world:switched', () => this.returnButton?.setVisible(true));
    this.ctx.bus.on('world:return', () => this.returnButton?.setVisible(false));

    // Ambient weather (borealis' snow). Behind every HUD element, in front of the
    // whole board — UIScene renders above BoardScene, so DEPTH_WEATHER only has to
    // beat nothing here and stay under the HUD. It follows the world you are in, and
    // a save reopened in the north brings it back (state:loaded, after hydrate).
    this.weather = new Snowfall(this, DEPTH_WEATHER);
    const weatherFor = (world: string): void => {
      if (WORLD_WEATHER[world] === 'snow') this.weather?.start();
      else this.weather?.stop();
    };
    this.ctx.bus.on('world:switched', ({ toWorld }) => weatherFor(toWorld));
    this.ctx.bus.on('world:return', () => this.weather?.stop());
    this.ctx.bus.on('state:loaded', () => weatherFor(this.ctx.state.activeWorld));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.weather?.destroy());

    // The objective tracker (top-right): main + side quest cards. Populate it now.
    // Built either way — QuestSystem keeps score and the tutorial's sub-quests keep
    // completing — but HIDDEN behind HUD_WIDGETS.questPanel, which is off to match
    // main's barer top bar. Hiding, not removing: one flag brings it back whole.
    this.questPanel = new QuestPanel(this, this.ctx.bus).setDepth(DEPTH_HUD + 4);
    this.questPanel.setVisible(HUD_WIDGETS.questPanel);
    this.ctx.systems.quest.announce();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.questPanel.destroy());

    // A small roothold (lair) map PREVIEW on the LEFT of the primary world — tap to
    // travel back to the lair (to merge sprouts + feed the dragon). Appears only after
    // the first teleport; hidden while you're already in the lair.
    this.lairPreview = this.buildWorldPreview(WORLD_TELEPORT.toWorld, '↩ The Lair', LIVE_GAME_HEIGHT / 2, (img) => (this.lairPreviewImg = img));
    // A second preview below it for BOREALIS — the Golden dragon's aurora world, unlocked
    // once the Golden Egg has burst (Cindra's golden order delivered).
    this.borealisPreview = this.buildWorldPreview(WORLD_TELEPORT_BOREALIS.toWorld, '↩ Borealis', LIVE_GAME_HEIGHT / 2 + 128, (img) => (this.borealisPreviewImg = img));
    const refreshPreviews = (): void => {
      this.refreshLairPreviewVisibility();
      this.refreshBorealisPreviewVisibility();
    };
    this.ctx.bus.on('world:switched', () => {
      this.lairPreview?.setVisible(false);
      this.borealisPreview?.setVisible(false);
    });
    this.ctx.bus.on('world:return', refreshPreviews);
    // Persist across reloads: the previews show in nb2 off SAVED state (tutorialDone /
    // the delivered golden order), not session flags.
    this.ctx.bus.on('state:loaded', refreshPreviews);
    this.ctx.bus.on('game:started', refreshPreviews);
    this.ctx.bus.on('golden:awakened', () => this.refreshBorealisPreviewVisibility()); // the burst opens borealis
    // A "▶ ENTER" tap on a BeyondDemoPanel world card asks to travel into that world.
    this.events.on('beyond:pick_world', (worldName: string) => this.ctx.bus.emit('world:switch', { toWorld: worldName }));

    // Top-centre feed HUD (Energy + Emberberry Bush) — persistent while in the lair.
    this.feedHud = this.buildFeedHud();
    this.ctx.bus.on('world:switched', () => {
      this.feedHud?.setVisible(true);
      this.refreshFeedHud();
    });
    this.ctx.bus.on('world:return', () => this.feedHud?.setVisible(false));
    this.ctx.bus.on('dragon:fed', () => this.refreshFeedHud());
    // The Level-3 lair coach (and any one-off line) speaks through the bubble.
    this.ctx.bus.on('character:say', ({ speaker, text, holdMs }) => this.bubble.say(speaker, text, holdMs));
    // After the dragon is invoked (assembled) → a guiding arrow points at the quest
    // log so the player opens it and sees the objective. Delayed past the teleport.
    this.ctx.bus.on('item:hatched', ({ item }) => {
      if (item.chain === WORLD_TELEPORT.dragonChain && !this.questArrowShown) {
        this.questArrowShown = true;
        this.time.delayedCall(2200, () => this.showQuestArrow());
      }
    });

    this.bubble = new CharacterBubble(this, this.ctx.bus);
    // Sit low AND shifted right — clear of the front-left 3D Crystal it used to
    // cover, over the empty bottom-right margin during tutorial steps.
    this.bubble.setPosition(GAME_WIDTH / 2 + 220, LIVE_GAME_HEIGHT - 150);
    this.bubble.setDepth(DEPTH_TUTORIAL);
    this.bubble.registerUi();

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
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.tooltip.visible) return;
      const bounds = new Phaser.Geom.Rectangle(
        this.tooltip.x - 240,
        this.tooltip.y - 264,
        480,
        304
      );
      if (!bounds.contains(pointer.x, pointer.y)) this.tooltip.close();
    });

    this.subscribe();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.offBus.forEach((off) => off());
      this.offBus = [];
      // Clean up UI-class bus subscriptions (not tracked in offBus above).
      this.hud.teardown();
      this.ledger.teardown();
      this.cookbook.teardown();
    });

    // If resuming from a completed-tutorial save, key pill is permanently hidden.
    if (this.ctx.state.tutorialDone) this.hud.setKeyVisible(false);

    // Tool-authored components (ui-theme.json `custom`) — part of the real UI.
    new CustomUiManager(this).buildAll();

    // Everything is wired: load the save (or start fresh) and roll the tutorial.
    // Async — it restores the world the save is standing in (cells + lattice) before
    // announcing anything. Nothing here waits on it: the scenes are already built and
    // every one of them reacts to `state:loaded` when it lands.
    void this.ctx.beginRun();
  }

  override update(_time: number, delta: number): void {
    // Re-project board-anchored tutorial markers EVERY frame so they stay glued
    // to their cell as the board camera pans/zooms (they live on the UI scene's
    // own fixed camera, so without this they'd appear stuck to the screen).
    if (this.hand.visible) {
      if (this.handDrag) {
        const f = this.cellToScreen(this.handDrag.from.col, this.handDrag.from.row);
        const t = this.cellToScreen(this.handDrag.to.col, this.handDrag.to.row);
        this.hand.setPosition(
          Phaser.Math.Linear(f.x, t.x, this.handProg.t) + 16,
          Phaser.Math.Linear(f.y, t.y, this.handProg.t) - 12
        );
      } else if (this.handPoint) {
        const p = this.handPoint();
        if (p) this.hand.setPosition(p.x, p.y + this.handBob.v);
      }
    }
    if (this.arrow.visible && this.arrowAnchor) {
      const a = this.arrowAnchor();
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
            ? a.y + 18 + this.arrow.displayHeight + this.arrowBob.v
            : a.y - this.arrowLift + this.arrowBob.v
        );
      }
    }

    // Feed HUD energy drains continuously — repaint it a couple times a second while
    // it's on-screen (in the lair). Kept before the regen early-return below.
    if (this.feedHud?.visible) {
      this.feedAccumMs += delta;
      if (this.feedAccumMs >= 450) {
        this.feedAccumMs = 0;
        this.refreshFeedHud();
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
      bus.on('gold:collected', ({ at, coins }) => this.flyCoinToGold(at, coins ?? 1)),
      // A banked berry flies to the feed gauge exactly as Gold flies to the purse.
      bus.on('dragon:stock_changed', ({ at }) => {
        if (at) this.flyBerryToStock(at);
        this.refreshFeedHud();
      }),
      bus.on('ui:shop_requested', ({ currency }) => {
        if (!(this.lastStep?.done || (this.lastStep?.allow.marketplace ?? false))) return;
        this.shop.open(currency);
      }),
      bus.on('order:completed', ({ orderId, rewards }) => {
        this.time.delayedCall(650, () => {
          if (this.ledger.isOpen && this.lastStep?.gateType === 'tap') this.ledger.requestClose();
        });
        this.celebrateOrder(orderId, rewards);
      }),
      bus.on('keeper:leveled', ({ level }) => this.celebrateLevelUp(level)),
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
        // Safety net only — the cookbook_close step has the player close the
        // book themselves; any later step that disallows it just shuts it.
        if (!step.done && !step.allow.cookbook && this.cookbook.isOpen) {
          this.cookbook.requestClose();
        }
      }),
      bus.on('cookbook:discovered', ({ chain, fromTier, resultTier }) => {
        // The demonstrated recipe was performed — retire the guiding hand.
        if (`${chain}:${fromTier}>${resultTier}` === this.recipeHint) this.clearRecipeHint();
        if (!this.ctx.state.tutorialDone || this.cookbook.isOpen) return;
        this.cookbookDot.setVisible(true);
        this.tweens.add({
          targets: this.cookbookButton,
          scale: { from: 1, to: 1.16 },
          duration: 140,
          yoyo: true,
          ease: 'Sine.easeOut'
        });
      }),
      bus.on('game:reset', () => {
        this.endScreen?.destroy();
        this.endScreen = null;
        this.scene.stop(SCENES.board);
        this.scene.start(SCENES.title);
      })
    );
  }

  /** Return button — a round ICON-ONLY back arrow in the BOTTOM-RIGHT corner. Hidden
   *  until a real world switch shows it (`world:switched`); tapping emits
   *  `world:return` (and hides it). */
  private buildReturnButton(): Phaser.GameObjects.Container {
    const c = this.add.container(GAME_WIDTH - 292, LIVE_GAME_HEIGHT - 96).setDepth(DEPTH_HUD + 6).setVisible(false);
    const r = 58;
    const bg = this.add.graphics();
    bg.fillStyle(num(PALETTE.night), 0.92);
    bg.fillCircle(0, 0, r);
    bg.lineStyle(4, num(PALETTE.gold), 0.9);
    bg.strokeCircle(0, 0, r);
    const arrow = this.add
      .text(-2, -2, '⟵', {
        fontFamily: 'Trebuchet MS, Verdana, sans-serif',
        fontSize: '58px',
        fontStyle: 'bold',
        color: PALETTE.goldAccent,
        stroke: PALETTE.night,
        strokeThickness: 5
      })
      .setOrigin(0.5);
    c.add([bg, arrow]);
    // Size-derived (centred) hit area, padded past the drawn circle — a centred
    // custom geom drifts off due to the container displayOrigin (CLAUDE.md gotcha).
    c.setSize((r + 26) * 2, (r + 26) * 2);
    c.setInteractive({ useHandCursor: true });
    c.on('pointerover', () => c.setScale(1.07));
    c.on('pointerout', () => c.setScale(1));
    c.on('pointerup', () => this.ctx.bus.emit('world:return', {}));
    return c;
  }

  /** A small world-map PREVIEW on the LEFT of nb2 — tap to travel to that world. Hidden
   *  until unlocked; its thumbnail uses that world's backdrop texture (loaded on the
   *  first teleport). Shared by the lair (roothold) and borealis previews. */
  private lairPreviewImg?: Phaser.GameObjects.Image;
  private buildWorldPreview(worldName: string, labelText: string, cy: number, setImg: (img: Phaser.GameObjects.Image) => void): Phaser.GameObjects.Container {
    const W = 208;
    const H = 148;
    const c = this.add.container(112, cy).setDepth(DEPTH_HUD + 6).setVisible(false);
    const frame = this.add.graphics();
    frame.fillStyle(num(PALETTE.night), 0.92);
    frame.fillRoundedRect(-W / 2 - 8, -H / 2 - 8, W + 16, H + 58, 18);
    frame.lineStyle(4, num(PALETTE.gold), 0.9);
    frame.strokeRoundedRect(-W / 2 - 8, -H / 2 - 8, W + 16, H + 58, 18);
    const key = editorStore.mapByName(worldName)?.textureKey;
    const img = this.add.image(0, -6, key && this.textures.exists(key) ? key : '__DEFAULT').setDisplaySize(W, H);
    setImg(img);
    const label = this.add
      .text(0, H / 2 + 20, labelText, {
        fontFamily: FONT,
        fontSize: '26px',
        fontStyle: 'bold',
        color: PALETTE.goldAccent,
        stroke: PALETTE.night,
        strokeThickness: 4
      })
      .setOrigin(0.5);
    c.add([frame, img, label]);
    // Size-derived (centred) hit area — a centred custom geom drifts off due to the
    // container displayOrigin (CLAUDE.md gotcha), which made it hard to tap.
    c.setSize(W + 16, H + 58);
    c.setInteractive({ useHandCursor: true });
    // Half-size (user: "faites qu'il rétrécisse de 50%"); hover nudges relative to that.
    const S = 0.5;
    c.setScale(S);
    c.on('pointerover', () => c.setScale(S * 1.05));
    c.on('pointerout', () => c.setScale(S));
    c.on('pointerup', () => this.ctx.bus.emit('world:switch', { toWorld: worldName }));
    return c;
  }

  /** Point a preview thumbnail at its (now-loaded) world backdrop texture. */
  private refreshWorldPreview(worldName: string, img?: Phaser.GameObjects.Image): void {
    const key = editorStore.mapByName(worldName)?.textureKey;
    if (key && this.textures.exists(key) && img) img.setTexture(key).setDisplaySize(208, 148);
  }

  /** Show the lair-travel preview in nb2 whenever the tutorial is DONE (you've reached
   *  the lair) and the lair world exists — and you're not currently in a sub-world.
   *  Driven off the SAVED `tutorialDone`, so it survives a reload. */
  private refreshLairPreviewVisibility(): void {
    const show = this.ctx.state.tutorialDone && !editorStore.activeWorldId && !!editorStore.mapByName(WORLD_TELEPORT.toWorld);
    if (show) this.refreshWorldPreview(WORLD_TELEPORT.toWorld, this.lairPreviewImg);
    this.lairPreview?.setVisible(show);
  }

  /** Show the borealis-travel preview once the Golden Egg has burst (Cindra's golden
   *  order delivered — a SAVED flag, so it survives a reload) and the borealis world
   *  exists, while you're in nb2. */
  private refreshBorealisPreviewVisibility(): void {
    // Unlocked by delivering Cindra's golden order — OR, in a custom world (where that
    // order isn't reachable), by hitting Level 3 (the finale that bursts the egg). Both
    // are SAVED, so the preview survives a reload.
    const unlocked = goldenPromiseKept(this.ctx.state, editorStore.baseHidden);
    const show = unlocked && !editorStore.activeWorldId && !!editorStore.mapByName(WORLD_TELEPORT_BOREALIS.toWorld);
    if (show) this.refreshWorldPreview(WORLD_TELEPORT_BOREALIS.toWorld, this.borealisPreviewImg);
    this.borealisPreview?.setVisible(show);
  }

  /** The persistent top-centre feed HUD: ⚡ Energy (the dragon's fullness — full right
   *  after a feed, drains over DRAGON_FEED.hungerMs, "Feed me!" when low) and
   *  🍓 Emberberry Bush (food in stock). Static frame here; `refreshFeedHud` paints the
   *  live fills. Sits between the top-left pills and the top-right buttons; shown in
   *  the lair (world:switched), hidden on return. */
  private buildFeedHud(): Phaser.GameObjects.Container {
    // Built from the SAME parts as the Warmth / Gold gauges (Hud.pill): the `ui_pill`
    // plate at scale (0.95, 0.9), the icon at x −116, the value in 42px cream at x +20,
    // and the HUD's own 348 px pitch (its pills sit at 224 / 572 / 920). Same row, same
    // baseline — the lair's two readings are gauges of the same instrument, not a
    // second widget with its own dialect.
    const PITCH = 348;
    // Desktop: the same row as Warmth/Gold/Keys, in the gap between the pill row
    // (which ends at 920 + 167 = 1087) and the top-right buttons (~2234). Mobile
    // magnifies the pills ×1.5 and spreads them to a 600 pitch, so that row already
    // reaches 1781 — there the pair drops to a second, centred row instead of
    // colliding with the Keys pill.
    const c = this.add
      .container(IS_MOBILE ? GAME_WIDTH / 2 : 1640, IS_MOBILE ? 360 : 88)
      .setScale(UI_SCALE)
      .setDepth(DEPTH_HUD + 2)
      .setVisible(false);

    const pill = (x: number, icon: string, iconScale: number): Phaser.GameObjects.Text => {
      const bg = this.add.image(x, 0, 'ui_pill').setScale(0.95, 0.9);
      const ic = this.add.image(x - 116, 0, icon).setScale(iconScale);
      const t = this.add
        .text(x + 20, 0, '', { fontFamily: FONT, fontSize: '42px', fontStyle: 'bold', color: PALETTE.cream })
        .setOrigin(0.5);
      c.add([bg, ic, t]);
      return t;
    };
    // The bolt is the Keeper's own Warmth icon — here it reads the DRAGON's fullness,
    // the same quantity the old caption called "Energy". The berry art is 240², so it
    // takes 0.25 to land on the ~60 px the coin icon occupies at its 0.14.
    this.feedEnergyVal = pill(-PITCH / 2, 'ui_icon_bolt', 0.92);
    this.feedBerryVal = pill(PITCH / 2, 'item_strawberry_2', 0.25);
    this.refreshFeedHud();
    return c;
  }

  /** Repaint the feed HUD's two values from live state. */
  private refreshFeedHud(): void {
    if (!this.feedEnergyVal || !this.feedBerryVal) return;
    const now = this.ctx.clock.now();
    const stat = this.ctx.state.dragonStat(WORLD_TELEPORT.dragonChain);
    const eFrac = stat.fedAt === undefined ? 0 : Math.max(0, Math.min(1, 1 - (now - stat.fedAt) / DRAGON_FEED.hungerMs));
    // The LARDER, not a headcount of the board: a bush is banked by tapping it, and
    // feeding spends from here. One number, one place a berry can be.
    const food = this.ctx.state.berryStock;
    const eLow = eFrac <= 0.34;
    // A pill carries a VALUE, not a bar — so hunger speaks through the colour the way
    // the board already does: cream while she is fed, lava when she is asking.
    this.feedEnergyVal.setText(eLow ? 'Feed me!' : `${Math.round(eFrac * 100)}%`);
    this.feedEnergyVal.setColor(eLow ? PALETTE.lavaHighlight : PALETTE.cream);
    this.feedBerryVal.setText(`×${food}`);
  }

  /** A one-off bouncing arrow under the quest-log icon (top-right) — nudges the
   *  player to open the quest after the dragon is invoked. Auto-clears after a few s. */
  private showQuestArrow(): void {
    this.questArrow?.destroy();
    const x = GAME_WIDTH - 236; // under the quest-log toggle
    const y = 210;
    const c = this.add.container(x, y).setDepth(DEPTH_HUD + 10);
    const arrow = this.add
      .text(0, 0, '⬆', { fontFamily: FONT, fontSize: '74px', fontStyle: 'bold', color: '#ffd84d', stroke: PALETTE.night, strokeThickness: 7 })
      .setOrigin(0.5);
    const label = this.add
      .text(0, 58, 'Your quest!', { fontFamily: FONT, fontSize: '30px', fontStyle: 'bold', color: PALETTE.goldAccent, stroke: PALETTE.night, strokeThickness: 5 })
      .setOrigin(0.5);
    c.add([arrow, label]);
    this.questArrow = c;
    this.tweens.add({ targets: c, y: y - 20, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.time.delayedCall(7000, () => {
      this.questArrow?.destroy();
      this.questArrow = undefined;
    });
  }

  /** Emberkeep Cookbook button — sits directly above the Ledger (quest)
   *  button; hidden during the tutorial. The lava dot marks new pages. */
  private buildCookbookButton(): Phaser.GameObjects.Container {
    // Directly BELOW the milestone gift (gift top / cookbook bottom), same
    // right-edge column; magnified on mobile.
    const button = this.add
      .container(GAME_WIDTH - 96, LIVE_GAME_HEIGHT - 330)
      .setScale(UI_SCALE)
      .setDepth(DEPTH_HUD);
    const bg = this.add.image(0, 0, 'ui_btn_round').setScale(1.05);
    const icon = this.textures.exists('ui_icon_cookbook')
      ? this.add.image(0, -6, 'ui_icon_cookbook').setDisplaySize(100, 100)
      : this.add.text(0, -8, '📖', { fontSize: '56px' }).setOrigin(0.5);
    this.cookbookDot = this.add
      .circle(46, -46, 16, num(PALETTE.lava))
      .setStrokeStyle(5, num(PALETTE.cream))
      .setVisible(false);
    button.add([bg, icon, this.cookbookDot]);
    button.setSize(134, 134);
    button.setInteractive({ useHandCursor: true });
    button.on('pointerover', () => button.setScale(UI_SCALE * 1.06));
    button.on('pointerout', () => button.setScale(UI_SCALE));
    button.on('pointerup', () => {
      if (!(this.lastStep?.done ?? this.ctx.state.tutorialDone) && !(this.lastStep?.allow.cookbook ?? false)) return;
      if (this.cookbook.isOpen) {
        this.cookbook.requestClose();
      } else {
        this.cookbookDot.setVisible(false);
        this.cookbook.open();
      }
    });
    button.setVisible(this.ctx.state.tutorialDone);
    return button;
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
  private flyCoinToGold(at: TilePos, count = 1): void {
    const start = this.cellToScreen(at.col, at.row);
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

  /** A banked Emberberry bush arcs from its tile up to the feed gauge — the same
   *  motion as `flyCoinToGold`, because it is the same promise: what you tapped is
   *  really in the larder now. Silent no-op while the feed HUD is hidden (nb2). */
  private flyBerryToStock(at: TilePos): void {
    if (!this.feedBerryVal || !this.feedHud?.visible) return;
    const start = this.cellToScreen(at.col, at.row);
    const end = { x: this.feedHud.x + this.feedBerryVal.x * this.feedHud.scaleX, y: this.feedHud.y };
    const berry = this.add
      .image(start.x, start.y - 30, 'item_strawberry_2')
      .setScale(0.16)
      .setDepth(DEPTH_PANEL + 5);
    const proxy = { t: 0 };
    this.tweens.add({
      targets: proxy,
      t: 1,
      duration: 560,
      ease: 'Sine.easeIn',
      onUpdate: () => {
        const t = proxy.t;
        berry.x = Phaser.Math.Linear(start.x, end.x, t);
        berry.y = Phaser.Math.Linear(start.y - 30, end.y, t) - Math.sin(Math.PI * t) * 120;
        berry.rotation = t * Math.PI;
        berry.setScale(0.16 * (1 - 0.45 * t));
      },
      onComplete: () => {
        berry.destroy();
        // One pulse on arrival, so the number is seen to change.
        const val = this.feedBerryVal;
        if (val) this.tweens.add({ targets: val, scale: 1.35, duration: 110, yoyo: true, ease: 'Sine.easeOut' });
      }
    });
  }

  /** The level-up reward beat: a warm banner — Warmth refilled + Gold. Deferred a
   *  frame: keeper:leveled can fire mid bus-emit (even from an external trigger),
   *  and allocating Text/particles right then can hit a not-yet-ready canvas.
   *  Level 3 takes the FINALE path instead (no banner — the screen holds while
   *  the Golden Egg cracks; DEMO-PLAN §THE FINALE). */
  private celebrateLevelUp(level: number): void {
    if (level >= 3) {
      this.time.delayedCall(0, () => this.runFinaleUi());
      return;
    }
    // The emblem is lazy (off boot) — load it, THEN build the banner (no fallback flash).
    this.time.delayedCall(0, () =>
      ensureTextures(this, this.ctx, ['ui_levelup_emblem'], () => this.buildLevelUpBanner(level))
    );
  }

  /**
   * UIScene's half of the Level-3 finale timeline (BoardScene runs the board
   * half off the same keeper:leveled beat): Cindra speaks — for the first time
   * in the entire demo — then the Chapter One card.
   */
  private runFinaleUi(): void {
    if (this.finaleActive || this.endScreen) return;
    this.finaleActive = true;
    // Kick off the end-screen art now (lazy off boot) so it's resident by the time
    // the Chapter-One card + "Beyond the demo" panel build a few seconds later.
    ensureTextures(
      this,
      this.ctx,
      [
        'trailer_world_ice',
        'trailer_world_crystal',
        'trailer_legend_frost',
        'trailer_legend_crystal',
        'trailer_legend_storm',
        'trailer_legend_tide',
        'trailer_legend_shadow',
        'ui_teaser_terrace',
        'ui_teaser_breed',
        'ui_teaser_flame'
      ],
      () => {}
    );
    this.clearRecipeHint(); // the finale owns the stage — no competing pointers
    this.ledger.requestClose();
    this.shop.requestClose();
    this.cookbook.requestClose();
    this.time.delayedCall(FINALE.cindraAtMs, () => {
      // No egg earned (Order 1 skipped)? Her line reads as PROPHECY — selling
      // the promise the player hasn't collected yet, never claiming an
      // awakening that didn't happen.
      const eggEarned = this.ctx.state.completedOrderIds.includes(GOLDEN_ALTAR.orderId);
      this.bubble.say(
        'cindra',
        eggEarned ? this.ctx.data.dialogue.finaleCindra : this.ctx.data.dialogue.finaleCindraProphecy,
        FINALE.cindraHoldMs
      );
    });
    this.time.delayedCall(FINALE.cardAtMs, () => {
      this.finaleActive = false;
      if (this.endScreen) return;
      const showCard = (): void => {
        if (this.endScreen || !this.scene.isActive()) return;
        this.endScreen = new EndScreen(this, 'chapter');
        this.add.existing(this.endScreen);
        this.endScreen.setDepth(DEPTH_DIALOG + 50);
        this.endScreen.once(Phaser.GameObjects.Events.DESTROY, () => {
          this.endScreen = null;
        });
      };
      // "Beyond the demo" is the ending's HEADLINE — it leads, unprompted, so
      // no session finishes without seeing it; the Chapter One card (its home,
      // which keeps the reopen button) follows when the player closes it.
      // Without the trailer art there is nothing to headline — straight to card.
      if (this.textures.exists('trailer_world_ice') || this.textures.exists('trailer_legend_frost')) {
        const panel = new BeyondDemoPanel(this);
        panel.setDepth(DEPTH_DIALOG + 50);
        panel.once(Phaser.GameObjects.Events.DESTROY, showCard);
      } else {
        showCard();
      }
    });
  }

  /** Order completion — the demo's primary reward beat — now celebrates at
   *  level-up parity: banner + spark burst + a rotating Cindra quote stamped on
   *  the card (her VOICE stays reserved for the finale). The golden order gets
   *  its own beats: a dedicated arrival quote, and — delivered after Level 3 —
   *  Cindra SPEAKS over the late awakening playing out at the altar. */
  private celebrateOrder(orderId: string, rewards: { coins: number; keys: number; xp?: number }): void {
    if (this.finaleActive || !this.ctx.state.tutorialDone) return;
    const golden = orderId === GOLDEN_ALTAR.orderId;
    this.time.delayedCall(0, () => {
      const quotes = this.ctx.data.dialogue.orderComplete;
      const quote = golden
        ? this.ctx.data.dialogue.goldenArrival
        : quotes[(this.ctx.state.completedOrderIds.length - 1) % quotes.length] ?? '';
      const parts: string[] = [];
      if (rewards.coins) parts.push(`◎ +${rewards.coins} Gold`);
      if (rewards.xp) parts.push(`✦ +${rewards.xp} XP`);
      this.buildCelebrationBanner('ORDER COMPLETE', parts.join('    '), quote);
    });
    if (golden && this.ctx.state.level >= 3) {
      // BoardScene's lateGoldenAwakening cracks the egg at ~2.4s — her line
      // lands right as the Elder rises.
      this.time.delayedCall(3200, () => {
        this.bubble.say('cindra', this.ctx.data.dialogue.lateAwakening, 4600);
      });
    }
  }

  private celebrateTasksComplete(): void {
    this.time.delayedCall(0, () => {
      this.buildCelebrationBanner('EVERY TASK COMPLETE', '◎ Gold  ⚡ Warmth — a golden thank-you', '');
      this.bubble.say('cindra', this.ctx.data.dialogue.tasksComplete, 5200);
    });
  }

  /** Shared warm banner (order complete / tasks complete) — the level-up
   *  banner's language, one tier smaller. */
  private buildCelebrationBanner(title: string, rewardLine: string, quote: string): void {
    const cx = GAME_WIDTH / 2;
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
        fontFamily: FONT, fontSize: '48px', fontStyle: 'bold', color: PALETTE.textBrown
      })
      .setOrigin(0.5)
      .setStroke(PALETTE.cream, 5);
    const sub = this.add
      .text(0, -height / 2 + 122, rewardLine, {
        fontFamily: FONT, fontSize: '32px', fontStyle: 'bold', color: PALETTE.goldShade
      })
      .setOrigin(0.5);
    c.add([g, ribbon, sub]);
    if (quote) {
      c.add(
        this.add
          .text(0, -height / 2 + 182, quote, {
            fontFamily: FONT, fontSize: '26px', fontStyle: 'italic', color: '#8A6248',
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
      .setDisplaySize(GAME_WIDTH, LIVE_GAME_HEIGHT)
      .setAlpha(ATMOSPHERE.vignette.alpha)
      .setDepth(DEPTH_HUD - 1); // over the board render, under every UI element
  }

  /** One-shot Laurah nudge (post-tutorial guidance without a second tutorial). */
  private showHint(key: keyof GameContext['data']['dialogue']['hints'], holdMs = 5200): void {
    if (!this.ctx.state.tutorialDone || this.finaleActive || this.hintShown.has(key)) return;
    this.hintShown.add(key);
    this.bubble.say('eleanor', this.ctx.data.dialogue.hints[key], holdMs);
  }

  /**
   * Contextual recipe mini-tutorials: the moment the board first holds the TWO
   * pieces of a 2→1 recipe (two Red Dragons → Adult, two Houses → Manor),
   * Laurah teases the merge and the guiding gauntlet demonstrates the drag
   * between the actual pieces. Purely presentational — nothing is gated, no
   * input is blocked; it clears itself on discovery, timeout, or the finale.
   */
  private checkRecipeHints(): void {
    if (!this.ctx.state.tutorialDone || this.finaleActive || this.recipeHint) return;
    const candidates = [
      { key: 'twoDragons', recipe: 'ember_dragon:3>4', chain: 'ember_dragon', tier: 3 },
      { key: 'twoHouses', recipe: 'lumber:2>3', chain: 'lumber', tier: 2 }
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
   *  pair's CURRENT cells, or retire it if the pair no longer exists. */
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
    this.placeHand({
      from: { col: pieces[1]!.col, row: pieces[1]!.row },
      to: { col: pieces[0]!.col, row: pieces[0]!.row }
    });
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
    const cx = GAME_WIDTH / 2;
    const cy = LIVE_GAME_HEIGHT * 0.34;
    const c = this.add.container(cx, cy).setDepth(DEPTH_DIALOG - 5).setAlpha(0);
    const coins = LEVELUP_REWARD.coinsBase + level * LEVELUP_REWARD.coinsPerLevel;

    if (this.textures.exists('ui_levelup_emblem')) {
      // Winged-medal emblem (honeur.png): the level number sits in the medal, the
      // prize in the "Prix:" banner baked into the art.
      const emblem = this.add.image(0, 0, 'ui_levelup_emblem').setScale(0.62);
      const levelNum = this.add
        .text(0, -12, `${level}`, {
          fontFamily: FONT, fontSize: '150px', fontStyle: 'bold', color: PALETTE.textBrown
        })
        .setOrigin(0.5)
        .setStroke('#fff7e0', 8);
      // Sit the reward ON the baked "Price:" ribbon, right after the word (its
      // right edge is ~x62,y208 in this container at the emblem's 0.62 scale) —
      // reads inline "Price: 🪙55 ⚡", not stacked below. (Level-up pays Gold +
      // a full Warmth refill, so ⚡ is a refill icon, not a fixed number.)
      const prize = this.add
        .text(82, 208, `🪙 ${coins}  ⚡`, {
          fontFamily: FONT, fontSize: '38px', fontStyle: 'bold', color: '#ffffff'
        })
        .setOrigin(0, 0.5)
        .setStroke(PALETTE.plumShade, 6);
      c.add([emblem, levelNum, prize]);
    } else {
      // Fallback (emblem art missing): the plain gold banner.
      const g = this.add.graphics();
      g.fillStyle(num(PALETTE.gold), 1);
      g.fillRoundedRect(-360, -96, 720, 192, 30);
      g.fillStyle(0xfffdf6, 1);
      g.fillRoundedRect(-348, -84, 696, 168, 24);
      const ribbon = this.add
        .text(0, -46, `KEEPER LEVEL ${level}`, {
          fontFamily: FONT, fontSize: '60px', fontStyle: 'bold', color: PALETTE.textBrown
        })
        .setOrigin(0.5)
        .setStroke(PALETTE.cream, 6);
      const sub = this.add
        .text(0, 34, `⚡ Warmth refilled    🪙 ${coins}`, {
          fontFamily: FONT, fontSize: '34px', fontStyle: 'bold', color: PALETTE.goldShade
        })
        .setOrigin(0.5);
      c.add([g, ribbon, sub]);
    }
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
    // (Level 3 never reaches here — celebrateLevelUp routes it to the finale.)
  }

  private onTutorialStep(step: TutorialStepEvent): void {
    this.lastStep = step;
    this.hud.setLedgerEnabled(step.done || step.allow.ledger);
    this.ledger.setDeliverAllowed(step.done || step.allow.deliver);
    // Show key pill only during the key_unlock step; hide it otherwise.
    this.hud.setKeyVisible(!step.done && step.id === 'key_unlock');
    // A step that no longer involves the Ledger closes it, so its dim never
    // sits over the board and swallows the next tap (e.g. the post-deliver fog).
    if (!step.done && !step.allow.ledger && this.ledger.isOpen) this.ledger.requestClose();
    if (step.done) {
      this.bubble.hide();
      this.clearMarkers();
      return;
    }
    this.bubble.show(step);
    this.applyMarkers(step);
  }

  private maybeShowTooltip(itemId: number): void {
    const item = this.ctx.state.items.get(itemId);
    if (!item || item.kind !== 'item') return;
    if (item.readyAt !== undefined) return; // generators harvest instead
    // Story items (Golden Egg/Elder) are unsellable — no tooltip; the board
    // plays their own tap beat instead.
    const tier = this.ctx.data.chains.chains
      .find((c) => c.id === item.chain)
      ?.tiers.find((t) => t.tier === item.tier);
    if (tier?.sellable === false) return;
    if (!this.ctx.state.tutorialDone && !(this.lastStep?.allow.sell ?? false)) return;
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
  private cellToScreen(col: number, row: number): { x: number; y: number } {
    const w = gridToWorld(col, row);
    return this.worldToScreen(w.x, w.y);
  }

  private worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const view = this.scene.get(SCENES.board)?.cameras?.main?.worldView;
    if (view && view.width > 0 && view.height > 0) {
      return {
        x: ((wx - view.x) / view.width) * GAME_WIDTH,
        y: ((wy - view.y) / view.height) * LIVE_GAME_HEIGHT
      };
    }
    return { x: wx, y: wy };
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

  private applyMarkers(step: TutorialStepEvent): void {
    this.clearMarkers();
    // The gauntlet demonstrates ACTIONS (drags); the arrow points at static
    // targets. They are mutually exclusive — a step defining both shows only
    // the hand (data should define exactly one).
    if (step.hand) this.placeHand(step.hand);
    else if (step.arrow) this.placeArrow(step.arrow);
  }

  private uiTarget(ref: { ui: 'ledger' | 'deliver' | 'marketplace' | 'cookbook' | 'cookbook_close' } | { fogRegion: string }): { x: number; y: number } | null {
    if ('ui' in ref) {
      // The ⚡+ button until the Emporium opens, then the FREE! card inside it —
      // handPoint/arrowAnchor re-evaluate each frame, so the marker follows live.
      if (ref.ui === 'marketplace') return this.shop.getFreeButtonPos() ?? this.hud.getEnergyPlusPos();
      if (ref.ui === 'ledger') return this.hud.getLedgerPos();
      if (ref.ui === 'cookbook') return { x: this.cookbookButton.x, y: this.cookbookButton.y };
      if (ref.ui === 'cookbook_close') return this.cookbook.isOpen ? this.cookbook.getClosePos() : null;
      return this.ledger.isOpen ? this.ledger.getDeliverPos() : null;
    }
    const region = this.ctx.data.map.regions.find((r) => r.id === ref.fogRegion);
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

  private placeHand(hand: ResolvedHand): void {
    if ('from' in hand) {
      // Drag gesture: store the from/to CELLS and drive a 0→1 progress proxy;
      // update() lerps the live re-projected cell positions so the hand follows
      // the camera. (Alpha still fades on the hand itself; that's screen-space.)
      this.handDrag = { from: hand.from, to: hand.to };
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
          duration: 240,
          ease: 'Back.easeOut',
          onComplete: () => {
            this.tweens.add({ targets: this.hand, angle: 4, duration: 950, ease: 'Sine.easeInOut' });
            this.tweens.add({
              targets: this.handProg,
              t: 1,
              duration: 950,
              ease: 'Sine.easeInOut',
              onComplete: () => {
                // Release: tiny overshoot pop as the item "drops".
                this.tweens.add({ targets: this.hand, angle: 0, scale: base * 1.05, duration: 200, ease: 'Back.easeOut' });
                this.tweens.add({
                  targets: this.hand,
                  alpha: 0,
                  duration: 260,
                  delay: 160,
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
      loopDelay: 140,
      tweens: [
        { v: 14, duration: 260, ease: 'Quad.easeIn' },
        { v: 0, duration: 430, ease: 'Back.easeOut' }
      ]
    });
    this.markerChain({
      targets: this.hand,
      loop: -1,
      loopDelay: 140,
      tweens: [
        { scale: base * 0.9, duration: 260, ease: 'Quad.easeIn' },
        { scale: base, duration: 430, ease: 'Back.easeOut' }
      ]
    });
  }

  private placeArrow(arrow: ResolvedArrow): void {
    if ('tile' in arrow) {
      this.arrowAnchor = () => this.cellToScreen(arrow.tile.col, arrow.tile.row);
      this.arrowLift = 156;
    } else {
      this.arrowAnchor = () => this.uiTarget(arrow);
      this.arrowLift = 'ui' in arrow ? 116 : 192;
    }
    const target = this.arrowAnchor();
    if (!target) {
      this.arrowAnchor = null;
      return;
    }
    this.arrow.setVisible(true);
    this.arrow.setAlpha(1);
    this.arrow.setPosition(target.x, target.y - this.arrowLift);
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

  private openResetDialog(): void {
    if (this.dialog) return;
    const container = this.add.container(GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2).setDepth(DEPTH_DIALOG);
    const dim = this.add
      .rectangle(0, 0, GAME_WIDTH, LIVE_GAME_HEIGHT, num(PALETTE.night), 0.55)
      .setInteractive();
    const panel = this.add.graphics();
    panel.fillStyle(num(PALETTE.night), 0.25);
    panel.fillRoundedRect(-450, -310 + 16, 900, 620, 52);
    panel.fillStyle(num(PALETTE.cream), 1);
    panel.fillRoundedRect(-450, -310, 900, 620, 52);
    panel.lineStyle(8, num(PALETTE.lava), 1);
    panel.strokeRoundedRect(-450, -310, 900, 620, 52);
    const title = this.add
      .text(0, -244, 'Settings', {
        fontFamily: FONT,
        fontSize: '54px',
        fontStyle: 'bold',
        color: PALETTE.textBrown
      })
      .setOrigin(0.5);

    // Background-music toggle (persists; the AudioManager applies it via the bus).
    const musicLabel = (): string => (getMusicMuted() ? 'Music: Off' : 'Music: On');
    const musicBtn = this.add.container(-206, -148);
    const musicBg = this.add
      .image(0, 0, getMusicMuted() ? 'ui_btn_play' : 'ui_btn_green')
      .setScale(0.72, 0.8);
    const musicText = this.add
      .text(0, -10, musicLabel(), {
        fontFamily: FONT,
        fontSize: '34px',
        fontStyle: 'bold',
        color: '#FFFFFF'
      })
      .setOrigin(0.5)
      .setShadow(0, 4, 'rgba(36,27,34,0.5)', 4);
    musicBtn.add([musicBg, musicText]);
    musicBtn.setSize(380 * 0.72, 118).setInteractive({ useHandCursor: true });
    musicBtn.on('pointerup', () => {
      const muted = !getMusicMuted();
      setMusicMuted(muted);
      this.ctx.bus.emit('audio:set_music_muted', { muted });
      musicText.setText(musicLabel());
      musicBg.setTexture(muted ? 'ui_btn_play' : 'ui_btn_green');
    });

    const divider = this.add.rectangle(0, -76, 760, 3, num(PALETTE.lava), 0.22);
    const resetTitle = this.add
      .text(0, -22, 'Reset Cinder Hollow?', {
        fontFamily: FONT,
        fontSize: '40px',
        fontStyle: 'bold',
        color: PALETTE.textBrown
      })
      .setOrigin(0.5);
    const body = this.add
      .text(0, 48, 'The ash will settle back over everything\nyou have rekindled. This cannot be undone.', {
        fontFamily: FONT,
        fontSize: '30px',
        color: '#8A6248',
        align: 'center',
        lineSpacing: 10
      })
      .setOrigin(0.5);

    const makeButton = (
      x: number,
      label: string,
      texture: string,
      scaleX: number,
      onTap: () => void
    ): Phaser.GameObjects.Container => {
      const button = this.add.container(x, 190);
      const bg = this.add.image(0, 0, texture).setScale(scaleX, 0.78);
      const text = this.add
        .text(0, -10, label, {
          fontFamily: FONT,
          fontSize: '42px',
          fontStyle: 'bold',
          color: '#FFFFFF'
        })
        .setOrigin(0.5)
        .setShadow(0, 4, 'rgba(36,27,34,0.5)', 4);
      button.add([bg, text]);
      button.setSize(380 * scaleX, 112);
      button.setInteractive({ useHandCursor: true });
      button.on('pointerup', onTap);
      return button;
    };

    const resetButton = makeButton(-210, 'Reset', 'ui_btn_play', 0.72, () => {
      this.closeResetDialog();
      this.ctx.bus.emit('game:reset_requested', {});
    });
    const keepButton = makeButton(210, 'Keep Playing', 'ui_btn_green', 0.95, () =>
      this.closeResetDialog()
    );

    // Map Editor (dev level tool) — shares the top row with the Music toggle.
    const editorButton = makeButton(206, 'Editor', 'ui_btn_play', 0.72, () => {
      this.closeResetDialog();
      this.ctx.bus.emit('editor:open', {});
    });
    editorButton.setY(-148);

    container.add([dim, panel, title, musicBtn, editorButton, divider, resetTitle, body, resetButton, keepButton]);
    container.setAlpha(0);
    container.setScale(0.94);
    this.tweens.add({ targets: container, alpha: 1, scale: 1, duration: 170, ease: 'Back.easeOut' });
    this.dialog = container;
  }

  private closeResetDialog(): void {
    this.dialog?.destroy();
    this.dialog = null;
  }
}
