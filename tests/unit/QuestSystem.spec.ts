import { describe, expect, it } from 'vitest';
import { GameContext } from '../../src/core/Context';
import { LEVEL_XP } from '../../src/core/Constants';
import type { MapData } from '../../src/core/types';
import realMap from '../../src/data/map.json';
import { capture, createTestContext, MemoryStorage } from './helpers';

/** Put `count` pieces on the board and let the systems see them. */
function place(ctx: GameContext, chain: string, tier: number, count = 1): void {
  ctx.bus.emit('board:spawn', { chain, tier, count });
}

/** The brazier's first subquest is a merge count — dragons are rare now, so no
 *  quest asks the player to hatch one (quests.json `brazier_merges`). */
function merges(ctx: GameContext, count: number): void {
  for (let i = 0; i < count; i++) {
    ctx.bus.emit('item:merged', {
      chain: 'ashmoss',
      fromTier: 1,
      resultTier: 2,
      at: { col: 0, row: 0 },
      consumedIds: [],
      consumedAt: [],
      outputs: [],
      xp: 0
    });
  }
}

/** Hand the state the tutorial would have left, without running it. */
function afterTutorial(ctx: GameContext): void {
  ctx.state.tutorialDone = true;
  ctx.bus.emit('state:loaded', { offlineMs: 0, energyRecovered: 0 });
}

describe('QuestSystem (the quest ladder behind the on-screen tracker)', () => {
  it('starts on the first quest and reports its subquests, in order', () => {
    const ctx = createTestContext();
    const quest = ctx.systems.quests.activeQuest!;

    expect(quest.id).toBe('rekindle_brazier');
    expect(quest.steps.map((s) => s.id)).toEqual([
      'brazier_merges',
      'brazier_shards',
      'brazier_deliver'
    ]);
    expect(ctx.systems.quests.titleFor(quest)).toBe('Light the Fire Bowl');
  });

  it('a `have` goal reads the live board and LATCHES, so delivering cannot un-do it', () => {
    const ctx = createTestContext();
    const shards = ctx.systems.quests.activeQuest!.steps.find((s) => s.id === 'brazier_shards')!;

    expect(ctx.systems.quests.progressFor(shards).done).toBe(false);
    place(ctx, 'flame_gem', 1, 6);
    expect(ctx.systems.quests.progressFor(shards)).toMatchObject({ have: 6, need: 6, done: true });

    // The order eats them. The step stays done — it happened.
    for (const item of ctx.state.itemsMatching('flame_gem', 1)) ctx.state.removeItem(item.id);
    ctx.bus.emit('item:removed', { itemId: 0, at: { col: 0, row: 0 }, reason: 'delivered' });
    expect(ctx.systems.quests.progressFor(shards).done).toBe(true);
  });

  it('completes a quest only when every step is, then advances the ladder', () => {
    const ctx = createTestContext();
    const completed = capture(ctx.bus, 'quest:completed');
    const stepDone = capture(ctx.bus, 'quest:step_completed');

    merges(ctx, 10);
    place(ctx, 'flame_gem', 1, 6);
    expect(stepDone.map((s) => s.stepId)).toEqual(
      expect.arrayContaining(['brazier_merges', 'brazier_shards'])
    );
    expect(ctx.systems.quests.activeQuest!.id).toBe('rekindle_brazier'); // delivery outstanding

    ctx.state.completedOrderIds.push('eleanor_brazier');
    ctx.bus.emit('order:completed', {
      orderId: 'eleanor_brazier',
      rewards: { coins: 25, keys: 0, xp: 30 }
    });

    expect(completed.map((q) => q.questId)).toContain('rekindle_brazier');
    expect(ctx.systems.quests.activeQuest!.id).toBe('fill_the_larder');
  });

  it('skips a quest the player satisfied out of order (the Ledger shows two at once)', () => {
    const ctx = createTestContext();
    // Quest 2 (Fill the Larder) wants nothing from the Ledger, so a player
    // stocking preserves while quest 1's delivery is outstanding finishes it
    // early — and quest 8 (Catch the Moonwater) can be settled ahead of its
    // turn too, because the Ledger shows two orders at once.
    ctx.state.completedOrderIds.push('eleanor_brazier', 'eleanor_moonwater');
    place(ctx, 'flame_gem', 1, 6);
    place(ctx, 'emberberry', 3, 2);
    place(ctx, 'moonwater', 3, 1);
    merges(ctx, 10);

    // Quest 2 is complete, so the ladder jumps it and stops on quest 3.
    expect(ctx.systems.quests.activeQuest!.id).toBe('warm_the_hearth');
    place(ctx, 'flame_gem', 2, 3);
    ctx.state.completedOrderIds.push('eleanor_hearth');
    ctx.bus.emit('order:completed', {
      orderId: 'eleanor_hearth',
      rewards: { coins: 75, keys: 0, xp: 35 }
    });
    expect(ctx.systems.quests.activeQuest!.id).toBe('raise_the_roofs');
  });

  it("mirrors the Keeper's Tasks from tasks.json — one definition, two readouts", () => {
    const ctx = createTestContext();
    const tasksQuest = ctx.systems.quests.all.find((q) => q.id === 'keepers_tasks')!;
    const elder = tasksQuest.steps.find((s) => s.id === 'tasks_elder')!;

    // Label and target come from the task, never from quests.json.
    expect(ctx.systems.quests.progressFor(elder)).toMatchObject({
      label: 'Tap the Golden Elder 10 times',
      need: 10,
      locked: true
    });

    ctx.state.completedOrderIds.push('eleanor_brazier');
    ctx.state.xp = 220; // Keeper Level 3
    expect(ctx.systems.quests.progressFor(elder).locked).toBe(false);
  });

  it('never dead-ends: the tail tracks whatever the Ledger is currently asking', () => {
    const ctx = createTestContext();
    afterTutorial(ctx);
    for (const quest of ctx.systems.quests.all) {
      for (const step of quest.steps) {
        if (step.goal.kind !== 'active_order') ctx.state.addStat(`q:${step.id}`, 1);
      }
    }
    const tail = ctx.systems.quests.activeQuest!;
    expect(tail.id).toBe('keep_the_ledger');
    // Its title and its single step's wording both come from the live order.
    expect(ctx.systems.quests.titleFor(tail)).toBe(ctx.systems.order.activeOrders[0]!.title);
    // Derived from whatever the Ledger is showing, so it cannot rot when the
    // order list is retuned — and it says the verb, the count and the recipient.
    const live = ctx.systems.order.activeOrders[0]!;
    expect(ctx.systems.quests.progressFor(tail.steps[0]!).label).toBe(
      `Deliver ${live.requires[0]!.count} × Gem Chip to Eleanor`
    );
    expect(ctx.systems.quests.progressFor(tail.steps[0]!).done).toBe(false);
  });

  it('a load re-derives the ladder silently — no replayed completion beats', () => {
    const ctx = createTestContext();
    ctx.state.completedOrderIds.push('eleanor_brazier');
    ctx.state.addStat('merges', 10);
    place(ctx, 'flame_gem', 1, 6);

    const ctx2 = createTestContext();
    const completed = capture(ctx2.bus, 'quest:completed');
    const stepDone = capture(ctx2.bus, 'quest:step_completed');
    ctx2.state.completedOrderIds.push('eleanor_brazier');
    ctx2.state.addStat('merges', 10);
    ctx2.bus.emit('state:loaded', { offlineMs: 0, energyRecovered: 0 });

    expect(completed).toHaveLength(0);
    expect(stepDone).toHaveLength(0);
    expect(ctx2.state.stat('q:brazier_merges')).toBe(1); // latched, just not announced
  });
});

describe("two givers on one board — the Golden Elder's track", () => {
  it('is dormant until keepers_hoard wakes him: not tracked, and never pre-latched', () => {
    const ctx = createTestContext();
    expect(ctx.systems.quests.giversHere).toEqual(['eleanor']);
    expect(ctx.systems.quests.activeQuestFor('golden_elder')).toBeNull();

    // A board that satisfies his first ask, long before he wakes…
    place(ctx, 'quartz', 2, 2);
    expect(ctx.state.stat('q:elder_stones')).toBe(0);
    // …and the wake must not inherit that stale board either.
    for (const item of ctx.state.itemsMatching('quartz', 2)) ctx.state.removeItem(item.id);

    ctx.state.addStat('q:done:keepers_hoard', 1);
    ctx.bus.emit('economy:changed', { coins: 0, keys: 0, xp: 0, level: 1 });

    expect(ctx.systems.quests.giversHere).toEqual(['eleanor', 'golden_elder']);
    expect(ctx.systems.quests.activeQuestFor('golden_elder')!.id).toBe('elder_seeing_stones');
    expect(ctx.state.stat('q:elder_stones')).toBe(0);
    // Eleanor's own pointer is untouched by his arrival.
    expect(ctx.systems.quests.activeQuest!.id).toBe('rekindle_brazier');
  });

  it('announces each track separately, naming the giver, and advances his ladder independently', () => {
    const ctx = createTestContext();
    const advanced = capture(ctx.bus, 'quest:advanced');
    ctx.state.addStat('q:done:keepers_hoard', 1);
    ctx.bus.emit('economy:changed', { coins: 0, keys: 0, xp: 0, level: 1 });

    const elder = advanced.find((a) => a.giver === 'golden_elder')!;
    expect(elder).toMatchObject({ questId: 'elder_seeing_stones', index: 1, total: 12 });

    place(ctx, 'quartz', 2, 2); // his first ask — Eleanor's ladder wants none of it
    const after = advanced.filter((a) => a.giver === 'golden_elder').at(-1)!;
    expect(after.questId).toBe('elder_green_over_ash');
    expect(ctx.systems.quests.activeQuest!.id).toBe('rekindle_brazier');
  });

  it('a gated track is gated WHOLE — every quest of the giver carries the same gate', () => {
    // The dormancy that stops pre-latching is per QUEST, but the property it
    // protects is per TRACK: one ungated quest in a sleeping giver's ladder
    // silently pre-completes off Eleanor-era board states, with no on-screen
    // symptom until he wakes into a half-finished ladder. Authored data has to
    // hold the invariant, so this test states it.
    const ctx = createTestContext();
    const byTrack = new Map<string, Array<string | undefined>>();
    for (const quest of ctx.systems.quests.all) {
      const track = `${quest.world ?? 'emberkeep'}:${quest.giver}`;
      if (!byTrack.has(track)) byTrack.set(track, []);
      byTrack.get(track)!.push(quest.lockedUntil?.quest);
    }
    for (const [track, gates] of byTrack) {
      expect(new Set(gates).size, `track ${track} mixes gates: ${[...new Set(gates)].join(', ')}`).toBe(1);
    }
  });
});

describe('quest rewards — the legendary egg arrives, once, and cannot be lost', () => {
  /** Drive the first Emberkeep egg quest (`fill_the_larder`) to completion:
   *  its single step is holding 2 Emberberry Preserves. */
  const finishLarder = (ctx: ReturnType<typeof createTestContext>): void => {
    for (let i = 0; i < 2; i++) {
      ctx.state.addItem({ chain: 'emberberry', tier: 3, col: i, row: 0, kind: 'item' });
    }
    ctx.bus.emit('item:spawned', {
      item: { id: 0, chain: 'emberberry', tier: 3, col: 0, row: 0, kind: 'item' },
      cause: 'init'
    });
  };

  it('pays the egg on completion, exactly once, no matter how often state moves', () => {
    const ctx = createTestContext();
    finishLarder(ctx);
    const eggs = (): number => ctx.state.countItems('ashdrake', 1) + bagCount(ctx, 'ashdrake', 1);
    expect(eggs()).toBe(1);

    // Every subsequent fact re-evaluates the whole ladder; none may pay again.
    for (let i = 0; i < 5; i++) ctx.bus.emit('economy:changed', { coins: 0, keys: 0, xp: 0, level: 1 });
    ctx.bus.emit('state:loaded', { offlineMs: 0, energyRecovered: 0 });
    expect(eggs()).toBe(1);
  });

  it('banks the egg when the board is full, rather than swallowing it', () => {
    const ctx = createTestContext();
    // Fill every active tile, so `board:spawn` has nowhere to put anything.
    for (let row = 0; row < ctx.state.rows; row++) {
      for (let col = 0; col < ctx.state.cols; col++) {
        if (!ctx.state.isTileActive(col, row) || ctx.state.itemIdAt(col, row) !== null) continue;
        ctx.state.addItem({ chain: 'lumber', tier: 1, col, row, kind: 'item' });
      }
    }
    finishLarder(ctx);
    // Nowhere on the board — so it is in the satchel, not gone. A legendary egg
    // exists three times in a zone; losing one costs the dragon for good.
    expect(ctx.state.countItems('ashdrake', 1)).toBe(0);
    expect(bagCount(ctx, 'ashdrake', 1)).toBe(1);
  });

  it('a quest with no rewards pays nothing', () => {
    const ctx = createTestContext();
    const paid = capture(ctx.bus, 'economy:add');
    ctx.bus.emit('item:merged', {
      chain: 'flame_gem', fromTier: 1, resultTier: 2, at: { col: 0, row: 0 },
      consumedIds: [], consumedAt: [], outputs: [], xp: 0
    });
    expect(paid.filter((p) => p.reason?.startsWith('quest:'))).toEqual([]);
  });
});

function bagCount(
  ctx: ReturnType<typeof createTestContext>,
  chain: string,
  tier: number
): number {
  return ctx.state.bag.find((s) => s.chain === chain && s.tier === tier)?.count ?? 0;
}

describe('brew goals — the cauldron as a quest driver', () => {
  const brew = (ctx: GameContext, recipeId: string, times: number): void => {
    for (let i = 0; i < times; i++) {
      ctx.bus.emit('cauldron:brewed', {
        recipeId,
        output: { chain: 'warhelm', tier: 1, count: 1 }
      });
    }
  };

  it('counts brews, and spending what was brewed cannot un-do the step', () => {
    const ctx = createTestContext();
    const step = ctx.systems.quests.all.find((q) => q.id === 'north_strakes')!.steps[0]!;
    expect(ctx.systems.quests.progressFor(step)).toMatchObject({ have: 0, need: 4, done: false });

    brew(ctx, 'iron_cap', 3);
    expect(ctx.systems.quests.progressFor(step)).toMatchObject({ have: 3, done: false });
    brew(ctx, 'iron_cap', 1);
    expect(ctx.systems.quests.progressFor(step).done).toBe(true);

    // The output is meant to be SPENT — four strakes merged away is the quest
    // working, not the quest coming undone.
    ctx.bus.emit('bag:consume', { chain: 'warhelm', tier: 1, count: 4 });
    expect(ctx.systems.quests.progressFor(step).done).toBe(true);
  });

  it('counts only the recipe it names', () => {
    const ctx = createTestContext();
    const step = ctx.systems.quests.all.find((q) => q.id === 'north_strakes')!.steps[0]!;
    brew(ctx, 'frost_thread', 4);
    expect(ctx.systems.quests.progressFor(step).have).toBe(0);
  });

  it('names an unlabelled brew step by what comes out of the pot', () => {
    const ctx = createTestContext();
    expect(
      ctx.systems.quests.progressFor({
        id: 'unlabelled',
        goal: { kind: 'brew', recipeId: 'iron_cap', count: 2 }
      }).label
    ).toBe('Brew 2 × Iron Hat');
  });

  /**
   * THE HOVER SHEET'S QUESTION IS NOT THE ROW'S. The row NAMES the Iron Hat;
   * the sheet has to say how to get one, and nothing merges into an Iron Hat —
   * so pointed at the output it walks one rung, finds no producer and says
   * nothing at all. Seven of Selyna's rows are brews, so the whole northern
   * ladder hovered blank while every Emberkeep row explained itself.
   */
  it('points a brew peek at the cauldron input, scaled by the brew count', () => {
    const ctx = createTestContext();
    const step = ctx.systems.quests.all.find((q) => q.id === 'north_strakes')!.steps[0]!;
    // iron_cap takes 1 Glass Float per hat; the step asks for four.
    expect(ctx.systems.quests.peekNeedFor(step)).toEqual({ chain: 'seaglass', tier: 2, count: 4 });
  });

  it('picks the ingredient the player is shortest of, not the first line', () => {
    const ctx = createTestContext();
    // north_pitchpot brews `fire_brick` three times: 6 x Tar Drop
    // (emberheart:1) + 3 x Iron Hat (warhelm:1). Stock the Tar Drops and the
    // answer must move to the hats — the first input is the wrong answer as
    // often as not to "why can I not brew this yet".
    const step = ctx.systems.quests.all.find((q) => q.id === 'north_pitchpot')!.steps[0]!;
    expect(ctx.systems.quests.peekNeedFor(step)).toEqual({
      chain: 'emberheart',
      tier: 1,
      count: 6
    });
    ctx.bus.emit('bag:bank', { chain: 'emberheart', tier: 1, count: 6 });
    expect(ctx.systems.quests.peekNeedFor(step)!.chain).toBe('warhelm');
  });

  it('answers nothing for a goal that is not a brew', () => {
    const ctx = createTestContext();
    const step = ctx.systems.quests.all.find((q) => q.id === 'north_landing')!.steps[0]!;
    expect(ctx.systems.quests.peekNeedFor(step)).toBeNull();
  });
});

describe('the tracker row knows which piece it is about', () => {
  /** Every goal kind that NAMES a piece must resolve one; the rest must not. */
  const NAMES_A_PIECE = new Set(['recipe', 'have', 'gift', 'order', 'active_order', 'brew']);

  it('resolves the piece for every row that names one, across the whole ladder', () => {
    const ctx = createTestContext();
    const bare: string[] = [];
    let resolved = 0;
    for (const quest of ctx.systems.quests.all) {
      for (const step of quest.steps) {
        const piece = ctx.systems.quests.pieceFor(step);
        if (!NAMES_A_PIECE.has(step.goal.kind)) {
          // A level, a region, a person's regard, a lifetime counter — the row
          // starts at its label, and an icon there would be an invented noun.
          expect(piece, `${step.id} (${step.goal.kind})`).toBeNull();
          continue;
        }
        if (piece) resolved++;
        else bare.push(`${step.id} (${step.goal.kind})`);
      }
    }
    // The gap this closed: `order` and `brew` rows used to resolve nothing, so
    // every "Deliver N to Eleanor" and every "Brew N" showed a bare row.
    expect(bare).toEqual([]);
    expect(resolved).toBeGreaterThan(40);
  });

  it('a delivery row points at what is DELIVERED, a brew at what comes OUT', () => {
    const ctx = createTestContext();
    const stepOf = (id: string) =>
      ctx.systems.quests.all.flatMap((q) => q.steps).find((s) => s.id === id)!;

    const deliver = ctx.systems.quests.all
      .flatMap((q) => q.steps)
      .find((s) => s.goal.kind === 'order')!;
    const order = ctx.data.orders.orders.find(
      (o) => o.id === (deliver.goal as { orderId: string }).orderId
    )!;
    expect(ctx.systems.quests.pieceFor(deliver)).toEqual({
      chain: order.requires[0]!.chain,
      tier: order.requires[0]!.tier,
      count: order.requires[0]!.count
    });

    const brew = ctx.systems.quests.all
      .flatMap((q) => q.steps)
      .find((s) => s.goal.kind === 'brew');
    if (brew) {
      const recipe = ctx.data.cauldron.recipes.find(
        (r) => r.id === (brew.goal as { recipeId: string }).recipeId
      )!;
      // The OUTPUT, not the ingredients: the row says "Brew 4 Broken Strakes"
      // and the icon has to be the thing the words name.
      expect(ctx.systems.quests.pieceFor(brew)).toEqual({
        chain: recipe.output.chain,
        tier: recipe.output.tier,
        count: (brew.goal as { count: number }).count
      });
    }
    expect(stepOf(deliver.id)).toBe(deliver);
  });

  it('a merge row points at the INPUT — what the player must go and gather', () => {
    const ctx = createTestContext();
    const recipe = ctx.systems.quests.all
      .flatMap((q) => q.steps)
      .find((s) => s.goal.kind === 'recipe');
    if (!recipe) return;
    const goal = recipe.goal as { chain: string; fromTier: number };
    expect(ctx.systems.quests.pieceFor(recipe)).toEqual({
      chain: goal.chain,
      tier: goal.fromTier,
      count: 1
    });
  });
});

describe('the north tracks its own ladder', () => {
  /** Travel needs the real authored map: the 8×8 fixture degrades emberkeep and
   *  the door out of it. Same recipe as WorldTravel.spec. */
  const northContext = (): GameContext => {
    const ctx = new GameContext(new MemoryStorage(), { map: realMap as unknown as MapData });
    ctx.state.tutorialDone = true;
    ctx.state.addStat('q:done:keepers_hoard', 1); // the Elder is awake — Borealis is open
    ctx.bus.emit('economy:add', { xp: LEVEL_XP[2], reason: 'test' }); // rank 3, the door's floor
    ctx.bus.emit('world:switch', { to: 'borealis' });
    expect(ctx.state.worldId).toBe('borealis');
    return ctx;
  };

  it('standing in Borealis, the HUD tracks Selyna’s first quest — not Eleanor’s endless tail', () => {
    // The trap this pins: `keep_the_ledger` is ALWAYS live and sits earlier in
    // file order than every northern quest, so a visited-filtered `find` never
    // gets past it — the player stood on the ice watching Eleanor’s Ledger.
    const ctx = northContext();
    expect(ctx.systems.quests.activeQuest?.id).toBe('north_landing');
    expect(ctx.systems.quests.activeQuest?.giver).toBe('selyna');
  });

  it('back home, the ladder is Emberkeep’s again', () => {
    const ctx = northContext();
    ctx.bus.emit('world:switch', { to: 'emberkeep' });
    const active = ctx.systems.quests.activeQuest;
    expect(active).not.toBeNull();
    expect(active!.world ?? 'emberkeep').toBe('emberkeep');
  });

  it('the northern tail’s piece is the LIVE order’s — never the pool’s first template', () => {
    // The screenshot bug: words naming Selyna’s Glass Floats over Eleanor’s
    // Gem Chip, because the flattened encore pool leads with the other world’s
    // template. The live order in a fresh north is `selyna_signal`.
    const ctx = northContext();
    const tail = ctx.systems.quests.all
      .flatMap((q) => q.steps)
      .find((s) => s.id === 'north_encore')!;
    expect(ctx.systems.quests.pieceFor(tail)).toEqual({ chain: 'seaglass', tier: 2, count: 2 });
  });
});
