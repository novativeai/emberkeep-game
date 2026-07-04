import { describe, expect, it } from 'vitest';
import {
  BLINK_GAP_CALM,
  BLINK_GAP_EXCITED,
  BlinkScheduler,
  FaceChannel,
  type FaceDoc
} from '../../src/render/faceAnimations';
import { makePresetContext, PRESET_BY_KEY } from '../../src/render/rigAnimations';
import type { RigDoc, RigPose } from '../../src/render/rigTypes';

/** Deterministic rng: replays a queue, then holds the last value. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}

/** Drive the scheduler in fixed steps until `pred(eyelid)` or `capMs` elapses;
 *  returns the total ms elapsed and the min eyelid seen. */
function runUntil(
  b: BlinkScheduler,
  pred: (e: number) => boolean,
  gap = BLINK_GAP_CALM,
  stepMs = 16,
  capMs = 30000
): { ms: number; minEyelid: number } {
  let ms = 0;
  let minEyelid = 1;
  while (ms < capMs) {
    const e = b.update(stepMs, false, gap);
    minEyelid = Math.min(minEyelid, e);
    ms += stepMs;
    if (pred(e)) break;
  }
  return { ms, minEyelid };
}

/** Face doc shaped like the generated src/data/faces.json (durations from the
 *  real frames.json exports: blink hold+45/70/55, talk 4×267). */
function makeFaceDoc(sets: Array<'blink' | 'talk'> = ['blink', 'talk']): FaceDoc {
  const all: FaceDoc['sets'] = {
    blink: {
      dir: 'blink',
      textureScale: 0.938,
      originX: 0.464,
      originY: 0.94,
      frames: [
        { file: 'open.png', durationMs: 2600 },
        { file: 'half.png', durationMs: 45 },
        { file: 'closed.png', durationMs: 70 },
        { file: 'half2.png', durationMs: 55 }
      ]
    },
    talk: {
      dir: 'talk',
      textureScale: 0.471,
      originX: 0.467,
      originY: 0.924,
      frames: [
        { file: 't0.png', durationMs: 267 },
        { file: 't1.png', durationMs: 267 },
        { file: 't2.png', durationMs: 267 },
        { file: 't3.png', durationMs: 267 }
      ]
    }
  };
  const picked: FaceDoc['sets'] = {};
  for (const key of sets) picked[key] = all[key]!;
  return { layer: 'head', basePath: 'x', sets: picked };
}

function pose(overrides: Partial<RigPose> = {}): RigPose {
  return { root: { dx: 0, dy: 0, rotDeg: 0, sx: 1, sy: 1 }, partDeg: {}, ...overrides };
}

describe('FaceChannel — pose-driven selection', () => {
  it('rests on the base texture (null) with a neutral pose', () => {
    const face = new FaceChannel(makeFaceDoc());
    expect(face.update(16, pose())).toBeNull();
    expect(face.update(16, pose({ eyelid: 1 }))).toBeNull();
  });

  it('maps eyelid dips to half-open then closed blink frames', () => {
    const face = new FaceChannel(makeFaceDoc());
    expect(face.update(16, pose({ eyelid: 0.6 }))).toEqual({ setKey: 'blink', frameIndex: 1 });
    expect(face.update(16, pose({ eyelid: 0.1 }))).toEqual({ setKey: 'blink', frameIndex: 2 });
    expect(face.update(16, pose({ eyelid: 0.95 }))).toBeNull();
  });

  it('maps jaw openness to half then wide talk frames, beating the eyelid', () => {
    const face = new FaceChannel(makeFaceDoc());
    expect(face.update(16, pose({ mouth: 0.3 }))).toEqual({ setKey: 'talk', frameIndex: 1 });
    expect(face.update(16, pose({ mouth: 0.9 }))).toEqual({ setKey: 'talk', frameIndex: 2 });
    // Mouth wins over a simultaneous blink dip (the sets are exclusive textures).
    expect(face.update(16, pose({ mouth: 0.9, eyelid: 0.1 }))).toEqual({ setKey: 'talk', frameIndex: 2 });
    expect(face.update(16, pose({ mouth: 0.05 }))).toBeNull();
  });

  it('degrades per missing set: no talk set → mouth ignored, blink still works', () => {
    const face = new FaceChannel(makeFaceDoc(['blink']));
    expect(face.update(16, pose({ mouth: 0.9 }))).toBeNull();
    expect(face.update(16, pose({ eyelid: 0.1 }))).toEqual({ setKey: 'blink', frameIndex: 2 });
    face.playTalk(3); // no talk set → must be a no-op
    expect(face.talking).toBe(false);
  });

  it('runs without a pose (no preset playing)', () => {
    const face = new FaceChannel(makeFaceDoc());
    expect(face.update(16, null)).toBeNull();
  });
});

describe('FaceChannel — scripted talk override', () => {
  it('steps through the loop on the authored frame durations', () => {
    const face = new FaceChannel(makeFaceDoc());
    face.playTalk(1);
    expect(face.update(0, pose())).toEqual({ setKey: 'talk', frameIndex: 0 });
    expect(face.update(266, pose())).toEqual({ setKey: 'talk', frameIndex: 0 });
    expect(face.update(2, pose())).toEqual({ setKey: 'talk', frameIndex: 1 }); // 268ms
    expect(face.update(267, pose())).toEqual({ setKey: 'talk', frameIndex: 2 });
    expect(face.update(267, pose())).toEqual({ setKey: 'talk', frameIndex: 3 });
  });

  it('loops the requested number of times then returns to pose-driven', () => {
    const face = new FaceChannel(makeFaceDoc());
    face.playTalk(2);
    let last: unknown = null;
    // 2 loops × 4 × 267ms = 2136ms; step past it.
    for (let t = 0; t < 2200; t += 50) last = face.update(50, pose());
    expect(last).toBeNull();
    expect(face.talking).toBe(false);
    // Pose-driven face resumes immediately after.
    expect(face.update(16, pose({ eyelid: 0.1 }))).toEqual({ setKey: 'blink', frameIndex: 2 });
  });

  it('catches up over a large frame delta without leaving the loop', () => {
    const face = new FaceChannel(makeFaceDoc());
    face.playTalk(1);
    // 600ms in one step lands inside frame 2 (267+267=534 .. 801).
    expect(face.update(600, pose())).toEqual({ setKey: 'talk', frameIndex: 2 });
  });

  it('overrides any simultaneous pose influence while active', () => {
    const face = new FaceChannel(makeFaceDoc());
    face.playTalk(1);
    expect(face.update(16, pose({ eyelid: 0.05 }))).toEqual({ setKey: 'talk', frameIndex: 0 });
    face.stopTalk();
    expect(face.update(16, pose({ eyelid: 0.05 }))).toEqual({ setKey: 'blink', frameIndex: 2 });
  });
});

describe('BlinkScheduler — randomized, realistic cadence', () => {
  it('holds eyes open until the scheduled gap, then blinks shut and back', () => {
    // rng: [firstGapStagger, doubleRoll(no), nextGapRoll...]; 0.5 → mid-range.
    const b = new BlinkScheduler(seq([0.5, 0.9, 0.5]), BLINK_GAP_CALM);
    // first blink is staggered: pick 0.5 of range = 4650ms, ×(0.25+0.75·0.9)=0.925 ≈ 4301ms.
    const before = b.update(16, false, BLINK_GAP_CALM);
    expect(before).toBe(1);
    const closed = runUntil(b, (e) => e <= 0.05, BLINK_GAP_CALM);
    expect(closed.ms).toBeGreaterThan(3500); // waited a realistic few seconds
    expect(closed.ms).toBeLessThan(5200);
    expect(closed.minEyelid).toBeLessThanOrEqual(0.05); // fully shut
    // Passes back through the half-open band while reopening.
    const reopened = runUntil(b, (e) => e >= 0.999, BLINK_GAP_CALM);
    expect(reopened.ms).toBeGreaterThan(60); // hold + open phases took time
  });

  it('picks a fresh gap in the requested range every cycle (never a fixed period)', () => {
    // Feed rng so successive gaps differ: 0.1 then 0.9 of the range.
    const b = new BlinkScheduler(seq([0, 0, 0.1, 0, 0.9, 0]), BLINK_GAP_CALM);
    const gaps: number[] = [];
    let acc = 0;
    let wasOpen = true;
    for (let i = 0; i < 2000; i++) {
      const e = b.update(16, false, BLINK_GAP_CALM);
      acc += 16;
      const open = e >= 0.999;
      if (!open && wasOpen) { gaps.push(acc); acc = 0; } // caught a blink start
      wasOpen = open;
    }
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    // Two consecutive gaps must differ (0.1 vs 0.9 of range → ~370ms apart min).
    expect(Math.abs(gaps[1]! - gaps[0]!)).toBeGreaterThan(300);
    // And each sits inside the configured range (+ blink duration slop).
    for (const g of gaps) expect(g).toBeLessThan(BLINK_GAP_CALM.maxMs + 400);
  });

  it('excited cadence blinks sooner than calm', () => {
    const calm = new BlinkScheduler(seq([0.5, 0.9]), BLINK_GAP_CALM);
    const excited = new BlinkScheduler(seq([0.5, 0.9]), BLINK_GAP_EXCITED);
    const tCalm = runUntil(calm, (e) => e <= 0.05, BLINK_GAP_CALM).ms;
    const tExcited = runUntil(excited, (e) => e <= 0.05, BLINK_GAP_EXCITED).ms;
    expect(tExcited).toBeLessThan(tCalm);
  });

  it('suppress (mouth open) holds the eyes open and defers the blink', () => {
    const b = new BlinkScheduler(seq([0.01, 0.9, 0.5]), BLINK_GAP_CALM); // tiny first gap
    // Even well past that gap, suppression keeps eyes fully open.
    for (let i = 0; i < 200; i++) expect(b.update(16, true, BLINK_GAP_CALM)).toBe(1);
    // Once released it still takes a fresh (re-armed) gap before blinking.
    expect(b.update(16, false, BLINK_GAP_CALM)).toBe(1);
  });

  it('fires a quick double-blink when the roll hits', () => {
    // Constructor reads 3 rng values: gap(0.02), stagger(0.0), doubleRoll(0.0 <
    // 0.14 → YES). Holding 0.0 keeps subsequent rolls double too — fine here.
    const b = new BlinkScheduler(seq([0.02, 0.0, 0.0]), BLINK_GAP_CALM);
    const first = runUntil(b, (e) => e <= 0.05, BLINK_GAP_CALM);
    runUntil(b, (e) => e >= 0.999, BLINK_GAP_CALM); // reopen from blink 1
    // The 2nd blink of the pair comes fast (~150ms gap), not seconds later.
    const second = runUntil(b, (e) => e <= 0.05, BLINK_GAP_CALM);
    expect(second.ms).toBeLessThan(500);
    expect(first.minEyelid).toBeLessThanOrEqual(0.05);
  });

  it('two schedulers with independent rng desync (no unison blinking)', () => {
    const a = new BlinkScheduler(seq([0.2, 0.9, 0.5]), BLINK_GAP_CALM);
    const b = new BlinkScheduler(seq([0.8, 0.9, 0.5]), BLINK_GAP_CALM);
    const ta = runUntil(a, (e) => e <= 0.05, BLINK_GAP_CALM).ms;
    const tb = runUntil(b, (e) => e <= 0.05, BLINK_GAP_CALM).ms;
    expect(ta).not.toBe(tb);
  });
});

describe('presets record mouth openness for face-frame rigs', () => {
  /** Minimal rig with a head but NO jaw layer (like the red dragon). */
  function headOnlyRig(): RigDoc {
    return {
      format: 'emberkeep-rig',
      version: 1,
      character: 'test',
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      root: null,
      layers: [
        { name: 'body_tail', file: 'b.png', z: 0, x: 0, y: 0, width: 100, height: 100 },
        { name: 'head', file: 'h.png', z: 1, x: 10, y: 0, width: 80, height: 80 }
      ],
      anchors: [
        { name: 'anchor_head', parentLayer: 'body_tail', childLayer: 'head', rig: { x: 40, y: 30 }, childOriginNorm: { x: 0.5, y: 0.8 } }
      ],
      pins: []
    };
  }

  it('roar sets pose.mouth AND keeps the head-tilt fallback (no jaw layer)', () => {
    const K = makePresetContext(headOnlyRig());
    const p = PRESET_BY_KEY['roar']!.fn(1.0, K); // fully reared back
    expect(p.mouth ?? 0).toBeGreaterThan(0.7); // 18° of 22° max
    expect(p.partDeg['head'] ?? 0).toBeLessThan(-16); // rear tilt + jaw fallback tilt
  });

  it('idle no longer bakes blink into the pose (scheduler owns it now)', () => {
    const K = makePresetContext(headOnlyRig());
    // Sample the whole former blink window: eyelid must never be emitted.
    for (let t = 0; t < 3.2; t += 0.05) {
      expect(PRESET_BY_KEY['idle']!.fn(t, K).eyelid).toBeUndefined();
      expect(PRESET_BY_KEY['idle']!.fn(t, K).mouth ?? 0).toBe(0);
    }
  });

  it('stretch yawns through half to wide and back', () => {
    const K = makePresetContext(headOnlyRig());
    const mid = PRESET_BY_KEY['stretch']!.fn(3.4 * 0.45, K); // yawn apex region
    expect(mid.mouth ?? 0).toBeGreaterThan(0.45);
    const start = PRESET_BY_KEY['stretch']!.fn(0.05, K);
    expect(start.mouth ?? 0).toBeLessThan(0.12);
  });
});
