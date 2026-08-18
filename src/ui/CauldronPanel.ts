import Phaser from 'phaser';
import { FONT, INK } from '../art/design';
import {
  LIVE_GAME_HEIGHT,
  LIVE_GAME_WIDTH,
  num,
  panelMobileScale,
  TAP_SCALE
} from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameContext } from '../core/Context';
import type { CauldronRecipeConfig } from '../core/types';
import { ensureTextures } from '../core/lazyTextures';
import { uiRegistry } from './theme';


/* Recipe list (left column), in the 2560-space.
 *
 * It used to say "seven rows fit the frame without scrolling — the roster is
 * authored, not player-grown". The roster grew: nineteen recipes at a 122-unit
 * pitch is 2196 units of list inside a 1320-tall frame, so the last two thirds
 * of it hung off the panel and down the board. An authored count is exactly the
 * kind of assumption that stops being true quietly.
 *
 * So the list SCROLLS, on the same geometry-mask + drag/wheel shape the
 * Cookbook already uses for the same reason. Nothing about a row changed. */
const LIST_X = -640;
const ROW_W = 700;
const ROW_H = 104;
const ROW_GAP = 122;
const ROW_ICON = 80;
/** The scrolling window, in panel space: under the banner, inside the frame. */
const VIEW_TOP = -470;
const VIEW_H = 1030;
/** Centre of that window — where the viewport container sits. */
const VIEW_MID = VIEW_TOP + VIEW_H / 2;
/** First row's centre inside the scrolling content. */
const LIST_TOP = -VIEW_H / 2 + ROW_GAP / 2;
/** Past this much drag the gesture is a scroll, not a tap. */
const DRAG_SLOP = 12;

/* Detail column (right of the list). */
const DETAIL_X = 350;
const DETAIL_W = 1180;

/* Ingredient cards under the description. */
const ING_W = 236;
const ING_H = 290;
const ING_GAP = 26;
const ING_ICON = 140;
const ING_Y = 150;

const BREW_Y = 520;

/**
 * Selyna's Cauldron — the brew screen behind the pot in the Runevault hub.
 *
 * Layout follows the classic alchemy-screen grammar (a recipe ledger on the
 * left, the selected formula explained on the right, its ingredients as cards
 * with have-counts): the LIST answers "what can this pot make", the DETAIL
 * answers "what would it cost me right now". Every count repaints live off
 * `bag:changed`, and a shortfall is exactly one signal — the have-number turns
 * ember-red. The panel never mutates: it emits `cauldron:brew` and repaints on
 * the facts that come back.
 */
export class CauldronPanel extends Phaser.GameObjects.Container {
  isOpen = false;
  private dim: Phaser.GameObjects.Rectangle;
  private titleText: Phaser.GameObjects.Text;
  private titleBg: Phaser.GameObjects.Graphics;
  private listGroup: Phaser.GameObjects.Container;
  private listViewport: Phaser.GameObjects.Container;
  private listMask: Phaser.GameObjects.Graphics;
  private scrollY = 0;
  private maxScroll = 0;
  /** Pointer y where a drag began, and the scroll offset it began from — null
   *  when no drag is in flight. */
  private dragFrom: number | null = null;
  private dragScrollFrom = 0;
  private detailGroup: Phaser.GameObjects.Container;
  private brewBtn!: Phaser.GameObjects.Container;
  private brewBg!: Phaser.GameObjects.Image;
  private brewLabel!: Phaser.GameObjects.Text;
  private selectedId: string;
  private baseScale = 1;
  private offBus: (() => void)[] = [];
  private closeBtn!: Phaser.GameObjects.Container;

  constructor(
    scene: Phaser.Scene,
    private bus: EventBus,
    private ctx: GameContext
  ) {
    super(scene, LIVE_GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2);
    this.selectedId = this.recipes[0]?.id ?? '';

    this.dim = scene.add
      .rectangle(0, 0, LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, num(INK.scrim), 0.62)
      .setInteractive();
    // ONLY THE ✕ CLOSES — the dim swallows the tap but no longer dismisses.
    // A thumb scrolling the body releases ON the dim, and tap-outside-to-close
    // read that as "shut". See the long note in `ShopPanel.ts`.

    const frame = scene.add.image(0, 40, 'ui_store_panel');
    this.baseScale = panelMobileScale(frame.width);

    this.titleBg = scene.add.graphics();
    this.titleText = scene.add
      .text(0, -586, "SELYNA'S CAULDRON", {
        fontFamily: FONT.ui, fontSize: '64px', fontStyle: 'bold', color: INK.onField
      })
      .setOrigin(0.5)
      .setShadow(0, 5, 'rgba(36,27,34,0.55)', 6);

    // Inside the plate (x -1016..1016, y -588..652), at the size and seat the
    // Store's ✕ uses — the two panels share this frame, so they share its corner.
    const close = scene.add.container(964, -538);
    this.closeBtn = close;
    const closeBg = scene.add.image(0, 6, 'ui_btn_round_royal').setScale(0.58);
    const closeX = scene.add
      .text(0, -2, '✕', { fontFamily: FONT.ui, fontSize: '40px', fontStyle: 'bold', color: INK.onFieldGold })
      .setOrigin(0.5);
    close.add([closeBg, closeX]);
    // A THUMB, NOT A CURSOR. 96 units of hit box is ~15 real pixels on a
    // handset — well under the 44px every platform asks for — so in portrait
    // the whole disc steps up by `TAP_SCALE`. `1` on desktop, where the seat
    // inside the plate's corner was measured and must not move.
    close.setSize(96, 96).setScale(TAP_SCALE).setInteractive({ useHandCursor: true });
    close.on('pointerover', () => close.setScale(TAP_SCALE * 1.08));
    close.on('pointerout', () => close.setScale(TAP_SCALE));
    close.on('pointerup', () => this.requestClose());

    // The list lives inside a VIEWPORT so it can scroll: the viewport is fixed
    // in the frame, `listGroup` slides inside it, and a geometry mask cuts it to
    // the window. Same three-part shape as the Cookbook's page.
    this.listViewport = scene.add.container(LIST_X, VIEW_MID);
    this.listGroup = scene.add.container(0, 0);
    this.listViewport.add(this.listGroup);
    // A geometry mask is drawn in WORLD space, so it is re-seated from the
    // viewport's own world transform whenever the panel opens or scales.
    this.listMask = scene.make.graphics();
    this.listGroup.setMask(this.listMask.createGeometryMask());
    this.detailGroup = scene.add.container(DETAIL_X, 0);

    this.add([this.dim, frame, this.titleBg, this.titleText, close, this.listViewport, this.detailGroup]);
    scene.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onWheel);
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp);
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp);
    scene.add.existing(this);
    this.setVisible(false);
    this.drawBanner(this.titleText.width + 200);

    // Counts go stale the moment anything touches the Bag — including our own
    // brew, whose consume/bank land before `cauldron:brewed` does.
    this.offBus.push(bus.on('bag:changed', () => this.isOpen && this.refresh()));
    this.offBus.push(bus.on('cauldron:brewed', ({ output }) => this.isOpen && this.celebrate(output)));
    this.offBus.push(bus.on('cauldron:brew_failed', () => this.isOpen && this.refuse()));

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const off of this.offBus) off();
      this.offBus = [];
      // Scene-level input listeners outlive the panel unless they are taken
      // off by hand — the bus subscriptions above are not the only thing here
      // holding a reference to a dead container.
      scene.input.off(Phaser.Input.Events.POINTER_WHEEL, this.onWheel);
      scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown);
      scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove);
      scene.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp);
      scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp);
    });

    uiRegistry.register(scene, 'panel.cauldron', "Selyna's Cauldron panel", 'Panels', this, {
      frame,
      title: this.titleText,
      recipes: this.listGroup,
      detail: this.detailGroup
    });
  }

  /** The EARNED pages only (CauldronSystem.available) — a formula the player
   *  has not unlocked is not greyed, it is simply not in the book. */
  private get recipes(): readonly CauldronRecipeConfig[] {
    return this.ctx.systems.cauldron.available();
  }

  /** Ids that were new when THIS visit opened — they wear the star for the
   *  whole visit, and their arrival fade plays exactly once (`introPlayed`
   *  guards the bag:changed rebuilds from replaying it). */
  private freshIds = new Set<string>();
  private introPlayed = false;

  /** Tour accessor — the ✕'s page-space anchor for Selyna's pointer. */
  getClosePos(): { x: number; y: number } | null {
    if (!this.visible) return null;
    const m = this.closeBtn.getWorldTransformMatrix();
    return { x: m.tx, y: m.ty };
  }

  open(): void {
    // What is NEW is decided at the door and held for the visit: the star and
    // the arrival fade belong to the moment the book opens, not to every
    // bag-change rebuild while it is open.
    this.freshIds = new Set(
      this.recipes.filter((r) => this.ctx.systems.cauldron.isNew(r.id)).map((r) => r.id)
    );
    this.introPlayed = false;
    // Egg and ingredient art spans every world's chains, and PreloadScene only
    // loads what the ACTIVE world shows — fetch the rest on the way in, exactly
    // as the Store does for its shelf.
    ensureTextures(this.scene, this.ctx, this.artKeys(), () => {
      if (this.isOpen) this.refresh();
    });
    this.refresh();
    this.isOpen = true;
    this.setVisible(true).setAlpha(0).setScale(this.baseScale * 0.92);
    this.scene.tweens.add({
      targets: this,
      alpha: 1,
      scale: this.baseScale,
      duration: 200,
      ease: 'Back.easeOut',
      // The mask follows the open tween: it is cut in WORLD space, so a rect
      // seated at the 0.92 start scale would clip the wrong band for the whole
      // animation and leave a visibly short list once it settled.
      onUpdate: () => this.seatMask(),
      onComplete: () => this.seatMask()
    });
    this.seatMask();
    this.bus.emit('ui:cauldron_toggled', { open: true });
  }

  requestClose(): void {
    if (!this.isOpen) return;
    // One visit is one reveal: everything the open book showed counts as seen,
    // so the next open is a settled ledger — no star, no fade.
    this.ctx.systems.cauldron.markAllSeen();
    this.freshIds.clear();
    this.isOpen = false;
    this.bus.emit('ui:cauldron_toggled', { open: false });
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scale: this.baseScale * 0.94,
      duration: 150,
      ease: 'Sine.easeIn',
      onComplete: () => this.setVisible(false)
    });
  }

  /** Every item texture any recipe can show — outputs and inputs both. */
  private artKeys(): string[] {
    const keys = new Set<string>();
    for (const r of this.recipes) {
      keys.add(this.itemKey(r.output.chain, r.output.tier));
      for (const i of r.inputs) keys.add(this.itemKey(i.chain, i.tier));
    }
    return [...keys];
  }

  private itemKey(chain: string, tier: number): string {
    return `item_${chain}_${tier}`;
  }

  private nameOf(chain: string, tier: number): string {
    return (
      this.ctx.data.chains.chains
        .find((c) => c.id === chain)
        ?.tiers.find((t) => t.tier === tier)?.name ?? chain
    );
  }

  private drawBanner(width: number): void {
    const w = Math.max(620, width);
    const y = -640;
    const g = this.titleBg;
    g.clear();
    g.fillStyle(num(INK.goldDeep), 1);
    g.fillRoundedRect(-w / 2, y + 10, w, 104, 34);
    g.fillStyle(num(INK.field), 1);
    g.fillRoundedRect(-w / 2, y, w, 104, 34);
    g.lineStyle(6, num(INK.gold), 1);
    g.strokeRoundedRect(-w / 2, y, w, 104, 34);
    g.fillStyle(num(INK.fieldLift), 0.5);
    g.fillRoundedRect(-w / 2 + 14, y + 8, w - 28, 34, 18);
  }

  private refresh(): void {
    this.buildList();
    this.buildDetail();
  }

  /* ------------------------------ recipe list ----------------------------- */

  private buildList(): void {
    this.listGroup.removeAll(true);
    this.recipes.forEach((recipe, i) => {
      const selected = recipe.id === this.selectedId;
      const brewable = this.ctx.systems.cauldron.canBrew(recipe.id);
      const row = this.scene.add.container(0, LIST_TOP + i * ROW_GAP);
      const g = this.scene.add.graphics();
      g.fillStyle(num(INK.goldDeep), 1);
      g.fillRoundedRect(-ROW_W / 2, -ROW_H / 2 + 6, ROW_W, ROW_H, 26);
      g.fillStyle(num(selected ? INK.fieldLift : INK.fieldDeep), 1);
      g.fillRoundedRect(-ROW_W / 2, -ROW_H / 2, ROW_W, ROW_H, 26);
      g.lineStyle(selected ? 6 : 4, num(selected ? INK.gold : INK.goldDeep), 1);
      g.strokeRoundedRect(-ROW_W / 2, -ROW_H / 2, ROW_W, ROW_H, 26);
      row.add(g);

      const key = this.itemKey(recipe.output.chain, recipe.output.tier);
      if (this.scene.textures.exists(key)) {
        const icon = this.scene.add.image(-ROW_W / 2 + 66, 0, key);
        icon.setScale(Math.min(ROW_ICON / icon.width, ROW_ICON / icon.height));
        if (!brewable) icon.setAlpha(0.55);
        row.add(icon);
      }
      row.add(
        this.scene.add
          .text(-ROW_W / 2 + 126, 0, this.nameOf(recipe.output.chain, recipe.output.tier), {
            fontFamily: FONT.ui, fontSize: '36px', fontStyle: 'bold',
            color: selected ? INK.onField : brewable ? INK.onFieldGold : INK.onFieldDim
          })
          .setOrigin(0, 0.5)
      );
      // The quiet readiness cue: a lit dot on rows the Bag can pay for right
      // now, so the ledger can be scanned without selecting every line.
      if (brewable) {
        const dot = this.scene.add.graphics();
        dot.fillStyle(num(INK.gain), 1);
        dot.fillCircle(ROW_W / 2 - 48, 0, 10);
        row.add(dot);
      }

      // A page earned since the last visit wears the STAR STICKER for this
      // whole visit: a pulsing gold star with its exclamation, seated at the
      // row's right edge — the name keeps the left, so the eye reads
      // "Iron Cap … ★!" as one line. The pulse is the sticker's own; the row
      // underneath stays an ordinary, tappable row.
      if (this.freshIds.has(recipe.id)) {
        const star = this.scene.add
          .text(ROW_W / 2 - 96, 0, '★', { fontFamily: FONT.ui, fontSize: '44px', color: INK.gold })
          .setOrigin(0.5);
        const bang = this.scene.add
          .text(ROW_W / 2 - 56, 0, '!', {
            fontFamily: FONT.ui, fontSize: '40px', fontStyle: 'bold', color: INK.gold
          })
          .setOrigin(0.5);
        row.add([star, bang]);
        this.scene.tweens.add({
          targets: [star, bang],
          scale: { from: 1, to: 1.28 },
          alpha: { from: 1, to: 0.72 },
          duration: 520,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        });
      }

      row.setSize(ROW_W, ROW_H).setInteractive({ useHandCursor: true });
      row.on('pointerup', () => {
        if (this.selectedId === recipe.id) return;
        this.selectedId = recipe.id;
        this.refresh();
      });
      this.listGroup.add(row);

      // The ARRIVAL: a new page rises into place from just below its seat,
      // fading up — once, on the visit's first build. Bag-change rebuilds
      // while the book is open reseat rows instantly (`introPlayed`), and the
      // next visit opens settled: the close marked everything seen.
      if (!this.introPlayed && this.freshIds.has(recipe.id)) {
        const seatY = row.y;
        row.setAlpha(0).setY(seatY + 56);
        this.scene.tweens.add({
          targets: row,
          alpha: 1,
          y: seatY,
          duration: 460,
          delay: 140,
          ease: 'Cubic.easeOut'
        });
      }
    });
    this.introPlayed = true;
    // Content taller than the window is what there is to scroll through; a
    // roster that fits leaves this at 0 and the handlers all no-op.
    const contentH = this.recipes.length * ROW_GAP;
    this.maxScroll = Math.max(0, contentH - VIEW_H);
    this.setScroll(this.scrollY); // re-clamp: the roster can shrink under us
  }

  /* ------------------------------- scrolling ------------------------------ */

  private setScroll(y: number): void {
    this.scrollY = Phaser.Math.Clamp(y, 0, this.maxScroll);
    this.listGroup.setY(-this.scrollY);
  }

  /** Re-seat the clip rect from the viewport's live WORLD transform — the panel
   *  is centred, scaled by `panelMobileScale` and scaled again by its own open
   *  tween, and a mask in local units clips the wrong band through all three. */
  private seatMask(): void {
    const m = this.listViewport.getWorldTransformMatrix();
    const h = VIEW_H * m.scaleY;
    const w = (ROW_W + 80) * m.scaleX;
    this.listMask.clear();
    this.listMask.fillStyle(0xffffff, 1);
    this.listMask.fillRect(m.tx - w / 2, m.ty - h / 2, w, h);
  }

  private onWheel = (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number): void => {
    if (!this.isOpen || this.maxScroll <= 0) return;
    this.setScroll(this.scrollY + dy);
  };

  private onPointerDown = (p: Phaser.Input.Pointer): void => {
    if (!this.isOpen) return;
    this.dragFrom = p.y;
    this.dragScrollFrom = this.scrollY;
  };

  private onPointerMove = (p: Phaser.Input.Pointer): void => {
    if (this.dragFrom === null || this.maxScroll <= 0) return;
    const dy = p.y - this.dragFrom;
    if (Math.abs(dy) <= DRAG_SLOP) return;
    const scale = this.listViewport.getWorldTransformMatrix().scaleY || 1;
    this.setScroll(this.dragScrollFrom - dy / scale);
  };

  private onPointerUp = (): void => {
    this.dragFrom = null;
  };

  /* ----------------------------- detail column ---------------------------- */

  private buildDetail(): void {
    this.detailGroup.removeAll(true);
    const recipe = this.ctx.systems.cauldron.recipe(this.selectedId);
    if (!recipe) return;
    const cauldron = this.ctx.systems.cauldron;

    // The output, held up like the thing it is: art first, name under it.
    const outKey = this.itemKey(recipe.output.chain, recipe.output.tier);
    if (this.scene.textures.exists(outKey)) {
      const art = this.scene.add.image(0, -350, outKey);
      art.setScale(Math.min(230 / art.width, 230 / art.height));
      this.detailGroup.add(art);
    }
    this.detailGroup.add(
      this.scene.add
        .text(0, -212, this.nameOf(recipe.output.chain, recipe.output.tier), {
          fontFamily: FONT.ui, fontSize: '52px', fontStyle: 'bold', color: INK.onFieldGold
        })
        .setOrigin(0.5)
        .setShadow(0, 4, 'rgba(36,27,34,0.55)', 5)
    );
    this.detailGroup.add(
      this.scene.add
        .text(0, -158, recipe.flavor, {
          fontFamily: FONT.ui, fontSize: '28px', fontStyle: 'italic', color: INK.onFieldDim,
          align: 'center', wordWrap: { width: DETAIL_W - 120 }
        })
        .setOrigin(0.5, 0)
    );
    this.detailGroup.add(
      this.scene.add
        .text(0, -62, recipe.use, {
          fontFamily: FONT.ui, fontSize: '30px', color: INK.onField,
          align: 'center', wordWrap: { width: DETAIL_W - 120 }
        })
        .setOrigin(0.5, 0)
    );

    // Ingredient cards — the required item, the count it wants, and beneath the
    // card how many the Bag holds, in red when it is not enough.
    const total = recipe.inputs.length * ING_W + (recipe.inputs.length - 1) * ING_GAP;
    recipe.inputs.forEach((input, i) => {
      const x = -total / 2 + ING_W / 2 + i * (ING_W + ING_GAP);
      const have = cauldron.haveOf(input.chain, input.tier);
      const enough = have >= input.count;
      const card = this.scene.add.container(x, ING_Y);

      const g = this.scene.add.graphics();
      g.fillStyle(num(INK.goldDeep), 1);
      g.fillRoundedRect(-ING_W / 2, -ING_H / 2 + 6, ING_W, ING_H, 24);
      g.fillStyle(num(INK.fieldDeep), 1);
      g.fillRoundedRect(-ING_W / 2, -ING_H / 2, ING_W, ING_H, 24);
      g.lineStyle(4, num(enough ? INK.gold : INK.spendDeep), 1);
      g.strokeRoundedRect(-ING_W / 2, -ING_H / 2, ING_W, ING_H, 24);
      card.add(g);

      const key = this.itemKey(input.chain, input.tier);
      if (this.scene.textures.exists(key)) {
        const icon = this.scene.add.image(0, -46, key);
        icon.setScale(Math.min(ING_ICON / icon.width, ING_ICON / icon.height));
        if (!enough) icon.setAlpha(0.6);
        card.add(icon);
      }
      card.add(
        this.scene.add
          .text(0, 56, this.nameOf(input.chain, input.tier), {
            fontFamily: FONT.ui, fontSize: '22px', color: INK.onFieldDim,
            align: 'center', wordWrap: { width: ING_W - 28 }
          })
          .setOrigin(0.5, 0)
      );
      card.add(
        this.scene.add
          .text(0, ING_H / 2 - 34, `×${input.count}`, {
            fontFamily: FONT.ui, fontSize: '36px', fontStyle: 'bold', color: INK.onFieldGold
          })
          .setOrigin(0.5)
      );
      // The have-count, under the card. This is the one place a shortfall
      // speaks, and it speaks in red.
      card.add(
        this.scene.add
          .text(0, ING_H / 2 + 42, `in bag: ${have}`, {
            fontFamily: FONT.ui, fontSize: '28px', fontStyle: 'bold',
            color: enough ? INK.onFieldDim : INK.spendDeep
          })
          .setOrigin(0.5)
      );
      this.detailGroup.add(card);
    });

    this.buildBrewButton(cauldron.canBrew(recipe.id));
  }

  private buildBrewButton(canBrew: boolean): void {
    this.brewBtn = this.scene.add.container(0, BREW_Y);
    this.brewBg = this.scene.add.image(0, 0, 'ui_btn_green').setScale(1.15, 1.05);
    this.brewLabel = this.scene.add
      .text(0, -4, 'BREW', {
        fontFamily: FONT.ui, fontSize: '46px', fontStyle: 'bold', color: '#fff6e0',
        stroke: '#1f3a14', strokeThickness: 6
      })
      .setOrigin(0.5)
      .setLetterSpacing(6);
    this.brewBtn.add([this.brewBg, this.brewLabel]);
    if (canBrew) {
      this.brewBg.setInteractive({ useHandCursor: true });
      this.brewBg.on('pointerover', () => this.brewBtn.setScale(1.05));
      this.brewBg.on('pointerout', () => this.brewBtn.setScale(1));
      this.brewBg.on('pointerup', () => {
        this.brewBtn.setScale(1);
        this.bus.emit('cauldron:brew', { recipeId: this.selectedId });
      });
    } else {
      // Not merely un-clickable: visibly asleep. The red have-counts already
      // say why.
      this.brewBg.setTint(num(INK.fieldDeep));
      this.brewBtn.setAlpha(0.6);
    }
    this.detailGroup.add(this.brewBtn);
  }

  /* -------------------------------- feedback ------------------------------ */

  /** The brew landed: name the thing over the pot area, let the counts (which
   *  `bag:changed` already repainted) speak for the rest. */
  private celebrate(output: { chain: string; tier: number; count: number }): void {
    const float = this.scene.add
      .text(this.x + DETAIL_X * this.scaleX, this.y + (BREW_Y - 90) * this.scaleY,
        `+${output.count} ${this.nameOf(output.chain, output.tier)}`, {
          fontFamily: FONT.ui, fontSize: '44px', fontStyle: 'bold', color: INK.onFieldGold,
          stroke: 'rgba(36,27,34,0.8)', strokeThickness: 6
        })
      .setOrigin(0.5)
      .setDepth(this.depth + 1);
    this.scene.tweens.add({
      targets: float,
      y: float.y - 90,
      alpha: 0,
      duration: 1100,
      ease: 'Sine.easeOut',
      onComplete: () => float.destroy()
    });
  }

  /** A refusal shakes the button — the red counts already carry the reason. */
  private refuse(): void {
    this.scene.tweens.add({
      targets: this.brewBtn,
      x: this.brewBtn.x + 10,
      duration: 45,
      yoyo: true,
      repeat: 3
    });
  }
}
