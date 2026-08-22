/**
 * GAME EVENTS — the one place that knows what `events.json` MEANS.
 *
 * An event is an input → output block (docs/event-creator.md): WHEN one of its
 * triggers fires and IF every condition holds, THEN its actions run. Children
 * are events inside it, armed by its firing. This module is the pure half —
 * the vocabularies, the validator, the property reader and the stat keys —
 * shared by EventSystem (runtime), the dev API (writes), the editor (pickers)
 * and the unit suite. No Phaser, no GameState import: the runtime hands in a
 * `PropertyFacts` view and gets numbers back.
 */
import type {
  EventAction,
  EventCompareOp,
  EventCondition,
  EventPanel,
  EventsData,
  EventTrigger,
  GameEventConfig,
  SpeakerId
} from './types';

/* ------------------------------------------------------------------ */
/* Vocabularies — closed on purpose; the editor and validator read them */
/* ------------------------------------------------------------------ */

export const SPEAKERS: readonly SpeakerId[] = ['eleanor', 'selyna', 'golden_elder'];
export const PANELS: readonly EventPanel[] = ['ledger', 'store', 'bag', 'cauldron', 'codex', 'cookbook'];
export const COMPARE_OPS: readonly EventCompareOp[] = ['==', '!=', '>', '>=', '<', '<='];
export const TRIGGER_TYPES = ['event', 'tap', 'property', 'time', 'manual'] as const;
export const ACTION_KINDS = ['add', 'set', 'say', 'prompt', 'spawn', 'retier', 'open', 'tutorial', 'fire', 'emit'] as const;

/**
 * The bus FACTS an `event` trigger may listen for, with the payload keys a
 * `match` may name (dotted for nested snapshots). Anything not here is not an
 * observable input — commands and intents are outputs, never inputs.
 */
export const TRIGGER_EVENTS: Readonly<Record<string, readonly string[]>> = {
  'item:tapped': ['itemId', 'chain', 'tier'],
  'item:merged': ['chain', 'fromTier', 'resultTier'],
  'item:hatched': ['item.chain', 'item.tier'],
  'item:harvested': ['output.chain', 'output.tier'],
  'item:produced': ['output.chain', 'output.tier'],
  'item:spawned': ['item.chain', 'item.tier', 'cause'],
  'item:sold': ['chain', 'tier'],
  'bag:stored': ['chain', 'tier'],
  'generator:skipped': ['chain', 'currency'],
  'chest:claimed': ['coins'],
  'cauldron:brewed': ['recipeId', 'output.chain'],
  'store:purchased': ['itemId', 'kind'],
  'marketplace:purchased': ['free'],
  'order:completed': ['orderId'],
  'quest:step_completed': ['questId', 'stepId'],
  'quest:completed': ['questId'],
  'region:unlocked': ['regionId'],
  'keeper:leveled': ['level'],
  'dragon:fed': ['chain', 'favourite'],
  'dragon:named': ['chain', 'name'],
  'dragon:working': [],
  'dragon:well_fed': ['chain', 'cycles'],
  'companion:fed': ['companionId', 'chain', 'favourite'],
  'nest:hatched': ['chain'],
  'regard:gift_accepted': ['characterId', 'chain', 'tier'],
  'regard:heart': ['characterId', 'hearts'],
  'character:action_used': ['characterId', 'action'],
  'ui:character_tapped': ['characterId'],
  'fog:tapped': ['regionId'],
  'elder:tapped': ['itemId', 'chain', 'tier'],
  'ui:ledger_toggled': ['open'],
  'ui:store_toggled': ['open'],
  'ui:codex_toggled': ['open'],
  'ui:cauldron_toggled': ['open'],
  'ui:cookbook_opened': ['discovered'],
  'story:chapter': ['chapter'],
  'story:arrival': ['worldId'],
  'story:beats_finished': ['chapter'],
  'world:switched': ['from', 'to'],
  'world:ready': ['world'],
  'tasks:all_complete': [],
  'gate:opened': [],
  'iap:completed': ['packId'],
  'tutorial:step': ['tutorial', 'id', 'done'],
  'event:fired': ['id', 'count']
};

/** Facts after which a `property` trigger's edge is re-read (plus the clock). */
export const PROPERTY_WATCH_EVENTS: readonly string[] = [
  'economy:changed',
  'energy:changed',
  'keeper:leveled',
  'regard:changed',
  'dragon:trust_changed',
  'item:spawned',
  'item:merged',
  'item:removed',
  'item:sold',
  'bag:stored',
  'quest:completed',
  'world:ready',
  'tutorial:step',
  'event:fired'
];

/** Commands an `emit` action may send. Each has an owner on the bus already. */
export const EMITTABLE_COMMANDS: readonly string[] = [
  'economy:add',
  'energy:add',
  'energy:refill',
  'board:spawn',
  'board:retier',
  'board:move',
  'chest:open',
  'region:reveal',
  'ui:codex_open_requested',
  'ui:shop_toggled',
  'ui:name_dragon_requested',
  'hint:merge',
  'hint:carry',
  'tutorial:nudge',
  'audio:set_music_muted'
];

/* ------------------------------------------------------------------ */
/* Properties                                                          */
/* ------------------------------------------------------------------ */

/**
 * One catalogue entry: a path PATTERN (`<x>` = an id the author supplies) and
 * how it may be written. The editor lists these; the validator matches them.
 */
export interface PropertySpec {
  pattern: string;
  label: string;
  write: 'none' | 'add' | 'add+set';
}

export const PROPERTY_CATALOG: readonly PropertySpec[] = [
  { pattern: 'keeper.level', label: 'Keeper level', write: 'none' },
  { pattern: 'keeper.xp', label: 'Keeper XP', write: 'add' },
  { pattern: 'keeper.coins', label: 'Gold', write: 'add' },
  { pattern: 'keeper.keys', label: 'Gold Keys', write: 'add' },
  { pattern: 'keeper.energy', label: 'Warmth', write: 'add' },
  { pattern: 'keeper.tutorialDone', label: 'Main tutorial finished (0/1)', write: 'none' },
  { pattern: 'keeper.world.<worldId>', label: 'Standing in a world (0/1)', write: 'none' },
  { pattern: 'character.<id>.hearts', label: 'A person\'s Regard hearts (0–5)', write: 'none' },
  { pattern: 'character.<id>.regard', label: 'A person\'s Regard points', write: 'add' },
  { pattern: 'dragon.<chain>.trust', label: 'Highest Trust of that breed on the board', write: 'none' },
  { pattern: 'dragon.<chain>.count', label: 'Hatched dragons of that breed on the board', write: 'none' },
  { pattern: 'board.<chain>.<tier>', label: 'Pieces of chain+tier on the active board', write: 'none' },
  { pattern: 'quest.<id>.done', label: 'Quest completed (0/1)', write: 'none' },
  { pattern: 'stat.<key>', label: 'A lifetime counter', write: 'none' },
  { pattern: 'flag.<name>', label: 'An event-owned number', write: 'add+set' },
  { pattern: 'event.<id>.fired', label: 'Times an event has fired', write: 'none' }
];

/** Match a concrete path to its catalogue entry (or nothing). */
export function propertySpec(path: string): PropertySpec | undefined {
  const parts = path.split('.');
  return PROPERTY_CATALOG.find((spec) => {
    const pat = spec.pattern.split('.');
    if (pat.length !== parts.length) return false;
    return pat.every((p, i) => (p.startsWith('<') ? parts[i].length > 0 : p === parts[i]));
  });
}

/** Everything a property may be read from — the runtime implements it over GameState. */
export interface PropertyFacts {
  level: number;
  xp: number;
  coins: number;
  keys: number;
  energy: number;
  tutorialDone: boolean;
  worldId: string;
  regardPoints(characterId: string): number;
  hearts(characterId: string): number;
  dragonTrust(chain: string): number;
  dragonCount(chain: string): number;
  boardCount(chain: string, tier: number): number;
  stat(key: string): number;
}

export function readProperty(facts: PropertyFacts, path: string): number {
  const [root, a, b] = path.split('.');
  switch (root) {
    case 'keeper':
      switch (a) {
        case 'level': return facts.level;
        case 'xp': return facts.xp;
        case 'coins': return facts.coins;
        case 'keys': return facts.keys;
        case 'energy': return facts.energy;
        case 'tutorialDone': return facts.tutorialDone ? 1 : 0;
        case 'world': return facts.worldId === b ? 1 : 0;
      }
      return 0;
    case 'character':
      return b === 'hearts' ? facts.hearts(a) : b === 'regard' ? facts.regardPoints(a) : 0;
    case 'dragon':
      return b === 'trust' ? facts.dragonTrust(a) : b === 'count' ? facts.dragonCount(a) : 0;
    case 'board':
      return facts.boardCount(a, Number(b));
    case 'quest':
      return facts.stat(`q:done:${a}`) > 0 ? 1 : 0;
    case 'stat':
      return facts.stat(a);
    case 'flag':
      return facts.stat(flagKey(a));
    case 'event':
      return facts.stat(eventStatKeys(a).fired);
  }
  return 0;
}

export function compare(left: number, op: EventCompareOp, right: number): boolean {
  switch (op) {
    case '==': return left === right;
    case '!=': return left !== right;
    case '>': return left > right;
    case '>=': return left >= right;
    case '<': return left < right;
    case '<=': return left <= right;
  }
}

export function conditionsHold(facts: PropertyFacts, conditions: EventCondition[] | undefined): boolean {
  return (conditions ?? []).every((c) => compare(readProperty(facts, c.prop), c.op, c.value));
}

/* ------------------------------------------------------------------ */
/* Stats — the only persistence the system has                         */
/* ------------------------------------------------------------------ */

export function eventStatKeys(id: string): { fired: string; last: string; armed: string } {
  return { fired: `evt:${id}:fired`, last: `evt:${id}:last`, armed: `evt:${id}:armed` };
}

export function flagKey(name: string): string {
  return `flag:${name}`;
}

/* ------------------------------------------------------------------ */
/* Tree helpers                                                        */
/* ------------------------------------------------------------------ */

export interface FlatEvent {
  event: GameEventConfig;
  parent: GameEventConfig | null;
  depth: number;
}

/** Depth-first, parents before children — the order the validator reports in. */
export function flattenEvents(events: GameEventConfig[]): FlatEvent[] {
  const out: FlatEvent[] = [];
  const walk = (list: GameEventConfig[], parent: GameEventConfig | null, depth: number): void => {
    for (const event of list) {
      out.push({ event, parent, depth });
      if (Array.isArray(event.children)) walk(event.children, event, depth + 1);
    }
  };
  walk(events, null, 0);
  return out;
}

export function findEvent(events: GameEventConfig[], id: string): FlatEvent | undefined {
  return flattenEvents(events).find((f) => f.event.id === id);
}

/** The list an event sits in — the root list or its parent's `children`. */
export function siblingsOf(data: EventsData, id: string): GameEventConfig[] | undefined {
  const found = findEvent(data.events, id);
  if (!found) return undefined;
  return found.parent ? found.parent.children : data.events;
}

/** The tap sugar, resolved to the bus fact it listens for. */
export function tapFactOf(target: string): { event: string; key?: string; value?: string } | null {
  const [kind, id] = target.split(':');
  switch (kind) {
    case 'character': return id ? { event: 'ui:character_tapped', key: 'characterId', value: id } : null;
    case 'item': return id ? { event: 'item:tapped', key: 'chain', value: id } : null;
    case 'fog': return id ? { event: 'fog:tapped', key: 'regionId', value: id } : null;
    case 'elder': return { event: 'elder:tapped' };
  }
  return null;
}

/** The actions an event can run, prompt branches included — for validation and pickers. */
export function allActions(event: GameEventConfig): EventAction[] {
  const out: EventAction[] = [];
  const walk = (list: EventAction[]): void => {
    for (const a of list) {
      out.push(a);
      if ('prompt' in a) for (const c of a.prompt.choices ?? []) walk(c.then ?? []);
    }
  };
  walk(event.then ?? []);
  return out;
}

/* ------------------------------------------------------------------ */
/* Validation — runs before every write and in the unit suite          */
/* ------------------------------------------------------------------ */

/** What the validator may check an author's ids against. All optional:
 *  without a list, that kind of id is not checked. */
export interface EventsContext {
  chains?: string[];
  quests?: string[];
  characters?: string[];
  worlds?: string[];
  regions?: string[];
  tutorials?: string[];
}

const ID_RE = /^[a-z0-9_]+$/;

export function validateEventsData(data: EventsData, ctx: EventsContext = {}): string[] {
  const errors: string[] = [];
  if (!data || !Array.isArray(data.events)) return ['events must be an array'];
  const flat = flattenEvents(data.events);
  const ids = new Set<string>();
  for (const { event } of flat) {
    if (typeof event.id !== 'string' || !ID_RE.test(event.id)) errors.push(`event id "${String(event.id)}" must be lowercase [a-z0-9_]`);
    else if (ids.has(event.id)) errors.push(`duplicate event id "${event.id}"`);
    ids.add(event.id);
  }
  for (const { event } of flat) errors.push(...validateEvent(event, ids, ctx));
  return errors;
}

function validateEvent(event: GameEventConfig, ids: Set<string>, ctx: EventsContext): string[] {
  const errors: string[] = [];
  const at = `event "${event.id}"`;
  if (!Array.isArray(event.when) || event.when.length === 0) errors.push(`${at}: needs at least one trigger (when)`);
  else event.when.forEach((t, i) => errors.push(...validateTrigger(t, `${at} when[${i}]`, ctx)));
  if (event.if !== undefined) {
    if (!Array.isArray(event.if)) errors.push(`${at}: if must be an array`);
    else event.if.forEach((c, i) => errors.push(...validateCondition(c, `${at} if[${i}]`)));
  }
  if (!Array.isArray(event.then) || event.then.length === 0) errors.push(`${at}: needs at least one action (then)`);
  else event.then.forEach((a, i) => errors.push(...validateAction(a, `${at} then[${i}]`, ids, ctx)));
  if (event.once && (event.limit || event.cooldownMs)) errors.push(`${at}: once cannot be combined with limit/cooldownMs`);
  if (event.limit !== undefined && (!Number.isInteger(event.limit) || event.limit < 0)) errors.push(`${at}: limit must be a non-negative integer`);
  if (event.cooldownMs !== undefined && (typeof event.cooldownMs !== 'number' || event.cooldownMs < 0)) errors.push(`${at}: cooldownMs must be a non-negative number`);
  if (event.children !== undefined && !Array.isArray(event.children)) errors.push(`${at}: children must be an array`);
  return errors;
}

function validateTrigger(t: EventTrigger, at: string, ctx: EventsContext): string[] {
  const errors: string[] = [];
  if (!t || !(TRIGGER_TYPES as readonly string[]).includes(t.type)) return [`${at}: trigger type must be one of ${TRIGGER_TYPES.join('/')}`];
  if (t.type === 'event') {
    const keys = TRIGGER_EVENTS[t.event];
    if (!keys) errors.push(`${at}: "${t.event}" is not an observable bus fact`);
    else if (t.match) {
      for (const k of Object.keys(t.match)) if (!keys.includes(k)) errors.push(`${at}: "${t.event}" has no payload key "${k}" (has ${keys.join(', ') || 'none'})`);
    }
  } else if (t.type === 'tap') {
    const fact = tapFactOf(t.target ?? '');
    if (!fact) errors.push(`${at}: tap target must be character:<id>, item:<chain>, fog:<region> or elder`);
    else {
      const [kind, id] = t.target.split(':');
      if (kind === 'character' && ctx.characters && !ctx.characters.includes(id)) errors.push(`${at}: unknown character "${id}"`);
      if (kind === 'item' && ctx.chains && !ctx.chains.includes(id)) errors.push(`${at}: unknown chain "${id}"`);
      if (kind === 'fog' && ctx.regions && !ctx.regions.includes(id)) errors.push(`${at}: unknown region "${id}"`);
    }
  } else if (t.type === 'property') {
    errors.push(...validateCondition(t, at));
  } else if (t.type === 'time') {
    if (typeof t.afterMs !== 'number' || t.afterMs < 0) errors.push(`${at}: time trigger needs afterMs >= 0`);
  }
  return errors;
}

function validateCondition(c: { prop?: string; op?: string; value?: unknown }, at: string): string[] {
  const errors: string[] = [];
  if (typeof c?.prop !== 'string' || !propertySpec(c.prop)) errors.push(`${at}: unknown property "${String(c?.prop)}"`);
  if (!(COMPARE_OPS as readonly string[]).includes(c?.op ?? '')) errors.push(`${at}: op must be one of ${COMPARE_OPS.join(' ')}`);
  if (typeof c?.value !== 'number') errors.push(`${at}: value must be a number`);
  return errors;
}

function validateAction(a: EventAction, at: string, ids: Set<string>, ctx: EventsContext): string[] {
  const errors: string[] = [];
  if (!a || typeof a !== 'object') return [`${at}: action must be an object`];
  const kinds = Object.keys(a).filter((k) => (ACTION_KINDS as readonly string[]).includes(k));
  if (kinds.length !== 1) return [`${at}: an action is exactly one of ${ACTION_KINDS.join('/')}`];
  if ('add' in a) {
    const spec = propertySpec(a.add);
    if (!spec) errors.push(`${at}: unknown property "${a.add}"`);
    else if (spec.write === 'none') errors.push(`${at}: "${a.add}" is read-only`);
    if (typeof a.amount !== 'number' || a.amount === 0) errors.push(`${at}: add needs a non-zero amount`);
  } else if ('set' in a) {
    if (!a.set?.startsWith('flag.') || !propertySpec(a.set)) errors.push(`${at}: set only writes flag.<name>`);
    if (typeof a.value !== 'number') errors.push(`${at}: set needs a numeric value`);
  } else if ('say' in a) {
    if (!SPEAKERS.includes(a.say?.speaker)) errors.push(`${at}: say.speaker must be one of ${SPEAKERS.join('/')}`);
    if (!Array.isArray(a.say?.lines) || a.say.lines.length === 0 || a.say.lines.some((l) => typeof l !== 'string' || !l.trim())) errors.push(`${at}: say.lines must be non-empty strings`);
  } else if ('prompt' in a) {
    const p = a.prompt;
    if (typeof p?.id !== 'string' || !ID_RE.test(p.id)) errors.push(`${at}: prompt.id must be lowercase [a-z0-9_]`);
    if (!SPEAKERS.includes(p?.speaker)) errors.push(`${at}: prompt.speaker must be one of ${SPEAKERS.join('/')}`);
    if (typeof p?.text !== 'string' || !p.text.trim()) errors.push(`${at}: prompt.text is required`);
    if (!Array.isArray(p?.choices) || p.choices.length < 1) errors.push(`${at}: prompt needs at least one choice`);
    else {
      const seen = new Set<string>();
      p.choices.forEach((c, i) => {
        const cat = `${at} choice[${i}]`;
        if (typeof c?.id !== 'string' || !ID_RE.test(c.id)) errors.push(`${cat}: id must be lowercase [a-z0-9_]`);
        else if (seen.has(c.id)) errors.push(`${cat}: duplicate choice id "${c.id}"`);
        seen.add(c?.id);
        if (typeof c?.label !== 'string' || !c.label.trim()) errors.push(`${cat}: label is required`);
        if (!Array.isArray(c?.then) || c.then.length === 0) errors.push(`${cat}: then must hold at least one action`);
        else c.then.forEach((x, j) => errors.push(...validateAction(x, `${cat} then[${j}]`, ids, ctx)));
      });
    }
  } else if ('spawn' in a) {
    const s = a.spawn;
    if (typeof s?.chain !== 'string' || (ctx.chains && !ctx.chains.includes(s.chain))) errors.push(`${at}: spawn.chain unknown "${String(s?.chain)}"`);
    if (!Number.isInteger(s?.tier) || s.tier < 1) errors.push(`${at}: spawn.tier must be a positive integer`);
    if (!Number.isInteger(s?.count) || s.count < 1) errors.push(`${at}: spawn.count must be a positive integer`);
    if (s?.at !== undefined && !(Array.isArray(s.at) && s.at.length === 2 && s.at.every(Number.isInteger))) errors.push(`${at}: spawn.at must be [col, row]`);
  } else if ('retier' in a) {
    const r = a.retier;
    if (typeof r?.chain !== 'string' || (ctx.chains && !ctx.chains.includes(r.chain))) errors.push(`${at}: retier.chain unknown "${String(r?.chain)}"`);
    if (!Number.isInteger(r?.fromTier) || !Number.isInteger(r?.toTier) || r.fromTier === r.toTier) errors.push(`${at}: retier needs distinct integer fromTier/toTier`);
  } else if ('open' in a) {
    if (!PANELS.includes(a.open)) errors.push(`${at}: open must be one of ${PANELS.join('/')}`);
  } else if ('tutorial' in a) {
    if (typeof a.tutorial !== 'string' || !a.tutorial) errors.push(`${at}: tutorial needs a script id`);
    else if (ctx.tutorials && !ctx.tutorials.includes(a.tutorial)) errors.push(`${at}: unknown tutorial script "${a.tutorial}"`);
  } else if ('fire' in a) {
    if (!ids.has(a.fire)) errors.push(`${at}: fire names no event "${a.fire}"`);
  } else if ('emit' in a) {
    if (!EMITTABLE_COMMANDS.includes(a.emit)) errors.push(`${at}: "${a.emit}" is not an emittable command`);
    if (a.payload !== undefined && (typeof a.payload !== 'object' || a.payload === null || Array.isArray(a.payload))) errors.push(`${at}: emit.payload must be an object`);
  }
  return errors;
}

/** One line per trigger/action — the editor's and CLI's sentences. */
export function triggerSentence(t: EventTrigger): string {
  switch (t.type) {
    case 'event': {
      const m = t.match ? ' where ' + Object.entries(t.match).map(([k, v]) => `${k} = ${String(v)}`).join(', ') : '';
      return `on ${t.event}${m}`;
    }
    case 'tap': return `tap ${t.target}`;
    case 'property': return `when ${t.prop} becomes ${t.op} ${t.value}`;
    case 'time': return `${t.afterMs} ms after armed`;
    case 'manual': return 'manual (fire / API only)';
  }
}

export function actionSentence(a: EventAction): string {
  if ('add' in a) return `${a.add} ${a.amount >= 0 ? '+' : ''}${a.amount}`;
  if ('set' in a) return `${a.set} = ${a.value}`;
  if ('say' in a) return `${a.say.speaker} says ${a.say.lines.length} line${a.say.lines.length === 1 ? '' : 's'}`;
  if ('prompt' in a) return `${a.prompt.speaker} asks "${a.prompt.text}" → ${a.prompt.choices.map((c) => c.label).join(' / ')}`;
  if ('spawn' in a) return `spawn ${a.spawn.count}× ${a.spawn.chain} t${a.spawn.tier}${a.spawn.at ? ` at [${a.spawn.at.join(',')}]` : ''}`;
  if ('retier' in a) return `retier ${a.retier.chain} t${a.retier.fromTier} → t${a.retier.toTier}`;
  if ('open' in a) return `open ${a.open}`;
  if ('tutorial' in a) return `start tutorial ${a.tutorial}`;
  if ('fire' in a) return `fire ${a.fire}`;
  return `emit ${a.emit}`;
}
