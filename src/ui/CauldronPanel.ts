import Phaser from 'phaser';
import { FONT, INK } from '../art/design';
import { GAME_WIDTH, LIVE_GAME_HEIGHT, num, panelMobileScale } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameContext } from '../core/Context';
import type { CauldronRecipeConfig } from '../core/types';
import { ensureTextures } from '../core/lazyTextures';
import { uiRegistry } from './theme';


/* Recipe list (left column), in the 2560-space. Seven rows fit the frame
 * without scrolling — the roster is authored, not player-grown. */
const LIST_X = -640;
const LIST_TOP = -400;
const ROW_W = 700;
const ROW_H = 104;
const ROW_GAP = 122;
const ROW_ICON = 80;

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
    super(scene, GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2);
    this.selectedId = this.recipes[0]?.id ?? '';

    this.dim = scene.add
      .rectangle(0, 0, GAME_WIDTH, LIVE_GAME_HEIGHT, num(INK.scrim), 0.62)
      .setInteractive();
    this.dim.on('pointerup', () => this.requestClose());

    const frame = scene.add.image(0, 40, 'ui_store_panel');
    this.baseScale = panelMobileScale(frame.width);

    this.titleBg = scene.add.graphics();
    this.titleText = scene.add
      .text(0, -586, "SELYNA'S CAULDRON", {
        fontFamily: FONT.ui, fontSize: '64px', fontStyle: 'bold', color: INK.onField
      })
      .setOrigin(0.5)
      .setShadow(0, 5, 'rgba(36,27,34,0.55)', 6);

    const close = scene.add.container(956, -540);
    this.closeBtn = close;
    const closeBg = scene.add.image(0, 6, 'ui_btn_round').setScale(0.92).setTint(num(INK.field));
    const closeX = scene.add
      .text(0, -2, '✕', { fontFamily: FONT.ui, fontSize: '54px', fontStyle: 'bold', color: INK.onFieldGold })
      .setOrigin(0.5);
    close.add([closeBg, closeX]);
    close.setSize(120, 120).setInteractive({ useHandCursor: true });
    close.on('pointerover', () => close.setScale(1.08));
    close.on('pointerout', () => close.setScale(1));
    close.on('pointerup', () => this.requestClose());

    this.listGroup = scene.add.container(LIST_X, 0);
    this.detailGroup = scene.add.container(DETAIL_X, 0);

    this.add([this.dim, frame, this.titleBg, this.titleText, close, this.listGroup, this.detailGroup]);
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
    });

    uiRegistry.register(scene, 'panel.cauldron', "Selyna's Cauldron panel", 'Panels', this, {
      frame,
      title: this.titleText,
      recipes: this.listGroup,
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
      ease: 'Back.easeOut'
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

      row.setSize(ROW_W, ROW_H).setInteractive({ useHandCursor: true });
      row.on('pointerup', () => {
        if (this.selectedId === recipe.id) return;
        this.selectedId = recipe.id;
        this.refresh();
      });
      this.listGroup.add(row);
    });
  }

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
