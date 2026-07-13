import { EMBERFONT, ENERGY_START, energyMaxForLevel, LEVEL_XP } from './Constants';
import type {
  BoardItemState,
  ItemKind,
  ItemSnapshot,
  MapData,
  RegionStatus,
  SaveDataV1,
  TilePos
} from './types';

const tileKey = (col: number, row: number): string => `${col},${row}`;

/**
 * The single source of truth for game state. Only systems mutate it; scenes
 * and UI read it (and react to EventBus notifications).
 */
export class GameState {
  readonly cols: number;
  readonly rows: number;

  items = new Map<number, BoardItemState>();
  /** grid[row][col] -> itemId or null */
  grid: (number | null)[][] = [];
  regionStatus = new Map<string, RegionStatus>();
  private tileRegion = new Map<string, string>();

  nextItemId = 1;
  energyCurrent = ENERGY_START;
  energyLastRegenAt = 0;
  coins = 0;
  keys = 0;
  xp = 0;
  completedOrderIds: string[] = [];
  claimedMilestoneIds: string[] = [];
  tutorialIndex = 0;
  tutorialDone = false;
  /** Lifetime counters (hatches, merges, goldEarned, elderTaps, …) plus
   *  one-shot numeric flags (finaleSeen, tasksClaimed). TaskSystem owns writes. */
  stats: Record<string, number> = {};
  /** Emberkeep Cookbook pages — first-time merge recipes, keyed
   *  `"chain:fromTier>resultTier"`. MergeSystem owns writes. */
  discoveredRecipes: string[] = [];

  /* Emberfont (Spark Well) — mutated only by EmberfontSystem. */
  emberSparks: number = EMBERFONT.startSparks;
  emberSparkAt = 0;
  emberStoke = 0;
  emberStokeAt = 0;
  emberSurgeUntil = 0;
  emberVeinIndex = 0;

  /* Dragon Duel — per-dragon-colour level + 0..gaugeMax gauge (systems only). */
  dragonLevels = new Map<string, { level: number; gauge: number }>();

  constructor(private map: MapData) {
    this.cols = map.cols;
    this.rows = map.rows;
    for (const region of map.regions) {
      for (const [c, r] of region.tiles) {
        this.tileRegion.set(tileKey(c, r), region.id);
      }
    }
    this.reset(0);
  }

  /** Wipe to a brand-new game. `now` seeds the energy regen timestamp. */
  reset(now: number): void {
    this.items.clear();
    this.grid = Array.from({ length: this.rows }, () =>
      Array.from({ length: this.cols }, () => null)
    );
    this.regionStatus.clear();
    for (const region of this.map.regions) {
      this.regionStatus.set(region.id, region.status);
    }
    this.nextItemId = 1;
    this.energyCurrent = ENERGY_START;
    this.energyLastRegenAt = now;
    this.coins = 0;
    this.keys = 0;
    this.xp = 0;
    this.completedOrderIds = [];
    this.claimedMilestoneIds = [];
    this.tutorialIndex = 0;
    this.tutorialDone = false;
    this.emberSparks = EMBERFONT.startSparks;
    this.emberSparkAt = now;
    this.emberStoke = 0;
    this.emberStokeAt = now;
    this.emberSurgeUntil = 0;
    this.emberVeinIndex = 0;
    this.dragonLevels.clear();
    this.stats = {};
    this.discoveredRecipes = [];
  }

  hydrate(save: SaveDataV1): void {
    this.reset(save.energy.lastRegenAt);
    for (const item of save.items) {
      this.items.set(item.id, { ...item });
      this.grid[item.row]![item.col] = item.id;
    }
    this.nextItemId = save.nextItemId;
    for (const [regionId, status] of Object.entries(save.regions)) {
      this.regionStatus.set(regionId, status);
    }
    this.energyCurrent = save.energy.current;
    this.energyLastRegenAt = save.energy.lastRegenAt;
    this.coins = save.coins;
    this.keys = save.keys;
    this.xp = save.xp;
    this.completedOrderIds = [...save.orderProgress.completedIds];
    this.claimedMilestoneIds = [...(save.milestoneProgress?.claimedIds ?? [])];
    const ef = save.emberfontProgress;
    this.emberSparks = ef ? ef.sparks : EMBERFONT.startSparks;
    this.emberSparkAt = ef ? ef.sparkAt : save.energy.lastRegenAt;
    this.emberStoke = ef ? ef.stoke : 0;
    this.emberStokeAt = ef ? ef.stokeAt : save.energy.lastRegenAt;
    this.emberSurgeUntil = ef ? ef.surgeUntil : 0;
    this.emberVeinIndex = ef ? ef.veinIndex : 0;
    this.dragonLevels.clear();
    for (const [chain, v] of Object.entries(save.dragonLevels ?? {})) {
      this.dragonLevels.set(chain, { level: v.level, gauge: v.gauge });
    }
    this.tutorialIndex = save.tutorial.index;
    this.tutorialDone = save.tutorial.done;
    this.stats = { ...(save.stats ?? {}) };
    this.discoveredRecipes = [...(save.discoveredRecipes ?? [])];
  }

  toSave(savedAt: number, version: number): SaveDataV1 {
    return {
      version,
      savedAt,
      items: [...this.items.values()].map((i) => ({ ...i })),
      nextItemId: this.nextItemId,
      regions: Object.fromEntries(this.regionStatus),
      energy: { current: this.energyCurrent, lastRegenAt: this.energyLastRegenAt },
      coins: this.coins,
      keys: this.keys,
      xp: this.xp,
      orderProgress: { completedIds: [...this.completedOrderIds] },
      milestoneProgress: { claimedIds: [...this.claimedMilestoneIds] },
      emberfontProgress: {
        sparks: this.emberSparks,
        sparkAt: this.emberSparkAt,
        stoke: this.emberStoke,
        stokeAt: this.emberStokeAt,
        surgeUntil: this.emberSurgeUntil,
        veinIndex: this.emberVeinIndex
      },
      dragonLevels: Object.fromEntries(
        [...this.dragonLevels.entries()].map(([k, v]) => [k, { level: v.level, gauge: v.gauge }])
      ),
      tutorial: { index: this.tutorialIndex, done: this.tutorialDone },
      stats: { ...this.stats },
      discoveredRecipes: [...this.discoveredRecipes]
    };
  }

  /** Convenience for the stat counters (absent key = 0). */
  stat(key: string): number {
    return this.stats[key] ?? 0;
  }

  addStat(key: string, amount: number): void {
    this.stats[key] = (this.stats[key] ?? 0) + amount;
  }

  /* ------------- board mutation primitives (systems only) ------------- */

  addItem(spec: {
    chain: string;
    tier: number;
    col: number;
    row: number;
    kind: ItemKind;
    readyAt?: number;
  }): BoardItemState {
    if (!this.inBounds(spec.col, spec.row)) {
      throw new Error(`addItem out of bounds: ${spec.col},${spec.row}`);
    }
    if (this.grid[spec.row]![spec.col] !== null) {
      throw new Error(`addItem on occupied tile: ${spec.col},${spec.row}`);
    }
    const item: BoardItemState = { id: this.nextItemId++, ...spec };
    this.items.set(item.id, item);
    this.grid[spec.row]![spec.col] = item.id;
    return item;
  }

  moveItem(id: number, to: TilePos): void {
    const item = this.items.get(id);
    if (!item) throw new Error(`moveItem: unknown item ${id}`);
    if (!this.inBounds(to.col, to.row)) throw new Error(`moveItem out of bounds`);
    const occupant = this.grid[to.row]![to.col];
    if (occupant !== null && occupant !== id) {
      throw new Error(`moveItem onto occupied tile ${to.col},${to.row}`);
    }
    this.grid[item.row]![item.col] = null;
    item.col = to.col;
    item.row = to.row;
    this.grid[to.row]![to.col] = id;
  }

  removeItem(id: number): BoardItemState {
    const item = this.items.get(id);
    if (!item) throw new Error(`removeItem: unknown item ${id}`);
    this.grid[item.row]![item.col] = null;
    this.items.delete(id);
    return item;
  }

  /* ---------------- board helpers (reads only) ---------------- */

  inBounds(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.cols && row < this.rows;
  }

  regionIdAt(col: number, row: number): string | undefined {
    return this.tileRegion.get(tileKey(col, row));
  }

  regionStatusAt(col: number, row: number): RegionStatus | undefined {
    const id = this.regionIdAt(col, row);
    return id ? this.regionStatus.get(id) : undefined;
  }

  isTileActive(col: number, row: number): boolean {
    return this.inBounds(col, row) && this.regionStatusAt(col, row) === 'active';
  }

  itemIdAt(col: number, row: number): number | null {
    if (!this.inBounds(col, row)) return null;
    return this.grid[row]![col] ?? null;
  }

  itemAt(col: number, row: number): BoardItemState | undefined {
    const id = this.itemIdAt(col, row);
    return id === null ? undefined : this.items.get(id);
  }

  neighbors(col: number, row: number): TilePos[] {
    return [
      { col: col + 1, row },
      { col: col - 1, row },
      { col, row: row + 1 },
      { col, row: row - 1 }
    ].filter((p) => this.inBounds(p.col, p.row));
  }

  /** Free, active tiles adjacent to (col,row), nearest-first by insertion. */
  freeActiveNeighbors(col: number, row: number): TilePos[] {
    return this.neighbors(col, row).filter(
      (p) => this.isTileActive(p.col, p.row) && this.itemIdAt(p.col, p.row) === null
    );
  }

  /** All free active tiles, ordered by Manhattan distance from (col,row). */
  /** Free active tiles sorted nearest-first. `maxDist` (manhattan) caps the
   *  search — reward drops use it so a full neighbourhood BLOCKS the drop
   *  instead of teleporting it across the map (or off the platforms). */
  freeActiveTilesNear(col: number, row: number, maxDist?: number): TilePos[] {
    const free: TilePos[] = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!this.isTileActive(c, r) || this.grid[r]![c] !== null) continue;
        if (maxDist !== undefined && Math.abs(c - col) + Math.abs(r - row) > maxDist) continue;
        free.push({ col: c, row: r });
      }
    }
    return free.sort(
      (a, b) =>
        Math.abs(a.col - col) + Math.abs(a.row - row) - (Math.abs(b.col - col) + Math.abs(b.row - row))
    );
  }

  /** Count of board items matching chain+tier on active tiles (items only). */
  countItems(chain: string, tier: number): number {
    let n = 0;
    for (const item of this.items.values()) {
      if (item.kind === 'item' && item.chain === chain && item.tier === tier) n++;
    }
    return n;
  }

  itemsMatching(chain: string, tier: number): BoardItemState[] {
    return [...this.items.values()].filter(
      (i) => i.kind === 'item' && i.chain === chain && i.tier === tier
    );
  }

  /** A dragon colour's duel level + gauge (default Lv1 / 0 if never trained). */
  dragonStat(chain: string): { level: number; gauge: number } {
    const d = this.dragonLevels.get(chain);
    return d ? { ...d } : { level: 1, gauge: 0 };
  }

  /** The stored (mutable) duel record for a dragon colour, created on first use. */
  ensureDragon(chain: string): { level: number; gauge: number } {
    let d = this.dragonLevels.get(chain);
    if (!d) {
      d = { level: 1, gauge: 0 };
      this.dragonLevels.set(chain, d);
    }
    return d;
  }

  get level(): number {
    let level = 1;
    for (let i = 0; i < LEVEL_XP.length; i++) {
      if (this.xp >= LEVEL_XP[i]!) level = i + 1;
    }
    return level;
  }

  /** Max Warmth at the current level (+3 per level). */
  get energyMax(): number {
    return energyMaxForLevel(this.level);
  }

  /** XP progress within the current level: [gained, span]. */
  get levelProgress(): [number, number] {
    const lvl = this.level;
    const base = LEVEL_XP[lvl - 1] ?? 0;
    const next = LEVEL_XP[lvl] ?? base;
    const span = Math.max(1, next - base);
    return [Math.min(this.xp - base, span), span];
  }

  snapshot(item: BoardItemState, now?: number): ItemSnapshot {
    const snap: ItemSnapshot = {
      id: item.id,
      chain: item.chain,
      tier: item.tier,
      col: item.col,
      row: item.row,
      kind: item.kind
    };
    if (item.readyAt !== undefined && now !== undefined) {
      snap.ready = now >= item.readyAt;
    }
    return snap;
  }
}
