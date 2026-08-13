import { describe, expect, it, vi } from 'vitest';
import { GameClock } from '../../src/core/GameClock';

/**
 * The clock is the one thing standing between "the player left" and "the isle
 * kept working". Its two doors — a live pause for a hidden tab, a rebase for a
 * page that was closed — are tested against a controlled wall clock, because
 * the whole point of the class is what it does with wall time it is handed.
 */
describe('GameClock', () => {
  /** Drive Date.now() by hand: these are assertions about arithmetic, not about
   *  how fast the test machine happens to run. */
  const wall = (at: number): void => {
    vi.spyOn(Date, 'now').mockReturnValue(at);
  };

  it('runs with the wall while nobody has stopped it', () => {
    const clock = new GameClock();
    wall(1_000);
    expect(clock.now()).toBe(1_000);
    wall(4_000);
    expect(clock.now()).toBe(4_000);
  });

  it('freezes on pause and resumes where it froze, not where the wall got to', () => {
    const clock = new GameClock();
    wall(1_000);
    clock.pause();
    wall(61_000); // a minute of the tab being hidden
    expect(clock.now()).toBe(1_000); // …which the game never saw
    clock.resume();
    expect(clock.now()).toBe(1_000);
    wall(64_000); // three more seconds, this time watched
    expect(clock.now()).toBe(4_000);
  });

  it('does not forgive the same absence twice', () => {
    const clock = new GameClock();
    wall(1_000);
    clock.pause();
    wall(31_000);
    clock.pause(); // a second `hidden` event mid-absence
    wall(61_000);
    clock.resume();
    // Re-stamping the freeze point would have charged the first 30s to the game.
    expect(clock.now()).toBe(1_000);
    expect(clock.paused).toBe(false);
  });

  it('rebases onto a saved instant, and keeps running from there', () => {
    const clock = new GameClock();
    wall(3_600_000); // reopened an hour after the save was written
    clock.rebaseTo(1_000);
    expect(clock.now()).toBe(1_000);
    wall(3_602_000);
    expect(clock.now()).toBe(3_000); // two watched seconds, not an hour and two
  });

  it('rebases while paused too — hidden and closed tell the same story', () => {
    const clock = new GameClock();
    wall(3_600_000);
    clock.pause();
    clock.rebaseTo(1_000);
    expect(clock.now()).toBe(1_000);
    wall(3_660_000);
    clock.resume();
    expect(clock.now()).toBe(1_000);
  });

  it('still fast-forwards on demand, paused or not (window.advanceTime)', () => {
    const clock = new GameClock();
    wall(1_000);
    clock.advance(5_000);
    expect(clock.now()).toBe(6_000);
    clock.pause();
    clock.advance(2_000);
    expect(clock.now()).toBe(8_000);
  });

  it('reset clears the freeze as well as the offset', () => {
    const clock = new GameClock();
    wall(1_000);
    clock.pause();
    clock.advance(9_000);
    clock.reset();
    expect(clock.paused).toBe(false);
    expect(clock.offset).toBe(0);
    wall(2_000);
    expect(clock.now()).toBe(2_000);
  });
});
