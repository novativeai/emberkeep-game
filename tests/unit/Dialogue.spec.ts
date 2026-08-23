import { describe, expect, it } from 'vitest';
import { DIALOGUE_MAX_CHARS } from '../../src/core/Constants';
import dialogue from '../../src/data/dialogue.json';

/** Every string anywhere in dialogue.json, with the path that names it. */
function walk(node: unknown, path: string, visit: (path: string, line: string) => void): void {
  if (typeof node === 'string') {
    visit(path, node);
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${path}[${i}]`, visit));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) walk(value, path ? `${path}.${key}` : key, visit);
  }
}

describe('dialogue.json line budget (Constants.DIALOGUE_MAX_CHARS)', () => {
  it(`no single line exceeds ${DIALOGUE_MAX_CHARS} characters — a longer speech is split into lines`, () => {
    // A bubble is one breath. Past the cap the card grows tall enough to crowd
    // the board — the finale monologue shipped at 302 characters once, which is
    // exactly the wall of text this test exists to stop. Split the line into an
    // array (a sequence, or the finale's chained says) instead of trimming the
    // writing.
    const over: string[] = [];
    walk(dialogue, '', (path, line) => {
      if (line.length > DIALOGUE_MAX_CHARS) over.push(`${path} (${line.length})`);
    });
    expect(over).toEqual([]);
  });

  it('speaker keys are present and non-empty wherever a sequence declares one', () => {
    // The bubble resolves speaker art and name tags off these ids; an empty one
    // renders an unnamed portrait ring. Collected first so a renamed key makes
    // the test FAIL loudly rather than silently checking nothing.
    const speakers: string[] = [];
    walk(dialogue, '', (path, line) => {
      if (path.endsWith('.speaker')) speakers.push(line);
    });
    expect(speakers.length).toBeGreaterThan(0);
    expect(speakers.filter((s) => !s)).toEqual([]);
  });
});
