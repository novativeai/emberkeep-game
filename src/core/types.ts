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
  produces: { chain: string; tier: number };
  cooldownMs: number;
  energyCost: number;
  /** If set, the generator also PASSIVELY gifts one produce every this-many ms
   *  — free, no tap, no energy. The standing advantage of owning a dragon. */
  passiveMs?: number;
}

export interface ChainTierConfig {
  tier: number;
  id: string;
  name: string;
  sell: number;
  /** XP granted when a merge produces this tier. */
  xp: number;
  generator?: GeneratorConfig;
}

export interface ChainConfig {
  id: string;
  name: string;
  /** Tier whose creation counts as a hatch (dragon chains). */
  hatchAtTier?: number;
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
  rewards: { coins: number; keys: number; xp?: number };
}

export interface OrdersData {
  orders: OrderConfig[];
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
  /** Authored tile footprint (world-builder units). */
  tile?: { width: number; height: number };
  /** All playable cells as [col, row] (for void/cliff silhouette detection). */
  playable?: [number, number][];
  /** Which tile-art variant sits on each playable cell, keyed "col,row". */
  tilesByCell?: Record<string, string>;
  /** Placement calibration keyed by bare tile-art name. */
  calibration?: Record<string, TileCalibration>;
  /** Per-level camera framing. */
  cameraKeyframes?: CameraKeyframe[];
}

export type TutorialGate =
  | { type: 'tap' }
  | { type: 'event'; event: 'item:merged' | 'item:hatched' | 'item:harvested' | 'order:completed' | 'region:unlocked' | 'ui:ledger_opened'; chain?: string }
  | { type: 'count'; chain: string; tier: number; count: number };

export interface TutorialAllow {
  /** Chain ids the player may drag ('*' = all). */
  drag?: string[];
  tapGenerators?: boolean;
  ledger?: boolean;
  deliver?: boolean;
  fog?: boolean;
  sell?: boolean;
}

/** A tile reference in tutorial data: literal [col,row] or a dynamic marker. */
export type TileRef = [number, number] | 'last_hatched';

export type TutorialHandConfig =
  | { from: TileRef; to: TileRef }
  | { ui: 'ledger' | 'deliver' }
  | { fogRegion: string };

export type TutorialArrowConfig =
  | { tile: TileRef }
  | { ui: 'ledger' | 'deliver' }
  | { fogRegion: string };

export interface TutorialStepConfig {
  id: string;
  speaker: 'pip' | 'cindra' | 'laurah';
  text: string;
  gate: TutorialGate;
  highlight?: TileRef[];
  hand?: TutorialHandConfig;
  arrow?: TutorialArrowConfig;
  allow?: TutorialAllow;
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
}

/* ------------------------------------------------------------------ */
/* EventBus contract                                                    */
/* ------------------------------------------------------------------ */

export interface EventMap {
  /* -- input intents (scenes/UI emit, systems handle) -- */
  'drag:dropped': { itemId: number; from: TilePos; to: TilePos };
  'item:tapped': { itemId: number };
  'ui:ledger_toggled': { open: boolean };
  'ui:deliver_requested': { orderId: string };
  'ui:sell_requested': { itemId: number };
  'fog:tapped': { regionId: string };
  'tutorial:advance_requested': { stepId: string };
  'game:reset_requested': Record<string, never>;
  'time:advanced': { ms: number };

  /* -- cross-system commands (systems handle, synchronously) -- */
  'energy:spend': { amount: number; reason: string };
  'economy:add': { coins?: number; keys?: number; xp?: number; reason: string };
  'economy:spend_keys': { keys: number; reason: string };
  'board:consume_items': { itemIds: number[]; reason: string };

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
  'item:harvested': { generatorId: number; output: ItemSnapshot };
  'item:harvest_failed': { generatorId: number; reason: 'cooldown' | 'energy' | 'no_space' };
  /** A generator passively gifted an item (no tap, no energy). */
  'item:produced': { generatorId: number; output: ItemSnapshot };
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
  'tutorial:step': TutorialStepEvent;
  'state:saved': { at: number };
  'state:loaded': { offlineMs: number; energyRecovered: number };
  'game:reset': Record<string, never>;
}

export type ResolvedHand =
  | { from: TilePos; to: TilePos }
  | { ui: 'ledger' | 'deliver' }
  | { fogRegion: string };

export type ResolvedArrow =
  | { tile: TilePos }
  | { ui: 'ledger' | 'deliver' }
  | { fogRegion: string };

export interface TutorialStepEvent {
  id: string;
  index: number;
  total: number;
  done: boolean;
  speaker: 'pip' | 'cindra' | 'laurah';
  text: string;
  gateType: TutorialGate['type'];
  highlight: TilePos[];
  hand: ResolvedHand | null;
  arrow: ResolvedArrow | null;
  allow: Required<TutorialAllow>;
}

export type EventKey = keyof EventMap;
