import Phaser from 'phaser';
import { SCENES } from '../core/Constants';
import type { GameContext } from '../core/Context';
import type { BoardScene } from '../scenes/BoardScene';
import { importAsset, recreateModel, recreateModelFromUrl, restoreTexture } from './assetImport';
import { deleteAsset3dFile, listAsset3dFiles, loadEditorMap, publishWorlds, saveEditorMap } from './asset3dFs';
import { BoardEditor } from './BoardEditor';
import { EditorDom } from './EditorDom';
import { worldToGrid } from '../core/iso';
import worldsRegistry from '../data/worlds.json';
import { editorStore, gridBBox, gridCellCenter, type GridDef, type MapLayer, type MapZone, type PlacedAsset, type PositionEntry } from './editorStore';

/**
 * Map Editor orchestrator: ties the DOM chrome, the Phaser board layer and the
 * running game together. Opened from Settings (`editor:open`). It also owns the
 * cross-domain glue the DOM can't reach on its own — the Position list (live game
 * objects + placed assets), focusing, and the JSON export. Created once at boot.
 *
 * HOW "APPLY" REACHES THE GAME
 * ----------------------------
 * It used to poke the running board directly — tile overrides on `GameState`, a
 * decor payload on `BoardScene`, one global cell lattice it could re-point per
 * world. The engine no longer works that way: a world is a registry of
 * independently placed ZONES (`core/world.ts`, built from `src/data/zones.json`),
 * each with its own tile size, origin and rotation — which is this editor's own
 * grid model, adopted by the engine.
 *
 * So the editor authors, and the pipeline applies:
 *
 *   Apply → assets/map/nionja-worlds.json → ingest-worlds.mjs → src/data/worlds.json
 *                                         → build-zones.mjs   → src/data/zones.json
 *
 * `build-zones.mjs` owns the editor→art transform (it FITS one scale + offset
 * against every cell's measured `gameCell`), so recomputing it in the browser
 * would be a second implementation of the one thing that must not drift. The dev
 * server runs the real scripts and Vite reloads the game onto the new zones.
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
  /** The map whose art is currently previewed on the board, so paging repaints
   *  only when the page actually changed. */
  private shownMapId: string | null = null;
  private offPage?: () => void;

  constructor(
    private game: Phaser.Game,
    private ctx: GameContext
  ) {
    editorStore.load(); // localStorage (fast, in-session)
    this.diskReady = this.loadDiskProject(); // asset3d/editor-map.json — the baked-in default
    // Placing a prop is a change to the PROJECT, so it goes to the project file.
    // It used to reach localStorage only, where the size budget could silently
    // drop it — the prop was on screen, absent from the save, and gone on the
    // next reload. Debounced because dragging one emits a change per frame and
    // the project is megabytes of embedded art.
    editorStore.onAssetsChanged = () => this.bakeProjectSoon();
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
    // Re-hydrate the editor's OWN view once the board is live: the disk default is
    // the authoritative design, so wait for it and restore exactly once — never a
    // concurrent second restore off a stale localStorage snapshot (that race was the
    // "wrong on reopen, right on refresh" asset bug).
    //
    // It no longer restores anything INTO the game. The world the game runs is
    // `zones.json`, rebuilt by Apply through the pipeline; re-applying a second,
    // browser-side version of the same design on every boot is exactly the drift
    // this merge removed.
    ctx.bus.on('world:ready', () => {
      if (!this.prepared) void this.hydrate();
    });
  }

  /** The single boot restore of the EDITOR's own state: wait for the on-disk
   *  default, then bring back the textures its canvas draws with. */
  private async hydrate(): Promise<void> {
    this.prepared = true;
    await this.diskReady;
    await this.restoreToGame();
  }

  private boardScene(): Phaser.Scene | undefined {
    return this.game.scene.getScene(SCENES.board) ?? undefined;
  }

  /** Pending debounce for the project bake (see `onAssetsChanged`). */
  private bakeTimer?: ReturnType<typeof setTimeout>;

  /**
   * Write the project to `asset3d/editor-map.json`, coalescing a burst of changes
   * into one write. The wait is long enough to cover a drag and short enough that
   * closing the tab straight after placing something still catches it — and Save,
   * Apply and the map operations bake synchronously anyway, so this is the safety
   * net for the edits nobody thought to press a button after.
   */
  private bakeProjectSoon(): void {
    clearTimeout(this.bakeTimer);
    this.bakeTimer = setTimeout(() => {
      void saveEditorMap(editorStore.serializeProject());
    }, 800);
  }

  /**
   * Paint the PAGED map's art where the authored backdrop sits, so the grids drawn
   * on that art line up with what is on screen. Editor-view only (BoardScene
   * restores the authored image on close) — the running world is untouched.
   */
  private async applyPageBackdrop(): Promise<void> {
    const scene = this.boardScene() as BoardScene | undefined;
    if (!scene) return;
    const id = editorStore.currentMapId;
    const map = [...editorStore.maps, ...editorStore.resolvedSavedMaps()].find((m) => m.id === id);
    if (!map?.dataUrl) {
      scene.applyWorldBackdrop(null); // the authored map is its own art
      return;
    }
    try {
      if (!scene.textures.exists(map.textureKey)) await restoreTexture(scene, map.textureKey, map.dataUrl);
      scene.applyWorldBackdrop(map.textureKey);
    } catch (e) {
      console.warn('[MapEditor] could not preview the page backdrop', e);
    }
  }

  open(): void {
    const scene = this.boardScene();
    if (!scene || !scene.scene.isActive()) return;
    if (!this.boardEditor) this.boardEditor = new BoardEditor(scene, this.ctx);
    void this.restoreMaps(scene).then(() => this.applyPageBackdrop());
    // Paging to another map re-paints its art under the grids it was drawn on.
    this.offPage ??= editorStore.on('change', () => {
      if (!editorStore.open) return;
      const id = editorStore.currentMapId;
      if (id === this.shownMapId) return;
      this.shownMapId = id;
      void this.applyPageBackdrop();
    });
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
    // Give the running world its own art back — the preview was the editor's view.
    (this.boardScene() as BoardScene | undefined)?.applyWorldBackdrop(null);
    this.shownMapId = null;
    const ui = this.game.scene.getScene(SCENES.ui);
    if (ui) {
      ui.scene.setVisible(true);
      ui.input.enabled = true;
    }
  }

  /**
   * "Apply" / "Save": publish this design to the world pipeline.
   *
   * Every grid keeps its OWN pitch here. That is not a detail — folding a
   * hand-drawn grid through one global game lattice collapsed several drawn cells
   * onto the same cell and silently lost all but the last (measured: barely half
   * of roothold's and borealis' cells survived). Zones ended that: a zone owns its
   * tile size, origin and rotation, so a drawn cell is a real cell. Nothing to
   * warn about any more, and nothing to audit around.
   *
   * Returns what to tell the user — the endpoint only exists in dev, and a
   * production build must say so rather than look applied.
   */
  private async publish(): Promise<string> {
    const res = await publishWorlds(this.buildExportDoc());
    if (res === null) return "Serveur de dev absent — l'export a été enregistré, mais zones.json n'a pas été régénéré.";
    if (!res.ok) return `Échec: ${res.error ?? 'inconnu'}`;
    return 'Appliqué — worlds.json + zones.json régénérés.';
  }

  private async pushToGame(): Promise<string> {
    // Commit the current selection into the CURRENT map's design (saved PER map).
    if (editorStore.selectedCells.size) {
      for (const key of editorStore.selectedCells) editorStore.allocations.set(key, editorStore.allocLevel);
      editorStore.markChanged();
    }
    return this.publish();
  }

  /** Save button: persist to localStorage + disk AND publish to the pipeline (stay
   *  in the editor). Save and Apply BOTH publish — so whichever you press, your
   *  zones become the ones the game runs; Apply additionally closes to go play. */
  private save(): void {
    editorStore.saveAll();
    void saveEditorMap(editorStore.serializeProject()); // bake to disk (survives cookie wipe)
    void this.pushToGame().then((msg) => console.info('[MapEditor]', msg));
  }

  private apply(): void {
    editorStore.saveAll();
    void saveEditorMap(editorStore.serializeProject());
    void this.pushToGame().then((msg) => console.info('[MapEditor]', msg));
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
    // The disk project has to land BEFORE the pager is built. It is fetched in the
    // constructor and `open()` fires this without waiting, so opening the editor
    // quickly built the pager from localStorage alone — and localStorage silently
    // drops any map past its ~4MB budget. That is how roothold "disappeared": not
    // deleted, just never read. And because the next Save bakes the pager back to
    // disk, one fast open could make the loss permanent.
    await this.diskReady.catch(() => {}); // a dead dev store must not block the editor
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
    if (a.dataUrl && !scene.textures.exists(a.textureKey)) {
      await restoreTexture(scene, a.textureKey, a.dataUrl);
      return;
    }
    // A 2D prop whose base64 did not fit the localStorage budget: the file is
    // still in asset3d/, which is where it was uploaded to in the first place.
    // 3D has always had this fallback; without it for 2D, a stripped record came
    // back as a placement with no picture — and the prop looked deleted.
    if (a.file2d) {
      // `restoreTexture` reports a failed load as a 1×1, it does not throw.
      const got = await restoreTexture(scene, a.textureKey, `/asset3d/${encodeURIComponent(a.file2d)}`);
      if (got.w <= 1 && got.h <= 1) {
        console.warn(`[MapEditor] asset3d/${a.file2d} would not load — "${a.name}" is placed but has no art.`);
      }
    }
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
   * Boot/reload: bring the placed assets' TEXTURES back, so reopening the editor
   * shows the design it saved rather than a page of blanks.
   *
   * It no longer paints anything into the game. The ground the game stands on is
   * `zones.json` and its decor is the map data — both regenerated by Apply. A
   * browser-side re-apply on every boot was a second, divergent copy of the same
   * design, and it is exactly what made a reload disagree with a refresh.
   */
  private async restoreToGame(): Promise<void> {
    const scene = this.boardScene() as BoardScene | undefined;
    if (!scene) return;
    const id = editorStore.activeGameWorldId; // the live game world (default, imported primary, or teleport target)
    const saved = editorStore.assetsFor(id); // from mapStates (disk default OR localStorage)
    if (!saved.length) return; // nothing placed on this map
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
  /** The project export — the EXACT document `assets/map/nionja-worlds.json` holds
   *  and `scripts/ingest-worlds.mjs` reads. Downloaded by Export, published by Apply. */
  private buildExportDoc(): Record<string, unknown> {
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
      teleport: worldsRegistry.teleport, // the hatch → world-switch wiring (src/data/worlds.json)
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
    return data;
  }

  private exportJson(): void {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(this.buildExportDoc(), null, 2)], { type: 'application/json' })
    );
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
