import { describe, expect, it } from 'vitest';
import { GameContext } from '../../src/core/Context';
import { MemoryStorage } from './helpers';
import type { MapData, SaveDataV1 } from '../../src/core/types';
import mapJson from '../../src/data/map.json';

/**
 * The Theme Crystal stands OFF the playable zone, on purpose.
 *
 * `map.json` starts it at (8,11), a cell that belongs to no region — a landmark
 * on a ledge below the board, not a merge piece. That makes it the one starting
 * item no other guard can see: `render_game_to_text` only reports cells inside an
 * ACTIVE region, so the e2e's full board comparison across a reload — the test
 * that exists precisely to catch pieces moving — skips it entirely. It has drifted
 * twice for that reason.
 *
 * These run on the SHIPPED map (not the 8x8 fixture): the cell, the regions it is
 * deliberately outside of, and the zone geometry are the thing under test.
 */
const shipped = (): GameContext =>
  new GameContext(new MemoryStorage(), { map: mapJson as unknown as MapData });

const crystalAt = (ctx: GameContext): string | null => {
  const it = [...ctx.state.items.values()].find((i) => i.chain === 'crystal');
  return it ? `${it.col},${it.row}` : null;
};

describe('the Theme Crystal keeps its ledge', () => {
  it('starts where the map authored it, outside every region', () => {
    const ctx = shipped();
    ctx.systems.board.newGame();
    expect(crystalAt(ctx)).toBe('8,11');
    // The premise of the whole bug: this cell is NOT playable ground.
    expect(ctx.state.isTileActive(8, 11)).toBe(false);
  });

  it('survives a save round trip on the same map', () => {
    const ctx = shipped();
    ctx.systems.board.newGame();
    const save = ctx.state.toSave(1000, 8);
    ctx.state.hydrate(save);
    expect(crystalAt(ctx)).toBe('8,11');
  });

  it('survives a RE-GRID — the case that actually moved it', () => {
    // A save written before the world was re-cut (a merge that lands new
    // zones.json, an editor "Apply", a shipped update). The signature no longer
    // matches, so every piece comes back through `placeByMapPoint` instead of
    // straight off its cell — and scenery parked outside `playable` is exactly
    // what that path can mis-handle: it asks for the nearest USABLE cell, and
    // "usable" must not silently mean "on the board" for a piece whose whole
    // point is that it is not.
    const ctx = shipped();
    ctx.systems.board.newGame();
    const save = ctx.state.toSave(1000, 8) as SaveDataV1 & {
      worlds?: Record<string, { mapSignature?: string }>;
    };
    for (const board of Object.values(save.worlds ?? {})) {
      board.mapSignature = 'a-different-world|1x1|1x1s0|none@0,0+0,0*1';
    }
    ctx.state.hydrate(save as SaveDataV1);
    expect(crystalAt(ctx)).toBe('8,11');
  });
});

/**
 * What ACTUALLY moved it. A fixture is a `startingItems` placement outside
 * `playable`, and every mover on the board only ever asked whether the
 * DESTINATION was active ground — so the Crystal could be dragged off its ledge
 * onto the isle, and the save then kept it there for good.
 */
describe('the Theme Crystal is scenery, not a merge piece', () => {
  it('cannot be dragged onto the board', () => {
    const ctx = shipped();
    ctx.systems.board.newGame();
    ctx.state.tutorialDone = true; // the drag guard the player reaches
    const crystal = [...ctx.state.items.values()].find((i) => i.chain === 'crystal')!;
    let bounced = 0;
    ctx.bus.on('item:move_bounced', () => (bounced += 1));

    ctx.bus.emit('drag:dropped', {
      itemId: crystal.id,
      from: { col: 8, row: 11 },
      to: { col: 9, row: 7 } // the last free tile of level_1 — real, active ground
    });

    expect(crystalAt(ctx)).toBe('8,11');
    expect(bounced).toBe(1);
  });

  it('is not moved by a scripted tutorial relocation', () => {
    const ctx = shipped();
    ctx.systems.board.newGame();
    ctx.bus.emit('board:move', { chain: 'crystal', tier: 1, to: [8, 7] });
    expect(crystalAt(ctx)).toBe('8,11');
  });

  it('is put back by a save that already moved it', () => {
    // Exactly the shape of a played save from before the guards existed.
    const ctx = shipped();
    ctx.systems.board.newGame();
    const save = ctx.state.toSave(1000, 8);
    const strayed = save.items.find((i) => i.chain === 'crystal')!;
    strayed.col = 9;
    strayed.row = 7;

    ctx.state.hydrate(save);

    expect(crystalAt(ctx)).toBe('8,11');
    // …and it did not leave a ghost behind on the cell it was rescued from.
    expect(ctx.state.itemIdAt(9, 7)).toBeNull();
  });
});

describe('a fixture takes its cell back even when squatted on', () => {
  it('re-seats the Crystal and rehouses whatever was standing there', () => {
    const ctx = shipped();
    ctx.systems.board.newGame();
    const save = ctx.state.toSave(1000, 8);
    const crystal = save.items.find((i) => i.chain === 'crystal')!;
    // The shape a botched re-grid leaves behind: the Crystal on the board, and
    // something else parked on the ledge it belongs to.
    crystal.col = 9;
    crystal.row = 7;
    const squatter = { ...crystal, id: 9999, chain: 'flame_gem', tier: 1, col: 8, row: 11 };
    save.items.push(squatter);

    ctx.state.hydrate(save);

    expect(crystalAt(ctx)).toBe('8,11');
    const gem = ctx.state.items.get(9999);
    // Not destroyed — moved onto real ground, or banked if there was none.
    if (gem) expect(`${gem.col},${gem.row}`).not.toBe('8,11');
    else expect(ctx.state.bag.some((s) => s.chain === 'flame_gem')).toBe(true);
    expect(ctx.state.itemIdAt(8, 11)).toBe(ctx.state.items.get(crystal.id)?.id);
  });
});
