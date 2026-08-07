import { describe, expect, it } from 'vitest';
import { LAST_CHAPTER, StorySystem } from '../../src/systems/StorySystem';
import { LEVEL_XP } from '../../src/core/Constants';
import { capture, createTestContext } from './helpers';

/** The campaign only moves once the tutorial has handed the board over. */
function pastTutorial(ctx: ReturnType<typeof createTestContext>): void {
  ctx.state.tutorialDone = true;
}

describe('StorySystem (the chapter pointer)', () => {
  it('starts at chapter 1', () => {
    const ctx = createTestContext();
    expect(ctx.state.storyChapter).toBe(1);
  });

  it('advances to chapter 2 on the first DELIVERED order', () => {
    const ctx = createTestContext();
    pastTutorial(ctx);
    const turned = capture(ctx.bus, 'story:chapter');

    ctx.state.completedOrderIds.push('eleanor_brazier');
    ctx.bus.emit('order:completed', { orderId: 'eleanor_brazier', rewards: { coins: 0, keys: 0 } });

    expect(ctx.state.storyChapter).toBe(2);
    expect(turned.at(-1)).toEqual({ chapter: 2 });
  });

  it('does NOT advance while the tutorial still owns the board', () => {
    const ctx = createTestContext();
    ctx.state.completedOrderIds.push('eleanor_brazier');
    ctx.bus.emit('order:completed', { orderId: 'eleanor_brazier', rewards: { coins: 0, keys: 0 } });
    expect(ctx.state.storyChapter).toBe(1);
  });

  it('never advances twice for the same gate, and never skips a chapter', () => {
    const ctx = createTestContext();
    pastTutorial(ctx);
    for (let i = 0; i < 5; i++) {
      ctx.state.completedOrderIds.push(`order_${i}`);
      ctx.bus.emit('order:completed', { orderId: `order_${i}`, rewards: { coins: 0, keys: 0 } });
    }
    // Chapter 3's gate reads the Cold Nest, which does not exist yet — so the
    // campaign correctly stops at 2 rather than running ahead of its systems.
    expect(ctx.state.storyChapter).toBe(2);
  });

  it('maps chapters onto the six banter stages, two chapters per stage', () => {
    expect(StorySystem.stageFor(1)).toBe(1);
    expect(StorySystem.stageFor(2)).toBe(1);
    expect(StorySystem.stageFor(3)).toBe(2);
    expect(StorySystem.stageFor(11)).toBe(6);
    expect(StorySystem.stageFor(LAST_CHAPTER)).toBe(6);
    // Out-of-range input clamps rather than indexing off the end.
    expect(StorySystem.stageFor(0)).toBe(1);
    expect(StorySystem.stageFor(99)).toBe(6);
  });

  it('serves the banter bank for the current chapter', () => {
    const ctx = createTestContext();
    const stage1 = ctx.systems.story.orderCompleteBank();
    expect(stage1.length).toBeGreaterThan(0);

    ctx.state.storyChapter = 5; // stage 3
    const stage3 = ctx.systems.story.orderCompleteBank();
    expect(stage3.length).toBeGreaterThan(0);
    expect(stage3).not.toEqual(stage1);
  });

  it('every authored chapter has beats with a real speaker and no empty line', () => {
    const ctx = createTestContext();
    for (let ch = 1; ch <= LAST_CHAPTER; ch++) {
      const beats = ctx.systems.story.beatsFor(ch);
      if (!beats) continue;
      expect(['eleanor', 'selyna', 'golden_elder']).toContain(beats.speaker);
      expect(beats.lines.length).toBeGreaterThan(0);
      for (const line of beats.lines) {
        expect(line.trim()).not.toBe('');
        // The bubble wraps at 940px / 38px bold — roughly 180 chars over 4 lines.
        expect(line.length).toBeLessThanOrEqual(180);
      }
    }
  });

  it('survives a save/load round trip', () => {
    const ctx = createTestContext();
    ctx.state.storyChapter = 4;
    const save = ctx.state.toSave(0, 9);
    expect(save.storyChapter).toBe(4);

    const fresh = createTestContext();
    fresh.state.hydrate(save);
    expect(fresh.state.storyChapter).toBe(4);
  });

  it('an old save with no chapter field starts at 1 rather than NaN', () => {
    const ctx = createTestContext();
    const save = ctx.state.toSave(0, 9);
    delete save.storyChapter;
    ctx.state.hydrate(save);
    expect(ctx.state.storyChapter).toBe(1);
  });
});

describe('arrivals — a world speaks the first time you stand in it', () => {
  it('fires once ever, and never touches the chapter ladder', () => {
    const ctx = createTestContext();
    ctx.state.tutorialDone = true;
    ctx.state.xp = LEVEL_XP[LEVEL_XP.length - 1]!; // the cap…
    ctx.state.addStat('q:done:keepers_hoard', 1); // …and the woken Elder open Borealis
    const seen: string[] = [];
    ctx.bus.on('story:arrival', ({ worldId }) => seen.push(worldId));
    const chapters: number[] = [];
    ctx.bus.on('story:chapter', ({ chapter }) => chapters.push(chapter));

    ctx.bus.emit('world:switch', { to: 'borealis' });
    expect(seen).toEqual(['borealis']);
    // Rung 11 of the reveal ladder is NOT reachable by walking through a door:
    // an arrival is an occasion, and the campaign still stands where it stood.
    expect(chapters).toEqual([]);
    expect(ctx.state.storyChapter).toBe(1);

    // Coming back is not an arrival.
    ctx.bus.emit('world:switch', { to: 'emberkeep' });
    ctx.bus.emit('world:switch', { to: 'borealis' });
    expect(seen).toEqual(['borealis']);
  });

  it('says nothing mid-tutorial, and nothing for a world with no lines', () => {
    const ctx = createTestContext();
    const seen: string[] = [];
    ctx.bus.on('story:arrival', ({ worldId }) => seen.push(worldId));
    ctx.state.xp = LEVEL_XP[LEVEL_XP.length - 1]!;
    ctx.bus.emit('world:switch', { to: 'borealis' }); // tutorial still running
    expect(seen).toEqual([]);
    // Roothold is painted and unwritten; an arrival with nothing authored is
    // silence, not an empty bubble.
    expect(ctx.systems.story.arrivalBeats('roothold')).toBeNull();
  });
});
