import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { WorldRuntime } from '../core/world';
import { cellAtWorldPoint } from '../core/world';
import type { TilePos } from '../core/types';
import { storyOpen, worldOpen } from '../core/worldGates';

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
    bus.on('dragon:cross_gate', ({ itemId, to }) => this.crossDragon(itemId, to));
  }

  /**
   * A dragon goes through a gate, and STAYS through.
   *
   * The Keeper does not travel — this is the animal scouting ahead, and the
   * story it tells only works if following it later actually finds it there.
   * A flourish that flew it into the light and back out again was the same
   * picture with the meaning taken out: it says "he went" and then unsays it.
   *
   * The landing cell is chosen HERE rather than authored, because the far side
   * may never have been visited and has no idea anyone is coming. The gate the
   * two worlds share is the anchor — a dragon that crossed at the arch comes
   * out beside the arch — and the search widens from there to the first free
   * playable cell, so a busy hub simply seats it one tile over.
   */
  private crossDragon(itemId: number, to: string): void {
    const from = this.state.worldId;
    const world = this.state.worlds.get(to);
    if (!world || to === from) return;
    const at = this.landingCell(world, from);
    if (!at || !this.state.crossItemToWorld(itemId, to, at)) return;
    this.bus.emit('dragon:crossed', { itemId, from, to, at });
  }

  /**
   * Where an arriving dragon comes out: beside the far side's own door back,
   * else the first free playable cell. Never on top of something — the far
   * board is live even while unwatched, and a crossing must not displace a
   * piece the player left there.
   */
  private landingCell(world: WorldRuntime, from: string): TilePos | null {
    const board = this.state.itemsIn(world.id);
    const taken = new Set([...(board?.values() ?? [])].map((i) => `${i.col},${i.row}`));
    const free = (col: number, row: number): boolean =>
      world.playable.has(`${col},${row}`) && !taken.has(`${col},${row}`);

    // The door BACK is the anchor: a dragon that crossed at the arch comes out
    // beside the arch. Portals are authored as world-pixel rectangles, so the
    // cell is whichever one their centre lands on.
    const doorBack = world.portals.find((p) => p.to === from);
    if (doorBack) {
      const at = cellAtWorldPoint(
        world,
        doorBack.x + doorBack.width / 2,
        doorBack.y + doorBack.height / 2
      );
      // Rings out from it, so "he is waiting at the arch" stays true even when
      // the exact tile under the door is occupied or is not playable ground.
      for (let r = 0; r <= 3; r++) {
        for (let dc = -r; dc <= r; dc++) {
          for (let dr = -r; dr <= r; dr++) {
            if (Math.max(Math.abs(dc), Math.abs(dr)) !== r) continue;
            if (free(at.col + dc, at.row + dr)) return { col: at.col + dc, row: at.row + dr };
          }
        }
      }
    }
    // No door back, or the whole neighbourhood is full: anywhere it can stand.
    for (const key of world.playable) {
      const [col, row] = key.split(',').map(Number);
      if (free(col!, row!)) return { col: col!, row: row! };
    }
    return null;
  }


  /** Worlds the Keeper may travel to right now, in the order they open. The
   *  rule itself lives in `core/worldGates` — the Store shelves read the same
   *  one, so the goods of a place unlock exactly when the place does. */
  available(): WorldRuntime[] {
    return [...this.state.worlds.values()]
      .filter((w) => worldOpen(this.state, w.id))
      .sort((a, b) => a.level - b.level);
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
    if (!storyOpen(this.state, to)) {
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
