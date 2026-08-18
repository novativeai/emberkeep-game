import Phaser from 'phaser';
import { FONT, INK } from '../art/design';
import { LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, num, panelMobileScale } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import { speakerName } from '../entities/CharacterBubble';
import { discTextureFor } from '../entities/PortraitAnimator';
import type { GameState } from '../core/GameState';
import type { OrderConfig } from '../core/types';
import type { OrderSystem } from '../systems/OrderSystem';
import type { TaskSystem } from '../systems/TaskSystem';
import { uiRegistry } from './theme';

// Card centres: half the card art (640×0.9 → ±288) + this must stay inside the
// ui_panel's inner face (~±612) — at 330/0.96 the cards overflowed the frame.
const CARD_X = 300;
/** The requirement icon contain-fits this box — the `ui_slot` backdrop is 144
 *  units, so the art sits inside it with a small air gap all round. */
const SLOT_ICON_FIT = 128;
const TAB_W = 520;
const TAB_H = 104;
const TAB_Y = -384;

/** The Keeper's Tasks checklist, in panel space. Shared by the page that BUILDS
 *  the rows and the one that repaints them — two copies of the same two numbers
 *  is how a row and its progress bar end up in different places. They spread
 *  into the frame's new height rather than leaving it empty above the footer. */
const TASK_ROW_TOP = -240;
const TASK_ROW_GAP = 140;

// ---- Order-card portrait medallion ----
// Eleanor sits in the SAME gold ring the dialogue bubble frames her with
// (`portrait_ring`, 512px art), so the quest book and her bubble read as one
// medallion language rather than two unrelated treatments. Every radius below
// is a ratio of that art's own geometry — the window hole ends at 200/512 and
// the gold's outer edge at 250/512 — so re-sizing is one constant.
// 164, not 184. The band it has to live in is fixed — the card's painted plate
// starts at -304 and the requirement slot at -36 — and at 184 the ring filled
// it almost exactly: 18 units of air above the gold and 5 below it, before the
// title. Both edges read as touching, because 18 units at this size IS
// touching. A smaller ring is the only thing that buys air at both ends.
const MEDALLION_SIZE = 164;
/** Centred in the band between the card's top edge and the title, with 30
 *  units of air above the gold and 30 below it. */
const MEDALLION_Y = -194;
const RING_HOLE_R = MEDALLION_SIZE * (200 / 512);
const RING_OUTER_R = MEDALLION_SIZE * (250 / 512);
/** Portrait clip radius — just inside the gold, so the crop's edge hides UNDER
 *  the band and never reads as a hard circle against the moss. */
const RING_MASK_R = MEDALLION_SIZE * (247 / 512);
/** Bust height as a multiple of the window's diameter. Just over 1 — the same
 *  proportion the dialogue bubble frames her at, so the crop lands on her robe
 *  hem and her shoulders and braid still read. Scaling to COVER the window's
 *  width instead cropped her at the jaw and lost the bust entirely. */
const MEDALLION_FILL = 1.1;
/** Headroom between the window's top and the top of the art, so her hair has
 *  air instead of butting into the frame. */
const MEDALLION_HEAD_INSET = 6;
/** Moss interior — the same two greens CharacterBubble fills its ring window
 *  with, so the gaps beside her silhouette read as the medallion's inside. */
const MOSS_BACK = 0x3e745b;
const MOSS_LIGHT = 0x549270;

type LedgerTab = 'orders' | 'tasks';

interface OrderCard {
  root: Phaser.GameObjects.Container;
  /** The face in the medallion ring — retargeted to each order's `giver` on
   *  refresh, so Selyna's orders wear Selyna and Eleanor's wear Eleanor. */
  medallion: Phaser.GameObjects.Image;
  title: Phaser.GameObjects.Text;
  slotIcon: Phaser.GameObjects.Image;
  slotCount: Phaser.GameObjects.Text;
  rewardText: Phaser.GameObjects.Text;
  /** Real coin art in front of the reward line — shown only when the order pays
   *  Gold, and re-seated on every refresh because the line's width changes. */
  rewardCoin: Phaser.GameObjects.Image;
  deliverButton: Phaser.GameObjects.Container;
  order: OrderConfig | null;
  deliverable: boolean;
}

interface TaskRow {
  label: Phaser.GameObjects.Text;
  count: Phaser.GameObjects.Text;
  barBg: Phaser.GameObjects.Graphics;
  fill: Phaser.GameObjects.Graphics;
  check: Phaser.GameObjects.Text;
  hint: Phaser.GameObjects.Text;
}

interface TabHandle {
  root: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

/**
 * Eleanor's Ledger — the game's single quest board. Two tabs under one frame:
 *   • Orders — the two-slot order board (DEMO-PLAN §Act III): both active
 *     orders visible at once, so the player CHOOSES what to chase.
 *   • Tasks — the Keeper's Tasks chapter checklist (DEMO-PLAN §Act V) with
 *     live progress bars; TaskSystem owns the reward, this page only renders.
 * The Tasks tab appears once the tutorial ends (the checklist is the encore's
 * spine, not a tutorial concern) — until then the Orders header sits centred
 * and the panel reads exactly like the tutorial's original Ledger.
 */
export class LedgerPanel extends Phaser.GameObjects.Container {
  isOpen = false;
  /** Open/rest scale — >1 on mobile so the frame fills the portrait width. */
  private baseScale = 1;
  private readonly offBus: Array<() => void> = [];
  private dim: Phaser.GameObjects.Rectangle;
  private blurb: Phaser.GameObjects.Text;
  private emptyText: Phaser.GameObjects.Text;
  private cards: OrderCard[] = [];
  private deliverAllowed = true;
  private activeTab: LedgerTab = 'orders';
  private ordersPage: Phaser.GameObjects.Container;
  private tasksPage: Phaser.GameObjects.Container;
  private ordersTab: TabHandle;
  private tasksTab: TabHandle;
  private taskRows: TaskRow[] = [];
  /** Per-card portrait clip circles, re-seated in world space each frame. */
  private portraitMasks: Array<{ g: Phaser.GameObjects.Graphics; root: Phaser.GameObjects.Container }> = [];
  /** The owning scene, held separately from the GameObject's own `this.scene`.
   *  Phaser's DisplayList destroys every child during scene shutdown, and a
   *  destroyed GameObject has `scene === undefined` — but our SHUTDOWN listener
   *  is registered in create(), so it runs AFTER that. `teardown()` therefore
   *  cannot reach the scene through `this.scene`; it would throw and abort the
   *  whole teardown chain (the panels after it would keep their subscriptions). */
  private readonly owner: Phaser.Scene;

  constructor(
    scene: Phaser.Scene,
    private bus: EventBus,
    private orderSystem: OrderSystem,
    private taskSystem: TaskSystem,
    private gameState: GameState
  ) {
    super(scene, LIVE_GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2);
    this.owner = scene;

    this.dim = scene.add
      .rectangle(0, 0, LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, num(INK.scrim), 0.55)
      .setInteractive(); // swallow board input behind the panel
    this.dim.on('pointerup', () => this.requestClose());

    // SEATED SO THE FRAME GREW DOWNWARD, not outward from its middle.
    //
    // `ui_quest_panel` is 136 game units taller than it was, and a centred image
    // would have split that between the top and the bottom — moving the frame's
    // top edge up under the tabs, which straddle it, and re-cutting the header
    // for a problem that is entirely at the floor. At y 86 the inner plate still
    // starts at -404, exactly where every number in this file expects it, and
    // all 136 units land where the blurb needed them.
    const panel = scene.add.image(0, 86, 'ui_quest_panel');
    this.baseScale = panelMobileScale(panel.width);

    // Tab lozenges along the top edge — Orders sits centred (classic Ledger
    // header) until the tutorial ends and the Tasks tab joins it.
    this.ordersTab = this.buildTab(scene, 'Eleanor’s Orders', () => this.switchTab('orders'));
    this.tasksTab = this.buildTab(scene, 'Keeper’s Tasks', () => this.switchTab('tasks'));

    // Close button — INSIDE the board, not straddling its corner.
    //
    // The frame's inner rect is x -632..632, y -404..420; the Tasks tab ends at
    // x 530 and the right order card starts at y -299. That leaves one clear
    // pocket, and the key is sized to sit in it with air on all four sides
    // rather than hung on the rim like a sticker.
    const closeButton = scene.add.container(580, -350);
    // The royal candy disc — the same Close key every other panel wears, and
    // deliberately NOT the cream HUD disc, which means "open something". 0.58
    // is what fits the pocket: the Tasks tab ends at 530 and the frame at 632.
    const closeBg = scene.add.image(0, 0, 'ui_btn_round_royal').setScale(0.58);
    const closeX = scene.add
      .text(0, -2, '✕', { fontFamily: FONT.ui, fontSize: '40px', fontStyle: 'bold', color: INK.onFieldGold })
      .setOrigin(0.5);
    closeButton.add([closeBg, closeX]);
    closeButton.setSize(96, 96);
    closeButton.setInteractive({ useHandCursor: true });
    closeButton.on('pointerup', () => this.requestClose());

    // ---- Orders page: two cards side by side + blurb + empty text. ----
    this.ordersPage = scene.add.container(0, 0);
    this.cards.push(this.buildCard(scene, -CARD_X), this.buildCard(scene, CARD_X));

    // The active card's flavor line runs along the bottom of the board.
    // BOLD, and in the field's full ink. It is Eleanor's own line about the
    // order the player is looking at — the one piece of writing on this board
    // that is neither a label nor a number — and it was set dim, small and
    // italic, which is how you set a footnote nobody is meant to read.
    this.blurb = scene.add
      .text(0, 440, '', {
        fontFamily: FONT.ui,
        fontSize: '30px',
        fontStyle: 'bold italic',
        color: INK.onField,
        align: 'center',
        lineSpacing: 6,
        // 1100 of the plate's 1264: three lines of the longest order blurb, with
        // room for a fourth before it could reach the frame's floor at 556.
        wordWrap: { width: 1100 }
      })
      .setOrigin(0.5);

    this.emptyText = scene.add
      .text(0, 20, 'The brazier roars again!\nEleanor will have new work for you soon.', {
        fontFamily: FONT.ui,
        fontSize: '38px',
        fontStyle: 'bold',
        color: INK.onField,
        align: 'center',
        lineSpacing: 12
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.ordersPage.add([...this.cards.map((c) => c.root), this.blurb, this.emptyText]);

    // ---- Tasks page: the chapter checklist. ----
    this.tasksPage = scene.add.container(0, 0).setVisible(false);
    this.buildTasksPage(scene);

    this.add([this.dim, panel, this.ordersTab.root, this.tasksTab.root, closeButton, this.ordersPage, this.tasksPage]);
    scene.add.existing(this);
    this.setVisible(false);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.syncPortraitMasks, this);

    uiRegistry.register(scene, 'panel.ledger', 'Eleanor’s Ledger panel', 'Panels', this, {
      frame: panel,
      title: this.ordersTab.label,
      orderTitle: this.cards[0]!.title,
      blurb: this.blurb,
      card: this.cards[0]!.root
    });

    this.offBus.push(
      bus.on('order:progress', () => this.refresh()),
      bus.on('order:completed', () => this.refresh())
    );
    // The checklist counts merges/hatches/orders/gold/elder-taps — refresh the
    // Tasks page (and its tab counter) whenever any of those move while open.
    for (const event of ['item:merged', 'item:hatched', 'order:completed', 'elder:tapped', 'economy:changed', 'tasks:all_complete'] as const) {
      this.offBus.push(bus.on(event, () => this.isOpen && this.refreshTasks()));
    }
  }

  /** One header lozenge — restyled active/inactive by layoutTabs(). */
  private buildTab(scene: Phaser.Scene, text: string, onTap: () => void): TabHandle {
    const root = scene.add.container(0, TAB_Y);
    const bg = scene.add.graphics();
    const label = scene.add
      .text(0, 0, text, {
        fontFamily: FONT.ui,
        fontSize: '40px',
        fontStyle: 'bold',
        color: INK.onField
      })
      .setOrigin(0.5)
      .setShadow(0, 4, 'rgba(36,27,34,0.5)', 6);
    root.add([bg, label]);
    root.setSize(TAB_W, TAB_H);
    root.setInteractive({ useHandCursor: true });
    root.on('pointerup', onTap);
    return { root, bg, label };
  }

  /** Five checklist rows + the reward footer, in panel space. */
  private buildTasksPage(scene: Phaser.Scene): void {
    const rowTop = TASK_ROW_TOP;
    const rowGap = TASK_ROW_GAP;
    this.taskSystem.tasks.forEach((task, i) => {
      const y = rowTop + i * rowGap;
      const label = scene.add
        .text(-548, y, task.label, {
          fontFamily: FONT.ui,
          fontSize: '31px',
          fontStyle: 'bold',
          color: INK.onField,
          wordWrap: { width: 640 }
        })
        .setOrigin(0, 0.5);
      const barX = 160;
      const barBg = scene.add.graphics();
      barBg.fillStyle(num(INK.fieldDeep), 0.85);
      barBg.fillRoundedRect(barX, y + 18, 320, 22, 11);
      const fill = scene.add.graphics();
      const count = scene.add
        .text(barX + 160, y - 14, '', {
          fontFamily: FONT.ui,
          fontSize: '27px',
          fontStyle: 'bold',
          color: INK.onFieldGold
        })
        .setOrigin(0.5);
      const check = scene.add
        .text(548, y, '✓', {
          fontFamily: FONT.ui,
          fontSize: '46px',
          fontStyle: 'bold',
          color: INK.gain
        })
        .setOrigin(0.5)
        .setVisible(false);
      // Replaces the bar while the task's subject doesn't exist yet.
      const hint = scene.add
        .text(340, y, task.lockedHint ? `🔒 ${task.lockedHint}` : '', {
          fontFamily: FONT.ui,
          fontSize: '24px',
          fontStyle: 'italic',
          color: INK.onFieldDim,
          align: 'center',
          wordWrap: { width: 430 }
        })
        .setOrigin(0.5)
        .setVisible(false);
      this.tasksPage.add([label, barBg, fill, count, check, hint]);
      this.taskRows.push({ label, count, barBg, fill, check, hint });
    });

    // Follows the frame's new floor (556) rather than staying at the old one.
    const footer = scene.add
      .text(0, 462, `Finish all ${this.taskSystem.tasks.length} → a golden reward from Eleanor`, {
        fontFamily: FONT.ui,
        fontSize: '28px',
        fontStyle: 'bold',
        color: INK.onFieldGold
      })
      .setOrigin(0.5);
    this.tasksPage.add(footer);
  }

  /** One order card: portrait, title, requirement slot, reward line, Deliver. */
  private buildCard(scene: Phaser.Scene, x: number): OrderCard {
    const root = scene.add.container(x, 16);
    const cardBg = scene.add.image(0, 0, 'ui_card').setScale(0.9);
    const { layers: medallion, portrait } = this.buildMedallion(scene, root);
    const title = scene.add
      .text(0, -84, '', {
        fontFamily: FONT.ui,
        fontSize: '30px',
        fontStyle: 'bold',
        color: INK.onField,
        align: 'center',
        wordWrap: { width: 400 }
      })
      .setOrigin(0.5);
    const slot = scene.add.image(0, 36, 'ui_slot');
    const slotIcon = scene.add.image(0, 28, 'item_flame_gem_2').setScale(0.72);
    const slotCount = scene.add
      .text(48, 80, '0/0', {
        fontFamily: FONT.ui,
        fontSize: '30px',
        fontStyle: 'bold',
        color: INK.onField
      })
      .setOrigin(0.5)
      .setShadow(0, 2, '#FFFFFF', 4);
    const rewardCoin = scene.add.image(0, 148, 'ui_icon_coin').setVisible(false);
    rewardCoin.setScale(34 / Math.max(rewardCoin.width, rewardCoin.height));
    const rewardText = scene.add
      .text(0, 148, '', {
        fontFamily: FONT.ui,
        fontSize: '28px',
        fontStyle: 'bold',
        color: INK.onFieldGold
      })
      .setOrigin(0.5);

    const deliverButton = scene.add.container(0, 232);
    // WIDER THAN IT IS TALL, on purpose. At a uniform 0.72 the word filled the
    // pill end to end and the rounded caps ate what padding was left, so the
    // key looked shut. The height stays where it was — it is the air either
    // side of the word that was missing, not the size of the button.
    const deliverBg = scene.add.image(0, 0, 'ui_btn_green').setScale(0.88, 0.74);
    const deliverText = scene.add
      .text(0, -8, 'Deliver', {
        fontFamily: FONT.ui,
        fontSize: '44px',
        fontStyle: 'bold',
        color: '#FFFFFF'
      })
      .setOrigin(0.5)
      .setShadow(0, 4, 'rgba(36,27,34,0.5)', 6);
    deliverButton.add([deliverBg, deliverText]);
    // The bg image carries the interaction so the nested-container transform
    // doesn't muddle the hit test (see the original single-card notes).
    deliverBg.setInteractive({ useHandCursor: true });
    deliverButton.setSize(360, 124);

    const card: OrderCard = {
      root,
      medallion: portrait,
      title,
      slotIcon,
      slotCount,
      rewardText,
      rewardCoin,
      deliverButton,
      order: null,
      deliverable: false
    };
    deliverBg.on('pointerup', () => this.onDeliverPressed(card));
    root.add([cardBg, ...medallion, title, slot, slotIcon, slotCount, rewardCoin, rewardText, deliverButton]);
    return card;
  }

  /**
   * Eleanor framed in the dialogue bubble's gold ring: drop shadow, moss
   * interior, her bust cropped to the window, ring on top. Returns the layers in
   * back-to-front order for the card to add.
   *
   * The bust art is TALLER than it is wide (391×560), so it is COVER-fit and
   * top-anchored — the window takes her head and shoulders and the crop falls at
   * the chest, the way a portrait medallion should read. (The card previously
   * forced it into a 178px square with `setDisplaySize`, which squashed her to
   * 70% height.) The painted fallback is square, so the same cover rule centres
   * it instead of top-anchoring — either way the art can never under-fill the
   * window and let moss show through as a gap.
   */
  private buildMedallion(
    scene: Phaser.Scene,
    root: Phaser.GameObjects.Container
  ): { layers: Phaser.GameObjects.GameObject[]; portrait: Phaser.GameObjects.Image } {
    // Lift: a soft dark disc under the gold so the medallion sits ON the card
    // rather than floating flat against it.
    const shadow = scene.add.graphics();
    shadow.fillStyle(num(INK.scrim), 0.4);
    shadow.fillCircle(0, MEDALLION_Y + 5, RING_OUTER_R + 2);

    // Moss interior, filled past the hole to the clip radius so no card colour
    // survives as a sliver under the ring's inner antialiased edge.
    const back = scene.add.graphics();
    back.fillStyle(MOSS_BACK, 1);
    back.fillCircle(0, MEDALLION_Y, RING_MASK_R);
    back.fillStyle(MOSS_LIGHT, 1);
    back.fillCircle(0, MEDALLION_Y - RING_HOLE_R * 0.085, RING_HOLE_R * 0.915);

    // Her face comes from the DISC ATLAS the bubble already animates — frame 0
    // is the rest bust. 'portrait_eleanor' died when the cast art moved to the
    // atlases: nothing loads that key any more, so the medallion was showing
    // Phaser's missing-texture mark in a gold ring.
    const discKey = discTextureFor('eleanor');
    const portrait = scene.textures.exists(discKey)
      ? scene.add.image(0, MEDALLION_Y, discKey, 0)
      : scene.add.image(0, MEDALLION_Y, 'portrait_ring'); // never the green mark
    this.seatMedallion(portrait);

    // Geometry masks live in WORLD space, so the circle is re-seated every frame
    // against the panel's position and its open/close scale tween (the same
    // treatment CharacterBubble gives its ring window).
    const maskG = scene.make.graphics();
    maskG.fillStyle(0xffffff, 1);
    maskG.fillCircle(0, 0, RING_MASK_R);
    portrait.setMask(maskG.createGeometryMask());
    this.portraitMasks.push({ g: maskG, root });

    const ring = scene.add.image(0, MEDALLION_Y, 'portrait_ring');
    ring.setDisplaySize(MEDALLION_SIZE, MEDALLION_SIZE);

    return { layers: [shadow, back, portrait, ring], portrait };
  }

  /** Fit whatever face is mounted into the ring window — run on build AND after
   *  every texture swap, because the fit depends on the mounted art's size. */
  private seatMedallion(portrait: Phaser.GameObjects.Image): void {
    const window = RING_MASK_R * 2;
    if (portrait.height > portrait.width * 1.15) {
      // Bust art: size by HEIGHT and hang it from the window's top, so the
      // window takes her head, shoulders and braid and the crop falls on the
      // robe. Moss shows at her sides — that is the frame reading as a window.
      const fit = (window * MEDALLION_FILL) / portrait.height;
      portrait.setScale(fit);
      portrait.y = MEDALLION_Y - RING_MASK_R + MEDALLION_HEAD_INSET + (portrait.height * fit) / 2;
    } else {
      // Square art — the painted fallback, itself a little framed medallion.
      // Contain it and centre it; a fallback should look plain, never cropped.
      portrait.setScale(window / Math.max(1, portrait.width));
      portrait.y = MEDALLION_Y;
    }
  }

  /** Mount `giver`'s face in a card's medallion (frame 0 of their disc atlas =
   *  the rest bust). A giver with no disc keeps the current face rather than
   *  showing the missing-texture mark — art failures degrade, never block. */
  private setMedallionGiver(card: OrderCard, giver: string): void {
    const discKey = discTextureFor(giver);
    if (!this.owner.textures.exists(discKey) || card.medallion.texture.key === discKey) return;
    card.medallion.setTexture(discKey, 0);
    this.seatMedallion(card.medallion);
  }

  /** Keep every card's portrait clip circle over its ring window. */
  private syncPortraitMasks(): void {
    if (!this.visible) return;
    for (const { g, root } of this.portraitMasks) {
      g.setPosition(this.x + root.x * this.scaleX, this.y + (root.y + MEDALLION_Y) * this.scaleY);
      g.setScale(this.scaleX, this.scaleY);
    }
  }

  teardown(): void {
    this.offBus.forEach((off) => off());
    this.offBus.length = 0;
    this.owner.events.off(Phaser.Scenes.Events.UPDATE, this.syncPortraitMasks, this);
    this.portraitMasks.forEach(({ g }) => g.destroy());
    this.portraitMasks.length = 0;
  }

  /** World position of the FIRST card's Deliver button (tutorial hand target). */
  getDeliverPos(): { x: number; y: number } {
    const card = this.cards[0]!;
    // Local offsets scaled by the panel's own scale (>1 on mobile) so the pointer
    // tracks the Deliver button through the portrait magnification.
    return {
      x: this.x + (card.root.x + card.deliverButton.x) * this.scaleX,
      y: this.y + (card.root.y + card.deliverButton.y) * this.scaleY
    };
  }

  setDeliverAllowed(allowed: boolean): void {
    this.deliverAllowed = allowed;
  }

  /** Deliver a card's order, or shake its button if it isn't ready. */
  private onDeliverPressed(card: OrderCard): void {
    if (card.deliverable && this.deliverAllowed && card.order) {
      this.bus.emit('ui:deliver_requested', { orderId: card.order.id });
    } else if (!card.deliverable) {
      this.scene.tweens.add({
        targets: card.deliverButton,
        x: card.deliverButton.x + 10,
        duration: 45,
        yoyo: true,
        repeat: 3
      });
    }
  }

  open(tab: LedgerTab = 'orders'): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.activeTab = this.gameState.tutorialDone ? tab : 'orders';
    this.refresh();
    this.refreshTasks();
    this.layoutTabs();
    // A still-running close tween would re-hide the panel from its onComplete.
    this.scene.tweens.killTweensOf(this);
    this.setVisible(true);
    this.setAlpha(0);
    this.setScale(this.baseScale * 0.92);
    this.syncPortraitMasks(); // seat the clip circles before the first frame renders
    this.scene.tweens.add({ targets: this, alpha: 1, scale: this.baseScale, duration: 200, ease: 'Back.easeOut' });
    this.bus.emit('ui:ledger_toggled', { open: true });
  }

  requestClose(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scale: this.baseScale * 0.94,
      duration: 150,
      ease: 'Sine.easeIn',
      onComplete: () => this.setVisible(false)
    });
    this.bus.emit('ui:ledger_toggled', { open: false });
  }

  private switchTab(tab: LedgerTab): void {
    if (tab === this.activeTab || (tab === 'tasks' && !this.gameState.tutorialDone)) return;
    this.activeTab = tab;
    if (tab === 'tasks') this.refreshTasks();
    else this.refresh();
    this.layoutTabs();
    // A soft pop as the page lands.
    const page = tab === 'tasks' ? this.tasksPage : this.ordersPage;
    page.setAlpha(0);
    this.scene.tweens.add({ targets: page, alpha: 1, duration: 140, ease: 'Sine.easeOut' });
  }

  /** Position + restyle the header tabs, and flip page visibility. The Tasks
   *  tab only exists post-tutorial; before that the Orders lozenge sits alone,
   *  centred, exactly like the tutorial's original Ledger title. */
  private layoutTabs(): void {
    const twoTabs = this.gameState.tutorialDone;
    this.tasksTab.root.setVisible(twoTabs);
    this.ordersTab.root.x = twoTabs ? -270 : 0;
    this.tasksTab.root.x = 270;
    this.paintTab(this.ordersTab, this.activeTab === 'orders');
    this.paintTab(this.tasksTab, this.activeTab === 'tasks');
    this.ordersPage.setVisible(this.activeTab === 'orders');
    this.tasksPage.setVisible(this.activeTab === 'tasks');
  }

  /** A header tab. State is LIGHT, not hue: the selected tab is a lit lozenge,
   *  the unselected one the same shape sunk into the frame. */
  private paintTab(tab: TabHandle, active: boolean): void {
    tab.bg.clear();
    tab.bg.fillStyle(num(active ? INK.fieldLift : INK.fieldDeep), active ? 1 : 0.9);
    tab.bg.fillRoundedRect(-TAB_W / 2, -TAB_H / 2, TAB_W, TAB_H, TAB_H / 2);
    tab.bg.lineStyle(6, num(active ? INK.gold : INK.goldDeep), active ? 1 : 0.75);
    tab.bg.strokeRoundedRect(-TAB_W / 2, -TAB_H / 2, TAB_W, TAB_H, TAB_H / 2);
    tab.label.setColor(active ? INK.onField : INK.onFieldDim);
    tab.label.setAlpha(active ? 1 : 0.85);
    tab.root.setScale(active ? 1 : 0.94);
  }

  private refresh(): void {
    const orders = this.orderSystem.activeOrders;
    this.emptyText.setVisible(orders.length === 0);
    this.blurb.setVisible(orders.length > 0);
    this.blurb.setText(orders[0] ? `”${orders[0].blurb}”` : '');

    // The Ledger belongs to whoever keeps it HERE: Selyna's board in the north
    // wears her name and her face, Eleanor's at home wears hers. Derived from
    // the orders data (OrderSystem.giverHere), never from a world-id table.
    const host = this.orderSystem.giverHere;
    this.ordersTab.label.setText(`${speakerName(host)}’s Orders`);
    this.emptyText.setText(
      `The brazier roars again!\n${speakerName(host)} will have new work for you soon.`
    );

    this.cards.forEach((card, i) => {
      const order = orders[i] ?? null;
      card.order = order;
      card.root.setVisible(order !== null);
      if (!order) {
        card.deliverable = false;
        return;
      }
      this.setMedallionGiver(card, order.giver ?? host);
      const requirement = order.requires[0];
      if (!requirement) return;
      const { have, deliverable } = this.orderSystem.progressFor(order);
      card.deliverable = deliverable;
      card.title.setText(order.title);
      const slotKey = `item_${requirement.chain}_${requirement.tier}`;
      // Contain-fit into the requirement SLOT, never the item's board scale:
      // board scale is tuned to a tile footprint, and doubling it put a
      // Radiant Gem at 230 units on a 144-unit slot — over the card's title.
      card.slotIcon.setTexture(slotKey);
      card.slotIcon.setScale(
        SLOT_ICON_FIT / Math.max(card.slotIcon.width, card.slotIcon.height)
      );
      card.slotCount.setText(`${have[0] ?? 0}/${requirement.count}`);
      const parts: string[] = [];
      if (order.rewards.coins) parts.push(`${order.rewards.coins}`);
      if (order.rewards.xp) parts.push(`✦ ${order.rewards.xp} XP`);
      if (order.rewards.spawn) parts.push('🎁 ???');
      if (order.rewards.tease) parts.push(order.rewards.tease);
      card.rewardText.setText(parts.join('   '));
      // The Gold figure leads the line, so its coin hangs off the line's left
      // edge — measured after setText, since the width moves with the rewards.
      const paysGold = !!order.rewards.coins;
      card.rewardCoin.setVisible(paysGold);
      if (paysGold) {
        const half = card.rewardText.width / 2;
        card.rewardCoin.setX(-half - 24);
        card.rewardText.setX(card.rewardCoin.displayWidth / 2 + 2);
      } else {
        card.rewardText.setX(0);
      }
      card.slotIcon.setAlpha(deliverable ? 1 : 0.75);
      card.deliverButton.setAlpha(deliverable ? 1 : 0.55);
    });
  }

  /** Repaint the checklist rows AND the tab's live done-counter. */
  private refreshTasks(): void {
    const rowTop = TASK_ROW_TOP;
    const rowGap = TASK_ROW_GAP;
    const barX = 160;
    let doneCount = 0;
    this.taskSystem.tasks.forEach((task, i) => {
      const row = this.taskRows[i];
      if (!row) return;
      const y = rowTop + i * rowGap;
      const progress = this.taskSystem.progressFor(task);
      const done = progress >= task.target;
      if (done) doneCount += 1;
      const locked = !done && this.taskSystem.isLocked(task);
      row.barBg.setVisible(!locked);
      row.count.setVisible(!locked);
      row.hint.setVisible(locked);
      row.count.setText(`${progress} / ${task.target}`);
      row.check.setVisible(done);
      row.fill.clear();
      if (!locked) {
        row.fill.fillStyle(num(done ? INK.gain : INK.gold), 1);
        row.fill.fillRoundedRect(barX, y + 18, Math.max(12, (progress / task.target) * 320), 22, 11);
      }
      row.label.setAlpha(done ? 0.62 : locked ? 0.5 : 1);
    });
    this.tasksTab.label.setText(`Keeper’s Tasks  ${doneCount}/${this.taskSystem.tasks.length}`);
  }
}
