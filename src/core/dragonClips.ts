/**
 * DRAGON CLIP RESIDENCY — how many frame sheets a board is allowed to hold.
 *
 * A staged clip is stored DECODED: `frames × frameWidth × frameHeight × 4`
 * bytes of video memory, from the moment it uploads, drawn or not. That makes
 * dragon clips by far the most expensive art in the game and frame COUNT the
 * thing that does it — the red whelp's 184-frame `fly` alone is 50 MB, and its
 * full wardrobe is 106 MB from 6.7 MB of WebP.
 *
 * With one breed that was affordable. With the Emporium's six it is not: every
 * clip of every breed resident at once is **718 MB**, on a device whose whole
 * budget the audit put at ~174 MB. So residency is a RULE here rather than an
 * accident of what the player happened to hatch, and it stands on three legs:
 *
 *   1. `dragonClipCharacter` is skin-aware, so only the WORN wardrobe is ever
 *      askable — one breed per chain+tier, not the whole catalogue.
 *   2. A breed arrives in two waves (`clipLoadTiers`): what the player sees in
 *      the first second, and what waits for the beat that needs it. A hungry
 *      roar is 27-36 MB on the adults and plays for a second and a half, once
 *      a minute, only while hungry — paying for it up front is the easiest
 *      thing in this file to not do.
 *   3. `planClipEviction` is a hard ceiling with an LRU behind it, so the worst
 *      case is a NUMBER rather than a hope. Breeds no live dragon is wearing
 *      are handed back, least-recently-needed first, until the newcomer fits.
 *
 * Phaser-free on purpose, like worldArt.ts: what may be held and what must be
 * released is a rule the unit tests can check, not something only a browser
 * (and only a browser that crashes) can tell you.
 */
import { CHARACTER_ANIMS, type CharacterAnimsData, type CharacterClip, clipsFor } from './characterAnims';

/** RGBA, uncompressed — what a texture actually costs once uploaded. */
const BYTES_PER_PIXEL = 4;

/** Video memory one staged sheet occupies. */
export function clipVramBytes(clip: CharacterClip): number {
  return clip.frames * clip.frameWidth * clip.frameHeight * BYTES_PER_PIXEL;
}

/**
 * A breed's BOARD clips. Portrait clips are excluded here for the same reason
 * `worldArtKeys` excludes them: they belong to the dialogue bubble in UIScene,
 * a scene that outlives every board, and evicting one under a live portrait
 * null-crashes the renderer and hangs the game.
 */
export function breedClipIds(characterId: string, data: CharacterAnimsData = CHARACTER_ANIMS): string[] {
  return Object.entries(clipsFor(characterId, data))
    .filter(([, clip]) => clip.stage !== 'portrait')
    .map(([id]) => id);
}

/** Video memory a breed costs — all of its board clips, or the ones named. */
export function breedVramBytes(
  characterId: string,
  clipIds?: readonly string[],
  data: CharacterAnimsData = CHARACTER_ANIMS
): number {
  const clips = clipsFor(characterId, data);
  const ids = clipIds ?? breedClipIds(characterId, data);
  let total = 0;
  for (const id of ids) {
    const clip = clips[id];
    if (clip && clip.stage !== 'portrait') total += clipVramBytes(clip);
  }
  return total;
}

/**
 * Which clips are fetched the moment a breed's dragon stands on the board, and
 * which wait for the beat that needs them.
 *
 * `idle` is the floor and is never deferred — it is what `clipComplete` tests,
 * and a breed without it has no animal to draw at all. `fly` joins it because
 * the wings must answer the finger on the FIRST grab: a clip that arrives a
 * second late is a dragon that got slid across the board once, and that single
 * miss is exactly the thing the takeoff rate exists to fix.
 *
 * Everything else — the hungry roar, the curl into sleep — is a mood clip. Its
 * beat announces itself (a mood change, then a countdown) long before the
 * frames are drawn, so fetching it then costs nothing visible, and not fetching
 * it at all is what keeps a session that never starved a dragon from paying for
 * the bellow.
 *
 * `lean` is the weak-device tier: idle only. Flight falls back to the rig,
 * which is how every dragon moved before these clips existed and is still the
 * documented degrade path (`dragonClip` returns null → the rig plays). A
 * cheaper animal that runs beats a beautiful one on a crashed tab.
 */
export function clipLoadTiers(
  characterId: string,
  opts: { lean?: boolean } = {},
  data: CharacterAnimsData = CHARACTER_ANIMS
): { eager: string[]; deferred: string[] } {
  const ids = breedClipIds(characterId, data);
  const wanted = opts.lean ? ['idle'] : ['idle', 'fly'];
  const eager = ids.filter((id) => wanted.includes(id));
  const deferred = ids.filter((id) => !wanted.includes(id));
  return { eager, deferred };
}

/** One resident sheet: a breed and which of its clips. */
export interface ClipRef {
  breed: string;
  clip: string;
}

const refId = (r: ClipRef): string => `${r.breed}/${r.clip}`;

export interface ClipEvictionRequest {
  /**
   * Sheets an overlay is DRAWING right now. Never dropped, whatever the budget
   * says: pulling a texture out from under a live sprite does not blank it, it
   * null-crashes the renderer and kills Phaser's RAF chain — the whole game
   * freezes, which is worse than any overspend.
   */
  playing?: Iterable<ClipRef>;
  /**
   * Breeds a dragon standing on the board is wearing. Their EAGER sheets (the
   * idle it rests on, the fly the next grab needs) stay too — those are what
   * the animal is made of, and losing them mid-session is a dragon that blinks
   * out or stops flying rather than a saving.
   */
  live: Iterable<string>;
  /** Sheets holding memory, LEAST-recently-needed first. */
  resident: readonly ClipRef[];
  /** Sheets about to be fetched. Counted against the budget; never dropped. */
  incoming?: readonly ClipRef[];
  budgetBytes: number;
  lean?: boolean;
  data?: CharacterAnimsData;
}

export interface ClipEvictionPlan {
  /** Sheets to hand back, in the order they should go. */
  drop: ClipRef[];
  /** What stays resident once they have gone, including `incoming`. */
  keptBytes: number;
  /**
   * True when what may not be dropped still overspends. Reported rather than
   * forced: the only way further down is evicting a texture a live animal is
   * made of, and that costs either a vanished dragon or a frozen game.
   */
  overBudget: boolean;
}

/**
 * Choose which sheets to hand back so a newcomer fits under the ceiling.
 *
 * Two ranks, each least-recently-needed first:
 *
 *   1. Everything belonging to a breed NOTHING is wearing — the whelp you
 *      merged into an adult, the skin you switched away from, the breed left
 *      behind in another world. Free to take; the player cannot tell.
 *   2. The MOOD sheets of breeds that are worn (the hungry roar, the curl into
 *      sleep). They cost 27-36 MB on the adults and draw for a second and a
 *      half, a minute apart, only while the mood holds — so giving one back
 *      between beats is invisible, and the refetch when the mood returns comes
 *      off the HTTP cache. This is the rank that pays for the finale, where a
 *      whelp, an adult and the Elder can all be standing at once and their
 *      full wardrobes together are more than the ceiling allows.
 *
 * What is never offered: anything an overlay is drawing, and the eager sheets
 * of a live breed.
 */
export function planClipEviction(req: ClipEvictionRequest): ClipEvictionPlan {
  const data = req.data ?? CHARACTER_ANIMS;
  const clips = (breed: string): Record<string, CharacterClip> => clipsFor(breed, data);
  const cost = (r: ClipRef): number => {
    const clip = clips(r.breed)[r.clip];
    return clip && clip.stage !== 'portrait' ? clipVramBytes(clip) : 0;
  };

  const live = new Set(req.live);
  const playing = new Set([...(req.playing ?? [])].map(refId));
  const incoming = new Set((req.incoming ?? []).map(refId));

  const held = new Map<string, ClipRef>();
  for (const r of req.resident) held.set(refId(r), r);
  for (const r of req.incoming ?? []) held.set(refId(r), r);
  let bytes = 0;
  for (const r of held.values()) bytes += cost(r);

  // Rank 1 needs to know which of a live breed's sheets are load-bearing.
  const eagerOf = new Map<string, Set<string>>();
  for (const breed of live) eagerOf.set(breed, new Set(clipLoadTiers(breed, { lean: req.lean }, data).eager));

  const rank = (r: ClipRef): 0 | 1 | 2 => {
    if (playing.has(refId(r)) || incoming.has(refId(r))) return 2;
    if (!live.has(r.breed)) return 0;
    return eagerOf.get(r.breed)?.has(r.clip) ? 2 : 1;
  };

  const drop: ClipRef[] = [];
  for (const pass of [0, 1] as const) {
    for (const r of req.resident) {
      if (bytes <= req.budgetBytes) break;
      if (rank(r) !== pass) continue;
      drop.push(r);
      bytes -= cost(r);
    }
    if (bytes <= req.budgetBytes) break;
  }
  return { drop, keptBytes: bytes, overBudget: bytes > req.budgetBytes };
}
