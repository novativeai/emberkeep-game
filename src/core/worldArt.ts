/**
 * PER-WORLD ART — what belongs to one world, and what it costs to leave.
 *
 * Phaser-free on purpose (it takes a `TextureBin`, not a Scene), so the rule
 * about which world may hold which texture is a rule the unit tests can check
 * rather than something only a browser can tell you.
 */
import { clipKey, clipsFor } from './characterAnims';
import { STANDEE_BANKS, WORLD_ID } from './Constants';
import type { GameContext } from './Context';

/**
 * Every texture that belongs to ONE world and to no other: its backdrop, and the
 * standee banks of the characters who live there.
 *
 * ONE list, used for both loading and unloading, and that is the point rather
 * than a convenience — a world's art is fetched from this list when you arrive
 * and released from the same list when you leave, so the two can never drift
 * apart into a leak. Anything shared (items, tiles, UI, VFX, portraits) is
 * absent by construction and is never touched.
 */
export function worldArtKeys(ctx: GameContext, worldId: string): string[] {
  const world = ctx.state.worlds.get(worldId);
  const keys = (world?.map.backgrounds ?? []).map((b) => `background_${b.name}`);
  for (const cfg of ctx.data.characters.characters) {
    if (cfg.world !== worldId) continue;
    const art = cfg.art ?? cfg.id;
    const bank = STANDEE_BANKS[art];
    if (bank) keys.push(...Object.values(bank.keys));
    // …and her Align-Studio clips, which are by far the heaviest thing a
    // character brings: a frame sheet is stored DECODED, so Selyna's four
    // clips are ~104 MB of video memory from 4.8 MB of WebP. PreloadScene
    // fetches the arriving world's; without them listed here nothing ever
    // handed the departing world's back, and travel only ever added.
    for (const clipId of Object.keys(clipsFor(art))) keys.push(clipKey(art, clipId));
  }
  // The map's own decor (the Hatchery cauldron, and whatever a world stands
  // up next). Boot only preloads the ACTIVE map's decor, so a travelling
  // player fetches the destination's at the door — and hands it back when
  // they leave, exactly like the backdrop.
  const map = world?.map;
  for (const d of map?.mapDecor ?? []) {
    keys.push(`decor_${d.name}`);
    // A decor piece can carry Align-Studio clips exactly like a character —
    // the cauldron's boil loop lives under the character id of the SAME name.
    // Listed here for the same reason the characters' clips are: a frame
    // sheet is stored decoded, so travel must hand the departing world's back.
    for (const clipId of Object.keys(clipsFor(d.name))) keys.push(clipKey(d.name, clipId));
  }
  for (const d of map?.decor3d ?? []) keys.push(`decor_${d.name}`);
  for (const d of map?.startingDecor ?? []) keys.push(`decor_${d.decor}`);
  for (const r of map?.regions ?? []) for (const d of r.decor ?? []) keys.push(`decor_${d.decor}`);
  return keys;
}

/**
 * Drop the GPU memory held by every world that is not the one on screen.
 *
 * A backdrop is 2610×1632 and costs its video memory from the moment it is
 * uploaded, drawn or not — so a session that wandered through three worlds would
 * otherwise carry all three for the rest of its life, and the board you came
 * home to would run on what the ones you visited left over. Called at the end of
 * every BoardScene build rather than on the travel event, so it self-corrects
 * whatever route got us here (travel, a restart, or Title → Play after a reset).
 *
 * The AUTHORED world is deliberately exempt. Its backdrop is in the boot preload
 * and is the baseline every session already pays; evicting it would only trade
 * memory the game has always used for a re-fetch on the most common journey
 * there is — coming home. The rule this enforces is that visiting a world never
 * leaves the others worse off than before, not that the game holds nothing.
 */
export function releaseAwayWorldArt(bin: TextureBin, ctx: GameContext): string[] {
  // Art the ACTIVE world is showing right now is untouchable no matter which
  // other worlds also list it. Wardrobes are shared — Eleanor stands in both
  // Emberkeep and Roothold wearing one bank — and evicting a texture under a
  // live sprite null-crashes the renderer, which kills Phaser's RAF chain and
  // freezes the whole game (loader, scene ops, travel — everything).
  const keep = new Set(worldArtKeys(ctx, ctx.state.worldId));
  const freed: string[] = [];
  for (const id of ctx.state.worlds.keys()) {
    if (id === ctx.state.worldId || id === WORLD_ID) continue;
    for (const key of worldArtKeys(ctx, id)) {
      if (keep.has(key) || !bin.exists(key)) continue;
      bin.remove(key);
      freed.push(key);
    }
  }
  return freed;
}

/** The sliver of `Phaser.Textures.TextureManager` the eviction needs — declared
 *  so the rule above can be unit-tested in node, like every other rule. */
export interface TextureBin {
  exists(key: string): boolean;
  remove(key: string): void;
}
