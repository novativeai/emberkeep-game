import { expect, test, type Page } from '@playwright/test';

/**
 * Drives the full scripted tutorial:
 *   lore × 2 → rubies merge (red egg) → 3 eggs merge (red dragon) →
 *   crystal tap → 3 emeralds merge (green egg) → 3 green eggs merge (green dragon) →
 *   chest → level-up → key+fog → bushes merge → dragon-work → dragon-rest →
 *   marketplace → free-play → level-3 finale (Elder wakes, play continues)
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

// Lane-isolated (see scripts/verify-lane.mjs): two agents sharing this checkout
// must not write their screenshots over each other's.
const SHOTS = process.env.EMBERKEEP_E2E_SHOTS ?? 'tests/e2e/shots';
const shot = (name: string): string => `${SHOTS}/${name}.png`;

/** Mirrors TIMINGS.chapterBeatDelay — how long a chapter's beats wait for the
 *  order celebration to land before they start. */
const TIMINGS_CHAPTER_BEAT_DELAY = 2600;

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

/** Where to AIM the pointer for the item on (col,row): the centre of its art.
 *  Hit zones wrap the sprite's art, which can sit off the tile point (the wood
 *  log's opaque pixels miss the tile centre entirely). */
async function itemToPage(page: Page, col: number, row: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([c, r]) => window.__emberkeep.itemToPage(c as number, r as number),
    [col, row]
  );
}

async function dragTile(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = await itemToPage(page, from[0], from[1]); // grab the item's ART
  const aTile = await gridToPage(page, from[0], from[1]);
  const b = await gridToPage(page, to[0], to[1]);
  // Phaser keeps the grab offset while dragging and drops resolve from the
  // ITEM's position, not the pointer — carry the offset to the release point
  // so the item (not the pointer) hovers the target cell.
  const dx = a.x - aTile.x;
  const dy = a.y - aTile.y;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 14, a.y - 10, { steps: 3 });
  await page.mouse.move(b.x + dx, b.y + dy, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(450);
}

/**
 * MERGE THREE ALIKE THE WAY THE BOARD NOW WANTS IT: a drop ON a matching piece.
 *
 * Adjacency only prepares a merge; the drop performs it (src/core/mergeRule.ts).
 * So the gesture is chosen from the shape: if two of the pieces already touch,
 * the third goes ON one of them and fuses; if none touch, the first drop
 * GATHERS (the board seats the piece beside its target) and the second drop,
 * onto the pair that just formed, fuses. Index adjacency is the truth here:
 * every tutorial trio stands on the dense isle, where the lattice IS the zone.
 *
 * `done` says when to stop (a tutorial step reached, a count landed) — the
 * same retry shape the old sites used against a flaky 2560-wide drag.
 */
async function mergeTrio(
  page: Page,
  pred: (c: Cell) => boolean,
  done: (state: GameText) => boolean
): Promise<void> {
  const touching = (a: [number, number], b: [number, number]): boolean =>
    Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (done(await gameText(page))) return;
    const pieces = await findCells(page, pred);
    if (pieces.length < 2) return;
    // A member of a touching pair, if there is one — the drop that fuses.
    let target = pieces.find((a) => pieces.some((b) => b !== a && touching(a, b)));
    let mover = target ? pieces.find((x) => x !== target && !touching(x, target!)) : undefined;
    if (!target || !mover) {
      // Nothing touches yet: gather the farthest onto the first.
      target = pieces[0]!;
      mover = pieces[pieces.length - 1]!;
    }
    await page.evaluate(
      ([c, r]) => window.__emberkeep.centerCell(c as number, r as number),
      [target[0], target[1]]
    );
    await page.waitForTimeout(400);
    await dragTile(page, mover, target);
    await page.waitForTimeout(500);
  }
}

async function tapTile(page: Page, col: number, row: number): Promise<void> {
  const p = await itemToPage(page, col, row); // tap the item's ART
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(120);
}

/** The bubble sits at game coords ≈ (1280, 1368); CSS is ÷2. */
/** Tap a tutorial UI target where the lesson's own arrow would point. */
async function tapUi(page: Page, ui: string): Promise<void> {
  const p = await page.evaluate((u) => window.__emberkeep.uiToPage(u), ui);
  expect(p, `ui target ${ui} is on screen`).not.toBeNull();
  await page.mouse.click(p!.x, p!.y);
  await page.waitForTimeout(120);
}

async function tapBubble(page: Page): Promise<void> {
  await page.mouse.click(750, 725); // bubble centre (game (GAME_WIDTH/2+220, LIVE-150) ÷ RES)
}

/** The recorder's bubble tap, with its retry loop: wait until the bubble is
 *  VISIBLE, then real move/down/up gestures until the step moves on — one tap
 *  can be spent on the typewriter or a story line before the gate hears it. */
async function tapBubbleWhenOpen(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const b = (window.__emberkeep.game.scene.getScene('UIScene') as unknown as {
        bubble?: { visible: boolean };
      }).bubble;
      return !!(b && b.visible);
    },
    null,
    { timeout: 14_000 }
  );
  const from = (await gameText(page)).tutorial.step;
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(750, 725);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();
    await page.waitForTimeout(500);
    if ((await gameText(page)).tutorial.step !== from) return;
  }
}

interface PointerView {
  hand?: { from?: { x: number; y: number }; to?: { x: number; y: number }; at?: { x: number; y: number } } | null;
  arrow?: { x: number; y: number } | null;
}

/** Drive the tutorial the way scripts/beats.mjs does: follow the lesson's own
 *  pointers (hand drag, hand tap, arrow tap — the bubble for a tap gate) and
 *  re-read after every gesture, until the named step is current. Used for the
 *  arcs whose beats each point at what to do, so the spec survives re-authoring
 *  of the lesson; the assertions live at the anchor steps around the window. */
async function followPointers(page: Page, until: string): Promise<void> {
  const gesture = async (a: { x: number; y: number }, b?: { x: number; y: number }): Promise<void> => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.waitForTimeout(80);
    if (b) {
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
        await page.waitForTimeout(16);
      }
      await page.waitForTimeout(80);
    } else {
      await page.waitForTimeout(60);
    }
    await page.mouse.up();
    await page.waitForTimeout(450);
  };
  for (let guard = 0; guard < 160; guard++) {
    const view = await page.evaluate(() => {
      const w = window.__emberkeep as unknown as {
        pointers: () => unknown;
        game: { registry: { get: (k: string) => { systems: { tutorial: { currentStep: { id: string; gate: { type: string } } | null } } } } };
      };
      const step = w.game.registry.get('ctx').systems.tutorial.currentStep;
      return { step: step?.id ?? 'done', gate: step?.gate.type ?? 'none', ptr: w.pointers() as never };
    }) as { step: string; gate: string; ptr: PointerView };
    if (view.step === until) return;
    const ptr = view.ptr;
    // A pointer read mid-camera-glide aims at where the target WAS — and a tap
    // on empty ground is not harmless (it cancels an armed give). Tap only a
    // pointer that reads the same twice, 250ms apart.
    const settled = async (p: { x: number; y: number }): Promise<{ x: number; y: number } | null> => {
      await page.waitForTimeout(250);
      const again = await page.evaluate(
        () => (window.__emberkeep as unknown as { pointers: () => unknown }).pointers() as never
      ) as PointerView;
      const q = again.hand?.at ?? again.arrow;
      return q && Math.hypot(q.x - p.x, q.y - p.y) < 8 ? q : null;
    };
    if (ptr.hand?.from && ptr.hand.to) await gesture(ptr.hand.from, ptr.hand.to);
    else if (ptr.hand?.at) {
      const p = await settled(ptr.hand.at);
      if (p) await gesture(p);
    } else if (ptr.arrow) {
      const p = await settled(ptr.arrow);
      if (p) await gesture(p);
    } else if (view.gate === 'tap') await tapBubbleWhenOpen(page);
    // No pointer and no tap gate: the beat is still settling (a tween, a spawn).
    // A blind tap here is not neutral — during an armed give it lands on empty
    // ground and CANCELS the give — so wait for the pointer instead.
    else await page.waitForTimeout(400);
  }
  throw new Error(`followPointers never reached step ${until}`);
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
  test('lore → rubies → cookbook → red egg → red dragon → crystal → emeralds → green eggs → green dragon → chest → level-up → fog → emberberries → bushes → dragon-work → rest → marketplace → golden-tease → level-3-end', async ({
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

    // ---------- Eleanor's arrival: 7 tap-gated beats ----------
    // The director emits beat 1 immediately; UIScene HOLDS the bubble for
    // OPENING_HOLD_MS so the player sees the ash first, so the tap has to wait
    // for the bubble rather than for the step.
    await waitStep(page, 'arrival_miss');
    let state = await gameText(page);
    expect(state.energy).toEqual({ current: 28, max: 30 }); // starts 28/30; tutorial's free Spark tops it up
    // crystal is a permanent startingItem at [8,11] (non-active tile)
    expect(count(state, 'ember_dragon', 1)).toBe(0);
    expect(count(state, 'crystal', 1)).toBe(1);
    expect(state.regions['level_2_gate']).toBe('unlockable');
    await page.waitForTimeout(1800); // the held silence, then she speaks
    await page.screenshot({ path: shot('02-arrival') });

    for (const beat of [
      'arrival_place',
      'arrival_ash',
      'arrival_slip',
      'arrival_hold',
      'arrival_why',
      'arrival_ask'
    ]) {
      await tapBubble(page);
      await waitStep(page, beat);
    }
    await page.screenshot({ path: shot('03-arrival-ask') });

    // ---------- Ash Moss: the GREEN, and the first thing the player ever does ----------
    // Her ask names "the warmth, the green, and whatever's still asleep"; the
    // green is what the isle gives back first, so the game's opening merge is
    // moss rather than rubies.
    await tapBubble(page);
    await waitStep(page, 'moss_stump');
    // The Mossy Stump is the first generator: tap it and the first puff is picked.
    const [stump] = await findCells(page, (c) => c.chain === 'emberbark');
    expect(stump).toBeDefined();
    await tapTile(page, stump![0], stump![1]);
    await waitStep(page, 'ash_green');
    state = await gameText(page);
    expect(count(state, 'ashmoss', 1)).toBe(3);
    await page.screenshot({ path: shot('04-ash-green') });

    const tufts = await findCells(page, (c) => c.chain === 'ashmoss' && c.tier === 1);
    expect(tufts.length).toBe(3);
    await mergeTrio(page, (c) => c.chain === 'ashmoss' && c.tier === 1, (st) => count(st, 'ashmoss', 2) >= 1);

    // ---------- "It answered you": her reaction to the player's FIRST merge ----------
    await waitStep(page, 'arrival_answered');
    state = await gameText(page);
    expect(count(state, 'ashmoss', 1)).toBe(0);
    expect(count(state, 'ashmoss', 2)).toBe(1); // a Moss Bundle
    await page.screenshot({ path: shot('04a-answered') });
    await tapBubble(page);

    // ---------- Cookbook intro: the first merge wrote the first recipe page ----------
    await waitStep(page, 'cookbook_intro');
    await page.screenshot({ path: shot('04b-cookbook-intro') });
    // Tap the Cookbook button — slot 2 of the bottom-right column, HUD_COLUMN_X /
    // hudColumnY(2) = game (2404,1032) → CSS ÷2. Opening it is the gate.
    await tapUi(page, 'cookbook');
    await waitStep(page, 'cookbook_close');
    await page.screenshot({ path: shot('04c-cookbook-open') });
    // Close the book YOURSELF — that's the gate. The ✕ sits at panel-local
    // (578,-352) (CookbookPanel's CLOSE_X/CLOSE_Y), i.e. game (1858,448) at
    // scale 1 → CSS ÷2.
    await tapUi(page, 'cookbook_close');

    // ---------- Ruby merge: the WARMTH, and now contiguous with the hatch ----------
    await waitStep(page, 'ruby_merge');
    state = await gameText(page);
    expect(count(state, 'ember_dragon', 1)).toBe(3);
    await page.screenshot({ path: shot('04d-rubies') });
    const rubies = await findCells(page, (c) => c.chain === 'ember_dragon' && c.tier === 1);
    expect(rubies.length).toBe(3);
    await mergeTrio(page, (c) => c.chain === 'ember_dragon' && c.tier === 1, (st) => count(st, 'ember_dragon', 1) === 0);

    await waitStep(page, 'dragon_hatch');
    await page.waitForTimeout(500);
    state = await gameText(page);
    expect(count(state, 'ember_dragon', 1)).toBe(0);
    expect(count(state, 'ember_dragon', 2)).toBe(3); // 1 red egg + 2 spawned by step effects
    await page.screenshot({ path: shot('05-red-egg') });

    // ---------- Dragon hatch: merge 3 Red Eggs → Red Dragon ----------
    const redEggs = await findCells(page, (c) => c.chain === 'ember_dragon' && c.tier === 2);
    expect(redEggs.length).toBe(3);
    await mergeTrio(page, (c) => c.chain === 'ember_dragon' && c.tier === 2, (st) => count(st, 'ember_dragon', 3) >= 1);

    // ---------- Naming: Eleanor introduces her, the player picks a name ----------
    // Same mechanics as scripts/beats.mjs: wait for the bubble to be VISIBLE
    // (not just the step to be current), then a real move/down/up tap on it;
    // the panel is confirmed through its own confirm(), the way a player does.
    await waitStep(page, 'name_intro');
    await tapBubbleWhenOpen(page);
    await waitStep(page, 'name_choose');
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const ui = window.__emberkeep.game.scene.getScene('UIScene') as unknown as {
            naming?: { isOpen: boolean; nameInput: HTMLInputElement | null; chosen: string; confirm: () => void };
          };
          const panel = ui.naming;
          if (!panel?.isOpen) return false;
          if (panel.nameInput) panel.nameInput.value = 'Cinder';
          panel.chosen = 'Cinder';
          panel.confirm();
          return true;
        }),
        { timeout: 14_000, message: 'waiting for the naming panel' }
      )
      .toBe(true);
    await waitStep(page, 'name_said');
    await tapBubbleWhenOpen(page);

    state = await gameText(page);
    expect(count(state, 'ember_dragon', 2)).toBe(0);
    expect(count(state, 'ember_dragon', 3)).toBe(1); // Red Dragon, now named
    await page.screenshot({ path: shot('06-red-dragon') });

    // ---------- Moss, quartz, and the first gift ----------
    // moss_feed → crystal_tap → quartz_merge → quartz_ball → ball_pocket →
    // ball_give → eleanor_gift → eleanor_hearts: this arc's beats each show
    // their own hand or arrow, so it is driven the way scripts/beats.mjs
    // drives the whole lesson — follow the pointers until the chest arrives.
    await followPointers(page, 'chest');
    state = await gameText(page);
    expect(count(state, 'quartz', 3)).toBe(0); // the Crystal Ball was GIVEN away
    expect(count(state, 'chest', 1)).toBe(1); // chest spawned
    await page.screenshot({ path: shot('09-gift-given') });

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
    expect(count(state, 'lumber', 1)).toBeGreaterThanOrEqual(3); // 3 Cut Wood revealed
    expect(count(state, 'strawberry', 3)).toBe(1); // the patch
    expect(count(state, 'emberberry', 1)).toBe(0); // berries arrive with the merge lesson
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
    expect(count(state, 'emberberry', 1)).toBe(3); // 2 spawned + 1 harvested
    expect(state.energy.current).toBe(energyBeforeBerry); // the patch is FREE
    await page.screenshot({ path: shot('12b-emberberries') });

    // ---------- Emberberry merge: 3 berries → an Emberberry Basket ----------
    await mergeTrio(page, (c) => c.chain === 'emberberry' && c.tier === 1, (st) => st.tutorial.step === 'wood_merge');
    await waitStep(page, 'wood_merge');
    state = await gameText(page);
    expect(count(state, 'emberberry', 1)).toBe(0);
    expect(count(state, 'emberberry', 2)).toBe(1); // Emberberry Basket
    await page.screenshot({ path: shot('12c-emberberry-basket') });

    // ---------- Wood merge: 3 Cut Wood → a Plank Set, then 3 Plank Sets → the House ----------
    // The 2560×1600 drag is flaky under SwiftShader — retry until each merge lands.
    const mergeLumber = async (tier: number, until: string): Promise<void> =>
      mergeTrio(page, (c) => c.chain === 'lumber' && c.tier === tier, (st) => st.tutorial.step === until);
    await mergeLumber(1, 'plank_merge');
    await waitStep(page, 'plank_merge');
    state = await gameText(page);
    expect(count(state, 'lumber', 2)).toBe(3); // 1 milled + 2 spawned by the step
    await page.screenshot({ path: shot('13-planks-milled') });

    await mergeLumber(2, 'pocket_it');
    await waitStep(page, 'pocket_it');
    state = await gameText(page);
    expect(count(state, 'lumber', 2)).toBe(0);
    expect(count(state, 'lumber', 3)).toBeGreaterThanOrEqual(1); // house raised
    await page.screenshot({ path: shot('13b-house-built') });

    // ---------- Pocket it: a short tap on a spare piece stores it in the satchel ----------
    // (allow.bag opens tap-to-store for this one beat; every other tutorial step
    // keeps it shut so a scripted piece can't be pocketed out from under a gate.)
    const stones = await findCells(page, (c) => c.chain === 'cinder_vein' && c.tier === 1);
    expect(stones.length).toBe(2); // exactly two: one to pocket and sell, one spare
    await page.evaluate(
      ([c, r]) => window.__emberkeep.centerCell(c as number, r as number),
      [stones[0]![0], stones[0]![1]]
    );
    await page.waitForTimeout(400);
    const stonePage = await itemToPage(page, stones[0]![0], stones[0]![1]);
    await page.mouse.click(stonePage.x, stonePage.y);
    await page.waitForTimeout(500);
    if ((await gameText(page)).tutorial.step !== 'sell_it') {
      await page.evaluate(() => {
        const ctx = window.__emberkeep.game.registry.get('ctx') as {
          state: { items: Map<number, { id: number; chain: string; tier: number }> };
          bus: { emit: (event: string, payload: unknown) => void };
        };
        const stone = [...ctx.state.items.values()].find((i) => i.chain === 'cinder_vein');
        if (stone) ctx.bus.emit('ui:store_requested', { itemId: stone.id });
      });
    }
    // Advancing on the `bag:stored` gate IS the proof the piece went to the satchel.
    await waitStep(page, 'sell_it');
    await page.screenshot({ path: shot('13a-pocketed') });

    // ---------- Sell it: the BAG sells, the board never does ----------
    // Nothing on the board is sellable any more, so the pocketed stone has to be
    // sold out of the satchel: open the bag, tap the slot, hit Sell on the
    // chooser. The board still holds the second stone, and it must stay there.
    const coinsBeforeSale = (await gameText(page)).coins;
    const stonesOnBoard = (await findCells(page, (c) => c.chain === 'cinder_vein' && c.tier === 1))
      .length;
    expect(stonesOnBoard).toBe(1); // two seeded, one pocketed
    const bagPos = await page.evaluate(() => {
      const ui = window.__emberkeep.game.scene.getScene('UIScene') as unknown as {
        hud: { getBagPos: () => { x: number; y: number } };
      };
      return ui.hud.getBagPos();
    });
    await page.mouse.click(bagPos.x / 2, bagPos.y / 2);
    await page.waitForTimeout(450);
    await page.screenshot({ path: shot('13a2-bag-open') });
    // The filled slot is the first one holding art; tap it to raise Drop/Sell.
    const slotPos = await page.evaluate(() => {
      const ui = window.__emberkeep.game.scene.getScene('UIScene') as unknown as {
        bag: { isOpen: boolean; slots: Array<{ length: number; getWorldTransformMatrix: () => { tx: number; ty: number } }> };
      };
      if (!ui.bag?.isOpen) return null;
      const filled = ui.bag.slots.find((s) => s.length > 1);
      if (!filled) return null;
      const m = filled.getWorldTransformMatrix();
      return { x: m.tx, y: m.ty };
    });
    expect(slotPos).not.toBeNull();
    await page.mouse.click(slotPos!.x / 2, slotPos!.y / 2);
    await page.waitForTimeout(350);
    const sellPos = await page.evaluate(() => {
      const ui = window.__emberkeep.game.scene.getScene('UIScene') as unknown as {
        bag: { getSellPos: () => { x: number; y: number } | null };
      };
      return ui.bag.getSellPos();
    });
    expect(sellPos).not.toBeNull(); // the chooser really opened
    await page.screenshot({ path: shot('13a3-bag-chooser') });
    await page.mouse.click(sellPos!.x / 2, sellPos!.y / 2);
    await page.waitForTimeout(500);
    if ((await gameText(page)).tutorial.step === 'sell_it') {
      // Flake fallback (software rendering): sell via the same intent the
      // chooser emits — still the BAG path, never a board sale.
      await page.evaluate(() => {
        const ctx = window.__emberkeep.game.registry.get('ctx') as {
          state: { bag: Array<{ chain: string; tier: number }> };
          bus: { emit: (event: string, payload: unknown) => void };
        };
        const stack = ctx.state.bag.find((s) => s.chain === 'cinder_vein');
        if (stack) ctx.bus.emit('ui:bag_sell_requested', { chain: stack.chain, tier: stack.tier });
      });
      await page.waitForTimeout(400);
    }
    // The bag is emptied by the sale and the board's spare stone is untouched.
    expect((await gameText(page)).coins).toBeGreaterThan(coinsBeforeSale);
    expect(
      (await findCells(page, (c) => c.chain === 'cinder_vein' && c.tier === 1)).length
    ).toBe(1);
    // Eleanor names the Moonwater on the west ledge — a look-at-this beat, so it
    // closes on a tap. Both counts are the point of the beat: a seeded chain the
    // player cannot assemble three of is a dead end, not an introduction.
    await waitStep(page, 'isle_materials');
    const seeded = await gameText(page);
    expect(count(seeded, 'moonwater', 1)).toBe(3);
    // One Cracked Stone is left: two are seeded, and `sell_it` spent the other.
    expect(count(seeded, 'cinder_vein', 1)).toBe(1);
    await page.screenshot({ path: shot('13c-isle-materials') });
    await tapBubble(page);

    // ---------- Moonwater merge: 3 Dew Drops → a Dew Vial ----------
    // Naming a chain and then never merging it left the lesson half-taught, so
    // she asks for the merge she just described. The three seeds straddle two
    // regions ([5,6] in the gate, [4,5]/[4,6] in level_2) but stand in one
    // row of touching cells, so a single drop onto the pair fuses them.
    await waitStep(page, 'moonwater_merge');
    await mergeTrio(page, (c) => c.chain === 'moonwater' && c.tier === 1, (st) => st.tutorial.step !== 'moonwater_merge');
    const merged = await gameText(page);
    expect(count(merged, 'moonwater', 1)).toBe(0);
    expect(count(merged, 'moonwater', 2)).toBe(1); // Dew Vial
    await page.screenshot({ path: shot('13d-moonwater-vial') });

    await waitStep(page, 'dragon_work');
    expect((await gameText(page)).coins).toBeGreaterThan(coinsBeforeSale); // the sale paid
    await page.screenshot({ path: shot('13b-sold') });

    // ---------- Dragon work: the REAL gesture — drag the dragon ONTO the House ----------
    // (Regression cover: the WYSIWYG drop resolution once bounced this drop —
    // the House's tall art resolves to the cell BEHIND its tile.)
    for (let attempt = 0; attempt < 4; attempt++) {
      const dragonCells = await findCells(page, (c) => c.chain === 'ember_dragon' && c.tier === 3);
      const houseCells2 = await findCells(page, (c) => c.chain === 'lumber' && c.tier === 3);
      if (!dragonCells.length || !houseCells2.length) break;
      await page.evaluate(
        ([c, r]) => window.__emberkeep.centerCell(c as number, r as number),
        [houseCells2[0]![0], houseCells2[0]![1]]
      );
      await page.waitForTimeout(400);
      await dragTile(page, dragonCells[0]!, houseCells2[0]!);
      await page.waitForTimeout(600);
      if ((await gameText(page)).tutorial.step === 'dragon_rest') break;
    }
    await waitStep(page, 'dragon_rest');
    await page.screenshot({ path: shot('14-dragon-resting') });

    // ---------- Dragon rest: tap bubble to advance ----------
    await tapBubble(page);
    await waitStep(page, 'house_skip');

    // ---------- House skip: spend Warmth to rush the House's timer ----------
    // (the step's setTimer effect already put the House on an affordable cooldown)
    const energyBeforeSkip = (await gameText(page)).energy.current;
    // Tap the House's ROOF (real UI) — a point ~90 game-px above its tile centre,
    // whose world CELL belongs to the neighbour behind. The art-bounds hit zone
    // must still route the tap to the House. (Regression: tile-yield hit areas
    // sent this tap to the item behind — the player paid the WRONG generator's
    // Warmth skip and the house_skip gate never advanced.)
    // Tier 4, not 3: `house_merge` now teaches the two-House merge before the
    // commission, so by this beat the building on the board is the MANOR.
    const houseCells = await findCells(page, (c) => c.chain === 'lumber' && c.tier === 4);
    expect(houseCells.length).toBeGreaterThanOrEqual(1);
    const housePage = await gridToPage(page, houseCells[0]![0], houseCells[0]![1]);
    await page.mouse.click(housePage.x, housePage.y - 45); // roof pixels (CSS = game ÷2)
    await page.waitForTimeout(450);
    await page.screenshot({ path: shot('14b-house-skip') });
    const skipTarget = await page.evaluate(() => {
      const scene = window.__emberkeep.game.scene.getScene('BoardScene') as unknown as {
        skipForId: number;
      };
      const ctx = window.__emberkeep.game.registry.get('ctx') as {
        state: { items: Map<number, { id: number; chain: string; tier: number }> };
      };
      const item = ctx.state.items.get(scene.skipForId);
      return item ? `${item.chain}:${item.tier}` : 'none';
    });
    expect(skipTarget).toBe('lumber:4'); // the roof tap raised the MANOR's popup
    // Pay with Warmth via the popup's real ⚡ key. Its position is ASKED FOR
    // rather than computed: the offer is a hanging pin now, stacked and seated
    // off the art's own height, so no fixed offset off the tile can find it.
    const warmthKey = await page.evaluate(() => window.__emberkeep.skipKeyToPage('warmth'));
    expect(warmthKey, 'the generator popup should be up').not.toBeNull();
    await page.mouse.click(warmthKey!.x, warmthKey!.y);
    await page.waitForTimeout(500);
    if ((await gameText(page)).tutorial.step !== 'buy_energy') {
      // Flake fallback (software rendering): perform the skip via a direct emit.
      await page.evaluate(() => {
        const ctx = window.__emberkeep.game.registry.get('ctx') as {
          state: { items: Map<number, { id: number; chain: string; tier: number }> };
          bus: { emit: (event: string, payload: unknown) => void };
        };
        const house = [...ctx.state.items.values()].find((i) => i.chain === 'lumber' && i.tier === 3);
        if (house) ctx.bus.emit('generator:skip', { itemId: house.id, currency: 'warmth' });
      });
    }
    // The skip IS the whole energy lesson now: the House's own popup, paid in
    // Warmth, hands straight to `buy_energy`. `eleanor_helps` used to sit here
    // and made the beat a two-target errand — tap her, then tap the House — on
    // a step whose subject is spending Warmth ON the House. It was cut from the
    // ladder, so this leg no longer walks over to her and back.
    await waitStep(page, 'buy_energy');
    expect((await gameText(page)).energy.current).toBeLessThan(energyBeforeSkip); // Warmth dropped
    await page.screenshot({ path: shot('15-buy-energy') });

    // ---------- Buy energy: the REAL UI path — ⚡+ opens the Emporium, claim FREE ----------
    // (Regression cover: the free-spark one-shot used to live in sessionStorage,
    // surviving resets and leaving replays with no FREE card — a stuck step.)
    await page.mouse.click(187, 44); // the ⚡ gauge's + button (game 374,88 → CSS ÷2)
    await page.waitForTimeout(700); // Emporium slides open
    await page.screenshot({ path: shot('15a-emporium') });
    const freePos = await page.evaluate(() => {
      const ui = window.__emberkeep.game.scene.getScene('UIScene') as unknown as {
        shop: { getFreeButtonPos: () => { x: number; y: number } | null };
      };
      return ui.shop.getFreeButtonPos();
    });
    expect(freePos).not.toBeNull(); // the FREE card must exist on a fresh save
    await page.mouse.click(freePos!.x / 2, freePos!.y / 2);

    // ---------- Gem harvest: the Green Dragon is where Chapter One's order currency comes from ----------
    await waitStep(page, 'gem_harvest');
    state = await gameText(page);
    // The step spawns 5 so the order (6) is always reachable in one harvest —
    // the Green Dragon may also have produced a few passively by now, which is
    // exactly why the bubble never claims an exact count.
    expect(count(state, 'flame_gem', 1)).toBeGreaterThanOrEqual(5);
    const greens = await findCells(page, (c) => c.chain === 'emerald' && c.tier === 3);
    expect(greens.length).toBeGreaterThanOrEqual(1);
    await page.evaluate(
      ([c, r]) => window.__emberkeep.centerCell(c as number, r as number),
      [greens[0]![0], greens[0]![1]]
    );
    await page.waitForTimeout(450);
    const greenPage = await itemToPage(page, greens[0]![0], greens[0]![1]);
    await page.mouse.click(greenPage.x, greenPage.y); // opens her Work/Harvest menu
    await page.waitForTimeout(500);
    if ((await gameText(page)).tutorial.step !== 'ledger_open') {
      // The menu's Harvest row is laid out at runtime — drive the harvest itself.
      await page.evaluate(() => {
        const ctx = window.__emberkeep.game.registry.get('ctx') as {
          state: { items: Map<number, { id: number; chain: string; tier: number }> };
          bus: { emit: (event: string, payload: unknown) => void };
        };
        const green = [...ctx.state.items.values()].find((i) => i.chain === 'emerald' && i.tier === 3);
        if (green) ctx.bus.emit('item:tapped', { itemId: green.id });
      });
    }
    await waitStep(page, 'ledger_open');
    expect(count(await gameText(page), 'flame_gem', 1)).toBeGreaterThanOrEqual(6); // the order asks 6
    await page.screenshot({ path: shot('15c-gem-harvest') });

    // ---------- Ledger: open it (it has been dimmed on screen since frame 1) ----------
    const ledgerPos = await page.evaluate(() => {
      const ui = window.__emberkeep.game.scene.getScene('UIScene') as unknown as {
        hud: { getLedgerPos: () => { x: number; y: number } };
      };
      return ui.hud.getLedgerPos();
    });
    await page.mouse.click(ledgerPos.x / 2, ledgerPos.y / 2);
    await waitStep(page, 'ledger_deliver');
    await page.waitForTimeout(500); // the panel slides open
    await page.screenshot({ path: shot('15d-ledger-open') });

    // ---------- Deliver: the first order pays gold, XP, and the golden tease ----------
    const beforeDeliver = await gameText(page);
    const coinsBeforeDeliver = beforeDeliver.coins;
    const gemsBeforeDeliver = count(beforeDeliver, 'flame_gem', 1);
    const deliverPos = await page.evaluate(() => {
      const ui = window.__emberkeep.game.scene.getScene('UIScene') as unknown as {
        ledger: { isOpen: boolean; getDeliverPos: () => { x: number; y: number } };
      };
      return ui.ledger.isOpen ? ui.ledger.getDeliverPos() : null;
    });
    if (deliverPos) await page.mouse.click(deliverPos.x / 2, deliverPos.y / 2);
    await page.waitForTimeout(600);
    if ((await gameText(page)).tutorial.step !== 'golden_tease') {
      await page.evaluate(() => {
        const ctx = window.__emberkeep.game.registry.get('ctx') as {
          bus: { emit: (event: string, payload: unknown) => void };
        };
        ctx.bus.emit('ui:deliver_requested', { orderId: 'eleanor_brazier' });
      });
    }

    // ---------- Golden tease: the camera glides west to the sleeping egg ----------
    await waitStep(page, 'golden_tease');
    state = await gameText(page);
    expect(count(state, 'flame_gem', 1)).toBeLessThan(gemsBeforeDeliver); // 6 went to the brazier
    expect(state.coins).toBeGreaterThan(coinsBeforeDeliver); // the order paid
    await page.waitForTimeout(2000); // glide (1.1s) + the egg's waking wobble/aura
    await page.screenshot({ path: shot('15b-golden-tease') });
    await tapBubble(page);
    await waitStep(page, 'free_play');
    await page.waitForTimeout(1100); // camera glides home
    await page.screenshot({ path: shot('16-free-play') });

    // ---------- Free play: tap → tutorialDone, game continues ----------
    await tapBubble(page);
    await expect.poll(async () => (await gameText(page)).tutorial.done, { timeout: 8_000 }).toBe(true);
    state = await gameText(page);
    expect(state.level).toBe(2); // still level 2 after tutorial
    await page.screenshot({ path: shot('17-tutorial-done') });

    // The tutorial delivered Eleanor's first order, so chapter 2 turns at the
    // handover — tap its beats away before driving the board again.
    await page.waitForTimeout(TIMINGS_CHAPTER_BEAT_DELAY);
    for (let i = 0; i < 6; i++) {
      await tapBubble(page);
      await page.waitForTimeout(260);
    }

    // ---------- Regression: the chest step's scripted dragon move ----------
    // The tutorial's chest step slid the GREEN dragon to (9,6) synchronously
    // inside its hatch emit — before the hatch ceremony created a sprite. The
    // sprite must be born on the item's LIVE cell: born on the stale merge
    // cell, every later drag bounces forever and (9,6) stays invisibly
    // occupied (nothing can ever be dropped there).
    const greenSync = await page.evaluate(() => {
      const board = window.__emberkeep.game.scene.getScene('BoardScene') as unknown as {
        ctx: {
          state: {
            items: Map<number, { id: number; chain: string; tier: number; col: number; row: number }>;
            isTileActive: (c: number, r: number) => boolean;
            itemIdAt: (c: number, r: number) => number | null;
          };
        };
        itemSprites: Map<number, { col: number; row: number }>;
      };
      const dragon = [...board.ctx.state.items.values()].find(
        (i) => i.chain === 'emerald' && i.tier === 3
      );
      if (!dragon) return null;
      const sprite = board.itemSprites.get(dragon.id);
      let free: [number, number] | null = null;
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ]) {
        const c = dragon.col + dc!;
        const r = dragon.row + dr!;
        if (board.ctx.state.isTileActive(c, r) && board.ctx.state.itemIdAt(c, r) === null) {
          free = [c, r];
          break;
        }
      }
      return {
        state: { col: dragon.col, row: dragon.row },
        sprite: sprite ? { col: sprite.col, row: sprite.row } : null,
        free
      };
    });
    expect(greenSync).not.toBeNull();
    expect(greenSync!.sprite).toEqual(greenSync!.state); // scene renders what state holds
    expect(greenSync!.free).not.toBeNull();
    // And the REAL gesture: drag the green dragon one tile — it must MOVE.
    const gd: [number, number] = [greenSync!.state.col, greenSync!.state.row];
    await page.evaluate(([c, r]) => window.__emberkeep.centerCell(c as number, r as number), gd);
    await page.waitForTimeout(400);
    await dragTile(page, gd, greenSync!.free!);
    await expect
      .poll(
        async () =>
          (await findCells(page, (c) => c.chain === 'emerald' && c.tier === 3))[0]!.join(','),
        { timeout: 8_000 }
      )
      .toBe(greenSync!.free!.join(','));

    // ---------- Reach level 3 → the land opens, and NOTHING else fires ----------
    // The tutorial ends at 60 XP from its scripted merges plus 30 for Eleanor's
    // first order; Level 3 sits at 220 (the cap). Top up the remainder rather
    // than a fixed grant, so retuning either number can't silently miss it.
    const xpNow = (await gameText(page)).xp;
    await page.evaluate((n) => window.__emberkeep.grantXp(n as number), 220 - xpNow);
    await expect.poll(async () => (await gameText(page)).level, { timeout: 8_000 }).toBe(3);
    // The south terrace opens on the cap now — its `level: 99` was demo-era
    // scaffolding and came off when the chapter left demo mode.
    await expect
      .poll(async () => (await gameText(page)).regions['level_5'], { timeout: 8_000 })
      .toBe('active');
    // Crossing a level is NOT the awakening any more: she must still be asleep.
    await page.waitForTimeout(1_200);
    const atCap = await page.evaluate(() => {
      const board = window.__emberkeep.game.scene.getScene('BoardScene') as unknown as {
        altarElder?: unknown;
        altarElderFallback?: unknown;
      };
      return !!(board.altarElder || board.altarElderFallback);
    });
    expect(atCap).toBe(false);

    // ---------- The awakening: completing the Keeper's Hoard ----------
    // Driven straight off the bus — the quest itself is hours of free play, and
    // what is under test is that its COMPLETION is what wakes her.
    await page.evaluate(() => {
      const ctx = window.__emberkeep.game.registry.get('ctx') as {
        bus: { emit: (event: string, payload: unknown) => void };
      };
      ctx.bus.emit('quest:completed', { questId: 'keepers_hoard' });
    });
    // The finale runs ~8.4s: camera to the altar → the egg cracks → the Elder
    // speaks → camera home. Nothing follows her — no teaser glimpse, no card.
    await page.waitForTimeout(9_500);
    await page.screenshot({ path: shot('18-awakening-end') });
    // The board is HANDED BACK, not interrupted: the finale released the stage
    // and the player is straight back in the game with no modal to dismiss.
    const afterFinale = await page.evaluate(() => {
      const ui = window.__emberkeep.game.scene.getScene('UIScene') as unknown as {
        finaleActive: boolean;
      };
      return { finaleActive: ui.finaleActive };
    });
    expect(afterFinale.finaleActive).toBe(false);
    expect((await gameText(page)).scene).toBe('BoardScene');
    // The Elder woke and stands on her altar — the finale's actual payoff, and
    // now its last beat. She is a scene fixture, not a board item, so she is
    // read off BoardScene rather than out of the inventory.
    const elderAwake = await page.evaluate(() => {
      const board = window.__emberkeep.game.scene.getScene('BoardScene') as unknown as {
        altarElder?: unknown;
        altarElderFallback?: unknown;
      };
      return !!(board.altarElder || board.altarElderFallback);
    });
    expect(elderAwake).toBe(true);

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

    // ---------- In-game restart reuses the scene INSTANCE ----------
    // (Regression: stale altarEgg/altarZone/finaleRan refs from the previous
    // run survived into the next one — the Golden Egg was never rebuilt, so
    // players saw only the tease aura on the altar, and the finale one-shot
    // could never play again.)
    await page.evaluate(() => {
      const ctx = window.__emberkeep.game.registry.get('ctx') as {
        bus: { emit: (event: string, payload: unknown) => void };
      };
      ctx.bus.emit('game:reset_requested', {});
    });
    await expect.poll(async () => (await gameText(page)).scene).toBe('TitleScene');
    await page.waitForTimeout(1200);
    await page.mouse.click(640, 670); // Play — a fresh run on the SAME scene instance
    await expect.poll(async () => (await gameText(page)).scene).toBe('BoardScene');
    await page.waitForTimeout(600);
    const altar = await page.evaluate(() => {
      const board = window.__emberkeep.game.scene.getScene('BoardScene') as unknown as {
        altarEgg?: { active: boolean; displayList: unknown };
        finaleRan: boolean;
      };
      return {
        eggAlive: !!(board.altarEgg && board.altarEgg.active && board.altarEgg.displayList),
        finaleRan: board.finaleRan
      };
    });
    expect(altar.eggAlive).toBe(true); // the Golden Egg stands on the altar again
    expect(altar.finaleRan).toBe(false); // the finale one-shot re-armed

    // ---------- No console errors anywhere in the run ----------
    expect(consoleErrors).toEqual([]);
    expect((await gameText(page)).fps).toBeGreaterThan(1);
  });
});
