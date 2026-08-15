/**
 * WHEN each texture is fetched — the boot queue split into waves.
 *
 * The loader used to be one list: every `source:"file"` entry in assets.json,
 * downloaded before the board could open. That is 14.2 MB of images (plus ~5 MB
 * of spritesheets) and it gated the Play button, which is the wrong shape twice
 * over. A merge game's asset need is extremely front-light — a new save starts
 * with ONE item on the board (`map.json` startingItems: crystal:1) and unlocks
 * chains over hours — and most of the weight is art for screens and pieces the
 * first minute cannot reach: 112 of the 116 item textures are not on the board
 * when it opens, and `reveal_`/`card_` art belongs to a card that appears when a
 * dragon hatches.
 *
 * So the queue is now three waves:
 *
 *   BOOT      — the board cannot be drawn without it. Gates Play. Terrain, the
 *               live backdrop, UI chrome, and the item art of chains actually
 *               reachable in the opening (the saved board, plus the tutorial's
 *               own chains while it is still running).
 *   PLAY      — everything else with a texture. Streams DURING gameplay, behind
 *               the board, and blocks nothing. Arriving late is harmless: art
 *               that has not landed falls back to its generated placeholder
 *               (TextureFactory) and is re-dressed when it does.
 *   ON_DEMAND — screen-gated art fetched by `ensureTextures` when its screen is
 *               about to open. This is the existing `isLazyScreenArt` contract
 *               and is unchanged; it is named here so all three live in one
 *               place.
 *
 * DERIVED, NOT LISTED — the same law the ship filter follows. The boot set is
 * rebuilt from the map, the save and the tutorial script on every launch, so a
 * re-exported world or a re-authored tutorial moves it automatically and there
 * is no second list to keep in step.
 *
 * Phaser-free, so the split is a rule the unit suite can check.
 */
import type { AssetEntry, MapData, SaveDataV1, TutorialData } from './types';

export type AssetWave = 'boot' | 'play' | 'ondemand';

/**
 * True for rare-screen art deliberately kept OFF the boot preload.
 *
 * Anything listed here MUST be fetched through `ensureTextures` before the screen
 * that draws it opens, or it will render as a missing texture. Keep the two in
 * step — that is the whole contract of this class, and the reason it is the one
 * wave `waveFor` will not infer.
 *
 * It lives here rather than beside `ensureTextures` so that this module stays
 * Phaser-free (lazyTextures.ts imports Phaser, and importing it from here pulled
 * the whole engine into a pure rule the unit suite has to run in node).
 * `lazyTextures` re-exports it, so every existing caller is unchanged.
 */
export function isLazyScreenArt(key: string): boolean {
  return (
    /^trailer_/.test(key) || // finale "Beyond the demo" worlds + legends
    /^ui_teaser_/.test(key) || // finale Chapter-Two teasers
    key === 'ui_levelup_emblem' || // level-up banner emblem
    // The three below were in the `play` wave, and that shipped a crash. They
    // are 120 MB DECODED between them — art for one modal card, one panel, and
    // cosmetics most players never buy — and streaming it into a live board is
    // what pushed iOS past its renderer-process cap about two seconds in. None
    // of it can appear without a specific screen opening or a specific purchase,
    // so none of it belongs anywhere but here.
    /^reveal_/.test(key) || //  72.6 MB — the hatch card (DragonReveal.play)
    /^card_/.test(key) || //   9.8 MB — Emporium cards (StorePanel.artKeys)
    /^skin_/.test(key) //     37.5 MB — only the skins a player OWNS (ensureOwnedSkinArt)
  );
}

/**
 * Key prefixes the board cannot draw its first frame without.
 *
 * Terrain and chrome, all of it small (~1.5 MB together) and all of it on screen
 * the instant the board opens. `ui_` is here because the HUD is up from frame
 * one; `fx_` because a merge can happen within seconds of the first tap.
 */
const BOOT_PREFIXES = ['tile_', 'decor_', 'background_', 'grass_', 'cliff_', 'fog_', 'cloud_', 'fx_', 'ui_', 'icon_', 'portrait_'];

/**
 * The chains whose item art must be resident before the board opens.
 *
 * Three sources, unioned:
 *  - whatever is standing on the SAVED board (read straight off the save, since
 *    `ctx.state` is not hydrated until `beginRun()` — the same reason
 *    `savedDragonClips` reads the save);
 *  - the map's `startingItems`, which is what a fresh save is seeded with;
 *  - every chain the TUTORIAL script names, but only while the tutorial is still
 *    running. Its 65 steps reference 14 of the 43 chains, and a scripted beat
 *    that spawns a piece must not be the thing that discovers the art is missing.
 *    A player past the tutorial has no such script ahead of them and pays for
 *    none of it.
 */
export function bootChains(
  save: SaveDataV1 | null,
  map: MapData,
  tutorial: TutorialData,
  authoredWorldId: string
): Set<string> {
  const chains = new Set<string>();
  for (const placement of map.startingItems ?? []) chains.add(placement.chain);

  if (save) {
    const world = save.activeWorld ?? authoredWorldId;
    const items = world === authoredWorldId ? save.items : (save.boards?.[world]?.items ?? []);
    for (const item of items) chains.add(item.chain);
  }

  if (!save?.tutorial?.done) for (const chain of tutorialChains(tutorial)) chains.add(chain);
  return chains;
}

/** Every `chain` named anywhere in the tutorial script, at any depth. */
export function tutorialChains(tutorial: TutorialData): Set<string> {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if ((k === 'chain' || k === 'nearChain') && typeof v === 'string') out.add(v);
      else walk(v);
    }
  };
  walk(tutorial);
  return out;
}

export interface WaveContext {
  /** Texture keys the ACTIVE map places — tiles, decor, the live backdrop. */
  placed: ReadonlySet<string>;
  /** Chains whose item art must be resident before the board opens. */
  bootChains: ReadonlySet<string>;
}

/**
 * Which wave this asset belongs to.
 *
 * The default is `play`, deliberately. An asset nobody has classified still
 * downloads — just not in front of the Play button — so a new art category
 * added to assets.json degrades to "streams during play" rather than to
 * "missing". Only `isLazyScreenArt` may promote something to `ondemand`, because
 * that class carries an obligation (a matching `ensureTextures` call) that
 * cannot be inferred from the key.
 */
export function waveFor(key: string, ctx: WaveContext): AssetWave {
  if (isLazyScreenArt(key)) return 'ondemand';

  // Map-placed art is boot; the rest of the tile/decor/backdrop banks are
  // unplaced weight and were already skipped entirely (see PreloadScene).
  if (/^(tile_|decor_|background_)/.test(key)) return ctx.placed.has(key) ? 'boot' : 'play';

  if (key.startsWith('item_')) {
    const chain = itemChainOf(key);
    return chain && ctx.bootChains.has(chain) ? 'boot' : 'play';
  }

  return BOOT_PREFIXES.some((p) => key.startsWith(p)) ? 'boot' : 'play';
}

/**
 * The chain an `item_<chain>_<tier>` key belongs to.
 *
 * Chain ids contain underscores (`ember_dragon`, `cinder_vein`), so the tier is
 * split off the END, never by splitting on the first underscore. A key with no
 * numeric tier suffix has no chain to speak of.
 */
export function itemChainOf(key: string): string | null {
  const m = /^item_(.+)_(\d+)$/.exec(key);
  return m ? m[1]! : null;
}

/** Split the file-backed entries into the three waves, in one pass. */
export function splitWaves(
  entries: readonly AssetEntry[],
  ctx: WaveContext
): Record<AssetWave, AssetEntry[]> {
  const out: Record<AssetWave, AssetEntry[]> = { boot: [], play: [], ondemand: [] };
  for (const entry of entries) out[waveFor(entry.key, ctx)].push(entry);
  return out;
}
