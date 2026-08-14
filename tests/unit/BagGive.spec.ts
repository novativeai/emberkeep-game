import { describe, expect, it } from 'vitest';
import { REGARD_POINTS_PER_HEART } from '../../src/core/Constants';
import type { GameContext } from '../../src/core/Context';
import { capture, createTestContext } from './helpers';

/**
 * GIVE is the bag's third verb and it spans two systems: the panel arms it, the
 * board delivers it. These cover the seam — that the piece leaves the BAG (not
 * the board) exactly when the recipient's own record moved, and never otherwise.
 *
 * The scene half (which tap resolves to which recipient) is Phaser and is not
 * unit-testable; what is testable, and what actually breaks, is the accounting.
 */
function pocket(ctx: GameContext, chain: string, tier: number, count = 1): void {
  ctx.bus.emit('bag:bank', { chain, tier, count });
}

const heldCount = (ctx: GameContext, chain: string, tier: number): number =>
  ctx.state.bag.find((s) => s.chain === chain && s.tier === tier)?.count ?? 0;

describe('giving a pocketed piece', () => {
  it('leaves the bag only once she has actually taken it', () => {
    const ctx = createTestContext();
    pocket(ctx, 'quartz', 3);
    ctx.bus.emit('tutorial:want_gift', {
      characterId: 'eleanor',
      chain: 'quartz',
      tier: 3,
      count: 1,
      points: REGARD_POINTS_PER_HEART
    });

    const before = ctx.systems.regard.given('eleanor', 'quartz', 3);
    ctx.bus.emit('ui:gift_requested', { characterId: 'eleanor', chain: 'quartz', tier: 3 });
    expect(ctx.systems.regard.given('eleanor', 'quartz', 3)).toBe(before + 1);

    // The board consumes from the BAG only after reading that counter — this is
    // the step it takes once the gift landed.
    ctx.bus.emit('bag:consume', { chain: 'quartz', tier: 3, count: 1 });
    expect(heldCount(ctx, 'quartz', 3)).toBe(0);
    expect(ctx.systems.regard.hearts('eleanor')).toBe(1);
  });

  it('a refused gift costs the player nothing — it stays pocketed', () => {
    const ctx = createTestContext();
    pocket(ctx, 'moonwater', 1);
    const declined = capture(ctx.bus, 'regard:gift_declined');

    // Nothing asks for Moonwater, so the counter cannot move and the board
    // never reaches its `bag:consume`.
    const before = ctx.systems.regard.given('eleanor', 'moonwater', 1);
    ctx.bus.emit('ui:gift_requested', { characterId: 'eleanor', chain: 'moonwater', tier: 1 });

    expect(declined).toHaveLength(1);
    expect(ctx.systems.regard.given('eleanor', 'moonwater', 1)).toBe(before);
    expect(heldCount(ctx, 'moonwater', 1)).toBe(1);
  });

  it('feeds a dragon out of the bag on the same contract', () => {
    const ctx = createTestContext();
    pocket(ctx, 'resin', 3);
    const free = ctx.state.freeActiveTilesNear(0, 0)[0]!;
    const dragon = ctx.state.addItem({
      chain: 'ember_dragon',
      tier: 3,
      col: free.col,
      row: free.row,
      kind: 'item'
    });

    const before = ctx.systems.dragons.careOf(dragon.id).meals;
    ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'resin', tier: 3 });
    expect(ctx.systems.dragons.careOf(dragon.id).meals).toBeGreaterThan(before);

    ctx.bus.emit('bag:consume', { chain: 'resin', tier: 3, count: 1 });
    expect(heldCount(ctx, 'resin', 3)).toBe(0);
  });

  it('a dragon that refuses the food leaves it in the bag', () => {
    const ctx = createTestContext();
    pocket(ctx, 'emberheart', 2); // the Red's refusal
    const free = ctx.state.freeActiveTilesNear(0, 0)[0]!;
    const dragon = ctx.state.addItem({
      chain: 'ember_dragon',
      tier: 3,
      col: free.col,
      row: free.row,
      kind: 'item'
    });
    const refused = capture(ctx.bus, 'dragon:refused');

    ctx.bus.emit('ui:feed_dragon_requested', { itemId: dragon.id, chain: 'emberheart', tier: 2 });

    expect(refused).toHaveLength(1);
    expect(ctx.systems.dragons.careOf(dragon.id).meals).toBe(0);
    expect(heldCount(ctx, 'emberheart', 2)).toBe(1);
  });
});

describe('a resumed tutorial step re-asks its question', () => {
  it('re-opens the naming prompt, so a reload mid-beat is not a dead save', async () => {
    const { GameContext } = await import('../../src/core/Context');
    const { MemoryStorage } = await import('./helpers');
    const ctx = new GameContext(new MemoryStorage());
    const asked: unknown[] = [];
    ctx.bus.on('ui:name_dragon_requested', (p) => asked.push(p));

    const free = ctx.state.freeActiveTilesNear(0, 0)[0]!;
    ctx.state.addItem({ chain: 'ember_dragon', tier: 3, col: free.col, row: free.row, kind: 'item' });
    // Sitting ON the beat whose effect opens the prompt — exactly where a save
    // resumed after the panel was dismissed or failed to open lands.
    ctx.state.tutorialIndex = ctx.data.tutorial.steps.findIndex((s) => s.id === 'name_choose');

    ctx.systems.tutorial.begin();

    expect(asked).toHaveLength(1);
  });

  it('re-stages a scripted want, which is never persisted', async () => {
    const { GameContext } = await import('../../src/core/Context');
    const { MemoryStorage } = await import('./helpers');
    const ctx = new GameContext(new MemoryStorage());
    ctx.state.tutorialIndex = ctx.data.tutorial.steps.findIndex((s) => s.id === 'eleanor_gift');

    expect(ctx.systems.regard.wants('eleanor', 'quartz', 3)).toBe(false);
    ctx.systems.tutorial.begin();
    expect(ctx.systems.regard.wants('eleanor', 'quartz', 3)).toBe(true);
  });
});
