/**
 * The crystal's baked spin, and the one place its numbers are read.
 *
 * `src/data/crystal-spin.json` is GENERATED — `scripts/bake-crystal.mjs` renders
 * the SHIPPED `Crystal3D` module in a headless browser and `scripts/pack-crystal.py`
 * trims and packs the frames — so nothing here is authored and nothing here may
 * be hand-edited. Re-run the bake instead.
 *
 * ## Why 54 frames is the same motion, not an approximation
 *
 * The gem is a stretched octahedron spinning about Y, with vertices
 * (±0.66,0,0), (0,±1.2,0), (0,0,±0.66). A 90° turn about Y maps that set — and
 * every face built from it — onto itself while the lights stay put, so the image
 * at θ and at θ+90° is IDENTICAL and the loop is a quarter turn, not a full one.
 * The live gem re-renders every `POWER.crystalMs.active` = 33 ms at 50°/s, which
 * is 1.667° a step and 90°/1.667° = 54 steps. Fifty-four frames held 33.33 ms
 * each is not a close match for the live motion; it is the same motion.
 * `bake-crystal --verify` proves the wrap by hashing 0° against 90°.
 */
import spin from '../data/crystal-spin.json';
import type { SpinSheet } from './types';

/** Texture key for the packed sheet. Deliberately NOT `item_crystal_1`: that key
 *  is the untrimmed still, and the two have different frames, origins and
 *  scales — sharing a key would let one be seated with the other's numbers. */
export const CRYSTAL_SPIN_KEY = 'crystal_spin';

// Through `unknown`: the JSON's `anchor`/`sourceSize` widen to `number[]`, which
// does not overlap the fixed-length pairs the type promises. The packer writes
// exactly two of each — that is the contract this cast asserts.
export const CRYSTAL_SPIN: SpinSheet = spin as unknown as SpinSheet;
