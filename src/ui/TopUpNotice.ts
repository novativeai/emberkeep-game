import Phaser from 'phaser';
import { FONT, INK } from '../art/design';
import {
  LIVE_GAME_HEIGHT,
  LIVE_GAME_WIDTH,
  num,
  panelFitScale,
  px,
  TOP_UP
} from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { TopUpSource } from '../core/types';
import { uiRegistry } from './theme';

const BOX = TOP_UP.box;
const TYPE = TOP_UP.type;
const COPY = TOP_UP.copy;

/** The coin art is a big detailed PNG; fit it to the line box it rides rather
 *  than trusting a multiplier, and never upscale a small source into mush.
 *  Same rule (and the same 1.5 ceiling) as the Emporium's `fitArt`. */
function fitArt(img: Phaser.GameObjects.Image, slot: number): void {
  const natural = Math.max(img.width, img.height);
  img.setScale(Math.min(slot / natural, 1.5));
}

/**
 * THE SHORTFALL NOTICE — "you are 42 gold short, here is the way to fix it".
 *
 * A gold refusal in this game used to be a red price and a shake: the player
 * learned they could not have the thing and was left holding that. This is the
 * other half — what they were short OF, by HOW MUCH, and one key that takes
 * them to the coin shop. It is deliberately NOT a shop itself: see the note on
 * `TOP_UP` for why a second list of packs is a second thing to keep in step
 * with the hub's catalog.
 *
 * ## What this component is not allowed to do
 *
 * **It never starts a checkout.** The notice is raised BY a refusal, so it is
 * on screen with no transient activation of its own; `iapBridge.beginCheckout`
 * called from here (or from any bus handler that leads here) is popup-blocked
 * by construction. Its action goes to the Emporium and the player taps a pack
 * there — a fresh gesture, which is the only kind that opens a payment window.
 *
 * **It never calls `stopPropagation`, on the scrim or on a key.** Within a
 * scene `InputPlugin.topOnly` is true (this project never overrides it), so the
 * pointerup already reaches only the top object and there is nothing beneath to
 * protect. What cancelling DOES reach is the scene-level `POINTER_UP` that
 * `processUpEvents` skips once `_eventData.cancelled` is set — and that is the
 * event StorePanel releases its scroll drag on. Cancel it and the shelf under
 * this notice follows the cursor with no button held, for the rest of the
 * session. The canonical version of this note is in `ShopPanel`; it is repeated
 * here because this is the one panel that is ALWAYS drawn over another one.
 *
 * **It never closes itself.** The wallet can move while it is up (a grant can
 * land behind it), and it re-reads live state and re-words itself when that
 * happens — but a modal that vanishes on its own hands the tap that was already
 * travelling towards it to whatever was underneath.
 *
 * ## Its scrim swallows
 *
 * Being interactive is the whole mechanism: Phaser walks the live scenes
 * top-down on a pointer event and stops at the first that captured, so a
 * screen-sized interactive rectangle above every panel is what keeps a tap
 * meant for this notice off the shelf it is covering. It carries no handler —
 * tap-outside-to-close is a mouse idiom that a thumb loses at, and the two keys
 * are the only way out.
 */
export class TopUpNotice extends Phaser.GameObjects.Container {
  isOpen = false;

  private dim: Phaser.GameObjects.Rectangle;
  private sheet: Phaser.GameObjects.Container;
  private plate: Phaser.GameObjects.Graphics;
  private title: Phaser.GameObjects.Text;
  private short: Phaser.GameObjects.Text;
  private coin: Phaser.GameObjects.Image;
  private wallet: Phaser.GameObjects.Text;
  private goKey: Phaser.GameObjects.Container;
  private exitKey: Phaser.GameObjects.Container;

  /** What was refused, and what it costs. `price` is the FULL price — the
   *  shortfall is `price - coins`, re-derived on every repaint so the notice
   *  stays true as the wallet moves. */
  private label = '';
  private price = 0;
  private source: TopUpSource = 'store';

  private readonly offBus: Array<() => void> = [];

  constructor(
    scene: Phaser.Scene,
    private bus: EventBus,
    private gameState: GameState,
    private onGo: (source: TopUpSource) => void
  ) {
    super(scene, LIVE_GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2);

    this.dim = scene.add
      .rectangle(0, 0, LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, num(INK.scrim), TOP_UP.dimAlpha)
      .setInteractive();

    // The plate and its type ride a child container, so the whole notice can be
    // fit-scaled without touching the scrim, which must stay screen-sized on
    // every device (a scaled scrim leaves a live corner of board showing).
    // Named `sheet`, not `body`: GameObject.body is Phaser's physics slot, and
    // a container in it fails to typecheck against the base class.
    this.sheet = scene.add.container(0, 0);
    this.plate = scene.add.graphics();

    this.title = scene.add
      .text(0, 0, COPY.title, {
        fontFamily: FONT.ui,
        fontSize: `${px(TYPE.title)}px`,
        fontStyle: 'bold',
        color: INK.onField,
        align: 'center'
      })
      .setOrigin(0.5)
      .setShadow(0, 4, 'rgba(11,7,10,0.6)', 6);

    this.short = scene.add
      .text(0, 0, '', {
        fontFamily: FONT.ui,
        fontSize: `${px(TYPE.short)}px`,
        fontStyle: 'bold',
        color: INK.goldHi,
        align: 'center',
        wordWrap: { width: BOX.width - BOX.pad * 2 }
      })
      .setOrigin(0.5);

    this.coin = scene.add.image(0, 0, 'ui_icon_coin');
    fitArt(this.coin, BOX.walletBox);
    this.wallet = scene.add
      .text(0, 0, '', {
        fontFamily: FONT.ui,
        fontSize: `${px(TYPE.wallet)}px`,
        color: INK.onFieldDim
      })
      .setOrigin(0, 0.5);

    // ONE green plate, and everything else royal — the rule stated in
    // TextureFactory's two-button note. The green key is the only thing on this
    // notice that leaves it.
    this.goKey = this.makeKey('ui_btn_green', COPY.go, BOX.keyPrimaryW, BOX.keyPrimaryH, () => {
      if (!this.isOpen) return;
      const source = this.source;
      this.requestClose();
      this.onGo(source);
    });
    this.exitKey = this.makeKey('ui_btn_play', COPY.exit, BOX.keySecondaryW, BOX.keySecondaryH, () =>
      this.requestClose()
    );

    this.sheet.add([
      this.plate,
      this.title,
      this.short,
      this.coin,
      this.wallet,
      this.goKey,
      this.exitKey
    ]);
    this.add([this.dim, this.sheet]);
    scene.add.existing(this);
    this.setVisible(false);

    uiRegistry.register(scene, 'panel.topup', 'Shortfall notice', 'Panels', this, {
      frame: this.plate,
      title: this.title
    });

    // The wallet moves while this is up — a House pays out, a purchase lands.
    // The notice re-words itself rather than going stale or closing.
    this.offBus.push(bus.on('economy:changed', () => this.isOpen && this.layout()));
  }

  teardown(): void {
    this.offBus.forEach((off) => off());
    this.offBus.length = 0;
  }

  /** Raise the notice over whatever refused. `price` is the FULL price of the
   *  thing, not the shortfall (see the field note). */
  open(label: string, price: number, source: TopUpSource): void {
    this.label = label;
    this.price = price;
    this.source = source;
    this.layout();

    this.isOpen = true;
    this.bus.emit('ui:topup_toggled', { open: true });
    // Re-armed together, because `requestClose` disarms them together.
    this.dim.setInteractive();
    this.goKey.setInteractive();
    this.exitKey.setInteractive();
    this.setVisible(true).setAlpha(0);
    this.sheet.setScale(this.sheet.scale * 0.94);
    const rest = this.fitScale();
    this.scene.tweens.add({
      targets: this,
      alpha: 1,
      duration: TOP_UP.openMs,
      ease: 'Back.easeOut'
    });
    this.scene.tweens.add({
      targets: this.sheet,
      scale: rest,
      duration: TOP_UP.openMs,
      ease: 'Back.easeOut'
    });
  }

  requestClose(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.bus.emit('ui:topup_toggled', { open: false });
    // EVERY interactive piece stops listening NOW, not when the fade finishes.
    //
    // The green key opens the Emporium in the same breath as this close, and
    // anything of this notice that is still live for the 150ms of the dissolve
    // eats the player's first tap on the shelf it just sent them to. That was
    // written for the scrim and applied to the scrim alone — but the two keys
    // are 300+ units of hit area sitting in the middle of the screen, they
    // outrank the scrim in Phaser's sort, and their handlers early-return on
    // `!this.isOpen`, so they swallow the tap and do nothing with it. A tap
    // that lands on nothing is the same bug whichever object ate it.
    this.dim.disableInteractive();
    this.goKey.disableInteractive();
    this.exitKey.disableInteractive();
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      duration: TOP_UP.closeMs,
      ease: 'Sine.easeIn',
      onComplete: () => this.setVisible(false)
    });
  }

  /* --------------------------------------------------------------- layout */

  /** How short the player is RIGHT NOW. Never negative — once the wallet
   *  covers the price the notice switches to its answered wording. */
  private shortfall(): number {
    return Math.max(0, this.price - this.gameState.coins);
  }

  private fitScale(): number {
    return panelFitScale(BOX.width, this.plateHeight());
  }

  /** The notice's own height: the fixed parts, plus however tall the shortfall
   *  line actually turned out. `shortMaxLines` is what the arithmetic in
   *  `TOP_UP` was budgeted against, not a clamp — one line must not leave dead
   *  plate, and three must not run off the bottom. */
  private plateHeight(): number {
    return (
      BOX.pad +
      BOX.titleBox +
      BOX.gapTitle +
      this.short.height +
      BOX.gapShort +
      BOX.walletBox +
      BOX.gapKeys +
      this.keysHeight() +
      BOX.pad
    );
  }

  private keysHeight(): number {
    return BOX.keysStacked
      ? BOX.keyPrimaryH + BOX.keyGap + BOX.keySecondaryH
      : Math.max(BOX.keyPrimaryH, BOX.keySecondaryH);
  }

  /**
   * Re-word and re-seat everything from live state.
   *
   * Run on open AND on every `economy:changed` while open: the wording changes
   * with the wallet, the wording changes the line COUNT, and the line count
   * changes the plate. Doing it in one pass is what stops a re-worded notice
   * from printing over its own rim.
   */
  private layout(): void {
    const missing = this.shortfall();
    const covered = missing === 0;
    this.title.setText(covered ? COPY.titleCovered : COPY.title);
    this.title.setColor(covered ? INK.gain : INK.onField);
    this.short.setText(
      covered
        ? COPY.covered.replace('{what}', this.label)
        : COPY.short.replace('{n}', missing.toLocaleString()).replace('{what}', this.label)
    );
    this.wallet.setText(`${COPY.wallet} ${this.gameState.coins.toLocaleString()}`);

    // THE POP GIVES WAY TO THE TRUTH. The open flourish tweens this container's
    // scale towards a rest value computed from the height it had when it was
    // raised; a wallet that moves mid-flourish can change the line count and so
    // the height, and a tween finishing at the old rest would leave the notice
    // a few percent off its fit on a handset. Killing it here costs at most a
    // truncated 190ms flourish and cannot leave a wrong-sized plate.
    this.scene.tweens.killTweensOf(this.sheet);

    const h = this.plateHeight();
    const top = -h / 2;
    this.drawPlate(h);

    let y = top + BOX.pad;
    this.title.setY(y + BOX.titleBox / 2);
    y += BOX.titleBox + BOX.gapTitle;
    this.short.setY(y + this.short.height / 2);
    y += this.short.height + BOX.gapShort;

    // Coin + count, centred as one group: the icon's fitted width is only known
    // after `fitArt`, so the pair is measured rather than placed at a guess.
    const gap = Math.round(BOX.walletBox * 0.28);
    const groupW = this.coin.displayWidth + gap + this.wallet.width;
    this.coin.setPosition(-groupW / 2 + this.coin.displayWidth / 2, y + BOX.walletBox / 2);
    this.wallet.setPosition(-groupW / 2 + this.coin.displayWidth + gap, y + BOX.walletBox / 2);
    y += BOX.walletBox + BOX.gapKeys;

    if (BOX.keysStacked) {
      this.goKey.setPosition(0, y + BOX.keyPrimaryH / 2);
      this.exitKey.setPosition(0, y + BOX.keyPrimaryH + BOX.keyGap + BOX.keySecondaryH / 2);
    } else {
      const rowW = BOX.keyPrimaryW + BOX.keyGap + BOX.keySecondaryW;
      this.goKey.setPosition(-rowW / 2 + BOX.keyPrimaryW / 2, y + BOX.keyPrimaryH / 2);
      this.exitKey.setPosition(rowW / 2 - BOX.keySecondaryW / 2, y + BOX.keySecondaryH / 2);
    }

    this.sheet.setScale(this.fitScale());
  }

  /**
   * The seated candy plate — the four layers `drawBanner` states, at notice
   * size: a `goldDeep` SEAT under the face, the `field` FACE, a `gold` RIM, and
   * a `fieldLift` GLOSS strip along the top. The seat is drawn BELOW the face
   * (nothing is seated under this plate, so it may hang), which is what makes
   * the notice read as an object resting on the panel rather than a rectangle
   * printed on it.
   */
  private drawPlate(h: number): void {
    const w = BOX.width;
    const g = this.plate;
    g.clear();
    g.fillStyle(num(INK.goldDeep), 1);
    g.fillRoundedRect(-w / 2, -h / 2 + BOX.seat, w, h, BOX.radius);
    g.fillStyle(num(INK.field), 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, BOX.radius);
    g.lineStyle(BOX.rim, num(INK.gold), 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, BOX.radius);
    g.fillStyle(num(INK.fieldLift), 0.5);
    g.fillRoundedRect(
      -w / 2 + BOX.glossInset,
      -h / 2 + BOX.glossTop,
      w - BOX.glossInset * 2,
      BOX.glossH,
      Math.round(BOX.glossH / 2)
    );
  }

  /**
   * One key: a painted plate sized by `setDisplaySize` (so the geometry above
   * is the geometry on screen, not a scale that has to be re-guessed when the
   * texture is repainted) with its label centred on it.
   *
   * The HIT AREA is the container's own `setSize`, which is the whole plate —
   * on a handset that is 340 units tall, i.e. 51.8 CSS px on a 390px-wide
   * phone, clear of the 44px platform floor. Deliberately no `stopPropagation`
   * in the handler: see the class note.
   */
  private makeKey(
    texture: string,
    label: string,
    w: number,
    h: number,
    onTap: () => void
  ): Phaser.GameObjects.Container {
    const key = this.scene.add.container(0, 0);
    const bg = this.scene.add.image(0, 0, texture).setDisplaySize(w, h);
    const text = this.scene.add
      .text(0, -Math.round(h * 0.03), label, {
        fontFamily: FONT.ui,
        fontSize: `${px(TYPE.key)}px`,
        fontStyle: 'bold',
        color: INK.creamHi
      })
      .setOrigin(0.5)
      .setShadow(0, 3, 'rgba(11,7,10,0.55)', 4);
    key.add([bg, text]);
    key.setSize(w, h).setInteractive({ useHandCursor: true });
    key.on('pointerover', () => key.setScale(1.05));
    key.on('pointerout', () => key.setScale(1));
    key.on('pointerup', () => {
      key.setScale(1);
      onTap();
    });
    return key;
  }
}
