import Phaser from 'phaser';
import { FONT, INK } from '../art/design';
import {
  IS_MOBILE,
  LIVE_GAME_HEIGHT,
  LIVE_GAME_WIDTH,
  num,
  panelMobileScale,
  TAP_SCALE
} from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import { recipeHelp, type RecipeHelp } from '../core/recipeTree';
import type { ChainsData } from '../core/types';
import { uiRegistry } from './theme';

/* ------------------------------ the sheet ------------------------------ *
 *
 * Layout in hi-res panel space (RES = 2), all of it relative to the frame so
 * re-scaling the sheet is one number. The rows are a LADDER read downward: the
 * wanted piece at the top, then what makes it, then what makes that, and last
 * the thing on the board to go and touch.
 */
/** `ui_quest_panel` is paint(660, 510) => 1320 x 1020 game units. The help is a
 *  short sheet, so it wears the same frame at three-fifths height. */
const FRAME_SCALE_X = 0.62;
const FRAME_SCALE_Y = 0.6;
const FRAME_HALF_W = 660 * FRAME_SCALE_X;
const FRAME_HALF_H = 510 * FRAME_SCALE_Y;

const TITLE_Y = -FRAME_HALF_H + 96;
const TITLE_PX = 40;
const TITLE_WRAP = 2 * FRAME_HALF_W - 200;
const GOAL_ICON_Y = TITLE_Y + 106;
/** Every icon on the sheet contain-fits ONE box, the way the Cookbook's rows
 *  do — a ladder of pieces wants a tidy column, not board-relative sizes. */
const GOAL_ICON_FIT = 116;
const ROW_ICON_FIT = 76;

const ROWS_TOP = GOAL_ICON_Y + 96;
const ROW_GAP = 92;
const ROW_ICON_X = -FRAME_HALF_W + 118;
const ROW_TEXT_X = ROW_ICON_X + 74;
const ROW_TEXT_PX = 30;
const ROW_TEXT_WRAP = 2 * FRAME_HALF_W - 260;
/** The still-missing figure, hard right, where the eye goes for a number. */
const ROW_COUNT_X = FRAME_HALF_W - 78;
const ROW_COUNT_PX = 34;

const FOOT_PX = 28;
/** The ✕, in panel space — inside the frame's painted corner. */
const CLOSE_X = FRAME_HALF_W - 92;
const CLOSE_Y = -FRAME_HALF_H + 88;

/** One drawn line of the ladder. Kept so a re-open can repaint in place rather
 *  than rebuild — the sheet is opened and shut far more often than it changes. */
interface HelpRow {
  root: Phaser.GameObjects.Container;
  icon: Phaser.GameObjects.Image;
  text: Phaser.GameObjects.Text;
  count: Phaser.GameObjects.Text;
}

/**
 * THE `?` SHEET — "how do I make that?", answered for one quest.
 *
 * It draws a `RecipeHelp` (src/core/recipeTree.ts) and holds no opinion of its
 * own: every number here comes from that module, so what the sheet says and
 * what the merge does cannot drift apart. Opened by `ui:recipe_help`, which the
 * quest cards emit for the piece they are showing at that moment.
 *
 * The rows are pooled to the deepest ladder ever drawn and hidden rather than
 * destroyed, because this panel is opened and shut constantly and a rebuild per
 * open is a Text object per rung per open.
 */
export class RecipeHelpPanel extends Phaser.GameObjects.Container {
  private isOpenNow = false;
  private baseScale = 1;
  private title: Phaser.GameObjects.Text;
  private goalIcon: Phaser.GameObjects.Image;
  private rows: HelpRow[] = [];
  private rowsGroup: Phaser.GameObjects.Container;
  private foot: Phaser.GameObjects.Text;
  private offBus: Array<() => void> = [];

  constructor(
    scene: Phaser.Scene,
    bus: EventBus,
    private gameState: GameState,
    private chains: ChainsData
  ) {
    super(scene, LIVE_GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2);

    // A scrim that SWALLOWS taps without dismissing: a thumb that scrolls the
    // Ledger underneath and releases here would otherwise shut the help it just
    // opened. Only the ✕ closes — the same rule every other panel follows.
    const dim = scene.add
      .rectangle(0, 0, LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, num(INK.scrim), 0.5)
      .setInteractive();
    this.add(dim);

    const frame = scene.add.image(0, 0, 'ui_quest_panel').setScale(FRAME_SCALE_X, FRAME_SCALE_Y);
    this.baseScale = panelMobileScale(frame.width * FRAME_SCALE_X);
    this.add(frame);

    this.title = scene.add
      .text(0, TITLE_Y, '', {
        fontFamily: FONT.ui,
        fontSize: `${TITLE_PX}px`,
        fontStyle: 'bold',
        color: INK.onFieldGold,
        align: 'center',
        wordWrap: { width: TITLE_WRAP }
      })
      .setOrigin(0.5);
    this.add(this.title);

    this.goalIcon = scene.add.image(0, GOAL_ICON_Y, '__DEFAULT').setVisible(false);
    this.add(this.goalIcon);

    this.rowsGroup = scene.add.container(0, 0);
    this.add(this.rowsGroup);

    this.foot = scene.add
      .text(0, FRAME_HALF_H - 84, '', {
        fontFamily: FONT.ui,
        fontSize: `${FOOT_PX}px`,
        fontStyle: 'bold',
        color: INK.onFieldGold,
        align: 'center',
        wordWrap: { width: TITLE_WRAP }
      })
      .setOrigin(0.5);
    this.add(this.foot);

    // The same royal disc every panel wears. A panel that draws its own Close
    // is a panel the player has to re-learn.
    const closeButton = scene.add.container(CLOSE_X, CLOSE_Y);
    const closeBg = scene.add.image(0, 0, 'ui_btn_round_royal').setScale(0.56);
    const closeX = scene.add
      .text(0, -2, '✕', {
        fontFamily: FONT.ui,
        fontSize: '36px',
        fontStyle: 'bold',
        color: INK.goldHi
      })
      .setOrigin(0.5);
    closeButton.add([closeBg, closeX]);
    // A THUMB, NOT A CURSOR — the hit box keeps the whole tap budget in local
    // units while the disc itself takes a calmer visual step, exactly as the
    // Cookbook's does.
    const closeVisual = IS_MOBILE ? 1.4 : 1;
    closeButton.setSize((96 * TAP_SCALE) / closeVisual, (96 * TAP_SCALE) / closeVisual);
    closeButton.setScale(closeVisual);
    closeButton.setInteractive({ useHandCursor: true });
    closeButton.on('pointerup', () => this.close());
    this.add(closeButton);

    scene.add.existing(this);
    this.setVisible(false);

    uiRegistry.register(scene, 'panel.recipe_help', 'Recipe help sheet', 'Panels', this, {
      frame,
      title: this.title
    });

    this.offBus.push(bus.on('ui:recipe_help', (goal) => this.open(goal)));
    // A sheet standing open over a Ledger that has just closed is furniture.
    this.offBus.push(bus.on('ui:ledger_toggled', ({ open }) => !open && this.close()));
    // UIScene tears its panels down explicitly (BusLifetime.spec enforces it);
    // this is for the UI Builder's scene, which builds the chrome to theme it
    // and has no such list.
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  get isOpen(): boolean {
    return this.isOpenNow;
  }

  teardown(): void {
    this.offBus.forEach((off) => off());
    this.offBus.length = 0;
  }

  /**
   * Show the ladder for one goal. Does NOTHING when the rule has nothing to
   * say — the cards already hide their `?` on that answer, and this is the
   * second lock on the same door: an empty sheet is worse than no sheet.
   */
  open(goal: { chain: string; tier: number; count: number }): void {
    const help = recipeHelp(
      this.chains,
      goal,
      (chain, tier) => this.gameState.countItemsAnywhere(chain, tier),
      this.gameState.worldId
    );
    if (!help) return;
    this.paint(help);
    this.isOpenNow = true;
    this.scene.tweens.killTweensOf(this);
    this.setVisible(true).setAlpha(0).setScale(this.baseScale * 0.92);
    this.scene.tweens.add({
      targets: this,
      alpha: 1,
      scale: this.baseScale,
      duration: 180,
      ease: 'Back.easeOut'
    });
  }

  close(): void {
    if (!this.isOpenNow) return;
    this.isOpenNow = false;
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scale: this.baseScale * 0.94,
      duration: 140,
      ease: 'Sine.easeIn',
      onComplete: () => this.setVisible(false)
    });
  }

  /** Contain-fit an icon into one box, and say whether the art was there at
   *  all. A help panel must never draw the magenta unknown-key square: a sheet
   *  that is supposed to explain the game cannot be the thing that looks
   *  broken, so a missing key hides the icon and the words carry the line. */
  private fitIcon(icon: Phaser.GameObjects.Image, key: string, box: number): boolean {
    if (!this.scene.textures.exists(key)) {
      icon.setVisible(false);
      return false;
    }
    icon.setTexture(key);
    icon.setScale(box / Math.max(icon.width, icon.height));
    icon.setVisible(true);
    return true;
  }

  private acquireRow(index: number): HelpRow {
    const existing = this.rows[index];
    if (existing) return existing;
    const root = this.scene.add.container(0, 0);
    const icon = this.scene.add.image(ROW_ICON_X, 0, '__DEFAULT');
    const text = this.scene.add
      .text(ROW_TEXT_X, 0, '', {
        fontFamily: FONT.ui,
        fontSize: `${ROW_TEXT_PX}px`,
        color: INK.onField,
        wordWrap: { width: ROW_TEXT_WRAP }
      })
      .setOrigin(0, 0.5);
    const count = this.scene.add
      .text(ROW_COUNT_X, 0, '', {
        fontFamily: FONT.ui,
        fontSize: `${ROW_COUNT_PX}px`,
        fontStyle: 'bold',
        color: INK.onFieldGold
      })
      .setOrigin(1, 0.5);
    root.add([icon, text, count]);
    this.rowsGroup.add(root);
    const row: HelpRow = { root, icon, text, count };
    this.rows[index] = row;
    return row;
  }

  /**
   * THE LADDER, in words.
   *
   * One line per rung, read downward: "3 × Flame Gem  →  Radiant Gem", the
   * still-missing figure hard right. Then the source: the thing on the board to
   * go and tap. The rung the player has already filled says so quietly rather
   * than vanishing — a line that disappears as you make progress takes the
   * explanation with it.
   */
  private paint(help: RecipeHelp): void {
    this.title.setText(
      help.goal.count > 1 ? `${help.goal.count} × ${help.goal.name}` : help.goal.name
    );
    this.fitIcon(this.goalIcon, `item_${help.goal.chain}_${help.goal.tier}`, GOAL_ICON_FIT);

    let line = 0;
    // The rungs BELOW the goal: each says what makes the one above it. The goal
    // rung itself is the title and the big icon, so it is not repeated here.
    for (let i = 1; i < help.rungs.length; i += 1) {
      const rung = help.rungs[i]!;
      const above = help.rungs[i - 1]!;
      const row = this.acquireRow(line);
      row.root.setY(ROWS_TOP + line * ROW_GAP).setVisible(true);
      this.fitIcon(row.icon, `item_${rung.chain}_${rung.tier}`, ROW_ICON_FIT);
      row.text.setText(`${above.fromCount} × ${rung.name}  →  ${above.name}`);
      row.count.setText(rung.missing > 0 ? `${rung.missing}` : '✓');
      row.count.setColor(rung.missing > 0 ? INK.onFieldGold : INK.gain);
      line += 1;
    }

    // THE SOURCE — where the bottom piece comes from. Without it the sheet
    // replaces one question with another.
    if (help.source.kind === 'tap' && help.source.producer) {
      const row = this.acquireRow(line);
      row.root.setY(ROWS_TOP + line * ROW_GAP).setVisible(true);
      this.fitIcon(
        row.icon,
        `item_${help.source.producer.chain}_${help.source.producer.tier}`,
        ROW_ICON_FIT
      );
      const cost: string[] = [];
      if (help.source.energyCost) cost.push(`${help.source.energyCost} ⚡`);
      if (help.source.cooldownMs) cost.push(`${Math.round(help.source.cooldownMs / 1000)}s`);
      row.text.setText(
        `Tap the ${help.source.label}${cost.length > 0 ? `  ·  ${cost.join('  ·  ')}` : ''}`
      );
      row.count.setText('');
      line += 1;
    }

    for (let i = line; i < this.rows.length; i += 1) this.rows[i]!.root.setVisible(false);

    const base = help.rungs[help.rungs.length - 1]!;
    this.foot.setText(
      help.baseMissing > 0
        ? `Still to gather: ${help.baseMissing} × ${base.name}`
        : 'You already have everything this needs.'
    );
    this.foot.setColor(help.baseMissing > 0 ? INK.onFieldGold : INK.gain);
  }
}
