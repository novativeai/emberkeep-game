/**
 * Virtual clock. All gameplay timers (energy regen, generator cooldowns)
 * read GameClock.now() instead of Date.now() so that window.advanceTime(ms)
 * can deterministically fast-forward them.
 */
export class GameClock {
  private offsetMs = 0;

  now(): number {
    return Date.now() + this.offsetMs;
  }

  advance(ms: number): void {
    this.offsetMs += Math.max(0, ms);
  }

  get offset(): number {
    return this.offsetMs;
  }

  reset(): void {
    this.offsetMs = 0;
  }
}
