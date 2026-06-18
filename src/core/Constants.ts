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

/** Most Warmth a skip can cost — paid when the timer has just started. */
export const GENERATOR_SKIP_MAX_ENERGY = 8;

/**
 * Energy to skip a generator's remaining wait. EXPENSIVE near the start and it
 * CHEAPENS as the timer runs down (cost ∝ fraction remaining), so finishing the
 * last stretch is nearly free. Always ≥ 1 while anything remains.
 */
export function skipEnergyCost(remainingMs: number, totalMs: number): number {
  if (remainingMs <= 0) return 0;
  if (totalMs <= 0) return 1;
  const frac = Math.min(1, Math.max(0, remainingMs / totalMs));
  return Math.min(GENERATOR_SKIP_MAX_ENERGY, Math.max(1, Math.ceil(GENERATOR_SKIP_MAX_ENERGY * frac)));
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
  dragon: 0.42
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
  flame_gem_1: 0.15,
  // Timber loop art (Decors/): wood 273×240, house 361×380, big tree 622×823.
  lumber_1: 0.5, // a small log
  lumber_2: 1.0, // a house reads ~1.4 tiles
  bigtree_1: 0.62 // a tall landmark tree
};

/** Energy. */
export const ENERGY_MAX = 20;
export const ENERGY_REGEN_MS = 30_000;
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
 * Live rigged dragon on the board (hatchling/whelp). Enters mirrored
 * (facing RIGHT) celebrating, then alternates idle/celebrate weighted so it is
 * idle ~90% of the time. Durations in ms; scales are RigPlayer display scales.
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
  groundLift: 10, // px the rig sits above the tile centre so feet meet the floor
  /** Worker harvest (Phase 3): the dragon flies to a tapped plant, works, returns. */
  flyToMs: 520, // glide out to the plant
  workMs: 700, // breathing magic onto the plant before the loot drops
  flyBackMs: 480 // glide home
} as const;

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

/** Save. */
export const SAVE_KEY = 'emberkeep_save';
export const SAVE_VERSION = 1;

/** Audio master volumes 0..1. */
export const AUDIO = {
  master: 0.8,
  sfx: 0.9,
  ambient: 0.16
} as const;

export const SCENES = {
  boot: 'BootScene',
  preload: 'PreloadScene',
  title: 'TitleScene',
  board: 'BoardScene',
  ui: 'UIScene'
} as const;
