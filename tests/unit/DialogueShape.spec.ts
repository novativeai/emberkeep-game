import { describe, expect, it } from 'vitest';
import dialogue from '../../src/data/dialogue.json';

/**
 * THE SHAPES THE BUBBLE IS HANDED.
 *
 * `dialogue.json` is CAST into `DialogueData`, never validated against it, so a
 * declared type here is a claim nobody was checking. `finaleElder` was typed
 * `string` while the file had long since grown to two lines; the Golden Elder's
 * awakening then called `text.replace` on an array, threw out of a
 * `delayedCall`, and took the RAF chain with it — the chapter's one
 * irreversible beat froze the session, and a reload "fixed" it only because the
 * beat is latched and never replays.
 *
 * A one-line beat and a many-line beat are spoken by DIFFERENT methods (`say`
 * is timed and takes one string, `sequence` is tap-advanced and takes a list),
 * so the shape is not a formality — it decides which call is correct. These
 * tests pin the two the finale reads, which is the only place the mismatch
 * could end a session rather than lose a line.
 */
describe('the dialogue the finale speaks', () => {
  const lineBanks = ['finaleElder', 'finaleElderProphecy'] as const;

  it.each(lineBanks)('%s is a non-empty list of lines, not one string', (key) => {
    const bank = (dialogue as Record<string, unknown>)[key];
    expect(Array.isArray(bank)).toBe(true);
    expect((bank as unknown[]).length).toBeGreaterThan(0);
    for (const line of bank as unknown[]) {
      expect(typeof line).toBe('string');
      expect((line as string).trim().length).toBeGreaterThan(0);
    }
  });

  it.each(['lateAwakening', 'tasksComplete', 'goldenArrival'] as const)(
    '%s is a single string — it is spoken by say(), which cannot take a list',
    (key) => {
      expect(typeof (dialogue as Record<string, unknown>)[key]).toBe('string');
    }
  );

  it('every hint is a single string', () => {
    // `showHint` reaches straight into this bank and calls `say`.
    for (const [key, line] of Object.entries(dialogue.hints)) {
      expect(typeof line, `hints.${key}`).toBe('string');
    }
  });
});
