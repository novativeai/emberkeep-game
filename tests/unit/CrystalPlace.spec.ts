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
