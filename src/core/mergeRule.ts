import type { BoardItemState, ChainsData, TilePos } from './types';

/**
 * THE MERGE RULE — one predicate, four readers.
 *
 * A merge happens when, and only when, the player drops a piece ON a matching
 * piece. That is the whole rule, and it is stated once, here, because four
 * things have to agree about it and used to each keep their own copy:
 *
 *   • MergeSystem     decides (drop → merge / gather / bounce)
 *   • mergeHints      predicts (the hand must never ask for a drop the board
 *                     would refuse — that promise is only keepable if the
 *                     planner and the system run the SAME function)
 *   • TutorialDirector aims (the hand points the outlier at the cluster, not
 *                     at whichever piece happened to sort first)
 *   • BoardScene      shows (the reticle knows a drop will fuse before the
 *                     finger lets go; a complete cluster leans toward its
 *                     centre until somebody finishes it)
 *
 * WHAT CHANGED, for the next reader who remembers the old board. Dropping a
 * piece BESIDE two of its kind used to fuse them, and a "magnet" reached two
 * tiles further to find the completing cell. Both are gone: adjacency now only
 * PREPARES a merge, it never performs one. Three alike standing in a row are a
 * complete cluster and stay three pieces — they lean toward their centre, the
 * hint points at them, and the player's one gesture finishes it. This is the
 * Merge-Dragons / Fairyland grammar: the drop is the verb.
 *
 * THE FLOOD IS WALKED ON THE BOARD AS IT STANDS, with the dragged piece still
 * on its source cell. So in a row A·D·B, dropping the MIDDLE piece D on A
 * merges: the three were one connected cluster before the finger lifted D, and
 * the flood from A reaches B through D's cell. Lifting D out of the count
 * first would make the gesture the hint itself suggests (any member onto any
 * other) fail for one of the three pieces, and nothing on screen explains why.
 *
 * Everything here is pure and Phaser-free: `GameState` satisfies `RuleBoard`,
 * and so does the hint planner's adapter and a unit-test stub.
 */

/** What the rule needs to know about a board. `GameState` satisfies it. */
export interface RuleBoard {
  itemAt(col: number, row: number): BoardItemState | undefined;
  /** The four touching cells WITHIN THE SAME ZONE — adjacency never leaves a
   *  slab, or a merge would cross open sky. */
  neighbors(col: number, row: number): TilePos[];
  isTileActive(col: number, row: number): boolean;
}

/** The recipe that applies when pieces of `chain` at `tier` merge: how many
 *  are consumed and how many come out. A per-tier override wins, then the
 *  chain-level one, then the global rule — the same precedence everywhere. */
export interface MergeRecipe {
  /** Pieces consumed per merge (the threshold a cluster has to reach). */
  need: number;
  /** Next-tier pieces produced. */
  outputs: number;
  /** True when the chain can merge at this tier at all (a next tier exists). */
  mergeable: boolean;
  /** With the global five-bonus, a cluster of this many consumes five for two. */
  fiveGroup: number | null;
  fiveOutputs: number;
}

export function recipeFor(chains: ChainsData, chain: string, tier: number): MergeRecipe {
  const config = chains.chains.find((c) => c.id === chain);
  const next = config?.tiers.find((t) => t.tier === tier + 1);
  const override = config?.tiers.find((t) => t.tier === tier)?.merge ?? config?.merge;
  const rule = chains.mergeRule;
  return {
    need: override?.group ?? rule.minGroup,
    outputs: override?.outputs ?? 1,
    mergeable: !!config && !!next,
    // A tier with its own recipe (2 Houses → 1 Manor) is never a five-bonus.
    fiveGroup: !override && rule.fiveBonus ? rule.fiveGroup : null,
    fiveOutputs: rule.fiveOutputs
  };
}

/** Same chain, same tier, a real piece (not decor, not a fixture). */
export function matches(a: BoardItemState, b: BoardItemState): boolean {
  return a.kind === 'item' && b.kind === 'item' && a.chain === b.chain && a.tier === b.tier;
}

/**
 * The orthogonally-connected cluster of matching pieces around `seed`, walked
 * on the board AS IT STANDS. BFS order, seed first, so a caller that consumes
 * "the first n" takes the nearest ones to the seed.
 */
export function clusterOf(board: RuleBoard, seed: BoardItemState): BoardItemState[] {
  const visited = new Set<number>([seed.id]);
  const queue: BoardItemState[] = [seed];
  const group: BoardItemState[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    group.push(current);
    for (const pos of board.neighbors(current.col, current.row)) {
      if (!board.isTileActive(pos.col, pos.row)) continue;
      const nearby = board.itemAt(pos.col, pos.row);
      if (nearby && !visited.has(nearby.id) && matches(seed, nearby)) {
        visited.add(nearby.id);
        queue.push(nearby);
      }
    }
  }
  return group;
}

/**
 * The pieces a drop of `dragged` ON `target` would bring together: the dragged
 * piece first, then the target's cluster nearest-first. Null when the two do
 * not match — that drop is not a merge question at all.
 */
export function groupOnto(
  board: RuleBoard,
  dragged: BoardItemState,
  target: BoardItemState
): BoardItemState[] | null {
  if (dragged.id === target.id || !matches(dragged, target)) return null;
  const cluster = clusterOf(board, target).filter((p) => p.id !== dragged.id);
  return [dragged, ...cluster];
}

/** What a drop of `dragged` ON `target` does. */
export type DropVerdict =
  | { kind: 'merge'; members: BoardItemState[]; consume: number; outputs: number }
  | { kind: 'gather'; members: BoardItemState[] }
  | { kind: 'none' };

/**
 * THE PREDICATE. Merge when the dragged piece plus the target's cluster reach
 * the recipe's threshold; gather (the piece joins the cluster without fusing)
 * when they match but fall short; none when they do not match or the chain
 * cannot merge at this tier.
 *
 * `consume` is how many of `members` (nearest-first) the merge eats: the
 * five-bonus when a cluster of five or more is finished, else the recipe's
 * need. The rest of the cluster stays exactly where it is.
 */
export function verdictOnto(
  board: RuleBoard,
  chains: ChainsData,
  dragged: BoardItemState,
  target: BoardItemState
): DropVerdict {
  const members = groupOnto(board, dragged, target);
  if (!members) return { kind: 'none' };
  const recipe = recipeFor(chains, dragged.chain, dragged.tier);
  if (!recipe.mergeable) return { kind: 'none' };
  if (members.length < recipe.need) return { kind: 'gather', members };
  const five = recipe.fiveGroup !== null && members.length >= recipe.fiveGroup;
  return {
    kind: 'merge',
    members,
    consume: five ? recipe.fiveGroup! : recipe.need,
    outputs: five ? recipe.fiveOutputs : recipe.outputs
  };
}

/**
 * WHERE A GATHERED PIECE SITS.
 *
 * Ring one: a free active cell touching the TARGET, nearest to where the piece
 * came from, so it takes the short way round and the player sees it arrive
 * from the side they dropped it on. Ring two: a free cell touching any other
 * member of the target's cluster — still joined to the group, which is the
 * only thing that matters for the next drop. (With every shipped recipe at 2
 * or 3, a gather only ever happens onto a LONE piece — a target with a mate
 * already merges — so ring two is reached only by a recipe that needs four or
 * more. It is here so the rule stays true when one arrives.) Null when the
 * cluster is boxed in: the caller bounces, and the board is left exactly as
 * it was.
 *
 * A piece ALREADY touching the target also gets null — there is no seat to
 * move it to that it does not already hold. The caller treats that as "put it
 * back": dropping a piece on the neighbour it was standing beside is not a
 * request to shuffle it round to the far side.
 *
 * Never `freeActiveTilesNear`: that reaches past the cluster, and across a
 * zoned world it would happily seat the piece on the next island over — a
 * gather that lands the piece out of the group is worse than a bounce.
 */
export function gatherSeat(
  board: RuleBoard,
  dragged: BoardItemState,
  target: BoardItemState,
  cluster: BoardItemState[] = clusterOf(board, target)
): TilePos | null {
  const touching = board
    .neighbors(target.col, target.row)
    .some((p) => p.col === dragged.col && p.row === dragged.row);
  if (touching) return null;

  const free = (p: TilePos): boolean => {
    if (!board.isTileActive(p.col, p.row)) return false;
    const occupant = board.itemAt(p.col, p.row);
    return !occupant || occupant.id === dragged.id;
  };
  const closer = (a: TilePos, b: TilePos): number =>
    Math.abs(a.col - dragged.col) + Math.abs(a.row - dragged.row) -
    (Math.abs(b.col - dragged.col) + Math.abs(b.row - dragged.row));

  const ring1 = board.neighbors(target.col, target.row).filter(free).sort(closer);
  if (ring1[0]) return ring1[0];

  const seen = new Set<string>();
  const ring2: TilePos[] = [];
  for (const member of cluster) {
    if (member.id === target.id) continue;
    for (const p of board.neighbors(member.col, member.row)) {
      const key = `${p.col},${p.row}`;
      if (seen.has(key) || !free(p)) continue;
      seen.add(key);
      ring2.push(p);
    }
  }
  ring2.sort(closer);
  return ring2[0] ?? null;
}

/** A cluster that already holds enough to merge and is waiting for the gesture. */
export interface ReadyCluster {
  chain: string;
  tier: number;
  /** Every member, BFS order from the centre. */
  members: BoardItemState[];
  /** The piece to drop the others ON: the best-connected member, so that any
   *  other member dropped on it fuses. Ties go to the lowest id, which is the
   *  oldest piece — stable across frames, so the lean never flickers. */
  centre: BoardItemState;
}

/**
 * EVERY CLUSTER THAT IS COMPLETE BUT UNMERGED — three alike in a row, a pair
 * of Houses side by side. These are what the old rule fused on its own; under
 * this one they are the board saying "here, finish me". The scene leans their
 * members toward the centre, and the hint's shortest plan is one drop onto it.
 *
 * Deterministic in every respect — iteration in id order, ties by id — so the
 * scene can diff consecutive results by key and touch nothing that did not
 * change.
 */
export function readyClusters(
  board: RuleBoard,
  chains: ChainsData,
  items: Iterable<BoardItemState>
): ReadyCluster[] {
  const pieces = [...items].filter((i) => i.kind === 'item').sort((a, b) => a.id - b.id);
  const claimed = new Set<number>();
  const out: ReadyCluster[] = [];
  for (const piece of pieces) {
    if (claimed.has(piece.id)) continue;
    const cluster = clusterOf(board, piece);
    for (const member of cluster) claimed.add(member.id);
    const recipe = recipeFor(chains, piece.chain, piece.tier);
    if (!recipe.mergeable || cluster.length < recipe.need) continue;
    const inCluster = new Set(cluster.map((m) => m.id));
    const degree = (m: BoardItemState): number =>
      board.neighbors(m.col, m.row).filter((p) => {
        const n = board.itemAt(p.col, p.row);
        return !!n && inCluster.has(n.id);
      }).length;
    let centre = cluster[0]!;
    let best = degree(centre);
    for (const m of cluster) {
      const d = degree(m);
      if (d > best || (d === best && m.id < centre.id)) {
        centre = m;
        best = d;
      }
    }
    out.push({ chain: piece.chain, tier: piece.tier, members: clusterOf(board, centre), centre });
  }
  return out;
}
