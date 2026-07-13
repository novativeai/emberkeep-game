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
    bus.on('board:move', (p) => this.moveReward(p));
  }

  /** Scripted relocation (tutorial): slide one item of `chain`+`tier` to `to`
   *  (or the nearest free active tile to it). The scene re-anchors the sprite. */
  private moveReward({ chain, tier, to }: { chain: string; tier: number; to: [number, number] }): void {
    const item = [...this.state.items.values()].find(
      (i) => i.kind === 'item' && i.chain === chain && i.tier === tier
    );
    if (!item) return;
    let [col, row] = to;
    if (!this.state.isTileActive(col, row) || this.state.itemIdAt(col, row) !== null) {
      const free = this.state.freeActiveTilesNear(col, row)[0];
      if (!free) return;
      ({ col, row } = free);
    }
    if (item.col === col && item.row === row) return;
    const from = { col: item.col, row: item.row };
    this.state.moveItem(item.id, { col, row });
    this.bus.emit('item:moved', { itemId: item.id, from, to: { col, row } });
  }

  /** Scripted reward spawn (tutorial): drop `count` items into free tiles near
   *  an existing item of `nearChain` (else near any item, else the origin). */
  private spawnReward({
    chain,
    tier,
    count,
    nearChain,
    nearTier,
    at
  }: {
    chain: string;
    tier: number;
    count: number;
    nearChain?: string;
    nearTier?: number;
    at?: [number, number];
  }): void {
    // An explicit `at` cell wins: drop the blob there (the nearest free active
    // tile to it), regardless of where other items sit.
    if (at) {
      const cells = this.freeBlobNear(at[0], at[1], count);
      for (const cell of cells) this.spawn(chain, tier, cell.col, cell.row, 'unlock');
      return;
    }
    const items = [...this.state.items.values()].filter((i) => i.kind === 'item');
    // `nearTier` narrows the anchor to a specific tier — e.g. the tutorial's
    // freshly HARVESTED sprout rather than the patch that produced it, so the
    // spawned blob grows connected to it and one drag can merge all three.
    const anchor =
      (nearChain &&
        items.find((i) => i.chain === nearChain && (nearTier === undefined || i.tier === nearTier))) ||
      items[0] ||
      null;
    let anchorCol = anchor?.col ?? 0;
    let anchorRow = anchor?.row ?? 0;
    if (!anchor) {
      // When the board is empty the default [0,0] may resolve to an isolated active
      // tile with no active neighbours (unable to grow a connected blob). Prefer the
      // nearest active tile that has at least one active free neighbour instead.
      const connected = this.state.freeActiveTilesNear(0, 0)
        .find((p) => this.state.freeActiveNeighbors(p.col, p.row).length > 0);
      if (connected) { anchorCol = connected.col; anchorRow = connected.row; }
    } else if (nearChain) {
      // Use the nearest free active neighbour of the anchor so items always land
      // adjacent to it on a valid tile. A fixed +1,+1 offset can leave the active
      // zone and cause freeBlobNear to scatter items to a distant cluster.
      const near = this.state.freeActiveNeighbors(anchor.col, anchor.row)[0]
        ?? this.state.freeActiveTilesNear(anchor.col, anchor.row)[0];
      if (near) { anchorCol = near.col; anchorRow = near.row; }
    }
    // No else: for non-nearChain spawns with an anchor the start col/row is the
    // anchor's own tile (offset=0) — freeBlobNear resolves adjacency from there.
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
    // 'init' items (startingItems) are permanent fixtures — no cooldown ever at
    // placement; the cooldown only arms after the first real tap.
    const item = this.state.addItem({
      chain,
      tier,
      col,
      row,
      kind: 'item',
      ...(generator && cause !== 'init' ? { readyAt: this.clock.now() } : {})
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
