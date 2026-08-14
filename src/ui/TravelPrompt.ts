import Phaser from 'phaser';
import { FONT } from '../art/design';
import { LIVE_GAME_HEIGHT, LIVE_GAME_WIDTH, num, PALETTE, panelMobileScale } from '../core/Constants';
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
  private dim!: Phaser.GameObjects.Rectangle;
  /** Root-level pieces (dim aside) shown/hidden with the panel. */
  private chrome: Phaser.GameObjects.GameObject[] = [];
  private offBus: Array<() => void> = [];

  constructor(
    scene: Phaser.Scene,
    private bus: EventBus
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setVisible(false);
    this.setDepth(60001);

    const cx = LIVE_GAME_WIDTH / 2;
    const cy = LIVE_GAME_HEIGHT / 2;
    // The dim is a SIBLING below the panel, never a child beside the buttons:
    // inside one container Phaser's input sort is ambiguous between a
    // full-screen rectangle and nested buttons, and the rectangle won —
    // Cross went dead (measured). As a separate object one depth band down,
    // every cross-parent comparison is by depth and the buttons always win.
    // It swallows what it catches, so a dismissing tap never falls through to
    // the board underneath. Tap-outside closes: travel is dismissible.
    // NO two interactive objects of this panel ever overlap — Phaser's
    // dispatch between an overlapping pair proved order-unstable here
    // (measured: the full-screen dim swallowed Cross regardless of depth).
    // So each piece's hit area EXCLUDES the others': the dim is tappable only
    // outside the frame, the frame-blocker only outside the buttons.
    const pScale = panelMobileScale(FRAME_W);
    const dimW = LIVE_GAME_WIDTH * 2;
    const dimH = LIVE_GAME_HEIGHT * 2;
    this.dim = scene.add
      .rectangle(cx, cy, dimW, dimH, num(PALETTE.night), 0.7)
      .setDepth(59999)
      .setVisible(false);
    this.dim.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(0, 0, dimW, dimH),
      hitAreaCallback: (area: Phaser.Geom.Rectangle, x: number, y: number): boolean => {
        if (!Phaser.Geom.Rectangle.Contains(area, x, y)) return false;
        const lx = x - dimW / 2;
        const ly = y - dimH / 2;
        return Math.abs(lx) > (FRAME_W / 2) * pScale || Math.abs(ly) > (FRAME_H / 2) * pScale;
      }
    });
    this.dim.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      this.close();
    });
    // The frame itself swallows taps (a tap on the title must not reach the
    // board beneath) but yields the two button rectangles.
    const blocker = scene.add
      .zone(cx, cy, FRAME_W * pScale, FRAME_H * pScale)
      .setDepth(60000)
      .setVisible(false);
    const bw = FRAME_W * pScale;
    const bh = FRAME_H * pScale;
    const btnHalfW = 242 * pScale;
    const btnHalfH = 90 * pScale;
    blocker.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(0, 0, bw, bh),
      hitAreaCallback: (area: Phaser.Geom.Rectangle, x: number, y: number): boolean => {
        if (!Phaser.Geom.Rectangle.Contains(area, x, y)) return false;
        const lx = x - bw / 2;
        const ly = y - bh / 2;
        for (const bx of [-235 * pScale, 235 * pScale]) {
          if (Math.abs(lx - bx) < btnHalfW && Math.abs(ly - 138 * pScale) < btnHalfH) return false;
        }
        return true;
      }
    });
    blocker.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) =>
      ev.stopPropagation()
    );
    this.chrome.push(blocker);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.dim.destroy();
      for (const c of this.chrome) c.destroy();
      this.chrome = [];
    });

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

    // Two verbs, Cross first — it is the reason the panel exists. The buttons
    // are TOP-LEVEL scene objects, never container children: nested inside a
    // container their input priority collapses to the container tree's zeros
    // and the full-screen dim outranks them (measured — Cross went dead).
    // Root-level siblings sort purely by depth, and 60002 > the dim's 59999.
    const scale = panelMobileScale(FRAME_W);
    const mkBtn = (
      x: number,
      text: string,
      onTap: () => void
    ): Phaser.GameObjects.Text => {
      const bx = cx + x * scale;
      const by = cy + 138 * scale;
      const btn = scene.add.image(bx, by, 'ui_btn_green').setScale(1.15 * scale).setDepth(60002).setVisible(false);
      const label = scene.add
        .text(bx, by - 4 * scale, text, {
          fontFamily: FONT.display, fontSize: '38px', fontStyle: 'bold', color: PALETTE.night
        })
        .setOrigin(0.5)
        .setScale(scale)
        .setDepth(60003)
        .setVisible(false);
      btn.setInteractive({ useHandCursor: true });
      // stopPropagation so the dim below never hears a button tap.
      btn.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        onTap();
      });
      this.chrome.push(btn, label);
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
    this.add(body);

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
    this.dim.setVisible(true);
    for (const c of this.chrome) (c as Phaser.GameObjects.Image).setVisible(true);
    this.setVisible(true);
  }

  private close(): void {
    this.to = '';
    this.dim.setVisible(false);
    for (const c of this.chrome) (c as Phaser.GameObjects.Image).setVisible(false);
    this.setVisible(false);
  }
}
