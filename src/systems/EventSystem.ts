import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import {
  compare,
  conditionsHold,
  eventStatKeys,
  flagKey,
  flattenEvents,
  PROPERTY_WATCH_EVENTS,
  readProperty,
  tapFactOf,
  TRIGGER_EVENTS,
  type FlatEvent,
  type PropertyFacts
} from '../core/gameEvents';
import type { GameState } from '../core/GameState';
import type { EventAction, EventKey, EventMap, EventsData, EventTrigger, GameEventConfig } from '../core/types';
import type { DragonSystem } from './DragonSystem';
import type { RegardSystem } from './RegardSystem';

/**
 * How long a chain of explicit `fire` actions may get. The CASCADE BOUND below
 * is what makes a cycle impossible — an event fires at most once per cascade,
 * so a `fire` chain can never outlast the roster. This is the separate, softer
 * bound: a `fire` is the one thing that still runs INLINE, on the stack, and
 * past a handful of hops the author has plainly meant a script, not a reaction.
 */
const MAX_FIRE_DEPTH = 8;

/** A trigger as the runtime listens for it: the tap sugar already lowered to its fact. */
interface ArmedTrigger {
  index: number;
  trigger: EventTrigger;
  /** For `event` and `tap`: the fact and the payload keys that must equal. */
  fact?: { event: string; match: Record<string, string | number | boolean> };
}

/**
 * THE EVENT SYSTEM — runs `events.json` (docs/event-creator.md).
 *
 * A scheduler of intents and nothing more: it listens for facts, reads
 * properties, and when an event's inputs are satisfied it emits the commands
 * the event's outputs name. It never mutates a board, a gauge or a person —
 * the owning systems do, through the same bus commands they always handled.
 * The only state it writes is its own: `evt:<id>:*` latches and `flag:*`
 * numbers in `stats`, which is why no event ever needs a `SAVE_VERSION`.
 *
 * Four ways in (WHEN), one way out (THEN):
 *   fact      — a bus event, narrowed by payload keys
 *   tap       — sugar over the tap facts, resolved against the live piece
 *   property  — an EDGE on a property path (false on the last look, true now)
 *   time      — game time since the event was armed
 * and `manual`, which only `fire`, the dev bridge or the API ever runs.
 *
 * Children are events INSIDE their parent: the same machinery, armed by the
 * parent's firing (`evt:<parent>:fired > 0`) instead of by boot.
 */
export class EventSystem {
  private readonly flat: FlatEvent[];
  private readonly byId = new Map<string, FlatEvent>();
  private readonly triggers = new Map<string, ArmedTrigger[]>();
  /** Last truth of every property trigger, keyed `<eventId>#<triggerIndex>`. */
  private readonly edge = new Map<string, boolean>();
  /**
   * EVERY QUESTION THE PLAYER STILL OWES AN ANSWER TO, oldest first.
   *
   * It was ONE slot, and a second `prompt` action — two in one `then`, or a
   * second event firing while the card was up — overwrote it. UIScene does not
   * drop that second question: it QUEUES it and shows it after the first is
   * answered. So the reply for the first arrived against the second's branches,
   * `answer()` found the wrong promptId and returned, and the branch the player
   * had just chosen never ran. The card had already closed itself, so tapping
   * again did nothing: the answer was discarded in silence.
   *
   * A list keeps each question's branches until ITS OWN reply arrives, in any
   * order, and duplicates of one id are answered oldest-first. It only grows by
   * one per question actually asked, and UIScene shows every one of them, so
   * the queue drains at the same rate the player answers.
   */
  private readonly openPrompts: Array<{ eventId: string; promptId: string; branches: Map<string, EventAction[]> }> = [];
  /* ------------------------------------------------------------------ *
   * THE CASCADE
   *
   * An event's outputs come straight back in as inputs: `event:fired` is
   * itself an observable trigger, a written flag re-reads every property edge,
   * and a command a system answers emits facts of its own — all SYNCHRONOUSLY,
   * while the firing that caused them is still on the stack. An event
   * listening for `event:fired` with no narrowing `match` therefore matches its
   * own firing: ~1160 frames deep, then a RangeError thrown INSIDE a bus
   * handler, which also abandons every subscriber queued after it on that emit.
   *
   * A RE-ENTRANCY guard (an event on the stack may not fire again) does NOT
   * fix that: it bounds ONE event, not the cascade. With two listeners, B is
   * not on the stack while A runs, so A's firing runs B and B's firing runs A
   * again the moment A returns — measured 2 firings each at N=2, 5 each at
   * N=3, 16 each at N=4. A shared DEPTH budget is no better on its own: it caps
   * the stack at d and still permits N^d firings.
   *
   * So the bound is stated over the whole cascade, and it is the strongest one
   * that still lets honest chains run:
   *
   *     ONE FACT ON THE BUS = ONE CASCADE,
   *     AND EACH EVENT FIRES AT MOST ONCE INSIDE IT.
   *
   * The work one fact can set off is then at most N firings for a roster of
   * N events, whatever shape the graph has — self-matching, mutual
   * `match: { id }` pairs, a ring of any length, flag ping-pong. It holds for
   * every route in because every route lowers to `runIfAllowed`.
   *
   * IT IS PER FACT, NOT PER PLAYER GESTURE, and the difference is not
   * cosmetic: while the bus dispatches `keeper:leveled`, RewardSystem and
   * EconomySystem emit facts of their own, and this system is handed those the
   * same way it is handed the first — the bus does not say which emit is
   * nested inside which. So one level-up can still run several cascades, one
   * per fact, and an event listening for two of those facts fires in each.
   * What is bounded here is every route THIS system owns; widening it further
   * would mean holding the cascade open across another module's emit.
   *
   * A cascade DRAINS rather than recurses: anything raised while one is running
   * queues behind it, so an event's actions always finish before what they set
   * off begins, and the stack stays flat (`fire` excepted — see MAX_FIRE_DEPTH).
   *
   * `spent` carries the bound, `pending` is the queue, `draining` says a cascade
   * owns the current stack. All three belong to the cascade and are cleared when
   * it ends, so the SAME fact arriving twice is still two firings.
   * ------------------------------------------------------------------ */
  private draining = false;
  private readonly pending: FlatEvent[] = [];
  private readonly spent = new Set<string>();
  private fireDepth = 0;
  private started = false;

  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    data: EventsData,
    private dragons: DragonSystem,
    private regard: RegardSystem
  ) {
    this.flat = flattenEvents(data.events ?? []);
    for (const f of this.flat) {
      this.byId.set(f.event.id, f);
      this.triggers.set(f.event.id, f.event.when.map((trigger, index) => this.lower(trigger, index)));
    }

    // ONE SUBSCRIPTION PER FACT — never one per list it appears in.
    //
    // Nine facts are BOTH observable triggers and property-watch facts
    // (`item:merged`, `item:spawned`, `item:sold`, `bag:stored`,
    // `quest:completed`, `keeper:leveled`, `world:ready`, `tutorial:step`,
    // `event:fired`). Two subscriptions on one fact are two TOP-LEVEL cascades:
    // the fact match drains to the end, then a property sweep starts over with
    // a FRESH `spent`. The bound was then stated per subscription, not per
    // fact — measured on one `keeper:leveled`, four top-level cascades opened.
    //
    // One handler raises BOTH inside ONE cascade, and it raises the property
    // edges at the same moment as the fact: before anything the fact matched
    // has run, so the edge the stimulus arrived on is read as it stood then,
    // not as some event it woke has since left it.
    const listened = new Set<string>();
    for (const list of this.triggers.values()) {
      for (const t of list) if (t.fact && TRIGGER_EVENTS[t.fact.event]) listened.add(t.fact.event);
    }
    const watched = new Set<string>(PROPERTY_WATCH_EVENTS);
    for (const fact of new Set([...listened, ...watched])) {
      bus.on(fact as EventKey, (payload: EventMap[EventKey]) => {
        if (!this.started) return;
        this.cascade(() => {
          if (listened.has(fact)) this.raiseFact(fact, payload);
          if (watched.has(fact)) this.raiseProperties();
        });
      });
    }
    bus.on('time:advanced', () => this.tick());
    bus.on('ui:event_choice', ({ eventId, promptId, choice }) => this.answer(eventId, promptId, choice));
    // A fresh game: every latch is gone, so the baselines must be re-read or a
    // property that was true in the old save would never show its edge again.
    bus.on('game:reset', () => {
      this.edge.clear();
      this.openPrompts.length = 0;
      // The cascade's own state belongs to the cascade and its `finally` clears it,
      // so a reset has nothing to clean up there.
      this.started = false;
    });
  }

  /**
   * Arm the roots and take the property baselines — WITHOUT firing anything.
   * Called once the state is final (after hydrate or reset): a property that
   * is already true on load is not an edge, and a `once` event that fired in
   * the old session reads its latch rather than firing again.
   */
  begin(): void {
    const now = this.clock.now();
    for (const f of this.flat) {
      const keys = eventStatKeys(f.event.id);
      if (!f.parent && this.state.stat(keys.armed) === 0) this.state.stats[keys.armed] = now;
    }
    this.baseline();
    this.started = true;
  }

  /** Every event with its live status — the dev bridge and `render_game_to_text` read this. */
  status(): Array<{ id: string; armed: boolean; fired: number; depth: number }> {
    return this.flat.map((f) => ({
      id: f.event.id,
      armed: this.isArmed(f),
      fired: this.state.stat(eventStatKeys(f.event.id).fired),
      depth: f.depth
    }));
  }

  /**
   * Run an event NOW, by id — guards and latches still apply, so this is how a
   * `manual` event is started and how the editor's Run button works. Returns
   * whether it fired.
   */
  fire(id: string): boolean {
    const f = this.byId.get(id);
    if (!f) return false;
    // A fire from outside is a stimulus like any other, so it opens a cascade;
    // one raised from inside a running cascade (the `fire` action, the dev
    // bridge mid-drain) runs on the spot, still holding its one turn.
    let ran = false;
    this.cascade(() => {
      ran = this.runIfAllowed(f);
    });
    return ran;
  }

  /* ---------------------------------------------------------------- */
  /* Inputs                                                           */
  /* ---------------------------------------------------------------- */

  private lower(trigger: EventTrigger, index: number): ArmedTrigger {
    if (trigger.type === 'event') return { index, trigger, fact: { event: trigger.event, match: trigger.match ?? {} } };
    if (trigger.type === 'tap') {
      const fact = tapFactOf(trigger.target);
      if (fact) return { index, trigger, fact: { event: fact.event, match: fact.key ? { [fact.key]: fact.value! } : {} } };
    }
    return { index, trigger };
  }

  /**
   * THE WHOLE FACT is one raise, not one per listener: two events on the same
   * fact used to get a cascade each, and each cascade ran the other. Raise
   * only — the caller owns the cascade, so a fact that is also property-watched
   * queues its property edges into the same drain.
   */
  private raiseFact(fact: string, payload: unknown): void {
    const view = this.enrich(fact, payload);
    // Who may answer THIS fact is decided before anyone does: a child armed by
    // its parent's firing a moment ago is not offered the same tap.
    const armed = this.flat.filter((f) => this.isArmed(f));
    for (const f of armed) {
      const hit = this.triggers.get(f.event.id)!.some(
        (t) => t.fact?.event === fact && Object.entries(t.fact.match).every(([k, v]) => readPath(view, k) === v)
      );
      if (hit) this.enqueue(f);
    }
  }

  /** The tap facts carry an item id; the author wrote a chain. Resolve it here. */
  private enrich(fact: string, payload: unknown): unknown {
    if (fact !== 'item:tapped' && fact !== 'elder:tapped') return payload;
    const id = (payload as { itemId?: number } | undefined)?.itemId;
    const item = id === undefined ? undefined : this.state.items.get(id);
    return item ? { ...(payload as object), chain: item.chain, tier: item.tier } : payload;
  }

  /**
   * A flag an action wrote is a property change with no fact behind it, so the
   * edges are re-read on the spot. Inside a drain this is just the raise.
   */
  private checkProperties(): void {
    if (!this.started) return;
    this.cascade(() => this.raiseProperties());
  }

  /** Raise only — every armed property trigger that has just gone true. */
  private raiseProperties(): void {
    const facts = this.facts();
    for (const f of this.flat) {
      if (!this.isArmed(f)) continue;
      for (const t of this.triggers.get(f.event.id)!) {
        if (t.trigger.type !== 'property') continue;
        const key = `${f.event.id}#${t.index}`;
        const truth = compare(readProperty(facts, t.trigger.prop), t.trigger.op, t.trigger.value);
        const before = this.edge.get(key);
        // The edge is recorded WHERE IT IS SEEN even though the firing waits
        // its turn — otherwise the next look would read the same rise again.
        this.edge.set(key, truth);
        // No baseline yet (a child armed mid-session) → this look IS the baseline.
        if (before === false && truth) this.enqueue(f);
      }
    }
  }

  /** Take every armed property trigger's current truth without firing. */
  private baseline(): void {
    const facts = this.facts();
    for (const f of this.flat) {
      if (!this.isArmed(f)) continue;
      for (const t of this.triggers.get(f.event.id)!) {
        if (t.trigger.type !== 'property') continue;
        const key = `${f.event.id}#${t.index}`;
        if (!this.edge.has(key)) this.edge.set(key, compare(readProperty(facts, t.trigger.prop), t.trigger.op, t.trigger.value));
      }
    }
  }

  private tick(): void {
    if (!this.started) return;
    this.cascade(() => {
      const now = this.clock.now();
      for (const f of this.flat) {
        if (!this.isArmed(f)) continue;
        const keys = eventStatKeys(f.event.id);
        const armedAt = this.state.stat(keys.armed);
        const last = this.state.stat(keys.last);
        for (const t of this.triggers.get(f.event.id)!) {
          if (t.trigger.type !== 'time') continue;
          const due = armedAt + t.trigger.afterMs;
          // Once per arming: a firing after the stamp retires this trigger until
          // the parent fires again (children) — a root is armed once, at boot.
          if (now >= due && last < due) this.enqueue(f);
        }
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Gate and output                                                  */
  /* ---------------------------------------------------------------- */

  private isArmed(f: FlatEvent): boolean {
    return !f.parent || this.state.stat(eventStatKeys(f.parent.id).fired) > 0;
  }

  private mayFire(event: GameEventConfig): boolean {
    const keys = eventStatKeys(event.id);
    const fired = this.state.stat(keys.fired);
    if (event.once && fired > 0) return false;
    if (event.limit && fired >= event.limit) return false;
    if (event.cooldownMs && fired > 0 && this.clock.now() - this.state.stat(keys.last) < event.cooldownMs) return false;
    return true;
  }

  /**
   * Run `raise` — the stimulus, which only ever ENQUEUES what it matched — and
   * then drain everything that queues behind it until nothing is left. Called
   * again from inside, it is just the raise: the drain already running owns the
   * queue, and that is what keeps one fact to one cascade.
   */
  private cascade(raise: () => void): void {
    if (this.draining) {
      raise();
      return;
    }
    this.draining = true;
    try {
      raise();
      for (let next = this.pending.shift(); next; next = this.pending.shift()) this.runIfAllowed(next);
    } finally {
      // An action that throws must not leave the system barred for the session.
      this.draining = false;
      this.pending.length = 0;
      this.spent.clear();
      this.fireDepth = 0;
    }
  }

  /** A trigger matched: this event takes its ONE turn in the current cascade. */
  private enqueue(f: FlatEvent): void {
    if (this.spent.has(f.event.id)) return;
    if (this.pending.some((p) => p.event.id === f.event.id)) return;
    this.pending.push(f);
  }

  /** The ONE door into a firing — every input lowers to this, so the cascade
   *  bound belongs here rather than on any single trigger. */
  private runIfAllowed(f: FlatEvent): boolean {
    if (this.spent.has(f.event.id)) return false;
    if (!this.mayFire(f.event)) return false;
    if (!conditionsHold(this.facts(), f.event.if)) return false;
    // Spent BEFORE the actions run: every route back in — its own `event:fired`,
    // a flag it writes, an event it fires that fires it — meets a spent event.
    // A firing that its guards REFUSED costs nothing, so a later, honest raise
    // in the same cascade can still fire it.
    this.spent.add(f.event.id);
    this.run(f);
    return true;
  }

  private run(f: FlatEvent): void {
    const now = this.clock.now();
    const keys = eventStatKeys(f.event.id);
    // Latch BEFORE the actions: an action that re-enters this event (a `fire`
    // loop, a fact it emits itself) meets a fired event, not an open one.
    this.state.addStat(keys.fired, 1);
    this.state.stats[keys.last] = now;
    for (const child of f.event.children ?? []) this.state.stats[eventStatKeys(child.id).armed] = now;
    this.runActions(f.event.then, f.event.id);
    this.bus.emit('event:fired', { id: f.event.id, count: this.state.stat(keys.fired) });
    // Children just armed take their property baselines now, not on the next
    // fact — otherwise their first look would read as an edge.
    this.baseline();
  }

  private runActions(actions: EventAction[], eventId: string): void {
    for (const a of actions) this.runAction(a, eventId);
  }

  private runAction(a: EventAction, eventId: string): void {
    if ('add' in a) return this.add(a.add, a.amount, a.reason ?? `event:${eventId}`);
    if ('set' in a) {
      this.state.stats[flagKey(a.set.slice('flag.'.length))] = a.value;
      return;
    }
    if ('say' in a) return this.bus.emit('event:say', { eventId, speaker: a.say.speaker, lines: a.say.lines });
    if ('prompt' in a) {
      const branches = new Map(a.prompt.choices.map((c) => [c.id, c.then] as const));
      this.openPrompts.push({ eventId, promptId: a.prompt.id, branches });
      return this.bus.emit('event:prompt', {
        eventId,
        promptId: a.prompt.id,
        speaker: a.prompt.speaker,
        text: a.prompt.text,
        choices: a.prompt.choices.map((c) => ({ id: c.id, label: c.label }))
      });
    }
    if ('spawn' in a) {
      return this.bus.emit('board:spawn', {
        chain: a.spawn.chain,
        tier: a.spawn.tier,
        count: a.spawn.count,
        at: a.spawn.at,
        overflow: 'bag',
        cause: 'quest'
      });
    }
    if ('retier' in a) return this.bus.emit('board:retier', a.retier);
    if ('open' in a) return this.bus.emit('ui:panel_open_requested', { panel: a.open });
    if ('tutorial' in a) return this.bus.emit('tutorial:start_requested', { tutorial: a.tutorial });
    if ('fire' in a) {
      const target = this.byId.get(a.fire);
      if (!target || this.fireDepth >= MAX_FIRE_DEPTH) return;
      // INLINE, unlike a fact: `fire` is the author saying NOW, so the rest of
      // this `then` reads what it did. `spent` still holds it to one turn, so
      // the inline stack cannot outgrow the roster.
      this.fireDepth++;
      try {
        this.runIfAllowed(target);
      } finally {
        this.fireDepth--;
      }
      return;
    }
    if ('emit' in a) {
      this.bus.emit(a.emit as EventKey, (a.payload ?? {}) as EventMap[EventKey]);
    }
  }

  /** `add` on a writable path — each one is the owning system's command. */
  private add(path: string, amount: number, reason: string): void {
    const [root, a, b] = path.split('.');
    if (root === 'keeper') {
      if (a === 'coins') return this.bus.emit('economy:add', { coins: amount, reason });
      if (a === 'keys') return this.bus.emit('economy:add', { keys: amount, reason });
      if (a === 'xp') return this.bus.emit('economy:add', { xp: amount, reason });
      if (a === 'energy') return this.bus.emit('energy:add', { amount, reason });
      return;
    }
    if (root === 'character' && b === 'regard') return this.bus.emit('regard:add', { characterId: a, points: amount, reason });
    if (root === 'flag') {
      this.state.addStat(flagKey(a), amount);
      this.checkProperties();
    }
  }

  private answer(eventId: string, promptId: string, choice: string): void {
    // Oldest first: the player answers the card in front of them, and two
    // firings of the SAME question are two answers, not one lost one.
    const at = this.openPrompts.findIndex((p) => p.eventId === eventId && p.promptId === promptId);
    if (at < 0) return;
    const [open] = this.openPrompts.splice(at, 1);
    const branch = open.branches.get(choice);
    // The player's answer is a stimulus of its own — one cascade, one turn each.
    if (branch) this.cascade(() => this.runActions(branch, eventId));
  }

  /* ---------------------------------------------------------------- */
  /* Properties — the read view over the live state                   */
  /* ---------------------------------------------------------------- */

  private facts(): PropertyFacts {
    const state = this.state;
    const dragons = this.dragons;
    return {
      level: state.level,
      xp: state.xp,
      coins: state.coins,
      keys: state.keys,
      energy: state.energyCurrent,
      tutorialDone: state.tutorialDone,
      worldId: state.worldId,
      regardPoints: (id) => this.regard.points(id),
      hearts: (id) => this.regard.hearts(id),
      dragonTrust: (chain) => {
        let best = 0;
        for (const item of state.items.values()) {
          if (item.chain !== chain || !dragons.isBoardDragon(item)) continue;
          best = Math.max(best, dragons.careOf(item.id).trust);
        }
        return best;
      },
      dragonCount: (chain) => {
        let n = 0;
        for (const item of state.items.values()) if (item.chain === chain && dragons.isBoardDragon(item)) n++;
        return n;
      },
      boardCount: (chain, tier) => state.countItems(chain, tier),
      stat: (key) => state.stat(key)
    };
  }
}

/** `a.b.c` into a payload — the dotted keys `match` may name. */
function readPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
