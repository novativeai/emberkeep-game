import { describe, expect, it } from 'vitest';
import {
  makePresetContext,
  PRESET_BY_KEY,
  resolvePart,
  resolveRig
} from '../../src/render/rigAnimations';
import type { RigDoc } from '../../src/render/rigTypes';

/** A rig that exercises every adaptation path: an anchored wing, a pins-only
 *  tail, a bare limb with no joints, and a missing jaw. */
function makeRig(): RigDoc {
  return {
    format: 'emberkeep-rig',
    version: 1,
    character: 'test',
    bounds: { x: 0, y: 0, width: 200, height: 200 },
    root: null,
    layers: [
      { name: 'body_tail', file: 'b.png', z: 0, x: 0, y: 0, width: 100, height: 100 },
      { name: 'wing_left', file: 'w.png', z: 3, x: 10, y: 10, width: 80, height: 80 },
      { name: 'foot_right', file: 'f.png', z: 1, x: 20, y: 60, width: 40, height: 40 }
    ],
    anchors: [
      { name: 'anchor_wing_left', parentLayer: 'body_tail', childLayer: 'wing_left', rig: { x: 30, y: 40 }, childOriginNorm: { x: 0.25, y: 0.5 } }
    ],
    pins: [
      { name: 'pin_tail_01', layer: 'body_tail', chain: 'tail', order: 1, rig: { x: 60, y: 50 }, norm: { x: 0.6, y: 0.5 } },
      { name: 'pin_tail_02', layer: 'body_tail', chain: 'tail', order: 2, rig: { x: 90, y: 50 }, norm: { x: 0.9, y: 0.5 } }
    ]
  };
}

describe('rig adaptation (resolvePart)', () => {
  const rig = makeRig();

  it('uses the ANCHOR when a part has one', () => {
    const r = resolvePart(rig, 'wing_left');
    expect(r.via).toBe('anchor');
    expect(r.layer).toBe('wing_left');
    expect(r.originNorm).toEqual({ x: 0.25, y: 0.5 }); // the anchor's childOriginNorm
  });

  it('uses the PIN CHAIN for a pins-only part with no own layer (tail)', () => {
    const r = resolvePart(rig, 'tail');
    expect(r.via).toBe('pin');
    expect(r.layer).toBe('body_tail'); // the chain's owning layer
    expect(r.originNorm).toEqual({ x: 0.6, y: 0.5 }); // chain-root pin norm
  });

  it('falls back to BARE-LAYER rotation when a limb has no joints', () => {
    const r = resolvePart(rig, 'foot_right');
    expect(r.via).toBe('layer');
    expect(r.layer).toBe('foot_right');
    expect(r.originNorm).toEqual({ x: 0.5, y: 0.92 }); // base pivot
  });

  it('SKIPS a part that is wholly absent (no layer, no chain)', () => {
    expect(resolvePart(rig, 'jaw').via).toBe('skip');
    expect(resolvePart(rig, 'jaw').layer).toBeNull();
  });

  it('resolveRig classifies the whole standard part set', () => {
    const map = resolveRig(rig);
    expect(map['wing_left']!.via).toBe('anchor');
    expect(map['tail']!.via).toBe('pin');
    expect(map['foot_right']!.via).toBe('layer');
    expect(map['head']!.via).toBe('skip');
  });
});

describe('preset context (iso 3/4 perspective)', () => {
  const rig = makeRig();
  const K = makePresetContext(rig);

  it('gives near-side (higher-z) parts a larger amplitude than far-side', () => {
    // wing_left z3 is the highest z here → near → full amplitude.
    const near = K.nearAmp('wing_left', 100);
    const far = K.nearAmp('foot_right', 100); // z1, lower
    expect(near).toBeGreaterThan(far);
    expect(near).toBeLessThanOrEqual(100);
  });

  it('has() reports which parts are animatable', () => {
    expect(K.has('wing_left')).toBe(true);
    expect(K.has('tail')).toBe(true);
    expect(K.has('jaw')).toBe(false);
  });
});

describe('presets are finite and bounded', () => {
  const rig = makeRig();
  const K = makePresetContext(rig);

  it('every preset returns finite root + part values across a cycle', () => {
    for (const def of Object.values(PRESET_BY_KEY)) {
      for (let t = 0; t < 4; t += 0.25) {
        const pose = def.fn(t, K);
        expect(Number.isFinite(pose.root.dy)).toBe(true);
        expect(Number.isFinite(pose.root.rotDeg)).toBe(true);
        expect(pose.root.sx).toBeGreaterThan(0);
        expect(pose.root.sy).toBeGreaterThan(0);
        for (const deg of Object.values(pose.partDeg)) expect(Number.isFinite(deg)).toBe(true);
      }
    }
  });

  it('roar adapts the missing jaw into a head tilt', () => {
    const pose = PRESET_BY_KEY['roar']!.fn(1.0, K); // mid-roar
    // jaw absent → no jaw channel, but head is driven (raise + jaw→tilt).
    expect(pose.partDeg['jaw']).toBeUndefined();
    expect(pose.partDeg['head']).toBeDefined();
  });
});
