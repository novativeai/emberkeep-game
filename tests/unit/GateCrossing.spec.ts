import { describe, expect, it } from 'vitest';
import { capture, createTestContext } from './helpers';

type Ctx = ReturnType<typeof createTestContext>;

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
