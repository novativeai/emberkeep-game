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
  nearestPlayableCell,
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
  MapItemPlacement,
  NestState,
  RegionStatus,
  SaveDataV1,
  SavedWorldBoard,
  TilePos
} from './types';

const tileKey = (col: number, row: number): string => `${col},${row}`;

/**
 * The map's FIXTURES: a `startingItems` placement on a cell that belongs to NO
 * REGION.
 *
 * Regions are how ground becomes reachable — they unlock, they hold spawns,
 * they are what `isTileActive` answers about. A starting piece the map put
 * outside every one of them is therefore not opening board state at all: it is
 * scenery, standing where the backdrop painted something for it to stand on.
 * The Theme Crystal is the one this build ships, on its ledge below the isle.
 *
 * That distinction has to be ENFORCED, not merely implied by where the piece
 * starts. Every mover on the board — drag, snap-merge, the tutorial's scripted
 * relocations — only ever asked whether the DESTINATION was active ground, so
 * nothing stopped a fixture being dragged off its ledge onto the isle; and once
 * there, the save kept it there for good. A landmark the player can pick up and
 * has no legal way to put back is a bug however carefully it was placed.
 */
const authoredFixtures = (world: WorldRuntime): MapItemPlacement[] =>
  (world.map.startingItems ?? []).filter((p) => !world.tileRegion.has(tileKey(p.at[0], p.at[1])));

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
  /** Worn keeper looks, by wardrobe key ('eleanor' -> 'eleanor_beach'). */
  keeperSkins: Record<string, string> = {};
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
    this.keeperSkins = {};
  }

  hydrate(save: SaveDataV1): void {
    this.reset(save.energy.lastRegenAt);
    this.relocated = [];
    // The default world's board is stored at the top level of the save, exactly
    // where it has always been — a save written before worlds existed is a save
    // of this world and loads with nothing to migrate.
    this.hydrateBoard(WORLD_ID, {
      mapSignature: save.mapSignature,
      items: save.items,
      nests: save.nests,
      nestPlaces: save.nestPlaces
    });
    for (const [id, board] of Object.entries(save.boards ?? {})) {
      if (id === WORLD_ID || !this.worlds.has(id)) continue;
      this.hydrateBoard(id, board);
    }
    // The item map is keyed by id, so a counter behind its own board is not a
    // cosmetic drift: the next spawn REPLACES a piece the player owns while the
    // grid goes on pointing at the id it just overwrote. A save can carry one —
    // an older writer, a hand-edited file, a board hydrated from a world the
    // counter was never told about — so the floor is derived from what is
    // actually standing rather than trusted from the file.
    let highest = 0;
    for (const b of this.boards.values()) {
      for (const id of b.items.keys()) highest = Math.max(highest, id);
    }
    this.nextItemId = Math.max(save.nextItemId, highest + 1);
    // A SAVE RECORDS PROGRESS, NOT THE LADDER.
    //
    // The statuses seeded above come from the maps this BUILD ships; the save's
    // are what some earlier build wrote. Letting the file overwrite them both
    // ways meant a stale echo could CLOSE ground the current map authors as
    // openable — and `locked` is a one-way door: UnlockSystem only ever lifts a
    // region already at `unlockable`, so a locked band ignores every level-up
    // for the rest of that save's life. Any save written while the level cap
    // was short carries exactly that for every band above the old cap.
    //
    // So only `active` — the one status that means the player DID something —
    // travels, and only for a region this build still has. A renamed band (the
    // isle's waves are named from measured islands, and re-exporting renames
    // them) leaves its old id behind rather than haunting the map with a status
    // nothing reads.
    for (const [regionId, status] of Object.entries(save.regions)) {
      if (status !== 'active' || !this.regionStatus.has(regionId)) continue;
      this.regionStatus.set(regionId, 'active');
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
    this.keeperSkins = { ...(save.keeperSkins ?? {}) };
    // Last: the board the player was standing on. Unknown or absent (every save
    // written before travel existed) means the authored world, which is where
    // the game has always resumed.
    if (save.activeWorld && this.worlds.has(save.activeWorld)) this.switchWorld(save.activeWorld);
  }

  /**
   * Load one world's board. Positions come straight out of the save whenever
   * that world's geometry is the geometry they were written against; when it is
   * not, they are recovered from map space (see `placeByMapPoint`).
   */
  private hydrateBoard(worldId: string, saved: SavedWorldBoard): void {
    const world = this.worlds.get(worldId);
    if (!world) return;
    const board = this.board(worldId);
    // Does this save's grid still exist? Equal signature = the `(col,row)` in it
    // still index the world being loaded, which is every load today. Different =
    // the world was re-gridded under a save (new zones on the isle itself, a new
    // tile size, a moved backdrop) and the cells are stale.
    const regridded = saved.mapSignature !== undefined && saved.mapSignature !== world.signature;
    for (const item of saved.items ?? []) {
      const { place, ...state } = item;
      const at = regridded
        ? this.placeByMapPoint(world, board, place, state)
        : { col: state.col, row: state.row };
      if (!at) {
        // Its art position is on ground this world no longer has. Bank it rather
        // than delete it — a piece the player earned must never be the cost of
        // an engine change. Capacity is deliberately not enforced here: an
        // over-full satchel is a UI problem, a vanished dragon is not.
        this.stashDisplaced(state);
        continue;
      }
      // ONE PIECE PER CELL. Merging, dragging, the grid's reverse lookup and
      // every hit test assume it, and the loader is the one place that can
      // break it: writing both and letting the grid remember only the last
      // leaves a piece that exists in `items` — so it draws, and the rules walk
      // it — under a cell that points at something else. Invisible to the
      // rules, visible on screen, and unreachable for ever.
      //
      // The save can say it for reasons that are nobody's fault: a re-grid can
      // land two art positions in one cell, and `restoreFixtures` below seats
      // landmarks on cells it does not ask permission for. So the second piece
      // is re-seated beside the first, or banked — never dropped, never stacked.
      let seat: TilePos | null = { col: at.col, row: at.row };
      if (board.grid[seat.row]?.[seat.col] != null) {
        const home = zoneAt(world, seat.col, seat.row) ?? world.fallback;
        seat = this.nearestFree(world, board, seat.col, seat.row, true, home);
      }
      if (!seat) {
        this.stashDisplaced(state);
        continue;
      }
      const placed: BoardItemState = { ...state, col: seat.col, row: seat.row };
      board.items.set(placed.id, placed);
      board.grid[placed.row]![placed.col] = placed.id;
    }
    // Nests are keyed by cell, so on a re-grid the KEY has to move with the
    // cell — a nest left on a stale key is warming progress the player can no
    // longer reach. Its map point is stored beside it for exactly this.
    board.nests = {};
    for (const [k, value] of Object.entries(saved.nests ?? {})) {
      const moved = regridded ? this.relocateKey(world, k, saved.nestPlaces?.[k]) : k;
      if (moved) board.nests[moved] = { ...value };
    }
    this.restoreFixtures(world, board);
  }

  /**
   * Put the map's fixtures back on the cells the map authored for them.
   *
   * The guards above stop a fixture from ever being moved again, but they
   * cannot un-move the ones already sitting in saved games — and a landmark
   * that wandered is not something a player can drag home, because its ledge is
   * not a legal drop target. So every load walks the world's own
   * `startingItems` and re-seats anything that drifted.
   *
   * The authored cell is taken back UNCONDITIONALLY. It used to give up when
   * something else was standing there, and that was the last hole: the piece
   * squatting on a fixture's cell is itself a piece that only got there by the
   * same accident, so the polite version could leave the landmark stranded
   * forever with no way for anyone to notice. The squatter is not destroyed —
   * it takes the nearest free ground, or the satchel.
   */
  private restoreFixtures(world: WorldRuntime, board: WorldBoard): void {
    for (const placement of authoredFixtures(world)) {
      const [col = 0, row = 0] = placement.at;
      if (!hasCell(world, col, row)) continue;
      const item =
        [...board.items.values()].find(
          (i) => i.kind === 'item' && i.chain === placement.chain && i.tier === placement.tier
        ) ?? [...board.items.values()].find((i) => i.kind === 'item' && i.chain === placement.chain);
      if (!item || (item.col === col && item.row === row)) continue;
      const sitting = board.grid[row]?.[col] ?? null;
      if (sitting !== null && sitting !== item.id) {
        const squatter = board.items.get(sitting);
        board.grid[row]![col] = null;
        if (squatter) {
          const home = zoneAt(world, col, row) ?? world.fallback;
          const free = this.nearestFree(world, board, col, row, true, home);
          if (free) {
            squatter.col = free.col;
            squatter.row = free.row;
            board.grid[free.row]![free.col] = squatter.id;
          } else {
            board.items.delete(squatter.id);
            this.stashDisplaced(squatter);
          }
        }
      }
      board.grid[item.row]![item.col] = null;
      board.grid[row]![col] = item.id;
      item.col = col;
      item.row = row;
    }
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
      dragonSkins: { ...this.dragonSkins },
      keeperSkins: { ...this.keeperSkins }
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
    // A map fixture is immovable, and this is the SINGLE funnel every mover
    // goes through — MergeSystem, BoardSystem, DragonLifeSystem all end here.
    // The callers check too (so they can bounce the piece and tell the player),
    // but the guard belongs here as well: the Theme Crystal was lost precisely
    // because the rule lived in the callers, and a caller can be added.
    if (this.isFixture(item)) return;
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

  /**
   * Carry a piece THROUGH — off this world's board and onto another's, keeping
   * its identity.
   *
   * `moveItem` cannot do this and must not learn to: it moves a piece within
   * `grid`, and there is one grid per world. Crossing is a different act — the
   * piece leaves an occupancy map and joins another — and it is the ONLY way a
   * board item changes world, so it is one funnel like `moveItem` is.
   *
   * The IDENTITY travels, not a copy. Item ids are unique across worlds by
   * construction, so the same `id` on the far side means the same animal: the
   * name the Keeper gave it, the care record the Codex counts, the ready timer
   * a generator is running. Re-spawning it there would hand back a stranger
   * wearing its art — and, for a NAMED dragon, break the one law the naming
   * rests on (a named thing is never consumed and re-made).
   *
   * Returns false rather than throwing when the destination cannot take it: an
   * unknown world, or a cell that is out of bounds or already occupied. A
   * cinematic crossing is not worth a thrown exception inside the game loop.
   */
  crossItemToWorld(id: number, worldId: string, to: TilePos): boolean {
    const item = this.items.get(id);
    if (!item || !this.worlds.has(worldId) || worldId === this.activeId) return false;
    const world = this.worlds.get(worldId)!;
    if (to.col < 0 || to.row < 0 || to.col >= world.cols || to.row >= world.rows) return false;
    const board = this.board(worldId); // materialises the far side if unvisited
    if (board.grid[to.row]![to.col] !== null) return false;
    this.grid[item.row]![item.col] = null;
    this.items.delete(id);
    item.col = to.col;
    item.row = to.row;
    board.items.set(id, item);
    board.grid[to.row]![to.col] = id;
    return true;
  }

  /**
   * Send every WORLD-BOUND chain's pieces home — the save-heal for a chain
   * that acquired a `world` after players already owned it.
   *
   * The bag made the leak: a Borealis-only egg bought in Borealis overflows
   * into the bag, the bag follows the Keeper, and the egg comes out on any
   * board she likes. Closing the faucet (BagSystem now refuses the placement)
   * fixes tomorrow; this fixes the saves that already carry a frost dragon on
   * a southern isle. Items go to a free playable cell of their home world —
   * anchored at its first door so they read as having ARRIVED, not spawned —
   * and only fall back to the bag when the home board is genuinely full,
   * because a named dragon stacked into the bag would lose its name.
   */
  exileForeignChains(homeOf: (chain: string) => string | undefined): number {
    let moved = 0;
    for (const [worldId, board] of [...this.boards]) {
      for (const item of [...board.items.values()]) {
        if (item.kind !== 'item') continue;
        const home = homeOf(item.chain);
        if (!home || home === worldId || !this.worlds.has(home)) continue;
        board.grid[item.row]![item.col] = null;
        board.items.delete(item.id);
        const world = this.worlds.get(home)!;
        const target = this.board(home); // materialises an unvisited far side
        const door = world.portals[0];
        const anchor = door
          ? { x: door.x + door.width / 2, y: door.y + door.height / 2 }
          : worldPointOf(world, 0, 0);
        const free = (col: number, row: number): boolean =>
          target.grid[row]?.[col] === null;
        const at = nearestPlayableCell(world, anchor.x, anchor.y, free);
        if (at) {
          item.col = at.col;
          item.row = at.row;
          target.items.set(item.id, item);
          target.grid[at.row]![at.col] = item.id;
        } else {
          this.stashStack(item.chain, item.tier, 1);
        }
        moved += 1;
      }
    }
    return moved;
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

  /**
   * Is this piece a FIXTURE of the map rather than a piece of the board?
   *
   * Matched on chain: a fixture is authored once, is the only piece of its
   * chain the board ever holds, and — being outside `playable` — cannot be told
   * apart by its cell once something has already moved it. Everything that
   * relocates a piece asks this first, so the answer stays the same whether the
   * mover is a drag, a snap-merge or a scripted tutorial beat.
   */
  isFixture(item: { chain: string; kind: ItemKind }): boolean {
    return item.kind === 'item' && authoredFixtures(this.world).some((p) => p.chain === item.chain);
  }

  /**
   * Does the world the Keeper is standing on still hold a door a Gold Key
   * opens? Keys are Keeper-wide — they follow the player across worlds — so
   * "do I have one" is never the same question as "is there anything here to
   * spend it on", and only the second one is worth putting on screen.
   */
  hasKeyGate(): boolean {
    return this.map.regions.some(
      (r) => r.unlock?.keys !== undefined && this.regionStatus.get(r.id) !== 'active'
    );
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

  /**
   * THE SAME COUNT, ACROSS EVERY BOARD THE KEEPER HAS EVER STOOD ON.
   *
   * A quest is the Keeper's business, not a board's. The pieces it asks for are
   * hers wherever she left them, so travelling north must not make six Gem
   * Shards on the home isle read as zero — which is exactly what the per-world
   * count did, and why the ladder used to be hidden outside the world that
   * authored it rather than merely being inconvenient there.
   *
   * Only MATERIALISED boards are searched, which is the whole set that can hold
   * anything: a world nobody has visited has no items to find.
   */
  countItemsAnywhere(chain: string, tier: number): number {
    let n = 0;
    for (const board of this.boards.values()) {
      for (const item of board.items.values()) {
        if (item.kind === 'item' && item.chain === chain && item.tier === tier) n++;
      }
    }
    return n;
  }

  /** The pieces behind `countItemsAnywhere`, each with the board it stands on —
   *  because consuming one means reaching into THAT world's grid, not this
   *  one's. Sorted by id so a delivery always takes the oldest first, which is
   *  the order the single-board path has always used. */
  itemsMatchingAnywhere(chain: string, tier: number): { worldId: string; item: BoardItemState }[] {
    const found: { worldId: string; item: BoardItemState }[] = [];
    for (const [worldId, board] of this.boards) {
      for (const item of board.items.values()) {
        if (item.kind === 'item' && item.chain === chain && item.tier === tier) {
          found.push({ worldId, item });
        }
      }
    }
    return found.sort((a, b) => a.item.id - b.item.id);
  }

  /** Which board holds this item, if any — the lookup a cross-world consume
   *  needs before it can take one off its grid. */
  worldOfItem(id: number): string | undefined {
    for (const [worldId, board] of this.boards) {
      if (board.items.has(id)) return worldId;
    }
    return undefined;
  }

  /** `removeItem`, addressed to a named board. The active-world version is this
   *  with `activeId` filled in; they are separate only because everything that
   *  removes a piece the player is LOOKING at should keep saying so. */
  removeItemIn(worldId: string, id: number): BoardItemState | undefined {
    const board = this.boards.get(worldId);
    const item = board?.items.get(id);
    if (!board || !item) return undefined;
    board.grid[item.row]![item.col] = null;
    board.items.delete(id);
    return item;
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
