import Phaser from 'phaser';
import { num, PALETTE } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { EventMap } from '../core/types';

const FONT = 'Trebuchet MS, Verdana, sans-serif';
const SLOT_H = 120; // vertical gap between the two stacked gauges
const BAR_X = 84;
const BAR_W = 400; // matches the Keeper XP bar (440×36) — the gauges read as "big"
const BAR_H = 34;

interface GaugeSlot {
  root: Phaser.GameObjects.Container;
  face: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Graphics;
  count: Phaser.GameObjects.Text;
  lv: Phaser.GameObjects.Text;
}

/**
 * The two dragons' duel-level gauges, parked just above the Keeper level/XP bar
 * (bottom-left). Each owned dragon shows its face, Lv, and 0..gaugeMax gauge —
 * the same value the duel fills. Appears only once you own a dragon; hidden
 * before that. Pure subscriber (reads `duel:changed`).
 */
export class DragonGauges extends Phaser.GameObjects.Container {
  private slots: GaugeSlot[] = [];
  private offBus: () => void;

  constructor(scene: Phaser.Scene, bus: EventBus, x: number, y: number) {
    super(scene, x, y);

    // Two stacked slots: index 0 sits at the mount (bottom), index 1 above it
    // (top). render() puts the RED dragon in slot 0 and GREEN in slot 1.
    for (let i = 0; i < 2; i++) {
      const root = scene.add.container(0, -i * SLOT_H);
      const bar = scene.add.graphics();
      const face = scene.add.image(42, 4, '__DEFAULT').setDisplaySize(76, 76);
      const lv = scene.add
        .text(BAR_X + 2, -26, '', { fontFamily: FONT, fontSize: '32px', fontStyle: 'bold', color: PALETTE.goldAccent, stroke: PALETTE.night, strokeThickness: 5 })
        .setOrigin(0, 0.5);
      const count = scene.add
        .text(BAR_X + BAR_W / 2, 21, '', { fontFamily: FONT, fontSize: '28px', fontStyle: 'bold', color: PALETTE.cream, stroke: PALETTE.night, strokeThickness: 5 })
        .setOrigin(0.5);
      root.add([bar, face, lv, count]);
      this.add(root);
      this.slots.push({ root, face, bar, count, lv });
    }

    scene.add.existing(this);
    this.setScale(1.0); // bars are sized to the XP bar natively now
    this.setVisible(false);
    this.offBus = bus.on('duel:changed', (m) => this.render(m));
  }

  private drawBar(g: Phaser.GameObjects.Graphics, gauge: number, max: number): void {
    g.clear();
    g.fillStyle(num(PALETTE.night), 0.6);
    g.fillRoundedRect(BAR_X, 4, BAR_W, BAR_H, BAR_H / 2);
    const frac = Math.max(0, Math.min(1, max > 0 ? gauge / max : 0));
    if (frac > 0) {
      g.fillStyle(num(PALETTE.moss), 1);
      g.fillRoundedRect(BAR_X, 4, Math.max(BAR_H, BAR_W * frac), BAR_H, BAR_H / 2);
    }
    g.lineStyle(2.5, num(PALETTE.gold), 0.8);
    g.strokeRoundedRect(BAR_X, 4, BAR_W, BAR_H, BAR_H / 2);
  }

  private render(m: EventMap['duel:changed']): void {
    const owned = m.roster.filter((d) => d.owned);
    if (owned.length === 0) {
      this.setVisible(false);
      return;
    }
    this.setVisible(true);
    // Fixed layout by colour: RED in slot 0 (bottom), GREEN in slot 1 (top).
    // Any other-coloured dragon (future chains) fills whichever slot is free.
    const bySlot: (typeof owned[number] | undefined)[] = [
      owned.find((d) => d.color === 'red'),
      owned.find((d) => d.color === 'green')
    ];
    const leftovers = owned.filter((d) => d.color !== 'red' && d.color !== 'green');
    for (let i = 0; i < bySlot.length && leftovers.length > 0; i++) {
      if (!bySlot[i]) bySlot[i] = leftovers.shift();
    }
    for (let i = 0; i < 2; i++) {
      const slot = this.slots[i]!;
      const d = bySlot[i];
      if (!d) {
        slot.root.setVisible(false);
        continue;
      }
      slot.root.setVisible(true);
      const faceKey = `duel_face_${d.color}`;
      if (this.scene.textures.exists(faceKey)) slot.face.setTexture(faceKey).setDisplaySize(76, 76);
      slot.lv.setText(`Lv ${d.level}`);
      slot.count.setText(`${d.gauge}/${m.gaugeMax}`);
      this.drawBar(slot.bar, d.gauge, m.gaugeMax);
    }
  }

  destroy(fromScene?: boolean): void {
    this.offBus?.();
    super.destroy(fromScene);
  }
}
