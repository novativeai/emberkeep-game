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
    const targetFree =
      this.state.isTileActive(to.col, to.row) && this.state.itemIdAt(to.col, to.row) === null;

    if (sameTile || !targetFree) {
      this.bus.emit('item:move_bounced', { itemId, at: from });
      return;
    }

    this.state.moveItem(itemId, to);

    const merged = this.tryMergeAt(item);
    if (!merged) {
      this.bus.emit('item:moved', { itemId, from, to });
    }
  }

  /** Flood-fill the same-chain/tier group containing `seed` and merge if big enough. */
  private tryMergeAt(seed: BoardItemState): boolean {
    const config = this.chainConfig(seed.chain);
    if (!config) return false;
    const nextTier = config.tiers.find((t) => t.tier === seed.tier + 1);
    if (!nextTier) return false; // max tier: plain move only

    const group = this.collectGroup(seed);
    const rule = this.chains.mergeRule;
    if (group.length < rule.minGroup) return false;

    const isFive = rule.fiveBonus && group.length >= rule.fiveGroup;
    const consumeCount = isFive ? rule.fiveGroup : rule.minGroup;
    const outputCount = isFive ? rule.fiveOutputs : 1;

    const consumed = group.slice(0, consumeCount);
    const consumedIds = consumed.map((i) => i.id);
    const consumedAt = consumed.map((i) => ({ col: i.col, row: i.row }));
    const dropPos = { col: seed.col, row: seed.row };

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
