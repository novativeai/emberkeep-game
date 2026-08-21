/**
 * THE EVENTS API — what the World Builder's ⚡ Events tab and the
 * `event-creator` skill talk to. Mounted by vite at `/__events`
 * (docs/event-creator.md §5).
 *
 *   GET  /            → { events }                 the tree, as authored
 *   GET  /context     → pickers: facts + payload keys, property catalogue,
 *                       speakers, panels, commands, chains, quests, characters,
 *                       regions, worlds, tutorial scripts
 *   PUT  /            ← { events }                 replace the file (validated)
 *   POST /op          ← one EditOp                 a single atomic edit (validated)
 *   POST /validate    → { ok, errors }             the committed file, checked
 *
 * `applyOp` is pure and exported so the unit suite drives the same code the
 * server runs. Every write validates first; a refused write leaves the file
 * untouched and says why.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import {
  ACTION_KINDS,
  COMPARE_OPS,
  EMITTABLE_COMMANDS,
  findEvent,
  PANELS,
  PROPERTY_CATALOG,
  siblingsOf,
  SPEAKERS,
  TRIGGER_EVENTS,
  TRIGGER_TYPES,
  validateEventsData,
  type EventsContext
} from '../../src/core/gameEvents';
import type { EventsData, GameEventConfig } from '../../src/core/types';

export type EditOp =
  /** Insert a new event — at the root, or inside `parent`; after `after` or at the end. */
  | { op: 'add_event'; event: GameEventConfig; parent?: string; after?: string }
  /** Replace fields of an event (children untouched unless `patch.children` is given). */
  | { op: 'update_event'; id: string; patch: Partial<GameEventConfig> }
  | { op: 'remove_event'; id: string }
  /** Re-parent and/or re-order: `parent` null = root; `to` is the index among the new siblings. */
  | { op: 'move_event'; id: string; parent: string | null; to: number }
  /** Reorder one sibling list (root when `parent` is null). */
  | { op: 'reorder'; parent: string | null; order: string[] };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function applyOp(data: EventsData, op: EditOp, ctx: EventsContext = {}): EventsData {
  const next = clone(data);
  const listOf = (parent: string | null | undefined): GameEventConfig[] => {
    if (!parent) return next.events;
    const found = findEvent(next.events, parent);
    if (!found) throw new Error(`no event "${parent}"`);
    found.event.children ??= [];
    return found.event.children;
  };
  switch (op.op) {
    case 'add_event': {
      if (!op.event || typeof op.event.id !== 'string') throw new Error('add_event needs an event with an id');
      if (findEvent(next.events, op.event.id)) throw new Error(`event id "${op.event.id}" already exists`);
      const list = listOf(op.parent);
      const at = op.after ? list.findIndex((e) => e.id === op.after) : -1;
      if (op.after && at < 0) throw new Error(`no sibling "${op.after}" under ${op.parent ?? 'root'}`);
      list.splice(at < 0 ? list.length : at + 1, 0, op.event);
      break;
    }
    case 'update_event': {
      const found = findEvent(next.events, op.id);
      if (!found) throw new Error(`no event "${op.id}"`);
      if (op.patch.id !== undefined && op.patch.id !== op.id && findEvent(next.events, op.patch.id)) throw new Error(`event id "${op.patch.id}" already exists`);
      Object.assign(found.event, op.patch);
      for (const k of Object.keys(op.patch) as (keyof GameEventConfig)[]) if (op.patch[k] === undefined) delete found.event[k];
      break;
    }
    case 'remove_event': {
      const list = siblingsOf(next, op.id);
      if (!list) throw new Error(`no event "${op.id}"`);
      list.splice(list.findIndex((e) => e.id === op.id), 1);
      break;
    }
    case 'move_event': {
      const from = siblingsOf(next, op.id);
      if (!from) throw new Error(`no event "${op.id}"`);
      const [event] = from.splice(from.findIndex((e) => e.id === op.id), 1);
      if (op.parent && (op.parent === op.id || findEvent(event!.children ?? [], op.parent))) throw new Error('an event cannot be moved inside itself');
      const to = listOf(op.parent);
      to.splice(Math.max(0, Math.min(op.to, to.length)), 0, event!);
      break;
    }
    case 'reorder': {
      const list = listOf(op.parent);
      const ids = list.map((e) => e.id);
      if (op.order.length !== ids.length || op.order.some((id) => !ids.includes(id))) throw new Error('order must name every sibling exactly once');
      const byId = new Map(list.map((e) => [e.id, e]));
      list.splice(0, list.length, ...op.order.map((id) => byId.get(id)!));
      break;
    }
    default:
      throw new Error(`unknown op "${String((op as { op?: string }).op)}"`);
  }
  const errors = validateEventsData(next, ctx);
  if (errors.length) throw new Error(errors.join('; '));
  return next;
}

/** The ids the validator may check against, read from the authored data. */
export function contextOf(root: string): EventsContext {
  const read = (rel: string) => JSON.parse(readFileSync(path.join(root, rel), 'utf8')) as Record<string, unknown>;
  const chains = (read('src/data/chains.json').chains as Array<{ id: string }>).map((c) => c.id);
  const quests = (read('src/data/quests.json').quests as Array<{ id: string }>).map((q) => q.id);
  const characters = [...new Set((read('src/data/characters.json').characters as Array<{ id: string; art?: string }>).map((c) => c.art ?? c.id))];
  const regions = (read('src/data/map.json').regions as Array<{ id: string }>).map((r) => r.id);
  // zones.json is what SHIPS (docs/worlds-and-zones.md); worlds.json also lists editor-only drafts.
  const worlds = Object.keys((read('src/data/zones.json').worlds as Record<string, unknown>) ?? {});
  const tutorials = ((read('src/data/tutorial.json').tutorials as Array<{ id: string }> | undefined) ?? []).map((t) => t.id);
  return { chains, quests, characters, regions, worlds, tutorials };
}

/** Reference data the editor's pickers and the skill's prompts are built from. */
export function buildContext(root: string): Record<string, unknown> {
  const read = (rel: string) => JSON.parse(readFileSync(path.join(root, rel), 'utf8')) as Record<string, unknown>;
  const chains = (read('src/data/chains.json').chains as Array<{ id: string; name?: string; hatchAtTier?: number; tiers: Array<{ tier: number; name: string }> }>).map(
    (c) => ({ id: c.id, name: c.name ?? c.id, hatchAtTier: c.hatchAtTier ?? null, tiers: c.tiers.map((t) => ({ tier: t.tier, name: t.name })) })
  );
  const quests = (read('src/data/quests.json').quests as Array<{ id: string; title?: string; world?: string }>).map((q) => ({ id: q.id, title: q.title, world: q.world ?? 'emberkeep' }));
  const ids = contextOf(root);
  const art: Record<string, string> = {};
  for (const e of read('src/data/assets.json').images as Array<{ key: string; file?: string }>) {
    if (e.key.startsWith('item_') && e.file) art[e.key] = e.file;
  }
  return {
    art,
    triggerTypes: TRIGGER_TYPES,
    triggerEvents: TRIGGER_EVENTS,
    properties: PROPERTY_CATALOG,
    ops: COMPARE_OPS,
    actionKinds: ACTION_KINDS,
    speakers: SPEAKERS,
    panels: PANELS,
    commands: EMITTABLE_COMMANDS,
    chains,
    quests,
    characters: ids.characters,
    regions: ids.regions,
    worlds: ids.worlds,
    tutorials: ids.tutorials
  };
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

/** The connect-style middleware vite mounts at `/__events`. */
export function createEventsApi(root: string): (req: IncomingMessage, res: ServerResponse) => void {
  const file = path.join(root, 'src/data/events.json');
  const load = (): EventsData => JSON.parse(readFileSync(file, 'utf8')) as EventsData;
  const save = (data: EventsData): void => writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  const send = (res: ServerResponse, code: number, body: unknown): void => {
    res.statusCode = code;
    res.end(JSON.stringify(body));
  };
  return (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');
    const sub = (req.url ?? '/').split('?')[0]!.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    void (async () => {
      try {
        if (req.method === 'GET' && sub === '/') return send(res, 200, { events: load().events });
        if (req.method === 'GET' && sub === '/context') return send(res, 200, buildContext(root));
        if (req.method === 'PUT' && sub === '/') {
          const body = (await readJson(req)) as { events?: GameEventConfig[] };
          if (!Array.isArray(body.events)) throw new Error('body must be { events: [...] }');
          const data: EventsData = { events: body.events };
          const errors = validateEventsData(data, contextOf(root));
          if (errors.length) return send(res, 400, { ok: false, errors });
          save(data);
          return send(res, 200, { ok: true, events: data.events });
        }
        if (req.method === 'POST' && sub === '/op') {
          const op = (await readJson(req)) as EditOp;
          const next = applyOp(load(), op, contextOf(root));
          save(next);
          return send(res, 200, { ok: true, events: next.events });
        }
        if (req.method === 'POST' && sub === '/validate') {
          const errors = validateEventsData(load(), contextOf(root));
          return send(res, 200, { ok: errors.length === 0, errors });
        }
        send(res, 404, { ok: false, error: `no route ${req.method} ${sub}` });
      } catch (e) {
        send(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
  };
}
