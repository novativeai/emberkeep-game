/**
 * `pnpm quests` — prove the quest ladder is playable, without launching the game.
 *
 * Simulates the whole scripted tutorial beat by beat, then walks every quest and
 * subquest in `src/data/quests.json` and prints, for each thing it asks the
 * player for, exactly how that thing can be got at that exact point: which
 * generator makes it, which region reveals it, which merge builds it — or why it
 * can never be had. Exits non-zero on any error, so it is usable as a gate.
 *
 *   pnpm quests            the world the tutorial teaches
 *   pnpm quests --all      EVERY world this build can run, each as its own
 *                          supply graph — how a world gets checked BEFORE it ships
 *   pnpm quests --brief    findings only
 *   pnpm quests --items    add the per-piece availability table
 *
 * The same functions back `tests/unit/QuestAvailability.spec.ts`, so a data edit
 * that breaks reachability fails `pnpm verify` whether or not anyone runs this.
 */
import {
  auditWorlds,
  pieceKey,
  type AuditData,
  type Finding,
  type WorldLadderAudit
} from '../src/core/availability';
import { ZONES } from '../src/core/world';
import cauldron from '../src/data/cauldron.json';
import chains from '../src/data/chains.json';
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

const base = { chains, orders, tasks, tutorial, quests, cauldron } as unknown as Omit<
  AuditData,
  'worldId' | 'map'
>;
const brief = process.argv.includes('--brief');
const showItems = process.argv.includes('--items');
const all = process.argv.includes('--all');

const worlds: WorldLadderAudit[] = auditWorlds(
  base,
  map as unknown as AuditData['map'],
  all ? ZONES.worlds : ZONES.worlds.filter((w) => w.extendsAuthoredMap)
);

const mark = (f: Finding): string =>
  f.severity === 'error'
    ? `${C.red}✗${C.reset}`
    : f.severity === 'warning'
      ? `${C.yellow}!${C.reset}`
      : `${C.cyan}i${C.reset}`;

for (const world of worlds) {
  const { audit } = world;
  console.log(
    `\n${C.bold}══ ${world.name} ${C.dim}(${world.worldId} · ${world.cells} cells · ` +
      `${world.questCount} quest${world.questCount === 1 ? '' : 's'})${C.reset}`
  );

  if (!brief && audit.beats.length > 0) {
    console.log(`\n${C.bold}── The tutorial, simulated ──${C.reset}`);
    for (const beat of audit.beats) {
      const actions = beat.actions.length ? beat.actions.join(' · ') : `${C.dim}—${C.reset}`;
      console.log(
        `${String(beat.index).padStart(2)} ${C.bold}${beat.stepId.padEnd(20)}${C.reset} ` +
          `${C.dim}L${beat.level} ${String(beat.xp).padStart(3)}xp${C.reset}  ${actions}`
      );
      for (const f of beat.findings) console.log(`     ${mark(f)} ${f.message}`);
    }
  }

  if (!brief) {
    console.log(`\n${C.bold}── The quest ladder ──${C.reset}`);
    if (audit.steps.length === 0) {
      console.log(`  ${C.dim}no quests are tracked in this world yet${C.reset}`);
    }
    let quest = '';
    for (const step of audit.steps) {
      if (step.questId !== quest) {
        quest = step.questId;
        console.log(
          `\n${C.cyan}${C.bold}${step.questTitle}${C.reset} ${C.dim}(${step.questId} · Keeper Level ${step.level} · ${step.regions.length} regions open)${C.reset}`
        );
      }
      console.log(`  ${C.bold}${step.label}${C.reset} ${C.dim}[${step.stepId}]${C.reset}`);
      if (step.needs.length === 0) {
        console.log(`     ${C.dim}no merge pieces — a counter, a level or a fog lift${C.reset}`);
      }
      for (const need of step.needs) {
        const badge =
          need.verdict === 'renewable'
            ? `${C.green}RENEWABLE${C.reset}`
            : need.verdict === 'finite-ok'
              ? `${C.yellow}FINITE ${need.availability.maxEver}${C.reset}`
              : need.verdict === 'finite-short'
                ? `${C.red}SHORT ${need.availability.maxEver}${C.reset}`
                : `${C.red}UNREACHABLE${C.reset}`;
        const how =
          need.availability.sources.map((s) => s.detail).join('; ') ||
          need.availability.blockedBy ||
          'no source';
        console.log(
          `     ${badge}  ${need.requirement.count} × ${need.availability.name} ` +
            `${C.dim}(${pieceKey(need.requirement.chain, need.requirement.tier)}) ← ${how}${C.reset}`
        );
      }
    }
  }

  if (showItems) {
    console.log(`\n${C.bold}── Every piece, at the end of the ladder ──${C.reset}`);
    const rows = [...audit.finalAvailability.values()].sort((a, b) =>
      a.chain === b.chain ? a.tier - b.tier : a.chain.localeCompare(b.chain)
    );
    for (const row of rows) {
      const state = !row.reachable
        ? `${C.red}unreachable${C.reset}`
        : row.renewable
          ? `${C.green}renewable ${C.reset}`
          : `${C.yellow}finite ${String(row.maxEver).padEnd(3)}${C.reset}`;
      const how = row.reachable
        ? row.sources.map((s) => s.detail).join('; ')
        : (row.blockedBy ?? '');
      console.log(
        `  ${state} ${pieceKey(row.chain, row.tier).padEnd(18)} ${row.name.padEnd(24)} ${C.dim}${how}${C.reset}`
      );
    }
  }
}

/* ---- verdict, across every world audited ---- */

const findings = worlds.flatMap((w) => w.audit.findings.map((f) => ({ world: w.worldId, f })));
const errors = findings.filter((x) => x.f.severity === 'error');
const warnings = findings.filter((x) => x.f.severity === 'warning');

console.log(`\n${C.bold}── Verdict ──${C.reset}`);
for (const { world, f } of [...errors, ...warnings]) {
  console.log(`  ${mark(f)} ${C.dim}${world} · ${f.at}${C.reset} — ${f.message}`);
}
console.log(
  errors.length === 0
    ? `  ${C.green}${C.bold}Every subquest is satisfiable at the point it is asked.${C.reset} ` +
        `${C.dim}${worlds.length} world(s), ${warnings.length} warning(s).${C.reset}\n`
    : `  ${C.red}${C.bold}${errors.length} blocking finding(s).${C.reset} ` +
        `${C.dim}${worlds.length} world(s), ${warnings.length} warning(s).${C.reset}\n`
);

process.exit(errors.length === 0 ? 0 : 1);
