import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, num, PALETTE } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { OrderConfig, OrdersData } from '../core/types';

const FONT = 'Trebuchet MS, Verdana, sans-serif';

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
  private rewardRow: Phaser.GameObjects.Container;
  private slotIcon: Phaser.GameObjects.Image;
  private slotCount: Phaser.GameObjects.Text;
  private deliverButton: Phaser.GameObjects.Container;
  private deliverText: Phaser.GameObjects.Text;
  private emptyText: Phaser.GameObjects.Text;
  private card: Phaser.GameObjects.Container;
  private deliverable = false;
  private deliverAllowed = true;
  private currentOrder: OrderConfig | null = null;

  constructor(
    scene: Phaser.Scene,
    private bus: EventBus,
    private gameState: GameState,
    private orders: OrdersData
  ) {
    super(scene, GAME_WIDTH / 2, GAME_HEIGHT / 2);

    this.dim = scene.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, num(PALETTE.night), 0.45)
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
    // Coin reward hidden for now (the coin pill is off); the Gold Key is the
    // reward shown. Keys take the coin's old slot so the row stays tidy.
    const keyIcon = scene.add.image(32, 8, 'ui_icon_key').setScale(0.85);
    this.rewardKeys = scene.add
      .text(72, 8, '×1', { fontFamily: FONT, fontSize: '38px', fontStyle: 'bold', color: PALETTE.goldShade })
      .setOrigin(0, 0.5);
    this.rewardRow.add([rewardLabel, keyIcon, this.rewardKeys]);

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
      this.emptyText
    ]);
    scene.add.existing(this);
    this.setVisible(false);

    this.offBus.push(
      bus.on('order:progress', ({ have, deliverable }) => {
        this.deliverable = deliverable;
        this.refresh(have[0] ?? 0);
      }),
      bus.on('order:completed', () => this.refresh(0))
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

  private refresh(haveOverride?: number): void {
    this.currentOrder = this.activeOrder();
    const hasOrder = this.currentOrder !== null;
    this.orderTitle.setVisible(hasOrder);
    this.blurb.setVisible(hasOrder);
    this.rewardRow.setVisible(hasOrder);
    this.card.setVisible(hasOrder);
    this.emptyText.setVisible(!hasOrder);
    if (!this.currentOrder) return;

    const requirement = this.currentOrder.requires[0];
    if (!requirement) return;
    const have =
      haveOverride ??
      Math.min(this.gameState.countItems(requirement.chain, requirement.tier), requirement.count);
    this.orderTitle.setText(this.currentOrder.title);
    this.blurb.setText(`“${this.currentOrder.blurb}”`);
    this.rewardKeys.setText(`×${this.currentOrder.rewards.keys}`);
    this.slotIcon.setTexture(`item_${requirement.chain}_${requirement.tier}`);
    this.slotCount.setText(`${have}/${requirement.count}`);
    this.deliverable = have >= requirement.count;
    this.slotIcon.setAlpha(this.deliverable ? 1 : 0.75);
    this.deliverButton.setAlpha(this.deliverable ? 1 : 0.55);
  }
}
