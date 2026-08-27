import { CAULDRON_REACHED_STAT } from './Constants';
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
 * How each door beyond Emberkeep opens:
 *
 *   roothold — Eleanor's first delivered order (the tutorial delivers it, so
 *              her hub opens the moment the game hands over);
 *   borealis — the KEEPER'S LEVEL alone (owner's call, 2026-08-26: "unlock the
 *              portal to borealis at level"). The world's own `level` in
 *              zones.json is the number; the old `q:done:keepers_hoard` story
 *              latch is gone, so `worldOpen`'s rank clause is the whole gate.
 *              The Elder's AWAKENING stays a quest beat — only the door moved;
 *   runevault — the KEEPER'S LEVEL (zones.json says 6, the rank that clears
 *              the last clouds off Borealis's main island) OR the cauldron
 *              latch below — see `cloudLevelMet`. The old Selyna-quest-count
 *              latch is gone.
 */
export function storyOpen(state: GameState, worldId: string): boolean {
  if (worldId === 'roothold') return state.completedOrderIds.includes('eleanor_brazier');
  return true;
}

/** Has any ladder put its first brew quest in the player's hands yet? Written
 *  by QuestSystem (monotonic, save-carried); see CAULDRON_REACHED_STAT. */
export function cauldronReached(state: GameState): boolean {
  return state.stat(CAULDRON_REACHED_STAT) > 0;
}

/** Where the cauldron latch counts as rank: Borealis's own cloud slabs, and
 *  the Runevault the pot stands in. Emberkeep's level regions are NOT here —
 *  the southern isle's pacing is untouched. */
const CAULDRON_KEY_WORLDS = new Set(['borealis', 'runevault']);

/**
 * THE DOUBLE KEY (owner's law, 2026-08-26): a level requirement on Borealis's
 * clouds or on the Rune Way is met by the RANK **or** by the ladder REACHING
 * its first cauldron quest — whichever comes first. A grinder sees the north
 * open at the cap without touching Selyna's quests; a quester is never handed
 * "Brew Tar Buckets" with the pot's door still shut. One predicate, so
 * UnlockSystem, WorldSystem's arrival settle and the door gate below can
 * never disagree.
 */
export function cloudLevelMet(state: GameState, worldId: string, level: number): boolean {
  if (state.level >= level) return true;
  return CAULDRON_KEY_WORLDS.has(worldId) && cauldronReached(state);
}

/**
 * Could the Keeper be standing on this world right now? The story gate above,
 * plus the two rules that hold for every world: never mid-tutorial (its
 * scripted steps all name cells on the authored isle), and never above the
 * Keeper's rank (a world declares the level it opens at — met by rank or, for
 * the Rune Way, by the cauldron latch).
 */
export function worldOpen(state: GameState, worldId: string): boolean {
  const world = state.worlds.get(worldId);
  if (!world) return false;
  return state.tutorialDone && cloudLevelMet(state, worldId, world.level) && storyOpen(state, worldId);
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
