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

/** The primary world's id — the authored isle the game boots into. */
export const PRIMARY_WORLD = '__primary__';

/**
 * ONE world's board: its pieces, what sits on which cell, and its own id counter.
 *
 * Each world owns its board outright. Before this, every world shared a single item
 * map and a visibility filter decided what you could see — so a piece in nb2 was
 * still on roothold's board: you could drag nb2's dragon while standing in roothold,
 * and an Emberberry looked like it "teleported" between worlds when only its
 * visibility had changed. A world you cannot reach into is the whole point.
 */
interface WorldBoard {
  items: Map<number, BoardItemState>;
  /** Cell "col,row" -> itemId. A Map, not a 2D array, so the Map Editor can expand
   *  the board to ANY cell (incl. negative) without reindexing. */
  occupancy: Map<string, number>;
  nextItemId: number;
}

const emptyBoard = (): WorldBoard => ({ items: new Map(), occupancy: new Map(), nextItemId: 1 });

/**
 * The single source of truth for game state. Only systems mutate it; scenes
 * and UI read it (and react to EventBus notifications).
 */
export class GameState {
  readonly cols: number;
  readonly rows: number;

  /** worldId -> its board. Created on first use, so a world costs nothing until visited. */
  private boards = new Map<string, WorldBoard>([[PRIMARY_WORLD, emptyBoard()]]);
  private world = PRIMARY_WORLD;

  /** The live world's board. Every accessor below reads through this, so systems and
   *  scenes keep their existing calls and simply act on the world you are in. */
  private board(): WorldBoard {
    let b = this.boards.get(this.world);
    if (!b) {
      b = emptyBoard();
      this.boards.set(this.world, b);
    }
    return b;
  }

  /** The live world's pieces, keyed by item id. */
  get items(): Map<number, BoardItemState> {
    return this.board().items;
  }

  private get occupancy(): Map<string, number> {
    return this.board().occupancy;
  }

  /** Which world the board is showing. Switching swaps the ENTIRE board. */
  get activeWorld(): string {
    return this.world;
  }

  setActiveWorld(worldId: string): void {
    this.world = worldId || PRIMARY_WORLD;
    this.board(); // materialise it, so a first visit starts from a clean board
  }

  /** Every world that has a board, live one included (save + diagnostics). */
  worldIds(): string[] {
    return [...this.boards.keys()];
  }

  regionStatus = new Map<string, RegionStatus>();
  private tileRegion = new Map<string, string>();
  /**
   * Map Editor "Apply" overrides: cell "col,row" -> forced active(true)/inactive.
   * Empty in normal play (zero behaviour change) — only the in-game Map Editor's
   * Apply writes here, to make newly-allocated cells habitable (droppable) live.
   */
  private editorTileOverrides = new Map<string, number>();
  /** The live world draws all of its own ground (see setCellsFullyAuthored). */
  private cellsFullyAuthored = false;
  /** Placeable board extent (col/row). Defaults to the authored 0..cols/0..rows;
   *  the Map Editor's Apply widens it so any allocated cell becomes placeable. */
  private minCol = 0;
  private maxCol = 0;
  private minRow = 0;
  private maxRow = 0;

  /** The live world's id counter — ids are unique per world, never reused. */
  get nextItemId(): number {
    return this.board().nextItemId;
  }
  set nextItemId(value: number) {
    this.board().nextItemId = value;
  }

  energyCurrent = ENERGY_START;
  energyLastRegenAt = 0;
  coins = 0;
  keys = 0;
  xp = 0;
  completedOrderIds: string[] = [];
  claimedMilestoneIds: string[] = [];
  tutorialIndex = 0;
  tutorialDone = false;
  /**
   * The OTHER worlds' tutorials (borealis), worldId -> progress. The primary world
   * deliberately keeps the two fields above rather than moving in here: the teleport
   * trigger, the Ledger and the quest panel all read `tutorialDone`, and the save
   * carries it at the top level. A second world's script is additive — an old save
   * has no entry and simply starts its script from the top the first time it lands.
   */
  worldTutorials = new Map<string, { index: number; done: boolean }>();
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
  dragonLevels = new Map<string, { level: number; gauge: number; fedAt?: number }>();
  /**
   * The dragon's LARDER: Emberberry bushes picked off the board and banked. Tapping
   * a bush stores it here (the board piece is consumed), and feeding spends from
   * here — the board is where food GROWS, the larder is where it waits.
   * DragonFeedSystem owns every write.
   */
  berryStock = 0;

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
    // Every world's board goes, not just the live one, and we come back to the
    // primary world — a new game must not leave a lair standing behind you.
    this.boards.clear();
    this.boards.set(PRIMARY_WORLD, emptyBoard());
    this.world = PRIMARY_WORLD;
    this.editorTileOverrides.clear();
    this.cellsFullyAuthored = false;
    this.minCol = 0;
    this.maxCol = this.cols - 1;
    this.minRow = 0;
    this.maxRow = this.rows - 1;
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
    this.worldTutorials.clear();
    this.emberSparks = EMBERFONT.startSparks;
    this.emberSparkAt = now;
    this.emberStoke = 0;
    this.emberStokeAt = now;
    this.emberSurgeUntil = 0;
    this.emberVeinIndex = 0;
    this.dragonLevels.clear();
    this.berryStock = 0;
    this.stats = {};
    this.discoveredRecipes = [];
  }

  /**
   * Rebuild every world's board from a save.
   *
   * A save written since worlds got their own boards carries `worlds` and is read
   * straight back. An OLDER save kept one board plus `itemWorlds`, a map of what to
   * SHOW where — that map is exactly the information needed to split those pieces
   * onto the right boards, so it becomes the migration and is then never written
   * again. That is what puts borealis' Golden dragon on borealis' board instead of
   * leaving it in nb2 wearing a label.
   */
  private hydrateBoards(save: SaveDataV1): void {
    const put = (b: WorldBoard, item: BoardItemState): void => {
      b.items.set(item.id, { ...item });
      b.occupancy.set(tileKey(item.col, item.row), item.id);
    };
    const ensure = (id: string): WorldBoard => {
      let b = this.boards.get(id);
      if (!b) {
        b = emptyBoard();
        this.boards.set(id, b);
      }
      return b;
    };
    const settleIds = (b: WorldBoard, saved?: number): void => {
      const maxId = b.items.size ? Math.max(...b.items.keys()) : 0;
      b.nextItemId = Math.max(saved ?? 0, maxId + 1);
    };

    if (save.worlds) {
      for (const [id, w] of Object.entries(save.worlds)) {
        const b = ensure(id);
        for (const item of w.items ?? []) put(b, item);
        settleIds(b, w.nextItemId);
      }
    } else {
      // Legacy: one board, split by the old ownership map.
      const owners = save.itemWorlds ?? {};
      for (const item of save.items ?? []) put(ensure(owners[String(item.id)] || PRIMARY_WORLD), item);
      const legacyNext = save.nextItemId;
      for (const id of this.boards.keys()) settleIds(ensure(id), id === PRIMARY_WORLD ? legacyNext : undefined);
    }
    this.setActiveWorld(save.activeWorld ?? PRIMARY_WORLD);
  }

  hydrate(save: SaveDataV1): void {
    // Defensive throughout: an older-SAVE_VERSION save may lack newer fields — we
    // fill sane defaults rather than throw, so a version bump preserves progress
    // (SaveSystem accepts version <= current; see the save-reset fix).
    const lastRegenAt = save.energy?.lastRegenAt ?? save.savedAt ?? 0;
    this.reset(lastRegenAt);
    this.hydrateBoards(save);
    for (const [regionId, status] of Object.entries(save.regions ?? {})) {
      this.regionStatus.set(regionId, status);
    }
    this.energyCurrent = save.energy?.current ?? ENERGY_START;
    this.energyLastRegenAt = lastRegenAt;
    this.coins = save.coins ?? 0;
    this.keys = save.keys ?? 0;
    this.xp = save.xp ?? 0;
    this.completedOrderIds = [...(save.orderProgress?.completedIds ?? [])];
    this.claimedMilestoneIds = [...(save.milestoneProgress?.claimedIds ?? [])];
    const ef = save.emberfontProgress;
    this.emberSparks = ef ? ef.sparks : EMBERFONT.startSparks;
    this.emberSparkAt = ef ? ef.sparkAt : save.energy.lastRegenAt;
    this.emberStoke = ef ? ef.stoke : 0;
    this.emberStokeAt = ef ? ef.stokeAt : save.energy.lastRegenAt;
    this.emberSurgeUntil = ef ? ef.surgeUntil : 0;
    this.emberVeinIndex = ef ? ef.veinIndex : 0;
    this.dragonLevels.clear();
    this.berryStock = save.berryStock ?? 0;
    for (const [chain, v] of Object.entries(save.dragonLevels ?? {})) {
      this.dragonLevels.set(chain, { level: v.level, gauge: v.gauge, fedAt: v.fedAt });
    }
    this.tutorialIndex = save.tutorial?.index ?? 0;
    this.tutorialDone = save.tutorial?.done ?? false;
    this.worldTutorials.clear();
    for (const [id, p] of Object.entries(save.worldTutorials ?? {})) {
      this.worldTutorials.set(id, { index: p.index, done: p.done });
    }
    this.stats = { ...(save.stats ?? {}) };
    this.discoveredRecipes = [...(save.discoveredRecipes ?? [])];
  }

  toSave(savedAt: number, version: number): SaveDataV1 {
    return {
      version,
      savedAt,
      // The top level always mirrors the PRIMARY world, whatever world is live, so an
      // older build reading this save still finds the isle it expects.
      items: [...(this.boards.get(PRIMARY_WORLD)?.items.values() ?? [])].map((i) => ({ ...i })),
      nextItemId: this.boards.get(PRIMARY_WORLD)?.nextItemId ?? 1,
      worlds: Object.fromEntries(
        [...this.boards.entries()].map(([id, b]) => [
          id,
          { items: [...b.items.values()].map((i) => ({ ...i })), nextItemId: b.nextItemId }
        ])
      ),
      activeWorld: this.world,
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
        [...this.dragonLevels.entries()].map(([k, v]) => [k, { level: v.level, gauge: v.gauge, fedAt: v.fedAt }])
      ),
      berryStock: this.berryStock,
      tutorial: { index: this.tutorialIndex, done: this.tutorialDone },
      worldTutorials: Object.fromEntries(
        [...this.worldTutorials.entries()].map(([id, p]) => [id, { index: p.index, done: p.done }])
      ),
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

  /* ---------------- tutorial progress, per world ---------------- */

  /** The primary isle answers from the two top-level fields; every other world from
   *  its own entry (absent = never started, so index 0 / not done). */
  tutorialIndexFor(worldId: string): number {
    if (worldId === PRIMARY_WORLD) return this.tutorialIndex;
    return this.worldTutorials.get(worldId)?.index ?? 0;
  }

  tutorialDoneFor(worldId: string): boolean {
    if (worldId === PRIMARY_WORLD) return this.tutorialDone;
    return this.worldTutorials.get(worldId)?.done ?? false;
  }

  setTutorialProgress(worldId: string, index: number, done: boolean): void {
    if (worldId === PRIMARY_WORLD) {
      this.tutorialIndex = index;
      this.tutorialDone = done;
      return;
    }
    this.worldTutorials.set(worldId, { index, done });
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
    if (this.occupancy.has(tileKey(spec.col, spec.row))) {
      throw new Error(`addItem on occupied tile: ${spec.col},${spec.row}`);
    }
    const item: BoardItemState = { id: this.nextItemId++, ...spec };
    this.items.set(item.id, item);
    this.occupancy.set(tileKey(spec.col, spec.row), item.id);
    return item;
  }

  moveItem(id: number, to: TilePos): void {
    const item = this.items.get(id);
    if (!item) throw new Error(`moveItem: unknown item ${id}`);
    if (!this.inBounds(to.col, to.row)) throw new Error(`moveItem out of bounds`);
    const occupant = this.occupancy.get(tileKey(to.col, to.row));
    if (occupant !== undefined && occupant !== id) {
      throw new Error(`moveItem onto occupied tile ${to.col},${to.row}`);
    }
    this.occupancy.delete(tileKey(item.col, item.row));
    item.col = to.col;
    item.row = to.row;
    this.occupancy.set(tileKey(to.col, to.row), id);
  }

  removeItem(id: number): BoardItemState {
    const item = this.items.get(id);
    if (!item) throw new Error(`removeItem: unknown item ${id}`);
    this.occupancy.delete(tileKey(item.col, item.row));
    this.items.delete(id);
    return item;
  }

  /* ---------------- board helpers (reads only) ---------------- */

  inBounds(col: number, row: number): boolean {
    return col >= this.minCol && row >= this.minRow && col <= this.maxCol && row <= this.maxRow;
  }

  /** The placeable board's current extent — it GROWS with the live world's cells
   *  (expandBoardTo), and a sub-world's cells can sit far outside the authored
   *  rectangle. Anything scanning "the whole board" must ask, never assume. */
  get bounds(): { minCol: number; maxCol: number; minRow: number; maxRow: number } {
    return { minCol: this.minCol, maxCol: this.maxCol, minRow: this.minRow, maxRow: this.maxRow };
  }

  /** Map Editor "Apply": widen the placeable board so (col,row) is in bounds. */
  expandBoardTo(col: number, row: number): void {
    this.minCol = Math.min(this.minCol, col);
    this.maxCol = Math.max(this.maxCol, col);
    this.minRow = Math.min(this.minRow, row);
    this.maxRow = Math.max(this.maxRow, row);
  }

  regionIdAt(col: number, row: number): string | undefined {
    return this.tileRegion.get(tileKey(col, row));
  }

  regionStatusAt(col: number, row: number): RegionStatus | undefined {
    const id = this.regionIdAt(col, row);
    return id ? this.regionStatus.get(id) : undefined;
  }

  isTileActive(col: number, row: number): boolean {
    if (!this.inBounds(col, row)) return false;
    // Map Editor override wins over the authored region. The value is an UNLOCK
    // LEVEL: 0 = blocked; N>=1 = playable once the Keeper reaches level N (1 = now).
    const o = this.editorTileOverrides.get(tileKey(col, row));
    if (o !== undefined) return o > 0 && this.level >= o;
    // In a world that draws ALL of its own ground, an un-drawn cell is void. Without
    // this, the authored isle's regions showed through underneath — the lair borrowed
    // playable cells from nb2 simply because both worlds use the same coordinates,
    // which is the cross-map effect the per-world boards exist to end.
    return !this.cellsFullyAuthored && this.regionStatusAt(col, row) === 'active';
  }

  /**
   * The live world authors EVERY playable cell itself (a sub-world entered by
   * teleport, whose hand-drawn grids ARE its ground). False for the primary world,
   * which layers editor overrides on top of the authored regions, and false in the
   * shipped game, which has no editor project at all.
   */
  setCellsFullyAuthored(authored: boolean): void {
    this.cellsFullyAuthored = authored;
  }

  /** True when the live world draws every playable cell itself. */
  get worldAuthorsItsCells(): boolean {
    return this.cellsFullyAuthored;
  }

  /** Does ANOTHER world's board hold a piece of this chain? The only cross-world
   *  read there is — a fact, so nobody has to keep a flag in step with it. */
  worldHolds(worldId: string, chain: string): boolean {
    const b = this.boards.get(worldId);
    if (!b) return false;
    for (const i of b.items.values()) if (i.chain === chain) return true;
    return false;
  }

  /** Map Editor override: unlock LEVEL for a cell (0 = blocked, N = opens at level N). */
  setEditorTileOverride(col: number, row: number, unlockLevel: number): void {
    this.editorTileOverrides.set(tileKey(col, row), unlockLevel);
  }
  clearEditorTileOverrides(): void {
    this.editorTileOverrides.clear();
  }

  itemIdAt(col: number, row: number): number | null {
    if (!this.inBounds(col, row)) return null;
    return this.occupancy.get(tileKey(col, row)) ?? null;
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
    for (let r = this.minRow; r <= this.maxRow; r++) {
      for (let c = this.minCol; c <= this.maxCol; c++) {
        if (!this.isTileActive(c, r) || this.occupancy.has(tileKey(c, r))) continue;
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
  dragonStat(chain: string): { level: number; gauge: number; fedAt?: number } {
    const d = this.dragonLevels.get(chain);
    return d ? { ...d } : { level: 1, gauge: 0 };
  }

  /** The stored (mutable) duel record for a dragon colour, created on first use. */
  ensureDragon(chain: string): { level: number; gauge: number; fedAt?: number } {
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
