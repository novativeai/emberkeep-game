import Phaser from 'phaser';
import { GAME_WIDTH, num, PALETTE } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { QuestState } from '../core/types';

const FONT = 'Trebuchet MS, Verdana, sans-serif';
const RIGHT_X = GAME_WIDTH - 40; // panel right edge
const PANEL_TOP = 196; // below the gear row
const TOGGLE_X = GAME_WIDTH - 236; // LEFT of the top-right gear
const TOGGLE_Y = 104;
const GOLD = 0xffd84d; // completed MAIN quest
const PLATINUM = 0xd8dde3; // completed SIDE quest
const PARCH = 0xfff6e8; // cream parchment (Cookbook theme)
const PARCH_BORDER = 0xe8b98f; // tan stitch border
const BROWN = '#B5602F'; // PALETTE.textBrown

const PANEL_W = 560;
const HEAD_H = 118; // title row + tab bar
const TAB_Y = 82; // tab-pill centre
const TAB_H = 44;
const TAB_GAP = 12;

type TabKey = 'main' | 'sub';

interface Tab {
  key: TabKey;
  bg: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  x: number;
  w: number;
}

type VisibleObject = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Visible;

interface Row {
  main: boolean;
  accent: number;
  objects: VisibleObject[];
  bullet: Phaser.GameObjects.Graphics;
  title: Phaser.GameObjects.Text;
  strike: Phaser.GameObjects.Graphics;
  image?: Phaser.GameObjects.Image;
}

/**
 * The objective tracker: a COLLAPSED quest-log button (a paper-with-lines icon,
 * top-right, clear of the gear). Tap it to open a Cookbook-themed PARCHMENT panel
 * with a two-tab navbar — PRINCIPALE (main quests, Red Dragon peeking) and
 * SECONDAIRE (the tutorial-step checklist) — each row struck through + recoloured
 * on completion (MAIN gold / SIDE platinum). A tap anywhere off the panel closes
 * it. Pure subscriber (`quest:changed`).
 */
export class QuestPanel {
  private toggle: Phaser.GameObjects.Container;
  private toggleIcon: Phaser.GameObjects.Graphics;
  private badge: Phaser.GameObjects.Text;
  private cardsRoot: Phaser.GameObjects.Container;
  private panel: Phaser.GameObjects.Container;
  private panelBg: Phaser.GameObjects.Graphics;
  private rows = new Map<string, Row>();
  private done = new Map<string, boolean>();
  private tab: TabKey = 'main';
  private tabs: Tab[] = [];
  private open = false;
  private built = false;
  private panelH = 0;
  private headerBuilt = false;
  private lastCounts = { done: 0, total: 0 };
  private offBus: () => void;

  constructor(
    private scene: Phaser.Scene,
    bus: EventBus
  ) {
    this.cardsRoot = scene.add.container(0, 0).setVisible(false);
    this.panelBg = scene.add.graphics();
    this.panel = scene.add.container(0, PANEL_TOP, [this.panelBg]);
    this.cardsRoot.add(this.panel);

    this.toggleIcon = scene.add.graphics();
    this.badge = scene.add
      .text(38, -38, '', { fontFamily: FONT, fontSize: '26px', fontStyle: 'bold', color: '#17131f', backgroundColor: '#ffd84d', padding: { x: 8, y: 2 } })
      .setOrigin(0.5);
    this.toggle = scene.add.container(TOGGLE_X, TOGGLE_Y, [this.toggleIcon, this.badge]);
    // A centred custom hit-rect gets displaced by the container's displayOrigin
    // (the CLAUDE.md gotcha) → the clickable zone drifts up-left of the icon, which
    // is why it read as "hard to click". Use the size-derived hit area like the HUD
    // buttons (setSize + setInteractive), which stays centred + forgiving.
    this.toggle.setSize(168, 168);
    this.toggle.setInteractive({ useHandCursor: true });
    this.toggle.on('pointerover', () => this.toggle.setScale(1.06));
    this.toggle.on('pointerout', () => this.toggle.setScale(1));
    this.toggle.on('pointerup', () => this.setOpen(!this.open));
    this.drawToggle(0, 0);

    // Tap anywhere off the panel (and off the toggle, which owns its own tap) closes
    // the open list — so you don't have to hit the toggle a second time to dismiss it.
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onScenePointerDown, this);

    this.offBus = bus.on('quest:changed', ({ quests }) => this.render(quests));
  }

  private onScenePointerDown(p: Phaser.Input.Pointer): void {
    if (!this.open) return;
    const x = p.worldX;
    const y = p.worldY;
    if (this.panel.getBounds().contains(x, y)) return; // inside the list (rows/tabs) — keep it
    if (this.toggle.getBounds().contains(x, y)) return; // the toggle handles its own tap
    this.setOpen(false);
  }

  /**
   * Show or hide the WHOLE tracker — the toggle button, its badge and any open
   * card stack. The system underneath keeps running: quests still complete, the
   * tutorial's sub-quests still tick, the panel is simply not on screen.
   * Returns `this` so the caller can chain it like a game object.
   */
  setVisible(v: boolean): this {
    this.toggle.setVisible(v);
    this.toggle.input!.enabled = v;
    if (!v) this.setOpen(false);
    return this;
  }

  private setOpen(v: boolean): void {
    this.open = v;
    this.cardsRoot.setVisible(v);
    this.drawToggle(this.lastCounts.done, this.lastCounts.total);
  }

  private setTab(key: TabKey): void {
    if (this.tab === key) return;
    this.tab = key;
    this.layout();
  }

  /** The paper/list quest-log icon (a page + folded corner + ruled lines, one per
   *  quest, gold-checked when done). Highlights while open. */
  private drawToggle(doneN: number, total: number): void {
    const g = this.toggleIcon;
    g.clear();
    const r = 54;
    g.fillStyle(num(PALETTE.night), 0.92);
    g.fillCircle(0, 0, r);
    g.lineStyle(3, this.open ? GOLD : 0x8a7f9d, this.open ? 0.95 : 0.7);
    g.strokeCircle(0, 0, r);
    const pw = 46;
    const ph = 56;
    const px = -pw / 2;
    const py = -ph / 2;
    const fold = 14;
    g.fillStyle(0xf3ecd8, 1);
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px + pw - fold, py);
    g.lineTo(px + pw, py + fold);
    g.lineTo(px + pw, py + ph);
    g.lineTo(px, py + ph);
    g.closePath();
    g.fillPath();
    g.lineStyle(3, 0x9a5a1e, 0.9);
    g.strokePath();
    g.fillStyle(0xd9c9a3, 1);
    g.fillTriangle(px + pw - fold, py, px + pw, py + fold, px + pw - fold, py + fold);
    // Decorative ruled lines — CAPPED so they stay INSIDE the page (16 quests used to
    // spill a long tail of dashes below the icon). At most 4 rows fit the 56px page.
    const lines = Math.min(4, Math.max(2, total));
    for (let i = 0; i < lines; i++) {
      const ly = py + 16 + i * 12;
      const complete = doneN >= total ? true : i < Math.round((doneN / Math.max(1, total)) * lines);
      g.lineStyle(3, complete ? GOLD : 0x8a7f9d, complete ? 1 : 0.8);
      g.lineBetween(px + 8, ly, px + pw - 8, ly);
    }
  }

  /** A row bullet: a scroll (main) or a small ring (sub), turning into a ✓ when done. */
  private drawBullet(g: Phaser.GameObjects.Graphics, done: boolean, accent: number, big = true): void {
    g.clear();
    if (!big) {
      // Compact sub-quest bullet: ring ○ → green check ✓.
      if (done) {
        g.lineStyle(5, num(PALETTE.moss), 1);
        g.beginPath();
        g.moveTo(-8, 0);
        g.lineTo(-2, 7);
        g.lineTo(10, -9);
        g.strokePath();
      } else {
        g.lineStyle(3, num(PALETTE.gold), 0.85);
        g.strokeCircle(0, 0, 11);
      }
      return;
    }
    if (done) {
      g.lineStyle(7, accent, 1);
      g.beginPath();
      g.moveTo(-13, 0);
      g.lineTo(-4, 11);
      g.lineTo(15, -13);
      g.strokePath();
      return;
    }
    g.lineStyle(4, num(PALETTE.gold), 0.95);
    g.strokeRoundedRect(-13, -16, 26, 32, 6);
    g.lineStyle(3, num(PALETTE.gold), 0.7);
    for (let i = -7; i <= 7; i += 7) g.lineBetween(-8, i, 8, i);
  }

  /** Build the header (title + the Principale/Secondaire tab pills) once. */
  private buildHeader(): void {
    if (this.headerBuilt) return;
    this.headerBuilt = true;
    const icon = this.scene.add.graphics().setPosition(44, 36);
    this.drawBullet(icon, false, GOLD);
    const title = this.scene.add
      .text(80, 36, 'QUÊTES', { fontFamily: FONT, fontSize: '26px', fontStyle: 'bold', color: '#9A5A1E' })
      .setOrigin(0, 0.5);
    this.panel.add([icon, title]);

    const defs: { key: TabKey; text: string }[] = [
      { key: 'main', text: 'Principale' },
      { key: 'sub', text: 'Secondaire' }
    ];
    const tabW = (PANEL_W - 48 - TAB_GAP) / 2;
    defs.forEach((d, i) => {
      const x = 24 + i * (tabW + TAB_GAP);
      const bg = this.scene.add.graphics();
      const label = this.scene.add
        .text(x + tabW / 2, TAB_Y, d.text, { fontFamily: FONT, fontSize: '19px', fontStyle: 'bold', color: BROWN })
        .setOrigin(0.5);
      // A hit rect on the pill; the label rides on top.
      bg.setInteractive(new Phaser.Geom.Rectangle(x, TAB_Y - TAB_H / 2, tabW, TAB_H), Phaser.Geom.Rectangle.Contains);
      bg.on('pointerup', () => this.setTab(d.key));
      this.panel.add([bg, label]);
      this.tabs.push({ key: d.key, bg, label, x, w: tabW });
    });
  }

  /** Redraw the tab pills: the active one filled gold, each with its remaining count. */
  private paintTabs(quests: QuestState[]): void {
    for (const t of this.tabs) {
      const list = quests.filter((q) => (q.kind === 'main') === (t.key === 'main'));
      const remaining = list.filter((q) => !q.done).length;
      const active = this.tab === t.key;
      const g = t.bg;
      g.clear();
      g.fillStyle(active ? num(PALETTE.gold) : 0xf3ead4, active ? 1 : 0.9);
      g.fillRoundedRect(t.x, TAB_Y - TAB_H / 2, t.w, TAB_H, 12);
      g.lineStyle(2, PARCH_BORDER, active ? 1 : 0.7);
      g.strokeRoundedRect(t.x, TAB_Y - TAB_H / 2, t.w, TAB_H, 12);
      const base = t.key === 'main' ? 'Principale' : 'Secondaire';
      t.label.setText(remaining > 0 ? `${base} · ${remaining}` : `${base} ✓`);
      t.label.setColor(active ? '#5c2e10' : '#9A7048');
    }
  }

  /** Create every row object once (mains + subs). Positions come later, in layout(). */
  private build(quests: QuestState[]): void {
    quests.forEach((q) => {
      const main = q.kind === 'main';
      const accent = main ? GOLD : PLATINUM;
      const bullet = this.scene.add.graphics();
      const title = this.scene.add
        .text(0, 0, q.title, {
          fontFamily: FONT,
          fontSize: main ? '27px' : '20px',
          fontStyle: 'bold',
          color: BROWN,
          wordWrap: { width: main ? 360 : 440 }
        })
        .setOrigin(0, 0.5);
      const strike = this.scene.add.graphics();
      const objects: VisibleObject[] = [bullet, title, strike];
      let image: Phaser.GameObjects.Image | undefined;
      if (main && q.image && this.scene.textures.exists(q.image)) {
        image = this.scene.add.image(0, 0, q.image).setDisplaySize(84, 84).setOrigin(0.5);
        objects.push(image);
      }
      this.panel.add(objects);
      this.rows.set(q.id, { main, accent, objects, bullet, title, strike, image });
    });
    this.built = true;
  }

  /** Lay out only the ACTIVE tab's rows top-to-bottom; hide the rest; size the frame. */
  private layout(): void {
    let y = HEAD_H;
    let shown = 0;
    for (const [id, r] of this.rows) {
      const visible = r.main === (this.tab === 'main');
      r.objects.forEach((o) => o.setVisible(visible));
      if (!visible) continue;
      shown++;
      const h = r.main ? 92 : 44;
      const cy = y + h / 2;
      if (r.main) {
        r.bullet.setPosition(46, cy);
        r.title.setPosition(90, cy);
        r.image?.setPosition(PANEL_W - 58, cy);
      } else {
        r.bullet.setPosition(48, cy);
        r.title.setPosition(78, cy);
      }
      this.paintRow(r, this.done.get(id) ?? false); // re-anchors the strike at the new x
      y += h;
    }
    if (shown === 0) y += 40; // room for the "nothing here" case (rare)
    this.panelH = y + 16;
    this.paintFrame();
  }

  /** Draw the parchment frame (cream fill + tan stitch border + gold hairline + a
   *  header divider under the tab bar). */
  private paintFrame(): void {
    const g = this.panelBg;
    const H = this.panelH;
    g.clear();
    g.fillStyle(PARCH, 0.98);
    g.fillRoundedRect(0, 0, PANEL_W, H, 20);
    g.lineStyle(6, PARCH_BORDER, 1);
    g.strokeRoundedRect(0, 0, PANEL_W, H, 20);
    g.lineStyle(2, num(PALETTE.gold), 0.5);
    g.strokeRoundedRect(8, 8, PANEL_W - 16, H - 16, 14);
    g.lineStyle(3, PARCH_BORDER, 0.9);
    g.lineBetween(24, HEAD_H - 8, PANEL_W - 24, HEAD_H - 8);
  }

  private hex(n: number): string {
    return '#' + n.toString(16).padStart(6, '0');
  }

  /** Update one row's done styling (strike + recolour + dim + bullet check). */
  private paintRow(r: Row, done: boolean): void {
    this.drawBullet(r.bullet, done, r.accent, r.main);
    r.title.setColor(done ? this.hex(r.accent === GOLD ? 0xb07a1e : 0x8a8f96) : BROWN);
    r.title.setAlpha(done ? 0.85 : 1);
    r.strike.clear();
    if (done) {
      r.strike.lineStyle(r.main ? 6 : 4, r.accent === GOLD ? 0xd9a521 : 0x9aa0a8, 1);
      r.strike.lineBetween(r.title.x - 4, r.title.y, r.title.x + r.title.width + 8, r.title.y);
    }
  }

  /** Completion beat: recolour + a strikethrough that grows left→right + a pop. */
  private celebrate(r: Row): void {
    this.paintRow(r, true);
    if (!r.title.visible) return; // struck off-screen (other tab) — no animation needed
    const y0 = r.title.y;
    const x0 = r.title.x - 4;
    const x1 = r.title.x + r.title.width + 8;
    const p = { t: 0 };
    const strikeCol = r.accent === GOLD ? 0xd9a521 : 0x9aa0a8;
    this.scene.tweens.add({
      targets: p,
      t: 1,
      duration: 440,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        r.strike.clear();
        r.strike.lineStyle(r.main ? 6 : 4, strikeCol, 1);
        r.strike.lineBetween(x0, y0, x0 + (x1 - x0) * p.t, y0);
      }
    });
    this.scene.tweens.add({ targets: this.toggle, scaleX: 1.18, scaleY: 1.18, duration: 160, yoyo: true, ease: 'Sine.easeInOut' });
  }

  private render(quests: QuestState[]): void {
    if (!this.built) {
      this.buildHeader();
      this.build(quests);
      this.panel.setPosition(RIGHT_X - PANEL_W, PANEL_TOP);
      for (const q of quests) this.done.set(q.id, false);
      this.layout();
    }
    let doneN = 0;
    for (const q of quests) {
      const r = this.rows.get(q.id);
      if (!r) continue;
      const was = this.done.get(q.id) ?? false;
      if (q.done && !was) this.celebrate(r);
      else if (q.done !== was) this.paintRow(r, q.done);
      this.done.set(q.id, q.done);
      if (q.done) doneN++;
    }
    this.lastCounts = { done: doneN, total: quests.length };
    this.badge.setText(doneN >= quests.length ? '✓' : `${quests.length - doneN}`).setVisible(quests.length > 0);
    this.paintTabs(quests);
    this.drawToggle(doneN, quests.length);
  }

  setDepth(d: number): this {
    this.toggle.setDepth(d + 1);
    this.cardsRoot.setDepth(d);
    return this;
  }

  destroy(): void {
    this.offBus();
    this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onScenePointerDown, this);
    this.toggle.destroy();
    this.cardsRoot.destroy();
    this.rows.clear();
  }
}
