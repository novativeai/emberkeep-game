/**
 * Every tunable in Emberkeep lives here or in src/data/*.json.
 * Systems and scenes must not contain magic numbers.
 */

import type { DayPhase } from './types';

/** Emberkeep palette (string form for Canvas2D, use num() for Phaser). */
export const PALETTE = {
  lava: '#E8503C',
  lavaShade: '#C73A2E',
  lavaHighlight: '#FF8A66',
  gold: '#F7A437',
  goldShade: '#D9821F',
  goldAccent: '#FFD84D',
  plum: '#4A3845',
  plumShade: '#3A2B38',
  plumHighlight: '#6A5468',
  teal: '#3FA8D9',
  tealDeep: '#2E7FA6',
  ash: '#8E8A93',
  ashShade: '#6E6A75',
  moss: '#7ECB4F',
  mossShade: '#5FA63D',
  cream: '#FFF6E8',
  textBrown: '#B5602F',
  white: '#FFFFFF',
  night: '#241B22'
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** '#RRGGBB' -> 0xRRGGBB for Phaser tint/fill APIs. */
export const num = (hex: string): number => parseInt(hex.slice(1), 16);

/**
 * Internal render resolution. The canvas renders at 2560x1600 and FIT-scales
 * to the window, so the game is crisp on retina/2x displays ("1440p feel").
 * RES is the multiplier applied to the texture painter; all world/UI
 * coordinates are already expressed in this hi-res space.
 */
export const RES = 2;
export const GAME_WIDTH = 2560;
export const GAME_HEIGHT = 1600;

/**
 * HUD bonus widgets that can be hidden from the UI while KEEPING all their code
 * (the classes AND their systems stay wired — flip a flag back to `true` to bring
 * the bonus back with zero other changes). Turned OFF to strip the free-reward /
 * duel bonuses from the game UI for now; nothing is deleted.
 */
export const HUD_WIDGETS: {
  sparkWell: boolean;
  milestoneGift: boolean;
  dragonDuel: boolean;
  dragonGauges: boolean;
  questPanel: boolean;
} = {
  sparkWell: false, // Emberfont "Spark Well" orb (StokeMeter) — free gem/ruby/emerald on tap
  milestoneGift: false, // 🎁 milestone quest-reward button (gives coins on claim)
  dragonDuel: false, // ✌️ Dragon Duel launcher + arena
  dragonGauges: false, // red/green duel gauges — now shown per-dragon on tap (BoardScene), not as a fixed HUD
  // The top-right quest toggle + its remaining-count badge. OFF to match main's
  // barer top bar. The QuestSystem keeps running underneath and the tutorial's
  // speech bubbles are untouched — this hides the panel, it does not remove the
  // quests. Flip to `true` and the button comes back exactly as it was.
  questPanel: false
};

/**
 * World teleport: the FIRST time the "ruby" is assembled, the "Demon" dragon
 * teleports (VFX) and the game switches to another editor world (e.g. borealis).
 * All fields are tunable — retarget the ruby chain/tier, the dragon, or the world
 * without touching code. `triggerTier` = the tier whose CREATION counts as
 * "assembling the ruby" (an item:merged with chain===triggerChain &&
 * resultTier===triggerTier). `toWorld` matches an editor map's NAME.
 */
export interface WorldTeleportConfig {
  enabled: boolean;
  /** 'hatch' = dragon invoked; 'merge' = ruby assembled; 'tutorial_done' = the whole
   *  tutorial checklist finished; 'golden_awaken' = the Golden Egg bursts (the finale). */
  trigger: 'hatch' | 'merge' | 'tutorial_done' | 'golden_awaken';
  triggerChain: string;
  triggerTier: number;
  dragonChain: string;
  toWorld: string;
  /** The tier of the world's own dragon to SEED on first entry (borealis: the
   *  Golden Elder; roothold: the Red Dragon of the lair). */
  dragonTier?: number;
  /** Chain seeded as harvestable sprouts on first entry (roothold's Emberberries). */
  seedChain?: string;
  /** Single night fixture seeded on first entry (roothold's Dew Basin, which fills
   *  only during the `night` phase — chains.json `generator.phases`). */
  basinChain?: string;
  /**
   * This world keeps a dragon OF ITS OWN, seeded on entry. Worlds own their boards
   * outright, so no piece can be in two of them at once: a lair that wants a dragon
   * standing in it has to be given one. (Before boards were per-world, roothold's
   * Red Dragon was nb2's, merely shown in both — the day that stopped, the lair
   * stood empty.) The dragon's LEVEL is per-chain, so feeding her here is feeding
   * the same Red Dragon the isle knows.
   */
  dragonOwned?: boolean;
}

export const WORLD_TELEPORT: WorldTeleportConfig = {
  enabled: true,
  trigger: 'tutorial_done', // fire the teleport once the whole tutorial CHECKLIST is finished (all 15 tasks), not on the Red Dragon hatch — else the later steps (green dragon, chest, house…) never run
  triggerChain: 'flame_gem', // (merge mode only) "the ruby" — the red Flame Gem chain
  triggerTier: 2, // (merge mode only) assembling the first tier-2 Flame Gem = "the first ruby"
  dragonChain: 'ember_dragon', // "Demon" — the dragon that is invoked + teleports
  toWorld: 'roothold', // the editor world to switch to (map name) = "level 3" (roothold.webp)
  dragonTier: 3, // the Red Dragon herself (ember_dragon_3) stands in her lair
  dragonOwned: true, // …and she is ROOTHOLD's — the isle keeps its own (see dragonOwned)
  seedChain: 'strawberry', // Emberberry sprouts to merge + feed the Red Dragon
  basinChain: 'dew_basin' // the lair's Dew Basin — waters a berry only at night
};

/** True when the primary input is touch (phone/tablet). */
export const IS_MOBILE: boolean =
  typeof window !== 'undefined' &&
  (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);

/**
 * True on iOS/iPadOS Safari (incl. iPadOS masquerading as Mac + touch). WebKit
 * caps a tab's renderer-process memory FAR lower than Android Chrome, so the
 * heaviest GPU paths are trimmed here (skip the second live WebGL context, render
 * at a leaner backing) to stay under the "A problem repeatedly occurred" crash.
 */
export const IS_IOS: boolean =
  typeof window !== 'undefined' &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent)));

/**
 * Weak device (low RAM or few CPU cores) — a cheap Android or an old/GPU-less PC.
 * `deviceMemory` (GB, capped at 8; unset on Safari) and `hardwareConcurrency` are
 * the only coarse signals a browser exposes; either being low is enough to trip
 * the aggressive downgrade (leaner backing, no second WebGL context) that keeps
 * the tab under its GPU-memory budget instead of crashing the page. iOS is always
 * treated as at-least this constrained. When neither signal is present we assume
 * capable (desktop/high-end) so we never needlessly degrade a strong machine.
 */
export const IS_LOW_END: boolean =
  IS_IOS ||
  (typeof navigator !== 'undefined' &&
    ((typeof (navigator as { deviceMemory?: number }).deviceMemory === 'number' &&
      (navigator as { deviceMemory?: number }).deviceMemory! <= 4) ||
      (typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 4)));

/**
 * HUD / popup magnification on mobile portrait. The UI is authored in the fixed
 * 2560-wide space; on a phone that space FIT-scales to ~15%, so gauges/buttons
 * render at half the size a thumb needs. Clusters multiply by this (anchored to
 * their screen corner) and popups fill the portrait width. `1` on desktop — the
 * landscape layout is untouched. See `panelMobileScale`.
 */
export const UI_SCALE: number = IS_MOBILE ? 1.5 : 1;

/** Uniform scale so a centred popup FRAME of `frameWidth` fills ~94% of the
 *  portrait width. `1` on desktop. Capped so a small frame never balloons. */
export function panelMobileScale(frameWidth: number): number {
  if (!IS_MOBILE) return 1;
  return Math.min(2.2, (GAME_WIDTH * 0.94) / frameWidth);
}

/**
 * Viewport height in game-space units.
 * On desktop stays at GAME_HEIGHT (1600) — no change (e2e/landscape untouched).
 * On mobile the game is PORTRAIT: GAME_WIDTH (2560) spans the phone's SHORT side
 * (full width) and the coordinate space grows TALLER to match the portrait aspect,
 * so FIT fills the screen with zero bars and the board pans vertically. The 2.4×
 * cap keeps a near-square tablet (or an extreme aspect) from a runaway backing.
 */
export const LIVE_GAME_HEIGHT: number = (() => {
  if (typeof window === 'undefined' || !IS_MOBILE) return GAME_HEIGHT;
  const shortSide = Math.min(window.innerWidth, window.innerHeight); // portrait width
  const longSide = Math.max(window.innerWidth, window.innerHeight); // portrait height
  return Math.round(GAME_WIDTH * Math.min(2.4, longSide / shortSide));
})();

/** Isometric 2:1 projection. */
export const TILE_W = 256;
export const TILE_H = 128;
export const BOARD_COLS = 8;
export const BOARD_ROWS = 8;
/** World position of the centre of tile (0,0). */
export const BOARD_ORIGIN_X = GAME_WIDTH / 2;
export const BOARD_ORIGIN_Y = 316;

/** Render depth bands (within BoardScene). */
export const DEPTHS = {
  sky: 0,
  cliffs: 4,
  tiles: 10,
  tileHighlight: 40,
  itemBase: 100, // + screenY
  fogBase: 1300, // + screenY — shared by board fog AND the world cloud field
  // The authored 51×24 board pushes screenY (and so itemBase+y) up to ~5100,
  // so the always-on-top bands sit far above that.
  dragged: 50000,
  particles: 52000,
  flash: 54000
} as const;

/** When a dragon's passive gift has nowhere to land, retry this soon (ms). */
export const GENERATOR_PASSIVE_RETRY_MS = 8000;


/**
 * Spring-bounce timing for scenery (world-builder decor + tree tiles). The Back
 * ease overshoots like a lazy spring; a long rest between hops keeps it calm.
 * Trees animate 15% FASTER (durations ÷ 1.15) on request.
 */
export const DECOR_BOUNCE = { riseMs: 820, hold: 90, restMs: 1700, rise: 18 } as const;
export const TREE_BOUNCE_SPEEDUP = 1.15;
/** Tile-art names (in tilesByCell) that should spring-bounce like decor. */
export const ANIMATED_TILE_NAMES = ['tree-1', 'tree-2', 'tree-3', 'tree-4', 'sapin'];

/**
 * On-board render scale for file-based decor, keyed by decor chain. Placeholder
 * decor (nest/brazier) is painted at tile size, but real-art files can be huge
 * (the baked dragon is 1054px ≈ 4 tiles), so they need fitting. ~0.42 lands the
 * guardian dragon at ~1.7 tiles wide. Anything absent renders at scale 1.
 */
export const DECOR_SCALE: Record<string, number> = {
  dragon: 0.42,
  // Landmark trees read too tall in the higher zones — halve them (−50%).
  tree_2: 0.5
};

/**
 * On-board render scale for file-based ITEM art, keyed by `<chain>_<tier>`
 * (preferred) or bare `<chain>`. Absent → 1. Lets a single PNG read bigger
 * without re-exporting art (e.g. the red dragon egg looks small at native size).
 */
/**
 * How much smaller borealis' own pieces are drawn than the isle's — THE knob for
 * "the pieces are too big for the ground up there".
 *
 * Borealis runs on its OWN cell lattice (172 × 92px, adopted from the grids it was
 * hand-drawn with) against the isle's 256 × 147.5. Art sized for the isle therefore
 * stands ~1.5× too large on it and overflows the diamond it sits in. Pure geometry
 * says 172/256 = 0.67; this is deliberately smaller, so a piece sits INSIDE its cell
 * with air around it rather than filling it edge to edge.
 *
 * It applies only to chains that declare `world: "borealis"` — the Golden Elder
 * standing there is the isle's art at the isle's scale and must not shrink with them.
 * One number: raise it toward 0.67 if the pieces now read as too small.
 */
export const BOREALIS_ART = 0.4;

export const ITEM_SCALE: Record<string, number> = {
  // Mergeable board PIECES use nionja's −40% sizing (small speckled eggs, gem
  // shards, rubies). Generators + dragon rig HOSTS keep main's baked-rig-art
  // scale (their art differs from nionja's, so nionja's numbers don't apply).
  ember_dragon_1: 0.108, // Dragon Ruby — nionja −40% piece
  ember_dragon_2: 0.0384, // Red Egg — nionja −40% piece
  ember_dragon_3: 0.21, // Red Dragon: baked rig art (1054px) — main's scale
  ember_dragon_4: 0.45, // Adult Red Dragon: baked adult rig (836px) — main's scale
  // The Flame Gem chain, drawn at last: tiers 2 and 3 were PLACEHOLDERS painted by
  // TextureFactory at runtime — the ruby the whole tutorial is about was programmer
  // art past its first tier. Tier 1 keeps its exact size; 2 and 3 step up gently.
  flame_gem_1: 0.150, // Gem Shard  — art 310px opaque
  flame_gem_2: 0.154, // Flame Gem  — art 390px opaque
  flame_gem_3: 0.164, // Ruby       — art 462px opaque
  // Timber loop art (Decors/): wood 273×240, house 361×380, big tree 622×823.
  lumber_1: 0.2016, // a log / Bush — nionja −40% piece
  lumber_2: 0.72, // the House generator — main's scale
  lumber_3: 0.82, // the Manor — main's scale
  bigtree_1: 0.17, // Ancient Tree generator — main's scale
  chest_1: 0.19, // Treasure Chest fixture — main's scale
  // Emberberry, from main's drawn set (2026-08-06) — the PLANT chain, not the
  // harvest one: main split them, and tier 3 here is the generator that fruits, so
  // it has to be a laden bush, never the jam jar the other chain ends on.
  // The art is TRIMMED — opaque
  // box ≈ frame — where the old sprites were 42% content in a 240px frame, so the
  // scales are re-derived to land the same on-board size, not carried over.
  // 55 / 70 / 94 game px wide, the family this build already reads as one chain.
  strawberry_1: 0.170, // Emberberry sprout — art 323px opaque
  strawberry_2: 0.131, // Emberberry bush   — art 534px opaque
  strawberry_3: 0.152, // Emberberry plant  — art 620px opaque
  // Crystal landmark (803×902), diamond reward (518×387), gold coin (432×357).
  crystal_1: 0.4, // Crystal generator — main's scale
  emerald_1: 0.15, // Emerald gem — nionja piece size
  emerald_2: 0.0384, // Green Egg — nionja −40% piece
  emerald_3: 0.21, // Green Dragon: baked rig art (1054px) — main's scale
  emerald_4: 0.45, // Adult Emerald Dragon: baked adult rig (836px) — main's scale
  golden_egg_1: 0.06, // Golden Egg — nionja −40% piece
  // Golden Elder as a BOARD piece (borealis seeds her): her stand-in art is the
  // red-dragon bake (1054px, see assets.json) until the golden rig attaches, so
  // she wears the same scale as the other 1054px baked dragons. Missing, she
  // rendered at scale 1 — a giant red dragon filling the aurora world.
  golden_egg_2: 0.21,
  coin_1: 0.072, // Gold Coin — nionja −40% piece
  coin_2: 0.12, // Gold Pouch — nionja −40% piece
  // The lair's Dew Basin, now real art (365×372) in place of the painted stand-in.
  dew_basin_1: 0.4, // ≈149px — a waist-high fixture, not a landmark
  /*
   * Borealis' four cold chains (EMB-10 art, trimmed natives 288–520px). The base
   * number is the isle's own sizing — a merge PIECE reads ~100px at T1 and ~120px
   * at T2 (an Emberberry bush is 115), a finished T3 ~140, a tappable T3 GENERATOR
   * ~190 so it reads as a fixture you visit rather than a piece you drag — and then
   * BOREALIS_ART lands it on borealis' ground. Scaled off the TRIMMED height:
   * retrim the art and these have to be redone.
   */
  driftwood_1: 0.237 * BOREALIS_ART, // Frozen Plank (422px)
  driftwood_2: 0.232 * BOREALIS_ART, // Bound Bundle (518px)
  driftwood_3: 0.365 * BOREALIS_ART, // Kindled Pile (520px) — generator
  tarknot_1: 0.316 * BOREALIS_ART, // Pitch Stone (316px)
  tarknot_2: 0.264 * BOREALIS_ART, // Pressed Tarknot (454px)
  tarknot_3: 0.269 * BOREALIS_ART, // Burning Heart (520px)
  rimebloom_1: 0.347 * BOREALIS_ART, // Frost Star (288px)
  rimebloom_2: 0.255 * BOREALIS_ART, // Rime Cluster (471px)
  rimebloom_3: 0.365 * BOREALIS_ART, // Rimebloom (520px) — generator
  frostsilk_1: 0.245 * BOREALIS_ART, // Silk Spool (408px)
  frostsilk_2: 0.231 * BOREALIS_ART, // Frostsilk Skein (520px)
  frostsilk_3: 0.269 * BOREALIS_ART // Loaded Spindle (520px)
};

/**
 * Ambient WEATHER, per world. A world absent from here has none, which is every
 * world but borealis — the isle is warm and the lair is underground.
 *
 * It is drawn by UIScene, not the board: UIScene owns a fixed 2560×1600 camera, so
 * the fall stays vertical and screen-filling whatever the board camera is doing
 * (zoom, level glide, a drag pushing the view). Weather belongs to the window you
 * look through, not to the ground.
 */
export const WORLD_WEATHER: Record<string, 'snow'> = {
  borealis: 'snow'
};

/**
 * Borealis' snowfall. `flakes` is how many are alive at once — the emitter derives
 * its own frequency from it and the lifespan, so this is the ONE number to move for
 * "more snow" / "less snow", and the only one that costs anything.
 *
 * Sizes span 0.3 → 1.05 on purpose: the small, slow, faint ones read as distance and
 * do most of the work, while a handful of big ones crossing the frame sell the
 * parallax. Everything falls with a constant lateral wind, so the whole field drifts
 * as one weather rather than as independent dots.
 */
export const SNOWFALL = {
  flakes: 110,
  /** Phones get a third of it — same look, a third of the overdraw. */
  mobileFactor: 0.35,
  speedY: { min: 90, max: 230 },
  /** The wind. Negative = leftward, matching the isle's light coming upper-left. */
  speedX: { min: -70, max: -18 },
  scale: { min: 0.3, max: 1.05 },
  alpha: { min: 0.32, max: 0.85 },
  /** Long enough for the slowest flake to cross 1600px and leave the frame. */
  lifespanMs: { min: 7000, max: 15000 },
  /** A cold blue-white — pure white reads as UI, not as weather. */
  tint: 0xeaf6ff
} as const;

/** Chains collected by TAP into a currency. Coin → +1 Gold (flies to the gauge). */
export const COLLECTIBLE_REWARD: Record<string, { coins: number }> = {
  coin: { coins: 5 }, // Gold Coin — the House drops one each cycle
  coin_2: { coins: 10 } // Gold Pouch (3 coins merged) — worth the merge
};

/**
 * Chains that exist in chains.json (the unit tests use `sparkweed` as their
 * generic merge chain) but must NEVER spawn in the live game. The map can still
 * reference them; `BoardSystem`/`UnlockSystem` skip them at spawn, so we erase
 * the flower (Spark Weed → Ember Bloom) WITHOUT editing the authored map.
 */
export const HIDDEN_CHAINS = new Set<string>(['sparkweed']);

/** A standing treasure chest readies a fresh gift every this-many ms (5 min —
 *  the demo's "something free arrives on a rhythm" beat, DEMO-PLAN §3). */
export const CHEST_INTERVAL_MS = 300_000;

/**
 * Recurring treasure-chest gifts. The chest is a PERMANENT fixture: every
 * CHEST_INTERVAL_MS a gift is ready; claiming it grants ONE of these at random,
 * then the chest recharges (it never disappears). `coins` is currency; `item`
 * pops that many merge pieces onto free tiles by the chest. (No wood — lumber
 * appears only when its cloud zone clears.) Designers tune it here, not in code.
 */
/** How far (manhattan tiles) a reward drop may land from its source. Beyond
 *  this the drop is BLOCKED (harvest fails / chest pays Gold / passive skips)
 *  — rewards must never teleport across the map or off the platforms. */
export const REWARD_SPAWN_RADIUS = 3;

/**
 * Battery governor (PowerGovernor): the loop runs at full rate only while the
 * player is interacting; an untouched board throttles down in two steps. All
 * gameplay timing is wall-clock (GameClock.now), so render fps never affects
 * logic or determinism.
 *
 * activeFps is 62, not 60, on purpose: Phaser's fps.limit skips a step when the
 * accumulated delta is a hair under the limit-rate, so 60 on a 60 Hz display
 * micro-stutters (~55 real fps). 62 fires every vsync at 60 Hz and halves a
 * 120 Hz display to 60 — the cap costs nothing on standard screens.
 */
export const POWER = {
  activeFps: 62,
  idleFps: 30,
  dozeFps: 15,
  /** No input/gameplay for this long → idle (30 fps). */
  idleAfterMs: 10_000,
  /** …and for this long → doze (15 fps, ambient FX + crystal paused). */
  dozeAfterMs: 45_000,
  /** Gameplay bus events hold ACTIVE this long (finale beats hold longer). */
  eventHoldMs: 10_000,
  finaleHoldMs: 45_000,
  /** Crystal3D re-render cadence per state; it PAUSES entirely in doze. */
  crystalMs: { active: 33, idle: 100 }
} as const;

/** How far (manhattan tiles) a sub-world's furniture may stand from its dragon
 *  before `board:gather` walks it back. Generous on purpose: a piece the player
 *  moved on purpose stays put; only a garden left at the far rim is collected. */
export const LAIR_GATHER_RADIUS = 5;
/** Per-world one-shot: this world's furniture has been gathered once (stat key
 *  prefix + world id). It is a REPAIR of layouts seeded before the anchor rule,
 *  not a rule of the room — running it every visit would undo the player's own
 *  arrangement. */
export const LAIR_GATHERED_STAT = 'lairGathered:';

export const CHEST_GIFTS: ReadonlyArray<
  | { kind: 'coins'; amount: number; label: string }
  | { kind: 'item'; chain: string; tier: number; count: number; label: string }
> = [
  { kind: 'coins', amount: 15, label: '+15 🪙' },
  { kind: 'item', chain: 'emerald', tier: 1, count: 3, label: '3 Emeralds!' },
  { kind: 'item', chain: 'ember_dragon', tier: 1, count: 3, label: '3 Rubies!' }
];

/** Energy. */
export const ENERGY_MAX = 30;
/** Warmth a brand-new game starts with — 2 below max, so the tutorial's free
 *  Ember Spark visibly tops the gauge back toward full. */
export const ENERGY_START = 28;
export const ENERGY_REGEN_MS = 60_000; // 1 Warmth every minute (cozy session gate, not a wall)
export const ENERGY_REGEN_AMOUNT = 1;

/**
 * Cumulative XP to reach each Keeper level (index 0 = level 1 = 0 xp).
 * The scripted tutorial earns exactly 60 XP (26 + 24 hatches + 10 scripted), so
 * the Level-2 beat lands ON the tutorial's `levelup` step. Level 3 (220) is the
 * demo's finale and is tuned so it lands on Order 3's delivery (DEMO-PLAN §Act
 * IV XP ledger: 60 tutorial + O1 30 + merges ~24 + O2 35 + optional hatch ~24
 * + merges ~34 + O3 50 ≈ 257 — orders pay XP in big chunks, so the level-up
 * fires on a delivery, the right beat). The array ENDS at 3 on purpose: the
 * chapter is complete — the XP bar never fills toward nothing.
 */
export const LEVEL_XP = [0, 60, 220] as const;

/** Max Warmth grows by this much per Keeper level (level 1 = ENERGY_MAX). */
export const ENERGY_PER_LEVEL = 3;
export function levelForXp(xp: number): number {
  let level = 1;
  for (let i = 0; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]!) level = i + 1;
  return level;
}
export function energyMaxForLevel(level: number): number {
  return ENERGY_MAX + Math.max(0, level - 1) * ENERGY_PER_LEVEL;
}

/** Level-up reward: full Warmth refill (handled by EnergySystem) + this Gold. */
export const LEVELUP_REWARD = {
  coinsBase: 25,
  coinsPerLevel: 15
} as const;

/**
 * The Emberfont — the anti-idle "Spark Well" (see EmberfontSystem). It slowly
 * fills with Sparks (a small ember pool); tapping it draws a *vein* — one merge
 * piece dropped onto the play area — so an idle keep still trickles fodder to
 * come back to. Active merging *stokes* the well: fill the Stoke bar and it
 * SURGES — Sparks recharge far faster and every merge grants bonus XP — which
 * rewards long, sustained sessions. All values are tunable here (no magic
 * numbers in the system). Times in ms.
 */
export const EMBERFONT = {
  maxSparks: 5,
  startSparks: 5,
  /** Idle drip: one Spark every this-many ms. */
  rechargeMs: 30_000,
  /** While Surging: one Spark every this-many ms (~5× the idle rate). */
  surgeRechargeMs: 6_000,
  stokeMax: 100,
  /** Stoke gained per merge (5 merges fill the bar → Surge). */
  stokePerMerge: 20,
  /** Idle Stoke cooldown: lose this much every `stokeDecayMs`. */
  stokeDecayPerTick: 5,
  stokeDecayMs: 4_000,
  /** How long a Surge lasts once triggered. */
  surgeMs: 20_000,
  /** Bonus XP granted per merge while Surging. */
  surgeXpBonus: 2
} as const;

/**
 * Dragon Duel — the rock-paper-scissors level-up mode (see DragonDuelSystem).
 * Unlocks once every dragon is hatched AND the Keeper is level ≥ 2. You pick a
 * dragon to train, pay `energyCost` for a set of `matchesPerSet` auto-battles
 * against a random OTHER owned dragon whose throws are biased weak (`winRate`),
 * and each win adds `winGauge` to that dragon's 0..`gaugeMax` level gauge. A
 * dragon's own passive production ("work") drips `workGauge`. Filling the gauge
 * levels the dragon up (+reward, gauge carries the overflow). Tunables only.
 */
export const DUEL = {
  matchesPerSet: 3,
  energyCost: 2,
  winGauge: 3,
  workGauge: 1,
  gaugeMax: 100,
  countdownMs: 3000,
  /** Player win / tie probabilities per match (remainder = loss). Opponent weak. */
  winRate: 0.62,
  tieRate: 0.13,
  /** Coins granted when a dragon's gauge fills and it levels up. */
  levelReward: { coinsBase: 20, coinsPerLevel: 10 }
} as const;

/**
 * Dragon feeding & the Emberberry food loop (see DragonFeedSystem + the tap-menu
 * food/hunger gauges). Food = the `strawberry` chain; the ripe "main sprout"
 * (tier 3, chains.json) drips one leaf every `hungerMs` passively, or you buy one
 * for Gold. Each feed is a BIG beat: it jumps the dragon and pays the Keeper.
 */
export const DRAGON_FEED = {
  chain: 'strawberry', // the food items (any tier) the dragon eats
  /** The tier the STOCK gauge counts: the Emberberry BUSH (T2), not the sprout (T1).
   *  A sprout is raw material you still have to merge; the bush is what the dragon
   *  is actually offered, so it is the only number worth putting on the HUD. */
  stockTier: 2,
  dragonLevelsPerFeed: 5, // +5 to the dragon's level per feed
  keeperXpPerFeed: 60, // game (Keeper) XP each feed pays — moves the bar where not capped
  hungerMs: 600_000, // 10 min from a feed until the dragon is fully hungry
  foodFull: 5, // food count that fills the "food" gauge to the brim
  buyGold: 40 // Gold to buy one leaf instantly (the "via des achats" path)
} as const;

/**
 * Time-of-day food preferences: a dragon listed here REFUSES food outside its
 * hour ("she'll only take it at dusk"). Absent chain = eats around the clock —
 * the Red Dragon (`ember_dragon`) deliberately stays unrestricted, because the
 * tutorial quest chain feeds it and must never wait on the sky.
 */
export const DRAGON_FEED_PHASE: Record<string, DayPhase> = {
  emerald: 'dusk' // the Emerald dragon takes her berry only in the dusk light
};

/* ----------------------------- the four-phase day ----------------------------- */

/** The ring, in order. Phase index = floor(now / phaseMs) % 4. */
export const DAY_PHASES: readonly DayPhase[] = ['morning', 'day', 'dusk', 'night'];

/**
 * The day: four coarse phases of 8 minutes = a 32-minute round. This is NOT a
 * simulated calendar — four phases is all the design needs (time-of-day food
 * preferences, the night-only Dew Basin) and it costs a fraction of a real
 * day-cycle system.
 *
 * The ring is anchored to WORLD time (`GameClock.now()`), not to the session, so
 * it keeps turning while you are away — "come back at night" means something.
 * Every read goes through the clock, so `window.advanceTime(ms)` steps it
 * deterministically (DayCycleSystem + src/core/dayCycle.ts).
 */
export const DAY_CYCLE = {
  phaseMs: 480_000, // 8 min per phase → 32 min a full day
  /** Cross-fade time when the sky grade rolls into a new phase. */
  fadeMs: 2600,
  /** Player-facing phase names (float text, tooltips). */
  label: {
    morning: 'morning',
    day: 'daylight',
    dusk: 'dusk',
    night: 'night'
  } as Record<DayPhase, string>,
  /**
   * The SKY GRADE: a full-screen wash the board lays over whatever backdrop the
   * live world ships, so every world (nb2, roothold, borealis) reads the same
   * hour with zero per-world authoring. Daylight is the neutral, ungraded pass.
   */
  grade: {
    morning: { color: 0xffc489, alpha: 0.1 },
    day: { color: 0xffffff, alpha: 0 },
    dusk: { color: 0xff7a46, alpha: 0.2 },
    night: { color: 0x1d2a6e, alpha: 0.36 }
  } as Record<DayPhase, { color: number; alpha: number }>
} as const;

/* ------------------------- the Chapter One finale ------------------------- */

/** The Golden Egg MacGuffin: chain + the tier the finale AWAKENS it into —
 *  not a hatchling but the legendary Golden Elder, asleep since the Great
 *  Flame was taken. */
export const GOLDEN_CHAIN = 'golden_egg';
export const GOLDEN_ELDER_TIER = 2;

/** The SECOND world teleport: when the Golden Egg bursts (the finale awakening),
 *  the Golden dragon travels to the aurora world "borealis" — the golden mirror of
 *  the Red Dragon's roothold lair. Its own Golden dragon is SEEDED there on entry
 *  (there's no golden board item in nb2 — she's born of the burst), is movable but
 *  never re-teleports (the once-guard). Only switches if a "borealis" map exists. */
export const WORLD_TELEPORT_BOREALIS: WorldTeleportConfig = {
  enabled: true,
  trigger: 'golden_awaken',
  triggerChain: GOLDEN_CHAIN,
  triggerTier: GOLDEN_ELDER_TIER,
  dragonChain: GOLDEN_CHAIN,
  toWorld: 'borealis',
  dragonTier: GOLDEN_ELDER_TIER, // seed the Golden Elder in borealis on first entry
  dragonOwned: true // she's born of the burst — belongs to borealis, hidden in nb2
};

/** Every world teleport (roothold, then borealis). WorldTeleportSystem arms each with
 *  its own once-guard; BoardScene looks a world's config up by name. */
export const WORLD_TELEPORTS: WorldTeleportConfig[] = [WORLD_TELEPORT, WORLD_TELEPORT_BOREALIS];
/** Gold tint worn by the Golden Elder's stand-in art (red-dragon bake) if the
 *  golden rig fails to load — remove alongside the assets.json swap. */
export const GOLDEN_TINT = 0xffd84d;
/** The fogged region the finale glimpses into (the "south terrace" promise). */
export const FINALE_REGION = 'level_5';
/** XP progress within level 2 past which the Golden Egg starts trembling. */
export const GOLDEN_TREMBLE_PROGRESS = 0.8;

/**
 * The GOLDEN ALTAR — the scenic, NON-playable ledge west of the isle where the
 * whole golden lore plays out: the egg appears there when Cindra's first order
 * completes, trembles there as Level 3 nears, AWAKENS into the Golden Elder
 * there, and the Elder stands there for the encore (communing taps).
 * Authored in the world builder (`golden-egg.json`: decor `golden-egg` at
 * world cell (-8,-2) = current-map cell (-2,2) after the +6,+4 normalization);
 * `calibration` is the builder's measured placement for the egg art. It is a
 * SCENE FIXTURE, not a board item — never merges, sells, drags, or works.
 */
export const GOLDEN_ALTAR = {
  cell: { col: -2, row: 2 }, // off-grid is fine — gridToWorld is unbounded
  calibration: { offsetX: 135, offsetY: -137, scale: 0.13, anchor: { x: 0.5, y: 0 } },
  /** Elder rig display scale at the altar (rig pieces ~550px) — the legendary
   *  Golden Elder reads bigger than a board dragon (upsized on request). */
  elderScale: 0.44,
  /** Completing THIS order makes the egg appear on the altar. */
  orderId: 'cindra_brazier'
} as const;

/**
 * Keeper Level 3 finale choreography (DEMO-PLAN §THE FINALE). One timeline,
 * shared by BoardScene (hatch → camera fly → fog half-glimpse → return) and
 * UIScene (Cindra's first line → the chapter card) so the two scenes stay in
 * step without cross-scene calls. All ms from the keeper:leveled(3) beat.
 */
export const FINALE = {
  hatchAtMs: 900, // camera glides WEST to the Golden Altar…
  awakenAtMs: 2000, // …where the Golden Egg cracks: the Elder AWAKENS
  flyAtMs: 3400, // camera glides to the south terrace
  flyMs: 1600,
  glimpseAtMs: 5000, // fog parts halfway…
  glimpseHoldMs: 2400, // …a 2.4s look at the warm light…
  fogDipAlpha: 0.32, // …then the ash settles back
  returnAtMs: 8000, // camera returns to the player's zone
  cindraAtMs: 8600, // Cindra speaks — for the first time in the demo
  cardAtMs: 12600, // the Chapter One card
  cindraHoldMs: 5200 // her line stays up until just before the card
} as const;

/* --------------------------- welcome-back moment -------------------------- */

/** Only show the "While you were away" card after a real absence. */
export const WELCOME_BACK_MIN_MS = 300_000;
/** Passive producers bank up to this many overdue cycles while offline — a
 *  small waiting harvest (never 1, never unlimited; MECHANICS §4.3). */
export const OFFLINE_BANK_CYCLES = 3;
/** Item motion & juice timings (ms unless noted). */
export const TIMINGS = {
  dragReturn: 220,
  mergeGather: 130,
  mergePop: 260,
  spawnPop: 240,
  hatchShake: 420,
  hatchPop: 380,
  fogLift: 900,
  fogStaggerPerTile: 38,
  warmFlash: 1100,
  tileBloom: 700,
  harvestHop: 240,
  bubbleIn: 240,
  bobPeriodMs: 2400,
  bobAmplitudePx: 5.2,
  fogPulsePeriodMs: 4200,
  readyPulse: 600
} as const;

/**
 * Drag feel (Fairyland / Merge-Dragons style — see docs/research/drag-feel.md).
 * The dragged item EASES toward the pointer (exponential smoothing) instead of
 * locking 1:1, lifts with a ground shadow, and the target cell lights up.
 */
export const DRAG = {
  /** Pick-up scale-up and how high the art floats above the finger (px). */
  liftScale: 1.16,
  liftY: -34,
  liftMs: 120,
  settleMs: 150,
  /** Exponential-smoothing time constant (ms): lower = snappier follow. */
  followTau: 50,
  /** Ground shadow under a lifted item. */
  shadowRX: 58,
  shadowRY: 22,
  shadowY: 30,
  shadowAlpha: 0.28,
  shadowColor: 0x1a0f14,
  shadowFadeMs: 130,
  /** Highlight diamond on the cell under the dragged item. */
  cellHighlightAlpha: 0.5,
  cellHighlightColor: 0xffd27a
} as const;

/** Pointer forgiveness (game px) around the exact hit point when alpha-testing
 *  board-item art: near-misses on thin/holey sprites (sprout stems) still land,
 *  while big transparent corners keep yielding to the item behind. */
export const HIT_FORGIVENESS_PX = 14;

/**
 * Live rigged dragon on the board (hatchling/whelp). Enters in the rig's original
 * (un-mirrored, facing LEFT) orientation celebrating, then alternates idle/celebrate
 * weighted so it is idle ~90% of the time. Durations in ms; scales are RigPlayer
 * display scales.
 */
export const DRAGON_ANIM = {
  introCelebrateMs: 2400, // the grand entrance after hatching
  celebrateMs: 2000, // one celebration burst during the alternation
  idleMinMs: 4500,
  idleMaxMs: 6500,
  celebrateChance: 0.15, // P(celebrate) per cycle → ~90% of time spent idle
  /** ADULT dragons (the tier-4 Red Adult, the Golden Elder) are calm, wise
   *  elders: the same idle + low-flight repertoire, but rolled far less often,
   *  held longer, and played slower — a whelp fidgets, an elder breathes. */
  adultIdleMinMs: 9000,
  adultIdleMaxMs: 15000,
  adultCelebrateChance: 0.06,
  adultCelebrateMs: 2600, // a single unhurried low-flight when it does happen
  adultSpeed: 0.62, // preset playback rate (breathing/wing-beat cadence)
  fadeInMs: 220,
  hatchlingScale: 0.34,
  whelpScale: 0.46,
  groundLift: -20, // px: negative moves rig DOWN so dragon feet land on the tile floor
  /** Worker harvest (Phase 3): the dragon flies to a tapped plant, works, returns. */
  flyToMs: 520, // glide out to the plant
  workMs: 700, // breathing magic onto the plant before the loot drops
  flyBackMs: 480 // glide home
} as const;

/** Per-dragon-chain rig scale factor so different art reads at the SAME on-board
 *  size. The emerald rig renders larger, so it's taken down 40% to match red. */
export const DRAGON_RIG_SCALE: Record<string, number> = {
  emerald: 0.486, // green dragon −10% again on request (0.54 → 0.486)
  ember_dragon: 0.448, // red dragon −20% again on request (0.56 → 0.448)
  // Adult Red Dragon (tier-4 rig override; adult rig pieces are ~836px wide vs
  // the whelp's 1054) — sized to read clearly BIGGER than the whelp on-board.
  // +50% on request (0.62 → 0.93), then back to 0.70: at 0.62 the adult read
  // SMALLER than the baby, at 0.93 it swallowed a whole platform in the sub-worlds.
  // 0.70 is 1.56× the whelp — unmistakably bigger, still a board piece.
  'ember_dragon:4': 0.7,
  // Adult Emerald Dragon: same rig geometry as the adult red (identical part
  // canvases/bounds), so it wears the same on-board scale.
  'emerald:4': 0.93,
  // The Golden Elder DOES stand on a board — borealis seeds her there (she also
  // stands on the altar, at GOLDEN_ALTAR.elderScale). She wears the ADULT rig,
  // whose part geometry matches the adult red's, but her tier is 2 so the base
  // scale is the hatchling's (0.34) rather than the whelp's (0.46). The factor
  // is dialled so she lands on the adult red's on-board size: 0.34 × 0.95 ≈
  // 0.46 × 0.70.
  golden_egg: 0.95
};

/**
 * Dragon Job system. A working dragon stands by a House and speeds every timed
 * object: each worker advances it DRAGON_WORK_PER_DRAGON seconds per real second,
 * so the rate is PER × workers (1 dragon = 2×, 2 = 4×, …). It tires after WORK_MS,
 * returns home and rests REST_MS before it can work again.
 */
export const DRAGON_WORK_MS = 180_000; // 3 minutes of work
export const DRAGON_REST_MS = 300_000; // then 5 minutes of rest (fatigue)

/** Seconds a single working dragon advances timers per real second. Total rate =
 *  PER × workers; the base 1× already comes from the clock, so the job system
 *  adds the remainder ((PER × workers − 1) × ms). */
export const DRAGON_WORK_PER_DRAGON = 2;

/** Input (game-resolution pixels; CSS pixels are half of these under FIT). */
export const TAP_MAX_DISTANCE_PX = 16;
export const TAP_MAX_MS = 350;

/** Ambient juice. */
export const EMBER_MOTES = {
  count: 14,
  minSpeedY: -28,
  maxSpeedY: -60,
  driftX: 24,
  minScale: 0.35,
  maxScale: 0.9,
  alpha: 0.5,
  lifespanMs: 9000
} as const;

/**
 * Ambient world atmosphere — the layered "the isle is alive" pass, near→far:
 * ember-flies drifting around the player's view, slow ember updrafts off the
 * lava seams, high mist sliding across the isles, and a warm vignette grade
 * over everything. Pure presentation: no state, no input, no gameplay timing.
 */
export const ATMOSPHERE = {
  /** Near layer: small orange ember-flies twinkling around the current view.
   *  MANY tiny sparks (a swarm, not a few bugs) — subtlety comes from the small
   *  scale and the sine-bell alpha, not from scarcity. */
  fireflies: {
    frequency: 320, // ms between spawns (emitter-paced; ~21 alive at a time)
    lifespanMs: 6800,
    speedMin: 6,
    speedMax: 22,
    scaleMin: 0.18,
    scaleMax: 0.4,
    alphaPeak: 0.5, // fades 0 → peak → 0 across the life (slow twinkle)
    tint: 0xffb03a
  },
  /** High mist drifting across the view — a soft depth-haze between the camera
   *  and the isles (the isles are baked into the backdrop, so "beneath" layers
   *  are impossible; overhead haze is what reads at this camera angle). */
  wisps: {
    count: 3,
    scale: [3.4, 4.6] as const,
    alpha: [0.045, 0.075] as const,
    crossMs: [260000, 420000] as const, // minutes per crossing — barely perceptible
    bobPx: 40,
    tint: 0xfff2e2, // sunset-warmed white
    depth: 48800
  },
  /** Finishing grade: warm dark vignette hugging the screen edges (UIScene). */
  vignette: {
    alpha: 0.16,
    color: '#2a0e12'
  }
} as const;

/** Save. Bump SAVE_VERSION whenever the map/chains change incompatibly, so old
 *  localStorage saves are discarded on load (Context.beginRun → newGame) instead
 *  of layering stale items onto the new map. v1→v2: map/items reshuffled (red
 *  dragon→ruby, golden egg, region contents) left phantom wood + a duplicate
 *  House on deployed saves; v2 forced a clean départ-0 for them. v2→v3: chests no
 *  longer drop wood — wipe saves that already banked that loose wood / 2nd House.
 *  v3→v4: the chest is now a PERMANENT recurring gift box — wipe saves whose
 *  one-shot chest was already consumed so it comes back. v4→v5: tutorial reworked
 *  (House energy-skip, repositioned dragons/chest) — wipe so deployed players get
 *  the same fresh départ-0 as a local run. v5→v8: the nionja↔main merge combines
 *  the Emberfont (Spark Well) + Dragon Duel per-dragon state with the Chapter One
 *  retune (stats/finale counters, re-curved LEVEL_XP, golden Elder tier) — one
 *  bump past both lineages (nionja v7, main v6) so every save seeds all the new
 *  fields cleanly from départ-0. */
export const SAVE_KEY = 'emberkeep_save';
export const SAVE_VERSION = 8;

/** Audio master volumes 0..1. */
export const AUDIO = {
  master: 0.8,
  sfx: 0.9,
  ambient: 0.16,
  music: 0.45 // looping background track (Dragonsland.mp3)
} as const;

export const SCENES = {
  boot: 'BootScene',
  preload: 'PreloadScene',
  title: 'TitleScene',
  board: 'BoardScene',
  ui: 'UIScene',
  uiEditor: 'UiEditorScene'
} as const;
