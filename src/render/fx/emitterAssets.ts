/**
 * Loading the art the emitter presets reference.
 *
 * Two rules here, both deliberate:
 *
 * 1. **Bank particles load under `fxb_*` keys, never `fx_*`.** The bank's own
 *    manifest says its stills "replace" the game's placeholder `fx_ember` /
 *    `fx_spark` / `fx_glow`, and loading them under those keys would silently
 *    restyle every merge burst, hatch and chest pop in the game. Whether to
 *    make that swap is a separate decision from placing an emitter, so the
 *    emitter art gets its own namespace and changes nothing else.
 *
 * 2. **Sheets are not in `SHIPPED`.** `fb_flame_small` and `fb_smoke_wispy`
 *    cost ~2.0 MB of texture memory each once decoded, and until emitters are
 *    actually placed in the world nothing would look at them. `EMITTER_SHEETS`
 *    names them; adding those two entries to `SHIPPED` in `vfxBank.ts` is the
 *    one-line switch that ships them (the dist prune reads `SHIPPED` directly,
 *    so it follows automatically). Until then a production build runs the
 *    emitters particle-only, which is the designed fallback, not a break.
 */
import type Phaser from 'phaser';

import { preloadFlipbooks, RAMP_TEXTURE } from '../FlipbookFX';
import { BANK_BASE, sheetOf } from '../vfxBank';
import file from '../../data/fx-emitters.json';
import type { FxPresetFile } from './emitterTypes';

export const EMITTER_PRESETS = file as unknown as FxPresetFile;

/** Bank sheets the presets need. See rule 2 above before shipping them. */
export const EMITTER_SHEETS: readonly string[] = EMITTER_PRESETS.sheets;

/**
 * Queue every texture the presets reference. Safe to call when the bank is not
 * deployed — the loader's own failure path leaves the keys absent and every
 * layer that needed one is skipped at build time.
 *
 * `sheets` defaults to true for standalone callers (the FX Lab, the World
 * Builder). The GAME passes false: `EMITTER_SHEETS` are already in `SHIPPED`,
 * and queueing them twice makes Phaser warn about duplicate keys for no gain.
 */
export function preloadEmitterAssets(
  load: Phaser.Loader.LoaderPlugin,
  base = BANK_BASE,
  { sheets = true }: { sheets?: boolean } = {}
): void {
  for (const [key, path] of Object.entries(EMITTER_PRESETS.textures)) {
    load.image(key, `${base}${path}`);
  }
  if (!sheets) return;
  const resolved = EMITTER_SHEETS.map(sheetOf).filter((s): s is NonNullable<typeof s> => !!s);
  if (resolved.length) preloadFlipbooks(load, resolved, base);
  else load.image(RAMP_TEXTURE, `${base}ramps.png`);
}
