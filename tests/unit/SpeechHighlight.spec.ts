import { describe, expect, it } from 'vitest';
import chainsDoc from '../../src/data/chains.json';
import type { ChainsData } from '../../src/core/types';
import { nounMatcher, pieceNames } from '../../src/core/speechHighlight';
import tutorial from '../../src/data/tutorial.json';

const chains = chainsDoc as unknown as ChainsData;
/** The matcher a bubble builds once the player has named their whelp. */
const matcher = (dragon = 'Kioto') =>
  nounMatcher([...pieceNames(chains), 'Eleanor', 'Selyna', 'The Golden Elder', dragon])!;

const found = (text: string, dragon?: string): string[] =>
  text.match(matcher(dragon)) ?? [];

describe('the spoken-line highlighter — the nouns a bubble points at', () => {
  it('picks the LONGEST name, never the shorter one hiding inside it', () => {
    // "Red Dragon" is a piece and so is "Red Dragon Egg". First-match
    // alternation would take the shorter and leave "Egg" plain.
    expect(found('Merge three Rubies into a Red Dragon Egg.')).toContain('Red Dragon Egg');
    expect(found('Merge three Rubies into a Red Dragon Egg.')).not.toContain('Red Dragon');
  });

  it('takes the plural the writing actually uses', () => {
    // The roster stores "Moss Puff"; the line says "Moss Puffs".
    expect(found('Drag two Moss Puffs together.')).toEqual(['Moss Puffs']);
  });

  it('never lights a name up inside a longer word', () => {
    // 'Logs' is a piece; "Logsmith" is not, and must stay plain.
    expect(found('The Logsmith is not a piece.')).toEqual([]);
  });

  it('highlights the people and the dragon the player named', () => {
    expect(found('Eleanor will ask Selyna about Kioto.')).toEqual(['Eleanor', 'Selyna', 'Kioto']);
    // …and an unnamed whelp adds no empty alternative that would match anywhere.
    expect(found('Eleanor waits.', '')).toEqual(['Eleanor']);
  });

  it('is regex-safe: a player-chosen name is escaped, never compiled', () => {
    // A name with regex metacharacters must match itself literally rather than
    // blow up the alternation (or match everything).
    expect(() => matcher('R.*x')).not.toThrow();
    expect(found('Say hello to R.*x now.', 'R.*x')).toEqual(['R.*x']);
    expect(found('Say hello to Rex now.', 'R.*x')).toEqual([]);
  });

  it('actually fires on the shipped script — most beats name something', () => {
    const re = matcher();
    let withNoun = 0;
    let total = 0;
    for (const step of tutorial.steps as Array<{ text?: string }>) {
      if (!step.text) continue;
      total++;
      re.lastIndex = 0;
      if (re.test(step.text.replace(/\{dragon\}/g, 'Kioto'))) withNoun++;
    }
    // A guard against a matcher that silently stops matching (a rename, an
    // escaping slip): the tutorial talks about pieces constantly.
    expect(total).toBeGreaterThan(40);
    expect(withNoun / total).toBeGreaterThan(0.5);
  });
});
