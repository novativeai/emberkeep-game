import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import type { ChainsData, ItemSnapshot, MapData, MapRegionConfig, TilePos } from '../core/types';

/**
 * Lifting fog. Two gates:
 *   • KEY regions (`unlock.keys`) lift when the player taps them with enough
 *     Gold Keys — the tutorial's north_fog lesson.
 *   • LEVEL regions (`unlock.level`) lift automatically the moment the Keeper
 *     reaches that level — the authored world's per-level zones.
 * Either way the tiles go active and the region's hidden contents appear.
 */
export class UnlockSystem {
  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    private chains: ChainsData,
    private map: MapData
  ) {
    bus.on('fog:tapped', ({ regionId }) => this.tryKeyUnlock(regionId));
    bus.on('keeper:leveled', ({ level }) => this.unlockForLevel(level));
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
    if (this.state.keys < region.unlock.keys) {
      this.bus.emit('region:unlock_failed', { regionId, reason: 'keys' });
      return;
    }
    this.bus.emit('economy:spend_keys', { keys: region.unlock.keys, reason: `unlock:${regionId}` });
    this.reveal(region);
  }

  /** On reaching `level`, lift every still-fogged zone gated at or below it. */
  private unlockForLevel(level: number): void {
    for (const region of this.map.regions) {
      if (
        region.unlock?.level !== undefined &&
        region.unlock.level <= level &&
        this.state.regionStatus.get(region.id) === 'unlockable'
      ) {
        this.reveal(region);
      }
    }
  }

  private reveal(region: MapRegionConfig): void {
    this.state.regionStatus.set(region.id, 'active');

    const now = this.clock.now();
    const revealed: ItemSnapshot[] = [];
    for (const placement of region.contents ?? []) {
      const generator = this.chains.chains
        .find((c) => c.id === placement.chain)
        ?.tiers.find((t) => t.tier === placement.tier)?.generator;
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
