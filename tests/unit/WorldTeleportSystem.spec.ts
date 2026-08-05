import { describe, expect, it } from 'vitest';
import { WORLD_TELEPORT } from '../../src/core/Constants';
import type { EventBus } from '../../src/core/EventBus';
import { capture, createTestContext } from './helpers';

/** A minimal-but-valid item:hatched payload for a given dragon chain. */
function hatch(bus: EventBus, chain: string): void {
  bus.emit('item:hatched', { item: { id: 1, chain, tier: 3, col: 4, row: 5, kind: 'item' } });
}

describe('WorldTeleportSystem', () => {
  it('emits world:teleport exactly once, when the whole tutorial checklist is finished', () => {
    expect(WORLD_TELEPORT.trigger).toBe('tutorial_done');
    const ctx = createTestContext(); // registers the WorldTeleportSystem
    const fired = capture(ctx.bus, 'world:teleport');

    // Hatching the dragon no longer teleports — the full tutorial must finish first.
    hatch(ctx.bus, WORLD_TELEPORT.dragonChain);
    expect(fired).toHaveLength(0);

    // The tutorial completes → fire once, carrying the target world + dragon.
    ctx.bus.emit('tutorial:done', {});
    expect(fired).toHaveLength(1);
    expect(fired[0]!.toWorld).toBe(WORLD_TELEPORT.toWorld);
    expect(fired[0]!.dragonChain).toBe(WORLD_TELEPORT.dragonChain);

    // A second completion signal never re-fires it.
    ctx.bus.emit('tutorial:done', {});
    expect(fired).toHaveLength(1);
  });
});
