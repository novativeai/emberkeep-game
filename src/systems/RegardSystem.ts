import {
  giftKey,
  heartsForPoints,
  REGARD_GIFT_POINTS,
  REGARD_MAX_POINTS,
  REGARD_POINTS_PER_HEART,
  REGARD_QUEST_POINTS,
  regardKey,
  regardPaidKey
} from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { CharactersData, QuestConfig, QuestStepConfig } from '../core/types';
import type { OrderSystem } from './OrderSystem';
import type { QuestSystem } from './QuestSystem';

/** A live gift step of the active quest, shaped for the Ledger's card. */
export interface GiftAsk {
  stepId: string;
  label: string;
  characterId: string;
  chain: string;
  tier: number;
  remaining: number;
  onBoard: number;
  deliverable: boolean;
}

/**
 * REGARD — the five hearts each of the two people keeps for the Keeper.
 *
 * Eleanor in the south, Selyna in the north. It is the human counterpart of a
 * dragon's Trust and it works on the same two rules: it never decays, and it
 * cannot be bought. The only two things that pay it are a completed quest and a
 * gift she actually asked for, so it is a record of what the player did rather
 * than of what they spent.
 *
 * **The gauge is derived, never kept.** Points live in `GameState.stats` under
 * `regard:<id>` and hearts are `floor(points / REGARD_POINTS_PER_HEART)`, so
 * there is exactly one number and the UI cannot disagree with the gate. Same
 * law the quest ladder holds to: nothing in here keeps a counter of its own.
 *
 * **What she wants is the quest ladder's business, not this system's.** A gift
 * is accepted when — and only when — a LIVE `gift` subquest names that exact
 * piece for that exact person. There is no second want-table to drift out of
 * step with the ladder, and it makes the fiction and the mechanic one sentence:
 * she asks for a thing, and the thing she asked for is the thing she will take.
 * Anything else is declined politely and stays on the board.
 *
 * Phaser-free, so it runs in the node tests like every other system.
 */
export class RegardSystem {
  /** Ids of everyone who can hold Regard, in authored order. */
  private readonly ids: string[];

  constructor(
    private state: GameState,
    private bus: EventBus,
    characters: CharactersData,
    private quests: QuestSystem,
    /** Read-only here (giveTarget): a give that no gift step wants may still be
     *  a delivery in singles. The MUTATION goes through `order:give`, which
     *  OrderSystem owns — the one-way rule between systems holds. */
    private orders: OrderSystem
  ) {
    // Canonical PEOPLE, not standee entries: `art ?? id` folds Eleanor-at-home
    // (roothold) onto Eleanor — one Regard gauge and one heart-scene bank per
    // person, however many worlds they stand in.
    this.ids = [...new Set(characters.characters.map((c) => c.art ?? c.id))];

    bus.on('ui:gift_requested', ({ characterId, chain, tier }) =>
      this.offer(characterId, chain, tier)
    );
    bus.on('ui:gift_deliver_requested', ({ characterId, chain, tier }) =>
      this.deliverFromBoard(characterId, chain, tier)
    );
    // The gift-ask "order" announcements (Hud dot + Ledger card): a gift step's
    // deliverability is a property of the BOARD, so it re-announces on the same
    // facts the real Ledger does — plus quest movement, which is what retires an
    // ask and must switch its dot off.
    for (const event of [
      'item:spawned',
      'item:merged',
      'item:removed',
      'state:loaded',
      'world:switched',
      'quest:step_completed',
      'quest:advanced',
      'regard:gift_accepted'
    ] as const) {
      bus.on(event, () => this.announceGiftAsks());
    }
    // A finished quest pays its giver. Latched per quest, so a re-derivation can
    // never pay twice — and a quest that completed while the ladder was being
    // re-derived silently (a load) is caught by `settleUnpaid` below.
    bus.on('quest:completed', ({ questId }) => this.payQuest(questId, true));
    bus.on('state:loaded', () => this.settleUnpaid());
    bus.on('tutorial:want_gift', (want) => {
      this.scripted = { ...want };
    });
  }

  /**
   * A want the TUTORIAL staged, standing in for the quest ladder.
   *
   * The give-gesture is taught before the Ledger is open, so there is no live
   * `gift` subquest to answer `wants()` — this is that subquest, for one lesson,
   * and it is spent the moment the piece is handed over. Deliberately NOT
   * persisted: a save resumed mid-tutorial replays its step, and the step's own
   * effect re-stages the want.
   */
  private scripted:
    | { characterId: string; chain: string; tier: number; count: number; points?: number }
    | null = null;

  /** Everyone who can hold Regard. */
  get characterIds(): readonly string[] {
    return this.ids;
  }

  points(characterId: string): number {
    return this.state.stat(regardKey(characterId));
  }

  hearts(characterId: string): number {
    return heartsForPoints(this.points(characterId));
  }

  /** Points banked toward the heart in progress, and what that heart costs —
   *  the partial fill the UI draws on the next, unlit heart. A full gauge has no
   *  heart in progress, so it reads as one whole heart rather than as zero. */
  progress(characterId: string): { have: number; need: number } {
    const points = Math.min(REGARD_MAX_POINTS, this.points(characterId));
    if (points >= REGARD_MAX_POINTS) return { have: REGARD_POINTS_PER_HEART, need: REGARD_POINTS_PER_HEART };
    return { have: points % REGARD_POINTS_PER_HEART, need: REGARD_POINTS_PER_HEART };
  }

  /** How many of this piece have EVER been given to this person. A `gift` goal
   *  reads exactly this, which is why it is a lifetime counter and not a
   *  per-quest tally: two quests may legally ask for the same keepsake. */
  given(characterId: string, chain: string, tier: number): number {
    return this.state.stat(giftKey(characterId, chain, tier));
  }

  /**
   * Is she standing there waiting for THIS piece right now?
   *
   * True when some quest in the ladder has an unfinished, unlocked `gift` step
   * naming this person and this piece. The board asks before it consumes, so
   * this predicate and the one inside `offer` must be the same one — it is.
   */
  wants(characterId: string, chain: string, tier: number): boolean {
    return this.outstanding(characterId, chain, tier) > 0;
  }

  /** How many more of it a live gift step still needs (0 = she wants none). */
  outstanding(characterId: string, chain: string, tier: number): number {
    const s = this.scripted;
    if (s && s.characterId === characterId && s.chain === chain && s.tier === tier) {
      return Math.max(0, s.count);
    }
    let most = 0;
    for (const quest of this.quests.all) {
      for (const step of quest.steps) {
        const goal = step.goal;
        if (goal.kind !== 'gift') continue;
        if (goal.characterId !== characterId) continue;
        if (goal.chain !== chain || goal.tier !== tier) continue;
        if (this.quests.stepDone(step) || this.quests.isLocked(step)) continue;
        most = Math.max(most, goal.count - this.given(characterId, chain, tier));
      }
    }
    return Math.max(0, most);
  }

  /** Every piece she is currently asking for, for a UI that wants to show it. */
  wishlist(characterId: string): Array<{ chain: string; tier: number; have: number; need: number }> {
    const out: Array<{ chain: string; tier: number; have: number; need: number }> = [];
    for (const quest of this.quests.all) {
      for (const step of quest.steps) {
        const goal = step.goal;
        if (goal.kind !== 'gift' || goal.characterId !== characterId) continue;
        if (this.quests.stepDone(step) || this.quests.isLocked(step)) continue;
        if (out.some((w) => w.chain === goal.chain && w.tier === goal.tier)) continue;
        out.push({
          chain: goal.chain,
          tier: goal.tier,
          have: Math.min(goal.count, this.given(characterId, goal.chain, goal.tier)),
          need: goal.count
        });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ giving

  /**
   * She is handed one piece.
   *
   * Nothing here removes it from the board — the caller does that, and only
   * after checking the counter actually moved. A refused gift must leave the
   * piece exactly where it was, which is the same contract a nest offering and
   * a dragon's refusal already hold.
   */
  private offer(characterId: string, chain: string, tier: number): void {
    if (!this.ids.includes(characterId)) return;
    if (!this.wants(characterId, chain, tier)) {
      // No gift step wants it — but her own live ORDER might. Give and Deliver
      // are the same verb in different grammar: a piece handed over that the
      // giver's visible order needs is a delivery in singles, banked toward the
      // order (`order:give` → OrderSystem), which completes on its own the
      // moment everything is given. The lifetime given-counter still moves (it
      // IS a thing given to her — and it is what tells the board the piece was
      // taken), but no Regard points: the Deliver button pays none either, and
      // the two verbs must stay worth exactly the same.
      if (this.orders.giveTarget(characterId, chain, tier)) {
        this.state.addStat(giftKey(characterId, chain, tier), 1);
        this.bus.emit('order:give', { characterId, chain, tier });
        this.bus.emit('regard:gift_accepted', { characterId, chain, tier, points: 0 });
        return;
      }
      this.bus.emit('regard:gift_declined', {
        characterId,
        chain,
        tier,
        // Told apart on purpose: "I have everything I need from you" is a very
        // different sentence from "that isn't what I asked for", and at five
        // hearts it is the only true one.
        reason: this.points(characterId) >= REGARD_MAX_POINTS ? 'complete' : 'not_wanted'
      });
      return;
    }
    this.state.addStat(giftKey(characterId, chain, tier), 1);
    // A scripted want is spent as it is met, so the lesson cannot be repeated
    // into a Regard farm with the same piece — and it may name its own price.
    const s = this.scripted;
    let points = REGARD_GIFT_POINTS;
    if (s && s.characterId === characterId && s.chain === chain && s.tier === tier) {
      points = s.points ?? REGARD_GIFT_POINTS;
      s.count -= 1;
      if (s.count <= 0) this.scripted = null;
    }
    this.bus.emit('regard:gift_accepted', { characterId, chain, tier, points });
    // A gift is the one fact that can finish a `gift` step, so QuestSystem
    // subscribes to `regard:gift_accepted` like any other trigger — which is why
    // the award is paid AFTER the counter is written and the fact announced.
    this.award(characterId, points, 'gift', true);
  }

  /**
   * The Deliver verb, pointed at a GIFT step: hand over pieces straight off the
   * board, no pocketing. Each piece runs the exact accept `offer` runs for a
   * bag give — counter, points, celebration, the same events in the same order
   * — and is consumed from the board only after her record moved (the
   * check-the-record contract every handing-over holds). Stops the moment she
   * wants no more or the board runs dry, so a partial board still pays what it
   * can.
   */
  private deliverFromBoard(characterId: string, chain: string, tier: number): void {
    for (let guard = 0; guard < 99; guard++) {
      if (this.outstanding(characterId, chain, tier) <= 0) break;
      const item = this.state.itemsMatching(chain, tier).sort((a, b) => a.id - b.id)[0];
      if (!item) break;
      const before = this.given(characterId, chain, tier);
      this.offer(characterId, chain, tier);
      if (this.given(characterId, chain, tier) <= before) break;
      this.bus.emit('board:consume_items', { itemIds: [item.id], reason: 'delivered' });
    }
  }

  // ------------------------------------------- the gift ask, worn as an order

  /** Ids announced last time, so a retired ask can switch its dot OFF. */
  private announcedAsks = new Set<string>();

  /**
   * The ACTIVE quest's live gift steps, shaped for the Ledger: who is asking,
   * for what, how many are still owed, and whether the board covers it. The
   * Ledger wears one as a card with a Deliver button; the Hud's dot hears the
   * `order:progress` announcements below exactly as it hears a real order's.
   */
  giftAsks(): GiftAsk[] {
    const quest = this.quests.activeQuest;
    if (!quest) return [];
    const out: GiftAsk[] = [];
    for (const step of quest.steps) {
      const goal = step.goal;
      if (goal.kind !== 'gift') continue;
      if (this.quests.stepDone(step) || this.quests.isLocked(step)) continue;
      const remaining = Math.max(0, goal.count - this.given(goal.characterId, goal.chain, goal.tier));
      if (remaining === 0) continue;
      const onBoard = this.state.countItems(goal.chain, goal.tier);
      out.push({
        stepId: step.id,
        label: this.quests.progressFor(step).label,
        characterId: goal.characterId,
        chain: goal.chain,
        tier: goal.tier,
        remaining,
        onBoard: Math.min(onBoard, remaining),
        deliverable: onBoard >= remaining
      });
    }
    return out;
  }

  private announceGiftAsks(): void {
    const seen = new Set<string>();
    for (const ask of this.giftAsks()) {
      const id = `gift:${ask.stepId}`;
      seen.add(id);
      this.bus.emit('order:progress', {
        orderId: id,
        have: [ask.onBoard],
        need: [ask.remaining],
        deliverable: ask.deliverable
      });
    }
    for (const id of this.announcedAsks) {
      if (!seen.has(id)) {
        this.bus.emit('order:progress', { orderId: id, have: [], need: [], deliverable: false });
      }
    }
    this.announcedAsks = seen;
  }

  // ------------------------------------------------------------------ quests

  /** Pay a quest's Regard to its giver, once ever. */
  private payQuest(questId: string, announce: boolean): void {
    const quest = this.quests.all.find((q) => q.id === questId);
    if (!quest) return;
    const amount = quest.regard ?? REGARD_QUEST_POINTS;
    if (amount <= 0) return;
    const paid = regardPaidKey(quest.id);
    if (this.state.stat(paid) > 0) return;
    this.state.addStat(paid, 1);
    this.award(quest.giver, amount, 'quest', announce);
  }

  /**
   * A quest can finish without anyone hearing it: QuestSystem re-derives the
   * whole ladder on load with `announce = false`, so a save resumed past a quest
   * completed by a build that had no Regard would never be paid for it.
   *
   * Settle those silently at load. Regard is a function of which quests are
   * done, so the honest behaviour is to make it true — not to make it true only
   * for players who happened to be online when the beat fired.
   */
  private settleUnpaid(): void {
    for (const quest of this.quests.all) {
      if (!this.isComplete(quest)) continue;
      this.payQuest(quest.id, false);
    }
  }

  private isComplete(quest: QuestConfig): boolean {
    return quest.steps.every((step: QuestStepConfig) => this.quests.stepDone(step));
  }

  // ------------------------------------------------------------------ paying

  private award(
    characterId: string,
    amount: number,
    reason: 'quest' | 'gift' | 'load',
    announce: boolean
  ): void {
    const before = this.points(characterId);
    if (before >= REGARD_MAX_POINTS) return;
    const after = Math.min(REGARD_MAX_POINTS, before + amount);
    this.state.stats[regardKey(characterId)] = after;

    const hearts = heartsForPoints(after);
    this.bus.emit('regard:changed', {
      characterId,
      points: after,
      hearts,
      reason: announce ? reason : 'load'
    });
    // One beat per heart crossed, in order. Awards are small enough that this is
    // always 0 or 1 today, but a bigger authored payout must not swallow a
    // milestone — every heart the player earns gets its scene.
    if (!announce) return;
    for (let h = heartsForPoints(before) + 1; h <= hearts; h++) {
      this.bus.emit('regard:heart', { characterId, hearts: h });
    }
  }
}
