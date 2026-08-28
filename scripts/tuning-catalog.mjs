/**
 * THE TUNING CATALOG — every animation, delay and speed the game runs on, read
 * out of `src/core/Constants.ts` itself.
 *
 * The worldbuilder's ⏱ Tuning page edits these, and the one thing it must never
 * do is drift from the file: a hand-written list of knobs goes stale the first
 * time someone adds a constant, and a stale tuning page is worse than none. So
 * the catalog is PARSED. Every numeric literal under a named group (or a bare
 * `export const … = <number>`) is found with its exact character span, which is
 * what lets a write splice one number and leave the file — comments, ordering,
 * expressions and all — otherwise untouched.
 *
 * Values that are EXPRESSIONS (`8 * 60_000`, `GOLD_UNIT * 3`) are catalogued
 * read-only: their meaning lives in the expression, and a tool that flattened
 * one to a literal would quietly delete that meaning.
 */

/** A numeric literal, with underscores as TS writes them. */
const NUMBER = /^-?\d[\d_]*(?:\.\d[\d_]*)?(?:e[+-]?\d+)?$/i;
const isNumber = (raw) => NUMBER.test(raw.trim());
const numOf = (raw) => Number(raw.trim().replace(/_/g, ''));

/** Strip comments and strings so the brace scanner cannot be fooled by them. */
function blankNoise(src) {
  const out = src.split('');
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') out[i++] = ' ';
    } else if (c === '/' && d === '*') {
      out[i++] = ' '; out[i++] = ' ';
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] !== '\n') out[i] = ' '; i++; }
      if (i < src.length) { out[i++] = ' '; out[i++] = ' '; }
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out[i++] = ' ';
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') { out[i++] = ' '; } if (i < src.length && src[i] !== '\n') out[i] = ' '; i++; }
      if (i < src.length) out[i++] = ' ';
    } else {
      i++;
    }
  }
  return out.join('');
}

/**
 * The doc comment IMMEDIATELY above an offset, as one flat line.
 *
 * Scanned from the end backwards, never by a regex anchored at `$`: a lazy
 * `/\*\*[\s\S]*?\*\/\s*$/` matches the FIRST block comment in the file that can
 * still end where the search does, so every constant came back wearing the
 * file's own header. The rule is "the comment that ends here, if anything but
 * whitespace does not sit between".
 */
function docAbove(src, start) {
  const head = src.slice(0, start);
  const tail = head.replace(/\s+$/, '');
  if (tail.endsWith('*/')) {
    const open = tail.lastIndexOf('/**', tail.length - 2);
    if (open >= 0) {
      return tail
        .slice(open + 3, tail.length - 2)
        .split('\n')
        .map((l) => l.replace(/^\s*\*ic?\s?/, '').replace(/^\s*\*\s?/, '').trim())
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }
  // …or a run of `//` lines directly above.
  const lines = head.split('\n');
  const picked = [];
  for (let i = lines.length - 2; i >= 0; i--) {
    const t = lines[i].trim();
    if (t.startsWith('//')) picked.unshift(t.replace(/^\/\/\s?/, ''));
    else break;
  }
  return picked.join(' ').replace(/\s+/g, ' ').trim();
}

/** The trailing `// …` comment on the same line as an offset. */
function docAfter(src, end) {
  const line = src.slice(end, src.indexOf('\n', end) === -1 ? src.length : src.indexOf('\n', end));
  const m = /\/\/\s*(.*)$/.exec(line);
  return m ? m[1].trim() : '';
}

/**
 * Every numeric leaf in the file, as `{ path, value, start, end }`.
 *
 * `start`/`end` bracket the literal ONLY — a write is a splice of those bytes,
 * so nothing else in the file can move.
 */
export function parseConstants(src) {
  const clean = blankNoise(src);
  const out = [];
  const decl = /export const ([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*/g;
  let m;
  while ((m = decl.exec(clean))) {
    const name = m[1];
    let i = m.index + m[0].length;
    if (clean[i] === '{') {
      // Walk the object, remembering the key path as depth changes.
      const stack = [];
      let depth = 0;
      let pendingKey = null;
      i++; depth = 1;
      let valueStart = -1;
      while (i < clean.length && depth > 0) {
        const c = clean[i];
        if (c === '{') {
          if (pendingKey !== null) { stack.push(pendingKey); pendingKey = null; }
          depth++; i++; valueStart = -1; continue;
        }
        if (c === '}') {
          if (valueStart >= 0 && pendingKey !== null) {
            const raw = clean.slice(valueStart, i);
            if (isNumber(raw)) out.push(leaf(src, name, [...stack, pendingKey], valueStart, valueStart + raw.trimEnd().length, raw));
            valueStart = -1; pendingKey = null;
          }
          depth--; if (stack.length) stack.pop(); i++; continue;
        }
        if (c === '[') { // an array value: skip it whole (order matters, not a slider)
          let d2 = 1; i++;
          while (i < clean.length && d2 > 0) { if (clean[i] === '[') d2++; else if (clean[i] === ']') d2--; i++; }
          valueStart = -1; pendingKey = null; continue;
        }
        if (c === ':') {
          const before = clean.slice(0, i);
          const km = /([A-Za-z_$][A-Za-z0-9_$]*)\s*$/.exec(before) || /['"]([^'"]+)['"]\s*$/.exec(before);
          pendingKey = km ? km[1] : null;
          i++;
          while (i < clean.length && /\s/.test(clean[i])) i++;
          valueStart = i;
          continue;
        }
        if (c === ',') {
          if (valueStart >= 0 && pendingKey !== null) {
            const raw = clean.slice(valueStart, i);
            if (isNumber(raw)) out.push(leaf(src, name, [...stack, pendingKey], valueStart, valueStart + raw.trimEnd().length, raw));
          }
          valueStart = -1; pendingKey = null; i++; continue;
        }
        i++;
      }
    } else {
      // A bare `export const NAME = <literal>;`
      const semi = clean.indexOf(';', i);
      if (semi > i) {
        const raw = clean.slice(i, semi);
        if (isNumber(raw)) out.push(leaf(src, name, [], i, i + raw.trimEnd().length, raw));
      }
    }
  }
  return out;
}

function leaf(src, group, keys, start, end, raw) {
  const path = keys.length ? `${group}.${keys.join('.')}` : group;
  return {
    group,
    keys,
    path,
    value: numOf(raw),
    raw: raw.trim(),
    start,
    end,
    doc: docAfter(src, end) || docAbove(src, src.lastIndexOf('\n', start) + 1)
  };
}

/** Splice new values into the source, right-to-left so offsets stay valid. */
export function applyTuning(src, edits, index) {
  const byPath = new Map(index.map((e) => [e.path, e]));
  const chosen = [];
  for (const [path, value] of Object.entries(edits)) {
    const e = byPath.get(path);
    if (!e) throw new Error(`unknown tunable "${path}"`);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a number`);
    chosen.push({ e, value });
  }
  chosen.sort((a, b) => b.e.start - a.e.start);
  let out = src;
  for (const { e, value } of chosen) {
    // Keep integers integral: a duration written as 820 must not become 820.0000001.
    let text = Number.isInteger(value) ? String(value) : String(Math.round(value * 1e6) / 1e6);
    // …and keep the file's own digit grouping: a constant written `10_000` is
    // written that way because it is read as ten thousand.
    if (e.raw.includes('_') && Number.isInteger(value) && Math.abs(value) >= 1000) {
      text = text.replace(/\B(?=(\d{3})+(?!\d))/g, '_');
    }
    out = out.slice(0, e.start) + text + out.slice(e.end);
  }
  return { text: out, count: chosen.length };
}

/**
 * THE CATEGORIES — what the ⏱ Tuning page shows, and in what order.
 *
 * Membership is by GROUP wherever the whole group is about motion or time, so
 * a constant added to `DRAGON_ANIM` tomorrow appears on the page by itself. A
 * mixed group (`TOP_UP` is mostly layout) names its timing keys instead. What
 * no category claims still appears, under "Everything else" — the page is a
 * view of the file, not a hand-kept copy of part of it.
 *
 * `preview` names the scene the right-hand pane plays for that category.
 */
export const CATEGORIES = [
  { id: 'merge', name: 'Merge & pieces', preview: 'merge',
    groups: ['TIMINGS', 'MERGE_READY', 'DRAG', 'ITEM_SHADOW'],
    blurb: 'How a piece lifts, travels, gathers and lands — and the pulse that says a merge is ready.' },
  { id: 'hint', name: 'Hints & suggestions', preview: 'hint',
    groups: ['MERGE_HINT', 'MERGE_HINT_WEIGHTS'],
    blurb: 'How long the board waits before it suggests a merge, and how long it rests after one.' },
  { id: 'pointer', name: 'Tutorial pointer', preview: 'pointer',
    groups: ['TUTORIAL_HAND', 'TUTORIAL_ARROW'], keys: ['TUTORIAL_FOLLOW_MS'],
    blurb: 'The gauntlet that demonstrates a drag or a tap, and the arrow that names a target.' },
  { id: 'dialogue', name: 'Dialogue & reading', preview: 'dialogue',
    groups: ['TYPEWRITER', 'READING', 'PORTRAIT_CLIP_TALK'],
    keys: ['STORY_BEAT_HOLD_MS', 'OPENING_HOLD_MS', 'FIRST_CONTACT_HOLD_MS', 'FIRST_CONTACT_RETRY_MS',
           'STATUS_FLASH_MS', 'STATUS_FADE_IN_MS', 'STATUS_FADE_OUT_MS', 'DIALOGUE_MAX_CHARS'],
    blurb: 'Typing speed, how long a line is held, and how long the game thinks a line takes to read.' },
  { id: 'dragon', name: 'Dragons', preview: 'dragon',
    groups: ['DRAGON_ANIM', 'DRAGON_CLIPS', 'SLEEP_BREATH', 'GATE_FLIGHT', 'DRAGON_OUTLINE'],
    keys: ['DRAGON_ROAR_MS', 'DRAGON_ROAR_EVERY_MS', 'DRAGON_WAKE_MS', 'DRAGON_NAP_LENGTH_MS',
           'DRAGON_NAP_CYCLE_MIN_MS', 'DRAGON_NAP_CYCLE_MAX_MS', 'DRAGON_WANDER_EVERY_MS',
           'DRAGON_WANDER_SPREAD_MS', 'DRAGON_WANDER_FLIGHT_MS', 'DRAGON_WANDER_ARC',
           'DRAGON_WANDER_MIN_DIST', 'DRAGON_WANDER_MAX_DIST', 'DRAGON_WORK_MS', 'DRAGON_REST_MS',
           'DRAGON_HUNGER_GRACE_MS', 'DRAGON_SLEEP_SCALE'],
    blurb: 'Idle cadence, celebrate, flight, sleep and the gaps between a dragon doing anything at all.' },
  { id: 'folk', name: 'Characters', preview: 'folk',
    groups: ['STANDEE_BREATH', 'STANDEE_CLIP_BLINK', 'STANDEE_BANKS'],
    keys: ['CHARACTER_COOLDOWN_MIN_MS'],
    blurb: 'Eleanor and Selyna: their breath, their blink, and the frame rate of every clip they play.' },
  { id: 'ceremony', name: 'Ceremony & reveals', preview: 'ceremony',
    groups: ['REVEAL', 'EGG_GIFT', 'FINALE', 'GOLDEN_ALTAR'],
    blurb: 'The dragon reveal card, the egg gift, and the finale timeline the Elder wakes on.' },
  { id: 'travel', name: 'World travel', preview: 'travel',
    groups: ['TRAVEL_WIPE'], keys: ['TRAVEL_VEIL_TIMEOUT_MS', 'GATE_LIGHT_GRACE_MS'],
    blurb: 'The veil that covers the board between worlds — how it grows, holds and pulls back.' },
  { id: 'weather', name: 'Weather & scenery', preview: 'weather',
    groups: ['FOG_BLANKET', 'FOG_STORM', 'ATMOSPHERE', 'EMBER_MOTES', 'FOIL', 'DECOR_BOUNCE'],
    keys: ['TREE_BOUNCE_SPEEDUP'],
    blurb: 'Cloud breath, storm drift, motes, the foil sweep and the bounce a tree answers a tap with.' },
  { id: 'input', name: 'Input & camera', preview: 'input',
    groups: ['HOLD_TO_PAN', 'EDGE_SCROLL'],
    keys: ['TAP_MAX_MS', 'TAP_MAX_DISTANCE_PX', 'HIT_FORGIVENESS_PX'],
    blurb: 'What still counts as a tap, how long a hold takes to become a pan, and how fast the edge scrolls.' },
  { id: 'waits', name: 'Waits & economy', preview: 'waits',
    keys: ['ENERGY_REGEN_MS', 'ENERGY_REGEN_AMOUNT', 'ENERGY_MAX', 'ENERGY_START', 'CHEST_INTERVAL_MS',
           'GENERATOR_PASSIVE_RETRY_MS', 'WELCOME_BACK_MIN_MS', 'OFFLINE_BANK_CYCLES', 'PHASE_MS'],
    blurb: 'Every clock the player waits on: Warmth, chests, passive generators and the day phase.' },
  { id: 'power', name: 'Power & panels', preview: 'power',
    groups: ['POWER'], keys: ['TOP_UP.openMs', 'TOP_UP.closeMs'],
    blurb: 'When the game throttles itself while idle, and how fast a panel opens.' }
];

/** A sensible slider range for a value, from its own magnitude. */
export function rangeFor(value, path) {
  const abs = Math.abs(value);
  const frac = !Number.isInteger(value);
  if (/Chance|Frac|Alpha|alpha|Scale$|scale$|amount|Amount|squash|ofWidth/.test(path) && abs <= 4) {
    return { min: value < 0 ? -2 : 0, max: Math.max(1, Math.ceil(abs * 2)), step: 0.001 };
  }
  if (frac && abs <= 4) return { min: value < 0 ? -Math.max(1, abs * 3) : 0, max: Math.max(1, abs * 3), step: 0.001 };
  if (abs <= 20) return { min: value < 0 ? Math.floor(value * 3) : 0, max: Math.max(20, Math.ceil(abs * 3)), step: frac ? 0.01 : 1 };
  if (abs <= 2000) return { min: value < 0 ? Math.floor(value * 3) : 0, max: Math.ceil((abs * 3) / 10) * 10, step: frac ? 0.1 : 5 };
  return { min: value < 0 ? Math.floor(value * 3) : 0, max: Math.ceil((abs * 3) / 1000) * 1000, step: 100 };
}

/** The whole page's data: categories, each with its parameters. */
export function buildCatalog(src) {
  const all = parseConstants(src);
  const byPath = new Map(all.map((e) => [e.path, e]));
  const used = new Set();
  const param = (e) => {
    used.add(e.path);
    return { path: e.path, group: e.group, key: e.keys.join('.') || e.group, value: e.value, doc: e.doc, ...rangeFor(e.value, e.path) };
  };
  const cats = CATEGORIES.map((c) => {
    const params = [];
    for (const g of c.groups ?? []) for (const e of all) if (e.group === g && !used.has(e.path)) params.push(param(e));
    for (const k of c.keys ?? []) { const e = byPath.get(k); if (e && !used.has(e.path)) params.push(param(e)); }
    return { id: c.id, name: c.name, blurb: c.blurb, preview: c.preview, params };
  }).filter((c) => c.params.length);
  const rest = all.filter((e) => !used.has(e.path));
  if (rest.length) {
    cats.push({
      id: 'rest',
      name: 'Everything else',
      blurb: 'Every remaining number in Constants.ts — sizes, counts, depths and rates no category claimed. Nothing here is hidden from you; it simply has no animation to show.',
      preview: null,
      params: rest.map(param)
    });
  }
  return cats;
}
