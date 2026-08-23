#!/usr/bin/env node
/**
 * EVENTS — run one authored event in a real game and say what it did.
 *
 *   node scripts/events.mjs list                     every event in src/data/events.json
 *   node scripts/events.mjs run <id> … [options]     boot a beat, fire it, screenshot, report
 *
 * Several ids share one boot and fire in the order given — which is the only
 * way to watch a CHILD do anything, since its guard reads the parent's latch
 * and every run starts from a clean checkpoint.
 *
 * Options (run):
 *   --at <step>      the recorded beat to boot into (default: the last one, free_play)
 *   --shot <path>    where the screenshot goes, one id only (default
 *                    tests/e2e/checkpoints/_event-<id>.png, one per id)
 *   --keep-tutorial  do not take the final beat's tap first (see handOver)
 *   --url U          a running game (default: the dev server on 5173) · --headed  watch it
 *
 * The ⚡ half of `pnpm beat`. `beat` answers "what does this lesson look like";
 * this answers "what does this event DO" — the same boot, then
 * `__emberkeep.fireEvent(id)` and a before/after read of
 * `render_game_to_text()`, so every observable consequence of the actions
 * (gold, XP, Warmth, pieces on the board, the fired ledger, a panel, a line in
 * the ring) is named rather than left for the eye to find in a screenshot.
 *
 * WHY A REFUSAL IS EXPLAINED. `fireEvent` returns a bare boolean, and an event
 * that will not run is the normal case while authoring: `once` already spent, a
 * limit reached, a cooldown still warm, or — nearly always — a guard that does
 * not hold in this beat. So the gate is re-walked here in the same order the
 * runtime walks it (EventSystem.mayFire → conditionsHold), reading the live
 * values through the game's OWN `readProperty`, imported from the running
 * page. Nothing about the predicate is re-derived: a diagnosis that disagreed
 * with the system would be worse than none.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { bootAt, defaultCheckpoint, flag, launch, opt, renderText, resolveUrl, ROOT, settleBubble, sleep, toPageRect, CHECKPOINT_DIR } from './game-harness.mjs';

const args = process.argv.slice(2);
const URL_OPT = opt(args, '--url');
const AT = opt(args, '--at');
const SHOT = opt(args, '--shot');
const HEADED = flag(args, '--headed');
const KEEP_TUTORIAL = flag(args, '--keep-tutorial');
const cmd = args[0];

const EVENTS_FILE = path.join(ROOT, 'src/data/events.json');
const rel = (p) => path.relative(ROOT, p);

/* ------------------------------------------------------------------- model */

/** The authored tree, flattened depth-first — ids are unique across it. */
function flatten(events, parent = null, depth = 0, out = []) {
  for (const e of events) {
    out.push({ event: e, parent, depth });
    flatten(e.children ?? [], e, depth + 1, out);
  }
  return out;
}

const authored = () => flatten(JSON.parse(readFileSync(EVENTS_FILE, 'utf8')).events ?? []);

const latchOf = (e) =>
  e.once ? 'once' : [e.limit ? `×${e.limit}` : null, e.cooldownMs ? `every ≥${e.cooldownMs}ms` : null].filter(Boolean).join(' ') || '∞';

const triggerText = (t) =>
  t.type === 'event' ? `on ${t.event}${t.match ? ` where ${Object.entries(t.match).map(([k, v]) => `${k}=${v}`).join(', ')}` : ''}`
  : t.type === 'tap' ? `tap ${t.target}`
  : t.type === 'property' ? `when ${t.prop} becomes ${t.op} ${t.value}`
  : t.type === 'time' ? `${t.afterMs}ms after armed`
  : 'manual';

const actionText = (a) =>
  'add' in a ? `${a.add} ${a.amount >= 0 ? '+' : ''}${a.amount}`
  : 'set' in a ? `${a.set} = ${a.value}`
  : 'say' in a ? `${a.say.speaker} says ${a.say.lines.length} line(s)`
  : 'prompt' in a ? `ask "${a.prompt.text}" (${a.prompt.choices.map((c) => c.id).join(' | ')})`
  : 'spawn' in a ? `spawn ${a.spawn.count}× ${a.spawn.chain} t${a.spawn.tier}`
  : 'retier' in a ? `retier ${a.retier.chain} t${a.retier.fromTier}→t${a.retier.toTier}`
  : 'open' in a ? `open ${a.open}`
  : 'tutorial' in a ? `start tutorial ${a.tutorial}`
  : 'fire' in a ? `fire ${a.fire}`
  : 'emit' in a ? `emit ${a.emit}`
  : JSON.stringify(a);

function list() {
  const all = authored();
  if (!all.length) {
    console.log('no events authored — src/data/events.json is empty');
    return;
  }
  for (const { event: e, depth } of all) {
    const pad = '  '.repeat(depth);
    console.log(`${pad}${e.id}${e.title ? `  — ${e.title}` : ''}   [${latchOf(e)}]${depth ? '   (child)' : ''}`);
    for (const t of e.when ?? []) console.log(`${pad}    when  ${triggerText(t)}`);
    for (const c of e.if ?? []) console.log(`${pad}    if    ${c.prop} ${c.op} ${c.value}`);
    for (const a of e.then ?? []) console.log(`${pad}    then  ${actionText(a)}`);
  }
  console.log(`\n${all.length} event(s) in ${rel(EVENTS_FILE)} · run one with \`pnpm event <id>\``);
}

/* -------------------------------------------------------------------- diff */

/**
 * `render_game_to_text` as a flat label → value map. The board collapses to one
 * count per chain+tier: an event that spawns is visible as `board emberberry
 * t1  4 → 6`, which is the sentence its author wrote.
 */
function measures(t) {
  const m = new Map();
  m.set('scene', t.scene);
  m.set('level', t.level);
  m.set('xp', t.xp);
  m.set('gold', t.coins);
  m.set('keys', t.keys);
  m.set('warmth', t.energy.current);
  m.set('warmth max', t.energy.max);
  m.set('tutorial step', t.tutorial.step);
  m.set('lesson', t.tutorial.lesson ?? '—');
  m.set('order', t.order?.id ?? '—');
  m.set('orders done', (t.completedOrders ?? []).join(' ') || '—');
  // One measure per fired event rather than one long string, so the diff names
  // the event that just ran instead of reprinting the whole ledger twice.
  for (const entry of t.events ?? []) {
    const [id, count] = entry.split('×');
    m.set(`event ${id}`, Number(count) || 0);
  }
  for (const [region, status] of Object.entries(t.regions ?? {})) m.set(`region ${region}`, status);
  // `inventory` counts every piece the state holds, `board` only the ones
  // standing on the grid — a spawn that overflows moves one and not the other.
  for (const [item, n] of Object.entries(t.inventory ?? {})) m.set(`pieces ${item}`, n);
  for (const row of t.board ?? []) {
    for (const cell of row) {
      if (!cell?.chain) continue;
      const k = `board ${cell.chain} t${cell.tier}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  }
  return m;
}

function diff(before, after) {
  const a = measures(before);
  const b = measures(after);
  const out = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const from = a.get(k) ?? 0;
    const to = b.get(k) ?? 0;
    if (from === to) continue;
    const delta = typeof from === 'number' && typeof to === 'number' ? `  (${to - from >= 0 ? '+' : ''}${to - from})` : '';
    out.push(`${k.padEnd(24)} ${String(from)} → ${String(to)}${delta}`);
  }
  return out.sort();
}

/* ------------------------------------------------------------------- probe */

/**
 * The consequences a text render cannot carry: who is in the dialogue ring and
 * what they are saying, and whether a choice card is up. Read-only and wholly
 * defensive — UIScene's internals belong to UIScene, and a rename there must
 * cost this tool a line of output, never a crash mid-run.
 */
const stage = (page) =>
  page.evaluate(() => {
    try {
      const ui = window.__emberkeep.game.scene.getScene('UIScene');
      const bubble = ui?.bubble;
      const choice = ui?.choice;
      // Panels answer "am I up?" with either an `isOpen` latch or plain
      // visibility, depending on the panel — ask for both and take whichever
      // the object actually has.
      const panels = ['ledger', 'store', 'bag', 'cauldron', 'codex', 'cookbook'].filter((p) => {
        const panel = ui?.[p];
        return panel && (typeof panel.isOpen === 'boolean' ? panel.isOpen : !!panel.visible);
      });
      return {
        bubble: bubble?.visible ? { speaker: bubble.artSpeaker ?? null, line: bubble.rawLine ?? bubble.label?.text ?? null } : null,
        prompt: choice?.isOpen ? { id: choice.current?.id ?? null, text: choice.current?.text ?? null, choices: (choice.current?.choices ?? []).map((c) => c.label) } : null,
        panels,
        queued: ui?.pendingEvents?.length ?? 0
      };
    } catch {
      return null;
    }
  });

/**
 * Why the gate did (or would) refuse, walked in the runtime's own order.
 *
 * `readProperty` is imported from the page's module graph rather than copied:
 * on the dev server that IS the shipped predicate. Against a built bundle the
 * import has no path to resolve and the guard values come back unread, which
 * the caller reports as such instead of guessing.
 */
const gate = (page, event) =>
  page.evaluate(async (e) => {
    const ctx = window.__emberkeep.game.registry.get('ctx');
    const status = window.__emberkeep.events().find((s) => s.id === e.id) ?? null;
    const now = ctx?.clock?.now?.() ?? null;
    const stats = ctx?.state?.stats ?? {};
    const out = {
      status,
      now,
      firedStat: stats[`evt:${e.id}:fired`] ?? 0,
      lastStat: stats[`evt:${e.id}:last`] ?? 0,
      conditions: (e.if ?? []).map((c) => ({ ...c, actual: null, ok: null }))
    };
    if (!out.conditions.length) return out;
    let readProperty = null;
    try {
      ({ readProperty } = await import(/* @vite-ignore */ '/src/core/gameEvents.ts'));
    } catch {
      return out;
    }
    const facts = ctx.systems.events.facts();
    const cmp = { '==': (l, r) => l === r, '!=': (l, r) => l !== r, '>': (l, r) => l > r, '>=': (l, r) => l >= r, '<': (l, r) => l < r, '<=': (l, r) => l <= r };
    for (const c of out.conditions) {
      c.actual = readProperty(facts, c.prop);
      c.ok = cmp[c.op](c.actual, c.value);
    }
    return out;
  }, event);

/**
 * Take the bubble back from the director before firing.
 *
 * `say` and `prompt` are QUEUED while a tutorial step owns the bubble
 * (UIScene.playEventBeat) — an event fired at the last beat therefore reports
 * a perfectly true "fired ✓" over a screen where nothing happened, which is
 * the most misleading thing this tool could print. So on the final beat, whose
 * gate is the tap that ends the script, the tap is taken here, exactly as a
 * player takes it. Anywhere earlier the script is genuinely mid-lesson and
 * playing it forward is `pnpm beat`'s job, not this one's: say so and fire
 * anyway.
 */
async function handOver(page) {
  const t = await renderText(page);
  if (t.tutorial.done) return { done: true, note: null };
  if (t.tutorial.index + 1 < t.tutorial.total) {
    return { done: false, note: `the tutorial is mid-script on "${t.tutorial.step}" — say/prompt actions will be QUEUED until it hands back` };
  }
  const at = await page.evaluate(() => {
    const b = window.__emberkeep.game.scene.getScene('UIScene')?.bubble;
    if (!b?.visible) return null;
    const r = b.getBounds();
    return { x: r.centerX, y: r.centerY, width: 0, height: 0 };
  });
  if (!at) return { done: false, note: 'the last beat is open but its bubble is not up — say/prompt may be queued' };
  const p = await toPageRect(page, at);
  await page.mouse.click(p.x, p.y);
  await sleep(700);
  const after = await renderText(page);
  return { done: after.tutorial.done, note: after.tutorial.done ? 'tapped the last beat closed so the bubble is free' : 'tapped the last beat, but the director still holds the bubble' };
}

/** The sentence that answers "why not", from the gate read taken BEFORE firing. */
function refusal(event, g) {
  if (!g.status) return 'the running game does not know this id — its events.json is older than the file on disk (reload the page)';
  if (event.once && g.firedStat > 0) return `already fired (\`once\`, and evt:${event.id}:fired = ${g.firedStat})`;
  if (event.limit && g.firedStat >= event.limit) return `limit reached (${g.firedStat}/${event.limit})`;
  if (event.cooldownMs && g.firedStat > 0 && g.now !== null && g.now - g.lastStat < event.cooldownMs) {
    return `cooling down (${Math.ceil((event.cooldownMs - (g.now - g.lastStat)) / 1000)}s of ${event.cooldownMs}ms left)`;
  }
  const failed = g.conditions.filter((c) => c.ok === false);
  if (failed.length) return `a condition failed: ${failed.map((c) => `${c.prop} ${c.op} ${c.value} (actual ${c.actual})`).join('; ')}`;
  if (g.conditions.some((c) => c.ok === null)) {
    return `a condition failed, but its live values could not be read (not the dev server?): ${g.conditions.map((c) => `${c.prop} ${c.op} ${c.value}`).join('; ')}`;
  }
  return 'the gate reports nothing — an action of its own may have re-entered it, or the id is a child of an event that owns a `fire`';
}

/* --------------------------------------------------------------------- run */

async function run(ids) {
  const all = authored();
  const missing = ids.filter((id) => !all.some((f) => f.event.id === id));
  if (missing.length) {
    console.error(`no event ${missing.map((m) => `"${m}"`).join(', ')} in ${rel(EVENTS_FILE)}\n  have: ${all.map((f) => f.event.id).join(', ') || '(none authored)'}`);
    process.exitCode = 1;
    return;
  }
  const step = AT ?? defaultCheckpoint();
  const url = await resolveUrl(URL_OPT);
  const { browser, page, errors } = await launch({ headed: HEADED });
  try {
    const t0 = Date.now();
    const landed = await bootAt(page, url, step);
    if (landed !== step) console.warn(`! asked for "${step}", the game resumed on "${landed}"`);
    const hand = KEEP_TUTORIAL ? { done: null, note: 'left the tutorial exactly as the checkpoint recorded it (--keep-tutorial)' } : await handOver(page);
    console.log(`\nboot   ${landed}  ·  ${((Date.now() - t0) / 1000).toFixed(1)}s${hand.note ? `\nstage  ${hand.note}` : ''}`);
    // Several ids share ONE boot, in the order given: that is how a child is
    // seen doing anything at all, since its guard reads the parent's latch.
    for (const id of ids) await fireOne(page, errors, all.find((f) => f.event.id === id), ids.length > 1 || !SHOT ? null : SHOT);
  } finally {
    await browser.close();
  }
}

async function fireOne(page, errors, hit, shotOverride) {
  const event = hit.event;
  const id = event.id;
  const shot = path.resolve(shotOverride ?? path.join(CHECKPOINT_DIR, `_event-${id}.png`));
  const before = await renderText(page);
  const stageBefore = await stage(page);
  const g = await gate(page, event);
  const errorsBefore = errors.length;
  const fired = await page.evaluate((eid) => window.__emberkeep.fireEvent(eid), id);
  await sleep(1200); // spawn tweens, a panel's slide
  // A line the ring is still typing photographs as two letters, so an event
  // that speaks is given until the text lands before anything is read off it.
  if ((event.then ?? []).some((a) => 'say' in a || 'prompt' in a)) await settleBubble(page);
  const after = await renderText(page);
  const onStage = await stage(page);
  await page.screenshot({ path: shot });

  console.log(`\n${event.id}${event.title ? `  — ${event.title}` : ''}   [${latchOf(event)}]${hit.parent ? `   child of ${hit.parent.id}` : ''}`);
  for (const t of event.when ?? []) console.log(`  when   ${triggerText(t)}`);
  for (const c of event.if ?? []) {
    const live = g.conditions.find((x) => x.prop === c.prop && x.op === c.op && x.value === c.value);
    console.log(`  if     ${c.prop} ${c.op} ${c.value}${live && live.actual !== null ? `   (actual ${live.actual} — ${live.ok ? 'holds' : 'FAILS'})` : ''}`);
  }
  for (const a of event.then ?? []) console.log(`  then   ${actionText(a)}`);
  console.log(`  state  armed ${g.status?.armed ? 'yes' : 'no'}  ·  fired before ${g.firedStat}×`);
  console.log(fired ? '\n  FIRED ✓' : `\n  DID NOT FIRE ✗ — ${refusal(event, g)}`);

  const changes = diff(before, after);
  if (changes.length) {
    console.log('\n  observable change');
    for (const line of changes) console.log(`    ${line}`);
  } else if (fired) {
    console.log('\n  observable change: none in the text render (a say/prompt/open shows only on screen — look at the shot)');
  }
  const opened = (onStage?.panels ?? []).filter((p) => !(stageBefore?.panels ?? []).includes(p));
  if (opened.length) console.log(`\n  panel   ${opened.join(', ')} opened`);
  if (onStage?.bubble) console.log(`${opened.length ? '' : '\n'}  ring    ${onStage.bubble.speaker ?? '?'}: "${onStage.bubble.line ?? ''}"`);
  if (onStage?.prompt) console.log(`  prompt  "${onStage.prompt.text}" → [${onStage.prompt.choices.join('] [')}]`);
  if ((onStage?.queued ?? 0) > (stageBefore?.queued ?? 0)) {
    console.log(`  queued  ${onStage.queued - stageBefore.queued} say/prompt beat(s) are waiting for the director to hand the bubble back`);
  }

  const recorded = await page.evaluate(() => window.__emberkeep.errors()).catch(() => []);
  const fresh = errors.slice(errorsBefore);
  if (fresh.length || recorded.length) {
    console.log('\n  errors');
    for (const e of fresh) console.log(`    ${e}`);
    for (const e of recorded) console.log(`    recorded: ${e.message ?? JSON.stringify(e)}`);
  }
  console.log(`\n  shot   ${rel(shot)}`);
  if (!fired) process.exitCode = 1;
}

if (cmd === 'list') list();
else if (cmd === 'run' && args[1]) await run(args.slice(1));
else {
  console.log('usage: events.mjs list | run <id> [<id> …] [--at step] [--shot path] [--url U] [--headed] [--keep-tutorial]');
  process.exit(2);
}
