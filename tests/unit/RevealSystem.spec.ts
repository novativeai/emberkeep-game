import { describe, expect, it } from 'vitest';
import { DRAGON_REVEAL } from '../../src/core/Constants';
import assetsDoc from '../../src/data/assets.json';
import storeDoc from '../../src/data/store.json';
import type { StoreData } from '../../src/core/types';
import { revealKey } from '../../src/systems/RevealSystem';
import { capture, createTestContext } from './helpers';

/**
 * The reveal is a full-screen interruption, so the only thing that really
 * matters about it is that it happens ONCE. "Once" is a fact about the save,
 * not about the screen — which is why the latch lives in `stats` and is tested
 * here rather than left to the scene that draws the card.
 */
describe('RevealSystem (first sight of a dragon form)', () => {
  it('announces a hatched whelp exactly once, ever', () => {
    const ctx = createTestContext();
    const seen = capture(ctx.bus, 'dragon:revealed');
    const item = ctx.state.addItem({ chain: 'ember_dragon', tier: 3, col: 1, row: 1, kind: 'item' });
    const snap = ctx.state.snapshot(item, 0);

    ctx.bus.emit('item:hatched', { item: snap });
    ctx.bus.emit('item:hatched', { item: snap });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ chain: 'ember_dragon', tier: 3, art: 'reveal_ember' });
    expect(ctx.state.stat(revealKey('ember_dragon', 3))).toBe(1);
  });

  it('stays quiet after a reload — the latch rides the save', () => {
    const ctx = createTestContext();
    const item = ctx.state.addItem({ chain: 'ember_dragon', tier: 3, col: 1, row: 1, kind: 'item' });
    ctx.bus.emit('item:hatched', { item: ctx.state.snapshot(item, 0) });

    const fresh = createTestContext();
    fresh.state.hydrate(ctx.state.toSave(0, 99));
    const seen = capture(fresh.bus, 'dragon:revealed');
    const again = fresh.state.addItem({ chain: 'ember_dragon', tier: 3, col: 2, row: 1, kind: 'item' });

    fresh.bus.emit('item:hatched', { item: fresh.state.snapshot(again, 0) });

    expect(seen).toEqual([]);
    expect(fresh.systems.reveal.seen('ember_dragon', 3)).toBe(true);
  });

  it('an adult is its own reveal, and a merge to a non-dragon tier is not', () => {
    const ctx = createTestContext();
    const seen = capture(ctx.bus, 'dragon:revealed');
    const merged = (chain: string, resultTier: number): void =>
      ctx.bus.emit('item:merged', {
        chain, fromTier: resultTier - 1, resultTier, at: { col: 0, row: 0 },
        consumedIds: [], consumedAt: [], outputs: [], xp: 0
      });

    merged('ember_dragon', 4);
    merged('ashmoss', 3); // food, not a dragon
    merged('golden_egg', 2); // a merged Elder (brewed eggs) — has a card

    expect(seen.map((s) => `${s.chain}:${s.tier}`)).toEqual([
      'ember_dragon:4',
      'golden_egg:2'
    ]);
  });
});

describe('the reveal roster and the Emporium landmarks (authored data)', () => {
  const keys = new Set(assetsDoc.images.map((image) => image.key));

  it('every reveal card points at art that is registered', () => {
    expect(Object.keys(DRAGON_REVEAL).length).toBeGreaterThan(0);
    for (const [form, card] of Object.entries(DRAGON_REVEAL)) {
      expect(keys, `${form} art`).toContain(card.art);
      expect(card.name.length, `${form} name`).toBeGreaterThan(0);
      expect(card.epithet.length, `${form} epithet`).toBeGreaterThan(0);
    }
  });

  it('the Golden Elder has a card for a MERGED hatch; the altar keeps the finale', () => {
    // Amended when Selyna's Cauldron made Golden Eggs brewable: merging three
    // is a player act outside the story, and that hatch gets the ceremony. The
    // finale itself is a QUEST trigger (`FINALE`, `quest:completed`) — it never
    // routes through DRAGON_REVEAL, so the altar beat is untouched by this card.
    expect(DRAGON_REVEAL['golden_egg:2']).toBeDefined();
    expect(DRAGON_REVEAL['golden_egg:2']!.art).toBe('reveal_golden');
    expect(keys).toContain('reveal_golden_adult');
  });

  it('every decoration on the shelf has art and a price', () => {
    const decor = (storeDoc as StoreData).sections.find((s) => s.id === 'decor')!;
    expect(decor.items.length).toBeGreaterThanOrEqual(13);
    for (const item of decor.items) {
      expect(keys, `${item.id} art`).toContain(item.art);
      expect(item.gold, `${item.id} price`).toBeGreaterThan(0);
    }
  });
});
