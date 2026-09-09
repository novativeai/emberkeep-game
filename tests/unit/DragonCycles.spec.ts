import { describe, expect, it } from 'vitest';
import { DRAGON_CYCLE_MS, DRAGON_DIET, MEALS_PER_DAY, WELL_FED_EVOLUTION } from '../../src/core/Constants';
import type { DragondexData } from '../../src/core/types';
import assets from '../../src/data/assets.json';
import dragondex from '../../src/data/dragondex.json';
import { capture, createTestContext } from './helpers';

/** A Red Dragon on the board, returned by id — the codex/cycle test subject. */
function placeDragon(ctx: ReturnType<typeof createTestContext>): number {
  ctx.bus.emit('board:spawn', { chain: 'ember_dragon', tier: 3, count: 1 });
  const dragon = [...ctx.state.items.values()].find((i) => i.chain === 'ember_dragon' && i.tier === 3)!;
  expect(dragon).toBeDefined();
  return dragon.id;
}

/** One full serving of his favourite (resin T2 = one whole meal at rate 1). */
function feed(ctx: ReturnType<typeof createTestContext>, itemId: number, times = 1): void {
  for (let i = 0; i < times; i++) {
    ctx.bus.emit('ui:feed_dragon_requested', { itemId, chain: 'resin', tier: 2 });
  }
}

describe('feed cycles — the 10-minute window behind the Dragon Codex', () => {
  it('credits ONE well-fed cycle when the gauge fills, never twice in a window', () => {
    const ctx = createTestContext();
    const itemId = placeDragon(ctx);
    const wellFed = capture(ctx.bus, 'dragon:well_fed');

    feed(ctx, itemId, MEALS_PER_DAY - 1);
    expect(ctx.systems.dragons.wellFedCyclesOf(itemId)).toBe(0); // not full yet

    feed(ctx, itemId);
    expect(ctx.systems.dragons.wellFedCyclesOf(itemId)).toBe(1);
    expect(wellFed).toHaveLength(1);
    expect(wellFed[0]).toMatchObject({ itemId, chain: 'ember_dragon', cycles: 1, needed: 6 });

    // Stuffing him further inside the SAME window credits nothing more.
    feed(ctx, itemId, 3);
    expect(ctx.systems.dragons.wellFedCyclesOf(itemId)).toBe(1);
    expect(wellFed).toHaveLength(1);
  });

  it('the cycle rollover returns hunger to zero, and the next full gauge counts again', () => {
    const ctx = createTestContext();
    const itemId = placeDragon(ctx);
    feed(ctx, itemId, MEALS_PER_DAY);
    expect(ctx.systems.dragons.careOf(itemId).meals).toBeGreaterThanOrEqual(MEALS_PER_DAY);

    // The window turns: no reset job runs — the stale stamp simply stops
    // matching, and the record reads hungry again.
    ctx.clock.advance(DRAGON_CYCLE_MS);
    expect(ctx.systems.dragons.careOf(itemId).meals).toBe(0);
    expect(ctx.systems.dragons.wellFedCyclesOf(itemId)).toBe(1); // lifetime count kept

    feed(ctx, itemId, MEALS_PER_DAY);
    expect(ctx.systems.dragons.wellFedCyclesOf(itemId)).toBe(2);
  });

  it('a MISSED cycle credits nothing — the count is cycles fed, not time served', () => {
    const ctx = createTestContext();
    const itemId = placeDragon(ctx);
    feed(ctx, itemId, MEALS_PER_DAY);
    ctx.clock.advance(DRAGON_CYCLE_MS * 5); // four windows starved
    feed(ctx, itemId, MEALS_PER_DAY);
    expect(ctx.systems.dragons.wellFedCyclesOf(itemId)).toBe(2);
  });

  it('taste rows fill in by EXPERIMENT: a loved meal names the favourite, a refusal names the dislike', () => {
    const ctx = createTestContext();
    const itemId = placeDragon(ctx);
    expect(ctx.systems.dragons.tasteKnowledge(itemId)).toMatchObject({
      favourite: { chain: 'resin', known: false },
      dislike: { chain: 'emberheart', known: false }
    });

    feed(ctx, itemId); // resin — his favourite, and now the player knows it
    expect(ctx.systems.dragons.tasteKnowledge(itemId).favourite.known).toBe(true);
    expect(ctx.systems.dragons.tasteKnowledge(itemId).dislike.known).toBe(false);

    // The head turns away — nothing eaten, but the book writes it down.
    ctx.bus.emit('ui:feed_dragon_requested', { itemId, chain: 'emberheart', tier: 1 });
    expect(ctx.systems.dragons.tasteKnowledge(itemId).dislike.known).toBe(true);
  });

  it('every breed is CODEX READY — a diet implies a page, and a promised adult has its art', () => {
    // The Codex opens on any dragon the player names, and naming reaches every
    // breed with a DRAGON_DIET entry (isBoardDragon). A breed that can be
    // named but has no page would open the book onto a blank card.
    const dex = (dragondex as unknown as DragondexData).dragons;
    const registered = new Set(assets.images.map((img) => img.key));
    for (const breed of Object.keys(DRAGON_DIET)) {
      const entry = dex[breed];
      expect(entry, `dragondex.${breed}`).toBeDefined();
      for (const field of ['title', 'story', 'personality', 'ability'] as const) {
        expect(entry[field], `${breed}.${field}`).toBeTruthy();
      }
      // The Evolution page paints `reveal` as the silhouette; a key that is
      // not in assets.json renders an empty frame over the condition text.
      // And every breed HAS the page now (owner, 2026-08-28): the adult reveal
      // plates ship for all seven, so a dex entry without `evolution` is a
      // dragon the Codex cannot show growing up — a regression, not a choice.
      expect(entry.evolution, `${breed}.evolution`).toBeDefined();
      if (entry.evolution) {
        expect(registered.has(entry.evolution.reveal), `${breed} reveal '${entry.evolution.reveal}'`).toBe(true);
      }
    }
  });

  it('dragondex.json and WELL_FED_EVOLUTION state the same bar — words and law agree', () => {
    // The data file says the words on the Evolution page; Constants holds the
    // number the systems enforce. A retune that moves one without the other
    // ships a page that lies.
    for (const [chain, entry] of Object.entries((dragondex as unknown as DragondexData).dragons)) {
      if (!entry.evolution) continue;
      expect(WELL_FED_EVOLUTION[chain], `WELL_FED_EVOLUTION.${chain}`).toBe(entry.evolution.wellFedCycles);
      expect(entry.evolution.condition).toContain(String(entry.evolution.wellFedCycles));
    }
  });
});
