import { describe, expect, it } from 'vitest';
import { chainHiddenIn } from '../../src/core/Constants';
import { reachableRecipeKeys, type AuditData } from '../../src/core/availability';
import { buildWorlds } from '../../src/core/world';
import chains from '../../src/data/chains.json';
import quests from '../../src/data/quests.json';
import orders from '../../src/data/orders.json';
import tasks from '../../src/data/tasks.json';
import tutorial from '../../src/data/tutorial.json';
import cauldron from '../../src/data/cauldron.json';
import authoredMap from '../../src/data/map.json';
import type { MapData } from '../../src/core/types';

/**
 * THE COOKBOOK'S PAGES, one per world — the question CookbookPanel asks to fill
 * a page and to decide whether that page gets a tab at all.
 *
 * The panel used to ask it against `ctx.data.map`, which is the AUTHORED isle
 * whatever world is named, so every page answered "what can Emberkeep produce?"
 * under a different label: Borealis printed the southern Quartz chain, and
 * Roothold — a lair with no producers and no seeds — printed the same southern
 * recipes as though it merged anything at all. The world's OWN map is what
 * makes the answer true, and these are the three facts that proves.
 */
const worlds = buildWorlds(authoredMap as unknown as MapData);

/** Exactly what the panel prints: reachable here, minus the altar's lore chain,
 *  minus every chain withheld from this world. */
function pageOf(worldId: string): string[] {
  const world = worlds.get(worldId)!;
  const data = {
    chains,
    quests,
    orders,
    tasks,
    tutorial,
    cauldron,
    worldId,
    map: world.map
  } as unknown as AuditData;
  return [...reachableRecipeKeys(data)]
    .filter((key) => {
      const id = key.split(':')[0]!;
      const chain = chains.chains.find((c) => c.id === id);
      return !!chain && id !== 'golden_egg' && !chainHiddenIn(chain, worldId);
    })
    .sort();
}

const chainsOf = (page: string[]): Set<string> => new Set(page.map((k) => k.split(':')[0]!));

describe('the Cookbook prints one world per page', () => {
  it('gives Roothold no page at all — it is a lair, and lairs merge nothing', () => {
    // The tab is hidden on exactly this answer, so the emptiness is the point.
    expect(pageOf('roothold')).toEqual([]);
    expect(pageOf('runevault')).toEqual([]);
  });

  it('keeps the southern chains out of the northern page, and the northern out of the south', () => {
    const north = chainsOf(pageOf('borealis'));
    const south = chainsOf(pageOf('emberkeep'));
    // The reported defect, in one line: Quartz Pebble → Cut Crystal is Emberkeep's.
    expect(south.has('quartz')).toBe(true);
    expect(north.has('quartz')).toBe(false);
    for (const only of ['ashmoss', 'moonwater', 'resin', 'lumber', 'ember_dragon']) {
      expect(north.has(only), `${only} is southern and must not print in Borealis`).toBe(false);
    }
    for (const only of ['glasskiln', 'seaglass', 'rimewyrm']) {
      expect(south.has(only), `${only} is northern and must not print in Emberkeep`).toBe(false);
      expect(north.has(only), `${only} is northern and must print in Borealis`).toBe(true);
    }
    // The Runestone's merge ladder went dormant with its seeded generator
    // (owner, 2026-08-28): no faucet drops Rune Chips any more, so the ladder's
    // rows print NOWHERE — the stone the north actually needs arrives BREWED
    // (the `rune_shard` cauldron page), which the quests audit still proves.
    expect(south.has('runestone')).toBe(false);
    expect(north.has('runestone')).toBe(false);
  });

  it('prints only chains a world is allowed to hold, so `n / N` is finishable', () => {
    for (const id of ['emberkeep', 'borealis']) {
      const page = pageOf(id);
      expect(page.length, `${id} has a page`).toBeGreaterThan(0);
      for (const chain of chainsOf(page)) {
        const config = chains.chains.find((c) => c.id === chain)!;
        expect(chainHiddenIn(config, id), `${chain} on ${id}'s page`).toBe(false);
      }
    }
  });
});
