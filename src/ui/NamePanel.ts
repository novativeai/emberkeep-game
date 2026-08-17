import Phaser from 'phaser';
import { FONT } from '../art/design';
import { LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, num, PALETTE, panelMobileScale, TIMINGS } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import { uiRegistry } from './theme';

const FRAME_W = 1180;
const FRAME_H = 820;

/** The typed field: a plate the name sits in, above the suggestions. */
const FIELD_W = 720;
const FIELD_H = 116;
const FIELD_Y = -78;
const OPTIONS_Y = 92;
/** Longest name we will keep. Matches the companion path's own clamp. */
const NAME_MAX = 16;
/** Suggestion cards — smaller than they were, because they are no longer the
 *  answer, only shortcuts into the field above them. */
const CARD_W = 300;
const CARD_H = 104;

/** Name pools per dragon line. Short, warm, sayable out loud — Eleanor's whole
 *  point is that a name only takes if something hears it. */
const NAMES: Record<string, string[]> = {
  ember_dragon: [
    'Ashling', 'Cinder', 'Pyre', 'Hearth', 'Sable', 'Kindle', 'Ember', 'Sorrel',
    'Rusk', 'Tinder', 'Bellow', 'Coal', 'Marrow', 'Flint', 'Scorch', 'Bramble'
  ],
  emerald: [
    'Fern', 'Moss', 'Thistle', 'Verdant', 'Ivy', 'Sage', 'Bracken', 'Hollow',
    'Willow', 'Nettle', 'Sorrel', 'Juniper', 'Laurel', 'Alder', 'Reed', 'Yarrow'
  ]
};

/**
 * The naming prompt — it opens the instant a nest hatches, before anything else.
 *
 * A picker rather than a text field, on purpose: this is a mobile game with no
 * DOM input container, a keyboard would cover the dragon the player is naming,
 * and three good options read as an invitation where an empty box reads as
 * homework. Reroll is free and unlimited, so nobody is stuck with a name they
 * dislike.
 */
export class NamePanel extends Phaser.GameObjects.Container {
  isOpen = false;
  /**
   * Who is being named. A nest hatchling is a `Companion` and answers to a
   * string id; a board dragon is an item and answers to a number. The panel is
   * identical either way — the only difference is which intent `confirm` emits,
   * so the two are one union rather than two panels.
   */
  private subject: { kind: 'companion'; id: string } | { kind: 'board'; id: number } | null = null;
  private chain = 'ember_dragon';
  private optionRow: Phaser.GameObjects.Container;
  private fieldBg: Phaser.GameObjects.Graphics;
  private fieldText: Phaser.GameObjects.Text;
  private caret: Phaser.GameObjects.Text;
  private fieldZone: Phaser.GameObjects.Zone;
  /**
   * A real, focusable `<input>` parked off-screen behind the canvas.
   *
   * Phaser `Text` cannot take keystrokes and this build has no DOM container
   * (`dom.createContainer` is off game-wide), so the field on screen is drawn by
   * us and fed by a hidden input. That is also what makes a phone work: a soft
   * keyboard only opens for a focused form control, and focusing one inside the
   * tap that opened the panel counts as a user gesture.
   */
  private nameInput: HTMLInputElement | null = null;
  private chosen = '';
  private offBus: Array<() => void> = [];
  private confirmLabel: Phaser.GameObjects.Text;
  private confirmBtn: Phaser.GameObjects.Image;
  private offered: string[] = [];

  constructor(
    scene: Phaser.Scene,
    private bus: EventBus
  ) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setVisible(false);
    this.setDepth(60000);

    // The authored 2560x1600 space, never `scene.scale.*` — the backing is
    // LIVE_GAME_WIDTH x renderScale (Graphics setting), cameras zoom to compensate.
    const cx = LIVE_GAME_WIDTH / 2;
    const cy = LIVE_GAME_HEIGHT / 2;
    // No tap-outside-to-close: naming is not dismissible. The dragon is waiting.
    const dim = scene.add
      .rectangle(cx, cy, LIVE_GAME_WIDTH * 2, LIVE_GAME_HEIGHT * 2, num(PALETTE.night), 0.7)
      .setInteractive();

    const body = scene.add.container(cx, cy).setScale(panelMobileScale(FRAME_W));
    const frame = scene.add.graphics();
    frame.fillStyle(num(PALETTE.plum), 0.98);
    frame.fillRoundedRect(-FRAME_W / 2, -FRAME_H / 2, FRAME_W, FRAME_H, 46);
    frame.lineStyle(9, num(PALETTE.gold), 1);
    frame.strokeRoundedRect(-FRAME_W / 2, -FRAME_H / 2, FRAME_W, FRAME_H, 46);

    const title = scene.add
      .text(0, -FRAME_H / 2 + 82, 'IT IS AWAKE', {
        fontFamily: FONT.display, fontSize: '64px', fontStyle: 'bold', color: PALETTE.goldAccent
      })
      .setOrigin(0.5);
    const sub = scene.add
      .text(0, -FRAME_H / 2 + 168, 'Say it out loud. Names don’t take unless something hears them.', {
        fontFamily: FONT.display, fontSize: '34px', color: PALETTE.cream, wordWrap: { width: FRAME_W - 160 }, align: 'center'
      })
      .setOrigin(0.5)
      .setAlpha(0.92);

    // THE FIELD. A picker alone could only ever offer names we thought of; the
    // dragon is the player's, so the name has to be theirs to type. The picker
    // stays underneath it as suggestions — on a phone, tapping one is still the
    // faster path, and an empty box with no ideas in it reads as homework.
    this.fieldBg = scene.add.graphics();
    this.fieldText = scene.add
      .text(0, FIELD_Y, '', {
        fontFamily: FONT.display,
        fontSize: '46px',
        fontStyle: 'bold',
        color: PALETTE.cream
      })
      .setOrigin(0.5);
    this.caret = scene.add
      .text(0, FIELD_Y, '|', {
        fontFamily: FONT.display,
        fontSize: '46px',
        fontStyle: 'bold',
        color: PALETTE.goldAccent
      })
      .setOrigin(0, 0.5);
    scene.tweens.add({
      targets: this.caret,
      alpha: { from: 1, to: 0 },
      duration: 520,
      yoyo: true,
      repeat: -1
    });
    // The field is tappable so a phone can re-open its keyboard after a dismiss.
    this.fieldZone = scene.add
      .zone(0, FIELD_Y, FIELD_W, FIELD_H)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.fieldZone.on('pointerup', () => this.nameInput?.focus());

    this.optionRow = scene.add.container(0, OPTIONS_Y);

    const reroll = scene.add
      .text(0, 196, '↺  Other suggestions', {
        fontFamily: FONT.display, fontSize: '34px', fontStyle: 'bold', color: PALETTE.goldAccent
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    reroll.on('pointerup', () => this.offer());

    // Smaller than it was: this plate is one line of a card, not the card.
    this.confirmBtn = scene.add.image(0, 288, 'ui_btn_green').setScale(1.18);
    this.confirmLabel = scene.add
      .text(0, 284, 'Choose a name', {
        // `ui_btn_green` is painted with the CREAM plate tone, so its ink is the
        // dark plate ink. Cream-on-cream was unreadable.
        fontFamily: FONT.display, fontSize: '40px', fontStyle: 'bold', color: PALETTE.night
      })
      .setOrigin(0.5);
    this.confirmBtn.setInteractive({ useHandCursor: true });
    this.confirmBtn.on('pointerup', () => this.confirm());

    body.add([
      frame, title, sub,
      this.fieldBg, this.fieldText, this.caret, this.fieldZone,
      this.optionRow, reroll, this.confirmBtn, this.confirmLabel
    ]);
    this.paintField();
    this.add([dim, body]);

    uiRegistry.register(scene, 'panel.naming', 'Naming prompt', 'Panels', this, { frame, title });

    // RELEASED ON DESTROY, like every other panel's — and this one had not been.
    //
    // UIScene is stopped and created again on the route Reset → Title → Play, and
    // a subscription outlives the object it was made for: the destroyed panel
    // stayed on the bus, was called FIRST (it subscribed first), and threw on its
    // own dead `scene`. The bus is synchronous, so that throw ended the emit — the
    // LIVE panel never heard the request, and the naming beat, whose gate is the
    // name, could not be answered at all. One leak, one unwinnable save.
    this.offBus.push(
      this.bus.on('nest:hatched', ({ companionId, chain }) =>
        this.open({ kind: 'companion', id: companionId }, chain)
      ),
      // A dragon that hatched on the BOARD — Chapter One has no nest, so this is
      // the only naming the opening ever reaches.
      this.bus.on('ui:name_dragon_requested', ({ itemId }) =>
        this.open({ kind: 'board', id: itemId }, this.chainOf(itemId))
      )
    );
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      for (const off of this.offBus) off();
      this.offBus = [];
    });
  }

  /** Which name pool to draw from. The requester passes only an item id, so the
   *  breed is read back off the board — and any unknown breed falls through to
   *  the ember pool rather than offering nothing. */
  private chainOf(itemId: number): string {
    return this.resolveChain?.(itemId) ?? 'ember_dragon';
  }

  /** Set by UIScene: item id → chain. Kept as a hook rather than a GameState
   *  reference so the panel stays a pure view. */
  resolveChain: ((itemId: number) => string | undefined) | undefined;

  private open(subject: { kind: 'companion'; id: string } | { kind: 'board'; id: number }, chain: string): void {
    this.subject = subject;
    this.chain = chain;
    this.chosen = '';
    this.isOpen = true;
    // ON SCREEN FIRST, and only then the typing apparatus.
    //
    // The panel is not dismissible and the step it serves gates on a name being
    // chosen, so anything that can fail while opening it must fail AFTER it is
    // visible — otherwise the beat has no way forward at all. The suggestion
    // cards alone are a complete way to name a dragon; the hidden `<input>` is
    // an enhancement on top, and it is allowed to be unavailable (a browser that
    // refuses `focus()`, a headless run with no `document`).
    this.setVisible(true);
    this.setAlpha(0);
    this.scene.tweens.add({ targets: this, alpha: 1, duration: TIMINGS.bubbleIn, ease: 'Sine.easeOut' });
    this.offer();
    this.paintField();
    try {
      this.openInput();
    } catch (err) {
      console.error('[naming] text entry unavailable — the picker still works', err);
    }
  }

  /** Three fresh candidates, never repeating what is already on screen. */
  private offer(): void {
    const pool = (NAMES[this.chain] ?? NAMES.ember_dragon)!.filter((n) => !this.offered.includes(n));
    const source = pool.length >= 3 ? pool : (NAMES[this.chain] ?? NAMES.ember_dragon)!;
    const picks: string[] = [];
    while (picks.length < 3) {
      const n = source[Math.floor(Math.random() * source.length)]!;
      if (!picks.includes(n)) picks.push(n);
    }
    this.offered = picks;
    this.paintOptions(picks);
    // Re-rolling only changes the SUGGESTIONS. A name already in the field is
    // the player's own and survives — wiping it would punish them for looking.
    if (!this.chosen) this.confirmLabel.setText('Choose a name');
  }

  /** Build (once) and focus the hidden input the field is fed from. */
  private openInput(): void {
    if (!this.nameInput) {
      const el = document.createElement('input');
      el.type = 'text';
      el.maxLength = NAME_MAX;
      el.autocomplete = 'off';
      // A soft keyboard's PREDICTION is what put a space on the end of every
      // name: accepting a suggested word appends one, and the field is fed
      // straight from this element. Turning the three off is the fix at the
      // source; `onTyped` still normalises, because a paste can carry anything.
      el.autocapitalize = 'words';
      el.setAttribute('autocorrect', 'off');
      el.spellcheck = false;
      el.setAttribute('aria-label', 'Dragon name');
      // Off-screen but focusable — NOT `display:none` or `visibility:hidden`,
      // which make an element unfocusable and kill the mobile keyboard. The
      // 16px font size is what stops iOS zooming the page on focus.
      Object.assign(el.style, {
        position: 'fixed',
        left: '0px',
        top: '0px',
        width: '1px',
        height: '1px',
        opacity: '0',
        border: '0',
        padding: '0',
        fontSize: '16px',
        zIndex: '-1'
      } as Partial<CSSStyleDeclaration>);
      el.addEventListener('input', () => this.onTyped());
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.confirm();
      });
      document.body.appendChild(el);
      this.nameInput = el;
      // The element lives on `document.body`, outside Phaser's display list, so
      // nothing else will ever clean it up — a scene restart (world travel, a
      // reset) would otherwise leave a focusable orphan behind on every reboot.
      this.once(Phaser.GameObjects.Events.DESTROY, () => {
        el.remove();
        this.nameInput = null;
      });
    }
    this.nameInput.value = '';
    this.nameInput.focus();
  }

  private onTyped(): void {
    // Only what a name may contain: letters, spaces and the apostrophe/hyphen a
    // real name uses. Anything else is dropped as it is typed rather than
    // rejected at the end, so the field never shows something it will not take.
    // Two passes. The first drops anything a name may not contain; the second
    // collapses runs of spaces and refuses a LEADING one, so the field can
    // never hold "  Bl  aze". A TRAILING space survives this on purpose —
    // stripping it as you type makes it impossible to type a two-word name,
    // because the space between the words is trailing until the next letter
    // lands. It is trimmed at the point it stops being an edit and becomes a
    // name (`chosen`, below), which is the only place it matters.
    const cleaned = (this.nameInput?.value ?? '')
      .replace(/[^\p{L}\p{M}' -]/gu, '')
      .replace(/ {2,}/g, ' ')
      .replace(/^ +/, '')
      .slice(0, NAME_MAX);
    if (this.nameInput && this.nameInput.value !== cleaned) this.nameInput.value = cleaned;
    this.chosen = cleaned.trim();
    this.paintField();
    this.clearOptionHighlight();
    this.confirmLabel.setText(this.chosen ? `Name her ${this.chosen}` : 'Choose a name');
  }

  /** Redraw the plate, the typed name and the caret sitting after it. */
  private paintField(): void {
    this.fieldBg.clear();
    this.fieldBg.fillStyle(num(PALETTE.plumShade), 1);
    this.fieldBg.fillRoundedRect(-FIELD_W / 2, FIELD_Y - FIELD_H / 2, FIELD_W, FIELD_H, 24);
    this.fieldBg.lineStyle(5, num(this.chosen ? PALETTE.goldAccent : PALETTE.goldShade), 1);
    this.fieldBg.strokeRoundedRect(-FIELD_W / 2, FIELD_Y - FIELD_H / 2, FIELD_W, FIELD_H, 24);

    this.fieldText.setText(this.chosen || 'Type a name…');
    this.fieldText.setColor(this.chosen ? PALETTE.cream : PALETTE.ash);
    this.caret.setX(this.fieldText.x + this.fieldText.width / 2 + 8);
    this.caret.setVisible(this.isOpen);
  }

  /** Drop the selected ring from every suggestion card — used when the player
   *  starts typing instead, so two things never look chosen at once. */
  private clearOptionHighlight(): void {
    this.optionRow.each((c: Phaser.GameObjects.GameObject) => {
      const card = c as Phaser.GameObjects.Container;
      const g = card.list[0] as Phaser.GameObjects.Graphics;
      const label = card.list[1] as Phaser.GameObjects.Text;
      this.paintCard(g, false);
      label.setColor(PALETTE.cream);
    });
  }

  private paintCard(g: Phaser.GameObjects.Graphics, on: boolean): void {
    const w = CARD_W;
    g.clear();
    g.fillStyle(num(on ? PALETTE.gold : PALETTE.plumShade), 1);
    g.fillRoundedRect(-w / 2, -CARD_H / 2, w, CARD_H, 22);
    g.lineStyle(6, num(on ? PALETTE.goldAccent : PALETTE.gold), 1);
    g.strokeRoundedRect(-w / 2, -CARD_H / 2, w, CARD_H, 22);
  }

  private paintOptions(names: string[]): void {
    this.optionRow.removeAll(true);
    const gap = 28;
    const total = names.length * CARD_W + (names.length - 1) * gap;
    names.forEach((name, i) => {
      const x = -total / 2 + CARD_W / 2 + i * (CARD_W + gap);
      const card = this.scene.add.container(x, 0);
      const g = this.scene.add.graphics();
      this.paintCard(g, false);
      const label = this.scene.add
        .text(0, 0, name, {
          fontFamily: FONT.display, fontSize: '40px', fontStyle: 'bold', color: PALETTE.cream
        })
        .setOrigin(0.5);
      card.add([g, label]);
      card.setSize(CARD_W, CARD_H);
      card.setInteractive({ useHandCursor: true });
      // A suggestion FILLS THE FIELD rather than being a separate answer — one
      // place holds the name, so the panel can never show a typed name and a
      // picked one disagreeing about which is about to be used.
      card.on('pointerup', () => {
        if (this.nameInput) this.nameInput.value = name;
        this.chosen = name;
        this.paintField();
        this.confirmLabel.setText(`Name her ${name}`);
        this.clearOptionHighlight();
        this.paintCard(g, true);
        label.setColor(PALETTE.night);
      });
      this.optionRow.add(card);
    });
  }

  private confirm(): void {
    if (!this.chosen || !this.subject) return; // inert until a name exists
    this.nameInput?.blur();
    if (this.subject.kind === 'companion') {
      this.bus.emit('ui:companion_named', { companionId: this.subject.id, name: this.chosen });
    } else {
      this.bus.emit('ui:dragon_named', { itemId: this.subject.id, name: this.chosen });
    }
    this.isOpen = false;
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      duration: TIMINGS.bubbleIn,
      ease: 'Sine.easeIn',
      onComplete: () => this.setVisible(false)
    });
  }
}
