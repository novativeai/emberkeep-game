import downscale from '../data/art-downscale.json';

/**
 * THE PLATE IS SMALLER THAN THE SCALE THINKS IT IS.
 *
 * `ITEM_SCALE` and its neighbours are RATIOS on a plate's natural pixel width,
 * hand-tuned against the art as it was drawn. A pass over the board art stored
 * those plates at 2.25x the size they can actually occupy — the eggs were
 * 1160px wide and are drawn at 74 — which took 128 MB of GPU memory off a boot
 * that was crashing phones outright.
 *
 * Shrinking the file WITHOUT telling anyone would have shrunk the piece on the
 * board by the same factor: that is precisely the trap `shrink-dist` documents
 * and refuses ("the 1160px Ashdrake egg to 148px turned it into a 9px speck").
 * So the resize records a factor per texture key and the authored ratio is
 * divided by it here. Two properties fall out, and both were the point:
 *
 *   - every hand-tuned number in ITEM_SCALE, and every per-line comment
 *     explaining the measurement behind it, stays TRUE — they describe the art
 *     as authored, which is still what they are ratios of
 *   - the correction lives in ONE generated file beside the script that made
 *     it, so the whole operation is auditable and reversible, the way
 *     `faces.json` carries its calibration
 *
 * A key with no entry is a plate that was never resized, and gets its authored
 * scale back unchanged — which is every plate on the day this shipped bar 98.
 */
const FACTORS = downscale.factors as Record<string, number>;

export function plateScale(textureKey: string, authored: number): number {
  const factor = FACTORS[textureKey];
  return factor ? authored / factor : authored;
}
