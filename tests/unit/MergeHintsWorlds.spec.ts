import { describe, expect, it } from 'vitest';
import { buildWorlds, hasCell, neighborsOf, worldPointOf, zoneAt } from '../../src/core/world';
import { mergeHints, nextMergePlan, planFor, type HintBoard, type MergePlan } from '../../src/core/mergeHints';
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
 * first: a scattered set gets a PLAN, and every plan really fuses — the three
 * pieces end up as ONE connected flood through the world's own adjacency,
 * which is what MergeSystem does when the last piece lands.
 *
 * A third joined them once the offer stopped being "the oldest plannable one":
 * on a board holding several mergeable sets, the one the hand asks for must be
 * the CHEAPEST — fewest drags, then shortest haul, then oldest. That rule is
 * only interesting where there is a choice, so it gets its own boards, and it
 * is asserted against the full field rather than against a hand-picked answer:
 * whatever the planner returns must be the minimum of the triple over every
 * hint the board could have offered.
 *
 * THE FOURTH IS THE ONE THAT WAS MISSING, and it is the reason the third test
 * passed while the planner was wrong on a tenth of real boards. Its generator
 * only ever built two families — three random cells, and a seed with two of its
 * neighbours — and NEITHER can produce the shape that breaks a naive drag
 * bound: a set whose pieces are pairwise NOT touching, and which still fits
 * inside one connected `need`-cell shape because the piece that moves lands in
 * the gap between them. `nextMergePlan` pruned its search with
 * `need − largestCluster`, which counts adjacency the board already has, and on
 * exactly that shape it over-stated the cost by a drag and threw the cheapest
 * plan away. So the gap bridge is generated here on purpose, and the boards it
 * builds put a cheap gap-bridge merge against a touching pair that costs the
 * same one drag and a longer haul — the pair the old bound preferred. Restore
 * that bound and this file fails on 34/39 Emberkeep boards, 46/51 Borealis and
 * 47/53 Roothold.
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

/** Every plan the board could have produced, ranked by hand on the file's own
 *  stated triple. The offer has to be the head of this list — asserted against
 *  the whole field rather than a hand-picked answer, because a hand-picked
 *  answer only ever tests the case whoever wrote it thought of. */
function fieldOf(items: BoardItemState[], board: HintBoard): MergePlan[] {
  return mergeHints(items, CHAINS, board)
    .map((h) => planFor(h, items, board))
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
  // bug, and the tie-breaks (haul, then age, then the shape's own cells) exist
  // precisely so nothing falls out of iteration order.
  const mirrored = nextMergePlan([...items].reverse(), CHAINS, boardFor(world, [...items].reverse()));
  expect(mirrored, `${id}: the same board answered two different ways`).toEqual(offered);

  // SAFETY. Every step but the last lands on FREE ground, so no intermediate
  // drag can bounce off an occupied tile; only the last is allowed to land on a
  // piece, and that is the drop that fuses.
  const finals = new Map(items.map((i) => [i.id, { col: i.col, row: i.row }]));
  const occupied = new Set(items.map((i) => `${i.col},${i.row}`));
  for (const step of offered.steps.slice(0, -1)) {
    expect(step.completes, `${id}: a non-final step claims to complete`).toBe(false);
    expect(occupied.has(`${step.to.col},${step.to.row}`), `${id}: bounced step`).toBe(false);
    occupied.delete(`${finals.get(step.itemId)!.col},${finals.get(step.itemId)!.row}`);
    occupied.add(`${step.to.col},${step.to.row}`);
    finals.set(step.itemId, step.to);
  }
  const last = offered.steps.at(-1)!;
  expect(last.completes).toBe(true);
  finals.set(last.itemId, last.to);

  // AND IT FUSES. Deduped, because the fusing drop is allowed to land ON a mate
  // — that is the whole "already connected, one flick finishes it" case, and
  // there the set ends on `need - 1` cells rather than `need`. What has to hold
  // either way is that the cells they end on are one flood.
  const seats = new Map(
    offered.ids.map((pieceId) => [`${finals.get(pieceId)!.col},${finals.get(pieceId)!.row}`, finals.get(pieceId)!])
  );
  expect(oneFlood(world, [...seats.values()]), `${id}: cheapest plan does not fuse`).toBe(true);
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

        // Where each piece ends up once the plan has been carried out.
        const finals = new Map(items.map((i) => [i.id, { col: i.col, row: i.row }]));
        for (const step of plan.steps) finals.set(step.itemId, step.to);
        expect(oneFlood(world, [...finals.values()]), `${id}: plan does not fuse`).toBe(true);

        // The safety property: every step but the last lands on FREE ground, so
        // no intermediate drag can bounce off an occupied tile.
        expect(plan.steps.at(-1)!.completes).toBe(true);
        for (const step of plan.steps.slice(0, -1)) expect(step.completes).toBe(false);
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

    /**
     * THE GAP BRIDGE — the shape neither generator above can produce, and the
     * one the shipped drag bound got wrong.
     *
     * A HUB is a free cell with three neighbours that do not touch each other.
     * Put a piece on each of those three arms and you have a set whose pieces
     * are PAIRWISE NON-ADJACENT — `largestCluster` reads 1 — and which is one
     * drag from merging, because any arm dropped on the hub joins the other
     * two. The old floor read `need − 1 = 2` and pruned it away.
     *
     * Against it stands a decoy the old floor liked: an adjacent PAIR plus a
     * distant third. Same one drag, longer haul. So on these boards the old
     * planner planned the decoy first, saw the bridge's floor of 2, broke, and
     * handed the player the long swipe with the short one on the board.
     */
    it(`${id}: offers a gap-bridge merge over a touching pair with a longer haul`, () => {
      // Hubs, with the arms reduced to a pairwise non-touching set — on a
      // square lattice that is all four neighbours, but the exported zone
      // graphs are not lattices and two "neighbours" of a cell can neighbour
      // each other, which would hand the set a cluster of 2 and prove nothing.
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
      let bridgeWins = 0; // boards where the pairwise-apart set really is the answer
      for (let t = 0; t < 60; t++) {
        const { hub, arms } = hubs[(t * 7) % hubs.length]!;
        const pair = pairs[(t * 13 + 5) % pairs.length]!;
        const far = ground[(t * 29 + 11) % ground.length]!;
        const cells = [arms[0]!, arms[1]!, arms[2]!, pair[0], pair[1], far];
        const keys = new Set(cells.map((c) => `${c.col},${c.row}`));
        if (keys.size !== cells.length) continue;
        if (keys.has(`${hub.col},${hub.row}`)) continue; // the bridge cell must stay free
        built++;

        // ids 1-3 are the gap bridge and complete FIRST, so age is on their
        // side too — this board only distinguishes the bounds, not the ordering.
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
        if (!offered || !field.length) continue;

        // Did this board actually exercise the trap? The winning plan costs one
        // drag while its own pieces touch nothing — which is precisely the
        // configuration `need − largestCluster` claims costs two.
        const winners = offered.ids.map((pieceId) => items.find((i) => i.id === pieceId)!);
        const anyTouching = winners.some((a, i) => winners.some((b, j) => i < j && touching(world, a, b)));
        if (offered.steps.length === 1 && !anyTouching) bridgeWins++;
      }
      expect(built, `${id}: the generator built nothing`).toBeGreaterThan(10);
      // Vacuum guard: without this the test would pass on a build where the
      // bridge never wins, which is exactly the build being guarded against.
      expect(bridgeWins, `${id}: no board where the gap bridge is the answer`).toBeGreaterThan(built / 2);
    });
  }
});
