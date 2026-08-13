/**
 * ONE DOOR ONTO A SCENE'S LOADER.
 *
 * A Phaser scene has exactly one LoaderPlugin, and every `load.image()` in the
 * scene shares it. The idiom each caller reaches for —
 *
 *     load.image(...); load.once(COMPLETE, done); load.start();
 *
 * is safe alone and treacherous in company, because `start()` returns silently
 * when the loader is already running and `COMPLETE` is broadcast to EVERY
 * listener at once. So two callers overlapping get each other's callbacks: a
 * fetch that queued nothing is told its files are resident, a fetch still in
 * flight is torn down by the other's `scene.restart()`, and the queue can be
 * left with files pending and nothing in flight — which is a loader that never
 * emits COMPLETE again, and every later load waiting behind it forever.
 *
 * BoardScene had four such doors (the world's art at a portal, a breed's clip
 * sheets, the Elder's, and the rigs) firing on four unrelated schedules — a
 * portal tap, a merge, a dragon getting hungry, a scene boot. Overlap was a
 * matter of timing rather than of logic, which is why it showed up as "travel
 * hangs on the veil, sometimes".
 *
 * This is the fix, and it is a queue rather than a lock because the callers
 * genuinely all need to run: one batch has the loader to itself from the moment
 * it queues its first file until its own COMPLETE, and the next batch starts
 * after. Nothing is dropped and nothing overlaps.
 */

/** The sliver of `Phaser.Loader.LoaderPlugin` this needs — declared so the
 *  queue's behaviour can be unit-tested in node, like every other rule. */
export interface QueueableLoader {
  /** True when the loader is idle or finished — i.e. safe to hand files to. */
  isReady(): boolean;
  once(event: string, fn: () => void): void;
  start(): void;
}

/** Phaser's `Loader.Events.COMPLETE`, as a string so node needs no Phaser. */
const COMPLETE = 'complete';

interface Job {
  /** Queue the files. May queue none — the callback still fires. */
  add: () => void;
  done: () => void;
}

export class LoadQueue {
  private readonly jobs: Job[] = [];
  private busy = false;
  /** Set while waiting on a COMPLETE we did not start, so the wait is armed
   *  once rather than once per queued job. */
  private waiting = false;
  /** Bumped by `reset`, so work outstanding from the previous board can tell
   *  that the queue it is about to touch is no longer the one it started on. */
  private era = 0;

  constructor(private readonly loader: QueueableLoader) {}

  /**
   * Queue files and be told when they are resident.
   *
   * `add` is not called until the loader is free, so it must not capture a
   * decision that could go stale — check `textures.exists` INSIDE it, not
   * before. `done` fires exactly once, even when `add` queued nothing (an
   * empty batch completes immediately), so callers need no already-loaded
   * branch.
   */
  run(add: () => void, done: () => void = (): void => {}): void {
    this.jobs.push({ add, done });
    this.pump();
  }

  /**
   * Give an existing add/once/start routine — `RigPlayer.loadTextures` is the
   * one that matters — the loader to itself. It keeps its own callback; the
   * queue only guarantees nobody else is mid-run while it works, and waits for
   * its promise before releasing the next batch.
   */
  async runExclusive(fn: () => Promise<void>): Promise<void> {
    await new Promise<void>((resolve) => this.run(() => {}, resolve));
    // The empty batch above completed, so the loader is idle and ours until
    // `fn` resolves — which it does on its own COMPLETE.
    const era = this.era;
    this.busy = true;
    try {
      await fn();
    } finally {
      // …unless the scene went away while we waited, in which case the queue
      // has already been handed to a new board and this hold is not ours to
      // release. `fn`'s own COMPLETE died with the old loader, so without this
      // a torn-down rig fetch would clear a lock it no longer owns.
      if (era === this.era) {
        this.busy = false;
        this.pump();
      }
    }
  }

  /** How many batches are waiting. For assertions and diagnostics. */
  get depth(): number {
    return this.jobs.length;
  }

  /**
   * Forget everything — THE SCENE IS GONE.
   *
   * Phaser reuses a scene INSTANCE across `scene.restart()`, so this queue
   * outlives the board that owns it, while the LoaderPlugin under it is reset
   * and every pending `once(COMPLETE)` is thrown away with it. A queue that was
   * mid-batch when that happened would sit `busy` on a completion that can
   * never arrive, and everything asked of it afterwards would join a line that
   * never moves — which is a board that never rebuilds and a travelling veil
   * that never lifts. Travelling twice was enough to do it: the first journey
   * restarted the scene, the second queued behind the corpse.
   *
   * Dropping the pending batches is right rather than merely expedient. They
   * were asked for by the board being torn down; the one being built asks
   * again for whatever it actually needs.
   */
  reset(): void {
    this.jobs.length = 0;
    this.busy = false;
    this.waiting = false;
    this.era++;
  }

  private pump(): void {
    if (this.busy || !this.jobs.length) return;
    if (!this.loader.isReady()) {
      // Someone is mid-run. Every run ends in a COMPLETE, so that is the signal
      // — no polling, and no timeout that would let two batches overlap after
      // all, which is the very thing this exists to prevent.
      if (this.waiting) return;
      this.waiting = true;
      this.loader.once(COMPLETE, () => {
        this.waiting = false;
        this.pump();
      });
      return;
    }
    const job = this.jobs.shift()!;
    this.busy = true;
    // Registered BEFORE `add`/`start`, because a batch that queues nothing
    // makes `start()` emit COMPLETE synchronously inside itself.
    this.loader.once(COMPLETE, () => {
      this.busy = false;
      job.done();
      this.pump();
    });
    job.add();
    this.loader.start();
  }
}
