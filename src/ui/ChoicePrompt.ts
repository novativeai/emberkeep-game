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
import type { EventMap, SpeakerId } from '../core/types';
import { uiRegistry } from './theme';

const FRAME_W = 1060;
const HEAD_H = 250;
const BTN_SCALE = IS_MOBILE ? 1.05 : 0.86;
const BTN_GAP = 26;
const FOOT = 56;
/**
 * THE PLATE THE ANSWERS WEAR — and the only place its name is written.
 *
 * The row pitch, the frame height and the blocker's hole are all MEASURED off
 * this texture (`plateH` / `plateHalfW`), because the numbers that used to
 * state them were the wrong plate's. They read `152 * BTN_SCALE` and
 * `230 * BTN_SCALE` — `ui_btn_green` is 420x152 game units, and those came
 * over from TravelPrompt with it — while the plate drawn here is `ui_btn_play`,
 * 528x192. So the pitch was 156.7 against a plate 165.1 tall and every answer
 * sat 8.4 units INSIDE the one above it (185.6 against 201.6, so 16, on
 * portrait). The hole cut for each plate was 197.8 half-wide against a plate
 * 227.0 half-wide, which broke the one guarantee this panel's input geometry
 * is FOR: the blocker and the buttons overlapped by 29.2 units a side (35.7 on
 * portrait), so along the plate's own edges the dispatch was decided by depth
 * order rather than by nothing touching anything.
 *
 * TravelPrompt's header comment is the same trap written down after the fact:
 * "the keys were not close together, they were 13 units INSIDE each other".
 * Typing a sibling panel's plate size is how that happens twice, so this panel
 * asks the texture instead and cannot drift when either plate is repainted.
 */
const PLATE_KEY = 'ui_btn_play';
const TITLE_PX = IS_MOBILE ? 44 : 36;
const BODY_PX = IS_MOBILE ? 40 : 32;
const LABEL_PX = IS_MOBILE ? 38 : 30;
const MAX_CHOICES = 4;

const SPEAKER_NAME: Record<SpeakerId, string> = {
  eleanor: 'Eleanor',
  selyna: 'Selyna',
  golden_elder: 'The Golden Elder'
};

type PromptRequest = EventMap['event:prompt'];

/**
 * THE CLICKABLE DIALOGUE — an authored event's `prompt` action.
 *
 * A person asks one thing and offers up to four answers; the player picks and
 * `ui:event_choice` carries the pick back to EventSystem, which runs that
 * branch. It is a card in UIScene's depth stack, built once and re-dressed per
 * prompt, and it is NOT dismissible: a question with no answer is a branch
 * that never runs, so the dim swallows taps instead of closing it.
 *
 * Same input SHAPE as TravelPrompt, for the same measured reason: the dim, the
 * frame blocker and the buttons never overlap, so Phaser's dispatch between
 * them is never ambiguous. The NUMBERS are this panel's own, read off its own
 * plate (see PLATE_KEY) — borrowing TravelPrompt's is the bug that shape once
 * hid. Every plate is the ROYAL one — the answers are peers, and a green plate
 * would tell the player which one is "right".
 */
export class ChoicePrompt extends Phaser.GameObjects.Container {
  private dim: Phaser.GameObjects.Rectangle;
  private blocker: Phaser.GameObjects.Zone;
  private frame: Phaser.GameObjects.Graphics;
  private who: Phaser.GameObjects.Text;
  private ask: Phaser.GameObjects.Text;
  private plates: Phaser.GameObjects.Image[] = [];
  private labels: Phaser.GameObjects.Text[] = [];
  private current: PromptRequest | null = null;
  private frameH = HEAD_H;
  /** The drawn plate's half-width and height, in game units, at BTN_SCALE. */
  private readonly plateHalfW: number;
  private readonly plateH: number;

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
    const pScale = panelMobileScale(FRAME_W);
    const dimW = LIVE_GAME_WIDTH * 2;
    const dimH = LIVE_GAME_HEIGHT * 2;

    this.dim = scene.add.rectangle(cx, cy, dimW, dimH, num(PALETTE.night), 0.72).setDepth(59999).setVisible(false);
    this.dim.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(0, 0, dimW, dimH),
      hitAreaCallback: (area: Phaser.Geom.Rectangle, x: number, y: number): boolean => {
        if (!Phaser.Geom.Rectangle.Contains(area, x, y)) return false;
        const lx = x - dimW / 2;
        const ly = y - dimH / 2;
        return Math.abs(lx) > (FRAME_W / 2) * pScale || Math.abs(ly) > (this.frameH / 2) * pScale;
      }
    });
    this.dim.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) =>
      ev.stopPropagation()
    );

    this.blocker = scene.add.zone(cx, cy, FRAME_W * pScale, HEAD_H * pScale).setDepth(60000).setVisible(false);
    this.blocker.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) =>
      ev.stopPropagation()
    );

    const body = scene.add.container(cx, cy).setScale(pScale);
    this.frame = scene.add.graphics();
    const fpx = (n: number): number => Math.max(1, Math.round(px(n) / pScale));
    this.who = scene.add
      .text(0, 0, '', { fontFamily: FONT.display, fontSize: `${fpx(TITLE_PX)}px`, fontStyle: 'bold', color: PALETTE.goldAccent })
      .setOrigin(0.5);
    this.ask = scene.add
      .text(0, 0, '', {
        fontFamily: FONT.display,
        fontSize: `${fpx(BODY_PX)}px`,
        color: PALETTE.cream,
        wordWrap: { width: FRAME_W - 160 },
        align: 'center'
      })
      .setOrigin(0.5)
      .setAlpha(0.94);
    body.add([this.frame, this.who, this.ask]);
    this.add(body);

    for (let i = 0; i < MAX_CHOICES; i++) {
      const plate = scene.add.image(cx, cy, PLATE_KEY).setScale(BTN_SCALE * pScale).setDepth(60002).setVisible(false);
      const label = scene.add
        .text(cx, cy, '', { fontFamily: FONT.display, fontSize: `${fpx(LABEL_PX)}px`, fontStyle: 'bold', color: PALETTE.cream })
        .setOrigin(0.5)
        .setScale(pScale)
        .setDepth(60003)
        .setVisible(false);
      plate.setInteractive({ useHandCursor: true });
      plate.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        this.choose(i);
      });
      this.plates.push(plate);
      this.labels.push(label);
    }

    // Measured off the frame the plates are actually wearing. Read ONCE: the
    // chrome is painted before any panel is built, and a live re-theme redraws
    // that texture IN PLACE (same canvas, same size), so there is nothing here
    // to go stale. `pScale` is left out on purpose — every layout number below
    // is in the body's own space and is multiplied by it at the point of use.
    this.plateHalfW = (this.plates[0].width / 2) * BTN_SCALE;
    this.plateH = this.plates[0].height * BTN_SCALE;

    uiRegistry.register(scene, 'panel.choice', 'Choice prompt', 'Panels', this, { frame: this.frame, title: this.who });

    // UIScene opens it — the request is QUEUED there while the tutorial owns
    // the bubble, the same way a reveal card and a heart beat are.
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.dim.destroy();
      this.blocker.destroy();
      for (const p of this.plates) p.destroy();
      for (const l of this.labels) l.destroy();
    });
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  open(req: PromptRequest): void {
    const choices = req.choices.slice(0, MAX_CHOICES);
    this.current = req;
    const cx = LIVE_GAME_WIDTH / 2;
    const cy = LIVE_GAME_HEIGHT / 2;
    const pScale = panelMobileScale(FRAME_W);

    this.frameH = HEAD_H + choices.length * (this.plateH + BTN_GAP) + FOOT;
    this.frame.clear();
    this.frame.fillStyle(num(PALETTE.plum), 0.98);
    this.frame.fillRoundedRect(-FRAME_W / 2, -this.frameH / 2, FRAME_W, this.frameH, 46);
    this.frame.lineStyle(9, num(PALETTE.gold), 1);
    this.frame.strokeRoundedRect(-FRAME_W / 2, -this.frameH / 2, FRAME_W, this.frameH, 46);
    this.who.setText(SPEAKER_NAME[req.speaker] ?? req.speaker).setPosition(0, -this.frameH / 2 + 78);
    this.ask.setText(req.text).setPosition(0, -this.frameH / 2 + HEAD_H / 2 + 50);

    // The blocker covers the frame minus every plate (hit-tested per frame
    // against the live layout, so a taller prompt keeps the same guarantee).
    const bw = FRAME_W * pScale;
    const bh = this.frameH * pScale;
    const rows: number[] = [];
    for (let i = 0; i < MAX_CHOICES; i++) {
      const shown = i < choices.length;
      const y = -this.frameH / 2 + HEAD_H + i * (this.plateH + BTN_GAP) + this.plateH / 2;
      rows.push(y);
      this.plates[i].setPosition(cx, cy + y * pScale).setVisible(shown);
      this.labels[i].setText(shown ? choices[i].label : '').setPosition(cx, cy + (y - 4) * pScale).setVisible(shown);
      if (shown) this.plates[i].setInteractive({ useHandCursor: true });
      else this.plates[i].disableInteractive();
    }
    this.blocker.setSize(bw, bh);
    this.blocker.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(0, 0, bw, bh),
      hitAreaCallback: (area: Phaser.Geom.Rectangle, x: number, y: number): boolean => {
        if (!Phaser.Geom.Rectangle.Contains(area, x, y)) return false;
        const lx = x - bw / 2;
        const ly = y - bh / 2;
        for (let i = 0; i < choices.length; i++) {
          if (Math.abs(lx) < (this.plateHalfW + 6) * pScale && Math.abs(ly - rows[i] * pScale) < (this.plateH / 2 + 6) * pScale) return false;
        }
        return true;
      }
    });

    this.dim.setVisible(true);
    this.blocker.setVisible(true);
    this.setVisible(true);
  }

  private choose(index: number): void {
    const req = this.current;
    if (!req) return;
    const choice = req.choices[index];
    this.close();
    if (choice) this.bus.emit('ui:event_choice', { eventId: req.eventId, promptId: req.promptId, choice: choice.id });
  }

  private close(): void {
    this.current = null;
    this.dim.setVisible(false);
    this.blocker.setVisible(false);
    for (const p of this.plates) p.setVisible(false);
    for (const l of this.labels) l.setVisible(false);
    this.setVisible(false);
  }
}
