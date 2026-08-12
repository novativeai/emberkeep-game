import Phaser from 'phaser';
import { REGARD_HEARTS } from '../core/Constants';

/**
 * The five hearts — how a person's Regard is shown, and the ONLY way it is ever
 * shown.
 *
 * Never a number, never a bar, never a "3/5". Regard is expressed as conduct
 * (docs/quests.md §1.3); the row exists so the player can see that the thing
 * changing her lines is a thing they have been doing, not so they can read it
 * off as a stat. The heart in progress fills partially, which is the only hint
 * that there is arithmetic underneath at all.
 *
 * Deliberately dumb: it holds no state and subscribes to nothing. Whoever owns
 * it calls `set()` — the same rule every other readout in this UI follows, and
 * what stops two panels drawing two different gauges for one person.
 */
export class HeartRow extends Phaser.GameObjects.Container {
  private readonly empties: Phaser.GameObjects.Image[] = [];
  private readonly fills: Phaser.GameObjects.Image[] = [];
  /** Full width of the row, for a caller that needs to centre something on it. */
  readonly rowWidth: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    size = 46,
    gap = 10
  ) {
    super(scene, x, y);
    scene.add.existing(this);

    const pitch = size + gap;
    this.rowWidth = pitch * REGARD_HEARTS - gap;
    const left = -this.rowWidth / 2 + size / 2;

    for (let i = 0; i < REGARD_HEARTS; i++) {
      const cx = left + i * pitch;
      const empty = scene.add.image(cx, 0, 'ui_heart_empty').setDisplaySize(size, size);
      // The lit heart is CROPPED rather than scaled as it fills, so a
      // half-earned heart reads as half an ember rather than as a small one.
      const fill = scene.add.image(cx, 0, 'ui_heart').setDisplaySize(size, size).setOrigin(0.5);
      this.empties.push(empty);
      this.fills.push(fill);
      this.add([empty, fill]);
    }
  }

  /**
   * @param hearts   whole hearts lit, 0..REGARD_HEARTS
   * @param progress fill of the NEXT heart, 0..1 (ignored once the row is full)
   */
  set(hearts: number, progress = 0): void {
    const whole = Phaser.Math.Clamp(Math.floor(hearts), 0, REGARD_HEARTS);
    for (let i = 0; i < REGARD_HEARTS; i++) {
      const fill = this.fills[i]!;
      if (i < whole) {
        fill.setVisible(true).setCrop();
        continue;
      }
      if (i === whole && progress > 0) {
        // Crop rectangles are in TEXTURE space, not display space — a heart
        // drawn at 46 units off a 128px texture cropped by display height would
        // barely move. Ask the frame how tall it really is.
        const h = fill.frame.realHeight;
        const w = fill.frame.realWidth;
        const shown = Phaser.Math.Clamp(progress, 0, 1) * h;
        fill.setVisible(true).setCrop(0, h - shown, w, shown);
        continue;
      }
      fill.setVisible(false);
    }
  }

  /** A heart just filled: beat it once. Cosmetic only — the row is already set. */
  pulse(index: number): void {
    const heart = this.fills[Phaser.Math.Clamp(index, 0, REGARD_HEARTS - 1)];
    if (!heart) return;
    this.scene.tweens.add({
      targets: heart,
      scaleX: { from: heart.scaleX, to: heart.scaleX * 1.5 },
      scaleY: { from: heart.scaleY, to: heart.scaleY * 1.5 },
      duration: 220,
      yoyo: true,
      ease: 'Back.easeOut'
    });
  }

  /** Dim the whole row — a person the player has not met yet still has hearts,
   *  they are simply not her business to show brightly. */
  setDim(dim: boolean): void {
    this.setAlpha(dim ? 0.45 : 1);
  }
}
