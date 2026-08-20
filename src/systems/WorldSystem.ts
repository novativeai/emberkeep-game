import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { WorldRuntime } from '../core/world';
import { groundCellAtWorldPoint, nearestPlayableCell, worldPointOf, zoneAt } from '../core/world';
import { GATE_LANDING } from '../core/Constants';
import type { CharactersData, TilePos } from '../core/types';
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
    private bus: EventBus,
    /** Who stands where. Read ONLY to keep an arriving dragon off their feet —
     *  a standee is decor, never a board item, so nothing else in this file
     *  can see them and a landing would otherwise treat their ground as empty. */
    private folk: CharactersData
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
   * Where an arriving dragon comes out: a few paces clear of the far side's own
   * door back, else beside it, else the first free playable cell. Never on top
   * of something — the far board is live even while unwatched, and a crossing
   * must not displace a piece the player left there.
   */
  private landingCell(world: WorldRuntime, from: string): TilePos | null {
    const board = this.state.itemsIn(world.id);
    const taken = new Set([...(board?.values() ?? [])].map((i) => `${i.col},${i.row}`));
    const free = (col: number, row: number): boolean =>
      world.playable.has(`${col},${row}`) && !taken.has(`${col},${row}`);

    // The door BACK is the anchor: a dragon that crossed at the arch comes out
    // beside the arch. Portals are authored as world-pixel rectangles, so the
    // anchor is the world POINT at their centre.
    const doorBack = world.portals.find((p) => p.to === from);
    if (doorBack) {
      const door = {
        x: doorBack.x + doorBack.width / 2,
        y: doorBack.y + doorBack.height / 2
      };
      // FIRST ASK FOR A FEW PACES OF DISTANCE. A dragon seated on the door's
      // own cell is standing inside the archway he just came through — the
      // picture says "still crossing", not "arrived". `standoffCell` answers
      // with the NEAREST ground a stated number of its own tiles clear of the
      // arch, and null when the door's island cannot offer one; everything
      // below is then exactly the landing this had before, unchanged.
      const clear = this.standoffCell(world, door, free);
      if (clear) return clear;

      // `groundCellAtWorldPoint`, not `cellAtWorldPoint`: an archway is painted
      // OFF the playable ground more often than not, and the unbounded version
      // answers such a point with a projection through the authored Emberkeep
      // lattice — an address a Roothold zone may well own, hundreds of pixels
      // from the door. Every step below then rang out from a cell that had
      // nothing to do with the arch, which is the "he came out miles away" of
      // it. Null simply means the ring has no honest centre; the sweep below
      // does not need one.
      const at = groundCellAtWorldPoint(world, door.x, door.y);
      if (at) {
        // Rings out from it, so "he is waiting at the arch" stays true even when
        // the exact tile under the door is occupied.
        for (let r = 0; r <= 3; r++) {
          for (let dc = -r; dc <= r; dc++) {
            for (let dr = -r; dr <= r; dr++) {
              if (Math.max(Math.abs(dc), Math.abs(dr)) !== r) continue;
              if (free(at.col + dc, at.row + dr)) return { col: at.col + dc, row: at.row + dr };
            }
          }
        }
      }
      // Past the ring — or with no ring at all — the cell PHYSICALLY nearest the
      // door. In world pixels, never in cell indices: a world is a registry of
      // zones whose blocks sit side by side with gutters between them, so
      // `|Δcol| + |Δrow|` calls a cell on the next island two away and the slab
      // under your feet thirty. Measuring where the player actually looks is
      // the only distance that means anything across a zoned world.
      const best = nearestPlayableCell(world, door.x, door.y, free);
      if (best) return best;
    }
    // No door back at all: anywhere it can stand.
    for (const key of world.playable) {
      const [col, row] = key.split(',').map(Number);
      if (free(col!, row!)) return { col: col!, row: row! };
    }
    return null;
  }

  /**
   * The nearest cell that is clear of the arch AND clear of the people by it.
   *
   * ONE UNIT FOR THE WHOLE SWEEP — the tile of the ground the arch opens onto,
   * not each candidate's own. Measuring per candidate is what let Eleanor's
   * small-tiled slab satisfy a four-tile bar at 357 real px and win the sweep
   * for being nearest; see GATE_LANDING. The anchor ignores occupancy on
   * purpose: what a tile MEASURES cannot depend on whether a piece happens to
   * be standing on the cell we took the measurement from.
   *
   * Null when nothing satisfies it, and the caller then keeps the old answer
   * beside the arch rather than flinging the animal across open sky.
   */
  private standoffCell(
    world: WorldRuntime,
    door: { x: number; y: number },
    free: (col: number, row: number) => boolean
  ): TilePos | null {
    const anchor = nearestPlayableCell(world, door.x, door.y);
    const zone = anchor ? zoneAt(world, anchor.col, anchor.row) : undefined;
    if (!zone) return null;
    // The average of the two lattice steps: a tile is a diamond, and either
    // edge on its own reads as "a cell" from the player's side.
    const tile = (Math.hypot(zone.u.x, zone.u.y) + Math.hypot(zone.v.x, zone.v.y)) / 2;
    const near = GATE_LANDING.standoffCells * tile;
    const far = (GATE_LANDING.standoffCells + GATE_LANDING.slackCells) * tile;
    const clear = GATE_LANDING.folkCells * tile;
    const standing = this.folkPoints(world);

    return nearestPlayableCell(world, door.x, door.y, (col, row) => {
      if (!free(col, row)) return false;
      const p = worldPointOf(world, col, row);
      const d = Math.hypot(p.x - door.x, p.y - door.y);
      if (d < near || d > far) return false;
      return standing.every((f) => Math.hypot(p.x - f.x, p.y - f.y) >= clear);
    });
  }

  /**
   * Where this world's authored characters stand, in world px.
   *
   * Their ANCHOR CELL, not their drawn standee: `dx`/`dy` are World-Builder
   * pixels that the renderer rebases by the map's own tile width, so adding
   * them raw here would be a different measurement from the one on screen.
   * The cell is where she is STANDING, which is the thing a dragon must not
   * land on, and it needs no rebasing to be true.
   */
  private folkPoints(world: WorldRuntime): Array<{ x: number; y: number }> {
    return this.folk.characters
      .filter((c) => c.world === world.id)
      .map((c) => worldPointOf(world, c.anchor[0], c.anchor[1]));
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
