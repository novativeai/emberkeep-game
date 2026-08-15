import Phaser from 'phaser';
import type { GameContext } from './Context';

/**
 * On-demand texture loading for RARE-SCREEN art.
 *
 * The boot preload uploads every `source:"file"` entry in assets.json, and a
 * texture costs GPU memory from the moment it is uploaded whether or not it is
 * ever drawn. Some of the heaviest art in the game belongs to screens most
 * sessions never reach — the Chapter-One finale trailers and Chapter-Two teasers,
 * the level-up emblem. Paying for those at boot is the single easiest GPU-memory
 * win available, and on a weak device it is the difference between a board and a
 * crashed tab.
 *
 * So they are skipped at boot (`isLazyScreenArt`, honoured by PreloadScene) and
 * pulled in here the moment their screen is about to show. `ensureTextures` is
 * safe to call on every open: anything already resident is skipped, and when
 * nothing needs loading it calls back synchronously so the caller has no special
 * "already loaded" branch.
 */
export function ensureTextures(
  scene: Phaser.Scene,
  ctx: GameContext,
  keys: string[],
  onReady: () => void
): void {
  const byKey = new Map(ctx.data.assets.images.map((e) => [e.key, e] as const));
  let queued = 0;
  for (const k of keys) {
    if (scene.textures.exists(k)) continue;
    const e = byKey.get(k);
    if (e?.source === 'file' && e.file) {
      scene.load.image(k, e.file);
      queued++;
    }
  }
  if (queued === 0) {
    onReady();
    return;
  }
  // Fire once THIS batch (and anything already queued) finishes uploading.
  scene.load.once(Phaser.Loader.Events.COMPLETE, onReady);
  scene.load.start();
}

/**
 * The `ondemand` wave's membership test — now defined in `assetWaves.ts` beside
 * the other two waves, and re-exported here so this file still reads as the whole
 * contract: what is skipped at boot, and the `ensureTextures` above that is
 * obliged to fetch it.
 */
export { isLazyScreenArt } from './assetWaves';
