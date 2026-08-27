import { describe, expect, it } from 'vitest';
import { capture, createTestContext } from './helpers';
import { GATE_LANDING } from '../../src/core/Constants';
import characters from '../../src/data/characters.json';
import type { WorldRuntime } from '../../src/core/world';
import { nearestPlayableCell, worldPointOf, zoneAt } from '../../src/core/world';
import type { CharactersData, TilePos } from '../../src/core/types';

type Ctx = ReturnType<typeof createTestContext>;

/** The door's own centre, in world px. */
function doorPoint(world: WorldRuntime, from: string): { x: number; y: number } {
  const door = world.portals.find((p) => p.to === from)!;
  return { x: door.x + door.width / 2, y: door.y + door.height / 2 };
}

/**
 * ONE TILE, taken from the ground the arch opens onto — the unit GATE_LANDING
 * is stated in, and deliberately NOT the landing cell's own.
 *
 * Measuring each candidate against its own zone is the bug this pins: Eleanor's
 * slab has 89px tiles against the plaza's 95.6, so it cleared a four-tile bar
 * at 357 real px and won the sweep for being nearest. A test that re-derived
 * the unit from the landing cell would have agreed with the defect.
 */
function doorTile(world: WorldRuntime, from: string): number {
  const c = doorPoint(world, from);
  const anchor = nearestPlayableCell(world, c.x, c.y)!;
  const zone = zoneAt(world, anchor.col, anchor.row)!;
  return (Math.hypot(zone.u.x, zone.u.y) + Math.hypot(zone.v.x, zone.v.y)) / 2;
}

/** How far it sits from the NEAREST authored standee, in the same unit. */
function tilesFromFolk(world: WorldRuntime, from: string, at: TilePos): number {
  const people = (characters as unknown as CharactersData).characters.filter(
    (c) => c.world === world.id
  );
  if (!people.length) return Infinity;
  const p = worldPointOf(world, at.col, at.row);
  const unit = doorTile(world, from);
  return Math.min(
    ...people.map((c) => {
      const f = worldPointOf(world, c.anchor[0], c.anchor[1]);
      return Math.hypot(p.x - f.x, p.y - f.y) / unit;
    })
  );
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

  /** NEVER UNDER THE CLOUDS (owner's report, 2026-08-27): a fresh Borealis is
   *  mostly authored fog — only the shore's region is active — and a landing
   *  under a cloud puts the dragon on ground the player cannot tap through.
   *  The landing predicate now requires the cell's region to be ACTIVE. */
  it('never lands inside a fogged region on the far world', () => {
    const ctx = createTestContext();
    const borealis = ctx.state.worlds.get('borealis')!;
    const itemId = namedDragon(ctx);
    const crossed = capture(ctx.bus, 'dragon:crossed');
    ctx.bus.emit('dragon:cross_gate', { itemId, to: 'borealis' });
    expect(crossed).toHaveLength(1);
    const at = crossed[0]!.at;
    expect(borealis.playable.has(`${at.col},${at.row}`)).toBe(true);
    const region = borealis.tileRegion.get(`${at.col},${at.row}`);
    if (region !== undefined) {
      expect(ctx.state.regionStatus.get(region), `landed in ${region}`).toBe('active');
    }
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

  it('is RECEIVED: it comes out beside the innkeeper, never left at the arch', () => {
    // The owner's landing law (the production line's): somebody LIVES on the
    // far side, and a dragon sent ahead is received, not left on the doorstep
    // — following it through finds the two of them together. Beside her means
    // at least residentCells of HER OWN tiles (clear of her two-cell slab,
    // whose far half sits 1.26 tiles out) and still close: this replaced a
    // four-to-six-tile arch standoff the owner read as "he arrives too far
    // from Eleanor".
    const ctx = createTestContext();
    const itemId = namedDragon(ctx);
    const crossed = capture(ctx.bus, 'dragon:crossed');
    ctx.bus.emit('dragon:cross_gate', { itemId, to: 'roothold' });

    const roothold = ctx.state.worlds.get('roothold')!;
    const d = tilesFromFolk(roothold, 'emberkeep', crossed[0]!.at);
    expect(d).toBeGreaterThanOrEqual(GATE_LANDING.residentCells);
    expect(d).toBeLessThanOrEqual(GATE_LANDING.residentCells + 2);
  });

  it('receives beside its OWN resident on the Rune Way too, tiny island or not', () => {
    // The Runevault authors Selyna at the hearth; a crossing seats beside her
    // rather than at the arch, and never on top of her slab.
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
    expect(tilesFromFolk(runevault, 'borealis', crossed[0]!.at)).toBeGreaterThanOrEqual(
      GATE_LANDING.residentCells
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
