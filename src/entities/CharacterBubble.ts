import Phaser from 'phaser';
import { FONT } from '../art/design';
import { CHARACTER_ANIMS, type CharacterClip, clipFor, clipKey, type PortraitView } from '../core/characterAnims';
import { num, PALETTE, PORTRAIT_CLIP_TALK, STORY_BEAT_HOLD_MS, TIMINGS } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { SpeakerId, TutorialStepEvent } from '../core/types';
import {
  ANIMATED_SPEAKER,
  discTextureFor,
  ELEANOR_DISC_TEXTURE,
  type Expression,
  isAnimatedSpeaker,
  PortraitAnimator
} from './PortraitAnimator';
import { uiRegistry } from '../ui/theme';

/** Display name + name-tag colour per speaker. Adding a speaker is an entry
 *  here plus a `portrait_<id>` texture (and, if she should animate, a disc
 *  atlas from `scripts/bake-portrait-disc.py`). */
const SPEAKERS: Record<SpeakerId, { name: string; tag: string }> = {
  eleanor: { name: 'Eleanor', tag: PALETTE.goldShade },
  selyna: { name: 'Selyna', tag: PALETTE.tealDeep },
  golden_elder: { name: 'The Golden Elder', tag: PALETTE.lavaShade }
};
/** Exported so every surface that prints a person's name prints the SAME name.
 *  A second table would drift the first time somebody is renamed. */
export const speakerName = (id: string): string => SPEAKERS[id as SpeakerId]?.name ?? id;

const BUBBLE_WIDTH = 1200;
const TEXT_WIDTH = 940;
const MIN_HEIGHT = 192;
const PAD = 40;
/** Portrait ring display diameter. */
const RING_SIZE = 300;
/** Ring art geometry (assets/sprites/ui/portrait-ring.png): hole is 400/512 of
 *  the 512 canvas — the transparent window the guide's bust rises through. */
const RING_HOLE_RADIUS = RING_SIZE * (200 / 512);
/** A static speaker's disc (the Golden Elder, Selyna) fits INSIDE the hole like
 *  a medallion photo — the fully-contained treatment. */
const STATIC_DISC_SIZE = RING_SIZE * 0.98;
/** Align-Studio PORTRAIT clips (character-anims.json, stage 'portrait') get
 *  the SAME split treatment the guide's disc has — body copy masked BEHIND the
 *  ring band, head copy (cropped at the neck) drawn ABOVE it — with per-
 *  character framing from the entry's `portrait` view (frame display height,
 *  top offset from ring centre, neck-line fraction). */
/** The guide's bust cutout (scripts/bake-portrait-disc.py, 270x360 cells, top
 *  95% of her frame). She renders as TWO synced copies of the same sheet,
 *  split-layered around the ring:
 *    - BODY copy (rows 0..BODY_CROP_ROWS) drawn BEHIND the ring — the band
 *      covers her shoulders/bottom, tucking them UNDER the exterior frame;
 *    - HEAD copy (rows 0..HEAD_CROP_ROWS) drawn ABOVE the ring — only her
 *      head/hair exceeds the frame, z-index wise.
 *  The split line sits at her NECK, where her silhouette is far inside the
 *  ring's window — both copies are pixel-identical there, so the handoff is
 *  invisible. A moss backing disc behind her fills the window. */
const GUIDE_DISPLAY_HEIGHT = 320;
const GUIDE_CELL_W = 300;
const GUIDE_CELL_H = 400;
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
/** Disc crossfade when the speaker changes (docs/conversation-staging.md §6). */
const SPEAKER_CROSSFADE_MS = 140;

/**
 * AAA merge-game speech bubble: cream rounded card with the ANIMATED guide
 * portrait in a gold ring overlapping the card's left edge — the character
 * lives outside the text frame. Eleanor plays her talk bank, then rests on her
 * idle pose; a static speaker shows a still disc in the same ring.
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
  /** Who is currently standing in the ring — drives the crossfade on handoff. */
  private artSpeaker = '';
  /** A post-tutorial chapter run: tap-advanced lines from one speaker. Empty
   *  when no run is playing, which is also how the tap handler tells the two
   *  modes apart. */
  private seqLines: string[] = [];
  private seqIdx = 0;
  private seqSpeaker: SpeakerId = 'eleanor';
  private seqDone: (() => void) | undefined;
  private seqOnLine?: (idx: number) => void;
  /** Coloured runs drawn over the body copy (the dragon's name). */
  private highlightFx!: Phaser.GameObjects.Container;
  /** Unwrapped, invisible twin of `label`, used only to measure run widths. */
  private measurer!: Phaser.GameObjects.Text;
  /** Token → value for `{token}` substitution in any line the bubble speaks.
   *  Seeded by UIScene, which is the part of the app that can see GameState. */
  private tokens: Record<string, string> = {};
  /** The line as authored, tokens unresolved — kept so a token arriving mid-line
   *  can re-render the same sentence rather than freezing the placeholder. */
  private rawLine = '';
  /** Align-Studio PORTRAIT clips (stage 'portrait' in character-anims.json):
   *  when a speaker has them, they are the DEFINITIVE ring animation — the
   *  disc-atlas talk banks step aside entirely. '' = inactive. */
  private atlasSpeaker = '';
  private atlasClips: { talking: CharacterClip; blinking: CharacterClip } | null = null;
  private atlasMode: 'talking' | 'blinking' = 'blinking';
  private atlasFrame = 0;
  private atlasTick: Phaser.Time.TimerEvent | null = null;
  private atlasTalkHold: Phaser.Time.TimerEvent | null = null;

  constructor(scene: Phaser.Scene, private bus: EventBus) {
    super(scene, 0, 0);
    this.bg = scene.add.graphics();
    this.label = scene.add
      .text(0, 0, '', {
        fontFamily: FONT.ui,
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
    this.portrait = scene.add.image(-BUBBLE_WIDTH / 2 + 30, 0, this.hasDiscSheet() ? ELEANOR_DISC_TEXTURE : 'portrait_eleanor', 0);
    this.ring = scene.add.image(-BUBBLE_WIDTH / 2 + 30, 0, 'portrait_ring');
    // Second synced copy of the guide, cropped to her head — the layer that pops
    // ABOVE the exterior frame while the body copy stays tucked behind it.
    this.portraitTop = scene.add.image(-BUBBLE_WIDTH / 2 + 30, 0, this.hasDiscSheet() ? ELEANOR_DISC_TEXTURE : 'portrait_eleanor', 0);
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
      .text(0, 0, SPEAKERS.eleanor.name, {
        fontFamily: FONT.ui,
        fontSize: '30px',
        fontStyle: 'bold',
        color: PALETTE.cream
      })
      .setOrigin(0.5);
    // Explicit continue cue — a lone chevron read as decoration; the words
    // make the tap gate unmissable (pill behind it is drawn by layout()).
    this.chevron = scene.add
      .text(BUBBLE_WIDTH / 2 - 60, 0, 'Tap to continue  ▼', {
        fontFamily: FONT.ui,
        fontSize: '26px',
        fontStyle: 'bold',
        color: PALETTE.goldShade
      })
      .setOrigin(1, 0.5);
    this.hitZone = scene.add.zone(0, 0, BUBBLE_WIDTH, MIN_HEIGHT);
    this.hitZone.setInteractive({ useHandCursor: true });
    this.hitZone.on('pointerup', () => {
      if (!this.visible) return;
      // A story run owns the tap while it is playing; only the tutorial's own
      // steps may ask the director to advance.
      if (this.seqLines.length) {
        this.advanceSequence();
      } else if (this.tapGated) {
        this.bus.emit('tutorial:advance_requested', { stepId: this.currentStepId });
      }
    });
    // Sits immediately over the body copy — see `paintHighlight`.
    this.highlightFx = scene.add.container(0, 0);
    this.measurer = scene.add
      .text(0, 0, '', { fontFamily: FONT.ui, fontSize: '38px', fontStyle: 'bold' })
      .setVisible(false);
    this.add([
      this.bg,
      this.label,
      this.highlightFx,
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

  /**
   * Give the bubble a value for a `{token}` any line may contain.
   *
   * Set by UIScene, which is the layer that can see GameState — the bubble is a
   * view and must not reach into the board to find out what a dragon is called.
   * Setting a token re-renders the line on screen, so a name arriving while the
   * bubble is already open updates in place.
   */
  setToken(token: string, value: string): void {
    if (this.tokens[token] === value) return;
    this.tokens[token] = value;
    if (this.visible) this.setLine(this.rawLine);
  }

  /**
   * Speak one line — the single choke point every caller goes through.
   *
   * Two jobs: substitute `{token}`s, and remember the raw form so a token that
   * arrives later can re-render the same sentence.
   */
  private setLine(text: string): void {
    this.rawLine = text;
    this.label.setText(this.resolveTokens(text));
    this.paintHighlight();
  }

  private resolveTokens(text: string): string {
    return text.replace(/\{(\w+)\}/g, (whole, key: string) => this.tokens[key] ?? whole);
  }

  /**
   * Paint the dragon's name in lava over the body copy.
   *
   * Phaser's `Text` has no rich-text: one object is one colour. Rather than
   * replace the label with a run-laid-out container — which would cost the UI
   * editor its font controls on the most-edited text in the game — the coloured
   * word is drawn ON TOP of the word the label already rendered, over an opaque
   * patch of the card's own paper. That works because the text column sits on a
   * flat `0xfffdf6` fill, so the patch is invisible, and because the overlay
   * reuses the label's exact wrap: `getWrappedText` gives the same lines the
   * label drew, and an unwrapped twin measures the prefix on each one.
   *
   * Only the dragon's name is ever highlighted. It is a name the player chose,
   * and it should read like one.
   */
  private paintHighlight(): void {
    this.highlightFx.removeAll(true);
    const word = this.tokens.dragon;
    if (!word || !this.label.text.includes(word)) return;

    const scale = this.label.scaleX;
    const lines = this.label.getWrappedText(this.label.text);
    if (lines.length === 0 || this.label.height <= 0) return;

    // Per-row advance is derived, never averaged: `height / lines.length` folds
    // the inter-line spacing into every row including the last, which drifts a
    // few pixels further down the block with each line and eventually clips the
    // patch off the word it is covering.
    this.measurer.setStyle({ fontSize: this.label.style.fontSize });
    this.measurer.setText('Xg');
    const lineBox = this.measurer.height;
    const advance = lineBox + this.label.lineSpacing;
    // The label is origin (0, 0.5), so its first line's top is half its height up.
    const topY = this.label.y - (this.label.height * scale) / 2;

    lines.forEach((line, row) => {
      for (let from = 0; ; ) {
        const at = line.indexOf(word, from);
        if (at < 0) break;
        from = at + word.length;
        const x = this.label.x + this.widthOf(line.slice(0, at)) * scale;
        const y = topY + (row * advance + lineBox / 2) * scale;
        const w = this.widthOf(word) * scale;
        const h = lineBox * scale;

        const patch = this.scene.add.graphics();
        patch.fillStyle(0xfffdf6, 1);
        patch.fillRect(x, y - h / 2, w, h);
        const run = this.scene.add
          .text(x, y, word, {
            fontFamily: FONT.ui,
            fontSize: this.label.style.fontSize,
            fontStyle: 'bold',
            color: PALETTE.lava
          })
          .setOrigin(0, 0.5)
          .setScale(scale);
        this.highlightFx.add([patch, run]);
      }
    });
  }

  /** Width of a run in the label's own font, unwrapped. */
  private widthOf(run: string): number {
    if (!run) return 0;
    this.measurer.setText(run);
    return this.measurer.width;
  }

  /** Keep the mask circle glued to the ring through the bubble's slide/pop
   *  tweens. The bubble is a direct child of the scene and never rotates, so
   *  its own transform is all that applies. */
  private syncPortraitMask(): void {
    if (!this.visible) return;
    this.portraitMaskG.setPosition(this.x + this.ringLocal.x * this.scaleX, this.y + this.ringLocal.y * this.scaleY);
    this.portraitMaskG.setScale(this.scaleX, this.scaleY);
  }

  /** A speaker's baked disc spritesheet is loaded and sliced into frames. */
  private hasDiscSheet(speaker: string = ANIMATED_SPEAKER): boolean {
    const key = discTextureFor(speaker);
    return this.scene.textures.exists(key) && this.scene.textures.get(key).frameTotal > 2;
  }

  /** Seat the right art in the ring for the speaker, start/stop the talk
   *  animation, and configure the split layers each treatment needs:
   *  The guide — two synced copies of her sheet: body copy cropped + tucked
   *  BEHIND the ring band, head copy cropped at the neck and drawn ABOVE the
   *  frame; both bottom-anchored so the breathing puppet grows upward.
   *  Static speaker — single disc INSIDE the ring like a medallion
   *  photo (ring in front, centred origin), matching the original look. */
  private setSpeakerArt(speaker: string, text: string): void {
    // The ring is a stage with room for one. When the person standing in it
    // changes, the disc crossfades rather than cutting — a hard swap under a
    // stationary frame reads as a rendering bug.
    if (speaker !== this.artSpeaker) {
      this.artSpeaker = speaker;
      for (const img of [this.portrait, this.portraitTop]) {
        img.setAlpha(0);
        this.scene.tweens.add({ targets: img, alpha: 1, duration: SPEAKER_CROSSFADE_MS, ease: 'Sine.easeOut' });
      }
    }
    // Shown by default; only the static branch below can withhold it, and only
    // when the speaker has no face of their own to wear.
    this.portrait.setVisible(true);
    if (this.trySetAtlasPortrait(speaker, text)) return;
    this.stopAtlasPortrait();
    if (isAnimatedSpeaker(speaker) && this.hasDiscSheet(speaker)) {
      const disc = discTextureFor(speaker);
      if (this.portrait.texture.key !== disc) this.portrait.setTexture(disc, 0);
      if (this.portraitTop.texture.key !== disc) this.portraitTop.setTexture(disc, 0);
      // Bottom-anchored so the breathing puppet grows upward from the frame.
      this.portrait.setOrigin(0.5, 1);
      this.portraitTop.setOrigin(0.5, 1);
      // Split layers: FULL body copy behind the ring, clipped to the frame's
      // circle by the mask; head copy above it, cropped at the neck.
      this.portrait.setCrop();
      this.portrait.setMask(this.portraitMask);
      this.portraitTop.setCrop(0, 0, GUIDE_CELL_W, HEAD_CROP_ROWS);
      this.portraitTop.setVisible(true);
      this.portraitBack.setVisible(true);
      this.portraitAnim.talk(text);
      return;
    }
    this.portraitAnim.rest();
    /**
     * NOBODY WEARS SOMEBODY ELSE'S FACE.
     *
     * This used to set the texture only `if (exists)` and otherwise leave the
     * portrait on whatever it was last showing — which for a speaker with no
     * registered `portrait_<id>` meant the previous person's. The Golden Elder
     * had exactly that gap, so her line at the golden delivery opened under her
     * name wearing ELEANOR's disc frame; and because the layout pass keys off
     * the TEXTURE (`endsWith('_disc')`) while this one had already centre-
     * origined and unmasked it, the two disagreed about how to frame it and her
     * head hung outside the ring. Her art existed the whole time
     * (`sprites/golden-elder/portrait.webp`) — nothing loaded it.
     *
     * So: her own face when it is registered, and NO face rather than the wrong
     * one when it is not. A missing portrait is now a visibly absent portrait,
     * which is debuggable; a borrowed one reads as a rendering bug in the ring.
     */
    const staticKey = `portrait_${speaker}`;
    const has = this.scene.textures.exists(staticKey);
    if (has) this.portrait.setTexture(staticKey);
    this.portrait.setVisible(has);
    this.portrait.setOrigin(0.5, 0.5);
    this.portrait.setCrop();
    // Masked like every other treatment. `STATIC_DISC_SIZE` is wider than the
    // ring's hole, so "fully contained like a medallion photo" was true only of
    // art that happened to be circular with margin — the frame never enforced
    // it. Now it does, and the arcs of the ring are the edge of the portrait
    // whatever art is handed to it.
    this.portrait.setMask(this.portraitMask);
    this.portraitTop.setVisible(false);
    // A medallion fills the hole itself, so it keeps the split treatment's
    // backing disc off — that exists to fill the gaps around a cut-out bust.
    this.portraitBack.setVisible(false);
  }

  /**
   * The Align-Studio BUST clips, when the speaker has them: TALKING while the
   * line reads (length-scaled hold), then the BLINKING rest loop. These are the
   * definitive ring animation — the disc-atlas talk banks never run under them
   * (same speech, one mouth). Frames are stepped on the Image directly, the
   * same manual-driver approach the disc animator uses.
   */
  private atlasView(speaker: string): PortraitView | null {
    return CHARACTER_ANIMS.characters[speaker]?.portrait ?? null;
  }

  private trySetAtlasPortrait(speaker: string, text: string): boolean {
    const talking = clipFor(speaker, 'talking');
    const blinking = clipFor(speaker, 'blinking');
    if (talking?.stage !== 'portrait' || blinking?.stage !== 'portrait') return false;
    if (!this.scene.textures.exists(clipKey(speaker, 'talking')) || !this.scene.textures.exists(clipKey(speaker, 'blinking'))) {
      return false;
    }
    const view = this.atlasView(speaker);
    if (!view) return false;
    this.portraitAnim.rest(); // the disc animator steps aside entirely
    this.atlasSpeaker = speaker;
    this.atlasClips = { talking, blinking };
    // THE SPLIT, same as the guide's disc: the FULL frame drawn behind the
    // ring band, clipped to the frame's circle by the mask; a second synced
    // copy cropped at the NECK drawn above the band, so only her head ever
    // overlaps the exterior frame. Both top-anchored so the per-character
    // view's dy places the crown, whatever each clip's frame height is.
    this.portrait.setOrigin(0.5, 0);
    this.portrait.setCrop();
    this.portrait.setMask(this.portraitMask);
    this.portraitTop.setOrigin(0.5, 0);
    this.portraitTop.setVisible(true);
    this.portraitBack.setVisible(true);
    this.startAtlasMode('talking');
    this.atlasTalkHold?.remove();
    const holdMs = Phaser.Math.Clamp(
      text.length * PORTRAIT_CLIP_TALK.msPerChar,
      PORTRAIT_CLIP_TALK.minMs,
      PORTRAIT_CLIP_TALK.maxMs
    );
    this.atlasTalkHold = this.scene.time.delayedCall(holdMs, () => this.startAtlasMode('blinking'));
    return true;
  }

  private startAtlasMode(mode: 'talking' | 'blinking'): void {
    if (!this.atlasClips || !this.atlasSpeaker) return;
    this.atlasMode = mode;
    this.atlasFrame = 0;
    const clip = this.atlasClips[mode];
    const key = clipKey(this.atlasSpeaker, mode);
    const view = this.atlasView(this.atlasSpeaker);
    this.portrait.setTexture(key, 0);
    this.portraitTop.setTexture(key, 0);
    // Neck-line crop, in this clip's texture rows (talking and blinking may
    // differ in frame size, so the crop follows the mounted clip).
    if (view) this.portraitTop.setCrop(0, 0, clip.frameWidth, Math.round(clip.frameHeight * view.headCrop));
    this.atlasTick?.remove();
    this.atlasTick = this.scene.time.addEvent({
      delay: 1000 / clip.fps,
      loop: true,
      callback: () => {
        if (!this.atlasClips) return;
        const c = this.atlasClips[this.atlasMode];
        this.atlasFrame = (this.atlasFrame + 1) % c.frames;
        this.portrait.setFrame(this.atlasFrame);
        this.portraitTop.setFrame(this.atlasFrame);
      }
    });
  }

  private stopAtlasPortrait(): void {
    this.atlasTick?.remove();
    this.atlasTick = null;
    this.atlasTalkHold?.remove();
    this.atlasTalkHold = null;
    this.atlasSpeaker = '';
    this.atlasClips = null;
  }

  /** UI Builder registration — call AFTER the scene has positioned the bubble
   *  so the theme offset applies on top of the authored spot. */
  registerUi(): void {
    uiRegistry.register(
      this.scene,
      'dialogue.bubble',
      'Dialogue bubble',
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
      this.nameTag.setText(SPEAKERS.eleanor.name);
      const sample = 'Long ago, Emberkeep blazed with dragon fire. Then the cold came... and the dragons slept.';
      this.setLine(sample);
      this.setSpeakerArt(ANIMATED_SPEAKER, sample);
      this.layout(ANIMATED_SPEAKER);
    } else if (this.samplePeek) {
      this.samplePeek = false;
      this.setLine('');
      this.setVisible(false);
    }
  }

  /** Re-run layout with current content (theme params/offsets changed). */
  relayout(): void {
    if (!this.visible && !this.samplePeek) return;
    if (this.lastStep) {
      const step = this.lastStep;
      this.nameTag.setText(speakerName(step.speaker));
      this.setLine(step.text);
      this.layout(step.speaker);
    } else if (this.samplePeek) {
      this.layout(ANIMATED_SPEAKER);
    }
  }

  /**
   * A one-off spoken line OUTSIDE the tutorial (the Golden Elder's finale beat,
   * Eleanor's post-tutorial nudges). Not tap-gated; auto-hides after `holdMs`.
   * Never used
   * while a tutorial step is up — the tutorial owns the bubble until it's done.
   */
  say(speaker: SpeakerId, text: string, holdMs = 4200): void {
    this.cancelSequence();
    this.sayTimer?.remove();
    this.currentStepId = '';
    this.tapGated = false;
    this.lastStep = null;
    this.samplePeek = false;
    this.setChevron(false);
    this.nameTag.setText(speakerName(speaker));
    this.setLine(text);
    this.setSpeakerArt(speaker, text);
    this.layout(speaker);
    this.popIn();
    this.sayTimer = this.scene.time.delayedCall(holdMs, () => this.hide());
  }

  /**
   * A post-tutorial chapter run — several lines from one speaker, each waiting
   * for a tap, exactly like a tutorial step. Chapter beats are the story's peaks
   * and must not scroll past unread, so they are tap-advanced rather than timed;
   * `STORY_BEAT_HOLD_MS` is only a safety net so a bubble can never strand the
   * board if the player walks away.
   */
  sequence(
    speaker: SpeakerId,
    lines: string[],
    onDone?: () => void,
    onLine?: (idx: number) => void
  ): void {
    if (!lines.length) {
      onDone?.();
      return;
    }
    this.seqLines = [...lines];
    this.seqIdx = 0;
    this.seqSpeaker = speaker;
    this.seqDone = onDone;
    // Per-line hook — the hub tours move their pointer as she talks (section
    // by section, then the close button), so the arrow is part of the line.
    this.seqOnLine = onLine;
    this.playSequenceLine();
  }

  private playSequenceLine(): void {
    const text = this.seqLines[this.seqIdx];
    if (text === undefined) {
      this.endSequence();
      return;
    }
    this.seqOnLine?.(this.seqIdx);
    this.sayTimer?.remove();
    this.currentStepId = '';
    this.lastStep = null;
    this.samplePeek = false;
    this.tapGated = true;
    this.nameTag.setText(speakerName(this.seqSpeaker));
    this.setLine(text);
    this.setSpeakerArt(this.seqSpeaker, text);
    this.layout(this.seqSpeaker);
    this.setChevron(true);
    this.popIn();
    this.sayTimer = this.scene.time.delayedCall(STORY_BEAT_HOLD_MS, () => this.advanceSequence());
  }

  private advanceSequence(): void {
    this.seqIdx++;
    this.playSequenceLine();
  }

  private endSequence(): void {
    this.seqLines = [];
    this.seqIdx = 0;
    const done = this.seqDone;
    this.seqDone = undefined;
    this.seqOnLine = undefined;
    this.hide();
    done?.();
  }

  /** Cancel any run in flight — the tutorial and one-off lines both own the
   *  bubble outright when they take it. */
  private cancelSequence(): void {
    this.seqLines = [];
    this.seqIdx = 0;
    this.seqDone = undefined;
    this.seqOnLine = undefined;
  }

  /** Hold a still face on the current speaker. Set it before the line reveals —
   *  the expression is a reaction to the moment, not to the words. */
  setExpression(face: Expression): void {
    this.portraitAnim.expression(face);
  }

  show(step: TutorialStepEvent): void {
    this.cancelSequence();
    this.sayTimer?.remove();
    this.sayTimer = null;
    this.currentStepId = step.id;
    this.tapGated = step.gateType === 'tap';
    this.lastStep = step;
    this.samplePeek = false;
    this.nameTag.setText(speakerName(step.speaker));
    this.setLine(step.text);
    this.setSpeakerArt(step.speaker, step.text);
    this.layout(step.speaker);
    this.setChevron(this.tapGated);
    this.popIn();
  }

  /** A small "over here" swell — the tutorial's answer to input it refused. Does
   *  not re-show a hidden bubble and does not restart the sequence. */
  bump(): void {
    if (!this.visible) return;
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({
      targets: this,
      scale: { from: this.scale * 1.05, to: this.scale },
      duration: 200,
      ease: 'Back.easeOut'
    });
  }

  /** The pulsing "tap me" chevron — on for anything the player must dismiss. */
  private setChevron(on: boolean): void {
    this.chevronTween?.remove();
    this.chevronTween = null;
    if (!on) {
      this.chevron.setAlpha(0);
      return;
    }
    this.chevron.setAlpha(1);
    this.chevronTween = this.scene.tweens.add({
      targets: this.chevron,
      alpha: 0.45,
      y: this.chevron.y + 6,
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
  }

  /** Rise-and-settle when the bubble arrives; a small re-pop between lines. */
  private popIn(): void {
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
  }

  /** Geometry pass: draws the card and seats every part. Theme-aware — the
   *  UI Builder's bubble width/text width knobs and per-part offsets/scales
   *  (partOffsetOf) are consumed HERE, so they survive every re-layout. */
  private layout(speaker: string): void {
    const ID = 'dialogue.bubble';
    const width = uiRegistry.paramOf(ID, 'width', BUBBLE_WIDTH);
    const textWidth = uiRegistry.paramOf(ID, 'textWidth', TEXT_WIDTH);
    const minHeight = uiRegistry.paramOf(ID, 'minHeight', MIN_HEIGHT);
    const tagColor = SPEAKERS[speaker as SpeakerId]?.tag ?? PALETTE.goldShade;
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
    // The overlay is a function of the label's final wrap, scale and position,
    // so it is repainted here rather than at setText time — layout() runs after
    // every line change AND on every theme edit.
    this.paintHighlight();
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
    // Moss backing fills the ring window behind the guide (same treatment as the
    // original disc icon's interior) so the sliver below her trimmed edge and
    // the gaps beside her silhouette read as the portrait's interior, not the
    // board showing through.
    this.portraitBack.clear();
    this.portraitBack.fillStyle(0x3e745b, 1);
    this.portraitBack.fillCircle(ringX, ringY, RING_HOLE_RADIUS + 6);
    this.portraitBack.fillStyle(0x549270, 1);
    this.portraitBack.fillCircle(ringX + 2, ringY - 10, RING_HOLE_RADIUS - 10);

    // ANY mounted disc sheet gets the split treatment — matching setSpeakerArt,
    // which keys on isAnimatedSpeaker. This used to compare against Eleanor's
    // texture specifically, so Selyna (whose disc loads and animates) fell into
    // the static-medallion branch below: positioned as if centre-origined while
    // setSpeakerArt had bottom-anchored her, her whole bust floated ABOVE the
    // ring with nothing tucked behind the frame.
    if (this.portrait.texture.key.endsWith('_disc')) {
      // Both split copies share one transform: centred in the ring (with a
      // slight upward bias) like the original medallion placement, bottom-
      // anchored so breathing grows upward. Scale goes through the animator
      // so the breathing puppet oscillates on top of this base without
      // fighting the layout.
      const s = (GUIDE_DISPLAY_HEIGHT / GUIDE_CELL_H) * oPortrait.scale;
      const px = ringX + oPortrait.dx;
      const py = ringY + PORTRAIT_CENTER_DY + GUIDE_DISPLAY_HEIGHT / 2 + oPortrait.dy;
      this.portrait.setPosition(px, py);
      this.portraitTop.setPosition(px, py);
      this.portraitAnim.applyBaseScale(s, s);
    } else if (this.portrait.texture.key.startsWith('canim_') && this.atlasSpeaker) {
      // Align-Studio portrait clip, split-layered like the guide's disc: both
      // synced copies top-anchored at the view's crown offset, scaled so the
      // whole frame reads at the view's display height. Body behind the band
      // (masked), head copy above it (cropped at the neck by setSpeakerArt).
      const view = this.atlasView(this.atlasSpeaker);
      const frameH = Math.max(1, this.portrait.height);
      const s = ((view?.height ?? 400) / frameH) * oPortrait.scale;
      const px = ringX + oPortrait.dx;
      const py = ringY + (view?.dy ?? -160) + oPortrait.dy;
      this.portrait.setPosition(px, py);
      this.portraitTop.setPosition(px, py);
      this.portraitAnim.applyBaseScale(s, s);
    } else {
      // Static speaker disc: centred, fully CONTAINED inside the hole
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

    this.chevron.setPosition(width / 2 - 36 + oChevron.dx, height / 2 - 34 + oChevron.dy);
    this.chevron.setScale(oChevron.scale);
    this.chevron.setVisible(this.tapGated);
    if (this.tapGated) {
      // Soft gold pill behind the cue so it reads as a button-like affordance.
      const cw = this.chevron.displayWidth + 40;
      const chh = 46 * oChevron.scale;
      const cxr = width / 2 - 36 + oChevron.dx + 14;
      const cyy = height / 2 - 34 + oChevron.dy;
      this.bg.fillStyle(num(PALETTE.gold), 0.16);
      this.bg.fillRoundedRect(cxr - cw, cyy - chh / 2, cw, chh, chh / 2);
      this.bg.lineStyle(2, num(PALETTE.gold), 0.45);
      this.bg.strokeRoundedRect(cxr - cw, cyy - chh / 2, cw, chh, chh / 2);
    }
  }

  hide(): void {
    if (!this.visible) return;
    this.portraitAnim.rest();
    this.stopAtlasPortrait();
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
