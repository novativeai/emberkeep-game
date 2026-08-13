/**
 * Virtual clock. All gameplay timers (energy regen, generator cooldowns)
 * read GameClock.now() instead of Date.now() so that window.advanceTime(ms)
 * can deterministically fast-forward them.
 *
 * THE GAME ONLY RUNS WHILE SOMEONE IS WATCHING IT.
 *
 * `Date.now()` is the wall, and the wall does not care whether the tab is open.
 * A clock that only ever added it meant the isle kept working for a player who
 * had closed it: producers paid out into a board nobody was looking at, dragons
 * grew hungry, the day rolled from dusk to night, and the dev server running in
 * another window was enough to make an hour of "play" happen while its author
 * was elsewhere. So this clock can be STOPPED, and time that passes while it is
 * stopped is not time the game had — it is subtracted rather than remembered.
 *
 * Two doors, because leaving happens two ways:
 *   - `pause`/`resume` — the page is still alive but hidden (another tab, a
 *     minimised window). The away span is deducted on the way back in.
 *   - `rebaseTo` — the page was closed and reopened, so there is no live clock
 *     to deduct from; the save's own timestamp becomes the present instead.
 *
 * Both keep now() MONOTONIC: it never runs backwards, it only declines to
 * advance. Everything downstream — cooldowns, regen, the day phase — is written
 * against absolute instants from this clock, so freezing the clock freezes all
 * of it without a single one of them knowing this exists.
 */
export class GameClock {
  private offsetMs = 0;
  /** Wall time at which the clock was stopped, or null while it runs. */
  private pausedAt: number | null = null;

  now(): number {
    return (this.pausedAt ?? Date.now()) + this.offsetMs;
  }

  advance(ms: number): void {
    this.offsetMs += Math.max(0, ms);
  }

  /** Stop time. Idempotent — a second `hidden` event must not re-stamp the
   *  freeze point, or the first stretch of absence would be forgiven twice. */
  pause(): void {
    if (this.pausedAt === null) this.pausedAt = Date.now();
  }

  /** Start time again exactly where it stopped: the away span is taken out of
   *  the offset, so `now()` continues from the frozen reading rather than
   *  jumping to catch the wall up. */
  resume(): void {
    if (this.pausedAt === null) return;
    this.offsetMs -= Date.now() - this.pausedAt;
    this.pausedAt = null;
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  /**
   * Make `now()` read exactly `at`.
   *
   * Used by the load: a session resumes at the instant it was SAVED, not the
   * instant it was reopened, so the gap in between never existed as far as the
   * game is concerned. It is deliberately the only lever that moves the clock
   * backwards, and it moves it to a value the game itself wrote.
   */
  rebaseTo(at: number): void {
    this.offsetMs += at - this.now();
  }

  get offset(): number {
    return this.offsetMs;
  }

  reset(): void {
    this.offsetMs = 0;
    this.pausedAt = null;
  }
}
