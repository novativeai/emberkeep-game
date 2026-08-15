import Phaser from 'phaser';
import { FONT, INK } from '../art/design';
import { IS_MOBILE, LIVE_GAME_HEIGHT, LIVE_GAME_WIDTH, num, panelFitScale, panelMobileScale } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameContext } from '../core/Context';
import type { CauldronRecipeConfig } from '../core/types';
import { ensureTextures } from '../core/lazyTextures';
import { uiRegistry } from './theme';


/** Past this much drag the gesture is a scroll, not a pick. */
const DRAG_SLOP = 12;
const BAR_W = 10;

/**
 * TWO layouts, one pot. Desktop is the classic alchemy spread — the recipe
 * ledger a column on the LEFT, the selected formula explained on the right.
 * A phone is a portrait sheet on the tall frame and the same two panes STACK:
 * the formula (art, story, ingredient cards, BREW) reads first at the top, and
 * the ledger scrolls below it — depth is what portrait has to spend.
 *
 * The list SCROLLS on both. The roster is authored rather than player-grown,
 * but authored does not mean small: the book is nineteen recipes now, and the
 * fixed column that once "fit the frame" was drawing rows through the floor.
 * Numbers live in the frame's RENDERED space (painter logical ×RES) — the tall
 * frame renders 2360×4080, the landscape one 2120×1320.
 */
const CY = IS_MOBILE
  ? {
      frameKey: 'ui_panel_tall', frameY: 0,
      bannerY: -1904, titleY: -1800, titleFont: 150, closeX: 984, closeY: -1800, closeScale: 2.2,
      listX: 0, rowW: 2050, rowH: 200, rowGap: 236, rowIcon: 150, rowFont: 68,
      listViewTop: 340, listViewH: 1480,
      detailX: 0, detailW: 2080,
      artY: -1400, artFit: 440,
      nameY: -1130, nameFont: 100,
      flavorY: -1030, flavorFont: 58,
      useY: -850, useFont: 62,
      ingW: 470, ingH: 580, ingGap: 48, ingIcon: 280, ingY: -400,
      ingCountFont: 72, ingNameFont: 44, haveFont: 56,
      brewY: 190, brewScaleX: 2.3, brewScaleY: 2.1, brewFont: 92
    }
  : {
      frameKey: 'ui_store_panel', frameY: 40,
      bannerY: -640, titleY: -586, titleFont: 64, closeX: 956, closeY: -540, closeScale: 1,
      listX: -640, rowW: 700, rowH: 104, rowGap: 122, rowIcon: 80, rowFont: 36,
      listViewTop: -458, listViewH: 1090,
      detailX: 350, detailW: 1180,
      artY: -350, artFit: 230,
      nameY: -212, nameFont: 52,
      flavorY: -158, flavorFont: 28,
      useY: -62, useFont: 30,
      ingW: 236, ingH: 290, ingGap: 26, ingIcon: 140, ingY: 150,
      ingCountFont: 36, ingNameFont: 22, haveFont: 28,
      brewY: 520, brewScaleX: 1.15, brewScaleY: 1.05, brewFont: 46
    };

/** Centre of the clipped window — where the viewport container sits. */
const LIST_VIEW_MID = CY.listViewTop + CY.listViewH / 2;
/** First row's centre inside the scrolling content. */
const LIST_TOP = -CY.listViewH / 2 + CY.rowGap / 2;
/** The scroll rail down the column's right edge — the only cue that the book
 *  runs past its window, so it is drawn whenever there is anywhere to go. */
const BAR_X = CY.rowW / 2 + 26;

/**
 * Selyna's Cauldron — the brew screen behind the pot in the runevault hub.
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
  /** Clipped window the recipe column scrolls inside. */
  private listViewport!: Phaser.GameObjects.Container;
  private listMask!: Phaser.GameObjects.Graphics;
  /** Track + thumb, drawn OUTSIDE `listGroup` so the mask never eats it. */
  private listBar!: Phaser.GameObjects.Graphics;
  private scrollY = 0;
  private maxScroll = 0;
  private dragFrom: number | null = null;
  private dragScrollFrom = 0;
  /** True once a pointer has travelled past DRAG_SLOP — read by the row's tap
   *  handler so a scroll that ends on a recipe does not also select it. */
  private dragged = false;
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
    this.dim.on('pointerup', () => this.requestClose());

    const frame = scene.add.image(0, CY.frameY, CY.frameKey);
    this.baseScale = IS_MOBILE ? panelFitScale(frame.width, frame.height) : panelMobileScale(frame.width);

    this.titleBg = scene.add.graphics();
    this.titleText = scene.add
      .text(0, CY.titleY, "SELYNA'S CAULDRON", {
        fontFamily: FONT.ui, fontSize: `${CY.titleFont}px`, fontStyle: 'bold', color: INK.onField
      })
      .setOrigin(0.5)
      .setShadow(0, 5, 'rgba(36,27,34,0.55)', 6);

    const close = scene.add.container(CY.closeX, CY.closeY);
    this.closeBtn = close;
    const closeBg = scene.add.image(0, 6, 'ui_btn_round').setScale(0.92).setTint(num(INK.field));
    const closeX = scene.add
      .text(0, -2, '✕', { fontFamily: FONT.ui, fontSize: '54px', fontStyle: 'bold', color: INK.onFieldGold })
      .setOrigin(0.5);
    close.add([closeBg, closeX]);
    close.setScale(CY.closeScale);
    close.setSize(120, 120).setInteractive({ useHandCursor: true });
    close.on('pointerover', () => close.setScale(CY.closeScale * 1.08));
    close.on('pointerout', () => close.setScale(CY.closeScale));
    close.on('pointerup', () => this.requestClose());

    this.listViewport = scene.add.container(CY.listX, LIST_VIEW_MID);
    this.listGroup = scene.add.container(0, 0);
    this.listBar = scene.add.graphics();
    this.listViewport.add([this.listGroup, this.listBar]);
    // Geometry masks live in WORLD space, so this is re-seated from the
    // container's own world transform whenever the panel moves or scales.
    this.listMask = scene.make.graphics();
    this.listGroup.setMask(this.listMask.createGeometryMask());
    this.detailGroup = scene.add.container(CY.detailX, 0);

    this.add([this.dim, frame, this.titleBg, this.titleText, close, this.listViewport, this.detailGroup]);
    scene.add.existing(this);
    this.setVisible(false);
    this.drawBanner(this.titleText.width + 200);

    // Counts go stale the moment anything touches the Bag — including our own
    // brew, whose consume/bank land before `cauldron:brewed` does.
    this.offBus.push(bus.on('bag:changed', () => this.isOpen && this.refresh()));
    this.offBus.push(bus.on('cauldron:brewed', ({ output }) => this.isOpen && this.celebrate(output)));
    this.offBus.push(bus.on('cauldron:brew_failed', () => this.isOpen && this.refuse()));

    // Scene-level input rather than an interactive Zone over the column: a Zone
    // big enough to catch the drag would sit on top of every row and swallow
    // the taps that pick them. The handlers gate on `isOpen` instead.
    scene.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const off of this.offBus) off();
      this.offBus = [];
      scene.input.off(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
      scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
      scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
      scene.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
      scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
      this.listMask.destroy();
    });

    uiRegistry.register(scene, 'panel.cauldron', "Selyna's Cauldron panel", 'Panels', this, {
      frame,
      title: this.titleText,
      recipes: this.listViewport,
      detail: this.detailGroup
    });
  }

  private get recipes(): readonly CauldronRecipeConfig[] {
    return this.ctx.systems.cauldron.recipes;
  }

  /** Tour accessor — the ✕'s page-space anchor for Selyna's pointer. */
  getClosePos(): { x: number; y: number } | null {
    if (!this.visible) return null;
    const m = this.closeBtn.getWorldTransformMatrix();
    return { x: m.tx, y: m.ty };
  }

  open(): void {
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
      onUpdate: () => this.seatListMask()
    });
    this.bus.emit('ui:cauldron_toggled', { open: true });
  }

  requestClose(): void {
    if (!this.isOpen) return;
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
    const w = Math.max(IS_MOBILE ? 1240 : 620, width);
    const y = CY.bannerY;
    const bh = IS_MOBILE ? 208 : 104;
    const g = this.titleBg;
    g.clear();
    g.fillStyle(num(INK.goldDeep), 1);
    g.fillRoundedRect(-w / 2, y + 10, w, bh, bh / 3);
    g.fillStyle(num(INK.field), 1);
    g.fillRoundedRect(-w / 2, y, w, bh, bh / 3);
    g.lineStyle(6, num(INK.gold), 1);
    g.strokeRoundedRect(-w / 2, y, w, bh, bh / 3);
    g.fillStyle(num(INK.fieldLift), 0.5);
    g.fillRoundedRect(-w / 2 + 14, y + 8, w - 28, bh / 3, bh / 6);
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
      const row = this.scene.add.container(0, LIST_TOP + i * CY.rowGap);
      const g = this.scene.add.graphics();
      const rr = Math.min(26, CY.rowH / 2 - 2) * (IS_MOBILE ? 2 : 1);
      g.fillStyle(num(INK.goldDeep), 1);
      g.fillRoundedRect(-CY.rowW / 2, -CY.rowH / 2 + 6, CY.rowW, CY.rowH, rr);
      g.fillStyle(num(selected ? INK.fieldLift : INK.fieldDeep), 1);
      g.fillRoundedRect(-CY.rowW / 2, -CY.rowH / 2, CY.rowW, CY.rowH, rr);
      g.lineStyle(selected ? 6 : 4, num(selected ? INK.gold : INK.goldDeep), 1);
      g.strokeRoundedRect(-CY.rowW / 2, -CY.rowH / 2, CY.rowW, CY.rowH, rr);
      row.add(g);

      const key = this.itemKey(recipe.output.chain, recipe.output.tier);
      if (this.scene.textures.exists(key)) {
        const icon = this.scene.add.image(-CY.rowW / 2 + CY.rowIcon * 0.85, 0, key);
        icon.setScale(Math.min(CY.rowIcon / icon.width, CY.rowIcon / icon.height));
        if (!brewable) icon.setAlpha(0.55);
        row.add(icon);
      }
      row.add(
        this.scene.add
          .text(-CY.rowW / 2 + CY.rowIcon * 1.6, 0, this.nameOf(recipe.output.chain, recipe.output.tier), {
            fontFamily: FONT.ui, fontSize: `${CY.rowFont}px`, fontStyle: 'bold',
            color: selected ? INK.onField : brewable ? INK.onFieldGold : INK.onFieldDim
          })
          .setOrigin(0, 0.5)
      );
      // The quiet readiness cue: a lit dot on rows the Bag can pay for right
      // now, so the ledger can be scanned without selecting every line.
      if (brewable) {
        const dot = this.scene.add.graphics();
        dot.fillStyle(num(INK.gain), 1);
        dot.fillCircle(CY.rowW / 2 - 48, 0, IS_MOBILE ? 18 : 10);
        row.add(dot);
      }

      row.setSize(CY.rowW, CY.rowH).setInteractive({ useHandCursor: true });
      row.on('pointerup', () => {
        if (this.dragged) return; // the player was scrolling the book, not picking
        if (this.selectedId === recipe.id) return;
        this.selectedId = recipe.id;
        this.refresh();
      });
      this.listGroup.add(row);
    });
    const contentH = this.recipes.length * CY.rowGap;
    this.maxScroll = Math.max(0, contentH - CY.listViewH);
    this.setScroll(this.scrollY); // re-clamp: the roster may have shrunk
    this.seatListMask();
  }

  /* ------------------------------- scrolling ------------------------------ */

  private setScroll(y: number): void {
    this.scrollY = Phaser.Math.Clamp(y, 0, this.maxScroll);
    this.listGroup.setY(-this.scrollY);
    this.drawScrollBar();
  }

  /** Rail + thumb, sized by how much of the book the window holds and seated by
   *  how far down it we are. Nothing to scroll ⇒ nothing drawn. */
  private drawScrollBar(): void {
    const g = this.listBar;
    g.clear();
    if (this.maxScroll <= 0) return;
    const top = -CY.listViewH / 2;
    const contentH = CY.listViewH + this.maxScroll;
    const thumbH = Math.max(90, CY.listViewH * (CY.listViewH / contentH));
    const thumbY = top + (CY.listViewH - thumbH) * (this.scrollY / this.maxScroll);
    g.fillStyle(num(INK.fieldDeep), 0.85);
    g.fillRoundedRect(BAR_X - BAR_W / 2, top, BAR_W, CY.listViewH, BAR_W / 2);
    g.fillStyle(num(INK.gold), 0.9);
    g.fillRoundedRect(BAR_X - BAR_W / 2, thumbY, BAR_W, thumbH, BAR_W / 2);
  }

  /** Re-cut the clip rect from the viewport's live world transform — the panel
   *  is centred, scaled by `panelMobileScale`, and scaled again by its own
   *  open/close tween, and a mask left in local units clips the wrong band. */
  private seatListMask(): void {
    const m = this.listViewport.getWorldTransformMatrix();
    const w = (CY.rowW + 60) * m.scaleX;
    const h = CY.listViewH * m.scaleY;
    this.listMask.clear();
    this.listMask.fillStyle(0xffffff, 1);
    this.listMask.fillRect(m.tx - w / 2, m.ty - h / 2, w, h);
  }

  /** Is the pointer over the recipe column? Pointer coords arrive in the same
   *  2560-space the UI is authored in, so this is a plain rect test. */
  private overList(p: Phaser.Input.Pointer): boolean {
    const m = this.listViewport.getWorldTransformMatrix();
    // Wide enough to take in the rail, so a wheel over the scrollbar scrolls.
    const w = (CY.rowW + 80) * m.scaleX;
    const h = CY.listViewH * m.scaleY;
    return (
      p.x >= m.tx - w / 2 && p.x <= m.tx + w / 2 && p.y >= m.ty - h / 2 && p.y <= m.ty + h / 2
    );
  }

  private onWheel = (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number): void => {
    if (!this.isOpen || this.maxScroll <= 0 || !this.overList(p)) return;
    this.setScroll(this.scrollY + dy);
  };

  private onPointerDown = (p: Phaser.Input.Pointer): void => {
    if (!this.isOpen || !this.overList(p)) return;
    this.dragFrom = p.y;
    this.dragScrollFrom = this.scrollY;
    this.dragged = false;
  };

  private onPointerMove = (p: Phaser.Input.Pointer): void => {
    if (this.dragFrom === null || this.maxScroll <= 0) return;
    const dy = p.y - this.dragFrom;
    if (Math.abs(dy) > DRAG_SLOP) this.dragged = true;
    const scale = this.listViewport.getWorldTransformMatrix().scaleY || 1;
    this.setScroll(this.dragScrollFrom - dy / scale);
  };

  private onPointerUp = (): void => {
    this.dragFrom = null;
    // Cleared a frame later so the row's pointerup, which fires on this same
    // event, still sees that the gesture was a drag.
    this.scene.time.delayedCall(0, () => (this.dragged = false));
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
      const art = this.scene.add.image(0, CY.artY, outKey);
      art.setScale(Math.min(CY.artFit / art.width, CY.artFit / art.height));
      this.detailGroup.add(art);
    }
    this.detailGroup.add(
      this.scene.add
        .text(0, CY.nameY, this.nameOf(recipe.output.chain, recipe.output.tier), {
          fontFamily: FONT.ui, fontSize: `${CY.nameFont}px`, fontStyle: 'bold', color: INK.onFieldGold
        })
        .setOrigin(0.5)
        .setShadow(0, 4, 'rgba(36,27,34,0.55)', 5)
    );
    this.detailGroup.add(
      this.scene.add
        .text(0, CY.flavorY, recipe.flavor, {
          fontFamily: FONT.ui, fontSize: `${CY.flavorFont}px`, fontStyle: 'italic', color: INK.onFieldDim,
          align: 'center', wordWrap: { width: CY.detailW - 120 }
        })
        .setOrigin(0.5, 0)
    );
    this.detailGroup.add(
      this.scene.add
        .text(0, CY.useY, recipe.use, {
          fontFamily: FONT.ui, fontSize: `${CY.useFont}px`, color: INK.onField,
          align: 'center', wordWrap: { width: CY.detailW - 120 }
        })
        .setOrigin(0.5, 0)
    );

    // Ingredient cards — the required item, the count it wants, and beneath the
    // card how many the Bag holds, in red when it is not enough.
    const total = recipe.inputs.length * CY.ingW + (recipe.inputs.length - 1) * CY.ingGap;
    recipe.inputs.forEach((input, i) => {
      const x = -total / 2 + CY.ingW / 2 + i * (CY.ingW + CY.ingGap);
      const have = cauldron.haveOf(input.chain, input.tier);
      const enough = have >= input.count;
      const card = this.scene.add.container(x, CY.ingY);

      const g = this.scene.add.graphics();
      const ir = IS_MOBILE ? 44 : 24;
      g.fillStyle(num(INK.goldDeep), 1);
      g.fillRoundedRect(-CY.ingW / 2, -CY.ingH / 2 + 6, CY.ingW, CY.ingH, ir);
      g.fillStyle(num(INK.fieldDeep), 1);
      g.fillRoundedRect(-CY.ingW / 2, -CY.ingH / 2, CY.ingW, CY.ingH, ir);
      g.lineStyle(4, num(enough ? INK.gold : INK.spendDeep), 1);
      g.strokeRoundedRect(-CY.ingW / 2, -CY.ingH / 2, CY.ingW, CY.ingH, ir);
      card.add(g);

      const key = this.itemKey(input.chain, input.tier);
      if (this.scene.textures.exists(key)) {
        const icon = this.scene.add.image(0, -CY.ingH * 0.16, key);
        icon.setScale(Math.min(CY.ingIcon / icon.width, CY.ingIcon / icon.height));
        if (!enough) icon.setAlpha(0.6);
        card.add(icon);
      }
      card.add(
        this.scene.add
          .text(0, CY.ingH * 0.19, this.nameOf(input.chain, input.tier), {
            fontFamily: FONT.ui, fontSize: `${CY.ingNameFont}px`, color: INK.onFieldDim,
            align: 'center', wordWrap: { width: CY.ingW - 28 }
          })
          .setOrigin(0.5, 0)
      );
      card.add(
        this.scene.add
          .text(0, CY.ingH / 2 - CY.ingCountFont, `×${input.count}`, {
            fontFamily: FONT.ui, fontSize: `${CY.ingCountFont}px`, fontStyle: 'bold', color: INK.onFieldGold
          })
          .setOrigin(0.5)
      );
      // The have-count, under the card. This is the one place a shortfall
      // speaks, and it speaks in red.
      card.add(
        this.scene.add
          .text(0, CY.ingH / 2 + CY.haveFont * 1.05, `in bag: ${have}`, {
            fontFamily: FONT.ui, fontSize: `${CY.haveFont}px`, fontStyle: 'bold',
            color: enough ? INK.onFieldDim : INK.spendDeep
          })
          .setOrigin(0.5)
      );
      this.detailGroup.add(card);
    });

    this.buildBrewButton(cauldron.canBrew(recipe.id));
  }

  private buildBrewButton(canBrew: boolean): void {
    this.brewBtn = this.scene.add.container(0, CY.brewY);
    this.brewBg = this.scene.add.image(0, 0, 'ui_btn_green').setScale(CY.brewScaleX, CY.brewScaleY);
    this.brewLabel = this.scene.add
      .text(0, -4, 'BREW', {
        fontFamily: FONT.ui, fontSize: `${CY.brewFont}px`, fontStyle: 'bold', color: '#fff6e0',
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
      .text(this.x + CY.detailX * this.scaleX, this.y + (CY.brewY - 90) * this.scaleY,
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
