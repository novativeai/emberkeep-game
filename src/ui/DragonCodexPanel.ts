import Phaser from 'phaser';
import { FONT } from '../art/design';
import {
  GAME_WIDTH,
  LIVE_GAME_HEIGHT,
  num,
  PALETTE,
  panelMobileScale,
  WELL_FED_EVOLUTION
} from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { ChainsData, DragondexData, DragondexEntry } from '../core/types';
import type { DragonSystem } from '../systems/DragonSystem';
import {
  CHIP_DY,
  CHIP_H,
  CONTENT_TOP,
  EVOLVE_DY,
  EVOLVE_H,
  LEFT_W,
  LEFT_X,
  leftColumnRoom,
  PORTRAIT_H,
  REVEAL_CONDITION_DY,
  REVEAL_CYCLES_DY,
  REVEAL_DY,
  REVEAL_FIT,
  REVEAL_INTO_DY,
  RIGHT_W,
  RIGHT_X
} from './codexLayout';
import { uiRegistry } from './theme';

/** The three pages the Codex turns between. */
type Page = 'roster' | 'detail' | 'evolution';

/** Ink the silhouette is painted in — near-night, so the adult reads as a
 *  promise rather than a spoiler. */
const SILHOUETTE_INK = 0x241b22;


/**
 * The Dragon Codex — the keepsake record of the dragons the Keeper has NAMED.
 *
 * Three pages inside the standard cream panel:
 *   • ROSTER — one face card per named dragon (Chapter One holds exactly one).
 *   • DETAIL — the lore card: story, personality, special ability and the
 *     well-fed cycle count on the left; the dragon's rest-pose sprite on the
 *     right; the Evolution button beneath.
 *   • EVOLUTION — the ADULT's reveal art as a silhouette (full colour once the
 *     condition is met) with the condition and live progress under it.
 *
 * Reads only: DragonSystem owns the names and the care records, dragondex.json
 * owns the words. The panel re-renders its live numbers off `dragon:well_fed`
 * while open, so the count can never lag a feeding.
 */
export class DragonCodexPanel extends Phaser.GameObjects.Container {
  isOpen = false;
  private readonly offBus: Array<() => void> = [];
  private baseScale = 1;
  private page: Page = 'roster';
  private pageRoster: Phaser.GameObjects.Container;
  private pageDetail: Phaser.GameObjects.Container;
  private pageEvolution: Phaser.GameObjects.Container;
  private title: Phaser.GameObjects.Text;
  private closeBtn!: Phaser.GameObjects.Container;
  /** The dragon the detail/evolution pages are showing. */
  private selected: { itemId: number; name: string; chain: string; tier: number } | null = null;
  /** Mid-cinematic (the tutorial's favourite-meal reveal): the favourite row is
   *  waiting to fade in, and `getClosePos` answers null so the tutorial arrow
   *  cannot point at the ✕ until the reveal has been SEEN. */
  private revealPending = false;
  private favouriteRow: Phaser.GameObjects.Container | null = null;

  constructor(
    scene: Phaser.Scene,
    private bus: EventBus,
    private dragons: DragonSystem,
    private dex: DragondexData,
    private chains: ChainsData
  ) {
    super(scene, GAME_WIDTH / 2, LIVE_GAME_HEIGHT / 2);

    const dim = scene.add
      .rectangle(0, 0, GAME_WIDTH, LIVE_GAME_HEIGHT, num(PALETTE.night), 0.45)
      .setInteractive();
    dim.on('pointerup', () => this.requestClose());
    this.add(dim);

    const panel = scene.add.image(0, 16, 'ui_panel');
    this.baseScale = panelMobileScale(panel.width);
    this.add(panel);

    const lozenge = scene.add.graphics();
    lozenge.fillStyle(num(PALETTE.gold), 1);
    lozenge.fillRoundedRect(-330, -436, 660, 104, 52);
    lozenge.lineStyle(6, num(PALETTE.cream), 0.95);
    lozenge.strokeRoundedRect(-330, -436, 660, 104, 52);
    this.add(lozenge);
    this.title = scene.add
      .text(0, -384, 'Dragon Codex', {
        fontFamily: FONT.ui,
        fontSize: '48px',
        fontStyle: 'bold',
        color: PALETTE.textBrown
      })
      .setOrigin(0.5)
      .setShadow(0, 3, 'rgba(255,255,255,0.5)', 3);
    this.add(this.title);

    this.pageRoster = scene.add.container(0, 0);
    this.pageDetail = scene.add.container(0, 0);
    this.pageEvolution = scene.add.container(0, 0);
    this.add([this.pageRoster, this.pageDetail, this.pageEvolution]);

    // The ✕ — the close affordance the tutorial's pointer aims at.
    this.closeBtn = scene.add.container(586, -384);
    const closePlate = scene.add.graphics();
    closePlate.fillStyle(num(PALETTE.lava), 1);
    closePlate.fillCircle(0, 0, 44);
    closePlate.lineStyle(5, num(PALETTE.cream), 0.95);
    closePlate.strokeCircle(0, 0, 44);
    const closeGlyph = scene.add
      .text(0, -2, '✕', { fontFamily: FONT.ui, fontSize: '42px', fontStyle: 'bold', color: PALETTE.cream })
      .setOrigin(0.5);
    this.closeBtn.add([closePlate, closeGlyph]);
    this.closeBtn.setSize(110, 110);
    this.closeBtn.setInteractive({ useHandCursor: true });
    this.closeBtn.on('pointerup', () => this.requestClose());
    this.add(this.closeBtn);

    scene.add.existing(this);
    this.setVisible(false);

    // The count on screen follows the record: a feeding that completes a cycle
    // while the card is open updates the number in place.
    this.offBus.push(
      bus.on('dragon:well_fed', () => {
        if (!this.isOpen || this.page === 'roster') return;
        this.showPage(this.page);
      }),
      bus.on('game:reset', () => this.requestClose())
    );

    uiRegistry.register(scene, 'panel.dragondex', 'Dragon Codex', 'Panels', this, {
      title: this.title
    });
  }

  open(): void {
    this.isOpen = true;
    this.revealPending = false;
    this.showPage('roster');
    this.setVisible(true);
    this.setAlpha(0);
    this.setScale(this.baseScale * 0.96);
    this.scene.tweens.add({
      targets: this,
      alpha: 1,
      scale: this.baseScale,
      duration: 180,
      ease: 'Back.easeOut'
    });
    this.bus.emit('ui:codex_toggled', { open: true });
  }

  requestClose(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.revealPending = false;
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      duration: 150,
      ease: 'Sine.easeIn',
      onComplete: () => this.setVisible(false)
    });
    this.bus.emit('ui:codex_toggled', { open: false });
  }

  teardown(): void {
    this.offBus.forEach((off) => off());
    this.offBus.length = 0;
  }

  // ------------------------------------------------------------------- pages

  private showPage(page: Page): void {
    this.page = page;
    this.pageRoster.setVisible(page === 'roster');
    this.pageDetail.setVisible(page === 'detail');
    this.pageEvolution.setVisible(page === 'evolution');
    if (page === 'roster') this.renderRoster();
    if (page === 'detail') this.renderDetail();
    if (page === 'evolution') this.renderEvolution();
  }

  private entryFor(chain: string): DragondexEntry | undefined {
    return this.dex.dragons[chain];
  }

  /** MAIN page — the dragons we have, face only. One card each. */
  private renderRoster(): void {
    this.pageRoster.removeAll(true);
    this.title.setText('Dragon Codex');
    const roster = this.dragons.namedDragons();

    if (!roster.length) {
      // Unreachable through the button (it only appears once a dragon is
      // named), but a page must never render blank.
      this.pageRoster.add(
        this.scene.add
          .text(0, -40, 'No dragon has told you its name yet.', {
            fontFamily: FONT.ui,
            fontSize: '32px',
            fontStyle: 'italic',
            color: '#8A6248'
          })
          .setOrigin(0.5)
      );
      return;
    }

    // Face cards on a centred row (wraps to a second row from the fifth on).
    const perRow = Math.min(roster.length, 4);
    const gap = 320;
    roster.forEach((dragon, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const x = (col - (perRow - 1) / 2) * gap;
      const y = -60 + row * 380;
      const card = this.scene.add.container(x, y);

      const plate = this.scene.add.graphics();
      plate.fillStyle(num(PALETTE.cream), 1);
      plate.fillRoundedRect(-130, -150, 260, 300, 28);
      plate.lineStyle(6, num(PALETTE.gold), 1);
      plate.strokeRoundedRect(-130, -150, 260, 300, 28);
      const face = this.scene.add.image(0, -34, 'ui_icon_dragondex');
      face.setDisplaySize(200, 200);
      const name = this.scene.add
        .text(0, 108, dragon.name, {
          fontFamily: FONT.ui,
          fontSize: '34px',
          fontStyle: 'bold',
          color: PALETTE.textBrown
        })
        .setOrigin(0.5);
      card.add([plate, face, name]);
      card.setSize(260, 300);
      card.setInteractive({ useHandCursor: true });
      card.on('pointerover', () => card.setScale(1.04));
      card.on('pointerout', () => card.setScale(1));
      card.on('pointerup', () => {
        this.selected = dragon;
        this.showPage('detail');
      });
      this.pageRoster.add(card);
    });
  }

  /**
   * The lore card: the words down the left, and the right column stacking the
   * rest-pose portrait, the cycle record and the Evolution button.
   *
   * Everything is measured against FIELD. The chip and the button used to sit
   * at fixed page coordinates below a column whose height depends on how long
   * the entry's prose runs — so a wordy breed pushed the taste rows under the
   * button and the chip out through the panel's bottom edge. They now live in
   * the RIGHT column, whose height is fixed, and the left column is a container
   * that scales itself down if its words ever outgrow the field. Neither can
   * spill, whatever an entry says.
   */
  private renderDetail(): void {
    this.pageDetail.removeAll(true);
    const dragon = this.selected;
    if (!dragon) {
      this.showPage('roster');
      return;
    }
    const entry = this.entryFor(dragon.chain);
    this.title.setText(dragon.name);
    this.pageDetail.add(this.backButton(() => this.showPage('roster')));

    // ---- left column: the words, in their own container --------------
    // Local coordinates start at 0 so the whole column can be scaled about its
    // top-left if it overruns — the one thing a fixed layout cannot do.
    const left = this.scene.add.container(LEFT_X, CONTENT_TOP);
    this.pageDetail.add(left);
    let y = 0;
    const block = (label: string, text: string, italic = false): void => {
      if (label) {
        left.add(
          this.scene.add.text(0, y, label, {
            fontFamily: FONT.ui,
            fontSize: '25px',
            fontStyle: 'bold',
            color: PALETTE.goldShade
          })
        );
        y += 34;
      }
      const body = this.scene.add.text(0, y, text, {
        fontFamily: FONT.ui,
        fontSize: '27px',
        fontStyle: italic ? 'italic' : 'normal',
        color: PALETTE.textBrown,
        wordWrap: { width: LEFT_W },
        lineSpacing: 4
      });
      left.add(body);
      y += body.height + 22;
    };
    block('', entry?.story ?? '', true);
    block('PERSONALITY', entry?.personality ?? '');
    block('SPECIAL ABILITY', entry?.ability ?? '');

    // ---- taste rows: written by EXPERIMENT, '???' until tested -------
    const taste = this.dragons.tasteKnowledge(dragon.itemId);
    y += 6;
    this.favouriteRow = this.tasteRow(0, y, 'FAVOURITE MEAL', taste.favourite);
    left.add(this.favouriteRow);
    if (this.revealPending) this.favouriteRow.setAlpha(0); // the cinematic owns its entrance
    y += 70;
    left.add(this.tasteRow(0, y, "WON'T TOUCH", taste.dislike));
    y += 62;

    // The column may not leave the field. Scaling is the honest answer: the
    // alternative is clipping words the card exists to be read for.
    const room = leftColumnRoom();
    if (y > room) left.setScale(room / y);

    // ---- right column: portrait, record, and the way forward ---------
    const cx = RIGHT_X + RIGHT_W / 2;
    const artKey = `item_${dragon.chain}_${dragon.tier}`;
    if (this.scene.textures.exists(artKey)) {
      const backing = this.scene.add.graphics();
      backing.fillStyle(num(PALETTE.gold), 0.1);
      backing.fillRoundedRect(RIGHT_X, CONTENT_TOP, RIGHT_W, PORTRAIT_H, 32);
      backing.lineStyle(4, num(PALETTE.gold), 0.5);
      backing.strokeRoundedRect(RIGHT_X, CONTENT_TOP, RIGHT_W, PORTRAIT_H, 32);
      this.pageDetail.add(backing);
      const sprite = this.scene.add.image(cx, CONTENT_TOP + PORTRAIT_H / 2, artKey);
      const fit = 330 / Math.max(sprite.width, sprite.height);
      sprite.setScale(fit);
      this.pageDetail.add(sprite);
      // The rest pose breathes — a keepsake, not a museum pin.
      this.scene.tweens.add({
        targets: sprite,
        scale: fit * 1.02,
        duration: 1600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    }

    // The cycle record — the number the feeding loop banks.
    const cycles = this.dragons.wellFedCyclesOf(dragon.itemId);
    const chipY = CONTENT_TOP + CHIP_DY;
    const chip = this.scene.add.graphics();
    chip.fillStyle(num(PALETTE.gold), 0.18);
    chip.fillRoundedRect(RIGHT_X, chipY, RIGHT_W, CHIP_H, CHIP_H / 2);
    chip.lineStyle(3, num(PALETTE.gold), 0.6);
    chip.strokeRoundedRect(RIGHT_X, chipY, RIGHT_W, CHIP_H, CHIP_H / 2);
    this.pageDetail.add(chip);
    this.pageDetail.add(
      this.scene.add
        .text(cx, chipY + CHIP_H / 2, `Well fed for ${cycles} cycle${cycles === 1 ? '' : 's'}`, {
          fontFamily: FONT.ui,
          fontSize: '28px',
          fontStyle: 'bold',
          color: PALETTE.goldShade
        })
        .setOrigin(0.5)
    );

    // ---- the Evolution button ---------------------------------------
    if (entry?.evolution) {
      const btn = this.scene.add.container(cx, CONTENT_TOP + EVOLVE_DY);
      const g = this.scene.add.graphics();
      g.fillStyle(num(PALETTE.gold), 1);
      g.fillRoundedRect(-RIGHT_W / 2, -EVOLVE_H / 2, RIGHT_W, EVOLVE_H, EVOLVE_H / 2);
      g.lineStyle(5, num(PALETTE.cream), 0.95);
      g.strokeRoundedRect(-RIGHT_W / 2, -EVOLVE_H / 2, RIGHT_W, EVOLVE_H, EVOLVE_H / 2);
      const label = this.scene.add
        .text(0, 0, 'Evolution', {
          fontFamily: FONT.ui,
          fontSize: '36px',
          fontStyle: 'bold',
          color: PALETTE.cream
        })
        .setOrigin(0.5)
        .setStroke(PALETTE.goldShade, 4);
      btn.add([g, label]);
      btn.setSize(RIGHT_W, EVOLVE_H);
      btn.setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setScale(1.05));
      btn.on('pointerout', () => btn.setScale(1));
      btn.on('pointerup', () => this.showPage('evolution'));
      this.pageDetail.add(btn);
    }
  }

  /** The promise page: the adult's reveal art as a silhouette, the condition
   *  under it — full colour the moment the condition is met. */
  private renderEvolution(): void {
    this.pageEvolution.removeAll(true);
    const dragon = this.selected;
    const entry = dragon && this.entryFor(dragon.chain);
    if (!dragon || !entry?.evolution) {
      this.showPage('detail');
      return;
    }
    this.title.setText('Evolution');
    this.pageEvolution.add(this.backButton(() => this.showPage('detail')));

    const needed = WELL_FED_EVOLUTION[dragon.chain] ?? entry.evolution.wellFedCycles;
    const cycles = this.dragons.wellFedCyclesOf(dragon.itemId);
    const met = cycles >= needed;

    // Sized to the FIELD, not to the art: at 560 the card reached up under the
    // title lozenge and pushed the three lines below it onto the panel's
    // bottom border. 420 clears both with room either side.
    if (this.scene.textures.exists(entry.evolution.reveal)) {
      const art = this.scene.add.image(0, CONTENT_TOP + REVEAL_DY, entry.evolution.reveal);
      const fit = REVEAL_FIT / Math.max(art.width, art.height);
      art.setScale(fit);
      if (met) {
        // Earned: the silhouette steps aside and the adult stands in colour.
        art.setAlpha(0);
        this.scene.tweens.add({ targets: art, alpha: 1, duration: 600, ease: 'Sine.easeOut' });
      } else {
        art.setTintFill(SILHOUETTE_INK);
        art.setAlpha(0.92);
      }
      this.pageEvolution.add(art);
    }

    this.pageEvolution.add(
      this.scene.add
        .text(0, CONTENT_TOP + REVEAL_INTO_DY, met ? entry.evolution.into : `???  ·  ${entry.evolution.into.replace(/\S/g, '?')}`, {
          fontFamily: FONT.ui,
          fontSize: '40px',
          fontStyle: 'bold',
          color: met ? PALETTE.goldShade : '#8A6248'
        })
        .setOrigin(0.5)
    );
    this.pageEvolution.add(
      this.scene.add
        .text(0, CONTENT_TOP + REVEAL_CONDITION_DY, entry.evolution.condition, {
          fontFamily: FONT.ui,
          fontSize: '30px',
          fontStyle: 'italic',
          color: '#8A6248'
        })
        .setOrigin(0.5)
    );
    this.pageEvolution.add(
      this.scene.add
        .text(0, CONTENT_TOP + REVEAL_CYCLES_DY, `${Math.min(cycles, needed)} / ${needed} cycles`, {
          fontFamily: FONT.ui,
          fontSize: '34px',
          fontStyle: 'bold',
          color: met ? PALETTE.goldShade : PALETTE.textBrown
        })
        .setOrigin(0.5)
    );
  }

  /**
   * One taste row: label, then the food's icon and name — or '???' until the
   * player has actually TESTED it (fed the favourite / been refused). The
   * chain's tier-1 piece names the food family.
   */
  private tasteRow(
    x: number,
    y: number,
    label: string,
    taste: { chain: string; known: boolean }
  ): Phaser.GameObjects.Container {
    const row = this.scene.add.container(0, 0);
    row.setData('rowAt', { x, y }); // children carry page coords — remembered for the reveal glow
    row.add(
      this.scene.add.text(x, y, label, {
        fontFamily: FONT.ui,
        fontSize: '26px',
        fontStyle: 'bold',
        color: PALETTE.goldShade
      })
    );
    const foodName = taste.known
      ? this.chains.chains.find((c) => c.id === taste.chain)?.tiers.find((t) => t.tier === 1)?.name ??
        taste.chain
      : '???';
    let tx = x + 290;
    const iconKey = `item_${taste.chain}_1`;
    if (taste.known && this.scene.textures.exists(iconKey)) {
      const chip = this.scene.add.graphics();
      chip.fillStyle(num(PALETTE.gold), 0.16);
      chip.fillCircle(tx + 26, y + 16, 32);
      row.add(chip);
      const icon = this.scene.add.image(tx + 26, y + 16, iconKey);
      icon.setDisplaySize(52, 52);
      row.add(icon);
      tx += 70;
    }
    row.add(
      this.scene.add.text(tx, y, foodName, {
        fontFamily: FONT.ui,
        fontSize: '28px',
        fontStyle: taste.known ? 'bold' : 'italic',
        color: taste.known ? PALETTE.textBrown : '#8A6248'
      })
    );
    return row;
  }

  /**
   * The tutorial's cinematic: open straight onto this dragon's page with the
   * favourite row held back, then let it FADE IN — a gold bloom, the row
   * settling, and only then does `getClosePos` start answering, so the
   * tutorial's arrow points at the ✕ after the reveal, never through it.
   */
  openReveal(itemId: number): void {
    const dragon = this.dragons.namedDragons().find((d) => d.itemId === itemId) ??
      this.dragons.namedDragons()[0];
    if (!dragon) return;
    this.selected = dragon;
    this.revealPending = true;
    this.isOpen = true;
    this.showPage('detail');
    this.setVisible(true);
    this.setAlpha(0);
    this.setScale(this.baseScale * 0.96);
    this.scene.tweens.add({
      targets: this,
      alpha: 1,
      scale: this.baseScale,
      duration: 220,
      ease: 'Back.easeOut'
    });
    this.bus.emit('ui:codex_toggled', { open: true });

    this.scene.time.delayedCall(1000, () => {
      const row = this.favouriteRow;
      if (!row?.active || !this.isOpen) {
        this.revealPending = false;
        return;
      }
      // The bloom behind the line — the book writing, made visible.
      const at = row.getData('rowAt') as { x: number; y: number };
      const glow = this.scene.add.graphics();
      glow.fillStyle(num(PALETTE.goldAccent), 0.35);
      glow.fillRoundedRect(at.x - 14, at.y - 10, 560, 62, 31);
      glow.setAlpha(0);
      row.addAt(glow, 0);
      this.scene.tweens.add({
        targets: glow,
        alpha: { from: 0, to: 1 },
        duration: 420,
        yoyo: true,
        hold: 500,
        ease: 'Sine.easeInOut',
        onComplete: () => glow.destroy()
      });
      row.setScale(1.12);
      this.scene.tweens.add({
        targets: row,
        alpha: 1,
        scale: 1,
        duration: 700,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.revealPending = false; // NOW the arrow may point at the ✕
        }
      });
    });
  }

  /** The ✕, for the tutorial's pointer — null while closed OR while the
   *  favourite reveal is still playing. */
  getClosePos(): { x: number; y: number } | null {
    if (!this.isOpen || this.revealPending || !this.visible) return null;
    const m = this.closeBtn.getWorldTransformMatrix();
    return { x: m.tx, y: m.ty };
  }

  /** The ‹ Back pill every inner page carries, top-left of the spread. */
  private backButton(onTap: () => void): Phaser.GameObjects.Container {
    const btn = this.scene.add.container(-560, -384);
    const g = this.scene.add.graphics();
    g.fillStyle(num(PALETTE.plum), 0.9);
    g.fillRoundedRect(-84, -36, 168, 72, 36);
    g.lineStyle(4, num(PALETTE.cream), 0.8);
    g.strokeRoundedRect(-84, -36, 168, 72, 36);
    const label = this.scene.add
      .text(0, 0, '‹ Back', {
        fontFamily: FONT.ui,
        fontSize: '30px',
        fontStyle: 'bold',
        color: PALETTE.cream
      })
      .setOrigin(0.5);
    btn.add([g, label]);
    btn.setSize(168, 72);
    btn.setInteractive({ useHandCursor: true });
    btn.on('pointerup', onTap);
    return btn;
  }
}
