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
 * True for rare-screen art deliberately kept OFF the boot preload.
 *
 * Anything listed here MUST be fetched through `ensureTextures` before the screen
 * that draws it opens, or it will render as a missing texture. Keep the two in
 * step — that is the whole contract of this file.
 */
export function isLazyScreenArt(key: string): boolean {
  return (
    /^trailer_/.test(key) || // finale "Beyond the demo" worlds + legends
    /^ui_teaser_/.test(key) || // finale Chapter-Two teasers
    key === 'ui_levelup_emblem' || // level-up banner emblem
    // THE REVEAL PLATES — 16 full-bleed cards, ~6.7 MB of GPU memory EACH once
    // decoded (99 MB of the boot's 375). Two screens draw them and both are
    // rare: the reveal card a breed earns once per save, and the Codex's
    // evolution page. Neither is on the path to the board, and a phone was
    // holding all sixteen from the first frame to show at most one.
    /^reveal_/.test(key) ||
    // EMPORIUM CARDS — the shop's own illustrations, ~2 MB of GPU memory each
    // and drawn nowhere but inside the Emporium. StorePanel already fetches
    // every `item.art` in its catalogue when it opens (`artKeys`), so this side
    // of the contract was the only one missing.
    /^card_/.test(key) ||
    // BOARD SKIN ART. One Manor skin and one skin per dragon chain can be worn
    // at a time, and only if bought — but all fourteen were resident. The WORN
    // ones are pulled back into the boot preload by key (PreloadScene), so a
    // save that wears one still draws it on the first frame; the rest arrive
    // when the Emporium opens or when one is put on.
    /^skin_/.test(key)
  );
}
