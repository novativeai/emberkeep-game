import { describe, expect, it } from 'vitest';
import realMap from '../../src/data/map.json';
import { buildWorlds } from '../../src/core/world';
import type { MapData } from '../../src/core/types';
import fixtureMap from '../fixtures/map-8x8.json';

/**
 * WorldRuntime.itemScale — the one number that sizes every board piece in a
 * world (art, rig, clip overlay, shadow width, shadow seat), derived as the
 * playable-cell-weighted median of each cell's owning zone's artScale.
 *
 * Pinned to two decimals because the derivation is meant to MOVE with a
 * re-export: when a repaint changes a world's tile, these numbers change with
 * it, and this spec is where that change is noticed rather than shipped blind.
 * The invariants below the pins are the part that must never move.
 */
describe('per-world item scale', () => {
  const worlds = buildWorlds(realMap as unknown as MapData);

  it('Emberkeep is the baseline every piece was tuned against', () => {
    // Exactly 1, and organically: the authored isle's dense zone (artScale 1
    // by definition) is the median stone, so no special case is needed — and
    // if a future re-export ever tips the median off 1, that is a real design
    // event this line exists to surface.
    expect(worlds.get('emberkeep')?.itemScale).toBe(1);
  });

  it('the smaller-tiled worlds land where their ground was measured', () => {
    expect(worlds.get('borealis')?.itemScale).toBe(0.69);
    expect(worlds.get('roothold')?.itemScale).toBe(0.67);
    expect(worlds.get('runevault')?.itemScale).toBe(0.66);
  });

  it('every shipped world scales pieces DOWN or not at all, never up', () => {
    // A factor above 1 would blow art past the resolution it ships at; the
    // authored isle is the largest tile by design.
    for (const [id, w] of worlds) {
      expect(w.itemScale, id).toBeGreaterThan(0.4);
      expect(w.itemScale, id).toBeLessThanOrEqual(1);
    }
  });

  it('a bare fixture map (no zones adopted) stays at 1', () => {
    // The 8×8 unit fixture fails zones.json's baseSignature guard, gets one
    // dense zone, and must keep the pre-zone behaviour exactly — every unit
    // test that sizes anything depends on it.
    const fixture = buildWorlds(fixtureMap as unknown as MapData);
    expect(fixture.get('emberkeep')?.itemScale).toBe(1);
  });
});
