import { questStepNeeds } from '../core/availability';
import {
  brewKey,
  CAULDRON_REACHED_STAT,
  giftKey,
  heartsForPoints,
  regardKey,
  SPEAKER_NAMES,
  WORLD_ID
} from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type {
  CauldronData,
  ChainsData,
  OrderConfig,
  OrderRequirement,
  QuestConfig,
  QuestGoal,
  QuestStepConfig,
  QuestsData,
  SpeakerId
} from '../core/types';
import type { OrderSystem } from './OrderSystem';
import type { TaskSystem } from './TaskSystem';

/** Latch key for a finished subquest. Lives in `GameState.stats`, which is
 *  already persisted — the ladder adds no field to the save schema and so needs
 *  no SAVE_VERSION bump (ripple-map: TOUCH GameState fields → CHECK SaveSystem). */
const latchKey = (stepId: string): string => `q:${stepId}`;

/** The once-ever completion latch for a whole quest (`q:done:<id>`) — the key
 *  `evaluate` writes, `questLocked` gates on, and WorldSystem's story doors
 *  read. One derivation, because it is a PERSISTED save key. */
const doneLatchKey = (questId: string): string => latchKey(`done:${questId}`);

/** Plain-English verb per lifetime counter, so an unlabelled `stat` step reads
 *  "Hatch 4" rather than leaking the counter's field name onto the HUD. */
const STAT_VERB: Record<string, string> = {
  hatches: 'Hatch',
  merges: 'Merge',
  orders: 'Complete',
  goldEarned: 'Earn',
  elderTaps: 'Tap the Golden Elder',
  recipes: 'Discover'
};

/**
 * The Ledger-keeper's name, as a subquest should say it.
 *
 * Derived from the order rather than written into the sentence: Eleanor keeps
 * the Ledger in the south and Selyna keeps her own in the north, and a HUD row
 * reading "Deliver 2 Light-Fast Spindles to Eleanor" would name a woman who has
 * never set foot in Borealis and never will (story-bible §5).
 */
const giverName = (giver: string | undefined): string =>
  giver ? (SPEAKER_NAMES[giver as keyof typeof SPEAKER_NAMES] ?? giver) : 'the Ledger';

export interface StepProgress {
  have: number;
  need: number;
  /** Nothing left to do on this step. */
  done: boolean;
  /** Its subject doesn't exist yet — not an ACTIVE subquest (the Elder asleep). */
  locked: boolean;
  label: string;
  hint?: string;
}

/**
 * The quest ladder — the single thing that decides what the player is being
 * asked to do RIGHT NOW, and the only source the on-screen tracker reads.
 *
 * One MAIN quest at a time, in authored order (`src/data/quests.json`), each
 * made of ordered SUBQUESTS. A quest is done when every step is; the ladder then
 * advances past any quest the player already satisfied out of order (the Ledger
 * shows two orders at once, so Order 3 can legally land before Order 2).
 *
 * Two laws it holds to:
 *   • **Goals read existing state.** No goal keeps a counter of its own, so a
 *     goal can never drift from the thing it claims to measure. The one
 *     exception is `have` — "six shards on the board" stops being true the
 *     instant they are delivered — so a met `have` is LATCHED into
 *     `GameState.stats` the first time it is seen.
 *   • **Nothing is asked for that cannot be got.** Every step's item needs are
 *     proved reachable at its own point on the ladder, offline, by
 *     `src/core/availability.ts` (`pnpm quests`, and a unit test that fails the
 *     build). The ladder is authored data; the proof is automatic.
 *
 * Phaser-free — it runs in the node tests. It READS OrderSystem and TaskSystem
 * (their getters only, never a command into them) so the encore queue and the
 * Keeper's Tasks each keep exactly one definition; the Ledger UI reads them the
 * same way.
 */
export class QuestSystem {
  /** Facts that could move any goal. Everything here is already emitted. */
  private static readonly TRIGGERS = [
    'item:merged',
    'item:hatched',
    'item:spawned',
    'item:produced',
    'item:harvested',
    'item:removed',
    'item:sold',
    'order:completed',
    'economy:changed',
    'keeper:leveled',
    'region:unlocked',
    'elder:tapped',
    'cookbook:discovered',
    'bag:changed',
    // A crossing changes which ladder is tracked AND satisfies any `world` goal
    // waiting on it, so it is a trigger like any other fact.
    'world:switched',
    // The two relationship facts. A gift is the only thing that moves a `gift`
    // goal, and a heart is the only thing that opens a `lockedUntil.regard`
    // gate — so a step can go from locked to askable without the player
    // touching the board.
    'regard:gift_accepted',
    'regard:changed'
  ] as const;

  /** Per GIVER — two people can hand out quests on one board (Eleanor and the
   *  woken Elder), and each track announces its own advances. */
  private lastAnnounced = new Map<SpeakerId, string>();

  constructor(
    private state: GameState,
    private bus: EventBus,
    private quests: QuestsData,
    private chains: ChainsData,
    private cauldron: CauldronData,
    private orders: OrderSystem,
    private tasks: TaskSystem
  ) {
    for (const event of QuestSystem.TRIGGERS) {
      bus.on(event, () => this.evaluate(true));
    }
    // A load re-derives the whole ladder, but silently: a save resumed at quest
    // three must not replay two quests' worth of completion beats.
    bus.on('state:loaded', () => this.evaluate(false));
    bus.on('game:reset', () => {
      this.lastAnnounced.clear();
    });
  }

  /** Every quest in the ladder, all worlds. */
  get all(): QuestConfig[] {
    return this.quests.quests;
  }

  /**
   * EVERY quest, whichever world authored it — because a ladder the Keeper
   * cannot reach is a ladder she has to walk home to climb.
   *
   * This used to filter to the world she was standing in, and the reason given
   * was correctness rather than tidiness: `countItems` read the ACTIVE board,
   * so an Emberkeep quest asking for six Gem Shards sat at `0 / 6` the whole
   * time she was in the north, and its subquests looked broken rather than
   * absent. Hiding them was the honest response to a count that lied.
   *
   * The count no longer lies. `countItemsAnywhere` sums every board she has
   * stood on and `itemsMatchingAnywhere` pays the delivery out of whichever one
   * holds the pieces, so a quest is her business from anywhere — which is what
   * a quest was always meant to be. The filter's own justification is what
   * removed it.
   *
   * WHAT REPLACES IT IS NOT NOTHING. The gate is now the world having been
   * REACHED rather than being underfoot: a ladder she has walked into follows
   * her home, and one she has never seen stays out of sight. Dropping the test
   * altogether put Selyna on the roster during the tutorial, three worlds and a
   * chapter before the player has any idea who she is — which is a spoiler, not
   * a convenience. `visited` is the same fact WorldSystem uses, so the two can
   * never disagree about where the Keeper has been.
   */
  get tracked(): QuestConfig[] {
    return this.quests.quests.filter((q) => this.state.visited(q.world ?? WORLD_ID));
  }

  /** The ladder of the world UNDERFOOT — what the HUD may speak for right now.
   *  `tracked` answers a different question (everything the Keeper has walked
   *  into, for the sheet); the live pointers below must not reach across a
   *  portal, or Borealis spends eternity tracking Eleanor's endless tail: the
   *  tail is ALWAYS live and sits earlier in file order than every northern
   *  quest, so a visited-filtered `find` can never get past it. */
  private get here(): QuestConfig[] {
    return this.quests.quests.filter((q) => (q.world ?? WORLD_ID) === this.state.worldId);
  }

  /** The quest the HUD tracks by default: the first LIVE one in THIS world not
   *  finished. The authored world's ladder ends in the endless Ledger tail, so
   *  it is never null there; a world with no ladder yet returns null and the
   *  HUD stays empty rather than showing another world's business. */
  get activeQuest(): QuestConfig | null {
    return this.here.find((q) => this.isLive(q)) ?? null;
  }

  /**
   * A quest whose `lockedUntil.quest` gate has not flipped is DORMANT: not
   * latched, not completed, not announced, invisible to the HUD. The gate reads
   * the same `q:done:<id>` latch the ladder itself writes, so it is derived
   * state and survives reloads for free.
   */
  questLocked(quest: QuestConfig): boolean {
    const gate = quest.lockedUntil?.quest;
    return !!gate && this.state.stat(doneLatchKey(gate)) === 0;
  }

  /** The one predicate behind every track pointer: askable right now — awake
   *  and unfinished. */
  private isLive(quest: QuestConfig): boolean {
    return !this.questLocked(quest) && !this.isComplete(quest);
  }

  /**
   * Each giver's live track head in this world, one ladder pass, in ladder
   * (file) order. A giver is on the roster once any of their quests is unlocked
   * and unfinished: Eleanor is always here (her ladder ends in the endless
   * tail), the Elder joins when `keepers_hoard` wakes him and leaves when his
   * twelfth quest is done. Derived per call — the `q:done:` fast path in
   * `isComplete` makes the pass a handful of map reads.
   */
  private liveTracks(): Map<SpeakerId, QuestConfig> {
    const tracks = new Map<SpeakerId, QuestConfig>();
    for (const quest of this.here) {
      if (!tracks.has(quest.giver) && this.isLive(quest)) tracks.set(quest.giver, quest);
    }
    return tracks;
  }

  /** The roster the tracker's track arrow cycles through. */
  get giversHere(): SpeakerId[] {
    return [...this.liveTracks().keys()];
  }

  /** One giver's ladder in this world, dormant quests included (positions are
   *  authored; a locked quest is still rung N of the ladder it belongs to). */
  trackedFor(giver: SpeakerId): QuestConfig[] {
    return this.tracked.filter((q) => q.giver === giver);
  }

  /** The quest a giver's own track is on — what the HUD shows when the player
   *  has switched the tracker to that giver. */
  activeQuestFor(giver: SpeakerId): QuestConfig | null {
    return this.liveTracks().get(giver) ?? null;
  }

  /** Its 1-based position within its own GIVER's ladder in this world. */
  indexOf(quest: QuestConfig): number {
    return this.trackedFor(quest.giver).findIndex((q) => q.id === quest.id) + 1;
  }

  /** The quest's title — the endless tail borrows the live order's. */
  titleFor(quest: QuestConfig): string {
    if (quest.title) return quest.title;
    const live = this.orders.activeOrders[0];
    return live?.title ?? `${giverName(live?.giver)}'s Ledger`;
  }

  isComplete(quest: QuestConfig): boolean {
    // The done latch answers first: completion is monotone (steps latch), so a
    // set latch is the whole truth, and the track pointers that prefix-scan the
    // ladder pay one map read per finished rung instead of re-walking its steps.
    if (this.state.stat(doneLatchKey(quest.id)) > 0) return true;
    return quest.steps.every((step) => this.stepDone(step));
  }

  /** Steps done / steps total, ignoring locked ones (a locked step's subject
   *  does not exist yet, so counting it would show a total that cannot move). */
  questProgress(quest: QuestConfig): { have: number; need: number } {
    const live = quest.steps.filter((s) => !this.isLocked(s) || this.stepDone(s));
    return { have: live.filter((s) => this.stepDone(s)).length, need: live.length };
  }

  isLocked(step: QuestStepConfig): boolean {
    if (step.goal.kind === 'task') {
      const task = this.taskFor(step.goal.taskId);
      return task ? this.tasks.isLocked(task) : false;
    }
    const gate = step.lockedUntil;
    if (!gate) return false;
    if (gate.order && !this.state.completedOrderIds.includes(gate.order)) return true;
    if (gate.level && this.state.level < gate.level) return true;
    // She has not asked yet. Read hearts, not points — the gate and the thing
    // the player can see on screen have to be the same number.
    if (gate.regard && this.heartsOf(gate.regard.characterId) < gate.regard.hearts) return true;
    return false;
  }

  /** A person's hearts, derived from the points RegardSystem banks in `stats`.
   *  Read straight off state rather than through RegardSystem so the ladder
   *  keeps no dependency on it — RegardSystem reads THIS system, not the other
   *  way round, and one direction is what keeps the pair acyclic. */
  private heartsOf(characterId: string): number {
    return heartsForPoints(this.state.stat(regardKey(characterId)));
  }

  stepDone(step: QuestStepConfig): boolean {
    if (this.state.stat(latchKey(step.id)) > 0) return true;
    return this.meets(step.goal);
  }

  progressFor(step: QuestStepConfig): StepProgress {
    const latched = this.state.stat(latchKey(step.id)) > 0;
    const raw = this.rawProgress(step.goal);
    // `meets` is the authority, never the counters: an `order` step reads its
    // item progress so the HUD can show "6 / 6 — go and deliver it", but it is
    // finished by the DELIVERY, not by holding the goods.
    const done = latched || this.meets(step.goal);
    const locked = this.isLocked(step);
    const task = step.goal.kind === 'task' ? this.taskFor(step.goal.taskId) : undefined;
    return {
      have: done ? raw.need : raw.have,
      need: raw.need,
      done,
      locked,
      label: step.label ?? task?.label ?? this.derivedLabel(step.goal),
      hint: step.lockedHint ?? task?.lockedHint
    };
  }

  /**
   * The pieces a step consumes: whatever its goal names, plus whatever the
   * author declared on top (the dragons behind a hatch count, the Elder behind a
   * commune). Delegates to the same pure function `auditLadder` uses, so the
   * running game and the offline proof can never disagree about what a step
   * actually asks for.
   */
  needsFor(step: QuestStepConfig): OrderRequirement[] {
    return questStepNeeds(
      step,
      this.orders.scripted,
      this.orders.encorePool,
      this.tasks.tasks,
      this.cauldron.recipes
    );
  }

  /**
   * WHAT IS ACTUALLY STOPPING A BREW — the ingredient the player is shortest of.
   *
   * A brewed piece has no merge ladder of its own (nothing merges into an Iron
   * Hat), so the hover sheet has nothing to walk unless it is pointed at the
   * CAULDRON'S INPUT instead. Most recipes take one and the choice is empty;
   * three of Selyna's take two, and there the first input is the wrong answer
   * as often as not — a player holding six Tar Drops and no Iron Hats would be
   * shown the Tar Drops and told they were fine.
   *
   * So it is the LARGEST SHORTFALL, not the first line: need minus held, over
   * every board the Keeper has stood on (`countItemsAnywhere`, the same sum the
   * quest counts themselves are paid out of). Ties and a fully-stocked bench
   * both fall back to the first input, which is the recipe's own idea of what
   * it is mainly made of.
   *
   * Only brews go through here. Every other goal already names a piece whose
   * own chain is the answer.
   */
  peekNeedFor(step: QuestStepConfig): OrderRequirement | null {
    if (step.goal.kind !== 'brew') return null;
    const needs = this.needsFor(step);
    if (needs.length === 0) return null;
    let worst = needs[0]!;
    let gap = -Infinity;
    for (const need of needs) {
      const short = need.count - this.heldForBrew(need.chain, need.tier);
      if (short > gap) {
        gap = short;
        worst = need;
      }
    }
    return worst;
  }

  /** Boards AND bag, because a brew is paid out of the BAG and the bag is
   *  filled from the boards: an ingredient already pocketed is not one the
   *  player still has to go and find, and pointing them back at the board for
   *  it is the same wrong answer as naming the wrong ingredient. */
  private heldForBrew(chain: string, tier: number): number {
    const pocketed = this.state.bag
      .filter((stack) => stack.chain === chain && stack.tier === tier)
      .reduce((n, stack) => n + stack.count, 0);
    return this.state.countItemsAnywhere(chain, tier) + pocketed;
  }

  /**
   * The PIECE a step's row is about, or null when the goal is not about one.
   *
   * This is deliberately not `needsFor`. That answers "what does this step
   * COST", which is the audit's question; this answers "what is the row
   * NAMING", which is the tracker's — and the two part company exactly where a
   * brew is concerned. `needsFor` charges a brew its ingredients (the honest
   * cost), while the row reads "Brew 4 Broken Strakes" and the player is
   * looking for a Broken Strake. The icon has to match the words beside it or
   * it is a second, quieter instruction disagreeing with the first.
   *
   * The rule, then: whatever noun the row says. A merge names its INPUT
   * ("Merge 3 Drift Spars into…"), a delivery names what is delivered, a brew
   * names what comes out, and a level, a region or a person's regard name no
   * piece at all.
   */
  pieceFor(step: QuestStepConfig): { chain: string; tier: number; count: number } | null {
    const goal = step.goal;
    switch (goal.kind) {
      case 'recipe':
        return { chain: goal.chain, tier: goal.fromTier, count: 1 };
      case 'have':
      case 'gift':
        return { chain: goal.chain, tier: goal.tier, count: goal.count };
      case 'order': {
        const first = this.orderById(goal.orderId)?.requires[0];
        return first ? { chain: first.chain, tier: first.tier, count: first.count } : null;
      }
      case 'active_order': {
        // The encore the Ledger is actually showing — the row tracks a LIVE
        // order, so a template's first requirement would be the wrong piece the
        // moment the pool rotated. `activeOrders` filters by the world
        // underfoot, which is the second half of the answer: the pool holds
        // BOTH ledgers' templates, and its first entry is Eleanor's Gem Chips
        // — the piece the northern tail wore for a while, over words that
        // correctly named Selyna's Glass Floats.
        const first = this.orders.activeOrders[0]?.requires[0];
        return first ? { chain: first.chain, tier: first.tier, count: first.count } : null;
      }
      case 'brew': {
        const out = this.cauldron.recipes.find((r) => r.id === goal.recipeId)?.output;
        return out ? { chain: out.chain, tier: out.tier, count: goal.count } : null;
      }
      default:
        return null;
    }
  }

  // ------------------------------------------------------------- evaluation

  private evaluate(announce: boolean): void {
    for (const quest of this.quests.quests) {
      // A dormant quest is deaf: its steps must not latch off board state that
      // happens to satisfy them while its giver is still asleep.
      if (this.questLocked(quest)) continue;
      for (const step of quest.steps) {
        if (this.state.stat(latchKey(step.id)) > 0) continue;
        if (!this.meets(step.goal)) continue;
        if (!this.latchable(step.goal)) continue;
        this.state.addStat(latchKey(step.id), 1);
        if (announce) this.bus.emit('quest:step_completed', { questId: quest.id, stepId: step.id });
      }
      const doneKey = doneLatchKey(quest.id);
      if (this.isComplete(quest) && this.state.stat(doneKey) === 0) {
        this.state.addStat(doneKey, 1);
        // The per-world completion counter. No gate reads it since the Rune
        // Way went level-only (2026-08-26), but it stays written: it is save
        // data a future gate or stat screen can lean on without a migration.
        this.state.addStat(`q:world:${quest.world ?? 'emberkeep'}:done`, 1);
        // Paid on the LATCH flipping, not on `announce`. A save resumed past
        // this quest already carries the latch, so a reload can never pay
        // twice; and a quest that genuinely completes during a silent
        // re-derive is still owed its reward, it simply gets no banner.
        this.payRewards(quest);
        if (announce) this.bus.emit('quest:completed', { questId: quest.id });
      }
    }
    this.latchCauldronReached();
    // Each giver's track announces its own pointer moves — the Elder starting
    // his first quest must not wait for (or interfere with) wherever Eleanor's
    // ladder happens to be.
    for (const [giver, active] of this.liveTracks()) {
      if (active.id === this.lastAnnounced.get(giver)) continue;
      this.lastAnnounced.set(giver, active.id);
      if (announce) {
        const ladder = this.trackedFor(giver);
        this.bus.emit('quest:advanced', {
          questId: active.id,
          giver,
          index: ladder.findIndex((q) => q.id === active.id) + 1,
          total: ladder.length
        });
      }
    }
  }

  /**
   * THE CAULDRON-REACHED LATCH (owner's law, 2026-08-26; the long note sits on
   * `CAULDRON_REACHED_STAT`): the moment any world's ladder puts its FIRST
   * brew quest at the player's track head, the clouds and the Rune Way get
   * their second key. Derived here — never from a hardcoded quest id, so a
   * ladder reorder moves the latch with it — and monotonic like every other
   * quest latch. Out-of-order play is covered by the DONE clause: a brew quest
   * a player satisfied before it ever headed the track was still reached.
   *
   * Emitted on the silent (load-time) evaluate too: the fact is a mechanism
   * (UnlockSystem sweeps, BoardScene re-syncs its doors), not a banner, and an
   * old save whose ladder already stands past the threshold must open the same
   * doors a live session would.
   */
  private latchCauldronReached(): void {
    if (this.state.stat(CAULDRON_REACHED_STAT) > 0) return;
    const brews = (q: QuestConfig): boolean => q.steps.some((s) => s.goal.kind === 'brew');
    const worlds = new Set(this.quests.quests.map((q) => q.world ?? WORLD_ID));
    for (const world of worlds) {
      const ladder = this.quests.quests.filter((q) => (q.world ?? WORLD_ID) === world);
      const head = ladder.find((q) => this.isLive(q));
      if ((head && brews(head)) || ladder.some((q) => brews(q) && this.isComplete(q))) {
        this.state.addStat(CAULDRON_REACHED_STAT, 1);
        this.bus.emit('quest:cauldron_reached', {});
        return;
      }
    }
  }

  /**
   * What the story pays for a quest being finished.
   *
   * Commands only — the economy and the board own their own writes, exactly as
   * `OrderSystem.deliver` does it, so there is one implementation of paying a
   * player and one of putting a piece on a tile. The spawn asks for `overflow:
   * 'bag'` unconditionally: a quest reward is authored once and never repeats,
   * so a full board must bank it rather than swallow it — and for a legendary
   * egg, swallowing one would cost the zone its dragon for good.
   */
  private payRewards(quest: QuestConfig): void {
    const rewards = quest.rewards;
    if (!rewards) return;
    if (rewards.coins || rewards.keys || rewards.xp) {
      this.bus.emit('economy:add', {
        coins: rewards.coins ?? 0,
        keys: rewards.keys ?? 0,
        xp: rewards.xp,
        reason: `quest:${quest.id}`
      });
    }
    if (rewards.spawn) this.bus.emit('board:spawn', { ...rewards.spawn, overflow: 'bag', cause: 'quest' });
  }

  /** The endless tail never latches — it has no end to record. */
  private latchable(goal: QuestGoal): boolean {
    return goal.kind !== 'active_order';
  }

  private meets(goal: QuestGoal): boolean {
    // The endless tail is a live readout, never a thing that finishes.
    if (goal.kind === 'active_order') return false;
    // A delivery is the ONLY thing that closes an order step. Its counters
    // measure the goods on the board, which is a different question.
    if (goal.kind === 'order') return this.state.completedOrderIds.includes(goal.orderId);
    const { have, need } = this.rawProgress(goal);
    return have >= need;
  }

  private rawProgress(goal: QuestGoal): { have: number; need: number } {
    switch (goal.kind) {
      case 'have':
        return {
          have: Math.min(this.state.countItemsAnywhere(goal.chain, goal.tier), goal.count),
          need: goal.count
        };
      case 'order': {
        const order = this.orderById(goal.orderId);
        if (this.state.completedOrderIds.includes(goal.orderId)) {
          return { have: 1, need: 1 };
        }
        return order ? this.orderProgress(order) : { have: 0, need: 1 };
      }
      case 'active_order': {
        const order = this.orders.activeOrders[0];
        return order ? this.orderProgress(order) : { have: 0, need: 1 };
      }
      case 'stat':
        return { have: Math.min(this.state.stat(goal.stat), goal.count), need: goal.count };
      case 'task': {
        const task = this.taskFor(goal.taskId);
        if (!task) return { have: 0, need: 1 };
        return { have: this.tasks.progressFor(task), need: task.target };
      }
      case 'level':
        return { have: Math.min(this.state.level, goal.level), need: goal.level };
      case 'region':
        return { have: this.state.regionStatus.get(goal.regionId) === 'active' ? 1 : 0, need: 1 };
      case 'recipe': {
        const key = `${goal.chain}:${goal.fromTier}>${goal.toTier}`;
        return { have: this.state.discoveredRecipes.includes(key) ? 1 : 0, need: 1 };
      }
      case 'brew':
        // Counts BREWS, not the pieces they made — the output is meant to be
        // spent, and a step that un-finished when the player used what they
        // brewed would be a trap.
        return {
          have: Math.min(this.state.stat(brewKey(goal.recipeId)), goal.count),
          need: goal.count
        };
      case 'world':
        // Standing there IS the goal. It latches on arrival, so coming home
        // never re-opens the crossing.
        return { have: this.state.worldId === goal.worldId ? 1 : 0, need: 1 };
      case 'gift':
        // A LIFETIME counter, unlike `have`: what she was given is a thing that
        // happened, so it never needs latching and can never be undone by the
        // board changing underneath it.
        return {
          have: Math.min(this.state.stat(giftKey(goal.characterId, goal.chain, goal.tier)), goal.count),
          need: goal.count
        };
      case 'regard':
        return { have: Math.min(this.heartsOf(goal.characterId), goal.hearts), need: goal.hearts };
    }
  }

  private orderProgress(order: OrderConfig): { have: number; need: number } {
    const { have, need } = this.orders.progressFor(order);
    return {
      have: have.reduce((a, b) => a + b, 0),
      need: need.reduce((a, b) => a + b, 0)
    };
  }

  private orderById(orderId: string): OrderConfig | undefined {
    return this.orders.scripted.find((o) => o.id === orderId);
  }

  private taskFor(taskId: string) {
    return this.tasks.tasks.find((t) => t.id === taskId);
  }

  /**
   * A readable line for a goal the author left unlabelled — used by the endless
   * tail, whose wording changes with whatever order the Ledger is showing.
   *
   * Same rule the authored labels follow: a subquest says the VERB, the NUMBER
   * and the PIECE, and a delivery says where it goes. `n × Name` rather than a
   * plural, because "Dragon Rubys" is the sort of thing a naive `+ 's'` ships.
   */
  private derivedLabel(goal: QuestGoal): string {
    switch (goal.kind) {
      case 'have':
        return `Collect ${goal.count} × ${this.pieceName(goal.chain, goal.tier)}`;
      case 'order':
        return this.orderById(goal.orderId)?.title ?? 'Fill the Ledger';
      case 'active_order': {
        const order = this.orders.activeOrders[0];
        if (!order) return 'Fill the Ledger';
        const goods = order.requires
          .map((r) => `${r.count} × ${this.pieceName(r.chain, r.tier)}`)
          .join(' · ');
        return `Deliver ${goods} to ${giverName(order.giver)}`;
      }
      case 'stat':
        return `${STAT_VERB[goal.stat] ?? goal.stat} ${goal.count}`;
      case 'task':
        return this.taskFor(goal.taskId)?.label ?? goal.taskId;
      case 'level':
        return `Reach Keeper Level ${goal.level}`;
      case 'region':
        return 'Clear the ash';
      case 'recipe':
        return `Discover ${this.pieceName(goal.chain, goal.toTier)}`;
      case 'brew': {
        // Named by what comes OUT, because that is the word on the pot's card —
        // the recipe id is an authoring handle and never reaches the HUD.
        const output = this.cauldron.recipes.find((r) => r.id === goal.recipeId)?.output;
        const what = output ? this.pieceName(output.chain, output.tier) : goal.recipeId;
        return `Brew ${goal.count} × ${what}`;
      }
      case 'world':
        return 'Travel to the next world';
      case 'gift':
        return `Give ${giverName(goal.characterId)} ${goal.count} × ${this.pieceName(goal.chain, goal.tier)}`;
      case 'regard':
        // Said as conduct, never as a stat: Regard is never shown as a number
        // (docs/quests.md §1.3) and a subquest row is not the place to start.
        return `Earn ${giverName(goal.characterId)}'s trust`;
    }
  }

  private pieceName(chain: string, tier: number): string {
    return (
      this.chains.chains.find((c) => c.id === chain)?.tiers.find((t) => t.tier === tier)?.name ??
      `${chain} T${tier}`
    );
  }
}
