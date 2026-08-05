import Phaser from 'phaser';
import type { GameContext } from './Context';
import { isWorldItemArt } from './worldChains';

/**
 * Load any of `keys` not already resident — from their assets.json `file` entry —
 * then call `onReady` (immediately if all are present). Rare-screen art (the
 * Chapter-One finale trailers/teasers, the Dragon-Duel throws, the level-up
 * emblem) is deliberately kept OFF the boot preload (see PreloadScene) and pulled
 * in here only when its screen is about to show, so a session that never reaches
 * those screens never pays their GPU-memory cost.
 */
export function ensureTextures(scene: Phaser.Scene, ctx: GameContext, keys: string[], onReady: () => void): void {
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

/** True for rare-screen art kept off the boot preload (loaded via ensureTextures). */
export function isLazyScreenArt(key: string): boolean {
  return (
    /^trailer_/.test(key) || // finale "Beyond the demo" worlds + legends
    /^ui_teaser_/.test(key) || // finale Chapter-Two teasers
    key === 'ui_levelup_emblem' || // level-up banner emblem
    /^duel_(rock|paper|scissors)_/.test(key) || // Dragon-Duel throw art
    // Another world's merge icons (borealis' four cold chains). A run that never
    // travels north never pays for them; BoardScene pulls them in on arrival.
    isWorldItemArt(key)
  );
}
