import { beforeAll, describe, expect, it } from 'vitest';
import {
  auditCampaign,
  buildTimeline,
  judgeLadder,
  type CampaignData,
  type Milestone
} from '../../src/core/campaign';
import type { Finding } from '../../src/core/availability';
import {
  CHAPTER_GATES,
  LAST_CHAPTER,
  StorySystem,
  type CampaignFacts,
  type ChapterGate
} from '../../src/systems/StorySystem';
import type { GameContext } from '../../src/core/Context';
import { GameState } from '../../src/core/GameState';
import { EventBus } from '../../src/core/EventBus';
import type { DialogueData, MapData, TutorialStepEvent } from '../../src/core/types';
import map8x8 from '../fixtures/map-8x8.json';
import { capture, createTestContext } from './helpers';
import { ZONES } from '../../src/core/world';
import cauldron from '../../src/data/cauldron.json';
import chains from '../../src/data/chains.json';
import dialogue from '../../src/data/dialogue.json';
import map from '../../src/data/map.json';
import orders from '../../src/data/orders.json';
import quests from '../../src/data/quests.json';
import tasks from '../../src/data/tasks.json';
import tutorial from '../../src/data/tutorial.json';

const data: CampaignData = {
  base: { chains, orders, tasks, tutorial, quests, cauldron } as unknown as CampaignData['base'],
  map: map as unknown as CampaignData['map'],
  worlds: ZONES.worlds,
  dialogue: dialogue as unknown as CampaignData['dialogue']
};

const errorsIn = (findings: readonly Finding[]): Finding[] =>
  findings.filter((f) => f.severity === 'error');
const say = (findings: readonly Finding[]): string =>
  findings.map((f) => `${f.at} — ${f.message}`).join('\n');

/* The timeline is the expensive half and it never changes between cases, so it
 * is walked once and every deliberately-broken ladder below is judged against
 * the same one. */
let timeline: Milestone[];
const beats = new Set([2]);
const hasBeats = (chapter: number): boolean => beats.has(chapter);

beforeAll(() => {
  timeline = buildTimeline(data).timeline;
});

describe('The chapter ladder (the offline proof — `pnpm chapters`)', () => {
  it('every landed gate is consecutive, reachable, in order and spoken', () => {
    const audit = auditCampaign(data);
    expect(say(errorsIn(audit.findings))).toBe('');
  });

  it('walks a campaign that actually gets somewhere', () => {
    // Guards the audit against passing by walking nowhere: a timeline that
    // stopped at the tutorial would call every gate above chapter 2 unreachable
    // and be right for the wrong reason.
    expect(timeline.length).toBeGreaterThan(100);
    const last = timeline[timeline.length - 1]!;
    expect(last.facts.tutorialDone).toBe(true);
    expect(last.facts.completedOrderIds.length).toBeGreaterThan(10);
    expect(last.facts.stat('trust:5')).toBeGreaterThan(0);
    expect(last.facts.stat('reveal:ember_dragon:3')).toBeGreaterThan(0);
    expect(last.facts.stat('arrived:borealis')).toBeGreaterThan(0);
  });

  it('the campaign honestly stops where its gates do', () => {
    const audit = auditCampaign(data);
    const highest = audit.gates.reduce((n, g) => Math.max(n, g.gate.chapter), 1);
    expect(audit.reachedChapter).toBe(highest);
    expect(highest).toBeLessThanOrEqual(LAST_CHAPTER);
  });

  it('the shipped ladder enters chapter 2 on the tutorial’s own delivery', () => {
    const audit = auditCampaign(data);
    const two = audit.gates.find((g) => g.gate.chapter === 2)!;
    expect(two.hasBeats).toBe(true);
    // The order is delivered at `ledger_deliver`, but `evaluate` is blind while
    // the tutorial owns the bubble — so the campaign's first rung lands on the
    // handover beat, which is also where it reads best.
    expect(two.firstHold?.at).toBe('tutorial:free_play');
    expect(two.entered?.at).toBe('tutorial:free_play');
  });
});

/* ------------------------------------------------------------------ */
/* Each law, against a ladder built to break it.                        */
/* ------------------------------------------------------------------ */

const gate = (chapter: number, met: (f: CampaignFacts) => boolean): ChapterGate => ({
  chapter,
  on: 'recheck',
  met
});
const always = (): boolean => true;
const never = (): boolean => false;

describe('the four laws catch what they claim to', () => {
  it('CONSECUTIVE — a gate above a gap is dead code', () => {
    // `StorySystem.evaluate` only ever looks up `storyChapter + 1`, so nothing
    // gating chapter 3 means chapter 4's gate is never asked, however true it is.
    beats.add(3).add(4);
    try {
      const judged = judgeLadder(timeline, [gate(2, always), gate(4, always)], hasBeats);
      expect(say(errorsIn(judged.findings))).toMatch(/nothing gates chapter 3/);
      expect(judged.reachedChapter).toBe(2);
    } finally {
      beats.delete(3);
      beats.delete(4);
    }
  });

  it('REACHABLE — a condition nothing on the timeline makes true', () => {
    beats.add(3);
    try {
      const judged = judgeLadder(timeline, [gate(2, always), gate(3, never)], hasBeats);
      expect(say(errorsIn(judged.findings))).toMatch(/never true anywhere on the timeline/);
    } finally {
      beats.delete(3);
    }
  });

  it('ORDER — a rung that is already true when the one below it opens', () => {
    beats.add(3);
    try {
      // Chapter 3 asks for something the player already has at the handover,
      // while chapter 2 waits for the third delivery — so 3's lines would land
      // as a formality, on a beat 2 has not given the player yet.
      const judged = judgeLadder(
        timeline,
        [gate(2, (f) => f.completedOrderIds.length >= 3), gate(3, always)],
        hasBeats
      );
      expect(say(errorsIn(judged.findings))).toMatch(/which is BEFORE chapter 2/);
    } finally {
      beats.delete(3);
    }
  });

  it('BEATS — a gate landed ahead of its dialogue is inert, and says so', () => {
    // dialogue.json has no chapter 3, so advancing into it would BURN it: the
    // pointer is persisted and beats never replay.
    const judged = judgeLadder(timeline, [gate(2, always), gate(3, always)], hasBeats);
    expect(say(errorsIn(judged.findings))).toMatch(/no beats authored in dialogue\.json for chapter 3/);
    expect(judged.reachedChapter).toBe(2);
  });

  it('a well-formed ladder passes all four', () => {
    beats.add(3);
    try {
      const judged = judgeLadder(
        timeline,
        [
          gate(2, (f) => f.completedOrderIds.length >= 1),
          gate(3, (f) => f.stat('trust:3') > 0)
        ],
        hasBeats
      );
      expect(say(errorsIn(judged.findings))).toBe('');
      expect(judged.reachedChapter).toBe(3);
    } finally {
      beats.delete(3);
    }
  });
});

describe('the gates the game actually ships', () => {
  it('are typed against CampaignFacts and nothing wider', () => {
    // A gate that could reach `state.items` could be non-monotone — true, then
    // false when the piece is sold, delivered or carried to another world — and
    // a chapter is only ever asked on the tick its trigger fires. The narrow
    // interface is what makes that a compile error; this asserts the runtime
    // half: every shipped gate answers a plain facts object with no game in it.
    const bare: CampaignFacts = {
      stat: () => 0,
      completedOrderIds: [],
      level: 1,
      tutorialDone: true,
      storyChapter: 1
    };
    for (const g of CHAPTER_GATES) expect(() => g.met(bare)).not.toThrow();
  });

  it('are monotone along the timeline — once true, true to the end', () => {
    for (const g of CHAPTER_GATES) {
      const facts = timeline.map((m) => ({
        at: m.at,
        met: g.met({ ...m.facts, storyChapter: g.chapter - 1 })
      }));
      const first = facts.findIndex((f) => f.met);
      if (first < 0) continue;
      const lapse = facts.slice(first).find((f) => !f.met);
      expect(
        lapse ? `chapter ${g.chapter}'s gate goes false again at ${lapse.at}` : ''
      ).toBe('');
    }
  });
});

/* ------------------------------------------------------------------ */
/* The machinery, driven by the real bus.                               */
/* ------------------------------------------------------------------ */

/**
 * A two-rung ladder on a BARE state and bus — no GameContext.
 *
 * Deliberately not `createTestContext`: that builds the real StorySystem on the
 * shipped ladder, and two StorySystems on one bus both advance the same pointer,
 * so the fixture would be testing the race and not the machinery.
 */
function bareStory(
  gates: readonly ChapterGate[],
  chapters: Record<string, { speaker: string; lines: string[] }> = {
    '2': { speaker: 'eleanor', lines: ['two'] },
    '3': { speaker: 'eleanor', lines: ['three'] }
  }
): { state: GameState; bus: EventBus; turned: { chapter: number }[] } {
  const state = new GameState(map8x8 as unknown as MapData);
  const bus = new EventBus();
  state.tutorialDone = true;
  const turned = capture(bus, 'story:chapter');
  new StorySystem(state, bus, { chapters } as unknown as DialogueData, gates);
  return { state, bus, turned };
}

describe('StorySystem machinery', () => {
  it('ONE CHAPTER PER BUBBLE — a second chapter queues behind the first’s ack', () => {
    // Two gates satisfied by one fact is the NORMAL case once the ladder has
    // more than one rung. Both firing in one tick would schedule two bubble
    // sequences on the same delay, and the second would wipe the first mid-run —
    // beats the persisted pointer can never replay.
    const { state, bus, turned } = bareStory([
      { chapter: 2, on: 'order:completed', met: (f) => f.completedOrderIds.length >= 1 },
      { chapter: 3, on: 'order:completed', met: (f) => f.completedOrderIds.length >= 1 }
    ]);

    state.completedOrderIds.push('eleanor_brazier');
    bus.emit('order:completed', { orderId: 'eleanor_brazier', rewards: { coins: 0, keys: 0 } });
    expect(turned).toEqual([{ chapter: 2 }]);
    expect(state.storyChapter).toBe(2);

    // The bubble finishes; the queue drains, and chapter 3 gets its own turn.
    bus.emit('story:beats_finished', { chapter: 2 });
    expect(turned).toEqual([{ chapter: 2 }, { chapter: 3 }]);
    expect(state.storyChapter).toBe(3);
  });

  it('ONE CHAPTER PER CASCADE — a delivery that also finishes a quest opens ONE', async () => {
    // The bunching shape the guard exists for, spelled out: one player action,
    // two gates satisfied a single bus hop apart inside the SAME synchronous
    // cascade. Both announced there would land two `chapterBeatDelay` timers in
    // one frame, and the second run would talk over the first.
    const { state, bus, turned } = bareStory([
      { chapter: 2, on: 'order:completed', met: (f) => f.completedOrderIds.length >= 1 },
      { chapter: 3, on: 'quest:completed', met: (f) => f.completedOrderIds.length >= 1 }
    ]);
    // Registered after StorySystem, so it relays inside the cascade exactly as
    // QuestSystem does: the order lands, the quest it completes lands next.
    bus.on('order:completed', () => bus.emit('quest:completed', { questId: 'brazier' }));

    state.completedOrderIds.push('eleanor_brazier');
    bus.emit('order:completed', { orderId: 'eleanor_brazier', rewards: { coins: 0, keys: 0 } });
    expect(turned).toEqual([{ chapter: 2 }]);
    expect(state.storyChapter).toBe(2);

    // The hold dies with the cascade — but the ladder does not then run ahead of
    // itself: chapter 3 is waiting for a wake, not for a lock.
    await Promise.resolve();
    expect(turned).toEqual([{ chapter: 2 }]);

    bus.emit('story:beats_finished', { chapter: 2 });
    expect(turned).toEqual([{ chapter: 2 }, { chapter: 3 }]);
    expect(state.storyChapter).toBe(3);
  });

  it('A DROPPED ACK DOES NOT END THE CAMPAIGN — the next fact still moves it', async () => {
    // The repro that killed the old `speaking` latch. `story:beats_finished` is
    // emitted by a callback the bubble holds, and `CharacterBubble` throws that
    // callback away whenever anything else takes the bubble — a tutorial lesson,
    // a one-off line, a scene torn down mid-beat. Under a latch cleared ONLY by
    // that ack, one dropped callback froze the ladder for the rest of the
    // session. So here the ack is never sent, at all, ever.
    const { state, bus, turned } = bareStory([
      { chapter: 2, on: 'order:completed', met: (f) => f.completedOrderIds.length >= 1 },
      { chapter: 3, on: 'order:completed', met: (f) => f.completedOrderIds.length >= 2 }
    ]);

    state.completedOrderIds.push('eleanor_brazier');
    bus.emit('order:completed', { orderId: 'eleanor_brazier', rewards: { coins: 0, keys: 0 } });
    expect(turned).toEqual([{ chapter: 2 }]);

    // Her beats are wiped mid-run and nothing acks. Later — another delivery.
    await Promise.resolve();
    state.completedOrderIds.push('eleanor_lantern');
    bus.emit('order:completed', { orderId: 'eleanor_lantern', rewards: { coins: 0, keys: 0 } });

    expect(turned).toEqual([{ chapter: 2 }, { chapter: 3 }]);
    expect(state.storyChapter).toBe(3);
  });

  it('a RESET taken while a chapter is speaking does not follow the player in', async () => {
    // `speaking` was session state, and a Reset is the one moment a session
    // keeps its objects and throws away its game: every other system that holds
    // anything subscribes to `game:reset`. A block carried across it would end
    // the NEW campaign before it started. Driven through the real reset path,
    // with the shipped ladder and no ack ever sent.
    const ctx = createTestContext();
    ctx.state.tutorialDone = true;
    const turned = capture(ctx.bus, 'story:chapter');

    ctx.state.completedOrderIds.push('eleanor_brazier');
    ctx.bus.emit('order:completed', { orderId: 'eleanor_brazier', rewards: { coins: 0, keys: 0 } });
    expect(turned).toEqual([{ chapter: 2 }]);

    await Promise.resolve(); // her beats are on screen: a later tick, no ack
    ctx.bus.emit('game:reset_requested', {});
    expect(ctx.state.storyChapter).toBe(1);

    // A brand-new game, and it can still reach its first chapter.
    ctx.state.tutorialDone = true;
    ctx.state.completedOrderIds.push('eleanor_brazier');
    ctx.bus.emit('order:completed', { orderId: 'eleanor_brazier', rewards: { coins: 0, keys: 0 } });
    expect(turned).toEqual([{ chapter: 2 }, { chapter: 2 }]);
    expect(ctx.state.storyChapter).toBe(2);
  });

  it('the catch-up tick is a WILDCARD — it re-asks a gate whatever fact it names', () => {
    // The handover re-check used to be labelled `order:completed`, so it could
    // only ever open an order-gated chapter: the first Trust- or quest-gated rung
    // satisfied while the game was closed would never be looked at again.
    const { state, bus, turned } = bareStory([
      { chapter: 2, on: 'dragon:trust_changed', met: (f) => f.stat('trust:3') > 0 }
    ]);
    state.addStat('trust:3', 1);

    // The handover: TutorialDirector re-emits this on every load of a done
    // tutorial, which is what makes it the ladder's catch-up path.
    bus.emit('tutorial:step', {
      id: 'free_play',
      tutorial: 'main',
      index: 0,
      total: 1,
      done: true,
      speaker: 'eleanor',
      text: '',
      gateType: 'tap',
      highlight: [],
      hand: null,
      arrow: null,
      arrowThen: null,
      allow: {} as TutorialStepEvent['allow']
    });
    expect(turned).toEqual([{ chapter: 2 }]);
  });

  it('wakes on every fact a gate is allowed to name', () => {
    for (const on of ['quest:completed', 'dragon:named', 'dragon:revealed'] as const) {
      const { bus, turned } = bareStory([{ chapter: 2, on, met: () => true }]);
      if (on === 'quest:completed') bus.emit(on, { questId: 'x' });
      else if (on === 'dragon:named') bus.emit(on, { itemId: 1, name: 'x', chain: 'ember_dragon' });
      else bus.emit(on, { chain: 'ember_dragon', tier: 3, art: '', name: '', epithet: '' });
      expect(turned, `a gate on '${on}' is never asked`).toEqual([{ chapter: 2 }]);
    }
  });

  it('NO BEATS, NO CHAPTER — a gate ahead of its dialogue is inert, not destructive', () => {
    // The pointer is persisted and beats never replay, so advancing into a
    // chapter dialogue.json has nothing for would burn it in silence.
    const { state, bus, turned } = bareStory([{ chapter: 2, on: 'order:completed', met: () => true }], {});

    bus.emit('order:completed', { orderId: 'eleanor_brazier', rewards: { coins: 0, keys: 0 } });
    expect(turned).toEqual([]);
    expect(state.storyChapter).toBe(1);
  });
});

describe('the monotone latches a gate can actually read', () => {
  /** Put a dragon of `chain` at `tier` on a free tile and hand back its id. */
  const placeDragon = (ctx: GameContext, chain = 'ember_dragon', tier = 3): number => {
    const free = ctx.state.freeActiveTilesNear(0, 0)[0];
    if (!free) throw new Error('fixture board has no free tile');
    return ctx.state.addItem({ chain, tier, col: free.col, row: free.row, kind: 'item' }).id;
  };

  it('trust latches every rung it passes, and survives the dragon', () => {
    const ctx = createTestContext();
    const id = placeDragon(ctx);
    // Resin is the Red's favourite, so this is +2 in one meal — rung 1 must not
    // be stepped over, or a gate reading `trust:1` would never see it.
    ctx.bus.emit('ui:feed_dragon_requested', { itemId: id, chain: 'resin', tier: 3 });
    expect(ctx.state.stat('trust:1')).toBe(1);
    expect(ctx.state.stat('trust:2')).toBe(1);
    expect(ctx.state.stat('trust:3')).toBe(0);

    // The dragon is delivered, sold, merged away — the RECORD of what it reached
    // is not on it, so the fact outlives the piece.
    ctx.bus.emit('board:consume_items', { itemIds: [id], reason: 'delivered' });
    expect(ctx.state.items.has(id)).toBe(false);
    expect(ctx.state.stat('trust:2')).toBe(1);
  });

  it('a naming is counted where nothing else can count it', () => {
    const ctx = createTestContext();
    const id = placeDragon(ctx);
    ctx.bus.emit('ui:dragon_named', { itemId: id, name: 'Cinder' });
    expect(ctx.state.stat('dragons:named')).toBe(1);
    // Write-once on the item, so it can never be counted twice.
    ctx.bus.emit('ui:dragon_named', { itemId: id, name: 'Ash' });
    expect(ctx.state.stat('dragons:named')).toBe(1);
  });
});
