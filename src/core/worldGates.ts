import { GOLDEN_ALTAR, RUNEVAULT_QUESTS_NEEDED } from './Constants';
import type { GameState } from './GameState';

/**
 * WHICH WORLDS ARE OPEN TO THE KEEPER — one answer, several askers.
 *
 * WorldSystem asks it to decide whether a door may be walked through. The
 * Store asks it to decide whether the goods of a place may be bought yet. They
 * must agree: a shelf that sells Borealis ice while the North Crossing is still
 * shut promises a place the player cannot reach, and a shelf still padlocked
 * after they have stood there is a reward that never arrived. So the rule lives
 * here rather than inside whichever system happened to need it first.
 *
 * Every answer is derived from state the SAVE already carries, so a reload
 * finds each gate exactly as open as it was.
 */

/**
 * Every door beyond Emberkeep opens on the STORY, never on a number a player
 * crosses mid-merge:
 *
 *   roothold — Eleanor's first delivered order (the tutorial delivers it, so
 *              her hub opens the moment the game hands over);
 *   borealis — the Golden Elder awake (`q:done:keepers_hoard`, the same latch
 *              the altar derives her presence from);
 *   runevault — RUNEVAULT_QUESTS_NEEDED of Selyna's quests done, read off the
 *              per-world counter QuestSystem keeps (`q:world:borealis:done`).
 */
export function storyOpen(state: GameState, worldId: string): boolean {
  if (worldId === 'roothold') return state.completedOrderIds.includes('eleanor_brazier');
  if (worldId === 'borealis') return state.stat(`q:done:${GOLDEN_ALTAR.awakenQuestId}`) > 0;
  if (worldId === 'runevault') return state.stat('q:world:borealis:done') >= RUNEVAULT_QUESTS_NEEDED;
  return true;
}

/**
 * Could the Keeper be standing on this world right now? The story gate above,
 * plus the two rules that hold for every world: never mid-tutorial (its
 * scripted steps all name cells on the authored isle), and never above the
 * Keeper's rank (a world declares the level it opens at).
 */
export function worldOpen(state: GameState, worldId: string): boolean {
  const world = state.worlds.get(worldId);
  if (!world) return false;
  return state.tutorialDone && state.level >= world.level && storyOpen(state, worldId);
}

/**
 * The hub that fronts each MAIN world's goods: Roothold is Emberkeep's
 * shopfront, the Runevault is Borealis's (owner's call, 2026-08-26).
 */
const HUB_OF: Record<string, string> = { emberkeep: 'roothold', borealis: 'runevault' };

/**
 * Is a store item tagged for `itemWorld` sold where the Keeper stands? Local
 * goods are sold where they are made AND in that world's own hub — the hubs
 * are the main worlds' storefronts, not fifth catalogues. Untagged goods sell
 * everywhere. StoreSystem enforces it at the bus and StorePanel padlocks by
 * it, through this one predicate so the two can never disagree.
 */
export function soldHere(itemWorld: string | undefined, worldId: string): boolean {
  if (!itemWorld) return true;
  return itemWorld === worldId || HUB_OF[itemWorld] === worldId;
}
