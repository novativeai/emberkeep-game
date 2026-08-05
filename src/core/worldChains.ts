import chainsJson from '../data/chains.json';
import type { ChainsData } from './types';

const chains = (chainsJson as unknown as ChainsData).chains;

/**
 * Which merge chains belong to which world, derived from `chains.json`'s `world`
 * field. Phaser-free on purpose: the preloader, the board and the tests all need
 * the same answer, and only one of the three can touch Phaser.
 *
 * A chain with no `world` is the primary isle's and stays resident — the rule only
 * exists so a cold world's icons cost nothing to a run that never travels north.
 */
export function worldItemKeys(worldId: string): string[] {
  return chains
    .filter((c) => c.world === worldId)
    .flatMap((c) => c.tiers.map((t) => `item_${c.id}_${t.tier}`));
}

/** Every world-owned item key, flat — the boot preload skips exactly this set. */
const WORLD_ITEM_KEYS = new Set(
  chains.filter((c) => !!c.world).flatMap((c) => c.tiers.map((t) => `item_${c.id}_${t.tier}`))
);

export function isWorldItemArt(key: string): boolean {
  return WORLD_ITEM_KEYS.has(key);
}
