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

/**
 * The four-phase day (8 min each, a 32-min round — DAY_CYCLE in Constants).
 * Deliberately NOT a simulated calendar: four coarse phases is all the design
 * needs (time-of-day food preferences, the night-only Dew Basin). The ring is
 * derived from `GameClock.now()`, so `window.advanceTime(ms)` steps it.
 */
export type DayPhase = 'morning' | 'day' | 'dusk' | 'night';

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
   *  auto-produce on their passive timer; a tap does not harvest them. */
  tappable?: boolean;
  /** Time-of-day gate: this generator only produces during these day phases (the
   *  Dew Basin fills only at `["night"]`). Absent = produces around the clock.
   *  An overdue timer simply HOLDS until the phase comes round again. */
  phases?: DayPhase[];
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
  /** Per-TIER merge recipe override — takes precedence over the chain-level
   *  `merge` when merging items of THIS tier (e.g. 2 Houses → 1 Manor while
   *  Bushes still merge 3 → 1 House). */
  merge?: ChainMergeOverride;
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
  /**
   * The world this chain BELONGS to (an editor map name — 'borealis'). Absent =
   * the primary isle, which is every chain that shipped before worlds existed.
   * It is a declaration, not a gate: the merge rules do not read it. Its job is
   * to say whose art has to be resident when you stand in that world, so a cold
   * world's icons stay off the boot preload (see WORLD_CHAIN_ART / lazyTextures).
   */
  world?: string;
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

/** One selectable way to fulfil an order: consume board items and/or spend
 *  coins in exchange for this option's rewards. Delivering ANY option completes
 *  the order (the player picks their path). Used by orders that carry
 *  `options`; simple orders keep the legacy top-level `requires`/`rewards`. */
export interface OrderOption {
  label: string;
  requires?: OrderRequirement[];
  costCoins?: number;
  rewards: { coins?: number; keys?: number; xp?: number; spawn?: { chain: string; tier: number; count: number } };
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
  /** When present, the ledger shows one row per option and delivering any one
   *  completes the order. `requires`/`rewards` mirror option 0 for legacy
   *  readers (progress text, tutorial). */
  options?: OrderOption[];
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
  hints: {
    zeroWarmth: string;
    boardFull: string;
    eggTrembles: string;
    twoDragons: string;
    twoHouses: string;
  };
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

/** A "gift" goal shown by the quest journal: reach `count` of chain+tier on the
 *  board, then claim `coins` (Farmland-style milestone chain). */
export interface MilestoneConfig {
  id: string;
  chain: string;
  tier: number;
  count: number;
  coins: number;
}

export interface MilestonesData {
  milestones: MilestoneConfig[];
}

/** One drawable "vein" of the Emberfont Spark Well — a tier-1 merge piece the
 *  well can draw, and its relative frequency in the draw cycle. */
export interface EmberfontVein {
  chain: string;
  tier: number;
  weight: number;
}

export interface EmberfontData {
  veins: EmberfontVein[];
}

/* -- Dragon Duel (rock-paper-scissors level-up mode) -- */
export type DuelThrow = 'rock' | 'paper' | 'scissors';
export type DuelOutcome = 'win' | 'lose' | 'tie';

/** A dragon color in the duel roster (red = ember_dragon, green = emerald, …). */
export interface DuelDragon {
  chain: string;
  /** Art/loop colour key: 'red' | 'green' | … (drives duel_<throw>_<color>). */
  color: string;
  name: string;
  owned: boolean;
  level: number;
  gauge: number;
}

/** A quest definition (src/data/quests.json). `kind` drives the completed colour:
 *  main = gold, sub = platinum. `image` (optional) = a texture key shown on the card. */
export interface QuestDef {
  id: string;
  kind: 'main' | 'sub';
  title: string;
  image?: string;
}
export interface QuestsData {
  feedTargetLevel: number;
  quests: QuestDef[];
}
/** A quest's live state broadcast to the HUD (`quest:changed`). */
export interface QuestState extends QuestDef {
  done: boolean;
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
  | { type: 'event'; event: 'item:merged' | 'item:hatched' | 'item:harvested' | 'order:completed' | 'region:unlocked' | 'ui:ledger_opened' | 'ui:cookbook_opened' | 'ui:cookbook_closed' | 'chest:open' | 'dragon:working' | 'marketplace:purchased'; chain?: string }
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
  /** Short imperative title shown in the Tasks-list checklist (event steps only). */
  task?: string;
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

/** worldId -> that world's script. A world absent from the map simply has no
 *  tutorial, which is every world but borealis today. */
export type WorldTutorials = Record<string, TutorialData>;

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

/**
 * A cell lattice, as stored in a save — structurally the `Lattice` of `iso.ts`
 * (declared here rather than imported so the save schema owns no module cycle).
 */
export interface SavedLattice {
  halfW: number;
  halfH: number;
  skewK: number;
  originX: number;
  originY: number;
}

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
  /** Claimed milestone-gift ids (optional — pre-milestone saves omit it). */
  milestoneProgress?: { claimedIds: string[] };
  /** Emberfont Spark Well progress (optional — pre-Emberfont saves omit it). */
  emberfontProgress?: {
    sparks: number;
    sparkAt: number;
    stoke: number;
    stokeAt: number;
    surgeUntil: number;
    veinIndex: number;
  };
  /** Per-dragon-colour duel level/gauge (optional — pre-duel saves omit it).
   *  `fedAt` = GameClock time of the last feed, drives the tap-menu hunger gauge. */
  dragonLevels?: Record<string, { level: number; gauge: number; fedAt?: number }>;
  /** Emberberry bushes banked in the dragon's larder (absent on pre-larder saves). */
  berryStock?: number;
  /** LEGACY (pre per-world boards): item id -> owning world name. Everything lived on
   *  one board and this only said what to show. Still read on load, to split an old
   *  save's pieces onto the right world's board; never written any more. */
  itemWorlds?: Record<string, string>;
  /**
   * Every world's own board. The top-level `items`/`nextItemId` mirror the primary
   * world so an older build still reads this save.
   *
   * `lattice` is the CELL LATTICE those (col,row) were written in — the unit of the
   * coordinates, saved alongside them. A world's playable cells are re-derived at
   * every boot from hand-drawn grids that live outside this file, so without it a
   * redrawn grid (or a shipped update) silently changes what every saved coordinate
   * MEANS. With it, the change is detected and the pieces are re-projected exactly.
   * Absent on pre-lattice saves: the live lattice is then adopted as-is.
   */
  worlds?: Record<
    string,
    { items: BoardItemState[]; nextItemId: number; lattice?: SavedLattice }
  >;
  /** The world the player was in. A reload puts them back where they left off. */
  activeWorld?: string;
  tutorial: { index: number; done: boolean };
  /** Progress through the OTHER worlds' tutorials (borealis), keyed by world id.
   *  The primary world keeps `tutorial` above, so an older save reads unchanged. */
  worldTutorials?: Record<string, { index: number; done: boolean }>;
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
  /* -- dragon jobs -- */
  'dragon:work': { dragonId: number; houseId: number };
  'dragon:working': { dragonId: number; houseId: number };
  'dragon:rest': { dragonId: number };
  'dragon:rested': { dragonId: number };
  'ui:ledger_toggled': { open: boolean };
  /** The Emberkeep Cookbook panel opened/closed (tutorial gates + analytics). */
  'ui:cookbook_opened': { discovered: number };
  'ui:cookbook_closed': { discovered: number };
  'ui:deliver_requested': { orderId: string; optionIndex?: number };
  /** A gauge "+" button opened the shop for that currency. */
  'ui:shop_requested': { currency: 'energy' | 'coins' };
  'ui:sell_requested': { itemId: number };
  /** The Emberfont Spark Well was tapped — spend a Spark, draw a vein. */
  'emberfont:tap': Record<string, never>;
  /* -- Dragon Duel intents (UI emits, DragonDuelSystem handles) -- */
  'duel:choose': { chain: string };
  'duel:start': Record<string, never>;
  /** The player threw `move` for the current match — resolve it. */
  'duel:play': { move: DuelThrow };
  /** Settings toggled the background music on/off (AudioManager applies it). */
  'audio:set_music_muted': { muted: boolean };
  'fog:tapped': { regionId: string };
  'tutorial:advance_requested': { stepId: string };
  'game:reset_requested': Record<string, never>;
  /** Settings → open the in-game Map Editor (dev level tool). */
  'editor:open': Record<string, never>;
  'time:advanced': { ms: number };
  /** The day rolled into a new phase (morning → day → dusk → night → morning).
   *  DayCycleSystem emits it; the board grades its sky off it. `startedAt`/`endsAt`
   *  are absolute GameClock times, so a UI can count the phase down. */
  'day:phase': { phase: DayPhase; index: number; startedAt: number; endsAt: number };

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
  /** Re-seat pieces standing on cells the live world no longer offers (a world's
   *  playable cells are re-derived on every entry — see BoardSystem.reconcile). */
  'board:reconcile': Record<string, never>;
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
  'item:harvest_failed': {
    generatorId: number;
    reason: 'cooldown' | 'energy' | 'no_space' | 'phase';
    /** Set with reason 'phase': the phase this generator waits for (the Dew Basin's night). */
    requiresPhase?: DayPhase;
  };
  /** A generator passively gifted an item (no tap, no energy). */
  'item:produced': { generatorId: number; output: ItemSnapshot };
  /** A reward generator (the house) paid out currency/energy on its timer. */
  'generator:reward': { generatorId: number; coins: number; xp: number; energy: number };
  /** A Gold coin was tapped to bank it — UI flies coin(s) to the Gold gauge,
   *  one gauge pulse per arrival (the Pouch sends 3; default 1). */
  'gold:collected': { at: TilePos; coins?: number };
  'item:removed': { itemId: number; at: TilePos; reason: 'sold' | 'delivered' };
  'item:sold': { itemId: number; coins: number };
  'energy:changed': { current: number; max: number };
  'economy:changed': { coins: number; keys: number; xp: number; level: number };
  'keeper:leveled': { level: number; from: number };
  /** The "ruby" was assembled for the first time — the WorldTeleportSystem asks for
   *  the Demon dragon to teleport and the game to switch worlds. Handled by
   *  BoardScene (the cinematic) which then emits `world:switch`. */
  'world:teleport': { toWorld: string; dragonChain: string; at: TilePos };
  /** The Golden Egg BURST (the finale awakening) — the WorldTeleportSystem uses this
   *  to teleport the Golden dragon into the borealis world (if it exists). */
  'golden:awakened': Record<string, never>;
  /** Switch the live game to another editor world (backdrop + its playable cells +
   *  decor). Emitted by BoardScene mid-cinematic; handled by MapEditor. */
  'world:switch': { toWorld: string };
  /** A world switch ACTUALLY happened (the target world exists). Emitted by MapEditor
   *  after `switchToWorld` succeeds — lets the UI show a "return" button and the
   *  tutorial stand down. Never fires when the target world is absent (e2e/prod). */
  'world:switched': { toWorld: string };
  /** Return the live game to the primary world ("Level 1"). Emitted by the return
   *  button; handled by MapEditor. */
  'world:return': Record<string, never>;
  /** The player asked to FEED a dragon (the "Feed" button on its tap menu). */
  'dragon:feed': { chain: string };
  /** A dragon was fed: a berry consumed, its level raised. */
  'dragon:fed': { chain: string; level: number };
  /** A feed attempt failed (no berries, no gold, or the wrong hour — 'phase'). */
  'dragon:feed_failed': { chain: string; reason: string; requiresPhase?: DayPhase };
  /** The player asked to BUY one leaf for Gold (the sprout's "via des achats" path). */
  'dragon:buy_food': { chain: string };
  /** A leaf was bought (Gold spent, one berry added to the larder). */
  'dragon:food_bought': { chain: string };
  /** The player TAPPED an Emberberry bush to bank it in the dragon's larder. */
  'dragon:store_food': { itemId: number };
  /** The larder changed. `at` is the cell the berry came from, so the UI can fly it
   *  to the gauge the way collected Gold flies to the purse; absent for a purchase. */
  'dragon:stock_changed': { stock: number; gained: number; at?: TilePos };
  /** Make Cindra/Laurah say a one-off line in the character bubble (used by the
   *  Level-3 lair "how to merge berries" coach). */
  'character:say': { speaker: 'cindra' | 'laurah'; text: string; holdMs?: number };
  /** Quest progress broadcast to the HUD (main + side quests, each with a done flag). */
  'quest:changed': { quests: QuestState[] };
  /** Force-complete a quest by id (intent from any system). */
  'quest:complete': { id: string };
  'energy:refill': { reason: string };
  'order:progress': { orderId: string; have: number[]; need: number[]; deliverable: boolean };
  'order:completed': { orderId: string; rewards: { coins: number; keys: number; xp?: number } };
  /** Milestone "gift" (Farmland-style): the player taps to claim when ready. */
  'milestone:claim': Record<string, never>;
  'milestone:changed': {
    id: string | null;
    chain: string;
    tier: number;
    have: number;
    need: number;
    coins: number;
    ready: boolean;
    done: boolean;
  };
  'milestone:claimed': { id: string; coins: number };
  /** Emberfont Spark Well state (drives the StokeMeter HUD widget). */
  'emberfont:changed': {
    sparks: number;
    maxSparks: number;
    stoke: number;
    maxStoke: number;
    surging: boolean;
    surgeRemainingMs: number;
    nextVein: { chain: string; tier: number };
    active: boolean;
  };
  /** A Spark was drawn: a vein piece dropped at `at` (scene plays the pop). */
  'emberfont:sparked': { at: TilePos; chain: string; tier: number };
  /** The well entered/left a Surge (scene/audio react). */
  'emberfont:surge': { active: boolean; remainingMs: number };
  /* -- Dragon Duel notifications (DragonDuelSystem emits; UI + audio subscribe) -- */
  'duel:changed': {
    unlocked: boolean;
    roster: DuelDragon[];
    selected: string | null;
    matchesLeft: number;
    canAfford: boolean;
    energyCost: number;
    gaugeMax: number;
  };
  /** A set of matches began — `energyCost` was paid, `matches` to play. */
  'duel:set_started': { chain: string; matches: number };
  /** Couldn't start a set. */
  'duel:start_failed': { reason: 'energy' | 'locked' | 'no_dragon' };
  /** One match resolved (UI animates the reveal from this). */
  'duel:match': {
    chain: string;
    oppChain: string;
    color: string;
    oppColor: string;
    playerThrow: DuelThrow;
    oppThrow: DuelThrow;
    outcome: DuelOutcome;
    gauge: number;
    gaugeMax: number;
    level: number;
    leveledUp: boolean;
    matchesLeft: number;
  };
  'order:all_done': Record<string, never>;
  'region:unlocked': { regionId: string; tiles: TilePos[]; revealed: ItemSnapshot[] };
  'region:unlock_failed': { regionId: string; reason: 'keys' | 'not_unlockable' | 'level' };
  'marketplace:purchased': { energy: number; free: boolean };
  /** The awakened Golden Elder was tapped (communing) — Keeper's Tasks counts it. */
  'elder:tapped': { itemId: number };
  /** Every Keeper's Task reached its target (fired once; reward already paid). */
  'tasks:all_complete': Record<string, never>;
  'tutorial:step': TutorialStepEvent;
  /** The whole tutorial checklist just FINISHED (natural completion only — NOT a
   *  reload of an already-done save). Drives the end-of-tutorial world teleport. */
  /** `world` = the world whose script finished (omitted = the primary isle, which
   *  is what the lair teleport waits for). */
  'tutorial:done': { world?: string };
  'state:saved': { at: number };
  'state:loaded': { offlineMs: number; energyRecovered: number };
  /** Fired once after beginRun finishes (load OR new game) — the board is live and
   *  state is settled (post-hydrate). The Map Editor re-applies its saved zones +
   *  assets here so they persist across a reload on BOTH paths. */
  'game:started': Record<string, never>;
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
