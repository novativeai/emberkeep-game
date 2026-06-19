import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import type { ChainsData, GeneratorConfig, MapData, SpawnCause } from '../core/types';

/**
 * Owns board lifecycle: initial population and removal commands.
 * Item movement/merging is resolved by MergeSystem; generators by
 * GeneratorSystem. All of them mutate the board through GameState
 * primitives and announce changes on the bus.
 */
export class BoardSystem {
  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    private chains: ChainsData,
    private map: MapData
  ) {
    bus.on('board:consume_items', ({ itemIds, reason }) => this.consume(itemIds, reason));
    bus.on('board:spawn', (p) => this.spawnReward(p));
    bus.on('board:retier', (p) => this.retier(p));
  }

  /** Scripted reward spawn (tutorial): drop `count` items into free tiles near
   *  an existing item of `nearChain` (else near any item, else the origin). */
  private spawnReward({
    chain,
    tier,
    count,
    nearChain
  }: {
    chain: string;
    tier: number;
    count: number;
    nearChain?: string;
  }): void {
    const items = [...this.state.items.values()].filter((i) => i.kind === 'item');
    const anchor = (nearChain && items.find((i) => i.chain === nearChain)) || items[0] || null;
    // Spawn IN FRONT of the anchor (+1,+1 = south, toward the viewer) so produce
    // isn't hidden behind a tall generator — e.g. the dragon occluding its gems.
    const offset = nearChain && anchor ? 1 : 0;
    let anchorCol = (anchor?.col ?? 0) + offset;
    let anchorRow = (anchor?.row ?? 0) + offset;
    // When the board is empty the default [0,0] may resolve to an isolated active
    // tile with no active neighbours (unable to grow a connected blob). Prefer the
    // nearest active tile that has at least one active free neighbour instead.
    if (!anchor) {
      const connected = this.state.freeActiveTilesNear(0, 0)
        .find((p) => this.state.freeActiveNeighbors(p.col, p.row).length > 0);
      if (connected) { anchorCol = connected.col; anchorRow = connected.row; }
    }
    const cells = this.freeBlobNear(anchorCol, anchorRow, count);
    for (const cell of cells) this.spawn(chain, tier, cell.col, cell.row, 'unlock');
  }

  /** A CONNECTED blob of free active tiles grown from the nearest free tile to
   *  (col,row). Spawned items land orthogonally adjacent, so a single drag can
   *  merge them (drop-onto needs neighbours) — unlike "nearest N" which scatters. */
  private freeBlobNear(col: number, row: number, n: number): { col: number; row: number }[] {
    const seed = this.state.freeActiveTilesNear(col, row)[0];
    if (!seed) return [];
    const seen = new Set([`${seed.col},${seed.row}`]);
    const out: { col: number; row: number }[] = [];
    const queue = [seed];
    while (queue.length > 0 && out.length < n) {
      const cur = queue.shift()!;
      if (!this.state.isTileActive(cur.col, cur.row)) continue;
      if (this.state.itemIdAt(cur.col, cur.row) !== null) continue;
      out.push(cur);
      for (const nb of this.state.neighbors(cur.col, cur.row)) {
        const k = `${nb.col},${nb.row}`;
        if (!seen.has(k)) {
          seen.add(k);
          queue.push(nb);
        }
      }
    }
    return out;
  }

  /** Scripted in-place upgrade (tutorial): one `chain`+`fromTier` item becomes
   *  `toTier` on its tile (e.g. the strawberry bush ripening into a generator). */
  private retier({
    chain,
    fromTier,
    toTier
  }: {
    chain: string;
    fromTier: number;
    toTier: number;
  }): void {
    const target = [...this.state.items.values()].find(
      (i) => i.kind === 'item' && i.chain === chain && i.tier === fromTier
    );
    if (!target) return;
    const at = { col: target.col, row: target.row };
    this.state.removeItem(target.id);
    this.bus.emit('item:removed', { itemId: target.id, at, reason: 'delivered' });
    this.spawn(chain, toTier, at.col, at.row, 'unlock');
  }

  generatorConfig(chain: string, tier: number): GeneratorConfig | undefined {
    return this.chains.chains
      .find((c) => c.id === chain)
      ?.tiers.find((t) => t.tier === tier)?.generator;
  }

  /** Populate a brand-new board from map.json. */
  newGame(): void {
    this.state.reset(this.clock.now());
    for (const placement of this.map.startingItems) {
      this.spawn(placement.chain, placement.tier, placement.at[0], placement.at[1], 'init');
    }
    for (const decor of this.map.startingDecor ?? []) {
      this.spawnDecor(decor.decor, decor.at[0], decor.at[1], 'init');
    }
    this.bus.emit('energy:changed', { current: this.state.energyCurrent, max: this.state.energyMax });
    this.bus.emit('economy:changed', {
      coins: this.state.coins,
      keys: this.state.keys,
      xp: this.state.xp,
      level: this.state.level
    });
  }

  spawn(chain: string, tier: number, col: number, row: number, cause: SpawnCause): void {
    const generator = this.generatorConfig(chain, tier);
    const item = this.state.addItem({
      chain,
      tier,
      col,
      row,
      kind: 'item',
      ...(generator ? { readyAt: this.clock.now() } : {})
    });
    this.bus.emit('item:spawned', { item: this.state.snapshot(item, this.clock.now()), cause });
  }

  spawnDecor(decor: string, col: number, row: number, cause: SpawnCause): void {
    const item = this.state.addItem({ chain: decor, tier: 1, col, row, kind: 'decor' });
    this.bus.emit('item:spawned', { item: this.state.snapshot(item), cause });
  }

  consume(itemIds: number[], reason: string): void {
    for (const id of itemIds) {
      const item = this.state.items.get(id);
      if (!item) continue;
      const at = { col: item.col, row: item.row };
      this.state.removeItem(id);
      this.bus.emit('item:removed', {
        itemId: id,
        at,
        reason: reason === 'sold' ? 'sold' : 'delivered'
      });
    }
  }

}
