import Phaser from 'phaser';
import type { GameContext } from '../core/Context';
import {
  ENERGY_REGEN_MS,
  FINALE,
  GAME_WIDTH,
  GOLDEN_ALTAR,
  GOLDEN_TREMBLE_PROGRESS,
  LIVE_GAME_HEIGHT,
  num,
  PALETTE,
  SCENES,
  WELCOME_BACK_MIN_MS
} from '../core/Constants';
import { gridToWorld } from '../core/iso';
import type { ResolvedArrow, ResolvedHand, TilePos, TutorialStepEvent } from '../core/types';
import { CharacterBubble } from '../entities/CharacterBubble';
import { CookbookPanel } from '../ui/CookbookPanel';
import { EndScreen } from '../ui/EndScreen';
import { Hud } from '../ui/Hud';
import { LedgerPanel } from '../ui/LedgerPanel';
import { ShopPanel } from '../ui/ShopPanel';
import { renderScale } from '../core/render-scale';
import { getMusicMuted, setMusicMuted } from '../audio/musicPref';
import { CustomUiManager } from '../ui/customUi';
import { uiRegistry } from '../ui/theme';
import { Tooltip } from '../ui/Tooltip';

const FONT = 'Trebuchet MS, Verdana, sans-serif';
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
  private cookbook!: CookbookPanel;
  private cookbookButton!: Phaser.GameObjects.Container;
  private cookbookDot!: Phaser.GameObjects.Arc;
  private bubble!: CharacterBubble;
  /** The Level-3 finale is running — suppress competing banners. */
  private finaleActive = false;
  /** One-shot Laurah nudges (per session). */
  private hintShown = new Set<string>();
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

    this.shop = new ShopPanel(this, this.ctx.bus);
    this.shop.setDepth(DEPTH_PANEL + 8); // above the ledger

    this.cookbook = new CookbookPanel(this, this.ctx.bus, this.ctx.state, this.ctx.data.chains);
    this.cookbook.setDepth(DEPTH_PANEL + 4);
    this.cookbookButton = this.buildCookbookButton();

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
    this.ctx.beginRun();
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
        if (this.lastStep) this.applyMarkers(this.lastStep);
        this.tooltip.close();
      }),
      bus.on('item:tapped', ({ itemId }) => this.maybeShowTooltip(itemId)),
      bus.on('item:removed', ({ itemId }) => {
        if (this.tooltip.openItemId === itemId) this.tooltip.close();
      }),
      bus.on('item:merged', (payload) => {
        this.tooltip.close();
        // A fresh Flame Gem flies toward the Ledger (where the magic happens) —
        // pure juice, no game state depends on it.
        if (payload.chain === 'flame_gem' && payload.resultTier === 2) {
          this.flyGemToLedger(payload.at, payload.resultTier);
        }
      }),
      bus.on('gold:collected', ({ at }) => this.flyCoinToGold(at)),
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
      bus.on('state:loaded', ({ offlineMs, energyRecovered }) =>
        this.maybeWelcomeBack(offlineMs, energyRecovered)
      ),
      bus.on('tutorial:step', (step) => {
        this.cookbookButton.setVisible(step.done);
      }),
      bus.on('cookbook:discovered', () => {
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

  /** Emberkeep Cookbook button — sits directly above the Ledger (quest)
   *  button; hidden during the tutorial. The lava dot marks new pages. */
  private buildCookbookButton(): Phaser.GameObjects.Container {
    const button = this.add.container(GAME_WIDTH - 156, LIVE_GAME_HEIGHT - 356).setDepth(DEPTH_HUD);
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
    button.on('pointerover', () => button.setScale(1.06));
    button.on('pointerout', () => button.setScale(1));
    button.on('pointerup', () => {
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

  /** A tapped Gold coin arcs from its board cell up to the Gold gauge, then the
   *  gauge bumps — smooth appearance + collection juice. */
  private flyCoinToGold(at: TilePos): void {
    const start = this.cellToScreen(at.col, at.row);
    const end = this.hud.getCoinPos();
    const coin = this.add
      .image(start.x, start.y - 30, 'item_coin_1')
      .setScale(0.16)
      .setDepth(DEPTH_PANEL + 5);
    coin.setScale(0.05);
    this.tweens.add({ targets: coin, scale: 0.16, duration: 160, ease: 'Back.easeOut' });
    const proxy = { t: 0 };
    this.tweens.add({
      targets: proxy,
      t: 1,
      duration: 560,
      delay: 150,
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
        this.hud.bumpCoin();
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
    this.time.delayedCall(0, () => this.buildLevelUpBanner(level));
  }

  /**
   * UIScene's half of the Level-3 finale timeline (BoardScene runs the board
   * half off the same keeper:leveled beat): Cindra speaks — for the first time
   * in the entire demo — then the Chapter One card.
   */
  private runFinaleUi(): void {
    if (this.finaleActive || this.endScreen) return;
    this.finaleActive = true;
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
      this.endScreen = new EndScreen(this, 'chapter');
      this.add.existing(this.endScreen);
      this.endScreen.setDepth(DEPTH_DIALOG + 50);
      this.endScreen.once(Phaser.GameObjects.Events.DESTROY, () => {
        this.endScreen = null;
      });
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

  /** One-shot Laurah nudge (post-tutorial guidance without a second tutorial). */
  private showHint(key: 'zeroWarmth' | 'boardFull' | 'eggTrembles'): void {
    if (!this.ctx.state.tutorialDone || this.finaleActive || this.hintShown.has(key)) return;
    this.hintShown.add(key);
    this.bubble.say('laurah', this.ctx.data.dialogue.hints[key], 5200);
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
        fontFamily: FONT, fontSize: '60px', fontStyle: 'bold', color: PALETTE.textBrown
      })
      .setOrigin(0.5)
      .setStroke(PALETTE.cream, 6);
    const sub = this.add
      .text(0, 34, '⚡ Warmth refilled    ◎ Gold reward', {
        fontFamily: FONT, fontSize: '34px', fontStyle: 'bold', color: PALETTE.goldShade
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
    if (step.hand) this.placeHand(step.hand);
    if (step.arrow) this.placeArrow(step.arrow);
  }

  private uiTarget(ref: { ui: 'ledger' | 'deliver' | 'marketplace' } | { fogRegion: string }): { x: number; y: number } | null {
    if ('ui' in ref) {
      // The ⚡+ button until the Emporium opens, then the FREE! card inside it —
      // handPoint/arrowAnchor re-evaluate each frame, so the marker follows live.
      if (ref.ui === 'marketplace') return this.shop.getFreeButtonPos() ?? { x: 374, y: 88 };
      if (ref.ui === 'ledger') return this.hud.getLedgerPos();
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
    const musicBtn = this.add.container(0, -148);
    const musicBg = this.add
      .image(0, 0, getMusicMuted() ? 'ui_btn_play' : 'ui_btn_green')
      .setScale(1.05, 0.8);
    const musicText = this.add
      .text(0, -10, musicLabel(), {
        fontFamily: FONT,
        fontSize: '42px',
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

    container.add([dim, panel, title, musicBtn, divider, resetTitle, body, resetButton, keepButton]);
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
