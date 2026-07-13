import Phaser from 'phaser';
import { GAME_WIDTH, LIVE_GAME_HEIGHT, num, panelMobileScale, PALETTE } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { ChainsData } from '../core/types';
import { uiRegistry } from './theme';

const FONT = 'Trebuchet MS, Verdana, sans-serif';

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
// Two page columns; up to six recipes per page render at full size.
const COL_X = 310;
const ROW_TOP = -238;
const ROW_BOTTOM = 322; // last row centre must stay above the counter line
const ROW_GAP = 102;
const CHIP = 78;
const CHIP_FROM_X = -196;
const CHIP_TO_X = 158;
const ICON_FIT = 56;

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
  private counter: Phaser.GameObjects.Text;
  /** Open/rest scale — >1 on mobile so the frame fills the portrait width. */
  private baseScale = 1;

  constructor(
    scene: Phaser.Scene,
    private bus: EventBus,
    private gameState: GameState,
    chains: ChainsData
  ) {
    super(scene, GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2);

    const dim = scene.add
      .rectangle(0, 0, GAME_WIDTH, LIVE_GAME_HEIGHT, num(PALETTE.night), 0.45)
      .setInteractive();
    dim.on('pointerup', () => this.requestClose());
    this.add(dim);

    const panel = scene.add.image(0, 16, 'ui_panel');
    this.baseScale = panelMobileScale(panel.width);
    this.add(panel);

    // Title lozenge — gold, like the Keeper's Tasks header.
    const lozenge = scene.add.graphics();
    lozenge.fillStyle(num(PALETTE.gold), 1);
    lozenge.fillRoundedRect(-330, -436, 660, 104, 52);
    lozenge.lineStyle(6, num(PALETTE.cream), 0.95);
    lozenge.strokeRoundedRect(-330, -436, 660, 104, 52);
    this.add(lozenge);
    const title = scene.add
      .text(0, -384, 'Emberkeep Cookbook', {
        fontFamily: FONT,
        fontSize: '48px',
        fontStyle: 'bold',
        color: PALETTE.textBrown
      })
      .setOrigin(0.5)
      .setShadow(0, 3, 'rgba(255,255,255,0.5)', 3);
    this.add(title);

    this.add(
      scene.add
        .text(0, -302, 'Every merge you discover is inscribed here', {
          fontFamily: FONT,
          fontSize: '26px',
          fontStyle: 'italic',
          color: '#8A6248'
        })
        .setOrigin(0.5)
        .setAlpha(0.9)
    );

    // The book's centre seam — the panel reads as an open two-page spread.
    const seam = scene.add.graphics();
    seam.lineStyle(3, num(PALETTE.goldShade), 0.25);
    seam.lineBetween(0, -268, 0, 330);
    this.add(seam);

    // Close button.
    const closeButton = scene.add.container(592, -392);
    const closeBg = scene.add.circle(0, 0, 42, num(PALETTE.lava)).setStrokeStyle(6, num(PALETTE.cream));
    const closeX = scene.add
      .text(0, -2, '✕', { fontFamily: FONT, fontSize: '44px', fontStyle: 'bold', color: PALETTE.cream })
      .setOrigin(0.5);
    closeButton.add([closeBg, closeX]);
    closeButton.setSize(96, 96);
    closeButton.setInteractive({ useHandCursor: true });
    closeButton.on('pointerup', () => this.requestClose());
    this.add(closeButton);

    // ---- Recipe rows: every mergeable tier pair, chains.json order. Two
    // columns split evenly; with more than 6 rows per column the gap squeezes
    // so the last row never collides with the counter line below. ----
    const recipes = this.enumerateRecipes(chains);
    const half = Math.ceil(recipes.length / 2);
    // Crowded book: shrink the gap to spread rows across the page, and shrink
    // each ROW by the same ratio so chips/captions can never overlap.
    const gap = half <= 6 ? ROW_GAP : Math.floor((ROW_BOTTOM - ROW_TOP) / (half - 1));
    const rowScale = Math.min(1, gap / ROW_GAP);
    recipes.forEach((recipe, i) => {
      const x = (i < half ? -1 : 1) * COL_X;
      const y = ROW_TOP + (i % half) * gap;
      this.rows.push(this.buildRow(scene, recipe, x, y, rowScale));
    });

    this.counter = scene.add
      .text(0, 384, '', {
        fontFamily: FONT,
        fontSize: '28px',
        fontStyle: 'bold',
        color: PALETTE.goldShade
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

  /** All merge recipes the game holds: chain tiers with a next tier. The
   *  Golden chain is lore (altar fixture, never board-merged) — skipped. */
  private enumerateRecipes(chains: ChainsData): Recipe[] {
    const out: Recipe[] = [];
    for (const chain of chains.chains) {
      if (chain.id === 'golden_egg') continue;
      for (const tier of chain.tiers) {
        const next = chain.tiers.find((t) => t.tier === tier.tier + 1);
        if (!next) continue;
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
   *  Everything is ROW-LOCAL inside one container scaled by `rowScale`, so a
   *  crowded book shrinks rows uniformly instead of overlapping them. */
  private buildRow(scene: Phaser.Scene, recipe: Recipe, x: number, y: number, rowScale: number): RecipeRow {
    const rowC = scene.add.container(x, y);
    rowC.setScale(rowScale);
    this.add(rowC);

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
          fontFamily: FONT,
          fontSize: '44px',
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
      .text((CHIP_FROM_X + CHIP_TO_X) / 2, 14, '', {
        fontFamily: FONT,
        fontSize: '18px',
        fontStyle: 'bold',
        color: PALETTE.textBrown
      })
      .setOrigin(0.5, 0);
    rowC.add(caption);

    // ×N badge riding the input chip's bottom edge.
    const badge = scene.add.container(CHIP_FROM_X + 26, 26);
    const badgeBg = scene.add.graphics();
    badgeBg.fillStyle(num(PALETTE.gold), 1);
    badgeBg.fillRoundedRect(-27, -15, 54, 30, 15);
    badgeBg.lineStyle(3, num(PALETTE.cream), 0.9);
    badgeBg.strokeRoundedRect(-27, -15, 54, 30, 15);
    const badgeText = scene.add
      .text(0, -1, `×${recipe.count}`, {
        fontFamily: FONT,
        fontSize: '22px',
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
    this.scene.tweens.killTweensOf(this);
    this.setVisible(true).setAlpha(0).setScale(this.baseScale * 0.92);
    this.scene.tweens.add({ targets: this, alpha: 1, scale: this.baseScale, duration: 200, ease: 'Back.easeOut' });
    this.bus.emit('ui:cookbook_opened', {
      discovered: this.gameState.discoveredRecipes.length
    });
  }

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
    return { x: this.x + 592 * this.scaleX, y: this.y - 392 * this.scaleY };
  }
}
