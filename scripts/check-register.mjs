#!/usr/bin/env node
/**
 * Register audit — is every spoken line still readable by a 10-year-old?
 *
 *   node scripts/check-register.mjs              # human report + distribution
 *   node scripts/check-register.mjs --json       # one JSON blob for a test/CI
 *   node scripts/check-register.mjs --worst 20   # how many offenders to print
 *   node scripts/check-register.mjs --baseline   # the ratchet's failing-line list
 *   node scripts/check-register.mjs --syllables  # the syllable counter's own test
 *
 * `docs/naming.md` states the kid-clarity law in prose — "a 10-year-old reads it
 * once and knows what the thing is, what to do, and what just happened", one idea
 * per bubble, <= 2 sentences, no metaphor, no irony, and a list of words that are
 * simply gone. Prose cannot fail a build, so the law has been enforced by whoever
 * happened to be reviewing. This turns the measurable half of it into a number.
 *
 * It measures, per player-facing line of `src/data/dialogue.json` and per `text`
 * of `src/data/tutorial.json`:
 *
 *   length      <= DIALOGUE_MAX_CHARS      (read from Constants.ts, not retyped)
 *   sentences   <= MAX_SENTENCES           one idea per bubble
 *   words/sent  <= MAX_MEAN_WORDS
 *   FK grade    <= MAX_FK                  Flesch-Kincaid, LONG LINES ONLY
 *   banned word -> hard failure            list PARSED out of docs/naming.md
 *
 * The blacklist is parsed rather than copied so the doc stays the one place a
 * word is retired; if the parse yields nothing this script throws instead of
 * silently passing every line. For the same reason the corpus has a FLOOR
 * (`MIN_LINES`): a schema that moved under `collectLines` would otherwise hand
 * the report an empty corpus, and an empty corpus scores perfectly clean.
 *
 * Offenders are ranked by HOW BADLY a line breaks the law (`severity`), never by
 * how many rules it breaks: one line at five sentences is a bigger rewrite than
 * two rules each missed by a decimal.
 *
 * Exit code is 1 when any line fails, so this can front a unit test — but note
 * the thresholds are the OWNER'S numbers, not this script's. If shipped text
 * fails, the text moves or the owner moves the number; the script does not.
 * Shipped text DOES fail today, so the test that fronts this is a RATCHET:
 * `--baseline` emits the sorted, diffable list of failing lines to record as
 * the starting point, and the bar is that the list must not GROW. See
 * `baselineOf`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* ------------------------------------------------------------------ the bars */

/** The char cap already exists and is already tuned — take it, never restate it. */
export const DIALOGUE_MAX_CHARS = (() => {
  const m = read('src/core/Constants.ts').match(/export const DIALOGUE_MAX_CHARS\s*=\s*(\d+)/);
  if (!m) throw new Error('DIALOGUE_MAX_CHARS not found in src/core/Constants.ts');
  return Number(m[1]);
})();

export const MAX_SENTENCES = 2; // docs/naming.md §1.5 — one idea per bubble
export const MAX_MEAN_WORDS = 12;
export const MAX_FK = 5; // school grade; the audience is 8-13 and reads mid-sentence

/**
 * Below this many words a line gets NO Flesch-Kincaid grade at all.
 *
 * FK is fitted on running prose and its syllable term is 11.8 * syllables/words,
 * so in an n-word line ONE word carrying one extra syllable moves the grade by
 * 11.8/n. Under twelve words that single word moves it by more than a whole
 * school grade — more than the unit the score is reported in, and more than the
 * error bar on the syllable heuristic below, which is itself +/-1 on any given
 * word. "It's getting warmer!" scored 5.25 and led the offender list; there is
 * no reading age in a three-word cheer, only arithmetic. Twelve is where one
 * word stops being able to outvote the sentence.
 */
export const FK_MIN_WORDS = 12;

/**
 * A floor under the corpus. `collectLines` reads two SHAPES and a shape can
 * move: nest `steps` under a scripts container and `tutorial.steps ?? []`
 * quietly yields nothing; restructure dialogue.json and `walk` finds no strings.
 * Either way every rule passes, the exit code is 0 and the audit reports that
 * the text is perfect — the one failure mode that must never be silent. These
 * numbers sit far under the shipped 142/64: they catch a schema that moved, they
 * do not police how much text the game ships.
 */
export const MIN_LINES = { 'dialogue.json': 80, 'tutorial.json': 30 };

/** docs/naming.md §1.4 retires words; it has never un-retired one. */
export const MIN_BANNED_WORDS = 15;

/**
 * The retired words, parsed out of docs/naming.md's fourth law ("No word a
 * 10-year-old stumbles on. Gone: …").
 *
 * The list runs to the END OF ITS NUMBERED ITEM, not to the first "(": the
 * parentheses in that law are GLOSSES on a word ("ledger (in speech — the
 * panel's own tab says …)"), and stopping at one dropped every word after it
 * without a word of complaint. Gloss the third word tomorrow and seventeen
 * retired words would go quietly back into circulation, so the asides are cut
 * out and the list is read whole.
 */
export function bannedWords(doc = read('docs/naming.md')) {
  const law = doc.match(
    /No word a 10-year-old stumbles on\.\*\*\s*Gone:\s*([\s\S]*?)(?=\n\s*\n|\n\s*\d+\.\s|$)/u
  );
  if (!law) throw new Error('docs/naming.md: the "Gone:" list of §1.4 no longer parses');
  const words = law[1]
    .replace(/\([^)]*\)/gu, ' ') // an aside SCOPES a word, it never adds one
    .replace(/\s+/gu, ' ')
    .split(',')
    .map((w) => w.trim().toLowerCase().replace(/^[^a-z]+|[^a-z-]+$/gu, ''))
    .filter((w) => /^[a-z][a-z-]*$/.test(w));
  if (words.length < MIN_BANNED_WORDS)
    throw new Error(
      `docs/naming.md: parsed only ${words.length} banned words (floor ${MIN_BANNED_WORDS}) — the LIST broke, not the text`
    );
  return words;
}

/* ------------------------------------------------------- what counts as a line */

/** Every string in a JSON tree, with the dotted path that names it. */
function walk(node, path, visit) {
  if (typeof node === 'string') visit(path, node);
  else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`, visit));
  else if (node && typeof node === 'object')
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, visit);
}

/** Speaker ids ("eleanor") are addressing, not speech — they are never read aloud. */
const NOT_SPOKEN = (path) => path === 'speaker' || path.endsWith('.speaker');

/**
 * Every line the player can read, with the floor from `MIN_LINES` enforced on
 * the way out. Both readers assert the SHAPE they assume before they walk it:
 * a collector that silently returns nothing is indistinguishable, downstream,
 * from text that has no faults, and the second reading is the one the report
 * would print.
 */
export function collectLines(
  dialogue = JSON.parse(read('src/data/dialogue.json')),
  tutorial = JSON.parse(read('src/data/tutorial.json'))
) {
  const lines = [];
  if (!dialogue || typeof dialogue !== 'object' || Array.isArray(dialogue))
    throw new Error('src/data/dialogue.json: expected an object of banks — the collector is reading a schema that moved');
  walk(dialogue, '', (path, text) => {
    if (!NOT_SPOKEN(path) && text.trim()) lines.push({ file: 'dialogue.json', id: path, text });
  });
  if (!Array.isArray(tutorial?.steps))
    throw new Error('src/data/tutorial.json: `steps` is no longer a top-level array — the collector is reading a schema that moved');
  for (const step of tutorial.steps) {
    if (typeof step.text === 'string' && step.text.trim())
      lines.push({ file: 'tutorial.json', id: step.id, text: step.text });
  }
  for (const [file, floor] of Object.entries(MIN_LINES)) {
    const n = lines.filter((l) => l.file === file).length;
    if (n < floor)
      throw new Error(
        `register audit: ${n} lines collected from ${file}, floor is ${floor} — the CORPUS broke, not the text; an empty corpus scores clean`
      );
  }
  return lines;
}

/* ------------------------------------------------------------------ the metric */

/**
 * Strip what is punctuation-of-presentation rather than language: the curly
 * quotes a bubble is wrapped in, and the trailing "— Eleanor" attribution that
 * the order-complete bank carries. Both are rendered (so they count against the
 * CHARACTER budget, which is about how tall the card grows) but neither is a
 * clause, so leaving them in would inflate the sentence and word counts.
 */
function speech(text) {
  return text
    .replace(/\s*[—–-]\s*(Eleanor|Selyna|the Golden Elder|Keeper)\s*$/u, '')
    .replace(/[“”"„]/gu, '')
    .trim();
}

const ELLIPSIS = '\u0001';
const ABBREV = '\u0002';
/** Abbreviations whose period is not a full stop. Small on purpose: this text has few. */
const ABBREVIATIONS = /\b(Mr|Mrs|Ms|Dr|St|Prof|vs|etc|e\.g|i\.e)\./giu;

/**
 * Sentences, by terminator. `…` and `...` are a held breath, not a stop — the
 * Golden Elder's lines are full of them and each one would otherwise read as an
 * extra sentence and drag the mean words-per-sentence DOWN, hiding a long line.
 */
export function sentencesOf(text) {
  const held = speech(text)
    .replace(/\.\.\.|…/gu, ELLIPSIS)
    .replace(ABBREVIATIONS, (m) => m.replace('.', ABBREV));
  return held
    .split(/[.!?]+(?:\s+|$)/u)
    .map((s) => s.replace(new RegExp(`[${ELLIPSIS}]`, 'gu'), '…').replace(new RegExp(ABBREV, 'gu'), '.').trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

export function wordsOf(text) {
  return (speech(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).map((w) => w.toLowerCase());
}

/* ---------------------------------------------------------------- syllables */

/**
 * The consonant-initial second elements our words are built with. A stem keeps
 * its silent 'e' INTO the compound — home|less, life|time, some|thing, care|ful,
 * rune|vault — and a vowel-run count reads that 'e' as a syllable no mouth says.
 *
 * It is a LIST and not a rule because there is no rule: "care|ful" and
 * "for|ever" are the same five letters in the same order (vowel, consonant, e,
 * consonant, vowel), so every general pattern that silences the first also
 * silences the second and turns a three-syllable word into two. Naming the
 * boundaries we actually use is the honest version. Add to it as the text grows.
 */
const SILENT_E_SUFFIX =
  /([aeiouy][^aeiouy])e(?=less|ness|ful|ly|ment|time|thing|body|where|wise|like|ship|hood|some|work|land|light|line|mate|vault|keep)/gu;

/**
 * ev(e)ry, sev(e)ral, deliv(e)ry: an unstressed 'e' between a consonant and an
 * r that OPENS the next syllable is elided in speech. Both guards earn their
 * keep — the leading vowel keeps it off word-initial "very" (2, not 1), and
 * requiring a vowel after the r keeps it off "forever" (3, not 2), whose own r
 * closes the word.
 */
const ELIDED_ERY = /([aeiouy][^aeiouy])e(?=r[aeiouy])/gu;

/**
 * "-es" is a syllable you SAY when it lands on a sibilant, and English spells
 * that sibilant six ways: s/ss, x, z, ch, sh, and the soft c/g that only ever
 * go soft in front of this very e. chang|es, ag|es, fac|es, plac|es, hous|es,
 * match|es, bush|es, box|es. The leading vowel is a guard, not decoration: it
 * keeps the stem from being emptied out ("yes" is not a plural).
 */
const SPOKEN_ES = /[aeiouy][a-z]*(?:s|x|z|ch|sh|c|g)es$/u;

/** "-ed" is a syllable only after d or t: need|ed, start|ed, land|ed. */
const SPOKEN_ED = /[aeiouy][a-z]*[dt]ed$/u;
/** Everywhere else it is silent — call|ed, roll|ed, work|ed, notic|ed. */
const SILENT_ED = /[aeiouy][a-z]*[^aeiouy]ed$/u;

/** Syllabic l: litt|le, cast|le, peop|le. Consonant + le, and the l IS the beat. */
const SYLLABIC_LE = /[^aeiouy]le$/u;
/** The silent final e, with a vowel left behind it so "the" and "he" survive. */
const SILENT_E = /[aeiouy][a-z]*[^aeiouy]e$/u;

/**
 * Two vowels that touch on the page but not in the mouth — each read one
 * syllable LOW by a vowel-run count. Only the two shapes this vocabulary
 * actually contains are encoded; a hiatus rule invented for words the game does
 * not say is a rule nobody can test.
 *
 *   be|ing, go|ing, try|ing, say|ing — a vowel immediately before "-ing"
 *   l|ion, guard|ian, av|iation      — i + a/o/u, except where the preceding
 *                                      letter makes it a single sound
 *                                      (na|tion, spe|cial, reg|ion, ver|sion)
 */
const HIATUS = [/[aeiouy]ing$/gu, /[^cgstx]i[aou]/gu];

/**
 * Words English does not spell the way it says them. Every entry is a rule that
 * failed, so the map is kept SHORT and only holds words the corpus (or its near
 * neighbourhood) actually contains — a dictionary is not a counter.
 */
const IRREGULAR = new Map(
  Object.entries({
    // -ed that is spoken after a non-d/t consonant. There are about a dozen in
    // English and these are the ones a children's game can plausibly reach.
    aged: 2,
    blessed: 2,
    learned: 2,
    naked: 2,
    sacred: 2,
    wicked: 2,
    // -le after a consonant that is NOT syllabic.
    isle: 1,
    aisle: 1,
    // qu + a genuine two-vowel run.
    quiet: 2,
    quietly: 3,
    // silent-e compounds whose second element starts with a vowel.
    someone: 2,
    // -ed that is not an inflection at all.
    hundred: 2,
    hundreds: 2,
    // A borrowed final -e that IS spoken. English has a handful (recipe,
    // simile, epitome) and no spelling tells them from "ripe".
    recipe: 3,
    recipes: 3,
  })
);

/** English names for the numerals a bubble can hold; "60" is read, not skipped. */
const NUMBER_SYLLABLES = {
  ones: [2, 1, 1, 1, 1, 1, 1, 2, 1, 1], // zero one two three four five six seven eight nine
  teens: [1, 3, 1, 2, 2, 2, 2, 3, 2, 2], // ten … nineteen
  tens: [2, 2, 2, 2, 2, 3, 2, 2], // twenty thirty forty fifty sixty seventy eighty ninety
};

/**
 * A numeral is a WORD the reader says out loud, so it has to carry syllables:
 * scoring "12th" as zero pulled the whole line's syllables-per-word down and
 * made a line with numbers in it look easier than it reads. Above 99 we name it
 * digit by digit, which is what the number-heavy lines here ("Every 12th time")
 * never reach anyway.
 */
function numeralSyllables(digits) {
  const n = Number(digits);
  if (!Number.isFinite(n) || n > 99) return [...digits].reduce((s, d) => s + NUMBER_SYLLABLES.ones[Number(d)], 0);
  if (n < 10) return NUMBER_SYLLABLES.ones[n];
  if (n < 20) return NUMBER_SYLLABLES.teens[n - 10];
  const tens = NUMBER_SYLLABLES.tens[Math.floor(n / 10) - 2];
  return n % 10 === 0 ? tens : tens + NUMBER_SYLLABLES.ones[n % 10];
}

/**
 * Syllables, counted the way the problem is actually shaped: VOWEL GROUPS first,
 * then the short list of corrections English needs on top of them — silent
 * final -e, the syllabic -le, -ed after a non-d/t consonant, -es after a
 * sibilant, the silent e inside a compound, and the two vowels that touch on the
 * page but not in the mouth.
 *
 * Each correction is applied to the STEM and the syllable it adds or removes is
 * carried in `extra`, so the corrections cannot fight each other the way a chain
 * of in-place string rewrites did. That fight is what the old counter lost
 * twice: its -ed rule excluded `l` to protect the "-le" words, so
 * called/rolled/filled/pulled/healed all scored one HIGH, and it had no -es rule
 * at all, so changes/ages/faces/places all scored one LOW.
 *
 * IT IS STILL A HEURISTIC — see the hand-scored table in `SYLLABLE_CASES` and
 * `node scripts/check-register.mjs --syllables` for exactly how right it is on
 * this game's own vocabulary. Treat the FK grade as a REGRESSION BARRIER, never
 * as an oracle for one sentence, and never rewrite a good line to chase a
 * decimal.
 */
export function syllablesOf(word) {
  const token = word.toLowerCase();
  // A hyphen joins two words and each keeps its own beats: sun-lit is two.
  if (token.includes('-')) return token.split('-').reduce((s, part) => s + syllablesOf(part), 0);
  if (/^[0-9]+/u.test(token)) return numeralSyllables(token.match(/^[0-9]+/u)[0]);

  const raw = token.replace(/[^a-z]/gu, '');
  if (!raw) return 0;
  if (IRREGULAR.has(raw)) return IRREGULAR.get(raw);

  let w = raw.replace(SILENT_E_SUFFIX, '$1').replace(ELIDED_ERY, '$1');
  let extra = 0;

  // -- outermost inflection: -es / -s -----------------------------------------
  if (SPOKEN_ES.test(w)) {
    w = w.slice(0, -2);
    extra += 1;
  } else if (/es$/u.test(w)) {
    w = w.slice(0, -1); // the s is silent; the e is left for the final-e rule
  } else if (/[aeiouy][a-z]*[^s]s$/u.test(w)) {
    w = w.slice(0, -1);
  }

  // -- -ed --------------------------------------------------------------------
  if (SPOKEN_ED.test(w)) {
    w = w.slice(0, -2);
    extra += 1;
  } else if (SILENT_ED.test(w)) {
    w = w.slice(0, -2);
  }

  // -- final -e ---------------------------------------------------------------
  if (!SYLLABIC_LE.test(w) && SILENT_E.test(w)) w = w.slice(0, -1);

  const groups = w.match(/[aeiouy]+/gu);
  const hiatus = HIATUS.reduce((n, re) => n + (w.match(re)?.length ?? 0), 0);
  return Math.max(1, (groups ? groups.length : 0) + extra + hiatus);
}

/**
 * THE COUNTER'S OWN TEST, hand-scored, and drawn from this game's vocabulary so
 * it is tested on the words it actually scores. Every line here is a word some
 * bubble says (plus the handful the reviewers named), with the number of beats
 * a mouth gives it — not the number a rule wishes it had.
 *
 * Run it with `node scripts/check-register.mjs --syllables`. It is the reason
 * the FK column can be quoted at all. On these 105 words a bare vowel-run count
 * is wrong 48 times and the earlier patched-up counter 24 times; this one is
 * wrong 0. A counter nobody has scored against answers is not a measurement,
 * and until the answers exist there is no way to tell which of the three you
 * are running.
 *
 * Words honest speakers disagree about (usually, family, fire — one beat or
 * two) are deliberately ABSENT: a case that asserts one side of a real
 * ambiguity tests the author, not the counter.
 *
 * Add a word here the moment the counter is wrong about it — the fix and the
 * case go in together, or the next rewrite silently un-fixes it.
 */
export const SYLLABLE_CASES = {
  // --- silent final -e ---------------------------------------------------
  make: 1, here: 1, whole: 1, close: 1, place: 1, notice: 2, inside: 2, welcome: 2,
  // --- syllabic -le: the l IS the beat ------------------------------------
  little: 2, castle: 2, people: 2, bottle: 2, single: 2, circle: 2,
  // --- -ed after a non-d/t consonant is SILENT ----------------------------
  called: 1, rolled: 1, filled: 1, pulled: 1, cooled: 1, healed: 1, sealed: 1,
  worked: 1, cared: 1, touched: 1, dropped: 1, stayed: 1, tried: 1,
  noticed: 2, opened: 2, appeared: 2, carried: 2, wondered: 2,
  // --- -ed after d or t is SPOKEN -----------------------------------------
  waited: 2, landed: 2, needed: 2, decided: 3,
  // --- -es after a sibilant is SPOKEN -------------------------------------
  changes: 2, ages: 2, faces: 2, places: 2, houses: 2, watches: 2, catches: 2,
  bushes: 2, lenses: 2, rises: 2, uses: 2, washes: 2,
  // --- -es and -s that are not ---------------------------------------------
  makes: 1, gives: 1, lives: 1, eyes: 1, goes: 1, names: 1, scares: 1,
  shelves: 1, minutes: 2, stories: 2, berries: 2, dragons: 2, crystals: 2,
  // --- a stem keeps its silent e into a compound ---------------------------
  something: 2, careful: 2, useful: 2, heartbeat: 2, moonwater: 3, runevault: 2,
  // --- the unstressed e that r swallows ------------------------------------
  every: 2, everything: 3, very: 2, forever: 3, whatever: 3, wherever: 3,
  // --- vowels that touch on the page and not in the mouth -----------------
  being: 2, going: 2, doing: 2, saying: 2, trying: 2, iron: 2, emporium: 4,
  // --- numerals are words the reader says out loud -------------------------
  2: 1, 9: 1, '12th': 1, 60: 2,
  // --- the ones no rule reaches --------------------------------------------
  recipe: 3, someone: 2, quiet: 2, isle: 1,
  // --- plain longer words, as a spine --------------------------------------
  the: 1, she: 1, island: 2, aurora: 3, eleanor: 3, selyna: 3, together: 3,
  tomorrow: 3, already: 3, nobody: 3, important: 3, difference: 3,
  instructions: 3, favourite: 3, evolution: 4, decorations: 4, emberberries: 4,
};

/** The table, run. Returns every word the counter is wrong about. */
export function syllableMisses(cases = SYLLABLE_CASES, count = syllablesOf) {
  return Object.entries(cases)
    .map(([word, truth]) => ({ word, truth, got: count(word) }))
    .filter((c) => c.got !== c.truth);
}

/** Word-boundary match, tolerating a regular plural: "helm" flags "helms", not "helmet". */
function bannedIn(text, banned) {
  const hay = speech(text);
  return banned.filter((w) => new RegExp(`\\b${w}(?:e?s)?\\b`, 'iu').test(hay));
}

export function score(line, banned) {
  const sentences = sentencesOf(line.text);
  const words = wordsOf(line.text);
  const nS = Math.max(1, sentences.length);
  const nW = Math.max(1, words.length);
  const syllables = words.reduce((sum, w) => sum + syllablesOf(w), 0);
  const meanWords = words.length / nS;
  // The grade twice. `fkRaw` is the arithmetic run on every line; `fk` is the
  // one that JUDGES, and it is null — not a number — for a line too short to
  // carry the statistic, so an unscored line is visibly unscored everywhere
  // downstream: no failure, no percentile, no place in the ranking.
  //
  // Both are kept because the word floor and the syllable counter changed in
  // the same pass once and were reported as one number, which made neither
  // measurable. With `fkRaw` the report can say exactly how many failures the
  // floor removes, separately from how many the counter does.
  const fkRaw = Number((0.39 * meanWords + 11.8 * (syllables / nW) - 15.59).toFixed(2));
  const fk = words.length >= FK_MIN_WORDS ? fkRaw : null;
  const bans = bannedIn(line.text, banned);
  const fails = [];
  if (line.text.length > DIALOGUE_MAX_CHARS) fails.push('chars');
  if (sentences.length > MAX_SENTENCES) fails.push('sentences');
  if (meanWords > MAX_MEAN_WORDS) fails.push('meanWords');
  if (fk !== null && fk > MAX_FK) fails.push('fk');
  if (bans.length) fails.push('banned');
  const scored = {
    ...line,
    chars: line.text.length,
    sentences: sentences.length,
    words: words.length,
    meanWords: Number(meanWords.toFixed(2)),
    syllables,
    fk,
    fkRaw,
    banned: bans,
    fails,
  };
  return { ...scored, severity: Number(severityOf(scored).toFixed(3)) };
}

/**
 * HOW BADLY a line breaks the law, in one number: every broken bar's overshoot
 * as a fraction of the bar itself, added up. Counting broken RULES instead ranks
 * a line that misses two bars by a decimal above a line running five sentences
 * where two are allowed — and it is the five-sentence line that needs a writer.
 * A retired word is not a matter of degree, so each one costs a flat 1.
 */
export function severityOf(s) {
  const over = (value, bar) => (value > bar ? value / bar - 1 : 0);
  return (
    over(s.chars, DIALOGUE_MAX_CHARS) +
    over(s.sentences, MAX_SENTENCES) +
    over(s.meanWords, MAX_MEAN_WORDS) +
    (s.fk === null ? 0 : over(s.fk, MAX_FK)) +
    s.banned.length
  );
}

export function audit() {
  const banned = bannedWords();
  return collectLines().map((line) => score(line, banned));
}

/**
 * The RATCHET's baseline: one stable, sorted line per FAILING line — where it
 * lives, which line it is, and which bars it misses.
 *
 * Sorted and rule-bearing on purpose. The bar this audit measures is the real
 * one, and today's text does not clear it; the honest way to hold that is to
 * record what fails now and fail only when the list GROWS. A bare count would
 * let a fixed line pay for a broken one, so each entry carries its rules: a
 * line that starts failing a NEW rule shows up as a changed line in the diff
 * instead of hiding inside an unchanged total.
 */
export function baselineOf(scored = audit()) {
  return scored
    .filter((s) => s.fails.length)
    .map((s) => `${s.file} ${s.id} ${[...s.fails].sort().join(',')}`)
    .sort();
}

/* ------------------------------------------------------------------ the report */

/** The failure a WRITER can act on: which line, where it lives, and by how much. */
export function explain(s) {
  const why = s.fails
    .map((f) =>
      f === 'chars'
        ? `${s.chars} chars (max ${DIALOGUE_MAX_CHARS})`
        : f === 'sentences'
          ? `${s.sentences} sentences (max ${MAX_SENTENCES})`
          : f === 'meanWords'
            ? `${s.meanWords} words/sentence (max ${MAX_MEAN_WORDS})`
            : f === 'fk'
              ? `FK grade ${s.fk} (max ${MAX_FK}, over ${s.words} words)`
              : `banned word: ${s.banned.join(', ')}`
    )
    .join(' · ');
  return `${s.file} ${s.id} — ${why}\n    "${s.text}"`;
}

function percentiles(values) {
  const v = values.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  if (!v.length) return { p50: '-', p75: '-', p90: '-', p95: '-', max: '-' };
  const at = (p) => v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))];
  return { p50: at(50), p75: at(75), p90: at(90), p95: at(95), max: v[v.length - 1] };
}

function main() {
  const argv = process.argv.slice(2);
  const worstN = Number(argv[argv.indexOf('--worst') + 1]) || 12;

  // The counter's own test, before any corpus is read: if the syllable counter
  // is wrong, every FK number below it is a rumour.
  if (argv.includes('--syllables')) {
    const n = Object.keys(SYLLABLE_CASES).length;
    const miss = syllableMisses();
    console.log(
      `SYLLABLE COUNTER — ${n - miss.length}/${n} hand-scored words correct (${((100 * miss.length) / n).toFixed(1)}% wrong)`
    );
    for (const c of miss) console.log(`  ${String(c.word).padEnd(16)} counted ${c.got}, is ${c.truth}`);
    process.exitCode = miss.length ? 1 : 0;
    return;
  }

  const scored = audit();

  if (argv.includes('--baseline')) {
    // A dump, not a verdict — exit 0 even though every line printed is a failure.
    console.log(baselineOf(scored).join('\n'));
    return;
  }
  const failed = scored.filter((s) => s.fails.length);

  if (argv.includes('--json')) {
    // exitCode, never exit(): stdout down a PIPE is async, and exiting on the
    // same tick cut the blob off mid-string — the machine-readable half of this
    // audit was unparseable exactly where a test would read it.
    console.log(JSON.stringify({ scored, failed }, null, 2));
    process.exitCode = failed.length ? 1 : 0;
    return;
  }

  const banned = bannedWords();
  console.log(`REGISTER AUDIT — ${scored.length} player-facing lines`);
  console.log(`  dialogue.json ${scored.filter((s) => s.file === 'dialogue.json').length} · tutorial.json ${scored.filter((s) => s.file === 'tutorial.json').length}`);
  console.log(`  bars: chars<=${DIALOGUE_MAX_CHARS} sentences<=${MAX_SENTENCES} words/sentence<=${MAX_MEAN_WORDS} FK<=${MAX_FK} (FK only on lines of ${FK_MIN_WORDS}+ words)`);
  console.log(`  banned (${banned.length} from docs/naming.md): ${banned.join(', ')}\n`);

  // FK's denominator is the lines it was ALLOWED to score, never the whole
  // corpus — a rule that declines to judge 53 lines has not passed them.
  const fkScored = scored.filter((s) => s.fk !== null).length;
  for (const rule of ['chars', 'sentences', 'meanWords', 'fk', 'banned']) {
    const n = scored.filter((s) => s.fails.includes(rule)).length;
    const of = rule === 'fk' ? fkScored : scored.length;
    const note = rule === 'fk' ? ` of ${fkScored} scored, ${scored.length - fkScored} too short to score` : '';
    console.log(`  ${rule.padEnd(10)} ${String(n).padStart(4)} fail  (${((100 * n) / of).toFixed(1)}%${note})`);
  }
  // What the WORD FLOOR costs, alone. The floor and the syllable counter were
  // once changed together and quoted as one drop, so neither could be checked.
  const fkFail = scored.filter((s) => s.fails.includes('fk')).length;
  const fkNoFloor = scored.filter((s) => s.fkRaw > MAX_FK).length;
  console.log(
    `             the same counter with NO ${FK_MIN_WORDS}-word floor fails ${fkNoFloor} of ${scored.length} lines — the floor removes ${fkNoFloor - fkFail}`
  );

  console.log('');
  for (const [name, key] of [['chars', 'chars'], ['sentences', 'sentences'], ['words/sent', 'meanWords'], ['FK grade', 'fk']]) {
    const p = percentiles(scored.map((s) => s[key]));
    console.log(`  ${name.padEnd(11)} p50 ${String(p.p50).padStart(6)}  p75 ${String(p.p75).padStart(6)}  p90 ${String(p.p90).padStart(6)}  p95 ${String(p.p95).padStart(6)}  max ${String(p.max).padStart(6)}`);
  }

  // The shape of the sentence rule's evidence: whether 3 is the whole story or
  // there is a tail of 4s and 5s changes what the owner is deciding about.
  console.log('\n  sentences per line');
  const counts = scored.map((s) => s.sentences);
  for (let n = 1; n <= Math.max(...counts); n++) {
    const c = counts.filter((x) => x === n).length;
    const flag = n > MAX_SENTENCES ? ' over' : '     ';
    console.log(`  ${String(n)} ${flag} ${String(c).padStart(4)}  ${((100 * c) / scored.length).toFixed(1).padStart(5)}%  ${'#'.repeat(Math.round((60 * c) / scored.length))}`);
  }

  // The offender list below is severity-ranked, and severity is DOMINATED by
  // the sentence rule: a third sentence is +50% of its bar, while an FK grade of
  // 5.62 is +12% of its own. That is the right ranking for "what needs a writer
  // first" and the wrong one for "does this rule have evidence" — 18 lines tie at
  // or above 1.00, so a rule with four real failures sits below any sane cut.
  // One line per rule, so no rule's evidence needs `--worst 100` to be seen.
  console.log('\n  worst line per rule');
  for (const [rule, key] of [['chars', 'chars'], ['sentences', 'sentences'], ['meanWords', 'meanWords'], ['fk', 'fk'], ['banned', 'banned']]) {
    const hits = scored.filter((s) => s.fails.includes(rule));
    if (!hits.length) {
      console.log(`  ${rule.padEnd(10)} —`);
      continue;
    }
    const top = [...hits].sort((a, b) => (key === 'banned' ? b.banned.length - a.banned.length : b[key] - a[key]))[0];
    console.log(`  ${rule.padEnd(10)} ${hits.length} line${hits.length === 1 ? '' : 's'} · worst ${top.file} ${top.id}`);
  }

  console.log(`\n${failed.length} of ${scored.length} lines fail at least one rule (${((100 * failed.length) / scored.length).toFixed(1)}%)`);
  // Worst = furthest over the bar, not most bars grazed. See `severityOf`.
  const worst = [...failed]
    .sort((a, b) => b.severity - a.severity || b.fails.length - a.fails.length || a.id.localeCompare(b.id))
    .slice(0, worstN);
  for (const s of worst) console.log(`\n  [${s.severity.toFixed(2)}] ${explain(s)}`);
  process.exitCode = failed.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
