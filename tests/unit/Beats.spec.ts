import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import tutorial from '../../src/data/tutorial.json';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { beatsFingerprint } = require('../../scripts/beats-fingerprint.cjs') as { beatsFingerprint: () => string };

/**
 * The beat checkpoints (tests/e2e/checkpoints) are raw save blobs: a snapshot
 * of the board the CURRENT script, chains, map and save schema make. This is
 * the guard that keeps them honest — change any of those and this fails until
 * `pnpm beats:record` is run again, instead of `pnpm beat` quietly booting a
 * board the game no longer produces.
 */
interface Checkpoint { step: string; index: number; fingerprint?: string; saveKey: string; blob: string }

const DIR = path.resolve(__dirname, '../e2e/checkpoints');
const steps = (tutorial as { steps: { id: string }[] }).steps.map((s) => s.id);
const fileOf = (id: string): string => path.join(DIR, `${String(steps.indexOf(id)).padStart(2, '0')}-${id}.json`);
const read = (id: string): Checkpoint => JSON.parse(readFileSync(fileOf(id), 'utf8')) as Checkpoint;

describe('beat checkpoints', () => {
  const current = beatsFingerprint();

  it('exist for every tutorial beat', () => {
    const missing = steps.filter((id) => !existsSync(fileOf(id)));
    expect(missing, 'run `pnpm beats:record`').toEqual([]);
  });

  it('are recorded for the current script, chains, map and save schema', () => {
    const stale = steps.filter((id) => existsSync(fileOf(id)) && read(id).fingerprint !== current);
    expect(stale, `stale for ${current} — run \`pnpm beats:record\``).toEqual([]);
  });

  it('carry a save that names its own beat', () => {
    for (const id of steps) {
      if (!existsSync(fileOf(id))) continue;
      const cp = read(id);
      expect(cp.step).toBe(id);
      expect(cp.index).toBe(steps.indexOf(id));
      const save = JSON.parse(cp.blob) as { tutorialIndex?: number; tutorial?: { index?: number } };
      const idx = save.tutorialIndex ?? save.tutorial?.index;
      expect(idx, `${id}: the blob's tutorial index`).toBe(steps.indexOf(id));
    }
  });

  it('leave no orphans from steps that no longer exist', () => {
    const orphans = readdirSync(DIR).filter((f) => /^\d+-.*\.json$/.test(f)).map((f) => f.replace(/^\d+-/, '').replace(/\.json$/, '')).filter((id) => !steps.includes(id));
    expect(orphans).toEqual([]);
  });
});
