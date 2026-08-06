import Phaser from 'phaser';
import { INK } from '../art/design';
import { num } from '../core/Constants';

/**
 * A segmented gauge bar — how a dragon's feeding is shown.
 *
 * Deliberately NOT the five hearts. Hearts are Regard, and Regard belongs to
 * Eleanor and Selyna: it is a relationship, it only ever goes up, and it is read
 * as conduct rather than as a stat. A dragon's hunger is the opposite kind of
 * number — it empties every day, it is fractional (a Moss Tuft is a quarter of a
 * meal), and the player acts on it directly. Showing both on the same five-heart
 * shape said they were the same thing.
 *
 * The dividers are what make it legible: servings are fractional, so a plain
 * continuous fill cannot say "one and a quarter meals of two". One segment per
 * meal, with the fill running across them, says both at once.
 *
 * Dumb like `HeartRow`: it holds no state and subscribes to nothing. Whoever
 * owns it calls `set()`.
 */
export class GaugeBar extends Phaser.GameObjects.Container {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly barW: number;
  private readonly barH: number;

  constructor(scene: Phaser.Scene, x: number, y: number, width = 300, height = 30) {
    super(scene, x, y);
    scene.add.existing(this);
    this.barW = width;
    this.barH = height;
    this.g = scene.add.graphics();
    this.add(this.g);
  }

  /** Width of the bar, for a caller seating it against a right margin. */
  get barWidth(): number {
    return this.barW;
  }

  /**
   * `ratio` 0..1 of the bar filled, `segments` how many meals it is divided
   * into. `sated` swaps the warm "still wants feeding" fill for the calm green
   * of a dragon that needs nothing — the one colour change in the whole gauge,
   * so it reads as a state rather than as decoration.
   */
  set(ratio: number, segments: number, sated = false): void {
    const r = Phaser.Math.Clamp(ratio, 0, 1);
    const { barW: w, barH: h, g } = this;
    const radius = h / 2;
    g.clear();

    // Trough. Not flat black: an empty gauge still has to read as a GAUGE, and
    // a black slab under a name just reads as a missing texture. The lit lip
    // and the dividers below are what make the empty state say "nothing in me
    // yet" instead of nothing at all.
    g.fillStyle(num(INK.field), 1);
    g.fillRoundedRect(0, -h / 2, w, h, radius);
    g.fillStyle(num(INK.fieldDeep), 0.85);
    g.fillRoundedRect(2, -h / 2 + 2, w - 4, h * 0.55, radius);

    if (r > 0) {
      // A sliver of fill still has to look like a rounded bar, so the filled
      // width never drops below its own cap.
      const fw = Math.max(h, w * r);
      const fill = sated ? INK.gain : INK.ember;
      g.fillStyle(num(fill), 1);
      g.fillRoundedRect(0, -h / 2, fw, h, radius);
      // Highlight along the top of the fill — the detail that separates "a
      // filled bar" from "a bar filling". Kept thin and half-strength: on a
      // one-serving fill a fat bright band covers the whole cap and the ember
      // underneath stops reading as ember at all.
      g.fillStyle(num(sated ? INK.gain : INK.emberLift), 0.5);
      g.fillRoundedRect(4, -h / 2 + 4, fw - 8, h * 0.22, radius * 0.5);
    }

    // Dividers, drawn OVER the fill so a segment boundary stays visible inside
    // the filled part — that is what lets the bar be counted, not just judged.
    // Gold rather than the trough's own colour, or they disappear on the empty
    // half, which is exactly where the count matters most.
    if (segments > 1) {
      g.lineStyle(3, num(INK.goldDeep), 0.9);
      for (let i = 1; i < segments; i++) {
        const x = (w * i) / segments;
        g.lineBetween(x, -h / 2 + 3, x, h / 2 - 3);
      }
    }

    g.lineStyle(3.5, num(INK.goldMid), 1);
    g.strokeRoundedRect(0, -h / 2, w, h, radius);
  }
}
