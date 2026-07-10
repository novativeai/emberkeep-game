/** Shared types: board model, data-file schemas, and the full EventBus contract. */

export interface TilePos {
  col: number;
  row: number;
}

export type ItemKind = 'item' | 'decor';

export interface BoardItemState {
  id: number;
  chain: string;
  tier: number;
  col: number;
  row: number;
  kind: ItemKind;
  /** Absolute clock time at which a TAP-harvested generator may produce again. */
  readyAt?: number;
  /** Absolute clock time at which this generator PASSIVELY gifts its next item. */
  passiveAt?: number;
}

export type RegionStatus = 'active' | 'unlockable' | 'locked';

export type SpawnCause = 'init' | 'merge' | 'generator' | 'unlock' | 'load';

export interface ItemSnapshot {
  id: number;
  chain: string;
  tier: number;
  col: number;
  row: number;
  kind: ItemKind;
  ready?: boolean;
}

/* ------------------------------------------------------------------ */
/* Data file schemas (src/data/*.json)                                  */
/* ------------------------------------------------------------------ */

export interface GeneratorConfig {
  /** Spawns this item per cycle (item generators: dragons, the big tree). */
  produces?: { chain: string; tier: number };
  /** Grants currency/energy per cycle instead of an item (the house). */
  reward?: { coins?: number; xp?: number; energy?: number };
  cooldownMs: number;
  energyCost: number;
  /** If set, the generator also PASSIVELY gifts one produce every this-many ms
   *  — free, no tap, no energy. The standing advantage of owning a dragon. */
  passiveMs?: number;
  /** Tap-to-harvest? Passive-only generators (house, big tree) set false: they
   *  auto-produce on their passive timer; a tap only offers the energy skip. */
  tappable?: boolean;
  /** Most GOLD the "buy now" skip can cost on THIS generator (the Crystal's
   *  emeralds are dear). Falls back to GENERATOR_SKIP_MAX_ENERGY when unset. */
  skipMaxGold?: number;
}

export interface ChainTierConfig {
  tier: number;
  id: string;
  name: string;
  sell: number;
  /** XP granted when a merge produces this tier. */
  xp: number;
  /** false = the sell path refuses this tier (story items like the Golden Egg). */
  sellable?: boolean;
  generator?: GeneratorConfig;
}

/** Per-chain merge recipe override (e.g. 5 wood → 1 house). */
export interface ChainMergeOverride {
  /** Number consumed to make one next-tier item (default mergeRule.minGroup). */
  group: number;
  /** Next-tier items produced per merge (default 1). */
  outputs: number;
}

export interface ChainConfig {
  id: string;
  name: string;
  /** Tier whose creation counts as a hatch (dragon chains). */
  hatchAtTier?: number;
  /** Overrides the global mergeRule for this chain (e.g. lumber: 5 → 1). */
  merge?: ChainMergeOverride;
  tiers: ChainTierConfig[];
}

export interface MergeRuleConfig {
  minGroup: number;
  fiveBonus: boolean;
  fiveGroup: number;
  fiveOutputs: number;
}

export interface ChainsData {
  mergeRule: MergeRuleConfig;
  chains: ChainConfig[];
}

export interface OrderRequirement {
  chain: string;
  tier: number;
  count: number;
}

export interface OrderConfig {
  id: string;
  giver: string;
  title: string;
  blurb: string;
  requires: OrderRequirement[];
  rewards: {
    coins: number;
    keys: number;
    xp?: number;
    spawn?: { chain: string; tier: number; count: number };
    /** Mystery-reward hint shown verbatim on the order card (e.g. "🥚 ???") —
     *  for rewards staged OUTSIDE the board, like the Golden Altar egg. */
    tease?: string;
  };
}

export interface OrdersData {
  orders: OrderConfig[];
  /** Encore templates cycled forever once the scripted orders are done, so the
   *  Ledger never dead-ends. Ids are synthesised as `encore_<n>`. */
  repeatable?: Omit<OrderConfig, 'id'>[];
}

/* ------------------------------------------------------------------ */
/* Dialogue + Keeper's Tasks data (src/data/dialogue.json, tasks.json)  */
/* ------------------------------------------------------------------ */

export interface DialogueData {
  /** Short Cindra quotes stamped on the order-complete banner (rotating). */
  orderComplete: string[];
  /** Golden Egg tap flavor, keyed by XP progress toward the Level-3 finale. */
  goldenEgg: { early: string[]; mid: string[]; near: string[] };
  /** Cindra's first (and only pre-encore) spoken line — the finale beat. */
  finaleCindra: string;
  /** Finale variant when the Golden Egg was never earned (Order 1 skipped) —
   *  reads as PROPHECY, pointing the player back to the un-filled promise. */
  finaleCindraProphecy: string;
  /** Cindra's banner quote the moment the egg materialises on the altar. */
  goldenArrival: string;
  /** Cindra's line when Order 1 completes AFTER Level 3 — the late awakening. */
  lateAwakening: string;
  /** One-shot Laurah nudges post-tutorial. */
  hints: { zeroWarmth: string; boardFull: string; eggTrembles: string };
  /** Cindra's line when all Keeper's Tasks complete. */
  tasksComplete: string;
}

export type TaskKind = 'hatches' | 'orders' | 'goldEarned' | 'merges' | 'elderTaps';

export interface TaskConfig {
  id: string;
  label: string;
  kind: TaskKind;
  target: number;
  /** The task's subject doesn't exist before these gates (presentation only —
   *  progress can't move anyway; e.g. the Elder pre-awakening). */
  lockedUntil?: { order?: string; level?: number };
  /** Shown in place of the progress bar while locked. */
  lockedHint?: string;
}

export interface TasksData {
  tasks: TaskConfig[];
  reward: { coins: number; energy: number };
}

export interface MapItemPlacement {
  chain: string;
  tier: number;
  at: [number, number];
}

export interface MapDecorPlacement {
  decor: string;
  at: [number, number];
}

/**
 * Static authored scenery from the world builder's `decor` category (huts,
 * crystals, landmarks). Painted like tiles — part of the MAP, not save state —
 * so a re-imported world refreshes the scene for everyone. `name` is the slug;
 * the texture loads as `decor_<name>`.
 */
export interface MapDecorRender {
  name: string;
  col: number;
  row: number;
  z?: number;
  /** Free-move offset in world px from the cell centre (world-builder Move tool). */
  dx?: number;
  dy?: number;
}

/** Procedural animated 3D decor (world-builder 🧊 tab — the emerald crystal). */
export interface MapDecor3dRender extends MapDecorRender {
  model3d?: {
    shape: string; color: string; material: string; outline: string;
    spinDegPerSec: number; camera: string; steps: number;
  } | null;
}

export interface MapRegionConfig {
  id: string;
  status: RegionStatus;
  /** Tile list as [col, row] pairs. */
  tiles: [number, number][];
  /** A region lifts on spending `keys` Gold Keys OR on reaching Keeper `level`. */
  unlock?: { keys?: number; level?: number };
  contents?: MapItemPlacement[];
  decor?: MapDecorPlacement[];
}

/** Per-asset placement calibration measured in the world builder. */
export interface TileCalibration {
  offsetX: number;
  offsetY: number;
  scale: number;
  anchor: { x: number; y: number };
}

/** Where the camera frames each Keeper level (focal cell on the grid). */
export interface CameraKeyframe {
  level: number;
  focus?: { col: number; row: number };
  world?: { x: number; y: number };
  zoom?: number;
}

export interface MapData {
  cols: number;
  rows: number;
  regions: MapRegionConfig[];
  startingItems: MapItemPlacement[];
  /** Featured decor placed on the active board at new-game (e.g. the L1 dragon). */
  startingDecor?: MapDecorPlacement[];
  /** Authored tile footprint (world-builder units). */
  tile?: { width: number; height: number };
  /** All playable cells as [col, row] (for void/cliff silhouette detection). */
  playable?: [number, number][];
  /** Which tile-art variant sits on each playable cell, keyed "col,row". */
  tilesByCell?: Record<string, string>;
  /** Placement calibration keyed by bare tile-art name. */
  calibration?: Record<string, TileCalibration>;
  /** Static authored scenery (world-builder `decor`), painted like tiles. */
  mapDecor?: MapDecorRender[];
  /** Placement calibration for map decor, keyed by decor slug. */
  decorCalibration?: Record<string, TileCalibration>;
  /** Playable cells with NO tile art — the background/void shows through, keyed "col,row" elsewhere as [col,row]. */
  invisible?: [number, number][];
  /** A layer painted BELOW the floor (world-builder Background), + its calibration. */
  backgrounds?: MapDecorRender[];
  backgroundCalibration?: Record<string, TileCalibration>;
  /** The background's cell extent — the camera frontier (pan/zoom can't go past it). */
  backgroundBounds?: { minCol: number; maxCol: number; minRow: number; maxRow: number } | null;
  /** Procedural Three.js decor (the emerald crystal) + its calibration. */
  decor3d?: MapDecor3dRender[];
  decor3dCalibration?: Record<string, TileCalibration>;
  /** In-game wheel-zoom clamp authored in the world builder. */
  cameraZoom?: { min: number; max: number };
  /** Per-level camera framing. */
  cameraKeyframes?: CameraKeyframe[];
}

export type TutorialGate =
  | { type: 'tap' }
  | { type: 'event'; event: 'item:merged' | 'item:hatched' | 'item:harvested' | 'order:completed' | 'region:unlocked' | 'ui:ledger_opened' | 'ui:cookbook_opened' | 'ui:cookbook_closed' | 'chest:open' | 'dragon:working' | 'marketplace:purchased' | 'generator:skipped'; chain?: string; currency?: 'gold' | 'warmth' }
  | { type: 'count'; chain: string; tier: number; count: number };

export interface TutorialAllow {
  /** Chain ids the player may drag ('*' = all). */
  drag?: string[];
  tapGenerators?: boolean;
  ledger?: boolean;
  deliver?: boolean;
  fog?: boolean;
  sell?: boolean;
  /** Allow tapping a dragon to open the Work/Harvest job menu during tutorial. */
  dragonWork?: boolean;
  /** Allow tapping the energy ⚡ shop button during tutorial. */
  marketplace?: boolean;
  /** Allow tapping the Emberkeep Cookbook button during tutorial. */
  cookbook?: boolean;
}

/**
 * A tile reference in tutorial data: a literal [col,row], the dynamic
 * `last_hatched` marker, or a `{ chain, nth }` token that resolves at runtime to
 * the nth board item of that chain. Tokens keep tutorial hints glued to the
 * ACTUAL item placement, so they stay correct for any imported map.
 */
export type TileRef = [number, number] | 'last_hatched' | { chain: string; nth: number; tier?: number };

export type TutorialHandConfig =
  | { from: TileRef; to: TileRef }
  | { ui: 'ledger' | 'deliver' | 'marketplace' | 'cookbook' | 'cookbook_close' }
  | { fogRegion: string };

export type TutorialArrowConfig =
  | { tile: TileRef }
  | { ui: 'ledger' | 'deliver' | 'marketplace' | 'cookbook' | 'cookbook_close' }
  | { fogRegion: string };

/**
 * Scripted side-effects a tutorial step runs the moment it becomes active —
 * the spec's "reward" beats: spawn the dragon eggs after the plant merge, ripen
 * the bush after the hatch, hand over the key before the fog lesson.
 */
export type TutorialEffect =
  | { spawn: { chain: string; tier: number; count: number; nearChain?: string; nearTier?: number; at?: [number, number] } }
  | { retier: { chain: string; fromTier: number; toTier: number } }
  | { grantKeys: number }
  | { grantXp: number }
  | { advanceClock: number }
  | { setEnergy: number }
  | { move: { chain: string; tier: number; to: [number, number] } }
  | { setTimer: { chain: string; tier: number; remainingMs: number } };

export interface TutorialStepConfig {
  id: string;
  speaker: 'cindra' | 'laurah';
  text: string;
  gate: TutorialGate;
  highlight?: TileRef[];
  hand?: TutorialHandConfig;
  arrow?: TutorialArrowConfig;
  allow?: TutorialAllow;
  /** Side-effects fired once, when this step becomes the active step. */
  effects?: TutorialEffect[];
}

export interface TutorialData {
  steps: TutorialStepConfig[];
}

export interface AssetEntry {
  key: string;
  /** 'placeholder' = generated at runtime; 'file' = load from assets/ (public dir). */
  source: 'placeholder' | 'file';
  /** Path relative to assets/ when source === 'file', e.g. 'raw/ai/egg.png'. */
  file?: string;
  generator: string;
}

export interface AssetsManifest {
  images: AssetEntry[];
}

export interface AnchorsData {
  default: [number, number];
  byKey: Record<string, [number, number]>;
}

/* ------------------------------------------------------------------ */
/* Save schema                                                          */
/* ------------------------------------------------------------------ */

export interface SaveDataV1 {
  version: number;
  savedAt: number;
  items: BoardItemState[];
  nextItemId: number;
  regions: Record<string, RegionStatus>;
  energy: { current: number; lastRegenAt: number };
  coins: number;
  keys: number;
  xp: number;
  orderProgress: { completedIds: string[] };
  tutorial: { index: number; done: boolean };
  /** Lifetime counters (Keeper's Tasks + chapter-card stats) and one-shot
   *  flags (`finaleSeen`, `tasksClaimed`) — all numeric for easy versioning. */
  stats: Record<string, number>;
  /** First-time merge discoveries for the Emberkeep Cookbook — keys like
   *  `"ember_dragon:1>2"`. Optional: older saves default to []. */
  discoveredRecipes?: string[];
}

/* ------------------------------------------------------------------ */
/* EventBus contract                                                    */
/* ------------------------------------------------------------------ */

export interface EventMap {
  /* -- input intents (scenes/UI emit, systems handle) -- */
  'drag:dropped': { itemId: number; from: TilePos; to: TilePos };
  'item:tapped': { itemId: number };
  'generator:skip': { itemId: number; currency: 'gold' | 'warmth' };
  /* -- dragon jobs -- */
  'dragon:work': { dragonId: number; houseId: number };
  'dragon:working': { dragonId: number; houseId: number };
  'dragon:rest': { dragonId: number };
  'dragon:rested': { dragonId: number };
  'ui:ledger_toggled': { open: boolean };
  /** The Emberkeep Cookbook panel opened/closed (tutorial gates + analytics). */
  'ui:cookbook_opened': { discovered: number };
  'ui:cookbook_closed': { discovered: number };
  'ui:deliver_requested': { orderId: string };
  /** A gauge "+" button opened the shop for that currency. */
  'ui:shop_requested': { currency: 'energy' | 'coins' };
  'ui:sell_requested': { itemId: number };
  /** Settings toggled the background music on/off (AudioManager applies it). */
  'audio:set_music_muted': { muted: boolean };
  'fog:tapped': { regionId: string };
  'tutorial:advance_requested': { stepId: string };
  'game:reset_requested': Record<string, never>;
  'time:advanced': { ms: number };

  /* -- cross-system commands (systems handle, synchronously) -- */
  'energy:spend': { amount: number; reason: string };
  'energy:add': { amount: number; reason: string };
  'energy:set': { value: number; reason: string };
  'economy:add': { coins?: number; keys?: number; xp?: number; reason: string };
  'economy:spend_keys': { keys: number; reason: string };
  'board:consume_items': { itemIds: number[]; reason: string };
  /** Scripted spawn of `count` items, into free tiles near an item of `nearChain`. */
  'board:spawn': { chain: string; tier: number; count: number; nearChain?: string; nearTier?: number; at?: [number, number] };
  /** Transform one on-board item of `chain`+`fromTier` into `toTier` in place. */
  'board:retier': { chain: string; fromTier: number; toTier: number };
  /** Relocate one on-board item of `chain`+`tier` to a cell (tutorial staging). */
  'board:move': { chain: string; tier: number; to: [number, number] };
  /** Force a generator's tap-cooldown to `remainingMs` left (tutorial staging). */
  'generator:set_timer': { chain: string; tier: number; remainingMs: number };

  /** A treasure chest was tapped — ChestSystem grants a random reward + removes it. */
  'chest:open': { itemId: number };
  'chest:claimed': { chestId: number; label: string };

  /* -- state-change notifications (systems emit; UI + audio subscribe) -- */
  'item:spawned': { item: ItemSnapshot; cause: SpawnCause };
  'item:moved': { itemId: number; from: TilePos; to: TilePos };
  'item:move_bounced': { itemId: number; at: TilePos };
  'item:merged': {
    chain: string;
    fromTier: number;
    resultTier: number;
    at: TilePos;
    consumedIds: number[];
    consumedAt: TilePos[];
    outputs: ItemSnapshot[];
    xp: number;
  };
  'item:hatched': { item: ItemSnapshot };
  /** A merge recipe was performed for the FIRST time — the Emberkeep Cookbook
   *  writes a new page (MergeSystem emits once per chain:fromTier>resultTier). */
  'cookbook:discovered': { chain: string; fromTier: number; resultTier: number };
  'item:harvested': { generatorId: number; output: ItemSnapshot };
  'item:harvest_failed': { generatorId: number; reason: 'cooldown' | 'energy' | 'no_space' };
  /** A generator passively gifted an item (no tap, no energy). */
  'item:produced': { generatorId: number; output: ItemSnapshot };
  /** A reward generator (the house) paid out currency/energy on its timer. */
  'generator:reward': { generatorId: number; coins: number; xp: number; energy: number };
  /** A generator's wait was paid off (the skip button) — currency tells which. */
  'generator:skipped': { itemId: number; chain: string; currency: 'gold' | 'warmth' };
  /** A Gold coin was tapped to bank it — UI flies a coin to the Gold gauge. */
  'gold:collected': { at: TilePos };
  'item:removed': { itemId: number; at: TilePos; reason: 'sold' | 'delivered' };
  'item:sold': { itemId: number; coins: number };
  'energy:changed': { current: number; max: number };
  'economy:changed': { coins: number; keys: number; xp: number; level: number };
  'keeper:leveled': { level: number; from: number };
  'energy:refill': { reason: string };
  'order:progress': { orderId: string; have: number[]; need: number[]; deliverable: boolean };
  'order:completed': { orderId: string; rewards: { coins: number; keys: number; xp?: number } };
  'order:all_done': Record<string, never>;
  'region:unlocked': { regionId: string; tiles: TilePos[]; revealed: ItemSnapshot[] };
  'region:unlock_failed': { regionId: string; reason: 'keys' | 'not_unlockable' | 'level' };
  'marketplace:purchased': { energy: number; free: boolean };
  /** The awakened Golden Elder was tapped (communing) — Keeper's Tasks counts it. */
  'elder:tapped': { itemId: number };
  /** Every Keeper's Task reached its target (fired once; reward already paid). */
  'tasks:all_complete': Record<string, never>;
  'tutorial:step': TutorialStepEvent;
  'state:saved': { at: number };
  'state:loaded': { offlineMs: number; energyRecovered: number };
  'game:reset': Record<string, never>;
}

export type ResolvedHand =
  | { from: TilePos; to: TilePos }
  | { ui: 'ledger' | 'deliver' | 'marketplace' | 'cookbook' | 'cookbook_close' }
  | { fogRegion: string };

export type ResolvedArrow =
  | { tile: TilePos }
  | { ui: 'ledger' | 'deliver' | 'marketplace' | 'cookbook' | 'cookbook_close' }
  | { fogRegion: string };

export interface TutorialStepEvent {
  id: string;
  index: number;
  total: number;
  done: boolean;
  speaker: 'cindra' | 'laurah';
  text: string;
  gateType: TutorialGate['type'];
  highlight: TilePos[];
  hand: ResolvedHand | null;
  arrow: ResolvedArrow | null;
  allow: Required<TutorialAllow>;
}

export type EventKey = keyof EventMap;
