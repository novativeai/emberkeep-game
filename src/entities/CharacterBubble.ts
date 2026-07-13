import Phaser from 'phaser';
import { num, PALETTE, TIMINGS } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { TutorialStepEvent } from '../core/types';
import { LAURAH_DISC_TEXTURE, PortraitAnimator } from './PortraitAnimator';
import { uiRegistry } from '../ui/theme';

const BUBBLE_WIDTH = 1200;
const TEXT_WIDTH = 940;
const MIN_HEIGHT = 192;
const PAD = 40;
/** Portrait ring display diameter. */
const RING_SIZE = 300;
/** Ring art geometry (scripts/bake-laurah-portrait.py): hole is 400/512 of the
 *  512 canvas — the transparent window Laurah's bust rises through. */
const RING_HOLE_RADIUS = RING_SIZE * (200 / 512);
/** Cindra's (and any future static speaker's) disc fits INSIDE the hole like a
 *  medallion photo — the old, fully-contained treatment. */
const STATIC_DISC_SIZE = RING_SIZE * 0.98;
/** Laurah's bust cutout (scripts/bake-laurah-portrait.py, 300x400 cells, top
 *  95% of her frame). She renders as TWO synced copies of the same sheet,
 *  split-layered around the ring:
 *    - BODY copy (rows 0..BODY_CROP_ROWS) drawn BEHIND the ring — the band
 *      covers her shoulders/bottom, tucking them UNDER the exterior frame;
 *    - HEAD copy (rows 0..HEAD_CROP_ROWS) drawn ABOVE the ring — only her
 *      head/hair exceeds the frame, z-index wise.
 *  The split line sits at her NECK, where her silhouette is far inside the
 *  ring's window — both copies are pixel-identical there, so the handoff is
 *  invisible. A moss backing disc behind her fills the window. */
const LAURAH_DISPLAY_HEIGHT = 320;
const LAURAH_CELL_W = 300;
const LAURAH_CELL_H = 400;
/** Slight upward bias from dead-centre so her head clears the ring's top. */
const PORTRAIT_CENTER_DY = -4;
/** Head copy crop (cell rows): down to her neck — narrowest point (~86px wide
 *  at display scale vs the 234px window), so the seam never crosses the band. */
const HEAD_CROP_ROWS = 265;
/** Body copy circular clip radius — the ring's OUTER edge (250/512 of its
 *  canvas) minus a hair: the FULL sprite shows through the window, but a
 *  GeometryMask stops it ever overflowing the frame's bottom/side arcs. */
const PORTRAIT_MASK_RADIUS = RING_SIZE * (247 / 512);
/** Text column starts right of the ring (portrait centre sits ON the card's
 *  left edge, half outside the frame). */
const TEXT_LEFT = 30 + RING_SIZE / 2 + 30;

/**
 * AAA merge-game speech bubble: cream rounded card with the ANIMATED Laurah
 * portrait in a gold ring overlapping the card's left edge — the character
 * lives outside the text frame. Laurah plays a talk bank sized to the line,
 * then rests on an idle pose; Cindra shows her static disc in the same ring.
 * Tap-gated steps show a pulsing chevron and the whole bubble is tappable.
 */
export class CharacterBubble extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private portrait: Phaser.GameObjects.Image;
  private portraitBack: Phaser.GameObjects.Graphics;
  private ring: Phaser.GameObjects.Image;
  private portraitTop: Phaser.GameObjects.Image;
  private portraitAnim: PortraitAnimator;
  /** Un-displayed circle graphics driving the body copy's GeometryMask; synced
   *  to the ring's WORLD position every tick (masks live in world space). */
  private portraitMaskG: Phaser.GameObjects.Graphics;
  private portraitMask: Phaser.Display.Masks.GeometryMask;
  private ringLocal = { x: 0, y: 0 };
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
    // Animated portrait bust + the gold ring framing it. Falls back to the old
    // static icon when the disc sheet failed to load (house rule: art load
    // failures degrade, never block).
    this.portraitBack = scene.add.graphics();
    this.portrait = scene.add.image(-BUBBLE_WIDTH / 2 + 30, 0, this.hasDiscSheet() ? LAURAH_DISC_TEXTURE : 'portrait_laurah', 0);
    this.ring = scene.add.image(-BUBBLE_WIDTH / 2 + 30, 0, 'portrait_ring');
    // Second synced copy of Laurah, cropped to her head — the layer that pops
    // ABOVE the exterior frame while the body copy stays tucked behind it.
    this.portraitTop = scene.add.image(-BUBBLE_WIDTH / 2 + 30, 0, this.hasDiscSheet() ? LAURAH_DISC_TEXTURE : 'portrait_laurah', 0);
    this.portraitAnim = new PortraitAnimator(scene, this.portrait, this.portraitTop);
    // Circular clip for the body copy: a world-space circle the size of the
    // ring's outer edge, kept OFF the display list and re-seated on the ring
    // every tick (containers can't parent mask sources).
    this.portraitMaskG = scene.make.graphics();
    this.portraitMaskG.fillStyle(0xffffff, 1);
    this.portraitMaskG.fillCircle(0, 0, PORTRAIT_MASK_RADIUS);
    this.portraitMask = this.portraitMaskG.createGeometryMask();
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.syncPortraitMask, this);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.events.off(Phaser.Scenes.Events.UPDATE, this.syncPortraitMask, this);
      this.portraitMaskG.destroy();
    });
    this.nameTagBg = scene.add.graphics();
    this.nameTag = scene.add
      .text(0, 0, 'Laurah', {
        fontFamily: 'Trebuchet MS, Verdana, sans-serif',
        fontSize: '30px',
        fontStyle: 'bold',
        color: PALETTE.cream
      })
      .setOrigin(0.5);
    this.chevron = scene.add
      .text(BUBBLE_WIDTH / 2 - 60, 0, '▼', {
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
    this.add([
      this.bg,
      this.label,
      this.hitZone,
      this.portraitBack,
      this.portrait,
      this.ring,
      this.portraitTop,
      this.nameTagBg,
      this.nameTag,
      this.chevron
    ]);
    scene.add.existing(this);
    this.setVisible(false);
  }

  /** Keep the mask circle glued to the ring through the bubble's slide/pop
   *  tweens. The bubble is a direct child of the scene and never rotates, so
   *  its own transform is all that applies. */
  private syncPortraitMask(): void {
    if (!this.visible) return;
    this.portraitMaskG.setPosition(this.x + this.ringLocal.x * this.scaleX, this.y + this.ringLocal.y * this.scaleY);
    this.portraitMaskG.setScale(this.scaleX, this.scaleY);
  }

  /** The baked Laurah disc spritesheet loaded and sliced into frames. */
  private hasDiscSheet(): boolean {
    return this.scene.textures.exists(LAURAH_DISC_TEXTURE) && this.scene.textures.get(LAURAH_DISC_TEXTURE).frameTotal > 2;
  }

  /** Seat the right art in the ring for the speaker, start/stop the talk
   *  animation, and configure the split layers each treatment needs:
   *  Laurah — two synced copies of her sheet: body copy cropped + tucked
   *  BEHIND the ring band, head copy cropped at the neck and drawn ABOVE the
   *  frame; both bottom-anchored so the breathing puppet grows upward.
   *  Static speaker (Cindra) — single disc INSIDE the ring like a medallion
   *  photo (ring in front, centred origin), matching the original look. */
  private setSpeakerArt(speaker: string, text: string): void {
    if (speaker === 'laurah' && this.hasDiscSheet()) {
      if (this.portrait.texture.key !== LAURAH_DISC_TEXTURE) this.portrait.setTexture(LAURAH_DISC_TEXTURE, 0);
      if (this.portraitTop.texture.key !== LAURAH_DISC_TEXTURE) this.portraitTop.setTexture(LAURAH_DISC_TEXTURE, 0);
      // Bottom-anchored so the breathing puppet grows upward from the frame.
      this.portrait.setOrigin(0.5, 1);
      this.portraitTop.setOrigin(0.5, 1);
      // Split layers: FULL body copy behind the ring, clipped to the frame's
      // circle by the mask; head copy above it, cropped at the neck.
      this.portrait.setCrop();
      this.portrait.setMask(this.portraitMask);
      this.portraitTop.setCrop(0, 0, LAURAH_CELL_W, HEAD_CROP_ROWS);
      this.portraitTop.setVisible(true);
      this.portraitBack.setVisible(true);
      this.portraitAnim.talk(text);
      return;
    }
    this.portraitAnim.rest();
    const staticKey = `portrait_${speaker}`;
    if (this.scene.textures.exists(staticKey)) this.portrait.setTexture(staticKey);
    this.portrait.setOrigin(0.5, 0.5);
    this.portrait.setCrop();
    this.portrait.clearMask();
    this.portraitTop.setVisible(false);
    this.portraitBack.setVisible(false);
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
        ring: this.ring,
        name: this.nameTag,
        chevron: this.chevron
      },
      {
        // layout() owns these transforms; it consumes partOffsetOf() so the
        // editor can move/scale the portrait, name tag, text and chevron.
        selfLaidOutParts: ['text', 'portrait', 'ring', 'name', 'chevron'],
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
      const sample = 'Long ago, Emberkeep blazed with dragon fire. Then the cold came... and the dragons slept.';
      this.label.setText(sample);
      this.setSpeakerArt('laurah', sample);
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
    this.setSpeakerArt(speaker, text);
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
    this.setSpeakerArt(step.speaker, step.text);
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
    const oRing = uiRegistry.partOffsetOf(ID, 'ring');
    const oName = uiRegistry.partOffsetOf(ID, 'name');
    const oChevron = uiRegistry.partOffsetOf(ID, 'chevron');

    // Text flows in the column right of the portrait ring.
    this.label.setWordWrapWidth(Math.min(textWidth, width - TEXT_LEFT - PAD - 8));
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

    this.label.setPosition(left + TEXT_LEFT + oText.dx, 0 + oText.dy);
    this.hitZone.setSize(width + RING_SIZE, Math.max(height, RING_SIZE) + 60);

    // Ring centre sits ON the card's left edge — the frame is half outside the
    // text card, rising above its top; its bottom edge stays seated on the
    // card bottom (never below — the bubble already hugs the screen's bottom).
    const ringX = left + 30 + oRing.dx;
    const ringY = Math.min(0, height / 2 - RING_SIZE / 2) + oRing.dy;
    const ringScale = (RING_SIZE / Math.max(1, this.ring.width)) * oRing.scale;
    this.ring.setScale(ringScale);
    this.ring.setPosition(ringX, ringY);
    this.ringLocal = { x: ringX, y: ringY };
    this.syncPortraitMask();
    // Moss backing fills the ring window behind Laurah (same treatment as the
    // original disc icon's interior) so the sliver below her trimmed edge and
    // the gaps beside her silhouette read as the portrait's interior, not the
    // board showing through.
    this.portraitBack.clear();
    this.portraitBack.fillStyle(0x3e745b, 1);
    this.portraitBack.fillCircle(ringX, ringY, RING_HOLE_RADIUS + 6);
    this.portraitBack.fillStyle(0x549270, 1);
    this.portraitBack.fillCircle(ringX + 2, ringY - 10, RING_HOLE_RADIUS - 10);

    if (this.portrait.texture.key === LAURAH_DISC_TEXTURE) {
      // Both split copies share one transform: centred in the ring (with a
      // slight upward bias) like the original medallion placement, bottom-
      // anchored so breathing grows upward. Scale goes through the animator
      // so the breathing puppet oscillates on top of this base without
      // fighting the layout.
      const s = (LAURAH_DISPLAY_HEIGHT / LAURAH_CELL_H) * oPortrait.scale;
      const px = ringX + oPortrait.dx;
      const py = ringY + PORTRAIT_CENTER_DY + LAURAH_DISPLAY_HEIGHT / 2 + oPortrait.dy;
      this.portrait.setPosition(px, py);
      this.portraitTop.setPosition(px, py);
      this.portraitAnim.applyBaseScale(s, s);
    } else {
      // Static speaker disc (Cindra): centred, fully CONTAINED inside the hole
      // like a medallion photo — the original look.
      const s = (STATIC_DISC_SIZE / Math.max(1, this.portrait.width)) * oPortrait.scale;
      this.portrait.setPosition(ringX + oPortrait.dx, ringY + oPortrait.dy);
      this.portraitAnim.applyBaseScale(s, s);
    }

    // Name chip straddles the card's top edge at the head of the text column.
    this.nameTag.setScale(oName.scale);
    const tagWidth = this.nameTag.displayWidth + 36;
    const tagHeight = 44 * oName.scale;
    const tagX = left + TEXT_LEFT + tagWidth / 2 - 18 + oName.dx;
    const tagY = top + oName.dy;
    this.nameTag.setPosition(tagX, tagY);
    this.nameTagBg.clear();
    this.nameTagBg.fillStyle(num(tagColor), 0.95);
    this.nameTagBg.fillRoundedRect(tagX - tagWidth / 2, tagY - tagHeight / 2, tagWidth, tagHeight, tagHeight / 2);
    this.nameTagBg.lineStyle(4, num(PALETTE.cream), 0.9);
    this.nameTagBg.strokeRoundedRect(tagX - tagWidth / 2, tagY - tagHeight / 2, tagWidth, tagHeight, tagHeight / 2);

    this.chevron.setPosition(width / 2 - 60 + oChevron.dx, height / 2 - 40 + oChevron.dy);
    this.chevron.setScale(oChevron.scale);
    this.chevron.setVisible(this.tapGated);
  }

  hide(): void {
    if (!this.visible) return;
    this.portraitAnim.rest();
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
