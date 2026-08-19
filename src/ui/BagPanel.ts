import Phaser from 'phaser';
import { FONT } from '../art/design';
import {
  BAG_SLOTS,
  goldPurse,
  LIVE_GAME_HEIGHT,
  LIVE_GAME_WIDTH,
  num,
  PALETTE,
  panelMobileScale,
  TIMINGS
} from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { BagStack, ChainsData } from '../core/types';
import { uiRegistry } from './theme';

const FRAME_W = 1560;
const FRAME_H = 900;
/** 6 x 2 — the layout the concept frame settled on. Twelve slots read better in
 *  one wide band at 16:9 than in a 4x3 block, and the count is what matters. */
const COLS = 6;
const ROWS = 2;
const SLOT = 196;
const GAP = 30;
/**
 * The Drop/Sell chooser is an anchored POPOVER, not two loose buttons.
 *
 * It used to be a pair of `ui_btn_green` plates parented straight to the slot.
 * That art is 420px natural and was drawn at 0.62 — 260 units wide — with its
 * centres only 224 apart, so the two buttons literally overlapped, and with
 * nothing behind them they sat on top of whatever slots happened to be beneath.
 * A menu with no surface of its own always reads as broken.
 *
 * So: a plate with a tail pointing at the slot it belongs to, the rest of the
 * grid dimmed behind it, and geometry that flips and clamps so it can never
 * leave the frame.
 */
/** Widened for the THIRD verb. Three buttons at the old 194 would have brought
 *  the overlap the popover was built to fix straight back. */
const POP_W = 596;
const POP_H = 292; // title · quantity stepper · the three fates
const POP_R = 26;
/** Tail height, and half its width where it meets the plate. */
const POP_TAIL = 20;
const POP_TAIL_HALF = 22;
/** Gap between the slot's edge and the tail's tip. */
const POP_LIFT = 14;
const BTN_W = 172;
const BTN_H = 78;
const BTN_GAP = 20;
/** How far the unchosen slots fade while a chooser is open. */
const DIM_ALPHA = 0.32;

/**
 * The Bag panel — the player's off-board pocket, opened from the satchel button.
 *
 * Deliberately plain: twelve slots, a stack count on each filled one, a dashed
 * outline on each empty one, and a single instruction. No sort, no filter — the
 * bag stores, the board merges, and keeping those separate is what stops this
 * quietly becoming a second board.
 *
 * Tapping a filled slot offers the piece's three fates: **Drop** it back on the
 * board, **Give** it to a person or a dragon, or **Sell** it for coins.
 * Giving and selling both live HERE and nowhere else — handing something over is
 * a deliberate act, and a piece you have pocketed is a piece you have already
 * decided something about. Give only ARMS the act; the recipient is the next tap
 * on the board, which is why the panel closes behind it. The
 * board's verbs (drag, merge, pocket) are all recoverable, so the one
 * irreversible verb is placed behind the deliberate act of setting a piece
 * aside — a mis-tap on the board can never cost the player anything.
 *
 * Matches `assets/raw/bag-concept/generations/screen-bag.png`.
 */
export class BagPanel extends Phaser.GameObjects.Container {
  isOpen = false;
  private readonly offBus: Array<() => void> = [];
  private dim: Phaser.GameObjects.Rectangle;
  private slots: Phaser.GameObjects.Container[] = [];
  private capacityText: Phaser.GameObjects.Text;
  /** The Gold balance, drawn as Pouches (or Coins below a Pouch's worth). */
  private purse!: Phaser.GameObjects.Container;
  private baseScale = 1;
  /** The Drop/Sell chooser, parented to the slot it belongs to (null = none
   *  open). Only one is ever live: opening another closes this one. */
  private chooser: Phaser.GameObjects.Container | null = null;
  /**
   * HOW MANY — the stepper's live answer, and why it exists.
   *
   * Drop and Sell used to move exactly one piece per visit: open the slot, tap,
   * the popover closes, open it again. Emptying a stack of twelve was twelve
   * round trips through a menu that had already been told what the player
   * wanted. The count travels with the request instead.
   *
   * A stepper rather than a typed field: this is a touch surface and the
   * numbers are small — `Max` covers the one case where typing would win, and
   * nothing here is worth raising a keyboard over. Reset to 1 on every open, so
   * a big number chosen for one stack is never inherited by the next.
   */
  private qty = 1;
  private qtyMax = 1;
  private qtyLabel: Phaser.GameObjects.Text | null = null;
  /** The Sell button inside the live chooser — the tutorial arrow's target. */
  private sellButton: Phaser.GameObjects.Container | null = null;
  /** The Give button, likewise. */
  private giveButton: Phaser.GameObjects.Container | null = null;
  /** Giving is tutorial-gated the same way selling is. */
  private giveAllowed = true;
  /** Selling is a tutorial-gated verb (`allow.sell`) until the script teaches
   *  it. The button is still drawn when it is off — a refused action answers
   *  with a nudge, never with silence (tutorial-design law 3). */
  private sellAllowed = true;

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

    // The AUTHORED space, never `scene.scale.*`: the canvas backing is
    // LIVE_GAME_WIDTH × renderScale (the Graphics setting picks the factor at boot,
    // off the SAVED profile), and the cameras zoom to compensate — so on a
    // resumed session `scale.width/2` is the centre of the BACKING, which
    // parked this panel in the top-left. UI coordinates live in 2560×1600.
    const cx = LIVE_GAME_WIDTH / 2;
    const cy = LIVE_GAME_HEIGHT / 2;

    // The dim sits in the panel so it fades with it.
    this.dim = scene.add
      .rectangle(cx, cy, LIVE_GAME_WIDTH * 2, LIVE_GAME_HEIGHT * 2, num(PALETTE.night), 0.62)
      .setInteractive();
    // ONLY THE ✕ CLOSES — the dim swallows the tap but no longer dismisses.
    // A thumb scrolling the body releases ON the dim, and tap-outside-to-close
    // read that as "shut". See the long note in `ShopPanel.ts`.

    const body = scene.add.container(cx, cy).setScale(this.baseScale);

    const frame = scene.add.graphics();
    frame.fillStyle(num(PALETTE.plum), 0.98);
    frame.fillRoundedRect(-FRAME_W / 2, -FRAME_H / 2, FRAME_W, FRAME_H, 46);
    frame.lineStyle(9, num(PALETTE.gold), 1);
    frame.strokeRoundedRect(-FRAME_W / 2, -FRAME_H / 2, FRAME_W, FRAME_H, 46);

    // Title banner — cream plate with gold trim, same furniture as the Ledger.
    const bannerW = 460;
    const banner = scene.add.graphics();
    banner.fillStyle(num(PALETTE.cream), 1);
    banner.fillRoundedRect(-bannerW / 2, -FRAME_H / 2 - 46, bannerW, 108, 28);
    banner.lineStyle(8, num(PALETTE.gold), 1);
    banner.strokeRoundedRect(-bannerW / 2, -FRAME_H / 2 - 46, bannerW, 108, 28);
    const title = scene.add
      .text(0, -FRAME_H / 2 + 8, 'BAG', {
        fontFamily: FONT.display,
        fontSize: '64px',
        fontStyle: 'bold',
        color: PALETTE.textBrown
      })
      .setOrigin(0.5);

    // Capacity readout: satchel icon + used/total, top-right inside the frame.
    const capIcon = scene.add.image(FRAME_W / 2 - 286, -FRAME_H / 2 + 92, 'ui_icon_bag').setScale(0.52);
    this.capacityText = scene.add
      .text(FRAME_W / 2 - 220, -FRAME_H / 2 + 92, '', {
        fontFamily: FONT.display,
        fontSize: '46px',
        fontStyle: 'bold',
        color: PALETTE.cream
      })
      .setOrigin(0, 0.5);

    // Seated INSIDE the frame: at the old corner the disc hung 22 units above
    // the gold edge and 2 past its right, which reads as a sticker on the panel
    // rather than a key in it.
    const close = scene.add
      .image(FRAME_W / 2 - 88, -FRAME_H / 2 + 88, 'ui_btn_round_royal')
      .setScale(0.62);
    const closeX = scene.add
      .text(FRAME_W / 2 - 88, -FRAME_H / 2 + 88, '✕', {
        fontFamily: FONT.display,
        fontSize: '48px',
        fontStyle: 'bold',
        // The royal disc is a dark plum face, so the ✕ is its rim's gold.
        color: PALETTE.goldAccent
      })
      .setOrigin(0.5);
    close.setInteractive({ useHandCursor: true });
    close.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      this.requestClose();
    });

    // The PURSE: the Gold balance, in the coins it is made of. It is not a
    // storage slot — money is the balance, so it costs no capacity and can
    // never push a pocketed piece out of the grid.
    this.purse = scene.add.container(-FRAME_W / 2 + 250, -FRAME_H / 2 + 92);
    body.add([frame, banner, title, capIcon, this.capacityText, close, closeX, this.purse]);

    const gridW = COLS * SLOT + (COLS - 1) * GAP;
    const gridH = ROWS * SLOT + (ROWS - 1) * GAP;
    for (let i = 0; i < BAG_SLOTS; i++) {
      const sx = -gridW / 2 + SLOT / 2 + (i % COLS) * (SLOT + GAP);
      const sy = -gridH / 2 + SLOT / 2 + Math.floor(i / COLS) * (SLOT + GAP) + 30;
      const slot = scene.add.container(sx, sy);
      body.add(slot);
      this.slots.push(slot);
    }

    const helper = scene.add
      .text(0, FRAME_H / 2 - 62, 'Tap an item to Drop it back, Give it to someone, or Sell it for gold.', {
        fontFamily: FONT.display,
        fontSize: '40px',
        color: PALETTE.cream
      })
      .setOrigin(0.5)
      .setAlpha(0.92);
    body.add(helper);

    this.add([this.dim, body]);

    uiRegistry.register(scene, 'panel.bag', 'Bag panel', 'Panels', this, {
      frame,
      title,
      helper
    });

    this.offBus.push(
      bus.on('bag:changed', () => {
        if (this.isOpen) this.render();
      }),
      // The purse is a view of the balance, so it follows the money rather than
      // the satchel — a coin banked while the panel is open must show at once.
      bus.on('economy:changed', () => {
        if (this.isOpen) this.paintPurse();
      })
    );
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      for (const off of this.offBus) off();
    });
  }

  open(): void {
    this.isOpen = true;
    this.render();
    this.setVisible(true);
    this.setAlpha(0);
    this.scene.tweens.add({ targets: this, alpha: 1, duration: TIMINGS.bubbleIn, ease: 'Sine.easeOut' });
  }

  requestClose(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.closeChooser();
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      duration: TIMINGS.bubbleIn,
      ease: 'Sine.easeIn',
      onComplete: () => this.setVisible(false)
    });
  }

  /** Repaint every slot from state. Cheap enough to do wholesale — twelve slots. */
  private render(): void {
    // Every slot is rebuilt wholesale, which destroys the chooser with its
    // parent — drop the dangling reference before it is read.
    this.closeChooser();
    const stacks = this.gameState.bag;
    this.capacityText.setText(`${stacks.length}/${BAG_SLOTS}`);
    this.paintPurse();
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      slot.removeAll(true);
      const stack = stacks[i];
      if (stack) this.paintFilled(slot, stack);
      else this.paintEmpty(slot);
    }
  }

  /**
   * The purse tile: the same Gold the HUD counts, shown as the largest coin it
   * fills — 500 Gold is 33 Pouches. Empty of art below one Coin's worth, so a
   * player with 3 Gold is not shown a coin they cannot spend as one.
   */
  private paintPurse(): void {
    this.purse.removeAll(true);
    const held = goldPurse(this.gameState.coins);
    if (!held) return;
    const key = `item_coin_${held.tier}`;
    if (this.scene.textures.exists(key)) {
      const art = this.scene.add.image(-46, 0, key);
      art.setScale(Math.min(84 / art.width, 84 / art.height));
      this.purse.add(art);
    }
    this.purse.add(
      this.scene.add
        .text(4, 0, `x${held.count}`, {
          fontFamily: FONT.display,
          fontSize: '46px',
          fontStyle: 'bold',
          color: PALETTE.cream
        })
        .setOrigin(0, 0.5)
    );
  }

  /** An unfilled slot: a recessed square with a faint gold DASHED outline and
   *  nothing inside it. No "EMPTY" label — the shape says it. */
  private paintEmpty(slot: Phaser.GameObjects.Container): void {
    const g = this.scene.add.graphics();
    g.fillStyle(num(PALETTE.plumShade), 0.75);
    g.fillRoundedRect(-SLOT / 2, -SLOT / 2, SLOT, SLOT, 26);
    g.lineStyle(5, num(PALETTE.goldShade), 0.6);
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

  private paintFilled(slot: Phaser.GameObjects.Container, stack: BagStack): void {
    const g = this.scene.add.graphics();
    g.fillStyle(num(PALETTE.plumShade), 1);
    g.fillRoundedRect(-SLOT / 2, -SLOT / 2, SLOT, SLOT, 26);
    g.lineStyle(6, num(PALETTE.gold), 1);
    g.strokeRoundedRect(-SLOT / 2, -SLOT / 2, SLOT, SLOT, 26);
    slot.add(g);

    const key = `item_${stack.chain}_${stack.tier}`;
    if (this.scene.textures.exists(key)) {
      const art = this.scene.add.image(0, -6, key);
      const fit = (SLOT - 62) / Math.max(art.width, art.height);
      art.setScale(fit);
      slot.add(art);
    }

    // Stack count, bottom-right — a gold rounded tag like the concept's.
    const tag = this.scene.add.graphics();
    tag.fillStyle(num(PALETTE.gold), 1);
    tag.fillRoundedRect(SLOT / 2 - 96, SLOT / 2 - 62, 88, 52, 20);
    tag.lineStyle(4, num(PALETTE.night), 0.9);
    tag.strokeRoundedRect(SLOT / 2 - 96, SLOT / 2 - 62, 88, 52, 20);
    const count = this.scene.add
      .text(SLOT / 2 - 52, SLOT / 2 - 36, `x${stack.count}`, {
        fontFamily: FONT.display,
        fontSize: '30px',
        fontStyle: 'bold',
        color: PALETTE.textBrown
      })
      .setOrigin(0.5);
    slot.add([tag, count]);

    // Hover lifts and lights the slot — the concept's hovered state, and the
    // only affordance telling the player a slot is tappable.
    const glow = this.scene.add.graphics().setAlpha(0);
    glow.lineStyle(9, num(PALETTE.goldAccent), 0.95);
    glow.strokeRoundedRect(-SLOT / 2 - 6, -SLOT / 2 - 6, SLOT + 12, SLOT + 12, 30);
    slot.add(glow);

    slot.setSize(SLOT, SLOT);
    slot.setInteractive({ useHandCursor: true });
    slot.on('pointerover', () => {
      glow.setAlpha(1);
      slot.setScale(1.05);
    });
    slot.on('pointerout', () => {
      glow.setAlpha(0);
      slot.setScale(1);
    });
    slot.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      this.openChooser(slot, stack);
    });
  }

  /**
   * The two things a pocketed piece can become, offered on a plate anchored to
   * the slot the player tapped.
   *
   * Three rules, all of them things the old chooser broke:
   *  • it FLIPS — a bottom-row slot opens upward, so the plate never hangs off
   *    the frame;
   *  • it CLAMPS — the first and last columns slide the plate inward and the
   *    tail slides the other way to keep pointing at the slot;
   *  • everything else DIMS — the chosen slot is the only lit thing on the grid
   *    while its menu is up, which is what makes the popover read as modal
   *    without a second scrim over the panel.
   */
  private openChooser(slot: Phaser.GameObjects.Container, stack: BagStack): void {
    this.closeChooser();
    const tier = this.chains.chains
      .find((c) => c.id === stack.chain)
      ?.tiers.find((t) => t.tier === stack.tier);
    const value = tier?.sell ?? 0;

    const index = this.slots.indexOf(slot);
    const openUp = Math.floor(index / COLS) >= ROWS - 1;
    // Keep the whole plate inside the frame, then point the tail back at the
    // slot by exactly however far the plate had to move.
    const limit = FRAME_W / 2 - 26 - POP_W / 2;
    const offsetX = Phaser.Math.Clamp(slot.x, -limit, limit) - slot.x;
    const offsetY = (SLOT / 2 + POP_LIFT + POP_TAIL + POP_H / 2) * (openUp ? -1 : 1);

    const chooser = this.scene.add.container(offsetX, offsetY);
    chooser.add(this.plate(-offsetX, openUp));

    const name = tier?.name ?? stack.chain;
    chooser.add(
      this.scene.add
        .text(0, -POP_H / 2 + 44, `${name}   ×${stack.count}`, {
          fontFamily: FONT.display,
          fontSize: '34px',
          fontStyle: 'bold',
          color: PALETTE.cream
        })
        .setOrigin(0.5)
    );

    const bx = BTN_W + BTN_GAP;
    const by = POP_H / 2 - BTN_H / 2 - 26;
    // A piece the game refuses to sell (`sellable:false` — the legendary eggs)
    // gets NO Sell plate at all: a button that only nudges is a dead button,
    // and EconomySystem would refuse the sale anyway. Two fates centre up.
    const sellHere = tier?.sellable !== false;
    const dropX = sellHere ? -bx : -bx / 2;
    const giveX = sellHere ? 0 : bx / 2;
    // Three fates, ordered by how far they take the piece from the player:
    // Drop puts it back where it came from, Give hands it to somebody, Sell ends
    // it. Drop is reversible so it is the quiet one; Sell is final and wears the
    // coin it pays, which is also the only place the value is ever shown.
    const drop = this.chooserButton('Drop', dropX, by, PALETTE.plumHighlight, PALETTE.plumShade, () => {
      this.bus.emit('ui:bag_retrieve_requested', {
        chain: stack.chain,
        tier: stack.tier,
        count: this.qty
      });
      this.closeChooser();
    });
    const give = this.chooserButton('Give', giveX, by, PALETTE.lava, PALETTE.lavaShade, () => {
      if (!this.giveAllowed) {
        this.bus.emit('tutorial:nudge', {});
        return;
      }
      // Only ARMS it. Who it is for is the next tap, on the board — so the panel
      // gets out of the way rather than asking the question twice.
      this.bus.emit('ui:bag_give_requested', { chain: stack.chain, tier: stack.tier });
      this.closeChooser();
    });
    give.setAlpha(this.giveAllowed ? 1 : 0.5);
    let sell: Phaser.GameObjects.Container | undefined;
    if (sellHere) {
      sell = this.chooserButton(`+${value}`, bx, by, PALETTE.gold, PALETTE.night, () => {
        if (!this.sellAllowed) {
          this.bus.emit('tutorial:nudge', {});
          return;
        }
        this.bus.emit('ui:bag_sell_requested', {
          chain: stack.chain,
          tier: stack.tier,
          count: this.qty
        });
        this.closeChooser();
      }, true);
      sell.setAlpha(this.sellAllowed ? 1 : 0.5);
    }
    chooser.add(sell ? [drop, give, sell] : [drop, give]);

    // The stepper, between the name and the fates — it qualifies the two verbs
    // that take a number, and sits where the eye already is on the way down.
    //
    // GIVE is deliberately not qualified by it: giving ARMS a second gesture on
    // the board, and "give six" would have to ask six times or invent a rule
    // for what happens after the first refusal. One is the only honest answer
    // there, so the stepper leaves it alone rather than lying about its reach.
    this.qty = 1;
    this.qtyMax = stack.count;
    const priceOf = (n: number): string => `+${value * n}`;
    const paint = (): void => {
      this.qtyLabel?.setText(`×${this.qty}`);
      (drop.getData('text') as Phaser.GameObjects.Text | undefined)?.setText(
        this.qty > 1 ? `Drop ×${this.qty}` : 'Drop'
      );
      if (sell) {
        const label = sell.getData('text') as Phaser.GameObjects.Text | undefined;
        label?.setText(priceOf(this.qty));
        // The coin rides beside the price, so a wider number has to re-centre
        // the pair or the plate reads lopsided at ×10.
        const coin = sell.list.find((o) => o instanceof Phaser.GameObjects.Image) as
          | Phaser.GameObjects.Image
          | undefined;
        if (coin && label) {
          const total = coin.displayWidth + 10 + label.width;
          coin.setX(-total / 2 + coin.displayWidth / 2);
          label.setX(total / 2 - label.width / 2);
        }
      }
    };
    const step = (by2: number): void => {
      this.qty = Phaser.Math.Clamp(this.qty + by2, 1, Math.max(1, this.qtyMax));
      paint();
    };
    if (stack.count > 1) chooser.add(this.quantityRow(-4, step, () => { this.qty = this.qtyMax; paint(); }));
    paint();

    slot.add(chooser);
    // Above every other slot: the plate is wider than its own slot and would
    // otherwise be painted under the ones drawn after it.
    slot.parentContainer.bringToTop(slot);
    this.chooser = chooser;
    this.sellButton = sell ?? null;
    this.giveButton = give;
    this.dimOthers(slot);

    chooser.setAlpha(0).setScale(0.92);
    chooser.setY(offsetY - (openUp ? -14 : 14)); // rises out of the slot it belongs to
    this.scene.tweens.add({
      targets: chooser,
      alpha: 1,
      scale: 1,
      y: offsetY,
      duration: 160,
      ease: 'Back.easeOut'
    });
  }

  /** The popover surface: a rounded plate whose outline INCLUDES the tail, so
   *  the gold edge runs round the point instead of cutting across its base. */
  private plate(tailX: number, openUp: boolean): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics();
    const w = POP_W / 2;
    const h = POP_H / 2;
    const tx = Phaser.Math.Clamp(tailX, -w + POP_R + POP_TAIL_HALF + 8, w - POP_R - POP_TAIL_HALF - 8);
    g.beginPath();
    g.moveTo(-w + POP_R, -h);
    if (openUp === false) {
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
    g.fillStyle(num(PALETTE.plumShade), 1);
    g.fillPath();
    g.lineStyle(6, num(PALETTE.gold), 1);
    g.strokePath();
    return g;
  }

  /** One chooser action. Drawn rather than textured: these have to be an exact
   *  width to sit side by side without touching, and the shared button art can
   *  only get there by being squashed non-uniformly — which is how the old pair
   *  ended up overlapping. */
  /**
   * `−  ×N  +  Max` — the row that turns "one per visit" into "however many".
   *
   * Built only when the stack HOLDS more than one: a stepper over a single
   * piece is three controls that can do nothing, which is worse than no
   * stepper. `Max` is the one shortcut worth having — emptying a stack is the
   * commonest reason to want a number at all.
   */
  private quantityRow(
    y: number,
    step: (by: number) => void,
    max: () => void
  ): Phaser.GameObjects.Container {
    // The keys span -234..154 once laid out below, so the row itself is nudged
    // right by half that offset — otherwise a set that now fits the plate still
    // sits visibly left of its middle.
    const row = this.scene.add.container(40, y);
    const label = this.scene.add
      .text(0, 0, '×1', {
        fontFamily: FONT.display,
        fontSize: '40px',
        fontStyle: 'bold',
        color: PALETTE.cream
      })
      .setOrigin(0.5);
    this.qtyLabel = label;
    // Laid out to sit INSIDE the plate with the same 26px margin its buttons
    // use: `Max` at x=246 with a 108 width put its right edge at 300 against a
    // 298 half-plate, so it hung over the rim. The row is pulled left and the
    // whole set tightened, keeping the number in the middle of the three keys
    // that change it rather than in the middle of the plate.
    row.add([
      this.stepperKey('−', -196, () => step(-1)),
      label,
      this.stepperKey('+', -68, () => step(1)),
      this.stepperKey('Max', 96, max, 116)
    ]);
    label.setX(-132);
    return row;
  }

  /** One round key of the stepper. Its own helper rather than `chooserButton`:
   *  those are the three FATES and wear the weight to match — a key that only
   *  changes a number must not look like one that spends the piece. */
  private stepperKey(
    label: string,
    x: number,
    onTap: () => void,
    width = 76
  ): Phaser.GameObjects.Container {
    const c = this.scene.add.container(x, 0);
    const h = 68;
    const g = this.scene.add.graphics();
    g.fillStyle(num(PALETTE.plumShade), 1);
    g.fillRoundedRect(-width / 2, -h / 2 + 4, width, h, 18);
    g.fillStyle(num(PALETTE.plum), 1);
    g.fillRoundedRect(-width / 2, -h / 2, width, h, 18);
    g.lineStyle(3, num(PALETTE.plumShade), 1);
    g.strokeRoundedRect(-width / 2, -h / 2, width, h, 18);
    c.add(g);
    c.add(
      this.scene.add
        .text(0, -2, label, {
          fontFamily: FONT.display,
          fontSize: label.length > 1 ? '28px' : '40px',
          fontStyle: 'bold',
          color: PALETTE.cream
        })
        .setOrigin(0.5)
    );
    c.setSize(width, h);
    c.setInteractive({ useHandCursor: true });
    c.on('pointerover', () => c.setScale(1.06));
    c.on('pointerout', () => c.setScale(1));
    c.on('pointerup', () => {
      c.setScale(1);
      onTap();
    });
    return c;
  }

  private chooserButton(
    label: string,
    x: number,
    y: number,
    face: string,
    edge: string,
    onTap: () => void,
    withCoin = false
  ): Phaser.GameObjects.Container {
    const container = this.scene.add.container(x, y);
    const g = this.scene.add.graphics();
    const w = BTN_W / 2;
    const h = BTN_H / 2;
    g.fillStyle(num(edge), 1); // seat, so the plate sits ON the surface
    g.fillRoundedRect(-w, -h + 6, BTN_W, BTN_H, 20);
    g.fillStyle(num(face), 1);
    g.fillRoundedRect(-w, -h, BTN_W, BTN_H, 20);
    g.fillStyle(0xffffff, 0.22); // top gloss
    g.fillRoundedRect(-w + 10, -h + 8, BTN_W - 20, BTN_H * 0.36, 14);
    g.lineStyle(4, num(edge), 1);
    g.strokeRoundedRect(-w, -h, BTN_W, BTN_H, 20);
    container.add(g);

    const text = this.scene.add
      .text(0, -2, label, { fontFamily: FONT.display, fontSize: '34px', fontStyle: 'bold', color: '#FFFFFF' })
      .setOrigin(0.5)
      .setShadow(0, 3, 'rgba(36,27,34,0.5)', 4);
    container.add(text);
    container.setData('text', text); // so a stepper can rewrite the price
    if (withCoin) {
      const coin = this.scene.add.image(0, -2, 'ui_icon_coin');
      coin.setScale(40 / Math.max(coin.width, coin.height));
      const total = coin.displayWidth + 10 + text.width;
      coin.setX(-total / 2 + coin.displayWidth / 2);
      text.setX(total / 2 - text.width / 2);
      container.add(coin);
    }

    container.setSize(BTN_W, BTN_H);
    container.setInteractive({ useHandCursor: true });
    container.on('pointerover', () => container.setScale(1.05));
    container.on('pointerout', () => container.setScale(1));
    container.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      onTap();
    });
    return container;
  }

  /** Fade every slot but the chosen one, so the popover reads as modal without
   *  a second scrim laid over the panel. */
  private dimOthers(chosen: Phaser.GameObjects.Container | null): void {
    for (const slot of this.slots) {
      slot.setAlpha(chosen === null || slot === chosen ? 1 : DIM_ALPHA);
    }
  }

  private closeChooser(): void {
    this.chooser?.destroy();
    this.chooser = null;
    this.sellButton = null;
    this.giveButton = null;
    // The label belonged to the destroyed plate; holding the reference would
    // leave `paint()` writing into a corpse the next time a slot opens.
    this.qtyLabel = null;
    this.qty = 1;
    this.dimOthers(null);
  }

  setSellAllowed(allowed: boolean): void {
    this.sellAllowed = allowed;
    if (this.chooser) this.sellButton?.setAlpha(allowed ? 1 : 0.5);
  }

  setGiveAllowed(allowed: boolean): void {
    this.giveAllowed = allowed;
    if (this.chooser) this.giveButton?.setAlpha(allowed ? 1 : 0.5);
  }

  /**
   * Where a satchel lesson's arrow should point, which moves as the player works.
   *
   * Three stages, because every satchel verb is three taps and an arrow that
   * names only the last one leaves the middle tap unguided: bag shut → null, and
   * UIScene falls back to the satchel button; bag open, nothing chosen → THE
   * PIECE, because tapping it is what raises the chooser; chooser up → the verb's
   * own plate. Whenever a lesson talks about something in the satchel, the arrow
   * is on that something.
   *
   * The piece is the first filled slot (slots are index-for-index with
   * `state.bag`), which is the pocketed piece itself while the satchel holds one
   * thing — and the lessons that use this pocket exactly one.
   */
  private verbPos(button: Phaser.GameObjects.Container | null): { x: number; y: number } | null {
    if (!this.isOpen) return null;
    const target = button ?? (this.gameState.bag.length ? this.slots[0] : null);
    if (!target) return null;
    const m = target.getWorldTransformMatrix();
    return { x: m.tx, y: m.ty };
  }

  /** The give lesson's arrow target: the piece, then its Give plate. */
  getGivePos(): { x: number; y: number } | null {
    return this.verbPos(this.giveButton);
  }

  /** The sell lesson's arrow target: the piece, then its Sell plate. */
  getSellPos(): { x: number; y: number } | null {
    return this.verbPos(this.sellButton);
  }
}
