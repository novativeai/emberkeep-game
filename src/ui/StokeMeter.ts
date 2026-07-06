import Phaser from 'phaser';
import { num, PALETTE } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { EventMap } from '../core/types';

const FONT = 'Trebuchet MS, Verdana, sans-serif';
const R_SPARK = 80; // outer spark-ring radius
const TH_SPARK = 14;
const R_STOKE = 58; // inner stoke-ring radius
const TH_STOKE = 8;
const R_ORB = 47; // orb body radius
const HIT = 88; // tap radius
const TOP = -Math.PI / 2; // 12 o'clock
const TAU = Math.PI * 2;

/**
 * The Emberfont "Spark Well" — a round, modern orb (bottom-left). Two concentric
 * activity rings tell the whole story without prose: the OUTER ring is 5 Spark
 * segments (lit = a tap available), the INNER ring is the Stoke arc filling
 * toward a Surge. The centre shows the next vein that will drop. Tapping emits
 * `emberfont:tap`; the orb ignites while Surging. Hidden until the well wakes
 * (post-tutorial `active`). Pure subscriber.
 */
export class StokeMeter extends Phaser.GameObjects.Container {
  private glow: Phaser.GameObjects.Graphics;
  private rings: Phaser.GameObjects.Graphics;
  private orb: Phaser.GameObjects.Graphics;
  private veinIcon: Phaser.GameObjects.Image;
  private surgeText: Phaser.GameObjects.Text;
  private surging = false;
  private glowTween?: Phaser.Tweens.Tween;
  private pulseTween?: Phaser.Tweens.Tween;
  private offBus: Array<() => void> = [];

  constructor(scene: Phaser.Scene, private bus: EventBus, x: number, y: number) {
    super(scene, x, y);

    this.glow = scene.add.graphics();
    this.rings = scene.add.graphics();
    this.orb = scene.add.graphics();
    this.veinIcon = scene.add.image(0, -4, '__DEFAULT').setDisplaySize(46, 46);
    this.surgeText = scene.add
      .text(0, R_SPARK + 4, '', {
        fontFamily: FONT, fontSize: '23px', fontStyle: 'bold', color: PALETTE.goldAccent,
        stroke: PALETTE.night, strokeThickness: 5
      })
      .setOrigin(0.5, 0.5);

    this.add([this.glow, this.rings, this.orb, this.veinIcon, this.surgeText]);
    scene.add.existing(this);

    this.setSize(HIT * 2, HIT * 2).setInteractive({ useHandCursor: true });
    this.on('pointerdown', () => { if (!this.surging) this.setScale(0.94); });
    this.on('pointerout', () => { if (!this.surging) this.setScale(1); });
    this.on('pointerup', () => {
      if (!this.surging) this.setScale(1);
      this.bus.emit('emberfont:tap', {});
    });

    this.setVisible(false); // hidden until the well wakes
    this.offBus.push(bus.on('emberfont:changed', (m) => this.render(m)));
    this.offBus.push(bus.on('emberfont:sparked', () => this.pulse()));
  }

  private arc(r: number, th: number, color: string, alpha: number, a0: number, a1: number): void {
    this.rings.lineStyle(th, num(color), alpha);
    this.rings.beginPath();
    this.rings.arc(0, 0, r, a0, a1, false);
    this.rings.strokePath();
  }

  private drawRings(m: EventMap['emberfont:changed']): void {
    this.rings.clear();
    // Outer: 5 Spark segments (lit = a draw is ready).
    const seg = TAU / m.maxSparks;
    const gap = 0.18;
    for (let i = 0; i < m.maxSparks; i++) {
      const a0 = TOP + i * seg + gap / 2;
      const a1 = TOP + (i + 1) * seg - gap / 2;
      const lit = i < m.sparks;
      this.arc(R_SPARK, TH_SPARK, lit ? (m.surging ? PALETTE.goldAccent : PALETTE.lava) : PALETTE.plumShade, lit ? 1 : 0.85, a0, a1);
      if (lit) this.arc(R_SPARK, TH_SPARK * 0.34, m.surging ? PALETTE.white : PALETTE.goldAccent, 0.9, a0, a1);
    }
    // Inner: Stoke arc filling toward a Surge.
    this.arc(R_STOKE, TH_STOKE, PALETTE.night, 0.5, 0, TAU); // full track
    const frac = m.surging ? 1 : Math.max(0, Math.min(1, m.stoke / m.maxStoke));
    if (frac > 0) this.arc(R_STOKE, TH_STOKE, m.surging ? PALETTE.goldAccent : PALETTE.gold, 1, TOP, TOP + frac * TAU);
  }

  private drawBody(surging: boolean): void {
    const g = this.orb;
    g.clear();
    g.fillStyle(num(surging ? PALETTE.lavaShade : PALETTE.plum), 1);
    g.fillCircle(0, 0, R_ORB);
    g.fillStyle(num(PALETTE.white), 0.1); // top sheen
    g.fillEllipse(0, -R_ORB * 0.42, R_ORB, R_ORB * 0.55);
    g.lineStyle(3, num(surging ? PALETTE.goldAccent : PALETTE.gold), 0.95);
    g.strokeCircle(0, 0, R_ORB);
  }

  private render(m: EventMap['emberfont:changed']): void {
    if (!m.active) {
      this.setVisible(false);
      return;
    }
    this.setVisible(true);
    this.drawRings(m);
    this.drawBody(m.surging);

    const key = `item_${m.nextVein.chain}_${m.nextVein.tier}`;
    if (this.scene.textures.exists(key)) this.veinIcon.setTexture(key).setDisplaySize(46, 46);

    this.surgeText.setText(m.surging ? `🔥 ${Math.ceil(m.surgeRemainingMs / 1000)}s` : '');
    this.setSurging(m.surging);
  }

  private setSurging(surging: boolean): void {
    if (surging === this.surging) return;
    this.surging = surging;
    this.glowTween?.stop();
    this.pulseTween?.stop();
    this.glow.clear();
    if (surging) {
      this.setScale(1); // clear any mid-press squash so the pulse baseline is 1.0
      this.glow.fillStyle(num(PALETTE.lavaHighlight), 0.32);
      this.glow.fillCircle(0, 0, R_SPARK + 18);
      this.glowTween = this.scene.tweens.add({
        targets: this.glow, alpha: { from: 0.35, to: 1 }, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
      });
      this.pulseTween = this.scene.tweens.add({
        targets: this, scale: 1.06, duration: 460, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
      });
    } else {
      this.scene.tweens.killTweensOf(this);
      this.setScale(1);
      this.glow.setAlpha(1);
    }
  }

  /** A quick squash-and-pop on the vein icon when a Spark is drawn. */
  private pulse(): void {
    this.scene.tweens.add({
      targets: this.veinIcon, scaleX: '*=0.7', scaleY: '*=0.7', duration: 130, yoyo: true, ease: 'Sine.easeInOut'
    });
  }

  destroy(fromScene?: boolean): void {
    this.offBus.forEach((off) => off());
    this.glowTween?.stop();
    this.pulseTween?.stop();
    super.destroy(fromScene);
  }
}
