import { expect, test, type Page } from '@playwright/test';

/**
 * Drives the ENTIRE Level 1 tutorial through real pointer input, asserting
 * game state after every beat via window.render_game_to_text() and saving a
 * milestone screenshot per beat to tests/e2e/shots/.
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
  order: { id: string; have: number[]; need: number[]; deliverable: boolean } | null;
  completedOrders: string[];
  regions: Record<string, string>;
  board: (Cell | null)[][];
  inventory: Record<string, number>;
}

const shot = (name: string): string => `tests/e2e/shots/${name}.png`;

async function gameText(page: Page): Promise<GameText> {
  return page.evaluate(() => window.render_game_to_text() as unknown as GameText);
}

async function gridToPage(page: Page, col: number, row: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([c, r]) => window.__emberkeep.gridToPage(c as number, r as number),
    [col, row]
  );
}

async function dragTile(
  page: Page,
  from: [number, number],
  to: [number, number]
): Promise<void> {
  const a = await gridToPage(page, from[0], from[1]);
  const b = await gridToPage(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  // Cross the drag threshold deliberately, then glide.
  await page.mouse.move(a.x + 14, a.y - 10, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(380); // let gather/pop tweens settle for screenshots
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
      timeout: 10_000,
      message: `waiting for tutorial step ${stepId}`
    })
    .toBe(stepId);
}

function countOnBoard(state: GameText, chain: string, tier: number): number {
  return state.inventory[`${chain}:${tier}`] ?? 0;
}

test.describe('Emberkeep Level 1 — Cinder Hollow', () => {
  test('full tutorial: weeds → hatch → harvest → gems → ledger → key → fog → free play', async ({
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
    // Generous first poll: cold Chromium + first WebGL boot can be slow.
    await expect
      .poll(async () => (await gameText(page)).scene, { timeout: 30_000 })
      .toBe('TitleScene');
    await page.waitForTimeout(600); // let the title settle for the shot
    await page.screenshot({ path: shot('01-title') });

    await page.mouse.click(640, 386); // Play
    await expect
      .poll(async () => (await gameText(page)).scene, { timeout: 15_000 })
      .toBe('BoardScene');
    await waitStep(page, 'pip_welcome');
    let state = await gameText(page);
    expect(state.energy).toEqual({ current: 20, max: 20 });
    expect(countOnBoard(state, 'sparkweed', 1)).toBe(5);
    expect(countOnBoard(state, 'ember_dragon', 1)).toBe(3);
    expect(countOnBoard(state, 'flame_gem', 1)).toBe(5);
    expect(state.regions['level_2_gate']).toBe('unlockable');
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot('02-welcome') });

    // ---------- Merge the Spark Weeds ----------
    await tapBubble(page);
    await waitStep(page, 'pip_merge_weeds');
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot('03-weed-step') });

    await dragTile(page, [4, 8], [2, 8]);
    await waitStep(page, 'pip_warmth');
    state = await gameText(page);
    expect(countOnBoard(state, 'sparkweed', 1)).toBe(2);
    expect(countOnBoard(state, 'sparkweed', 2)).toBe(1);
    expect(state.board[8]![2]).toMatchObject({ chain: 'sparkweed', tier: 2 });
    expect(state.xp).toBeGreaterThan(0);
    await page.screenshot({ path: shot('04-weeds-merged') });

    // ---------- Merge the eggs: THE HATCHING ----------
    await tapBubble(page);
    await waitStep(page, 'pip_merge_eggs');
    await dragTile(page, [5, 8], [3, 7]);
    await waitStep(page, 'cindra_hatch'); // Cindra's proud line gates here
    state = await gameText(page);
    expect(countOnBoard(state, 'ember_dragon', 1)).toBe(0);
    expect(countOnBoard(state, 'ember_dragon', 2)).toBe(1);
    expect(state.board[7]![3]).toMatchObject({ chain: 'ember_dragon', tier: 2, ready: true });
    await page.waitForTimeout(1000); // hatch burst + pop
    await page.screenshot({ path: shot('05-hatched-cindra') });

    // ---------- Harvest a Gem Shard ----------
    await tapBubble(page);
    await waitStep(page, 'pip_harvest');
    await tapTile(page, 3, 7);
    await waitStep(page, 'pip_merge_gems');
    state = await gameText(page);
    expect(countOnBoard(state, 'flame_gem', 1)).toBe(6);
    expect(state.energy.current).toBeGreaterThanOrEqual(19 - 1);
    expect(state.energy.current).toBeLessThanOrEqual(20);
    expect(state.board[7]![3]?.ready).toBe(false); // cooldown started
    await page.waitForTimeout(450);
    await page.screenshot({ path: shot('06-harvested') });

    // ---------- Forge two Flame Gems ----------
    await dragTile(page, [4, 7], [4, 9]); // shard from the harvest joins (2,9)+(3,9)
    state = await gameText(page);
    expect(countOnBoard(state, 'flame_gem', 2)).toBe(1);
    await dragTile(page, [4, 5], [5, 7]); // joins (5,6)+(6,7)
    await waitStep(page, 'pip_ledger');
    state = await gameText(page);
    expect(countOnBoard(state, 'flame_gem', 2)).toBe(2);
    expect(state.order).toMatchObject({ deliverable: true, have: [2], need: [2] });
    await page.screenshot({ path: shot('07-two-flame-gems') });

    // ---------- Cindra's Ledger ----------
    await page.mouse.click(1202, 716); // scroll button
    await waitStep(page, 'pip_deliver');
    await page.waitForTimeout(450);
    await page.screenshot({ path: shot('08-ledger-open') });

    await page.mouse.click(790, 524); // Deliver
    await waitStep(page, 'cindra_key');
    state = await gameText(page);
    // The whole tutorial earns ~54 XP — below the level-2 cap (60) — so the
    // Keeper is still level 1 here and the order pays a clean 50 Gold. The first
    // level-up (and zone-2 camera fly) lands just after, in free play.
    expect(state.level).toBe(1);
    expect(state.coins).toBe(50);
    expect(state.keys).toBe(1);
    expect(state.completedOrders).toEqual(['cindra_brazier']);
    expect(countOnBoard(state, 'flame_gem', 2)).toBe(0);
    await page.waitForTimeout(700);
    await page.screenshot({ path: shot('09-delivered-key') });

    // ---------- Spend the key: the fog lifts ----------
    await tapBubble(page);
    await waitStep(page, 'pip_fog');
    await tapTile(page, 12, 7); // tap the authored level-2 clouds at the clearing's edge (the key gate)
    await waitStep(page, 'pip_free');
    state = await gameText(page);
    expect(state.keys).toBe(0);
    expect(state.regions['level_2_gate']).toBe('active');
    expect(countOnBoard(state, 'ember_dragon', 1)).toBe(3); // three new eggs revealed in the gate
    expect(state.board[5]![12]).toMatchObject({ decor: 'nest' });
    await page.waitForTimeout(2100); // smoke curls away, warm light floods, tiles bloom
    await page.screenshot({ path: shot('10-fog-lifted') });

    // ---------- Free play ----------
    await tapBubble(page);
    await expect.poll(async () => (await gameText(page)).tutorial.done).toBe(true);
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot('11-free-play') });

    // Generator cooldown respects advanceTime: harvest twice more.
    await page.evaluate(() => window.advanceTime(10_000));
    await tapTile(page, 3, 7);
    await expect.poll(async () => countOnBoard(await gameText(page), 'flame_gem', 1)).toBe(1);
    await tapTile(page, 3, 7); // still cooling — must not produce
    await page.waitForTimeout(400);
    expect(countOnBoard(await gameText(page), 'flame_gem', 1)).toBe(1);
    await page.evaluate(() => window.advanceTime(10_000));
    await tapTile(page, 3, 7);
    await expect.poll(async () => countOnBoard(await gameText(page), 'flame_gem', 1)).toBe(2);

    // Tooltip + sell: tap the spare weed, then its Sell button.
    const coinsBefore = (await gameText(page)).coins;
    await tapTile(page, 6, 9);
    await page.waitForTimeout(350);
    await page.screenshot({ path: shot('11b-tooltip') });
    const weedTip = await gridToPage(page, 6, 9);
    await page.mouse.click(weedTip.x, weedTip.y - 152); // Sell button inside the tooltip
    await expect.poll(async () => (await gameText(page)).coins).toBe(coinsBefore + 1);
    expect(countOnBoard(await gameText(page), 'sparkweed', 1)).toBe(1);

    // ---------- Save / reload restores mid-game state ----------
    const before = await gameText(page);
    await page.reload();
    await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
    await expect.poll(async () => (await gameText(page)).scene).toBe('TitleScene');
    await page.mouse.click(640, 386); // Continue
    await expect.poll(async () => (await gameText(page)).scene).toBe('BoardScene');
    const after = await gameText(page);
    expect(after.tutorial.done).toBe(true);
    expect(after.coins).toBe(before.coins);
    expect(after.keys).toBe(before.keys);
    expect(after.xp).toBe(before.xp);
    expect(after.board).toEqual(before.board);
    expect(after.regions['level_2_gate']).toBe('active');
    await page.waitForTimeout(600);
    await page.screenshot({ path: shot('12-reloaded') });

    // ---------- Offline energy regen on load ----------
    const savedRaw = await page.evaluate(() =>
      localStorage.getItem(window.__emberkeep.saveKey)
    );
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
    await page.mouse.click(640, 386); // Continue
    await expect.poll(async () => (await gameText(page)).scene).toBe('BoardScene');
    const regenerated = await gameText(page);
    expect(regenerated.energy.current).toBeGreaterThanOrEqual(expectedEnergy);
    expect(regenerated.energy.current).toBeLessThanOrEqual(Math.min(20, expectedEnergy + 1));

    // ---------- Level-up flies the camera to the next zone ----------
    const readCam = (): Promise<{ x: number; zoom: number; level: number }> =>
      page.evaluate(() => {
        const cam = (
          window.__emberkeep.game.scene.getScene('BoardScene') as unknown as {
            cameras: { main: { worldView: { centerX: number }; zoom: number } };
          }
        ).cameras.main;
        return { x: cam.worldView.centerX, zoom: cam.zoom, level: window.render_game_to_text().level };
      });
    const camBefore = await readCam();
    await page.evaluate(() => window.__emberkeep.grantXp(60)); // cross the level-2 cap
    await page.waitForTimeout(1900); // the smootherstep + dolly glide settles
    const camAfter = await readCam();
    expect(camAfter.level).toBe(2);
    expect(camAfter.x).toBeGreaterThan(camBefore.x + 500); // panned east, toward zone 2
    expect((await gameText(page)).regions['level_2']).toBe('active'); // zone woke
    await page.screenshot({ path: shot('13-levelup-camera-fly') });

    // ---------- No console errors anywhere in the run ----------
    expect(consoleErrors).toEqual([]);

    // FPS sanity: the loop is actually running.
    expect((await gameText(page)).fps).toBeGreaterThan(10);
  });
});
