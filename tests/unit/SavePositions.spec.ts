import { describe, expect, it } from 'vitest';
import { createTestContext, MemoryStorage } from './helpers';

type Ctx = ReturnType<typeof createTestContext>;

/** Every piece on every world's board, as `id → world/chain/tier@col,row`. */
function layout(ctx: Ctx): Record<number, string> {
  const out: Record<number, string> = {};
  for (const worldId of ctx.state.worlds.keys()) {
    for (const item of ctx.state.itemsIn(worldId)?.values() ?? []) {
      out[item.id] = `${worldId}/${item.chain}:${item.tier}@${item.col},${item.row}`;
    }
  }
  return out;
}

/**
 * A REJOIN puts every piece back exactly where it was left.
 *
 * This is not a nicety. A merge board is a spatial puzzle the player arranges
 * deliberately — a row lined up for a merge, a generator parked out of the way
 * — and a piece that has moved itself overnight is indistinguishable from one
 * the game lost. `placeByMapPoint` exists to rescue positions when the world is
 * re-gridded UNDER a save; on an ordinary reload, where the grid is unchanged,
 * it must not run at all and nothing may shift by a single cell.
 */
describe('rejoin puts the board back exactly as it was left', () => {
  it('an ordinary reload moves nothing — same cells, same ids, no relocations', () => {
    const storage = new MemoryStorage();
    const ctx1 = createTestContext(storage);
    ctx1.beginRun();
    const before = layout(ctx1);
    expect(Object.keys(before).length).toBeGreaterThan(0);
    ctx1.systems.save.save();

    const ctx2 = createTestContext(storage);
    expect(ctx2.systems.save.load()).toBe(true);
    expect(layout(ctx2)).toEqual(before);
  });

  it('the saved grid signature matches the live world, so the fast path is taken', () => {
    // The signature is what decides between "trust the cells" and "recover from
    // art positions". If it ever fails to match on an unchanged build, every
    // reload silently runs the recovery — which resolves to the NEAREST usable
    // cell and is exactly how a board drifts a tile at a time.
    const storage = new MemoryStorage();
    const ctx1 = createTestContext(storage);
    ctx1.beginRun();
    ctx1.systems.save.save();

    const raw = JSON.parse(storage.getItem('emberkeep:save') ?? '{}') as {
      worlds?: Record<string, { mapSignature?: string }>;
      mapSignature?: string;
    };
    const ctx2 = createTestContext(storage);
    ctx2.systems.save.load();
    for (const [worldId, saved] of Object.entries(raw.worlds ?? {})) {
      if (saved.mapSignature === undefined) continue;
      const live = ctx2.state.worlds.get(worldId);
      expect(saved.mapSignature, `${worldId} signature drifted between runs`).toBe(live?.signature);
    }
  });

  it('survives a reload after pieces have been moved and merged', () => {
    const storage = new MemoryStorage();
    const ctx1 = createTestContext(storage);
    ctx1.beginRun();
    // Shuffle the board the way a player would before walking away.
    const movable = [...ctx1.state.items.values()].filter((i) => i.kind === 'item').slice(0, 3);
    for (const item of movable) {
      const free = ctx1.state.freeActiveTilesNear(item.col, item.row)[0];
      if (free) ctx1.state.moveItem(item.id, free);
    }
    const before = layout(ctx1);
    ctx1.systems.save.save();

    const ctx2 = createTestContext(storage);
    expect(ctx2.systems.save.load()).toBe(true);
    expect(layout(ctx2)).toEqual(before);
  });
});

describe('rejoin after time away', () => {
  it('an offline gap never MOVES a piece that was already on the board', () => {
    // The real rejoin: hours pass with the tab closed. Offline banking pays out
    // on load and may ADD produce, but nothing the player arranged may shift.
    const storage = new MemoryStorage();
    const ctx1 = createTestContext(storage);
    ctx1.beginRun();
    ctx1.state.tutorialDone = true;
    const before = layout(ctx1);
    ctx1.systems.save.save();

    const ctx2 = createTestContext(storage);
    ctx2.clock.advance(6 * 60 * 60 * 1000); // six hours away
    expect(ctx2.systems.save.load()).toBe(true);
    const after = layout(ctx2);
    for (const [id, where] of Object.entries(before)) {
      expect(after[Number(id)], `item ${id} moved or vanished over the gap`).toBe(where);
    }
  });
});
