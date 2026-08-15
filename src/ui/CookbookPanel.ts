import Phaser from 'phaser';
import { chromeScale } from '../art/TextureFactory';
import { FONT } from '../art/design';
import { chainHiddenIn, IS_MOBILE, LIVE_GAME_HEIGHT, LIVE_GAME_WIDTH, num, panelFitScale, panelMobileScale, PALETTE } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import { reachableRecipeKeys, type AuditData } from '../core/availability';
import type { ChainsData } from '../core/types';
import { uiRegistry } from './theme';


/** One merge recipe the book can hold: N× (chain, fromTier) → (chain, toTier). */
interface Recipe {
  key: string;
  chain: string;
  fromTier: number;
  toTier: number;
  count: number;
  fromName: string;
  toName: string;
}

interface RecipeRow {
  recipe: Recipe;
  fromChip: Phaser.GameObjects.Graphics;
  toChip: Phaser.GameObjects.Graphics;
  fromIcon: Phaser.GameObjects.Image | null;
  toIcon: Phaser.GameObjects.Image | null;
  fromMark: Phaser.GameObjects.Text;
  toMark: Phaser.GameObjects.Text;
  caption: Phaser.GameObjects.Text;
  badge: Phaser.GameObjects.Container;
  arrow: Phaser.GameObjects.Graphics;
}

// Row geometry (ROW-local; every row lives in its own container so crowded
// books scale rows down UNIFORMLY instead of letting chips overlap).
// Desktop: two page columns, an open spread. Mobile: ONE column of magnified
// rows down a tall page — a spread halves the row width, and at phone width a
// halved row's caption is unreadable. The row internals stay authored; the
// row CONTAINER carries the magnification.
const CB = IS_MOBILE
  ? {
      frameKey: 'ui_panel_tall', frameY: 0,
      lozengeW: 1240, lozengeH: 190, lozengeY: -1900, titleY: -1806, titleFont: 88,
      subY: -1640, subFont: 56,
      closeX: 984, closeY: -1800, closeScale: 2.2,
      cols: 1, colX: 0, rowScale: 3, rowGap: 140 * 3,
      viewTop: -1440, viewH: 3200,
      counterY: 1830, counterFont: 60,
      seam: false
    }
  : {
      frameKey: 'ui_panel', frameY: 16,
      lozengeW: 660, lozengeH: 104, lozengeY: -436, titleY: -384, titleFont: 48,
      subY: -302, subFont: 26,
      closeX: 592, closeY: -392, closeScale: 1,
      cols: 2, colX: 310, rowScale: 1, rowGap: 140,
      viewTop: -278, viewH: 612,
      counterY: 384, counterFont: 28,
      seam: true
    };
const COL_X = CB.colX;
/**
 * A recipe is drawn at ONE size and the page scrolls.
 *
 * It used to squeeze instead: with more than six rows per column the gap
 * shrank and every row scaled down with it, so a full 24-recipe book rendered
 * at roughly half scale and nothing on it could be read. A book has pages —
 * shrinking the type until it all fits is the one thing a book never does.
 */
const ROW_GAP = CB.rowGap;
const CHIP = 96;
const CHIP_FROM_X = -212;
const CHIP_TO_X = 188;
const ICON_FIT = 72;

/** The scrolling window, in panel space: under the subtitle, above the count. */
const VIEW_TOP = CB.viewTop;
const VIEW_H = CB.viewH;
/** Centre of that window — where the viewport container sits. */
const VIEW_MID = VIEW_TOP + VIEW_H / 2;
/** First row's centre inside the scrolling content. */
const ROW_TOP = -VIEW_H / 2 + ROW_GAP / 2;
/** Past this much drag the gesture is a scroll, not a tap. */
const DRAG_SLOP = 12;

/**
 * The Emberkeep Cookbook — a discovery log of every merge recipe performed at
 * least once. Reads as an open two-page spread inside the standard cream
 * ui_panel: each line is [input chip + ×N badge] ──▶ [result chip], with the
 * item names beneath. Recipes not yet performed show as darkened "???" pages,
 * so the book doubles as a collection drive. MergeSystem owns discovery
 * (`state.discoveredRecipes` + `cookbook:discovered`); this panel only renders.
 */
export class CookbookPanel extends Phaser.GameObjects.Container {
  isOpen = false;
  private readonly offBus: Array<() => void> = [];
  private rows: RecipeRow[] = [];
  private viewport!: Phaser.GameObjects.Container;
  private rowsGroup!: Phaser.GameObjects.Container;
  private pageMask!: Phaser.GameObjects.Graphics;
  private scrollY = 0;
  private maxScroll = 0;
  private dragFrom: number | null = null;
  private dragScrollFrom = 0;
  private counter: Phaser.GameObjects.Text;
  /** Open/rest scale — >1 on mobile so the frame fills the portrait width. */
  private baseScale = 1;

  constructor(
    scene: Phaser.Scene,
    private bus: EventBus,
    private gameState: GameState,
    data: AuditData
  ) {
    super(scene, LIVE_GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2);
    const chains = data.chains;

    const dim = scene.add
      .rectangle(0, 0, LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, num(PALETTE.night), 0.45)
      .setInteractive();
    dim.on('pointerup', () => this.requestClose());
    this.add(dim);

    const panel = scene.add.image(0, CB.frameY, CB.frameKey).setScale(chromeScale(CB.frameKey));
    this.baseScale = IS_MOBILE ? panelFitScale(panel.displayWidth, panel.displayHeight) : panelMobileScale(panel.displayWidth);
    this.add(panel);

    // Title lozenge — gold, like the Keeper's Tasks header.
    const lozenge = scene.add.graphics();
    lozenge.fillStyle(num(PALETTE.gold), 1);
    lozenge.fillRoundedRect(-CB.lozengeW / 2, CB.lozengeY, CB.lozengeW, CB.lozengeH, CB.lozengeH / 2);
    lozenge.lineStyle(6, num(PALETTE.cream), 0.95);
    lozenge.strokeRoundedRect(-CB.lozengeW / 2, CB.lozengeY, CB.lozengeW, CB.lozengeH, CB.lozengeH / 2);
    this.add(lozenge);
    const title = scene.add
      .text(0, CB.titleY, 'Emberkeep Cookbook', {
        fontFamily: FONT.ui,
        fontSize: `${CB.titleFont}px`,
        fontStyle: 'bold',
        color: PALETTE.textBrown
      })
      .setOrigin(0.5)
      .setShadow(0, 3, 'rgba(255,255,255,0.5)', 3);
    this.add(title);

    this.add(
      scene.add
        .text(0, CB.subY, 'Every merge you discover is inscribed here', {
          fontFamily: FONT.ui,
          fontSize: `${CB.subFont}px`,
          fontStyle: 'italic',
          color: '#8A6248'
        })
        .setOrigin(0.5)
        .setAlpha(0.9)
    );

    // The book's centre seam — the panel reads as an open two-page spread.
    if (CB.seam) {
      const seam = scene.add.graphics();
      seam.lineStyle(3, num(PALETTE.goldShade), 0.25);
      seam.lineBetween(0, VIEW_TOP, 0, VIEW_TOP + VIEW_H);
      this.add(seam);
    }

    // Close button.
    const closeButton = scene.add.container(CB.closeX, CB.closeY);
    const closeBg = scene.add.circle(0, 0, 42, num(PALETTE.lava)).setStrokeStyle(6, num(PALETTE.cream));
    const closeX = scene.add
      .text(0, -2, '✕', { fontFamily: FONT.ui, fontSize: '44px', fontStyle: 'bold', color: PALETTE.goldAccent })
      .setOrigin(0.5);
    closeButton.add([closeBg, closeX]);
    closeButton.setScale(CB.closeScale);
    closeButton.setSize(96, 96);
    closeButton.setInteractive({ useHandCursor: true });
    closeButton.on('pointerup', () => this.requestClose());
    this.add(closeButton);

    // Scene-level input, gated on `isOpen`: a Zone big enough to catch the drag
    // would sit over the whole spread and swallow the close button's taps.
    scene.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.input.off(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
      scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
      scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
      scene.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
      scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
      this.pageMask.destroy();
    });

    // ---- Recipe rows: every mergeable tier pair, chains.json order. Two
    // columns split evenly; with more than 6 rows per column the gap squeezes
    // so the last row never collides with the counter line below. ----
    const recipes = this.enumerateRecipes(chains, reachableRecipeKeys(data));
    this.viewport = scene.add.container(0, VIEW_MID);
    this.rowsGroup = scene.add.container(0, 0);
    this.viewport.add(this.rowsGroup);
    this.add(this.viewport);
    // A geometry mask is drawn in WORLD space, so it is re-seated from the
    // viewport's own world transform whenever the panel opens or scales.
    this.pageMask = scene.make.graphics();
    this.rowsGroup.setMask(this.pageMask.createGeometryMask());

    // Row-major, left then right: scrolling then reveals recipes IN ORDER.
    // Filling column one before column two put recipe 1 beside recipe 13, and
    // a scroll moved both by twelve places at once.
    recipes.forEach((recipe, i) => {
      const x = CB.cols === 1 ? 0 : (i % 2 === 0 ? -1 : 1) * COL_X;
      const y = ROW_TOP + Math.floor(i / CB.cols) * ROW_GAP;
      this.rows.push(this.buildRow(scene, recipe, x, y));
    });
    const contentH = Math.ceil(recipes.length / CB.cols) * ROW_GAP;
    this.maxScroll = Math.max(0, contentH - VIEW_H);

    this.counter = scene.add
      .text(0, CB.counterY, '', {
        fontFamily: FONT.ui,
        fontSize: `${CB.counterFont}px`,
        fontStyle: 'bold',
        color: PALETTE.goldAccent
      })
      .setOrigin(0.5);
    this.add(this.counter);

    scene.add.existing(this);
    this.setVisible(false);

    uiRegistry.register(scene, 'panel.cookbook', 'Emberkeep Cookbook panel', 'Panels', this, {
      frame: panel,
      title
    });

    this.offBus.push(bus.on('cookbook:discovered', () => this.isOpen && this.refresh()));
  }

  /**
   * The recipes this book is allowed to promise: chain tiers with a next tier,
   * minus the Golden chain (lore — an altar fixture, never board-merged), minus
   * every chain withheld from this world, and minus any pair this chapter
   * cannot actually produce.
   *
   * A row the player can never fill sits as a permanent "· · ·" and caps
   * `n / N` below its own total, which reads as a bug rather than as content
   * not yet reached. `chainHiddenIn` covers a whole chain — wrong chapter
   * (HIDDEN_CHAINS) or wrong world (chains.json `world`); `discoverable`
   * (availability.reachableRecipeKeys) covers the partial ones — the two
   * Cracked Stones that are a prop rather than a chain, and Moonwater's third
   * tier, whose Dew Basin belongs to a later chapter. The book counts what is
   * reachable, and now it computes that instead of assuming it.
   */
  private enumerateRecipes(chains: ChainsData, discoverable: Set<string>): Recipe[] {
    const out: Recipe[] = [];
    for (const chain of chains.chains) {
      if (chain.id === 'golden_egg' || chainHiddenIn(chain, this.gameState.worldId)) continue;
      for (const tier of chain.tiers) {
        const next = chain.tiers.find((t) => t.tier === tier.tier + 1);
        if (!next) continue;
        if (!discoverable.has(`${chain.id}:${tier.tier}>${next.tier}`)) continue;
        // Per-TIER recipe override first (2 Houses → Manor, 2 Dragons → Adult),
        // then the chain-level one, then the global rule.
        const count = tier.merge?.group ?? chain.merge?.group ?? chains.mergeRule.minGroup;
        out.push({
          key: `${chain.id}:${tier.tier}>${next.tier}`,
          chain: chain.id,
          fromTier: tier.tier,
          toTier: next.tier,
          count,
          fromName: tier.name,
          toName: next.name
        });
      }
    }
    return out;
  }

  /** One cookbook line: [chip ×N] ──▶ [chip], caption beneath the arrow.
   *  Everything is ROW-LOCAL, so a row can be seated anywhere on the page. */
  private buildRow(scene: Phaser.Scene, recipe: Recipe, x: number, y: number): RecipeRow {
    const rowC = scene.add.container(x, y).setScale(CB.rowScale);
    this.rowsGroup.add(rowC);

    const fromChip = scene.add.graphics();
    const toChip = scene.add.graphics();
    const arrow = scene.add.graphics();
    rowC.add([fromChip, toChip, arrow]);

    const mkIcon = (tier: number, cx: number): Phaser.GameObjects.Image | null => {
      const key = `item_${recipe.chain}_${tier}`;
      if (!scene.textures.exists(key)) return null;
      const icon = scene.add.image(cx, -8, key);
      // Normalise every icon to the chip's inner box — a recipe book wants a
      // tidy grid, not board-relative sizes.
      icon.setScale(ICON_FIT / Math.max(icon.width, icon.height));
      rowC.add(icon);
      return icon;
    };
    const fromIcon = mkIcon(recipe.fromTier, CHIP_FROM_X);
    const toIcon = mkIcon(recipe.toTier, CHIP_TO_X);

    // "?" marks for undiscovered pages (also the fallback if art is missing).
    const mkMark = (cx: number): Phaser.GameObjects.Text => {
      const mark = scene.add
        .text(cx, -8, '?', {
          fontFamily: FONT.ui,
          fontSize: '54px',
          fontStyle: 'bold',
          color: PALETTE.goldAccent
        })
        .setOrigin(0.5)
        .setVisible(false);
      rowC.add(mark);
      return mark;
    };
    const fromMark = mkMark(CHIP_FROM_X);
    const toMark = mkMark(CHIP_TO_X);

    // One caption per row, written in the chip-free gap under the arrow —
    // "Dragon Ruby → Red Egg". Rows never collide vertically this way.
    const caption = scene.add
      .text((CHIP_FROM_X + CHIP_TO_X) / 2, 26, '', {
        fontFamily: FONT.ui,
        fontSize: '24px',
        fontStyle: 'bold',
        color: PALETTE.textBrown
      })
      .setOrigin(0.5, 0);
    rowC.add(caption);

    // ×N badge riding the input chip's bottom edge.
    const badge = scene.add.container(CHIP_FROM_X + 34, 34);
    const badgeBg = scene.add.graphics();
    badgeBg.fillStyle(num(PALETTE.gold), 1);
    badgeBg.fillRoundedRect(-33, -19, 66, 38, 19);
    badgeBg.lineStyle(3, num(PALETTE.cream), 0.9);
    badgeBg.strokeRoundedRect(-33, -19, 66, 38, 19);
    const badgeText = scene.add
      .text(0, -1, `×${recipe.count}`, {
        fontFamily: FONT.ui,
        fontSize: '28px',
        fontStyle: 'bold',
        color: PALETTE.textBrown
      })
      .setOrigin(0.5);
    badge.add([badgeBg, badgeText]);
    rowC.add(badge);

    return { recipe, fromChip, toChip, fromIcon, toIcon, fromMark, toMark, caption, badge, arrow };
  }

  /** Repaint one row for its discovered/undiscovered state (row-local). */
  private paintRow(row: RecipeRow, discovered: boolean): void {
    const chip = (g: Phaser.GameObjects.Graphics, cx: number, size: number): void => {
      const half = size / 2;
      g.clear();
      if (discovered) {
        g.fillStyle(num(PALETTE.cream), 1);
        g.fillRoundedRect(cx - half, -8 - half, size, size, 20);
        g.fillStyle(0xefe0c8, 1);
        g.fillRoundedRect(cx - half + 4, -8 - half + 4, size - 8, size - 8, 16);
        g.lineStyle(4, num(PALETTE.goldShade), 0.55);
      } else {
        g.fillStyle(num(PALETTE.plumShade), 0.88);
        g.fillRoundedRect(cx - half, -8 - half, size, size, 20);
        g.lineStyle(4, num(PALETTE.plumShade), 1);
      }
      g.strokeRoundedRect(cx - half, -8 - half, size, size, 20);
    };
    chip(row.fromChip, CHIP_FROM_X, CHIP);
    chip(row.toChip, CHIP_TO_X, CHIP + 8); // the result chip is the payoff — a touch larger

    // Long tapered arrow: dark under-stroke, gold on top. Raised a touch so
    // the caption reads comfortably beneath it.
    const a = row.arrow;
    const x1 = CHIP_FROM_X + CHIP / 2 + 26;
    const x2 = CHIP_TO_X - (CHIP + 8) / 2 - 14;
    const ay = -22;
    a.clear();
    a.setAlpha(discovered ? 1 : 0.3);
    a.fillStyle(num(PALETTE.plumShade), 1);
    a.fillRoundedRect(x1 - 2, ay - 7, x2 - x1 - 16, 14, 7);
    a.fillTriangle(x2 - 26, ay - 16, x2 - 26, ay + 16, x2 + 2, ay);
    a.fillStyle(num(discovered ? PALETTE.gold : PALETTE.plum), 1);
    a.fillRoundedRect(x1, ay - 4, x2 - x1 - 20, 8, 4);
    a.fillTriangle(x2 - 24, ay - 11, x2 - 24, ay + 11, x2 - 3, ay);

    row.fromIcon?.setVisible(discovered);
    row.toIcon?.setVisible(discovered);
    row.fromMark.setVisible(!discovered || !row.fromIcon);
    row.toMark.setVisible(!discovered || !row.toIcon);
    row.fromMark.setAlpha(discovered ? 1 : 0.55);
    row.toMark.setAlpha(discovered ? 1 : 0.55);
    // Single-line caption, scaled down if a long pair would spill onto the
    // chips (e.g. "Ripe Emberberry Plant").
    row.caption.setText(discovered ? `${row.recipe.fromName}  →  ${row.recipe.toName}` : '· · ·');
    row.caption.setScale(Math.min(1, 262 / Math.max(1, row.caption.width)));
    row.caption.setAlpha(discovered ? 1 : 0.4);
    row.badge.setVisible(discovered);
  }

  private refresh(): void {
    let found = 0;
    for (const row of this.rows) {
      const discovered = this.gameState.discoveredRecipes.includes(row.recipe.key);
      if (discovered) found += 1;
      this.paintRow(row, discovered);
    }
    this.counter.setText(`${found} / ${this.rows.length} recipes discovered`);
  }

  teardown(): void {
    this.offBus.forEach((off) => off());
    this.offBus.length = 0;
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.refresh();
    this.setScroll(0);
    this.scene.tweens.killTweensOf(this);
    this.setVisible(true).setAlpha(0).setScale(this.baseScale * 0.92);
    this.seatMask();
    this.scene.tweens.add({
      targets: this,
      alpha: 1,
      scale: this.baseScale,
      duration: 200,
      ease: 'Back.easeOut',
      onUpdate: () => this.seatMask()
    });
    this.bus.emit('ui:cookbook_opened', {
      discovered: this.gameState.discoveredRecipes.length
    });
  }

  /* ------------------------------- scrolling ------------------------------ */

  private setScroll(y: number): void {
    this.scrollY = Phaser.Math.Clamp(y, 0, this.maxScroll);
    this.rowsGroup.setY(-this.scrollY);
  }

  /** Re-seat the clip rect from the viewport's live WORLD transform — the panel
   *  is centred, scaled by `panelMobileScale` and scaled again by its own
   *  open tween, and a mask in local units clips the wrong band through all
   *  three. Both page columns share one window, so one rect covers the spread. */
  private seatMask(): void {
    const m = this.viewport.getWorldTransformMatrix();
    const h = VIEW_H * m.scaleY;
    const w = LIVE_GAME_WIDTH * m.scaleX; // only Y clips here
    this.pageMask.clear();
    this.pageMask.fillStyle(0xffffff, 1);
    this.pageMask.fillRect(m.tx - w / 2, m.ty - h / 2, w, h);
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
    const scale = this.viewport.getWorldTransformMatrix().scaleY || 1;
    this.setScroll(this.dragScrollFrom - dy / scale);
  };

  private onPointerUp = (): void => {
    this.dragFrom = null;
  };

  requestClose(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scale: this.baseScale * 0.94,
      duration: 150,
      ease: 'Sine.easeIn',
      onComplete: () => this.setVisible(false)
    });
    this.bus.emit('ui:cookbook_closed', {
      discovered: this.gameState.discoveredRecipes.length
    });
  }

  /** World position of the ✕ button (the tutorial's close-the-book arrow). */
  getClosePos(): { x: number; y: number } {
    // Offset is panel-LOCAL — scale it by the panel's own scale (>1 on mobile)
    // so the tutorial pointer lands on the ✕ instead of a shrunken/enlarged gap.
    return { x: this.x + CB.closeX * this.scaleX, y: this.y + CB.closeY * this.scaleY };
  }
}
