import Phaser from 'phaser';
import { DEPTHS, TILE_H, TILE_W } from '../core/Constants';
import type { GameContext } from '../core/Context';
import { gridToWorld, projHalfH, projHalfW, worldToGrid } from '../core/iso';
import { projectIn, unprojectIn, type Lattice } from './lattice';
import type { RegionStatus } from '../core/types';
import {
  cellKey,
  editorStore,
  gridBBox,
  gridCellCenter,
  gridCellPolygon,
  gridCenter,
  gridInvert,
  gridMoveHandle,
  gridOutline,
  gridRotateHandle,
  gridSnap,
  latticeFor,
  type GridDef,
  type PlacedAsset
} from './editorStore';

/** Short unlock badge for a region overlay: "Lv 2", "🔑 Lv 2", "🔒", or '' (active). */
function unlockBadge(status: RegionStatus, unlock?: { keys?: number; level?: number }): string {
  if (status === 'active') return '';
  const parts: string[] = [];
  if (unlock?.keys) parts.push(unlock.keys > 1 ? `🔑${unlock.keys}` : '🔑');
  if (unlock?.level && unlock.level < 90) parts.push(`Lv ${unlock.level}`);
  return parts.length ? parts.join(' ') : '🔒'; // locked with no reachable condition
}

const EDITOR_DEPTH = 55000; // above every hidden game band, below dragged/particles

type Rect = { x: number; y: number; w: number; h: number };

/**
 * The board-side of the Map Editor, created lazily by BoardScene. It hides all
 * game objects (dragons, items, decor, fog), darkens the map and paints a grid
 * over the WHOLE backdrop (not just the authored playable tiles) — functional
 * cells bright, non-functional cells dark — then routes pointer input to the
 * active tool (select / allocate / place asset). Pure view+input over the shared
 * `editorStore`; it owns no game state.
 *
 * The grid is split into a STATIC layer (the full ~800-cell mesh, redrawn only on
 * a structural change) and a light HOVER layer (one cell, redrawn on every move),
 * so dragging the cursor never rebuilds the whole mesh.
 */
export class BoardEditor {
  private blackCover: Phaser.GameObjects.Rectangle; // "Fond noir" — erases the default backdrop
  private gridStatic: Phaser.GameObjects.Graphics;
  private gridHover: Phaser.GameObjects.Graphics;
  private gridDefLayer: Phaser.GameObjects.Graphics; // defined grids (foundation)
  private cellHi: Phaser.GameObjects.Graphics; // asset placement/selection cell highlight
  private gridLabels: Phaser.GameObjects.Text[] = [];
  private zoneLayer: Phaser.GameObjects.Graphics; // hand-drawn zones + live draft
  private zoneLabels: Phaser.GameObjects.Text[] = [];
  /** Active drag of the selected zone (whole polygon) or one of its vertices.
   *  `last` is the pointer's SCREEN position — world deltas are screen-delta/zoom
   *  (getWorldPoint goes stale during a same-frame pointermove burst). */
  private drag:
    | { kind: 'vertex'; id: string; vi: number; last: { x: number; y: number } }
    | { kind: 'zone'; id: string; last: { x: number; y: number } }
    | { kind: 'gridmove'; id: string; last: { x: number; y: number } } // drag a whole grid
    | {
        kind: 'gridsize'; // drag the grid's far corner → size (delta-based, rotation-aware)
        id: string;
        orig: { x: number; y: number; w: number; h: number };
        grab: { x: number; y: number };
        rot: number;
        last: { x: number; y: number };
      }
    | { kind: 'gridrot'; id: string; last: { x: number; y: number } } // drag the handle → rotation
    | {
        kind: 'resize';
        id: string;
        anchor: { x: number; y: number }; // fixed corner/edge the scale grows from
        hx: boolean; // scales the X axis
        hy: boolean; // scales the Y axis
        orig: { x: number; y: number }[]; // polygon captured at grab time
        handleOrig: { x: number; y: number }; // grabbed handle's world pos at grab
        cur: { x: number; y: number }; // live cursor world pos (delta-tracked)
        last: { x: number; y: number };
      }
    | null = null;
  private assetSprites = new Map<string, Phaser.GameObjects.Image>();
  private mapSprite?: Phaser.GameObjects.Image; // the current paged base-map layer
  private ghost?: Phaser.GameObjects.Image; // pending-asset preview under the cursor
  private regionLabels: Phaser.GameObjects.Text[] = []; // "Lv N" / "🔑" per region
  private cellBadges: Phaser.GameObjects.Text[] = []; // "L{n}" on cells allocated at level > 1
  private hiddenChildren: Phaser.GameObjects.GameObject[] = [];
  private off: () => void;
  private readonly cols: number;
  private readonly rows: number;
  private active = false;
  private lastRev = -1;

  /** Full grid extent (col/row), covering the whole backdrop — may be negative. */
  private gMinC = 0;
  private gMaxC = 0;
  private gMinR = 0;
  private gMaxR = 0;
  /** Backdrop world rect (cached) — undefined = not computed yet, null = none. */
  private bgRect: Rect | null | undefined;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ctx: GameContext
  ) {
    const map = ctx.data.map;
    this.cols = map.cols;
    this.rows = map.rows;
    editorStore.setMapDims(this.cols, this.rows);

    // Covers the whole game backdrop (depth just under the imported-map sprite at
    // EDITOR_DEPTH-200, above all game content) so "Fond noir" gives a clean canvas.
    this.blackCover = scene.add.rectangle(0, 0, 60000, 60000, 0x000000, 1).setDepth(EDITOR_DEPTH - 1000).setVisible(false);
    this.gridStatic = scene.add.graphics().setDepth(EDITOR_DEPTH).setVisible(false);
    this.gridHover = scene.add.graphics().setDepth(EDITOR_DEPTH + 1).setVisible(false);
    this.gridDefLayer = scene.add.graphics().setDepth(EDITOR_DEPTH + 4).setVisible(false);
    this.cellHi = scene.add.graphics().setDepth(EDITOR_DEPTH + 7).setVisible(false); // above the grid mesh
    this.zoneLayer = scene.add.graphics().setDepth(EDITOR_DEPTH + 5).setVisible(false);

    scene.input.on('pointermove', this.onMove, this);
    scene.input.on('pointerdown', this.onDown, this);
    scene.input.on('pointerup', this.onUp, this);
    // Zone keyboard shortcuts (Enter/Esc/⌫) + the name prompt live in EditorDom
    // (the DOM layer) so a visible "Terminer" button and the keyboard share one
    // code path — the board only handles pointer + drawing.
    this.off = editorStore.on('change', () => this.redraw());
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    this.hideGameContent(true);
    this.computeGridExtent(); // needs the backdrop texture, loaded by now
    this.sampleWorldTransform(); // lock the pointer→world map while the camera is settled
    const mr = this.mapRect(); // centre the blackout cover over the map
    this.blackCover.setPosition(mr.x + mr.w / 2, mr.y + mr.h / 2);
    this.buildRegionLabels();
    this.gridStatic.setVisible(true);
    this.gridHover.setVisible(true);
    this.gridDefLayer.setVisible(true);
    this.cellHi.setVisible(true);
    this.zoneLayer.setVisible(true);
    this.lastRev = -1; // force a full static rebuild
    this.redraw();
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.hideGameContent(false);
    this.blackCover.setVisible(false);
    this.gridStatic.setVisible(false).clear();
    this.gridHover.setVisible(false).clear();
    this.gridDefLayer.setVisible(false).clear();
    this.cellHi.setVisible(false).clear();
    this.clearGridLabels();
    this.zoneLayer.setVisible(false).clear();
    this.clearZoneLabels();
    this.ghost?.destroy();
    this.ghost = undefined;
    this.mapSprite?.destroy();
    this.mapSprite = undefined;
    this.clearRegionLabels();
    this.clearCellBadges();
    for (const s of this.assetSprites.values()) s.destroy();
    this.assetSprites.clear();
    editorStore.setHover(null);
  }

  destroy(): void {
    this.exit();
    this.off();
    this.scene.input.off('pointermove', this.onMove, this);
    this.scene.input.off('pointerdown', this.onDown, this);
    this.scene.input.off('pointerup', this.onUp, this);
    this.blackCover.destroy();
    this.gridStatic.destroy();
    this.gridHover.destroy();
    this.gridDefLayer.destroy();
    this.cellHi.destroy();
    this.zoneLayer.destroy();
  }

  /** The near-darken "Voir" toggle: reveal (or re-hide) the game objects the
   *  editor hid on enter — every dragon, the House, items, decor — so the user
   *  can see everything in place ON the map. Toggles visibility only; exit()
   *  restores them regardless. */
  revealGameContent(show: boolean): void {
    for (const child of this.hiddenChildren) {
      (child as { setVisible?: (v: boolean) => unknown }).setVisible?.(show);
    }
  }

  /* --------------------------- object hiding --------------------------- */

  /** Hide (or restore) every game object — anything in the item/decor/fog/dragon
   *  depth bands — leaving only the terrain tiles + backdrop and the editor
   *  overlay. A depth sweep avoids threading every sprite collection. */
  private hideGameContent(hide: boolean): void {
    if (hide) {
      this.hiddenChildren = [];
      for (const child of this.scene.children.list) {
        const go = child as Phaser.GameObjects.GameObject & { depth?: number; visible?: boolean; setVisible?: (v: boolean) => unknown };
        const d = go.depth ?? 0;
        if (d >= DEPTHS.itemBase - 10 && d < DEPTHS.dragged && go.visible) {
          this.hiddenChildren.push(child);
          go.setVisible?.(false);
        }
      }
    } else {
      for (const child of this.hiddenChildren) {
        const go = child as { setVisible?: (v: boolean) => unknown; scene?: unknown };
        if (!go.scene) continue; // was destroyed while the editor was open (e.g. lifted fog)
        try {
          go.setVisible?.(true);
        } catch {
          /* stale/destroyed child — the close-time rebuildFromState will fix it */
        }
      }
      this.hiddenChildren = [];
    }
  }

  /* --------------------------- map extent ----------------------------- */

  /** World-space rect of the current map: the game's authored backdrop, else the
   *  playable extent. This is the area the grid tiles and a base map covers. */
  private mapRect(): Rect {
    if (this.bgRect === undefined) this.bgRect = this.backdropRect();
    return this.bgRect ?? this.playableRect();
  }

  /** Replicates BoardScene.backgroundWorldRect — the first authored backdrop's
   *  exact world rect (cell + free-move + calibration). Null if there's no art. */
  private backdropRect(): Rect | null {
    const map = this.ctx.data.map;
    const b = map.backgrounds?.[0];
    if (!b) return null;
    const key = `background_${b.name}`;
    if (!this.scene.textures.exists(key)) return null;
    const src = this.scene.textures.get(key).getSourceImage() as HTMLImageElement;
    const ratio = TILE_W / (map.tile?.width ?? TILE_W);
    const cal = map.backgroundCalibration?.[b.name] ?? { offsetX: 0, offsetY: 0, scale: 1, anchor: { x: 0.5, y: 0.5 } };
    const { x, y } = gridToWorld(b.col, b.row);
    const cx = x + (cal.offsetX + (b.dx ?? 0)) * ratio;
    const cy = y + (cal.offsetY + (b.dy ?? 0)) * ratio;
    const scale = (cal.scale ?? 1) * ratio;
    const w = src.width * scale;
    const h = src.height * scale;
    return { x: cx - w * (cal.anchor?.x ?? 0.5), y: cy - h * (cal.anchor?.y ?? 0.5), w, h };
  }

  /** Fallback extent when there's no backdrop: the authored grid's bounding box
   *  plus a tile of margin. */
  private playableRect(): Rect {
    const pts = [
      [0, 0],
      [this.cols - 1, 0],
      [0, this.rows - 1],
      [this.cols - 1, this.rows - 1]
    ].map(([c, r]) => this.toWorld(c!, r!));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs) - TILE_W;
    const y = Math.min(...ys) - TILE_H * 2;
    return { x, y, w: Math.max(...xs) - Math.min(...xs) + TILE_W * 2, h: Math.max(...ys) - Math.min(...ys) + TILE_H * 3 };
  }

  /** Grid extent = every cell whose diamond falls within the backdrop rect. */
  private computeGridExtent(): void {
    const r = this.mapRect();
    const corners = [
      [r.x, r.y],
      [r.x + r.w, r.y],
      [r.x, r.y + r.h],
      [r.x + r.w, r.y + r.h]
    ].map(([x, y]) => this.toGrid(x!, y!));
    const cs = corners.map((c) => c.col);
    const rs = corners.map((c) => c.row);
    this.gMinC = Math.min(...cs) - 1; // +1 cell of margin so edges fully cover
    this.gMaxC = Math.max(...cs) + 1;
    this.gMinR = Math.min(...rs) - 1;
    this.gMaxR = Math.max(...rs) + 1;
    editorStore.setGridExtent(this.gMinC, this.gMaxC, this.gMinR, this.gMaxR);
  }

  /* ----------------------------- input -------------------------------- */

  private cellUnder(pointer: Phaser.Input.Pointer): { col: number; row: number } | null {
    const wp = this.worldOf(pointer);
    const { col, row } = this.toGrid(wp.x, wp.y);
    if (col < this.gMinC || col > this.gMaxC || row < this.gMinR || row > this.gMaxR) return null;
    return { col, row };
  }

  /** Stable pointer→world affine, sampled ONCE when the editor opens. The board
   *  camera never moves during editing, so `camera.getWorldPoint` — which goes
   *  unreliable during a fast pointer burst — is replaced by this fixed linear map
   *  (offset + per-axis scale), keeping hit-tests correct throughout a drag. */
  private w0 = { x: 0, y: 0 };
  private wS = { x: 1, y: 1 };
  private sampleWorldTransform(): void {
    const cam = this.scene.cameras.main;
    const a = cam.getWorldPoint(0, 0);
    const ax = a.x;
    const ay = a.y; // copy BEFORE the next call (getWorldPoint reuses one Vector2)
    const b = cam.getWorldPoint(1000, 1000);
    this.w0 = { x: ax, y: ay };
    this.wS = { x: (b.x - ax) / 1000 || 1, y: (b.y - ay) / 1000 || 1 };
  }
  private worldOf(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    return { x: this.w0.x + pointer.x * this.wS.x, y: this.w0.y + pointer.y * this.wS.y };
  }

  /** While drawing a zone, snap the point to the SELECTED grid's cell corners so
   *  the polygon follows the grid; free pixels when no grid is chosen. */
  private snapPoint(x: number, y: number): { x: number; y: number } {
    const g = editorStore.selectedGrid;
    return g ? gridSnap(g, x, y) : { x, y };
  }

  private onMove = (pointer: Phaser.Input.Pointer): void => {
    if (!this.active) return;
    // Keep the pointer→world map fresh while just hovering, so wheel-zoom / middle-drag
    // pan never desync the hit-tests. Skip during an active drag/draw — the camera is
    // static then and getWorldPoint is unreliable mid-burst (we use the cached map).
    if (!this.drag && !editorStore.drawingGrid && !editorStore.drawingZone && !editorStore.calibratingGrid) {
      this.sampleWorldTransform();
    }
    editorStore.setHover(this.cellUnder(pointer));
    const w = this.worldOf(pointer);
    if (editorStore.drawingGrid) {
      if (editorStore.gridDraft) editorStore.setGridDraftEnd(w.x, w.y); // live drag box
      return;
    }
    if (editorStore.drawingZone || editorStore.calibratingGrid) {
      // Snap the rubber-band to the grid while tracing a zone (calibration stays raw).
      const p = editorStore.drawingZone ? this.snapPoint(w.x, w.y) : w;
      editorStore.setZoneCursor(p.x, p.y);
      return;
    }
    if (this.drag) {
      // World delta from the SCREEN delta ÷ zoom (getWorldPoint caches its transform
      // per frame, so it returns a constant during a fast drag — this stays live).
      const wdx = (pointer.x - this.drag.last.x) * this.wS.x;
      const wdy = (pointer.y - this.drag.last.y) * this.wS.y;
      if (this.drag.kind === 'vertex') {
        editorStore.moveZoneVertexBy(this.drag.id, this.drag.vi, wdx, wdy);
      } else if (this.drag.kind === 'zone') {
        editorStore.moveZoneBy(this.drag.id, wdx, wdy);
      } else if (this.drag.kind === 'gridmove') {
        editorStore.moveGridBy(this.drag.id, wdx, wdy);
      } else if (this.drag.kind === 'gridsize') {
        // Resize the box from its fixed top-left. The cursor delta is un-rotated into
        // the grid's own frame, so it stays continuous at any rotation.
        const d = this.drag;
        const wp = this.worldOf(pointer);
        const dvx = wp.x - d.grab.x;
        const dvy = wp.y - d.grab.y;
        const co = Math.cos(-d.rot);
        const si = Math.sin(-d.rot);
        const lx = dvx * co - dvy * si;
        const ly = dvx * si + dvy * co;
        editorStore.setGridBounds(d.id, { x: d.orig.x, y: d.orig.y, w: d.orig.w + lx, h: d.orig.h + ly }, false);
      } else if (this.drag.kind === 'gridrot') {
        // Rotate so the handle follows the cursor (angle from the grid centre).
        const g = editorStore.grids.find((x) => x.id === this.drag!.id);
        if (g) {
          const c = gridCenter(g);
          const w = this.worldOf(pointer);
          editorStore.setGridRot(g.id, (Math.atan2(w.y - c.y, w.x - c.x) * 180) / Math.PI + 90, false);
        }
      } else {
        // resize: scale the captured polygon from the anchor so the grabbed handle
        // follows the cursor (min 0.05 so it can shrink but never flip/collapse).
        const d = this.drag;
        d.cur.x += wdx;
        d.cur.y += wdy;
        const denX = d.handleOrig.x - d.anchor.x;
        const denY = d.handleOrig.y - d.anchor.y;
        const sx = d.hx && Math.abs(denX) > 1 ? Math.max(0.05, (d.cur.x - d.anchor.x) / denX) : 1;
        const sy = d.hy && Math.abs(denY) > 1 ? Math.max(0.05, (d.cur.y - d.anchor.y) / denY) : 1;
        editorStore.setZonePoints(
          d.id,
          d.orig.map((p) => ({ x: d.anchor.x + (p.x - d.anchor.x) * sx, y: d.anchor.y + (p.y - d.anchor.y) * sy }))
        );
      }
      this.drag.last = { x: pointer.x, y: pointer.y };
    }
  };

  private onUp = (): void => {
    if (editorStore.drawingGrid && editorStore.gridDraft) {
      editorStore.finishGridDraw(); // release ends the box → create the grid
      return;
    }
    if (this.drag) {
      // Commit the move/reshape/resize once, on release (both zone + grid edits).
      if (this.drag.kind === 'gridmove' || this.drag.kind === 'gridsize' || this.drag.kind === 'gridrot') editorStore.persistGrids();
      else editorStore.persistZones();
      this.drag = null;
    }
  };

  private onDown = (pointer: Phaser.Input.Pointer): void => {
    if (!this.active) return;
    if (pointer.button !== 0) return; // MIDDLE/RIGHT drag pans the camera (BoardScene) — not an edit
    // Refresh the pointer→world map on every click (a single down is never part of a
    // fast pointermove burst, so getWorldPoint is reliable here). This keeps hit-tests
    // aligned with the camera even if it settled/moved after the editor opened —
    // otherwise clicks land at the wrong world point and grids can't be selected.
    this.sampleWorldTransform();

    // Grille tab: DRAW a new grid by dragging a box; otherwise select a grid, grab a
    // handle (move / rotate / resize), or drag its body to move.
    if (editorStore.tab === 'grille') {
      const w = this.worldOf(pointer);
      if (editorStore.drawingGrid) {
        editorStore.setGridDraftStart(w.x, w.y); // begin the box drag
        return;
      }
      const sel = editorStore.selectedGrid;
      if (sel) {
        if (this.tryGridHandle(sel, w, pointer)) return; // move / rotate / resize knobs
        if (this.pointInPoly(gridOutline(sel), w.x, w.y)) {
          this.drag = { kind: 'gridmove', id: sel.id, last: { x: pointer.x, y: pointer.y } };
          return;
        }
      }
      editorStore.selectGrid(this.gridAt(w.x, w.y));
      return;
    }

    // Assets tab: place / move / select assets — SNAPPED to a custom grid when one is
    // under the cursor, so items land exactly on the grid you drew. A selected grid's
    // handles still adjust the grid (so you can nudge it without leaving the tab).
    if (editorStore.tab === 'assets') {
      const w = this.worldOf(pointer);
      const selg = editorStore.selectedGrid;
      if (selg && this.tryGridHandle(selg, w, pointer)) return;
      const g = this.gridUnder(w);
      if (editorStore.pendingAsset) {
        if (g) {
          const s = this.snapAssetToGrid(g, w);
          editorStore.placePendingOnGrid(g.id, s.gi, s.gj, s.col, s.row);
        } else {
          const cell = this.cellUnder(pointer);
          if (cell) editorStore.placePendingAt(cell.col, cell.row);
        }
        return;
      }
      const hit = this.assetHit(w);
      if (hit) {
        editorStore.selectAsset(hit);
        return;
      }
      if (editorStore.selectedAssetId) {
        if (g) {
          const s = this.snapAssetToGrid(g, w);
          editorStore.moveAssetOnGrid(editorStore.selectedAssetId, g.id, s.gi, s.gj, s.col, s.row);
        } else {
          const cell = this.cellUnder(pointer);
          if (cell) editorStore.moveAsset(editorStore.selectedAssetId, cell.col, cell.row);
        }
        return;
      }
      editorStore.selectAsset(null);
      return;
    }

    // Carte tab: zone drawing / grid calibration / move take over the pointer.
    if (editorStore.tab === 'carte') {
      const w = this.worldOf(pointer);
      if (editorStore.drawingZone) {
        const p = this.snapPoint(w.x, w.y); // land the vertex on the grid
        editorStore.addZonePoint(p.x, p.y);
        return;
      }
      if (editorStore.calibratingGrid) {
        editorStore.addCalibPoint(w.x, w.y); // click a painted tile's 4 corners
        return;
      }
      // Idle: grab the selected zone's transform box (resize), a vertex (reshape),
      // or its body (move) — else select a zone.
      const sel = editorStore.selectedZone;
      if (sel && sel.points.length >= 3) {
        const scr = { x: pointer.x, y: pointer.y };
        // 1) resize handle (bbox corners/edges) has priority
        for (const h of this.transformHandles(sel.points)) {
          if (Math.hypot(h.x - w.x, h.y - w.y) <= 26) {
            this.drag = {
              kind: 'resize',
              id: sel.id,
              anchor: { x: h.ax, y: h.ay },
              hx: h.sx,
              hy: h.sy,
              orig: sel.points.map((p) => ({ ...p })),
              handleOrig: { x: h.x, y: h.y },
              cur: { x: h.x, y: h.y },
              last: scr
            };
            return;
          }
        }
        // 2) a polygon vertex → reshape that point
        const vi = this.vertexAt(sel, w.x, w.y);
        if (vi >= 0) {
          this.drag = { kind: 'vertex', id: sel.id, vi, last: scr };
          return;
        }
        // 3) inside the body → move the whole zone
        if (this.pointInPoly(sel.points, w.x, w.y)) {
          this.drag = { kind: 'zone', id: sel.id, last: scr };
          return;
        }
      }
      editorStore.selectZone(this.zoneAt(w.x, w.y));
      return;
    }

    // Edit tab: if a custom grid is under the cursor, allocate/deallocate ITS cells
    // (with the current unlock level). Empty area falls through to the implicit grid.
    if (editorStore.tab === 'edit') {
      const w = this.worldOf(pointer);
      const selg = editorStore.selectedGrid;
      if (selg && this.tryGridHandle(selg, w, pointer)) return; // adjust the grid while allocating
      const g =
        editorStore.selectedGrid && this.pointInPoly(gridOutline(editorStore.selectedGrid), w.x, w.y)
          ? editorStore.selectedGrid
          : editorStore.grids.find((x) => x.id === this.gridAt(w.x, w.y)) ?? null;
      if (g) {
        if (editorStore.selectedGridId !== g.id) editorStore.selectGrid(g.id);
        const { i, j } = gridInvert(g, w.x, w.y);
        const ci = Math.round(i);
        const cj = Math.round(j);
        if (ci >= 0 && cj >= 0 && ci < g.cols && cj < g.rows) {
          const cur = editorStore.gridCellLevel(g, ci, cj);
          // allocate paints at the level, deallocate erases, select/multiselect toggle.
          const target =
            editorStore.tool === 'deallocate'
              ? 0
              : editorStore.tool === 'allocate'
                ? editorStore.allocLevel
                : cur >= 1
                  ? 0
                  : editorStore.allocLevel;
          editorStore.setGridCellAlloc(g.id, ci, cj, target);
        }
        return;
      }
      if (editorStore.selectedGridId) editorStore.selectGrid(null); // clicked off any grid
    }

    const cell = this.cellUnder(pointer);
    if (!cell) return;
    const ev = pointer.event as MouseEvent | undefined;
    const ctrl = ev?.ctrlKey === true || ev?.metaKey === true;

    // Position tab: click focuses the asset on this cell.
    if (editorStore.tab === 'position') {
      editorStore.selectAsset(this.assetAt(cell.col, cell.row));
      return;
    }

    // Edit tab: grid tools.
    switch (editorStore.tool) {
      case 'select':
        editorStore.toggleCell(cell.col, cell.row, false); // single-pick
        break;
      case 'multiselect':
        if (ctrl) editorStore.removeCell(cell.col, cell.row); // Ctrl+clic de-selects
        else editorStore.addCell(cell.col, cell.row); // clic adds to the set
        break;
      case 'allocate':
      case 'deallocate':
        editorStore.addCell(cell.col, cell.row);
        // Allocate → the chosen unlock level (opens at that Keeper level); 0 = block.
        editorStore.applyAllocation(editorStore.tool === 'allocate' ? editorStore.allocLevel : 0);
        break;
    }
  };

  private assetAt(col: number, row: number): string | null {
    const hit = editorStore.placedAssets.find((a) => a.col === col && a.row === row);
    return hit ? hit.id : null;
  }

  /** If the pointer grabbed one of the SELECTED grid's handles (move / rotate /
   *  resize), begin that drag and return true — so the grid can be adjusted from any
   *  tab, not just Grille. The handles sit OUTSIDE the cells, so they never block
   *  placing/allocating on the grid's interior. */
  private tryGridHandle(sel: GridDef, w: { x: number; y: number }, pointer: Phaser.Input.Pointer): boolean {
    const mh = gridMoveHandle(sel); // left knob — translate the whole grid
    if (Math.hypot(mh.x - w.x, mh.y - w.y) <= 28) {
      this.drag = { kind: 'gridmove', id: sel.id, last: { x: pointer.x, y: pointer.y } };
      return true;
    }
    const rh = gridRotateHandle(sel); // top knob — rotate
    if (Math.hypot(rh.x - w.x, rh.y - w.y) <= 30) {
      this.drag = { kind: 'gridrot', id: sel.id, last: { x: pointer.x, y: pointer.y } };
      return true;
    }
    const far = gridOutline(sel)[2]!; // far corner — resize
    if (Math.hypot(far.x - w.x, far.y - w.y) <= 30) {
      this.drag = {
        kind: 'gridsize',
        id: sel.id,
        orig: gridBBox(sel),
        grab: { x: w.x, y: w.y },
        rot: ((sel.rot ?? 0) * Math.PI) / 180,
        last: { x: pointer.x, y: pointer.y }
      };
      return true;
    }
    return false;
  }

  /** The grid a world point falls in — the selected grid (if the point is inside it)
   *  wins, else the topmost grid; null if the point is on no grid. */
  private gridUnder(w: { x: number; y: number }): GridDef | null {
    const sel = editorStore.selectedGrid;
    if (sel && this.pointInPoly(gridOutline(sel), w.x, w.y)) return sel;
    const id = this.gridAt(w.x, w.y);
    return id ? editorStore.grids.find((g) => g.id === id) ?? null : null;
  }

  /** Snap a world point to a grid cell → its (i,j) indices + the game cell its centre
   *  falls on (kept for the game-side integration in `applyBaseToGame`). */
  private snapAssetToGrid(g: GridDef, w: { x: number; y: number }): { gi: number; gj: number; col: number; row: number } {
    const { i, j } = gridInvert(g, w.x, w.y);
    const gi = Math.max(0, Math.min(g.cols - 1, Math.round(i)));
    const gj = Math.max(0, Math.min(g.rows - 1, Math.round(j)));
    const c = gridCellCenter(g, gi, gj);
    const { col, row } = this.toGrid(c.x, c.y);
    return { gi, gj, col, row };
  }

  /** World position an asset renders at: its pinned grid cell (exact), else its game
   *  cell. This is what makes placed assets sit ON the custom grid. */
  private assetWorld(a: PlacedAsset): { x: number; y: number } {
    if (a.gridId && a.gi !== undefined && a.gj !== undefined) {
      const g = editorStore.grids.find((x) => x.id === a.gridId);
      if (g) return gridCellCenter(g, a.gi, a.gj);
    }
    if (a.wx !== undefined && a.wy !== undefined) return { x: a.wx, y: a.wy }; // baked pin — survives an unresolved grid
    return this.toWorld(a.col, a.row);
  }

  /** Pick the placed asset under a world point. Test the rendered SPRITE's display
   *  bounds first (topmost/highest-depth wins) — so a tall 3D model is selectable by
   *  clicking anywhere on its VISIBLE body, not just near its tile-centre anchor
   *  (which sat far below the art and made big/3D assets feel unclickable). Falls back
   *  to nearest-anchor within grab range for tiny assets whose bounds barely register. */
  private assetHit(w: { x: number; y: number }): string | null {
    let hit: string | null = null;
    let hitDepth = -Infinity;
    let best: string | null = null;
    let bestD = Infinity;
    for (const a of editorStore.placedAssets) {
      const sprite = this.assetSprites.get(a.id);
      if (sprite && sprite.getBounds().contains(w.x, w.y) && sprite.depth > hitDepth) {
        hit = a.id;
        hitDepth = sprite.depth;
      }
      const p = this.assetWorld(a);
      const d = Math.hypot(p.x - w.x, p.y - w.y);
      if (d < bestD) {
        bestD = d;
        best = a.id;
      }
    }
    return hit ?? (bestD <= TILE_W * 0.75 ? best : null);
  }

  /** Ray-cast point-in-polygon on world-space {x,y} vertices (our own — avoids any
   *  Phaser.Geom.Polygon flat-array ambiguity). */
  private pointInPoly(pts: { x: number; y: number }[], x: number, y: number): boolean {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i]!.x;
      const yi = pts[i]!.y;
      const xj = pts[j]!.x;
      const yj = pts[j]!.y;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /** Topmost grid whose matrix outline contains a world point (last wins), else null. */
  private gridAt(x: number, y: number): string | null {
    const gs = editorStore.grids;
    for (let i = gs.length - 1; i >= 0; i--) {
      const g = gs[i]!;
      if (this.pointInPoly(gridOutline(g), x, y)) return g.id;
    }
    return null;
  }

  /** Topmost zone whose polygon contains a world point (last drawn wins), else null. */
  private zoneAt(x: number, y: number): string | null {
    const zs = editorStore.zones;
    for (let i = zs.length - 1; i >= 0; i--) {
      const z = zs[i]!;
      if (z.points.length >= 3 && this.pointInPoly(z.points, x, y)) return z.id;
    }
    return null;
  }

  /** Index of the selected zone's vertex within grab range of a world point, else -1. */
  private vertexAt(zone: { points: { x: number; y: number }[] }, x: number, y: number): number {
    const R = 26; // world-px grab radius (tiles are ~256 wide, so this stays small)
    for (let i = 0; i < zone.points.length; i++) {
      const p = zone.points[i]!;
      if (Math.hypot(p.x - x, p.y - y) <= R) return i;
    }
    return -1;
  }

  /** The 8 transform-box handles for a polygon's bounding box: 4 corners (scale
   *  both axes) + 4 edge midpoints (scale one axis). `ax/ay` = the opposite anchor
   *  the scale grows from; `sx/sy` = which axes this handle scales. */
  private transformHandles(pts: { x: number; y: number }[]): { x: number; y: number; ax: number; ay: number; sx: boolean; sy: boolean }[] {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const mx = (minX + maxX) / 2;
    const my = (minY + maxY) / 2;
    return [
      { x: minX, y: minY, ax: maxX, ay: maxY, sx: true, sy: true },
      { x: maxX, y: minY, ax: minX, ay: maxY, sx: true, sy: true },
      { x: maxX, y: maxY, ax: minX, ay: minY, sx: true, sy: true },
      { x: minX, y: maxY, ax: maxX, ay: minY, sx: true, sy: true },
      { x: mx, y: minY, ax: mx, ay: maxY, sx: false, sy: true },
      { x: maxX, y: my, ax: minX, ay: my, sx: true, sy: false },
      { x: mx, y: maxY, ax: mx, ay: minY, sx: false, sy: true },
      { x: minX, y: my, ax: maxX, ay: my, sx: true, sy: false }
    ];
  }

  /* ------------------------- the PAGE's own lattice ------------------------- */

  /**
   * Every map is edited at ITS OWN pitch.
   *
   * A map's grids were hand-drawn on that map's backdrop art, at whatever scale
   * that art is painted — so reading them through the running world's projection
   * puts the cell overlay somewhere the drawn grids are not, which is exactly the
   * "the editor doesn't follow my grid any more" symptom. `latticeFor` recovers the
   * page's pitch from its own grids and returns null for a page it cannot represent
   * (rotated or ortho grids), which falls back to the ambient projection.
   *
   * LOCAL on purpose. The old build re-pointed the engine's ONE global lattice
   * (`setLattice`) whenever the editor paged, which moved the running game's
   * coordinates under it. The engine now holds a world as independently placed
   * zones and owns its own projection; this is a VIEW, and it stays in the view.
   */
  private lattice: Lattice | null = null;

  private refreshLattice(): void {
    this.lattice = latticeFor(editorStore.grids);
  }

  /** Cell → world pixel, in the page's lattice when it has one. */
  private toWorld(col: number, row: number): { x: number; y: number } {
    return this.lattice ? projectIn(this.lattice, col, row) : gridToWorld(col, row);
  }

  /** World pixel → cell, the inverse of `toWorld`. */
  private toGrid(x: number, y: number): { col: number; row: number } {
    return this.lattice ? unprojectIn(this.lattice, x, y) : worldToGrid(x, y);
  }

  private halfW(): number {
    return this.lattice ? this.lattice.halfW : projHalfW();
  }

  private halfH(): number {
    return this.lattice ? this.lattice.halfH : projHalfH();
  }

  /* ----------------------------- drawing ------------------------------ */

  private diamond(col: number, row: number): number[] {
    const { x, y } = this.toWorld(col, row);
    const hw = this.halfW(); // the page's tile-width reference
    const hh = this.halfH(); // its true vertical pitch — tiles seamlessly
    return [x, y - hh, x + hw, y, x, y + hh, x - hw, y];
  }

  private redraw(): void {
    if (!this.active) return;
    this.refreshLattice(); // the page may have changed under us
    this.blackCover.setVisible(editorStore.blackout); // only the manual "Fond noir" — a deleted default is replaced by the imported map, not black
    // Full mesh only when something structural changed; hover overlay every move.
    if (editorStore.rev !== this.lastRev) {
      this.lastRev = editorStore.rev;
      this.redrawStatic();
    }
    this.redrawHover();
    this.redrawGridDefs(); // the defined grids (foundation), beneath the zones
    this.redrawZones(); // cheap — runs every frame incl. the live rubber-band
    this.syncAssets();
    this.redrawCellHighlight(); // the "selection follows the grid" cell — exact grid shape
  }

  /**
   * The asset placement/selection highlight — a single cell painted in the EXACT
   * shape of the custom grid (diamond/square, sized + rotated as you drew it). On
   * the Assets tab it marks: the SELECTED asset's own grid cell (cyan) and, under
   * the cursor, the cell a placed/moved asset will SNAP to (gold) — so moving an
   * object shows a selection effect that truly follows your grid.
   */
  private redrawCellHighlight(): void {
    const g = this.cellHi;
    g.clear();
    if (!this.active || editorStore.tab !== 'assets') return;
    const hover = editorStore.hoverCell;
    // 1) The cell under the cursor a pending/selected asset will land on (gold).
    if ((editorStore.pendingAsset || editorStore.selectedAssetId) && hover) {
      const hw = this.toWorld(hover.col, hover.row);
      const gd = this.gridUnder(hw);
      if (gd) {
        const s = this.snapAssetToGrid(gd, hw);
        this.strokeCell(g, gd, s.gi, s.gj, 0xffd84d);
      }
    }
    // 2) The selected asset's OWN pinned cell (cyan) — the persistent selection mark.
    const sel = editorStore.selectedAsset;
    if (sel && sel.gridId && sel.gi !== undefined && sel.gj !== undefined) {
      const gd = editorStore.grids.find((x) => x.id === sel.gridId);
      if (gd) this.strokeCell(g, gd, sel.gi, sel.gj, 0x8af3ff);
    }
  }

  /** Fill+stroke one grid cell (exact grid shape) in the given colour. */
  private strokeCell(g: Phaser.GameObjects.Graphics, gd: GridDef, i: number, j: number, color: number): void {
    const pts = gridCellPolygon(gd, i, j).map((p) => new Phaser.Geom.Point(p.x, p.y));
    g.fillStyle(color, 0.22);
    g.fillPoints(pts, true);
    g.lineStyle(4, color, 0.95);
    g.strokePoints(pts, true);
  }

  /** The whole-map grid + allocation state + selection — the expensive layer. */
  private redrawStatic(): void {
    const g = this.gridStatic;
    g.clear();
    if (!editorStore.darken) {
      this.clearCellBadges();
      for (const t of this.regionLabels) t.setVisible(false);
      return; // "Assombrir" off → clean map, no grid/labels
    }
    if (!editorStore.showGrid) {
      // Grid removed (Carte tab): clean art for zone-drawing — no mesh/badges/labels.
      this.clearCellBadges();
      for (const t of this.regionLabels) t.setVisible(false);
      return;
    }

    // NO FOREIGN MESH. This mesh is the CELL grid, and a cell only means something
    // in a lattice. The page has one when its own grids define it (`this.lattice`);
    // failing that, only the page the game is actually running can borrow the
    // engine's. Drawing the running world's mesh over another map's art is what
    // made the editor look like it had stopped following the grid — so on a page
    // that can't speak for itself, the hand-drawn grids are shown alone.
    if (!this.lattice && editorStore.currentMapId !== editorStore.activeGameWorldId) {
      this.clearCellBadges();
      for (const t of this.regionLabels) t.setVisible(false);
      return;
    }

    for (let r = this.gMinR; r <= this.gMaxR; r++) {
      for (let c = this.gMinC; c <= this.gMaxC; c++) {
        const poly = this.toPts(this.diamond(c, r));
        const key = cellKey(c, r);
        const inRegion = c >= 0 && r >= 0 && c < this.cols && r < this.rows;
        const touched = editorStore.allocations.get(key) !== undefined;
        const selected = editorStore.selectedCells.has(key);

        if (inRegion || touched) {
          // Colour by effective state (region status / editor override).
          const [fill, fa, line, la] = this.cellStyle(c, r, key);
          g.fillStyle(fill, fa);
          g.fillPoints(poly, true);
          g.lineStyle(2.5, line, la);
          g.strokePoints(poly, true);
        } else {
          // Untouched backdrop cell — faint outline so the art stays readable.
          g.lineStyle(1.5, 0x4a3f57, 0.3);
          g.strokePoints(poly, true);
        }

        if (selected) {
          g.fillStyle(0xffffff, 0.3);
          g.fillPoints(poly, true);
          g.lineStyle(4, 0xffffff, 0.95);
          g.strokePoints(poly, true);
        }
      }
    }
    for (const t of this.regionLabels) t.setVisible(editorStore.darken);

    // "L{n}" badges on cells you allocated to open at a level > 1.
    this.clearCellBadges();
    for (const [key, lvl] of editorStore.allocations) {
      if (lvl <= 1) continue;
      const [bc, br] = key.split(',').map(Number) as [number, number];
      const { x, y } = this.toWorld(bc, br);
      this.cellBadges.push(
        this.scene.add
          .text(x, y, `L${lvl}`, {
            fontFamily: 'sans-serif',
            fontSize: '26px',
            fontStyle: 'bold',
            color: '#d8f7ff',
            stroke: '#07333a',
            strokeThickness: 6
          })
          .setOrigin(0.5)
          .setDepth(EDITOR_DEPTH + 2)
      );
    }
  }

  private clearCellBadges(): void {
    for (const t of this.cellBadges) t.destroy();
    this.cellBadges = [];
  }

  /**
   * Colour a board cell by its EFFECTIVE state — a faithful, clean copy of the
   * game's zone model. Editor override wins, else the LIVE region status:
   * active (green, playable now) / unlockable (amber, opens at a level or key) /
   * locked (red) / void (no region). Returns [fill, fillAlpha, line, lineAlpha].
   */
  private cellStyle(c: number, r: number, key: string): [number, number, number, number] {
    const override = editorStore.allocations.get(key);
    // Editor override = unlock level: >0 = you allocated (green + cyan border, with a
    // "Lv N" badge for N>1 drawn in redrawStatic); 0 = you blocked.
    if (override !== undefined && override > 0) return [0x2ad673, 0.28, 0x3fe0ff, 0.95];
    if (override === 0) return [0x120810, 0.66, 0xff5a5a, 0.7]; // YOU blocked
    switch (this.ctx.state.regionStatusAt(c, r)) {
      case 'active':
        return [0x2ad673, 0.22, 0x2ad673, 0.7]; // functional NOW
      case 'unlockable':
        return [0xf5a01e, 0.2, 0xffb733, 0.75]; // opens at a level / key
      case 'locked':
        return [0x7a2436, 0.22, 0xb0466a, 0.55]; // locked
      default:
        return [0x0a0713, 0.55, 0x3a3350, 0.4]; // in-bounds but no region (void)
    }
  }

  /** A short unlock badge per region ("Lv 2", "🔑 Lv 2", "🔒") placed at its
   *  centroid, so the "opens at a higher level / key" rule is visible at a glance.
   *  Active regions get no badge (already open). */
  private buildRegionLabels(): void {
    this.clearRegionLabels();
    for (const region of this.ctx.data.map.regions ?? []) {
      const status = this.ctx.state.regionStatus.get(region.id) ?? region.status;
      const badge = unlockBadge(status, region.unlock);
      if (!badge || !region.tiles.length) continue;
      let sc = 0;
      let sr = 0;
      for (const [c, r] of region.tiles) {
        sc += c;
        sr += r;
      }
      const { x, y } = gridToWorld(sc / region.tiles.length, sr / region.tiles.length);
      this.regionLabels.push(
        this.scene.add
          .text(x, y, badge, {
            fontFamily: 'sans-serif',
            fontSize: '46px',
            fontStyle: 'bold',
            color: status === 'locked' ? '#ffb0b0' : '#ffe08a',
            stroke: '#160d18',
            strokeThickness: 9,
            align: 'center'
          })
          .setOrigin(0.5)
          .setDepth(EDITOR_DEPTH + 3)
      );
    }
  }

  private clearRegionLabels(): void {
    for (const t of this.regionLabels) t.destroy();
    this.regionLabels = [];
  }

  /** Just the hovered cell's outline — cheap, redrawn on every pointer move. */
  private redrawHover(): void {
    const g = this.gridHover;
    g.clear();
    if (!editorStore.darken || !editorStore.showGrid) return; // no implicit-grid hover unless the square grid is on
    const h = editorStore.hoverCell;
    if (!h || editorStore.selectedCells.has(cellKey(h.col, h.row))) return;
    g.lineStyle(3, 0xffffff, 0.75);
    g.strokePoints(this.toPts(this.diamond(h.col, h.row)), true);
  }

  private toPts(flat: number[]): Phaser.Geom.Point[] {
    const out: Phaser.Geom.Point[] = [];
    for (let i = 0; i < flat.length; i += 2) out.push(new Phaser.Geom.Point(flat[i]!, flat[i + 1]!));
    return out;
  }

  private clearZoneLabels(): void {
    for (const t of this.zoneLabels) t.destroy();
    this.zoneLabels = [];
  }

  private clearGridLabels(): void {
    for (const t of this.gridLabels) t.destroy();
    this.gridLabels = [];
  }

  /**
   * Paint every defined grid: its cell lattice (diamonds for iso, squares for
   * ortho), the matrix outline, and — for the selected grid on the Grille tab — a
   * far-corner resize handle + a name/size label. Grids are the foundation, so they
   * show on every tab (dimmer off the Grille tab) — you see them while drawing the
   * zones that sit on them.
   */
  private redrawGridDefs(): void {
    const g = this.gridDefLayer;
    g.clear();
    this.clearGridLabels();
    if (!this.active) return;
    const onTab = editorStore.tab === 'grille';

    for (const def of editorStore.grids) {
      const sel = editorStore.selectedGridId === def.id;
      const cellA = sel ? 0.95 : onTab ? 0.5 : 0.26;

      // Cell lattice (capped so a huge matrix can't stall the frame). Allocated cells
      // fill by unlock level: green = playable now (L1), amber = opens at a level (L≥2).
      if (def.cols * def.rows <= 3000) {
        const alloc = def.alloc ?? {};
        g.lineStyle(sel ? 2 : 1.5, sel ? 0x8af3ff : 0x66e0a0, cellA);
        for (let i = 0; i < def.cols; i++) {
          for (let j = 0; j < def.rows; j++) {
            // EXACT cell shape (rotation-aware) — same helper as the highlight, so
            // the "selection follows the grid" mark lines up with the drawn mesh.
            const pts = gridCellPolygon(def, i, j).map((p) => new Phaser.Geom.Point(p.x, p.y));
            const lvl = alloc[`${i},${j}`] ?? 0;
            if (lvl >= 1) {
              g.fillStyle(lvl === 1 ? 0x2ad673 : 0xf5a01e, sel ? 0.36 : 0.24);
              g.fillPoints(pts, true);
            }
            g.strokePoints(pts, true);
          }
        }
        // "L{n}" badges on cells that open at a level > 1 (selected grid only, capped).
        if (sel) {
          let badges = 0;
          for (const [key, lvl] of Object.entries(alloc)) {
            if (lvl <= 1 || badges >= 150) continue;
            const [bi, bj] = key.split(',').map(Number) as [number, number];
            const cc = gridCellCenter(def, bi, bj);
            this.gridLabels.push(
              this.scene.add
                .text(cc.x, cc.y, `L${lvl}`, {
                  fontFamily: 'sans-serif',
                  fontSize: '22px',
                  fontStyle: 'bold',
                  color: '#fff2b0',
                  stroke: '#3a2410',
                  strokeThickness: 5
                })
                .setOrigin(0.5)
                .setDepth(EDITOR_DEPTH + 6)
            );
            badges++;
          }
        }
      }

      // Matrix outline.
      const out = gridOutline(def);
      g.lineStyle(sel ? 5 : 3, sel ? 0x8af3ff : 0x3fe0ff, onTab || sel ? 0.9 : 0.4);
      g.strokePoints(out.map((p) => new Phaser.Geom.Point(p.x, p.y)), true);

      if (sel) {
        // Handles show on EVERY tab (not just Grille) so a selected grid is always
        // adjustable: far-corner resize, top rotate knob, left move knob. All sit
        // OUTSIDE the cells, so they never block placing/allocating on the interior.
        const S = 22;
        const rz = out[2]!;
        g.fillStyle(0x8af3ff, 1);
        g.fillRect(rz.x - S / 2, rz.y - S / 2, S, S);
        g.lineStyle(3, 0x0a2a30, 1);
        g.strokeRect(rz.x - S / 2, rz.y - S / 2, S, S);
        // Rotate handle: a stalk from the centre to a knob above the grid.
        const c = gridCenter(def);
        const rh = gridRotateHandle(def);
        g.lineStyle(2, 0x8af3ff, 0.7);
        g.lineBetween(c.x, c.y, rh.x, rh.y);
        g.fillStyle(0xffd84d, 1);
        g.fillCircle(rh.x, rh.y, 12);
        g.lineStyle(3, 0x0a2a30, 1);
        g.strokeCircle(rh.x, rh.y, 12);
        // Move handle: a green knob off the left vertex — drag to translate the grid.
        const mh = gridMoveHandle(def);
        g.lineStyle(2, 0x2ad673, 0.6);
        g.lineBetween(out[3]!.x, out[3]!.y, mh.x, mh.y);
        g.fillStyle(0x2ad673, 1);
        g.fillCircle(mh.x, mh.y, 13);
        g.lineStyle(3, 0x0a2a30, 1);
        g.strokeCircle(mh.x, mh.y, 13);
      }

      if (onTab) {
        const cc = gridCellCenter(def, (def.cols - 1) / 2, (def.rows - 1) / 2);
        this.gridLabels.push(
          this.scene.add
            .text(cc.x, cc.y, `${def.name}  ·  ${def.cols}×${def.rows}`, {
              fontFamily: 'sans-serif',
              fontSize: '28px',
              fontStyle: 'bold',
              color: sel ? '#0a2a30' : '#d8f7ff',
              backgroundColor: sel ? '#8af3ffcc' : '#0a1a1fcc',
              padding: { x: 8, y: 3 },
              stroke: '#07333a',
              strokeThickness: sel ? 0 : 4
            })
            .setOrigin(0.5)
            .setDepth(EDITOR_DEPTH + 6)
        );
      }
    }

    // The live drag box while creating a grid by hand.
    const d = editorStore.gridDraft;
    if (editorStore.drawingGrid && d) {
      const x = Math.min(d.sx, d.ex);
      const y = Math.min(d.sy, d.ey);
      const w = Math.abs(d.ex - d.sx);
      const h = Math.abs(d.ey - d.sy);
      g.fillStyle(0x8af3ff, 0.12);
      g.fillRect(x, y, w, h);
      g.lineStyle(3, 0xffd84d, 0.95);
      g.strokeRect(x, y, w, h);
    }
  }

  /**
   * Paint every saved zone (filled polygon + outline + name label) and, while the
   * "Tracer une zone" tool is live, the draft: dropped vertices, the fixed edges,
   * and the yellow rubber-band from the last vertex to the cursor (plus a faint
   * closing hint back to the first point). Cheap — a handful of polygons.
   */
  private redrawZones(): void {
    const g = this.zoneLayer;
    g.clear();
    this.clearZoneLabels();
    if (!this.active) return;

    for (const z of editorStore.zones) {
      if (z.points.length < 2) continue;
      const pts = z.points.map((p) => new Phaser.Geom.Point(p.x, p.y));
      const sel = editorStore.selectedZoneId === z.id;
      if (z.points.length >= 3) {
        g.fillStyle(sel ? 0x3fe0ff : 0x2ad673, sel ? 0.22 : 0.16);
        g.fillPoints(pts, true);
      }
      g.lineStyle(sel ? 5 : 3, sel ? 0x8af3ff : 0x3fe0ff, 0.95);
      g.strokePoints(pts, true);
      if (z.grid) this.drawZoneGrid(g, z); // the calibrated per-tile lattice
      // Vertex dots (drag to reshape a single point).
      g.fillStyle(0xffffff, sel ? 1 : 0.85);
      for (const p of z.points) g.fillCircle(p.x, p.y, sel ? 7 : 5);
      // Selected: transform box (drag a square handle to resize, the body to move).
      if (sel && z.points.length >= 3) this.drawTransformBox(g, z.points);
      const c = this.centroid(z.points);
      this.zoneLabels.push(
        this.scene.add
          .text(c.x, c.y, z.name, {
            fontFamily: 'sans-serif',
            fontSize: '30px',
            fontStyle: 'bold',
            color: sel ? '#0a2a30' : '#d8f7ff',
            backgroundColor: sel ? '#8af3ffcc' : '#0a1a1fcc',
            padding: { x: 8, y: 3 },
            stroke: '#07333a',
            strokeThickness: sel ? 0 : 4
          })
          .setOrigin(0.5)
          .setDepth(EDITOR_DEPTH + 6)
      );
    }

    if (editorStore.drawingZone) {
      const dp = editorStore.draftPoints;
      const cur = editorStore.draftCursor;
      if (dp.length >= 2) {
        g.lineStyle(3, 0xffd84d, 0.95);
        g.strokePoints(dp.map((p) => new Phaser.Geom.Point(p.x, p.y)), false); // open polyline
      }
      if (dp.length && cur) {
        const last = dp[dp.length - 1]!;
        g.lineStyle(2.5, 0xffd84d, 0.7);
        g.lineBetween(last.x, last.y, cur.x, cur.y); // rubber-band to cursor
        if (dp.length >= 2) {
          g.lineStyle(1.5, 0xffd84d, 0.3);
          g.lineBetween(cur.x, cur.y, dp[0]!.x, dp[0]!.y); // faint "closes here" hint
        }
      }
      g.fillStyle(0xffd84d, 1);
      for (const p of dp) g.fillCircle(p.x, p.y, 8);
      // Snapping to a grid → ring the snapped node so the lock is obvious.
      if (editorStore.selectedGrid && cur) {
        g.lineStyle(3, 0x8af3ff, 0.95);
        g.strokeCircle(cur.x, cur.y, 12);
      }
    }

    // Grid calibration: the tile-corner clicks (haut/droite/bas/gauche) + cursor.
    if (editorStore.calibratingGrid) {
      const cp = editorStore.calibPoints;
      if (cp.length >= 2) {
        g.lineStyle(2, 0xff5cf0, 0.8);
        g.strokePoints(cp.map((p) => new Phaser.Geom.Point(p.x, p.y)), false);
      }
      g.fillStyle(0xff5cf0, 1);
      for (const p of cp) g.fillCircle(p.x, p.y, 9);
      const cur = editorStore.draftCursor;
      if (cur) {
        g.fillStyle(0xff5cf0, 0.55);
        g.fillCircle(cur.x, cur.y, 7);
      }
    }
  }

  /** Draw a zone's calibrated iso lattice: every tile whose centre lands inside the
   *  polygon. Cheap and clipped; capped so a mis-calibration can't runaway. */
  private drawZoneGrid(g: Phaser.GameObjects.Graphics, z: { points: { x: number; y: number }[]; grid?: { ox: number; oy: number; hw: number; hh: number } }): void {
    const gr = z.grid;
    if (!gr) return;
    let minx = Infinity;
    let miny = Infinity;
    let maxx = -Infinity;
    let maxy = -Infinity;
    for (const p of z.points) {
      minx = Math.min(minx, p.x);
      maxx = Math.max(maxx, p.x);
      miny = Math.min(miny, p.y);
      maxy = Math.max(maxy, p.y);
    }
    const toIJ = (x: number, y: number): { i: number; j: number } => {
      const a = (x - gr.ox) / gr.hw;
      const b = (y - gr.oy) / gr.hh;
      return { i: (a + b) / 2, j: (b - a) / 2 };
    };
    const cs = [toIJ(minx, miny), toIJ(maxx, miny), toIJ(minx, maxy), toIJ(maxx, maxy)];
    const iMin = Math.floor(Math.min(...cs.map((c) => c.i))) - 1;
    const iMax = Math.ceil(Math.max(...cs.map((c) => c.i))) + 1;
    const jMin = Math.floor(Math.min(...cs.map((c) => c.j))) - 1;
    const jMax = Math.ceil(Math.max(...cs.map((c) => c.j))) + 1;
    g.lineStyle(2, 0xffd84d, 0.9);
    let count = 0;
    for (let i = iMin; i <= iMax; i++) {
      for (let j = jMin; j <= jMax; j++) {
        if (++count > 4000) return; // safety cap
        const cx = gr.ox + (i - j) * gr.hw;
        const cy = gr.oy + (i + j) * gr.hh;
        if (!this.pointInPoly(z.points, cx, cy)) continue;
        g.strokePoints(this.toPts([cx, cy - gr.hh, cx + gr.hw, cy, cx, cy + gr.hh, cx - gr.hw, cy]), true);
      }
    }
  }

  /** The selected zone's bounding box + 8 square resize handles. */
  private drawTransformBox(g: Phaser.GameObjects.Graphics, pts: { x: number; y: number }[]): void {
    const hs = this.transformHandles(pts);
    const box = [hs[0]!, hs[1]!, hs[2]!, hs[3]!].map((h) => new Phaser.Geom.Point(h.x, h.y));
    g.lineStyle(2, 0x8af3ff, 0.6);
    g.strokePoints(box, true); // dashed-look bbox (thin cyan)
    const S = 20; // handle size in world px
    for (const h of hs) {
      g.fillStyle(0x8af3ff, 1);
      g.fillRect(h.x - S / 2, h.y - S / 2, S, S);
      g.lineStyle(3, 0x0a2a30, 1);
      g.strokeRect(h.x - S / 2, h.y - S / 2, S, S);
    }
  }

  private centroid(pts: { x: number; y: number }[]): { x: number; y: number } {
    let sx = 0;
    let sy = 0;
    for (const p of pts) {
      sx += p.x;
      sy += p.y;
    }
    const n = Math.max(1, pts.length);
    return { x: sx / n, y: sy / n };
  }

  /** Paint the paged base-map layer so it covers the whole backdrop area. The
   *  game's OWN backdrop (map #1, `base`) is drawn by the game itself, so we hide
   *  the override sprite and let it show through. */
  private renderCurrentMap(): void {
    const layer = editorStore.currentMapLayer;
    if (!layer || layer.base || !this.scene.textures.exists(layer.textureKey)) {
      this.mapSprite?.setVisible(false);
      return;
    }
    const r = this.mapRect();
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const cover = Math.max(r.w / Math.max(1, layer.w), r.h / Math.max(1, layer.h)); // fill the area
    if (!this.mapSprite) {
      this.mapSprite = this.scene.add.image(cx, cy, layer.textureKey).setDepth(EDITOR_DEPTH - 200);
    }
    this.mapSprite
      .setTexture(layer.textureKey)
      .setPosition(cx, cy)
      .setDisplaySize(layer.w * cover, layer.h * cover)
      .setVisible(true);
  }

  /** Reconcile placed-asset sprites with the store, the base map and the ghost. */
  private syncAssets(): void {
    this.renderCurrentMap();
    // remove sprites whose asset is gone
    for (const [id, sprite] of this.assetSprites) {
      if (!editorStore.placedAssets.some((a) => a.id === id)) {
        sprite.destroy();
        this.assetSprites.delete(id);
      }
    }
    for (const a of editorStore.placedAssets) this.drawAsset(a);

    // The move "shadow": a translucent preview of the asset AT THE GRID CELL it will
    // land on — shown ONLY when the cursor is over a grid you drew (never off-grid).
    // Covers both a pending import AND moving an already-placed selected asset.
    const src = editorStore.pendingAsset ?? (editorStore.tab === 'assets' ? editorStore.selectedAsset : null);
    const hover = editorStore.hoverCell;
    let shown = false;
    if (src && hover) {
      const hw = gridToWorld(hover.col, hover.row);
      const g = this.gridUnder(hw); // null off any custom grid → no shadow
      if (g) {
        const s = this.snapAssetToGrid(g, hw);
        const c = gridCellCenter(g, s.gi, s.gj);
        // Don't ghost a moving asset on its OWN current cell (nothing to preview).
        const moving = src === editorStore.selectedAsset ? editorStore.selectedAsset : null;
        const onOwnCell = !!moving && moving.gridId === g.id && moving.gi === s.gi && moving.gj === s.gj;
        if (!onOwnCell) {
          if (!this.ghost || this.ghost.texture.key !== src.textureKey) {
            this.ghost?.destroy();
            this.ghost = this.scene.add.image(c.x, c.y, src.textureKey).setDepth(EDITOR_DEPTH + 9000).setAlpha(0.6);
          }
          const d = this.fit(src);
          this.ghost.setPosition(c.x, c.y).setDisplaySize(d.w, d.h).setVisible(true);
          shown = true;
        }
      }
    }
    if (!shown) this.ghost?.setVisible(false);
  }

  /**
   * Auto-fit an asset to ~1.4 tiles wide (so it reads as a board piece whatever
   * its source resolution), ×the size slider, keeping the source aspect ratio.
   */
  private fit(a: { w: number; h: number; scale: number }): { w: number; h: number } {
    const w = TILE_W * 1.4 * a.scale;
    return { w, h: w * (a.h / Math.max(1, a.w)) };
  }

  private drawAsset(a: PlacedAsset): void {
    const { x, y } = this.assetWorld(a); // pinned grid cell (exact) or the game cell
    let sprite = this.assetSprites.get(a.id);
    if (!sprite) {
      sprite = this.scene.add.image(x, y, a.textureKey);
      this.assetSprites.set(a.id, sprite);
    }
    const d = this.fit(a);
    // z = vertical offset (positive raises the asset); depth stays by tile row.
    sprite.setTexture(a.textureKey).setPosition(x, y - (a.z ?? 0)).setDisplaySize(d.w, d.h).setDepth(EDITOR_DEPTH + 1000 + y);
    sprite.setAngle(a.rot ?? 0);
    sprite.setFlip(!!a.flipX, !!a.flipY);
    sprite.setTint(editorStore.selectedAssetId === a.id ? 0xfff2b0 : 0xffffff);
  }
}
