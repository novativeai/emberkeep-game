import { describe, expect, it } from 'vitest';
import { EMBERFONT } from '../../src/core/Constants';
import type { EventMap } from '../../src/core/types';
import { capture, createTestContext } from './helpers';

/** A minimal item:merged payload — EmberfontSystem only reacts to the event. */
function merge(): EventMap['item:merged'] {
  return {
    chain: 'flame_gem',
    fromTier: 1,
    resultTier: 2,
    at: { col: 0, row: 0 },
    consumedIds: [],
    consumedAt: [],
    outputs: [],
    xp: 0
  };
}

describe('EmberfontSystem (Spark Well)', () => {
  it('tapping a woken well spends a Spark and drops a vein piece', () => {
    const ctx = createTestContext();
    ctx.state.tutorialDone = true;
    const spawned = capture(ctx.bus, 'item:spawned');
    const sparked = capture(ctx.bus, 'emberfont:sparked');
    const changed = capture(ctx.bus, 'emberfont:changed');

    expect(ctx.state.emberSparks).toBe(EMBERFONT.startSparks);
    const itemsBefore = ctx.state.items.size;
    ctx.bus.emit('emberfont:tap', {});

    expect(ctx.state.emberSparks).toBe(EMBERFONT.startSparks - 1);
    expect(ctx.state.items.size).toBe(itemsBefore + 1);
    const drop = spawned.at(-1)!;
    expect(drop.cause).toBe('generator');
    expect(drop.item.tier).toBe(1);
    expect(['flame_gem', 'ember_dragon', 'emerald', 'lumber']).toContain(drop.item.chain);
    // The drop landed on an ACTIVE tile.
    expect(ctx.state.isTileActive(drop.item.col, drop.item.row)).toBe(true);
    expect(sparked).toHaveLength(1);
    expect(changed.at(-1)!.sparks).toBe(EMBERFONT.startSparks - 1);
    expect(changed.at(-1)!.active).toBe(true);
  });

  it('is dormant until the tutorial is done — tapping does nothing', () => {
    const ctx = createTestContext(); // tutorialDone defaults to false
    const spawned = capture(ctx.bus, 'item:spawned');

    ctx.bus.emit('emberfont:tap', {});

    expect(spawned).toHaveLength(0);
    expect(ctx.state.emberSparks).toBe(EMBERFONT.startSparks);
  });

  it('does not spend a Spark when there is nowhere to drop', () => {
    const ctx = createTestContext();
    ctx.state.tutorialDone = true;
    // Fill every active tile so pickDropCell finds nothing.
    for (let r = 0; r < ctx.state.rows; r++) {
      for (let c = 0; c < ctx.state.cols; c++) {
        if (ctx.state.isTileActive(c, r) && ctx.state.itemIdAt(c, r) === null) {
          ctx.state.addItem({ chain: 'flame_gem', tier: 1, col: c, row: r, kind: 'item' });
        }
      }
    }
    const spawned = capture(ctx.bus, 'item:spawned');
    ctx.bus.emit('emberfont:tap', {});

    expect(spawned).toHaveLength(0);
    expect(ctx.state.emberSparks).toBe(EMBERFONT.startSparks); // Spark kept
  });

  it('Sparks trickle back over time, capped at the max', () => {
    const ctx = createTestContext();
    ctx.state.emberSparks = 0;
    ctx.state.emberSparkAt = ctx.clock.now();

    ctx.clock.advance(EMBERFONT.rechargeMs * 2 + 10);
    ctx.bus.emit('time:advanced', { ms: EMBERFONT.rechargeMs * 2 });
    expect(ctx.state.emberSparks).toBe(2);

    ctx.clock.advance(EMBERFONT.rechargeMs * 20);
    ctx.bus.emit('time:advanced', { ms: EMBERFONT.rechargeMs * 20 });
    expect(ctx.state.emberSparks).toBe(EMBERFONT.maxSparks); // capped
  });

  it('merging stokes the well; a full bar ignites a Surge that pays bonus XP', () => {
    const ctx = createTestContext();
    ctx.state.tutorialDone = true;
    const surges = capture(ctx.bus, 'emberfont:surge');
    const economy = capture(ctx.bus, 'economy:add');

    const need = Math.ceil(EMBERFONT.stokeMax / EMBERFONT.stokePerMerge);
    for (let i = 0; i < need; i++) ctx.bus.emit('item:merged', merge());

    expect(surges.at(-1)).toMatchObject({ active: true });
    expect(ctx.state.emberSurgeUntil).toBeGreaterThan(ctx.clock.now());
    expect(ctx.state.emberStoke).toBe(0); // spent into the surge

    // A merge DURING the Surge grants the XP bonus.
    ctx.bus.emit('item:merged', merge());
    expect(economy.some((e) => e.xp === EMBERFONT.surgeXpBonus && e.reason === 'emberfont_surge')).toBe(true);
  });

  it('a Surge recharges Sparks far faster, then expires back to idle', () => {
    const ctx = createTestContext();
    ctx.state.tutorialDone = true;
    const surges = capture(ctx.bus, 'emberfont:surge');
    const need = Math.ceil(EMBERFONT.stokeMax / EMBERFONT.stokePerMerge);
    for (let i = 0; i < need; i++) ctx.bus.emit('item:merged', merge());

    // Fast drip: one Spark per surgeRechargeMs (< the idle rechargeMs).
    ctx.state.emberSparks = 0;
    ctx.state.emberSparkAt = ctx.clock.now();
    ctx.clock.advance(EMBERFONT.surgeRechargeMs + 5);
    ctx.systems.emberfont.catchUp(ctx.clock.now());
    expect(ctx.state.emberSparks).toBe(1);

    // Let the Surge window close.
    ctx.clock.advance(EMBERFONT.surgeMs);
    ctx.systems.emberfont.catchUp(ctx.clock.now());
    expect(ctx.state.emberSurgeUntil).toBe(0);
    expect(surges.at(-1)).toMatchObject({ active: false });
  });

  it('credits Sparks across a Surge boundary — an offline gap fills the well, not empties it', () => {
    const ctx = createTestContext();
    ctx.state.tutorialDone = true;
    const need = Math.ceil(EMBERFONT.stokeMax / EMBERFONT.stokePerMerge);
    for (let i = 0; i < need; i++) ctx.bus.emit('item:merged', merge()); // ignite a Surge
    expect(ctx.state.emberSurgeUntil).toBeGreaterThan(ctx.clock.now());

    ctx.state.emberSparks = 0; // leave mid-Surge with an empty well
    // A long gap that straddles the Surge boundary (offline / advanceTime).
    ctx.clock.advance(EMBERFONT.surgeMs + EMBERFONT.rechargeMs * 30);
    ctx.systems.emberfont.catchUp(ctx.clock.now());

    expect(ctx.state.emberSurgeUntil).toBe(0); // Surge closed
    expect(ctx.state.emberSparks).toBe(EMBERFONT.maxSparks); // FULL, not discarded to 0
  });

  it('idle Stoke cools off over time', () => {
    const ctx = createTestContext();
    ctx.state.tutorialDone = true;
    ctx.bus.emit('item:merged', merge());
    ctx.bus.emit('item:merged', merge());
    expect(ctx.state.emberStoke).toBe(EMBERFONT.stokePerMerge * 2);

    ctx.clock.advance(EMBERFONT.stokeDecayMs * 3 + 5);
    ctx.systems.emberfont.catchUp(ctx.clock.now());
    expect(ctx.state.emberStoke).toBe(EMBERFONT.stokePerMerge * 2 - EMBERFONT.stokeDecayPerTick * 3);
  });

  it('persists across save/load and seeds cleanly from a pre-Emberfont save', () => {
    const ctx = createTestContext();
    ctx.state.emberSparks = 2;
    ctx.state.emberStoke = 60;
    ctx.state.emberVeinIndex = 3;
    ctx.state.emberSurgeUntil = 12_345;
    const save = ctx.state.toSave(1000, 6);

    const ctx2 = createTestContext();
    ctx2.state.hydrate(save);
    expect(ctx2.state.emberSparks).toBe(2);
    expect(ctx2.state.emberStoke).toBe(60);
    expect(ctx2.state.emberVeinIndex).toBe(3);
    expect(ctx2.state.emberSurgeUntil).toBe(12_345);

    // A legacy save with no emberfontProgress seeds the defaults.
    const legacy = { ...save };
    delete (legacy as { emberfontProgress?: unknown }).emberfontProgress;
    const ctx3 = createTestContext();
    ctx3.state.hydrate(legacy);
    expect(ctx3.state.emberSparks).toBe(EMBERFONT.startSparks);
    expect(ctx3.state.emberStoke).toBe(0);
  });
});
