import Phaser from 'phaser';
import { FONT } from '../art/design';
import { DEPTHS, DRAG, HIT_FORGIVENESS_PX, SLEEP_BREATH, TIMINGS, num, PALETTE } from '../core/Constants';
import { gridToWorld } from '../core/iso';
import type { AnchorsData, ItemSnapshot, SpinSheet } from '../core/types';

const COOLING_TINT = 0x9d97a2;

/**
 * Pooled visual for one board item. The container carries position/depth and
 * receives tweens; the inner sprite carries the idle bob so the two never
 * fight. Generators show a cooling tint plus a tiny ready-sparkle pulse.
 */
export class BoardItem extends Phaser.GameObjects.Container {
  itemId = 0;
  chain = '';
  tier = 0;
  kind: 'item' | 'decor' = 'item';
  col = 0;
  row = 0;
  isGenerator = false;

  private sprite: Phaser.GameObjects.Image;
  private readyStar: Phaser.GameObjects.Image;
  private groundShadow: Phaser.GameObjects.Image; // persistent soft shadow, sized to the art
  private cooldownLabel: Phaser.GameObjects.Text;
  private timePill: Phaser.GameObjects.Image;
  private timeIcon: Phaser.GameObjects.Arc;
  private bobPaused = false;
  /** Slow ribcage breath while this item is a SLEEPING dragon. Driven from
   *  `applyBob` (the existing per-frame art hook) off ABSOLUTE time, so the
   *  power governor's dropped frames slow it down without ever desyncing it —
   *  the same treatment the standee breath gets. A tween would fight the
   *  landing squash and the drag lift for the same two properties. */
  private sleepBreath = false;
  private breathPhase = 0;
  private sleepGroundY = 0;
  /** The baked spin sheet this item's art is playing, if any (the crystal on
   *  devices that decline the live three.js gem). */
  private spin: SpinSheet | null = null;
  /** The art's own scale, so the breath can modulate it without drifting. */
  private artBaseX = 1;
  private artBaseY = 1;
  /** Is the piece over ground it could be put down on? The ground shadow
   *  answers to this while dragging — see `setOverGround`. */
  private overGround = true;
  /** Whether the ground shadow was showing when the lift began, so coming back
   *  over the isle restores it WITHOUT lighting one under a rig host or a
   *  sleeping dragon that had deliberately hidden its own. */
  private groundShadowBeforeLift = true;
  private cooling = false;
  /** Art hidden behind a live rig — cooldown/ready visuals are suppressed
   *  (they'd render UNDER the rig); BoardScene floats a badge instead. */
  private artHidden = false;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    // Persistent soft (radial-gradient) ground shadow, sized to the art in
    // acquire() so EVERY object casts one. Sits first (under the art); the idle
    // bob lifts the sprite off it, and a drag SWELLS it (liftForDrag) — it is
    // the ONLY shadow an item has. Falls back to a flat tint if the texture
    // (built by BoardScene.ensureShadowTexture) isn't ready.
    this.groundShadow = scene.add
      .image(0, 8, scene.textures.exists('fx_shadow') ? 'fx_shadow' : '__WHITE')
      .setVisible(false);
    if (!scene.textures.exists('fx_shadow')) this.groundShadow.setTint(num(PALETTE.night)).setAlpha(0.24);
    this.sprite = scene.add.image(0, 0, '__DEFAULT');
    this.readyStar = scene.add.image(40, -104, 'fx_spark').setScale(0.7).setVisible(false);
    // Countdown shown over a waiting generator: warm plum pill (Emberkeep
    // palette) + gold dot icon + cream mm:ss text.
    this.timePill = scene.add
      .image(0, -122, scene.textures.exists('fx_timepill') ? 'fx_timepill' : '__WHITE')
      .setVisible(false);
    if (!scene.textures.exists('fx_timepill')) this.timePill.setTint(num(PALETTE.plum));
    this.timeIcon = scene.add
      .circle(-58, -122, 18, num(PALETTE.gold))
      .setStrokeStyle(4, num(PALETTE.plumShade))
      .setVisible(false);
    this.cooldownLabel = scene.add
      .text(8, -122, '', {
        fontFamily: FONT.ui,
        fontSize: '34px',
        fontStyle: 'bold',
        color: PALETTE.cream,
        stroke: PALETTE.night,
        strokeThickness: 4
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.add([
      this.groundShadow,
      this.sprite,
      this.readyStar,
      this.timePill,
      this.timeIcon,
      this.cooldownLabel
    ]);
    this.setSize(152, 152);
    scene.add.existing(this);
    this.setVisible(false);
    this.setActive(false);
  }

  /**
   * Swap the art texture in place, keeping position, scale and hit area.
   *
   * Used for Manor skins: same item, same tier, different drawing. The anchor
   * is re-read because a replacement plate may be framed differently, and the
   * ground shadow is re-fitted to the new art's footprint — a skin with a
   * taller silhouette would otherwise keep the old one's shadow.
   */
  setArtTexture(textureKey: string, anchors?: AnchorsData): void {
    this.sprite.setTexture(textureKey);
    if (anchors) {
      const [ax, ay] = anchors.byKey[textureKey] ?? anchors.default;
      this.sprite.setOrigin(ax, ay);
    }
    const w = Math.max(64, this.sprite.displayWidth * 0.92);
    this.groundShadow.setDisplaySize(w, w * 0.42);
  }

  /**
   * Re-fit the art after a texture swap whose replacement is a different SIZE.
   *
   * A skin is drawn to the same frame as the art it replaces, so `setArtTexture`
   * alone is enough for one. A sleeping dragon is not: it is a different
   * painting of a different pose at its own resolution, and inheriting the
   * standing dragon's scale would land it at roughly twice the tile. The ground
   * shadow is re-fitted here too, because the scale is what decides its width.
   */
  setArtScale(artScale: number): void {
    this.sprite.setScale(artScale);
    this.artBaseX = artScale;
    this.artBaseY = artScale;
    const w = Math.max(64, this.sprite.displayWidth * 0.92);
    this.groundShadow.setDisplaySize(w, w * 0.42);
  }

  acquire(
    snapshot: ItemSnapshot,
    anchors: AnchorsData,
    textureKey: string,
    artScale = 1
  ): void {
    this.itemId = snapshot.id;
    this.chain = snapshot.chain;
    this.tier = snapshot.tier;
    this.kind = snapshot.kind;
    this.isGenerator = snapshot.ready !== undefined;
    this.bobPaused = false;
    this.cooling = false;
    this.artHidden = false;
    this.sprite.setTexture(textureKey);
    const [ax, ay] = anchors.byKey[textureKey] ?? anchors.default;
    this.sprite.setOrigin(ax, ay);
    this.sprite.setPosition(0, 0);
    // File-based decor art can be far larger than a tile; artScale fits it.
    this.sprite.setScale(artScale);
    this.artBaseX = artScale;
    this.artBaseY = artScale;
    this.sleepBreath = false;
    this.sleepGroundY = 0;
    // A pooled item may have been the spinning crystal; `acquire` must hand back
    // a still one or the next piece in this slot inherits the sheet's frames.
    this.spin = null;
    this.sprite.setVisible(true); // a pooled item may have been a hidden rig host
    // Soft shadow scaled to the art's footprint (proportional to its size).
    const w = Math.max(64, this.sprite.displayWidth * 0.92);
    this.groundShadow.setDisplaySize(w, w * 0.42);
    this.groundShadow.setVisible(true);
    this.sprite.clearTint();
    this.readyStar.setVisible(false);
    this.cooldownLabel.setVisible(false);
    this.timePill.setVisible(false);
    this.timeIcon.setVisible(false);
    this.setScale(1);
    this.setAlpha(1);
    this.setVisible(true);
    this.setActive(true);
    this.placeAt(snapshot.col, snapshot.row);
  }

  release(): void {
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.killTweensOf(this.sprite);
    this.scene.tweens.killTweensOf(this.groundShadow);
    // Keep the input component: invisible objects are skipped by hit tests,
    // and disableInteractive() would leave reused pool sprites input-dead.
    this.setVisible(false);
    this.setActive(false);
    this.itemId = 0;
  }

  placeAt(col: number, row: number): void {
    this.col = col;
    this.row = row;
    const { x, y } = gridToWorld(col, row);
    this.setPosition(x, y);
    this.settleDepth();
  }

  settleDepth(): void {
    this.setDepth(DEPTHS.itemBase + this.y);
  }

  /** The art's display bounds in HIT-AREA space (container local point +
   *  displayOrigin — see acquireSprite): the clickable zone wraps the sprite
   *  the player sees, never the tile footprint. */
  artHitRect(): Phaser.Geom.Rectangle {
    const w = this.sprite.displayWidth;
    const h = this.sprite.displayHeight;
    return new Phaser.Geom.Rectangle(
      this.displayOriginX - this.sprite.originX * w,
      this.displayOriginY - this.sprite.originY * h,
      w,
      h
    );
  }

  /** True when hit-area point (hx,hy) lands on (or within HIT_FORGIVENESS_PX
   *  of) an opaque art pixel. Transparent regions FAIL the hit test, so the
   *  pointer falls through to whatever is visually behind — a tall sprite's
   *  empty corners never steal a tap — while the forgiveness ring keeps thin or
   *  holey art (sprout stems) comfortably tappable. A rig host's hidden art
   *  still answers (the live rig stands where the art would). */
  hitsOpaqueArt(hx: number, hy: number): boolean {
    if (this.artOpaqueAt(hx, hy)) return true;
    const r = HIT_FORGIVENESS_PX;
    return (
      this.artOpaqueAt(hx + r, hy) ||
      this.artOpaqueAt(hx - r, hy) ||
      this.artOpaqueAt(hx, hy + r) ||
      this.artOpaqueAt(hx, hy - r) ||
      this.artOpaqueAt(hx + r, hy + r) ||
      this.artOpaqueAt(hx - r, hy - r) ||
      this.artOpaqueAt(hx + r, hy - r) ||
      this.artOpaqueAt(hx - r, hy + r)
    );
  }

  /** Hit-area point on OPAQUE art nearest the art centre — where a pointer test
   *  should AIM (window.__emberkeep.itemToPage): generated placeholder art can
   *  leave the geometric centre transparent. */
  opaqueArtHitPoint(): { x: number; y: number } {
    const r = this.artHitRect();
    const samples = 13;
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let i = 0; i < samples; i++) {
      for (let j = 0; j < samples; j++) {
        const x = r.x + ((i + 0.5) / samples) * r.width;
        const y = r.y + ((j + 0.5) / samples) * r.height;
        if (!this.artOpaqueAt(x, y)) continue;
        const d = (x - r.centerX) ** 2 + (y - r.centerY) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    return best ?? { x: r.centerX, y: r.centerY };
  }

  private artOpaqueAt(hx: number, hy: number): boolean {
    const s = this.sprite;
    if (s.scaleX === 0 || s.scaleY === 0) return false;
    if (!this.scene.textures.exists(s.texture.key)) return true; // no pixels to ask
    const px = (hx - this.displayOriginX - s.x) / s.scaleX + s.displayOriginX;
    const py = (hy - this.displayOriginY - s.y) / s.scaleY + s.displayOriginY;
    const alpha = this.scene.textures.getPixelAlpha(
      Math.floor(px),
      Math.floor(py),
      s.texture.key,
      s.frame.name
    );
    return alpha !== null && alpha > 0;
  }

  /**
   * Hide the placeholder art while a live RigPlayer stands in for it, WITHOUT
   * touching the container's alpha — `setAlpha(0)`/`setVisible(false)` clear the
   * render flag, which makes Phaser skip the object in hit-tests (so taps and
   * drags would die). The container stays fully interactive; only the inner
   * art is hidden.
   */
  setArtVisible(visible: boolean): void {
    this.artHidden = !visible;
    this.sprite.setVisible(visible);
    // A live rig stands in for the art and brings its own shadow — hide ours.
    this.groundShadow.setVisible(visible);
    if (!visible) {
      this.readyStar.setVisible(false);
      // The in-container pill would render UNDER the rig — never show it here;
      // BoardScene's floating cool-badge carries the countdown instead.
      this.cooldownLabel.setVisible(false);
      this.timePill.setVisible(false);
      this.timeIcon.setVisible(false);
    }
  }

  /**
   * Is the piece being carried over ground it could actually be put down on?
   *
   * A shadow is cast BY something ONTO something. Carried out over the open sky
   * between two islands there is no floor to darken, so a shadow there is the
   * same lie the drop-target diamond used to tell before it learned to hide —
   * and on a zoned world, where most of the frame is sky, it is the lie you see
   * most often. `BoardScene.updateDrag` is the one place that knows whether the
   * cell under the drag is real; this is that answer reaching the piece itself,
   * so the diamond and the shadow can never disagree.
   *
   * Written STRAIGHT, not tweened: the lift and the settle already own this
   * property either side of the drag, and a third animation racing them is how
   * a shadow ends up stuck half-faded. Snapping is also the honest reading —
   * the floor is there or it is not, and the edge the piece crosses is a hard
   * one.
   *
   * Driven every frame, so it early-outs on no change.
   */
  setOverGround(on: boolean): void {
    if (on === this.overGround) return;
    this.overGround = on;
    // `groundShadowBeforeLift` is what keeps this from LIGHTING a shadow: a rig
    // host (or a sleeping dragon) hid its own on purpose, and coming back over
    // the isle must not undo that.
    this.groundShadow.setVisible(on && this.groundShadowBeforeLift);
  }

  /**
   * Show the art but NOT its own ground shadow.
   *
   * One caller: a sleeping dragon. The curled painting replaces a rig that was
   * already casting a shadow of its own, in its own place — so the painting
   * keeps standing on THAT shadow instead of lighting a second one underneath
   * itself. Two shadows for one animal is the tell that the pose was swapped.
   */
  setGroundShadowVisible(visible: boolean): void {
    this.groundShadow.setVisible(visible);
  }

  liftForDrag(): void {
    this.bobPaused = true;
    // Remember the shadow's state at pick-up, and start the journey assumed to
    // be over ground — a drag always begins on a cell the piece was sitting on.
    this.groundShadowBeforeLift = this.groundShadow.visible;
    this.overGround = true;
    this.setDepth(DEPTHS.dragged);
    this.scene.tweens.add({
      targets: this,
      scale: DRAG.liftScale,
      duration: DRAG.liftMs,
      ease: 'Back.easeOut'
    });
    this.scene.tweens.add({
      targets: this.sprite,
      y: DRAG.liftY,
      duration: DRAG.liftMs,
      ease: 'Sine.easeOut'
    });
    // The pick-up response lives on the item's own SOFT shadow: it swells
    // under the lifted piece on the same snappy curve the lift uses. (A rig
    // host's art — and its shadow — are hidden; the rig carries its own.)
    if (!this.artHidden) {
      this.scene.tweens.killTweensOf(this.groundShadow);
      const w = this.shadowFitWidth() * DRAG.shadowGrow;
      this.scene.tweens.add({
        targets: this.groundShadow,
        scaleX: w / Math.max(1, this.groundShadow.width),
        scaleY: (w * 0.42) / Math.max(1, this.groundShadow.height),
        duration: DRAG.liftMs,
        ease: 'Back.easeOut'
      });
    }
  }

  /** The soft shadow's resting display width for the current art — the same
   *  fit every setDisplaySize site uses, from the UNTWEENED art scale. */
  private shadowFitWidth(): number {
    return Math.max(64, this.sprite.width * this.artBaseX * 0.92);
  }

  settleFromDrag(): void {
    // Wherever the piece landed it is standing on something again — a drop over
    // the void snaps it home. Restore the shadow it had before the lift.
    this.setOverGround(true);
    this.scene.tweens.add({
      targets: this,
      scale: 1,
      duration: DRAG.settleMs,
      ease: 'Back.easeOut'
    });
    // Keep the bob paused until the lift-offset has eased back to 0, otherwise
    // applyBob would fight (and snap) the inner sprite mid-tween.
    this.scene.tweens.add({
      targets: this.sprite,
      y: 0,
      duration: DRAG.settleMs,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.bobPaused = false;
        this.landSquash();
      }
    });
    if (!this.artHidden) {
      this.scene.tweens.killTweensOf(this.groundShadow);
      const w = this.shadowFitWidth();
      this.scene.tweens.add({
        targets: this.groundShadow,
        scaleX: w / Math.max(1, this.groundShadow.width),
        scaleY: (w * 0.42) / Math.max(1, this.groundShadow.height),
        duration: DRAG.shadowFadeMs,
        ease: 'Sine.easeIn'
      });
    }
  }

  /**
   * Play a baked spin sheet on this item's art, or stop one.
   *
   * One caller: the crystal generator on iOS and the `low` profile, where the
   * live three.js gem is declined and `crystal-spin.webp` stands in for it. The
   * sheet is its own trimmed canvas, so it brings its OWN origin and scale — the
   * `anchors.json` entry and `ITEM_SCALE` that fit the untrimmed 803x902 texture
   * would seat it wrong — and both are generated alongside the pixels by
   * `pack-crystal.py` rather than restated here.
   *
   * Frames are stepped from the clock in `applyBob`, not by a Phaser animation:
   * the art child is an `Image`, and a per-frame `setFrame` in a loop that is
   * already walking every item is cheaper than promoting it to a `Sprite` and
   * giving the animation system another member to tick.
   */
  setSpin(spin: SpinSheet | null): void {
    this.spin = spin;
    if (!spin) return;
    this.sprite.setOrigin(spin.anchor[0], spin.anchor[1]);
    this.sprite.setScale(spin.itemScale);
    this.artBaseX = spin.itemScale;
    this.artBaseY = spin.itemScale;
    const w = Math.max(64, this.sprite.displayWidth * 0.92);
    this.groundShadow.setDisplaySize(w, w * 0.42);
  }

  /** Items no longer float — they sit flat on the ground (a one-time landing
   *  squash on spawn sells the "placed" feel). Kept as a no-op so the per-frame
   *  caller and the drag pause/resume logic stay intact — and as the hook the
   *  sleep breath and the crystal's hover both hang off. */
  applyBob(timeMs: number): void {
    if (this.spin) {
      // BEFORE the drag pause, unlike everything else here: a gem that froze
      // the moment it was picked up would read as the board hanging. The spin
      // is what the object IS, not an idle flourish it can be interrupted out
      // of. `setFrame` on a spritesheet is a UV swap, so a no-change frame is
      // near-free and not worth guarding.
      const t = ((timeMs % this.spin.periodMs) + this.spin.periodMs) % this.spin.periodMs;
      this.sprite.setFrame(Math.min(this.spin.frames - 1, Math.floor((t / this.spin.periodMs) * this.spin.frames)));
    }
    if (this.bobPaused) return;
    if (this.sleepBreath) {
      // A sleeping animal's ribcage: it rises and the body widens a little less
      // than it heightens, so the silhouette breathes instead of pulsing. Slow
      // on purpose — this is the calmest thing on the board.
      const t = (timeMs / SLEEP_BREATH.periodMs) * Math.PI * 2 + this.breathPhase;
      const k = Math.sin(t);
      this.sprite.setScale(
        this.artBaseX * (1 - SLEEP_BREATH.amount * 0.45 * k),
        this.artBaseY * (1 + SLEEP_BREATH.amount * k)
      );
      this.sprite.setY(this.sleepGroundY + SLEEP_BREATH.lift * k);
      return;
    }
    if (this.sprite.y !== 0) this.sprite.setY(0);
  }

  /**
   * Start or stop the sleeping breath.
   *
   * `phase` staggers two sleepers so a pair of dragons never inhales in unison
   * — the same deterministic-per-id trick the standees use, and the reason it
   * is passed in rather than randomised here.
   *
   * `groundY` seats the sleeper: the sleep art's anchor is its own bbox bottom,
   * which lands the belly on the container origin — but the RIG this painting
   * replaces stood `groundLift` px lower (its shadow was tuned to feet there),
   * so the caller passes that drop and the belly lies on the same floor line
   * the feet used. The breath scales around the anchor, so it never moves.
   */
  setSleepBreath(on: boolean, phase = 0, groundY = 0): void {
    this.sleepBreath = on;
    this.breathPhase = phase;
    this.sleepGroundY = on ? groundY : 0;
    if (!on) {
      this.sprite.setScale(this.artBaseX, this.artBaseY);
      this.sprite.setY(0);
    }
  }

  /** A quick squash-and-settle so a newly placed item reads as landing on the
   *  ground (replaces the old idle float). */
  landSquash(): void {
    const baseX = this.sprite.scaleX;
    const baseY = this.sprite.scaleY;
    this.sprite.setScale(baseX * 1.14, baseY * 0.8);
    this.scene.tweens.add({
      targets: this.sprite,
      scaleX: baseX,
      scaleY: baseY,
      duration: 240,
      ease: 'Back.easeOut'
    });
  }

  /** Generator cooldown visual: muted tint while cooling, sparkle when ready. */
  setCooling(cooling: boolean): void {
    if (!this.isGenerator || cooling === this.cooling) return;
    this.cooling = cooling;
    if (cooling) {
      this.sprite.setTint(COOLING_TINT);
      this.readyStar.setVisible(false);
      this.cooldownLabel.setVisible(!this.artHidden);
      this.timePill.setVisible(!this.artHidden);
      this.timeIcon.setVisible(!this.artHidden);
    } else {
      this.sprite.clearTint();
      this.cooldownLabel.setVisible(false);
      this.timePill.setVisible(false);
      this.timeIcon.setVisible(false);
      if (this.artHidden) return; // the rig host shows no ready-star pulse
      this.readyStar.setVisible(true);
      this.readyStar.setAlpha(0);
      this.readyStar.setScale(0.2);
      this.scene.tweens.add({
        targets: this.readyStar,
        alpha: 1,
        scale: 0.7,
        duration: TIMINGS.readyPulse,
        ease: 'Back.easeOut'
      });
      this.scene.tweens.add({
        targets: this,
        scale: 1.12,
        duration: 150,
        yoyo: true,
        ease: 'Sine.easeOut'
      });
    }
  }

  /**
   * Force the in-container countdown pill off, whatever `setCooling` decided.
   *
   * For a rig-hosted dragon the SCENE's floating badge owns the countdown, and
   * `artHidden` stops being a safe proxy for "a rig is presenting" the moment
   * the sleep painting stands in: the art is visible again, so a cooling flip
   * during sleep re-shows this pill — with a label nothing on the rig path
   * ever fills. The scene calls this every badge tick; because it runs in the
   * same frame as the flip, the empty pill never reaches the screen.
   */
  hideCountdownPill(): void {
    this.cooldownLabel.setVisible(false);
    this.timePill.setVisible(false);
    this.timeIcon.setVisible(false);
  }

  /** Update the countdown text + resize the pill around it: "8s" under a
   *  minute, "9:58" mm:ss above. */
  setCooldownRemaining(ms: number): void {
    if (!this.cooling) return;
    const secs = Math.max(0, Math.ceil(ms / 1000));
    this.cooldownLabel.setText(
      secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
    );
    const pillW = Math.max(120, this.cooldownLabel.width + 96);
    this.timePill.setDisplaySize(pillW, 56);
    this.timeIcon.setX(-pillW / 2 + 30);
    this.cooldownLabel.setX(18);
  }

  flashDenied(): void {
    this.sprite.setTintFill(num(PALETTE.lavaHighlight));
    this.scene.time.delayedCall(90, () => {
      if (this.cooling) this.sprite.setTint(COOLING_TINT);
      else this.sprite.clearTint();
    });
    this.scene.tweens.add({
      targets: this,
      x: this.x + 8,
      duration: 45,
      yoyo: true,
      repeat: 3
    });
  }
}
