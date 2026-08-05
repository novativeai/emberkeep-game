import Phaser from 'phaser';
import { SCENES, WORLD_TELEPORT } from '../core/Constants';
import type { GameContext } from '../core/Context';
import type { BoardScene } from '../scenes/BoardScene';
import { importAsset, recreateModel, recreateModelFromUrl, restoreTexture } from './assetImport';
import { deleteAsset3dFile, listAsset3dFiles, loadEditorMap, saveEditorMap } from './asset3dFs';
import { BoardEditor } from './BoardEditor';
import { EditorDom } from './EditorDom';
import { setLattice, setProjection, worldToGrid } from '../core/iso';
import { PRIMARY_WORLD } from '../core/GameState';
import { editorStore, gridBBox, gridCellCenter, latticeFor, type GridDef, type MapLayer, type MapZone, type PlacedAsset, type PositionEntry } from './editorStore';

/**
 * Map Editor orchestrator: ties the DOM chrome, the Phaser board layer and the
 * running game together. Opened from Settings (`editor:open`). It also owns the
 * cross-domain glue the DOM can't reach on its own — the Position list (live game
 * objects + placed assets), focusing, and the JSON export. Created once at boot.
 */
export class MapEditor {
  private boardEditor?: BoardEditor;
  private dom: EditorDom;
  private mapsRestored = false;
  /** The world restore has run (via `ctx.worldPreparer`), so the `game:started`
   *  fallback must stand down rather than restore a second time. */
  private prepared = false;
  /** Resolves once the on-disk default (asset3d/editor-map.json) has been loaded
   *  and mirrored into the store. `game:started` awaits this so the FIRST restore
   *  always uses the authoritative disk data — no race with a stale localStorage
   *  snapshot (which was the "wrong on reopen, right on refresh" asset bug). */
  private diskReady: Promise<void>;

  constructor(
    private game: Phaser.Game,
    private ctx: GameContext
  ) {
    editorStore.load(); // localStorage (fast, in-session)
    this.diskReady = this.loadDiskProject(); // asset3d/editor-map.json — the baked-in default
    this.dom = new EditorDom(
      (file) => importAsset(this.boardScene()!, file),
      () => this.exportJson(),
      () => this.objects(),
      (id) => this.focus(id),
      () => this.close(),
      () => this.apply(),
      () => this.save(),
      (show) => this.boardEditor?.revealGameContent(show),
      (id) => this.deleteAsset(id),
      (data) => this.importProjectJson(data)
    );
    this.dom.previewProvider = (key) => this.textureURL(key);
    ctx.bus.on('editor:open', () => this.open());
    // Re-apply the saved playable zones AND re-render the placed assets once the
    // board is live (game:started fires on BOTH load and new-game, AFTER hydrate so
    // overrides aren't wiped) — so the map (cells + 3D/decor) survives a reload
    // without re-opening the editor, and the 3D keeps animating.
    //
    // Await the disk default FIRST so there is exactly ONE restore, driven by the
    // authoritative on-disk data — never a concurrent second restore off a stale
    // localStorage snapshot that could win the race and paint the wrong assets.
    //
    // It runs as `beginRun`'s world PREPARER: the save is hydrated, then this is
    // awaited, and only then is anything announced — so the playable zones, the
    // backdrop and above all the cell LATTICE are live before a single system reads a
    // coordinate. Everything the game saves is (col,row); this project is what those
    // numbers mean.
    ctx.worldPreparer = (activeWorld) => this.onGameStarted(activeWorld);
    // Fallback for a boot where nothing wired the preparer, so the restore can never
    // be skipped outright. `prepared` stops it from doubling up on the normal path.
    ctx.bus.on('game:started', () => {
      if (!this.prepared) void this.onGameStarted(this.ctx.state.activeWorld);
    });
    // A teleport (BoardScene, mid-cinematic) asks to switch the live game world.
    ctx.bus.on('world:switch', ({ toWorld }) => void this.switchToWorld(toWorld));
    // The return button asks to go back to the primary world (Level 1).
    ctx.bus.on('world:return', () => void this.returnToPrimary());
  }

  /** The single boot/reload restore: wait for the on-disk default to load, then
   *  re-apply World 1's zones + assets exactly once. */
  private async onGameStarted(live: string): Promise<void> {
    this.prepared = true;
    await this.diskReady;
    await this.restoreToGame();
    await this.applyActiveBackdrop();
    // Reloading INSIDE a sub-world: the save knows which world was live (it holds
    // that world's board), the editor's runtime override does not — it always came
    // back pointing at the primary map. So the lair's pieces were drawn on the
    // isle's backdrop, on the isle's cells, at the isle's pitch. Re-enter the world
    // the save is standing in, through the one path that sets all three.
    if (live !== PRIMARY_WORLD && editorStore.mapByName(live)) await this.switchToWorld(live);
    // The isle gets the same check every other world gets: `board:reconcile` records
    // the units its coordinates are written in, and re-projects them if a build ever
    // ships a different authored tile. Its stranded-piece repair is gated on
    // `worldAuthorsItsCells`, which the isle never sets — so the Theme Crystal, a
    // landmark parked off the playable zone on purpose, is left exactly where it is.
    else this.ctx.bus.emit('board:reconcile', {});
  }

  /** Draw the ACTIVE world's map as the GAME's backdrop: the authored one for
   *  '__base__', else the imported map's texture (primary map or a teleport target).
   *  So gameplay shows your improved / switched map instead of the authored one. */
  private async applyActiveBackdrop(): Promise<void> {
    const scene = this.boardScene() as BoardScene | undefined;
    if (!scene) return;
    const id = editorStore.activeGameWorldId;
    if (id === '__base__') {
      scene.applyWorldBackdrop(null); // the authored map is the world
      return;
    }
    const map = [...editorStore.maps, ...editorStore.resolvedSavedMaps()].find((m) => m.id === id && m.dataUrl);
    if (!map?.dataUrl) return;
    try {
      if (!scene.textures.exists(map.textureKey)) await restoreTexture(scene, map.textureKey, map.dataUrl);
      scene.applyWorldBackdrop(map.textureKey);
    } catch (e) {
      console.warn('[MapEditor] could not apply the world backdrop', e);
    }
  }

  /** Switch the live game to another editor world (a `world:switch` teleport target):
   *  swap the backdrop, re-apply that world's playable cells + decor. */
  private async switchToWorld(mapName: string): Promise<void> {
    const map = editorStore.mapByName(mapName);
    if (!map) {
      console.warn('[MapEditor] world:switch — no map named', mapName);
      return;
    }
    editorStore.activeWorldId = map.id;
    // Adopt the world's OWN cell pitch. Its grids were hand-drawn on its own backdrop
    // art, at whatever scale that art is painted; folding them through the authored
    // lattice collapses several drawn cells onto one game cell — measured at 53% of
    // roothold's cells and 51% of borealis'. `latticeFor` returns null for a world it
    // cannot represent (rotated or ortho grids), and that world simply keeps the
    // authored lattice.
    //
    // This MUST come before applyBaseToGame, which projects every drawn cell through
    // the live lattice to decide which game cells are playable.
    //
    // It was held back for a long time because it moves the ONE global projection and
    // the game kept ONE item store for every world, so re-pitching roothold relocated
    // nb2's pieces too. Worlds own their boards now, and the live world is saved —
    // nothing outside this world is projected while it is live. See docs/worlds.md.
    const lattice = latticeFor(editorStore.gridsFor(map.id));
    if (lattice) setLattice(lattice);
    await this.applyActiveBackdrop();
    this.applyBaseToGame(); // the new world's playable cells (state-only)
    const scene = this.boardScene() as BoardScene | undefined;
    if (!scene) return;
    const assets = editorStore.assetsFor(map.id);
    for (const a of assets) {
      try {
        await this.ensureAssetTexture(scene, a);
      } catch (e) {
        console.warn('[MapEditor] world:switch asset', a.name, e);
      }
    }
    scene.applyEditorState(
      assets.filter((a) => scene.textures.exists(a.textureKey)).map((a) => this.assetPayload(a, map.id))
    );
    // A real switch happened (the world exists) → let the UI show a "return" button
    // and the tutorial stand down. Never fires when the target world is absent.
    this.ctx.bus.emit('world:switched', { toWorld: mapName });
  }

  /** Return the live game to the PRIMARY world ("Level 1"): clear the runtime world
   *  override, restore its backdrop + playable cells + decor. */
  private async returnToPrimary(): Promise<void> {
    editorStore.activeWorldId = null;
    // Hand the authored lattice back — the primary world's grids were drawn at the
    // game's own pitch (74 of 75 cells survive it), so a median pitch would LOSE
    // cells here. Only the sub-worlds adopt one of their own.
    setProjection(this.ctx.data.map.tile);
    await this.applyActiveBackdrop();
    this.applyBaseToGame();
    const scene = this.boardScene() as BoardScene | undefined;
    if (!scene) return;
    const id = editorStore.activeGameWorldId;
    const assets = editorStore.assetsFor(id);
    for (const a of assets) {
      try {
        await this.ensureAssetTexture(scene, a);
      } catch (e) {
        console.warn('[MapEditor] world:return asset', a.name, e);
      }
    }
    scene.applyEditorState(
      assets.filter((a) => scene.textures.exists(a.textureKey)).map((a) => this.assetPayload(a, id))
    );
    // Home, with the authored lattice and the isle's own cells both back in place —
    // the one moment on this path where a reconcile can read the truth. BoardScene
    // deliberately does NOT emit one from its own `world:return` handler: that runs
    // synchronously, a tick before `applyBaseToGame` above lowers the lair's
    // "I draw all my own ground" flag, and the repair then walked the isle's
    // out-of-zone fixtures onto the nearest tile on every single trip home.
    this.ctx.bus.emit('board:reconcile', {});
  }

  private boardScene(): Phaser.Scene | undefined {
    return this.game.scene.getScene(SCENES.board) ?? undefined;
  }

  /** Editor asset → the BoardScene decor payload. When pinned to a custom grid cell,
   *  include its EXACT world position (wx/wy) so it lands ON the grid in-game too —
   *  the game world has no notion of custom grids, so col/row alone would only
   *  approximate it to the nearest game cell. */
  private assetPayload(
    a: PlacedAsset,
    worldId: string
  ): { id: string; movable?: boolean; rot?: number; flipX?: boolean; flipY?: boolean; frameCount?: number; frameRate?: number; textureKey: string; col: number; row: number; z?: number; w: number; h: number; scale: number; wx?: number; wy?: number } {
    const base = { id: a.id, movable: a.movable, rot: a.rot, flipX: a.flipX, flipY: a.flipY, frameCount: a.frameCount, frameRate: a.frameRate, textureKey: a.textureKey, col: a.col, row: a.row, z: a.z, w: a.w, h: a.h, scale: a.scale };
    if (a.gridId && a.gi !== undefined && a.gj !== undefined) {
      const g = editorStore.gridsFor(worldId).find((x) => x.id === a.gridId);
      if (g) {
        const c = gridCellCenter(g, a.gi, a.gj);
        return { ...base, wx: c.x, wy: c.y };
      }
    }
    if (a.wx !== undefined && a.wy !== undefined) return { ...base, wx: a.wx, wy: a.wy }; // baked pin — survives an unresolved grid
    return base;
  }

  open(): void {
    const scene = this.boardScene();
    if (!scene || !scene.scene.isActive()) return;
    if (!this.boardEditor) this.boardEditor = new BoardEditor(scene, this.ctx);
    void this.restoreMaps(scene);
    const ui = this.game.scene.getScene(SCENES.ui);
    if (ui) {
      ui.scene.setVisible(false);
      ui.input.enabled = false;
    }
    editorStore.setOpen(true);
    this.boardEditor.enter();
  }

  close(): void {
    this.boardEditor?.exit(); // restores the exact game content it hid (nothing destroyed now)
    editorStore.setOpen(false);
    const ui = this.game.scene.getScene(SCENES.ui);
    if (ui) {
      ui.scene.setVisible(true);
      ui.input.enabled = true;
    }
  }

  /**
   * "Apply": push the editor's work into the LIVE game. Every allocated cell that
   * sits inside the game's grid becomes habitable (GameState override → drops
   * succeed there); placed assets are painted as board decor. Then save + close
   * so the player is back in the game and can move dragons into the new cells.
   *
   * Push ONLY the BASE map (= World 1, the live game) into the game's tile
   * overrides. Other paged maps are SEPARATE worlds (reached later via a portal) —
   * their zones must NEVER touch the current game. State-only (no fog/decor), so
   * it's safe on boot too. Each call is a clean slate.
   */
  private applyBaseToGame(): void {
    this.ctx.state.clearEditorTileOverrides();
    const id = editorStore.activeGameWorldId; // primary world, or the teleport target
    // A teleport target draws ALL of its own ground: its hand-drawn grids ARE the
    // lair floor, so a cell it never drew is void there. Otherwise the authored
    // isle's regions showed through from underneath — both worlds use the same
    // coordinates, so roothold inherited nb2's playable cells. The primary world
    // keeps the authored regions as its base and layers overrides on top.
    this.ctx.state.setCellsFullyAuthored(editorStore.activeWorldId !== null);
    // 1) Cell allocations already in game (col,row) space.
    for (const [key, lvl] of editorStore.allocationsFor(id)) {
      const [c, r] = key.split(',').map(Number) as [number, number];
      if (lvl > 0) {
        this.ctx.state.expandBoardTo(c, r);
        this.ctx.state.setEditorTileOverride(c, r, lvl); // opens at level `lvl` (1 = now)
      } else {
        this.ctx.state.setEditorTileOverride(c, r, 0); // blocked
      }
    }
    // 2) Custom-grid PLAYABLE cells → the game cell each one covers (world centre →
    //    worldToGrid). This is how a hand-drawn grid's marked cells become habitable.
    // The game has ONE lattice (setProjection runs once, from the AUTHORED map), so a
    // grid drawn at a different pitch folds several of its cells onto the same game
    // cell — and every one but the last is silently lost: it looks allocated in the
    // editor and can never hold a piece. Count them and say so, loudly. Audit the
    // whole project with `node scripts/audit-grids.mjs`.
    const claimed = new Map<string, string>();
    let collapsed = 0;
    for (const g of editorStore.gridsFor(id)) {
      if (!g.alloc) continue;
      for (const [cell, lvl] of Object.entries(g.alloc)) {
        if (lvl <= 0) continue;
        const [i, j] = cell.split(',').map(Number) as [number, number];
        const w = gridCellCenter(g, i, j);
        const { col, row } = worldToGrid(w.x, w.y);
        const key = `${col},${row}`;
        const prev = claimed.get(key);
        if (prev) collapsed++;
        else claimed.set(key, `${g.name ?? g.id}[${i},${j}]`);
        this.ctx.state.expandBoardTo(col, row);
        this.ctx.state.setEditorTileOverride(col, row, lvl);
      }
    }
    if (collapsed > 0) {
      console.warn(
        `[MapEditor] ${collapsed} cellule(s) dessinée(s) écrasée(s) sur une case déjà prise ` +
          `(monde ${id}). Une grille n'est sans perte que si son pas vaut celui du jeu — ` +
          `voir scripts/audit-grids.mjs.`
      );
    }
  }

  private pushToGame(): void {
    // Commit the current selection into the CURRENT map's design (saved PER map).
    if (editorStore.selectedCells.size) {
      for (const key of editorStore.selectedCells) editorStore.allocations.set(key, editorStore.allocLevel);
      editorStore.markChanged();
    }
    // Apply ONLY the primary world to the live game — never the other worlds' zones/decor.
    this.applyBaseToGame();
    const scene = this.boardScene() as BoardScene | undefined;
    scene?.applyEditorState(
      editorStore.assetsFor(editorStore.activeGameWorldId).map((a) => this.assetPayload(a, editorStore.activeGameWorldId))
    );
  }

  /** Save button: persist to localStorage AND apply to the game (stay in editor).
   *  Save and Apply BOTH push to the game — so whichever you press, your zones
   *  become playable; Apply additionally closes the editor to go play. */
  private save(): void {
    this.pushToGame();
    editorStore.saveAll();
    void saveEditorMap(editorStore.serializeProject()); // bake to disk (survives cookie wipe)
  }

  private apply(): void {
    this.pushToGame();
    editorStore.saveAll();
    void saveEditorMap(editorStore.serializeProject());
    this.close();
  }

  /**
   * Seed the pager once: the game's OWN backdrop is map #1 (so it reads "1/1"
   * before any import, and the first import becomes "1/2"), then re-create the
   * textures for any maps persisted to localStorage so they survive a reload.
   */
  private async restoreMaps(scene: Phaser.Scene): Promise<void> {
    if (this.mapsRestored) return;
    this.mapsRestored = true;
    const baseName = this.ctx.data.map.backgrounds?.[0]?.name ?? 'Base map';
    editorStore.seedBaseMap(baseName); // map #1 — the game backdrop (skipped if deleted)

    const saved = editorStore.resolvedSavedMaps(); // disk (permanent) preferred over localStorage
    // If the default was deleted but no imported map can replace it, bring it back so
    // the pager is never empty.
    if (editorStore.baseHidden && !saved.length) editorStore.forceSeedBase(baseName);
    if (!saved.length || editorStore.maps.length > 1) return;
    const restored: MapLayer[] = [];
    for (const m of saved) {
      if (!m.dataUrl || m.base) continue;
      // Skip re-loading a texture that already exists — restoreTexture REMOVES then
      // re-adds the key, which would break the game's live backdrop sprite that's
      // already bound to it (left the editor showing a dark/empty map).
      let dim = { w: m.w, h: m.h };
      if (!scene.textures.exists(m.textureKey)) dim = await restoreTexture(scene, m.textureKey, m.dataUrl);
      restored.push({ ...m, w: dim.w || m.w, h: dim.h || m.h });
    }
    for (const m of restored) editorStore.addMap(m);
    if (!editorStore.maps.length) editorStore.forceSeedBase(baseName); // replacement failed → keep the default
    editorStore.setCurrentMap(0); // land on the first map

    // Restore placed assets PER MAP (rebuild live 3D models, else static snapshots),
    // pruning any whose asset3d/ file was deleted from the folder (two-way sync).
    const disk = await listAsset3dFiles(); // null = no dev store → don't prune
    let pruned = false;
    for (const [id, list] of Object.entries(editorStore.savedAssetsAll())) {
      const kept =
        disk === null
          ? list
          : list.filter((a) => {
              const f = a.file3d ?? a.file2d;
              return !f || disk.includes(f);
            });
      pruned ||= kept.length !== list.length;
      for (const a of kept) await this.ensureAssetTexture(scene, a);
      editorStore.restoreAssetsFor(id, kept.map((a) => ({ ...a })));
    }
    if (pruned) editorStore.persistAssets();
  }

  /** Ensure a placed asset's texture exists — rebuild the live 3D model from its
   *  saved source (so it ANIMATES) when present, else restore the static snapshot.
   *  RESILIENT: if the model rebuild fails (bad/compressed GLB, parse error) it
   *  falls back to the static snapshot so the asset never silently vanishes. */
  private async ensureAssetTexture(scene: Phaser.Scene, a: PlacedAsset): Promise<void> {
    if (scene.textures.exists(a.textureKey)) return;
    // Prefer the on-disk asset3d/ file (reliable, animated); then the localStorage
    // source; then the static snapshot — never let the asset silently vanish.
    if (a.file3d && a.modelExt) {
      try {
        await recreateModelFromUrl(scene, `/asset3d/${encodeURIComponent(a.file3d)}`, a.modelExt, a.textureKey);
        return;
      } catch (e) {
        console.warn('[MapEditor] asset3d/ model load failed — trying fallbacks.', e);
      }
    }
    if (a.modelSrc && a.modelExt) {
      try {
        await recreateModel(scene, a.modelSrc, a.modelExt, a.textureKey);
        return;
      } catch (e) {
        console.warn('[MapEditor] 3D model rebuild failed — using the static snapshot.', e);
      }
    }
    if (a.dataUrl && !scene.textures.exists(a.textureKey)) await restoreTexture(scene, a.textureKey, a.dataUrl);
  }

  /** Delete a placed asset AND, if no other placement still uses it, its file in
   *  the asset3d/ folder — the two-way sync the dev asked for. */
  private deleteAsset(id: string): void {
    const asset = editorStore.placedAssets.find((x) => x.id === id);
    const file = asset?.file3d ?? asset?.file2d; // the asset3d/ filename (3D or 2D)
    editorStore.removeAsset(id);
    void saveEditorMap(editorStore.serializeProject()); // reflect the deletion on disk
    // Two-way disk sync: drop the file from asset3d/ only when NO other placement uses it.
    if (file && !editorStore.isFileUsed(file)) void deleteAsset3dFile(file);
  }

  /**
   * Boot/reload: re-apply ONLY World 1 (the base map) — its playable zones stay
   * droppable after reopening — then re-paint its assets as decor. applyBaseToGame
   * is state-only and the decor paint no longer lifts fog, so the clouds stay as
   * designed. Other paged maps are separate worlds and never touch this game.
   */
  private async restoreToGame(): Promise<void> {
    // Re-apply World 1 (base) zones FIRST and ALWAYS — the live game is ONLY the
    // base map; other worlds' zones must never leak in.
    this.applyBaseToGame();
    const scene = this.boardScene() as BoardScene | undefined;
    if (!scene) return;
    const id = editorStore.activeGameWorldId; // the live game world (default, imported primary, or teleport target)
    const saved = editorStore.assetsFor(id); // from mapStates (disk default OR localStorage)
    if (!saved.length) return; // zones already re-applied above; no assets to paint
    // Two-way sync: drop assets whose file was deleted from asset3d/ (null = no dev
    // store → don't prune, keep everything via fallbacks).
    const disk = await listAsset3dFiles();
    const records = disk === null ? saved : saved.filter((a) => !a.file3d || disk.includes(a.file3d));
    for (const a of records) {
      try {
        await this.ensureAssetTexture(scene, a);
      } catch (e) {
        console.warn('[MapEditor] could not restore asset', a.name, e);
      }
    }
    editorStore.restoreAssetsFor(id, records.map((a) => ({ ...a })));
    if (records.length !== saved.length) editorStore.persistAssets(); // forget folder-deleted ones
    // Decor ONLY — render just the assets whose texture came back (never magenta).
    scene.applyEditorState(
      records.filter((a) => scene.textures.exists(a.textureKey)).map((a) => this.assetPayload(a, id))
    );
  }

  /** Load the on-disk DEFAULT design (asset3d/editor-map.json) — the baked-in map
   *  that survives a cookie/localStorage wipe. Disk is the source of truth for the
   *  default: mirror it into localStorage, then re-apply so zones + assets show. */
  private async loadDiskProject(): Promise<void> {
    const data = await loadEditorMap();
    if (!data || (!data.allocations && !data.assets && !data.zones && !data.grids && !data.maps && data.baseHidden === undefined)) return; // no disk default → localStorage stands
    editorStore.ingestProject(
      data as {
        allocations?: Record<string, [string, unknown][]>;
        assets?: Record<string, PlacedAsset[]>;
        zones?: Record<string, MapZone[]>;
        grids?: Record<string, GridDef[]>;
        maps?: MapLayer[];
        baseHidden?: boolean;
      }
    );
    editorStore.persist(); // mirror the disk default into localStorage for the session
    editorStore.persistAssets();
    // No restore here: `onGameStarted` awaits this method (`diskReady`) and then
    // runs the SINGLE restore, so the disk data is authoritative and there is never
    // a concurrent second restore racing off a stale localStorage snapshot.
  }

  /** The Position tab list: every live game object, then every placed asset. */
  private objects(): PositionEntry[] {
    const out: PositionEntry[] = [];
    let rank = 1;
    for (const item of this.ctx.state.items.values()) {
      if (item.kind !== 'item' && item.kind !== 'decor') continue;
      out.push({
        id: `game:${item.id}`,
        name: item.tier ? `${item.chain} t${item.tier}` : item.chain,
        col: item.col,
        row: item.row,
        z: 0,
        rank: rank++,
        source: 'game'
      });
    }
    for (const a of editorStore.placedAssets) {
      out.push({ id: a.id, name: a.name, col: a.col, row: a.row, z: 0, rank: rank++, source: 'asset' });
    }
    return out;
  }

  /** Clicking a Position row: highlight a game object's cell, or select an asset. */
  private focus(id: string): void {
    if (id.startsWith('game:')) {
      const item = this.ctx.state.items.get(Number(id.slice(5)));
      if (item) {
        editorStore.selectAsset(null);
        editorStore.toggleCell(item.col, item.row, false);
      }
    } else {
      editorStore.selectAsset(id);
    }
  }

  /**
   * Export the whole editor state to a downloadable export.json — the channel for
   * telling the dev what each object should DO (e.g. "the dragon at x,y should
   * move when it works"). Captures allocations, placed assets and every object's
   * position + rank.
   */
  private exportJson(): void {
    // A COMPLETE manifest across every world (the authored default + every imported
    // map). Each world names its map, lists every grid in full (position + size +
    // perspective + rotation + matrix + which level it sits on + its playable cells,
    // each mapped to the exact game cell), plus allocations, placed assets (by
    // filename) and zones. Enough to integrate directly.
    const layerOf = (id: string): MapLayer | undefined =>
      [...editorStore.maps, ...editorStore.resolvedSavedMaps()].find((m) => m.id === id);
    const authoredName = this.ctx.data.map.backgrounds?.[0]?.name ?? 'authored';
    // De-duplicated world ids: the authored default first, then every known map.
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const id of ['__base__', ...editorStore.maps.map((m) => m.id), ...editorStore.resolvedSavedMaps().map((m) => m.id)]) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }

    const worlds = ids.map((id, i) => {
      const isBase = id === '__base__';
      const layer = layerOf(id);
      const grids = editorStore.gridsFor(id).map((g) => {
        const bb = gridBBox(g);
        // Every playable cell, mapped to the exact game tile it covers (world centre
        // → worldToGrid), so integration is a lookup, not a re-derivation.
        const cells = Object.entries(g.alloc ?? {}).map(([cell, unlockLevel]) => {
          const [gi, gj] = cell.split(',').map(Number) as [number, number];
          const w = gridCellCenter(g, gi, gj);
          const gc = worldToGrid(w.x, w.y);
          return { cell, i: gi, j: gj, world: { x: Math.round(w.x), y: Math.round(w.y) }, gameCell: { col: gc.col, row: gc.row }, unlockLevel };
        });
        return {
          id: g.id,
          name: g.name,
          onLevel: i + 1, // the world/level this grid is placed on
          assigned: cells.length > 0, // has playable cells (vs. an empty/unassigned grid)
          perspective: g.persp, // 'iso' | 'ortho'
          tile: { w: g.tileW, h: g.tileH }, // one cell's size in world px
          matrix: { cols: g.cols, rows: g.rows }, // how many cells across / down
          rotation: g.rot ?? 0, // degrees around the grid centre
          origin: { x: Math.round(g.ox), y: Math.round(g.oy) }, // cell (0,0) centre in world px
          bounds: { x: Math.round(bb.x), y: Math.round(bb.y), w: Math.round(bb.w), h: Math.round(bb.h) }, // footprint box
          playableCellCount: cells.length,
          cells
        };
      });
      return {
        world: i + 1,
        level: `Level ${i + 1}`,
        id,
        map: isBase ? authoredName : (layer?.name ?? id), // the map's NAME (e.g. "nb2-4k-aligned")
        isAuthoredDefault: isBase,
        isLiveGameWorld: id === editorStore.activeGameWorldId, // what the game shows right now
        isPrimary: id === editorStore.primaryMapId, // the primary world (default, or nb2 if default deleted)
        grids,
        allocations: [...editorStore.allocationsFor(id)].map(([cell, unlockLevel]) => ({ cell, unlockLevel })),
        assets: editorStore.assetsFor(id).map((a) => ({
          file: a.fileName ?? a.file3d ?? a.file2d ?? `${a.name}.${a.kind}`,
          name: a.name,
          kind: a.kind,
          x: a.col,
          y: a.row,
          z: a.z ?? 0,
          scale: Number(a.scale.toFixed(3)),
          // Pinned exactly to a custom grid cell (else placed free on the game cell).
          onGrid: a.gridId ? { gridId: a.gridId, cell: `${a.gi},${a.gj}` } : null,
          behaviour: '' // ← annotate what this asset should DO (e.g. "outputs pieces")
        })),
        zones: editorStore.zonesFor(id).map((z) => ({
          name: z.name,
          gridId: z.gridId ?? null,
          points: z.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
          behaviour: ''
        }))
      };
    });

    const data = {
      generatedBy: 'Emberkeep Map Editor',
      map: { cols: editorStore.mapCols, rows: editorStore.mapRows },
      defaultMapDeleted: editorStore.baseHidden, // true = an imported map is primary
      primaryWorldId: editorStore.primaryMapId,
      liveGameWorldId: editorStore.activeGameWorldId,
      teleport: WORLD_TELEPORT, // the ruby → Demon → world-switch wiring (Constants)
      gameObjects: this.objects(), // live game items (dragons, house…) with x/y/z + rank
      worlds,
      // The RAW, re-importable project (grids/zones/assets/allocations/maps + baseHidden)
      // — "Import" reads this to put everything back exactly. 2D art is embedded as
      // data-URLs; 3D models live in asset3d/ (the import lists any missing ones).
      project: editorStore.serializeProject(),
      legend: {
        world: 'Each paged map = one world = one "Level". `map` is its image name. isPrimary/isLiveGameWorld flag which one the game runs on.',
        'grids[]': 'perspective iso|ortho, tile w/h px, matrix cols×rows, rotation°, origin = cell(0,0) centre, bounds = footprint box. onLevel = the world it sits on; assigned = has playable cells.',
        'grids[].cells': 'Each PLAYABLE cell: "i,j" grid coord, its world-px centre, and the exact gameCell {col,row} it maps to, with unlockLevel (1 = now, N = opens at level N).',
        'allocations.unlockLevel': '0 = blocked; N = playable once the Keeper reaches level N (1 = now)',
        assets: 'Referenced by "file" (e.g. home.png), with board x/y, z (height offset), scale. "onGrid" = pinned to a custom grid cell {gridId, "i,j"} (else free on the game cell x/y). Fill "behaviour" to say what each should DO.',
        zones: 'Hand-drawn polygons (world px) tracing the art. "gridId" = the grid each was laid out on.'
      }
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'emberkeep-map.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * IMPORT a project JSON (the "Import" button) — accepts either the full export
   * (`emberkeep-map.json`, reads its `.project`) or the raw project shape. Restores
   * grids/zones/assets/allocations/maps EXACTLY, persists (localStorage + disk),
   * rebuilds the pager textures and re-applies to the game. Returns the list of
   * referenced asset3d/ files that AREN'T on disk yet — the ones the user must paste
   * in and re-import (2D art is embedded as data-URLs, so only 3D models / originals
   * can be missing).
   */
  async importProjectJson(data: unknown): Promise<{ imported: boolean; missing: string[]; error?: string }> {
    try {
      const raw = (data ?? {}) as { project?: unknown } & Record<string, unknown>;
      const project = (raw.project ?? raw) as {
        allocations?: Record<string, [string, number][]>;
        assets?: Record<string, PlacedAsset[]>;
        zones?: Record<string, MapZone[]>;
        grids?: Record<string, GridDef[]>;
        maps?: MapLayer[];
        baseHidden?: boolean;
      };
      if (!project || typeof project !== 'object' || !(project.grids || project.assets || project.zones || project.allocations || project.maps)) {
        return { imported: false, missing: [], error: 'Unrecognised JSON — no grids/assets/zones/maps found.' };
      }
      editorStore.ingestProject(project);
      editorStore.saveAll(); // persist the ingested design to localStorage first
      // Rebuild the pager (+ map/asset textures) from the freshly-ingested project.
      const scene = this.boardScene();
      editorStore.maps = [];
      editorStore.currentMap = 0;
      this.mapsRestored = false;
      if (scene) await this.restoreMaps(scene);
      void saveEditorMap(editorStore.serializeProject()); // bake to disk (survives a wipe)
      await this.restoreToGame();
      await this.applyActiveBackdrop();
      editorStore.markChanged(); // repaint the editor board

      // Which referenced asset3d/ files are NOT on disk yet? (disk === null → no dev store.)
      const disk = await listAsset3dFiles();
      const referenced = new Set<string>();
      for (const list of Object.values(project.assets ?? {})) {
        for (const a of list) {
          if (a.file3d) referenced.add(a.file3d);
          if (a.file2d && !a.dataUrl) referenced.add(a.file2d); // 2D with a snapshot needs no file
        }
      }
      const missing = disk === null ? [] : [...referenced].filter((f) => !disk.includes(f));
      return { imported: true, missing };
    } catch (e) {
      return { imported: false, missing: [], error: (e as Error).message };
    }
  }

  private textureURL(key: string): string | null {
    const scene = this.boardScene();
    if (!scene || !scene.textures.exists(key)) return null;
    const src = scene.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    if (src instanceof HTMLCanvasElement) return src.toDataURL();
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d')!.drawImage(src, 0, 0);
    return c.toDataURL();
  }
}
