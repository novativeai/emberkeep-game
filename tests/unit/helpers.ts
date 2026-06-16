import { GameContext } from '../../src/core/Context';
import type { EventBus } from '../../src/core/EventBus';
import type { EventKey, EventMap, MapData } from '../../src/core/types';
import type { StorageLike } from '../../src/systems/SaveSystem';
import map8x8 from '../fixtures/map-8x8.json';

export class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

export function createTestContext(storage: StorageLike = new MemoryStorage()): GameContext {
  // Unit tests assert against the compact 8×8 layout; the shipped map.json is
  // now the full authored 51×24 world. Inject the fixture so system tests stay
  // decoupled from level design.
  return new GameContext(storage, { map: map8x8 as unknown as MapData });
}

/** Collect every payload emitted for `event` into the returned array. */
export function capture<K extends EventKey>(bus: EventBus, event: K): EventMap[K][] {
  const seen: EventMap[K][] = [];
  bus.on(event, (payload) => seen.push(payload));
  return seen;
}

/** Convenience: id of the item at (col,row) — throws if empty. */
export function idAt(ctx: GameContext, col: number, row: number): number {
  const id = ctx.state.itemIdAt(col, row);
  if (id === null) throw new Error(`no item at ${col},${row}`);
  return id;
}

export function drag(ctx: GameContext, from: [number, number], to: [number, number]): void {
  ctx.bus.emit('drag:dropped', {
    itemId: idAt(ctx, from[0], from[1]),
    from: { col: from[0], row: from[1] },
    to: { col: to[0], row: to[1] }
  });
}
