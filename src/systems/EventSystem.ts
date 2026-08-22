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

/** `fire` chains are bounded so two events naming each other cannot recurse forever. */
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
  /** The one prompt the player may be looking at; its branches by choice id. */
  private openPrompt: { eventId: string; promptId: string; branches: Map<string, EventAction[]> } | null = null;
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

    // One subscription per distinct fact any event listens for.
    const facts = new Set<string>();
    for (const list of this.triggers.values()) for (const t of list) if (t.fact) facts.add(t.fact.event);
    for (const fact of facts) {
      if (!TRIGGER_EVENTS[fact]) continue;
      bus.on(fact as EventKey, (payload: EventMap[EventKey]) => this.onFact(fact, payload));
    }
    for (const fact of PROPERTY_WATCH_EVENTS) {
      bus.on(fact as EventKey, () => this.checkProperties());
    }
    bus.on('time:advanced', () => this.tick());
    bus.on('ui:event_choice', ({ eventId, promptId, choice }) => this.answer(eventId, promptId, choice));
    // A fresh game: every latch is gone, so the baselines must be re-read or a
    // property that was true in the old save would never show its edge again.
    bus.on('game:reset', () => {
      this.edge.clear();
      this.openPrompt = null;
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
    return this.attempt(f, 0);
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

  private onFact(fact: string, payload: unknown): void {
    if (!this.started) return;
    const view = this.enrich(fact, payload);
    // Who may answer THIS fact is decided before anyone does: a child armed by
    // its parent's firing a moment ago is not offered the same tap.
    const armed = this.flat.filter((f) => this.isArmed(f));
    for (const f of armed) {
      const hit = this.triggers.get(f.event.id)!.some(
        (t) => t.fact?.event === fact && Object.entries(t.fact.match).every(([k, v]) => readPath(view, k) === v)
      );
      if (hit) this.attempt(f, 0);
    }
  }

  /** The tap facts carry an item id; the author wrote a chain. Resolve it here. */
  private enrich(fact: string, payload: unknown): unknown {
    if (fact !== 'item:tapped' && fact !== 'elder:tapped') return payload;
    const id = (payload as { itemId?: number } | undefined)?.itemId;
    const item = id === undefined ? undefined : this.state.items.get(id);
    return item ? { ...(payload as object), chain: item.chain, tier: item.tier } : payload;
  }

  private checkProperties(): void {
    if (!this.started) return;
    const facts = this.facts();
    for (const f of this.flat) {
      if (!this.isArmed(f)) continue;
      for (const t of this.triggers.get(f.event.id)!) {
        if (t.trigger.type !== 'property') continue;
        const key = `${f.event.id}#${t.index}`;
        const truth = compare(readProperty(facts, t.trigger.prop), t.trigger.op, t.trigger.value);
        const before = this.edge.get(key);
        this.edge.set(key, truth);
        // No baseline yet (a child armed mid-session) → this look IS the baseline.
        if (before === false && truth) this.attempt(f, 0);
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
        if (now >= due && last < due) this.attempt(f, 0);
      }
    }
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

  private attempt(f: FlatEvent, depth: number): boolean {
    if (!this.mayFire(f.event)) return false;
    if (!conditionsHold(this.facts(), f.event.if)) return false;
    this.run(f, depth);
    return true;
  }

  private run(f: FlatEvent, depth: number): void {
    const now = this.clock.now();
    const keys = eventStatKeys(f.event.id);
    // Latch BEFORE the actions: an action that re-enters this event (a `fire`
    // loop, a fact it emits itself) meets a fired event, not an open one.
    this.state.addStat(keys.fired, 1);
    this.state.stats[keys.last] = now;
    for (const child of f.event.children ?? []) this.state.stats[eventStatKeys(child.id).armed] = now;
    this.runActions(f.event.then, f.event.id, depth);
    this.bus.emit('event:fired', { id: f.event.id, count: this.state.stat(keys.fired) });
    // Children just armed take their property baselines now, not on the next
    // fact — otherwise their first look would read as an edge.
    this.baseline();
  }

  private runActions(actions: EventAction[], eventId: string, depth: number): void {
    for (const a of actions) this.runAction(a, eventId, depth);
  }

  private runAction(a: EventAction, eventId: string, depth: number): void {
    if ('add' in a) return this.add(a.add, a.amount, a.reason ?? `event:${eventId}`);
    if ('set' in a) {
      this.state.stats[flagKey(a.set.slice('flag.'.length))] = a.value;
      return;
    }
    if ('say' in a) return this.bus.emit('event:say', { eventId, speaker: a.say.speaker, lines: a.say.lines });
    if ('prompt' in a) {
      const branches = new Map(a.prompt.choices.map((c) => [c.id, c.then] as const));
      this.openPrompt = { eventId, promptId: a.prompt.id, branches };
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
      if (target && depth < MAX_FIRE_DEPTH) this.attempt(target, depth + 1);
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
    const open = this.openPrompt;
    if (!open || open.eventId !== eventId || open.promptId !== promptId) return;
    const branch = open.branches.get(choice);
    this.openPrompt = null;
    if (branch) this.runActions(branch, eventId, 0);
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
