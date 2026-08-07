import Phaser from 'phaser';
import { FONT } from '../art/design';
import { GAME_WIDTH, LIVE_GAME_HEIGHT, num, PALETTE, panelMobileScale } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import { uiRegistry } from './theme';

const FRAME_W = 980;
const FRAME_H = 520;

/**
 * The travel prompt — a portal was tapped, and this asks before the world
 * changes under the player.
 *
 * A door used to switch on the bare tap. That was fine while doors were
 * invisible rectangles nobody found by accident; the Ember Gate now wears a
 * portal the size of Eleanor and ASKS to be tapped, so an accidental brush of
 * it must not cost the player their board view mid-plan. The prompt is the
 * whole difference: Cross emits the same `world:switch` intent the tap used
 * to, Stay costs nothing.
 */
export class TravelPrompt extends Phaser.GameObjects.Container {
  private title: Phaser.GameObjects.Text;
  private sub: Phaser.GameObjects.Text;
  private crossLabel: Phaser.GameObjects.Text;
  private to = '';
  private offBus: Array<() => void> = [];

  constructor(
    scene: Phaser.Scene,
    private bus: EventBus
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setVisible(false);
    this.setDepth(60000);

    const cx = GAME_WIDTH / 2;
    const cy = LIVE_GAME_HEIGHT / 2;
    // Tap-outside closes: unlike naming, travel is entirely dismissible.
    const dim = scene.add
      .rectangle(cx, cy, GAME_WIDTH * 2, LIVE_GAME_HEIGHT * 2, num(PALETTE.night), 0.7)
      .setInteractive();
    dim.on('pointerup', () => this.close());

    const body = scene.add.container(cx, cy).setScale(panelMobileScale(FRAME_W));
    const frame = scene.add.graphics();
    frame.fillStyle(num(PALETTE.plum), 0.98);
    frame.fillRoundedRect(-FRAME_W / 2, -FRAME_H / 2, FRAME_W, FRAME_H, 46);
    frame.lineStyle(9, num(PALETTE.gold), 1);
    frame.strokeRoundedRect(-FRAME_W / 2, -FRAME_H / 2, FRAME_W, FRAME_H, 46);

    this.title = scene.add
      .text(0, -FRAME_H / 2 + 88, 'THE EMBER GATE', {
        fontFamily: FONT.display, fontSize: '58px', fontStyle: 'bold', color: PALETTE.goldAccent
      })
      .setOrigin(0.5);
    this.sub = scene.add
      .text(0, -34, '', {
        fontFamily: FONT.display,
        fontSize: '38px',
        color: PALETTE.cream,
        wordWrap: { width: FRAME_W - 160 },
        align: 'center'
      })
      .setOrigin(0.5)
      .setAlpha(0.94);

    // Two verbs, Cross first — it is the reason the panel exists. Both are the
    // painted cream plate, so both carry the dark plate ink.
    const mkBtn = (
      x: number,
      text: string,
      onTap: () => void
    ): Phaser.GameObjects.Text => {
      const btn = scene.add.image(x, 138, 'ui_btn_green').setScale(1.15);
      const label = scene.add
        .text(x, 134, text, {
          fontFamily: FONT.display, fontSize: '38px', fontStyle: 'bold', color: PALETTE.night
        })
        .setOrigin(0.5);
      btn.setInteractive({ useHandCursor: true });
      btn.on('pointerup', onTap);
      body.add([btn, label]);
      return label;
    };
    this.crossLabel = mkBtn(-235, 'Cross', () => {
      const to = this.to;
      this.close();
      if (to) this.bus.emit('world:switch', { to });
    });
    mkBtn(235, 'Stay', () => this.close());

    body.add([frame, this.title, this.sub]);
    body.sendToBack(frame);
    this.add([dim, body]);

    uiRegistry.register(scene, 'panel.travel', 'Travel prompt', 'Panels', this, {
      frame,
      title: this.title
    });

    this.offBus.push(
      this.bus.on('ui:travel_requested', ({ to, label, world }) => this.open(to, label, world))
    );
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      for (const off of this.offBus) off();
      this.offBus = [];
    });
  }

  private open(to: string, label: string, world: string): void {
    this.to = to;
    this.title.setText(label.toUpperCase());
    this.sub.setText(`Cross to ${world}?`);
    this.crossLabel.setText('Cross');
    this.setVisible(true);
  }

  private close(): void {
    this.to = '';
    this.setVisible(false);
  }
}
