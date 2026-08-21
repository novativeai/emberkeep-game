import { REWARD_SPAWN_RADIUS } from '../core/Constants';
import type { EventBus } from '../core/EventBus';
import type { GameClock } from '../core/GameClock';
import type { GameState } from '../core/GameState';
import { clusterOf, gatherSeat, verdictOnto } from '../core/mergeRule';
import type { BoardItemState, ChainsData, DragonCare, ItemSnapshot, TilePos } from '../core/types';

/**
 * Resolves every 'drag:dropped' intent.
 *
 * THE DROP IS THE VERB. A merge happens when, and only when, a piece is dropped
 * ON a matching piece and the two of them plus the target's cluster reach the
 * recipe (3, or 5 for two; 2 for a tier that says so). Dropped on a match with
 * too few, the piece GATHERS — it is seated on a free cell beside the target,
 * the pair is formed, and the next drop on either of them finishes it. Dropped
 * on free ground, a piece simply moves: three alike standing in a row stay
 * three pieces, leaning toward their centre, until somebody drops one on
 * another. The rule itself lives in core/mergeRule.ts, shared with the hint
 * planner, the tutorial's hand and the scene's reticle, so no reader can
 * promise a merge this system would refuse.
 *
 * What used to be here and is gone on purpose: the free-tile flood (dropping
 * BESIDE two alike fused them) and the two-tile "magnet" that snapped a drop
 * onto the completing cell. Both made adjacency perform the merge; the owner's
 * design — Merge Dragons' and Fairyland's — makes adjacency only prepare it.
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

    // A fixture is part of the map, not of the board. It stands outside the
    // playable set, so only the DESTINATION test ever ran on it — and that test
    // happily accepted any active tile, which is how the Theme Crystal could be
    // dragged off its ledge into the middle of the isle and stay there.
    const sameTile = to.col === from.col && to.row === from.row;
    if (this.state.isFixture(item) || sameTile || !this.state.isTileActive(to.col, to.row)) {
      this.bus.emit('item:move_bounced', { itemId, at: from });
      return;
    }

    const target = this.state.itemAt(to.col, to.row);

    // FREE GROUND: a move, and nothing but a move. No flood, no magnet — the
    // piece lands where the finger let go, whatever stands beside it.
    if (!target || target.id === itemId) {
      this.state.moveItem(itemId, to);
      this.bus.emit('item:moved', { itemId, from, to });
      return;
    }

    const verdict = verdictOnto(this.state, this.chains, item, target);
    switch (verdict.kind) {
      case 'merge':
        this.performMerge(verdict.members, verdict.consume, verdict.outputs, to);
        return;
      case 'gather': {
        // A match, but not enough of them: the piece joins the target's side.
        // `gatherSeat` answers null both when the cluster is boxed in and when
        // the piece already touches the target — in either case there is
        // nowhere better for it than where it came from, so it goes home, and
        // the board is exactly as it was.
        const seat = gatherSeat(this.state, item, target, clusterOf(this.state, target));
        if (!seat) {
          this.bus.emit('item:move_bounced', { itemId, at: from });
          return;
        }
        this.state.moveItem(itemId, seat);
        this.bus.emit('item:moved', { itemId, from, to: seat });
        return;
      }
      case 'none':
        // A different piece, or a chain at the top of its ladder: you cannot
        // stack on an occupied tile.
        this.bus.emit('item:move_bounced', { itemId, at: from });
        return;
    }
  }

  /**
   * Consume the first `consumeCount` of `members` (the dragged piece first,
   * then the target's cluster nearest-first — `verdictOnto` already decided
   * the group reaches the recipe) into `outputCount` pieces of the next tier
   * at `dropPos`.
   */
  private performMerge(
    members: BoardItemState[],
    consumeCount: number,
    outputCount: number,
    dropPos: TilePos
  ): void {
    const seed = members[0]!;
    const config = this.chains.chains.find((c) => c.id === seed.chain)!;
    const nextTier = config.tiers.find((t) => t.tier === seed.tier + 1)!;

    const consumed = members.slice(0, consumeCount);
    const consumedIds = consumed.map((i) => i.id);
    const consumedAt = consumed.map((i) => ({ col: i.col, row: i.row }));

    // Two Red Dragons becoming an Adult is ONE dragon growing up, so the care
    // record survives the merge at the best of what went in. A player who has
    // been feeding a dragon every day must never be punished for merging it —
    // and its trust is a record of what they did, exactly like Regard's.
    const inherited = this.bestCare(consumed);
    // And her NAME. Without this the merge that grows a named dragon would read
    // as the player losing her and being handed a stranger — the one way a board
    // dragon could break the naming law (types.ts, BoardItemState.dragonName).
    const inheritedName = consumed.find((i) => i.dragonName)?.dragonName;

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
        ...(generator ? { readyAt: this.clock.now() } : {}),
        ...(inherited ? { care: { ...inherited } } : {}),
        ...(inheritedName ? { dragonName: inheritedName } : {})
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
  }

  /**
   * The care record the merge's output inherits: the most-trusted of the dragons
   * that went in, and the fullest belly among the records that share its trust.
   * Undefined when nothing consumed was ever fed, so a plain merge writes no
   * field at all and the save stays exactly as small as it was.
   */
  private bestCare(consumed: BoardItemState[]): DragonCare | undefined {
    let best: DragonCare | undefined;
    for (const member of consumed) {
      const care = member.care;
      if (!care) continue;
      if (
        !best ||
        care.trust > best.trust ||
        (care.trust === best.trust && care.day >= best.day && care.meals > best.meals)
      ) {
        best = care;
      }
    }
    return best;
  }
}
