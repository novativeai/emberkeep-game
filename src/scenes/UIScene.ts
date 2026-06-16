import Phaser from 'phaser';
import type { GameContext } from '../core/Context';
import { GAME_HEIGHT, GAME_WIDTH, num, PALETTE, SCENES } from '../core/Constants';
import { gridToWorld } from '../core/iso';
import type { ResolvedArrow, ResolvedHand, TilePos, TutorialStepEvent } from '../core/types';
import { CharacterBubble } from '../entities/CharacterBubble';
import { Hud } from '../ui/Hud';
import { LedgerPanel } from '../ui/LedgerPanel';
import { Tooltip } from '../ui/Tooltip';
import { hoverBob } from '../ui/tweens';

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
  private hud!: Hud;
  private tooltip!: Tooltip;
  private ledger!: LedgerPanel;
  private bubble!: CharacterBubble;
  private hand!: Phaser.GameObjects.Image;
  private arrow!: Phaser.GameObjects.Image;
  private dialog: Phaser.GameObjects.Container | null = null;
  private lastStep: TutorialStepEvent | null = null;
  private offBus: (() => void)[] = [];

  constructor() {
    super(SCENES.ui);
  }

  create(): void {
    this.ctx = this.registry.get('ctx') as GameContext;

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

    this.bubble = new CharacterBubble(this, this.ctx.bus);
    this.bubble.setPosition(GAME_WIDTH / 2 - 80, GAME_HEIGHT - 232);
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
    });

    // Everything is wired: load the save (or start fresh) and roll the tutorial.
    this.ctx.beginRun();
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
      bus.on('item:merged', () => this.tooltip.close()),
      bus.on('order:completed', () => {
        this.time.delayedCall(650, () => {
          if (this.ledger.isOpen && this.lastStep?.gateType === 'tap') this.ledger.requestClose();
        });
      }),
      bus.on('keeper:leveled', ({ level }) => this.celebrateLevelUp(level)),
      bus.on('game:reset', () => {
        this.scene.stop(SCENES.board);
        this.scene.start(SCENES.title);
      })
    );
  }

  /** The level-up reward beat: a warm banner — Warmth refilled + Gold. */
  private celebrateLevelUp(level: number): void {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT * 0.34;
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
  }

  private onTutorialStep(step: TutorialStepEvent): void {
    this.lastStep = step;
    this.hud.setLedgerEnabled(step.done || step.allow.ledger);
    this.ledger.setDeliverAllowed(step.done || step.allow.deliver);
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
        y: ((wy - view.y) / view.height) * GAME_HEIGHT
      };
    }
    return { x: wx, y: wy };
  }

  private clearMarkers(): void {
    this.tweens.killTweensOf(this.hand);
    this.tweens.killTweensOf(this.arrow);
    this.hand.setVisible(false);
    this.arrow.setVisible(false);
  }

  private applyMarkers(step: TutorialStepEvent): void {
    this.clearMarkers();
    if (step.hand) this.placeHand(step.hand);
    if (step.arrow) this.placeArrow(step.arrow);
  }

  private uiTarget(ref: { ui: 'ledger' | 'deliver' } | { fogRegion: string }): { x: number; y: number } | null {
    if ('ui' in ref) {
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
      const from = this.cellToScreen(hand.from.col, hand.from.row);
      const to = this.cellToScreen(hand.to.col, hand.to.row);
      this.hand.setVisible(true);
      const run = (): void => {
        if (!this.hand.visible) return;
        this.hand.setPosition(from.x + 16, from.y - 12);
        this.hand.setAlpha(0);
        this.tweens.add({
          targets: this.hand,
          alpha: 1,
          duration: 200,
          onComplete: () => {
            this.tweens.add({
              targets: this.hand,
              x: to.x + 16,
              y: to.y - 12,
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
    const target = this.uiTarget(hand);
    if (!target) {
      this.hand.setVisible(false);
      return;
    }
    this.hand.setVisible(true);
    this.hand.setAlpha(1);
    this.hand.setPosition(target.x + 28, target.y + 32);
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
    let target: { x: number; y: number } | null = null;
    let lift = 128;
    if ('tile' in arrow) {
      target = this.cellToScreen(arrow.tile.col, arrow.tile.row);
      lift = 156;
    } else {
      target = this.uiTarget(arrow);
      lift = 'ui' in arrow ? 116 : 192;
    }
    if (!target) return;
    this.arrow.setVisible(true);
    this.arrow.setAlpha(1);
    this.arrow.setPosition(target.x, target.y - lift);
    hoverBob(this, this.arrow, 20, 430);
  }

  /* ----------------------------- dialogs ---------------------------- */

  private openResetDialog(): void {
    if (this.dialog) return;
    const container = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(DEPTH_DIALOG);
    const dim = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, num(PALETTE.night), 0.55)
      .setInteractive();
    const panel = this.add.graphics();
    panel.fillStyle(num(PALETTE.night), 0.25);
    panel.fillRoundedRect(-450, -270 + 16, 900, 540, 52);
    panel.fillStyle(num(PALETTE.cream), 1);
    panel.fillRoundedRect(-450, -270, 900, 540, 52);
    panel.lineStyle(8, num(PALETTE.lava), 1);
    panel.strokeRoundedRect(-450, -270, 900, 540, 52);
    const title = this.add
      .text(0, -172, 'Reset Cinder Hollow?', {
        fontFamily: FONT,
        fontSize: '54px',
        fontStyle: 'bold',
        color: PALETTE.textBrown
      })
      .setOrigin(0.5);
    const body = this.add
      .text(0, -52, 'The ash will settle back over everything\nyou have rekindled. This cannot be undone.', {
        fontFamily: FONT,
        fontSize: '34px',
        color: '#8A6248',
        align: 'center',
        lineSpacing: 12
      })
      .setOrigin(0.5);

    const makeButton = (
      x: number,
      label: string,
      texture: string,
      scaleX: number,
      onTap: () => void
    ): Phaser.GameObjects.Container => {
      const button = this.add.container(x, 144);
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

    container.add([dim, panel, title, body, resetButton, keepButton]);
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
