import Phaser from 'phaser';
import { GAME_WIDTH, ITEM_SCALE, LIVE_GAME_HEIGHT, num, PALETTE } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { OrderConfig, OrderOption, OrdersData } from '../core/types';

const FONT = 'Trebuchet MS, Verdana, sans-serif';

/** One "market" row in a multi-option order: what you give → what you get + a
 *  green claim button. */
interface OptionRow {
  root: Phaser.GameObjects.Container;
  giveIcon: Phaser.GameObjects.Image;
  giveText: Phaser.GameObjects.Text;
  rewardIcon: Phaser.GameObjects.Image;
  rewardText: Phaser.GameObjects.Text;
  button: Phaser.GameObjects.Container;
  buttonBg: Phaser.GameObjects.Image;
  buttonLabel: Phaser.GameObjects.Text;
}

/**
 * Cindra's Ledger — the Magic-Orders-style panel: cream board with a warm
 * red frame, title lozenge, Cindra's order card with required item slots and
 * a glossy green Deliver button.
 */
export class LedgerPanel extends Phaser.GameObjects.Container {
  isOpen = false;
  private readonly offBus: Array<() => void> = [];
  private dim: Phaser.GameObjects.Rectangle;
  private titleText: Phaser.GameObjects.Text;
  private orderTitle: Phaser.GameObjects.Text;
  private blurb: Phaser.GameObjects.Text;
  private rewardKeys: Phaser.GameObjects.Text;
  private rewardIcon: Phaser.GameObjects.Image;
  private rewardRow: Phaser.GameObjects.Container;
  private slotIcon: Phaser.GameObjects.Image;
  private slotCount: Phaser.GameObjects.Text;
  private deliverButton: Phaser.GameObjects.Container;
  private deliverText: Phaser.GameObjects.Text;
  private emptyText: Phaser.GameObjects.Text;
  private card: Phaser.GameObjects.Container;
  private optionsContainer: Phaser.GameObjects.Container;
  private optionRows: OptionRow[] = [];
  private deliverable = false;
  private deliverAllowed = true;
  private currentOrder: OrderConfig | null = null;

  constructor(
    scene: Phaser.Scene,
    private bus: EventBus,
    private gameState: GameState,
    private orders: OrdersData
  ) {
    super(scene, GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2);

    this.dim = scene.add
      .rectangle(0, 0, GAME_WIDTH, LIVE_GAME_HEIGHT, num(PALETTE.night), 0.45)
      .setInteractive(); // swallow board input behind the panel
    this.dim.on('pointerup', () => this.requestClose());

    const panel = scene.add.image(0, 16, 'ui_panel');

    // Title lozenge.
    const titleBg = scene.add.graphics();
    titleBg.fillStyle(num(PALETTE.lava), 1);
    titleBg.fillRoundedRect(-300, -436, 600, 104, 52);
    titleBg.lineStyle(6, num(PALETTE.cream), 0.95);
    titleBg.strokeRoundedRect(-300, -436, 600, 104, 52);
    this.titleText = scene.add
      .text(0, -384, 'Cindra’s Ledger', {
        fontFamily: FONT,
        fontSize: '52px',
        fontStyle: 'bold',
        color: PALETTE.cream
      })
      .setOrigin(0.5)
      .setShadow(0, 4, 'rgba(36,27,34,0.5)', 6);

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

    // Left column: order text + rewards.
    this.orderTitle = scene.add
      .text(-560, -240, '', {
        fontFamily: FONT,
        fontSize: '46px',
        fontStyle: 'bold',
        color: PALETTE.textBrown,
        wordWrap: { width: 500 }
      })
      .setOrigin(0, 0);
    this.blurb = scene.add
      .text(-560, -148, '', {
        fontFamily: FONT,
        fontSize: '32px',
        color: '#8A6248',
        wordWrap: { width: 504 },
        lineSpacing: 8
      })
      .setOrigin(0, 0);
    this.rewardRow = scene.add.container(-560, 192);
    const rewardLabel = scene.add.text(0, -68, 'Reward:', {
      fontFamily: FONT,
      fontSize: '34px',
      fontStyle: 'bold',
      color: PALETTE.textBrown
    });
    this.rewardIcon = scene.add.image(32, 8, 'ui_icon_key').setScale(0.85);
    this.rewardKeys = scene.add
      .text(96, 8, '×1', { fontFamily: FONT, fontSize: '38px', fontStyle: 'bold', color: PALETTE.goldShade })
      .setOrigin(0, 0.5);
    this.rewardRow.add([rewardLabel, this.rewardIcon, this.rewardKeys]);

    // Right column: Cindra card with the requirement slot + deliver.
    this.card = scene.add.container(300, 16);
    const cardBg = scene.add.image(0, 0, 'ui_card').setScale(0.96);
    const portrait = scene.add.image(0, -204, 'portrait_cindra').setScale(1.12);
    const requiredLabel = scene.add
      .text(0, -76, 'Required:', {
        fontFamily: FONT,
        fontSize: '34px',
        fontStyle: 'bold',
        color: PALETTE.lavaShade
      })
      .setOrigin(0.5);
    const slot = scene.add.image(0, 32, 'ui_slot');
    this.slotIcon = scene.add.image(0, 24, 'item_flame_gem_2').setScale(0.72);
    this.slotCount = scene.add
      .text(48, 76, '0/2', {
        fontFamily: FONT,
        fontSize: '30px',
        fontStyle: 'bold',
        color: PALETTE.textBrown
      })
      .setOrigin(0.5)
      .setShadow(0, 2, '#FFFFFF', 4);

    this.deliverButton = scene.add.container(0, 232);
    const deliverBg = scene.add.image(0, 0, 'ui_btn_green');
    this.deliverText = scene.add
      .text(0, -10, 'Deliver', {
        fontFamily: FONT,
        fontSize: '52px',
        fontStyle: 'bold',
        color: '#FFFFFF'
      })
      .setOrigin(0.5)
      .setShadow(0, 4, 'rgba(36,27,34,0.5)', 6);
    this.deliverButton.add([deliverBg, this.deliverText]);
    // The button art is centred on the container origin. setSize + an explicit
    // origin-centred hit rect makes the WHOLE button clickable (a plain setSize
    // default hit rect (0,0,w,h) only covers the bottom-right quadrant of a
    // centred container — clicks on the rest miss). The bg image carries the
    // interaction so the nested-container transform doesn't muddle the hit test.
    deliverBg.setInteractive({ useHandCursor: true });
    deliverBg.on('pointerup', () => this.onDeliverPressed());
    this.deliverButton.setSize(400, 140);

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

    this.card.add([cardBg, portrait, requiredLabel, slot, this.slotIcon, this.slotCount, this.deliverButton]);

    // Multi-option layout ("two markets"): a stack of give → get rows, each with
    // its own claim button. Occupies the right half (the single Cindra card is
    // hidden in this mode). Built once, populated per active order in refresh().
    this.optionsContainer = scene.add.container(240, 40);
    for (let i = 0; i < 2; i++) {
      const root = scene.add.container(0, i === 0 ? -140 : 140);
      const slotBg = scene.add.image(-236, 0, 'ui_slot').setScale(0.62);
      const giveIcon = scene.add.image(-236, -6, '__DEFAULT').setScale(0.7);
      const giveText = scene.add
        .text(-236, 62, '', { fontFamily: FONT, fontSize: '32px', fontStyle: 'bold', color: PALETTE.textBrown })
        .setOrigin(0.5)
        .setShadow(0, 2, '#FFFFFF', 4);
      const arrow = scene.add
        .text(-116, -10, '→', { fontFamily: FONT, fontSize: '52px', fontStyle: 'bold', color: PALETTE.lavaShade })
        .setOrigin(0.5);
      const rewardIcon = scene.add.image(-34, -6, '__DEFAULT').setScale(0.7);
      const rewardText = scene.add
        .text(26, -6, '', { fontFamily: FONT, fontSize: '40px', fontStyle: 'bold', color: PALETTE.goldShade })
        .setOrigin(0, 0.5);
      const button = scene.add.container(236, 0);
      const buttonBg = scene.add.image(0, 0, 'ui_btn_green').setScale(0.66);
      const buttonLabel = scene.add
        .text(0, -8, '', { fontFamily: FONT, fontSize: '38px', fontStyle: 'bold', color: '#FFFFFF' })
        .setOrigin(0.5)
        .setShadow(0, 3, 'rgba(36,27,34,0.5)', 5);
      button.add([buttonBg, buttonLabel]);
      buttonBg.setInteractive({ useHandCursor: true });
      buttonBg.on('pointerup', () => this.onOptionPressed(i));
      root.add([slotBg, giveIcon, giveText, arrow, rewardIcon, rewardText, button]);
      this.optionsContainer.add(root);
      this.optionRows.push({ root, giveIcon, giveText, rewardIcon, rewardText, button, buttonBg, buttonLabel });
    }
    this.optionsContainer.setVisible(false);

    this.add([
      this.dim,
      panel,
      titleBg,
      this.titleText,
      closeButton,
      this.orderTitle,
      this.blurb,
      this.rewardRow,
      this.card,
      this.optionsContainer,
      this.emptyText
    ]);
    scene.add.existing(this);
    this.setVisible(false);

    this.offBus.push(
      bus.on('order:progress', ({ have, deliverable }) => {
        this.deliverable = deliverable;
        this.refresh(have[0] ?? 0);
      }),
      bus.on('order:completed', () => this.refresh(0)),
      // Coins changed → re-check the "pay coins" option's affordability.
      bus.on('economy:changed', () => {
        if (this.isOpen) this.refresh();
      })
    );
  }

  teardown(): void {
    this.offBus.forEach((off) => off());
    this.offBus.length = 0;
  }

  /** World position of the Deliver button (for the tutorial hand). */
  getDeliverPos(): { x: number; y: number } {
    return { x: this.x + this.card.x + this.deliverButton.x, y: this.y + this.card.y + this.deliverButton.y };
  }

  setDeliverAllowed(allowed: boolean): void {
    this.deliverAllowed = allowed;
  }

  /** Deliver the active order, or shake the button if it isn't ready. */
  private onDeliverPressed(): void {
    if (this.deliverable && this.deliverAllowed && this.currentOrder) {
      this.bus.emit('ui:deliver_requested', { orderId: this.currentOrder.id });
    } else if (!this.deliverable) {
      this.scene.tweens.add({
        targets: this.deliverButton,
        x: this.deliverButton.x + 10,
        duration: 45,
        yoyo: true,
        repeat: 3
      });
    }
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.refresh();
    this.setVisible(true);
    this.setAlpha(0);
    this.setScale(0.92);
    this.scene.tweens.add({ targets: this, alpha: 1, scale: 1, duration: 200, ease: 'Back.easeOut' });
    this.bus.emit('ui:ledger_toggled', { open: true });
  }

  requestClose(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scale: 0.94,
      duration: 150,
      ease: 'Sine.easeIn',
      onComplete: () => this.setVisible(false)
    });
    this.bus.emit('ui:ledger_toggled', { open: false });
  }

  private activeOrder(): OrderConfig | null {
    return this.orders.orders.find((o) => !this.gameState.completedOrderIds.includes(o.id)) ?? null;
  }

  /** Can this option be claimed right now? (mirrors OrderSystem.optionDeliverable) */
  private optionAffordable(opt: OrderOption): boolean {
    if (opt.requires) {
      for (const req of opt.requires) {
        if (this.gameState.countItems(req.chain, req.tier) < req.count) return false;
      }
    }
    if (opt.costCoins != null && this.gameState.coins < opt.costCoins) return false;
    return true;
  }

  private onOptionPressed(index: number): void {
    const order = this.currentOrder;
    const opt = order?.options?.[index];
    if (!order || !opt) return;
    if (this.optionAffordable(opt) && this.deliverAllowed) {
      this.bus.emit('ui:deliver_requested', { orderId: order.id, optionIndex: index });
    } else {
      const button = this.optionRows[index]?.button;
      if (button) {
        this.scene.tweens.add({ targets: button, x: button.x + 10, duration: 45, yoyo: true, repeat: 3 });
      }
    }
  }

  /** Populate the two market rows from the active order's options. */
  private renderOptions(order: OrderConfig): void {
    const options = order.options ?? [];
    for (let i = 0; i < this.optionRows.length; i++) {
      const row = this.optionRows[i]!;
      const opt = options[i];
      if (!opt) {
        row.root.setVisible(false);
        continue;
      }
      row.root.setVisible(true);

      // Give side: board items ("have/need") or a coin cost ("×N").
      const req = opt.requires?.[0];
      if (req) {
        const key = `item_${req.chain}_${req.tier}`;
        const s = ITEM_SCALE[`${req.chain}_${req.tier}`] ?? ITEM_SCALE[req.chain];
        row.giveIcon.setTexture(key).setScale(s != null ? s * 1.7 : 0.7);
        const have = Math.min(this.gameState.countItems(req.chain, req.tier), req.count);
        row.giveText.setText(`${have}/${req.count}`);
      } else if (opt.costCoins != null) {
        row.giveIcon.setTexture('ui_icon_coin').setScale(0.16);
        row.giveText.setText(`×${opt.costCoins}`);
      }

      // Get side: a key, a spawned item, or coins.
      const rw = opt.rewards;
      if (rw.keys) {
        row.rewardIcon.setTexture('ui_icon_key').setScale(0.62);
        row.rewardText.setText(`×${rw.keys}`);
      } else if (rw.spawn) {
        const spawnKey = `item_${rw.spawn.chain}_${rw.spawn.tier}`;
        const ss = ITEM_SCALE[`${rw.spawn.chain}_${rw.spawn.tier}`] ?? ITEM_SCALE[rw.spawn.chain];
        row.rewardIcon.setTexture(spawnKey).setScale(ss != null ? ss * 1.5 : 0.62);
        row.rewardText.setText(`×${rw.spawn.count}`);
      } else {
        row.rewardIcon.setTexture('ui_icon_coin').setScale(0.16);
        row.rewardText.setText(`×${rw.coins ?? 0}`);
      }

      const ok = this.optionAffordable(opt);
      row.buttonLabel.setText(opt.label);
      row.buttonBg.setAlpha(ok ? 1 : 0.5);
      row.giveText.setColor(ok ? PALETTE.moss : PALETTE.textBrown);
    }
  }

  private refresh(haveOverride?: number): void {
    this.currentOrder = this.activeOrder();
    const hasOrder = this.currentOrder !== null;
    const optionsMode = !!this.currentOrder?.options?.length;
    this.orderTitle.setVisible(hasOrder);
    this.blurb.setVisible(hasOrder);
    this.rewardRow.setVisible(hasOrder && !optionsMode);
    this.card.setVisible(hasOrder && !optionsMode);
    this.optionsContainer.setVisible(hasOrder && optionsMode);
    this.emptyText.setVisible(!hasOrder);
    if (!this.currentOrder) return;

    if (optionsMode) {
      this.orderTitle.setText(this.currentOrder.title);
      this.blurb.setText(`”${this.currentOrder.blurb}”`);
      this.renderOptions(this.currentOrder);
      return;
    }

    const requirement = this.currentOrder.requires[0];
    if (!requirement) return;
    const have =
      haveOverride ??
      Math.min(this.gameState.countItems(requirement.chain, requirement.tier), requirement.count);
    this.orderTitle.setText(this.currentOrder.title);
    this.blurb.setText(`”${this.currentOrder.blurb}”`);
    const spawnReward = this.currentOrder.rewards.spawn;
    if (spawnReward) {
      const spawnKey = `item_${spawnReward.chain}_${spawnReward.tier}`;
      const boardScale = ITEM_SCALE[`${spawnReward.chain}_${spawnReward.tier}`] ?? ITEM_SCALE[spawnReward.chain] ?? 0.1;
      this.rewardIcon.setTexture(spawnKey).setScale(boardScale * 0.75);
      this.rewardKeys.setText(`×${spawnReward.count}`);
    } else {
      this.rewardIcon.setTexture('ui_icon_key').setScale(0.85);
      this.rewardKeys.setText(`×${this.currentOrder.rewards.keys}`);
    }
    const slotKey = `item_${requirement.chain}_${requirement.tier}`;
    const slotBoardScale = ITEM_SCALE[`${requirement.chain}_${requirement.tier}`] ?? ITEM_SCALE[requirement.chain];
    this.slotIcon.setTexture(slotKey).setScale(slotBoardScale != null ? slotBoardScale * 2.0 : 0.72);
    this.slotCount.setText(`${have}/${requirement.count}`);
    this.deliverable = have >= requirement.count;
    this.slotIcon.setAlpha(this.deliverable ? 1 : 0.75);
    this.deliverButton.setAlpha(this.deliverable ? 1 : 0.55);
  }
}
