import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRecordedErrors, guard, hasRecordedErrors, recordedErrors, recordError } from '../../src/core/crash';

/**
 * The black box behind "nothing throws through the game loop".
 *
 * Phaser schedules the next frame only after the current step RETURNS, so an
 * exception escaping a scene callback ends the RAF chain: the session freezes
 * with the last frame still on screen, and every safety net written to catch
 * that — veil watchdogs, timers, taps — is dead with it.
 */
describe('the crash recorder', () => {
  beforeEach(() => clearRecordedErrors());

  it('starts clean', () => {
    expect(hasRecordedErrors()).toBe(false);
    expect(recordedErrors()).toEqual([]);
  });

  it('keeps the message and the stack', () => {
    const err = new Error('backdrop missing');
    recordError('board.create', err);
    const [rec] = recordedErrors();
    expect(rec).toMatchObject({ where: 'board.create', message: 'backdrop missing', count: 1 });
    expect(rec!.stack).toBe(err.stack);
  });

  it('counts a repeat instead of burying the first one', () => {
    // A throw inside update() is sixty a second. One entry with a count is a
    // log that can still be read.
    for (let i = 0; i < 200; i++) recordError('board.update', new Error('same'));
    expect(recordedErrors()).toHaveLength(1);
    expect(recordedErrors()[0]!.count).toBe(200);
  });

  it('tells two sites apart even with one message', () => {
    recordError('board.create', new Error('boom'));
    recordError('board.update', new Error('boom'));
    expect(recordedErrors().map((r) => r.where)).toEqual(['board.create', 'board.update']);
  });

  it('reports first occurrence first — the earliest is usually the cause', () => {
    recordError('a', new Error('1'));
    recordError('b', new Error('2'));
    recordError('a', new Error('1')); // a repeat must not reorder it
    expect(recordedErrors().map((r) => r.message)).toEqual(['1', '2']);
  });

  it('survives a thrown non-Error', () => {
    recordError('odd', 'just a string');
    recordError('odd', { code: 7 });
    expect(recordedErrors().map((r) => r.message)).toEqual(['just a string', '{"code":7}']);
  });

  describe('guard', () => {
    it('returns the value when nothing goes wrong, and records nothing', () => {
      expect(guard('x', () => 42, 0)).toBe(42);
      expect(hasRecordedErrors()).toBe(false);
    });

    it('swallows the throw, records it, and hands back the fallback', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(
        guard(
          'board.update',
          () => {
            throw new Error('bad frame');
          },
          'fallback'
        )
      ).toBe('fallback');
      expect(recordedErrors()[0]).toMatchObject({ where: 'board.update', message: 'bad frame' });
      spy.mockRestore();
    });

    it('prints only the FIRST of a repeating failure', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      for (let i = 0; i < 50; i++) {
        guard(
          'board.update',
          () => {
            throw new Error('every frame');
          },
          undefined
        );
      }
      expect(spy).toHaveBeenCalledTimes(1);
      expect(recordedErrors()[0]!.count).toBe(50);
      spy.mockRestore();
    });
  });
});
