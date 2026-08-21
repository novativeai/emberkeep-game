import { describe, expect, it } from 'vitest';
import realMap from '../../src/data/map.json';
import { REGRID_SEARCH_RINGS, SAVE_KEY, SAVE_VERSION, WORLD_ID } from '../../src/core/Constants';
import { GameState } from '../../src/core/GameState';
import { setProjection } from '../../src/core/iso';
import {
  gridToMapPoint,
  mapPointToGrid,
  mapPointToWorld,
  mapSignature,
  mapSpaceOf,
  worldToMapPoint
} from '../../src/core/mapSpace';
import type { MapData, SaveDataV1 } from '../../src/core/types';
import { createTestContext, drag, MemoryStorage } from './helpers';

const MAP = realMap as unknown as MapData;

/**
 * The world re-exported with its grid origin moved — every cell renumbered by
 * (dc,dr) while the ART stays exactly where it was. This is the realistic shape
 * of the coming change (a zone split, or simply a new north-west placement
 * redefining cell 0,0 — the World Builder's `gameOrigin` does exactly this), and
 * it is the case a stored `(col,row)` cannot survive and a map point can.
 */
function regrid(map: MapData, dc: number, dr: number): MapData {
  const cell = ([c, r]: [number, number]): [number, number] => [c + dc, r + dr];
  const moved = <T extends { col: number; row: number }>(o: T): T => ({ ...o, col: o.col + dc, row: o.row + dr });
  return {
    ...map,
    cols: map.cols + dc,
    rows: map.rows + dr,
    regions: map.regions.map((rg) => ({
      ...rg,
      tiles: rg.tiles.map(cell),
      contents: rg.contents?.map((c) => ({ ...c, at: cell(c.at) })),
      decor: rg.decor?.map((d) => ({ ...d, at: cell(d.at) }))
    })),
    startingItems: map.startingItems.map((i) => ({ ...i, at: cell(i.at) })),
    startingDecor: map.startingDecor?.map((d) => ({ ...d, at: cell(d.at) })),
    playable: map.playable?.map(cell),
    invisible: map.invisible?.map(cell),
    tilesByCell: map.tilesByCell
      ? Object.fromEntries(
          Object.entries(map.tilesByCell).map(([k, v]) => {
            const [c, r] = k.split(',').map(Number);
            return [`${(c ?? 0) + dc},${(r ?? 0) + dr}`, v];
          })
        )
      : undefined,
    mapDecor: map.mapDecor?.map(moved),
    backgrounds: map.backgrounds?.map(moved),
    decor3d: map.decor3d?.map(moved)
  };
}

describe('map space — the coordinate that survives a re-grid', () => {
  it('anchors to the real world’s backdrop', () => {
    const space = mapSpaceOf(MAP);
    expect(space.anchored).toBe(true);
    expect(space.unit).toBeGreaterThan(0);
  });

  it('round-trips every authored position on the shipped map, exactly', () => {
    const space = mapSpaceOf(MAP);
    const cells: [number, number][] = [
      ...(MAP.playable ?? []),
      ...MAP.regions.flatMap((r) => r.tiles),
      ...MAP.startingItems.map((i) => i.at),
      ...(MAP.startingDecor ?? []).map((d) => d.at),
      ...(MAP.mapDecor ?? []).map((d): [number, number] => [d.col, d.row]),
      ...(MAP.decor3d ?? []).map((d): [number, number] => [d.col, d.row]),
      ...(MAP.cameraKeyframes ?? [])
        .filter((k) => k.focus)
        .map((k): [number, number] => [k.focus!.col, k.focus!.row])
    ];
    expect(cells.length).toBeGreaterThan(50); // guards the guard
    for (const [col, row] of cells) {
      expect(mapPointToGrid(space, gridToMapPoint(space, col, row))).toEqual({ col, row });
    }
  });

  it('is its own inverse in world pixels', () => {
    const space = mapSpaceOf(MAP);
    for (const [x, y] of [[0, 0], [1234.5, -678.25], [-40, 9000]]) {
      const back = mapPointToWorld(space, worldToMapPoint(space, x!, y!));
      expect(back.x).toBeCloseTo(x!, 1);
      expect(back.y).toBeCloseTo(y!, 1);
    }
  });

  it('does NOT read the ambient projection — the trap that would poison every stored point', () => {
    // iso.ts keeps a module-level projection that only BoardScene sets. Anything
    // computing a saved coordinate outside a scene would silently get the wrong
    // grid, and the error would only surface during the migration, years later.
    const space = mapSpaceOf(MAP);
    const before = gridToMapPoint(space, 7, 5);
    setProjection({ width: 999, height: 111, skew: 12 }); // a projection from another world
    const after = gridToMapPoint(space, 7, 5);
    setProjection(MAP.tile);
    expect(after).toEqual(before);
  });

  it('changes signature when — and only when — the grid moves relative to the art', () => {
    const sig = mapSignature(WORLD_ID, MAP);
    expect(mapSignature(WORLD_ID, { ...MAP })).toBe(sig);
    expect(mapSignature(WORLD_ID, regrid(MAP, 2, 3))).not.toBe(sig);
    expect(mapSignature('borealis', MAP)).not.toBe(sig);
    expect(mapSignature(WORLD_ID, { ...MAP, tile: { width: 300, height: 242 } })).not.toBe(sig);
  });
});

describe('map space — what the save carries', () => {
  it('stamps world, signature and a map point on every saved item', () => {
    const storage = new MemoryStorage();
    const ctx = createTestContext(storage);
    ctx.beginRun();
    drag(ctx, [3, 4], [1, 3]);
    ctx.systems.save.save();

    const save = JSON.parse(storage.getItem(SAVE_KEY)!) as SaveDataV1;
    expect(save.world).toBe(WORLD_ID);
    expect(save.mapSignature).toBe(ctx.state.signature);
    expect(save.items.length).toBeGreaterThan(0);
    for (const item of save.items) {
      expect(item.place).toBeDefined();
      expect(item.place!.zone).toBe('main');
      expect(item.place!.world).toBe(WORLD_ID);
      const expected = gridToMapPoint(ctx.state.space, item.col, item.row);
      expect(item.place!.mx).toBe(expected.x);
      expect(item.place!.my).toBe(expected.y);
    }
  });

  it('loads a pre-map-space save unchanged — no signature, no places', () => {
    const storage = new MemoryStorage();
    const ctx1 = createTestContext(storage);
    ctx1.beginRun();
    drag(ctx1, [3, 4], [1, 3]);
    ctx1.systems.save.save();

    // Strip everything map space added, exactly as a save written before it looks.
    const raw = JSON.parse(storage.getItem(SAVE_KEY)!) as SaveDataV1;
    const legacy = {
      ...raw,
      world: undefined,
      mapSignature: undefined,
      nestPlaces: undefined,
      items: raw.items.map(({ place: _place, ...rest }) => rest)
    };
    storage.setItem(SAVE_KEY, JSON.stringify(legacy));

    const ctx2 = createTestContext(storage);
    expect(ctx2.systems.save.load()).toBe(true);
    expect(ctx2.state.items.size).toBe(ctx1.state.items.size);
    expect(ctx2.state.itemAt(1, 3)?.tier).toBe(2);
    expect(ctx2.state.relocated).toEqual([]);
    for (const [id, item] of ctx1.state.items) {
      expect(ctx2.state.items.get(id)).toMatchObject({ col: item.col, row: item.row });
    }
  });
});

describe('map space — surviving the re-grid (dormant until zones land)', () => {
  const playable = [...(MAP.playable ?? [])].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  /** A cell well inside the isle, and the southernmost one — the second is the
   *  piece we can strand by shrinking the world. */
  const SAFE = playable[0]!;
  const EDGE = playable[playable.length - 1]!;

  /** A save written on the shipped map, with a couple of pieces and a nest. */
  function saveOnShippedMap(): SaveDataV1 {
    const before = new GameState(MAP, WORLD_ID);
    before.addItem({ chain: 'ember_dragon', tier: 1, col: EDGE[0], row: EDGE[1], kind: 'item' });
    before.addItem({ chain: 'lumber', tier: 2, col: SAFE[0], row: SAFE[1], kind: 'item' });
    before.nests[`${SAFE[0]},${SAFE[1]}`] = { points: 3, pointsToday: 1, day: 2 };
    return before.toSave(1000, SAVE_VERSION);
  }

  /** The same island on a world that no longer reaches as far south, with the
   *  ground around `EDGE` gone too — so the stranded piece has nowhere to go. */
  function shrunk(): MapData {
    return {
      ...MAP,
      rows: EDGE[1],
      playable: (MAP.playable ?? []).filter(
        ([c, r]) => Math.max(Math.abs(c - EDGE[0]), Math.abs(r - EDGE[1])) > 3
      )
    };
  }

  it('re-places every piece onto the same ground when the grid is renumbered', () => {
    const save = saveOnShippedMap();
    const shifted = regrid(MAP, 2, 3);
    const after = new GameState(shifted, WORLD_ID);
    after.hydrate(save);

    // Nothing lost, nothing banked.
    expect(after.items.size).toBe(save.items.length);
    expect(after.bag).toEqual([]);

    // Every piece moved by exactly the renumbering — the art did not move, so
    // neither did the piece; only its address did.
    for (const saved of save.items) {
      const live = after.items.get(saved.id)!;
      expect({ col: live.col, row: live.row }).toEqual({ col: saved.col + 2, row: saved.row + 3 });
      // and the grid index agrees with the item record
      expect(after.itemIdAt(live.col, live.row)).toBe(saved.id);
    }
    // The nest moved with its cell rather than being orphaned on a stale key.
    expect(after.nests[`${SAFE[0] + 2},${SAFE[1] + 3}`]).toEqual({ points: 3, pointsToday: 1, day: 2 });
    expect(after.nests[`${SAFE[0]},${SAFE[1]}`]).toBeUndefined();
    expect(after.relocated.length).toBe(save.items.length);
  });

  it('keeps every piece on real ground, near its art position, when the lattice changes shape', () => {
    const save = saveOnShippedMap();
    // The same island re-drawn on a shallower lattice: the cells now cover
    // different art, so most pieces genuinely have to choose a new cell.
    const shallower: MapData = { ...MAP, tile: { ...MAP.tile!, height: 200 } };
    const after = new GameState(shallower, WORLD_ID);
    after.hydrate(save);
    expect(after.items.size).toBe(save.items.length);
    expect(after.bag).toEqual([]);

    const space = mapSpaceOf(shallower);
    const isle = new Set((shallower.playable ?? []).map(([c, r]) => `${c},${r}`));
    for (const saved of save.items) {
      const live = after.items.get(saved.id)!;
      // On the isle — the contract that matters. A piece dropped in the void
      // would still be visible and would never merge again.
      expect(isle.has(`${live.col},${live.row}`)).toBe(true);
      // And within the bounded search of where its art position points.
      const target = mapPointToGrid(space, { x: saved.place!.mx, y: saved.place!.my });
      expect(Math.max(Math.abs(live.col - target.col), Math.abs(live.row - target.row)))
        .toBeLessThanOrEqual(REGRID_SEARCH_RINGS);
    }
  });

  it('leaves a deliberately off-isle fixture exactly where the art puts it', () => {
    // The Theme Crystal is authored at [8,11] — outside `playable`, on purpose.
    const [cc, cr] = MAP.startingItems[0]!.at;
    expect((MAP.playable ?? []).some(([c, r]) => c === cc && r === cr)).toBe(false);

    const before = new GameState(MAP, WORLD_ID);
    before.addItem({ chain: 'crystal', tier: 1, col: cc, row: cr, kind: 'item' });
    const save = before.toSave(1000, SAVE_VERSION);
    expect(save.items[0]!.place!.onIsle).toBe(false);

    const after = new GameState(regrid(MAP, 2, 3), WORLD_ID);
    after.hydrate(save);
    const live = after.items.get(save.items[0]!.id)!;
    // Followed the art, and was NOT dragged onto the isle to be "helpful".
    expect({ col: live.col, row: live.row }).toEqual({ col: cc + 2, row: cr + 3 });
  });

  it('banks a piece whose ground is gone instead of deleting it', () => {
    const save = saveOnShippedMap();
    const after = new GameState(shrunk(), WORLD_ID);
    after.hydrate(save);

    expect(after.items.has(save.items[0]!.id)).toBe(false);
    expect(after.bag).toContainEqual({ chain: 'ember_dragon', tier: 1, count: 1 });
    expect(after.relocated).toContainEqual({
      id: save.items[0]!.id,
      from: { col: EDGE[0], row: EDGE[1] },
      to: null
    });
    // The piece that still had ground is untouched by its neighbour's trouble.
    expect(after.items.has(save.items[1]!.id)).toBe(true);
    expect(after.itemAt(SAFE[0], SAFE[1])?.chain).toBe('lumber');
  });

  it('pools banked pieces into the satchel the player already had', () => {
    const save = saveOnShippedMap();
    save.bag = [{ chain: 'ember_dragon', tier: 1, count: 2 }];
    const after = new GameState(shrunk(), WORLD_ID);
    after.hydrate(save);
    expect(after.bag).toContainEqual({ chain: 'ember_dragon', tier: 1, count: 3 });
  });
});
