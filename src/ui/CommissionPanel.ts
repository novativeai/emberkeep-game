import Phaser from 'phaser';
import {
  BAG_SLOTS,
  goldPurse,
  LIVE_GAME_HEIGHT,
  LIVE_GAME_WIDTH,
  num,
  panelMobileScale,
  TIMINGS
} from '../core/Constants';
import { FONT, INK, TYPE } from '../art/design';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { BagStack, ChainsData } from '../core/types';
import { uiRegistry } from './theme';

const FRAME_W = 1560;
const FRAME_H = 900;
/** 6 × 2 — the Bag's own grid, because this IS the Bag, asked a different
 *  question. A player who has learned to read twelve slots in one wide band
 *  should not have to learn a second layout to answer "which of these?". */
const COLS = 6;
const ROWS = 2;
const SLOT = 196;
const GAP = 30;
/** The confirm popover, anchored to the slot it belongs to. Same geometry rules
 *  as the Bag's Drop/Sell plate: it flips at the bottom row and clamps at the
 *  edge columns, so it can never hang off the frame. */
const POP_W = 452;
const POP_H = 214;
const POP_R = 26;
const POP_TAIL = 20;
const POP_TAIL_HALF = 22;
const POP_LIFT = 14;
const BTN_W = 194;
const BTN_H = 78;
const BTN_GAP = 24;
const DIM_ALPHA = 0.32;

/**
 * The House's commission — "what should this one make?"
 *
 * A finished House is not a coin press by default forever: the player dedicates
 * it to ONE merge piece, and it makes that piece for the rest of its life. A
 * second output costs a second House. That is the whole design, and it is why
 * this panel confirms rather than offering a menu of verbs — the choice is a
 * commitment, and an undoable commitment is not one.
 *
 * **The roster is the Bag, deliberately.** Only a piece the player is actually
 * holding can be commissioned. It keeps the chooser honest (nothing on it is
 * aspirational), it gives the Bag a third reason to exist, and it means the
 * panel can never promise an output this chapter cannot supply — the same
 * property `pnpm quests` enforces for everything else the game asks for.
 *
 * Deliberately NOT a subclass of BagPanel: they share a look, not a life. The
 * Bag's slots answer "drop or sell", these answer "yes or no", and folding both
 * into one panel with a mode flag is how a panel ends up with two half-correct
 * behaviours.
 */
export class CommissionPanel extends Phaser.GameObjects.Container {
  isOpen = false;
  /** The generator being commissioned; 0 when the panel is shut. */
  private forItemId = 0;
  private readonly offBus: Array<() => void> = [];
  private dim: Phaser.GameObjects.Rectangle;
  private slots: Phaser.GameObjects.Container[] = [];
  private emptyText: Phaser.GameObjects.Text;
  private helper: Phaser.GameObjects.Text;
  private chooser: Phaser.GameObjects.Container | null = null;
  private baseScale = 1;

  constructor(
    scene: Phaser.Scene,
    private bus: EventBus,
    private gameState: GameState,
    private chains: ChainsData
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setVisible(false);
    this.baseScale = panelMobileScale(FRAME_W);

    // The authored 2560x1600 space, never `scene.scale.*` — the backing is
    // LIVE_GAME_WIDTH x renderScale (Graphics setting), cameras zoom to compensate.
    const cx = LIVE_GAME_WIDTH / 2;
    const cy = LIVE_GAME_HEIGHT / 2;

    this.dim = scene.add
      .rectangle(cx, cy, LIVE_GAME_WIDTH * 2, LIVE_GAME_HEIGHT * 2, num(INK.scrim), 0.62)
      .setInteractive();
    // ONLY THE ✕ CLOSES — the dim swallows the tap but no longer dismisses.
    // A thumb scrolling the body releases ON the dim, and tap-outside-to-close
    // read that as "shut". See the long note in `ShopPanel.ts`.

    const body = scene.add.container(cx, cy).setScale(this.baseScale);

    const frame = scene.add.graphics();
    frame.fillStyle(num(INK.field), 0.98);
    frame.fillRoundedRect(-FRAME_W / 2, -FRAME_H / 2, FRAME_W, FRAME_H, 46);
    frame.lineStyle(9, num(INK.gold), 1);
    frame.strokeRoundedRect(-FRAME_W / 2, -FRAME_H / 2, FRAME_W, FRAME_H, 46);

    const bannerW = 760;
    const banner = scene.add.graphics();
    banner.fillStyle(num(INK.cream), 1);
    banner.fillRoundedRect(-bannerW / 2, -FRAME_H / 2 - 46, bannerW, 108, 28);
    banner.lineStyle(8, num(INK.gold), 1);
    banner.strokeRoundedRect(-bannerW / 2, -FRAME_H / 2 - 46, bannerW, 108, 28);
    const title = scene.add
      .text(0, -FRAME_H / 2 + 8, 'WHAT SHALL IT MAKE?', {
        fontFamily: FONT.display,
        fontSize: `${TYPE.title}px`,
        fontStyle: 'bold',
        color: INK.onPlate
      })
      .setOrigin(0.5);

    // Inside the gold edge, like every other ✕ in the game.
    const close = scene.add
      .image(FRAME_W / 2 - 88, -FRAME_H / 2 + 88, 'ui_btn_round_royal')
      .setScale(0.62);
    const closeX = scene.add
      .text(FRAME_W / 2 - 88, -FRAME_H / 2 + 88, '✕', {
        fontFamily: FONT.display,
        fontSize: `${Math.round(TYPE.title * 0.86)}px`,
        fontStyle: 'bold',
        color: INK.onFieldGold
      })
      .setOrigin(0.5);
    close.setInteractive({ useHandCursor: true });
    close.on(
      'pointerup',
      (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        this.requestClose();
      }
    );

    body.add([frame, banner, title, close, closeX]);

    const gridW = COLS * SLOT + (COLS - 1) * GAP;
    const gridH = ROWS * SLOT + (ROWS - 1) * GAP;
    for (let i = 0; i < BAG_SLOTS; i++) {
      const sx = -gridW / 2 + SLOT / 2 + (i % COLS) * (SLOT + GAP);
      const sy = -gridH / 2 + SLOT / 2 + Math.floor(i / COLS) * (SLOT + GAP) + 30;
      const slot = scene.add.container(sx, sy);
      body.add(slot);
      this.slots.push(slot);
    }

    // An empty Bag is the one state this panel cannot act on, so it says the one
    // thing that fixes it rather than showing twelve dashed squares and a shrug.
    this.emptyText = scene.add
      .text(0, 10, 'Your bag is empty.\nTap a piece on the board to pocket it,\nthen come back and choose.', {
        fontFamily: FONT.display,
        fontSize: `${TYPE.sub}px`,
        fontStyle: 'bold',
        color: INK.onField,
        align: 'center',
        lineSpacing: 14
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.helper = scene.add
      .text(0, FRAME_H / 2 - 62, 'Choose one — this house will make it, and only it, from now on.', {
        fontFamily: FONT.display,
        fontSize: `${TYPE.sub}px`,
        color: INK.onFieldGold
      })
      .setOrigin(0.5)
      .setAlpha(0.92);
    body.add([this.emptyText, this.helper]);

    this.add([this.dim, body]);

    uiRegistry.register(scene, 'panel.commission', 'House commission panel', 'Panels', this, {
      frame,
      title,
      helper: this.helper
    });

    this.offBus.push(
      bus.on('bag:changed', () => {
        if (this.isOpen) this.render();
      }),
      // The House it belongs to stopped existing (merged into a Manor, sold from
      // under it) — a panel commissioning a dead generator must not stay up.
      bus.on('item:removed', ({ itemId }) => {
        if (this.isOpen && itemId === this.forItemId) this.requestClose();
      })
    );
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      for (const off of this.offBus) off();
    });
  }

  /** The generator this panel is currently asking about (0 = shut). */
  get itemId(): number {
    return this.forItemId;
  }

  /**
   * Where the commission lesson's arrow should point once THIS PANEL is up.
   *
   * The step's own target is the House — right until the chooser covers it,
   * at which point an arrow still aimed at the board points at the panel's
   * dead middle and reads as "tap nothing". Same walk-them-through shape as
   * the satchel: the piece to pick first (slots are index-for-index with
   * `state.bag`), then the confirm popover once one is chosen. Null while
   * shut, so the caller falls back to the House.
   */
  getMarkerPos(): { x: number; y: number } | null {
    if (!this.isOpen) return null;
    const target = this.chooser ?? (this.gameState.bag.length ? this.slots[0] : null);
    if (!target) return null;
    const m = target.getWorldTransformMatrix();
    return { x: m.tx, y: m.ty };
  }

  openFor(itemId: number): void {
    this.forItemId = itemId;
    this.isOpen = true;
    this.render();
    this.setVisible(true);
    this.setAlpha(0);
    this.scene.tweens.add({ targets: this, alpha: 1, duration: TIMINGS.bubbleIn, ease: 'Sine.easeOut' });
    // Announced so guided beats (the merge-hint gauntlet) can yield the stage
    // while the chooser is up and take it back when it closes.
    this.bus.emit('ui:commission_toggled', { open: true });
  }

  requestClose(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.forItemId = 0;
    this.closeChooser();
    this.bus.emit('ui:commission_toggled', { open: false });
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      duration: TIMINGS.bubbleIn,
      ease: 'Sine.easeIn',
      onComplete: () => this.setVisible(false)
    });
  }

  teardown(): void {
    for (const off of this.offBus) off();
    this.offBus.length = 0;
  }

  /** The highest tier THIS generator may be commissioned to make — the same
   *  `produceMaxTier` GeneratorSystem enforces, read off the same data. */
  private maxTier(): number {
    const item = this.gameState.items.get(this.forItemId);
    if (!item) return 1;
    const cfg = this.chains.chains
      .find((c) => c.id === item.chain)
      ?.tiers.find((t) => t.tier === item.tier);
    return cfg?.produceMaxTier ?? 1;
  }

  private render(): void {
    this.closeChooser();
    const stacks = this.gameState.bag;
    const cap = this.maxTier();
    const hasGold = goldPurse(this.gameState.coins, cap) !== null;
    this.emptyText.setVisible(stacks.length === 0 && !hasGold);
    this.helper.setVisible(stacks.length > 0 || hasGold);
    // The rank of the building is the rank of the work — say so where the
    // choice is made, not only in the refusal.
    this.helper.setText(
      cap <= 1
        ? 'Choose one — this house will make it, and only it, from now on.\nA House works simple pieces: tier one. A Manor takes tier two.'
        : 'Choose one — this manor will make it, and only it, from now on.\nA Manor works pieces of tier one and two.'
    );
    // The PURSE is the first thing a building can be pointed at, at the rank it
    // can work: a House sees Gold Coins, a Manor sees Gold Pouches. It is the
    // one output every building starts with, so leaving it out of the roster
    // made the default choice the only unchoosable one.
    const purse = goldPurse(this.gameState.coins, cap);
    // Eligible first, so if the satchel is full the entry that falls off the
    // end is one this building could never have been commissioned to anyway.
    const entries = [...(purse ? [purse as BagStack] : []), ...stacks].sort(
      (a, b) => Number(b.tier <= cap) - Number(a.tier <= cap)
    );
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      slot.removeAll(true);
      slot.setVisible(entries.length > 0);
      const stack = entries[i];
      if (stack) this.paintFilled(slot, stack, stack.tier <= cap);
      else this.paintEmpty(slot);
    }
  }

  private paintEmpty(slot: Phaser.GameObjects.Container): void {
    const g = this.scene.add.graphics();
    g.fillStyle(num(INK.fieldDeep), 0.75);
    g.fillRoundedRect(-SLOT / 2, -SLOT / 2, SLOT, SLOT, 26);
    g.lineStyle(5, num(INK.goldMid), 0.6);
    const r = 26;
    const dash = 22;
    const half = SLOT / 2;
    for (let x = -half + r; x < half - r; x += dash * 2) {
      g.lineBetween(x, -half, Math.min(x + dash, half - r), -half);
      g.lineBetween(x, half, Math.min(x + dash, half - r), half);
    }
    for (let y = -half + r; y < half - r; y += dash * 2) {
      g.lineBetween(-half, y, -half, Math.min(y + dash, half - r));
      g.lineBetween(half, y, half, Math.min(y + dash, half - r));
    }
    slot.add(g);
  }

  private paintFilled(slot: Phaser.GameObjects.Container, stack: BagStack, eligible: boolean): void {
    const g = this.scene.add.graphics();
    g.fillStyle(num(INK.fieldDeep), 1);
    g.fillRoundedRect(-SLOT / 2, -SLOT / 2, SLOT, SLOT, 26);
    g.lineStyle(6, num(eligible ? INK.gold : INK.goldMid), eligible ? 1 : 0.5);
    g.strokeRoundedRect(-SLOT / 2, -SLOT / 2, SLOT, SLOT, 26);
    slot.add(g);

    const key = `item_${stack.chain}_${stack.tier}`;
    if (this.scene.textures.exists(key)) {
      const art = this.scene.add.image(0, -6, key);
      art.setScale((SLOT - 62) / Math.max(art.width, art.height));
      if (!eligible) art.setAlpha(0.35).setTint(0x8a8494);
      slot.add(art);
    }
    // Over-rank for THIS building: shown (the player should see what a Manor
    // would unlock), locked (this one cannot take it). The 🔒 is the badge and
    // the tap answers with a shake — a locked slot must never read as broken.
    if (!eligible) {
      slot.add(
        this.scene.add
          .text(0, -6, '🔒', { fontSize: '44px' })
          .setOrigin(0.5)
          .setAlpha(0.9)
      );
    }

    // NO stack count. The Bag shows how many you have because that is what it is
    // for; here the number is meaningless — a commission consumes nothing, and a
    // count would read as a price.
    const glow = this.scene.add.graphics().setAlpha(0);
    glow.lineStyle(9, num(INK.goldHi), 0.95);
    glow.strokeRoundedRect(-SLOT / 2 - 6, -SLOT / 2 - 6, SLOT + 12, SLOT + 12, 30);
    slot.add(glow);

    slot.setSize(SLOT, SLOT);
    slot.setInteractive({ useHandCursor: eligible });
    slot.on('pointerover', () => {
      if (!eligible) return;
      glow.setAlpha(1);
      slot.setScale(1.05);
    });
    slot.on('pointerout', () => {
      glow.setAlpha(0);
      slot.setScale(1);
    });
    slot.on(
      'pointerup',
      (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        if (!eligible) {
          this.scene.tweens.add({
            targets: slot,
            x: { from: slot.x - 7, to: slot.x },
            duration: 190,
            ease: 'Bounce.easeOut'
          });
          return;
        }
        this.openChooser(slot, stack);
      }
    );
  }

  /**
   * The confirmation. One question, two answers, and the piece's own name in it
   * — because "are you sure?" over an unnamed icon is how a player commits a
   * House to the wrong thing and cannot undo it.
   */
  private openChooser(slot: Phaser.GameObjects.Container, stack: BagStack): void {
    this.closeChooser();
    const tier = this.chains.chains
      .find((c) => c.id === stack.chain)
      ?.tiers.find((t) => t.tier === stack.tier);

    const index = this.slots.indexOf(slot);
    const openUp = Math.floor(index / COLS) >= ROWS - 1;
    const limit = FRAME_W / 2 - 26 - POP_W / 2;
    const offsetX = Phaser.Math.Clamp(slot.x, -limit, limit) - slot.x;
    const offsetY = (SLOT / 2 + POP_LIFT + POP_TAIL + POP_H / 2) * (openUp ? -1 : 1);

    const chooser = this.scene.add.container(offsetX, offsetY);
    chooser.add(this.plate(-offsetX, openUp));
    chooser.add(
      this.scene.add
        .text(0, -POP_H / 2 + 44, `Make ${tier?.name ?? stack.chain}?`, {
          fontFamily: FONT.display,
          fontSize: `${TYPE.body}px`,
          fontStyle: 'bold',
          color: INK.onField,
          align: 'center',
          wordWrap: { width: POP_W - 44 }
        })
        .setOrigin(0.5)
    );

    const bx = (BTN_W + BTN_GAP) / 2;
    const by = POP_H / 2 - BTN_H / 2 - 26;
    const cancel = this.chooserButton('No', -bx, by, INK.fieldLift, INK.fieldDeep, () =>
      this.closeChooser()
    );
    const confirm = this.chooserButton('Yes', bx, by, INK.gain, INK.gainDeep, () => {
      this.bus.emit('ui:produce_choice_requested', {
        itemId: this.forItemId,
        chain: stack.chain,
        tier: stack.tier
      });
      this.requestClose();
    });
    chooser.add([cancel, confirm]);

    slot.add(chooser);
    slot.parentContainer.bringToTop(slot);
    this.chooser = chooser;
    this.dimOthers(slot);

    chooser.setAlpha(0).setScale(0.92);
    chooser.setY(offsetY - (openUp ? -14 : 14));
    this.scene.tweens.add({
      targets: chooser,
      alpha: 1,
      scale: 1,
      y: offsetY,
      duration: 160,
      ease: 'Back.easeOut'
    });
  }

  /** The popover surface — outline INCLUDES the tail, so the gold edge runs
   *  round the point instead of cutting across its base. */
  private plate(tailX: number, openUp: boolean): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics();
    const w = POP_W / 2;
    const h = POP_H / 2;
    const tx = Phaser.Math.Clamp(tailX, -w + POP_R + POP_TAIL_HALF + 8, w - POP_R - POP_TAIL_HALF - 8);
    g.beginPath();
    g.moveTo(-w + POP_R, -h);
    if (!openUp) {
      g.lineTo(tx - POP_TAIL_HALF, -h);
      g.lineTo(tx, -h - POP_TAIL);
      g.lineTo(tx + POP_TAIL_HALF, -h);
    }
    g.lineTo(w - POP_R, -h);
    g.arc(w - POP_R, -h + POP_R, POP_R, -Math.PI / 2, 0);
    g.lineTo(w, h - POP_R);
    g.arc(w - POP_R, h - POP_R, POP_R, 0, Math.PI / 2);
    if (openUp) {
      g.lineTo(tx + POP_TAIL_HALF, h);
      g.lineTo(tx, h + POP_TAIL);
      g.lineTo(tx - POP_TAIL_HALF, h);
    }
    g.lineTo(-w + POP_R, h);
    g.arc(-w + POP_R, h - POP_R, POP_R, Math.PI / 2, Math.PI);
    g.lineTo(-w, -h + POP_R);
    g.arc(-w + POP_R, -h + POP_R, POP_R, Math.PI, Math.PI * 1.5);
    g.closePath();
    g.fillStyle(num(INK.fieldDeep), 1);
    g.fillPath();
    g.lineStyle(6, num(INK.gold), 1);
    g.strokePath();
    return g;
  }

  private chooserButton(
    label: string,
    x: number,
    y: number,
    face: string,
    edge: string,
    onTap: () => void
  ): Phaser.GameObjects.Container {
    const container = this.scene.add.container(x, y);
    const g = this.scene.add.graphics();
    const w = BTN_W / 2;
    const h = BTN_H / 2;
    g.fillStyle(num(edge), 1);
    g.fillRoundedRect(-w, -h + 6, BTN_W, BTN_H, 20);
    g.fillStyle(num(face), 1);
    g.fillRoundedRect(-w, -h, BTN_W, BTN_H, 20);
    g.fillStyle(0xffffff, 0.22);
    g.fillRoundedRect(-w + 10, -h + 8, BTN_W - 20, BTN_H * 0.36, 14);
    g.lineStyle(4, num(edge), 1);
    g.strokeRoundedRect(-w, -h, BTN_W, BTN_H, 20);
    container.add(g);

    container.add(
      this.scene.add
        .text(0, -2, label, {
          fontFamily: FONT.display,
          fontSize: `${TYPE.body}px`,
          fontStyle: 'bold',
          color: '#FFFFFF'
        })
        .setOrigin(0.5)
        .setShadow(0, 3, 'rgba(36,27,34,0.5)', 4)
    );

    container.setSize(BTN_W, BTN_H);
    container.setInteractive({ useHandCursor: true });
    container.on('pointerover', () => container.setScale(1.05));
    container.on('pointerout', () => container.setScale(1));
    container.on(
      'pointerup',
      (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        onTap();
      }
    );
    return container;
  }

  private dimOthers(chosen: Phaser.GameObjects.Container | null): void {
    for (const slot of this.slots) {
      slot.setAlpha(chosen === null || slot === chosen ? 1 : DIM_ALPHA);
    }
  }

  private closeChooser(): void {
    this.chooser?.destroy();
    this.chooser = null;
    this.dimOthers(null);
  }
}
