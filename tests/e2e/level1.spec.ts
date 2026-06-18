import { expect, test, type Page } from '@playwright/test';

/**
 * Drives the ENTIRE Level 1 tutorial through real pointer input:
 * merge 3 red eggs → hatch the dragon → the dragon's Gem Shards → merge into
 * Flame Gems → open Cindra's Ledger → deliver for a Gold Key → spend it on the
 * fog. Item cells are looked up dynamically (the start cluster snaps onto
 * whatever clearing the imported map provides); state is asserted after each
 * beat via window.render_game_to_text() and a milestone screenshot is saved.
 */

interface Cell {
  chain?: string;
  tier?: number;
  ready?: boolean;
  decor?: string;
  fog?: string;
}

interface GameText {
  scene: string;
  fps: number;
  tutorial: { step: string; index: number; total: number; done: boolean };
  energy: { current: number; max: number };
  coins: number;
  keys: number;
  xp: number;
  level: number;
  regions: Record<string, string>;
  board: (Cell | null)[][];
  inventory: Record<string, number>;
}

const shot = (name: string): string => `tests/e2e/shots/${name}.png`;

async function gameText(page: Page): Promise<GameText> {
  return page.evaluate(() => window.render_game_to_text() as unknown as GameText);
}

async function findCells(page: Page, pred: (c: Cell) => boolean): Promise<[number, number][]> {
  const state = await gameText(page);
  const out: [number, number][] = [];
  state.board.forEach((rowArr, r) =>
    rowArr.forEach((c, col) => {
      if (c && pred(c)) out.push([col, r]);
    })
  );
  return out.sort((a, b) => a[0] + a[1] - (b[0] + b[1]) || a[0] - b[0]);
}

async function gridToPage(page: Page, col: number, row: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([c, r]) => window.__emberkeep.gridToPage(c as number, r as number),
    [col, row]
  );
}

async function dragTile(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = await gridToPage(page, from[0], from[1]);
  const b = await gridToPage(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 14, a.y - 10, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(450);
}

async function tapTile(page: Page, col: number, row: number): Promise<void> {
  const p = await gridToPage(page, col, row);
  await page.mouse.click(p.x, p.y);
}

/** The bubble sits at game coords (600, 684); taps advance tap-gated steps. */
async function tapBubble(page: Page): Promise<void> {
  await page.mouse.click(600, 684);
}

async function waitStep(page: Page, stepId: string): Promise<void> {
  await expect
    .poll(async () => (await gameText(page)).tutorial.step, {
      timeout: 12_000,
      message: `waiting for tutorial step ${stepId}`
    })
    .toBe(stepId);
}

const count = (s: GameText, chain: string, tier: number): number =>
  s.inventory[`${chain}:${tier}`] ?? 0;

test.describe('Level 1 — Emberkeep tutorial', () => {
  test('eggs → hatch → gem shards → flame gems → ledger → key → fog → free play', async ({
    page
  }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto('/');
    await page.waitForFunction(() => typeof window.render_game_to_text === 'function');

    // ---------- Title ----------
    await expect.poll(async () => (await gameText(page)).scene, { timeout: 30_000 }).toBe('TitleScene');
    await page.waitForTimeout(1400); // let the logo + Play button intro spring in
    await page.screenshot({ path: shot('01-title') });

    await page.mouse.click(640, 670); // Play
    await expect
      .poll(async () => (await gameText(page)).scene, { timeout: 15_000 })
      .toBe('BoardScene');
    await waitStep(page, 'welcome');
    let state = await gameText(page);
    expect(state.energy).toEqual({ current: 20, max: 20 });
    expect(count(state, 'ember_dragon', 1)).toBe(3); // three red eggs
    expect(state.regions['level_2_gate']).toBe('unlockable');
    await page.screenshot({ path: shot('02-welcome') });

    // ---------- Hatch: merge the three eggs ----------
    await tapBubble(page);
    await waitStep(page, 'merge_eggs');
    await page.screenshot({ path: shot('03-egg-step') });

    const eggs = await findCells(page, (c) => c.chain === 'ember_dragon' && c.tier === 1);
    expect(eggs.length).toBe(3);
    await dragTile(page, eggs[2]!, eggs[0]!);
    await waitStep(page, 'dragon_gift');
    state = await gameText(page);
    expect(count(state, 'ember_dragon', 1)).toBe(0);
    expect(count(state, 'ember_dragon', 2)).toBe(1); // a hatchling
    await page.waitForTimeout(900);
    await page.screenshot({ path: shot('04-hatched') });

    // ---------- The dragon's Gem Shards → Flame Gems ----------
    await tapBubble(page);
    await waitStep(page, 'merge_shards');
    const shards = await findCells(page, (c) => c.chain === 'flame_gem' && c.tier === 1);
    expect(shards.length).toBe(6); // spawned by the merge_shards effect
    // Merge until two Flame Gems exist (drop each onto the cluster).
    for (let g = 0; g < 4 && count(await gameText(page), 'flame_gem', 2) < 2; g++) {
      const s = await findCells(page, (c) => c.chain === 'flame_gem' && c.tier === 1);
      if (s.length < 2) break;
      await dragTile(page, s[s.length - 1]!, s[0]!);
    }
    await waitStep(page, 'collect');
    state = await gameText(page);
    expect(count(state, 'flame_gem', 2)).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: shot('05-flame-gems') });

    // ---------- Cindra's Ledger → deliver for a Gold Key ----------
    await tapBubble(page);
    await waitStep(page, 'open_ledger');
    await page.mouse.click(1202, 716); // ledger button (game 2404,1432 → CSS ÷2)
    await waitStep(page, 'deliver');
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot('06-ledger') });

    // Deliver button centre = LedgerPanel.getDeliverPos() (the same spot the
    // tutorial hand points at); game-space → CSS is ÷2.
    const deliver = await page.evaluate(() => {
      const ui = window.__emberkeep.game.scene.getScene('UIScene') as unknown as {
        ledger: { getDeliverPos(): { x: number; y: number } };
      };
      const p = ui.ledger.getDeliverPos();
      return { x: p.x * 0.5, y: p.y * 0.5 };
    });
    await page.mouse.click(deliver.x, deliver.y); // Deliver
    await waitStep(page, 'cindra_key');
    state = await gameText(page);
    expect(state.keys).toBe(1); // the Gold Key from Cindra's order
    expect(count(state, 'flame_gem', 2)).toBeLessThan(2); // gems delivered
    await page.waitForTimeout(900); // the Ledger auto-closes after the order
    await page.screenshot({ path: shot('07-delivered-key') });

    // ---------- Spend the key: the fog lifts ----------
    await tapBubble(page); // dismiss the key line → open_fog
    await waitStep(page, 'open_fog');
    const gate = await findCells(page, (c) => c.fog === 'level_2_gate');
    expect(gate.length).toBeGreaterThan(0);
    await tapTile(page, gate[0]![0], gate[0]![1]);
    await waitStep(page, 'free');
    state = await gameText(page);
    expect(state.keys).toBe(0);
    expect(state.regions['level_2_gate']).toBe('active');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: shot('08-fog-lifted') });

    // ---------- Free play ----------
    await tapBubble(page);
    await expect.poll(async () => (await gameText(page)).tutorial.done).toBe(true);
    await page.screenshot({ path: shot('09-free-play') });

    // ---------- Save / reload restores mid-game state ----------
    const before = await gameText(page);
    await page.reload();
    await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
    await expect.poll(async () => (await gameText(page)).scene).toBe('TitleScene');
    await page.waitForTimeout(1200); // the Play button springs in (alpha 0 → interactive)
    await page.mouse.click(640, 670); // Continue
    await expect.poll(async () => (await gameText(page)).scene).toBe('BoardScene');
    const after = await gameText(page);
    expect(after.tutorial.done).toBe(true);
    expect(after.keys).toBe(before.keys);
    expect(after.xp).toBe(before.xp);
    expect(after.board).toEqual(before.board);
    expect(after.regions['level_2_gate']).toBe('active');
    await page.screenshot({ path: shot('10-reloaded') });

    // ---------- Offline energy regen on load ----------
    const savedRaw = await page.evaluate(() => localStorage.getItem(window.__emberkeep.saveKey));
    expect(savedRaw).not.toBeNull();
    const saved = JSON.parse(savedRaw!) as {
      savedAt: number;
      energy: { current: number; lastRegenAt: number };
    };
    const expectedEnergy = Math.min(20, saved.energy.current + 3);
    saved.energy.lastRegenAt -= 90_500;
    saved.savedAt -= 90_500;
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key as string, value as string),
      [await page.evaluate(() => window.__emberkeep.saveKey), JSON.stringify(saved)]
    );
    await page.reload();
    await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
    await expect.poll(async () => (await gameText(page)).scene).toBe('TitleScene');
    await page.waitForTimeout(1200); // the Play button springs in (alpha 0 → interactive)
    await page.mouse.click(640, 670); // Continue
    await expect.poll(async () => (await gameText(page)).scene).toBe('BoardScene');
    const regenerated = await gameText(page);
    expect(regenerated.energy.current).toBeGreaterThanOrEqual(expectedEnergy);
    expect(regenerated.energy.current).toBeLessThanOrEqual(Math.min(20, expectedEnergy + 1));

    // ---------- Level-up wakes the next zone ----------
    await page.evaluate(() => window.__emberkeep.grantXp(120)); // cross the level-2 cap
    await page.waitForTimeout(1900); // let the level-up + camera glide settle
    const leveled = await gameText(page);
    expect(leveled.level).toBeGreaterThanOrEqual(2);
    expect(leveled.regions['level_2']).toBe('active'); // zone 2 woke on level-up
    await page.screenshot({ path: shot('11-levelup') });

    // ---------- No console errors anywhere in the run ----------
    expect(consoleErrors).toEqual([]);
    expect((await gameText(page)).fps).toBeGreaterThan(1);
  });
});
