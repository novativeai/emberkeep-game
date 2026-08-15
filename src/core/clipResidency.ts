/**
 * DRAGON CLIP RESIDENCY — what the board may hold, and what it must hand back.
 *
 * A dragon clip set is the heaviest thing in the game by an order of magnitude.
 * A spritesheet is uploaded as ONE RGBA surface, so an atlas costs
 * `frameWidth × frameHeight × frames × 4` bytes resident whether it is drawn or
 * not: `porcelain_adult` alone is 128 MB across its three clips, and the eleven
 * breeds together are 1,659 MB. That is why booting them all killed the tab on
 * iOS (see `687be7b`).
 *
 * Fetching lazily fixed the BOOT number and nothing else. `ensureDragonClips`
 * pays per breed the first time one appears, but nothing ever released a breed
 * again — so a session that merged frost → storm → emerald → moonwhisker walked
 * straight back toward the original gigabyte, one breed at a time, and the only
 * thing standing between a long session and a killed tab was how many breeds the
 * player happened to touch.
 *
 * This module is the missing half: a byte budget and an LRU order, so the board
 * holds the breeds it is SHOWING and hands back the ones it is not.
 *
 * Phaser-free on purpose (it takes a `TextureBin`, not a Scene), exactly like
 * `worldArt.ts` — the rule about what may stay resident is a rule the unit tests
 * can check rather than something only a browser can tell you.
 */
import { boardClipCharacters, clipKey, clipsFor, dragonClipCharacter } from './characterAnims';
import type { SaveDataV1 } from './types';
import type { TextureBin } from './worldArt';

/**
 * Decoded bytes one clip character costs once its sheets are resident.
 *
 * Derived from the frame geometry rather than the file size: a 3 MB WebP decodes
 * to 50 MB of RGBA, and it is the DECODED figure that decides whether the tab
 * survives. Padding cells in the atlas grid are not counted — Phaser uploads the
 * image, so this is a floor, but it is the same floor for every breed and that
 * is what makes the comparison honest.
 */
export function clipBytesFor(characterId: string): number {
  let bytes = 0;
  for (const clip of Object.values(clipsFor(characterId))) {
    bytes += clip.frameWidth * clip.frameHeight * clip.frames * 4;
  }
  return bytes;
}

/** Every texture key this clip character owns. */
export function clipKeysFor(characterId: string): string[] {
  return Object.keys(clipsFor(characterId)).map((clipId) => clipKey(characterId, clipId));
}

export interface EvictionRequest {
  /** Clip characters whose sheets are resident now. */
  resident: Iterable<string>;
  /**
   * Clip characters that must NOT be evicted: anything with a sprite standing on
   * it right now. Evicting a texture out from under a live sprite null-crashes
   * the renderer, which kills Phaser's RAF chain and freezes the whole game —
   * the same hazard `releaseAwayWorldArt` guards against.
   */
  pinned: ReadonlySet<string>;
  /** `performance.now()`-style stamp of the last time each character was wanted. */
  lastUsedAt: ReadonlyMap<string, number>;
  budgetBytes: number;
}

/**
 * Which resident characters to drop to get back under budget, oldest first.
 *
 * Pinned characters are counted against the budget but never evicted: if the
 * board is genuinely showing more dragons than the budget allows, the honest
 * answer is to go over rather than to blank a dragon the player is looking at.
 * The budget is a target for what we KEEP AROUND, not a cap on what we may show.
 */
export function planClipEviction(req: EvictionRequest): string[] {
  const resident = [...req.resident];
  let total = resident.reduce((sum, id) => sum + clipBytesFor(id), 0);
  if (total <= req.budgetBytes) return [];

  const candidates = resident
    .filter((id) => !req.pinned.has(id))
    .sort((a, b) => (req.lastUsedAt.get(a) ?? 0) - (req.lastUsedAt.get(b) ?? 0));

  const evict: string[] = [];
  for (const id of candidates) {
    if (total <= req.budgetBytes) break;
    evict.push(id);
    total -= clipBytesFor(id);
  }
  return evict;
}

/** Drop every texture this clip character owns. @returns the keys actually freed. */
export function releaseClips(bin: TextureBin, characterId: string): string[] {
  const freed: string[] = [];
  for (const key of clipKeysFor(characterId)) {
    if (!bin.exists(key)) continue;
    bin.remove(key);
    freed.push(key);
  }
  return freed;
}

/**
 * True when this id is a BOARD-DRAGON clip character.
 *
 * The residency budget governs dragons and nothing else. Character and map-decor
 * clips (Eleanor, Selyna, the Runevault cauldron) are WORLD art: they are fetched
 * at a world's door and released from `worldArtKeys` when the player leaves, and
 * a second owner evicting them on a byte budget would fight that rule and pull a
 * standee's sheets out from under her mid-conversation.
 */
export function isDragonClipCharacter(characterId: string): boolean {
  return dragonClipIds().has(characterId);
}

let dragonIds: Set<string> | null = null;
function dragonClipIds(): Set<string> {
  dragonIds ??= new Set(boardClipCharacters());
  return dragonIds;
}

/**
 * The dragon breeds a SAVE will put on screen, read straight off the persisted
 * board — so the boot preload can fetch them before the board exists.
 *
 * This is the half of the lazy-clip fix that was never actually running.
 * `PreloadScene` used to derive the same list from `ctx.state.items`, but the
 * save is not hydrated until `ctx.beginRun()`, which `UIScene.create()` calls two
 * scenes later — so the set was empty on EVERY boot, new game or not, and every
 * breed was fetched mid-gameplay during the restore pass instead: a 3-5 MB fetch
 * and a 40-130 MB GPU upload with the board already on screen and running.
 *
 * Reading the save directly is what makes it work at the only moment it can. The
 * board is `activeWorld`'s, not the authored world's — a save that quit in
 * Borealis resumes in Borealis, and it is Borealis's dragons that must arrive
 * before the board does.
 */
export function savedDragonClips(save: SaveDataV1 | null, authoredWorldId: string): string[] {
  if (!save) return [];
  const world = save.activeWorld ?? authoredWorldId;
  const items = world === authoredWorldId ? save.items : (save.boards?.[world]?.items ?? []);
  const skins = save.dragonSkins ?? {};
  const ids = new Set<string>();
  for (const item of items) {
    const id = dragonClipCharacter(item.chain, item.tier, skins[item.chain] ?? null);
    if (id) ids.add(id);
  }
  return [...ids];
}
