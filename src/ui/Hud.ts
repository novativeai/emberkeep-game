import Phaser from 'phaser';
import {
  LIVE_GAME_WIDTH,
  HUD_COLUMN_X,
  hudColumnY,
  IS_MOBILE,
  LEVEL_XP,
  LIVE_GAME_HEIGHT,
  num,
  PALETTE,
  UI_SCALE
} from '../core/Constants';
import { FONT } from '../art/design';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import { uiRegistry } from './theme';

interface Pill {
  container: Phaser.GameObjects.Container;
  value: Phaser.GameObjects.Text;
  bg: Phaser.GameObjects.Image;
  icon: Phaser.GameObjects.Image;
  plus?: Phaser.GameObjects.Container;
}

/**
 * Heads-up display: energy / coins / keys pills (top-left), settings gear
 * (top-right), level + XP bar (bottom-left), and the bottom-right button column
 * — Ledger (with an attention dot when an order is deliverable), Bag, Cookbook
 * (UIScene builds that one) and Store, stacked by `hudColumnY`.
 *
 * There is exactly ONE shop button, and it opens the Store. The Emporium has no
 * button of its own: it is reached from the "+" on the gauge whose currency it
 * sells, which is where a player short of Warmth is already looking. A second
 * stall icon in the column only ever read as a duplicate of this one.
 */
export class Hud {
  ledgerButton: Phaser.GameObjects.Container;
  bagButton: Phaser.GameObjects.Container;
  storeButton: Phaser.GameObjects.Container;
  gearButton: Phaser.GameObjects.Container;
  private energyPill: Pill;
  private coinPill?: Pill;
  private keyPill: Pill;
  /** The tutorial's `key_unlock` beat is running — see `syncKeyPill`. */
  private keyLesson = false;
  private regenLabel: Phaser.GameObjects.Text;
  private xpFill: Phaser.GameObjects.Graphics;
  private levelText: Phaser.GameObjects.Text;
  private xpLabel: Phaser.GameObjects.Text;
  private bagBadge: Phaser.GameObjects.Container;
  private bagBadgeText: Phaser.GameObjects.Text;
  private ledgerDot: Phaser.GameObjects.Arc;
  private ledgerDotTween!: Phaser.Tweens.Tween;
  private ledgerEnabled = true;
  /** Base scale of the gauge pills (>1 on mobile) — press/refresh tweens are
   *  relative to this so the mobile magnification survives every bump. */
  private pillScale = UI_SCALE;
  /** Deliverability per visible order — the dot shows while ANY is ready. */
  private deliverableByOrder = new Map<string, boolean>();
  private readonly offBus: Array<() => void> = [];

  constructor(
    private scene: Phaser.Scene,
    bus: EventBus,
    private state: GameState,
    callbacks: {
      onLedger: () => void;
      onGear: () => void;
      onBag: () => void;
      onStore: () => void;
    }
  ) {
    // Portrait phones magnify the HUD (pillScale) and spread the gauge row wider
    // so the enlarged pills don't collide; desktop keeps its compact landscape row.
    const L = IS_MOBILE
      ? { energy: [330, 150], coin: [930, 150], key: [1530, 150], regen: [330, 280] }
      : { energy: [224, 88], coin: [572, 88], key: [920, 88], regen: [224, 138] };
    this.energyPill = this.pill(L.energy[0], L.energy[1], 'ui_icon_bolt', `${state.energyCurrent}/${this.state.energyMax}`);
    // coin.png is a big detailed coin — shrink the icon ~85% so the Gold gauge
    // reads like the others (icon + value), not an oversized coin.
    this.coinPill = this.pill(L.coin[0], L.coin[1], 'ui_icon_coin', `${state.coins}`, 0.14);
    this.keyPill = this.pill(L.key[0], L.key[1], 'ui_icon_key', `${state.keys}`);
    // A green "+" on the Warmth/Gold gauges opens their shop. Keys are STORY
    // gates and are never sold (MECHANICS §7: monetise impatience, never
    // progression) — the key pill gets no shop button.
    this.addPlus(this.energyPill, 'energy', bus);
    this.addPlus(this.coinPill, 'coins', bus);
    // Small countdown to the next +1 Warmth, just under the energy gauge.
    this.regenLabel = scene.add
      .text(L.regen[0], L.regen[1], '', { fontFamily: FONT.ui, fontSize: '27px', fontStyle: 'bold', color: PALETTE.cream })
      .setOrigin(0.5)
      .setScale(this.pillScale)
      .setAlpha(0.9);

    // Settings gear — top-right corner (nudged in on mobile for the fat pixels).
    this.gearButton = this.roundIconButton(
      LIVE_GAME_WIDTH - (IS_MOBILE ? 150 : 112),
      IS_MOBILE ? 150 : 104,
      'ui_icon_gear',
      1,
      callbacks.onGear
    );

    // Ledger button: bigger, with the scroll icon. Bottom of the right column.
    this.ledgerButton = this.roundIconButton(
      HUD_COLUMN_X,
      hudColumnY(0),
      'ui_icon_scroll',
      1.5,
      () => {
        // Dimmed during the tutorial. A dimmed button that does nothing at all
        // reads as broken, so it re-points at the live step instead.
        if (this.ledgerEnabled) callbacks.onLedger();
        else bus.emit('tutorial:nudge', {});
      }
    );
    // Bag button — the satchel, one slot above the Ledger in the same column so
    // the two board-side buttons read as one cluster. Its badge counts STACKS,
    // matching the panel's capacity readout.
    this.bagButton = this.roundIconButton(
      HUD_COLUMN_X,
      hudColumnY(1),
      'ui_icon_bag',
      1.5,
      callbacks.onBag
    );
    // Store button — slot 3, top of the column. Cosmetics only, so it is the one
    // button here that never gates play. It wears `ui_icon_shop` (the painted
    // stall) because it is now the column's only shop door.
    this.storeButton = this.roundIconButton(
      HUD_COLUMN_X,
      hudColumnY(3),
      'ui_icon_shop',
      1.5,
      callbacks.onStore
    );

    this.bagBadge = scene.add.container(62, -62);
    const badgeBg = scene.add.circle(0, 0, 26, num(PALETTE.gold)).setStrokeStyle(5, num(PALETTE.night));
    this.bagBadgeText = scene.add
      .text(0, 0, '0', { fontFamily: FONT.ui, fontSize: '30px', fontStyle: 'bold', color: PALETTE.night })
      .setOrigin(0.5);
    this.bagBadge.add([badgeBg, this.bagBadgeText]);
    this.bagButton.add(this.bagBadge);
    this.bagBadge.setVisible(false);

    this.ledgerDot = scene.add
      .circle(68, -68, 18, num(PALETTE.lava))
      .setStrokeStyle(5, num(PALETTE.cream));
    this.ledgerButton.add(this.ledgerDot);
    this.ledgerDot.setVisible(false);
    // Pulse only while the dot is shown — an invisible infinite tween still
    // ticks every frame (battery). refreshLedgerDot pauses/resumes it.
    this.ledgerDotTween = scene.tweens.add({
      targets: this.ledgerDot,
      scale: 1.3,
      duration: 460,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
    this.ledgerDotTween.pause();

    // Level disc + XP bar — one container so the whole cluster moves as one
    // (children keep their authored absolute coords; the group sits at 0,0).
    const xpY = LIVE_GAME_HEIGHT - 92;
    const levelGroup = scene.add.container(0, 0);
    const barBg = scene.add.graphics();
    barBg.fillStyle(num(PALETTE.plumShade), 0.85);
    barBg.fillRoundedRect(172, xpY - 18, 440, 36, 18);
    barBg.lineStyle(4, num(PALETTE.gold), 0.9);
    barBg.strokeRoundedRect(172, xpY - 18, 440, 36, 18);
    this.xpFill = scene.add.graphics();
    this.xpLabel = scene.add
      .text(392, xpY, '', {
        fontFamily: FONT.ui,
        fontSize: '24px',
        fontStyle: 'bold',
        color: PALETTE.cream
      })
      .setOrigin(0.5);
    const lvlTag = scene.add
      .text(112, xpY + 32, 'LVL', {
        fontFamily: FONT.ui,
        fontSize: '20px',
        fontStyle: 'bold',
        color: PALETTE.goldShade
      })
      .setOrigin(0.5);
    const disc = scene.add.image(112, xpY, 'ui_btn_round').setScale(0.82);
    this.levelText = scene.add
      .text(112, xpY - 10, '1', {
        fontFamily: FONT.ui,
        fontSize: '52px',
        fontStyle: 'bold',
        color: PALETTE.textBrown
      })
      .setOrigin(0.5);
    // Same paint order the old depth values produced: bar under disc, number on top.
    levelGroup.add([barBg, this.xpFill, this.xpLabel, lvlTag, disc, this.levelText]);
    // Mobile: magnify the whole cluster, anchored to the bottom-left corner. The
    // children carry large absolute Y (~LIVE_GAME_HEIGHT), so scaling around that
    // corner = scale k with the group offset by pivotY·(1−k) (plus a small inset).
    if (IS_MOBILE) {
      levelGroup.setScale(UI_SCALE).setPosition(24, LIVE_GAME_HEIGHT * (1 - UI_SCALE) - 30);
    }

    this.refreshEconomy();
    this.refreshEnergy(state.energyCurrent);

    // ---- UI Builder registration (theme overrides apply on register) ----
    uiRegistry.register(scene, 'hud.energy', 'Warmth gauge', 'HUD', this.energyPill.container, {
      bg: this.energyPill.bg, icon: this.energyPill.icon, value: this.energyPill.value, plus: this.energyPill.plus!
    });
    if (this.coinPill) {
      uiRegistry.register(scene, 'hud.gold', 'Gold gauge', 'HUD', this.coinPill.container, {
        bg: this.coinPill.bg, icon: this.coinPill.icon, value: this.coinPill.value, plus: this.coinPill.plus!
      });
    }
    uiRegistry.register(scene, 'hud.keys', 'Keys gauge', 'HUD', this.keyPill.container, {
      bg: this.keyPill.bg, icon: this.keyPill.icon, value: this.keyPill.value
    });
    uiRegistry.register(scene, 'hud.regen', 'Warmth regen countdown', 'HUD', this.regenLabel, {
      label: this.regenLabel
    });
    uiRegistry.register(scene, 'hud.gear', 'Settings button', 'HUD', this.gearButton, {
      bg: this.gearButton.getAt(0), icon: this.gearButton.getAt(1)
    });
    uiRegistry.register(scene, 'hud.bag', 'Bag button', 'HUD', this.bagButton, {
      bg: this.bagButton.getAt(0), icon: this.bagButton.getAt(1)
    });
    uiRegistry.register(scene, 'hud.store', 'Store button', 'HUD', this.storeButton, {
      bg: this.storeButton.getAt(0), icon: this.storeButton.getAt(1)
    });
    uiRegistry.register(scene, 'hud.ledger', 'Ledger button', 'HUD', this.ledgerButton, {
      bg: this.ledgerButton.getAt(0), icon: this.ledgerButton.getAt(1)
    });
    uiRegistry.register(scene, 'hud.level', 'Level badge + XP bar', 'HUD', levelGroup, {
      disc, level: this.levelText, tag: lvlTag, xp: this.xpLabel
    });

    this.offBus.push(
      bus.on('energy:changed', ({ current }) => this.refreshEnergy(current)),
      bus.on('economy:changed', () => this.refreshEconomy()),
      // The other half of "is a key useful here": the last gate on this world
      // being paid for, and standing somewhere with different gates.
      bus.on('region:unlocked', () => this.syncKeyPill()),
      bus.on('world:switched', () => this.syncKeyPill()),
      bus.on('order:progress', ({ orderId, deliverable }) => {
        this.deliverableByOrder.set(orderId, deliverable);
        this.refreshLedgerDot();
      }),
      bus.on('order:completed', ({ orderId }) => {
        this.deliverableByOrder.delete(orderId);
        this.refreshLedgerDot();
      }),
      bus.on('item:harvest_failed', ({ reason }) => { if (reason === 'energy') this.shakeEnergy(); })
    );

    // Key pill hidden until the tutorial unlock step — or a key — makes it real.
    this.syncKeyPill();
  }

  /** Unsubscribe all bus listeners — call on scene shutdown to prevent stale handlers. */
  teardown(): void {
    this.offBus.forEach((off) => off());
    this.offBus.length = 0;
  }

  /** The tutorial's key lesson forces the pill on for its one beat. */
  setKeyVisible(visible: boolean): void {
    this.keyLesson = visible;
    this.syncKeyPill();
  }

  /**
   * The key gauge is on screen only when a key would DO something here: the
   * Keeper holds at least one AND this world still has a door for it. Plus the
   * tutorial's key lesson, which is where the idea is taught.
   *
   * Two wrong answers were tried before this one. Hidden permanently after the
   * tutorial: the board still floated a Gold Key over its gates, so it promised
   * a currency the HUD flatly denied having. Shown whenever the Keeper holds
   * one: a key banked for Borealis's fog then sat in the wallet over an
   * Emberkeep with nothing left to unlock, which reads as a gauge that will not
   * go away. The badge on the board asks the same two questions
   * (`syncKeyBadges`), so the two always agree.
   */
  private syncKeyPill(): void {
    const useful = this.state.keys > 0 && this.state.hasKeyGate();
    this.keyPill.container.setVisible(this.keyLesson || useful);
  }

  private refreshLedgerDot(): void {
    const visible = [...this.deliverableByOrder.values()].some(Boolean);
    this.ledgerDot.setVisible(visible);
    if (visible && this.ledgerDotTween.isPaused()) {
      this.ledgerDotTween.resume();
    } else if (!visible && !this.ledgerDotTween.isPaused()) {
      this.ledgerDotTween.pause();
      this.ledgerDot.setScale(1);
    }
  }

  setLedgerEnabled(enabled: boolean): void {
    this.ledgerEnabled = enabled;
    this.ledgerButton.setAlpha(enabled ? 1 : 0.55);
  }

  getLedgerPos(): { x: number; y: number } {
    return { x: this.ledgerButton.x, y: this.ledgerButton.y };
  }

  /** Screen position of the Gold gauge (for the coin-collect fly). */
  getCoinPos(): { x: number; y: number } {
    return { x: this.coinPill?.container.x ?? 572, y: this.coinPill?.container.y ?? 88 };
  }

  /** WORLD position of the Warmth gauge's "+" button — the tutorial points here to
   *  open the Emporium. Uses the button's world matrix so it stays correct through
   *  the mobile pill magnification/reposition (a fixed offset would drift). */
  getEnergyPlusPos(): { x: number; y: number } {
    const plus = this.energyPill.plus;
    if (!plus) return { x: this.energyPill.container.x, y: this.energyPill.container.y };
    const m = plus.getWorldTransformMatrix();
    return { x: m.tx, y: m.ty };
  }

  /** A little bump when Gold lands. */
  /** Badge shows the number of STACKS held; hidden at zero so an empty bag is
   *  quiet rather than a nagging "0". */
  setBagCount(used: number): void {
    this.bagBadgeText.setText(String(used));
    this.bagBadge.setVisible(used > 0);
  }

  /** The satchel's arrival pulse: the button swells and a gold ring expands out
   *  of it — the same beat the concept frame shows. Called once per stored item,
   *  as the flight lands. */
  bumpBag(): void {
    const base = UI_SCALE;
    this.scene.tweens.add({
      targets: this.bagButton,
      scale: { from: base * 1.22, to: base },
      duration: 260,
      ease: 'Back.easeOut'
    });
    const ring = this.scene.add
      .circle(this.bagButton.x, this.bagButton.y, 62, undefined, 0)
      .setStrokeStyle(6, num(PALETTE.goldAccent), 0.95)
      .setDepth(this.bagButton.depth);
    this.scene.tweens.add({
      targets: ring,
      scale: 2.1,
      alpha: 0,
      duration: 420,
      ease: 'Sine.easeOut',
      onComplete: () => ring.destroy()
    });
  }

  /** WORLD position of the satchel — where a stored piece flies to. */
  getBagPos(): { x: number; y: number } {
    return { x: this.bagButton.x, y: this.bagButton.y };
  }

  bumpCoin(): void {
    if (!this.coinPill) return;
    this.scene.tweens.add({
      targets: this.coinPill.container,
      scale: { from: this.pillScale * 1.16, to: this.pillScale },
      duration: 160,
      ease: 'Sine.easeOut'
    });
  }

  /** A green "+" button hanging off a gauge's right edge → opens its shop. */
  private addPlus(pill: Pill, currency: 'energy' | 'coins', bus: EventBus): void {
    const btn = this.scene.add.container(150, 0);
    pill.plus = btn;
    const ring = this.scene.add.circle(0, 0, 31, 0x5fb43a).setStrokeStyle(6, num(PALETTE.cream));
    const plus = this.scene.add
      .text(0, -4, '+', { fontFamily: FONT.ui, fontSize: '52px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5);
    btn.add([ring, plus]);
    btn.setSize(70, 70);
    btn.setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => btn.setScale(1.1));
    btn.on('pointerout', () => btn.setScale(1));
    btn.on('pointerup', () => {
      btn.setScale(1);
      bus.emit('ui:shop_requested', { currency });
    });
    pill.container.add(btn);
  }

  private pill(x: number, y: number, icon: string, value: string, iconScale = 0.92): Pill {
    const container = this.scene.add.container(x, y).setScale(this.pillScale);
    const bg = this.scene.add.image(0, 0, 'ui_pill').setScale(0.95, 0.9);
    const iconImg = this.scene.add.image(-116, 0, icon).setScale(iconScale);
    const text = this.scene.add
      .text(20, 0, value, {
        fontFamily: FONT.ui,
        fontSize: '42px',
        fontStyle: 'bold',
        color: PALETTE.cream
      })
      .setOrigin(0.5);
    container.add([bg, iconImg, text]);
    return { container, value: text, bg, icon: iconImg };
  }

  private roundIconButton(
    x: number,
    y: number,
    icon: string,
    scale: number,
    onTap: () => void
  ): Phaser.GameObjects.Container {
    // `base` is the mobile magnification (1 on desktop). The press/hover feedback
    // multiplies it so the button never snaps back to un-magnified size on tap.
    const base = UI_SCALE;
    const container = this.scene.add.container(x, y).setScale(base);
    const bg = this.scene.add.image(0, 0, 'ui_btn_round').setScale(scale);
    // Icons arrive from two places at two resolutions: TextureFactory paints one
    // at 44 logical units (88 px after RES), while a file-backed icon is whatever
    // the PNG happens to be — icon_bag.png is 128 px, so the shared multiplier
    // drew the satchel half again too large and it spilled off its own plate onto
    // the button below. Fit every icon to the size a painted one lands at,
    // whatever it was authored at.
    const iconImg = this.scene.add.image(0, -8 * scale, icon);
    iconImg.setScale((88 * scale * 0.95) / Math.max(iconImg.width, iconImg.height));
    container.add([bg, iconImg]);
    container.setSize(128 * scale, 128 * scale);
    container.setInteractive({ useHandCursor: true });
    container.on('pointerover', () => container.setScale(base * 1.06));
    container.on('pointerout', () => container.setScale(base));
    container.on('pointerdown', () => container.setScale(base * 0.94));
    container.on('pointerup', () => {
      container.setScale(base);
      onTap();
    });
    return container;
  }

  /** Show the time to the next +1 Warmth (m:ss), or hide it when full. */
  setRegenText(text: string): void {
    this.regenLabel.setText(text ? `⏱ ${text}` : '').setVisible(text !== '');
  }

  private refreshEnergy(current: number): void {
    this.energyPill.value.setText(`${current}/${this.state.energyMax}`);
    this.scene.tweens.add({
      targets: this.energyPill.container,
      scale: { from: this.pillScale * 1.08, to: this.pillScale },
      duration: 140,
      ease: 'Sine.easeOut'
    });
  }

  private refreshEconomy(): void {
    this.coinPill?.value.setText(`${this.state.coins}`);
    this.keyPill.value.setText(`${this.state.keys}`);
    this.syncKeyPill();
    this.levelText.setText(`${this.state.level}`);
    const atCap = this.state.level >= LEVEL_XP.length;
    const [gained, span] = this.state.levelProgress;
    const xpY = LIVE_GAME_HEIGHT - 92;
    this.xpFill.clear();
    const width = (atCap ? 1 : Math.max(0.04, Math.min(1, gained / span))) * 424;
    this.xpFill.fillStyle(num(PALETTE.gold), 1);
    this.xpFill.fillRoundedRect(180, xpY - 11, width, 22, 11);
    this.xpFill.fillStyle(num(PALETTE.goldAccent), 0.65);
    this.xpFill.fillRoundedRect(180, xpY - 11, width, 9, 4.4);
    // At the cap the bar has nothing left to fill toward, so it says what the
    // cap MEANS instead of a number. Not "Chapter One complete" any more: the
    // rank that tops the curve is the rank that opens Borealis, so the last
    // thing the bar says has to point the Keeper onward rather than close a
    // book on them.
    this.xpLabel.setText(atCap ? 'The north is open ✦' : `${gained} / ${span} XP`);
  }

  private shakeEnergy(): void {
    const container = this.energyPill.container;
    this.scene.tweens.add({
      targets: container,
      x: container.x + 12,
      duration: 50,
      yoyo: true,
      repeat: 3
    });
    this.energyPill.value.setColor(PALETTE.lavaHighlight);
    this.scene.time.delayedCall(600, () => this.energyPill.value.setColor(PALETTE.cream));
  }
}
