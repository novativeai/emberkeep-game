import { chainHiddenIn } from './Constants';
import { recipeFor } from './mergeRule';
import type { ChainsData } from './types';

/**
 * "HOW DO I MAKE THAT?" — the question a quest card cannot answer on its own.
 *
 * A card says *Craft the Radiant Centerpiece* and shows one gem. Everything the
 * player has to do to get there — three Flame Gems, nine Gem Shards, a Red
 * Dragon tapped nine times — is knowledge the game holds and never says out
 * loud. The Cookbook lists recipes, but it is a book: it answers "what merges
 * into what", not "what do I do about THIS order, given what is already in my
 * pocket". This module answers the second question, and the `?` on the card is
 * where it is asked.
 *
 * THREE RULES, decided by the owner and not to be quietly improved:
 *
 *   1. IT COUNTS WHAT HE ALREADY HAS. The useful number is what is MISSING, and
 *      it cascades: two Flame Gems in the bag mean the rung below owes three
 *      Gem Shards, not nine. A help panel that restates the raw recipe is a
 *      Cookbook page with extra steps.
 *   2. IT DESCENDS TO A SOURCE. Stopping at "you need nine Gem Shards" replaces
 *      one question with another; the answer ends at a thing on the board the
 *      player can touch.
 *   3. IT IGNORES THE FIVE-BONUS. Five alike merge five-for-two, so a clever
 *      player needs fewer than this says. The help states the recipe's own
 *      count anyway — the smallest true statement is what an explanation
 *      should be, and a promise of "maybe fewer" is not one the board keeps
 *      unless the player builds the pile.
 *
 * Phaser-free and pure: the panel calls it, and so do the unit tests.
 */

/** One tier on the ladder between the goal and the base piece. */
export interface RecipeRung {
  chain: string;
  tier: number;
  name: string;
  /** How many of THIS piece the rung above needs, before counting holdings. */
  need: number;
  /** How many the Keeper holds right now (board of every world, plus the Bag). */
  have: number;
  /** Still to obtain here, after what is held at this rung and above it. */
  missing: number;
  /** How many of the tier BELOW make one of these. Absent on the base rung,
   *  which is not made by merging anything. */
  fromCount?: number;
}

export type RecipeSourceKind = 'tap' | 'none';

/** Where the base piece comes from. */
export interface RecipeSource {
  kind: RecipeSourceKind;
  /** Player-facing, e.g. `Red Dragon`. Empty when `kind` is 'none'. */
  label: string;
  /** The producing piece, so the panel can draw its icon. */
  producer?: { chain: string; tier: number };
  energyCost?: number;
  cooldownMs?: number;
}

export interface RecipeHelp {
  goal: { chain: string; tier: number; name: string; count: number };
  /** The goal rung FIRST, then each tier below it, down to the base. */
  rungs: RecipeRung[];
  source: RecipeSource;
  /** Base pieces still to obtain — the bottom line of the panel. */
  baseMissing: number;
}

/** How many pieces of `tier` merge into one of `tier + 1`, by the SAME
 *  precedence the merge itself uses. `recipeFor` is that precedence; this file
 *  does not get a second copy of it (CLAUDE.md: one predicate, four readers). */
function mergeCount(chains: ChainsData, chain: string, tier: number): number {
  return recipeFor(chains, chain, tier).need;
}

/**
 * The producer to name for `chain:tier`, or null when nothing on the board
 * makes it.
 *
 * PREFERS ONE THE PLAYER ALREADY HAS. Eight different dragons produce Gem
 * Shards; telling somebody who owns a Red Dragon to go and get a Storm Dragon
 * is worse than saying nothing. Failing that, the first that belongs in this
 * world at all — `chainHiddenIn` is the same gate the Cookbook's pages use, so
 * the help can never point at a chain the north keeps and the south does not.
 */
function producerOf(
  chains: ChainsData,
  chain: string,
  tier: number,
  held: (chain: string, tier: number) => number,
  worldId: string
): RecipeSource | null {
  let fallback: RecipeSource | null = null;
  for (const config of chains.chains) {
    if (chainHiddenIn(config, worldId)) continue;
    for (const t of config.tiers) {
      const produces = t.generator?.produces;
      if (!produces || produces.chain !== chain || (produces.tier ?? 1) !== tier) continue;
      const source: RecipeSource = {
        kind: 'tap',
        label: t.name,
        producer: { chain: config.id, tier: t.tier },
        ...(t.generator?.energyCost !== undefined ? { energyCost: t.generator.energyCost } : {}),
        ...(t.generator?.cooldownMs !== undefined ? { cooldownMs: t.generator.cooldownMs } : {})
      };
      if (held(config.id, t.tier) > 0) return source;
      fallback ??= source;
    }
  }
  return fallback;
}

/**
 * THE LADDER FOR ONE GOAL, walked top down.
 *
 * Down from the wanted piece to the lowest tier that is not made by merging —
 * or to one that a producer hands over directly, because descending past a
 * piece somebody can simply give you is answering a question nobody asked.
 *
 * Null when the goal names a chain or tier that does not exist, or when there
 * is nothing under it to explain (a tier-1 piece is not a recipe). The caller
 * shows no `?` at all in that case: a help button that opens an empty panel is
 * worse than no help button.
 */
export function recipeHelp(
  chains: ChainsData,
  goal: { chain: string; tier: number; count: number },
  held: (chain: string, tier: number) => number,
  worldId: string
): RecipeHelp | null {
  const config = chains.chains.find((c) => c.id === goal.chain);
  const goalTier = config?.tiers.find((t) => t.tier === goal.tier);
  if (!config || !goalTier || goal.count <= 0) return null;

  // WHERE THE LADDER STOPS. Down while a tier below exists — and stop early
  // only at a producer the Keeper ALREADY HAS.
  //
  // That last clause is the whole rule, and getting it wrong is the first thing
  // this module did: an Ashdrake pours Flame Gems, so a walk that stopped at
  // ANY producer answered "one Radiant Gem" with "tap the Ashdrake", a beast
  // from a chapter the player has not reached. A piece somebody can hand you
  // NOW is where an answer ends; a producer you have never seen is not an
  // answer, it is another question.
  let base = goal.tier;
  while (base > 1) {
    const maker = producerOf(chains, goal.chain, base, held, worldId);
    if (maker?.producer && held(maker.producer.chain, maker.producer.tier) > 0) break;
    if (!config.tiers.some((t) => t.tier === base - 1)) break;
    base -= 1;
  }

  const rungs: RecipeRung[] = [];
  // `owed` is what the rung ABOVE still needs after its own holdings — the
  // cascade the owner asked for, and the whole difference between this and a
  // Cookbook page.
  let owed = goal.count;
  for (let tier = goal.tier; tier >= base; tier -= 1) {
    const name = config.tiers.find((t) => t.tier === tier)?.name ?? `${goal.chain} ${tier}`;
    const have = Math.max(0, held(goal.chain, tier));
    const missing = Math.max(0, owed - have);
    const fromCount = tier > base ? mergeCount(chains, goal.chain, tier - 1) : undefined;
    rungs.push({
      chain: goal.chain,
      tier,
      name,
      need: owed,
      have,
      missing,
      ...(fromCount !== undefined ? { fromCount } : {})
    });
    if (fromCount === undefined) break;
    owed = missing * fromCount;
  }

  const bottom = rungs[rungs.length - 1]!;
  const source = producerOf(chains, goal.chain, bottom.tier, held, worldId) ?? {
    kind: 'none' as const,
    label: ''
  };
  // NOTHING TO SAY. One rung and nobody who makes it: no ladder, no source, and
  // the caller shows no `?` at all — a help button that opens an empty panel is
  // worse than no help button. A single rung WITH a source is worth saying:
  // "tap the Red Dragon three times" is exactly the help a tier-1 order wants.
  if (rungs.length === 1 && source.kind === 'none') return null;

  return {
    goal: { chain: goal.chain, tier: goal.tier, name: goalTier.name, count: goal.count },
    rungs,
    source,
    baseMissing: bottom.missing
  };
}
