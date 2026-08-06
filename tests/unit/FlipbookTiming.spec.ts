import { describe, expect, it } from 'vitest';
import {
  flipbookDurationMs,
  flipbookErosion,
  flipbookFrameAt
} from '../../src/render/flipbookTiming';

/**
 * The motion-vector flipbook's frame maths. Kept Phaser-free precisely so it can
 * be pinned here: the shader is only as correct as the (a, b, t) triple it is
 * handed, and an off-by-one at the loop seam or a t that runs backwards is
 * invisible in a screenshot but obvious as a stutter in motion.
 */
describe('flipbookTiming', () => {
  describe('flipbookDurationMs', () => {
    it('is frames / fps', () => {
      expect(flipbookDurationMs(16, 16)).toBe(1000);
      expect(flipbookDurationMs(32, 16)).toBe(2000);
      expect(flipbookDurationMs(12, 24)).toBe(500);
    });

    it('never divides by zero', () => {
      expect(Number.isFinite(flipbookDurationMs(16, 0))).toBe(true);
      expect(flipbookDurationMs(0, 24)).toBeGreaterThan(0);
    });
  });

  describe('looping sheets', () => {
    it('starts on frame 0 with no blend', () => {
      expect(flipbookFrameAt(0, 16, 16, true)).toEqual({ a: 0, b: 1, t: 0, done: false });
    });

    it('walks forward one frame at a time', () => {
      const f = flipbookFrameAt(1000 / 16 * 3, 16, 16, true);
      expect(f.a).toBe(3);
      expect(f.b).toBe(4);
      expect(f.t).toBeCloseTo(0, 5);
    });

    it('reports the half-way point as t = 0.5 between neighbours', () => {
      const f = flipbookFrameAt(1000 / 16 * 2.5, 16, 16, true);
      expect(f.a).toBe(2);
      expect(f.b).toBe(3);
      expect(f.t).toBeCloseTo(0.5, 5);
    });

    it('wraps the last frame back to the first — the seam the baker also solves', () => {
      const f = flipbookFrameAt(1000 / 16 * 15.5, 16, 16, true);
      expect(f.a).toBe(15);
      expect(f.b).toBe(0);
      expect(f.t).toBeCloseTo(0.5, 5);
      expect(f.done).toBe(false);
    });

    it('keeps looping forever and never reports done', () => {
      for (const cycles of [1, 2, 7.25, 100.5]) {
        const f = flipbookFrameAt(1000 * cycles, 16, 16, true);
        expect(f.done).toBe(false);
        expect(f.a).toBeGreaterThanOrEqual(0);
        expect(f.a).toBeLessThan(16);
        expect(f.b).toBeGreaterThanOrEqual(0);
        expect(f.b).toBeLessThan(16);
        expect(f.t).toBeGreaterThanOrEqual(0);
        expect(f.t).toBeLessThan(1);
      }
    });

    it('is monotonic within a cycle — t must never run backwards mid-frame', () => {
      let prev = -1;
      for (let ms = 0; ms < 1000; ms += 7) {
        const f = flipbookFrameAt(ms, 16, 16, true);
        const abs = f.a + f.t;
        if (f.a >= Math.floor(prev)) expect(abs).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = abs;
      }
    });
  });

  describe('one-shot sheets', () => {
    it('freezes on the last frame with t = 0 so it is never warped toward a wrap', () => {
      const f = flipbookFrameAt(1000 / 12 * 11.6, 12, 12, false);
      expect(f.a).toBe(11);
      expect(f.b).toBe(11);
      expect(f.t).toBe(0);
    });

    it('reports done only after the full duration', () => {
      expect(flipbookFrameAt(999, 12, 12, false).done).toBe(false);
      expect(flipbookFrameAt(1000, 12, 12, false).done).toBe(true);
      expect(flipbookFrameAt(5000, 12, 12, false).done).toBe(true);
    });

    it('never indexes past the sheet', () => {
      for (let ms = 0; ms <= 3000; ms += 13) {
        const f = flipbookFrameAt(ms, 12, 12, false);
        expect(f.a).toBeLessThan(12);
        expect(f.b).toBeLessThan(12);
        expect(f.a).toBeGreaterThanOrEqual(0);
        expect(f.b).toBeGreaterThanOrEqual(0);
      }
    });

    it('treats negative elapsed time as frame 0 rather than wrapping', () => {
      const f = flipbookFrameAt(-500, 12, 12, false);
      expect(f.a).toBe(0);
      expect(f.t).toBe(0);
    });
  });

  describe('single-frame sheets', () => {
    it('never blends', () => {
      const f = flipbookFrameAt(500, 12, 1, true);
      expect(f).toMatchObject({ a: 0, b: 0, t: 0 });
    });
  });

  describe('flipbookErosion', () => {
    it('holds at zero until the hold point, then ramps to full', () => {
      expect(flipbookErosion(0, 0.55)).toBe(0);
      expect(flipbookErosion(0.55, 0.55)).toBe(0);
      expect(flipbookErosion(0.775, 0.55)).toBeCloseTo(0.5, 5);
      expect(flipbookErosion(1, 0.55)).toBeCloseTo(1, 5);
    });

    it('is disabled entirely at hold = 1 (looping effects never burn away)', () => {
      for (const p of [0, 0.5, 1, 2]) expect(flipbookErosion(p, 1)).toBe(0);
    });

    it('clamps outside 0..1', () => {
      expect(flipbookErosion(-1, 0.5)).toBe(0);
      expect(flipbookErosion(4, 0.5)).toBeCloseTo(1, 5);
    });
  });

  describe('power-governor independence', () => {
    it('depends only on elapsed time, not on the sampling cadence', () => {
      // The governor drops the loop to 30 or 15fps. A frame-counter flipbook
      // would slow down with it; this one must not. Walk the same 600ms at
      // three cadences and compare the reading at the identical timestamp.
      const walk = (stepMs: number) => {
        let last = flipbookFrameAt(0, 16, 16, true);
        let ms = 0;
        while (ms < 600) {
          ms = Math.min(600, ms + stepMs);
          last = flipbookFrameAt(ms, 16, 16, true);
        }
        return last;
      };
      const at60 = walk(1000 / 60);
      const at30 = walk(1000 / 30);
      const at15 = walk(1000 / 15);
      expect(at30).toEqual(at60);
      expect(at15).toEqual(at60);
      expect(at60.a).toBe(9); // 600ms at 16fps = frame 9.6
      expect(at60.t).toBeCloseTo(0.6, 5);
    });
  });
});
