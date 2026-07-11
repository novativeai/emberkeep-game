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

/** Most GOLD a skip can cost — paid when the timer has just started. */
export const GENERATOR_SKIP_MAX_ENERGY = 9;

/** Warmth skip premium over the Gold price. Gold is the sink-starved plentiful
 *  currency, so it is the CHEAP way to skip; Warmth is the session meter and
 *  must never be the discount option (it was 0.55× — an inverted incentive). */
export const SKIP_WARMTH_MULTIPLIER = 1.5;

/**
 * Skip a generator's remaining wait. Two ways: GOLD (the default, cheaper) or
 * WARMTH (premium). Both are EXPENSIVE near the start and CHEAPEN as the timer
 * runs down (cost ∝ fraction remaining). Always ≥ 1 while anything remains.
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
/** Warmth (energy) price of a skip — dearer than the Gold price (never let the
 *  session meter be the discount skip). Scales with the SAME per-generator
 *  `maxGold`, so a dearer skip can't be dodged by switching currency. */
export function skipWarmthCost(
  remainingMs: number,
  totalMs: number,
  maxGold: number = GENERATOR_SKIP_MAX_ENERGY
): number {
  const gold = skipEnergyCost(remainingMs, totalMs, maxGold);
  return gold <= 0 ? 0 : Math.max(1, Math.round(gold * SKIP_WARMTH_MULTIPLIER));
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
  ember_dragon_1: 0.13, // Dragon Ruby — reduced ~28% on request (0.18 → 0.13)
  ember_dragon_2: 0.064, // Red Egg (red-egg.png 1162×1437) — −20% again on request (0.08 → 0.064)
  ember_dragon_3: 0.21, // Red Dragon: real baked rig art (1054px) at the live rig's on-board size
  flame_gem_1: 0.15,
  // Timber loop art (Decors/): wood 273×240, house 361×380, big tree 622×823.
  lumber_1: 0.336, // a log (wood.png) — reduced 30% on request (0.48 → 0.336)
  lumber_2: 0.9, // a house reads ~1.4 tiles (−10% on request)
  bigtree_1: 0.17, // the level-2 wood tree — reduced again on request (0.22 → 0.17)
  chest_1: 0.24, // a treasure chest (chest.png) — reduced 20% on request (0.30 → 0.24)
  strawberry_1: 0.65, // emberberry sprout — reduced again on request (0.85 → 0.65)
  strawberry_2: 0.8, // emberberry bush — reduced on request
  strawberry_3: 0.78, // the emberberry plant — back UP on request (0.58 → 0.78); t3 should read biggest
  // Crystal landmark (803×902), diamond reward (518×387), gold coin (432×357).
  crystal_1: 0.4, // ~1.3 tiles
  emerald_1: 0.18, // Emerald gem (emerald.png 467×392) — reduced ~28% on request (0.25 → 0.18)
  emerald_2: 0.064, // Green Egg (green-egg.png 1147×1438) — −20% again on request (0.08 → 0.064)
  emerald_3: 0.21, // Green Dragon: baked rig art (1054px), same treatment as the red
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

/* ------------------------- the Chapter One finale ------------------------- */

/** The Golden Egg MacGuffin: chain + the tier the finale AWAKENS it into —
 *  not a hatchling but the legendary Golden Elder, asleep since the Great
 *  Flame was taken. */
export const GOLDEN_CHAIN = 'golden_egg';
export const GOLDEN_ELDER_TIER = 2;
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
  /** Elder rig display scale at the altar (rig pieces ~550px). */
  elderScale: 0.34,
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
  // (The Golden Elder is NOT a board dragon — her altar scale lives in
  //  GOLDEN_ALTAR.elderScale.)
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
 *  the same fresh départ-0 as a local run. v5→v6: Chapter One demo retune —
 *  stats/finale counters added to the save, LEVEL_XP re-curved, golden_egg grew
 *  an Elder tier — wipe so every save carries the new fields + curve. */
export const SAVE_KEY = 'emberkeep_save';
export const SAVE_VERSION = 6;

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
