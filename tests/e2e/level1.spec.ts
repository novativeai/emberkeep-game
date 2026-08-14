import { expect, test, type Page } from '@playwright/test';

/**
 * Drives the full scripted tutorial (the shipped 57-beat cut):
 *   arrival ×7 → stump harvest → moss merge → cookbook → rubies → red dragon →
 *   naming → moss feed → crystal/quartz ladder → ball pocketed/given (bag) →
 *   hearts → chest → level-up → key+fog → emberberries → wood/planks → tree
 *   grain → pocket/sell → moonwater → dragon work/rest → resin → hearth cake
 *   fed (favourite) → commission → house skip → Eleanor helps → marketplace →
 *   gem harvest → ledger/deliver → golden tease → free play → level-3 finale.
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

async function tapTile(page: Page, col: number, row: number): Promise<void> {
  const p = await itemToPage(page, col, row); // tap the item's ART
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
  test('lore → stump → moss → rubies → red dragon → naming → quartz → gift → chest → level-up → fog → berries → wood → grain → pockets → moonwater → work/rest → resin cake → commission → marketplace → gems → ledger → golden-tease → level-3-end', async ({
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

    // ---------- Emberbark Stump: the game's FIRST interaction is a harvest ----------
    // She names the burned tree dressing itself in moss; tapping it gathers the
    // first tuft. Reliability path: emit item:tapped on the stump — the same
    // GeneratorSystem + TutorialDirector gate path a real tap takes.
    await tapBubble(page);
    await waitStep(page, 'moss_stump');
    state = await gameText(page);
    expect(count(state, 'emberbark', 1)).toBe(1); // the stump stands from frame one
    expect(count(state, 'ashmoss', 1)).toBe(0);
    await page.screenshot({ path: shot('03b-moss-stump') });
    await page.evaluate(() => {
      const ctx = window.__emberkeep.game.registry.get('ctx') as {
        state: { items: Map<number, { chain: string; kind: string }> };
        bus: { emit: (event: string, payload: unknown) => void };
      };
      for (const [id, item] of ctx.state.items.entries()) {
        if (item.chain === 'emberbark' && item.kind === 'item') {
          ctx.bus.emit('item:tapped', { itemId: id });
          return;
        }
      }
    });

    // ---------- Ash Moss: the GREEN — the harvested tuft plus two spawned ----------
    await waitStep(page, 'ash_green');
    state = await gameText(page);
    expect(count(state, 'ashmoss', 1)).toBe(3); // 1 harvested + 2 spawned at the stump
    await page.screenshot({ path: shot('04-ash-green') });

    const tufts = await findCells(page, (c) => c.chain === 'ashmoss' && c.tier === 1);
    expect(tufts.length).toBe(3);
    await dragTile(page, tufts[2]!, tufts[0]!);

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
    await page.mouse.click(1202, 516);
    await waitStep(page, 'cookbook_close');
    await page.screenshot({ path: shot('04c-cookbook-open') });
    // Close the book YOURSELF (✕ at game 1872,408 → CSS ÷2) — that's the gate.
    await page.mouse.click(936, 204);

    // ---------- Ruby merge: the WARMTH, and now contiguous with the hatch ----------
    await waitStep(page, 'ruby_merge');
    state = await gameText(page);
    expect(count(state, 'ember_dragon', 1)).toBe(3);
    await page.screenshot({ path: shot('04d-rubies') });
    const rubies = await findCells(page, (c) => c.chain === 'ember_dragon' && c.tier === 1);
    expect(rubies.length).toBe(3);
    await dragTile(page, rubies[2]!, rubies[0]!);

    await waitStep(page, 'dragon_hatch');
    await page.waitForTimeout(500);
    state = await gameText(page);
    expect(count(state, 'ember_dragon', 1)).toBe(0);
    expect(count(state, 'ember_dragon', 2)).toBe(3); // 1 red egg + 2 spawned by step effects
    await page.screenshot({ path: shot('05-red-egg') });

    // ---------- Dragon hatch: merge 3 Red Eggs → the Red Dragon (reveal card) ----------
    const redEggs = await findCells(page, (c) => c.chain === 'ember_dragon' && c.tier === 2);
    expect(redEggs.length).toBe(3);
    await dragTile(page, redEggs[2]!, redEggs[0]!);
    // The reveal card holds the stage before the hatch ceremony hands back.
    await page.waitForTimeout(4600);
    await waitStep(page, 'name_intro');
    state = await gameText(page);
    expect(count(state, 'ember_dragon', 2)).toBe(0);
    expect(count(state, 'ember_dragon', 3)).toBe(1); // the Red Dragon
    await page.screenshot({ path: shot('06-red-dragon') });

    // ---------- Naming: the panel opens on the beat, a name is chosen out of it ----------
    await tapBubble(page);
    await waitStep(page, 'name_choose');
    await page.waitForTimeout(600); // the panel pops in
    await page.screenshot({ path: shot('06b-name-panel') });
    // The REAL path: the panel parks a focusable <input> behind the canvas and
    // focuses it on open — type the name, then press its own Choose button
    // (position read live; the suggestion cards reroll, the button does not).
    await page.keyboard.type('Cinder');
    await page.waitForTimeout(250);
    const choosePos = await page.evaluate(() => {
      const ui = window.__emberkeep.game.scene.getScene('UIScene') as unknown as {
        naming: { confirmBtn: { getWorldTransformMatrix: () => { tx: number; ty: number } } };
      };
      const m = ui.naming.confirmBtn.getWorldTransformMatrix();
      return { x: m.tx, y: m.ty };
    });
    await page.mouse.click(choosePos.x / 2, choosePos.y / 2);
    await page.waitForTimeout(500);
    if ((await gameText(page)).tutorial.step === 'name_choose') {
      // Flake fallback: drive the panel's own confirm() with the typed name.
      await page.evaluate(() => {
        const ui = window.__emberkeep.game.scene.getScene('UIScene') as unknown as {
          naming: { chosen: string; confirm: () => void };
        };
        ui.naming.chosen = 'Cinder';
        ui.naming.confirm();
      });
    }
    await waitStep(page, 'name_said');
    await tapBubble(page);

    // ---------- Moss feed: the Green Bale goes to the dragon by drag ----------
    // The beat retiered the Moss Bundle to a Bale; dragging it onto the dragon
    // is the feeding gesture the whole husbandry loop rides.
    await waitStep(page, 'moss_feed');
    for (let attempt = 0; attempt < 4; attempt++) {
      const bale = await findCells(page, (c) => c.chain === 'ashmoss' && c.tier === 3);
      const dragon = await findCells(page, (c) => c.chain === 'ember_dragon' && c.tier === 3);
      if (!bale.length || !dragon.length) break;
      await page.evaluate(
        ([c, r]) => window.__emberkeep.centerCell(c as number, r as number),
        [dragon[0]![0], dragon[0]![1]]
      );
      await page.waitForTimeout(400);
      await dragTile(page, bale[0]!, dragon[0]!);
      await page.waitForTimeout(600);
      if ((await gameText(page)).tutorial.step !== 'moss_feed') break;
    }
    await waitStep(page, 'crystal_tap');
    await page.screenshot({ path: shot('06c-moss-fed') });

    // ---------- Crystal tap: the Theme Crystal sheds Quartz ----------
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
    await waitStep(page, 'quartz_merge');
    state = await gameText(page);
    expect(count(state, 'quartz', 1)).toBe(3); // 1 shed + 2 shaken loose by the step
    await page.screenshot({ path: shot('07-3quartz') });

    // ---------- Quartz ladder: pebbles → Cut Crystal → the Crystal Ball ----------
    const mergeChain = async (chain: string, tier: number, until: string): Promise<void> => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const pieces = await findCells(page, (c) => c.chain === chain && c.tier === tier);
        if (pieces.length < 3) break;
        await page.evaluate(
          ([c, r]) => window.__emberkeep.centerCell(c as number, r as number),
          [pieces[0]![0], pieces[0]![1]]
        );
        await page.waitForTimeout(400);
        await dragTile(page, pieces[2]!, pieces[0]!);
        await page.waitForTimeout(500);
        if ((await gameText(page)).tutorial.step === until) break;
      }
    };
    await mergeChain('quartz', 1, 'quartz_ball');
    await waitStep(page, 'quartz_ball');
    state = await gameText(page);
    expect(count(state, 'quartz', 2)).toBe(3); // 1 cut + 2 spawned
    await mergeChain('quartz', 2, 'ball_pocket');
    await waitStep(page, 'ball_pocket');
    state = await gameText(page);
    expect(count(state, 'quartz', 3)).toBe(1); // the Crystal Ball
    await page.screenshot({ path: shot('07b-crystal-ball') });

    // ---------- Pocket the ball (tap-to-store), then GIVE it from the satchel ----------
    await page.evaluate(() => {
      const ctx = window.__emberkeep.game.registry.get('ctx') as {
        state: { items: Map<number, { id: number; chain: string; tier: number }> };
        bus: { emit: (event: string, payload: unknown) => void };
      };
      const ball = [...ctx.state.items.values()].find((i) => i.chain === 'quartz' && i.tier === 3);
      if (ball) ctx.bus.emit('ui:store_requested', { itemId: ball.id });
    });
    await waitStep(page, 'ball_give');
    const giveBagPos = await page.evaluate(() => {
      const ui = window.__emberkeep.game.scene.getScene('UIScene') as unknown as {
        hud: { getBagPos: () => { x: number; y: number } };
      };
      return ui.hud.getBagPos();
    });
    await page.mouse.click(giveBagPos.x / 2, giveBagPos.y / 2);
    await page.waitForTimeout(450);
    const giveSlotPos = await page.evaluate(() => {
      const ui = window.__emberkeep.game.scene.getScene('UIScene') as unknown as {
        bag: { isOpen: boolean; slots: Array<{ length: number; getWorldTransformMatrix: () => { tx: number; ty: number } }> };
      };
      if (!ui.bag?.isOpen) return null;
      const filled = ui.bag.slots.find((s) => s.length > 1);
      if (!filled) return null;
      const m = filled.getWorldTransformMatrix();
      return { x: m.tx, y: m.ty };
    });
    expect(giveSlotPos).not.toBeNull();
    await page.mouse.click(giveSlotPos!.x / 2, giveSlotPos!.y / 2);
    await page.waitForTimeout(350);
    const givePos = await page.evaluate(() => {
      const ui = window.__emberkeep.game.scene.getScene('UIScene') as unknown as {
        bag: { getGivePos: () => { x: number; y: number } | null };
      };
      return ui.bag.getGivePos();
    });
    expect(givePos).not.toBeNull(); // the chooser really opened
    await page.screenshot({ path: shot('07c-bag-give') });
    await page.mouse.click(givePos!.x / 2, givePos!.y / 2);

    // ---------- Eleanor accepts: tap HER while the give is armed ----------
    await waitStep(page, 'eleanor_gift');
    const giftEleCell = await page.evaluate(() => {
      const ctx = window.__emberkeep.game.registry.get('ctx') as {
        systems: { characters: { charactersIn: (w: string) => { id: string; anchor: [number, number] }[] } };
      };
      const her = ctx.systems.characters.charactersIn('emberkeep').find((c) => c.id === 'eleanor');
      return her ? her.anchor : null;
    });
    expect(giftEleCell).not.toBeNull();
    await page.evaluate((c) => window.__emberkeep.centerCell(c[0], c[1]), giftEleCell!);
    await page.waitForTimeout(450);
    const giftElePage = await page.evaluate(() => window.__emberkeep.characterToPage('eleanor'));
    expect(giftElePage).not.toBeNull();
    await page.mouse.click(giftElePage!.x, giftElePage!.y);
    await waitStep(page, 'eleanor_hearts');
    expect(count(await gameText(page), 'quartz', 3)).toBe(0); // the ball is hers
    await page.screenshot({ path: shot('07d-gift-accepted') });

    // ---------- Hearts explained, then the chest arrives ----------
    await tapBubble(page);
    await waitStep(page, 'chest');
    state = await gameText(page);
    expect(count(state, 'chest', 1)).toBe(1); // chest spawned
    await page.screenshot({ path: shot('09-chest') });

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
    // ---------- Board hygiene: carry the Emberbark Stump onto the new field ----------
    // The first `move`-gated beat: the gate is the DROP landing inside
    // `level_2`, driven by the real drag first (stump → the hand's own [6,2],
    // the nearest free tile on Eleanor's left).
    await waitStep(page, 'board_room');
    {
      const stump = await findCells(page, (c) => c.chain === 'emberbark');
      expect(stump.length).toBe(1);
      await page.evaluate(() => window.__emberkeep.centerCell(6, 4));
      await page.waitForTimeout(350);
      await dragTile(page, [stump[0]![0], stump[0]![1]], [6, 2]);
      await page.waitForTimeout(500);
      if ((await gameText(page)).tutorial.step === 'board_room') {
        // Reliability fallback (software rendering): perform the move directly
        // and let the director hear the same fact the drop would emit.
        await page.evaluate(() => {
          const ctx = window.__emberkeep.game.registry.get('ctx') as {
            state: {
              items: Map<number, { id: number; chain: string; col: number; row: number }>;
              moveItem: (id: number, to: { col: number; row: number }) => void;
              itemIdAt: (col: number, row: number) => number | null;
            };
            bus: { emit: (event: string, payload: unknown) => void };
          };
          const stumpItem = [...ctx.state.items.values()].find((i) => i.chain === 'emberbark');
          if (!stumpItem) return;
          const from = { col: stumpItem.col, row: stumpItem.row };
          const to = ctx.state.itemIdAt(6, 2) === null ? { col: 6, row: 2 } : { col: 6, row: 4 };
          ctx.state.moveItem(stumpItem.id, to);
          ctx.bus.emit('item:moved', { itemId: stumpItem.id, from, to });
        });
      }
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
    for (let attempt = 0; attempt < 4; attempt++) {
      const sprouts = await findCells(page, (c) => c.chain === 'emberberry' && c.tier === 1);
      if (sprouts.length < 3) break;
      await page.evaluate(
        ([c, r]) => window.__emberkeep.centerCell(c as number, r as number),
        [sprouts[0]![0], sprouts[0]![1]]
      );
      await page.waitForTimeout(400);
      await dragTile(page, sprouts[2]!, sprouts[0]!);
      await page.waitForTimeout(500);
      if ((await gameText(page)).tutorial.step === 'wood_merge') break;
    }
    await waitStep(page, 'wood_merge');
    state = await gameText(page);
    expect(count(state, 'emberberry', 1)).toBe(0);
    expect(count(state, 'emberberry', 2)).toBe(1); // Emberberry Basket
    await page.screenshot({ path: shot('12c-emberberry-basket') });

    // ---------- Wood merge: 3 Cut Wood → a Plank Set, then 3 Plank Sets → the House ----------
    // The 2560×1600 drag is flaky under SwiftShader — retry until each merge lands.
    const mergeLumber = async (tier: number, until: string): Promise<void> => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const pieces = await findCells(page, (c) => c.chain === 'lumber' && c.tier === tier);
        if (pieces.length < 3) break;
        await page.evaluate(
          ([c, r]) => window.__emberkeep.centerCell(c as number, r as number),
          [pieces[0]![0], pieces[0]![1]]
        );
        await page.waitForTimeout(400);
        await dragTile(page, pieces[2]!, pieces[0]!);
        await page.waitForTimeout(500);
        if ((await gameText(page)).tutorial.step === until) break;
      }
    };
    await mergeLumber(1, 'plank_merge');
    await waitStep(page, 'plank_merge');
    state = await gameText(page);
    expect(count(state, 'lumber', 2)).toBe(3); // 1 milled + 2 spawned by the step
    await page.screenshot({ path: shot('13-planks-milled') });

    await mergeLumber(2, 'tree_grain');
    await waitStep(page, 'tree_grain');
    state = await gameText(page);
    expect(count(state, 'lumber', 2)).toBe(0);
    expect(count(state, 'lumber', 3)).toBeGreaterThanOrEqual(1); // house raised
    await page.screenshot({ path: shot('13b-house-built') });

    // ---------- Fir Grain: the tree's second yield, taught end to end ----------
    // The beat spawns 3 grains on entry; her line closes on a tap, then the two
    // merges climb the ladder (a Fir Sapling stands at the top).
    await tapBubble(page);
    await waitStep(page, 'grain_merge');
    state = await gameText(page);
    expect(count(state, 'firgrain', 1)).toBe(3);
    await mergeChain('firgrain', 1, 'fir_grow');
    await waitStep(page, 'fir_grow');
    state = await gameText(page);
    expect(count(state, 'firgrain', 2)).toBe(3); // 1 merged + 2 spawned
    await mergeChain('firgrain', 2, 'pocket_it');
    await waitStep(page, 'pocket_it');
    expect(count(await gameText(page), 'firgrain', 3)).toBe(1);
    await page.screenshot({ path: shot('13b2-fir-grown') });

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
    // regions ([5,6] in the gate, [4,5]/[4,6] in level_2) — the drop-onto path
    // fuses them regardless of adjacency.
    await waitStep(page, 'moonwater_merge');
    for (let attempt = 0; attempt < 4; attempt++) {
      const drops = await findCells(page, (c) => c.chain === 'moonwater' && c.tier === 1);
      if (drops.length < 3) break;
      await page.evaluate(
        ([c, r]) => window.__emberkeep.centerCell(c as number, r as number),
        [drops[0]![0], drops[0]![1]]
      );
      await page.waitForTimeout(400);
      await dragTile(page, drops[2]!, drops[0]!);
      await page.waitForTimeout(500);
      if ((await gameText(page)).tutorial.step !== 'moonwater_merge') break;
    }
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

    // ---------- Dragon rest → the resin arc: beads → Lump → Hearth Cake, FED ----------
    await tapBubble(page);
    await waitStep(page, 'resin_find');
    state = await gameText(page);
    expect(count(state, 'resin', 1)).toBe(3); // beads off the old tree's bark
    await tapBubble(page);
    await waitStep(page, 'resin_merge');
    await mergeChain('resin', 1, 'hearth_cake');
    await waitStep(page, 'hearth_cake');
    state = await gameText(page);
    expect(count(state, 'resin', 2)).toBe(3); // 1 lump + 2 spawned
    await mergeChain('resin', 2, 'feed_dragon');
    await waitStep(page, 'feed_dragon');
    expect(count(await gameText(page), 'resin', 3)).toBe(1); // the Hearth Cake
    await page.screenshot({ path: shot('14b-hearth-cake') });
    // The favourite: drag the Cake onto the dragon — the beat the diet hangs on.
    for (let attempt = 0; attempt < 4; attempt++) {
      const cake = await findCells(page, (c) => c.chain === 'resin' && c.tier === 3);
      const dragon2 = await findCells(page, (c) => c.chain === 'ember_dragon' && c.tier === 3);
      if (!cake.length || !dragon2.length) break;
      await page.evaluate(
        ([c, r]) => window.__emberkeep.centerCell(c as number, r as number),
        [dragon2[0]![0], dragon2[0]![1]]
      );
      await page.waitForTimeout(400);
      await dragTile(page, cake[0]!, dragon2[0]!);
      await page.waitForTimeout(600);
      if ((await gameText(page)).tutorial.step !== 'feed_dragon') break;
    }

    // ---------- The Codex writes the favourite: popup, reveal, close ----------
    // The book opens itself (+0.7s), the favourite row fades in (~1.7s more),
    // and only then does getClosePos answer — the arrow's own gate.
    await waitStep(page, 'codex_meal');
    await page.waitForTimeout(3200);
    await page.screenshot({ path: shot('14b2-codex-reveal') });
    {
      const closePos = await page.evaluate(() => {
        const ui = window.__emberkeep.game.scene.getScene('UIScene') as unknown as {
          codex: { getClosePos: () => { x: number; y: number } | null };
        };
        return ui.codex.getClosePos();
      });
      if (closePos) {
        await page.mouse.click(closePos.x / 2, closePos.y / 2);
        await page.waitForTimeout(400);
      }
      if ((await gameText(page)).tutorial.step === 'codex_meal') {
        // Reliability fallback: close through the panel's own contract.
        await page.evaluate(() => {
          const ui = window.__emberkeep.game.scene.getScene('UIScene') as unknown as {
            codex: { requestClose: () => void };
          };
          ui.codex.requestClose();
        });
      }
    }
    await waitStep(page, 'cake_loved');
    await page.screenshot({ path: shot('14c-cake-loved') });
    await tapBubble(page);
    await waitStep(page, 'dragon_status');
    await tapBubble(page);

    // ---------- Resin pocketed, then the House commissioned to press it ----------
    await waitStep(page, 'resin_pocket');
    await page.evaluate(() => {
      const ctx = window.__emberkeep.game.registry.get('ctx') as {
        state: { items: Map<number, { id: number; chain: string; tier: number }> };
        bus: { emit: (event: string, payload: unknown) => void };
      };
      const bead = [...ctx.state.items.values()].find((i) => i.chain === 'resin' && i.tier === 1);
      if (bead) ctx.bus.emit('ui:store_requested', { itemId: bead.id });
    });
    await waitStep(page, 'house_commission');
    // Raise the chooser with a real roof tap, then commit the choice through the
    // same intent the panel's Yes button emits (its card layout is runtime-laid).
    const commHouse = await findCells(page, (c) => c.chain === 'lumber' && c.tier === 3);
    expect(commHouse.length).toBeGreaterThanOrEqual(1);
    const commHousePage = await gridToPage(page, commHouse[0]![0], commHouse[0]![1]);
    await page.mouse.click(commHousePage.x, commHousePage.y - 45);
    await page.waitForTimeout(600);
    await page.screenshot({ path: shot('14d-commission') });
    // Tap the pocketed bead's slot, then the chooser's own Yes — the real path,
    // which is also what CLOSES the panel (a bare intent emit leaves it up,
    // covering the board for the skip lesson that follows).
    const commissionYes = async (): Promise<{ x: number; y: number } | null> =>
      page.evaluate(() => {
        const ui = window.__emberkeep.game.scene.getScene('UIScene') as unknown as {
          children: { list: Array<{ visible: boolean; type: string; text?: string; list?: unknown[]; getWorldTransformMatrix: () => { tx: number; ty: number } }> };
        };
        let found: { x: number; y: number } | null = null;
        type Node = { visible: boolean; type: string; text?: string; list?: Node[]; getWorldTransformMatrix: () => { tx: number; ty: number } };
        const walk = (o: Node, viz: boolean): void => {
          const v = viz && o.visible;
          if (!found && v && o.type === 'Text' && o.text === 'Yes') {
            const m = o.getWorldTransformMatrix();
            found = { x: m.tx, y: m.ty };
          }
          for (const k of o.list ?? []) walk(k, v);
        };
        for (const c of ui.children.list) walk(c as unknown as Node, true);
        return found;
      });
    let yesPos = await commissionYes();
    if (!yesPos) {
      // The chooser opens on the FIRST bag stack when nothing is picked; tap
      // the slot to raise the confirm pair, then look again.
      const commSlot = await page.evaluate(() => {
        const ui = window.__emberkeep.game.scene.getScene('UIScene') as unknown as {
          commission: { getMarkerPos: () => { x: number; y: number } | null };
        };
        return ui.commission.getMarkerPos();
      });
      if (commSlot) {
        await page.mouse.click(commSlot.x / 2, commSlot.y / 2);
        await page.waitForTimeout(350);
        yesPos = await commissionYes();
      }
    }
    expect(yesPos).not.toBeNull();
    await page.mouse.click(yesPos!.x / 2, yesPos!.y / 2);
    await page.waitForTimeout(400);
    await waitStep(page, 'house_skip');

    // ---------- House skip: spend Warmth to rush the House's timer ----------
    // (the step's setTimer effect already put the House on an affordable cooldown)
    const energyBeforeSkip = (await gameText(page)).energy.current;
    // Tap the House's ROOF (real UI) — a point ~90 game-px above its tile centre,
    // whose world CELL belongs to the neighbour behind. The art-bounds hit zone
    // must still route the tap to the House. (Regression: tile-yield hit areas
    // sent this tap to the item behind — the player paid the WRONG generator's
    // Warmth skip and the house_skip gate never advanced.)
    const houseCells = await findCells(page, (c) => c.chain === 'lumber' && c.tier === 3);
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
    if (skipTarget === 'lumber:3') {
      // Pay with Warmth via the popup's real ⚡ button (game offset +150,+100 → CSS ÷2).
      await page.mouse.click(housePage.x + 75, housePage.y + 50);
      await page.waitForTimeout(500);
    }
    if ((await gameText(page)).tutorial.step !== 'eleanor_helps') {
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
    await waitStep(page, 'eleanor_helps');
    expect((await gameText(page)).energy.current).toBeLessThan(energyBeforeSkip); // Warmth dropped

    // ---------- Eleanor's help: tap her to arm, then tap what she should hurry ----------
    // She has stood on the map since the first frame; this is the beat that
    // finally explains her. The step's setTimer put a live wait on the House.
    // Where she stands is authored in the World Builder (characters.json: a cell
    // PLUS a free dx/dy), so ask the game where she actually is rather than pin a
    // cell here — a hardcoded cell silently stops tapping her the moment she is
    // moved, and the fallback emit below hides that.
    const eleCell = await page.evaluate(() => {
      const ctx = window.__emberkeep.game.registry.get('ctx') as {
        systems: { characters: { charactersIn: (w: string) => { id: string; anchor: [number, number] }[] } };
      };
      const her = ctx.systems.characters.charactersIn('emberkeep').find((c) => c.id === 'eleanor');
      return her ? her.anchor : null;
    });
    expect(eleCell).not.toBeNull();
    await page.evaluate((c) => window.__emberkeep.centerCell(c[0], c[1]), eleCell!);
    await page.waitForTimeout(450);
    // Her BODY, not her cell: she is ~2 tiles tall, her hit rect is the lower half
    // of her silhouette, and her free offset means the cell is not under her feet.
    const elePage = await page.evaluate(() => window.__emberkeep.characterToPage('eleanor'));
    expect(elePage).not.toBeNull();
    await page.mouse.click(elePage!.x, elePage!.y);
    await page.waitForTimeout(350);
    const helpHouse = await findCells(page, (c) => c.chain === 'lumber' && c.tier === 3);
    if (helpHouse.length) {
      const hp = await gridToPage(page, helpHouse[0]![0], helpHouse[0]![1]);
      await page.mouse.click(hp.x, hp.y - 45); // roof pixels, as in house_skip
      await page.waitForTimeout(500);
    }
    if ((await gameText(page)).tutorial.step !== 'buy_energy') {
      await page.evaluate(() => {
        const ctx = window.__emberkeep.game.registry.get('ctx') as {
          state: { items: Map<number, { id: number; chain: string; tier: number }> };
          bus: { emit: (event: string, payload: unknown) => void };
        };
        const house = [...ctx.state.items.values()].find((i) => i.chain === 'lumber' && i.tier === 3);
        ctx.bus.emit('ui:character_action_requested', { characterId: 'eleanor', target: house?.id });
      });
    }
    await waitStep(page, 'buy_energy');
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

    // ---------- Gem harvest: the Red Dragon is where Chapter One's order currency comes from ----------
    await waitStep(page, 'gem_harvest');
    state = await gameText(page);
    // The step spawns 5 so the order (6) is always reachable in one harvest —
    // the Red Dragon may also have produced a few passively by now, which is
    // exactly why the bubble never claims an exact count.
    expect(count(state, 'flame_gem', 1)).toBeGreaterThanOrEqual(5);
    const reds = await findCells(page, (c) => c.chain === 'ember_dragon' && c.tier === 3);
    expect(reds.length).toBeGreaterThanOrEqual(1);
    await page.evaluate(
      ([c, r]) => window.__emberkeep.centerCell(c as number, r as number),
      [reds[0]![0], reds[0]![1]]
    );
    await page.waitForTimeout(450);
    const redPage = await itemToPage(page, reds[0]![0], reds[0]![1]);
    await page.mouse.click(redPage.x, redPage.y); // opens her Work/Harvest menu
    await page.waitForTimeout(500);
    if ((await gameText(page)).tutorial.step !== 'ledger_open') {
      // The menu's ✋ harvest button is laid out at runtime — drive the harvest itself.
      await page.evaluate(() => {
        const ctx = window.__emberkeep.game.registry.get('ctx') as {
          state: { items: Map<number, { id: number; chain: string; tier: number }> };
          bus: { emit: (event: string, payload: unknown) => void };
        };
        const red = [...ctx.state.items.values()].find((i) => i.chain === 'ember_dragon' && i.tier === 3);
        if (red) ctx.bus.emit('item:tapped', { itemId: red.id });
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

    // The handover also blooms the Ember Gate, whose reveal flies the named
    // hatchling through the door and back (BoardScene.playGateFlight — bloom
    // +2.1s, out 1.8s, through 2.6s, home 1.5s ≈ 8s from the done step). His
    // SPRITE is away from his cell for that whole flight, so the drag
    // assertions below would grab empty air — let him land first.
    await page.waitForTimeout(6_000);

    // ---------- Regression: scripted synchronous moves vs the sprite's cell ----------
    // A scripted step can slide the dragon synchronously inside an emit —
    // before the hatch ceremony created a sprite. The sprite must be born on
    // the item's LIVE cell: born on the stale merge cell, every later drag
    // bounces forever and the real cell stays invisibly occupied.
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
        (i) => i.chain === 'ember_dragon' && i.tier === 3
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
          (await findCells(page, (c) => c.chain === 'ember_dragon' && c.tier === 3))[0]!.join(','),
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
        altarElderClip?: unknown;
        altarElderFallback?: unknown;
      };
      return !!(board.altarElder || board.altarElderClip || board.altarElderFallback);
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
    // The finale runs FINALE_ENDS_MS (~12.2s now that the Elder's speech is two
    // chained lines across elderHoldMs): camera to the altar → the egg cracks →
    // she speaks both lines → camera home. Nothing follows her — no teaser
    // glimpse, no card.
    await page.waitForTimeout(13_200);
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
        altarElderClip?: unknown;
        altarElderFallback?: unknown;
      };
      return !!(board.altarElder || board.altarElderClip || board.altarElderFallback);
    });
    expect(elderAwake).toBe(true);

    // ---------- Save / reload restores mid-game state ----------
    const before = await gameText(page);
    await page.reload();
    await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
    await expect.poll(async () => (await gameText(page)).scene, { timeout: 30_000 }).toBe('TitleScene');
    await page.waitForTimeout(1200);
    await page.mouse.click(640, 670); // Continue
    await expect.poll(async () => (await gameText(page)).scene, { timeout: 15_000 }).toBe('BoardScene');
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
    await expect.poll(async () => (await gameText(page)).scene, { timeout: 30_000 }).toBe('TitleScene');
    await page.waitForTimeout(1200);
    await page.mouse.click(640, 670); // Continue
    await expect.poll(async () => (await gameText(page)).scene, { timeout: 15_000 }).toBe('BoardScene');
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
    await expect.poll(async () => (await gameText(page)).scene, { timeout: 30_000 }).toBe('TitleScene');
    await page.waitForTimeout(1200);
    await page.mouse.click(640, 670); // Play — a fresh run on the SAME scene instance
    await expect.poll(async () => (await gameText(page)).scene, { timeout: 15_000 }).toBe('BoardScene');
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
