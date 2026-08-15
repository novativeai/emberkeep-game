/**
 * LOW-END TEXTURE DIET — how iOS stays under its memory budget.
 *
 * The budget itself (and its derivation from the worst supported device) is
 * `IOS_TEXTURE_BUDGET_MB` in Constants.ts. This module is the biggest single
 * lever that gets us under it: on IS_LOW_END devices, merge-item art is
 * DOWNSCALED TO HALF RESOLUTION the moment it lands, before anything can wear
 * it.
 *
 * Why this is visually free on exactly the devices it runs on: item plates are
 * authored around 430×450 px, and on a phone the board draws a piece at
 * ~60–90 CSS px. A half-resolution source is still comfortably above display
 * size there — the shrink costs nothing the player can see, and it cuts the
 * decoded footprint of the item bank by 4× (measured: 181 MB → ~45 MB).
 *
 * What is deliberately NOT shrunk:
 *  - the golden chain — the altar egg and the Elder are the chapter's showcase
 *    art, drawn large in the finale choreography and seated by calibrated
 *    ceremony code that reads native size;
 *  - the crystal — `item_crystal_1` has its own canvas-replacement lifecycle
 *    (the live 3D gem) and the baked spin sheet is already half-scale;
 *  - everything that is not `item_` art: backdrops fill the screen, spritesheets
 *    carry frame grids the loader has already sliced.
 *
 * The shrink happens inside the loader's FILE_COMPLETE, synchronously with the
 * texture's arrival — same tick, so no sprite can acquire the full-size texture
 * between the add and the swap. Sprites that size themselves off native texture
 * dimensions compensate through `shrunkArtScale`.
 */
import Phaser from 'phaser';

import { GOLDEN_CHAIN, IS_LOW_END } from './Constants';

const shrunk = new Set<string>();

/** Keys eligible for the half-resolution diet. Beyond the item bank, the
 *  on-demand modal classes join it: the hatch card (`reveal_`, ~73 MB decoded
 *  — the single worst mid-session spike), Emporium cards and owned skins.
 *  All three size their art by fit/COVER math or the shrink-aware
 *  `artScaleFor`, so a halved source lands at the same on-screen size. */
export function shrinksOnLowEnd(key: string): boolean {
  if (!IS_LOW_END) return false;
  if (/^(reveal_|card_|skin_)/.test(key)) return true;
  if (!key.startsWith('item_')) return false;
  if (key.startsWith(`item_${GOLDEN_CHAIN}_`)) return false;
  if (key === 'item_crystal_1') return false;
  return true;
}

/** The scale that puts a shrunk texture back at its authored display size. */
export function shrunkArtScale(key: string): number {
  return shrunk.has(key) ? 2 : 1;
}

/**
 * Attach the diet to a scene's loader — every scene that can fetch a dietable
 * image arms its own (PreloadScene streams the item bank; BoardScene fetches
 * owned skins; UIScene's `ensureTextures` pulls the modal classes). Idempotent
 * per loader, so a scene restart re-arming costs nothing.
 */
export function armLowEndShrink(scene: Phaser.Scene): void {
  if (!IS_LOW_END) return;
  const loader = scene.load as Phaser.Loader.LoaderPlugin & { __shrinkArmed?: boolean };
  if (loader.__shrinkArmed) return;
  loader.__shrinkArmed = true;
  loader.on(Phaser.Loader.Events.FILE_COMPLETE, (key: string, type: string) => {
    if (type === 'image' && shrinksOnLowEnd(key)) shrinkToHalf(scene.textures, key);
    // Character/dragon clip sheets: the catalog already presents HALVED frame
    // records on low-end (characterAnims.halveForLowEnd), so the transiently
    // mis-sliced full-size texture is replaced wholesale with a half-size
    // canvas cut to the record's grid — the two halve together, always.
    else if (type === 'spritesheet' && key.startsWith('canim_')) shrinkSheetToHalf(scene.textures, key);
  });
}

/** Replace a clip spritesheet with a half-resolution canvas sliced to the
 *  (already-halved) catalog grid. Frame 0's dimensions ARE that grid — the
 *  loader was called with the adjusted record. */
function shrinkSheetToHalf(textures: Phaser.Textures.TextureManager, key: string): void {
  if (shrunk.has(key)) return;
  const tex = textures.get(key);
  const frame0 = tex.get(0);
  if (!frame0) return;
  const fw = frame0.width;
  const fh = frame0.height;
  const src = tex.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(src.width / 2));
  canvas.height = Math.max(1, Math.floor(src.height / 2));
  const g = canvas.getContext('2d');
  if (!g) return;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, canvas.width, canvas.height);
  textures.remove(key);
  textures.addSpriteSheet(key, canvas as unknown as HTMLImageElement, { frameWidth: fw, frameHeight: fh });
  shrunk.add(key);
}

/** Replace an image texture with a half-resolution canvas under the same key. */
function shrinkToHalf(textures: Phaser.Textures.TextureManager, key: string): void {
  const tex = textures.get(key);
  const src = tex.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const w = Math.max(1, Math.floor(src.width / 2));
  const h = Math.max(1, Math.floor(src.height / 2));
  // Tiny art (icons riding the item_ prefix) is not worth the swap.
  if (src.width < 128 && src.height < 128) return;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  textures.remove(key);
  textures.addCanvas(key, canvas);
  shrunk.add(key);
}
