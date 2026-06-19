import { expect, test, type Page } from '@playwright/test';

/**
 * Drives the full scripted tutorial:
 *   lore × 2 → rubies merge (red egg) → 3 eggs merge (red dragon) →
 *   crystal tap → 3 emeralds merge (green egg) → 3 green eggs merge (green dragon) →
 *   chest → level-up → key+fog → bushes merge → thank-you → EndScreen
 *
 * Cells are located dynamically via window.render_game_to_text() and
 * __emberkeep.gridToPage(); game-space coordinates are ÷2 for CSS clicks.
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
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(120);
}

/** The bubble sits at game coords ≈ (1280, 1368); CSS is ÷2. */
async function tapBubble(page: Page): Promise<void> {
  await page.mouse.click(640, 684);
}

async function waitStep(page: Page, stepId: string): Promise<void> {
  await expect
    .poll(async () => (await gameText(page)).tutorial.step, {
      timeout: 14_000,
      message: `waiting for tutorial step ${stepId}`
    })
    .toBe(stepId);
}

const count = (s: GameText, chain: string, tier: number): number =>
  s.inventory[`${chain}:${tier}`] ?? 0;

test.describe('Level 1 — Emberkeep tutorial', () => {
  test('lore → rubies → red egg → red dragon → crystal → emeralds → green eggs → green dragon → chest → level-up → fog → bushes → end', async ({
    page
  }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    // Navigate first so the origin is set, then wipe any stale save before the
    // game logic runs — guarantees we always start a fresh new game.
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => typeof window.render_game_to_text === 'function');

    // ---------- Title ----------
    await expect.poll(async () => (await gameText(page)).scene, { timeout: 30_000 }).toBe('TitleScene');
    await page.waitForTimeout(1400);
    await page.screenshot({ path: shot('01-title') });

    await page.mouse.click(640, 670); // Play
    await expect
      .poll(async () => (await gameText(page)).scene, { timeout: 15_000 })
      .toBe('BoardScene');

    // ---------- Lore 1 ----------
    await waitStep(page, 'lore_1');
    let state = await gameText(page);
    expect(state.energy).toEqual({ current: 20, max: 20 });
    // crystal is a permanent startingItem at [8,11] (non-active tile)
    expect(count(state, 'ember_dragon', 1)).toBe(0);
    expect(count(state, 'crystal', 1)).toBe(1);
    expect(state.regions['level_2_gate']).toBe('unlockable');
    await page.screenshot({ path: shot('02-lore1') });

    // ---------- Lore 2 ----------
    await tapBubble(page);
    await waitStep(page, 'lore_2');
    await page.screenshot({ path: shot('03-lore2') });

    // ---------- Ruby merge: 3 Dragon Rubies spawn, drag to hatch a Red Egg ----------
    await tapBubble(page);
    await waitStep(page, 'ruby_merge');
    state = await gameText(page);
    expect(count(state, 'ember_dragon', 1)).toBe(3);
    await page.screenshot({ path: shot('04-rubies') });

    const rubies = await findCells(page, (c) => c.chain === 'ember_dragon' && c.tier === 1);
    expect(rubies.length).toBe(3);
    await dragTile(page, rubies[2]!, rubies[0]!);
    await waitStep(page, 'dragon_hatch');
    state = await gameText(page);
    expect(count(state, 'ember_dragon', 1)).toBe(0);
    expect(count(state, 'ember_dragon', 2)).toBe(3); // 1 red egg + 2 spawned by step effects
    await page.screenshot({ path: shot('05-red-egg') });

    // ---------- Dragon hatch: merge 3 Red Eggs → Red Dragon ----------
    const redEggs = await findCells(page, (c) => c.chain === 'ember_dragon' && c.tier === 2);
    expect(redEggs.length).toBe(3);
    await dragTile(page, redEggs[2]!, redEggs[0]!);
    await waitStep(page, 'emerald_tap');
    state = await gameText(page);
    expect(count(state, 'ember_dragon', 2)).toBe(0);
    expect(count(state, 'ember_dragon', 3)).toBe(1); // Red Dragon
    expect(count(state, 'emerald', 1)).toBe(2); // 2 Emeralds from step effect
    await page.screenshot({ path: shot('06-red-dragon') });

    // ---------- Emerald tap: tap the permanent crystal fixture at [8,11] ----------
    await waitStep(page, 'emerald_tap');
    // The crystal is a permanent startingItem at [8,11] (non-active tile —
    // invisible in the board grid but present in state.items). Emit item:tapped
    // directly; same GeneratorSystem + TutorialDirector gate path as a real tap.
    await page.evaluate(() => {
      const ctx = window.__emberkeep.game.registry.get('ctx') as {
        state: { items: Map<number, { chain: string; kind: string }> };
        bus: { emit: (event: string, payload: unknown) => void };
      };
      for (const [id, item] of ctx.state.items.entries()) {
        if (item.chain === 'crystal' && item.kind === 'item') {
          ctx.bus.emit('item:tapped', { itemId: id });
          return;
        }
      }
    });
    await waitStep(page, 'emerald_egg_merge');
    state = await gameText(page);
    expect(count(state, 'emerald', 1)).toBe(3); // 2 spawned + 1 from crystal tap
    await page.screenshot({ path: shot('07-3emeralds') });

    // ---------- Emerald merge: drag 3 Emeralds → 1 Green Egg ----------
    const emeralds = await findCells(page, (c) => c.chain === 'emerald' && c.tier === 1);
    expect(emeralds.length).toBe(3);
    await dragTile(page, emeralds[2]!, emeralds[0]!);
    await waitStep(page, 'green_dragon_hatch');
    state = await gameText(page);
    expect(count(state, 'emerald', 1)).toBe(0);
    expect(count(state, 'emerald', 2)).toBe(3); // 1 from merge + 2 spawned
    await page.screenshot({ path: shot('08-3green-eggs') });

    // ---------- Green egg merge: drag 3 Green Eggs → Green Dragon ----------
    const greenEggs = await findCells(page, (c) => c.chain === 'emerald' && c.tier === 2);
    expect(greenEggs.length).toBe(3);
    await dragTile(page, greenEggs[2]!, greenEggs[0]!);
    await waitStep(page, 'chest');
    state = await gameText(page);
    expect(count(state, 'emerald', 2)).toBe(0);
    expect(count(state, 'emerald', 3)).toBe(1); // green dragon (tier 3)
    expect(count(state, 'chest', 1)).toBe(1); // chest spawned
    await page.screenshot({ path: shot('09-green-dragon') });

    // ---------- Chest: tap to open ----------
    const chests = await findCells(page, (c) => c.chain === 'chest' && c.tier === 1);
    expect(chests.length).toBe(1);
    // Emit chest:open directly — same reliability reason as the crystal tap above.
    await page.evaluate(([col, row]) => {
      const ctx = window.__emberkeep.game.registry.get('ctx') as {
        state: { items: Map<number, { chain: string; kind: string; col: number; row: number }> };
        bus: { emit: (event: string, payload: unknown) => void };
      };
      for (const [id, item] of ctx.state.items.entries()) {
        if (item.chain === 'chest' && item.kind === 'item' && item.col === col && item.row === row) {
          ctx.bus.emit('chest:open', { itemId: id });
          return;
        }
      }
    }, [chests[0]![0], chests[0]![1]] as [number, number]);
    await waitStep(page, 'levelup');
    state = await gameText(page);
    expect(count(state, 'chest', 1)).toBe(0); // consumed
    await page.screenshot({ path: shot('10-chest-opened') });

    // ---------- Level-up: grantXp fires on tap, reaching level 2 ----------
    await tapBubble(page);
    await waitStep(page, 'key_unlock');
    state = await gameText(page);
    expect(state.level).toBe(2);
    expect(state.xp).toBeGreaterThanOrEqual(60);
    expect(state.regions['level_2']).toBe('active'); // auto-unlocked at level 2
    expect(state.keys).toBe(1); // key granted by key_unlock effect
    await page.waitForTimeout(600);
    await page.screenshot({ path: shot('11-levelup') });

    // ---------- Key unlock: tap the fog ----------
    const gate = await findCells(page, (c) => c.fog === 'level_2_gate');
    expect(gate.length).toBeGreaterThan(0);
    const order = [gate[Math.floor(gate.length / 2)]!, ...gate];
    for (const cell of order) {
      if ((await gameText(page)).tutorial.step !== 'key_unlock') break;
      await page.evaluate(([c, r]) => window.__emberkeep.centerCell(c as number, r as number), [cell[0], cell[1]]);
      await page.waitForTimeout(280);
      await tapTile(page, cell[0], cell[1]);
      await page.waitForTimeout(360);
    }
    await waitStep(page, 'bush_merge');
    state = await gameText(page);
    expect(state.keys).toBe(0);
    expect(state.regions['level_2_gate']).toBe('active');
    expect(count(state, 'lumber', 1)).toBeGreaterThanOrEqual(3); // 3 bushes revealed
    await page.waitForTimeout(600);
    await page.screenshot({ path: shot('12-fog-lifted') });

    // ---------- Bush merge: drag 3 bushes → House ----------
    const bushes = await findCells(page, (c) => c.chain === 'lumber' && c.tier === 1);
    expect(bushes.length).toBeGreaterThanOrEqual(3);
    // Centre on the first bush to ensure all bush cells are in view.
    await page.evaluate(
      ([c, r]) => window.__emberkeep.centerCell(c as number, r as number),
      [bushes[0]![0], bushes[0]![1]]
    );
    await page.waitForTimeout(250);
    await dragTile(page, bushes[2]!, bushes[0]!);
    await waitStep(page, 'thank_you');
    state = await gameText(page);
    expect(count(state, 'lumber', 2)).toBeGreaterThanOrEqual(1); // house produced
    await page.screenshot({ path: shot('13-house-built') });

    // ---------- Thank you: tap → EndScreen + tutorialDone ----------
    await tapBubble(page);
    await expect.poll(async () => (await gameText(page)).tutorial.done, { timeout: 8_000 }).toBe(true);
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot('14-end-screen') });

    // ---------- Save / reload restores mid-game state ----------
    const before = await gameText(page);
    await page.reload();
    await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
    await expect.poll(async () => (await gameText(page)).scene).toBe('TitleScene');
    await page.waitForTimeout(1200);
    await page.mouse.click(640, 670); // Continue
    await expect.poll(async () => (await gameText(page)).scene).toBe('BoardScene');
    const after = await gameText(page);
    expect(after.tutorial.done).toBe(true);
    expect(after.keys).toBe(before.keys);
    expect(after.xp).toBe(before.xp);
    expect(after.board).toEqual(before.board);
    expect(after.regions['level_2_gate']).toBe('active');
    await page.screenshot({ path: shot('15-reloaded') });

    // ---------- Offline energy regen on load ----------
    const savedRaw = await page.evaluate(() => localStorage.getItem(window.__emberkeep.saveKey));
    expect(savedRaw).not.toBeNull();
    const saved = JSON.parse(savedRaw!) as {
      savedAt: number;
      energy: { current: number; lastRegenAt: number };
    };
    saved.energy.lastRegenAt -= 540_500;
    saved.savedAt -= 540_500;
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key as string, value as string),
      [await page.evaluate(() => window.__emberkeep.saveKey), JSON.stringify(saved)]
    );
    await page.reload();
    await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
    await expect.poll(async () => (await gameText(page)).scene).toBe('TitleScene');
    await page.waitForTimeout(1200);
    await page.mouse.click(640, 670); // Continue
    await expect.poll(async () => (await gameText(page)).scene).toBe('BoardScene');
    const regenerated = await gameText(page);
    // Use the actual energyMax (grows with level: level 2 = 23) so the cap is correct.
    const energyMax = regenerated.energy.max;
    const expectedEnergy = Math.min(energyMax, saved.energy.current + 3);
    expect(regenerated.energy.current).toBeGreaterThanOrEqual(expectedEnergy);
    expect(regenerated.energy.current).toBeLessThanOrEqual(Math.min(energyMax, expectedEnergy + 1));

    // ---------- No console errors anywhere in the run ----------
    expect(consoleErrors).toEqual([]);
    expect((await gameText(page)).fps).toBeGreaterThan(1);
  });
});
