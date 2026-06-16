/**
 * Tiny zero-dependency PNG prober for the asset ingest pipeline.
 * Reads the IHDR chunk: width, height, bit depth, colour type — enough to
 * sanity-check downloaded packs and AI sheets before wiring them into
 * assets.json.
 *
 * Run: pnpm run probe -- assets/raw/kenney/some.png [more.png ...]
 */
import { readFileSync } from 'node:fs';

const COLOR_TYPES: Record<number, string> = {
  0: 'greyscale',
  2: 'truecolour',
  3: 'indexed',
  4: 'greyscale+alpha',
  6: 'truecolour+alpha (RGBA)'
};

const files = process.argv.slice(2).filter((arg) => arg !== '--');
if (files.length === 0) {
  console.log('usage: pnpm run probe -- <file.png> [...]');
  process.exit(0);
}

let failures = 0;
for (const file of files) {
  try {
    const buf = readFileSync(file);
    const isPng =
      buf.length > 33 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47;
    if (!isPng) {
      console.error(`${file}: not a PNG`);
      failures++;
      continue;
    }
    // IHDR is always the first chunk: length(4) type(4) data(13) at offset 8.
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    const bitDepth = buf[24]!;
    const colorType = buf[25]!;
    console.log(
      `${file}: ${width}x${height}, ${bitDepth}-bit, ${COLOR_TYPES[colorType] ?? `type ${colorType}`}`
    );
  } catch (error) {
    console.error(`${file}: ${(error as Error).message}`);
    failures++;
  }
}
process.exit(failures > 0 ? 1 : 0);
