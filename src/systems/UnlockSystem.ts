import { chainHiddenIn } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import { cloudLevelMet } from '../core/worldGates';
import type { ChainsData, ItemSnapshot, MapData, MapRegionConfig, TilePos } from '../core/types';

/**
 * Lifting fog. Two gates:
 *   • KEY regions (`unlock.keys`) lift when the player taps them with enough
 *     Gold Keys — the tutorial's north_fog lesson.
 *   • LEVEL regions (`unlock.level`) lift automatically the moment the Keeper
 *     reaches that level — the authored world's per-level zones. On Borealis
 *     the level carries a DOUBLE KEY (`cloudLevelMet`): the ladder reaching
 *     its first cauldron quest lifts them just as the rank would.
 * Either way the tiles go active and the region's hidden contents appear.
 */
export class UnlockSystem {
  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    private chains: ChainsData
  ) {
    bus.on('fog:tapped', ({ regionId }) => this.tryKeyUnlock(regionId));
    bus.on('keeper:leveled', () => this.sweepLevelRegions());
    // The latch is the clouds' second key — when it flips mid-session the
    // slabs must lift NOW, not on the next rank.
    bus.on('quest:cauldron_reached', () => this.sweepLevelRegions());
    bus.on('region:reveal', ({ regionId }) => {
      const region = this.map.regions.find((r) => r.id === regionId);
      if (!region) return;
      this.reveal(region);
      this.sweepLevelRegions(); // anything that was waiting behind it
    });
  }

  /** The ACTIVE world's map. Regions belong to the world the board is
   *  showing — an unlock on Borealis must find Borealis's regions. */
  private get map(): MapData {
    return this.state.map;
  }

  private tryKeyUnlock(regionId: string): void {
    const region = this.map.regions.find((r) => r.id === regionId);
    if (!region || this.state.regionStatus.get(regionId) !== 'unlockable' || !region.unlock) {
      this.bus.emit('region:unlock_failed', { regionId, reason: 'not_unlockable' });
      return;
    }
    // A level-gated zone can't be bought with keys — it wakes on its own.
    if (region.unlock.keys === undefined) {
      this.bus.emit('region:unlock_failed', { regionId, reason: 'level' });
      return;
    }
    if (region.unlock.level !== undefined && this.state.level < region.unlock.level) {
      this.bus.emit('region:unlock_failed', { regionId, reason: 'level' });
      return;
    }
    if (this.state.keys < region.unlock.keys) {
      this.bus.emit('region:unlock_failed', { regionId, reason: 'keys' });
      return;
    }
    this.bus.emit('economy:spend_keys', { keys: region.unlock.keys, reason: `unlock:${regionId}` });
    this.reveal(region);
    // A door can be the last thing a rank-gated wave was waiting for: the
    // mainland's inner bands name this region in `unlock.after`, and a Keeper
    // who banked the rank before the key would otherwise hold both halves of
    // the condition and see nothing move. Sweep again now that it is open.
    this.sweepLevelRegions();
  }

  /**
   * On reaching a level, lift every still-fogged zone gated at or below it.
   *
   * Runs to a FIXED POINT, because a band may be waiting on another band rather
   * than on the Keeper (`unlock.after` — see MapRegionConfig). One pass would
   * lift the door and leave the wave behind it fogged until the next level-up,
   * which for the last rank on the curve means for ever. Looping until a pass
   * changes nothing costs one extra sweep of a handful of regions and removes
   * the ordering question entirely.
   */
  private sweepLevelRegions(): void {
    for (let pass = 0; pass < this.map.regions.length + 1; pass++) {
      const opened = this.map.regions.filter((region) => {
        if (region.unlock?.level === undefined) return false;
        if (region.unlock.keys !== undefined) return false; // keys unlock via fog:tapped
        // Rank — or, on the worlds the cauldron latch keys, the ladder having
        // reached its first brew quest.
        if (!cloudLevelMet(this.state, this.state.worldId, region.unlock.level)) return false;
        if (this.state.regionStatus.get(region.id) !== 'unlockable') return false;
        return this.preconditionMet(region);
      });
      if (!opened.length) return;
      for (const region of opened) this.reveal(region);
    }
  }

  /** Has the region this one waits behind already opened? */
  private preconditionMet(region: MapRegionConfig): boolean {
    const after = region.unlock?.after;
    return after === undefined || this.state.regionStatus.get(after) === 'active';
  }

  private reveal(region: MapRegionConfig): void {
    this.state.regionStatus.set(region.id, 'active');

    const now = this.clock.now();
    const revealed: ItemSnapshot[] = [];
    for (const placement of region.contents ?? []) {
      const config = this.chains.chains.find((c) => c.id === placement.chain);
      // Withheld either because it is a later chapter's chain or because it
      // belongs to another world — a region in the north may seed frozen goods,
      // and the same region data must not seed them here. A KEEPSAKE is the
      // author saying this particular piece is not that accident.
      if (
        chainHiddenIn(config ?? { id: placement.chain }, this.state.worldId, placement.keepsake === true)
      ) {
        continue;
      }
      const generator = config?.tiers.find((t) => t.tier === placement.tier)?.generator;
      const item = this.state.addItem({
        chain: placement.chain,
        tier: placement.tier,
        col: placement.at[0],
        row: placement.at[1],
        kind: 'item',
        ...(generator ? { readyAt: now } : {})
      });
      revealed.push(this.state.snapshot(item, now));
    }
    for (const decor of region.decor ?? []) {
      const item = this.state.addItem({
        chain: decor.decor,
        tier: 1,
        col: decor.at[0],
        row: decor.at[1],
        kind: 'decor'
      });
      revealed.push(this.state.snapshot(item));
    }

    const tiles: TilePos[] = region.tiles.map(([col, row]) => ({ col, row }));
    this.bus.emit('region:unlocked', { regionId: region.id, tiles, revealed });
  }
}
