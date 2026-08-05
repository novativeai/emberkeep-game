import { describe, expect, it } from 'vitest';
import { capture, createTestContext } from './helpers';

describe('QuestSystem', () => {
  it('exposes the MAIN teleport quest + tutorial-step sub-quests that tick with progress', () => {
    const ctx = createTestContext();
    const changes = capture(ctx.bus, 'quest:changed');
    const q = (id: string) => changes.at(-1)!.quests.find((x) => x.id === id)!;

    ctx.systems.quest.announce();
    // The teleport is the MAIN quest; each tutorial action step is a SUB quest.
    expect(q('teleport_lair').kind).toBe('main');
    expect(q('ruby_merge').kind).toBe('sub');
    expect(q('green_dragon_hatch').kind).toBe('sub');
    expect(q('teleport_lair').done).toBe(false);
    expect(q('ruby_merge').done).toBe(false);

    // Advancing the director past a step ticks its sub-quest.
    ctx.state.tutorialIndex = 99;
    ctx.systems.quest.announce();
    expect(q('ruby_merge').done).toBe(true);

    // A real world switch (the teleport) completes the MAIN quest.
    expect(q('teleport_lair').done).toBe(false);
    ctx.bus.emit('world:switched', { toWorld: 'roothold' });
    expect(q('teleport_lair').done).toBe(true);
  });
});
