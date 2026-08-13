import { describe, expect, it } from 'vitest';
import chainsDoc from '../../src/data/chains.json';
import type { ChainsData } from '../../src/core/types';
import { capture, createTestContext, idAt } from './helpers';

const chains = chainsDoc as unknown as ChainsData;
const tierOf = (chain: string, tier: number) =>
  chains.chains.find((c) => c.id === chain)!.tiers.find((t) => t.tier === tier)!;

type Ctx = ReturnType<typeof createTestContext>;

/** Run one passive cycle of every generator on the board. */
function tick(ctx: Ctx, ms: number): void {
  ctx.clock.advance(ms);
  ctx.bus.emit('time:advanced', { ms });
}

/** Clear the board of a chain+tier so the next drop has somewhere to land —
 *  the 8×8 fixture is small and a wood pile fills it long before ten yields. */
function sweep(ctx: Ctx, chain: string): void {
  const ids = [...ctx.state.items.values()]
    .filter((i) => i.kind === 'item' && i.chain === chain)
    .map((i) => i.id);
  if (ids.length) ctx.bus.emit('board:consume_items', { itemIds: ids, reason: 'sold' });
}

describe('the Fir loop — a worked tree plants its own replacement', () => {
  it('the Ancient Tree drops a Fir Grain every 10 Cut Wood, not before', () => {
    const ctx = createTestContext();
    ctx.systems.board.spawn('bigtree', 1, 2, 2, 'init');
    const tree = ctx.state.items.get(idAt(ctx, 2, 2))!;
    const produced = capture(ctx.bus, 'item:produced');
    const cycle = tierOf('bigtree', 1).generator!.passiveMs!;

    tick(ctx, 0); // arm
    for (let i = 0; i < 9; i++) {
      tick(ctx, cycle + 1);
      sweep(ctx, 'lumber'); // keep room on the small fixture board
    }
    expect(produced).toHaveLength(9);
    expect(produced.every((p) => p.output.chain === 'lumber')).toBe(true);
    expect(ctx.state.items.get(tree.id)!.yields).toBe(9);

    // The tenth yield pays the wood AND the grain.
    tick(ctx, cycle + 1);
    expect(produced).toHaveLength(11);
    expect(produced.at(-1)!.output).toMatchObject({ chain: 'firgrain', tier: 1 });
    // The counter is SPENT, never zeroed, so the eleventh yield starts again
    // from one rather than from whatever overflowed.
    expect(ctx.state.items.get(tree.id)!.yields).toBe(0);
  });

  it('3 grains make a Small Fir Tree, 3 of those make a Fir Tree', () => {
    const ctx = createTestContext();
    for (const [col, row] of [
      [1, 1],
      [2, 1],
      [3, 1]
    ] as const) {
      ctx.systems.board.spawn('firgrain', 1, col, row, 'init');
    }
    ctx.bus.emit('drag:dropped', { itemId: ctx.state.itemIdAt(1, 1)!, from: { col: 1, row: 1 }, to: { col: 2, row: 2 } });
    // Dropping beside the pair snaps and fuses (the forgiving merge).
    expect(ctx.state.countItems('firgrain', 2)).toBe(1);

    // …and the top of the chain is a WORKING tree, not a trophy.
    const grown = tierOf('firgrain', 3);
    expect(grown.generator?.produces).toEqual({ chain: 'lumber', tier: 1 });
    expect(grown.generator?.bonus).toEqual({
      every: 10,
      produces: { chain: 'firgrain', tier: 1 }
    });
  });

  it('a grown Fir Tree makes wood exactly like the ancient one', () => {
    const ctx = createTestContext();
    ctx.systems.board.spawn('firgrain', 3, 2, 2, 'init');
    const produced = capture(ctx.bus, 'item:produced');
    tick(ctx, 0);
    tick(ctx, tierOf('firgrain', 3).generator!.passiveMs! + 1);
    expect(produced.at(-1)!.output).toMatchObject({ chain: 'lumber', tier: 1 });
  });
});

describe("the House's commission — one house, one output, for good", () => {
  const houseAt = (ctx: Ctx, col: number, row: number) =>
    ctx.state.addItem({ chain: 'lumber', tier: 3, col, row, kind: 'item' });

  it('makes Gold until it is commissioned — a closed chooser never strands it', () => {
    const ctx = createTestContext();
    houseAt(ctx, 2, 2);
    const produced = capture(ctx.bus, 'item:produced');
    tick(ctx, 0);
    tick(ctx, tierOf('lumber', 3).generator!.passiveMs! + 1);
    expect(produced.at(-1)!.output).toMatchObject({ chain: 'coin', tier: 1 });
  });

  it('commissions a piece the player is carrying, and then makes only that', () => {
    const ctx = createTestContext();
    const house = houseAt(ctx, 2, 2);
    const set = capture(ctx.bus, 'generator:produce_set');
    ctx.state.bag.push({ chain: 'flame_gem', tier: 1, count: 2 });

    expect(ctx.systems.generator.awaitingChoice(house)).toBe(true);
    ctx.bus.emit('ui:produce_choice_requested', { itemId: house.id, chain: 'flame_gem', tier: 1 });
    expect(set).toHaveLength(1);
    expect(house.produces).toEqual({ chain: 'flame_gem', tier: 1 });
    expect(ctx.systems.generator.awaitingChoice(house)).toBe(false);

    const produced = capture(ctx.bus, 'item:produced');
    tick(ctx, tierOf('lumber', 3).generator!.passiveMs! + 1);
    expect(produced.at(-1)!.output).toMatchObject({ chain: 'flame_gem', tier: 1 });
    // The commission does not SPEND what it copies.
    expect(ctx.state.bag[0]).toMatchObject({ chain: 'flame_gem', tier: 1, count: 2 });
  });

  it('refuses a second commission — a re-pointable house is a menu, not a choice', () => {
    const ctx = createTestContext();
    const house = houseAt(ctx, 2, 2);
    const refused = capture(ctx.bus, 'generator:produce_refused');
    ctx.state.bag.push({ chain: 'flame_gem', tier: 1, count: 1 }, { chain: 'lumber', tier: 1, count: 1 });

    ctx.bus.emit('ui:produce_choice_requested', { itemId: house.id, chain: 'flame_gem', tier: 1 });
    ctx.bus.emit('ui:produce_choice_requested', { itemId: house.id, chain: 'lumber', tier: 1 });
    expect(refused.at(-1)).toMatchObject({ reason: 'already_set' });
    expect(house.produces).toEqual({ chain: 'flame_gem', tier: 1 });
  });

  it('refuses a piece that is not in the bag — only what you carry can be made', () => {
    const ctx = createTestContext();
    const house = houseAt(ctx, 2, 2);
    const refused = capture(ctx.bus, 'generator:produce_refused');
    ctx.bus.emit('ui:produce_choice_requested', { itemId: house.id, chain: 'flame_gem', tier: 1 });
    expect(refused.at(-1)).toMatchObject({ reason: 'not_in_bag' });
    expect(house.produces).toBeUndefined();
  });

  it('refuses a generator that was never commissionable', () => {
    const ctx = createTestContext();
    ctx.systems.board.spawn('bigtree', 1, 2, 2, 'init');
    const tree = ctx.state.items.get(idAt(ctx, 2, 2))!;
    const refused = capture(ctx.bus, 'generator:produce_refused');
    ctx.state.bag.push({ chain: 'flame_gem', tier: 1, count: 1 });
    expect(ctx.systems.generator.awaitingChoice(tree)).toBe(false);
    ctx.bus.emit('ui:produce_choice_requested', { itemId: tree.id, chain: 'flame_gem', tier: 1 });
    expect(refused.at(-1)).toMatchObject({ reason: 'not_commissionable' });
  });

  it('a HOUSE refuses a tier-2 commission — the rank of the building is the rank of the work', () => {
    const ctx = createTestContext();
    const house = houseAt(ctx, 2, 2);
    const refused = capture(ctx.bus, 'generator:produce_refused');
    ctx.state.bag.push({ chain: 'flame_gem', tier: 2, count: 1 });
    ctx.bus.emit('ui:produce_choice_requested', { itemId: house.id, chain: 'flame_gem', tier: 2 });
    expect(refused.at(-1)).toMatchObject({ reason: 'tier_too_high' });
    expect(house.produces).toBeUndefined();
    // …and the SAME house still takes the tier-1 sibling: the refusal is about
    // the piece's rank, never a latch on the building.
    ctx.state.bag.push({ chain: 'flame_gem', tier: 1, count: 1 });
    ctx.bus.emit('ui:produce_choice_requested', { itemId: house.id, chain: 'flame_gem', tier: 1 });
    expect(house.produces).toEqual({ chain: 'flame_gem', tier: 1 });
  });

  it('a MANOR takes tier 1 AND tier 2, and stops at 3', () => {
    const ctx = createTestContext();
    const manorAt = (col: number, row: number) =>
      ctx.state.addItem({ chain: 'lumber', tier: 4, col, row, kind: 'item' });
    const a = manorAt(1, 1);
    const b = manorAt(4, 4);
    const refused = capture(ctx.bus, 'generator:produce_refused');
    ctx.state.bag.push(
      { chain: 'flame_gem', tier: 2, count: 1 },
      { chain: 'lumber', tier: 1, count: 1 },
      { chain: 'flame_gem', tier: 3, count: 1 }
    );
    // A fresh Manor asks the same question a fresh House does.
    expect(ctx.systems.generator.awaitingChoice(a)).toBe(true);
    ctx.bus.emit('ui:produce_choice_requested', { itemId: a.id, chain: 'flame_gem', tier: 2 });
    expect(a.produces).toEqual({ chain: 'flame_gem', tier: 2 });
    ctx.bus.emit('ui:produce_choice_requested', { itemId: b.id, chain: 'flame_gem', tier: 3 });
    expect(refused.at(-1)).toMatchObject({ reason: 'tier_too_high' });
    ctx.bus.emit('ui:produce_choice_requested', { itemId: b.id, chain: 'lumber', tier: 1 });
    expect(b.produces).toEqual({ chain: 'lumber', tier: 1 });
  });

  it('two houses can be commissioned to two different things', () => {
    const ctx = createTestContext();
    const a = houseAt(ctx, 1, 1);
    const b = houseAt(ctx, 4, 4);
    ctx.state.bag.push({ chain: 'flame_gem', tier: 1, count: 1 }, { chain: 'lumber', tier: 1, count: 1 });
    ctx.bus.emit('ui:produce_choice_requested', { itemId: a.id, chain: 'flame_gem', tier: 1 });
    ctx.bus.emit('ui:produce_choice_requested', { itemId: b.id, chain: 'lumber', tier: 1 });
    expect(a.produces).toEqual({ chain: 'flame_gem', tier: 1 });
    expect(b.produces).toEqual({ chain: 'lumber', tier: 1 });
  });

  it('survives a reload — the commission is the house, not the session', () => {
    const ctx = createTestContext();
    const house = houseAt(ctx, 2, 2);
    ctx.state.bag.push({ chain: 'flame_gem', tier: 1, count: 1 });
    ctx.bus.emit('ui:produce_choice_requested', { itemId: house.id, chain: 'flame_gem', tier: 1 });

    const fresh = createTestContext();
    fresh.state.hydrate(ctx.state.toSave(0, 99));
    const reloaded = [...fresh.state.items.values()].find((i) => i.chain === 'lumber' && i.tier === 3)!;
    expect(reloaded.produces).toEqual({ chain: 'flame_gem', tier: 1 });
  });
});
