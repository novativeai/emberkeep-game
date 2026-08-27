import { describe, expect, it } from 'vitest';
import cauldronJson from '../../src/data/cauldron.json';
import questsJson from '../../src/data/quests.json';
import chainsJson from '../../src/data/chains.json';
import { BAG_SLOTS } from '../../src/core/Constants';
import type { CauldronData } from '../../src/core/types';
import { capture, createTestContext } from './helpers';

const data = cauldronJson as CauldronData;

/** Fill the bag so a recipe's inputs are exactly covered. */
function stock(ctx: ReturnType<typeof createTestContext>, recipeId: string): void {
  const recipe = data.recipes.find((r) => r.id === recipeId)!;
  for (const input of recipe.inputs) {
    ctx.bus.emit('bag:bank', { chain: input.chain, tier: input.tier, count: input.count });
  }
}

describe('CauldronSystem (brew out of the Bag, bank back into it)', () => {
  it('a covered recipe consumes every input and banks the output', () => {
    const ctx = createTestContext();
    stock(ctx, 'hearth_cake');
    const brewed = capture(ctx.bus, 'cauldron:brewed');

    ctx.bus.emit('cauldron:brew', { recipeId: 'hearth_cake' });

    expect(brewed.at(-1)).toMatchObject({
      recipeId: 'hearth_cake',
      output: { chain: 'resin', tier: 3, count: 1 }
    });
    // Inputs gone, output the only thing left.
    expect(ctx.state.bag).toEqual([{ chain: 'resin', tier: 3, count: 1 }]);
  });

  it('a shortfall refuses BEFORE anything is spent — no half-eaten brews', () => {
    const ctx = createTestContext();
    const recipe = data.recipes.find((r) => r.id === 'red_egg')!;
    // Everything except the last input.
    for (const input of recipe.inputs.slice(0, -1)) {
      ctx.bus.emit('bag:bank', { chain: input.chain, tier: input.tier, count: input.count });
    }
    const failed = capture(ctx.bus, 'cauldron:brew_failed');
    const before = JSON.parse(JSON.stringify(ctx.state.bag));

    ctx.bus.emit('cauldron:brew', { recipeId: 'red_egg' });

    expect(failed.at(-1)).toMatchObject({ recipeId: 'red_egg', reason: 'ingredients' });
    expect(ctx.state.bag).toEqual(before);
  });

  it('refuses when the output would need a slot a full bag cannot give', () => {
    const ctx = createTestContext();
    // One MORE of each input than the recipe wants: the debit leaves both
    // stacks standing, so no slot frees up.
    const recipe = data.recipes.find((r) => r.id === 'hearth_cake')!;
    for (const input of recipe.inputs) {
      ctx.bus.emit('bag:bank', { chain: input.chain, tier: input.tier, count: input.count + 1 });
    }
    for (let i = ctx.state.bag.length; i < BAG_SLOTS; i++) {
      ctx.bus.emit('bag:bank', { chain: `filler_${i}`, tier: 1, count: 1 });
    }
    const failed = capture(ctx.bus, 'cauldron:brew_failed');
    const before = JSON.parse(JSON.stringify(ctx.state.bag));

    ctx.bus.emit('cauldron:brew', { recipeId: 'hearth_cake' });

    expect(failed.at(-1)).toMatchObject({ recipeId: 'hearth_cake', reason: 'bag_full' });
    expect(ctx.state.bag).toEqual(before); // refused up front — nothing spent
  });

  it('a brew whose emptied input stacks free the slot is NOT refused', () => {
    const ctx = createTestContext();
    stock(ctx, 'hearth_cake'); // 2 stacks that the brew will empty
    for (let i = 0; i < BAG_SLOTS - 2; i++) {
      ctx.bus.emit('bag:bank', { chain: `filler_${i}`, tier: 1, count: 1 });
    }
    const brewed = capture(ctx.bus, 'cauldron:brewed');

    ctx.bus.emit('cauldron:brew', { recipeId: 'hearth_cake' });

    expect(brewed).toHaveLength(1);
    expect(ctx.state.bag.some((s) => s.chain === 'resin' && s.tier === 3)).toBe(true);
  });

  it('canBrew mirrors what brew would decide', () => {
    const ctx = createTestContext();
    expect(ctx.systems.cauldron.canBrew('golden_egg')).toBe(false);
    stock(ctx, 'golden_egg');
    expect(ctx.systems.cauldron.canBrew('golden_egg')).toBe(true);
  });
});

describe('cauldron.json (the recipe book itself)', () => {
  const chains = chainsJson.chains as Array<{ id: string; tiers: Array<{ tier: number }> }>;
  const exists = (chain: string, tier: number): boolean =>
    chains.some((c) => c.id === chain && c.tiers.some((t) => t.tier === tier));

  it('every output and input names a real chain tier', () => {
    for (const recipe of data.recipes) {
      expect(exists(recipe.output.chain, recipe.output.tier), `${recipe.id} output`).toBe(true);
      for (const input of recipe.inputs) {
        expect(exists(input.chain, input.tier), `${recipe.id} ← ${input.chain}:${input.tier}`).toBe(
          true
        );
      }
    }
  });

  it('every dragon egg in the roster has a recipe', () => {
    const outputs = data.recipes.map((r) => `${r.output.chain}:${r.output.tier}`);
    for (const egg of ['ember_dragon:2', 'emerald:2', 'ashdrake:1', 'rimewyrm:1', 'golden_egg:1']) {
      expect(outputs, `missing egg recipe ${egg}`).toContain(egg);
    }
  });

  it('no recipe asks for more ingredient CARDS than the panel can seat', () => {
    for (const recipe of data.recipes) {
      expect(recipe.inputs.length, recipe.id).toBeLessThanOrEqual(4);
      expect(recipe.inputs.length, recipe.id).toBeGreaterThan(0);
    }
  });

  it('a recipe never asks for its own output — the pot is not a duplicator', () => {
    for (const recipe of data.recipes) {
      const loops = recipe.inputs.some(
        (i) => i.chain === recipe.output.chain && i.tier === recipe.output.tier
      );
      expect(loops, recipe.id).toBe(false);
    }
  });

  /**
   * THE TIER LAW (owner, 2026-08-26): the pot never hands back a tier-1 item —
   * a brew must be worth at least a merge. The one exemption is the eggs: by
   * the legendary directive tier 1 IS the egg (three merge into the dragon),
   * and the Cauldron is their sanctioned faucet.
   */
  it('no recipe outputs a tier-1 item, eggs excepted', () => {
    const eggs = new Set(['ashdrake', 'rimewyrm', 'golden_egg']);
    const leaks = data.recipes
      .filter((r) => r.output.tier < 2 && !eggs.has(r.output.chain))
      .map((r) => r.id);
    expect(leaks).toEqual([]);
  });
});

describe('Recipe gating (the grimoire is earned page by page)', () => {
  const quests = (questsJson as {
    quests: Array<{ id: string; steps?: Array<{ goal?: { kind?: string; recipeId?: string } }> }>;
  }).quests;
  const order = quests.map((q) => q.id);
  const at = (id: string): number => order.indexOf(id);

  it('the ledger opens with exactly the three starter pages', () => {
    const ctx = createTestContext();
    const ids = ctx.systems.cauldron.available().map((r) => r.id);
    expect(ids).toEqual(['hearth_cake', 'red_egg', 'green_egg']);
  });

  it('every unlock names a quest that exists', () => {
    for (const r of data.recipes) {
      if (!r.unlock) continue;
      expect(at(r.unlock.quest), `${r.id} unlocks off unknown quest ${r.unlock.quest}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('no quest demands a brew before its recipe is taught', () => {
    for (const q of quests) {
      for (const st of q.steps ?? []) {
        const g = st.goal;
        if (g?.kind !== 'brew' || !g.recipeId) continue;
        const recipe = data.recipes.find((r) => r.id === g.recipeId)!;
        expect(recipe, `${q.id} brews unknown recipe ${g.recipeId}`).toBeDefined();
        if (!recipe.unlock) continue; // a starter is always available
        expect(
          at(recipe.unlock.quest),
          `${q.id} demands ${g.recipeId}, taught only by ${recipe.unlock.quest} which comes later`
        ).toBeLessThan(at(q.id));
      }
    }
  });

  it('a completed quest writes its page in; the star clears when the book closes', () => {
    const ctx = createTestContext();
    expect(ctx.systems.cauldron.available().map((r) => r.id)).not.toContain('iron_cap');
    expect(ctx.systems.cauldron.isNew('iron_cap')).toBe(false); // locked is not new

    ctx.state.addStat('q:done:north_salvage', 1);
    expect(ctx.systems.cauldron.available().map((r) => r.id)).toContain('iron_cap');
    expect(ctx.systems.cauldron.isNew('iron_cap')).toBe(true);

    ctx.systems.cauldron.markAllSeen();
    expect(ctx.systems.cauldron.isNew('iron_cap')).toBe(false);
    // …and only ONCE ever: the latch is monotonic.
    expect(ctx.state.stat('recipe:seen:iron_cap')).toBe(1);
    ctx.systems.cauldron.markAllSeen();
    expect(ctx.state.stat('recipe:seen:iron_cap')).toBe(1);
  });

  it('a locked page refuses to brew even when the Bag could pay', () => {
    const ctx = createTestContext();
    stock(ctx, 'iron_cap');
    const failed = capture(ctx.bus, 'cauldron:brew_failed');
    const before = JSON.parse(JSON.stringify(ctx.state.bag));

    ctx.bus.emit('cauldron:brew', { recipeId: 'iron_cap' });

    expect(failed.at(-1)).toMatchObject({ recipeId: 'iron_cap', reason: 'locked' });
    expect(ctx.state.bag).toEqual(before);
  });
});
