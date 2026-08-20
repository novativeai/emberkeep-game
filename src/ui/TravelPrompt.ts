import Phaser from 'phaser';
import { FONT } from '../art/design';
import {
  IS_MOBILE,
  LIVE_GAME_HEIGHT,
  LIVE_GAME_WIDTH,
  num,
  PALETTE,
  panelMobileScale,
  px
} from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import { uiRegistry } from './theme';

const FRAME_W = 980;
const FRAME_H = 520;

/*
 * THE TWO VERBS WERE OVERLAPPING, and the arithmetic says so.
 *
 * `ui_btn_green` is painted 210x76 logical, so the plate is 420x152 board
 * units. At 1.15 that is 483 wide — and the pair sat at ±235, a pitch of 470.
 * The keys were not "close together": they were 13 units INSIDE each other,
 * and the only reason it read as a seam rather than a bug is that both are the
 * same green.
 *
 * So the pitch and the plate are stated together, and the air between them is
 * whatever is left: 2*230 - 412 = 48. The pair spans 872 inside a 980 frame,
 * which leaves 54 down each margin — the same air outside as in.
 */
/*
 * PORTRAIT IS THE SAME PANEL, MAGNIFIED — not a second, louder layout.
 *
 * `panelMobileScale` already blows the whole frame up to fill the phone's
 * width, and the previous numbers then magnified the contents A SECOND TIME on
 * top of it: a 1.4x plate inside a 1.71x panel is 2.4x the desktop key, while
 * FRAME_H never moved. Measured, that left 15.6 units under the keys, 15.6
 * between them and the question, and 13 over the title, in a frame with 260 to
 * spend — which is the "trop serré" exactly.
 *
 * So the portrait plate is 1.05: barely over the desktop 0.98, because the
 * panel's own magnification is what makes it thumb-sized (441 x 160 units at
 * 1.05 lands at 147 x 53 REAL px on a 390px handset, well past the 44px bar).
 * 245 keeps 49 units of air between the two verbs — the pair used to sit 13
 * units INSIDE each other, and that is the failure this pitch is measured
 * against, not a taste.
 */
const BTN_SCALE = IS_MOBILE ? 1.05 : 0.98;
const BTN_DX = IS_MOBILE ? 245 : 230;
const BTN_Y = 138;
/** Half the PLATE, from the texture's own painted size — not a guess that has
 *  to be re-guessed whenever the scale moves. */
const BTN_HALF_W = 210 * BTN_SCALE;
const BTN_HALF_H = 76 * BTN_SCALE;
/**
 * The frame has to HOLD the pair, whatever the pair is.
 *
 * 108 is chosen so the desktop case comes to 979.6 and the `max` keeps the
 * authored 980 EXACTLY — the landscape prompt does not move by a unit. In
 * portrait the 1.05 plate takes it to 1039, so the pair spans 931 with the same
 * 54 units of margin down each side the landscape frame has. That 1039 is then
 * magnified to 89% of the screen's width, where 1404 used to be magnified to
 * 94% of it and crush its own contents.
 */
const FRAME_FIT_W = Math.max(FRAME_W, 2 * (BTN_DX + BTN_HALF_W) + 108);

/**
 * The panel's own magnification, and the reason the type has to divide by it.
 *
 * `px()` steps a size into the portrait space so that it LANDS at the same
 * apparent size a desktop reader gets — that is the whole contract of
 * TYPE_STEP. But every piece of type here is drawn inside something scaled by
 * `panelMobileScale`, so `px(38)` was being multiplied a second time and
 * arrived 2.2x over its own intent: 26 real px for a button label, against 19
 * on a desktop, on the smaller screen.
 *
 * `fpx` divides that scale back out. The type is therefore stated ONCE, in the
 * size it is meant to be READ at, and the panel's magnification stops leaking
 * into it. Desktop is arithmetically untouched — PANEL_SCALE is 1 and `px` is
 * the identity there, so `fpx(n) === n`.
 */
const PANEL_SCALE = panelMobileScale(FRAME_FIT_W);
const fpx = (n: number): number => Math.max(1, Math.round(px(n) / PANEL_SCALE));

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
    const pScale = panelMobileScale(FRAME_FIT_W);
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
        return Math.abs(lx) > (FRAME_FIT_W / 2) * pScale || Math.abs(ly) > (FRAME_H / 2) * pScale;
      }
    });
    this.dim.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      this.close();
    });
    // The frame itself swallows taps (a tap on the title must not reach the
    // board beneath) but yields the two button rectangles.
    const blocker = scene.add
      .zone(cx, cy, FRAME_FIT_W * pScale, FRAME_H * pScale)
      .setDepth(60000)
      .setVisible(false);
    const bw = FRAME_FIT_W * pScale;
    const bh = FRAME_H * pScale;
    // A hair of slack around the plate, so the blocker's hole is never smaller
    // than the key it is meant to be a hole for.
    const btnHalfW = (BTN_HALF_W + 6) * pScale;
    const btnHalfH = (BTN_HALF_H + 6) * pScale;
    blocker.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(0, 0, bw, bh),
      hitAreaCallback: (area: Phaser.Geom.Rectangle, x: number, y: number): boolean => {
        if (!Phaser.Geom.Rectangle.Contains(area, x, y)) return false;
        const lx = x - bw / 2;
        const ly = y - bh / 2;
        for (const bx of [-BTN_DX * pScale, BTN_DX * pScale]) {
          if (Math.abs(lx - bx) < btnHalfW && Math.abs(ly - BTN_Y * pScale) < btnHalfH) return false;
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

    const body = scene.add.container(cx, cy).setScale(panelMobileScale(FRAME_FIT_W));
    const frame = scene.add.graphics();
    frame.fillStyle(num(PALETTE.plum), 0.98);
    frame.fillRoundedRect(-FRAME_FIT_W / 2, -FRAME_H / 2, FRAME_FIT_W, FRAME_H, 46);
    frame.lineStyle(9, num(PALETTE.gold), 1);
    frame.strokeRoundedRect(-FRAME_FIT_W / 2, -FRAME_H / 2, FRAME_FIT_W, FRAME_H, 46);

    this.title = scene.add
      .text(0, -FRAME_H / 2 + 88, 'THE EMBER GATE', {
        fontFamily: FONT.display, fontSize: `${fpx(58)}px`, fontStyle: 'bold', color: PALETTE.goldAccent
      })
      .setOrigin(0.5);
    this.sub = scene.add
      .text(0, -34, '', {
        fontFamily: FONT.display,
        fontSize: `${fpx(38)}px`,
        color: PALETTE.cream,
        wordWrap: { width: FRAME_FIT_W - 160 },
        align: 'center'
      })
      .setOrigin(0.5)
      .setAlpha(0.94);

    // Two verbs, Cross first — it is the reason the panel exists. The buttons
    // are TOP-LEVEL scene objects, never container children: nested inside a
    // container their input priority collapses to the container tree's zeros
    // and the full-screen dim outranks them (measured — Cross went dead).
    // Root-level siblings sort purely by depth, and 60002 > the dim's 59999.
    const scale = panelMobileScale(FRAME_FIT_W);
    const mkBtn = (
      x: number,
      text: string,
      onTap: () => void
    ): Phaser.GameObjects.Text => {
      const bx = cx + x * scale;
      const by = cy + BTN_Y * scale;
      const btn = scene.add
        .image(bx, by, 'ui_btn_green')
        .setScale(BTN_SCALE * scale)
        .setDepth(60002)
        .setVisible(false);
      const label = scene.add
        .text(bx, by - 4 * scale, text, {
          fontFamily: FONT.display, fontSize: `${fpx(38)}px`, fontStyle: 'bold', color: PALETTE.night
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
    this.crossLabel = mkBtn(-BTN_DX, 'Cross', () => {
      const to = this.to;
      this.close();
      if (to) this.bus.emit('world:switch', { to });
    });
    mkBtn(BTN_DX, 'Stay', () => this.close());

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
