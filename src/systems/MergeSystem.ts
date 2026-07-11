import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import type {
  BoardItemState,
  ChainConfig,
  ChainsData,
  ItemSnapshot,
  TilePos
} from '../core/types';

/**
 * Resolves every 'drag:dropped' intent: validates the move, applies it, and
 * detects merges by flood-filling the orthogonally-connected group of items
 * sharing chain+tier at the drop position. A group of `minGroup`+ merges into
 * one item of the next tier; with the `fiveBonus` flag, a group of
 * `fiveGroup`+ consumes five and yields two next-tier items.
 */
export class MergeSystem {
  constructor(
    private state: GameState,
    private bus: EventBus,
    private clock: GameClock,
    private chains: ChainsData
  ) {
    bus.on('drag:dropped', (payload) => this.onDropped(payload));
  }

  private chainConfig(chainId: string): ChainConfig | undefined {
    return this.chains.chains.find((c) => c.id === chainId);
  }

  private onDropped({ itemId, from, to }: { itemId: number; from: TilePos; to: TilePos }): void {
    const item = this.state.items.get(itemId);
    // Validate the dragged item really occupies its claimed source tile.
    if (
      !item ||
      item.kind !== 'item' ||
      item.col !== from.col ||
      item.row !== from.row ||
      this.state.itemIdAt(from.col, from.row) !== itemId
    ) {
      this.bus.emit('item:move_bounced', { itemId, at: from });
      return;
    }

    const sameTile = to.col === from.col && to.row === from.row;
    if (sameTile || !this.state.isTileActive(to.col, to.row)) {
      this.bus.emit('item:move_bounced', { itemId, at: from });
      return;
    }

    const targetItem = this.state.itemAt(to.col, to.row);

    // Fairyland-style: dropping the piece directly ON a matching item makes it
    // join that cluster — merge if together they reach the threshold, else
    // bounce home (you can't stack on an occupied tile otherwise).
    if (targetItem && targetItem.id !== itemId) {
      const matches =
        targetItem.kind === 'item' &&
        targetItem.chain === item.chain &&
        targetItem.tier === item.tier;
      if (matches && this.tryMergeOnto(item, targetItem, to)) return;
      this.bus.emit('item:move_bounced', { itemId, at: from });
      return;
    }

    // Dropping on a FREE tile: move there, then merge the connected group.
    this.state.moveItem(itemId, to);
    if (this.tryMergeAt(item)) return;
    // Smart "near enough" merge: dropping NEXT TO a mergeable cluster (not dead
    // on it) snaps the piece onto the completing tile and fuses.
    if (this.trySnapMerge(item, to)) return;
    this.bus.emit('item:moved', { itemId, from, to });
  }

  /**
   * Forgiving "magnet" merge: if the exact drop tile didn't fuse, scan the ring
   * around it for the FREE active tile where placing this piece would complete an
   * orthogonally-connected group of `minGroup`+ (the SAME connectivity the actual
   * merge uses — so a candidate we snap to is guaranteed to fuse, never stranded).
   * Prefer the biggest group, tie-broken by nearest to the drop. This makes
   * dropping a piece NEAR a mergeable cluster glide it on and fuse, so you never
   * have to land dead-centre on the stack.
   */
  private trySnapMerge(item: BoardItemState, to: TilePos): boolean {
    const config = this.chainConfig(item.chain);
    if (!config || !config.tiers.some((t) => t.tier === item.tier + 1)) return false; // max tier
    const minGroup = config.merge?.group ?? this.chains.mergeRule.minGroup;
    let best: { col: number; row: number } | null = null;
    let bestScore = -1;
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue; // the drop tile itself was already tried
        const col = to.col + dc;
        const row = to.row + dr;
        if (!this.state.isTileActive(col, row)) continue;
        const occ = this.state.itemIdAt(col, row);
        if (occ !== null && occ !== item.id) continue; // candidate must be free
        const size = this.connectedMatchCount(item, { col, row });
        if (size < minGroup) continue;
        const score = size * 100 - (Math.abs(dc) + Math.abs(dr)); // biggest, then nearest
        if (score > bestScore) {
          bestScore = score;
          best = { col, row };
        }
      }
    }
    if (!best) return false;
    this.state.moveItem(item.id, best);
    return this.performMerge(this.collectGroup(item), best);
  }

  /**
   * Size of the orthogonally-connected same-chain/tier group that WOULD form if
   * `item` were placed at `at` (counting `at` itself; the piece's own current
   * tile is excluded so it isn't double-counted). Mirrors collectGroup's walk.
   */
  private connectedMatchCount(item: BoardItemState, at: TilePos): number {
    const key = (c: number, r: number): string => `${c},${r}`;
    const visited = new Set<string>([key(at.col, at.row)]);
    const queue: TilePos[] = [at];
    let count = 1; // the piece we'd place at `at`
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const p of this.state.neighbors(cur.col, cur.row)) {
        const k = key(p.col, p.row);
        if (visited.has(k)) continue;
        const n = this.state.itemAt(p.col, p.row);
        if (n && n.id !== item.id && n.kind === 'item' && n.chain === item.chain && n.tier === item.tier) {
          visited.add(k);
          count++;
          queue.push({ col: p.col, row: p.row });
        }
      }
    }
    return count;
  }

  /** Merge the flood-filled group around `seed`, output at the seed's tile. */
  private tryMergeAt(seed: BoardItemState): boolean {
    return this.performMerge(this.collectGroup(seed), { col: seed.col, row: seed.row });
  }

  /**
   * Drop-onto-merge: the dragged piece (still at its source tile) plus the
   * cluster it was dropped on. Output lands on the drop tile `to`.
   */
  private tryMergeOnto(dragged: BoardItemState, targetItem: BoardItemState, to: TilePos): boolean {
    const cluster = this.collectGroup(targetItem).filter((i) => i.id !== dragged.id);
    return this.performMerge([dragged, ...cluster], to);
  }

  /**
   * Consume the first `minGroup`/`fiveGroup` of `members` (seed/dragged first)
   * into the next tier at `dropPos`. Returns false if the group is too small or
   * the chain is at max tier (caller then treats it as a plain move/bounce).
   */
  private performMerge(members: BoardItemState[], dropPos: TilePos): boolean {
    const seed = members[0];
    if (!seed) return false;
    const config = this.chainConfig(seed.chain);
    if (!config) return false;
    const nextTier = config.tiers.find((t) => t.tier === seed.tier + 1);
    if (!nextTier) return false; // max tier: no merge

    const rule = this.chains.mergeRule;
    // A chain may override the recipe (e.g. lumber: 5 wood → 1 house); otherwise
    // the global rule applies, with its 5-for-2 bonus.
    const override = config.merge;
    const minGroup = override?.group ?? rule.minGroup;
    if (members.length < minGroup) return false;

    const isFive = !override && rule.fiveBonus && members.length >= rule.fiveGroup;
    const consumeCount = override ? override.group : isFive ? rule.fiveGroup : rule.minGroup;
    const outputCount = override ? override.outputs : isFive ? rule.fiveOutputs : 1;

    const consumed = members.slice(0, consumeCount);
    const consumedIds = consumed.map((i) => i.id);
    const consumedAt = consumed.map((i) => ({ col: i.col, row: i.row }));

    for (const member of consumed) {
      this.state.removeItem(member.id);
    }

    const generator = nextTier.generator;
    const outputs: ItemSnapshot[] = [];
    const spawnTiles: TilePos[] = [dropPos];
    if (outputCount > 1) {
      const extra = this.state
        .freeActiveTilesNear(dropPos.col, dropPos.row)
        .filter((p) => !(p.col === dropPos.col && p.row === dropPos.row))
        .slice(0, outputCount - 1);
      spawnTiles.push(...extra);
    }

    for (const tile of spawnTiles) {
      const created = this.state.addItem({
        chain: seed.chain,
        tier: nextTier.tier,
        col: tile.col,
        row: tile.row,
        kind: 'item',
        ...(generator ? { readyAt: this.clock.now() } : {})
      });
      outputs.push(this.state.snapshot(created, this.clock.now()));
    }

    this.bus.emit('economy:add', { xp: nextTier.xp * outputs.length, reason: 'merge' });
    this.bus.emit('item:merged', {
      chain: seed.chain,
      fromTier: seed.tier,
      resultTier: nextTier.tier,
      at: dropPos,
      consumedIds,
      consumedAt,
      outputs,
      xp: nextTier.xp * outputs.length
    });

    if (config.hatchAtTier === nextTier.tier) {
      for (const output of outputs) {
        this.bus.emit('item:hatched', { item: output });
      }
    }
    return true;
  }

  /** BFS from the seed so consumed members are nearest-first (seed included first). */
  private collectGroup(seed: BoardItemState): BoardItemState[] {
    const visited = new Set<number>([seed.id]);
    const queue: BoardItemState[] = [seed];
    const group: BoardItemState[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      group.push(current);
      for (const pos of this.state.neighbors(current.col, current.row)) {
        if (!this.state.isTileActive(pos.col, pos.row)) continue;
        const nearby = this.state.itemAt(pos.col, pos.row);
        if (
          nearby &&
          !visited.has(nearby.id) &&
          nearby.kind === 'item' &&
          nearby.chain === seed.chain &&
          nearby.tier === seed.tier
        ) {
          visited.add(nearby.id);
          queue.push(nearby);
        }
      }
    }
    return group;
  }
}
