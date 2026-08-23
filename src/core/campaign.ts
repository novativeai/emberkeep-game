import {
  auditLadder,
  mapForWorld,
  ordersIn,
  pieceKey,
  questsIn,
  simulateTutorial,
  TUTORIAL_WORLD,
  type AuditData,
  type Finding,
  type WorldModel
} from './availability';
import {
  DRAGON_DIET,
  DRAGON_REVEAL,
  LEVEL_XP,
  REGARD_HEARTS,
  REGARD_MAX_POINTS,
  REGARD_POINTS_PER_HEART,
  regardKey,
  TRUST_MAX,
  WORLD_ID
} from './Constants';
import { GameState } from './GameState';
import type { DialogueData, MapData, QuestConfig, QuestStepConfig } from './types';
import type { WorldSpec } from './world';
import { worldOpen } from './worldGates';
import { NAMED_DRAGONS_STAT, trustKey } from '../systems/DragonSystem';
import { revealKey } from '../systems/RevealSystem';
import {
  CHAPTER_GATES,
  LAST_CHAPTER,
  type CampaignFacts,
  type ChapterGate
} from '../systems/StorySystem';

/**
 * OFFLINE PROOF THAT THE CHAPTER LADDER IS CLIMBABLE.
 *
 * The sibling of `availability.ts`. That module answers "can the player GET the
 * thing this quest asks for"; this one answers the question one level up:
 *
 *   > Can the campaign actually reach chapter N — and does every rung below it
 *   > come first?
 *
 * It matters because of how `StorySystem.evaluate` works, and only because of
 * that. The ladder is STRICTLY SEQUENTIAL: it only ever looks up
 * `storyChapter + 1`. So a gate is not an independent switch — it is a link,
 * and four failure modes are invisible from inside one gate's own source:
 *
 *   • a GAP (nothing gates chapter 5) makes every gate above it dead code;
 *   • an UNREACHABLE condition (five Dragon Book entries in a chapter where
 *     three forms exist) stalls the whole ladder, not just its own chapter;
 *   • an OUT-OF-ORDER condition (chapter 6's gate true during the tutorial)
 *     means the player passes through chapter 6's beat as a formality, reading
 *     lines that presuppose chapter 5's reveal;
 *   • a gate with NO AUTHORED BEATS burns its chapter in silence — the pointer
 *     is persisted, so a chapter walked past can never be walked again.
 *
 * The method is one deterministic campaign TIMELINE. The tutorial is simulated
 * beat by beat (by `availability.simulateTutorial`, the same function that
 * proves the quest ladder — the two audits can never disagree about what the
 * scripted lesson leaves behind), then the quests are walked in a cheapest-first
 * topological order, the Ledger is emptied and then re-run as endless encores,
 * days cross so trust can climb, dragons are named only where a `nameDragon`
 * effect actually exists, forms are revealed as they are first produced, and
 * worlds open only when `worldGates` says they do. At every milestone every
 * gate's REAL `met` — imported from StorySystem, never restated here — is asked,
 * and the first milestone at which it holds is recorded.
 *
 * Nothing here reads the DOM, Phaser or a save, so the unit suite runs it on
 * every build (`tests/unit/ChapterLadder.spec.ts`) and `pnpm chapters` prints
 * it. Importing StorySystem from `core/` is deliberate and is the whole point:
 * an audit that kept its own copy of the gates would pass while the game hung.
 */

/**
 * How many Ledger ENCORES the timeline plays out.
 *
 * The encore queue is endless by construction (`OrderSystem.encoreId`), so
 * `completedOrderIds.length` has no ceiling and a finite walk can only ever
 * demonstrate a prefix of it. Twelve is well past any authored gate and keeps
 * the printed timeline readable; a gate that needs more orders than this is
 * reported as "needs more Ledger encores than the audit walks" rather than as
 * unreachable, because the difference is real.
 */
export const ENCORE_DELIVERIES = 12;

/** One point on the campaign timeline: a thing the player did, and every
 *  campaign fact that was true immediately after they did it. */
export interface Milestone {
  index: number;
  /** Stable id — `tutorial:name_choose`, `quest:rekindle_brazier`, `day:3`. */
  at: string;
  /** What the player just did, in words. */
  label: string;
  facts: CampaignFacts;
}

export interface GateAudit {
  gate: ChapterGate;
  /**
   * The first milestone at which this gate's `met` holds, asked ON ITS OWN —
   * as if the player had just entered the chapter below it. Independent of the
   * ladder, which is what makes an ORDER violation visible: a chapter 6 gate
   * whose `firstHold` precedes chapter 5's is out of order even though the
   * sequential ladder would never let it fire early.
   */
  firstHold: Milestone | null;
  /** The milestone at which the SEQUENTIAL ladder actually enters the chapter —
   *  `evaluate`'s own behaviour, beats requirement included. */
  entered: Milestone | null;
  /** Does dialogue.json have lines for this chapter? */
  hasBeats: boolean;
}

export interface CampaignAudit {
  timeline: Milestone[];
  gates: GateAudit[];
  findings: Finding[];
  /** The highest chapter the ladder can actually reach on this timeline. */
  reachedChapter: number;
}

/** Everything the audit reads. The same JSON the game boots from. */
export interface CampaignData {
  /** The shared half of an `AuditData`, minus the per-world fields. */
  base: Omit<AuditData, 'worldId' | 'map'>;
  /** The authored map — every world's board is derived from it. */
  map: MapData;
  /** Every world this build can run. */
  worlds: readonly WorldSpec[];
  dialogue: DialogueData;
}

/* ------------------------------------------------------------------ */
/* Facts                                                                */
/* ------------------------------------------------------------------ */

/**
 * A frozen copy of the campaign facts as they stand.
 *
 * `storyChapter` is deliberately NOT part of the walk: the timeline records what
 * the WORLD made true, and where the ladder had got to by then is the question
 * being asked, not an input to it. Each gate is instead asked with the chapter
 * below it in hand (`asChapter`), and the sequential climb is simulated
 * separately in `climb`.
 */
function snapshot(state: GameState): CampaignFacts {
  const stats = { ...state.stats };
  const orders = [...state.completedOrderIds];
  const { level, tutorialDone } = state;
  return {
    stat: (key: string) => stats[key] ?? 0,
    completedOrderIds: orders,
    level,
    tutorialDone,
    storyChapter: 1
  };
}

/** The same facts, seen from the chapter a gate is being asked about. */
const asChapter = (facts: CampaignFacts, chapter: number): CampaignFacts => ({
  stat: (key) => facts.stat(key),
  completedOrderIds: facts.completedOrderIds,
  level: facts.level,
  tutorialDone: facts.tutorialDone,
  storyChapter: chapter
});

/* ------------------------------------------------------------------ */
/* The timeline                                                         */
/* ------------------------------------------------------------------ */

/**
 * The walk's mutable state.
 *
 * A REAL `GameState`, not a hand-rolled bag of fields: it is the thing the gates
 * are typed against at runtime, its `level` derives from `xp` through the
 * shipped `LEVEL_XP`, and `worldGates.worldOpen` — the one rule that decides
 * which doors are walkable — can be asked directly instead of restated.
 */
class Walk {
  readonly state: GameState;
  readonly milestones: Milestone[] = [];
  readonly findings: Finding[] = [];
  /** Days crossed since the first dragon existed — the trust axis' clock. */
  private days = 0;
  private dragonExists = false;

  constructor(map: MapData) {
    this.state = new GameState(map);
  }

  mark(at: string, label: string): Milestone {
    const milestone: Milestone = {
      index: this.milestones.length,
      at,
      label,
      facts: snapshot(this.state)
    };
    this.milestones.push(milestone);
    return milestone;
  }

  finding(severity: Finding['severity'], at: string, message: string): void {
    this.findings.push({ severity, at, message });
  }

  /** A latch: written once, never taken away. */
  latch(key: string): void {
    if (this.state.stat(key) === 0) this.state.addStat(key, 1);
  }

  deliver(orderId: string): boolean {
    if (this.state.completedOrderIds.includes(orderId)) return false;
    this.state.completedOrderIds.push(orderId);
    return true;
  }

  /** A form the player has now seen for the first time (RevealSystem's latch). */
  reveal(chain: string, tier: number): void {
    if (!DRAGON_REVEAL[pieceKey(chain, tier)]) return;
    this.latch(revealKey(chain, tier));
    if (DRAGON_DIET[chain]) this.dragonExists = true;
  }

  /**
   * A day crosses. Trust rises at most once a day per dragon and never decays,
   * so the rungs latch one per crossing — and only once there is something alive
   * to feed. Modelled as one crossing per completed quest: the day axis and the
   * quest axis run in parallel for a player who plays daily, and a slower player
   * only reaches the same rung later, never a different one.
   */
  crossDay(): Milestone | null {
    if (!this.dragonExists || this.days >= TRUST_MAX) return null;
    this.days++;
    this.latch(trustKey(this.days));
    return this.mark(`day:${this.days}`, `a day passes — a fed dragon reaches trust ${this.days}`);
  }

  /** Every world whose door has just become walkable gets its arrival. */
  arrivals(dialogue: DialogueData, worlds: readonly WorldSpec[]): void {
    for (const spec of worlds) {
      const latch = `arrived:${spec.id}`;
      if (this.state.stat(latch) > 0) continue;
      if (!worldOpen(this.state, spec.id)) continue;
      if (spec.id === WORLD_ID) continue; // the Keeper starts here; no arrival
      this.latch(latch);
      const spoken = dialogue.arrivals?.[spec.id]?.lines.length ? '' : ' (no arrival lines authored)';
      this.mark(`arrival:${spec.id}`, `the Keeper stands in ${spec.name} for the first time${spoken}`);
    }
  }
}

/** The audit view of one world: the shared data, scoped to that board. */
function worldData(data: CampaignData, spec: WorldSpec): AuditData {
  return { ...data.base, worldId: spec.id, map: mapForWorld(spec, data.map) };
}

/**
 * Everything the simulated tutorial left behind, poured into the walk's state.
 *
 * Read off the SIMULATOR's world rather than off the script, so the two audits
 * agree by construction: if `simulateTutorial` says the scripted lesson never
 * managed to merge a dragon, no reveal is latched here either.
 */
function absorb(walk: Walk, world: WorldModel): void {
  if (world.xp > walk.state.xp) walk.state.xp = world.xp;
  for (const orderId of world.orders) walk.deliver(orderId);
  for (const key of world.supplied.keys()) {
    const [chain, tier] = key.split(':');
    if (chain && tier) walk.reveal(chain, Number(tier));
  }
}

/**
 * The scripted tutorial, beat by beat.
 *
 * Each beat re-runs `simulateTutorial` over the PREFIX of the script up to that
 * step. That is deliberately wasteful (the script is ~64 steps, so this is a few
 * thousand cheap step simulations) and it buys the one thing worth having: the
 * per-beat world comes out of the shipped simulator itself, with no second
 * reading of the tutorial's effects living here to drift from it.
 */
function walkTutorial(walk: Walk, data: AuditData): void {
  const steps = data.tutorial.steps;
  let named = 0;
  let fed = false;

  steps.forEach((step, i) => {
    const prefix: AuditData = {
      ...data,
      tutorial: { ...data.tutorial, steps: steps.slice(0, i + 1) }
    };
    const { world } = simulateTutorial(prefix);
    absorb(walk, world);

    // A naming happens where a `nameDragon` effect is, and nowhere else — the
    // only other route to `ui:name_dragon_requested` does not exist. Step 0's
    // effects never run (TutorialDirector.begin skips applyEffects), which is
    // exactly what the simulator models, so they cannot name anything either.
    for (const effect of i === 0 ? [] : (step.effects ?? [])) {
      if (!('nameDragon' in effect)) continue;
      const { chain, tier } = effect.nameDragon;
      if ((world.board.get(pieceKey(chain, tier)) ?? 0) <= 0) {
        walk.finding(
          'error',
          `tutorial:${step.id}`,
          `the nameDragon effect asks for an unnamed ${chain} T${tier}, but the board holds none at that beat — the prompt never opens and nothing is ever named`
        );
        continue;
      }
      named++;
      walk.state.addStat(NAMED_DRAGONS_STAT, 1);
    }

    // The tutorial feeds a dragon twice, but trust moves at most once a DAY and
    // the script's own clock does not credibly cross one, so the lesson is
    // worth exactly the first rung. Every rung above it is bought on the day
    // axis below — claiming less here is what keeps a trust gate from being
    // reported as opening earlier than it really can.
    const gate = step.gate;
    if (!fed && gate.type === 'event' && gate.event === 'dragon:fed') {
      fed = true;
      walk.latch(trustKey(1));
    }

    walk.state.tutorialDone = i === steps.length - 1;
    walk.mark(`tutorial:${step.id}`, step.id);
  });

  if (named === 0) {
    walk.finding(
      'warning',
      'tutorial',
      'nothing in the tutorial names a dragon — `dragons:named` stays at 0 for the whole campaign'
    );
  }
}

/** Every quest in the build, whichever world tracks it. */
function allQuests(data: CampaignData): Array<{ quest: QuestConfig; world: WorldSpec }> {
  const out: Array<{ quest: QuestConfig; world: WorldSpec }> = [];
  for (const spec of data.worlds) {
    for (const quest of questsIn(worldData(data, spec))) out.push({ quest, world: spec });
  }
  return out;
}

/** The Keeper Level a quest cannot start below — its steps' own gates. */
const questLevel = (quest: QuestConfig): number =>
  quest.steps.reduce((n, s) => Math.max(n, s.lockedUntil?.level ?? 0), 0);

/** Apply one quest step's effect on the campaign's facts. */
function applyStep(walk: Walk, step: QuestStepConfig, data: AuditData): void {
  walk.state.addStat(`q:${step.id}`, 1);
  const goal = step.goal;
  switch (goal.kind) {
    case 'order': {
      // A delivered order pays out; the Ledger's own XP is what carries the
      // ladder's level, so dropping it would report every level gate short.
      if (!walk.deliver(goal.orderId)) break;
      const order = data.orders.orders.find((o) => o.id === goal.orderId);
      walk.state.xp += order?.rewards.xp ?? 0;
      if (order?.rewards.spawn) walk.reveal(order.rewards.spawn.chain, order.rewards.spawn.tier);
      break;
    }
    case 'have':
      walk.reveal(goal.chain, goal.tier);
      break;
    case 'level': {
      // The step IS the level being reached. LEVEL_XP is the ceiling on what a
      // Keeper can rank to in this build, and a step asking past it is the quest
      // audit's finding, not this one's — but the fact stays honest here, so a
      // chapter gate reading `level >= 4` reads UNREACHABLE rather than opening
      // on a rank the XP table cannot mint.
      const want = LEVEL_XP[goal.level - 1];
      if (want === undefined) break;
      walk.state.xp = Math.max(walk.state.xp, want);
      break;
    }
    case 'regard':
      walk.state.stats[regardKey(goal.characterId)] = Math.max(
        walk.state.stat(regardKey(goal.characterId)),
        goal.hearts * REGARD_POINTS_PER_HEART
      );
      break;
    default:
      break;
  }
  for (const need of step.needs ?? []) walk.reveal(need.chain, need.tier);
}

/**
 * Every quest, cheapest first, in a legal order.
 *
 * "Legal" is three things at once: a quest locked behind another waits for its
 * `q:done:` latch, a quest tracked in another world waits for that world's door
 * (`worldGates.worldOpen` — the same rule WorldSystem walks the player through),
 * and a quest gated on a Keeper Level waits for the XP. "Cheapest" breaks the
 * remaining ties by authored chapter, then by level demand, then by file order,
 * so the walk is deterministic and reads like the ladder the designer wrote.
 */
function walkQuests(walk: Walk, data: CampaignData): void {
  const pending = allQuests(data);
  // Seeded from state, not from zero: the walk asks for quests more than once
  // (a door the Ledger opened can unlock a whole ladder), and a quest already
  // latched must not be walked twice.
  const done = new Set<string>(
    pending.filter(({ quest }) => walk.state.stat(`q:done:${quest.id}`) > 0).map(({ quest }) => quest.id)
  );

  for (;;) {
    const ready = pending.filter(({ quest, world }) => {
      if (done.has(quest.id)) return false;
      const lock = quest.lockedUntil?.quest;
      if (lock && walk.state.stat(`q:done:${lock}`) === 0) return false;
      if (world.id !== WORLD_ID && !worldOpen(walk.state, world.id)) return false;
      return walk.state.level >= (questLevel(quest) || 1);
    });
    if (ready.length === 0) break;

    ready.sort((a, b) => {
      if (a.quest.chapter !== b.quest.chapter) return a.quest.chapter - b.quest.chapter;
      const la = questLevel(a.quest);
      const lb = questLevel(b.quest);
      if (la !== lb) return la - lb;
      return pending.indexOf(a) - pending.indexOf(b);
    });

    const { quest, world } = ready[0]!;
    const scoped = worldData(data, world);
    for (const step of quest.steps) applyStep(walk, step, scoped);
    walk.state.xp += quest.rewards?.xp ?? 0;
    if (quest.rewards?.spawn) walk.reveal(quest.rewards.spawn.chain, quest.rewards.spawn.tier);
    walk.state.addStat(`q:done:${quest.id}`, 1);
    walk.state.addStat(`q:world:${quest.world ?? WORLD_ID}:done`, 1);
    done.add(quest.id);

    walk.mark(`quest:${quest.id}`, `${quest.title ?? quest.id} — done (${world.id})`);
    walk.crossDay();
    walk.arrivals(data.dialogue, data.worlds);
  }

  for (const { quest, world } of pending) {
    if (done.has(quest.id)) continue;
    const lock = quest.lockedUntil?.quest;
    const why =
      lock && !done.has(lock)
        ? `it waits on quest '${lock}', which the walk never reached`
        : world.id !== WORLD_ID && !worldOpen(walk.state, world.id)
          ? `the door to '${world.id}' never opens on this timeline`
          : `it needs Keeper Level ${questLevel(quest)} and the walk tops out at ${walk.state.level}`;
    walk.finding(
      'warning',
      `quest:${quest.id}`,
      `'${quest.title ?? quest.id}' is never reached — ${why}. Any chapter gate that reads it is unreachable too`
    );
  }
}

/** The Ledger: whatever the quests did not deliver, then the endless tail. */
function walkLedger(walk: Walk, data: CampaignData): void {
  for (const spec of data.worlds) {
    if (spec.id !== WORLD_ID && !worldOpen(walk.state, spec.id)) continue;
    const scoped = ordersIn(data.base.orders, spec.id);
    for (const order of scoped.orders) {
      if (!walk.deliver(order.id)) continue;
      walk.state.xp += order.rewards.xp ?? 0;
      if (order.rewards.spawn) walk.reveal(order.rewards.spawn.chain, order.rewards.spawn.tier);
      walk.mark(`order:${order.id}`, `delivered '${order.title ?? order.id}' (${spec.id})`);
    }
  }
  // The encore queue never runs out, so the walk plays a prefix of it: the
  // Ledger's tail is the one axis a player can always push further.
  for (let n = 1; n <= ENCORE_DELIVERIES; n++) {
    walk.deliver(`encore_${n}`);
    walk.mark(`encore:${n}`, `Ledger encore ${n} of an endless queue`);
  }
}

/**
 * The ceiling: everything a player can still reach by playing on.
 *
 * A gate that is false HERE is false forever, which is what makes "UNREACHABLE"
 * a statement rather than an impression. Reveals come from the quest audit's own
 * final availability per world (a form nothing can make is not revealed), trust
 * fills to `TRUST_MAX` because feeding is renewable, and regard fills for every
 * character who asks for anything because gifts are renewable too.
 */
function walkFreePlay(walk: Walk, data: CampaignData): void {
  for (const spec of data.worlds) {
    if (spec.id !== WORLD_ID && !worldOpen(walk.state, spec.id)) continue;
    const { finalAvailability } = auditLadder(worldData(data, spec));
    for (const key of Object.keys(DRAGON_REVEAL)) {
      const entry = finalAvailability.get(key);
      if (!entry?.reachable) continue;
      walk.reveal(entry.chain, entry.tier);
    }
  }
  for (let rung = 1; rung <= TRUST_MAX; rung++) walk.latch(trustKey(rung));
  for (const character of givers(data)) {
    walk.state.stats[regardKey(character)] = REGARD_MAX_POINTS;
  }
  walk.mark(
    'freeplay',
    `free play: every reachable dragon seen, trust ${TRUST_MAX}, ${REGARD_HEARTS} hearts everywhere`
  );
}

/** Everyone the game can hold a relationship with, per the authored data. */
function givers(data: CampaignData): Set<string> {
  const out = new Set<string>();
  for (const quest of data.base.quests.quests) out.add(quest.giver);
  for (const order of data.base.orders.orders) if (order.giver) out.add(order.giver);
  return out;
}

/* ------------------------------------------------------------------ */
/* The climb                                                            */
/* ------------------------------------------------------------------ */

/**
 * `StorySystem.evaluate`, replayed over the timeline.
 *
 * Sequential, one rung at a time, and it refuses a chapter with no authored
 * beats — the same three rules the running system keeps. What it does NOT model
 * is the bubble queue: a chapter that has to wait for the one below it to finish
 * speaking still enters at the same milestone, only seconds later, and seconds
 * are not what this audit is about.
 */
function climb(
  timeline: readonly Milestone[],
  gates: readonly ChapterGate[],
  hasBeats: (chapter: number) => boolean
): Map<number, Milestone> {
  const entered = new Map<number, Milestone>();
  let chapter = 1;
  for (const milestone of timeline) {
    if (!milestone.facts.tutorialDone) continue;
    for (;;) {
      const next = chapter + 1;
      if (next > LAST_CHAPTER) break;
      const gate = gates.find((g) => g.chapter === next);
      if (!gate) break;
      if (!gate.met(asChapter(milestone.facts, chapter))) break;
      if (!hasBeats(next)) break;
      chapter = next;
      entered.set(next, milestone);
    }
  }
  return entered;
}

/* ------------------------------------------------------------------ */
/* The audit                                                            */
/* ------------------------------------------------------------------ */

export function buildTimeline(data: CampaignData): { timeline: Milestone[]; findings: Finding[] } {
  const authored = data.worlds.find((w) => w.id === TUTORIAL_WORLD);
  if (!authored) throw new Error(`no world '${TUTORIAL_WORLD}' in zones.json — nothing teaches`);
  const walk = new Walk(data.map);
  walkTutorial(walk, worldData(data, authored));
  walk.arrivals(data.dialogue, data.worlds);
  walkQuests(walk, data);
  walkLedger(walk, data);
  walk.arrivals(data.dialogue, data.worlds);
  walkQuests(walk, data); // a door the Ledger opened may have unlocked a ladder
  walkFreePlay(walk, data);
  return { timeline: walk.milestones, findings: walk.findings };
}

/**
 * The four laws, judged against a timeline.
 *
 * Split out from `auditCampaign` so the gate list is an ARGUMENT: the shipped
 * ladder is what ships, and the unit suite can hold a deliberately broken ladder
 * against the same timeline to prove each law actually catches its own failure.
 * Building the timeline is the expensive half; judging it is free.
 */
export function judgeLadder(
  timeline: readonly Milestone[],
  gateList: readonly ChapterGate[],
  hasBeats: (chapter: number) => boolean
): Omit<CampaignAudit, 'timeline'> {
  const findings: Finding[] = [];
  const entered = climb(timeline, gateList, hasBeats);
  const gates: GateAudit[] = [...gateList]
    .sort((a, b) => a.chapter - b.chapter)
    .map((gate) => ({
      gate,
      firstHold:
        timeline.find((m) => m.facts.tutorialDone && gate.met(asChapter(m.facts, gate.chapter - 1))) ??
        null,
      entered: entered.get(gate.chapter) ?? null,
      hasBeats: hasBeats(gate.chapter)
    }));

  /* --- CONSECUTIVE. The ladder only ever looks up storyChapter + 1, so a gate
         above a gap is not "waiting", it is dead code. --- */
  const chapters = gates.map((g) => g.gate.chapter);
  const seen = new Set<number>();
  for (const gate of gates) {
    const chapter = gate.gate.chapter;
    const at = `chapter:${chapter}`;
    if (seen.has(chapter)) {
      findings.push({
        severity: 'error',
        at,
        message: `two gates claim chapter ${chapter} — only the first in the ladder is ever asked`
      });
    }
    seen.add(chapter);
    if (chapter < 2 || chapter > LAST_CHAPTER) {
      findings.push({
        severity: 'error',
        at,
        message: `chapter ${chapter} is outside the campaign (2..${LAST_CHAPTER}) — it can never be entered`
      });
      continue;
    }
    if (chapter > 2 && !chapters.includes(chapter - 1)) {
      findings.push({
        severity: 'error',
        at,
        message: `nothing gates chapter ${chapter - 1}, so the ladder stops below this one — chapter ${chapter}'s gate is dead code`
      });
    }
  }

  /* --- BEATS. Advancing into a chapter dialogue.json has nothing for would burn
         it: the pointer persists and beats never replay. StorySystem refuses,
         which makes such a gate inert — and a gate that can never fire is a
         chapter the campaign silently stops below. --- */
  for (const gate of gates) {
    if (gate.hasBeats) continue;
    findings.push({
      severity: 'error',
      at: `chapter:${gate.gate.chapter}`,
      message: `no beats authored in dialogue.json for chapter ${gate.gate.chapter} — the gate is inert, and the ladder stops here`
    });
  }

  /* --- REACHABLE. --- */
  for (const gate of gates) {
    if (gate.firstHold) continue;
    findings.push({
      severity: 'error',
      at: `chapter:${gate.gate.chapter}`,
      message: `its condition (on '${gate.gate.on}') is never true anywhere on the timeline — not after every quest, every order, ${ENCORE_DELIVERIES} encores, trust ${TRUST_MAX} and every reachable dragon seen`
    });
  }

  /* --- ORDER. Each chapter's beat presupposes exactly what the rung below it
         made true, so a gate that holds before its predecessor's is a beat the
         player reads out of sequence. --- */
  for (let i = 1; i < gates.length; i++) {
    const below = gates[i - 1]!;
    const above = gates[i]!;
    if (!below.firstHold || !above.firstHold) continue;
    if (above.firstHold.index >= below.firstHold.index) continue;
    findings.push({
      severity: 'error',
      at: `chapter:${above.gate.chapter}`,
      message:
        `holds at '${above.firstHold.at}', which is BEFORE chapter ${below.gate.chapter}'s ` +
        `'${below.firstHold.at}' — the higher rung is already true when the lower one opens, ` +
        `so its beat lands as a formality on lines that presuppose the one below`
    });
  }

  /* --- CLIMBABLE. The three checks above are about the data; this one is about
         what `evaluate` would actually do with it. --- */
  for (const gate of gates) {
    if (gate.entered || !gate.hasBeats || !gate.firstHold) continue;
    findings.push({
      severity: 'error',
      at: `chapter:${gate.gate.chapter}`,
      message: `its condition holds at '${gate.firstHold.at}', but the sequential ladder never gets this high — a rung below it never opens`
    });
  }

  const reachedChapter = gates.reduce((n, g) => (g.entered ? Math.max(n, g.gate.chapter) : n), 1);
  return { gates, findings, reachedChapter };
}

/** The shipped ladder, walked and judged. What `pnpm chapters` prints. */
export function auditCampaign(data: CampaignData): CampaignAudit {
  const { timeline, findings } = buildTimeline(data);
  const hasBeats = (chapter: number): boolean =>
    (data.dialogue.chapters?.[String(chapter)]?.lines.length ?? 0) > 0;
  const judged = judgeLadder(timeline, CHAPTER_GATES, hasBeats);
  return { ...judged, timeline, findings: [...findings, ...judged.findings] };
}
