import Phaser from 'phaser';
import { DUEL, GAME_WIDTH, LIVE_GAME_HEIGHT, num, PALETTE } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { DuelDragon, DuelThrow, EventMap } from '../core/types';

const MOVES: DuelThrow[] = ['rock', 'paper', 'scissors'];
const MOVE_LABELS = ['ROCK', 'PAPER', 'SCISSORS'];

const FONT = 'Trebuchet MS, Verdana, sans-serif';
const PW = 1560;
const PH = 1160;
const SLOTS = 4; // 2 real dragons + 2 "coming soon" placeholders
const SLOT_W = 320;
const SLOT_H = 500;
const THROW = 240;

interface Slot {
  root: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  img: Phaser.GameObjects.Image;
  name: Phaser.GameObjects.Text;
  lv: Phaser.GameObjects.Text;
  gauge: Phaser.GameObjects.Graphics;
  gaugeText: Phaser.GameObjects.Text;
  zone: Phaser.GameObjects.Zone;
  chain: string | null;
}

/**
 * The Dragon-Duel arena — a big centred modal in Cindra's-Ledger style (cream
 * board, warm-red frame, title lozenge). Two views: SELECT (pick a dragon from
 * the roster + placeholder slots, then LANCER for 2⚡) and BATTLE (a 3-2-1
 * countdown, then `matchesPerSet` auto rock-paper-scissors reveals; a win bounces
 * your hand and flies "+N" into that dragon's gauge; after the set → REJOUER).
 * The panel only drives timing/animation — all resolution is DragonDuelSystem.
 */
export class DuelPanel extends Phaser.GameObjects.Container {
  isOpen = false;
  private offBus: Array<() => void> = [];
  private timers: Phaser.Time.TimerEvent[] = [];

  private dim: Phaser.GameObjects.Rectangle;
  private selectView: Phaser.GameObjects.Container;
  private battleView: Phaser.GameObjects.Container;
  private slots: Slot[] = [];
  private lancer!: Phaser.GameObjects.Container;
  private lancerLabel!: Phaser.GameObjects.Text;
  private prompt!: Phaser.GameObjects.Text;

  // battle view
  private bTitle!: Phaser.GameObjects.Text;
  private bGauge!: Phaser.GameObjects.Graphics;
  private bGaugeText!: Phaser.GameObjects.Text;
  private playerImg!: Phaser.GameObjects.Image;
  private oppImg!: Phaser.GameObjects.Image;
  private vs!: Phaser.GameObjects.Text;
  private countText!: Phaser.GameObjects.Text;
  private result!: Phaser.GameObjects.Text;
  private matchCounter!: Phaser.GameObjects.Text;
  private replay!: Phaser.GameObjects.Container;
  private replayLabel!: Phaser.GameObjects.Text;
  private back!: Phaser.GameObjects.Text;
  private instruction!: Phaser.GameObjects.Text;
  private choiceRoot!: Phaser.GameObjects.Container;
  private choiceImgs: Phaser.GameObjects.Image[] = [];

  private lastState?: EventMap['duel:changed'];
  private selected: string | null = null;
  private matchesLeft = 0;
  private battleName = '';
  private battleColor = 'red';
  private choosing = false;

  constructor(scene: Phaser.Scene, private bus: EventBus) {
    super(scene, GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2);

    this.dim = scene.add
      .rectangle(0, 0, GAME_WIDTH, LIVE_GAME_HEIGHT * 2, num(PALETTE.night), 0.5)
      .setInteractive();
    this.dim.on('pointerup', () => this.requestClose());

    const board = scene.add.graphics();
    this.drawBoard(board);

    // Title lozenge + close.
    const titleBg = scene.add.graphics();
    titleBg.fillStyle(num(PALETTE.lava), 1);
    titleBg.fillRoundedRect(-430, -PH / 2 - 30, 860, 128, 64);
    titleBg.lineStyle(7, num(PALETTE.cream), 0.95);
    titleBg.strokeRoundedRect(-430, -PH / 2 - 30, 860, 128, 64);
    const title = scene.add
      .text(0, -PH / 2 + 34, '⚔️  DRAGON ARENA', {
        fontFamily: FONT, fontSize: '58px', fontStyle: 'bold', color: PALETTE.cream
      })
      .setOrigin(0.5)
      .setShadow(0, 4, 'rgba(36,27,34,0.5)', 6);
    const close = scene.add.container(PW / 2 - 58, -PH / 2 + 44);
    const closeBg = scene.add.circle(0, 0, 46, num(PALETTE.lava)).setStrokeStyle(6, num(PALETTE.cream));
    const closeX = scene.add.text(0, -2, '✕', { fontFamily: FONT, fontSize: '48px', fontStyle: 'bold', color: PALETTE.cream }).setOrigin(0.5);
    close.add([closeBg, closeX]).setSize(96, 96).setInteractive({ useHandCursor: true });
    close.on('pointerup', () => this.requestClose());

    this.selectView = scene.add.container(0, 0);
    this.battleView = scene.add.container(0, 0).setVisible(false);
    this.buildSelect(scene);
    this.buildBattle(scene);

    this.add([this.dim, board, titleBg, title, close, this.selectView, this.battleView]);
    scene.add.existing(this);
    this.setVisible(false);

    this.offBus.push(bus.on('duel:changed', (m) => this.onChanged(m)));
    this.offBus.push(bus.on('duel:set_started', (m) => this.onSetStarted(m)));
    this.offBus.push(bus.on('duel:match', (m) => this.onMatch(m)));
    this.offBus.push(bus.on('duel:start_failed', (m) => this.onStartFailed(m)));
  }

  private drawBoard(g: Phaser.GameObjects.Graphics): void {
    g.fillStyle(num(PALETTE.lavaShade), 1);
    g.fillRoundedRect(-PW / 2 - 6, -PH / 2 + 10, PW + 12, PH, 44);
    g.fillStyle(num(PALETTE.lava), 1);
    g.fillRoundedRect(-PW / 2, -PH / 2, PW, PH, 40);
    g.fillStyle(num(PALETTE.cream), 1);
    g.fillRoundedRect(-PW / 2 + 18, -PH / 2 + 18, PW - 36, PH - 36, 28);
    g.lineStyle(3, num(PALETTE.goldShade), 0.5);
    g.strokeRoundedRect(-PW / 2 + 18, -PH / 2 + 18, PW - 36, PH - 36, 28);
  }

  /** A glossy green action button (ui_btn_green) with a label + hit zone. */
  private greenButton(scene: Phaser.Scene, x: number, y: number, w: number, h: number, text: string): { root: Phaser.GameObjects.Container; label: Phaser.GameObjects.Text; zone: Phaser.GameObjects.Zone } {
    const root = scene.add.container(x, y);
    const img = scene.add.image(0, 0, 'ui_btn_green').setDisplaySize(w, h);
    const label = scene.add.text(0, -2, text, { fontFamily: FONT, fontSize: '46px', fontStyle: 'bold', color: '#FFFFFF' }).setOrigin(0.5).setShadow(0, 4, 'rgba(36,27,34,0.5)', 6);
    const zone = scene.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
    root.add([img, label, zone]);
    return { root, label, zone };
  }

  private buildSelect(scene: Phaser.Scene): void {
    this.prompt = scene.add
      .text(0, -PH / 2 + 190, 'Which dragon do you want to train?', {
        fontFamily: FONT, fontSize: '44px', fontStyle: 'bold', color: PALETTE.textBrown
      })
      .setOrigin(0.5);

    const startX = -((SLOTS - 1) * (SLOT_W + 24)) / 2;
    for (let i = 0; i < SLOTS; i++) {
      const x = startX + i * (SLOT_W + 24);
      const root = scene.add.container(x, 40);
      const bg = scene.add.graphics();
      const img = scene.add.image(0, -SLOT_H / 2 + 150, '__DEFAULT').setDisplaySize(200, 200);
      const name = scene.add.text(0, 30, '', { fontFamily: FONT, fontSize: '34px', fontStyle: 'bold', color: PALETTE.textBrown }).setOrigin(0.5);
      const lv = scene.add.text(0, 84, '', { fontFamily: FONT, fontSize: '30px', fontStyle: 'bold', color: PALETTE.lavaShade }).setOrigin(0.5);
      const gauge = scene.add.graphics();
      const gaugeText = scene.add.text(0, SLOT_H / 2 - 70, '', { fontFamily: FONT, fontSize: '26px', fontStyle: 'bold', color: PALETTE.cream, stroke: PALETTE.night, strokeThickness: 4 }).setOrigin(0.5);
      const zone = scene.add.zone(0, 0, SLOT_W, SLOT_H).setInteractive({ useHandCursor: true });
      zone.on('pointerup', () => { const s = this.slots[i]; if (s?.chain) this.bus.emit('duel:choose', { chain: s.chain }); });
      root.add([bg, img, name, lv, gauge, gaugeText, zone]);
      this.selectView.add(root);
      this.slots.push({ root, bg, img, name, lv, gauge, gaugeText, zone, chain: null });
    }

    const btn = this.greenButton(scene, 0, PH / 2 - 120, 460, 150, `⚔️ PLAY  (${DUEL.energyCost}⚡)`);
    this.lancer = btn.root;
    this.lancerLabel = btn.label;
    btn.zone.on('pointerup', () => this.bus.emit('duel:start', {}));
    this.selectView.add([this.prompt, this.lancer]);
  }

  private buildBattle(scene: Phaser.Scene): void {
    this.bTitle = scene.add.text(0, -PH / 2 + 170, '', { fontFamily: FONT, fontSize: '46px', fontStyle: 'bold', color: PALETTE.textBrown }).setOrigin(0.5);
    this.bGauge = scene.add.graphics();
    this.bGaugeText = scene.add.text(0, -PH / 2 + 264, '', { fontFamily: FONT, fontSize: '30px', fontStyle: 'bold', color: PALETTE.cream, stroke: PALETTE.night, strokeThickness: 4 }).setOrigin(0.5);
    this.matchCounter = scene.add.text(0, -PH / 2 + 340, '', { fontFamily: FONT, fontSize: '32px', fontStyle: 'bold', color: PALETTE.ashShade }).setOrigin(0.5);

    this.playerImg = scene.add.image(-360, 60, '__DEFAULT').setDisplaySize(THROW, THROW).setVisible(false);
    this.oppImg = scene.add.image(360, 60, '__DEFAULT').setDisplaySize(THROW, THROW).setVisible(false).setFlipX(true);
    this.vs = scene.add.text(0, 60, 'VS', { fontFamily: FONT, fontSize: '64px', fontStyle: 'bold', color: PALETTE.lava, stroke: PALETTE.cream, strokeThickness: 6 }).setOrigin(0.5);
    this.countText = scene.add.text(0, 60, '', { fontFamily: FONT, fontSize: '200px', fontStyle: 'bold', color: PALETTE.lava, stroke: PALETTE.cream, strokeThickness: 10 }).setOrigin(0.5).setVisible(false);
    this.result = scene.add.text(0, PH / 2 - 300, '', { fontFamily: FONT, fontSize: '56px', fontStyle: 'bold', color: PALETTE.moss }).setOrigin(0.5).setShadow(0, 3, 'rgba(36,27,34,0.4)', 5);

    const rbtn = this.greenButton(scene, -140, PH / 2 - 130, 440, 150, `REJOUER  (${DUEL.energyCost}⚡)`);
    this.replay = rbtn.root;
    this.replayLabel = rbtn.label;
    rbtn.zone.on('pointerup', () => this.bus.emit('duel:start', {}));
    this.back = scene.add.text(320, PH / 2 - 130, '← Choose', { fontFamily: FONT, fontSize: '38px', fontStyle: 'bold', color: PALETTE.textBrown }).setOrigin(0.5);
    this.back.setInteractive({ useHandCursor: true }).on('pointerup', () => this.showSelect());

    // Interactive throw picker — the player taps their hand each match.
    this.instruction = scene.add.text(0, -40, 'Choose your hand!', { fontFamily: FONT, fontSize: '44px', fontStyle: 'bold', color: PALETTE.textBrown }).setOrigin(0.5);
    this.choiceRoot = scene.add.container(0, 170);
    const cx = [-360, 0, 360];
    for (let i = 0; i < 3; i++) {
      const root = scene.add.container(cx[i], 0);
      const bg = scene.add.graphics();
      bg.fillStyle(num(PALETTE.cream), 1);
      bg.fillRoundedRect(-140, -140, 280, 280, 26);
      bg.lineStyle(6, num(PALETTE.gold), 0.9);
      bg.strokeRoundedRect(-140, -140, 280, 280, 26);
      // '__DEFAULT' placeholder — the real throw art is lazy-loaded (off boot) and
      // set in showChoices() once the duel opens; choiceRoot stays hidden until then.
      const img = scene.add.image(0, -18, '__DEFAULT').setDisplaySize(190, 190);
      const label = scene.add.text(0, 108, MOVE_LABELS[i]!, { fontFamily: FONT, fontSize: '30px', fontStyle: 'bold', color: PALETTE.textBrown }).setOrigin(0.5);
      const zone = scene.add.zone(0, 0, 280, 280).setInteractive({ useHandCursor: true });
      const move = MOVES[i]!;
      zone.on('pointerdown', () => root.setScale(0.94));
      zone.on('pointerout', () => root.setScale(1));
      zone.on('pointerup', () => { root.setScale(1); this.choose(move); });
      root.add([bg, img, label, zone]);
      this.choiceRoot.add(root);
      this.choiceImgs.push(img);
    }

    this.battleView.add([this.bTitle, this.bGauge, this.bGaugeText, this.matchCounter, this.playerImg, this.oppImg, this.vs, this.countText, this.result, this.instruction, this.choiceRoot, this.replay, this.back]);
  }

  /* ---------------------------- select view ---------------------------- */

  private renderSlots(roster: DuelDragon[]): void {
    for (let i = 0; i < SLOTS; i++) {
      const slot = this.slots[i]!;
      const d = roster[i];
      if (d && d.owned) {
        slot.chain = d.chain;
        const faceKey = `duel_face_${d.color}`;
        const key = this.scene.textures.exists(faceKey) ? faceKey : `item_${d.chain}_3`;
        if (this.scene.textures.exists(key)) slot.img.setTexture(key).setDisplaySize(200, 200).setAlpha(1);
        slot.name.setText(d.name).setColor(PALETTE.textBrown);
        slot.lv.setText(`Lv ${d.level}`).setVisible(true);
        slot.gaugeText.setVisible(true);
        this.drawSlotGauge(slot, d.gauge, this.lastState?.gaugeMax ?? DUEL.gaugeMax, this.selected === d.chain);
        slot.zone.setInteractive();
      } else {
        // Placeholder for a not-yet-obtained dragon.
        slot.chain = null;
        slot.img.setTexture('__DEFAULT').setAlpha(0);
        slot.name.setText('?').setColor(PALETTE.ash);
        slot.lv.setVisible(false);
        slot.gaugeText.setVisible(false);
        this.drawSlotCard(slot.bg, false, true);
        slot.zone.disableInteractive();
      }
    }
  }

  private drawSlotCard(g: Phaser.GameObjects.Graphics, selected: boolean, placeholder: boolean): void {
    g.clear();
    g.fillStyle(num(placeholder ? PALETTE.plumShade : PALETTE.cream), placeholder ? 0.4 : 1);
    g.fillRoundedRect(-SLOT_W / 2, -SLOT_H / 2, SLOT_W, SLOT_H, 24);
    g.lineStyle(selected ? 9 : 5, num(selected ? PALETTE.goldAccent : placeholder ? PALETTE.ashShade : PALETTE.gold), selected ? 1 : 0.7);
    g.strokeRoundedRect(-SLOT_W / 2, -SLOT_H / 2, SLOT_W, SLOT_H, 24);
  }

  private drawSlotGauge(slot: Slot, gauge: number, max: number, selected: boolean): void {
    this.drawSlotCard(slot.bg, selected, false);
    const g = slot.gauge;
    g.clear();
    const bw = SLOT_W - 60;
    const bx = -bw / 2;
    const by = SLOT_H / 2 - 108;
    g.fillStyle(num(PALETTE.night), 0.45);
    g.fillRoundedRect(bx, by, bw, 26, 13);
    const frac = Math.max(0, Math.min(1, gauge / max));
    if (frac > 0) {
      g.fillStyle(num(PALETTE.moss), 1);
      g.fillRoundedRect(bx, by, Math.max(26, bw * frac), 26, 13);
    }
    slot.gaugeText.setText(`${gauge}/${max}`);
  }

  private onChanged(m: EventMap['duel:changed']): void {
    this.lastState = m;
    this.selected = m.selected;
    this.matchesLeft = m.matchesLeft;
    if (!this.isOpen) return;
    this.renderSlots(m.roster);
    const ready = !!m.selected && m.canAfford;
    this.lancer.setAlpha(ready ? 1 : 0.5);
    this.lancerLabel.setText(m.canAfford ? `⚔️  PLAY  (${m.energyCost}⚡)` : 'Not enough  ⚡');
  }

  /* ---------------------------- battle view ---------------------------- */

  private onSetStarted(m: EventMap['duel:set_started']): void {
    this.matchesLeft = m.matches;
    this.showBattle();
    const d = this.lastState?.roster.find((r) => r.chain === m.chain);
    if (d) {
      this.battleName = d.name;
      this.battleColor = d.color;
      this.setBattleHeader(d.name, d.level, d.gauge, this.lastState?.gaugeMax ?? DUEL.gaugeMax);
    }
    this.startMatch();
  }

  private setBattleHeader(name: string, level: number, gauge: number, max: number): void {
    this.bTitle.setText(`${name}  •  Lv ${level}`);
    const g = this.bGauge;
    g.clear();
    const bw = 900;
    const bx = -bw / 2;
    const by = -PH / 2 + 236;
    g.fillStyle(num(PALETTE.night), 0.45);
    g.fillRoundedRect(bx, by, bw, 34, 17);
    const frac = Math.max(0, Math.min(1, gauge / max));
    if (frac > 0) {
      g.fillStyle(num(PALETTE.moss), 1);
      g.fillRoundedRect(bx, by, Math.max(34, bw * frac), 34, 17);
    }
    this.bGaugeText.setText(`${gauge}/${max}`);
  }

  /** Begin a match: offer the three throw choices (or end the set). */
  private startMatch(): void {
    if (this.matchesLeft <= 0) {
      this.showReplay();
      return;
    }
    this.choosing = true;
    this.playerImg.setVisible(false);
    this.oppImg.setVisible(false);
    this.vs.setVisible(false);
    this.result.setText('');
    this.replay.setVisible(false);
    this.back.setVisible(false);
    this.matchCounter.setText(`Manche ${DUEL.matchesPerSet - this.matchesLeft + 1}/${DUEL.matchesPerSet}`);
    // Paint the three choice buttons in the chosen dragon's colour.
    for (let i = 0; i < 3; i++) {
      const key = `duel_${MOVES[i]}_${this.battleColor}`;
      if (this.scene.textures.exists(key)) this.choiceImgs[i]!.setTexture(key).setDisplaySize(190, 190);
    }
    this.instruction.setVisible(true);
    this.choiceRoot.setVisible(true).setScale(1);
    this.scene.tweens.add({ targets: this.choiceRoot, scale: { from: 0.85, to: 1 }, duration: 200, ease: 'Back.easeOut' });
  }

  /** The player picked a throw — resolve this match. */
  private choose(move: DuelThrow): void {
    if (!this.choosing) return;
    this.choosing = false;
    this.instruction.setVisible(false);
    this.choiceRoot.setVisible(false);
    this.bus.emit('duel:play', { move });
  }

  private onMatch(m: EventMap['duel:match']): void {
    if (!this.isOpen) return;
    this.matchesLeft = m.matchesLeft;

    this.result.setText('');
    this.instruction.setVisible(false);
    this.choiceRoot.setVisible(false);
    this.vs.setVisible(true);
    this.revealImg(this.playerImg, `duel_${m.playerThrow}_${m.color}`, false);
    this.revealImg(this.oppImg, `duel_${m.oppThrow}_${m.oppColor}`, true);

    // React AFTER the reveal pop settles (so tweens don't fight).
    this.timer(340, () => {
      if (m.outcome === 'win') {
        this.result.setText(`GAGNÉ !  +${DUEL.winGauge}${m.leveledUp ? '  ⭐ LEVEL UP !' : ''}`).setColor(PALETTE.moss);
        this.bounce(this.playerImg);
        this.setBattleHeader(this.battleName, m.level, m.gauge, m.gaugeMax);
        this.flyXp();
      } else if (m.outcome === 'lose') {
        this.result.setText('PERDU').setColor(PALETTE.ash);
        this.bounce(this.oppImg);
      } else {
        this.result.setText('ÉGALITÉ').setColor(PALETTE.gold);
      }
    });
    this.timer(1650, () => this.startMatch());
  }

  /** Show a throw texture with a pop-in (flipX mirrors the opponent's hand). */
  private revealImg(img: Phaser.GameObjects.Image, key: string, flip: boolean): void {
    if (this.scene.textures.exists(key)) img.setTexture(key);
    img.setVisible(true).setFlipX(flip).setDisplaySize(THROW, THROW);
    const bx = img.scaleX;
    const by = img.scaleY;
    img.scaleX = bx * 0.4;
    img.scaleY = by * 0.4;
    this.scene.tweens.add({ targets: img, scaleX: bx, scaleY: by, duration: 220, ease: 'Back.easeOut' });
  }

  private bounce(img: Phaser.GameObjects.Image): void {
    const bx = img.scaleX;
    const by = img.scaleY;
    this.scene.tweens.add({ targets: img, y: img.y - 34, duration: 160, yoyo: true, repeat: 1, ease: 'Sine.easeInOut' });
    this.scene.tweens.add({ targets: img, scaleX: bx * 1.14, scaleY: by * 1.14, duration: 160, yoyo: true, repeat: 1, ease: 'Sine.easeInOut' });
  }

  /** Fly a "+N" from the player hand up into the gauge bar. */
  private flyXp(): void {
    const fx = this.scene.add
      .text(this.playerImg.x, this.playerImg.y - 60, `+${DUEL.winGauge}`, { fontFamily: FONT, fontSize: '56px', fontStyle: 'bold', color: PALETTE.moss, stroke: PALETTE.cream, strokeThickness: 6 })
      .setOrigin(0.5);
    this.battleView.add(fx);
    this.scene.tweens.add({
      targets: fx, x: 0, y: -PH / 2 + 236, scale: { from: 1.2, to: 0.6 }, alpha: { from: 1, to: 0 },
      duration: 620, ease: 'Cubic.easeIn', onComplete: () => fx.destroy()
    });
  }

  private showReplay(): void {
    this.choosing = false;
    this.instruction.setVisible(false);
    this.choiceRoot.setVisible(false);
    this.vs.setVisible(true);
    this.replay.setVisible(true);
    this.back.setVisible(true);
    this.replayLabel.setText(this.lastState?.canAfford ? `REJOUER  (${DUEL.energyCost}⚡)` : 'Pas assez d’⚡');
    this.replay.setAlpha(this.lastState?.canAfford ? 1 : 0.5);
  }

  private onStartFailed(m: EventMap['duel:start_failed']): void {
    if (m.reason === 'energy') {
      const target = this.battleView.visible ? this.replay : this.lancer;
      this.scene.tweens.add({ targets: target, x: target.x + 12, duration: 45, yoyo: true, repeat: 3 });
    }
  }

  private showBattle(): void {
    this.clearTimers();
    this.selectView.setVisible(false);
    this.battleView.setVisible(true);
  }

  private showSelect(): void {
    this.clearTimers();
    this.battleView.setVisible(false);
    this.selectView.setVisible(true);
    if (this.lastState) this.onChanged(this.lastState);
  }

  /* ------------------------------- open/close ------------------------------- */

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.setVisible(true);
    if (this.lastState) {
      this.selected = this.lastState.selected;
      this.matchesLeft = this.lastState.matchesLeft;
    }
    if (this.matchesLeft > 0) {
      this.battleView.setVisible(true);
      this.selectView.setVisible(false);
    } else {
      this.showSelect();
    }
    this.setAlpha(0).setScale(0.92);
    this.scene.tweens.add({ targets: this, alpha: 1, scale: 1, duration: 200, ease: 'Back.easeOut' });
  }

  requestClose(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.clearTimers();
    this.scene.tweens.add({ targets: this, alpha: 0, scale: 0.94, duration: 150, ease: 'Sine.easeIn', onComplete: () => this.setVisible(false) });
  }

  private timer(ms: number, fn: () => void): void {
    this.timers.push(this.scene.time.delayedCall(ms, fn));
  }

  private clearTimers(): void {
    this.timers.forEach((t) => t.remove(false));
    this.timers = [];
  }

  destroy(fromScene?: boolean): void {
    this.offBus.forEach((off) => off());
    this.clearTimers();
    super.destroy(fromScene);
  }
}
