import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import assets from '../../src/data/assets.json';
import downscale from '../../src/data/art-downscale.json';
import { ITEM_SCALE } from '../../src/core/Constants';
import { plateScale } from '../../src/core/artScale';

/**
 * THE RESIZE MUST BE INVISIBLE.
 *
 * 98 board plates are stored at a fraction of the size they were drawn at —
 * 128 MB of GPU memory that was crashing phones. The bargain is that the piece
 * on the board is exactly the size it always was: the authored ITEM_SCALE is a
 * ratio on the ORIGINAL width, and `plateScale` divides it by the factor the
 * resize recorded. If that arithmetic ever drifts, every affected piece changes
 * size on the board at once — the failure `shrink-dist` calls "a 9px speck".
 *
 * These read the plates' real headers rather than trusting the table.
 */
const ROOT = resolve(__dirname, '../..');
const FACTORS = downscale.factors as Record<string, number>;
const FILE_OF = new Map(
  assets.images.filter((e) => e.source === 'file' && e.file).map((e) => [e.key, e.file as string])
);

/** Width from a PNG/WebP header — no decoder, no dependency. */
function plateWidth(rel: string): number | null {
  const path = resolve(ROOT, 'assets', rel.replace(/^\//, ''));
  if (!existsSync(path)) return null;
  const b = readFileSync(path).subarray(0, 32);
  if (b.subarray(0, 8).toString('binary') === '\x89PNG\r\n\x1a\n') return b.readUInt32BE(16);
  if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') {
    const fmt = b.subarray(12, 16).toString('ascii');
    if (fmt === 'VP8 ') return b.readUInt16LE(26) & 0x3fff;
    if (fmt === 'VP8L') return (b.readUInt32LE(21) & 0x3fff) + 1;
    if (fmt === 'VP8X') return ((b[24]! | (b[25]! << 8) | (b[26]! << 16)) >>> 0) + 1;
  }
  return null;
}

describe('the board-plate downscale (art-downscale.json)', () => {
  it('keeps every resized piece the exact size it was drawn to be', () => {
    const drifted: string[] = [];
    for (const [key, factor] of Object.entries(FACTORS)) {
      const rel = FILE_OF.get(key);
      const width = rel ? plateWidth(rel) : null;
      if (width === null) continue;
      const authored = ITEM_SCALE[key.slice('item_'.length)];
      if (authored === undefined) continue;
      // What the piece occupied before the resize, and what it occupies now.
      const was = (width / factor) * authored;
      const now = width * plateScale(key, authored);
      if (Math.abs(was - now) > 1) drifted.push(`${key}: ${was.toFixed(1)} -> ${now.toFixed(1)}`);
    }
    expect(drifted).toEqual([]);
  });

  it('never resizes a plate a second key also reads', () => {
    // `item_storm_2` and `skin_storm_3` are one .webp read at two scales, and
    // one resize cannot serve both — the pass skips those, and this is what
    // keeps it skipping them.
    const usesOf = new Map<string, string[]>();
    for (const [key, file] of FILE_OF) {
      const list = usesOf.get(file) ?? [];
      list.push(key);
      usesOf.set(file, list);
    }
    const shared = Object.keys(FACTORS).filter((k) => (usesOf.get(FILE_OF.get(k) ?? '') ?? []).length > 1);
    expect(shared).toEqual([]);
  });

  it('leaves an unresized plate its authored scale, untouched', () => {
    expect(plateScale('item_never_resized_9', 0.42)).toBe(0.42);
  });
});
