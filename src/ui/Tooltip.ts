import Phaser from 'phaser';
import { num, PALETTE } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { ChainsData } from '../core/types';
import { uiRegistry } from './theme';

const FONT = 'Trebuchet MS, Verdana, sans-serif';
const WIDTH = 460;
const HEIGHT = 236;

/**
 * Item tooltip: name, tier dots, sell-for-coins button. Opens above the
 * tapped item; any outside tap closes it (handled by UIScene).
 */
export class Tooltip extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Graphics;
  private nameText: Phaser.GameObjects.Text;
  private dots: Phaser.GameObjects.Arc[] = [];
  private sellButton: Phaser.GameObjects.Container;
  private sellText: Phaser.GameObjects.Text;
  private currentItemId = 0;

  constructor(scene: Phaser.Scene, private bus: EventBus, private chains: ChainsData) {
    super(scene, 0, 0);
    this.bg = scene.add.graphics();
    this.bg.fillStyle(num(PALETTE.night), 0.2);
    this.bg.fillRoundedRect(-WIDTH / 2 + 6, -HEIGHT + 12, WIDTH, HEIGHT, 32);
    this.bg.fillStyle(0xfffdf6, 0.98);
    this.bg.fillRoundedRect(-WIDTH / 2, -HEIGHT, WIDTH, HEIGHT, 32);
    this.bg.lineStyle(6, num(PALETTE.gold), 1);
    this.bg.strokeRoundedRect(-WIDTH / 2, -HEIGHT, WIDTH, HEIGHT, 32);
    // Pointer nub.
    this.bg.fillStyle(0xfffdf6, 0.98);
    this.bg.fillTriangle(-20, -6, 20, -6, 0, 20);
    this.bg.lineStyle(6, num(PALETTE.gold), 1);
    this.bg.beginPath();
    this.bg.moveTo(-20, -4);
    this.bg.lineTo(0, 20);
    this.bg.lineTo(20, -4);
    this.bg.strokePath();

    this.nameText = scene.add
      .text(0, -HEIGHT + 52, '', {
        fontFamily: FONT,
        fontSize: '36px',
        fontStyle: 'bold',
        color: PALETTE.textBrown
      })
      .setOrigin(0.5);

    for (let i = 0; i < 3; i++) {
      const dot = scene.add
        .circle(-52 + i * 52, -HEIGHT + 104, 14, num(PALETTE.gold))
        .setStrokeStyle(4, num(PALETTE.goldShade));
      this.dots.push(dot);
    }

    this.sellButton = scene.add.container(0, -HEIGHT + 176);
    const sellBg = scene.add.image(0, 0, 'ui_btn_green').setScale(0.72, 0.62);
    this.sellText = scene.add
      .text(0, -3, 'Sell +1', {
        fontFamily: FONT,
        fontSize: '34px',
        fontStyle: 'bold',
        color: '#FFFFFF'
      })
      .setOrigin(0.5)
      .setShadow(0, 4, 'rgba(36,27,34,0.45)', 4);
    this.sellButton.add([sellBg, this.sellText]);
    this.sellButton.setSize(300, 92);
    this.sellButton.setInteractive({ useHandCursor: true });
    this.sellButton.on('pointerup', (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      if (this.currentItemId > 0) {
        this.bus.emit('ui:sell_requested', { itemId: this.currentItemId });
        this.close();
      }
    });

    this.add([this.bg, this.nameText, ...this.dots, this.sellButton]);
    scene.add.existing(this);
    this.setVisible(false);
    // Self-positioned: openFor() places it per item and consumes the theme
    // offset itself, so the registry must not write this container's x/y.
    uiRegistry.register(scene, 'dialogue.tooltip', 'Item tooltip', 'Dialogue', this, {
      name: this.nameText,
      sellLabel: this.sellText,
      sellBg
    }, { selfPositioned: true });
  }

  openFor(itemId: number, chain: string, tier: number, x: number, y: number): void {
    const chainConfig = this.chains.chains.find((c) => c.id === chain);
    const tierConfig = chainConfig?.tiers.find((t) => t.tier === tier);
    if (!tierConfig) return;
    this.currentItemId = itemId;
    this.nameText.setText(tierConfig.name);
    const maxTier = chainConfig?.tiers.length ?? 3;
    this.dots.forEach((dot, i) => {
      dot.setVisible(i < maxTier);
      dot.setFillStyle(i < tier ? num(PALETTE.gold) : num(PALETTE.cream));
    });
    this.sellText.setText(`Sell +${tierConfig.sell}`);
    // Theme offset/scale from the UI Builder ride on top of the computed spot.
    const off = uiRegistry.offsetOf('dialogue.tooltip');
    const themeScale = uiRegistry.doc.elements['dialogue.tooltip']?.scale ?? 1;
    this.setPosition(
      Phaser.Math.Clamp(x, 280, 2280) + off.dx,
      Math.max(y - 128, HEIGHT + 28) + off.dy
    );
    this.setVisible(true);
    this.setAlpha(0);
    this.setScale(0.85 * themeScale);
    this.scene.tweens.add({
      targets: this,
      alpha: 1,
      scale: themeScale,
      duration: 140,
      ease: 'Back.easeOut'
    });
  }

  close(): void {
    this.currentItemId = 0;
    this.setVisible(false);
  }

  get openItemId(): number {
    return this.currentItemId;
  }
}
