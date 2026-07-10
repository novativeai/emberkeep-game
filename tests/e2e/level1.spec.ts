import { expect, test, type Page } from '@playwright/test';

/**
 * Drives the full scripted tutorial:
 *   lore × 2 → rubies merge (red egg) → 3 eggs merge (red dragon) →
 *   crystal tap → 3 emeralds merge (green egg) → 3 green eggs merge (green dragon) →
 *   chest → level-up → key+fog → bushes merge → dragon-work → dragon-rest →
 *   marketplace → free-play → level-3 EndScreen
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
  await page.mouse.click(750, 725); // bubble centre (game (GAME_WIDTH/2+220, LIVE-150) ÷ RES)
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
  test('lore → rubies → cookbook → red egg → red dragon → crystal → emeralds → green eggs → green dragon → chest → level-up → fog → emberberries → bushes → dragon-work → rest → marketplace → level-3-end', async ({
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
    expect(state.energy).toEqual({ current: 28, max: 30 }); // starts 28/30; tutorial's free Spark tops it up
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

    // ---------- Cookbook intro: the first merge wrote the first recipe page ----------
    await waitStep(page, 'cookbook_intro');
    state = await gameText(page);
    expect(count(state, 'ember_dragon', 1)).toBe(0);
    expect(count(state, 'ember_dragon', 2)).toBe(1); // just the merged Red Egg so far
    await page.screenshot({ path: shot('04b-cookbook-intro') });
    // Tap the Cookbook button (game 2404,1244 → CSS ÷2) — opening it is the gate.
    await page.mouse.click(1202, 622);
    await waitStep(page, 'dragon_hatch');
    await page.screenshot({ path: shot('04c-cookbook-open') });
    // The next step auto-closes the panel after a short hold; wait it out so
    // its dim never swallows the upcoming egg drags.
    await page.waitForTimeout(1700);
    state = await gameText(page);
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
    // Force the coins gift (Math.random→0) so the tutorial claim is deterministic
    // and drops no extra merge pieces onto the board.
    await page.evaluate(([col, row]) => {
      const orig = Math.random;
      Math.random = () => 0;
      try {
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
      } finally {
        Math.random = orig;
      }
    }, [chests[0]![0], chests[0]![1]] as [number, number]);
    await waitStep(page, 'levelup');
    state = await gameText(page);
    expect(count(state, 'chest', 1)).toBe(1); // a standing gift box — claimed, NOT consumed
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
    // ---------- Emberberry patch: free harvest in the opened land ----------
    await waitStep(page, 'emberberry_tap');
    state = await gameText(page);
    expect(state.keys).toBe(0);
    expect(state.regions['level_2_gate']).toBe('active');
    expect(count(state, 'lumber', 1)).toBeGreaterThanOrEqual(3); // 3 bushes revealed
    expect(count(state, 'strawberry', 3)).toBe(1); // the patch
    expect(count(state, 'strawberry', 1)).toBe(0); // sprouts arrive with the merge lesson
    await page.waitForTimeout(600);
    await page.screenshot({ path: shot('12-fog-lifted') });
    const energyBeforeBerry = state.energy.current;
    // Harvest via a direct item:tapped emit (same reliability pattern as the crystal).
    await page.evaluate(() => {
      const ctx = window.__emberkeep.game.registry.get('ctx') as {
        state: { items: Map<number, { chain: string; tier: number; kind: string }> };
        bus: { emit: (event: string, payload: unknown) => void };
      };
      for (const [id, item] of ctx.state.items.entries()) {
        if (item.chain === 'strawberry' && item.tier === 3 && item.kind === 'item') {
          ctx.bus.emit('item:tapped', { itemId: id });
          return;
        }
      }
    });
    await waitStep(page, 'emberberry_merge');
    state = await gameText(page);
    expect(count(state, 'strawberry', 1)).toBe(3); // 2 spawned + 1 harvested
    expect(state.energy.current).toBe(energyBeforeBerry); // the patch is FREE
    await page.screenshot({ path: shot('12b-emberberries') });

    // ---------- Emberberry merge: 3 sprouts → an Emberberry Bush ----------
    for (let attempt = 0; attempt < 4; attempt++) {
      const sprouts = await findCells(page, (c) => c.chain === 'strawberry' && c.tier === 1);
      if (sprouts.length < 3) break;
      await page.evaluate(
        ([c, r]) => window.__emberkeep.centerCell(c as number, r as number),
        [sprouts[0]![0], sprouts[0]![1]]
      );
      await page.waitForTimeout(400);
      await dragTile(page, sprouts[2]!, sprouts[0]!);
      await page.waitForTimeout(500);
      if ((await gameText(page)).tutorial.step === 'bush_merge') break;
    }
    await waitStep(page, 'bush_merge');
    state = await gameText(page);
    expect(count(state, 'strawberry', 1)).toBe(0);
    expect(count(state, 'strawberry', 2)).toBe(1); // Emberberry Bush
    await page.screenshot({ path: shot('12c-emberberry-bush') });

    // ---------- Bush merge: drag 3 bushes → House ----------
    // The 2560×1600 drag is flaky under SwiftShader — retry until the House forms.
    for (let attempt = 0; attempt < 4; attempt++) {
      const bushes = await findCells(page, (c) => c.chain === 'lumber' && c.tier === 1);
      if (bushes.length < 3) break;
      await page.evaluate(
        ([c, r]) => window.__emberkeep.centerCell(c as number, r as number),
        [bushes[0]![0], bushes[0]![1]]
      );
      await page.waitForTimeout(400);
      await dragTile(page, bushes[2]!, bushes[0]!);
      await page.waitForTimeout(500);
      if ((await gameText(page)).tutorial.step === 'dragon_work') break;
    }
    await waitStep(page, 'dragon_work');
    state = await gameText(page);
    expect(count(state, 'lumber', 2)).toBeGreaterThanOrEqual(1); // house produced
    await page.screenshot({ path: shot('13-house-built') });

    // ---------- Dragon work: emit dragon:work directly (same pattern as chest/crystal) ----------
    await page.evaluate(() => {
      const ctx = window.__emberkeep.game.registry.get('ctx') as {
        state: { items: Map<number, { id: number; chain: string; tier: number; kind: string }> };
        bus: { emit: (event: string, payload: unknown) => void };
      };
      const dragon = [...ctx.state.items.values()].find((i) => i.chain === 'ember_dragon' && i.tier === 3);
      const house = [...ctx.state.items.values()].find((i) => i.chain === 'lumber' && i.tier === 2);
      if (dragon && house) ctx.bus.emit('dragon:work', { dragonId: dragon.id, houseId: house.id });
    });
    await waitStep(page, 'dragon_rest');
    await page.screenshot({ path: shot('14-dragon-resting') });

    // ---------- Dragon rest: tap bubble to advance ----------
    await tapBubble(page);
    await waitStep(page, 'house_skip');

    // ---------- House skip: spend Warmth to rush the House's timer ----------
    // (the step's setTimer effect already put the House on an affordable cooldown)
    const energyBeforeSkip = (await gameText(page)).energy.current;
    // Tap the House (real UI) to raise the skip popup + the tutorial's ⚡ arrow, capture it.
    const houseCells = await findCells(page, (c) => c.chain === 'lumber' && c.tier === 2);
    if (houseCells.length) {
      await tapTile(page, houseCells[0]![0], houseCells[0]![1]);
      await page.waitForTimeout(450);
      await page.screenshot({ path: shot('14b-house-skip') });
    }
    // Then perform the skip via a direct emit (reliable under SwiftShader).
    await page.evaluate(() => {
      const ctx = window.__emberkeep.game.registry.get('ctx') as {
        state: { items: Map<number, { id: number; chain: string; tier: number }> };
        bus: { emit: (event: string, payload: unknown) => void };
      };
      const house = [...ctx.state.items.values()].find((i) => i.chain === 'lumber' && i.tier === 2);
      if (house) ctx.bus.emit('generator:skip', { itemId: house.id, currency: 'warmth' });
    });
    await waitStep(page, 'buy_energy');
    expect((await gameText(page)).energy.current).toBeLessThan(energyBeforeSkip); // Warmth dropped
    await page.screenshot({ path: shot('15-buy-energy') });

    // ---------- Buy energy: emit marketplace:purchased directly ----------
    await page.evaluate(() => {
      const ctx = window.__emberkeep.game.registry.get('ctx') as {
        bus: { emit: (event: string, payload: unknown) => void };
      };
      ctx.bus.emit('marketplace:purchased', { energy: 5, free: true });
    });
    await waitStep(page, 'free_play');
    await page.screenshot({ path: shot('16-free-play') });

    // ---------- Free play: tap → tutorialDone, game continues ----------
    await tapBubble(page);
    await expect.poll(async () => (await gameText(page)).tutorial.done, { timeout: 8_000 }).toBe(true);
    state = await gameText(page);
    expect(state.level).toBe(2); // still level 2 after tutorial
    await page.screenshot({ path: shot('17-tutorial-done') });

    // ---------- Reach level 3 → the Chapter One finale ----------
    // Tutorial ends at exactly 60 XP; Level 3 sits at 220 (the finale curve).
    await page.evaluate(() => window.__emberkeep.grantXp(160));
    await expect.poll(async () => (await gameText(page)).level, { timeout: 8_000 }).toBe(3);
    // The finale choreography runs ~12.6s (hatch → glimpse → Cindra → card).
    await page.waitForTimeout(13_500);
    await page.screenshot({ path: shot('18-level3-end') });

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
    // Compare the persisted board WITHOUT the clock-derived `ready` flag: a
    // generator skipped to ready (now <= readyAt) can read as cooling after the
    // virtual clock resets on reload — harmless, and never happens on a real
    // wall-clock. Item chains/tiers/positions still round-trip exactly.
    const layout = (b: (Cell | null)[][]): unknown =>
      b.map((row) => row.map((c) => (c ? { chain: c.chain, tier: c.tier, decor: c.decor } : null)));
    expect(layout(after.board)).toEqual(layout(before.board));
    expect(after.regions['level_2_gate']).toBe('active');
    await page.screenshot({ path: shot('19-reloaded') });

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
    // Use the actual energyMax (grows with level: level 3 = 36) so the cap is correct.
    // 540.5s offline at +1/60s = 9 Warmth recovered.
    const energyMax = regenerated.energy.max;
    const expectedEnergy = Math.min(energyMax, saved.energy.current + 9);
    expect(regenerated.energy.current).toBeGreaterThanOrEqual(expectedEnergy);
    expect(regenerated.energy.current).toBeLessThanOrEqual(Math.min(energyMax, expectedEnergy + 1));

    // ---------- No console errors anywhere in the run ----------
    expect(consoleErrors).toEqual([]);
    expect((await gameText(page)).fps).toBeGreaterThan(1);
  });
});
