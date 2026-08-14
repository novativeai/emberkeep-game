import { describe, expect, it } from 'vitest';
import chainsData from '../../src/data/chains.json';
import dialogue from '../../src/data/dialogue.json';
import questsData from '../../src/data/quests.json';
import { DIALOGUE_MAX_CHARS, FIRST_CONTACT } from '../../src/core/Constants';
import type { ChainsData, QuestsData } from '../../src/core/types';

const chains = (chainsData as unknown as ChainsData).chains;
const quests = (questsData as unknown as QuestsData).quests;
const hints = dialogue.hints as Record<string, string | undefined>;

/** Display name of a chain's tier, e.g. `seaglass` t2 → "Glass Buoy". */
function pieceName(chain: string, tier: number): string | undefined {
  return chains.find((c) => c.id === chain)?.tiers.find((t) => t.tier === tier)?.name;
}

/**
 * FIRST CONTACT — the north has no tutorial, so these lines ARE its teach-points.
 *
 * The failure they exist to prevent is not cosmetic: four of the five northern
 * machines shipped named nowhere the player could read them, while two quests
 * asked for pieces made by the fifth. A row that names a machine nobody speaks
 * of, or speaks of one the board never holds, is that same defect wearing a
 * different hat.
 */
describe('first contact names every machine the north asks the player to run', () => {
  it('points at a real generator — the machine, not one of its parts', () => {
    for (const entry of FIRST_CONTACT) {
      const tier = chains.find((c) => c.id === entry.chain)?.tiers.find((t) => t.tier === entry.tier);
      expect(tier, `${entry.chain} t${entry.tier} is not in chains.json`).toBeDefined();
      // The introduction belongs to the piece that PRODUCES. Pointed at a Fire
      // Brick it would fire on the fixture drop, three rungs before there is a
      // machine to name.
      expect(tier?.generator, `${entry.chain} t${entry.tier} is not a generator`).toBeDefined();
    }
  });

  it('has a line for every machine, and the line says the machine’s name', () => {
    for (const entry of FIRST_CONTACT) {
      const line = hints[entry.hint];
      expect(line, `dialogue.hints.${entry.hint} is missing`).toBeTruthy();
      expect(line!.length).toBeLessThanOrEqual(DIALOGUE_MAX_CHARS);
      // "The Glass Kiln" → the line must contain "Glass Kiln". A first-contact
      // beat that never says the name is the gap it was written to close.
      const name = pieceName(entry.chain, entry.tier)!.replace(/^The /, '');
      expect(line, `${entry.hint} never names ${name}`).toContain(name);
    }
  });

  it('covers every northern machine — a farm with no line is an unnamed farm', () => {
    // Derived, not listed: any chain whose top tier is a generator feeding
    // ANOTHER chain is a farm machine, so a sixth farm added later fails here
    // until it is introduced.
    const machines = chains
      .filter((c) => {
        const top = c.tiers[c.tiers.length - 1];
        return top?.generator?.produces && top.generator.produces.chain !== c.id;
      })
      .map((c) => c.id);
    const north = ['glasskiln', 'starbench', 'wreckforge', 'tarkiln', 'auroraloom'];
    for (const id of north) {
      expect(machines, `${id} is no longer a machine`).toContain(id);
      expect(FIRST_CONTACT.map((f) => f.chain), `${id} has no first-contact line`).toContain(id);
    }
  });
});

/**
 * The quest tracker must ask for pieces that exist.
 *
 * The north's seven original chains were deleted and replaced, and every step
 * label kept naming the dead ones — the tracker asked for Drift Spars and Bound
 * Faggots while the board held Glass Floats. A label naming an object the game
 * no longer contains is worse than a vague one: the player searches for it.
 */
describe('every quest step names the piece its own goal resolves to', () => {
  it('never asks for an object that is not the goal', () => {
    const wrong: string[] = [];
    for (const quest of quests) {
      for (const step of quest.steps ?? []) {
        const goal = step.goal as { kind: string; chain?: string; tier?: number };
        if (goal.kind !== 'have' && goal.kind !== 'gift') continue;
        const name = pieceName(goal.chain!, goal.tier!);
        if (!name) {
          wrong.push(`${step.id}: goal points at ${goal.chain} t${goal.tier}, which is not a chain`);
          continue;
        }
        // Match the HEAD noun, stemmed by one character so a plural ("Ground
        // Lenses" for a Ground Lens, "Pitch Loaves" for a Pitch Loaf) still
        // counts. What it will not accept is a different object entirely.
        const head = name.replace(/^The /, '').split(' ').pop()!.toLowerCase();
        const label = (step.label ?? '').toLowerCase();
        if (!label.includes(head) && !label.includes(head.slice(0, -1))) {
          wrong.push(`${step.id}: "${step.label}" but the goal is a ${name}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('carries no name from the roster the north replaced', () => {
    // The exact nouns deleted at b3a8c68 (driftwood, keel, wrackline, tarknot,
    // frostsilk, rimebloom, frostfont). They are gone from chains.json, so
    // nothing derives them — this list IS the regression guard.
    const dead = [
      'drift spar',
      'bound faggot',
      'broken strake',
      'lashed frame',
      'upturned hull',
      'longhall',
      'frost flower',
      'rime bloom',
      'black ember',
      'spun skein',
      'light-fast spindle',
      'pitch cake'
    ];
    const offenders: string[] = [];
    for (const quest of quests) {
      const strings = [quest.title ?? '', ...(quest.steps ?? []).map((s) => s.label ?? '')];
      for (const text of strings) {
        for (const noun of dead) {
          if (text.toLowerCase().includes(noun)) offenders.push(`${quest.id}: "${text}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
