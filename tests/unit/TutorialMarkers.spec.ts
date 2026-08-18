import { describe, expect, it } from 'vitest';
import { GameContext } from '../../src/core/Context';
import { markerPointAt, markerPointCell } from '../../src/systems/TutorialDirector';
import type {
  MarkerPoint,
  MapData,
  TilePos,
  TutorialData,
  TutorialStepConfig
} from '../../src/core/types';
import map8x8 from '../fixtures/map-8x8.json';
import { capture, MemoryStorage } from './helpers';

/**
 * THE POINTER FOLLOWS THE PIECE — ON EVERY MAP.
 *
 * The bug this file pins was reported in Roothold ("the hand does not follow the
 * dragon; it stays on the tile it was put down on") and had nothing to do with
 * Roothold. A marker was resolved to a CELL, once, when the beat opened, and a
 * cell is a place — the piece standing on it is free to walk away, and when it
 * did the hand went on pointing at bare ground, telling the player to do
 * something to a thing that is no longer there.
 *
 * So a marker end is now a `MarkerPoint`: the cell it names AND, when it names a
 * piece rather than ground, that piece's id. Two halves that must not be
 * confused, and this file is about keeping them apart:
 *
 *   the CHOICE of piece is decided once, by the director, and must be stable —
 *   the refs name a RANK ("the third Ash Moss") and rank is read positionally,
 *   so a pointer that re-ranked would swap dragons under the player's finger
 *   and call it following;
 *
 *   the POSITION is never decided at all. It is read from the piece, every
 *   frame, by whoever is drawing the marker — which is why `markerPointCell` is
 *   a pure function tested here rather than a line inside a Phaser scene.
 *
 * Nothing below names a world, and that is the load-bearing part: the readers
 * touch `state.items`, which is the ACTIVE world's board and nothing else, so
 * there is no per-map branch that can be right on the isle and wrong in
 * Roothold. The last two tests are the proof — the same script, run against
 * every world the build exports.
 */

const FIXTURE = map8x8 as unknown as MapData;

/** A chain no shipped map seeds, so the pieces a test places are the only ones
 *  its refs can possibly name. */
const CHAIN = 'marker_probe';

/** A one-step script whose only job is to carry the marker under test. The beat
 *  is tap-gated so nothing on the board can advance it out from under us. */
function scriptOf(step: Omit<TutorialStepConfig, 'id' | 'speaker' | 'text' | 'gate'>): TutorialData {
  return {
    steps: [
      { id: 'probe', speaker: 'eleanor', text: 'probe', gate: { type: 'tap' }, ...step },
      { id: 'after', speaker: 'eleanor', text: 'after', gate: { type: 'tap' } }
    ]
  };
}

function contextWith(tutorial: TutorialData, map: MapData | undefined = FIXTURE): GameContext {
  return new GameContext(new MemoryStorage(), map ? { map, tutorial } : { tutorial });
}

/** Open the scripted beat and hand back the view it emitted. */
function openBeat(ctx: GameContext) {
  const seen = capture(ctx.bus, 'tutorial:step');
  ctx.state.tutorialIndex = 0;
  ctx.systems.tutorial.begin();
  return seen.at(-1)!;
}

type DragHand = { from: MarkerPoint; to: MarkerPoint };

/** Every free, active cell of the world currently on screen, in a stable order.
 *  Read off the world's own zones rather than a rectangle: a world is a set of
 *  slabs, and the authored isle's Golden Altar sits at a negative index. */
function freeCells(ctx: GameContext, want: number): TilePos[] {
  const out: TilePos[] = [];
  for (const zone of ctx.state.world.zones) {
    const locals = zone.dense
      ? Array.from({ length: zone.matrix.cols * zone.matrix.rows }, (_, n) =>
          `${n % zone.matrix.cols},${Math.floor(n / zone.matrix.cols)}`
        )
      : [...zone.cells];
    for (const local of locals) {
      const [i = 0, j = 0] = local.split(',').map(Number);
      const col = zone.block.col + i;
      const row = zone.block.row + j;
      if (!ctx.state.isTileActive(col, row)) continue;
      if (ctx.state.itemIdAt(col, row) !== null) continue;
      out.push({ col, row });
      if (out.length === want) return out;
    }
  }
  return out;
}

/** Put the piece down somewhere else the way a drag does — the move plus the
 *  fact that announces it — without the merge magnet joining in. */
function relocate(ctx: GameContext, itemId: number, to: TilePos): void {
  const item = ctx.state.items.get(itemId)!;
  const from = { col: item.col, row: item.row };
  ctx.state.moveItem(itemId, to);
  ctx.bus.emit('item:moved', { itemId, from, to });
}

describe('a marker end names a piece, not the tile under it', () => {
  const threeInARow = (ctx: GameContext): number[] => {
    const cells = freeCells(ctx, 3);
    return cells.map(
      (c) => ctx.state.addItem({ chain: CHAIN, tier: 1, col: c.col, row: c.row, kind: 'item' }).id
    );
  };

  it('carries the id of the piece each end is aimed at', () => {
    const ctx = contextWith(
      scriptOf({ hand: { from: { chain: CHAIN, nth: 2 }, to: { chain: CHAIN, nth: 0 } } })
    );
    const ids = threeInARow(ctx);
    const hand = openBeat(ctx).hand as DragHand;

    expect(hand.from.item, 'the hand end is still only a cell').toBeDefined();
    expect(hand.to.item).toBeDefined();
    expect(ids).toContain(hand.from.item);
    expect(hand.from.item).not.toBe(hand.to.item);
    // The cell is still filled in — the board aims its camera off it once, when
    // the beat opens, and that reader must not have to learn about pieces.
    const piece = ctx.state.items.get(hand.from.item!)!;
    expect({ col: hand.from.col, row: hand.from.row }).toEqual({ col: piece.col, row: piece.row });
  });

  it('answers the same piece when the same beat is resolved again', () => {
    const ctx = contextWith(scriptOf({ arrow: { tile: { chain: CHAIN, nth: 1 } } }));
    threeInARow(ctx);
    const first = openBeat(ctx).arrow as { tile: MarkerPoint };
    const again = openBeat(ctx).arrow as { tile: MarkerPoint };
    expect(first.tile.item, 'the end never named a piece to be stable about').toBeDefined();
    expect(again.tile.item).toBe(first.tile.item);
  });

  it('keeps naming that piece when the ranking re-sorts under it', () => {
    // The ref says "the second of them" and rank is read off position, so a
    // piece dropped ahead of the named one re-numbers the whole set. A pointer
    // that re-ranked here would jump to a different piece and look like it was
    // following one.
    const ctx = contextWith(scriptOf({ arrow: { tile: { chain: CHAIN, nth: 1 } } }));
    threeInARow(ctx);
    const markers = capture(ctx.bus, 'tutorial:markers');
    const chosen = (openBeat(ctx).arrow as { tile: MarkerPoint }).tile.item;

    const spare = freeCells(ctx, 1)[0]!;
    const intruder = ctx.state.addItem({
      chain: CHAIN,
      tier: 1,
      col: spare.col,
      row: spare.row,
      kind: 'item'
    });
    ctx.bus.emit('item:spawned', {
      item: { id: intruder.id, chain: CHAIN, tier: 1, col: spare.col, row: spare.row, kind: 'item' },
      cause: 'quest'
    });

    expect(chosen, 'the end never named a piece to be stable about').toBeDefined();
    const latest = markers.at(-1)?.arrow as { tile: MarkerPoint } | undefined;
    if (latest) expect(latest.tile.item).toBe(chosen);
    expect(chosen).not.toBe(intruder.id);
  });

  it('follows the piece across the board instead of holding its old tile', () => {
    const ctx = contextWith(
      scriptOf({ hand: { from: { chain: CHAIN, nth: 2 }, to: { chain: CHAIN, nth: 0 } } })
    );
    threeInARow(ctx);
    const hand = openBeat(ctx).hand as DragHand;
    const started = { col: hand.from.col, row: hand.from.row };

    // The very end the UI captured when the hand went up — nothing re-resolves
    // it, which is the point: it is read, not re-derived.
    const away = freeCells(ctx, 1)[0]!;
    relocate(ctx, hand.from.item!, away);

    expect(markerPointCell(ctx.state, hand.from)).toEqual(away);
    expect(markerPointCell(ctx.state, hand.from)).not.toEqual(started);
  });

  it('reports nothing at all once the piece is gone, never its last tile', () => {
    const ctx = contextWith(scriptOf({ arrow: { tile: { chain: CHAIN, nth: 0 } } }));
    const ids = threeInARow(ctx);
    const arrow = openBeat(ctx).arrow as { tile: MarkerPoint };
    const stale = { col: arrow.tile.col, row: arrow.tile.row };

    ctx.state.removeItem(arrow.tile.item!);
    expect(markerPointCell(ctx.state, arrow.tile)).toBeNull();
    expect(markerPointCell(ctx.state, arrow.tile)).not.toEqual(stale);

    // And the beat itself re-resolves rather than re-offering the dead end: with
    // every piece of the chain gone there is no target left to name.
    const markers = capture(ctx.bus, 'tutorial:markers');
    for (const id of ids) {
      if (!ctx.state.items.has(id)) continue;
      const item = ctx.state.removeItem(id);
      ctx.bus.emit('item:removed', {
        itemId: id,
        at: { col: item.col, row: item.row },
        reason: 'sold'
      });
    }
    expect(markers.at(-1)!.arrow).toBeNull();
  });

  it('leaves a ground end exactly the tile it names', () => {
    const ctx = contextWith(scriptOf({}));
    const empty = freeCells(ctx, 1)[0]!;
    const end = markerPointAt(ctx.state, empty.col, empty.row);
    expect(end.item).toBeUndefined();
    expect(markerPointCell(ctx.state, end)).toEqual(empty);
  });

  it('does not follow scenery — a fixture cannot be picked up', () => {
    const ctx = contextWith(scriptOf({}));
    const cell = freeCells(ctx, 1)[0]!;
    ctx.state.addItem({ chain: 'decor_probe', tier: 1, col: cell.col, row: cell.row, kind: 'decor' });
    expect(markerPointAt(ctx.state, cell.col, cell.row).item).toBeUndefined();
  });

  /**
   * A DRAG HAS TWO ENDS AND THEY CANNOT BE THE SAME PIECE.
   *
   * The player is free to answer half the beat — to drop the piece on the very
   * cell the hand was pointing at. A destination that then re-resolved by
   * position would name the piece already in their hand, and the gesture would
   * collapse into a hand waving at itself. The destination reverts to the ground
   * it names, so "put it HERE" still reads.
   */
  it('falls back to ground when the destination becomes the carried piece', () => {
    const target = { col: 4, row: 5 };
    const ctx = contextWith(
      scriptOf({ hand: { from: { chain: CHAIN, nth: 0 }, to: [target.col, target.row] } })
    );
    const start = freeCells(ctx, 1)[0]!;
    const piece = ctx.state.addItem({
      chain: CHAIN,
      tier: 1,
      col: start.col,
      row: start.row,
      kind: 'item'
    });
    const before = openBeat(ctx).hand as DragHand;
    expect(before.to).toEqual(target); // nobody is standing there yet

    const markers = capture(ctx.bus, 'tutorial:markers');
    relocate(ctx, piece.id, target);

    const after = markers.at(-1)!.hand as DragHand;
    expect(after.from.item).toBe(piece.id);
    expect(after.to.item, 'the destination followed the piece being carried to it').toBeUndefined();
    expect(markerPointCell(ctx.state, after.to)).toEqual(target);
  });
});

/**
 * "IL FAUT QUE TOUS LES MAPS POSSÈDENT CE SYSTÈME."
 *
 * The same script, on every world the build exports. It is not a loop for the
 * sake of coverage: the reported symptom was "it works on one map and not the
 * others", and the only defence against that coming back is a test that would
 * have to be edited to name a world before it could pass on one and fail on
 * another.
 */
describe('every exported world points the same way', () => {
  const worldIds = (): string[] => [...new GameContext(new MemoryStorage()).state.worlds.keys()];

  it('exports more than one world, or the sweep below proves nothing', () => {
    expect(worldIds().length).toBeGreaterThan(1);
  });

  for (const world of worldIds()) {
    it(`follows a moved piece in '${world}'`, () => {
      const ctx = contextWith(
        scriptOf({ hand: { from: { chain: CHAIN, nth: 1 }, to: { chain: CHAIN, nth: 0 } } }),
        undefined
      );
      expect(ctx.state.switchWorld(world)).toBe(true);

      const cells = freeCells(ctx, 4);
      expect(cells.length, `${world} has no free ground to stand on`).toBe(4);
      for (const c of cells.slice(0, 3)) {
        ctx.state.addItem({ chain: CHAIN, tier: 1, col: c.col, row: c.row, kind: 'item' });
      }

      const hand = openBeat(ctx).hand as DragHand;
      expect(hand.from.item).toBeDefined();

      const away = cells[3]!;
      relocate(ctx, hand.from.item!, away);
      expect(markerPointCell(ctx.state, hand.from)).toEqual(away);

      // …and gone means gone, on this world exactly as on the last one.
      ctx.state.removeItem(hand.from.item!);
      expect(markerPointCell(ctx.state, hand.from)).toBeNull();
    });
  }

  /**
   * A board is per world, so an id from another isle simply is not in
   * `state.items` — and a hand pointing at a piece on a board the player has
   * left is worse than no hand. The answer is the same `null` a consumed piece
   * gives, on purpose: there is nothing here to point at, and the caller does
   * not need to know which of the two it was.
   */
  it('points at nothing when its piece is standing on another isle', () => {
    const ids = worldIds();
    const ctx = contextWith(scriptOf({ arrow: { tile: { chain: CHAIN, nth: 0 } } }), undefined);
    expect(ctx.state.switchWorld(ids[0]!)).toBe(true);
    const here = freeCells(ctx, 1)[0]!;
    ctx.state.addItem({ chain: CHAIN, tier: 1, col: here.col, row: here.row, kind: 'item' });

    const arrow = openBeat(ctx).arrow as { tile: MarkerPoint };
    expect(markerPointCell(ctx.state, arrow.tile)).toEqual(here);

    expect(ctx.state.switchWorld(ids[1]!)).toBe(true);
    expect(markerPointCell(ctx.state, arrow.tile)).toBeNull();
  });
});
