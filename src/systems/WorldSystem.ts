import { GOLDEN_ALTAR, HATCHERY_QUESTS_NEEDED } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { WorldRuntime } from '../core/world';

/**
 * WORLD TRAVEL — which world the board is showing.
 *
 * The switch itself is one line in GameState; everything here is the RULES
 * around it, which is why it is a system and not a method call from the UI:
 *
 *   • Never mid-tutorial. Every scripted step names cells on the authored isle,
 *     and a step whose cell is on another world is a step that can never
 *     complete. This is the invariant that keeps the shipped onboarding safe no
 *     matter what later hangs a travel button off the bus.
 *   • Never above the Keeper's rank. A world declares the level it opens at.
 *   • Arriving somewhere lifts the ground you have already earned. Region status
 *     is Keeper progress, not per-world progress, but a level-gated region only
 *     hears `keeper:leveled` while its world is loaded — so a world entered for
 *     the first time at level 3 would otherwise sit under fog it should never
 *     have had. This settles it on arrival instead.
 *
 * What travel deliberately does NOT do is touch the board it leaves. Items,
 * timers and nests stay exactly as they were (GameState keeps a board per
 * world); coming back is a change of view, not a reload.
 */
export class WorldSystem {
  constructor(
    private state: GameState,
    private bus: EventBus
  ) {
    bus.on('world:switch', ({ to }) => this.switchTo(to));
  }

  /** Worlds the Keeper may travel to right now, in the order they open. */
  available(): WorldRuntime[] {
    return [...this.state.worlds.values()]
      .filter(
        (w) => this.state.tutorialDone && this.state.level >= w.level && this.storyOpen(w.id)
      )
      .sort((a, b) => a.level - b.level);
  }

  /**
   * Every door beyond Emberkeep opens on the STORY, never on a number a player
   * crosses mid-merge. All three keys are save-derivable stats, so a reload
   * finds each gate exactly as open as it was:
   *
   *   roothold — Eleanor's first delivered order (the tutorial delivers it, so
   *              her hub opens the moment the game hands over);
   *   borealis — the Golden Elder awake (`q:done:keepers_hoard`, the same
   *              latch the altar derives her presence from);
   *   hatchery — HATCHERY_QUESTS_NEEDED of Selyna's quests done, read off the
   *              per-world counter QuestSystem keeps (`q:world:borealis:done`).
   */
  private storyOpen(worldId: string): boolean {
    if (worldId === 'roothold') return this.state.completedOrderIds.includes('eleanor_brazier');
    if (worldId === 'borealis') return this.state.stat(`q:done:${GOLDEN_ALTAR.awakenQuestId}`) > 0;
    if (worldId === 'hatchery') return this.state.stat('q:world:borealis:done') >= HATCHERY_QUESTS_NEEDED;
    return true;
  }

  private switchTo(to: string): void {
    const world = this.state.worlds.get(to);
    if (!world) {
      this.bus.emit('world:switch_failed', { to, reason: 'unknown' });
      return;
    }
    if (to === this.state.worldId) {
      this.bus.emit('world:switch_failed', { to, reason: 'same' });
      return;
    }
    if (!this.state.tutorialDone) {
      this.bus.emit('world:switch_failed', { to, reason: 'tutorial' });
      return;
    }
    if (this.state.level < world.level) {
      this.bus.emit('world:switch_failed', { to, reason: 'level' });
      return;
    }
    if (!this.storyOpen(to)) {
      this.bus.emit('world:switch_failed', { to, reason: 'story' });
      return;
    }
    const from = this.state.worldId;
    const arriving = !this.state.visited(to);
    this.state.switchWorld(to);
    this.settleUnlocks(world);
    if (arriving) this.seed(world);
    this.bus.emit('world:switched', { from, to });
  }

  /**
   * Put the opening board out, the first time the Keeper stands somewhere.
   *
   * `BoardSystem.newGame` seeds the AUTHORED world and nothing else, so without
   * this a world of its own opens as bare ground: no producer on the island you
   * land on, and — since a merge cannot cross water — no way to ever get one.
   * Regions that are still fogged keep their contents for the day they lift,
   * which is what makes this exactly "the ground you can already stand on".
   */
  private seed(world: WorldRuntime): void {
    for (const region of world.map.regions) {
      if (this.state.regionStatus.get(region.id) !== 'active') continue;
      if (!region.contents?.length) continue;
      this.bus.emit('region:reveal', { regionId: region.id });
    }
  }

  /**
   * Open the level-gated regions this world would already have opened had the
   * Keeper been standing on it when they ranked up.
   *
   * Written straight to `regionStatus` rather than replayed through
   * `keeper:leveled`: that event also drives the Chapter One finale, the camera
   * flights and the XP bar, none of which should fire again because someone
   * walked through a door.
   */
  private settleUnlocks(world: WorldRuntime): void {
    for (const region of world.map.regions) {
      const level = region.unlock?.level;
      if (level === undefined || level > this.state.level) continue;
      if (this.state.regionStatus.get(region.id) === 'active') continue;
      this.state.regionStatus.set(region.id, 'active');
    }
  }
}
