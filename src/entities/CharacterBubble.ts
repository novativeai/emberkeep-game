import Phaser from 'phaser';
import { num, PALETTE, TIMINGS } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { TutorialStepEvent } from '../core/types';
import { uiRegistry } from '../ui/theme';

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
  private lastStep: TutorialStepEvent | null = null;
  private samplePeek = false;
  private sayTimer: Phaser.Time.TimerEvent | null = null;

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
    this.portrait = scene.add.image(BUBBLE_WIDTH / 2 - 56, 0, 'portrait_laurah').setScale(1.06);
    this.nameTagBg = scene.add.graphics();
    this.nameTag = scene.add
      .text(BUBBLE_WIDTH / 2 - 56, 108, 'Laurah', {
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

  /** UI Builder registration — call AFTER the scene has positioned the bubble
   *  so the theme offset applies on top of the authored spot. */
  registerUi(): void {
    uiRegistry.register(
      this.scene,
      'dialogue.bubble',
      'Laurah dialogue bubble',
      'Dialogue',
      this,
      {
        text: this.label,
        portrait: this.portrait,
        name: this.nameTag,
        chevron: this.chevron
      },
      {
        // layout() owns these transforms; it consumes partOffsetOf() so the
        // editor can move/scale the portrait, name tag, text and chevron.
        selfLaidOutParts: ['text', 'portrait', 'name', 'chevron'],
        relayout: () => this.relayout(),
        onPeek: (on) => this.previewSample(on),
        paramsSpec: [
          { key: 'width', label: 'Bubble width', min: 640, max: 2000, step: 10, dflt: BUBBLE_WIDTH },
          { key: 'textWidth', label: 'Text wrap width', min: 400, max: 1800, step: 10, dflt: TEXT_WIDTH },
          { key: 'minHeight', label: 'Min height', min: 120, max: 480, step: 4, dflt: MIN_HEIGHT }
        ]
      }
    );
  }

  /** Editor peek on a quiet bubble: show a sample line so there is something
   *  to style; restore the hidden state when the peek ends. */
  private previewSample(on: boolean): void {
    if (on) {
      if (this.lastStep) {
        this.relayout();
        return;
      }
      this.samplePeek = true;
      this.tapGated = true;
      this.nameTag.setText('Laurah');
      this.label.setText('Long ago, Emberkeep blazed with dragon fire. Then the cold came... and the dragons slept.');
      this.layout('laurah');
    } else if (this.samplePeek) {
      this.samplePeek = false;
      this.label.setText('');
      this.setVisible(false);
    }
  }

  /** Re-run layout with current content (theme params/offsets changed). */
  relayout(): void {
    if (!this.visible && !this.samplePeek) return;
    if (this.lastStep) {
      const step = this.lastStep;
      const speaker = { cindra: 'Cindra', laurah: 'Laurah' }[step.speaker] ?? step.speaker;
      this.nameTag.setText(speaker);
      this.label.setText(step.text);
      this.layout(step.speaker);
    } else if (this.samplePeek) {
      this.layout('laurah');
    }
  }

  /**
   * A one-off spoken line OUTSIDE the tutorial (Cindra's finale beat, Laurah's
   * post-tutorial nudges). Not tap-gated; auto-hides after `holdMs`. Never used
   * while a tutorial step is up — the tutorial owns the bubble until it's done.
   */
  say(speaker: 'cindra' | 'laurah', text: string, holdMs = 4200): void {
    this.sayTimer?.remove();
    this.currentStepId = '';
    this.tapGated = false;
    this.lastStep = null;
    this.samplePeek = false;
    this.chevronTween?.remove();
    const speakerName = { cindra: 'Cindra', laurah: 'Laurah' }[speaker] ?? speaker;
    this.nameTag.setText(speakerName);
    this.label.setText(text);
    this.layout(speaker);
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
      this.scene.tweens.add({
        targets: this,
        scale: { from: 0.97, to: 1 },
        alpha: { from: 0.85, to: 1 },
        duration: 160,
        ease: 'Sine.easeOut'
      });
    }
    this.sayTimer = this.scene.time.delayedCall(holdMs, () => this.hide());
  }

  show(step: TutorialStepEvent): void {
    this.sayTimer?.remove();
    this.sayTimer = null;
    this.currentStepId = step.id;
    this.tapGated = step.gateType === 'tap';
    this.lastStep = step;
    this.samplePeek = false;
    const speakerName = { cindra: 'Cindra', laurah: 'Laurah' }[step.speaker] ?? step.speaker;
    this.nameTag.setText(speakerName);
    this.label.setText(step.text);
    this.layout(step.speaker);
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

  /** Geometry pass: draws the card and seats every part. Theme-aware — the
   *  UI Builder's bubble width/text width knobs and per-part offsets/scales
   *  (partOffsetOf) are consumed HERE, so they survive every re-layout. */
  private layout(speaker: string): void {
    const ID = 'dialogue.bubble';
    const width = uiRegistry.paramOf(ID, 'width', BUBBLE_WIDTH);
    const textWidth = uiRegistry.paramOf(ID, 'textWidth', TEXT_WIDTH);
    const minHeight = uiRegistry.paramOf(ID, 'minHeight', MIN_HEIGHT);
    const tagColor = { cindra: PALETTE.lavaShade, laurah: PALETTE.goldShade }[speaker] ?? PALETTE.goldShade;
    const oText = uiRegistry.partOffsetOf(ID, 'text');
    const oPortrait = uiRegistry.partOffsetOf(ID, 'portrait');
    const oName = uiRegistry.partOffsetOf(ID, 'name');
    const oChevron = uiRegistry.partOffsetOf(ID, 'chevron');

    if (this.scene.textures.exists(`portrait_${speaker}`)) this.portrait.setTexture(`portrait_${speaker}`);
    // Normalise the disc to fit INSIDE the bubble (it must be shorter than the
    // min bubble height, or Laurah's 412px art overflows the frame).
    this.portrait.setScale((150 / Math.max(1, this.portrait.height)) * oPortrait.scale);
    this.label.setWordWrapWidth(textWidth);
    this.label.setScale(oText.scale);

    const textHeight = this.label.getBounds().height;
    const height = Math.max(minHeight, textHeight + PAD * 2);
    const left = -width / 2;
    const top = -height / 2;

    this.bg.clear();
    this.bg.fillStyle(num(PALETTE.night), 0.18);
    this.bg.fillRoundedRect(left + 8, top + 16, width, height, 48);
    this.bg.fillStyle(0xfffdf6, 1);
    this.bg.fillRoundedRect(left, top, width, height, 48);
    this.bg.lineStyle(7, num(PALETTE.gold), 1);
    this.bg.strokeRoundedRect(left, top, width, height, 48);
    this.bg.lineStyle(3, 0xffffff, 0.9);
    this.bg.strokeRoundedRect(left + 10, top + 10, width - 20, height - 20, 38);

    this.label.setPosition(left + PAD + 12 + oText.dx, 0 + oText.dy);
    this.hitZone.setSize(width + 120, height + 60);
    // Portrait seated INSIDE the right of the bubble (centred vertically), with
    // its name tag just under it — nothing spills past the frame.
    const portraitX = width / 2 - 104;
    this.portrait.setPosition(portraitX + oPortrait.dx, 0 + oPortrait.dy);
    const tagX = portraitX + oName.dx;
    const tagY = 60 + oName.dy;
    this.nameTag.setPosition(tagX, tagY);
    this.nameTag.setScale(oName.scale);
    this.nameTagBg.clear();
    this.nameTagBg.fillStyle(num(tagColor), 0.95);
    const tagWidth = this.nameTag.displayWidth + 36;
    const tagHeight = 44 * oName.scale;
    this.nameTagBg.fillRoundedRect(tagX - tagWidth / 2, tagY - tagHeight / 2, tagWidth, tagHeight, tagHeight / 2);
    this.nameTagBg.lineStyle(4, num(PALETTE.cream), 0.9);
    this.nameTagBg.strokeRoundedRect(tagX - tagWidth / 2, tagY - tagHeight / 2, tagWidth, tagHeight, tagHeight / 2);

    this.chevron.setPosition(width / 2 - 192 + oChevron.dx, height / 2 - 36 + oChevron.dy);
    this.chevron.setScale(oChevron.scale);
    this.chevron.setVisible(this.tapGated);
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
