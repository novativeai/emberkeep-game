import { describe, expect, it } from 'vitest';
import { buildWorlds, hasCell, neighborsOf, worldPointOf, zoneAt } from '../../src/core/world';
import { mergeHints, nextMergePlan, planFor, type HintBoard, type MergePlan } from '../../src/core/mergeHints';
import { verdictOnto, type DropVerdict, type RuleBoard } from '../../src/core/mergeRule';
import mapJson from '../../src/data/map.json';
import chainsJson from '../../src/data/chains.json';
import type { BoardItemState, ChainsData, MapData, TilePos } from '../../src/core/types';

/**
 * THE HINT, ON THE GROUND THE GAME ACTUALLY SHIPS.
 *
 * The fixture tests prove the rule; this proves the rule survives contact with
 * the exported worlds — which is where it failed. The planner bucketed pieces
 * BY ZONE, copying the merge rule onto the gather, and that is invisible on
 * Emberkeep (one dense slab holds the whole playable isle) and fatal on
 * Borealis (38 slabs, at most 9 cells each): three of a kind almost never
 * shared a bucket, so the hand simply never came up. "It works on nb2 but not
 * the other maps" was that, exactly.
 *
 * Two properties, and the second is the one that must never be traded for the
 * first: a scattered set gets a PLAN, and every plan really fuses. "Fuses"
 * means what MergeSystem means: a merge happens when, and only when, a piece
 * is dropped ON a matching piece and the target's cluster reaches the recipe
 * (mergeRule.ts `verdictOnto`). So the proof here is not "the seats end up
 * connected" — that is the deleted free-flood rule restated — it is: carry out
 * the plan's gathers on an overlay, then ask THE SAME PREDICATE the board runs
 * what the final drop does, and it must answer `merge`.
 *
 * A third joined them once the offer stopped being "the oldest plannable one":
 * on a board holding several mergeable sets, the one the hand asks for must be
 * the CHEAPEST — fewest drags, then shortest haul, then oldest. That rule is
 * only interesting where there is a choice, so it gets its own boards, and it
 * is asserted against the full field rather than against a hand-picked answer:
 * whatever the planner returns must be the minimum of the triple over every
 * hint the board could have offered.
 *
 * THE FOURTH IS THE GAP BRIDGE, and its meaning INVERTED when the rule did.
 * A set whose pieces are pairwise NOT touching, one free hub joining them,
 * used to be one drag (drop into the hub, the flood fused it) and the old
 * drag floor famously over-stated it and pruned it away. Under the drop-on
 * rule the hub drop is a plain MOVE, so the bridge honestly costs TWO drags —
 * build the bridge, then drop ON it — and the decoy that used to lose, the
 * touching pair with the longer haul, is now the required winner. The boards
 * are generated the same way; the assertion points the other way, and a
 * planner still pricing the bridge at one drag fails it on every world.
 */

const worlds = buildWorlds(mapJson as unknown as MapData);
const CHAINS = chainsJson as unknown as ChainsData;

type World = ReturnType<typeof buildWorlds> extends Map<string, infer W> ? W : never;

/** Every playable cell of a world, in a stable order. */
function groundOf(world: World) {
  const cells: { col: number; row: number }[] = [];
  for (const z of world.zones) {
    for (const local of z.cells) {
      const [i = 0, j = 0] = local.split(',').map(Number);
      const col = z.block.col + i;
      const row = z.block.row + j;
      if (hasCell(world, col, row)) cells.push({ col, row });
    }
  }
  return cells;
}

function boardFor(world: World, items: BoardItemState[]): HintBoard {
  return {
    isActive: (c, r) => hasCell(world, c, r),
    itemIdAt: (c, r) => items.find((i) => i.col === c && i.row === r)?.id ?? null,
    neighbors: (c, r) => neighborsOf(world, c, r),
    zoneOf: (c, r) => zoneAt(world, c, r)?.id,
    distance: (a, b) => {
      const pa = worldPointOf(world, a.col, a.row);
      const pb = worldPointOf(world, b.col, b.row);
      return (pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2;
    }
  };
}

/** Does the WORLD'S OWN graph put these two cells next to each other? Never
 *  index arithmetic: on the exported worlds a cell's neighbours are whatever
 *  the zone graph says, and two cells one column apart may be on two islands. */
function touching(world: World, a: TilePos, b: TilePos): boolean {
  return neighborsOf(world, a.col, a.row).some((n) => n.col === b.col && n.row === b.row);
}

/** Are these cells one orthogonally-connected group, by the world's own graph? */
function oneFlood(world: World, spots: { col: number; row: number }[]): boolean {
  const want = new Set(spots.map((s) => `${s.col},${s.row}`));
  if (want.size !== spots.length) return false; // two pieces on one cell
  const seen = new Set([`${spots[0]!.col},${spots[0]!.row}`]);
  const queue = [spots[0]!];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of neighborsOf(world, cur.col, cur.row)) {
      const k = `${n.col},${n.row}`;
      if (want.has(k) && !seen.has(k)) {
        seen.add(k);
        queue.push(n);
      }
    }
  }
  return seen.size === want.size;
}

/** The RULE's view of a world board with some of a plan's drags already made —
 *  how this spec asks the predicate MergeSystem runs, rather than its own
 *  arithmetic, whether a promised drop would fuse. */
function ruleView(world: World, items: BoardItemState[], moved: Map<number, TilePos>): RuleBoard {
  return {
    itemAt: (c, r) => {
      for (const p of items) {
        const at = moved.get(p.id) ?? p;
        if (at.col === c && at.row === r) return { ...p, col: at.col, row: at.row };
      }
      return undefined;
    },
    neighbors: (c, r) => neighborsOf(world, c, r),
    isTileActive: (c, r) => hasCell(world, c, r)
  };
}

/** Carry out every gather of `plan` on an overlay and ask `verdictOnto` what
 *  the final drop would do. `merge` is the only acceptable answer. */
function finalVerdict(world: World, items: BoardItemState[], plan: MergePlan): DropVerdict {
  const moved = new Map<number, TilePos>();
  for (const step of plan.steps.slice(0, -1)) moved.set(step.itemId, step.to);
  const view = ruleView(world, items, moved);
  const last = plan.steps.at(-1)!;
  const raw = items.find((i) => i.id === last.itemId);
  if (!raw) return { kind: 'none' };
  const at = moved.get(raw.id) ?? raw;
  const dragged = { ...raw, col: at.col, row: at.row };
  const target = view.itemAt(last.to.col, last.to.row);
  if (!target || target.id === dragged.id) return { kind: 'none' };
  return verdictOnto(view, CHAINS, dragged, target);
}

/** Every plan the board could have produced, ranked by hand on the file's own
 *  stated triple. The offer has to be the head of this list — asserted against
 *  the whole field rather than a hand-picked answer, because a hand-picked
 *  answer only ever tests the case whoever wrote it thought of. */
function fieldOf(items: BoardItemState[], board: HintBoard): MergePlan[] {
  return mergeHints(items, CHAINS, board)
    .map((h) => planFor(h, items, board, CHAINS))
    .filter((p): p is MergePlan => !!p)
    .sort((a, b) => a.steps.length - b.steps.length || a.travel - b.travel || a.completedBy - b.completedBy);
}

/**
 * THE WHOLE CONTRACT, ON ONE BOARD.
 *
 * Every property the module promises, checked together because they are not
 * separable: an offer that is cheapest but bounces is worse than no offer, and
 * an offer that is safe but costlier than what was sitting there is the defect
 * the effort ranking exists to remove. Returns the field so a caller can say
 * something about WHICH merge won.
 */
function checkOffer(id: string, world: World, items: BoardItemState[]): { offered: MergePlan | null; field: MergePlan[] } {
  const board = boardFor(world, items);
  const offered = nextMergePlan(items, CHAINS, board);
  const field = fieldOf(items, board);
  expect(!!offered, `${id}: a plannable board offered nothing`).toBe(field.length > 0);
  if (!offered) return { offered, field };

  // Not "which chain" — the ORDER. The offer must be the minimum of
  // (drags, haul, age) over the whole field, however that field came out.
  expect(
    [offered.steps.length, offered.travel, offered.completedBy],
    `${id}: offered a plan that is not the cheapest available`
  ).toEqual([field[0]!.steps.length, field[0]!.travel, field[0]!.completedBy]);

  // DETERMINISM. The same board, iterated the other way round, has to answer
  // the same — a hand that flickers between two equally good plans reads as a
  // bug, and the tie-breaks (haul, then age, then the plan's own steps) exist
  // precisely so nothing falls out of iteration order.
  const mirrored = nextMergePlan([...items].reverse(), CHAINS, boardFor(world, [...items].reverse()));
  expect(mirrored, `${id}: the same board answered two different ways`).toEqual(offered);

  // SAFETY. Every step but the last is a GATHER onto FREE ground, so no
  // intermediate drag can bounce off an occupied tile — and, under the drop-on
  // rule, none can fuse before its turn either. Only the last lands on a piece.
  const at = new Map(items.map((i) => [i.id, { col: i.col, row: i.row }]));
  const occupied = new Set(items.map((i) => `${i.col},${i.row}`));
  for (const step of offered.steps.slice(0, -1)) {
    expect(step.completes, `${id}: a non-final step claims to complete`).toBe(false);
    expect(occupied.has(`${step.to.col},${step.to.row}`), `${id}: bounced step`).toBe(false);
    occupied.delete(`${at.get(step.itemId)!.col},${at.get(step.itemId)!.row}`);
    occupied.add(`${step.to.col},${step.to.row}`);
    at.set(step.itemId, step.to);
  }
  expect(offered.steps.at(-1)!.completes).toBe(true);

  // AND IT FUSES — by the SAME predicate MergeSystem runs on the drop, asked
  // of the board AS THE PLAN LEAVES IT: gathers applied, the final piece in
  // hand. Walking the seats for one flood is not enough any more; connected
  // and unmerged is a legal resting state under the drop-on rule.
  expect(finalVerdict(world, items, offered).kind, `${id}: cheapest plan's last drop is not a merge`).toBe('merge');
  return { offered, field };
}

describe('the merge planner, on every shipped world', () => {
  for (const [id, world] of worlds) {
    const ground = groundOf(world);
    // A world with almost no ground cannot host a 3-merge, and saying nothing
    // there is the CORRECT answer — Runevault is five one-cell slabs.
    if (ground.length < 12) continue;

    it(`${id}: offers a plan for scattered pieces, and every plan really fuses`, () => {
      let offered = 0;
      let tried = 0;
      for (let t = 0; t < 40; t++) {
        const pick = [
          ground[(t * 7) % ground.length]!,
          ground[(t * 13 + 3) % ground.length]!,
          ground[(t * 29 + 11) % ground.length]!
        ];
        if (new Set(pick.map((c) => `${c.col},${c.row}`)).size < 3) continue;
        tried++;
        const items = pick.map(
          (c, n) =>
            ({ id: n + 1, chain: 'flame_gem', tier: 1, col: c.col, row: c.row, kind: 'item' }) as BoardItemState
        );
        const board = boardFor(world, items);
        const plan = nextMergePlan(items, CHAINS, board);
        if (!plan) continue;
        offered++;

        // The safety property: every step but the last is a gather onto FREE
        // ground, so no intermediate drag can bounce or fuse early.
        expect(plan.steps.at(-1)!.completes).toBe(true);
        for (const step of plan.steps.slice(0, -1)) expect(step.completes).toBe(false);

        // The gathers leave the staying pieces one flood on the world's own
        // graph — the cluster the last piece is dropped on…
        const moved = new Map(plan.steps.slice(0, -1).map((s) => [s.itemId, s.to] as const));
        const staying = items
          .filter((i) => i.id !== plan.steps.at(-1)!.itemId)
          .map((i) => moved.get(i.id) ?? { col: i.col, row: i.row });
        expect(oneFlood(world, staying), `${id}: gathers do not connect`).toBe(true);

        // …and the final drop lands ON it and the rule itself calls it a
        // merge. THE assertion of this file: the hand and MergeSystem agree.
        expect(finalVerdict(world, items, plan).kind, `${id}: plan does not fuse`).toBe('merge');
      }
      // The regression itself: this was ~0 on every world but Emberkeep.
      expect(offered / tried).toBeGreaterThan(0.9);
    });

    it(`${id}: offers the cheapest merge on the board, never merely the oldest`, () => {
      let boards = 0;
      let choices = 0; // boards where more than one merge could be made
      for (let t = 0; t < 40; t++) {
        // Two sets that completed at different times: the OLD one (ids 1-3)
        // scattered across the world, the YOUNG one (ids 4-6) dropped as a
        // huddle. Age says the first, effort says the second, and effort is
        // what the player is spending.
        const spread = [
          ground[(t * 11) % ground.length]!,
          ground[(t * 23 + 5) % ground.length]!,
          ground[(t * 31 + 17) % ground.length]!
        ];
        const seed = ground[(t * 7 + 2) % ground.length]!;
        const near = neighborsOf(world, seed.col, seed.row);
        const huddle = [seed, ...near.slice(0, 2)];
        const cells = [...spread, ...huddle];
        if (new Set(cells.map((c) => `${c.col},${c.row}`)).size < cells.length) continue;
        boards++;
        const items: BoardItemState[] = cells.map(
          (c, n) =>
            ({
              id: n + 1,
              chain: n < 3 ? 'flame_gem' : 'moonwater',
              tier: 1,
              col: c.col,
              row: c.row,
              kind: 'item'
            }) as BoardItemState
        );
        const { offered, field } = checkOffer(id, world, items);
        if (!offered) continue;
        if (field.length > 1) choices++;
      }
      // The test would pass vacuously if the boards never had a choice to make.
      expect(boards).toBeGreaterThan(20);
      expect(choices).toBeGreaterThan(0);
    });

    it(`${id}: every plan the field can produce ends in a drop the rule calls a merge`, () => {
      // Not only the offer — EVERY plan `planFor` will hand out, on mixed
      // boards, across the shipped ground. The offer test above could pass
      // while a losing plan still promised a bounce; this one closes that.
      let checked = 0;
      for (let t = 0; t < 30; t++) {
        const cells = [
          ground[(t * 7) % ground.length]!,
          ground[(t * 13 + 3) % ground.length]!,
          ground[(t * 29 + 11) % ground.length]!,
          ground[(t * 11 + 6) % ground.length]!,
          ground[(t * 23 + 14) % ground.length]!,
          ground[(t * 31 + 20) % ground.length]!
        ];
        if (new Set(cells.map((c) => `${c.col},${c.row}`)).size < cells.length) continue;
        const items: BoardItemState[] = cells.map(
          (c, n) =>
            ({
              id: n + 1,
              chain: n < 3 ? 'flame_gem' : 'moonwater',
              tier: 1,
              col: c.col,
              row: c.row,
              kind: 'item'
            }) as BoardItemState
        );
        const board = boardFor(world, items);
        for (const plan of fieldOf(items, board)) {
          checked++;
          expect(
            finalVerdict(world, items, plan).kind,
            `${id}: a plan whose last drop the board would not fuse`
          ).toBe('merge');
        }
      }
      expect(checked, `${id}: the generator produced no plans to check`).toBeGreaterThan(10);
    });

    /**
     * THE GAP BRIDGE, INVERTED — the same boards that once caught the floor
     * over-stating, now catching a planner that under-states.
     *
     * A HUB is a free cell with three neighbours that do not touch each other.
     * Put a piece on each arm and the set is pairwise non-adjacent and one
     * SEAT away from being complete — but under the drop-on rule that seat is
     * a plain move, so the whole merge is two drags: build the bridge, drop ON
     * it. Against it stands an adjacent PAIR plus a distant third: one drag,
     * whatever the haul, because a drop on either member of the pair reaches
     * the recipe as the board stands. Drags dominate haul, so the pair must
     * win every time — a planner still running the free-flood arithmetic
     * offers the bridge and fails here on every world.
     */
    it(`${id}: offers the touching pair over the gap bridge, which now costs a second drag`, () => {
      // Hubs, with the arms reduced to a pairwise non-touching set — on a
      // square lattice that is all four neighbours, but the exported zone
      // graphs are not lattices and two "neighbours" of a cell can neighbour
      // each other, which would hand the set a standing pair and prove nothing.
      const hubs: { hub: TilePos; arms: TilePos[] }[] = [];
      for (const c of ground) {
        const arms: TilePos[] = [];
        for (const n of neighborsOf(world, c.col, c.row)) {
          if (!arms.some((a) => touching(world, a, n))) arms.push(n);
        }
        if (arms.length >= 3) hubs.push({ hub: c, arms });
      }
      // Every adjacent pair, listed once (lower cell first).
      const pairs: [TilePos, TilePos][] = [];
      for (const c of ground) {
        for (const n of neighborsOf(world, c.col, c.row)) {
          if (c.col < n.col || (c.col === n.col && c.row < n.row)) pairs.push([c, n]);
        }
      }
      expect(hubs.length, `${id}: no hub to bridge across`).toBeGreaterThan(0);
      expect(pairs.length, `${id}: no adjacent pair to stand against it`).toBeGreaterThan(0);

      let built = 0;
      let contested = 0; // boards where the bridge was really on the table
      for (let t = 0; t < 60; t++) {
        const { hub, arms } = hubs[(t * 7) % hubs.length]!;
        const pair = pairs[(t * 13 + 5) % pairs.length]!;
        const far = ground[(t * 29 + 11) % ground.length]!;
        const cells = [arms[0]!, arms[1]!, arms[2]!, pair[0], pair[1], far];
        const keys = new Set(cells.map((c) => `${c.col},${c.row}`));
        if (keys.size !== cells.length) continue;
        if (keys.has(`${hub.col},${hub.row}`)) continue; // the bridge cell must stay free
        built++;

        // ids 1-3 are the gap bridge and complete FIRST, so age is on ITS
        // side — the pair has to win on effort alone, not on the tie-break.
        const items: BoardItemState[] = cells.map(
          (c, n) =>
            ({
              id: n + 1,
              chain: n < 3 ? 'flame_gem' : 'moonwater',
              tier: 1,
              col: c.col,
              row: c.row,
              kind: 'item'
            }) as BoardItemState
        );
        const { offered, field } = checkOffer(id, world, items);
        if (!offered) continue;

        // The winner is the ONE-drag drop-on, and its pieces include the
        // standing pair — precisely the plan the free-flood floor buried.
        expect(offered.steps.length, `${id}: the winning plan is not the single drop-on`).toBe(1);
        const winners = offered.ids.map((pieceId) => items.find((i) => i.id === pieceId)!);
        const anyTouching = winners.some((a, i) => winners.some((b, j) => i < j && touching(world, a, b)));
        expect(anyTouching, `${id}: a one-drag win with no standing pair`).toBe(true);

        // And the bridge really was on the table, priced at TWO drags — the
        // board distinguishes the rules, not merely the ordering.
        const bridge = field.find((p) => p.chain === 'flame_gem');
        if (bridge) {
          expect(bridge.steps.length, `${id}: the bridge is not two drags`).toBe(2);
          expect(finalVerdict(world, items, bridge).kind).toBe('merge');
          contested++;
        }
      }
      expect(built, `${id}: the generator built nothing`).toBeGreaterThan(10);
      // Vacuum guard: without this the test would pass on a build where the
      // bridge never got planned at all, which is exactly the build being
      // guarded against.
      expect(contested, `${id}: no board where the bridge stood against the pair`).toBeGreaterThan(built / 2);
    });
  }
});
