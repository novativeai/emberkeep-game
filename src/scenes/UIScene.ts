import Phaser from 'phaser';
import type { GameContext } from '../core/Context';
import {
  ATMOSPHERE,
  ENERGY_REGEN_MS,
  FINALE,
  FINALE_ENDS_MS,
  GAME_WIDTH,
  GOLDEN_ALTAR,
  GOLDEN_TREMBLE_PROGRESS,
  HUD_COLUMN_X,
  hudColumnY,
  LIVE_GAME_HEIGHT,
  num,
  PALETTE,
  OPENING_HOLD_MS,
  SCENES,
  TILE_W,
  TIMINGS,
  UI_SCALE,
  WELCOME_BACK_MIN_MS
} from '../core/Constants';
import { FONT } from '../art/design';
import { iapBridge } from '../core/iapBridge';
import { gridToWorld } from '../core/iso';
import type { EventMap, ResolvedArrow, ResolvedHand, SpeakerId, TilePos, TutorialStepEvent } from '../core/types';
import type { BoardScene } from './BoardScene';
import { CharacterBubble } from '../entities/CharacterBubble';
import { BagPanel } from '../ui/BagPanel';
import { CommissionPanel } from '../ui/CommissionPanel';
import { CauldronPanel } from '../ui/CauldronPanel';
import { StorePanel } from '../ui/StorePanel';
import { CookbookPanel } from '../ui/CookbookPanel';
import { Hud } from '../ui/Hud';
import { NamePanel } from '../ui/NamePanel';
import { TravelPrompt } from '../ui/TravelPrompt';
import { LedgerPanel } from '../ui/LedgerPanel';
import { QuestTracker } from '../ui/QuestTracker';
import { StatusPanel } from '../ui/StatusPanel';
import { ShopPanel } from '../ui/ShopPanel';
import { renderScale } from '../core/render-scale';
import { GRAPHICS_QUALITIES } from '../core/graphics';
import { GRAPHICS_EVENT, GRAPHICS_PROFILES, graphics } from '../core/graphicsState';
import { getMusicMuted, setMusicMuted } from '../audio/musicPref';
import { CustomUiManager } from '../ui/customUi';
import { uiRegistry } from '../ui/theme';
import { DragonReveal } from '../ui/DragonReveal';
import { Tooltip } from '../ui/Tooltip';

const DEPTH_HUD = 10;
const DEPTH_PANEL = 60;
const DEPTH_TUTORIAL = 100;
const DEPTH_DIALOG = 200;
// On-screen heights (2560-space) for the tutorial pointer/arrow. The real art
// loads at its native pixel size, so each is scaled to these.
const HAND_MARKER_H = 172;
const ARROW_MARKER_H = 148;

/**
 * Runs in parallel above BoardScene: HUD, tooltip, Eleanor's Ledger, the
 * tutorial presentation layer (dialogue bubble, guiding hand, bouncing
 * arrow) and the reset-confirm dialog. Pure subscriber + intent emitter.
 */
export class UIScene extends Phaser.Scene {
  private ctx!: GameContext;
  private regenAccum = 0;
  private hud!: Hud;
  private reveal!: DragonReveal;
  private tooltip!: Tooltip;
  private ledger!: LedgerPanel;
  private shop!: ShopPanel;
  private bag!: BagPanel;
  /** "What shall it make?" — a finished House's one-time commission. */
  private commission!: CommissionPanel;
  private store!: StorePanel;
  private cauldron!: CauldronPanel;
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
  private travelVeil?: Phaser.GameObjects.Container;
  private lastStep: TutorialStepEvent | null = null;
  /** Heart milestones banked while the tutorial owns the bubble (see playRegardBeats). */
  private pendingHearts: Array<{ characterId: string; hearts: number }> = [];
  /** Beats held because their speaker does not stand in the world the player is
   *  in (see `speakHere`). Flushed on `world:switched`. */
  private pendingAway: Array<{ speaker: SpeakerId; lines: string[] }> = [];
  /** The opening's held silence is a one-shot: only the very first step of a
   *  run waits, and a resumed save never re-holds. */
  private openingHeld = false;
  private offBus: (() => void)[] = [];
  // Tutorial markers are anchored to BOARD CELLS, not the screen: the board
  // camera pans/zooms over the big map, so each frame we re-project the cell to
  // its current on-screen spot (update()). Otherwise a marker would appear glued
  // to the screen and slide off its target the moment the camera moves.
  private handDrag: { from: TilePos; to: TilePos } | null = null;
  private handProg = { t: 0 }; // 0..1 along from→to, driven by a looping tween
  private handPoint: (() => { x: number; y: number } | null) | null = null;
  /** `height` = how far the target extends below the anchor point (0 for a
   *  button, a full standee for a world character) — see update(). */
  private arrowAnchor: (() => { x: number; y: number; height?: number } | null) | null = null;
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
    this.hud.setBagCount(this.ctx.state.bag.length);
    this.hud.gearButton.setDepth(DEPTH_HUD);

    this.tooltip = new Tooltip(this, this.ctx.data.chains);
    this.tooltip.setDepth(DEPTH_PANEL - 5);

    this.ledger = new LedgerPanel(this, this.ctx.bus, this.ctx.systems.order, this.ctx.systems.tasks, this.ctx.state);
    this.ledger.setDepth(DEPTH_PANEL);

    this.bag = new BagPanel(this, this.ctx.bus, this.ctx.state, this.ctx.data.chains);
    // Opens on nest:hatched and cannot be dismissed — the dragon is waiting.
    this.naming = new NamePanel(this, this.ctx.bus);
    this.naming.resolveChain = (itemId) => this.ctx.state.items.get(itemId)?.chain;
    void this.naming;
    // Answers `ui:travel_requested` from a portal tap; owns its own bus release.
    new TravelPrompt(this, this.ctx.bus);
    this.bag.setDepth(DEPTH_PANEL + 6);
    this.commission = new CommissionPanel(this, this.ctx.bus, this.ctx.state, this.ctx.data.chains);
    // Above the Bag: it is asked ABOUT the bag's contents, and the two are never
    // usefully open at once.
    this.commission.setDepth(DEPTH_PANEL + 9);
    this.shop = new ShopPanel(this, this.ctx.bus, this.ctx.state);
    this.shop.setDepth(DEPTH_PANEL + 8); // above the ledger

    this.store = new StorePanel(this, this.ctx.bus, this.ctx.state, this.ctx.data.store, this.ctx);
    this.store.setDepth(DEPTH_PANEL + 7);

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
    this.reveal = new DragonReveal(this, this.ctx.bus);

    this.bubble = new CharacterBubble(this, this.ctx.bus);
    // Sit low AND shifted right — clear of the front-left 3D Crystal it used to
    // cover, over the empty bottom-right margin during tutorial steps.
    this.bubble.setPosition(GAME_WIDTH / 2 + 220, LIVE_GAME_HEIGHT - 150);
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
    // and the bubble paints it in lava. Seeded from state so a resumed save
    // speaks her name too, then kept live off the naming fact.
    const named = this.ctx.systems.dragons.firstNamed();
    if (named) this.bubble.setToken('dragon', named.name);
    this.offBus.push(
      this.ctx.bus.on('dragon:named', ({ name }) => this.bubble.setToken('dragon', name))
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
      this.shop.teardown();
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
      bus.on('dragon:revealed', (card) => this.reveal.play(card)),
      bus.on('story:chapter', ({ chapter }) => this.playChapterBeats(chapter)),
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
      bus.on('gold:collected', ({ at, coins }) => this.flyCoinToGold(at, coins ?? 1)),
      bus.on('bag:stored', ({ chain, tier, at }) => this.flyItemToBag(chain, tier, at)),
      bus.on('bag:changed', ({ used }) => this.hud.setBagCount(used)),
      bus.on('bag:store_failed', ({ reason }) =>
        this.floatWarning(reason === 'full' ? 'Bag is full!' : 'No room on the board!')
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
        if (!(this.lastStep?.done || (this.lastStep?.allow.marketplace ?? false))) return;
        this.shop.open(currency);
      }),
      // Real-money packs: strictly post-tutorial (the buy_energy beat allows
      // the Emporium, never a checkout — its gate is the free Spark).
      bus.on('ui:iap_buy_requested', ({ packId }) => {
        if (!this.lastStep?.done) return;
        this.openIapConfirmDialog(packId);
      }),
      bus.on('iap:completed', (grant) => this.celebratePurchase(grant)),
      bus.on('iap:failed', ({ reason }) => this.onIapFailed(reason)),
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
        if (questId === GOLDEN_ALTAR.awakenQuestId) this.time.delayedCall(0, () => this.runFinaleUi());
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
        this.hud.storeButton.setVisible(step.done && this.shopUnlocked());
        // Safety net only — the cookbook_close step has the player close the
        // book themselves; any later step that disallows it just shuts it.
        if (!step.done && !step.allow.cookbook && this.cookbook.isOpen) {
          this.cookbook.requestClose();
        }
      }),
      bus.on('tutorial:nudge', () => this.nudgeMarkers()),
      // The popup offers Gold AND Warmth; the tutorial only ever demonstrated
      // Warmth on the House, so name the cheaper option the first time it shows.
      bus.on('ui:skip_offered', () => this.showHint('goldSkip')),
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
        this.scene.stop(SCENES.board);
        this.scene.start(SCENES.title);
      }),
      // Travel: the veil goes up when the world flips and comes down when the
      // new board exists. Between those two the destination's backdrop is coming
      // over the network — without this the player taps a door and the game
      // simply does nothing for a second or two.
      bus.on('world:switched', ({ to }) => this.showTravelVeil(to)),
      bus.on('world:ready', () => this.hideTravelVeil()),
      // The Roothold house is the Emporium's storefront — its tap opens the
      // same panel the (later-unlocked) HUD button does.
      bus.on('ui:emporium_requested', () => this.store.open()),
      bus.on('world:switched', ({ to }) => this.maybeStartTour(to)),
      // …and anything a speaker could not say from the world we just left. On
      // `world:ready`, not `world:switched`: the board has to exist under the
      // bubble, or she talks over the travelling curtain.
      bus.on('world:ready', () => this.flushAwayBeats())
    );
  }

  /**
   * The travelling curtain: a scrim over the board while the destination loads.
   *
   * It lives in UIScene rather than on the board because the board is exactly
   * what is being torn down and rebuilt — a veil parented to it would be
   * destroyed at the moment it is needed most. UIScene's camera is fixed and its
   * scene never restarts, so the curtain is the one thing on screen that spans
   * the whole journey.
   */
  private showTravelVeil(worldId: string): void {
    this.hideTravelVeil();
    const name = this.ctx.state.worlds.get(worldId)?.name ?? worldId;
    const c = this.add.container(0, 0).setDepth(DEPTH_DIALOG + 50);
    // Interactive so a tap during the load cannot reach the board underneath —
    // the board it would reach is the one being replaced.
    const scrim = this.add
      .rectangle(0, 0, GAME_WIDTH, LIVE_GAME_HEIGHT, num(PALETTE.night), 0.97)
      .setOrigin(0)
      .setInteractive();
    const label = this.add
      .text(GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2 - 30, name, {
        fontFamily: FONT.ui,
        fontSize: '64px',
        fontStyle: 'bold',
        color: PALETTE.cream
      })
      .setOrigin(0.5);
    c.add([scrim, label]);
    // Three breathing embers rather than a progress bar: the loader reports
    // bytes, not the scene rebuild that follows it, so a bar would fill and then
    // sit at full while the board was still being built — worse than no bar.
    // Drawn as circles, not `fx_glow`: that texture is a wide soft falloff (the
    // sun haze uses it at scale 7) and three of them this close smear into one
    // blob rather than reading as a count.
    for (let i = 0; i < 3; i++) {
      const dot = this.add
        .circle(GAME_WIDTH / 2 + (i - 1) * 74, LIVE_GAME_HEIGHT / 2 + 74, 13, num(PALETTE.goldAccent))
        .setAlpha(0.22);
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
      c.add(dot);
    }
    c.setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, duration: 180, ease: 'Sine.easeOut' });
    this.travelVeil = c;
  }

  private hideTravelVeil(): void {
    const veil = this.travelVeil;
    if (!veil) return;
    this.travelVeil = undefined;
    // Held a beat past `world:ready`: the board camera runs its own 320ms fade-in
    // on create, and lifting the curtain first would show the new world arriving
    // out of black instead of simply being there.
    this.tweens.add({
      targets: veil,
      alpha: 0,
      delay: 200,
      duration: 260,
      ease: 'Sine.easeIn',
      onComplete: () => veil.destroy()
    });
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
    // Plate, icon and dot all at the column's shared 1.5 — this button used to be
    // built at 1.05 and read as a runt beside the Bag and the Ledger.
    const bg = this.add.image(0, 0, 'ui_btn_round').setScale(1.5);
    const icon = this.textures.exists('ui_icon_cookbook')
      ? this.add.image(0, -12, 'ui_icon_cookbook').setDisplaySize(125, 125)
      : this.add.text(0, -12, '📖', { fontSize: '76px' }).setOrigin(0.5);
    this.cookbookDot = this.add
      .circle(68, -68, 18, num(PALETTE.lava))
      .setStrokeStyle(5, num(PALETTE.cream))
      .setVisible(false);
    button.add([bg, icon, this.cookbookDot]);
    button.setSize(192, 192);
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
      .text(GAME_WIDTH / 2, LIVE_GAME_HEIGHT * 0.62, text, {
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
  private runFinaleUi(): void {
    if (this.finaleActive) return;
    this.finaleActive = true;
    this.clearRecipeHint(); // the finale owns the stage — no competing pointers
    this.ledger.requestClose();
    this.shop.requestClose();
    this.cookbook.requestClose();
    this.time.delayedCall(FINALE.elderAtMs, () => {
      // No egg earned (Order 1 skipped)? Her line reads as PROPHECY — selling
      // the promise the player hasn't collected yet, never claiming an
      // awakening that didn't happen.
      const eggEarned = this.ctx.state.completedOrderIds.includes(GOLDEN_ALTAR.orderId);
      this.bubble.say(
        'golden_elder',
        eggEarned ? this.ctx.data.dialogue.finaleElder : this.ctx.data.dialogue.finaleElderProphecy,
        FINALE.elderHoldMs
      );
    });
    // The stage is released when her line does, not when a panel is dismissed.
    this.time.delayedCall(FINALE_ENDS_MS, () => {
      this.finaleActive = false;
      // The Gate ceremony rides the finale's tail: Eleanor speaks the arch
      // open (tap-advanced, STORY_BEAT_HOLD_MS backstop — it cannot strand),
      // and the last line blooming into `gate:opened` is what turns the
      // portal FX on and the door live. A reload after the finale skips the
      // ceremony: BoardScene derives the open Gate from the q:done latch.
      const beats = this.ctx.data.dialogue.gateOpens;
      if (beats?.lines.length) {
        this.time.delayedCall(TIMINGS.chapterBeatDelay, () => {
          this.bubble.sequence(beats.speaker as SpeakerId, beats.lines, () =>
            this.ctx.bus.emit('gate:opened', {})
          );
        });
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
      // BoardScene's lateGoldenAwakening cracks the egg at ~2.4s — her line
      // lands right as the Elder rises.
      this.time.delayedCall(3200, () => {
        this.bubble.say('golden_elder', this.ctx.data.dialogue.lateAwakening, 4600);
      });
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
      .setDisplaySize(GAME_WIDTH, LIVE_GAME_HEIGHT)
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

  /** The 3 sections with the pointer moving between them, then the ✕. The
   *  arrow rides the LINE (sequence onLine), and the panel shows the section
   *  she is naming, so eye, pointer and shelf agree. */
  private runShopWalkthrough(t: { sections: string[]; close: string; outro: string }): void {
    this.bubble.sequence('eleanor', [...t.sections, t.close], undefined, (i) => {
      if (i < t.sections.length) {
        this.store.showSection(i);
        this.pointUi(this.store.getTabPos(i));
      } else {
        this.pointUi(this.store.getClosePos());
      }
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

  private uiTarget(
    ref:
      | { ui: 'ledger' | 'deliver' | 'marketplace' | 'cookbook' | 'cookbook_close' | 'bag' | 'bag_give' | 'status' | 'commission' }
      | { fogRegion: string }
      | { character: string }
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
      // A character anchor is already the top of her head, so it wants the
      // smallest gap of the three; a fog region resolves to the middle of a
      // whole strip and wants the largest.
      this.arrowLift = 'character' in arrow ? 84 : 'ui' in arrow ? 116 : 192;
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
    panel.fillRoundedRect(-450, -368 + 16, 900, 736, 52);
    panel.fillStyle(num(PALETTE.cream), 1);
    panel.fillRoundedRect(-450, -368, 900, 736, 52);
    panel.lineStyle(8, num(PALETTE.lava), 1);
    panel.strokeRoundedRect(-450, -368, 900, 736, 52);
    const title = this.add
      .text(0, -320, 'Settings', {
        fontFamily: FONT.ui,
        fontSize: '54px',
        fontStyle: 'bold',
        // NOT PALETTE.cream — the panel is filled cream, so a cream heading is
        // invisible on it (it always was; nobody had reason to look).
        color: PALETTE.night
      })
      .setOrigin(0.5);

    // Background-music toggle (persists; the AudioManager applies it via the bus).
    const musicLabel = (): string => (getMusicMuted() ? 'Music: Off' : 'Music: On');
    const musicBtn = this.add.container(0, -232);
    const musicBg = this.add
      .image(0, 0, getMusicMuted() ? 'ui_btn_play' : 'ui_btn_green')
      .setScale(1.05, 0.8);
    const musicText = this.add
      .text(0, -10, musicLabel(), {
        fontFamily: FONT.ui,
        fontSize: '40px',
        fontStyle: 'bold',
        color: '#FFFFFF'
      })
      .setOrigin(0.5)
      .setShadow(0, 4, 'rgba(36,27,34,0.5)', 4);
    musicBtn.add([musicBg, musicText]);
    musicBtn.setSize(380 * 1.05, 118).setInteractive({ useHandCursor: true });
    musicBtn.on('pointerup', () => {
      const muted = !getMusicMuted();
      setMusicMuted(muted);
      this.ctx.bus.emit('audio:set_music_muted', { muted });
      musicText.setText(musicLabel());
      musicBg.setTexture(muted ? 'ui_btn_play' : 'ui_btn_green');
    });

    // Graphics quality. Cycles Auto → High → Balanced → Low. `high` is the
    // engine unchanged, so nothing here can cost a capable device anything —
    // the lower tiers only ever subtract.
    const gfxBtn = this.add.container(0, -104);
    const gfxBg = this.add.image(0, 0, 'ui_btn_green').setScale(1.05, 0.8);
    const gfxText = this.add
      .text(0, -10, graphics.label, {
        fontFamily: FONT.ui,
        fontSize: '36px',
        fontStyle: 'bold',
        color: '#FFFFFF'
      })
      .setOrigin(0.5)
      .setShadow(0, 4, 'rgba(36,27,34,0.5)', 4);
    gfxBtn.add([gfxBg, gfxText]);
    gfxBtn.setSize(380 * 1.05, 118).setInteractive({ useHandCursor: true });
    const gfxNote = this.add
      .text(0, -30, GRAPHICS_PROFILES[graphics.tier].note, {
        fontFamily: FONT.ui,
        fontSize: '26px',
        color: '#8A6248',
        align: 'center',
        lineSpacing: 6,
        wordWrap: { width: 780 }
      })
      .setOrigin(0.5, 0);
    gfxBtn.on('pointerup', () => {
      const order = GRAPHICS_QUALITIES;
      const next = order[(order.indexOf(graphics.quality) + 1) % order.length];
      const needsReload = graphics.set(next);
      gfxText.setText(graphics.label);
      gfxNote.setText(
        needsReload
          ? `${GRAPHICS_PROFILES[graphics.tier].note}\nReload the page to resize the canvas.`
          : GRAPHICS_PROFILES[graphics.tier].note
      );
      (this.registry.get('power') as { refreshFps?: () => void } | undefined)?.refreshFps?.();
      // Weather, the crystal and the ambient counts are decided when the board
      // is built, so the board rebuilds rather than half-applying.
      this.game.events.emit(GRAPHICS_EVENT);
    });

    const divider = this.add.rectangle(0, 46, 760, 3, num(PALETTE.lava), 0.22);
    const resetTitle = this.add
      .text(0, 88, 'Reset Cinder Hollow?', {
        fontFamily: FONT.ui,
        fontSize: '40px',
        fontStyle: 'bold',
        color: PALETTE.night
      })
      .setOrigin(0.5);
    const body = this.add
      .text(0, 150, 'The ash will settle back over everything\nyou have rekindled. This cannot be undone.', {
        fontFamily: FONT.ui,
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
      const button = this.add.container(x, 272);
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
      button.add([bg, text]);
      button.setSize(380 * scaleX, 112);
      button.setInteractive({ useHandCursor: true });
      button.on('pointerup', onTap);
      return button;
    };

    // Map Editor — the tool that authors the zone registry the engine runs
    // (`src/editor/`). Parked on the title row so it never crowds the reset copy.
    // It only emits the intent; the editor lives outside the scene tree entirely.
    const editorButton = makeButton(292, 'Map Editor', 'ui_btn_green', 0.68, () => {
      this.closeResetDialog();
      this.ctx.bus.emit('editor:open', {});
    });
    editorButton.setY(-320);

    const resetButton = makeButton(-210, 'Reset', 'ui_btn_play', 0.72, () => {
      this.closeResetDialog();
      this.ctx.bus.emit('game:reset_requested', {});
    });
    const keepButton = makeButton(210, 'Keep Playing', 'ui_btn_green', 0.95, () =>
      this.closeResetDialog()
    );

    container.add([dim, panel, title, editorButton, musicBtn, gfxBtn, gfxNote, divider, resetTitle, body, resetButton, keepButton]);
    container.setAlpha(0);
    container.setScale(0.94);
    this.tweens.add({ targets: container, alpha: 1, scale: 1, duration: 170, ease: 'Back.easeOut' });
    this.dialog = container;
  }

  private closeResetDialog(): void {
    this.dialog?.destroy();
    this.dialog = null;
  }

  /* ------------------------- real-money packs ------------------------ */

  /** Shared chrome for the purchase dialogs — cream card, gold keyline. */
  private iapCard(height: number): Phaser.GameObjects.Container {
    const container = this.add.container(GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2).setDepth(DEPTH_DIALOG);
    const dim = this.add
      .rectangle(0, 0, GAME_WIDTH, LIVE_GAME_HEIGHT, num(PALETTE.night), 0.55)
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
    this.confettiBurst(GAME_WIDTH / 2, LIVE_GAME_HEIGHT * 0.3);
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
