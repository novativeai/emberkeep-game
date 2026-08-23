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
 *   PUT  /__tutorial            ← { scripts, drop? }     replace the WHOLE file
 *   POST /__tutorial/op         ← one EditOp             an atomic edit, validated
 *   POST /__tutorial/validate   → { structural, ftue }   shape check + ftuecheck.py
 *
 * PUT IS A WHOLE-FILE REPLACE — it never merges. The body IS the new file, so a
 * caller that sends back only the scripts it edited is asking for the others to
 * be deleted, and that used to be granted in silence: a valid `main` plus one
 * lesson answered `{"ok":true}` and every other mid-game lesson was gone. It is
 * not a merge now either (a half-file would then be unable to DELETE anything,
 * and "which shape did I just send?" is exactly the ambiguity that lost the
 * lessons). Instead the drop must be SAID: every script on disk that the body
 * omits has to be named in `drop` (or `?drop=a,b`), or the write is refused 409
 * with their ids and nothing is touched. An accounted-for drop still answers
 * loudly — `dropped` names them and `replaced` counts what the file held — the
 * way the events API reports what a replace cost. Deleting one lesson without
 * holding the whole file is `POST /op {"op":"remove_script"}`.
 *
 * AND THE SAME LAW ONE LEVEL DOWN, BECAUSE THE FILE IS MADE OF BEATS. Diffing
 * script ids alone left the very same data loss alive inside a script: a body
 * carrying every script id but a truncated `main` answered `{"ok":true}` over
 * 63 dead beats. So `dropReport` accounts for BEATS too, `dropped` names every
 * one that died, and a write may destroy at most `TACIT_STEP_DROPS` of them
 * without saying so (that allowance, and why it is not zero, is on the constant).
 * Beats are declared in the same `drop` list — by `"script:beat"`, by their own
 * id, or by their script's id when the whole script goes. Deleting beats one at
 * a time without holding the whole file is `POST /op {"op":"remove_step"}`.
 *
 * The op applier is pure (`applyOp`) so the tests cover it without a server;
 * the middleware is the thin HTTP skin around it. That skin also carries the
 * write guard (`callerAllowed` / `declaresJson` below) — a dev API that edits
 * source files must not be drivable by whatever page the owner has open — and
 * every write leaves the replaced file behind in the temp dir (`keepBackup`).
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
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

/**
 * BEATS ARE WHAT THE FILE IS MADE OF, so beats are what the accounting counts.
 *
 * The first version of this only diffed script IDS, and that left the original
 * data-loss bug alive one level down: a PUT holding every script id but a
 * TRUNCATED `main` answered `{"ok":true,"dropped":[]}` while 63 of 64 beats
 * went in the bin. A whole-file replace destroys what the body omits at EVERY
 * granularity, so the report names both.
 *
 *  - `scripts`: script ids on disk the body left out.
 *  - `steps`:  `"<script>:<beat>"` for every beat id on disk that is nowhere in
 *    the body. Checked ACROSS scripts on purpose — step ids are unique
 *    file-wide (the validator says so), so a beat MOVED from one script to
 *    another is not a beat destroyed and must not be reported as one.
 *
 * `undeclared` is the part of that the caller did not admit in `drop`. A beat
 * counts as declared by its own id, by its `script:beat` label, or by its
 * script's id when the whole script is being dropped — deleting a lesson does
 * not also mean listing its beats one by one.
 *
 * Pure, so the law is checkable without a socket; `refuseDrop` turns it into a
 * verdict.
 */
export interface DropReport {
  /** Script ids the body omits — each dies with all its beats. */
  scripts: string[];
  /** `script:beat` for every beat id the body omits. */
  steps: string[];
  /** Everything above, flat, for the reply and the editor's "Deleted:" line. */
  dropped: string[];
  undeclared: { scripts: string[]; steps: string[] };
}

export function dropReport(
  before: TutorialScriptConfig[],
  sent: TutorialScriptConfig[],
  drop: readonly string[] = []
): DropReport {
  const keptScripts = new Set(sent.map((s) => s.id));
  const keptSteps = new Set(sent.flatMap((s) => (Array.isArray(s?.steps) ? s.steps : []).map((st) => st?.id)));
  const declared = new Set(drop);
  const scripts = before.map((s) => s.id).filter((id) => !keptScripts.has(id));
  const lostSteps = before.flatMap((s) =>
    (Array.isArray(s.steps) ? s.steps : []).filter((st) => !keptSteps.has(st?.id)).map((st) => ({ script: s.id, step: st?.id ?? '' }))
  );
  const steps = lostSteps.map((l) => `${l.script}:${l.step}`);
  return {
    scripts,
    steps,
    dropped: [...scripts, ...steps],
    undeclared: {
      scripts: scripts.filter((id) => !declared.has(id)),
      steps: lostSteps
        .filter((l) => !declared.has(`${l.script}:${l.step}`) && !declared.has(l.step) && !declared.has(l.script))
        .map((l) => `${l.script}:${l.step}`)
    }
  };
}

/**
 * How many beats a whole-file PUT may destroy WITHOUT naming them: one.
 *
 * Zero would be the tidy number, and it is the number the script-level rule
 * uses — but a script omitted from the body and a beat deleted on purpose are
 * not equally distinguishable. The World Builder's Tutorial tab holds the whole
 * file, deletes a beat from its in-memory copy and PUTs the result; its
 * `drop` list carries deleted SCRIPTS only (tools/worldbuilder/index.html,
 * `removeStep`). Refusing every undeclared beat would break its delete button,
 * so exactly ONE beat per write is allowed through untagged — an EDIT — while
 * two or more is a caller sending back something other than the file it loaded
 * and costs a 409. Nothing is ever silent either way: `dropped` names every
 * beat that died and `backup` is where to get it back.
 */
export const TACIT_STEP_DROPS = 1;

/** The 409 a report earns, or null when the write may proceed. */
export function refuseDrop(report: DropReport): string | null {
  const { scripts, steps } = report.undeclared;
  if (scripts.length) {
    return (
      `this PUT replaces the whole file and omits ${scripts.length} script(s) on disk: ${scripts.join(', ')} — ` +
      'send them back, or say you mean to delete them with { "drop": [ids] } (or ?drop=a,b). ' +
      'To delete one without holding the whole file, use POST /__tutorial/op { "op": "remove_script" }. Nothing was written.'
    );
  }
  if (steps.length > TACIT_STEP_DROPS) {
    return (
      `this PUT replaces the whole file and destroys ${steps.length} beats that are on disk: ${steps.join(', ')} — ` +
      `a write may drop at most ${TACIT_STEP_DROPS} beat without saying so, and this one is holding a script that lost ` +
      'several. Send the missing beats back, or name them in { "drop": ["script:beat", …] }. ' +
      'To delete beats one at a time, use POST /__tutorial/op { "op": "remove_step" }. Nothing was written.'
    );
  }
  return null;
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

/* ------------------------------------------------------------------ */
/* The write guard — kept verbatim in tools/events-api/server.ts        */
/* ------------------------------------------------------------------ */

/**
 * These endpoints EDIT SOURCE FILES, so the one thing they must never be is a
 * confused deputy for a page the owner merely happens to have open. Three
 * halves by now, and no one of them is enough alone:
 *
 *  - ORIGIN. `Access-Control-Allow-Origin: *` used to be stamped on every reply.
 *    That handed any third-party page the whole authored script to read, and it
 *    also OVERRODE vite's own `server.cors` default, which already answers
 *    loopback origins only — the policy this now matches instead of defeating.
 *    Headers alone are still not the fix: a browser withholds the RESPONSE from
 *    a disallowed origin, but the request has already run and the file is
 *    already written. So the origin is enforced here as well, and a refused one
 *    never reaches disk.
 *  - CONTENT TYPE. A POST with a *simple* content-type needs no preflight, so
 *    it lands whatever CORS says. Demanding `application/json` on the routes
 *    that WRITE makes every cross-origin write preflight — and a stranger's
 *    preflight comes back without an allow-origin header (vite's own cors
 *    answers OPTIONS at 204 upstream of this middleware, and stamps that header
 *    only for an origin it serves), so the browser drops the write before it is
 *    ever sent. The read-only routes keep no such rule, so the World
 *    Builder's ✓ Validate button — a POST with no body and no header — still
 *    works, and it changes nothing a page could want changed.
 *  - FETCH METADATA, because the Origin half has a documented blind spot it
 *    cannot see out of: a browser sends NO Origin on a no-cors GET, so an
 *    `<img>`/`<script>`/`<link>`/iframe aimed at a dev endpoint arrived looking
 *    exactly like curl — and `/__open-in-editor` spawns an editor from a plain
 *    GET. `Sec-Fetch-Site` is the header that tells them apart. The whole rule,
 *    and the Chromium measurements behind it, are on `callerAllowed` below.
 *
 * Allowed: a caller with no Origin and no browser fetch metadata (curl and the
 * tut/evt CLIs are not browsers and carry no ambient authority to borrow), an
 * Origin matching the request's own Host (the game and the tool served by vite,
 * LAN included when `--host` is on — safe because vite's `allowedHosts` refuses
 * an unknown Host before this middleware runs, so a rebound DNS name cannot
 * fake the match), and any loopback origin (the World Builder served from
 * `python3 -m http.server 8820`).
 * Refused: everything else, `null` included — an opaque origin is exactly what
 * a sandboxed iframe on a third-party page sends, which is the attack — and any
 * request a browser labelled `Sec-Fetch-Site: cross-site` while sending no
 * Origin, which is every no-cors way a stranger's page can reach us. A World
 * Builder opened straight off `file://` therefore no longer reaches the dev API
 * and gets a 403 saying so; serving it over http is the documented way anyway.
 */
const LOOPBACK = /^(?:[\w-]+\.)*localhost$|^127(?:\.\d{1,3}){3}$|^\[::1\]$/i;

/**
 * `Sec-Fetch-Site` exactly as the BROWSER set it. It is a forbidden header
 * name, so no page can add, alter or suppress it — which is what makes it
 * usable as evidence, unlike `Referer` (a page turns that off with one
 * attribute). Absent means the caller is not a browser at all, or the request
 * URL is not a potentially-trustworthy origin (see `callerAllowed`).
 */
function fetchSite(req: IncomingMessage): string | null {
  const raw = req.headers['sec-fetch-site'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value ? value.toLowerCase() : null;
}

/**
 * MAY THIS CALLER REACH A DEV API AT ALL? (Origin, plus the half Origin cannot
 * answer.)
 *
 * The Origin rule alone had a hole big enough to drive `/__open-in-editor`
 * through: a MISSING Origin passes — deliberately, because curl and the two
 * Python CLIs are not browsers and carry no ambient authority to borrow — but
 * per the Fetch spec a browser sends no Origin either on a no-cors GET. So a
 * third-party page's `<img src="http://localhost:5173/__open-in-editor?file=…">`
 * looked exactly like curl and got to spawn an editor on this machine.
 *
 * `Sec-Fetch-Site` closes it, because it separates the two cases the Origin
 * header conflates. MEASURED against Chromium (a page on `http://127.0.0.1` —
 * a different SITE — pointed at a logging server on `http://localhost`):
 *
 *   <img src>            Origin: —            Sec-Fetch-Site: cross-site
 *   <script src>         Origin: —            Sec-Fetch-Site: cross-site
 *   <link rel=stylesheet>Origin: —            Sec-Fetch-Site: cross-site
 *   <iframe src>         Origin: —            Sec-Fetch-Site: cross-site
 *   fetch(no-cors)       Origin: —            Sec-Fetch-Site: cross-site
 *   fetch(cors) / form   Origin: the attacker Sec-Fetch-Site: cross-site
 *   the overlay's fetch  Origin: —            Sec-Fetch-Site: same-origin
 *   World Builder :8820  Origin: loopback     Sec-Fetch-Site: same-site
 *   URL typed by hand    Origin: —            Sec-Fetch-Site: none
 *   curl / urllib        Origin: —            Sec-Fetch-Site: — (not a browser)
 *
 * So the added rule is one line: `cross-site` AND no Origin is a browser
 * fetching this on some page's behalf with no CORS to answer for it — refused.
 * `cross-site` WITH an Origin still falls through to the Origin rule, so the
 * World Builder on another loopback port (or on `127.0.0.1` while the game is
 * on `localhost`, which IS cross-site) keeps working. `same-origin`,
 * `same-site` and `none` (a URL the user typed) pass, and a caller with no
 * fetch metadata at all is a tool and passes as before.
 *
 * LIMIT, stated rather than assumed: browsers attach fetch metadata only to
 * potentially-trustworthy URLs. MEASURED — over plain http to a LAN IP
 * (`vite --host`) Chromium sends no `Sec-Fetch-*` at all, so such a session
 * falls back to the Origin rule alone and is exactly as protected as it was
 * before. localhost and 127.0.0.1 are potentially trustworthy, which is where
 * the dev server actually lives.
 *
 * The Origin half, unchanged: no Origin passes, an Origin matching the
 * request's own Host passes (vite's `allowedHosts` refuses an unknown Host
 * upstream, so a rebound DNS name cannot fake the match), any loopback origin
 * passes, and everything else — `null` included, the opaque origin a sandboxed
 * third-party iframe sends — is refused before the route is looked at, so a
 * refused write never reaches disk.
 */
export function callerAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  // A no-cors GET/navigation from a stranger's page: no Origin to judge, but
  // the browser said where it came from and a page cannot unsay it.
  if (!origin && fetchSite(req) === 'cross-site') return false;
  if (!origin) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false; // "null" — and anything else that is not a real origin
  }
  return url.host === req.headers.host || LOOPBACK.test(url.hostname);
}

/** A write must declare JSON, so it can never be a CORS *simple* request. */
export const declaresJson = (req: IncomingMessage): boolean => /^application\/json\s*(?:;|$)/i.test(req.headers['content-type'] ?? '');

/** How many replaced copies of one file are kept before the oldest is dropped. */
const BACKUP_KEEP = 8;

/**
 * Keep what a write replaced. These APIs overwrite an authored source file in
 * one shot, and that file is usually mid-edit and uncommitted, so a bad write
 * used to be unrecoverable. The copy goes to the OS temp dir rather than beside
 * the original on purpose: `src/data` is inside the dev server's watch
 * allow-list, and a sibling `.bak` would fire a rebuild on every save from the
 * editor. Returns where it landed so the reply can name it; a backup that
 * cannot be taken is reported as null and never blocks the edit.
 */
export function keepBackup(file: string, tag: string): string | null {
  try {
    const dir = path.join(os.tmpdir(), 'emberkeep-dev-api');
    mkdirSync(dir, { recursive: true });
    const to = path.join(dir, `${tag}.${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    copyFileSync(file, to);
    const mine = readdirSync(dir).filter((f) => f.startsWith(`${tag}.`)).sort();
    for (const f of mine.slice(0, Math.max(0, mine.length - BACKUP_KEEP))) rmSync(path.join(dir, f), { force: true });
    return to;
  } catch {
    return null;
  }
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
  /** Every write goes through here, so every write leaves a copy behind. */
  const save = (data: TutorialData): string | null => {
    const kept = keepBackup(file, 'tutorial');
    writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    return kept;
  };
  const send = (res: ServerResponse, code: number, body: unknown): void => {
    res.statusCode = code;
    res.end(JSON.stringify(body));
  };
  return (req, res) => {
    const origin = req.headers.origin;
    const allowed = callerAllowed(req);
    // Echo the caller's own origin when it is one we serve — never `*`, which
    // published the script to every page in the browser and overrode vite's cors.
    if (origin && allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    res.setHeader('Vary', 'Origin, Sec-Fetch-Site');
    res.setHeader('Content-Type', 'application/json');
    const sub = (req.url ?? '/').split('?')[0]!.replace(/\/+$/, '') || '/';
    if (!allowed) {
      // Refused before the route is even looked at. The PREFLIGHT never reaches
      // here — vite's cors answers OPTIONS upstream — but it answers a stranger
      // with no allow-origin header, so the browser never dispatches the write.
      // This is the second lock, for the request that arrives regardless.
      return send(res, 403, {
        ok: false,
        error: `origin "${String(origin)}" may not reach /__tutorial — a dev API writes source files; open the tool on localhost (or serve it over http) instead of file://`
      });
    }
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
          if (!declaresJson(req)) return send(res, 415, { ok: false, error: 'a write needs Content-Type: application/json' });
          const body = (await readJson(req)) as { scripts?: TutorialScriptConfig[]; drop?: string[] };
          if (!Array.isArray(body.scripts)) throw new Error('body must be { scripts: [...] }');
          // A DROP MUST BE SAID OUT LOUD. The body replaces the file, so every
          // script it omits dies; `drop` (body or `?drop=a,b`) is the caller
          // stating it meant that. Anything omitted and unnamed is a caller
          // that PUT back a partial dump, and the mid-game lessons it forgot
          // cost a 409 instead of the file.
          const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
          const drop = [...(Array.isArray(body.drop) ? body.drop : []), ...(query.get('drop')?.split(',').filter(Boolean) ?? [])];
          const before = scriptsOf(load());
          const report = dropReport(before, body.scripts, drop);
          const refusal = refuseDrop(report);
          if (refusal) {
            return send(res, 409, {
              ok: false,
              dropped: [...report.undeclared.scripts, ...report.undeclared.steps],
              error: refusal
            });
          }
          // `dataOf` throws on a list with no main script and the validator
          // refuses a main script with no steps, so the whole-file replace can
          // no longer answer ok while leaving Chapter One erased.
          const data = dataOf(body.scripts);
          const errors = validateTutorialData(data);
          if (errors.length) return send(res, 400, { ok: false, errors });
          const backup = save(data);
          // What the replace COST, in the reply, always: how much was on disk,
          // and which scripts AND WHICH BEATS are now gone — `dropped` naming
          // only scripts is how a truncated `main` once read as a clean save.
          // `backup` is where to get any of it back.
          return send(res, 200, {
            ok: true,
            backup,
            replaced: { scripts: before.length, steps: before.reduce((n, s) => n + s.steps.length, 0) },
            dropped: report.dropped,
            lost: { scripts: report.scripts, steps: report.steps },
            scripts: scriptsOf(data)
          });
        }
        if (req.method === 'POST' && sub === '/op') {
          if (!declaresJson(req)) return send(res, 415, { ok: false, error: 'a write needs Content-Type: application/json' });
          const op = (await readJson(req)) as EditOp;
          const next = applyOp(load(), op);
          const backup = save(next);
          return send(res, 200, { ok: true, backup, scripts: scriptsOf(next) });
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
