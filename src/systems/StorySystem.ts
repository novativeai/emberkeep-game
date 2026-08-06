import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { DialogueData } from '../core/types';

/** The last chapter the campaign is written to (docs/story-bible.md §6). */
export const LAST_CHAPTER = 12;

/**
 * A chapter gate: the campaign may only advance INTO `chapter` when `met`
 * returns true. Gates read state that already exists — they never keep their own
 * counters, so a gate can't drift from the thing it claims to measure.
 */
interface ChapterGate {
  chapter: number;
  /** Which bus event could possibly have satisfied it (cheap pre-filter). */
  on: 'order:completed';
  met: (state: GameState) => boolean;
}

/**
 * Owns `state.storyChapter` — the single integer that selects every dialogue
 * bank in the game (Ledger banter, day-phase lines, trust milestones, Dragon
 * Book marginalia, Selyna's letters, the Elder).
 *
 * Chapters advance strictly one at a time and only forward, on a gate that reads
 * live state. That ordering is not a nicety: every chapter beat is written to
 * presuppose exactly what its quest made true (docs/quests.md §4), so a chapter
 * that fires early doesn't merely spoil the next reveal — it makes the lines
 * below it wrong.
 *
 * Gates for chapters 3+ land with the systems they read (the Cold Nest, Trust,
 * the Dragon Book). Until then the campaign stops at 2, which is the honest
 * behaviour: no gate, no chapter.
 */
export class StorySystem {
  private static readonly GATES: ChapterGate[] = [
    {
      // Ch 2 — "The Cold Brazier". Her first line is "the first thing anyone
      // has given back to this place in sixty years", so the gate is a
      // DELIVERED order, not an accepted one.
      chapter: 2,
      on: 'order:completed',
      met: (s) => s.completedOrderIds.length >= 1
    }
  ];

  constructor(
    private state: GameState,
    private bus: EventBus,
    private dialogue: DialogueData
  ) {
    bus.on('order:completed', () => this.evaluate('order:completed'));
    // The tutorial DELIVERS Eleanor's first order itself (the `ledger_deliver`
    // beat), and `evaluate` refuses to fire while the tutorial owns the bubble.
    // Without this the gate would sit satisfied but unread until the player's
    // SECOND delivery, and chapter 2's "the first thing anyone has given back in
    // sixty years" would land one order stale. Re-check at the handover instead,
    // which is also where it reads best. Idempotent: a done tutorial re-emits
    // this on every load, and an already-advanced chapter has no gate to meet.
    bus.on('tutorial:step', ({ done }) => {
      if (done) this.evaluate('order:completed');
    });
    bus.on('world:switched', ({ to }) => this.arrive(to));
  }

  /**
   * First time the Keeper has ever stood somewhere: play that world's arrival
   * beats, once ever.
   *
   * The latch is a `stats` flag, the same instrument the quest ladder uses, so
   * this adds no save field. It does NOT touch `storyChapter`: an arrival is an
   * occasion, not a rung, and the campaign's rungs must keep advancing one at a
   * time on gates that read live state (story-bible §6).
   */
  private arrive(worldId: string): void {
    if (!this.state.tutorialDone) return;
    if (!this.dialogue.arrivals?.[worldId]?.lines.length) return;
    const latch = `arrived:${worldId}`;
    if (this.state.stats[latch]) return;
    this.state.stats[latch] = 1;
    this.bus.emit('story:arrival', { worldId });
  }

  /** The beats for a first arrival in `worldId`, or null if none are authored. */
  arrivalBeats(worldId: string): { speaker: string; lines: string[] } | null {
    const entry = this.dialogue.arrivals?.[worldId];
    return entry?.lines.length ? { speaker: entry.speaker, lines: entry.lines } : null;
  }

  /** The chapter the player is in, 1..12. */
  get chapter(): number {
    return this.state.storyChapter;
  }

  /**
   * The Ledger banter bank for the current chapter. Six stages across twelve
   * chapters, so the same system says something new roughly every second
   * chapter. Falls back to the nearest lower stage that exists, so a missing
   * bank degrades to an older voice rather than to silence.
   */
  orderCompleteBank(): string[] {
    const stage = StorySystem.stageFor(this.chapter);
    const banks = this.dialogue.orderComplete;
    for (let s = stage; s >= 1; s--) {
      const bank = banks[String(s)];
      if (bank && bank.length) return bank;
    }
    return [];
  }

  /** Chapters 1–2 → stage 1, 3–4 → 2, … 11–12 → 6. */
  static stageFor(chapter: number): number {
    const clamped = Math.min(Math.max(chapter, 1), LAST_CHAPTER);
    return Math.floor((clamped - 1) / 2) + 1;
  }

  /**
   * The scene for a heart that just filled, or null if that milestone has none
   * authored.
   *
   * Regard is the second axis the dialogue banks are keyed on, and it is
   * ORTHOGONAL to the chapter: a player who gifts diligently reaches heart 3
   * chapters before one who only fills the Ledger, and both should hear the same
   * scene when they get there. So this reads hearts and nothing else — mixing
   * the two would make a milestone that fires at a different point for every
   * player also *say* something different, which is how a beat ends up
   * presupposing a reveal the player has not had.
   */
  regardBeats(characterId: string, hearts: number): { speaker: string; lines: string[] } | null {
    const entry = this.dialogue.regard?.[characterId]?.hearts?.[String(hearts)];
    return entry?.lines.length ? { speaker: entry.speaker, lines: entry.lines } : null;
  }

  /**
   * What she says as she takes a gift — or as she hands it back.
   *
   * Rotated by a caller-supplied index rather than at random, so the same act in
   * the same state always reads the same way (the determinism every other timed
   * thing in this game keeps for `advanceTime`).
   */
  giftLine(characterId: string, accepted: boolean, seed: number): string | null {
    const bank = this.dialogue.regard?.[characterId];
    const lines = accepted ? bank?.giftAccepted : bank?.giftDeclined;
    if (!lines?.length) return null;
    return lines[Math.abs(Math.floor(seed)) % lines.length] ?? null;
  }

  /** The beats to play on entering `chapter`, or null if it has none authored. */
  beatsFor(chapter: number): { speaker: string; lines: string[] } | null {
    const entry = this.dialogue.chapters?.[String(chapter)];
    if (!entry || !entry.lines.length) return null;
    return { speaker: entry.speaker, lines: entry.lines };
  }

  private evaluate(on: ChapterGate['on']): void {
    // The tutorial owns the bubble and the board until it is done; a chapter
    // beat firing over a scripted step would fight it for both.
    if (!this.state.tutorialDone) return;
    const next = this.state.storyChapter + 1;
    if (next > LAST_CHAPTER) return;
    const gate = StorySystem.GATES.find((g) => g.chapter === next);
    if (!gate || gate.on !== on || !gate.met(this.state)) return;
    this.state.storyChapter = next;
    this.bus.emit('story:chapter', { chapter: next });
  }
}
