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
 * Weak device (low RAM or few CPU cores) — a cheap Android or an old/GPU-less PC.
 * `deviceMemory` (GB, capped at 8; unset on Safari) and `hardwareConcurrency` are
 * the only coarse signals a browser exposes; either being low is enough to trip
 * the aggressive downgrade (leaner backing, fewer ambient particles) that keeps
 * the tab under its GPU-memory budget instead of crashing the page. iOS is always
 * treated as at-least this constrained. When neither signal is present we assume
 * capable (desktop/high-end) so we never needlessly degrade a strong machine.
 *
 * This is the SIZE axis — how much GPU memory the device can hold. `PowerGovernor`
 * is the RATE axis — how often we redraw. They are independent: a strong laptop on
 * battery wants the governor and not this; a cheap phone wants both.
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

/**
 * The bottom-right button column — Ledger, Bag, Cookbook, Store, bottom-up
 * (slots 0..3).
 *
 * It lives here because it is built in two files (Hud owns the Ledger, the Bag
 * and the Store, UIScene the Cookbook) and so drifts apart when each picks its
 * own offsets: the Bag was slotted in between the other two at a spacing that
 * put its plate straight on top of the Cookbook's.
 *
 * Slots 0–1 are live from the first frame; the Cookbook and the Store surface
 * when the tutorial hands the game over, so the column grows upward and never
 * reflows the buttons already under the player's thumb.
 *
 * `ui_btn_round` is painted 68 logical units wide around a disc of radius 29,
 * so at the column's 1.5× plate scale the VISIBLE disc is ~174 units across and
 * anything closer than that overlaps its neighbour. UI_SCALE magnifies each
 * button about its own centre, so the pitch scales with it.
 */
export const HUD_COLUMN_X: number = GAME_WIDTH - (IS_MOBILE ? 190 : 156);
export const HUD_COLUMN_PITCH: number = 200 * UI_SCALE;
export const hudColumnY = (slot: number): number =>
  LIVE_GAME_HEIGHT - (IS_MOBILE ? 260 : 168) - slot * HUD_COLUMN_PITCH;

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
  // Procedural SKY effects (the Borealis aurora). The authored backdrop is
  // drawn at `tiles - 1` and covers everything the camera can reach, so a sky
  // shader below it would never be seen: this sits just above the painting and
  // just below the floor, where the isles and everything standing on them
  // still draw over it.
  skyFx: 9.5,
  tiles: 10,
  tileHighlight: 40,
  itemBase: 100, // + screenY
  fogBase: 1300, // + screenY — shared by board fog AND the world cloud field
  // WEATHER falls in front of the whole board — snow passes between the player
  // and the isles — so it clears fogBase + screenY (~6400 at the widest board),
  // but stays under the always-on-top bands: a flake must never fall in front
  // of the piece in the player's hand.
  weather: 20000,
  // The authored 51×24 board pushes screenY (and so itemBase+y) up to ~5100,
  // so the always-on-top bands sit far above that.
  dragged: 50000,
  particles: 52000,
  flash: 54000
} as const;

/** When a dragon's passive gift has nowhere to land, retry this soon (ms). */
export const GENERATOR_PASSIVE_RETRY_MS = 8000;

/** Most GOLD a skip can cost — paid when the timer has just started. Skips are
 *  the demo's PREMIUM gold sink: a full skip should feel like a real spend
 *  (roughly one order reward / four banked House coins), not pocket change —
 *  the price still melts away as the timer drains, so patience is always the
 *  free alternative. (Was 6 — skipping cost barely more than the coin the
 *  House pays out, an almost-free loop.) */
export const GENERATOR_SKIP_MAX_ENERGY = 20;

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
  tree_2: 0.5,
  // The purchasable prop sets (store.json). Each is drawn standing on its own
  // small plinth, so the art IS the tile footprint — these land the plinth at
  // ~250 units, a hair under one tile (TILE_W 256), which is what stops two
  // neighbouring props from visually butting together.
  ash_urn: 0.6,
  watch_bell: 0.6,
  rekindled_step: 0.61,
  chain_anchor: 0.61,
  ice_lantern: 0.6,
  frozen_spill: 0.62,
  rune_pad: 0.64,
  drift_cairn: 0.62,
  // The LANDMARKS are a different class of prop and are scaled by a different
  // rule. An ornament is scaled so its plinth lands just under one tile, which
  // is what keeps a shelf of them from butting together — but doing that to a
  // monument makes a ruined gatehouse the size of an urn. These are scaled so
  // the FOOTPRINT still fits its tile while the thing standing on it rises well
  // above one: a whelp (ITEM_SCALE ember_dragon_3 ≈ 221 units tall) should read
  // as small beside every one of them, which is the entire point of buying one.
  keeper_statue: 0.72, // 392x683 -> 282 tall, on a ~200-wide base
  broken_arch: 0.4, // 725x900 — the widest of them; the base sets the cap
  ember_beacon: 0.62, // 461x709 -> 440 tall, the tallest silhouette
  elder_bones: 0.34, // 900x665 — a low, WIDE mound; width is the constraint
  tethered_isle: 0.44 // 458x898 — floats, so its mooring block is the footprint
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
  ember_dragon_4: 0.45, // Adult Red Dragon: baked adult rig (836px) — +50% on request (0.3 → 0.45); must read clearly bigger than the whelp
  // Flame Gems (chains/flame_gem_{1,2,3}: 320×300, 400×380, 480×470). Scales are
  // set so a Gem Shard reads at ~61px — the same on-board size as a Dragon Ruby,
  // its sibling collectible — and the tier ramp stays legible above it. (The old
  // 0.12 was tuned for the 518px generic `diamond.webp` this chain used to
  // borrow; keeping it would have shrunk the shard by nearly 40%.)
  flame_gem_1: 0.19,
  flame_gem_2: 0.21,
  flame_gem_3: 0.24,
  // Timber loop art. The chain gained a milling step — Cut Wood → Plank Set →
  // House → Manor — so the House and the Manor each moved DOWN one tier and
  // keep their tuned sizes under their new keys. Tiers 1–2 are new art cut from
  // assets/raw/merge-chains/lumber_t1_t2-seedream-pro.png; every scale here is
  // `target / longest side of the alpha bbox`, and the two new pieces sit on
  // the 74 → 100 step so the House at 274 still reads as the payoff.
  lumber_1: 0.187, // Cut Wood, 395×337 → 74 units (the old log's exact size)
  lumber_2: 0.217, // Plank Set, 460×454 → 100 units
  lumber_3: 0.72, // the House — reduced 20% on request (0.9 → 0.72)
  lumber_4: 0.82, // the Manor (manor.png 430×450) — a touch bigger than the House
  // Curled sleep paintings (their own pose, their own resolution). Each scale
  // reproduces the STANDING dragon's on-board footprint — a whelp rig is 666px
  // at whelpScale 0.46 ≈ 306 units — so a dragon lying down occupies the tile
  // the same way it did standing up.
  sleep_ember_dragon_3: 0.256, // curled whelp, alpha bbox 1193 → 306 units
  sleep_ember_dragon_4: 0.262, // curled adult, 1602 → 420 units
  bigtree_1: 0.17, // the level-2 wood tree — reduced again on request (0.22 → 0.17)
  // The Fir loop — what the Ancient Tree drops as it is worked, and what that
  // grows back into. Sized so the three steps READ as growth at a glance:
  // 66 → 88 → 140 units, the last of which is the Ancient Tree's own size,
  // because tier 3 IS a working tree (same art, same produce, same bonus).
  firgrain_1: 0.183, // Fir Grain, alpha bbox 291×360 → 66 units
  firgrain_2: 0.116, // Small Fir Tree, 617×758 → 88 units
  firgrain_3: 0.17, // shares bigtree.webp with the landmark bigtree_1
  chest_1: 0.19, // a treasure chest (chest.png) — reduced again on request (0.24 → 0.19)
  // The Emberberry plant, redrawn so its fruit IS the shipped Emberberry (cut
  // from assets/raw/merge-chains/emberberry_plant-seedream-pro.png). Each scale
  // reproduces the previous art's on-board size exactly, so nothing about the
  // board's read changes — only the painting.
  strawberry_1: 0.233, // sprout, 323×331 → 77 units
  strawberry_2: 0.217, // bush, 534×488 → 116 units
  strawberry_3: 0.252, // the ripe plant, 620×618 → 156 units; t3 reads biggest
  // Crystal landmark (803×902), diamond reward (518×387), gold coin (432×357).
  crystal_1: 0.4, // ~1.3 tiles
  emerald_1: 0.144, // Emerald gem (emerald.png 467×392) — reduced 20% again on request (0.18 → 0.144)
  emerald_2: 0.064, // Green Egg (green-egg.png 1147×1438) — −20% again on request (0.08 → 0.064)
  emerald_3: 0.21, // Green Dragon: baked rig art (1054px), same treatment as the red
  emerald_4: 0.45, // Adult Emerald Dragon: baked adult rig (836px) — same treatment as the adult red
  golden_egg_1: 0.10, // Golden Egg (golden-egg.png 1176×1451) — same scale as red/green egg
  coin_1: 0.12, // SMALLER than an egg, per spec
  coin_2: 0.15, // Gold Pouch — reduced 25% on request (0.20 → 0.15); still bigger than the coin (0.12)
  // ---- merge-chains.md roster (art registered in assets.json) ----
  // These shipped with no entry here, so they drew at scale 1 and a Cracked
  // Stone came out ~260px on the board — four times a Gem Shard. Every scale
  // below is `target / longest side of the art's ALPHA BBOX`, tiered
  // 66 / 88 / 112 units, which is where the tuned chains already sit (a Gem
  // Shard is 59, a log 74, an Emberberry Sprout 65). Canvas size is not the
  // measure: item_strawberry_1.png is a 240px canvas holding a 100px sprout.
  firepine_1: 0.26,
  firepine_2: 0.26,
  firepine_3: 0.14, // shares bigtree.webp with the landmark bigtree_1 (0.17)
  cinder_vein_1: 0.25,
  cinder_vein_2: 0.27,
  cinder_vein_3: 0.12, // shares crystal.webp with the landmark crystal_1 (0.4)
  dew_basin_1: 0.25,
  dew_basin_2: 0.26,
  dew_basin_3: 0.30,
  emberberry_1: 0.21,
  emberberry_2: 0.17,
  emberberry_3: 0.19,
  resin_1: 0.12,
  resin_2: 0.12,
  resin_3: 0.22,
  ashmoss_1: 0.24,
  ashmoss_2: 0.27,
  ashmoss_3: 0.24,
  // Stormcap and Nightbloom sit on the food ladder every sibling chain uses —
  // ~66 / 88 / 112 units on the longest side, so a tier reads at the same size
  // whichever chain it came from. Each scale is `target / longest side`.
  stormcap_1: 0.236, // Storm Cap, 263×280
  stormcap_2: 0.222, // Cap Cluster, 371×396
  stormcap_3: 0.245, // Charged Cap, 458×454
  nightbloom_1: 0.21, // Night Bud, 235×314 — the tall one, matched on height
  nightbloom_2: 0.263, // Night Bloom, 335×304
  nightbloom_3: 0.224, // Cooling Wreath, 501×426
  quartz_1: 0.20,
  quartz_2: 0.19,
  quartz_3: 0.21,
  moonwater_1: 0.16,
  moonwater_2: 0.20,
  moonwater_3: 0.20,
  nest_1: 0.33, // a Cold Nest is furniture a dragon sits in, not a merge piece
  // ---- Selyna's Borealis roster (merge-chains.md §2.4) ----
  // Same 66 / 88 / 112 tiering as the Emberkeep chains above, so a Drift Spar
  // reads at the size of a Gem Shard and the board stays legible across worlds.
  driftwood_1: 0.16,
  driftwood_2: 0.17,
  driftwood_3: 0.22,
  tarknot_1: 0.20,
  tarknot_2: 0.18,
  tarknot_3: 0.22,
  rimebloom_1: 0.21,
  rimebloom_2: 0.19,
  rimebloom_3: 0.22,
  frostsilk_1: 0.16,
  frostsilk_2: 0.17,
  frostsilk_3: 0.22
};

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
export const HIDDEN_CHAINS = new Set<string>([
  'sparkweed',
  // The husbandry roster (docs/merge-chains.md §2). Authored, drawn and wired,
  // and it belongs to the chapter that opens the Cold Nest — not to this one.
  // Chapter One has no nest, no feeding and no recipient for any of it, its
  // seeds sit in `level_5` — whose land opens at the Level-3 cap now, so THIS
  // SET is the only thing still holding them off the board — and
  // Eleanor's orders ask for Gem Shards. Left visible they were 12 permanent
  // "· · ·" rows in the Cookbook — a completion counter the chapter can never
  // let the player finish. Same rule, same fix, same one-line switch as the
  // Borealis block below.
  'firepine',
  'dew_basin',
  'nest',
  // NOT 'emberberry' — the Ripe Emberberry Plant the tutorial grants now yields
  // the berry itself (berry ×3 → basket ×3 → preserve), so this chapter both
  // produces the chain and can finish its two Cookbook rows. It stays husbandry
  // FUEL for the nest chapter; it is simply reachable a chapter earlier.
  // NOT 'resin' — the tutorial now TEACHES it, and teaches it end to end: three
  // beads off the old tree's bark become a Lump, three Lumps a Hearth Cake, and
  // the Cake goes to the Red Dragon, whose favourite it is (DRAGON_DIET). Both
  // its Cookbook rows are discovered inside the lesson, so it is not a "· · ·"
  // row the chapter cannot finish — it is the chapter's one worked example of
  // the whole husbandry idea. It stays RENEWABLE afterwards because the same
  // lesson commissions the House to press beads (`house_commission`), which is
  // the point of putting the two beats next to each other.
  // NOT 'ashmoss' — it is the one husbandry chain with no farm by design
  // (merge-chains.md §2: "restoration IS the moss supply"), which makes it the
  // only one Chapter One can honestly own. `ash_green` opens the game with it:
  // her arrival asks for "the warmth, the green, and whatever's still asleep",
  // and the green is the first thing the isle gives back.
  // NOT 'quartz' — the Theme Crystal sheds it now (it used to shed Emeralds),
  // which makes it the one MAGE_ONLY chain Chapter One has a live producer for.
  // The opening teaches it end to end in place of the old Emerald ladder:
  // `crystal_tap` → `quartz_merge` → `quartz_ball`, both Cookbook rows
  // discovered, and RENEWABLE afterwards off the same Crystal. It stays
  // recipient-locked to Eleanor (DragonSystem's MAGE_ONLY) — no tier of it ever
  // feeds a dragon, which is exactly the lore the new beats are about.
  // The two chains that give Storm and Moonwhisker a favourite of their own.
  // Same reason as `resin`: husbandry roster, no Chapter One source, so they
  // would sit in the Cookbook as permanent "· · ·" rows. They turn on with the
  // nest chapter, alongside the farms that will supply them.
  'stormcap',
  'nightbloom'
  // Selyna's Borealis roster USED to sit here. It does not belong here: this set
  // is "not this CHAPTER", and those four are "not this WORLD". They now carry
  // `world: "borealis"` in chains.json, which withholds them from Emberkeep and
  // — unlike a line in this set — turns them on by itself the moment the player
  // is standing in the north, with no second edit to forget. See `chainHiddenIn`
  // and docs/merge-chains.md §2.4.
]);

/**
 * Is this chain withheld from the world the player is standing in?
 *
 * Two unrelated reasons, deliberately kept apart:
 *   • **Wrong world** — the chain names a `world` that is not this one. Selyna's
 *     frozen roster is Borealis's vocabulary and must never appear in Emberkeep;
 *     Emberkeep's must never appear in hers.
 *   • **Wrong chapter** — `HIDDEN_CHAINS`. Authored, drawn and wired, but its
 *     recipient (the Cold Nest, the feeding loop) belongs to a later chapter of
 *     THIS world. Left visible they are permanent "· · ·" rows in the Cookbook.
 *
 * Structurally typed on purpose so this file stays free of chains.json.
 */
export function chainHiddenIn(chain: { id: string; world?: string }, worldId: string): boolean {
  if (chain.world !== undefined && chain.world !== worldId) return true;
  return HIDDEN_CHAINS.has(chain.id);
}

/**
 * The Bag — the player's off-board pocket. TAP a plain merge piece to store it,
 * open the bag and tap a slot to put it back. Storing is free and instantly
 * reversible on purpose: drag and tap are now two verbs on the same object, so a
 * player who taps when they meant to drag must lose nothing.
 *
 * Capacity counts DISTINCT stacks, not items — identical pieces pool into one
 * slot, so a full bag means "twelve different things", which is far rarer (and
 * far easier to reason about) than twelve objects.
 */
export const BAG_SLOTS = 12;

/** World-character action cooldown floor. Authored per character in
 *  `characters.json`; Regard shortens it later (docs/world-characters.md §4).
 *  Help is FREE — she is help, not a shop — so the cooldown is the only limit,
 *  which is why it is long. */
export const CHARACTER_COOLDOWN_MIN_MS = 60_000;

/* ---------------- Regard: the five hearts (docs/quests.md §1.3) -------------
 *
 * The relationship gauge for the two PEOPLE — Eleanor in the south, Selyna in
 * the north. Five hearts, and it is meant to be full at the very end of the
 * campaign and not one quest before it. That is a pacing number, so it is
 * derived rather than felt:
 *
 *   5 hearts × REGARD_POINTS_PER_HEART = 60 points to fill.
 *   A chapter quest pays REGARD_QUEST_POINTS ...... 60 / 3 = 20 quests.
 *   Each accepted gift pays REGARD_GIFT_POINTS .... ≈ 1 per quest that has a
 *                                                    gift subquest.
 *
 * So a player who only fills the Ledger gets there in 20 quests, and one who
 * also gives her the things she asks for gets there in about 15 — the range the
 * twelve-chapter ladder is written to (docs/quests.md §3, ~25 days floor).
 *
 * Two properties this shape buys, both deliberate:
 *   • **It never decays.** Absence never punishes. Regard is a record of what
 *     the player did, exactly like Trust (merge-chains §4.1).
 *   • **It cannot be bought.** Nothing pays Regard but a completed quest and a
 *     gift she asked for, so it can never gate story behind a purchase
 *     (docs/quests.md §7 rule 6).
 *
 * The points live in `GameState.stats` — already persisted, so the gauge adds
 * no save field and needs no SAVE_VERSION bump.
 */
export const REGARD_HEARTS = 5;
export const REGARD_POINTS_PER_HEART = 12;
export const REGARD_MAX_POINTS = REGARD_HEARTS * REGARD_POINTS_PER_HEART;
/** Paid to a quest's `giver` when the quest completes. Overridable per quest
 *  (`QuestConfig.regard`) — a 0 there means "this one is not about her". */
export const REGARD_QUEST_POINTS = 3;
/** Paid per item accepted by a live `gift` subquest. */
export const REGARD_GIFT_POINTS = 1;

/** Where a character's Regard points live in `stats`. */
export const regardKey = (characterId: string): string => `regard:${characterId}`;
/** Lifetime count of one piece given to one character — what a `gift` goal
 *  reads. A counter, so the goal keeps no state of its own (QuestSystem law 1). */
export const giftKey = (characterId: string, chain: string, tier: number): string =>
  `gift:${characterId}:${chain}:${tier}`;
/** Latch so a quest's Regard is paid exactly once, however often
 *  `quest:completed` is re-derived. */
export const regardPaidKey = (questId: string): string => `regard:paid:${questId}`;

export const heartsForPoints = (points: number): number =>
  Math.min(REGARD_HEARTS, Math.floor(Math.max(0, points) / REGARD_POINTS_PER_HEART));

/**
 * The status readout under the quest tracker (`src/ui/StatusPanel.ts`).
 *
 * `FLASH` is how long an unasked-for reveal holds before it fades: long enough
 * to read one line and a row of hearts, short enough that a busy merge session
 * is not narrated at the player. The two fades are asymmetric on purpose — it
 * arrives quickly enough to catch the eye and leaves slowly enough not to snatch
 * itself away mid-read.
 */
export const STATUS_FLASH_MS = 3000;
export const STATUS_FADE_IN_MS = 220;
export const STATUS_FADE_OUT_MS = 420;

/** The "makes this" disc over a commissioned House: its radius, and how far it
 *  floats above the sprite's anchor. Sized to read at a glance without becoming
 *  a second item on the tile. */
export const PRODUCE_BADGE_R = 44;
export const PRODUCE_BADGE_LIFT = 190;

/** Which map this build renders. The engine is single-world; `characters.json`
 *  tags each character with a world so Borealis-only cast can never be built
 *  into Emberkeep by accident. */
export const WORLD_ID = 'emberkeep';

/**
 * How far the re-grid recovery searches for a home when a saved piece's art
 * position lands on ground the new map does not have (`GameState.nearestFree`,
 * see src/core/mapSpace.ts). Three rings is ~1.5 tiles of slack — enough to
 * absorb a re-cut coastline or a zone seam, small enough that a piece never
 * teleports somewhere the player would not recognise. Past it, the satchel is
 * the honest answer.
 */
export const REGRID_SEARCH_RINGS = 3;

/**
 * Animation banks for the characters who stand ON the map (not on the merge
 * board). Each is an 8-frame horizontal strip under `sprites/<id>/`.
 *
 * `idle` loops for as long as she is standing there, and is deliberately almost
 * motionless — a breath, a drift in the braid, a pulse in the scepter crystal.
 * `cast` plays ONCE when she is actually asked for something and then hands back
 * to the idle: she never walks to what she helps, she works at a distance with
 * the scepter (docs/world-characters.md §1).
 *
 * GENERATED by `scripts/bake-standee.py` (it prints this block) — do not hand-
 * tune the geometry. That script registers every frame of BOTH banks onto one
 * reference by her FEET and bakes them into one shared frame box, which is what
 * stops the idle sliding across the tile and the cast popping when it takes
 * over. Read its header before changing any number here.
 *
 * `anchorX`/`anchorY` are her FEET as a fraction of that frame — the sprite
 * origin, not (0.5, 1). The box is the union of every frame plus a thin
 * transparent margin (nothing may sit flush against an edge, or the scepter's
 * glow gets sliced square), and the cast's ember bolt reaches far to her left,
 * so its bottom-centre is empty space and only the explicit anchor puts her
 * shoes on the tile. Padding the box moves her on screen by ZERO: the anchor and
 * `body` are stored relative to it and `scale` is derived from body height.
 *
 * `body` is her silhouette inside the frame, in TEXTURE space — the hit rect is
 * derived from it, never from the frame (the frame includes the spell FX).
 *
 * `scale` is solved so her body renders 256 hi-res units tall, roughly the
 * on-board size of a whelp dragon (ITEM_SCALE `ember_dragon_3` ≈ 221px), so a
 * person reads as a person beside one instead of towering over the board.
 */
export interface StandeeBank {
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  /** Feet, as a fraction of the frame — the sprite's origin. */
  anchorX: number;
  anchorY: number;
  /** Her silhouette within the frame (texture space), for the hit rect. */
  body: { x: number; y: number; width: number; height: number };
  scale: number;
  fps: { idle: number; cast: number };
  keys: { idle: string; cast: string };
}

export const STANDEE_BANKS: Record<string, StandeeBank> = {
  eleanor: {
    frameWidth: 438,
    frameHeight: 584,
    frameCount: 8,
    anchorX: 0.7099,
    anchorY: 0.9709,
    body: { x: 128, y: 52, width: 293, height: 515 },
    scale: 0.4971,
    fps: { idle: 12, cast: 14 },
    keys: { idle: 'eleanor_world_idle', cast: 'eleanor_world_cast' }
  },
  selyna: {
    frameWidth: 456,
    frameHeight: 543,
    frameCount: 8,
    anchorX: 0.6992,
    anchorY: 0.9982,
    body: { x: 120, y: 28, width: 335, height: 514 },
    scale: 0.4981,
    fps: { idle: 12, cast: 14 },
    keys: { idle: 'selyna_world_idle', cast: 'selyna_world_cast' }
  }
};

/**
 * Authored size trim applied ON TOP of a bank's baked `scale`, per character.
 *
 * The bake solves `scale` so her body lands at a target height (256 hi-res units
 * by default); this is the art-direction adjustment on top of that solve, and it
 * lives OUT here rather than in the generated block above so re-running
 * `scripts/bake-standee.py` cannot silently undo it.
 *
 * Scaling is anchored at her FEET — the bake puts the sprite origin there
 * (`anchorX`/`anchorY`), not at the frame's bottom-centre — so a trim changes her
 * height and nothing else: her shoes stay on the same tile, and the breath, the
 * arm pulse, the cooldown nudge, the ground shadow and the tutorial marker all
 * re-derive from the trimmed scale rather than fighting it.
 */
export const STANDEE_SCALE_TRIM: Record<string, number> = {
  // 0.7 → her body renders ~179 units instead of 256. She read as too large
  // standing beside the whelps at the ward line.
  eleanor: 0.7,
  // Same trim, and for the same reason: the two are the same kind of figure and
  // a person must read at one size across worlds. Borealis's slabs are drawn at
  // the same backdrop calibration as Emberkeep's, so a standee that matched
  // there and not here would just be an inconsistency.
  selyna: 0.7
};

/**
 * Standing still IS the breath — a puppet-style vertical squash about her FEET
 * (her origin), so nothing but her height moves and her shoes stay on the tile.
 * The baked `idle` bank is NOT played: she rests on its frame 0 and this is the
 * only thing moving. The frame loop under the breath read as a fidget, and two
 * idles at once read as two different people. The bank stays loaded because it
 * owns her resting still and the cast hands back to it; `fps.idle` is now just
 * the rate the frames were captured at. The `cast` bank still plays in full —
 * that one is a deliberate gesture, not idling.
 *
 * `amount` is peak scaleY deviation: 0.008 is ~2px of head travel at her on-board
 * size, which reads as alive without ever reading as an animation. It composes on
 * top of whatever scale she is at (arm pulse, cooldown nudge) rather than
 * fighting it, and `phaseSpread` staggers the cast off one another so two
 * standees in frame never inhale in unison — the same rule the blink follows.
 * Starts after the landing settle so the two never write scaleY on one frame.
 */
export const STANDEE_BREATH = {
  amount: 0.008,
  periodMs: 4200,
  phaseSpread: 1.7,
  startDelayMs: 460
} as const;

/**
 * The full-screen DRAGON REVEAL — the card a player is shown the first time a
 * dragon form is theirs.
 *
 * Keyed by `<chain>:<tier>`, so a breed is ready here the moment it is given a
 * chain and needs no code to switch on. `golden_egg` is deliberately ABSENT: the
 * Golden Elder's awakening is the chapter's one irreversible story beat and it
 * is already choreographed off `FINALE` in both scenes. Putting a card in front
 * of it would be the "teaser glimpse" the finale exists to refuse — her art is
 * registered (`reveal_golden`/`reveal_golden_adult`) and used by nothing.
 */
export const DRAGON_REVEAL: Record<string, { art: string; name: string; epithet: string }> = {
  'ember_dragon:3': {
    art: 'reveal_ember',
    name: 'Ember Whelp',
    epithet: 'the first fire the isle has kept in four hundred years'
  },
  'ember_dragon:4': {
    art: 'reveal_ember_adult',
    name: 'Ember Dragon',
    epithet: 'grown, and loud about it'
  },
  'emerald:3': {
    art: 'reveal_emerald',
    name: 'Emerald Whelp',
    epithet: 'hatched green, which the old books said was lucky'
  },
  'emerald:4': {
    art: 'reveal_emerald_adult',
    name: 'Emerald Dragon',
    epithet: 'the moss and the ash both answer to her now'
  }
};

/**
 * The reveal's choreography, in ms from the moment the card opens. Every beat
 * lives here because they have to stay in step with each other AND with the
 * roar: move the plate's entrance and the sound is early.
 */
export const REVEAL = {
  /** Scrim in — the board is dimmed, never hidden: it is still your isle. */
  scrimMs: 260,
  scrimAlpha: 0.88,
  /** The plate flies in from below, overshooting once. */
  plateInMs: 520,
  plateFromScale: 0.52,
  plateFromY: 190,
  /** The roar lands ON the overshoot, not on the first frame of movement. */
  roarAtMs: 300,
  /** Nameplate rises after the animal has landed. */
  nameAtMs: 620,
  nameRiseMs: 380,
  /** How long the card holds once assembled, before it lets go by itself. */
  holdMs: 2400,
  outMs: 420,
  /** A tap skips straight to the exit, but not before the roar has landed. */
  skipAfterMs: 700,
  /** Idle breath on the held plate — alive, not floating. */
  breathScale: 0.018,
  breathMs: 1500,
  /** The godray disc behind the animal, and how fast it turns (deg/sec). */
  raySpin: 9,
  rayAlpha: 0.34,
  /** Plate height on screen, as a fraction of the live viewport height, and
   *  where its centre sits. Above the middle on purpose: the nameplate rises
   *  UNDER the animal, and centring the plate puts the text across its feet. */
  plateHeightFrac: 0.66,
  /** …and its width cap. Portrait phones are the reason this exists. */
  plateWidthFrac: 0.86,
  plateCentreFrac: 0.42
} as const;

/**
 * The longest BoardScene will hold a hatch waiting for the reveal card to close.
 *
 * Derived from the card's own timeline plus a margin, so it is a safety net and
 * never the thing that decides the timing: if the card closes normally (it holds
 * itself, and a tap skips it) the hatch runs the instant it does.
 */
export const REVEAL_HOLD_BACK_MAX_MS =
  REVEAL.nameAtMs + REVEAL.nameRiseMs + REVEAL.holdMs + REVEAL.outMs + 1500;

/**
 * How a shelf item's rarity is DRESSED — the Emporium's only use of it. Rarity
 * buys nothing: a legendary dragon skin re-textures a dragon exactly the way an
 * epic one does. It changes the plate the card is printed on, the ribbon it
 * wears and what it costs, and that is the whole of it.
 *
 * `foil` is the switch for the violet plate and its travelling sheen, so making
 * a future tier foiled is a one-line edit here.
 */
export const RARITY: Record<
  'epic' | 'legendary',
  { label: string; ribbon: string; ribbonEdge: string; ink: string; foil: boolean }
> = {
  epic: {
    label: 'EPIC',
    ribbon: '#5B3E8C',
    ribbonEdge: '#9B7CE0',
    ink: '#FFF6E8',
    foil: false
  },
  legendary: {
    label: 'LEGENDARY',
    ribbon: '#2E1147',
    ribbonEdge: '#FFD84D',
    ink: '#FFF6E8',
    foil: true
  }
};

/**
 * The foil plate under a legendary card: a brushed violet metal, a holographic
 * streak that crosses it, and a gold rim.
 *
 * The sheen is a TileSprite scrolling its own texture inside a FIXED rectangle,
 * never a sprite sliding across a masked card. Phaser's geometry masks resolve
 * against world space and lose the transform of a nested container, which the
 * store's cards are three deep in; a scrolling tile needs no mask at all and
 * cannot leak past the plate. `tileScale` stretches the 256px tile so one
 * streak crosses at a time — under ~3 the card wears stripes instead.
 */
export const FOIL = {
  base: '#1D0A2E',
  mid: '#4B1C7E',
  high: '#8E51CE',
  rim: '#E7C6FF',
  edge: '#FFD84D',
  /** One full pass of the streak, corner to corner. */
  sweepMs: 3400,
  /** Beat between passes, so the card glints rather than strobes. */
  sweepGapMs: 1100,
  tileScale: 4,
  sheenAlpha: 0.5,
  /** Thickness of the rim stroke, in the 2560-space. */
  rimWidth: 7
} as const;

/** Her ground shadow, as a fraction of her BODY width (never the frame — that
 *  also spans the cast's ember bolt). Under 1 so it reads as contact under her
 *  feet rather than a puddle she is floating over. */
export const STANDEE_SHADOW_WIDTH = 0.9;
/** Its height, as a fraction of its own final width — the standee's override of
 *  the shared 0.42. Widening a contact patch must not also deepen it: a person's
 *  shadow on a near-flat sunset light spreads sideways, and 0.9 × 0.34 keeps the
 *  vertical extent where 0.72 × 0.42 had it. */
export const STANDEE_SHADOW_SQUASH = 0.34;
/** And its horizontal nudge, in fractions of that width — negative is LEFT.
 *  An authored correction, not physics: the shadow is centred on her anchor,
 *  but the baked BODY box is the UNION of both banks and the cast pose swings
 *  her arm out to one side, so the box's centre sits right of the feet actually
 *  bearing her weight. Small on purpose — past ~0.1 she reads as detached. */
export const STANDEE_SHADOW_DX = -0.05;

/* ---------------- The day clock (merge-chains.md §3) ----------------
 * Four coarse phases, 8 minutes each — a full day is 32 minutes of real time.
 * Enough for "she'll only take it at dusk", visible in the sky art each world
 * already ships, and a player sees all four in one sitting. Everything reads
 * GameClock.now() so advanceTime(ms) stays deterministic. */
export const DAY_PHASES = ['morning', 'day', 'dusk', 'night'] as const;
export type DayPhase = (typeof DAY_PHASES)[number];
export const PHASE_MS = 8 * 60_000;
export const DAY_MS = PHASE_MS * DAY_PHASES.length;

export const dayIndexAt = (ms: number): number => Math.floor(ms / DAY_MS);
export const phaseAt = (ms: number): DayPhase =>
  DAY_PHASES[Math.floor((((ms % DAY_MS) + DAY_MS) % DAY_MS) / PHASE_MS)]!;

/* ---------------- The Cold Nest (merge-chains.md §4) ----------------
 * A dragon is coaxed, not merged, bought or dropped. 9 goods total, at most 3
 * points per day, so the minimum is THREE in-game days spread across sessions —
 * currency cannot compress it, which is the whole point. */
export const NEST_POINTS_REQUIRED = 9;
export const NEST_POINTS_PER_DAY = 3;

/* ---------------- Trust & Growth ----------------
 * Trust 0-5, earned by feeding (max +1/day) and by feeding a KNOWN favourite
 * (+1 bonus). It never decays: absence never punishes, presence always rewards.
 * Growth is a separate axis — a dragon that gets all its meals in a day is
 * well-fed that day, and five of those make it an adult. Dragons stop becoming
 * adults by merging and start becoming adults by being raised. */
export const TRUST_MAX = 5;
export const MEALS_PER_DAY = 3;
/** Meal value by tier: a snack, a meal, a feast (merge-chains §1.4). */
export const MEAL_VALUE: Record<number, number> = { 1: 1 / 3, 2: 1, 3: 1 };

/* ---------------- Diet: taste, the hunger gauge, and growing up ------------
 *
 * Every dragon sorts the food roster into exactly three boxes, fixed at birth
 * and HIDDEN until the player experiments (the Dragon Book fills in by
 * discovery, never by being told — merge-chains §2.1):
 *
 *   • its FAVOURITE — one chain. Fills the hunger gauge at full rate.
 *   • its REFUSAL — one chain. It turns its head away; nothing is consumed and
 *     the gauge does not move.
 *   • everything else it ACCEPTS, at `ACCEPTED_RATE` of the favourite.
 *
 * The old law was "the refusal is always a FUEL, never the green", because
 * `ashmoss` was the only cooling chain and a dragon that refused it could never
 * stop panting — a permanent bad condition nothing in the game could fix.
 * `nightbloom` retires it: with a SECOND cooling chain, refusing one green is
 * an inconvenience the player can cook around instead of a dead end. The law
 * that replaces it is the real one all along, and `dietIsSurvivable`
 * (DragonSystem, which owns the axis rosters) is its statement: whatever a
 * breed refuses, it must still be able to reach at least one fuel AND one
 * green in the world it lives in.
 */
export const ACCEPTED_RATE = 0.25;

/**
 * How much of a dragon it takes to raise one. A serving is ONE feed; its
 * favourite is worth a whole serving, anything it merely accepts is worth
 * `ACCEPTED_RATE` of one. So a lesser dragon is 15 favourite servings or 60
 * accepted ones, a legendary 25 or 100 — cooking to its taste is the difference
 * between a week and a month, which is the whole point of the Book.
 *
 * Growth counts SERVINGS, not calories: tier only sizes the daily hunger gauge
 * (MEAL_VALUE), so a stack of Hearth Cakes feeds a dragon well today and does
 * not shortcut raising it. Showing up is the currency.
 */
export type DragonRarity = 'lesser' | 'legendary';
export const ADULT_SERVINGS: Record<DragonRarity, number> = { lesser: 15, legendary: 25 };

/** Every rigged breed, by the chain key its companion carries. */
export const DRAGON_RARITY: Record<string, DragonRarity> = {
  ember_dragon: 'lesser',
  emerald: 'lesser',
  frost: 'legendary',
  storm: 'legendary',
  moonwhisker: 'legendary'
};

/**
 * Taste per breed. `favourite` must be a chain that exists in the world the
 * breed lives in, or its adult is 4× dearer than authored; the pair must pass
 * `dietIsSurvivable`.
 *
 * Every breed now has a favourite of its OWN — five breeds, five reachable
 * chains — which is what `stormcap` and `nightbloom` were added for. Before
 * them the roster held three usable favourites for five dragons (`tarknot` is
 * Borealis-only, so an Emberkeep dragon could never reach it), and two pairs of
 * breeds shared a taste. A favourite the player has to discover is only worth
 * discovering if it tells one dragon apart from another.
 */
export const DRAGON_DIET: Record<string, { favourite: string; refuses: string }> = {
  ember_dragon: { favourite: 'resin', refuses: 'tarknot' },
  emerald: { favourite: 'emberberry', refuses: 'tarknot' },
  frost: { favourite: 'ashmoss', refuses: 'resin' },
  storm: { favourite: 'stormcap', refuses: 'emberberry' },
  moonwhisker: { favourite: 'nightbloom', refuses: 'tarknot' }
};
/* ---------------- Ambient life: what a dragon does when nobody asks --------
 *
 * A merge board is a grid of objects that wait. A dragon that only ever waits
 * is furniture with good art on it, so the board dragons keep a life of their
 * own: they wander the isle, they sleep at night, and they say something about
 * it when they are hungry.
 *
 * Two rules hold the whole thing together:
 *   • **Ambience never costs the player anything.** Wandering cannot break a
 *     merge, sleep does not stop production, and a roar is a mood, not a
 *     penalty. Nothing here is a gate.
 *   • **Nothing here keeps a counter.** Hunger is `DragonSystem.careOf` — the
 *     same record feeding writes and the status readout draws — and sleep is
 *     the shipped day clock's `night` phase. A second hunger clock would drift
 *     from the gauge the player is looking at.
 */

/**
 * A dragon is HUNGRY when it has eaten nothing at all today. Anything settles
 * it — a snack, a scrap, food it merely tolerates.
 *
 * Deliberately NOT "under a full meal". `MEAL_VALUE` scales a serving by tier
 * and taste, so one tier-3 fruit a dragon merely ACCEPTS is worth 0.25 — and at
 * a one-meal threshold a player who fed it correctly would still be roared at
 * all day, which reads as the feeding being broken. The roar's job is to say
 * "nobody has fed this animal", and being fed must be enough to stop it.
 *
 * The hunger GAUGE still reads the full `MEALS_PER_DAY`; the two are different
 * granularities of the same record, and both are honest.
 */
export const HUNGRY_UNFED_EPS = 0.01;
/** How long after a dragon first appears before it may be hungry at all. A
 *  hatchling that roars the instant it lands reads as broken, not as hungry. */
export const DRAGON_HUNGER_GRACE_MS = 90_000;
/** Gap between hungry roars. Rare on purpose — it is a mood, and a dragon that
 *  roars every few seconds is a nuisance rather than a character. */
export const DRAGON_ROAR_EVERY_MS = 64_000;

/** Base gap between one dragon's wanders, and the per-dragon spread added on
 *  top so a board of them never moves in lockstep. Derived from the item id
 *  rather than `Math.random()` — `window.advanceTime(ms)` has to stay
 *  reproducible, and a randomly-timed board move is exactly what would break it. */
export const DRAGON_WANDER_EVERY_MS = 72_000;
export const DRAGON_WANDER_SPREAD_MS = 48_000;
/** A wander must actually GO somewhere: the target tile is at least this many
 *  cells away, so the dragon crosses the isle instead of shuffling sideways. */
export const DRAGON_WANDER_MIN_DIST = 3;
/** …and no further than this, so it stays in the neighbourhood the player is
 *  looking at rather than vanishing to the far side of the board. */
export const DRAGON_WANDER_MAX_DIST = 9;
/** How long the flight itself takes, and the hop height at its apex. */
export const DRAGON_WANDER_FLIGHT_MS = 1700;
export const DRAGON_WANDER_ARC = 175;

/**
 * The sleeping breath. The calmest movement on the board, so it is slow and
 * small: a 3.4-second cycle, a 3.5% rise, and the body widens a little LESS
 * than it heightens so the silhouette breathes instead of pulsing.
 */
export const SLEEP_BREATH = {
  periodMs: 3400,
  amount: 0.035,
  /** How far the body drifts up at the top of the breath, in game units. */
  lift: 4
} as const;

/** A dragon naps of its own accord: a window this long, once per cycle, with
 *  the offset derived from its id so a pair never sleeps in lockstep. Cozy
 *  cadence — it is asleep for roughly one minute in five. */
export const DRAGON_NAP_CYCLE_MS = 300_000;
export const DRAGON_NAP_LENGTH_MS = 58_000;

/** One bellow, and the stretch it takes to get up afterwards. */
export const DRAGON_ROAR_MS = 1500;
export const DRAGON_WAKE_MS = 1400;
/** Fallback scale for a curled sleep painting with no tuned ITEM_SCALE entry —
 *  the sleep art is its own pose at its own resolution, so it can never inherit
 *  the standing rig's scale. */
export const DRAGON_SLEEP_SCALE = 0.26;

/** Chance a feed of this tier reveals a Dragon Book entry. Tier 3 is an
 *  OPTIMISATION, never a gate — scarcity lives in knowledge, not nutrition. */
export const BOOK_REVEAL_CHANCE: Record<number, number> = { 1: 0.1, 2: 0.25, 3: 0.6 };

/* ---------------- The two axes of a dragon's day (merge-chains.md §2.1) ------
 * A dragon is a furnace with a heartbeat: it does not hunt, it burns. So it eats
 * no meat, and its diet has two axes — FUEL (calories) and GREEN (a furnace that
 * never cools cooks itself). Missing either shows on the dragon, which is how a
 * player learns the rule without being told it.
 *
 * There is no grit axis: quartz is Eleanor's chain end to end and no tier of it
 * is food. Recipient locking is absolute. */
export const DAILY_GREEN = 1;
/** Trust levels that pay out something mechanical (merge-chains §4.1). */
export const TRUST_DIGS = 2;
export const TRUST_FORAGES = 4;
export const TRUST_FOLLOWS = 5;
/** A forage is tier 1, or tier 2 on a lucky day — the same 8% that makes a
 *  producer drop occasionally jump a tier (merge-chains §1.3b). */
export const LUCKY_TIER2_CHANCE = 0.08;

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

export type ChestGift =
  | { kind: 'coins'; amount: number; label: string }
  | { kind: 'item'; chain: string; tier: number; count: number; label: string };

export const CHEST_GIFTS: ReadonlyArray<ChestGift> = [
  { kind: 'coins', amount: 15, label: '+15' }, // the scene draws the coin art beside it
  { kind: 'item', chain: 'emerald', tier: 1, count: 3, label: '3 Emeralds!' },
  { kind: 'item', chain: 'ember_dragon', tier: 1, count: 3, label: '3 Rubies!' }
];

/**
 * A chest pays in the currency of the world it stands in.
 *
 * The table above is Emberkeep's, and it is made of Emberkeep chains — neither
 * `emerald` nor `ember_dragon` carries a `world`, so `chainHiddenIn` does NOT
 * withhold them in the north. A chest opened in Borealis would cheerfully drop
 * Dragon Rubies onto an island with no dragon to want them, no order that asks
 * for them and no producer to continue the chain: dead weight, on a board where
 * a tile is the scarcest thing there is, and a silent contradiction of the rule
 * that each world has its own roster.
 *
 * Borealis pays what Borealis makes. Gold is shared vocabulary and stays.
 */
/* ------------------------------------------------------------------ */
/* THE LEGENDARY EGG DIRECTIVE                                          */
/* ------------------------------------------------------------------ */

/**
 * **Every zone gives up exactly one legendary dragon, and the quest ladder is
 * the only thing that can hand it over.**
 *
 * The rule, in full — enforced by `auditLegendaryArc` (`pnpm quests`), so a
 * ladder that breaks it fails the build rather than being found in play:
 *
 *  1. A world has **at most one** chain marked `legendary` in `chains.json`.
 *     Its egg is tier 1, the dragon is tier 2, and `LEGENDARY_EGG_COUNT` eggs
 *     merge into it.
 *  2. **No producer ever makes an egg.** Not a generator, not a region seed,
 *     not a chest, not an order. The ONLY source is a quest `rewards.spawn`,
 *     which is what makes the dragon a story object rather than a grind.
 *  3. Exactly `LEGENDARY_EGG_COUNT` eggs are paid across the zone, one per
 *     quest — never two from the same quest, and never from the endless tail
 *     (which does not finish, so it cannot pay).
 *  4. **They are spaced.** Between two egg quests there are
 *     `LEGENDARY_EGG_GAP_MIN`–`LEGENDARY_EGG_GAP_MAX` quests that pay something
 *     else. Back-to-back eggs make the dragon a formality; a gap longer than
 *     four and the player forgets there is an arc at all.
 *  5. **The last egg is the zone's last completable quest.** Assembling the
 *     dragon IS the end of the zone. That is why the arc is described from the
 *     end backwards and not from the start forwards.
 *
 * Consequence worth stating out loud: a zone needs at least
 * `1 + 2·(LEGENDARY_EGG_GAP_MIN + 1)` = 9 completable quests before it can hold
 * a legendary arc at all. A shorter ladder is not "mostly compliant", it is a
 * zone that cannot have a dragon, and the audit says so in those words.
 */
export const LEGENDARY_EGG_COUNT = 3;
/** Quests paying something OTHER than an egg, between two egg quests. */
export const LEGENDARY_EGG_GAP_MIN = 3;
export const LEGENDARY_EGG_GAP_MAX = 4;

/** The legendary chain of a world, or undefined where none is authored yet. */
export function legendaryChainIn<T extends { id: string; world?: string; legendary?: boolean }>(
  chains: readonly T[],
  worldId: string
): T | undefined {
  return chains.find((c) => c.legendary && !chainHiddenIn(c, worldId));
}

export const CHEST_GIFTS_BY_WORLD: Readonly<Record<string, ReadonlyArray<ChestGift>>> = {
  borealis: [
    { kind: 'coins', amount: 15, label: '+15' },
    { kind: 'item', chain: 'driftwood', tier: 1, count: 3, label: '3 Drift Spars!' },
    { kind: 'item', chain: 'rimebloom', tier: 1, count: 3, label: '3 Frost Flowers!' },
    { kind: 'item', chain: 'keel', tier: 1, count: 2, label: '2 Broken Strakes!' }
  ]
};

/** The gift table for the world the Keeper is standing in. */
export const chestGiftsIn = (worldId: string): ReadonlyArray<ChestGift> =>
  CHEST_GIFTS_BY_WORLD[worldId] ?? CHEST_GIFTS;

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
 *
 * Level 3 no longer FIRES anything. It opens `level_5`'s land and it is the
 * cap, but the Golden Elder's awakening moved off it onto
 * `GOLDEN_ALTAR.awakenQuestId` — a level the player crosses mid-merge is the
 * wrong trigger for the chapter's one irreversible story beat.
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
 * whole golden lore plays out: the egg appears there when Eleanor's first order
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
  /** The egg is authored decor and sits there from the start. Completing THIS
   *  order is half the gate on the awakening — delivered AND `awakenQuestId`
   *  complete puts the Elder on the altar instead (BoardScene.syncGoldenAltar).
   *  The tutorial's `ledger_deliver` beat is what delivers it. */
  orderId: 'eleanor_brazier',
  /**
   * The other half: the quest whose completion WAKES her. This used to be
   * "reach Keeper Level 3", which was demo scaffolding — it made the chapter's
   * one irreversible story beat fire off a number the player crosses while
   * doing something else entirely. It is earned now: the Keeper's Hoard is the
   * last gathering quest before `keepers_tasks` asks the player to commune with
   * her, so she is awake exactly when something first needs her to be.
   */
  awakenQuestId: 'keepers_hoard'
} as const;

/**
 * Keeper Level 3 finale choreography. One timeline, shared by BoardScene (camera
 * to the altar → the Golden Egg cracks → camera home) and UIScene (the Elder's
 * first line) so the two scenes stay in step without cross-scene calls. All ms
 * from the keeper:leveled(3) beat.
 *
 * It used to run on past the awakening into a teaser: a fly to the south
 * terrace, the ash-fog parting halfway, and Chapter-Two silhouettes fading in
 * under the clouds — then a card offering Keep Playing / Play Again. All of that
 * was demo scaffolding and is gone; the finale now ENDS on the Elder and hands
 * the board straight back, so the timeline is half as long.
 */
export const FINALE = {
  hatchAtMs: 900, // camera glides WEST to the Golden Altar…
  awakenAtMs: 2000, // …where the Golden Egg cracks: the Elder AWAKENS
  elderAtMs: 3200, // she speaks — her first words in the whole game
  returnAtMs: 6000, // camera returns to the player's zone while she finishes
  elderHoldMs: 5200 // her line holds, then play simply continues
} as const;

/** When the finale is over — her line's last frame. Both scenes measure "is the
 *  finale still running?" against this; it used to be the chapter card's cue. */
export const FINALE_ENDS_MS = FINALE.elderAtMs + FINALE.elderHoldMs;

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
  /** Wait after an order celebration before a chapter beat opens — her
   *  reaction has to land AFTER the thing she is reacting to. */
  chapterBeatDelay: 2600,
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
  /* ---- COZY CADENCE ----
   * The board is meant to be pleasant to leave running. Every number below was
   * roughly doubled from its first pass, where a whelp rolled a new segment
   * every ~5s and read as fidgeting rather than living. The rule the retune
   * follows: a dragon should be STILL most of the time, and the thing it does
   * when it stops being still should be long enough to watch.
   */
  celebrateMs: 3000, // one unhurried low-flight during the alternation
  idleMinMs: 9000,
  idleMaxMs: 15000,
  celebrateChance: 0.1, // P(low flight) per cycle → ~93% of the time at rest
  /** ADULT dragons (the tier-4 Red Adult, the Golden Elder) are calm, wise
   *  elders: the same idle + low-flight repertoire, but rolled far less often,
   *  held longer, and played slower — a whelp fidgets, an elder breathes. */
  adultIdleMinMs: 16000,
  adultIdleMaxMs: 26000,
  adultCelebrateChance: 0.05,
  adultCelebrateMs: 3800, // a single unhurried low-flight when it does happen
  adultSpeed: 0.55, // preset playback rate (breathing/wing-beat cadence)
  /** …and the whelp is slowed too. At 1.0 its wing-beat was the fastest thing
   *  on a screen where nothing else hurries. */
  whelpSpeed: 0.82,
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
  // +50% on request (0.62 → 0.93): at 0.62 the adult read SMALLER than the baby.
  'ember_dragon:4': 0.93,
  // Adult Emerald Dragon: same rig geometry as the adult red (identical part
  // canvases/bounds), so it wears the same on-board scale.
  'emerald:4': 0.93
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
 *  an Elder tier — wipe so every save carries the new fields + curve.
 *  v6→v7: the cast changed — Cindra and Laurah are gone and Eleanor is both the
 *  guide and the quest giver, so every order id was renamed `cindra_*` →
 *  `eleanor_*`. A v6 save's `completedOrderIds` hold the OLD ids, which would
 *  re-offer finished orders and leave the Golden Altar's `orderId` gate unmet —
 *  wipe rather than migrate. v7→v8: the Bag arrived — saves gain a `bag` array.
 *  It defaults to [] on load so a v7 save would survive, but the tap gesture on
 *  the board changed meaning in the same release, so a clean start keeps the
 *  tutorial's scripted board honest.
 *  v8→v9: the story chapter pointer arrived, and the tutorial's opening was
 *  rewritten (2 steps → 7, new ids). A v8 save's `tutorial.index` points into
 *  the OLD step list, so resuming would drop the player mid-scene on the wrong
 *  line — wipe rather than migrate.
 *  v9→v10: six beats were inserted into the tutorial (the satchel, selling,
 *  Eleanor's help, and the whole Ledger arc — see docs/tutorial-coverage.md).
 *  `tutorial.index` is a position in that list, so a v9 save mid-tutorial would
 *  resume on a different beat than it left — wipe rather than migrate.
 *  v10→v11: region CONTENTS changed — quartz and moonwater are seeded on the
 *  board and level_2 carries five Cracked Stones instead of two — and a beat
 *  (`isle_materials`) was inserted after `sell_it`. Region contents are laid
 *  down when a region unlocks, so a v10 save that already opened level_2 would
 *  never see the new pieces, and its `tutorial.index` again points into the old
 *  list — wipe rather than migrate.
 *
 *  NOT bumped for map space (`src/core/mapSpace.ts`). Every field it adds —
 *  `world`, `mapSignature`, per-item `place`, `nestPlaces` — is optional and
 *  additive: a v11 save without them hydrates down the identical grid path it
 *  always did (`MapSpace.spec` asserts exactly that), and a v11 save WITH them
 *  is still a v11 save to any build that ignores them. Bumping would wipe every
 *  player's board to add a field they cannot yet benefit from, which is the
 *  opposite of what the field is for. The bump that matters comes with the
 *  zone system, and by then the saves in the wild already carry the pixels
 *  needed to migrate rather than discard them. */
export const SAVE_KEY = 'emberkeep_save';
export const SAVE_VERSION = 11;

/** The opening's held silence: the board is visible and quiet before Eleanor's
 *  first line, so the player sees the ash before anyone frames it
 *  (docs/opening-scene.md, beat 0). Presentation-only — UIScene defers the very
 *  first bubble by this much; the director has already emitted the step. */
export const OPENING_HOLD_MS = 1500;

/** How long a post-tutorial story beat rests on screen if the player never taps
 *  it. Chapter beats are tap-advanced; this is the safety net so a bubble can
 *  never strand the board. */
export const STORY_BEAT_HOLD_MS = 9000;

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
