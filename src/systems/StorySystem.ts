import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { DialogueData } from '../core/types';

/** The last chapter the campaign is written to (docs/story-bible.md §6). */
export const LAST_CHAPTER = 12;

/**
 * Everything a chapter gate is allowed to know.
 *
 * Deliberately tiny, and deliberately NOT `GameState`. A gate has no counters of
 * its own and is re-asked from scratch on every trigger, so its predicate must
 * be MONOTONE: once true, true forever. Every field here is monotone by
 * construction — `stats` are latches and counters that only ever climb,
 * `completedOrderIds` only grows, `level` only rises, `tutorialDone` only flips
 * on. Reaching past this interface is how a gate ends up reading `state.items`,
 * where a piece sold, bagged, merged or carried to another world takes the
 * chapter's precondition with it: the gate goes true, then false, and — because
 * a chapter only ever fires on the ONE tick its trigger arrives — is never seen
 * true again.
 *
 * `GameState` satisfies this structurally, so the runtime call site is unchanged
 * and the offline audit (src/core/campaign.ts) can construct the same facts
 * without a save, a board or a Phaser scene.
 */
export interface CampaignFacts {
  /** A `stats` counter or latch, 0 when absent. */
  stat(key: string): number;
  /** Ledger orders delivered, ever. */
  readonly completedOrderIds: readonly string[];
  readonly level: number;
  readonly tutorialDone: boolean;
  readonly storyChapter: number;
}

/**
 * The facts a gate can be woken by.
 *
 * This is a pre-filter, not a truth: `evaluate` still asks `met`. But it is a
 * LOAD-BEARING pre-filter — a gate whose `on` never fires is a gate that is
 * never asked, so the union has to cover every fact a gate is allowed to read.
 *
 * A chapter opened on any of them is durable, because `story:chapter` is itself
 * in SaveSystem's `SAVE_ON` and the pointer is written before it is emitted.
 * Four of the five facts are on that list in their own right too — but
 * `dragon:revealed` is NOT, and neither is `item:hatched`: RevealSystem
 * subscribes to `item:merged` AFTER SaveSystem does, so the `reveal:<chain>:
 * <tier>` latch lands just after the save that merge triggered and waits for the
 * next one. Harmless while the chapter fires anyway; the day a gate has to sit
 * on an unsatisfied reveal across a reload, `dragon:revealed` belongs on
 * `SAVE_ON` first.
 *
 * `recheck` is the catch-up label and the only WILDCARD: it means "something
 * happened that is not itself a gate trigger — re-ask whatever gate is next".
 * It is what opens a chapter whose condition was satisfied while the game was
 * closed, or during the tutorial, or while an earlier chapter was still
 * speaking. Without it the ladder can only ever move on the exact tick of the
 * exact fact its next gate names.
 */
export type ChapterTrigger =
  | 'order:completed'
  | 'quest:completed'
  | 'dragon:named'
  | 'dragon:trust_changed'
  | 'dragon:revealed'
  | 'recheck';

/** The bus facts that wake the ladder. `recheck` is not one of them — it is
 *  synthesised at the handover and after a chapter finishes speaking. */
const TRIGGERS = [
  'order:completed',
  'quest:completed',
  'dragon:named',
  'dragon:trust_changed',
  'dragon:revealed'
] as const;

/**
 * A chapter gate: the campaign may only advance INTO `chapter` when `met`
 * returns true. Gates read state that already exists — they never keep their own
 * counters, so a gate can't drift from the thing it claims to measure.
 */
export interface ChapterGate {
  chapter: number;
  /** Which bus fact could possibly have satisfied it (cheap pre-filter). */
  on: ChapterTrigger;
  met: (facts: CampaignFacts) => boolean;
}

/**
 * THE LADDER. Exported because `pnpm chapters` walks a whole campaign timeline
 * against these exact predicates — the audit and the running game must never
 * hold two ideas of what a gate says.
 *
 * Strictly sequential and strictly consecutive: `evaluate` only ever looks up
 * `storyChapter + 1`, so a gap is not a pause, it is a wall. A gate for chapter
 * 7 with nothing at 6 is DEAD CODE, and the audit says so out loud.
 */
export const CHAPTER_GATES: readonly ChapterGate[] = [
  {
    // Ch 2 — "The Cold Brazier". Her first line is "the first thing anyone
    // has given back to this place in sixty years", so the gate is a
    // DELIVERED order, not an accepted one.
    chapter: 2,
    on: 'order:completed',
    met: (f) => f.completedOrderIds.length >= 1
  }
];

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
  /**
   * The chapter announced by the cascade that is unwinding right now, or null.
   *
   * ONE CHAPTER PER CASCADE. Two chapters advancing in one tick is the normal
   * case once more than one gate exists — a delivery finishes a quest which
   * finishes another, all inside a single synchronous bus chain — and UIScene
   * schedules every chapter's beats on the same `TIMINGS.chapterBeatDelay`, so
   * two announcements one tick apart land two timers that fire in the same
   * frame. This spreads them: the second chapter is not advanced here, it waits
   * for the next wake (the beats' ack, or simply the next fact a gate names).
   *
   * IT IS A HOLD, NOT A LOCK, AND THAT IS THE WHOLE POINT. It used to be
   * `speaking`, a latch set here and cleared ONLY by the `story:beats_finished`
   * ack — a callback owned by the bubble, which drops it whenever anything else
   * takes the bubble (`CharacterBubble.cancelSequence`), and by no other path at
   * all, not even a reset. One dropped callback and `evaluate` returned early
   * for the rest of the session: the campaign silently over. A latch whose only
   * key is held by another object is a deadlock with extra steps, so this one is
   * released by the RUNTIME instead — `queueMicrotask` runs after the emit chain
   * drains and before any timer or frame, and nothing can decline to run it.
   *
   * What the old latch also claimed to do — keep a chapter's lines from being
   * wiped mid-run by the next chapter's — was never the ladder's to promise: it
   * only ever covered chapter-versus-chapter, and left a chapter's beats to be
   * eaten by an arrival, a tour or an authored event just the same. That
   * property belongs to the object that owns the lines, so `CharacterBubble`
   * now QUEUES a sequence behind the one it is playing instead of replacing it,
   * for every pair of speakers rather than this one.
   */
  private announced: number | null = null;

  constructor(
    private state: GameState,
    private bus: EventBus,
    private dialogue: DialogueData,
    /**
     * The ladder. Defaulted rather than imported at the point of use so a test
     * can hold a two-rung ladder against the real machinery — the hold, the
     * catch-up tick and the beats refusal all only have anything to do once more
     * than one chapter is gated, and the shipped ladder gates exactly one.
     * Production never passes it.
     */
    private gates: readonly ChapterGate[] = CHAPTER_GATES
  ) {
    for (const trigger of TRIGGERS) bus.on(trigger, () => this.evaluate(trigger));
    // The catch-up tick. The tutorial DELIVERS Eleanor's first order itself (the
    // `ledger_deliver` beat) and `evaluate` refuses to fire while the tutorial
    // owns the bubble, so the gate sits satisfied but unread until the handover.
    // It is also the ONLY path that opens a chapter whose condition was met
    // while the game was closed: a done tutorial re-emits this on every load.
    // Labelled `recheck` rather than `order:completed` — under the old label it
    // could only ever re-ask an ORDER-gated chapter, so the first Trust- or
    // quest-gated rung would silently never get its catch-up.
    bus.on('tutorial:step', ({ done }) => {
      if (done) this.evaluate('recheck');
    });
    // The bubble is free again — a good moment to ask what is next, and the one
    // that makes a bunched chapter follow its predecessor's beats rather than
    // wait for the player's next delivery. A WAKE, not a release: the ladder
    // holds nothing that this has to unlock, so an ack that never arrives (the
    // bubble taken by a tutorial lesson, a scene torn down mid-beat) costs a
    // prompt re-ask and nothing else. It does retire the hold early — the hold
    // means "beats have just been launched" and this is proof they are over —
    // but it is never what the hold is WAITING on: that is the microtask below.
    bus.on('story:beats_finished', () => {
      this.announced = null;
      this.evaluate('recheck');
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

  private evaluate(on: ChapterTrigger): void {
    // The tutorial owns the bubble and the board until it is done; a chapter
    // beat firing over a scripted step would fight it for both.
    if (!this.state.tutorialDone) return;
    // A chapter was opened by this same cascade; the next rung waits for the
    // next wake so their beats do not land on top of each other.
    if (this.announced !== null) return;
    const next = this.state.storyChapter + 1;
    if (next > LAST_CHAPTER) return;
    const gate = this.gates.find((g) => g.chapter === next);
    if (!gate) return;
    // `recheck` is the wildcard — it asks every gate, whatever fact it names.
    if (on !== 'recheck' && gate.on !== on) return;
    if (!gate.met(this.state)) return;
    // NO BEATS, NO CHAPTER. The pointer is persisted and beats never replay, so
    // advancing into a chapter dialogue.json has nothing for would BURN it: the
    // player passes through it in silence and can never be given those lines.
    // With this line, landing a gate ahead of its dialogue is inert rather than
    // destructive: `announce` below moves the pointer, and a pointer moved onto
    // a chapter with no bank is a chapter the player can never be told.
    if (!this.beatsFor(next)) return;
    this.announce(next);
  }

  /**
   * Open a chapter: move the pointer, hold the ladder for the rest of this
   * cascade, and say so.
   *
   * The hold is armed BEFORE the emit — `story:chapter` runs SaveSystem and
   * UIScene synchronously, and anything they emit in turn must find the ladder
   * holding — and it expires on a microtask, which the runtime is guaranteed to
   * run once this whole chain has drained. So the hold covers exactly the
   * cascade it belongs to and cannot outlive it, whatever anyone downstream
   * does, drops, throws or resets.
   */
  private announce(chapter: number): void {
    this.state.storyChapter = chapter;
    this.announced = chapter;
    queueMicrotask(() => {
      this.announced = null;
    });
    this.bus.emit('story:chapter', { chapter });
  }
}
