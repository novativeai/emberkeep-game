import Phaser from 'phaser';
import type { GameContext } from '../core/Context';
import { ENERGY_REGEN_MS, GAME_WIDTH, LIVE_GAME_HEIGHT, num, PALETTE, SCENES } from '../core/Constants';
import { gridToWorld } from '../core/iso';
import type { ResolvedArrow, ResolvedHand, TilePos, TutorialStepEvent } from '../core/types';
import { CharacterBubble } from '../entities/CharacterBubble';
import { EndScreen } from '../ui/EndScreen';
import { Hud } from '../ui/Hud';
import { LedgerPanel } from '../ui/LedgerPanel';
import { ShopPanel } from '../ui/ShopPanel';
import { renderScale } from '../core/render-scale';
import { getMusicMuted, setMusicMuted } from '../audio/musicPref';
import { Tooltip } from '../ui/Tooltip';

const FONT = 'Trebuchet MS, Verdana, sans-serif';
const DEPTH_HUD = 10;
const DEPTH_PANEL = 60;
const DEPTH_TUTORIAL = 100;
const DEPTH_DIALOG = 200;

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
  private bubble!: CharacterBubble;
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

    this.ledger = new LedgerPanel(this, this.ctx.bus, this.ctx.state, this.ctx.data.orders);
    this.ledger.setDepth(DEPTH_PANEL);

    this.shop = new ShopPanel(this, this.ctx.bus);
    this.shop.setDepth(DEPTH_PANEL + 8); // above the ledger

    this.bubble = new CharacterBubble(this, this.ctx.bus);
    this.bubble.setPosition(GAME_WIDTH / 2 - 80, LIVE_GAME_HEIGHT - 232);
    this.bubble.setDepth(DEPTH_TUTORIAL);

    this.hand = this.add.image(0, 0, 'ui_hand').setDepth(DEPTH_TUTORIAL + 2).setVisible(false);
    const [hx, hy] = this.ctx.data.anchors.byKey['ui_hand'] ?? [0.3, 0.12];
    this.hand.setOrigin(hx, hy);
    this.arrow = this.add.image(0, 0, 'ui_arrow').setDepth(DEPTH_TUTORIAL + 1).setVisible(false);
    this.arrow.setOrigin(0.5, 1);

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
    });

    // If resuming from a completed-tutorial save, key pill is permanently hidden.
    if (this.ctx.state.tutorialDone) this.hud.setKeyVisible(false);

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
        if (p) this.hand.setPosition(p.x, p.y);
      }
    }
    if (this.arrow.visible && this.arrowAnchor) {
      const a = this.arrowAnchor();
      if (a) this.arrow.setPosition(a.x, a.y - this.arrowLift + this.arrowBob.v);
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
      bus.on('order:completed', () => {
        this.time.delayedCall(650, () => {
          if (this.ledger.isOpen && this.lastStep?.gateType === 'tap') this.ledger.requestClose();
        });
      }),
      bus.on('keeper:leveled', ({ level }) => this.celebrateLevelUp(level)),
      bus.on('game:reset', () => {
        this.endScreen?.destroy();
        this.endScreen = null;
        this.scene.stop(SCENES.board);
        this.scene.start(SCENES.title);
      })
    );
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

  /** The level-up reward beat: a warm banner — Warmth refilled + Gold. */
  private celebrateLevelUp(level: number): void {
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
    // Level 3 is the demo's milestone — show the end-game popup after the banner fades.
    if (level >= 3 && !this.endScreen) {
      this.time.delayedCall(2200, () => {
        if (!this.endScreen) {
          this.endScreen = new EndScreen(this, 'level3');
          this.add.existing(this.endScreen);
          this.endScreen.setDepth(DEPTH_DIALOG + 50);
        }
      });
    }
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
    this.tweens.killTweensOf(this.hand);
    this.tweens.killTweensOf(this.arrow);
    this.tweens.killTweensOf(this.handProg);
    this.tweens.killTweensOf(this.arrowBob);
    this.hand.setVisible(false);
    this.arrow.setVisible(false);
    this.handDrag = null;
    this.handPoint = null;
    this.arrowAnchor = null;
  }

  private applyMarkers(step: TutorialStepEvent): void {
    this.clearMarkers();
    if (step.hand) this.placeHand(step.hand);
    if (step.arrow) this.placeArrow(step.arrow);
  }

  private uiTarget(ref: { ui: 'ledger' | 'deliver' | 'marketplace' } | { fogRegion: string }): { x: number; y: number } | null {
    if ('ui' in ref) {
      if (ref.ui === 'marketplace') return { x: 374, y: 88 };
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
      const run = (): void => {
        if (!this.hand.visible) return;
        this.handProg.t = 0;
        this.hand.setAlpha(0);
        this.tweens.add({
          targets: this.hand,
          alpha: 1,
          duration: 200,
          onComplete: () => {
            this.tweens.add({
              targets: this.handProg,
              t: 1,
              duration: 950,
              ease: 'Sine.easeInOut',
              onComplete: () => {
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
    this.tweens.add({
      targets: this.hand,
      scale: { from: 1, to: 0.88 },
      duration: 420,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
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
    this.arrowBob.v = 0;
    this.tweens.add({
      targets: this.arrowBob,
      v: -20,
      duration: 430,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
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
