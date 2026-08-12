import { questStepNeeds } from '../core/availability';
import { giftKey, heartsForPoints, regardKey, WORLD_ID } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type {
  ChainsData,
  OrderConfig,
  OrderRequirement,
  QuestConfig,
  QuestGoal,
  QuestStepConfig,
  QuestsData
} from '../core/types';
import type { OrderSystem } from './OrderSystem';
import type { TaskSystem } from './TaskSystem';

/** Latch key for a finished subquest. Lives in `GameState.stats`, which is
 *  already persisted — the ladder adds no field to the save schema and so needs
 *  no SAVE_VERSION bump (ripple-map: TOUCH GameState fields → CHECK SaveSystem). */
const latchKey = (stepId: string): string => `q:${stepId}`;

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
  giver ? giver.charAt(0).toUpperCase() + giver.slice(1) : 'the Ledger';

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

  private lastAnnounced: string | null = null;

  constructor(
    private state: GameState,
    private bus: EventBus,
    private quests: QuestsData,
    private chains: ChainsData,
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
      this.lastAnnounced = null;
    });
  }

  /** Every quest in the ladder, all worlds. */
  get all(): QuestConfig[] {
    return this.quests.quests;
  }

  /**
   * The quests tracked in the world the player is STANDING in.
   *
   * Not tidiness — correctness. `state.countItems` reads the active world's
   * board, so an Emberkeep quest asking for six Gem Shards would sit at `0 / 6`
   * the whole time the player is in the north, and its subquests would look
   * broken rather than absent. A quest belongs to one board; the HUD shows the
   * board you are on.
   */
  get tracked(): QuestConfig[] {
    return this.quests.quests.filter((q) => (q.world ?? WORLD_ID) === this.state.worldId);
  }

  /** The quest the HUD tracks: the first one in THIS world not finished. The
   *  authored world's ladder ends in the endless Ledger tail, so it is never
   *  null there; a world with no ladder yet returns null and the HUD stays
   *  empty rather than showing another world's business. */
  get activeQuest(): QuestConfig | null {
    return this.tracked.find((q) => !this.isComplete(q)) ?? null;
  }

  /** Its 1-based position within its own world's ladder. */
  indexOf(quest: QuestConfig): number {
    return this.tracked.findIndex((q) => q.id === quest.id) + 1;
  }

  /** The quest's title — the endless tail borrows the live order's. */
  titleFor(quest: QuestConfig): string {
    if (quest.title) return quest.title;
    const live = this.orders.activeOrders[0];
    return live?.title ?? `${giverName(live?.giver)}'s Ledger`;
  }

  isComplete(quest: QuestConfig): boolean {
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
    return questStepNeeds(step, this.orders.scripted, this.orders.encorePool, this.tasks.tasks);
  }

  // ------------------------------------------------------------- evaluation

  private evaluate(announce: boolean): void {
    for (const quest of this.quests.quests) {
      for (const step of quest.steps) {
        if (this.state.stat(latchKey(step.id)) > 0) continue;
        if (!this.meets(step.goal)) continue;
        if (!this.latchable(step.goal)) continue;
        this.state.addStat(latchKey(step.id), 1);
        if (announce) this.bus.emit('quest:step_completed', { questId: quest.id, stepId: step.id });
      }
      const doneKey = latchKey(`done:${quest.id}`);
      if (this.isComplete(quest) && this.state.stat(doneKey) === 0) {
        this.state.addStat(doneKey, 1);
        // The per-world completion counter WorldSystem's Rune Way gate reads
        // (`q:world:borealis:done` >= HATCHERY_QUESTS_NEEDED). A counter, not
        // an id list, so renaming a quest can never silently re-lock a door.
        this.state.addStat(`q:world:${quest.world ?? 'emberkeep'}:done`, 1);
        // Paid on the LATCH flipping, not on `announce`. A save resumed past
        // this quest already carries the latch, so a reload can never pay
        // twice; and a quest that genuinely completes during a silent
        // re-derive is still owed its reward, it simply gets no banner.
        this.payRewards(quest);
        if (announce) this.bus.emit('quest:completed', { questId: quest.id });
      }
    }
    const active = this.activeQuest;
    if (active && active.id !== this.lastAnnounced) {
      this.lastAnnounced = active.id;
      if (announce) {
        this.bus.emit('quest:advanced', {
          questId: active.id,
          index: this.indexOf(active),
          total: this.tracked.length
        });
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
    if (rewards.spawn) this.bus.emit('board:spawn', { ...rewards.spawn, overflow: 'bag' });
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
          have: Math.min(this.state.countItems(goal.chain, goal.tier), goal.count),
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
