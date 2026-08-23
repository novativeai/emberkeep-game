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

/**
 * TWO DRESSINGS, ONE LADDER.
 *
 * `modal` is the sheet the `?` opens: dimmed, seated centre-screen, closed by
 * its own ✕. `peek` is the same ladder under the cursor on a quest row —
 * no scrim, no ✕, no input at all, anchored beside the row it explains. They
 * share every number they draw, which is the point: two panels that answer
 * "how do I make that?" differently is two answers.
 */
export type RecipeHelpVariant = 'modal' | 'peek';
/** Air between the quest cluster's left edge and the peek's right edge. */
const PEEK_GAP = 26;
/** The peek never touches the canvas edge — it is a card, not a bar. */
const PEEK_MARGIN = 24;
/** A peek is quieter than the sheet it mirrors: it is glanced at, not read. */
const PEEK_ALPHA = 0.97;
const PEEK_FADE_MS = 110;

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
  private frameImage!: Phaser.GameObjects.Image;
  private offBus: Array<() => void> = [];
  /** The peek's own goal, so a pointer sliding along one row does not repaint
   *  the same ladder on every mouse event. */
  private peeking: string | null = null;

  constructor(
    scene: Phaser.Scene,
    bus: EventBus,
    private gameState: GameState,
    private chains: ChainsData,
    private readonly variant: RecipeHelpVariant = 'modal'
  ) {
    super(scene, LIVE_GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2);

    if (variant === 'modal') {
      // A scrim that SWALLOWS taps without dismissing: a thumb that scrolls the
      // Ledger underneath and releases here would otherwise shut the help it just
      // opened. Only the ✕ closes — the same rule every other panel follows.
      const dim = scene.add
        .rectangle(0, 0, LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, num(INK.scrim), 0.5)
        .setInteractive();
      this.add(dim);
    }

    const frame = scene.add.image(0, 0, 'ui_quest_panel').setScale(FRAME_SCALE_X, FRAME_SCALE_Y);
    this.baseScale = panelMobileScale(frame.width * FRAME_SCALE_X);
    this.frameImage = frame;
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
    // is a panel the player has to re-learn. A peek has none: it is dismissed
    // by looking away, which is the only gesture it was opened with.
    if (variant === 'modal') this.addCloseButton(scene);

    scene.add.existing(this);
    this.setVisible(false);

    if (variant === 'peek') {
      // NOTHING under a peek may be blocked — not the board, not the tracker it
      // hangs off. It is a label that happens to be a panel.
      this.setAlpha(0);
      this.offBus.push(bus.on('ui:recipe_peek', ({ goal, x, y }) => this.peek(goal, x, y)));
      // The `?` sheet is the same answer, louder. Two of them on screen is one
      // too many, so the peek stands down the moment the modal takes over.
      this.offBus.push(bus.on('ui:recipe_help', () => this.peek(null, 0, 0)));
      uiRegistry.register(scene, 'panel.recipe_peek', 'Recipe peek', 'Panels', this, {
        frame: this.frameImage,
        title: this.title
      });
      scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
      return;
    }

    uiRegistry.register(scene, 'panel.recipe_help', 'Recipe help sheet', 'Panels', this, {
      frame: this.frameImage,
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

  /** The royal ✕, factored out so the peek can simply not have one. */
  private addCloseButton(scene: Phaser.Scene): void {
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

  /**
   * THE PEEK — the same ladder, beside the row that raised the question.
   *
   * `goal: null` is "the pointer left", and it is by far the commonest call, so
   * it costs nothing: no repaint, no tween restart, just a fade if something is
   * up. A goal that has not changed is also free — a mouse crossing one row
   * fires a dozen move events and every one of them would otherwise rebuild a
   * ladder that already says the right thing.
   *
   * WHERE IT GOES. The quest cluster hugs the right edge, so the only room is
   * to its LEFT: the sheet's right edge lands `PEEK_GAP` short of the row's
   * left edge, and its middle lines up with the row's. Both are then clamped
   * inside the canvas, because a hint that is half off-screen is not a hint —
   * with three rows the bottom one would otherwise hang the sheet's foot below
   * the floor.
   */
  peek(goal: { chain: string; tier: number; count: number } | null, x: number, y: number): void {
    if (this.variant !== 'peek') return;
    if (!goal) {
      if (this.peeking === null) return;
      this.peeking = null;
      this.scene.tweens.killTweensOf(this);
      this.scene.tweens.add({
        targets: this,
        alpha: 0,
        duration: PEEK_FADE_MS,
        ease: 'Sine.easeIn',
        onComplete: () => this.setVisible(false)
      });
      return;
    }
    const key = `${goal.chain}:${goal.tier}:${goal.count}`;
    const help = recipeHelp(
      this.chains,
      goal,
      (chain, tier) => this.gameState.countItemsAnywhere(chain, tier),
      this.gameState.worldId
    );
    // Nothing to explain is the same answer the `?` gives: no sheet at all.
    if (!help) {
      this.peek(null, 0, 0);
      return;
    }
    const fresh = this.peeking !== key;
    if (fresh) {
      this.paint(help);
      this.peeking = key;
    }
    const halfW = FRAME_HALF_W * this.baseScale;
    const halfH = FRAME_HALF_H * this.baseScale;
    this.setPosition(
      Phaser.Math.Clamp(x - PEEK_GAP - halfW, PEEK_MARGIN + halfW, LIVE_GAME_WIDTH - PEEK_MARGIN - halfW),
      Phaser.Math.Clamp(y, PEEK_MARGIN + halfH, LIVE_GAME_HEIGHT - PEEK_MARGIN - halfH)
    );
    this.setScale(this.baseScale);
    if (!fresh && this.visible) return;
    this.setVisible(true);
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({
      targets: this,
      alpha: PEEK_ALPHA,
      duration: PEEK_FADE_MS,
      ease: 'Sine.easeOut'
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
      // The kid register (docs/naming.md law 3: verb + number + item; law 4
      // keeps "gather" out of the player's words — it is our merge verb, and a
      // panel that borrows it teaches the wrong thing).
      help.baseMissing > 0
        ? `You still need: ${help.baseMissing} × ${base.name}`
        : 'You have everything you need!'
    );
    this.foot.setColor(help.baseMissing > 0 ? INK.onFieldGold : INK.gain);
  }
}
