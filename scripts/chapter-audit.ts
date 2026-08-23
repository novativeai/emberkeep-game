/**
 * `pnpm chapters` — prove the campaign's chapter ladder is climbable, without
 * launching the game.
 *
 * Walks ONE deterministic campaign timeline — the scripted tutorial beat by
 * beat, then every quest in a cheapest-first topological order, the Ledger
 * emptied and then re-run as endless encores, days crossing so trust can climb,
 * dragons named only where a `nameDragon` effect exists, forms revealed as they
 * are first produced, worlds opening only when `worldGates` says they do — and
 * at every milestone asks every chapter gate's REAL `met`, imported from
 * StorySystem itself.
 *
 * It then reports the four things a single gate's source can never show:
 *
 *   CONSECUTIVE  a gate above a gap is dead code — `evaluate` only ever looks
 *                up `storyChapter + 1`, so one hole stalls everything above it
 *   REACHABLE    the condition is true SOMEWHERE on the timeline
 *   ORDER        no gate is true before the chapter below it
 *   BEATS        every gate has an authored dialogue bank (no beats, no chapter)
 *
 *   pnpm chapters            the ladder, the verdict, and the gates' timeline
 *   pnpm chapters --timeline the whole walk, milestone by milestone
 *   pnpm chapters --brief    the verdict only
 *
 * The same functions back `tests/unit/ChapterLadder.spec.ts`, so a gate landed
 * ahead of its dialogue, its systems or its rung below fails `pnpm verify`
 * whether or not anyone runs this. Exits non-zero on any error.
 */
import { auditCampaign, ENCORE_DELIVERIES, type CampaignData } from '../src/core/campaign';
import type { AuditData, Finding } from '../src/core/availability';
import { LAST_CHAPTER } from '../src/systems/StorySystem';
import { ZONES } from '../src/core/world';
import cauldron from '../src/data/cauldron.json';
import chains from '../src/data/chains.json';
import dialogue from '../src/data/dialogue.json';
import map from '../src/data/map.json';
import orders from '../src/data/orders.json';
import quests from '../src/data/quests.json';
import tasks from '../src/data/tasks.json';
import tutorial from '../src/data/tutorial.json';

const C = {
  reset: '[0m',
  dim: '[2m',
  bold: '[1m',
  red: '[31m',
  yellow: '[33m',
  green: '[32m',
  cyan: '[36m'
};

const data: CampaignData = {
  base: { chains, orders, tasks, tutorial, quests, cauldron } as unknown as CampaignData['base'],
  map: map as unknown as AuditData['map'],
  worlds: ZONES.worlds,
  dialogue: dialogue as unknown as CampaignData['dialogue']
};

const brief = process.argv.includes('--brief');
const showTimeline = process.argv.includes('--timeline');

const audit = auditCampaign(data);

const mark = (f: Finding): string =>
  f.severity === 'error'
    ? `${C.red}✗${C.reset}`
    : f.severity === 'warning'
      ? `${C.yellow}!${C.reset}`
      : `${C.cyan}i${C.reset}`;

if (showTimeline) {
  console.log(`\n${C.bold}── The campaign, simulated ──${C.reset}`);
  for (const m of audit.timeline) {
    console.log(
      `${String(m.index).padStart(3)} ${C.bold}${m.at.padEnd(28)}${C.reset} ` +
        `${C.dim}L${m.facts.level} ${String(m.facts.completedOrderIds.length).padStart(2)} orders${C.reset}  ${m.label}`
    );
  }
}

if (!brief) {
  console.log(`\n${C.bold}══ The chapter ladder ${C.dim}(${audit.timeline.length} milestones walked)${C.reset}`);
  for (const g of audit.gates) {
    const where = g.firstHold
      ? `${C.green}holds at${C.reset} ${g.firstHold.at} ${C.dim}(#${g.firstHold.index})${C.reset}`
      : `${C.red}never holds${C.reset}`;
    const climbed = g.entered
      ? `${C.green}entered${C.reset} ${C.dim}at ${g.entered.at}${C.reset}`
      : `${C.red}never entered${C.reset}`;
    console.log(
      `  ${C.bold}Chapter ${String(g.gate.chapter).padStart(2)}${C.reset} ` +
        `${C.dim}on '${g.gate.on}'${C.reset}  ${where}  →  ${climbed}  ` +
        (g.hasBeats ? `${C.dim}beats ✓${C.reset}` : `${C.red}NO BEATS${C.reset}`)
    );
  }
  const missing: number[] = [];
  for (let c = 2; c <= LAST_CHAPTER; c++) {
    if (!audit.gates.some((g) => g.gate.chapter === c)) missing.push(c);
  }
  if (missing.length) {
    console.log(
      `\n  ${C.dim}ungated: ${missing.join(', ')} — the campaign is written to ${LAST_CHAPTER} ` +
        `and honestly stops at ${audit.reachedChapter}.${C.reset}`
    );
  }
}

const errors = audit.findings.filter((f) => f.severity === 'error');
const warnings = audit.findings.filter((f) => f.severity === 'warning');

console.log(`\n${C.bold}── Verdict ──${C.reset}`);
for (const f of [...errors, ...warnings]) {
  console.log(`  ${mark(f)} ${C.dim}${f.at}${C.reset} — ${f.message}`);
}
console.log(
  errors.length === 0
    ? `  ${C.green}${C.bold}Every landed gate is consecutive, reachable, in order and spoken.${C.reset} ` +
        `${C.dim}${audit.gates.length} gate(s), reaching chapter ${audit.reachedChapter} of ${LAST_CHAPTER}; ` +
        `${audit.timeline.length} milestones, ${ENCORE_DELIVERIES} encores, ${warnings.length} warning(s).${C.reset}\n`
    : `  ${C.red}${C.bold}${errors.length} blocking finding(s).${C.reset} ` +
        `${C.dim}${audit.gates.length} gate(s), ${warnings.length} warning(s).${C.reset}\n`
);

process.exit(errors.length === 0 ? 0 : 1);
