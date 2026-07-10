import { REWARD_SPAWN_RADIUS } from '../core/Constants';
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
   * If the exact drop tile didn't form a group, scan the 8 tiles around it for a
   * FREE active tile that sits beside enough matching pieces to merge; snap the
   * dropped piece there and fuse. This makes dropping a piece NEAR a mergeable
   * pair merge directly, the way a forgiving merge game should feel.
   */
  private trySnapMerge(item: BoardItemState, to: TilePos): boolean {
    const config = this.chainConfig(item.chain);
    if (!config || !config.tiers.some((t) => t.tier === item.tier + 1)) return false; // max tier
    const minGroup = config.merge?.group ?? this.chains.mergeRule.minGroup;
    let best: { col: number; row: number; matches: number } | null = null;
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue; // the drop tile itself was already tried
        const col = to.col + dc;
        const row = to.row + dr;
        if (!this.state.isTileActive(col, row)) continue;
        const occ = this.state.itemIdAt(col, row);
        if (occ && occ !== item.id) continue; // candidate must be free
        let matches = 0;
        for (let ec = -1; ec <= 1; ec++) {
          for (let er = -1; er <= 1; er++) {
            if (ec === 0 && er === 0) continue;
            const n = this.state.itemAt(col + ec, row + er);
            if (n && n.id !== item.id && n.kind === 'item' && n.chain === item.chain && n.tier === item.tier) {
              matches++;
            }
          }
        }
        if (matches >= minGroup - 1 && (!best || matches > best.matches)) {
          best = { col, row, matches };
        }
      }
    }
    if (!best) return false;
    this.state.moveItem(item.id, { col: best.col, row: best.row });
    return this.performMerge(this.collectGroup(item), { col: best.col, row: best.row });
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
      // Bonus outputs land NEAR the merge or not at all (never across the map).
      const extra = this.state
        .freeActiveTilesNear(dropPos.col, dropPos.row, REWARD_SPAWN_RADIUS)
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

    // First time this recipe is performed → a new Emberkeep Cookbook page.
    const recipeKey = `${seed.chain}:${seed.tier}>${nextTier.tier}`;
    if (!this.state.discoveredRecipes.includes(recipeKey)) {
      this.state.discoveredRecipes.push(recipeKey);
      this.bus.emit('cookbook:discovered', {
        chain: seed.chain,
        fromTier: seed.tier,
        resultTier: nextTier.tier
      });
    }

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
