import Phaser from 'phaser';
import { num, PALETTE, TIMINGS } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { TutorialStepEvent } from '../core/types';

const BUBBLE_WIDTH = 1200;
const TEXT_WIDTH = 940;
const MIN_HEIGHT = 192;
const PAD = 40;

/**
 * Fairyland-style speech bubble: cream rounded card, warm brown text, and a
 * gold-ringed portrait disc overlapping the right edge. Tap-gated steps show
 * a pulsing chevron and the whole bubble is tappable.
 */
export class CharacterBubble extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private portrait: Phaser.GameObjects.Image;
  private nameTag: Phaser.GameObjects.Text;
  private nameTagBg: Phaser.GameObjects.Graphics;
  private chevron: Phaser.GameObjects.Text;
  private chevronTween: Phaser.Tweens.Tween | null = null;
  private hitZone: Phaser.GameObjects.Zone;
  private currentStepId = '';
  private tapGated = false;

  constructor(scene: Phaser.Scene, private bus: EventBus) {
    super(scene, 0, 0);
    this.bg = scene.add.graphics();
    this.label = scene.add
      .text(0, 0, '', {
        fontFamily: 'Trebuchet MS, Verdana, sans-serif',
        fontSize: '38px',
        fontStyle: 'bold',
        color: PALETTE.textBrown,
        wordWrap: { width: TEXT_WIDTH },
        lineSpacing: 8
      })
      .setOrigin(0, 0.5);
    this.portrait = scene.add.image(BUBBLE_WIDTH / 2 - 56, 0, 'portrait_pip').setScale(1.06);
    this.nameTagBg = scene.add.graphics();
    this.nameTag = scene.add
      .text(BUBBLE_WIDTH / 2 - 56, 108, 'Pip', {
        fontFamily: 'Trebuchet MS, Verdana, sans-serif',
        fontSize: '30px',
        fontStyle: 'bold',
        color: PALETTE.cream
      })
      .setOrigin(0.5);
    this.chevron = scene.add
      .text(BUBBLE_WIDTH / 2 - 172, 0, '▼', {
        fontSize: '40px',
        color: PALETTE.gold
      })
      .setOrigin(0.5);
    this.hitZone = scene.add.zone(0, 0, BUBBLE_WIDTH, MIN_HEIGHT);
    this.hitZone.setInteractive({ useHandCursor: true });
    this.hitZone.on('pointerup', () => {
      if (this.tapGated && this.visible) {
        this.bus.emit('tutorial:advance_requested', { stepId: this.currentStepId });
      }
    });
    this.add([this.bg, this.label, this.hitZone, this.portrait, this.nameTagBg, this.nameTag, this.chevron]);
    scene.add.existing(this);
    this.setVisible(false);
  }

  show(step: TutorialStepEvent): void {
    this.currentStepId = step.id;
    this.tapGated = step.gateType === 'tap';
    const speakerName = { pip: 'Pip', cindra: 'Cindra', laurah: 'Laurah' }[step.speaker];
    const tagColor = { pip: PALETTE.tealDeep, cindra: PALETTE.lavaShade, laurah: PALETTE.goldShade }[step.speaker];
    this.portrait.setTexture(`portrait_${step.speaker}`);
    // Normalise the disc to fit INSIDE the bubble (it must be shorter than the
    // min bubble height, 192, or Laurah's 412px art overflows the frame).
    this.portrait.setScale(150 / Math.max(1, this.portrait.height));
    this.nameTag.setText(speakerName);
    this.label.setText(step.text);

    const textHeight = this.label.getBounds().height;
    const height = Math.max(MIN_HEIGHT, textHeight + PAD * 2);
    const left = -BUBBLE_WIDTH / 2;
    const top = -height / 2;

    this.bg.clear();
    this.bg.fillStyle(num(PALETTE.night), 0.18);
    this.bg.fillRoundedRect(left + 8, top + 16, BUBBLE_WIDTH, height, 48);
    this.bg.fillStyle(0xfffdf6, 1);
    this.bg.fillRoundedRect(left, top, BUBBLE_WIDTH, height, 48);
    this.bg.lineStyle(7, num(PALETTE.gold), 1);
    this.bg.strokeRoundedRect(left, top, BUBBLE_WIDTH, height, 48);
    this.bg.lineStyle(3, 0xffffff, 0.9);
    this.bg.strokeRoundedRect(left + 10, top + 10, BUBBLE_WIDTH - 20, height - 20, 38);

    this.label.setPosition(left + PAD + 12, 0);
    this.hitZone.setSize(BUBBLE_WIDTH + 120, height + 60);
    // Portrait seated INSIDE the right of the bubble (centred vertically), with
    // its name tag just under it — nothing spills past the frame.
    const portraitX = BUBBLE_WIDTH / 2 - 104;
    this.portrait.setPosition(portraitX, 0);
    const tagY = 60;
    this.nameTag.setPosition(portraitX, tagY);
    this.nameTagBg.clear();
    this.nameTagBg.fillStyle(num(tagColor), 0.95);
    const tagWidth = this.nameTag.width + 36;
    this.nameTagBg.fillRoundedRect(portraitX - tagWidth / 2, tagY - 22, tagWidth, 44, 22);
    this.nameTagBg.lineStyle(4, num(PALETTE.cream), 0.9);
    this.nameTagBg.strokeRoundedRect(portraitX - tagWidth / 2, tagY - 22, tagWidth, 44, 22);

    this.chevron.setPosition(BUBBLE_WIDTH / 2 - 192, height / 2 - 36);
    this.chevron.setVisible(this.tapGated);
    this.chevronTween?.remove();
    if (this.tapGated) {
      this.chevron.setAlpha(1);
      this.chevronTween = this.scene.tweens.add({
        targets: this.chevron,
        alpha: 0.25,
        y: this.chevron.y + 8,
        duration: 520,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    }

    if (!this.visible) {
      this.setVisible(true);
      this.setAlpha(0);
      const targetY = this.y;
      this.setY(targetY + 52);
      this.scene.tweens.add({
        targets: this,
        alpha: 1,
        y: targetY,
        duration: TIMINGS.bubbleIn,
        ease: 'Back.easeOut'
      });
    } else {
      // Small re-pop between steps.
      this.scene.tweens.add({
        targets: this,
        scale: { from: 0.97, to: 1 },
        alpha: { from: 0.85, to: 1 },
        duration: 160,
        ease: 'Sine.easeOut'
      });
    }
  }

  hide(): void {
    if (!this.visible) return;
    const targetY = this.y;
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      y: targetY + 44,
      duration: 180,
      ease: 'Sine.easeIn',
      onComplete: () => {
        this.setVisible(false);
        this.setY(targetY);
      }
    });
  }
}
