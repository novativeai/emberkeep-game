import { describe, expect, it } from 'vitest';
import { capture, createTestContext } from './helpers';

describe('dragon passive generation (the standing advantage)', () => {
  it('a hatchling gifts a Gem Shard once its passiveMs elapses — free, no tap', () => {
    const ctx = createTestContext();
    ctx.systems.board.spawn('ember_dragon', 2, 2, 2, 'init'); // a generator on an active tile
    const produced = capture(ctx.bus, 'item:produced');
    const energyBefore = ctx.state.energyCurrent;

    // First tick only arms the timer; nothing is produced yet.
    ctx.bus.emit('time:advanced', { ms: 0 });
    expect(produced).toHaveLength(0);

    // Cross the 120s passive interval.
    ctx.clock.advance(120_001);
    ctx.bus.emit('time:advanced', { ms: 120_001 });

    expect(produced).toHaveLength(1);
    expect(produced[0]!.output).toMatchObject({ chain: 'flame_gem', tier: 1 });
    expect(ctx.state.energyCurrent).toBe(energyBefore); // passive costs no Warmth
    expect(ctx.state.countItems('flame_gem', 1)).toBe(1);
  });

  it('does not flood after a long jump: at most one gift per tick', () => {
    const ctx = createTestContext();
    ctx.systems.board.spawn('ember_dragon', 2, 2, 2, 'init');
    const produced = capture(ctx.bus, 'item:produced');
    ctx.bus.emit('time:advanced', { ms: 0 }); // arm

    ctx.clock.advance(600_000); // five intervals at once
    ctx.bus.emit('time:advanced', { ms: 600_000 });
    expect(produced).toHaveLength(1); // not five

    // A tick immediately after (timer just reset) produces nothing.
    ctx.bus.emit('time:advanced', { ms: 0 });
    expect(produced).toHaveLength(1);
  });

  it('a plain item (no generator) never produces passively', () => {
    const ctx = createTestContext();
    ctx.systems.board.spawn('sparkweed', 1, 2, 2, 'init');
    const produced = capture(ctx.bus, 'item:produced');
    ctx.bus.emit('time:advanced', { ms: 0 });
    ctx.clock.advance(300_000);
    ctx.bus.emit('time:advanced', { ms: 300_000 });
    expect(produced).toHaveLength(0);
  });
});
