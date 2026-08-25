import type { ChainsData } from './types';

/**
 * The nouns a spoken line may highlight, as one matcher.
 *
 * Kept out of `CharacterBubble` — and so out of Phaser — because the rules here
 * are the fiddly half of the feature and the drawing is the easy half. This is
 * the part worth pinning in a node test.
 *
 * Three rules, each of which was a bug the first time it was missing:
 *
 *  • **Longest first.** JS alternation is first-match, not longest-match, so
 *    the ORDER is the rule: with "Red Dragon" ahead of "Red Dragon Egg" a line
 *    about an egg underlines the dragon inside it and stops.
 *  • **Whole words.** `\b…\b`, so a name never lights up inside a longer word.
 *  • **Plurals.** The roster stores singular names and the writing is not
 *    obliged to: "three Moss Puffs" must underline the whole phrase, not stop a
 *    letter short. `(?:e?s)?` covers the two English tails the names use.
 *
 * Returns null when there is nothing to match, so the caller can skip the work
 * rather than run an empty alternation over every line.
 */
export function nounMatcher(names: Iterable<string>): RegExp | null {
  const unique = new Set<string>();
  for (const name of names) if (name) unique.add(name);
  if (unique.size === 0) return null;
  const escaped = [...unique]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${escaped.join('|')})(?:e?s)?\\b`, 'g');
}

/** Every piece on the board, by name — one entry per tier, since a tier is the
 *  thing a player is actually told to go and find. */
export function pieceNames(chains: ChainsData): string[] {
  const out: string[] = [];
  for (const chain of chains.chains) {
    for (const tier of chain.tiers) if (tier.name) out.push(tier.name);
  }
  return out;
}
