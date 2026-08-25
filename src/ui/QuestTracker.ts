import Phaser from 'phaser';
import { FONT } from '../art/design';
import {
  GIVER_MARK,
  IS_MOBILE,
  LIVE_GAME_WIDTH,
  num,
  PALETTE,
  QUEST_LIST_TOP_Y,
  QUEST_ROW_H,
  QUEST_TRACKER_RIGHT,
  QUEST_TRACKER_TOP_Y,
  QUEST_VIEW_H,
  UI_SCALE
} from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import { questGoalPiece } from '../core/recipeTree';
import type { QuestConfig, QuestStepConfig } from '../core/types';
import type { QuestSystem } from '../systems/QuestSystem';
import { uiRegistry } from './theme';


/**
 * The cluster's geometry lives in Constants — the HUD column has to clear the
 * status readout that hangs under this, and that clearance has to be
 * computable somewhere Phaser cannot reach. Re-exported under the old names so
 * everything that already hangs off the tracker keeps its one source.
 */
export {
  QUEST_TRACKER_BOTTOM,
  QUEST_TRACKER_RIGHT,
  QUEST_TRACKER_TOP_Y
} from '../core/Constants';

/**
 * Widest the cluster may grow leftward before it starts scaling down to fit.
 *
 * The whole tracker is right-anchored, so long text grows LEFT on its own — the
 * only thing that has to be handled is the point where it would reach the board.
 * Shrinking beats wrapping here: a wrapped line has nowhere to go in a
 * background-free cluster whose rows are pitched at a fixed height.
 */
const MAIN_TITLE_Y = 0;

// One size up, throughout. This HUD is the only place the player reads what to
// do next, and it was set at a size that assumed they were leaning in. The
// numbers below are proportional to the type they serve — the icon box tracks
// the sub-row line, the row height tracks the label — so they move together or
// the list stops reading as one list.
const MAX_W = 840;
/** Never shrink past this — below it the line stops being readable at a glance. */
const MIN_FIT_SCALE = 0.72;

/** Mask width — rows are right-aligned and grow leftward, so this only has to
 *  be wider than the longest label can ever be. It is a CLIP, not a target:
 *  input hit-tests the rows' own bounds (`overList`), never this. */
const VIEW_W = 1040;

/** Gap between a row's label and its `n/target` counter. */
const COUNT_GAP = 16;

/**
 * The leading item icon on a sub row — the piece the step actually spends (a
 * `recipe` goal shows the TO-BE-MERGED tier, never the result: the row tells
 * the player what to go touch, and what they touch is the input).
 *
 * Icon-with-title rules, so seven rows read as one list and not seven
 * stickers: every icon contain-fits the SAME square box, sized to the text's
 * own line (26px type ≈ 34px line) so the art never dominates the words; one
 * fixed gap to the label; vertically centred on the line, not the row. Each
 * sits on a soft dark disc — this HUD is background-free, and the disc is to
 * the art what the stroke-and-shadow is to the glyphs.
 */
const ICON_BOX = 42;
const ICON_GAP = 14;
const ICON_CHIP_PAD = 6;

/**
 * Slack around a row's own ink before the pointer counts as "on it".
 *
 * A hover readout wants a target the size of the thing it explains, plus a
 * little for the hand — and how much "a little" is depends on the hand. Ten
 * units at 2560 is about four CSS pixels, which is all a mouse needs and far
 * less than a finger does; touch gets the fingertip's own radius instead.
 */
const PEEK_PAD: number = IS_MOBILE ? 28 : 10;

/** A row faded below this is an affordance, not a target: the half-visible
 *  fourth row says "there is more below", and explaining a line the player can
 *  barely read is noise. */
const PEEK_MIN_ALPHA = 0.6;

/** Strike-through baseline, measured from a row's top. */
const STRIKE_Y = 18;
const MAIN_STRIKE_Y = 20;

interface Row {
  /** The quest this row belongs to — rows left behind by a finished quest are
   *  struck out and spliced away when the ladder advances. */
  questId: string;
  step: QuestStepConfig;
  root: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  count: Phaser.GameObjects.Text;
  /** Leading item icon + its contrast disc — null when the goal names no piece. */
  icon: Phaser.GameObjects.Image | null;
  chip: Phaser.GameObjects.Arc | null;
  strike: Phaser.GameObjects.Graphics;
  /** Playing its completion beat — frozen in place until it is spliced out. */
  retiring: boolean;
  /** Layout slot, so a retiring row keeps its place while the others close up. */
  slot: number;
  /** Entrance progress, 0→1. Kept apart from the row's alpha because the fade
   *  ramp owns that: the two are MULTIPLIED, so a row arriving at the bottom of
   *  the viewport fades in only as far as its position allows. */
  reveal: number;
}

/**
 * The on-screen quest readout, top-right — a HUD element, not a panel.
 *
 *   • MAIN quest — the active quest on the ladder (`QuestSystem`). This is the
 *     line the story advances along, so there is exactly one and it never
 *     scrolls.
 *   • SUB quests — that quest's own ordered steps, three at a time, scrollable
 *     (wheel or drag) when there are more, their counters in the same
 *     right-hand column as the main line's.
 *
 * The two are one thing, not two lists side by side: the sub rows are always the
 * steps OF the line above them, so the HUD answers "what am I doing, and what is
 * the next move" without the player opening anything. The Keeper's Tasks are
 * still the Ledger's second tab; they reach this HUD as the steps of the encore
 * quest, from the same `tasks.json` definition.
 *
 * It has NO background by design: legibility comes from a dark stroke and a soft
 * shadow on the glyphs, and the list's bottom fade is an alpha ramp across the
 * rows rather than a gradient plate. Anything that reads as a panel belongs in
 * the Ledger, which this only summarises.
 *
 * Finishing a quest strikes it through left-to-right, holds a beat, then fades
 * it out and closes the gap. Reads facts off the bus and derives the rest from
 * OrderSystem/TaskSystem, the same way LedgerPanel does — it never mutates.
 */
export class QuestTracker extends Phaser.GameObjects.Container {
  private mainTitle: Phaser.GameObjects.Text;
  private mainProgress: Phaser.GameObjects.Text;
  private mainStrike: Phaser.GameObjects.Graphics;
  private mainGroup: Phaser.GameObjects.Container;
  /** The quest the main line is currently showing — a completion animates the
   *  line out before the next one is read, so this lags `activeQuest`. */
  private shownQuest: QuestConfig | null = null;
  private mainRetiring = false;

  private listViewport: Phaser.GameObjects.Container;
  private rowsGroup: Phaser.GameObjects.Container;
  private listMask: Phaser.GameObjects.Graphics;
  /** The owning scene, held separately from the GameObject's own `this.scene` —
   *  see the same field on LedgerPanel. A destroyed container has no `.scene`,
   *  and scene shutdown destroys the display list before our teardown runs. */
  private readonly owner: Phaser.Scene;
  private rows: Row[] = [];
  private scrollY = 0;
  private dragging = false;
  private dragLastY = 0;

  private storyVisible = false;
  private tasksVisible = false;
  /** Something is over the board — see `setSuppressed`. */
  private suppressed = false;
  private readonly offBus: Array<() => void> = [];
  /** The step id whose ladder is currently peeked, so a pointer travelling
   *  along one row does not re-emit on every move event. */
  private peekedStep: string | null = null;
  /** Where the pointer went down, to tell a TAP from the start of a drag. */
  private downAt: { x: number; y: number } | null = null;
  /** Reused by the hit tests — a mouse crossing the cluster asks for row bounds
   *  a few dozen times a second, and every answer is read immediately. */
  private readonly probe = new Phaser.Geom.Rectangle();
  private readonly bus: EventBus;

  constructor(
    scene: Phaser.Scene,
    bus: EventBus,
    private quests: QuestSystem
  ) {
    super(scene, LIVE_GAME_WIDTH - QUEST_TRACKER_RIGHT, QUEST_TRACKER_TOP_Y);
    this.owner = scene;
    this.bus = bus;
    this.setScale(UI_SCALE); // magnifies down-left from the top-right anchor

    // ---- Main quest ----
    this.mainGroup = scene.add.container(0, 0);
    this.mainTitle = this.styleText(
      scene.add.text(0, MAIN_TITLE_Y, '', {
        fontFamily: FONT.ui,
        fontSize: '42px',
        fontStyle: 'bold',
        color: PALETTE.cream,
        align: 'right'
      })
    );
    this.mainProgress = this.styleText(
      scene.add.text(0, MAIN_TITLE_Y + 2, '', {
        fontFamily: FONT.ui,
        fontSize: '34px',
        fontStyle: 'bold',
        color: PALETTE.goldAccent,
        align: 'right'
      }),
      4
    );
    this.mainStrike = scene.add.graphics();
    this.mainGroup.add([this.mainTitle, this.mainProgress, this.mainStrike]);

    // ---- Sub-quest list: a clipped viewport with the rows scrolling inside ----
    this.listViewport = scene.add.container(0, QUEST_LIST_TOP_Y);
    this.rowsGroup = scene.add.container(0, 0);
    this.listViewport.add(this.rowsGroup);
    this.listMask = scene.make.graphics();
    this.rowsGroup.setMask(this.listMask.createGeometryMask());

    this.add([this.mainGroup, this.listViewport]);
    scene.add.existing(this);

    // Scroll input is scene-level and BOUNDS-TESTED rather than an interactive
    // Zone over the list. An invisible catcher would have been simpler, but it
    // sits across the board's top-right corner: once the list is live it would
    // swallow every tap on the items under it. Nothing here is interactive, so
    // the board keeps its input and the cluster only reacts inside its own rect.
    scene.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);

    uiRegistry.register(scene, 'hud.quests', 'Quest tracker', 'HUD', this, {
      mainTitle: this.mainTitle,
      mainProgress: this.mainProgress
    });

    this.refreshMain();
    this.syncRows();
    this.applyVisibility();

    // QuestSystem is constructed with the context, long before this scene, so
    // its handlers have already latched everything by the time these run — the
    // bus is synchronous and subscribers fire in registration order.
    // Only the quest the main line is actually SHOWING plays the completion
    // beat: steps latch wherever they are met, so a later quest's checklist can
    // finish (five orders, thirty merges) while an earlier one is still on
    // screen — striking that line out would retire the wrong quest.
    this.offBus.push(
      bus.on('quest:completed', ({ questId }) => {
        if (questId === this.shownQuest?.id) this.onQuestCompleted();
      })
    );
    // No per-step progress event exists (and none should: goals are derived,
    // not counted), so the tracker recomputes off the same facts that move them
    // — the set LedgerPanel already refreshes its checklist on, plus the order
    // progress the endless Ledger tail reads live.
    for (const event of [
      'item:merged',
      'item:hatched',
      'item:spawned',
      'item:produced',
      'item:harvested',
      'item:removed',
      'item:sold',
      'order:progress',
      'order:completed',
      'quest:step_completed',
      'elder:tapped',
      'economy:changed',
      'keeper:leveled',
      'region:unlocked',
      'bag:changed',
      'state:loaded'
    ] as const) {
      this.offBus.push(
        bus.on(event, () => {
          this.refreshMain();
          this.syncRows();
        })
      );
    }
  }

  /** No background means the glyphs carry their own legibility: a dark stroke
   *  for edge contrast plus a soft drop shadow to lift them off bright cloud. */
  private styleText(text: Phaser.GameObjects.Text, strokeW = 6): Phaser.GameObjects.Text {
    return text
      .setOrigin(1, 0)
      .setStroke('rgba(36,27,34,0.62)', strokeW)
      .setShadow(0, 4, 'rgba(36,27,34,0.55)', 9);
  }

  teardown(): void {
    // A sheet explaining a row of a tracker that no longer exists.
    this.dropPeek();
    this.offBus.forEach((off) => off());
    this.offBus.length = 0;
    this.owner.input.off(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
    this.owner.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.owner.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.owner.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.owner.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
    this.listMask.destroy();
  }

  /** The main line mirrors the Ledger button's own gate — it is a readout of the
   *  Ledger, so it cannot appear before the beat that teaches the Ledger. */
  setStoryVisible(visible: boolean): void {
    this.storyVisible = visible;
    this.applyVisibility();
  }

  /** The checklist is the encore's spine, like the Ledger's Tasks tab: it joins
   *  once the tutorial hands the game over. */
  setTasksVisible(visible: boolean): void {
    if (this.tasksVisible === visible) return;
    this.tasksVisible = visible;
    if (visible) this.syncRows();
    this.applyVisibility();
  }

  /**
   * Something is over the board: hold every hover, wheel and drag this cluster
   * would answer, and drop whatever sheet is standing.
   *
   * The tracker STAYS on screen — it is a readout, and a panel does not make it
   * untrue. What must stop is the reaching: the peek is bounds-tested against
   * the rows rather than owned by an interactive object, so it cannot be
   * covered up the way a real hit area would be, and a pointer crossing the
   * cluster's coordinates on its way to the Settings sheet raised a recipe card
   * over the dialog the player had just opened.
   *
   * Driven every frame from UIScene's `update` rather than off eight
   * `*_opened` events, for the same reason the hint hand is: the question is
   * "is anything up", not "which one just went up".
   */
  setSuppressed(value: boolean): void {
    if (this.suppressed === value) return;
    this.suppressed = value;
    if (value) {
      this.dropPeek();
      this.dragging = false;
      this.downAt = null;
    }
  }

  private applyVisibility(): void {
    this.mainGroup.setVisible(this.storyVisible);
    this.listViewport.setVisible(this.tasksVisible);
    this.setVisible(this.storyVisible || this.tasksVisible);
    // `overList` already refuses a hidden list, but nothing re-asks it: a
    // cluster hidden under the pointer would leave its peek standing.
    if (!this.tasksVisible) this.dropPeek();
    this.seatMask();
  }

  // ---------------------------------------------------------------- main line

  private refreshMain(): void {
    if (this.mainRetiring) return;
    const quest = this.quests.activeQuest;
    this.shownQuest = quest;
    if (!quest) {
      this.mainTitle.setText('');
      this.mainProgress.setText('');
      return;
    }
    // A marked giver's asks wear her mark, so a glance says whose page is open
    // when two tracks share a board (GIVER_MARK).
    this.mainTitle.setText((GIVER_MARK[quest.giver] ?? '') + this.quests.titleFor(quest));
    // A multi-step quest counts its steps; a one-step quest (the endless Ledger
    // tail) would only ever read "0 / 1", so it shows that step's own item
    // progress instead — the same number the Ledger's order card shows.
    const only = quest.steps.length === 1 ? quest.steps[0] : undefined;
    const { have, need } = only
      ? this.quests.progressFor(only)
      : this.quests.questProgress(quest);
    this.mainProgress.setText(`${have} / ${need}`);
    this.layoutMain();
  }

  /**
   * Seat the main line: counter hard against the right edge, title immediately
   * left of it, then scale the pair down if together they would reach past
   * `MAX_W`. Both are origin-(1,0), so every x here is a right edge.
   */
  private layoutMain(): void {
    this.mainGroup.setScale(1);
    this.mainProgress.setX(0);
    this.mainTitle.setX(-(this.mainProgress.width + COUNT_GAP));
    this.mainGroup.setScale(this.fitScale(this.mainWidth()));
  }

  /** Combined width of the main line, in its own unscaled units. */
  private mainWidth(): number {
    return this.mainTitle.width + COUNT_GAP + this.mainProgress.width;
  }

  /** 1 while the line fits, shrinking toward MIN_FIT_SCALE once it does not. */
  private fitScale(width: number): number {
    return width > MAX_W ? Math.max(MIN_FIT_SCALE, MAX_W / width) : 1;
  }

  private onQuestCompleted(): void {
    if (!this.storyVisible || !this.shownQuest || this.mainRetiring) {
      this.refreshMain();
      return;
    }
    this.mainRetiring = true;
    const width = this.mainWidth();
    this.strike(this.mainStrike, width, MAIN_STRIKE_Y, () => {
      this.mainTitle.setColor(PALETTE.moss);
      this.scene.tweens.add({
        targets: this.mainGroup,
        alpha: 0,
        x: 30,
        delay: 300,
        duration: 400,
        ease: 'Sine.easeIn',
        onComplete: () => {
          this.mainStrike.clear();
          this.mainTitle.setColor(PALETTE.cream);
          this.mainGroup.setX(0);
          this.mainRetiring = false;
          this.refreshMain();
          // The next order arrives on its own line rather than snapping in.
          this.scene.tweens.add({
            targets: this.mainGroup,
            alpha: 1,
            duration: 320,
            ease: 'Sine.easeOut'
          });
        }
      });
    });
  }

  // ----------------------------------------------------------------- sub list

  /** Reconcile the rows against the active quest's steps: strike out what just
   *  finished (including every row left over from the quest that just ended),
   *  add what just unlocked, and repaint the counters on the rest. */
  private syncRows(): void {
    if (!this.tasksVisible) return;
    const quest = this.quests.activeQuest;

    // The ladder moved on: the old quest's steps are all done by definition, so
    // they play their completion beat rather than vanishing.
    for (const row of this.rows) {
      if (!row.retiring && row.questId !== quest?.id) this.retireRow(row);
    }
    if (!quest) {
      this.layoutRows();
      return;
    }

    for (const step of quest.steps) {
      const progress = this.quests.progressFor(step);
      const row = this.rows.find((r) => r.step.id === step.id);

      if (!row) {
        // A locked step has no live subject yet (the Elder still asleep), so it
        // is not an ACTIVE subquest — it joins the list the moment it unlocks.
        if (!progress.done && !progress.locked) this.addRow(quest.id, step);
        continue;
      }
      if (row.retiring) continue;
      if (progress.done) this.retireRow(row);
      else this.paintRow(row);
    }
    this.layoutRows();
  }

  /** The piece a step's row NAMES, as an item texture key — resolved by
   *  `QuestSystem.pieceFor`, which owns the orders and the grimoire the answer
   *  has to be read out of. Null when the goal is not about a piece (a level, a
   *  region, a person's regard), and the row then starts at its label.
   *
   *  It used to answer for three goal kinds only and return null for the rest,
   *  which left the two commonest rows in the game bare: every "Deliver N to
   *  Eleanor" (the goal is an `order`, and the piece is in the order's own
   *  requirements) and every "Brew N" (the piece is the recipe's output). */
  private iconKeyFor(step: QuestStepConfig): string | null {
    const piece = this.quests.pieceFor(step);
    return piece ? `item_${piece.chain}_${piece.tier}` : null;
  }

  private addRow(questId: string, step: QuestStepConfig): void {
    const root = this.scene.add.container(0, 0).setAlpha(0);
    const count = this.styleText(
      this.scene.add.text(0, 0, '', {
        fontFamily: FONT.ui,
        fontSize: '32px',
        fontStyle: 'bold',
        color: PALETTE.goldAccent
      }),
      5
    );
    const label = this.styleText(
      this.scene.add.text(0, 0, this.quests.progressFor(step).label, {
        fontFamily: FONT.ui,
        fontSize: '32px',
        color: PALETTE.cream
      }),
      5
    );
    const strike = this.scene.add.graphics();
    root.add([label, count, strike]);
    let icon: Phaser.GameObjects.Image | null = null;
    let chip: Phaser.GameObjects.Arc | null = null;
    const key = this.iconKeyFor(step);
    if (key && this.scene.textures.exists(key)) {
      chip = this.scene.add
        .circle(0, 0, ICON_BOX / 2 + ICON_CHIP_PAD, num(PALETTE.night), 0.32)
        .setOrigin(0.5);
      icon = this.scene.add.image(0, 0, key);
      icon.setScale(ICON_BOX / Math.max(icon.width, icon.height));
      root.add([chip, icon]);
    }
    this.rowsGroup.add(root);
    const row: Row = {
      questId,
      step,
      root,
      label,
      count,
      icon,
      chip,
      strike,
      retiring: false,
      slot: this.rows.length,
      reveal: 0
    };
    this.rows.push(row);
    this.paintRow(row);
    this.scene.tweens.add({
      targets: row,
      reveal: 1,
      duration: 300,
      ease: 'Sine.easeOut',
      onUpdate: () => this.applyFade()
    });
  }

  /** Counter text, then re-seat the label to its left — the counter's width
   *  changes with the digits, so the pair is laid out every repaint. The label
   *  is repainted too: the endless Ledger tail's wording changes with whatever
   *  order Eleanor is asking for. */
  private paintRow(row: Row): void {
    const progress = this.quests.progressFor(row.step);
    row.label.setText(progress.label);
    row.count.setText(`${progress.have} / ${progress.need}`);
    // …and so does the PIECE, for the same reason: the endless tail tracks
    // whichever order is live, so its icon rotates with the wording it sits
    // beside. Contain-fit again after the swap — a replacement is a different
    // drawing at its own resolution.
    const key = this.iconKeyFor(row.step);
    if (row.icon && key && row.icon.texture.key !== key && this.scene.textures.exists(key)) {
      row.icon.setTexture(key);
      row.icon.setScale(ICON_BOX / Math.max(row.icon.width, row.icon.height));
    }
    row.root.setScale(1);
    row.label.setX(-(row.count.width + COUNT_GAP));
    this.seatIcon(row);
    row.root.setScale(this.fitScale(this.rowWidth(row)));
  }

  /** Seat the leading icon (and its disc) against the label's left edge,
   *  centred on the TEXT LINE rather than the row — an icon aligned to the row
   *  box drifts visibly against a single line of type. */
  private seatIcon(row: Row): void {
    if (!row.icon || !row.chip) return;
    const x = -(row.count.width + COUNT_GAP + row.label.width + ICON_GAP + ICON_BOX / 2);
    const y = row.label.height / 2;
    row.icon.setPosition(x, y);
    row.chip.setPosition(x, y);
  }

  private rowWidth(row: Row): number {
    const iconW = row.icon ? ICON_GAP + ICON_BOX + ICON_CHIP_PAD : 0;
    return row.count.width + COUNT_GAP + row.label.width + iconW;
  }

  private retireRow(row: Row): void {
    row.retiring = true;
    // Explaining how to make a thing the player has just finished making.
    if (row.step.id === this.peekedStep) this.dropPeek();
    const { need } = this.quests.progressFor(row.step);
    row.count.setText(`${need} / ${need}`);
    row.root.setScale(1);
    row.label.setX(-(row.count.width + COUNT_GAP));
    this.seatIcon(row);
    row.root.setScale(this.fitScale(this.rowWidth(row)));
    this.strike(row.strike, this.rowWidth(row), STRIKE_Y, () => {
      row.label.setColor(PALETTE.moss);
      row.count.setColor(PALETTE.moss);
      this.scene.tweens.add({
        targets: row.root,
        alpha: 0,
        x: 30,
        delay: 260,
        duration: 380,
        ease: 'Sine.easeIn',
        onComplete: () => {
          this.rows = this.rows.filter((r) => r !== row);
          row.root.destroy();
          this.layoutRows();
        }
      });
    });
  }

  /** Seat every row on its slot (tweening the ones that shift up when a
   *  finished row leaves), then re-clamp the scroll and re-run the fade ramp. */
  private layoutRows(): void {
    this.rows.forEach((row, i) => {
      const y = i * QUEST_ROW_H;
      if (row.slot === i && row.root.y === y) return;
      row.slot = i;
      // The ramp is a function of the row's position, so it has to be re-run as
      // the row slides — otherwise a row promoted out of the faded bottom keeps
      // the alpha it had down there.
      this.scene.tweens.add({
        targets: row.root,
        y,
        duration: 260,
        ease: 'Cubic.easeOut',
        onUpdate: () => this.applyFade()
      });
    });
    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, this.maxScroll());
    this.rowsGroup.setY(-this.scrollY);
    this.applyFade();
    this.seatMask();
  }

  /**
   * The bottom fade. With no plate to gradient over, each row carries the ramp
   * itself: a row fully inside the viewport is opaque, and one crossing the
   * bottom edge eases to zero over its own height — so the peeking fourth row
   * reads as "there is more below" rather than as a hard cut.
   *
   * The top edge ramps the same way, but only once the list has actually been
   * scrolled: an un-scrolled list should read as a plain top-aligned column, not
   * as something already cut off.
   */
  private applyFade(): void {
    const scrolled = this.scrollY > 1;
    for (const row of this.rows) {
      // A retiring row is mid-animation on its own alpha — never fight it.
      if (row.retiring) continue;
      const top = row.root.y - this.scrollY;
      let a = Phaser.Math.Clamp((QUEST_VIEW_H - top) / QUEST_ROW_H, 0, 1);
      if (scrolled) a = Math.min(a, Phaser.Math.Clamp((top + QUEST_ROW_H) / QUEST_ROW_H, 0, 1));
      row.root.setAlpha(a * row.reveal);
    }
  }

  private maxScroll(): number {
    return Math.max(0, this.rows.length * QUEST_ROW_H - QUEST_VIEW_H);
  }

  private scrollBy(delta: number): void {
    const max = this.maxScroll();
    if (max <= 0) return;
    this.scrollY = Phaser.Math.Clamp(this.scrollY + delta, 0, max);
    this.rowsGroup.setY(-this.scrollY);
    this.applyFade();
  }

  /** The masked viewport's floor and ceiling in screen space — a row scrolled
   *  past either is not on screen, so it is not under the pointer either. */
  private viewBand(): { top: number; bottom: number } {
    const top = this.y + QUEST_LIST_TOP_Y * this.scaleY;
    return { top, bottom: top + QUEST_VIEW_H * this.scaleY };
  }

  /**
   * Is the pointer over the list? Over the ROWS, that is — not over the box
   * they are masked by.
   *
   * `VIEW_W` is a MASK width: how far a row may ever grow leftward before it
   * starts scaling down, i.e. the worst case the clip has to allow for. Used as
   * a hit rect it made 1040 units — two fifths of the screen — react to a
   * pointer nowhere near a word, and react at that worst case even when the
   * list was three short lines. It put an invisible catcher across the board's
   * whole top-right corner, which is the exact thing the note above says this
   * cluster refuses to do.
   *
   * Rows are right-anchored and as wide as their own text, so the union of
   * their bounds is the honest answer, and it shrinks with the list. Pointer
   * coords arrive in the same 2560-space the UI is authored in (UIScene's
   * camera is fixed), so the comparison is direct.
   */
  private overList(pointer: Phaser.Input.Pointer): boolean {
    if (!this.tasksVisible || this.suppressed) return false;
    const band = this.viewBand();
    let left = Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const row of this.rows) {
      if (row.retiring) continue; // sliding out to the right on its own alpha
      const b = row.root.getBounds(this.probe);
      left = Math.min(left, b.left);
      top = Math.min(top, b.top);
      bottom = Math.max(bottom, b.bottom);
    }
    if (left === Infinity) return false; // nothing drawn, nothing to be over
    return (
      pointer.x >= left - PEEK_PAD &&
      pointer.x <= this.x + PEEK_PAD &&
      pointer.y >= Math.max(top, band.top) - PEEK_PAD &&
      pointer.y <= Math.min(bottom, band.bottom) + PEEK_PAD
    );
  }

  /**
   * AND WHAT IS THAT? — the row under the pointer, and the piece it wants.
   *
   * The tracker says what to do next; this is where the player asks how. It is
   * the same ladder the Ledger's `?` opens (`ui:recipe_peek` / RecipeHelpPanel),
   * raised where the eye already is instead of two panels away.
   *
   * Bounds-tested like the scroll above it, and for the same reason: an
   * interactive Zone over this list would sit across the board's top-right
   * corner and swallow every tap on the pieces under it. Nothing here is
   * interactive; the cluster only reacts inside its own rect.
   */
  private rowAt(pointer: Phaser.Input.Pointer): Row | null {
    if (!this.overList(pointer)) return null;
    const band = this.viewBand();
    for (const row of this.rows) {
      if (row.retiring || row.root.alpha < PEEK_MIN_ALPHA) continue;
      const b = row.root.getBounds(this.probe);
      // The row's own ink, on BOTH axes. Testing only the y band made every
      // row a full-width stripe, so a pointer travelling up the board picked
      // one up by its altitude alone.
      if (pointer.x < b.left - PEEK_PAD || pointer.x > b.right + PEEK_PAD) continue;
      const top = Math.max(b.top, band.top);
      const bottom = Math.min(b.bottom, band.bottom);
      if (pointer.y >= top - PEEK_PAD && pointer.y <= bottom + PEEK_PAD) return row;
    }
    return null;
  }

  /**
   * The piece a step is asking for, if it is asking for a piece at all.
   *
   * `have` and `gift` name one outright. A step that waits on an ORDER names it
   * one hop away, through the same `needsFor` the offline quest audit uses — so
   * "Deliver 6 Gem Chips" explains the Gem Chips rather than shrugging. Steps
   * that count merges, levels or regions have no ladder and get no sheet; that
   * is the rule the `?` already follows, not a new one.
   */
  private goalOf(step: QuestStepConfig): { chain: string; tier: number; count: number } | null {
    // `needsFor` walks orders, tasks and cauldron recipes, so it is only asked
    // for the goal kinds that can use the answer.
    const needs =
      step.goal.kind === 'order' || step.goal.kind === 'active_order'
        ? this.quests.needsFor(step)
        : [];
    return questGoalPiece(step.goal, needs);
  }

  /** Raise (or drop) the peek for a row. Idempotent per step, because a mouse
   *  crossing one row fires a dozen move events. */
  private peekRow(row: Row | null): void {
    const step = row && !row.retiring ? row.step : null;
    const goal = step ? this.goalOf(step) : null;
    const id = goal && step ? step.id : null;
    if (id === this.peekedStep) return;
    this.peekedStep = id;
    if (!row || !goal) {
      this.bus.emit('ui:recipe_peek', { goal: null, x: 0, y: 0 });
      return;
    }
    const listTop = this.y + QUEST_LIST_TOP_Y * this.scaleY;
    const top = listTop + (row.root.y - this.scrollY) * this.scaleY;
    // The ROW's own left edge, not the viewport's. `VIEW_W` is how far the
    // cluster may ever grow leftward before it starts scaling down — anchoring
    // on it puts the sheet a third of a screen from the words it explains, and
    // walks it over the energy and coin pills on the way. A row is
    // right-anchored and as wide as its own text, so its bounds are the answer.
    this.bus.emit('ui:recipe_peek', {
      goal,
      x: row.root.getBounds().x,
      y: top + (QUEST_ROW_H * this.scaleY) / 2
    });
  }

  /** Drop the peek without asking why — used by every path that can take the
   *  rows out from under the pointer (scrolling, hiding, teardown). */
  private dropPeek(): void {
    if (this.peekedStep === null) return;
    this.peekedStep = null;
    this.bus.emit('ui:recipe_peek', { goal: null, x: 0, y: 0 });
  }

  private onWheel(pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number): void {
    if (!this.overList(pointer)) return;
    this.scrollBy(dy * 0.6);
    // The rows just moved under a pointer that did not: whatever was being
    // explained is no longer where the sheet is pointing.
    this.dropPeek();
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    this.downAt = this.overList(pointer) ? { x: pointer.x, y: pointer.y } : null;
    if (this.maxScroll() <= 0 || !this.overList(pointer)) return;
    this.dragging = true;
    this.dragLastY = pointer.y;
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.dragging) {
      this.scrollBy(-(pointer.y - this.dragLastY));
      this.dragLastY = pointer.y;
      this.dropPeek();
      return;
    }
    // A FINGER HAS NO HOVER. On touch the peek is raised by a tap in
    // `onPointerUp`, and a move here would only ever tear it down again —
    // Phaser reports the drag of a finger as pointer movement.
    if (IS_MOBILE) return;
    this.peekRow(this.rowAt(pointer));
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const from = this.downAt;
    this.downAt = null;
    const wasDragging = this.dragging;
    this.dragging = false;
    if (!IS_MOBILE || wasDragging || !from) return;
    // A tap, not a scroll: within a thumb's wobble of where it went down.
    if (Math.abs(pointer.x - from.x) > 24 || Math.abs(pointer.y - from.y) > 24) return;
    const row = this.rowAt(pointer);
    // Tapping the row that is already open closes it — the finger's version of
    // looking away.
    if (row && row.step.id === this.peekedStep) this.dropPeek();
    else this.peekRow(row);
  }

  /** Geometry masks live in WORLD space, so the clip rect is re-cut whenever the
   *  cluster's geometry could have moved (visibility flips, re-layout). */
  private seatMask(): void {
    const w = VIEW_W * this.scaleX;
    const h = QUEST_VIEW_H * this.scaleY;
    const x = this.x - w;
    const y = this.y + QUEST_LIST_TOP_Y * this.scaleY;
    this.listMask.clear();
    this.listMask.fillStyle(0xffffff, 1);
    this.listMask.fillRect(x, y, w, h);
  }

  /** The horizontal crossing: a gold rule drawn left-to-right across the line. */
  private strike(
    g: Phaser.GameObjects.Graphics,
    width: number,
    y: number,
    onComplete: () => void
  ): void {
    const t = { v: 0 };
    this.scene.tweens.add({
      targets: t,
      v: 1,
      duration: 300,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        g.clear();
        g.lineStyle(5, num(PALETTE.goldAccent), 0.95);
        g.beginPath();
        g.moveTo(-width, y);
        g.lineTo(-width + width * t.v, y);
        g.strokePath();
      },
      onComplete
    });
  }
}
