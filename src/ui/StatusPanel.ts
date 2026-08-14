import Phaser from 'phaser';
import { FONT, INK, TYPE } from '../art/design';
import {
  DAILY_GREEN,
  LIVE_GAME_WIDTH,
  MEALS_PER_DAY,
  STATUS_FADE_IN_MS,
  STATUS_FADE_OUT_MS,
  STATUS_FLASH_MS,
  STATUS_READOUT_GAP,
  STATUS_READOUT_H,
  UI_SCALE
} from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { ChainsData } from '../core/types';
import { speakerName } from '../entities/CharacterBubble';
import type { DragonSystem } from '../systems/DragonSystem';
import type { RegardSystem } from '../systems/RegardSystem';
import { GaugeBar } from './GaugeBar';
import { HeartRow } from './HeartRow';
import { QUEST_TRACKER_BOTTOM, QUEST_TRACKER_RIGHT, QUEST_TRACKER_TOP_Y } from './QuestTracker';
import { uiRegistry } from './theme';

/** Air between the quest cluster's last row and the name line under it, and
 *  the readout's own height. Both live in Constants because the HUD COLUMN is
 *  fitted to clear this readout — see HUD_COLUMN_PITCH. Moving a row here
 *  without moving STATUS_READOUT_H there is how the Codex button ended up with
 *  a dragon's name printed across it. */
const GAP = STATUS_READOUT_GAP;

const NAME_Y = 0;
const HEARTS_Y = 58;
const LINE_Y = 96;
/** The rows above must fit inside the height the column clears. */
if (LINE_Y + 30 > STATUS_READOUT_H) {
  throw new Error(`StatusPanel is taller than STATUS_READOUT_H (${STATUS_READOUT_H})`);
}

/** Heart size here is smaller than the board's was: this is a readout in a
 *  column of text, not a badge worn over somebody's head. */
const HEART_SIZE = 34;
const HEART_GAP = 8;

/** The dragon's hunger gauge, seated on the same row the hearts use. */
const GAUGE_W = 300;
const GAUGE_H = 30;

export type SubjectKind = 'character' | 'dragon';
export interface Subject {
  kind: SubjectKind;
  id: string;
}

/**
 * WHO AM I LOOKING AT — the status readout under the quest tracker.
 *
 * One subject at a time: a world character, whose five hearts are her Regard, or
 * a board dragon, whose five hearts are its Trust and whose second line is what
 * today's feeding still owes it. Both relationships are the same five-heart
 * shape on purpose (`TRUST_MAX === REGARD_HEARTS`) — the game has one gauge for
 * "how does this person/animal feel about me", and one place to read it.
 *
 * ## Why it is here and not over their heads
 *
 * The hearts used to float above each standee. That put a permanent gauge on the
 * board for somebody the player was not looking at, competing with the pieces
 * for the same few hundred pixels, and it had nowhere to put a dragon's feeding
 * line at all. A HUD slot under the quests answers both: the quest cluster
 * already says "what am I doing", so directly below it is where "and who am I
 * doing it with" belongs.
 *
 * ## Two ways it appears
 *
 *   • **Selected** — the player tapped somebody. It holds until they tap away,
 *     because that is a question they asked.
 *   • **Flashed** — a value MOVED (a quest paid Regard, a dragon was fed). It
 *     shows the subject that changed for `STATUS_FLASH_MS` and fades out again.
 *     Nobody asked, so it does not stay; but a number that changes off-screen
 *     may as well not have changed.
 *
 * A flash over a live selection reverts to the selection when it expires rather
 * than to nothing — the player's own question outlives the interruption.
 *
 * NO BACKGROUND, deliberately and like the quest tracker above it: legibility is
 * a dark stroke plus a soft shadow on the glyphs. A plate here would read as a
 * panel, and panels in this game are things you open.
 */
export class StatusPanel extends Phaser.GameObjects.Container {
  private nameText: Phaser.GameObjects.Text;
  private lineText: Phaser.GameObjects.Text;
  private hearts: HeartRow;
  private hunger: GaugeBar;

  /** The subject the player chose. Survives a flash. */
  private pinned: Subject | null = null;
  /** What is on screen right now — the flash subject if one is running. */
  private showing: Subject | null = null;
  private flashTimer: Phaser.Time.TimerEvent | null = null;
  private fade: Phaser.Tweens.Tween | null = null;

  /**
   * Off until the game has a reason to show it. Chapter One's opening minutes
   * are a scripted queue of one idea at a time, so a gauge nothing has taught
   * yet is noise sitting on top of the lesson — the tutorial turns it on for the
   * beat that teaches feeding, and it stays on once the game is handed over.
   */
  private enabled = false;

  private readonly owner: Phaser.Scene;
  private readonly offBus: Array<() => void> = [];

  constructor(
    scene: Phaser.Scene,
    bus: EventBus,
    private game: GameState,
    private chains: ChainsData,
    private regard: RegardSystem,
    private dragons: DragonSystem
  ) {
    super(
      scene,
      LIVE_GAME_WIDTH - QUEST_TRACKER_RIGHT,
      QUEST_TRACKER_TOP_Y + (QUEST_TRACKER_BOTTOM + GAP) * UI_SCALE
    );
    this.owner = scene;
    this.setScale(UI_SCALE); // magnifies down-left from the same anchor the tracker uses
    this.setAlpha(0).setVisible(false);

    this.nameText = this.styleText(
      scene.add.text(0, NAME_Y, '', {
        fontFamily: FONT.ui,
        fontSize: `${TYPE.sub}px`,
        fontStyle: 'bold',
        color: INK.onField,
        align: 'right'
      })
    );
    this.lineText = this.styleText(
      scene.add.text(0, LINE_Y, '', {
        fontFamily: FONT.ui,
        fontSize: `${TYPE.label}px`,
        fontStyle: 'bold',
        color: INK.onFieldGold,
        align: 'right'
      }),
      5
    );
    // The row is centre-anchored, so it is seated by its own half-width to land
    // its right edge on the same margin the text is right-aligned to.
    this.hearts = new HeartRow(scene, 0, HEARTS_Y, HEART_SIZE, HEART_GAP);
    this.hearts.setX(-this.hearts.rowWidth / 2);
    // Right-anchored like every line in this readout, so the bar's right edge
    // lands on the same margin the text does.
    this.hunger = new GaugeBar(scene, 0, HEARTS_Y, GAUGE_W, GAUGE_H);
    this.hunger.setX(-GAUGE_W);
    this.add([this.nameText, this.hearts, this.hunger, this.lineText]);
    scene.add.existing(this);

    uiRegistry.register(scene, 'hud.status', 'Status readout', 'HUD', this, {
      nameText: this.nameText,
      lineText: this.lineText
    });

    this.offBus.push(
      bus.on('ui:subject_selected', ({ kind, id }) => this.select({ kind, id })),
      bus.on('ui:subject_cleared', () => this.deselect()),
      // A value moved. Each of these names its own subject, so the readout never
      // has to guess which of the two people or which dragon it belongs to.
      bus.on('regard:changed', ({ characterId }) =>
        this.onChanged({ kind: 'character', id: characterId })
      ),
      bus.on('regard:heart', ({ characterId, hearts }) => {
        this.onChanged({ kind: 'character', id: characterId });
        if (this.isShowing({ kind: 'character', id: characterId })) this.hearts.pulse(hearts - 1);
      }),
      bus.on('dragon:fed', ({ itemId }) => this.onChanged({ kind: 'dragon', id: String(itemId) })),
      // Being named is a change worth showing unasked — it is the first time the
      // readout has anything to say about her.
      bus.on('dragon:named', ({ itemId }) => this.onChanged({ kind: 'dragon', id: String(itemId) })),
      // Trust still moves under the hood, and a dragon's readout should still
      // surface when it does — but it no longer pulses a heart, because a
      // dragon has no hearts to pulse. Its gauge is hunger.
      bus.on('dragon:trust_changed', ({ itemId }) =>
        this.onChanged({ kind: 'dragon', id: String(itemId) })
      )
    );
  }

  /** Same legibility contract as the quest tracker: no plate, so the glyphs
   *  carry a dark stroke for edge contrast and a soft shadow to lift them off
   *  bright cloud. */
  private styleText(text: Phaser.GameObjects.Text, strokeW = 6): Phaser.GameObjects.Text {
    return text
      .setOrigin(1, 0)
      .setStroke('rgba(36,27,34,0.62)', strokeW)
      .setShadow(0, 4, 'rgba(36,27,34,0.55)', 9);
  }

  /**
   * Where a tutorial marker should sit to point at this readout: the top-right
   * of the name line, plus the block's height so the arrow can be placed clear
   * of the hearts instead of across them.
   *
   * Null while it is not on screen — a marker pointing at an invisible readout
   * would hang over empty sky (tutorial-design law 4).
   */
  getMarkerPos(): { x: number; y: number; height: number } | null {
    if (!this.visible || this.alpha < 0.05) return null;
    return {
      x: this.x - (this.nameText.width / 2) * this.scaleX,
      y: this.y,
      height: (LINE_Y + TYPE.label) * this.scaleY
    };
  }

  teardown(): void {
    this.offBus.forEach((off) => off());
    this.offBus.length = 0;
    this.flashTimer?.remove();
    this.flashTimer = null;
  }

  /**
   * Turn the readout on or off wholesale.
   *
   * Turning it OFF also drops the selection: a readout that comes back holding
   * whoever the player happened to tap several minutes ago is worse than one
   * that comes back empty.
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.pinned = null;
      this.showing = null;
      this.stopFlash();
      this.fadeTo(0);
    }
  }

  // ------------------------------------------------------------------ subjects

  private select(subject: Subject): void {
    this.pinned = subject;
    this.stopFlash();
    this.present(subject);
  }

  private deselect(): void {
    this.pinned = null;
    // A flash still in flight is finishing its own job — let it, and it will
    // find no pin to fall back to when it expires.
    if (this.flashTimer) return;
    this.showing = null;
    this.fadeTo(0);
  }

  /**
   * Somebody's number moved.
   *
   * If it is the subject already on screen this is just a repaint — no fade, no
   * timer, because the player is watching it happen. Otherwise it is a flash:
   * show that subject for a beat and hand the screen back.
   */
  private onChanged(subject: Subject): void {
    if (!this.enabled) return;
    if (this.isShowing(subject)) {
      this.paint(subject);
      // Only a PINNED subject holds indefinitely. A flash that is repainted is
      // still a flash, and its timer keeps running — restarting it on every
      // helping would let a fast feeder pin the readout open by accident.
      return;
    }
    this.present(subject);
    this.startFlash();
  }

  private isShowing(subject: Subject): boolean {
    return this.showing?.kind === subject.kind && this.showing.id === subject.id;
  }

  private present(subject: Subject): void {
    if (!this.enabled) return;
    if (!this.paint(subject)) return;
    this.showing = subject;
    this.fadeTo(1);
  }

  private startFlash(): void {
    this.stopFlash();
    this.flashTimer = this.owner.time.delayedCall(STATUS_FLASH_MS, () => {
      this.flashTimer = null;
      // Back to whoever the player actually chose, or off the screen.
      if (this.pinned) {
        this.present(this.pinned);
        return;
      }
      this.showing = null;
      this.fadeTo(0);
    });
  }

  private stopFlash(): void {
    this.flashTimer?.remove();
    this.flashTimer = null;
  }

  private fadeTo(alpha: number): void {
    this.fade?.remove();
    if (alpha > 0) this.setVisible(true);
    this.fade = this.owner.tweens.add({
      targets: this,
      alpha,
      duration: alpha > 0 ? STATUS_FADE_IN_MS : STATUS_FADE_OUT_MS,
      ease: alpha > 0 ? 'Sine.easeOut' : 'Sine.easeIn',
      onComplete: () => {
        this.fade = null;
        if (alpha === 0) this.setVisible(false);
      }
    });
  }

  // -------------------------------------------------------------------- paint

  /** Fill in the three lines for a subject. False when the subject no longer
   *  exists — a dragon that has just been merged away, a character on another
   *  world — and the caller then leaves the readout alone. */
  private paint(subject: Subject): boolean {
    return subject.kind === 'character'
      ? this.paintCharacter(subject.id)
      : this.paintDragon(Number(subject.id));
  }

  private paintCharacter(characterId: string): boolean {
    if (!this.regard.characterIds.includes(characterId)) return false;
    const { have, need } = this.regard.progress(characterId);
    this.nameText.setText(speakerName(characterId));
    this.hearts.setVisible(true);
    this.hunger.setVisible(false);
    this.hearts.set(this.regard.hearts(characterId), need > 0 ? have / need : 0);
    this.hearts.setDim(false);
    // Her hearts ARE the sentence; a second line would be the number the gauge
    // exists to avoid (docs/quests.md §1.3 — Regard is expressed as conduct).
    this.lineText.setText('');
    return true;
  }

  private paintDragon(itemId: number): boolean {
    const item = this.game.items.get(itemId);
    if (!item || !this.dragons.isBoardDragon(item)) return false;
    const { meals, green } = this.dragons.boardNeeds(itemId);
    // Her NAME wins over her breed the moment she has one — that is the whole
    // point of having asked for it.
    this.nameText.setText(item.dragonName ?? this.dragonName(item.chain, item.tier));

    // A dragon gets a HUNGER bar, never the hearts. The hearts are Regard, and
    // Regard is Eleanor's and Selyna's — a relationship that only climbs and is
    // read as conduct. Hunger empties daily and is acted on directly; drawing
    // both on one five-heart shape claimed they were the same measure.
    this.hearts.setVisible(false);
    this.hunger.setVisible(true);
    const eaten = MEALS_PER_DAY - meals;
    this.hunger.set(eaten / MEALS_PER_DAY, MEALS_PER_DAY, meals <= 0);

    const fed = `Fed ${fmt(eaten)} / ${MEALS_PER_DAY} today`;
    // ONE need at a time, the more urgent first: a readout that lists everything
    // wrong at once teaches nothing about which to fix.
    const want =
      meals > 0
        ? green >= DAILY_GREEN
          ? ' · hungry, and wants greens'
          : ' · still hungry'
        : green >= DAILY_GREEN
          ? ' · wants greens'
          : ' · well fed';
    this.lineText.setText(fed + want);
    return true;
  }

  /** "Red Dragon" — the tier's authored name, so the readout and the Cookbook
   *  call the same animal the same thing. */
  private dragonName(chain: string, tier: number): string {
    return (
      this.chains.chains.find((c) => c.id === chain)?.tiers.find((t) => t.tier === tier)?.name ??
      'Dragon'
    );
  }
}

/** Servings are taste-weighted, so they are genuinely fractional: a Moss Tuft is
 *  a quarter of a meal. Print the quarter when there is one and never a
 *  trailing `.0`, which reads as precision the number does not have. */
const fmt = (n: number): string => {
  const rounded = Math.round(n * 4) / 4;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, '');
};
