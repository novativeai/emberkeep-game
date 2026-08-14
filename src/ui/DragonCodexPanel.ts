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
import type { DragondexData, DragondexEntry } from '../core/types';
import type { DragonSystem } from '../systems/DragonSystem';
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
  /** The dragon the detail/evolution pages are showing. */
  private selected: { itemId: number; name: string; chain: string; tier: number } | null = null;

  constructor(
    scene: Phaser.Scene,
    private bus: EventBus,
    private dragons: DragonSystem,
    private dex: DragondexData
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

  /** The lore card: words left, rest-pose sprite right, Evolution below. */
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

    // ---- left column: the words -------------------------------------
    const leftX = -420;
    let y = -270;
    const block = (label: string, text: string, italic = false): void => {
      if (label) {
        this.pageDetail.add(
          this.scene.add.text(leftX, y, label, {
            fontFamily: FONT.ui,
            fontSize: '26px',
            fontStyle: 'bold',
            color: PALETTE.goldShade
          })
        );
        y += 40;
      }
      const body = this.scene.add.text(leftX, y, text, {
        fontFamily: FONT.ui,
        fontSize: '28px',
        fontStyle: italic ? 'italic' : 'normal',
        color: PALETTE.textBrown,
        wordWrap: { width: 520 },
        lineSpacing: 6
      });
      this.pageDetail.add(body);
      y += body.height + 34;
    };
    block('', entry?.story ?? '', true);
    block('PERSONALITY', entry?.personality ?? '');
    block('SPECIAL ABILITY', entry?.ability ?? '');

    // The cycle record — the number the feeding loop banks.
    const cycles = this.dragons.wellFedCyclesOf(dragon.itemId);
    const chip = this.scene.add.graphics();
    chip.fillStyle(num(PALETTE.gold), 0.18);
    chip.fillRoundedRect(leftX - 14, y - 8, 548, 64, 32);
    chip.lineStyle(3, num(PALETTE.gold), 0.6);
    chip.strokeRoundedRect(leftX - 14, y - 8, 548, 64, 32);
    this.pageDetail.add(chip);
    this.pageDetail.add(
      this.scene.add.text(leftX + 8, y + 4, `Well fed for ${cycles} cycle${cycles === 1 ? '' : 's'}`, {
        fontFamily: FONT.ui,
        fontSize: '30px',
        fontStyle: 'bold',
        color: PALETTE.goldShade
      })
    );

    // ---- right column: the rest-pose sprite -------------------------
    const artKey = `item_${dragon.chain}_${dragon.tier}`;
    if (this.scene.textures.exists(artKey)) {
      const backing = this.scene.add.graphics();
      backing.fillStyle(num(PALETTE.gold), 0.1);
      backing.fillRoundedRect(150, -300, 520, 560, 36);
      backing.lineStyle(4, num(PALETTE.gold), 0.5);
      backing.strokeRoundedRect(150, -300, 520, 560, 36);
      this.pageDetail.add(backing);
      const sprite = this.scene.add.image(410, -30, artKey);
      const fit = 440 / Math.max(sprite.width, sprite.height);
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

    // ---- the Evolution button ---------------------------------------
    if (entry?.evolution) {
      const btn = this.scene.add.container(0, 380);
      const g = this.scene.add.graphics();
      g.fillStyle(num(PALETTE.gold), 1);
      g.fillRoundedRect(-190, -46, 380, 92, 46);
      g.lineStyle(5, num(PALETTE.cream), 0.95);
      g.strokeRoundedRect(-190, -46, 380, 92, 46);
      const label = this.scene.add
        .text(0, 0, 'Evolution', {
          fontFamily: FONT.ui,
          fontSize: '38px',
          fontStyle: 'bold',
          color: PALETTE.cream
        })
        .setOrigin(0.5)
        .setStroke(PALETTE.goldShade, 4);
      btn.add([g, label]);
      btn.setSize(380, 92);
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

    if (this.scene.textures.exists(entry.evolution.reveal)) {
      const art = this.scene.add.image(0, -80, entry.evolution.reveal);
      const fit = 560 / Math.max(art.width, art.height);
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
        .text(0, 250, met ? entry.evolution.into : `???  ·  ${entry.evolution.into.replace(/\S/g, '?')}`, {
          fontFamily: FONT.ui,
          fontSize: '40px',
          fontStyle: 'bold',
          color: met ? PALETTE.goldShade : '#8A6248'
        })
        .setOrigin(0.5)
    );
    this.pageEvolution.add(
      this.scene.add
        .text(0, 318, entry.evolution.condition, {
          fontFamily: FONT.ui,
          fontSize: '30px',
          fontStyle: 'italic',
          color: '#8A6248'
        })
        .setOrigin(0.5)
    );
    this.pageEvolution.add(
      this.scene.add
        .text(0, 378, `${Math.min(cycles, needed)} / ${needed} cycles`, {
          fontFamily: FONT.ui,
          fontSize: '34px',
          fontStyle: 'bold',
          color: met ? PALETTE.goldShade : PALETTE.textBrown
        })
        .setOrigin(0.5)
    );
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
