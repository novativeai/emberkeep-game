import { ENERGY_START, energyMaxForLevel, LEVEL_XP, REGRID_SEARCH_RINGS, WORLD_ID } from './Constants';
import type { MapSpace, PersistedPlace } from './mapSpace';
import { MAIN_ZONE, mapPointToWorld, placeOf, worldToMapPoint } from './mapSpace';
import type { WorldRuntime, ZoneRuntime } from './world';
import {
  buildWorlds,
  cellAtWorldPoint,
  cellInZone,
  cellsWithin,
  hasCell,
  neighborsOf,
  setActiveWorld,
  worldPointOf,
  zoneAt
} from './world';
import type {
  BagStack,
  BoardItemState,
  Companion,
  DragonCare,
  ItemKind,
  ItemSnapshot,
  MapData,
  NestState,
  RegionStatus,
  SaveDataV1,
  SavedBoardItem,
  SavedWorldBoard,
  TilePos
} from './types';

const tileKey = (col: number, row: number): string => `${col},${row}`;

/**
 * One world's board. Everything here is addressed by a `(col,row)` that only
 * means something beside the world that owns it, which is precisely why it
 * cannot live on GameState any more: two worlds both have a cell (3,4).
 *
 * Currency, XP, the tutorial, the bag, companions and region status are NOT
 * here — they belong to the Keeper, not to a place, and they follow the player
 * across worlds.
 */
export interface WorldBoard {
  items: Map<number, BoardItemState>;
  /** grid[row][col] -> itemId or null */
  grid: (number | null)[][];
  /** Cold Nest warming progress, keyed "col,row" IN THIS WORLD. */
  nests: Record<string, NestState>;
}

/**
 * The single source of truth for game state. Only systems mutate it; scenes
 * and UI read it (and react to EventBus notifications).
 */
export class GameState {
  /** Every world this build can run, keyed by id. */
  readonly worlds: Map<string, WorldRuntime>;
  /** The world the board is showing. Systems read `this.world` rather than this. */
  private activeId: string;
  private boards = new Map<string, WorldBoard>();

  regionStatus = new Map<string, RegionStatus>();

  nextItemId = 1;
  energyCurrent = ENERGY_START;
  energyLastRegenAt = 0;
  coins = 0;
  keys = 0;
  xp = 0;
  completedOrderIds: string[] = [];
  tutorialIndex = 0;
  tutorialDone = false;
  /** Lifetime counters (hatches, merges, goldEarned, elderTaps, …) plus
   *  one-shot numeric flags (finaleSeen, tasksClaimed). TaskSystem owns writes. */
  stats: Record<string, number> = {};
  /** Emberkeep Cookbook pages — first-time merge recipes, keyed
   *  `"chain:fromTier>resultTier"`. MergeSystem owns writes. */
  discoveredRecipes: string[] = [];
  /** The Bag — pooled stacks of stored board pieces. BagSystem owns writes. */
  bag: BagStack[] = [];
  /** How far the campaign has come, 1..12. StorySystem owns writes; it selects
   *  every dialogue bank in the game (docs/story-bible.md §6). */
  storyChapter = 1;
  /** `characterId -> readyAt` on the GameClock. WorldCharacterSystem owns writes. */
  characterCooldowns: Record<string, number> = {};
  /** Named dragons. NEVER in `items` — a name and the merge board are mutually
   *  exclusive. DragonSystem owns writes. */
  companions: Companion[] = [];
  nextCompanionId = 1;
  /** Store item ids bought (skins AND decor). StoreSystem owns writes. */
  ownedCosmetics: string[] = [];
  /** Equipped Manor skin id, or null for the authored Manor art. */
  manorSkin: string | null = null;
  /** Equipped DRAGON skins, keyed by the chain each re-skins
   *  (`{ ember_dragon: 'ashglass' }`). A map rather than one slot because the
   *  breeds are different animals: what the ember dragon wears says nothing
   *  about the emerald one. StoreSystem owns writes. */
  dragonSkins: Record<string, string> = {};
  /** Test hook: pins the Dragon Book discovery roll. Unset in play. */
  rollOverride: number | undefined = undefined;

  /**
   * What the last `hydrate` had to move because a world had been re-gridded
   * under the save: `to` is null for a piece that was banked in the satchel.
   * Empty on every normal load. Read by whoever wants to tell the player.
   */
  relocated: { id: number; from: TilePos; to: TilePos | null }[] = [];

  constructor(map: MapData, worldId: string = WORLD_ID) {
    this.worlds = buildWorlds(map);
    this.activeId = this.worlds.has(worldId) ? worldId : (this.worlds.keys().next().value as string);
    setActiveWorld(this.world);
    this.reset(0);
  }

  /* ---------------- worlds ---------------- */

  /** The world the board is showing — the only one whose `(col,row)` are live. */
  get world(): WorldRuntime {
    return this.worlds.get(this.activeId)!;
  }

  get worldId(): string {
    return this.activeId;
  }

  /** Map space for the ACTIVE world. See src/core/mapSpace.ts. */
  get space(): MapSpace {
    return this.world.space;
  }

  /** Fingerprint of the active world's grid, written into every save. */
  get signature(): string {
    return this.world.signature;
  }

  /** The map the renderer should draw for the active world. */
  get map(): MapData {
    return this.world.map;
  }

  get cols(): number {
    return this.world.cols;
  }

  get rows(): number {
    return this.world.rows;
  }

  /* ---------------- the active board ---------------- */

  /** Has this world's board ever been materialised — i.e. has the Keeper stood
   *  there? Asked BEFORE `switchWorld`, which materialises it. */
  visited(id: string): boolean {
    return this.boards.has(id);
  }

  private board(id = this.activeId): WorldBoard {
    let b = this.boards.get(id);
    if (!b) {
      const w = this.worlds.get(id)!;
      b = {
        items: new Map(),
        grid: Array.from({ length: w.rows }, () => Array.from({ length: w.cols }, () => null)),
        nests: {}
      };
      this.boards.set(id, b);
    }
    return b;
  }

  get items(): Map<number, BoardItemState> {
    return this.board().items;
  }

  /** Read-only view of a world's board items WITHOUT materialising it — for
   *  surfaces that ask about a board the player is not standing on (the Dragon
   *  Codex roster, the hub standee). An unvisited world reads as absent. */
  itemsIn(worldId: string): ReadonlyMap<number, BoardItemState> | undefined {
    return this.boards.get(worldId)?.items;
  }

  /** grid[row][col] -> itemId or null, for the ACTIVE world. */
  get grid(): (number | null)[][] {
    return this.board().grid;
  }

  /** Cold Nest warming progress for the ACTIVE world, keyed "col,row". */
  get nests(): Record<string, NestState> {
    return this.board().nests;
  }

  set nests(value: Record<string, NestState>) {
    this.board().nests = value;
  }

  /**
   * Show a different world. The board it left keeps standing exactly as it was —
   * its items are still in `boards`, its timers still tick on the shared clock —
   * so travel is a change of view, never a reset. Returns false for a world this
   * build does not have.
   */
  switchWorld(id: string): boolean {
    if (!this.worlds.has(id)) return false;
    this.activeId = id;
    this.board(id); // materialise, so the renderer never sees a half-built world
    setActiveWorld(this.world);
    return true;
  }

  /** Wipe to a brand-new game. `now` seeds the energy regen timestamp. */
  reset(now: number): void {
    this.boards.clear();
    this.activeId = this.worlds.has(WORLD_ID)
      ? WORLD_ID
      : (this.worlds.keys().next().value as string);
    setActiveWorld(this.world);
    this.regionStatus.clear();
    // Every world's regions, not just the active one: status is the Keeper's
    // progress through the whole game, and a region that unlocked while its
    // world was out of view must still be open when they return to it. Region
    // ids are unique across worlds by construction (see scripts/build-zones.mjs).
    for (const w of this.worlds.values()) {
      for (const region of w.map.regions) this.regionStatus.set(region.id, region.status);
    }
    this.nextItemId = 1;
    this.energyCurrent = ENERGY_START;
    this.energyLastRegenAt = now;
    this.coins = 0;
    this.keys = 0;
    this.xp = 0;
    this.completedOrderIds = [];
    this.tutorialIndex = 0;
    this.tutorialDone = false;
    this.stats = {};
    this.discoveredRecipes = [];
    this.bag = [];
    this.storyChapter = 1;
    this.characterCooldowns = {};
    this.companions = [];
    this.nextCompanionId = 1;
    this.nests = {};
    this.ownedCosmetics = [];
    this.manorSkin = null;
    this.dragonSkins = {};
  }

  hydrate(save: SaveDataV1): void {
    this.reset(save.energy.lastRegenAt);
    this.relocated = [];
    // The default world's board is stored at the top level of the save, exactly
    // where it has always been — a save written before worlds existed is a save
    // of this world and loads with nothing to migrate.
    this.hydrateBoards(save);
    // NEVER behind the board. A counter that has fallen below an id already on
    // the board hands the next spawn a number something else is using, and the
    // item map is keyed by id: the newcomer REPLACES a piece the player owns
    // while the grid still points at it. That is one of the ways a board comes
    // back looking scrambled, and it costs one max() to make impossible.
    let maxId = 0;
    for (const board of this.boards.values()) {
      for (const id of board.items.keys()) maxId = Math.max(maxId, id);
    }
    this.nextItemId = Math.max(save.nextItemId, maxId + 1);
    // Only 'active' is the PLAYER'S state — the one runtime transition is
    // unlockable→active, so any other saved value is just an echo of the
    // authored status at save time. Letting it through would pin a region to a
    // build's old lock typing: a save written while `beyond_l4` was 'locked'
    // demo scenery must not keep it locked now that the curve reaches it.
    for (const [regionId, status] of Object.entries(save.regions)) {
      if (status === 'active') this.regionStatus.set(regionId, status);
    }
    this.energyCurrent = save.energy.current;
    this.energyLastRegenAt = save.energy.lastRegenAt;
    this.coins = save.coins;
    this.keys = save.keys;
    this.xp = save.xp;
    this.completedOrderIds = [...save.orderProgress.completedIds];
    this.tutorialIndex = save.tutorial.index;
    this.tutorialDone = save.tutorial.done;
    this.stats = { ...(save.stats ?? {}) };
    this.discoveredRecipes = [...(save.discoveredRecipes ?? [])];
    // Bag last of the collections, so anything the relocation banked above is
    // pooled INTO the saved stacks rather than overwritten by them.
    const displaced = this.bag;
    this.bag = (save.bag ?? []).map((s) => ({ ...s }));
    for (const s of displaced) this.stashStack(s.chain, s.tier, s.count);
    this.storyChapter = save.storyChapter ?? 1;
    this.characterCooldowns = { ...(save.characterCooldowns ?? {}) };
    this.companions = (save.companions ?? []).map((c) => ({ ...c, discovered: [...c.discovered] }));
    this.nextCompanionId =
      this.companions.reduce((n, c) => Math.max(n, Number(c.id.split('_')[1] ?? 0) + 1), 1);
    this.ownedCosmetics = [...(save.ownedCosmetics ?? [])];
    this.manorSkin = save.manorSkin ?? null;
    this.dragonSkins = { ...(save.dragonSkins ?? {}) };
    // Last: the board the player was standing on. Unknown or absent (every save
    // written before travel existed) means the authored world, which is where
    // the game has always resumed.
    if (save.activeWorld && this.worlds.has(save.activeWorld)) this.switchWorld(save.activeWorld);
  }

  /**
   * Load every world's board — each piece filed under the world it was SAVED
   * ON, not under the section of the save it happened to be found in.
   *
   * The save's shape is historical: the authored world's board sits at the top
   * level (where it was before travel existed) and every other world's under
   * `boards`. That shape is fine, but it is not proof — `place.world` is what
   * the piece itself says, written beside its art position for exactly this
   * kind of question, and it is the only claim that cannot be broken by a
   * section being written or read wrongly. A piece that names another world is
   * routed there and resolved by its ART POSITION (its raw `(col,row)` indexed
   * a grid that is not the one it is going to), so a mis-filed board sorts
   * itself out on the next load instead of two worlds landing on one map.
   */
  private hydrateBoards(save: SaveDataV1): void {
    const sections = new Map<string, SavedWorldBoard>();
    // The home board always exists, even when it holds nothing: the game starts
    // standing on it.
    sections.set(WORLD_ID, {
      mapSignature: save.mapSignature,
      items: save.items,
      nests: save.nests,
      nestPlaces: save.nestPlaces
    });
    for (const [id, board] of Object.entries(save.boards ?? {})) {
      if (id === WORLD_ID) continue; // a duplicate section would double the home board
      sections.set(id, board);
    }

    const filed = new Map<string, { item: SavedBoardItem; regridded: boolean }[]>();
    for (const [sectionId, section] of sections) {
      for (const item of section.items ?? []) {
        const claimed = item.place?.world;
        const owner = claimed && this.worlds.has(claimed) ? claimed : sectionId;
        const world = this.worlds.get(owner);
        if (!world) continue; // a world this build no longer has: nothing to load it into
        // A piece filed under the wrong section is BY DEFINITION on a stale
        // grid, and this comparison says so without a special case: the
        // signature it was written against belongs to a different world.
        const regridded =
          section.mapSignature !== undefined && section.mapSignature !== world.signature;
        const list = filed.get(owner) ?? [];
        list.push({ item, regridded });
        filed.set(owner, list);
      }
    }

    for (const [id, section] of sections) {
      if (this.worlds.has(id)) this.hydrateBoard(id, section, filed.get(id) ?? []);
    }
    // A world nothing was saved UNDER but pieces were saved FOR still gets its
    // board — the routing above is what put them there.
    for (const [id, entries] of filed) {
      if (sections.has(id) || !this.worlds.has(id)) continue;
      this.hydrateBoard(id, { items: [] }, entries);
    }
  }

  /**
   * Load one world's board. Positions come straight out of the save whenever
   * that world's geometry is the geometry they were written against; when it is
   * not, they are recovered from map space (see `placeByMapPoint`).
   */
  private hydrateBoard(
    worldId: string,
    saved: SavedWorldBoard,
    entries: { item: SavedBoardItem; regridded: boolean }[]
  ): void {
    const world = this.worlds.get(worldId);
    if (!world) return;
    const board = this.board(worldId);
    for (const { item, regridded } of entries) {
      const { place, ...state } = item;
      const at = regridded
        ? this.placeByMapPoint(world, board, place, state)
        : this.placeAtSavedCell(world, board, place, state);
      if (!at) {
        // Its art position is on ground this world no longer has. Bank it rather
        // than delete it — a piece the player earned must never be the cost of
        // an engine change. Capacity is deliberately not enforced here: an
        // over-full satchel is a UI problem, a vanished dragon is not.
        this.stashDisplaced(state);
        continue;
      }
      const placed: BoardItemState = { ...state, col: at.col, row: at.row };
      board.items.set(placed.id, placed);
      board.grid[placed.row]![placed.col] = placed.id;
    }
    // Nests are keyed by cell, so on a re-grid the KEY has to move with the
    // cell — a nest left on a stale key is warming progress the player can no
    // longer reach. Its map point is stored beside it for exactly this.
    const regridded = saved.mapSignature !== undefined && saved.mapSignature !== world.signature;
    board.nests = {};
    for (const [k, value] of Object.entries(saved.nests ?? {})) {
      const moved = regridded ? this.relocateKey(world, k, saved.nestPlaces?.[k]) : k;
      if (moved) board.nests[moved] = { ...value };
    }
  }

  /**
   * The saved cell, when this world's grid is still the one that cell indexed —
   * but NEVER on top of something already standing there.
   *
   * ONE PIECE PER CELL is the invariant the whole board rests on: merging,
   * dragging, the grid's own reverse lookup and every hit test assume it, and
   * the loader used to be the one place that did not enforce it. It wrote each
   * saved piece straight into `items` and its id into `grid`, so two pieces
   * claiming one cell BOTH survived while the grid remembered only the last —
   * an invisible-to-the-rules piece drawn over a visible one, which is what a
   * "messy superposed board" is made of. A save can carry that pair for
   * reasons the loader cannot audit and should not have to; refusing to
   * reproduce it costs one check.
   *
   * The displaced piece is nudged to the nearest free cell of its own zone
   * through the same recovery a re-grid uses — its art position is right there
   * in the save — and banked in the satchel only if that finds nothing.
   */
  private placeAtSavedCell(
    world: WorldRuntime,
    board: WorldBoard,
    place: PersistedPlace | undefined,
    state: BoardItemState
  ): TilePos | null {
    if (this.canOccupy(world, board, state.col, state.row)) {
      return { col: state.col, row: state.row };
    }
    return this.placeByMapPoint(world, board, place, state);
  }

  /** One world's board, in the shape the save carries it. */
  private boardToSave(worldId: string): SavedWorldBoard {
    const world = this.worlds.get(worldId)!;
    const board = this.board(worldId);
    /**
     * Where a cell is, in every form the save carries: which grid owns it, and
     * where on the world's art it sits. The map point is measured from the
     * cell's ACTUAL world pixel, so it is exact on every zone — on the authored
     * isle that is term for term what the old single-lattice conversion
     * produced, so no existing save changes by a digit.
     */
    const place = (col: number, row: number): PersistedPlace => {
      const p = worldPointOf(world, col, row);
      return placeOf(
        world.space,
        worldId,
        col,
        row,
        world.playable.has(tileKey(col, row)),
        zoneAt(world, col, row)?.id ?? MAIN_ZONE,
        worldToMapPoint(world.space, p.x, p.y)
      );
    };
    return {
      mapSignature: world.signature,
      items: [...board.items.values()].map((i) => ({ ...i, place: place(i.col, i.row) })),
      nests: Object.fromEntries(Object.entries(board.nests).map(([k, v]) => [k, { ...v }])),
      nestPlaces: Object.fromEntries(
        Object.keys(board.nests).map((k) => {
          const [c, r] = k.split(',').map(Number);
          return [k, place(c ?? 0, r ?? 0)];
        })
      )
    };
  }

  toSave(savedAt: number, version: number): SaveDataV1 {
    // Other worlds only, and only ones that hold something: a save should not
    // grow a section per world the player has never set foot on.
    const boards: Record<string, SavedWorldBoard> = {};
    for (const id of this.worlds.keys()) {
      if (id === WORLD_ID) continue;
      const b = this.boards.get(id);
      if (!b || (b.items.size === 0 && Object.keys(b.nests).length === 0)) continue;
      boards[id] = this.boardToSave(id);
    }
    const home = this.boardToSave(WORLD_ID);
    return {
      version,
      savedAt,
      // `world` has always named the build's authored world and still does;
      // `activeWorld` is where the player currently stands.
      world: WORLD_ID,
      activeWorld: this.activeId,
      mapSignature: home.mapSignature,
      items: home.items,
      nestPlaces: home.nestPlaces,
      ...(Object.keys(boards).length ? { boards } : {}),
      nextItemId: this.nextItemId,
      regions: Object.fromEntries(this.regionStatus),
      energy: { current: this.energyCurrent, lastRegenAt: this.energyLastRegenAt },
      coins: this.coins,
      keys: this.keys,
      xp: this.xp,
      orderProgress: { completedIds: [...this.completedOrderIds] },
      tutorial: { index: this.tutorialIndex, done: this.tutorialDone },
      stats: { ...this.stats },
      discoveredRecipes: [...this.discoveredRecipes],
      bag: this.bag.map((s) => ({ ...s })),
      storyChapter: this.storyChapter,
      characterCooldowns: { ...this.characterCooldowns },
      companions: this.companions.map((c) => ({ ...c, discovered: [...c.discovered] })),
      nests: home.nests,
      ownedCosmetics: [...this.ownedCosmetics],
      manorSkin: this.manorSkin,
      dragonSkins: { ...this.dragonSkins }
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
    /** Carried over when a merge grows a dragon that has been being fed. */
    care?: DragonCare;
    /** Carried over with it — a merge grows her up, it does not replace her. */
    dragonName?: string;
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

  /* ---------------- re-grid recovery (see src/core/mapSpace.ts) ----------------
   * `hydrateBoard` only reaches this when a save's map signature no longer
   * matches the world being loaded. Adding zones BESIDE the authored isle does
   * not change what an address on the isle means, so today's saves still take
   * the fast path — this is for the day the isle itself is re-cut. It resolves
   * through the world's zones rather than one lattice, which is the whole point
   * of having stored an art position in the first place. */

  /**
   * Where a saved piece belongs in THIS world, from the art position it was
   * saved at. Nearest usable cell wins: the exact cell first, then rings
   * outward, so a piece that lands a tile inside a re-cut coastline still
   * settles beside where it stood. `null` when nothing within reach is usable —
   * the caller banks it.
   */
  private placeByMapPoint(
    world: WorldRuntime,
    board: WorldBoard,
    place: PersistedPlace | undefined,
    state: BoardItemState
  ): TilePos | null {
    const from = { col: state.col, row: state.row };
    // Nothing to go on (a save older than map space, or a world with no art to
    // anchor to): the old cell is the only information there is. Take it if it
    // is usable, and bank the piece rather than guess if it is not.
    if (!place || !world.space.anchored) {
      const ok = this.canOccupy(world, board, from.col, from.row);
      if (!ok) this.relocated.push({ id: state.id, from, to: null });
      return ok ? from : null;
    }
    // Map point → world pixels → whichever ZONE has ground there. Going through
    // pixels rather than a lattice is what makes this survive the isle being
    // split into several grids with different tile sizes.
    const at = mapPointToWorld(world.space, { x: place.mx, y: place.my });
    // The slab this piece is coming back to is the one it LEFT, whenever that
    // grid still exists. Resolving inside it — rather than asking which zone
    // happens to be nearest the art position now — is what stops a piece on the
    // isle's east edge from waking up on a different floating island because the
    // two ended up near each other in pixels.
    const home = world.zones.find((z) => z.id === place.zone);
    const target = home ? cellInZone(home, at.x, at.y) : cellAtWorldPoint(world, at.x, at.y);
    const slab = home ?? zoneAt(world, target.col, target.row) ?? world.fallback;
    // A piece that stood ON the isle has to come back on real ground even if
    // that costs it a tile — landing it in the void would leave it visible,
    // un-mergeable and unreachable. A piece that stood OFF the isle on purpose
    // (the Theme Crystal, authored outside `playable`) is scenery of the world
    // rather than of the board, so its art position wins outright.
    const wantsIsle = place.onIsle ?? true;
    const exactOk =
      zoneAt(world, target.col, target.row) === slab &&
      this.canOccupy(world, board, target.col, target.row) &&
      (!wantsIsle || world.playable.has(tileKey(target.col, target.row)));
    const found = exactOk
      ? target
      : this.nearestFree(world, board, target.col, target.row, wantsIsle, slab);
    if (!found) {
      this.relocated.push({ id: state.id, from, to: null });
      return null;
    }
    if (found.col !== from.col || found.row !== from.row) {
      this.relocated.push({ id: state.id, from, to: found });
    }
    return found;
  }

  /** A cell that can hold a hydrating piece: real ground, not already taken.
   *  Region STATUS is not consulted — a save legitimately holds pieces inside a
   *  region it has already unlocked, and re-locking them would be the loss this
   *  whole path exists to prevent. */
  private canOccupy(world: WorldRuntime, board: WorldBoard, col: number, row: number): boolean {
    if (!hasCell(world, col, row)) return false;
    // The grid row must actually EXIST. `hasCell` answers for the world's cell
    // registry, which a zone can extend past the row array (the Golden Altar is
    // authored at (-2,2)); writing an id into a row that is not there throws,
    // and a load that throws is a save the player cannot open at all. Banking
    // the piece is the honest answer to ground this board cannot index.
    if (!board.grid[row]) return false;
    return (board.grid[row]?.[col] ?? null) === null;
  }

  /**
   * The nearest cell to (col,row) that can receive a displaced piece, searched
   * in rings. `needsIsle` insists on the playable set — a merge piece we are
   * choosing a new home for must land on real ground, not in the void beside it
   * — while off-isle scenery only needs somewhere free.
   *
   * The search never leaves the target's ZONE. Index blocks sit side by side, so
   * a couple of rings east of the isle's last column is arithmetically a cell on
   * a different floating island — and a piece that quietly teleported to another
   * slab would be a far worse outcome than one honestly banked in the satchel.
   *
   * Bounded: past `REGRID_SEARCH_RINGS` the art has changed so much that
   * "nearest" stops meaning anything and the satchel is the honest answer.
   */
  private nearestFree(
    world: WorldRuntime,
    board: WorldBoard,
    col: number,
    row: number,
    needsIsle: boolean,
    home: ZoneRuntime
  ): TilePos | null {
    for (let r = 1; r <= REGRID_SEARCH_RINGS; r++) {
      for (let dc = -r; dc <= r; dc++) {
        for (let dr = -r; dr <= r; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== r) continue; // ring edge only
          const c = col + dc;
          const rw = row + dr;
          if (zoneAt(world, c, rw) !== home) continue;
          if (!this.canOccupy(world, board, c, rw)) continue;
          if (needsIsle && !world.playable.has(tileKey(c, rw))) continue;
          return { col: c, row: rw };
        }
      }
    }
    return null;
  }

  /** Move a "col,row" key into this world, or drop it if its ground is gone. */
  private relocateKey(
    world: WorldRuntime,
    key: string,
    place: PersistedPlace | undefined
  ): string | null {
    if (!place || !world.space.anchored) return key;
    const at = mapPointToWorld(world.space, { x: place.mx, y: place.my });
    const cell = cellAtWorldPoint(world, at.x, at.y);
    return hasCell(world, cell.col, cell.row) ? tileKey(cell.col, cell.row) : null;
  }

  /** Bank a piece that has nowhere to stand. */
  private stashDisplaced(state: BoardItemState): void {
    this.stashStack(state.chain, state.tier, 1);
  }

  private stashStack(chain: string, tier: number, count: number): void {
    const at = this.bag.find((s) => s.chain === chain && s.tier === tier);
    if (at) at.count += count;
    else this.bag.push({ chain, tier, count });
  }

  /* ---------------- board helpers (reads only) ---------------- */

  /**
   * Is there real ground at this address in the active world?
   *
   * The name is unchanged because the question is: everything that used to ask
   * "is this inside the rectangle" wanted "can something stand here", and on a
   * single-lattice world the two are the same sentence. On a zoned world they
   * are not — the index space has gaps between zones — so the answer now comes
   * from the world's cell registry. For the authored isle, whose zone is dense
   * over the whole 13×12, it returns exactly what the rectangle test returned.
   */
  inBounds(col: number, row: number): boolean {
    return hasCell(this.world, col, row);
  }

  regionIdAt(col: number, row: number): string | undefined {
    return this.world.tileRegion.get(tileKey(col, row));
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

  /**
   * The four cells touching this one — WITHIN THE SAME ZONE.
   *
   * Merging is an adjacency question, and adjacency stops at the edge of a
   * slab: two zones are two islands with sky between them, however close their
   * index blocks happen to sit. On the authored isle, whose one dense zone
   * covers the whole lattice, this returns precisely what the old bounds filter
   * returned, in the same order.
   */
  neighbors(col: number, row: number): TilePos[] {
    return neighborsOf(this.world, col, row);
  }

  /** Free, active tiles adjacent to (col,row), nearest-first by insertion. */
  freeActiveNeighbors(col: number, row: number): TilePos[] {
    return this.neighbors(col, row).filter(
      (p) => this.isTileActive(p.col, p.row) && this.itemIdAt(p.col, p.row) === null
    );
  }

  /**
   * Free active tiles sorted nearest-first. `maxDist` caps the search in STEPS —
   * reward drops use it so a full neighbourhood BLOCKS the drop instead of
   * teleporting it across the map (or off the platforms).
   *
   * "Nearest" is measured two ways, and which one applies is decided by the
   * ground, not by a flag. On the authored isle a step and a unit of index
   * arithmetic are the same thing, so it stays the sort it has always been —
   * every reward the tutorial drops lands on exactly the tile it always did. On
   * a zoned world they are unrelated: index blocks sit side by side with
   * gutters, so `|Δcol| + |Δrow|` would call a cell on another island "two away"
   * and the slab you are standing on "thirty". There it walks the ground.
   */
  freeActiveTilesNear(col: number, row: number, maxDist?: number): TilePos[] {
    const usable = (c: number, r: number): boolean =>
      this.isTileActive(c, r) && this.grid[r]![c] === null;

    if (!zoneAt(this.world, col, row)?.dense) {
      // cellsWithin already returns hop order, which IS nearest-first.
      const reach = cellsWithin(this.world, col, row, maxDist ?? this.cols + this.rows);
      const near = reach.filter((p) => usable(p.col, p.row));
      return usable(col, row) ? [{ col, row }, ...near] : near;
    }

    const free: TilePos[] = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!usable(c, r)) continue;
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
