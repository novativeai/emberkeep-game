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
    private chains: ChainsData
  ) {
    bus.on('board:consume_items', ({ itemIds, reason }) => this.consume(itemIds, reason));
    bus.on('board:spawn', (p) => this.spawnReward(p));
    bus.on('board:retier', (p) => this.retier(p));
    bus.on('board:move', (p) => this.moveReward(p));
    bus.on('board:place_decor', ({ decor }) => this.placeDecor(decor));
  }

  /** The ACTIVE world's map — a new board is seeded from the world the
   *  player is standing on, not from the build's authored one. */
  private get map(): MapData {
    return this.state.map;
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
    at,
    overflow
  }: {
    chain: string;
    tier: number;
    count: number;
    nearChain?: string;
    nearTier?: number;
    at?: [number, number];
    overflow?: 'bag';
  }): void {
    /** Whatever would not fit. Dropped by default (a generator pays again);
     *  banked when the caller says the piece is too scarce to lose. */
    const spill = (placed: number): void => {
      const lost = count - placed;
      if (lost > 0 && overflow === 'bag') this.bus.emit('bag:bank', { chain, tier, count: lost });
    };
    // An explicit `at` cell wins: drop the blob there (the nearest free active
    // tile to it), regardless of where other items sit.
    if (at) {
      const cells = this.freeBlobNear(at[0], at[1], count);
      for (const cell of cells) this.spawn(chain, tier, cell.col, cell.row, 'unlock');
      spill(cells.length);
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
    }
    // For a `nearChain` spawn the blob is grown from the ANCHOR'S OWN CELL, not
    // from a free tile picked out in advance. `freeActiveTilesNear` is sorted by
    // distance, so its first candidates are precisely the anchor's free
    // neighbours — which is what makes the spawned pieces land adjacent to the
    // piece the player already has, and the whole group merge in one drag.
    // Picking the start tile up front could not do that: when the anchor had no
    // free neighbour it fell through to "nearest free tile anywhere" and the new
    // pieces formed a tidy blob somewhere else entirely, stranding the original.
    // No else: for non-nearChain spawns with an anchor the start col/row is the
    // anchor's own tile (offset=0) — freeBlobNear resolves adjacency from there.
    const cells = this.freeBlobNear(anchorCol, anchorRow, count);
    for (const cell of cells) this.spawn(chain, tier, cell.col, cell.row, 'unlock');
    spill(cells.length);
  }

  /** How many nearby free tiles are tried as a blob SEED before giving up on a
   *  connected pocket. Generous — the scan is cheap and the alternative is a
   *  scripted merge lesson whose pieces cannot be reached in one drag. */
  private static readonly BLOB_SEED_TRIES = 24;

  /**
   * A CONNECTED blob of `n` free active tiles near (col,row).
   *
   * Spawned items land orthogonally adjacent so a single drag merges them —
   * "nearest N" scatters, and for a scripted merge lesson a scattered piece is
   * a piece the player cannot obviously use.
   *
   * **Why it tries many seeds.** It used to grow from the single nearest free
   * tile. On a congested board that tile is very often a lone pocket wedged
   * between occupied ones: the blob comes back holding one cell, and the top-up
   * below then scattered the rest across the isle — which is exactly how the
   * tutorial's three Emberberries ended up on three separated tiles with the
   * drag hint stretched across the map. A perfectly good pocket of three
   * usually sits a tile or two further out, so the seed is a search, not a
   * guess: take the first pocket that can hold the whole blob, and keep the
   * largest as the fallback.
   */
  private freeBlobNear(col: number, row: number, n: number): { col: number; row: number }[] {
    const candidates = this.orderBySightline(this.state.freeActiveTilesNear(col, row));
    if (candidates.length === 0) return [];

    let best: { col: number; row: number }[] = [];
    for (const seed of candidates.slice(0, BoardSystem.BLOB_SEED_TRIES)) {
      const blob = this.growBlob(seed, n);
      if (blob.length >= n) return blob; // nearest pocket that fits — done
      if (blob.length > best.length) best = blob;
    }

    // The blob is a PREFERENCE, never a cap. No pocket on the board can hold
    // `n` connected pieces, so the rest go wherever there is room rather than
    // being silently dropped — a scripted spawn that loses items is a gate that
    // can never be met (the Ledger beat spawns the shards its own order wants).
    const out = [...best];
    if (out.length < n) {
      const taken = new Set(out.map((c) => `${c.col},${c.row}`));
      for (const cell of candidates) {
        if (out.length >= n) break;
        const k = `${cell.col},${cell.row}`;
        if (taken.has(k) || this.state.itemIdAt(cell.col, cell.row) !== null) continue;
        taken.add(k);
        out.push(cell);
      }
    }
    return out;
  }

  /**
   * Same cells, but the ones the player can actually SEE come first.
   *
   * The board is isometric, so the tile in front of a cell — (col, row+1) and
   * (col+1, row) — is drawn over it. Small merge pieces are no trouble; the
   * furniture is: a House, a tree, a bush, a dragon. A piece spawned behind one
   * of those is hidden by its roof or canopy, and a hidden piece cannot be
   * tapped either, because the tap lands on the art in front.
   *
   * That is not cosmetic. The tutorial's Resin Bead spawned behind the House and
   * the beat that says "tap it into your satchel" became unfinishable: the arrow
   * pointed at what looked like bare ground, and every tap went to the House.
   *
   * A PREFERENCE, not a filter — a congested board must still take the hidden
   * cell over dropping the piece entirely. "Tall" is read as "is a generator",
   * which is what the furniture has in common and the only part of art a
   * Phaser-free system can know.
   */
  private orderBySightline(cells: { col: number; row: number }[]): { col: number; row: number }[] {
    const hidden = (c: { col: number; row: number }): boolean =>
      [
        { col: c.col, row: c.row + 1 },
        { col: c.col + 1, row: c.row }
      ].some((front) => {
        const id = this.state.itemIdAt(front.col, front.row);
        if (id === null) return false;
        const item = this.state.items.get(id);
        return !!item && this.generatorConfig(item.chain, item.tier) !== undefined;
      });
    // Stable: distance order is preserved inside each half.
    return [...cells.filter((c) => !hidden(c)), ...cells.filter(hidden)];
  }

  /** Flood-fill free active tiles outward from `seed`, stopping at `n`. Only
   *  free tiles are traversable: a blob may not grow THROUGH an occupied tile,
   *  or its two halves would not be adjacent once the items land. */
  private growBlob(
    seed: { col: number; row: number },
    n: number
  ): { col: number; row: number }[] {
    if (!this.state.isTileActive(seed.col, seed.row)) return [];
    if (this.state.itemIdAt(seed.col, seed.row) !== null) return [];
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

  /**
   * Put a bought decoration somewhere it will not be in the way.
   *
   * Merge space is the scarcest thing on this board — the tutorial's scripted
   * spawns already run it to the edge — so a decoration takes the free active
   * tile FURTHEST from the board's centre of mass rather than the nearest one.
   * The player gets their prop; the middle stays clear for merging.
   */
  private placeDecor(decor: string): void {
    const free = this.state.freeActiveTilesNear(0, 0);
    if (free.length === 0) {
      this.bus.emit('board:decor_placed', { decor, at: null });
      return;
    }
    const live = [...this.state.items.values()].filter((i) => i.kind === 'item');
    const cx = live.length ? live.reduce((n, i) => n + i.col, 0) / live.length : 0;
    const cy = live.length ? live.reduce((n, i) => n + i.row, 0) / live.length : 0;
    const at = free.reduce((best, p) =>
      Math.hypot(p.col - cx, p.row - cy) > Math.hypot(best.col - cx, best.row - cy) ? p : best
    );
    this.spawnDecor(decor, at.col, at.row, 'unlock');
    this.bus.emit('board:decor_placed', { decor, at });
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
