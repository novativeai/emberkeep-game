import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { beatsFingerprint } = require('../../scripts/beats-fingerprint.cjs') as { beatsFingerprint: () => string };

interface Checkpoint { step: string; fingerprint?: string; saveKey: string; blob: string }

/**
 * Boot a Playwright page INTO a recorded tutorial beat.
 *
 * `pnpm beats:record` plays the whole script once and writes one checkpoint
 * per beat (the raw save blob) under tests/e2e/checkpoints. A loaded save
 * rebases the game clock to its `savedAt`, so this lands on the beat exactly
 * as recorded — same board, timers and Warmth — in a few seconds instead of a
 * full playthrough. Use it to start a spec at the beat it is actually about.
 *
 * A checkpoint whose fingerprint (step list, SAVE_VERSION, chain ids, map,
 * zones) is not the game's is refused: a stale beat would test a board the
 * current game never makes.
 */
export async function bootAtBeat(page: Page, stepId: string): Promise<void> {
  const dir = path.resolve(__dirname, 'checkpoints');
  const tutorial = JSON.parse(readFileSync(path.resolve(__dirname, '../../src/data/tutorial.json'), 'utf8')) as { steps: { id: string }[] };
  const index = tutorial.steps.findIndex((s) => s.id === stepId);
  const file = path.join(dir, `${String(index).padStart(2, '0')}-${stepId}.json`);
  if (index < 0 || !existsSync(file)) throw new Error(`no checkpoint for beat "${stepId}" — run \`pnpm beats:record\``);
  const cp = JSON.parse(readFileSync(file, 'utf8')) as Checkpoint;
  const current = beatsFingerprint();
  if (cp.fingerprint !== current) {
    throw new Error(`checkpoint "${stepId}" is stale (recorded for ${cp.fingerprint ?? 'unstamped'}, game is ${current}) — run \`pnpm beats:record\``);
  }
  await page.goto('/');
  await page.evaluate(([k, b]) => { localStorage.clear(); localStorage.setItem(k, b); }, [cp.saveKey, cp.blob]);
  await page.reload();
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
  await page.waitForFunction(() => window.render_game_to_text().scene === 'TitleScene', null, { timeout: 30_000 });
  await page.waitForTimeout(1400);
  await page.mouse.click(640, 670); // Play
  await page.waitForFunction(() => window.render_game_to_text().scene === 'BoardScene', null, { timeout: 30_000 });
  await page.waitForFunction((id) => window.render_game_to_text().tutorial.step === id, stepId, { timeout: 15_000 });
  await page.waitForTimeout(800);
}
