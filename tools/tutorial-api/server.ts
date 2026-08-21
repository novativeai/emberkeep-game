/**
 * THE TUTORIAL API — `/__tutorial` on the vite dev server.
 *
 * One door for everything that edits `src/data/tutorial.json`: the World
 * Builder's 📜 Tutorial tab, the `tutorial-editor` Claude skill, and anyone
 * with curl. Every write goes through `validateTutorialData` first, so the file
 * on disk can never hold a trigger that points nowhere or two steps with one
 * id — the same rule the unit test holds the committed file to.
 *
 *   GET  /__tutorial            → { scripts }            every script, main first
 *   GET  /__tutorial/context    → reference data for pickers (chains, speakers,
 *                                 regions, ui targets, gate events, allow keys…)
 *   PUT  /__tutorial            ← { scripts }            replace the whole file
 *   POST /__tutorial/op         ← one EditOp             an atomic edit, validated
 *   POST /__tutorial/validate   → { structural, ftue }   shape check + ftuecheck.py
 *
 * The op applier is pure (`applyOp`) so the tests cover it without a server;
 * the middleware is the thin HTTP skin around it.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dataOf, MAIN_SCRIPT_ID, scriptsOf, validateTutorialData } from '../../src/core/tutorialScripts';
import type { TutorialData, TutorialScriptConfig, TutorialStepConfig, TutorialTrigger } from '../../src/core/types';

export type EditOp =
  | { op: 'add_script'; script: { id: string; title?: string; trigger: TutorialTrigger; allowBase?: 'nothing' | 'everything'; steps?: TutorialStepConfig[] } }
  | { op: 'remove_script'; tutorial: string }
  | { op: 'update_script'; tutorial: string; patch: { title?: string; trigger?: TutorialTrigger; allowBase?: 'nothing' | 'everything' } }
  | { op: 'add_step'; tutorial: string; step: TutorialStepConfig; after?: string; before?: string; index?: number }
  | { op: 'update_step'; tutorial: string; step: string; patch: Partial<TutorialStepConfig>; unset?: Array<keyof TutorialStepConfig> }
  | { op: 'remove_step'; tutorial: string; step: string }
  | { op: 'move_step'; tutorial: string; step: string; to: number }
  | { op: 'reorder'; tutorial: string; order: string[] };

function scriptOf(scripts: TutorialScriptConfig[], id: string): TutorialScriptConfig {
  const s = scripts.find((x) => x.id === id);
  if (!s) throw new Error(`unknown tutorial "${id}"`);
  return s;
}

function stepAt(script: TutorialScriptConfig, id: string): number {
  const i = script.steps.findIndex((s) => s.id === id);
  if (i < 0) throw new Error(`no step "${id}" in "${script.id}"`);
  return i;
}

/** Apply one edit to a file's worth of data and return the new data — or throw. */
export function applyOp(data: TutorialData, op: EditOp): TutorialData {
  const scripts = structuredClone(scriptsOf(data));
  switch (op.op) {
    case 'add_script': {
      if (!op.script?.id) throw new Error('add_script needs script.id');
      if (scripts.some((s) => s.id === op.script.id)) throw new Error(`tutorial "${op.script.id}" already exists`);
      scripts.push({ ...op.script, steps: op.script.steps ?? [] });
      break;
    }
    case 'remove_script': {
      if (op.tutorial === MAIN_SCRIPT_ID) throw new Error('the main script cannot be removed');
      const i = scripts.findIndex((s) => s.id === op.tutorial);
      if (i < 0) throw new Error(`unknown tutorial "${op.tutorial}"`);
      scripts.splice(i, 1);
      break;
    }
    case 'update_script': {
      const s = scriptOf(scripts, op.tutorial);
      if (op.tutorial === MAIN_SCRIPT_ID && (op.patch.trigger || op.patch.allowBase)) {
        throw new Error('the main script keeps trigger start and allowBase nothing');
      }
      Object.assign(s, op.patch);
      break;
    }
    case 'add_step': {
      const s = scriptOf(scripts, op.tutorial);
      let at = s.steps.length;
      if (op.after !== undefined) at = stepAt(s, op.after) + 1;
      else if (op.before !== undefined) at = stepAt(s, op.before);
      else if (op.index !== undefined) at = Math.max(0, Math.min(s.steps.length, op.index));
      s.steps.splice(at, 0, op.step);
      break;
    }
    case 'update_step': {
      const s = scriptOf(scripts, op.tutorial);
      const step = s.steps[stepAt(s, op.step)]!;
      Object.assign(step, op.patch);
      for (const k of op.unset ?? []) delete (step as unknown as Record<string, unknown>)[k];
      break;
    }
    case 'remove_step': {
      const s = scriptOf(scripts, op.tutorial);
      s.steps.splice(stepAt(s, op.step), 1);
      break;
    }
    case 'move_step': {
      const s = scriptOf(scripts, op.tutorial);
      const from = stepAt(s, op.step);
      const [step] = s.steps.splice(from, 1);
      s.steps.splice(Math.max(0, Math.min(s.steps.length, op.to)), 0, step!);
      break;
    }
    case 'reorder': {
      const s = scriptOf(scripts, op.tutorial);
      const byId = new Map(s.steps.map((st) => [st.id, st]));
      if (op.order.length !== s.steps.length || new Set(op.order).size !== op.order.length || op.order.some((id) => !byId.has(id))) {
        throw new Error('reorder must list every step id exactly once');
      }
      s.steps = op.order.map((id) => byId.get(id)!);
      break;
    }
    default:
      throw new Error(`unknown op "${String((op as { op: unknown }).op)}"`);
  }
  const next = dataOf(scripts);
  const errors = validateTutorialData(next);
  if (errors.length) throw new Error(errors.join('; '));
  return next;
}

/** Reference data the editor's pickers and the skill's prompts are built from. */
export function buildContext(root: string): Record<string, unknown> {
  const read = (rel: string) => JSON.parse(readFileSync(path.join(root, rel), 'utf8')) as Record<string, unknown>;
  const chains = (read('src/data/chains.json').chains as Array<{ id: string; name?: string; tiers: Array<{ tier: number; name: string }> }>).map(
    (c) => ({ id: c.id, name: c.name ?? c.id, tiers: c.tiers.map((t) => ({ tier: t.tier, name: t.name })) })
  );
  const map = read('src/data/map.json');
  const regions = (map.regions as Array<{ id: string; unlock?: unknown }>).map((r) => ({ id: r.id, unlock: r.unlock ?? null }));
  const quests = (read('src/data/quests.json').quests as Array<{ id: string; title?: string; world?: string }>).map((q) => ({ id: q.id, title: q.title, world: q.world ?? 'emberkeep' }));
  const characters = (read('src/data/characters.json').characters as Array<{ id: string; world?: string }>).map((c) => ({ id: c.id, world: c.world }));
  const types = readFileSync(path.join(root, 'src/core/types.ts'), 'utf8');
  const pick = (name: string): string[] => {
    const m = new RegExp(`export type ${name} =([\\s\\S]*?);`).exec(types);
    return m ? [...m[1]!.matchAll(/'([a-z_:]+)'/g)].map((x) => x[1]!) : [];
  };
  const gateEvents = (() => {
    const m = /type: 'event'; event: ([^;]+);/.exec(types);
    return m ? [...m[1]!.matchAll(/'([a-z_:]+)'/g)].map((x) => x[1]!) : [];
  })();
  const allowKeys = (() => {
    const m = /export interface TutorialAllow \{([\s\S]*?)\n\}/.exec(types);
    return m ? [...m[1]!.matchAll(/^\s+(\w+)\?:/gm)].map((x) => x[1]!) : [];
  })();
  const effectKinds = (() => {
    const m = /export type TutorialEffect =([\s\S]*?);\n/.exec(types);
    return m ? [...new Set([...m[1]!.matchAll(/\{ (\w+):/g)].map((x) => x[1]!))] : [];
  })();
  const worlds = [...new Set(quests.map((q) => q.world).concat(characters.map((c) => c.world ?? 'emberkeep')))];
  // Item plates by key, so the editor can show the piece a beat talks about.
  const art: Record<string, string> = {};
  for (const e of read('src/data/assets.json').images as Array<{ key: string; file?: string }>) {
    if (e.key.startsWith('item_') && e.file) art[e.key] = e.file;
  }
  return {
    art,
    speakers: pick('SpeakerId'),
    uiTargets: pick('TutorialUiTarget'),
    gateTypes: ['tap', 'event', 'count', 'move'],
    gateEvents,
    allowKeys,
    effectKinds,
    triggerTypes: ['step_done', 'tutorial_done', 'event', 'quest_done', 'level', 'world', 'stat'],
    chains,
    regions,
    quests,
    characters,
    worlds
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

/** The connect-style middleware vite mounts at `/__tutorial`. */
export function createTutorialApi(root: string): (req: IncomingMessage, res: ServerResponse) => void {
  const file = path.join(root, 'src/data/tutorial.json');
  const load = (): TutorialData => JSON.parse(readFileSync(file, 'utf8')) as TutorialData;
  const save = (data: TutorialData): void => writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
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
        if (req.method === 'GET' && sub === '/') return send(res, 200, { scripts: scriptsOf(load()) });
        if (req.method === 'GET' && sub === '/context') return send(res, 200, buildContext(root));
        if (req.method === 'PUT' && sub === '/') {
          const body = (await readJson(req)) as { scripts?: TutorialScriptConfig[] };
          if (!Array.isArray(body.scripts)) throw new Error('body must be { scripts: [...] }');
          const data = dataOf(body.scripts);
          const errors = validateTutorialData(data);
          if (errors.length) return send(res, 400, { ok: false, errors });
          save(data);
          return send(res, 200, { ok: true, scripts: scriptsOf(data) });
        }
        if (req.method === 'POST' && sub === '/op') {
          const op = (await readJson(req)) as EditOp;
          const next = applyOp(load(), op);
          save(next);
          return send(res, 200, { ok: true, scripts: scriptsOf(next) });
        }
        if (req.method === 'POST' && sub === '/validate') {
          const structural = validateTutorialData(load());
          const py = spawnSync('python3', ['.claude/skills/tutorial-design/scripts/ftuecheck.py'], { cwd: root, encoding: 'utf8' });
          return send(res, 200, {
            ok: structural.length === 0 && py.status === 0,
            structural,
            ftue: { code: py.status, output: (py.stdout ?? '') + (py.stderr ?? '') }
          });
        }
        send(res, 404, { ok: false, error: `no route ${req.method} ${sub}` });
      } catch (e) {
        send(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
  };
}
