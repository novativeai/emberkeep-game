import { describe, expect, it } from 'vitest';
import { capture, createTestContext } from './helpers';
import { GATE_LANDING } from '../../src/core/Constants';
import type { WorldRuntime } from '../../src/core/world';
import { worldPointOf, zoneAt } from '../../src/core/world';
import type { TilePos } from '../../src/core/types';

type Ctx = ReturnType<typeof createTestContext>;

/** How far a landing cell sits from its own door back, in tiles of the ground
 *  it stands on — the unit `GATE_LANDING` is stated in. */
function tilesFromDoor(world: WorldRuntime, from: string, at: TilePos): number {
  const door = world.portals.find((p) => p.to === from)!;
  const c = { x: door.x + door.width / 2, y: door.y + door.height / 2 };
  const zone = zoneAt(world, at.col, at.row)!;
  const step = (Math.hypot(zone.u.x, zone.u.y) + Math.hypot(zone.v.x, zone.v.y)) / 2;
  const p = worldPointOf(world, at.col, at.row);
  return Math.hypot(p.x - c.x, p.y - c.y) / step;
}

/** Any cell of a world, for seating a dragon somewhere other than the isle. */
function firstCell(world: WorldRuntime): TilePos {
  const [col, row] = [...world.playable][0]!.split(',').map(Number);
  return { col: col!, row: row! };
}

/** A named dragon standing on the authored isle, ready to be sent ahead. */
function namedDragon(ctx: Ctx): number {
  const item = ctx.state.addItem({ chain: 'ember_dragon', tier: 3, col: 1, row: 1, kind: 'item' });
  ctx.bus.emit('ui:dragon_named', { itemId: item.id, name: 'Ember' });
  return item.id;
}

/**
 * THE CROSSING — a dragon goes through a gate and STAYS through.
 *
 * The flourish it replaces flew into the light and back out, which says "he
 * went" and then unsays it. The whole point is that following him later finds
 * him there, and that is a claim about STATE, not about a tween: the piece
 * leaves this world's board and joins another's, keeping its identity.
 */
describe('a dragon crossing a gate', () => {
  it('leaves this board and stands on the other one, as the SAME animal', () => {
    const ctx = createTestContext();
    const itemId = namedDragon(ctx);
    const crossed = capture(ctx.bus, 'dragon:crossed');

    ctx.bus.emit('dragon:cross_gate', { itemId, to: 'roothold' });

    expect(crossed).toHaveLength(1);
    expect(crossed[0]).toMatchObject({ itemId, from: 'emberkeep', to: 'roothold' });
    // Gone from here…
    expect(ctx.state.items.has(itemId)).toBe(false);
    // …and there, with everything that makes it itself. Re-spawning would hand
    // back a stranger wearing its art — and for a NAMED dragon it would break
    // the law the naming rests on.
    const far = ctx.state.itemsIn('roothold')?.get(itemId);
    expect(far).toBeDefined();
    expect(far).toMatchObject({ id: itemId, chain: 'ember_dragon', tier: 3, dragonName: 'Ember' });
  });

  it('frees the cell it left, so the board it came from is not left with a hole', () => {
    const ctx = createTestContext();
    const itemId = namedDragon(ctx);
    ctx.bus.emit('dragon:cross_gate', { itemId, to: 'roothold' });
    // The occupancy map has to agree with the item map, or the next piece
    // dropped there is refused for a dragon that is a world away.
    expect(ctx.state.grid[1]![1]).toBeNull();
    expect(() =>
      ctx.state.addItem({ chain: 'lumber', tier: 1, col: 1, row: 1, kind: 'item' })
    ).not.toThrow();
  });

  it('comes out on ground it can stand on', () => {
    const ctx = createTestContext();
    const itemId = namedDragon(ctx);
    const crossed = capture(ctx.bus, 'dragon:crossed');
    ctx.bus.emit('dragon:cross_gate', { itemId, to: 'roothold' });
    const at = crossed[0]!.at;
    const roothold = ctx.state.worlds.get('roothold')!;
    expect(roothold.playable.has(`${at.col},${at.row}`)).toBe(true);
  });

  it('never lands on top of something already standing there', () => {
    // The far board is live even while unwatched — a crossing must not displace
    // a piece the player left in the hub.
    const ctx = createTestContext();
    const roothold = ctx.state.worlds.get('roothold')!;
    const seats = [...roothold.playable].slice(0, 4);
    ctx.state.switchWorld('roothold');
    for (const key of seats) {
      const [col, row] = key.split(',').map(Number);
      ctx.state.addItem({ chain: 'lumber', tier: 1, col: col!, row: row!, kind: 'item' });
    }
    ctx.state.switchWorld('emberkeep');

    const itemId = namedDragon(ctx);
    const crossed = capture(ctx.bus, 'dragon:crossed');
    ctx.bus.emit('dragon:cross_gate', { itemId, to: 'roothold' });
    const at = crossed[0]!.at;
    expect(seats).not.toContain(`${at.col},${at.row}`);
  });

  it('comes out a few paces clear of the arch, not standing in it', () => {
    // The picture is the point: on the door's own cell he reads as still
    // crossing. Roothold's arch used to seat him 1.78 tiles away — inside the
    // painted archway — and the fix is stated in TILES because a Roothold tile
    // is 95px and an Emberkeep one 145.
    const ctx = createTestContext();
    const itemId = namedDragon(ctx);
    const crossed = capture(ctx.bus, 'dragon:crossed');
    ctx.bus.emit('dragon:cross_gate', { itemId, to: 'roothold' });

    const roothold = ctx.state.worlds.get('roothold')!;
    const paces = tilesFromDoor(roothold, 'emberkeep', crossed[0]!.at);
    expect(paces).toBeGreaterThanOrEqual(GATE_LANDING.standoffCells);
    expect(paces).toBeLessThanOrEqual(GATE_LANDING.standoffCells + GATE_LANDING.slackCells);
  });

  it('keeps a one-cell island beside its arch rather than fling him across the sky', () => {
    // The Rune Way's door stands on a SINGLE cell: past two tiles the nearest
    // legal ground is eight away over open sky. The standoff is a preference,
    // and a door that cannot honour it keeps the old answer — otherwise the fix
    // for "he stands in the door" would reintroduce "he came out miles away".
    const ctx = createTestContext();
    const borealis = ctx.state.worlds.get('borealis')!;
    const runevault = ctx.state.worlds.get('runevault')!;
    ctx.state.switchWorld('borealis');
    const seat = firstCell(borealis);
    const item = ctx.state.addItem({ chain: 'ember_dragon', tier: 3, ...seat, kind: 'item' });
    ctx.bus.emit('ui:dragon_named', { itemId: item.id, name: 'Ember' });

    const crossed = capture(ctx.bus, 'dragon:crossed');
    ctx.bus.emit('dragon:cross_gate', { itemId: item.id, to: 'runevault' });

    expect(crossed).toHaveLength(1);
    expect(tilesFromDoor(runevault, 'borealis', crossed[0]!.at)).toBeLessThan(
      GATE_LANDING.standoffCells
    );
  });

  it('refuses a world this build does not have, and its own', () => {
    const ctx = createTestContext();
    const itemId = namedDragon(ctx);
    const crossed = capture(ctx.bus, 'dragon:crossed');
    ctx.bus.emit('dragon:cross_gate', { itemId, to: 'atlantis' });
    ctx.bus.emit('dragon:cross_gate', { itemId, to: 'emberkeep' });
    expect(crossed).toEqual([]);
    // Still here, untouched — a refused crossing is a no-op, not a half-move.
    expect(ctx.state.items.get(itemId)).toMatchObject({ col: 1, row: 1 });
  });
});
