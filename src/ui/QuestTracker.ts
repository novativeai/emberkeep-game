import Phaser from 'phaser';
import { FONT } from '../art/design';
import { GAME_WIDTH, GIVER_MARK, IS_MOBILE, num, PALETTE, UI_SCALE } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { QuestConfig, QuestStepConfig, SpeakerId } from '../core/types';
import type { QuestSystem } from '../systems/QuestSystem';
import { uiRegistry } from './theme';
import { scalePulse } from './tweens';


/** Right margin of the cluster — main line and sub rows share this edge, so
 *  every `x / n` counter sits in ONE right-aligned column. (An indent was tried
 *  here and dropped: with right-aligned lines whose counters ride the right
 *  edge, offsetting the parent offsets its COUNTER, and the column breaks.
 *  Hierarchy comes from the main line's larger type instead.) */
const MARGIN_R = IS_MOBILE ? 64 : 56;
/** Below the settings gear (y 104, a 128-unit plate → bottom ≈ 168). */
const TOP_Y = IS_MOBILE ? 300 : 196;
/** Exported so anything that hangs BELOW the cluster derives its own seat from
 *  the same two numbers rather than remembering a copy — the status readout does
 *  exactly that, and a change to the row pitch here must move it too. */
export const QUEST_TRACKER_TOP_Y = TOP_Y;
export const QUEST_TRACKER_RIGHT = MARGIN_R;

const MAIN_TITLE_Y = 0;
/** The main line's counter rides BESIDE its title, not under it. Parked on its
 *  own row it collided with the title's second line the moment a title wrapped,
 *  which is what put "2 / 3" underneath "Light the Brazier". */
const LIST_TOP_Y = 62;

/**
 * Widest the cluster may grow leftward before it starts scaling down to fit.
 *
 * The whole tracker is right-anchored, so long text grows LEFT on its own — the
 * only thing that has to be handled is the point where it would reach the board.
 * Shrinking beats wrapping here: a wrapped line has nowhere to go in a
 * background-free cluster whose rows are pitched at a fixed height.
 */
const MAX_W = 720;
/** Never shrink past this — below it the line stops being readable at a glance. */
const MIN_FIT_SCALE = 0.72;

/** Sub-row pitch, and how many are on screen before the list scrolls. */
const ROW_H = 56;
const VISIBLE_ROWS = 3;
/** A sliver of the FOURTH row stays inside the viewport, half-faded. Cutting the
 *  list dead on the third row leaves no sign there is a fourth — the peek is the
 *  only scroll affordance a background-free cluster gets. */
const PEEK_H = 26;
const VIEW_H = ROW_H * VISIBLE_ROWS + PEEK_H;
/** The cluster's own height in LOCAL units — where the list's viewport ends, and
 *  therefore the first free y under the whole tracker. */
export const QUEST_TRACKER_BOTTOM = LIST_TOP_Y + VIEW_H;
/** Mask width — rows are right-aligned and grow leftward, so this only has to
 *  be wider than the longest label can ever be. */
const VIEW_W = 900;

/** Gap between a row's label and its `n/target` counter. */
const COUNT_GAP = 14;

/** The track arrow — the small round button left of the main line that cycles
 *  the readout between quest-GIVERS (Eleanor ⇄ the woken Golden Elder). Radius
 *  of the painted plate and of its (larger) hit circle, in local units. */
const SWITCH_R = 26;
const SWITCH_HIT_R = 42;
/** Gap between the main line's left edge and the arrow's centre. */
const SWITCH_GAP = 48;

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
  private readonly offBus: Array<() => void> = [];

  /** Which of `QuestSystem.giversHere` the readout is showing. An INDEX, not an
   *  id: when a track retires (the Elder's twelfth quest done) the modulo in
   *  `viewGiver` folds the view back onto a live one without special-casing. */
  private giverIdx = 0;
  private switchBtn!: Phaser.GameObjects.Container;
  private switchGlyph!: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    bus: EventBus,
    private quests: QuestSystem
  ) {
    super(scene, GAME_WIDTH - MARGIN_R, TOP_Y);
    this.owner = scene;
    this.setScale(UI_SCALE); // magnifies down-left from the top-right anchor

    // ---- Main quest ----
    this.mainGroup = scene.add.container(0, 0);
    this.mainTitle = this.styleText(
      scene.add.text(0, MAIN_TITLE_Y, '', {
        fontFamily: FONT.ui,
        fontSize: '34px',
        fontStyle: 'bold',
        color: PALETTE.cream,
        align: 'right'
      })
    );
    this.mainProgress = this.styleText(
      scene.add.text(0, MAIN_TITLE_Y + 2, '', {
        fontFamily: FONT.ui,
        fontSize: '28px',
        fontStyle: 'bold',
        color: PALETTE.goldAccent,
        align: 'right'
      }),
      4
    );
    this.mainStrike = scene.add.graphics();
    this.mainGroup.add([this.mainTitle, this.mainProgress, this.mainStrike]);

    // ---- Sub-quest list: a clipped viewport with the rows scrolling inside ----
    this.listViewport = scene.add.container(0, LIST_TOP_Y);
    this.rowsGroup = scene.add.container(0, 0);
    this.listViewport.add(this.rowsGroup);
    this.listMask = scene.make.graphics();
    this.rowsGroup.setMask(this.listMask.createGeometryMask());

    // ---- Track arrow: cycles the readout between givers, hidden while there
    // is only one. Small and quiet by design (a HUD accessory, not a panel
    // control), but its hit circle is half again the painted plate.
    this.switchBtn = scene.add.container(0, 0);
    const plate = scene.add.graphics();
    plate.fillStyle(num(PALETTE.night), 0.38);
    plate.fillCircle(0, 0, SWITCH_R);
    plate.lineStyle(3, num(PALETTE.goldAccent), 0.9);
    plate.strokeCircle(0, 0, SWITCH_R);
    this.switchGlyph = scene.add
      .text(1, 0, '❯', {
        fontFamily: FONT.ui,
        fontSize: '28px',
        fontStyle: 'bold',
        color: PALETTE.cream
      })
      .setOrigin(0.5);
    this.switchBtn.add([plate, this.switchGlyph]);
    this.switchBtn.setInteractive(
      new Phaser.Geom.Circle(0, 0, SWITCH_HIT_R),
      Phaser.Geom.Circle.Contains
    );
    this.switchBtn.on('pointerup', () => this.cycleGiver());
    this.switchBtn.setVisible(false);

    this.add([this.mainGroup, this.listViewport, this.switchBtn]);
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
      mainProgress: this.mainProgress,
      trackArrow: this.switchGlyph
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

  private applyVisibility(): void {
    this.mainGroup.setVisible(this.storyVisible);
    this.listViewport.setVisible(this.tasksVisible);
    this.setVisible(this.storyVisible || this.tasksVisible);
    this.updateSwitch();
    this.seatMask();
  }

  // -------------------------------------------------------------- giver view

  /** The giver whose track the readout is on. A pure read — the modulo folds
   *  the index onto a live track whenever the roster shrank underneath it (a
   *  track finished, or the player crossed to a world with different givers),
   *  without writing view state from a render path. */
  private viewGiver(): SpeakerId | null {
    const givers = this.quests.giversHere;
    if (!givers.length) return null;
    return givers[this.giverIdx % givers.length] ?? null;
  }

  private viewQuest(): QuestConfig | null {
    const giver = this.viewGiver();
    return giver ? this.quests.activeQuestFor(giver) : null;
  }

  /** Flip to the next giver's track. A view switch is instant — the rows leave
   *  without a completion beat, because nothing completed. */
  private cycleGiver(): void {
    const givers = this.quests.giversHere;
    if (givers.length < 2 || this.mainRetiring) return;
    // Fold before stepping — the stored index may exceed a roster that shrank.
    this.giverIdx = (this.giverIdx % givers.length + 1) % givers.length;
    for (const row of this.rows) row.root.destroy();
    this.rows = [];
    this.scrollY = 0;
    this.rowsGroup.setY(0);
    this.mainStrike.clear();
    this.refreshMain();
    this.syncRows();
    scalePulse(this.scene, this.switchBtn);
  }

  /** The arrow exists only while there is a page to turn. */
  private updateSwitch(): void {
    this.switchBtn.setVisible(this.storyVisible && this.quests.giversHere.length > 1);
  }

  // ---------------------------------------------------------------- main line

  private refreshMain(): void {
    this.updateSwitch();
    if (this.mainRetiring) return;
    const quest = this.viewQuest();
    this.shownQuest = quest;
    if (!quest) {
      this.mainTitle.setText('');
      this.mainProgress.setText('');
      return;
    }
    // A marked giver's asks wear his mark (GIVER_MARK), so a glance says whose
    // page is open.
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
    // The arrow rides the main line's left edge, wherever the text ends.
    this.switchBtn.setPosition(
      -(this.mainWidth() * this.mainGroup.scaleX) - SWITCH_GAP,
      MAIN_TITLE_Y + 24
    );
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
    const quest = this.viewQuest();

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

  private addRow(questId: string, step: QuestStepConfig): void {
    const root = this.scene.add.container(0, 0).setAlpha(0);
    const count = this.styleText(
      this.scene.add.text(0, 0, '', {
        fontFamily: FONT.ui,
        fontSize: '26px',
        fontStyle: 'bold',
        color: PALETTE.goldAccent
      }),
      5
    );
    const label = this.styleText(
      this.scene.add.text(0, 0, this.quests.progressFor(step).label, {
        fontFamily: FONT.ui,
        fontSize: '26px',
        color: PALETTE.cream
      }),
      5
    );
    const strike = this.scene.add.graphics();
    root.add([label, count, strike]);
    this.rowsGroup.add(root);
    const row: Row = {
      questId,
      step,
      root,
      label,
      count,
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
    row.root.setScale(1);
    row.label.setX(-(row.count.width + COUNT_GAP));
    row.root.setScale(this.fitScale(this.rowWidth(row)));
  }

  private rowWidth(row: Row): number {
    return row.count.width + COUNT_GAP + row.label.width;
  }

  private retireRow(row: Row): void {
    row.retiring = true;
    const { need } = this.quests.progressFor(row.step);
    row.count.setText(`${need} / ${need}`);
    row.root.setScale(1);
    row.label.setX(-(row.count.width + COUNT_GAP));
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
      const y = i * ROW_H;
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
      let a = Phaser.Math.Clamp((VIEW_H - top) / ROW_H, 0, 1);
      if (scrolled) a = Math.min(a, Phaser.Math.Clamp((top + ROW_H) / ROW_H, 0, 1));
      row.root.setAlpha(a * row.reveal);
    }
  }

  private maxScroll(): number {
    return Math.max(0, this.rows.length * ROW_H - VIEW_H);
  }

  private scrollBy(delta: number): void {
    const max = this.maxScroll();
    if (max <= 0) return;
    this.scrollY = Phaser.Math.Clamp(this.scrollY + delta, 0, max);
    this.rowsGroup.setY(-this.scrollY);
    this.applyFade();
  }

  /** Is the pointer over the list? Pointer coords arrive in the same 2560-space
   *  the UI is authored in (UIScene's camera is fixed), so this is a plain rect
   *  test against the viewport's own bounds. */
  private overList(pointer: Phaser.Input.Pointer): boolean {
    if (!this.tasksVisible) return false;
    const left = this.x - VIEW_W * this.scaleX;
    const top = this.y + LIST_TOP_Y * this.scaleY;
    return (
      pointer.x >= left &&
      pointer.x <= this.x &&
      pointer.y >= top &&
      pointer.y <= top + VIEW_H * this.scaleY
    );
  }

  private onWheel(pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number): void {
    if (this.overList(pointer)) this.scrollBy(dy * 0.6);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.maxScroll() <= 0 || !this.overList(pointer)) return;
    this.dragging = true;
    this.dragLastY = pointer.y;
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.dragging) return;
    this.scrollBy(-(pointer.y - this.dragLastY));
    this.dragLastY = pointer.y;
  }

  private onPointerUp(): void {
    this.dragging = false;
  }

  /** Geometry masks live in WORLD space, so the clip rect is re-cut whenever the
   *  cluster's geometry could have moved (visibility flips, re-layout). */
  private seatMask(): void {
    const w = VIEW_W * this.scaleX;
    const h = VIEW_H * this.scaleY;
    const x = this.x - w;
    const y = this.y + LIST_TOP_Y * this.scaleY;
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
