/**
 * TUTORIAL SCRIPTS — the one place that knows what `tutorial.json` MEANS.
 *
 * The file carries the main Chapter One script as `steps` and any mid-game
 * scripts under `tutorials`. Everything that reads the file — TutorialDirector,
 * the World Builder's Tutorial tab, the `/__tutorial` dev endpoint, the unit
 * tests — goes through `scriptsOf`, so "the main script is the script called
 * `main` with trigger `start`" is decided exactly once.
 *
 * Phaser-free on purpose: trigger evaluation and validation run in node, and
 * the director only spends a few lines on bus plumbing around them.
 */
import type {
  TutorialData,
  TutorialScriptConfig,
  TutorialStepConfig,
  TutorialTrigger
} from './types';

export const MAIN_SCRIPT_ID = 'main';

/** Every script in the file, the main one first. */
export function scriptsOf(data: TutorialData): TutorialScriptConfig[] {
  return [
    { id: MAIN_SCRIPT_ID, title: 'Chapter One', trigger: { type: 'start' }, allowBase: 'nothing', steps: data.steps },
    ...(data.tutorials ?? []).map((s) => ({ allowBase: 'everything' as const, ...s }))
  ];
}

/** Rebuild the file shape from a script list (the editor's save path). */
export function dataOf(scripts: TutorialScriptConfig[]): TutorialData {
  const main = scripts.find((s) => s.id === MAIN_SCRIPT_ID);
  const rest = scripts
    .filter((s) => s.id !== MAIN_SCRIPT_ID)
    .map(({ id, title, trigger, allowBase, steps }) => {
      const out: TutorialScriptConfig = { id, trigger, steps };
      if (title) out.title = title;
      if (allowBase && allowBase !== 'everything') out.allowBase = allowBase;
      return out;
    });
  const data: TutorialData = { steps: main?.steps ?? [] };
  if (rest.length) data.tutorials = rest;
  return data;
}

/**
 * What a trigger needs to know about the world. Kept as plain callbacks so the
 * director hands in GameState and a test hands in a few lambdas.
 */
export interface TriggerFacts {
  stat: (key: string) => number;
  level: number;
  worldId: string;
  mainDone: boolean;
  /** The main script's current index (steps before it are passed). */
  mainIndex: number;
}

/** The stats keys a mid-game script's progress lives under. */
export const scriptStatKeys = (id: string) => ({
  step: `tut:${id}:step`,
  done: `tut:${id}:done`,
  started: `tut:${id}:started`,
  /** The `event` trigger's observation latch. */
  trigger: `tut:${id}:trig`
});

/** Has this step of this script been passed? */
export function stepDone(scripts: TutorialScriptConfig[], facts: TriggerFacts, scriptId: string, stepId: string): boolean {
  const script = scripts.find((s) => s.id === scriptId);
  if (!script) return false;
  const at = script.steps.findIndex((s) => s.id === stepId);
  if (at < 0) return false;
  if (scriptId === MAIN_SCRIPT_ID) return facts.mainDone || facts.mainIndex > at;
  const keys = scriptStatKeys(scriptId);
  return facts.stat(keys.done) > 0 || facts.stat(keys.step) > at;
}

export function scriptDone(facts: TriggerFacts, scriptId: string): boolean {
  if (scriptId === MAIN_SCRIPT_ID) return facts.mainDone;
  return facts.stat(scriptStatKeys(scriptId).done) > 0;
}

/**
 * Is this script's trigger met right now? `start` is never met for a mid-game
 * script — it is the main script's and only its. Mid-game scripts also wait
 * for the main script to be done: two lessons cannot hold the board at once,
 * and Chapter One's own beats are the ones that own the opening.
 */
export function triggerMet(
  scripts: TutorialScriptConfig[],
  facts: TriggerFacts,
  script: TutorialScriptConfig
): boolean {
  if (script.id === MAIN_SCRIPT_ID) return true;
  if (!facts.mainDone) return false;
  const t = script.trigger;
  switch (t.type) {
    case 'start':
      return false;
    case 'step_done':
      return stepDone(scripts, facts, t.tutorial, t.step);
    case 'tutorial_done':
      return scriptDone(facts, t.tutorial);
    case 'event':
      return facts.stat(scriptStatKeys(script.id).trigger) > 0;
    case 'quest_done':
      return facts.stat(`q:done:${t.quest}`) > 0;
    case 'level':
      return facts.level >= t.min;
    case 'world':
      return facts.worldId === t.world;
    case 'stat':
      return facts.stat(t.key) >= t.min;
  }
}

/** Every distinct bus event any `event` trigger listens for. */
export function triggerEvents(scripts: TutorialScriptConfig[]): string[] {
  const out = new Set<string>();
  for (const s of scripts) if (s.trigger.type === 'event') out.add(s.trigger.event);
  return [...out];
}

/**
 * Structural validation, shared by the dev endpoint (refuses a bad write) and
 * the unit test (refuses a bad commit). Gate/allow SEMANTICS stay with the
 * tutorial-design skill's ftuecheck — this is the shape, the ids and the
 * references, so a trigger can never point at a script or step that is not
 * there and no two steps can answer to one id.
 */
export function validateTutorialData(data: TutorialData): string[] {
  const errors: string[] = [];
  if (!Array.isArray(data.steps)) return ['steps must be an array'];
  const scripts = scriptsOf(data);
  const scriptIds = new Set<string>();
  const stepIds = new Map<string, string>();
  for (const script of scripts) {
    if (!script.id || typeof script.id !== 'string') errors.push('a script has no id');
    if (scriptIds.has(script.id)) errors.push(`duplicate script id "${script.id}"`);
    scriptIds.add(script.id);
    if (!Array.isArray(script.steps)) {
      errors.push(`script "${script.id}": steps must be an array`);
      continue;
    }
    if (script.allowBase !== undefined && script.allowBase !== 'nothing' && script.allowBase !== 'everything') {
      errors.push(`script "${script.id}": allowBase must be 'nothing' or 'everything'`);
    }
    script.steps.forEach((step, i) => errors.push(...validateStep(script.id, step, i, stepIds)));
  }
  for (const script of scripts) {
    const at = `script "${script.id}" trigger`;
    const t = script.trigger as TutorialTrigger | undefined;
    if (!t || typeof t !== 'object' || !('type' in t)) {
      errors.push(`${at}: missing`);
      continue;
    }
    if (script.id === MAIN_SCRIPT_ID) {
      if (t.type !== 'start') errors.push(`${at}: the main script's trigger must be 'start'`);
      continue;
    }
    switch (t.type) {
      case 'start':
        errors.push(`${at}: only the main script may start at 'start'`);
        break;
      case 'step_done':
        if (!scriptIds.has(t.tutorial)) errors.push(`${at}: unknown tutorial "${t.tutorial}"`);
        else if (stepIds.get(t.step) !== t.tutorial) errors.push(`${at}: no step "${t.step}" in "${t.tutorial}"`);
        if (t.tutorial === script.id) errors.push(`${at}: a script cannot wait on itself`);
        break;
      case 'tutorial_done':
        if (!scriptIds.has(t.tutorial)) errors.push(`${at}: unknown tutorial "${t.tutorial}"`);
        if (t.tutorial === script.id) errors.push(`${at}: a script cannot wait on itself`);
        break;
      case 'event':
        if (!t.event || !t.event.includes(':')) errors.push(`${at}: event must be a bus event like 'quest:completed'`);
        break;
      case 'quest_done':
        if (!t.quest) errors.push(`${at}: quest_done needs a quest id`);
        break;
      case 'level':
        if (!Number.isInteger(t.min) || t.min < 1) errors.push(`${at}: level.min must be a positive integer`);
        break;
      case 'world':
        if (!t.world) errors.push(`${at}: world needs a world id`);
        break;
      case 'stat':
        if (!t.key || !Number.isFinite(t.min)) errors.push(`${at}: stat needs key and min`);
        break;
      default:
        errors.push(`${at}: unknown trigger type "${String((t as { type: unknown }).type)}"`);
    }
  }
  return errors;
}

const GATE_TYPES = new Set(['tap', 'event', 'count', 'move']);
const SPEAKERS = new Set(['eleanor', 'selyna', 'golden_elder']);

function validateStep(scriptId: string, step: TutorialStepConfig, i: number, stepIds: Map<string, string>): string[] {
  const errors: string[] = [];
  const at = `script "${scriptId}" step ${i}${step?.id ? ` (${step.id})` : ''}`;
  if (!step || typeof step !== 'object') return [`${at}: not an object`];
  if (!step.id || typeof step.id !== 'string') errors.push(`${at}: missing id`);
  else if (stepIds.has(step.id)) errors.push(`${at}: duplicate step id "${step.id}" (already in "${stepIds.get(step.id)}")`);
  else stepIds.set(step.id, scriptId);
  if (!SPEAKERS.has(step.speaker)) errors.push(`${at}: unknown speaker "${String(step.speaker)}"`);
  if (typeof step.text !== 'string') errors.push(`${at}: text must be a string`);
  const gate = step.gate as { type?: string } | undefined;
  if (!gate || !GATE_TYPES.has(gate.type ?? '')) errors.push(`${at}: gate.type must be one of tap/event/count/move`);
  else if (gate.type === 'event' && !(step.gate as { event?: string }).event) errors.push(`${at}: event gate needs an event`);
  else if (gate.type === 'count') {
    const g = step.gate as { chain?: string; tier?: number; count?: number };
    if (!g.chain || !Number.isInteger(g.tier) || !Number.isInteger(g.count)) errors.push(`${at}: count gate needs chain, tier, count`);
  } else if (gate.type === 'move') {
    const g = step.gate as { chain?: string; region?: string };
    if (!g.chain || !g.region) errors.push(`${at}: move gate needs chain and region`);
  }
  if (step.effects !== undefined && !Array.isArray(step.effects)) errors.push(`${at}: effects must be an array`);
  if (step.highlight !== undefined && !Array.isArray(step.highlight)) errors.push(`${at}: highlight must be an array`);
  if (step.allow !== undefined && (typeof step.allow !== 'object' || step.allow === null)) errors.push(`${at}: allow must be an object`);
  return errors;
}
