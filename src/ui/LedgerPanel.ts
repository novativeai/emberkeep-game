import Phaser from 'phaser';
import { GAME_WIDTH, ITEM_SCALE, LIVE_GAME_HEIGHT, num, panelMobileScale, PALETTE } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { OrderConfig } from '../core/types';
import type { OrderSystem } from '../systems/OrderSystem';
import type { TaskSystem } from '../systems/TaskSystem';
import { uiRegistry } from './theme';

const FONT = 'Trebuchet MS, Verdana, sans-serif';
// Card centres: half the card art (640×0.9 → ±288) + this must stay inside the
// ui_panel's inner face (~±612) — at 330/0.96 the cards overflowed the frame.
const CARD_X = 300;
const TAB_W = 520;
const TAB_H = 104;
const TAB_Y = -384;

type LedgerTab = 'orders' | 'tasks';

interface OrderCard {
  root: Phaser.GameObjects.Container;
  title: Phaser.GameObjects.Text;
  slotIcon: Phaser.GameObjects.Image;
  slotCount: Phaser.GameObjects.Text;
  rewardText: Phaser.GameObjects.Text;
  deliverButton: Phaser.GameObjects.Container;
  order: OrderConfig | null;
  deliverable: boolean;
}

interface TaskRow {
  label: Phaser.GameObjects.Text;
  count: Phaser.GameObjects.Text;
  barBg: Phaser.GameObjects.Graphics;
  fill: Phaser.GameObjects.Graphics;
  check: Phaser.GameObjects.Text;
  hint: Phaser.GameObjects.Text;
}

interface TabHandle {
  root: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

/**
 * Cindra's Ledger — the game's single quest board. Two tabs under one frame:
 *   • Orders — the two-slot order board (DEMO-PLAN §Act III): both active
 *     orders visible at once, so the player CHOOSES what to chase.
 *   • Tasks — the Keeper's Tasks chapter checklist (DEMO-PLAN §Act V) with
 *     live progress bars; TaskSystem owns the reward, this page only renders.
 * The Tasks tab appears once the tutorial ends (the checklist is the encore's
 * spine, not a tutorial concern) — until then the Orders header sits centred
 * and the panel reads exactly like the tutorial's original Ledger.
 */
export class LedgerPanel extends Phaser.GameObjects.Container {
  isOpen = false;
  /** Open/rest scale — >1 on mobile so the frame fills the portrait width. */
  private baseScale = 1;
  private readonly offBus: Array<() => void> = [];
  private dim: Phaser.GameObjects.Rectangle;
  private blurb: Phaser.GameObjects.Text;
  private emptyText: Phaser.GameObjects.Text;
  private cards: OrderCard[] = [];
  private deliverAllowed = true;
  private activeTab: LedgerTab = 'orders';
  private ordersPage: Phaser.GameObjects.Container;
  private tasksPage: Phaser.GameObjects.Container;
  private ordersTab: TabHandle;
  private tasksTab: TabHandle;
  private taskRows: TaskRow[] = [];

  constructor(
    scene: Phaser.Scene,
    private bus: EventBus,
    private orderSystem: OrderSystem,
    private taskSystem: TaskSystem,
    private gameState: GameState
  ) {
    super(scene, GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2);

    this.dim = scene.add
      .rectangle(0, 0, GAME_WIDTH, LIVE_GAME_HEIGHT, num(PALETTE.night), 0.45)
      .setInteractive(); // swallow board input behind the panel
    this.dim.on('pointerup', () => this.requestClose());

    const panel = scene.add.image(0, 16, 'ui_panel');
    this.baseScale = panelMobileScale(panel.width);

    // Tab lozenges along the top edge — Orders sits centred (classic Ledger
    // header) until the tutorial ends and the Tasks tab joins it.
    this.ordersTab = this.buildTab(scene, 'Cindra’s Orders', () => this.switchTab('orders'));
    this.tasksTab = this.buildTab(scene, 'Keeper’s Tasks', () => this.switchTab('tasks'));

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

    // ---- Orders page: two cards side by side + blurb + empty text. ----
    this.ordersPage = scene.add.container(0, 0);
    this.cards.push(this.buildCard(scene, -CARD_X), this.buildCard(scene, CARD_X));

    // The active card's flavor line runs along the bottom of the board.
    this.blurb = scene.add
      .text(0, 400, '', {
        fontFamily: FONT,
        fontSize: '28px',
        fontStyle: 'italic',
        color: '#8A6248',
        align: 'center',
        wordWrap: { width: 1150 }
      })
      .setOrigin(0.5);

    this.emptyText = scene.add
      .text(0, 20, 'The brazier roars again!\nCindra will have new work for you soon.', {
        fontFamily: FONT,
        fontSize: '38px',
        fontStyle: 'bold',
        color: PALETTE.textBrown,
        align: 'center',
        lineSpacing: 12
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.ordersPage.add([...this.cards.map((c) => c.root), this.blurb, this.emptyText]);

    // ---- Tasks page: the chapter checklist. ----
    this.tasksPage = scene.add.container(0, 0).setVisible(false);
    this.buildTasksPage(scene);

    this.add([this.dim, panel, this.ordersTab.root, this.tasksTab.root, closeButton, this.ordersPage, this.tasksPage]);
    scene.add.existing(this);
    this.setVisible(false);

    uiRegistry.register(scene, 'panel.ledger', 'Cindra’s Ledger panel', 'Panels', this, {
      frame: panel,
      title: this.ordersTab.label,
      orderTitle: this.cards[0]!.title,
      blurb: this.blurb,
      card: this.cards[0]!.root
    });

    this.offBus.push(
      bus.on('order:progress', () => this.refresh()),
      bus.on('order:completed', () => this.refresh())
    );
    // The checklist counts merges/hatches/orders/gold/elder-taps — refresh the
    // Tasks page (and its tab counter) whenever any of those move while open.
    for (const event of ['item:merged', 'item:hatched', 'order:completed', 'elder:tapped', 'economy:changed', 'tasks:all_complete'] as const) {
      this.offBus.push(bus.on(event, () => this.isOpen && this.refreshTasks()));
    }
  }

  /** One header lozenge — restyled active/inactive by layoutTabs(). */
  private buildTab(scene: Phaser.Scene, text: string, onTap: () => void): TabHandle {
    const root = scene.add.container(0, TAB_Y);
    const bg = scene.add.graphics();
    const label = scene.add
      .text(0, 0, text, {
        fontFamily: FONT,
        fontSize: '40px',
        fontStyle: 'bold',
        color: PALETTE.cream
      })
      .setOrigin(0.5)
      .setShadow(0, 4, 'rgba(36,27,34,0.5)', 6);
    root.add([bg, label]);
    root.setSize(TAB_W, TAB_H);
    root.setInteractive({ useHandCursor: true });
    root.on('pointerup', onTap);
    return { root, bg, label };
  }

  /** Five checklist rows + the Cindra reward footer, in panel space. */
  private buildTasksPage(scene: Phaser.Scene): void {
    const rowTop = -236;
    const rowGap = 118;
    this.taskSystem.tasks.forEach((task, i) => {
      const y = rowTop + i * rowGap;
      const label = scene.add
        .text(-548, y, task.label, {
          fontFamily: FONT,
          fontSize: '31px',
          fontStyle: 'bold',
          color: PALETTE.textBrown,
          wordWrap: { width: 640 }
        })
        .setOrigin(0, 0.5);
      const barX = 160;
      const barBg = scene.add.graphics();
      barBg.fillStyle(num(PALETTE.plumShade), 0.5);
      barBg.fillRoundedRect(barX, y + 18, 320, 22, 11);
      const fill = scene.add.graphics();
      const count = scene.add
        .text(barX + 160, y - 14, '', {
          fontFamily: FONT,
          fontSize: '27px',
          fontStyle: 'bold',
          color: PALETTE.goldShade
        })
        .setOrigin(0.5);
      const check = scene.add
        .text(548, y, '✓', {
          fontFamily: FONT,
          fontSize: '46px',
          fontStyle: 'bold',
          color: PALETTE.mossShade
        })
        .setOrigin(0.5)
        .setVisible(false);
      // Replaces the bar while the task's subject doesn't exist yet.
      const hint = scene.add
        .text(340, y, task.lockedHint ? `🔒 ${task.lockedHint}` : '', {
          fontFamily: FONT,
          fontSize: '24px',
          fontStyle: 'italic',
          color: '#8A6248',
          align: 'center',
          wordWrap: { width: 430 }
        })
        .setOrigin(0.5)
        .setVisible(false);
      this.tasksPage.add([label, barBg, fill, count, check, hint]);
      this.taskRows.push({ label, count, barBg, fill, check, hint });
    });

    const footer = scene.add
      .text(0, 348, `Finish all ${this.taskSystem.tasks.length} → a golden reward from Cindra`, {
        fontFamily: FONT,
        fontSize: '28px',
        fontStyle: 'bold',
        color: PALETTE.goldShade
      })
      .setOrigin(0.5);
    this.tasksPage.add(footer);
  }

  /** One order card: portrait, title, requirement slot, reward line, Deliver. */
  private buildCard(scene: Phaser.Scene, x: number): OrderCard {
    const root = scene.add.container(x, 16);
    const cardBg = scene.add.image(0, 0, 'ui_card').setScale(0.9);
    // Fixed on-card size — the real 412px bubble-icon art and the 192px
    // painted fallback must both read the same here.
    const portrait = scene.add.image(0, -218, 'portrait_cindra').setDisplaySize(178, 178);
    const title = scene.add
      .text(0, -96, '', {
        fontFamily: FONT,
        fontSize: '30px',
        fontStyle: 'bold',
        color: PALETTE.textBrown,
        align: 'center',
        wordWrap: { width: 400 }
      })
      .setOrigin(0.5);
    const slot = scene.add.image(0, 36, 'ui_slot');
    const slotIcon = scene.add.image(0, 28, 'item_flame_gem_2').setScale(0.72);
    const slotCount = scene.add
      .text(48, 80, '0/0', {
        fontFamily: FONT,
        fontSize: '30px',
        fontStyle: 'bold',
        color: PALETTE.textBrown
      })
      .setOrigin(0.5)
      .setShadow(0, 2, '#FFFFFF', 4);
    const rewardText = scene.add
      .text(0, 148, '', {
        fontFamily: FONT,
        fontSize: '28px',
        fontStyle: 'bold',
        color: PALETTE.goldShade
      })
      .setOrigin(0.5);

    const deliverButton = scene.add.container(0, 232);
    const deliverBg = scene.add.image(0, 0, 'ui_btn_green').setScale(0.86);
    const deliverText = scene.add
      .text(0, -8, 'Deliver', {
        fontFamily: FONT,
        fontSize: '44px',
        fontStyle: 'bold',
        color: '#FFFFFF'
      })
      .setOrigin(0.5)
      .setShadow(0, 4, 'rgba(36,27,34,0.5)', 6);
    deliverButton.add([deliverBg, deliverText]);
    // The bg image carries the interaction so the nested-container transform
    // doesn't muddle the hit test (see the original single-card notes).
    deliverBg.setInteractive({ useHandCursor: true });
    deliverButton.setSize(360, 124);

    const card: OrderCard = {
      root,
      title,
      slotIcon,
      slotCount,
      rewardText,
      deliverButton,
      order: null,
      deliverable: false
    };
    deliverBg.on('pointerup', () => this.onDeliverPressed(card));
    root.add([cardBg, portrait, title, slot, slotIcon, slotCount, rewardText, deliverButton]);
    return card;
  }

  teardown(): void {
    this.offBus.forEach((off) => off());
    this.offBus.length = 0;
  }

  /** World position of the FIRST card's Deliver button (tutorial hand target). */
  getDeliverPos(): { x: number; y: number } {
    const card = this.cards[0]!;
    // Local offsets scaled by the panel's own scale (>1 on mobile) so the pointer
    // tracks the Deliver button through the portrait magnification.
    return {
      x: this.x + (card.root.x + card.deliverButton.x) * this.scaleX,
      y: this.y + (card.root.y + card.deliverButton.y) * this.scaleY
    };
  }

  setDeliverAllowed(allowed: boolean): void {
    this.deliverAllowed = allowed;
  }

  /** Deliver a card's order, or shake its button if it isn't ready. */
  private onDeliverPressed(card: OrderCard): void {
    if (card.deliverable && this.deliverAllowed && card.order) {
      this.bus.emit('ui:deliver_requested', { orderId: card.order.id });
    } else if (!card.deliverable) {
      this.scene.tweens.add({
        targets: card.deliverButton,
        x: card.deliverButton.x + 10,
        duration: 45,
        yoyo: true,
        repeat: 3
      });
    }
  }

  open(tab: LedgerTab = 'orders'): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.activeTab = this.gameState.tutorialDone ? tab : 'orders';
    this.refresh();
    this.refreshTasks();
    this.layoutTabs();
    // A still-running close tween would re-hide the panel from its onComplete.
    this.scene.tweens.killTweensOf(this);
    this.setVisible(true);
    this.setAlpha(0);
    this.setScale(this.baseScale * 0.92);
    this.scene.tweens.add({ targets: this, alpha: 1, scale: this.baseScale, duration: 200, ease: 'Back.easeOut' });
    this.bus.emit('ui:ledger_toggled', { open: true });
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
    this.bus.emit('ui:ledger_toggled', { open: false });
  }

  private switchTab(tab: LedgerTab): void {
    if (tab === this.activeTab || (tab === 'tasks' && !this.gameState.tutorialDone)) return;
    this.activeTab = tab;
    if (tab === 'tasks') this.refreshTasks();
    else this.refresh();
    this.layoutTabs();
    // A soft pop as the page lands.
    const page = tab === 'tasks' ? this.tasksPage : this.ordersPage;
    page.setAlpha(0);
    this.scene.tweens.add({ targets: page, alpha: 1, duration: 140, ease: 'Sine.easeOut' });
  }

  /** Position + restyle the header tabs, and flip page visibility. The Tasks
   *  tab only exists post-tutorial; before that the Orders lozenge sits alone,
   *  centred, exactly like the tutorial's original Ledger title. */
  private layoutTabs(): void {
    const twoTabs = this.gameState.tutorialDone;
    this.tasksTab.root.setVisible(twoTabs);
    this.ordersTab.root.x = twoTabs ? -270 : 0;
    this.tasksTab.root.x = 270;
    this.paintTab(this.ordersTab, PALETTE.lava, this.activeTab === 'orders');
    this.paintTab(this.tasksTab, PALETTE.gold, this.activeTab === 'tasks');
    // Gold's cream stroke washes out — the tasks tab keeps brown text.
    this.tasksTab.label.setColor(this.activeTab === 'tasks' ? PALETTE.textBrown : PALETTE.cream);
    this.ordersPage.setVisible(this.activeTab === 'orders');
    this.tasksPage.setVisible(this.activeTab === 'tasks');
  }

  private paintTab(tab: TabHandle, activeColor: string, active: boolean): void {
    tab.bg.clear();
    tab.bg.fillStyle(active ? num(activeColor) : num(PALETTE.plumShade), active ? 1 : 0.92);
    tab.bg.fillRoundedRect(-TAB_W / 2, -TAB_H / 2, TAB_W, TAB_H, TAB_H / 2);
    tab.bg.lineStyle(6, num(PALETTE.cream), active ? 0.95 : 0.4);
    tab.bg.strokeRoundedRect(-TAB_W / 2, -TAB_H / 2, TAB_W, TAB_H, TAB_H / 2);
    tab.label.setAlpha(active ? 1 : 0.8);
    tab.root.setScale(active ? 1 : 0.94);
  }

  private refresh(): void {
    const orders = this.orderSystem.activeOrders;
    this.emptyText.setVisible(orders.length === 0);
    this.blurb.setVisible(orders.length > 0);
    this.blurb.setText(orders[0] ? `”${orders[0].blurb}”` : '');

    this.cards.forEach((card, i) => {
      const order = orders[i] ?? null;
      card.order = order;
      card.root.setVisible(order !== null);
      if (!order) {
        card.deliverable = false;
        return;
      }
      const requirement = order.requires[0];
      if (!requirement) return;
      const { have, deliverable } = this.orderSystem.progressFor(order);
      card.deliverable = deliverable;
      card.title.setText(order.title);
      const slotKey = `item_${requirement.chain}_${requirement.tier}`;
      const slotBoardScale =
        ITEM_SCALE[`${requirement.chain}_${requirement.tier}`] ?? ITEM_SCALE[requirement.chain];
      card.slotIcon.setTexture(slotKey).setScale(slotBoardScale != null ? slotBoardScale * 2.0 : 0.72);
      card.slotCount.setText(`${have[0] ?? 0}/${requirement.count}`);
      const parts: string[] = [];
      if (order.rewards.coins) parts.push(`🪙 ${order.rewards.coins}`);
      if (order.rewards.xp) parts.push(`✦ ${order.rewards.xp} XP`);
      if (order.rewards.spawn) parts.push('🎁 ???');
      if (order.rewards.tease) parts.push(order.rewards.tease);
      card.rewardText.setText(parts.join('   '));
      card.slotIcon.setAlpha(deliverable ? 1 : 0.75);
      card.deliverButton.setAlpha(deliverable ? 1 : 0.55);
    });
  }

  /** Repaint the checklist rows AND the tab's live done-counter. */
  private refreshTasks(): void {
    const rowTop = -236;
    const rowGap = 118;
    const barX = 160;
    let doneCount = 0;
    this.taskSystem.tasks.forEach((task, i) => {
      const row = this.taskRows[i];
      if (!row) return;
      const y = rowTop + i * rowGap;
      const progress = this.taskSystem.progressFor(task);
      const done = progress >= task.target;
      if (done) doneCount += 1;
      const locked = !done && this.taskSystem.isLocked(task);
      row.barBg.setVisible(!locked);
      row.count.setVisible(!locked);
      row.hint.setVisible(locked);
      row.count.setText(`${progress} / ${task.target}`);
      row.check.setVisible(done);
      row.fill.clear();
      if (!locked) {
        row.fill.fillStyle(num(done ? PALETTE.moss : PALETTE.gold), 1);
        row.fill.fillRoundedRect(barX, y + 18, Math.max(12, (progress / task.target) * 320), 22, 11);
      }
      row.label.setAlpha(done ? 0.62 : locked ? 0.5 : 1);
    });
    this.tasksTab.label.setText(`Keeper’s Tasks  ${doneCount}/${this.taskSystem.tasks.length}`);
  }
}
