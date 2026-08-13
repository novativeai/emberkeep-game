import { describe, expect, it } from 'vitest';
import { LoadQueue, type QueueableLoader } from '../../src/core/LoadQueue';

/**
 * A loader with Phaser's actual manners: `start()` is a silent no-op while a
 * run is in flight, an empty batch completes synchronously inside `start()`,
 * and COMPLETE is broadcast to every listener at once.
 */
class FakeLoader implements QueueableLoader {
  files: string[] = [];
  loading = false;
  /** Files handed over across the whole life of the loader, per run. */
  runs: string[][] = [];
  private listeners: (() => void)[] = [];

  isReady(): boolean {
    return !this.loading;
  }

  once(_event: string, fn: () => void): void {
    this.listeners.push(fn);
  }

  add(file: string): void {
    this.files.push(file);
  }

  /** Files handed to the run currently in flight — Phaser's `inflight`. */
  private flight: string[] = [];

  start(): void {
    if (this.loading) return; // Phaser: `start()` while running does nothing
    if (!this.files.length) {
      this.runs.push([]);
      this.fire();
      return;
    }
    this.flight = this.files;
    this.files = [];
    this.loading = true;
  }

  /** Finish the run in flight, as the browser would a frame or two later. */
  finish(): void {
    if (!this.loading) throw new Error('nothing in flight');
    this.runs.push(this.flight);
    this.flight = [];
    this.loading = false;
    this.fire();
  }

  private fire(): void {
    const ls = this.listeners;
    this.listeners = [];
    for (const l of ls) l();
  }
}

describe('LoadQueue', () => {
  it('runs a lone batch and reports it resident', () => {
    const loader = new FakeLoader();
    const q = new LoadQueue(loader);
    let done = false;
    q.run(() => loader.add('a.webp'), () => (done = true));
    expect(done).toBe(false);
    loader.finish();
    expect(done).toBe(true);
    expect(loader.runs).toEqual([['a.webp']]);
  });

  it('completes a batch that queues nothing, so callers need no resident branch', () => {
    const loader = new FakeLoader();
    const q = new LoadQueue(loader);
    let done = false;
    q.run(() => {}, () => (done = true));
    expect(done).toBe(true); // synchronously, exactly as Phaser does it
  });

  it('never lets two batches share a run', () => {
    const loader = new FakeLoader();
    const q = new LoadQueue(loader);
    const order: string[] = [];
    q.run(() => loader.add('world.webp'), () => order.push('world'));
    // The second batch arrives mid-flight — the case that used to hand it the
    // first batch's COMPLETE and drop its files on the floor.
    q.run(() => loader.add('dragon.webp'), () => order.push('dragon'));
    expect(loader.files).toEqual([]); // 'dragon.webp' was NOT poured onto the run
    loader.finish();
    expect(order).toEqual(['world']);
    expect(loader.runs).toEqual([['world.webp']]);
    loader.finish();
    expect(order).toEqual(['world', 'dragon']);
    expect(loader.runs).toEqual([['world.webp'], ['dragon.webp']]);
  });

  it('waits behind a run somebody else started', () => {
    const loader = new FakeLoader();
    loader.add('rig.png');
    loader.start(); // a pre-queue caller, mid-flight
    const q = new LoadQueue(loader);
    let done = false;
    q.run(() => loader.add('late.webp'), () => (done = true));
    expect(loader.files).toEqual([]); // nothing added onto a foreign run
    loader.finish();
    expect(loader.runs).toEqual([['rig.png']]); // the stranger's run, alone
    loader.finish();
    expect(done).toBe(true);
    expect(loader.runs).toEqual([['rig.png'], ['late.webp']]);
  });

  it('arms the wait once however many batches pile up behind it', () => {
    const loader = new FakeLoader();
    loader.add('rig.png');
    loader.start();
    const q = new LoadQueue(loader);
    const order: string[] = [];
    q.run(() => loader.add('a'), () => order.push('a'));
    q.run(() => loader.add('b'), () => order.push('b'));
    q.run(() => loader.add('c'), () => order.push('c'));
    expect(q.depth).toBe(3);
    loader.finish(); // the foreign run ends and 'a' takes the loader
    loader.finish();
    loader.finish();
    loader.finish();
    expect(order).toEqual(['a', 'b', 'c']);
    expect(loader.runs).toEqual([['rig.png'], ['a'], ['b'], ['c']]);
  });

  it('lets a callback queue more work without re-entering the loader', () => {
    const loader = new FakeLoader();
    const q = new LoadQueue(loader);
    const order: string[] = [];
    q.run(
      () => loader.add('first'),
      () => {
        order.push('first');
        q.run(() => loader.add('second'), () => order.push('second'));
      }
    );
    loader.finish();
    expect(order).toEqual(['first']);
    loader.finish();
    expect(order).toEqual(['first', 'second']);
  });

  it('gives an add/once/start routine of its own the loader exclusively', async () => {
    const loader = new FakeLoader();
    const q = new LoadQueue(loader);
    const order: string[] = [];
    // A RigPlayer-shaped caller: it queues and starts on its own and resolves
    // on its own COMPLETE.
    const rig = q.runExclusive(
      () =>
        new Promise<void>((resolve) => {
          loader.add('rig.png');
          loader.once('complete', () => {
            order.push('rig');
            resolve();
          });
          loader.start();
        })
    );
    await Promise.resolve();
    q.run(() => loader.add('after'), () => order.push('after'));
    expect(loader.files).toEqual([]); // the batch waited its turn
    loader.finish();
    await rig;
    expect(order).toEqual(['rig']);
    loader.finish();
    expect(order).toEqual(['rig', 'after']);
  });
});
