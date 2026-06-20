/**
 * Every tunable in Emberkeep lives here or in src/data/*.json.
 * Systems and scenes must not contain magic numbers.
 */

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

/** True when the primary input is touch (phone/tablet). */
export const IS_MOBILE: boolean =
  typeof window !== 'undefined' &&
  (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);

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

/** Warmth spent to instantly clear a generator's cooldown (the "skip" button). */
export const GENERATOR_SKIP_ENERGY = 3;

/** Most GOLD a skip can cost — paid when the timer has just started. */
export const GENERATOR_SKIP_MAX_ENERGY = 9;

/**
 * Skip a generator's remaining wait. Two ways: GOLD (the default) or ENERGY
 * (cheaper). Both are EXPENSIVE near the start and CHEAPEN as the timer runs
 * down (cost ∝ fraction remaining). Always ≥ 1 while anything remains.
 *   skipEnergyCost = the GOLD price; skipWarmthCost ≈ 0.55× (the cheaper Warmth).
 */
export function skipEnergyCost(
  remainingMs: number,
  totalMs: number,
  maxGold: number = GENERATOR_SKIP_MAX_ENERGY
): number {
  if (remainingMs <= 0) return 0;
  if (totalMs <= 0) return 1;
  const frac = Math.min(1, Math.max(0, remainingMs / totalMs));
  return Math.min(maxGold, Math.max(1, Math.ceil(maxGold * frac)));
}
/** Warmth (energy) price of a skip — cheaper than the Gold price (e.g. 10 min
 *  ≈ 5 Warmth vs 9 Gold). Scales with the SAME per-generator `maxGold`, so a
 *  dearer skip can't be dodged by paying Warmth. 0 when nothing remains. */
export function skipWarmthCost(
  remainingMs: number,
  totalMs: number,
  maxGold: number = GENERATOR_SKIP_MAX_ENERGY
): number {
  const gold = skipEnergyCost(remainingMs, totalMs, maxGold);
  return gold <= 0 ? 0 : Math.max(1, Math.round(gold * 0.55));
}

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
export const ITEM_SCALE: Record<string, number> = {
  // reward/egg.png (396×501) and reward/ruby.png (474×382) are ~2× the old
  // placeholder art — scale down so a gem reads ~1 tile wide (SVG-sized).
  // Egg + ruby reduced 70% on request (small speckled egg / small ruby shard).
  ember_dragon_1: 0.18,
  ember_dragon_2: 0.064, // Red Egg (red-egg.png 1162×1437) — −20% again on request (0.08 → 0.064)
  ember_dragon_3: 1.0, // Red Dragon rig host — same canvas scale as the Green Dragon
  flame_gem_1: 0.15,
  // Timber loop art (Decors/): wood 273×240, house 361×380, big tree 622×823.
  lumber_1: 0.336, // a log (wood.png) — reduced 30% on request (0.48 → 0.336)
  lumber_2: 0.9, // a house reads ~1.4 tiles (−10% on request)
  bigtree_1: 0.31, // the level-2 wood tree — reduced 50% on request
  chest_1: 0.24, // a treasure chest (chest.png) — reduced 20% on request (0.30 → 0.24)
  // Crystal landmark (803×902), diamond reward (518×387), gold coin (432×357).
  crystal_1: 0.4, // ~1.3 tiles
  emerald_1: 0.25, // Emerald gem (emerald.png 467×392)
  emerald_2: 0.064, // Green Egg (green-egg.png 1147×1438) — −20% again on request (0.08 → 0.064)
  emerald_3: 1.0, // dragon host (the rig overlays it)
  golden_egg_1: 0.10, // Golden Egg (golden-egg.png 1176×1451) — same scale as red/green egg
  coin_1: 0.12, // SMALLER than an egg, per spec
  coin_2: 0.20  // Gold Pouch — bigger than the single coin (0.12)
};

/** Chains collected by TAP into a currency. Coin → +1 Gold (flies to the gauge). */
export const COLLECTIBLE_REWARD: Record<string, { coins: number }> = {
  coin: { coins: 1 },
  coin_2: { coins: 5 }
};

/**
 * Chains that exist in chains.json (the unit tests use `sparkweed` as their
 * generic merge chain) but must NEVER spawn in the live game. The map can still
 * reference them; `BoardSystem`/`UnlockSystem` skip them at spawn, so we erase
 * the flower (Spark Weed → Ember Bloom) WITHOUT editing the authored map.
 */
export const HIDDEN_CHAINS = new Set<string>(['sparkweed']);

/** A standing treasure chest readies a fresh gift every this-many ms (10 min). */
export const CHEST_INTERVAL_MS = 600_000;

/**
 * Recurring treasure-chest gifts. The chest is a PERMANENT fixture: every
 * CHEST_INTERVAL_MS a gift is ready; claiming it grants ONE of these at random,
 * then the chest recharges (it never disappears). `coins` is currency; `item`
 * pops that many merge pieces onto free tiles by the chest. (No wood — lumber
 * appears only when its cloud zone clears.) Designers tune it here, not in code.
 */
export const CHEST_GIFTS: ReadonlyArray<
  | { kind: 'coins'; amount: number; label: string }
  | { kind: 'item'; chain: string; tier: number; count: number; label: string }
> = [
  { kind: 'coins', amount: 5, label: '+5 🪙' },
  { kind: 'item', chain: 'emerald', tier: 1, count: 3, label: '3 Emeralds!' },
  { kind: 'item', chain: 'ember_dragon', tier: 1, count: 3, label: '3 Rubies!' }
];

/** Gold (coins) spent to skip a generator timer — dynamic like the energy cost
 *  was, but paid in Gold now. Expensive at the start, ~1 near the end. */
export const SKIP_GOLD_MAX = 8;

/** Energy. */
export const ENERGY_MAX = 20;
/** Warmth a brand-new game starts with — 2 below max, so the tutorial's free
 *  Ember Spark visibly tops the gauge back to full (18/20 → 20/20). */
export const ENERGY_START = 18;
export const ENERGY_REGEN_MS = 180_000; // 1 Warmth every 3 minutes
export const ENERGY_REGEN_AMOUNT = 1;

/**
 * Cumulative XP to reach each Keeper level (index 0 = level 1 = 0 xp).
 * A smooth quadratic curve (gaps 60 → 80 → 110 → 150 → 190 → 230). The whole
 * scripted tutorial earns ~54 XP, so the FIRST level-up lands a beat AFTER it —
 * which is exactly when the first zone (level 2) wakes and the camera flies to
 * reveal it. Tying the first level-up to that cinematic expansion makes it the
 * payoff moment, while the curve never walls. See `docs/research/xp-pacing.md`.
 */
export const LEVEL_XP = [0, 60, 140, 250, 400, 590, 820] as const;

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
  followTau: 70,
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
  ember_dragon: 0.448 // red dragon −20% again on request (0.56 → 0.448)
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

/** Save. Bump SAVE_VERSION whenever the map/chains change incompatibly, so old
 *  localStorage saves are discarded on load (Context.beginRun → newGame) instead
 *  of layering stale items onto the new map. v1→v2: map/items reshuffled (red
 *  dragon→ruby, golden egg, region contents) left phantom wood + a duplicate
 *  House on deployed saves; v2 forced a clean départ-0 for them. v2→v3: chests no
 *  longer drop wood — wipe saves that already banked that loose wood / 2nd House.
 *  v3→v4: the chest is now a PERMANENT recurring gift box — wipe saves whose
 *  one-shot chest was already consumed so it comes back. v4→v5: tutorial reworked
 *  (House energy-skip, repositioned dragons/chest) — wipe so deployed players get
 *  the same fresh départ-0 as a local run. */
export const SAVE_KEY = 'emberkeep_save';
export const SAVE_VERSION = 5;

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
  ui: 'UIScene'
} as const;
