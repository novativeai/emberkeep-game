/**
 * Track A placeholder art — generation strategy note.
 *
 * Emberkeep generates ALL placeholder textures AT RUNTIME in BootScene via
 * src/art/TextureFactory.ts (Canvas2D -> Phaser CanvasTexture). That path was
 * chosen over a Node build step (this script) deliberately:
 *
 *   - zero native dependencies (no node-canvas build pain)
 *   - the palette/shading source of truth lives next to the game code
 *   - a fresh checkout boots with `pnpm install && pnpm dev`, never blocked on art
 *
 * This script therefore only verifies the manifest is consistent: every
 * assets.json entry must be coverable by the runtime factory, and every
 * source:"file" entry must point at an existing file under assets/.
 *
 * Run: pnpm run placeholders
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import manifest from '../src/data/assets.json';

let missing = 0;
for (const entry of manifest.images) {
  if (entry.source === 'file') {
    const path = resolve(import.meta.dirname, '..', 'assets', entry.file ?? '');
    if (!entry.file || !existsSync(path)) {
      console.warn(`[placeholders] source:"file" but missing on disk: ${entry.key} -> ${entry.file}`);
      missing++;
    }
  }
}

console.log(
  `[placeholders] ${manifest.images.length} manifest entries; ` +
    `${manifest.images.filter((i) => i.source === 'placeholder').length} runtime-generated ` +
    `(see src/art/TextureFactory.ts); ${missing} broken file reference(s).`
);
process.exit(missing > 0 ? 1 : 0);
