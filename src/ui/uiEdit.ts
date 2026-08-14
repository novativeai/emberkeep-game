import Phaser from 'phaser';
import { TextureFactory, UI_TEXTURE_PARAMS } from '../art/TextureFactory';
import { LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT, PALETTE } from '../core/Constants';
import { bodyMotions, CHARACTER_RIGS, faceMotions } from '../render/characterCatalog';
import { BUILTIN_SEQUENCES } from '../render/sequenceCatalog';
import type { CustomUiManager } from './customUi';
import { applyUiReplacements, ensureSequenceTextures, repaintTextureWith, sequenceFrameKey, uiRegistry, uploadKey, type UiElementInfo, type UiElementPatch } from './theme';
import { sanitizeThemeDoc, type UiThemeDoc } from './themeCore';
import type { CustomComponent, CustomLayer, UiSequence } from './themeCore';

/**
 * In-game half of the UI Builder satellite tool (tools/uibuilder).
 *
 * Runs inside UiEditorScene (the `?uiedit=1` document — never the game): the
 * tool embeds that scene in an iframe and drives it over postMessage. This
 * module owns everything that needs engine truth — element/layer bounds,
 * selection outlines, staging (the canvas is the game window: saved components
 * sit at their exact in-game position; built-ins stage centered for editing),
 * component/layer drags + frame corner-resize, live theme patches, chrome
 * repaints, uploads and in-place texture replacement, and thumbnails.
 */

interface BridgeMsg {
  __uib: true;
  type: string;
  [k: string]: unknown;
}

const OVERLAY_DEPTH = 100000;

/** Snap pull radius for centring guides, in game px (canvas is 2560×1600). */
const SNAP_RANGE = 16;
const SNAP_GUIDE_COLOR = 0xff4fd2; // Figma-pink smart guide

/** Font stacks offered in the tool — the game's own face first. */
const FONT_PRESETS = [
  'Trebuchet MS, Verdana, sans-serif',
  'Verdana, Geneva, sans-serif',
  'Georgia, "Times New Roman", serif',
  '"Comic Sans MS", "Chalkboard SE", cursive',
  '"Courier New", monospace'
];

/** Extra swatch-able textures shown in the tool's asset rail. */
const ICON_KEYS = [
  'ui_icon_bolt',
  'ui_icon_coin',
  'ui_icon_key',
  'ui_icon_gear',
  'ui_icon_scroll',
  'ui_btn_round',
  'portrait_eleanor',
  'portrait_golden_elder'
];

export function initUiEdit(scene: Phaser.Scene, customUi: CustomUiManager): void {
  const factory = scene.registry.get('textureFactory') as TextureFactory;
  const post = (msg: Omit<BridgeMsg, '__uib'>): void => {
    if (window.parent !== window) window.parent.postMessage({ __uib: true, ...msg }, '*');
  };

  let editMode = true;
  let selectedId: string | null = null;
  let selectedPart: string | null = null;
  let hoverId: string | null = null;
  /** The component currently on the stage (edit mode shows ONLY this one on a
   *  blank game-sized canvas — never the running game). Saved components sit
   *  at their AUTHORED x/y (canvas position == in-game position); built-ins
   *  are display-centered for editing. */
  let staged: { id: string; origX: number; origY: number; x: number; y: number } | null = null;
  let restageAt = 0; // scene-time to re-place (async rig loads change bounds)
  const peeked = new Map<string, boolean>(); // id -> previous visible

  /* --------------------------- undo / redo --------------------------- */
  // INFINITE history: the whole theme doc is one document, so each operation
  // snapshots it via structuredClone (immutable strings — the big upload data
  // URLs — are shared, not copied, so unbounded history stays cheap).
  const undoStack: UiThemeDoc[] = [];
  const redoStack: UiThemeDoc[] = [];
  let lastSig = '';
  let lastSigAt = 0;
  const postHistory = (): void => post({ type: 'history', undo: undoStack.length, redo: redoStack.length });
  /** Snapshot BEFORE a mutation. Continuous gestures (drags, color sliders)
   *  share a signature and coalesce into one history entry per burst. */
  const remember = (sig: string): void => {
    const now = Date.now();
    if (sig === lastSig && now - lastSigAt < 800) {
      lastSigAt = now;
      return;
    }
    lastSig = sig;
    lastSigAt = now;
    undoStack.push(structuredClone(uiRegistry.doc));
    redoStack.length = 0;
    postHistory();
  };


  /* ------------------------- overlay & stage ------------------------- */

  // The component stage: a quiet, flat Emberkeep-night canvas with the exact
  // game dimensions — the selected component floats centered on it.
  const backdrop = scene.add.graphics().setDepth(-100000).setVisible(true);
  backdrop.fillStyle(Phaser.Display.Color.HexStringToColor(PALETTE.night).color, 1);
  backdrop.fillRect(0, 0, LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT);
  backdrop.fillStyle(0x342832, 1);
  backdrop.fillRect(0, LIVE_GAME_HEIGHT - 6, LIVE_GAME_WIDTH, 6);
  for (let x = 0; x < LIVE_GAME_WIDTH; x += 64) {
    backdrop.lineStyle(1, 0x4a3845, 0.16);
    backdrop.lineBetween(x, 0, x, LIVE_GAME_HEIGHT);
  }
  for (let y = 0; y < LIVE_GAME_HEIGHT; y += 64) {
    backdrop.lineStyle(1, 0x4a3845, 0.16);
    backdrop.lineBetween(0, y, LIVE_GAME_WIDTH, y);
  }

  // Alignment grid: straight verticals/horizontals in GAME units, toggled from
  // the tool's Grid checkbox. Drawn in-canvas so it is exact at any zoom and
  // also covers the isolation stage. Every 4th line is slightly stronger, and
  // the canvas centre lines are gold for quick symmetry checks.
  const grid = scene.add.graphics().setDepth(OVERLAY_DEPTH - 2).setVisible(false);
  const drawGrid = (size: number): void => {
    grid.clear();
    const minor = Math.max(16, size);
    for (let x = 0, i = 0; x <= LIVE_GAME_WIDTH; x += minor, i++) {
      grid.lineStyle(2, 0xffffff, i % 4 === 0 ? 0.18 : 0.08);
      grid.lineBetween(x, 0, x, LIVE_GAME_HEIGHT);
    }
    for (let y = 0, i = 0; y <= LIVE_GAME_HEIGHT; y += minor, i++) {
      grid.lineStyle(2, 0xffffff, i % 4 === 0 ? 0.18 : 0.08);
      grid.lineBetween(0, y, LIVE_GAME_WIDTH, y);
    }
    grid.lineStyle(2, 0xf7a437, 0.4);
    grid.lineBetween(LIVE_GAME_WIDTH / 2, 0, LIVE_GAME_WIDTH / 2, LIVE_GAME_HEIGHT);
    grid.lineBetween(0, LIVE_GAME_HEIGHT / 2, LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT / 2);
  };
  drawGrid(64);

  const overlay = scene.add.graphics().setDepth(OVERLAY_DEPTH);
  // Full-screen zone: in edit mode it swallows every pointer so game buttons
  // don't fire while designing; selection/drag runs on this zone.
  const blocker = scene.add
    .zone(0, 0, LIVE_GAME_WIDTH, LIVE_GAME_HEIGHT)
    .setOrigin(0)
    .setDepth(OVERLAY_DEPTH - 1)
    .setInteractive();

  const boundsOf = (id: string): Phaser.Geom.Rectangle | null => {
    const el = uiRegistry.elements.get(id);
    if (!el || !el.node.scene) return null;
    const b = el.node.getBounds();
    return new Phaser.Geom.Rectangle(b.x, b.y, b.width, b.height);
  };

  const partBoundsOf = (id: string, part: string): Phaser.Geom.Rectangle | null => {
    const info = uiRegistry.describe(id);
    const pb = info?.parts.find((p) => p.name === part)?.bounds;
    return pb ? new Phaser.Geom.Rectangle(pb.x, pb.y, pb.w, pb.h) : null;
  };

  /** Only the staged component is clickable — the stage never shows others. */
  const hitTest = (x: number, y: number): string | null => {
    if (!staged) return null;
    const b = boundsOf(staged.id);
    return b && b.contains(x, y) ? staged.id : null;
  };

  /** Inside a selected element, find the smallest part under the pointer. */
  const hitTestPart = (id: string, x: number, y: number): string | null => {
    const info = uiRegistry.describe(id);
    if (!info) return null;
    let best: string | null = null;
    let bestArea = Infinity;
    for (const p of info.parts) {
      if (!p.bounds) continue;
      const r = new Phaser.Geom.Rectangle(p.bounds.x - 6, p.bounds.y - 6, p.bounds.w + 12, p.bounds.h + 12);
      if (!r.contains(x, y)) continue;
      const area = r.width * r.height;
      if (area < bestArea) {
        bestArea = area;
        best = p.name;
      }
    }
    return best;
  };

  /** Active centring guides while a drag is snapped: game-x of the vertical
   *  line / game-y of the horizontal line (null = not snapped on that axis). */
  const snapGuides: { v: number | null; h: number | null } = { v: null, h: null };

  /** Snap a dragged object's bounds centre to the nearest guide on one axis
   *  (canvas centre + any extra guides, e.g. the component's own axes for
   *  layers). Returns the position correction; records the guide for redraw. */
  const snapAxis = (axis: 'v' | 'h', boundsCentre: number, guides: number[], bypass: boolean): number => {
    snapGuides[axis] = null;
    if (bypass) return 0;
    let best = 0;
    let bestDist = SNAP_RANGE + 1;
    for (const g of guides) {
      const dist = Math.abs(g - boundsCentre);
      if (dist < bestDist) {
        bestDist = dist;
        best = g;
      }
    }
    if (bestDist > SNAP_RANGE) return 0;
    snapGuides[axis] = best;
    return Math.round(best - boundsCentre);
  };

  /** Alt/Option bypasses snapping (precision drags), the industry-standard. */
  const snapBypassed = (pointer: Phaser.Input.Pointer): boolean =>
    (pointer.event as MouseEvent | undefined)?.altKey === true;

  const clearSnapGuides = (): void => {
    snapGuides.v = null;
    snapGuides.h = null;
  };

  const redraw = (): void => {
    overlay.clear();
    if (!editMode) return;
    if (snapGuides.v !== null) {
      overlay.lineStyle(3, SNAP_GUIDE_COLOR, 0.9);
      overlay.lineBetween(snapGuides.v, 0, snapGuides.v, LIVE_GAME_HEIGHT);
    }
    if (snapGuides.h !== null) {
      overlay.lineStyle(3, SNAP_GUIDE_COLOR, 0.9);
      overlay.lineBetween(0, snapGuides.h, LIVE_GAME_WIDTH, snapGuides.h);
    }
    if (hoverId && hoverId !== selectedId) {
      const b = boundsOf(hoverId);
      if (b) {
        overlay.lineStyle(3, 0xffd84d, 0.55);
        overlay.strokeRect(b.x - 4, b.y - 4, b.width + 8, b.height + 8);
      }
    }
    if (selectedId) {
      const b = boundsOf(selectedId);
      if (b) {
        overlay.lineStyle(4, 0x3fa8d9, selectedPart ? 0.45 : 1);
        overlay.strokeRect(b.x - 6, b.y - 6, b.width + 12, b.height + 12);
        if (!selectedPart) {
          overlay.fillStyle(0x3fa8d9, 1);
          for (const [cx, cy] of [
            [b.x - 6, b.y - 6],
            [b.right + 6, b.y - 6],
            [b.x - 6, b.bottom + 6],
            [b.right + 6, b.bottom + 6]
          ]) {
            overlay.fillRect(cx! - 6, cy! - 6, 12, 12);
          }
        }
      }
      if (selectedPart) {
        const pb = partBoundsOf(selectedId, selectedPart);
        if (pb) {
          overlay.lineStyle(4, 0xffd84d, 1);
          overlay.strokeRect(pb.x - 4, pb.y - 4, pb.width + 8, pb.height + 8);
          overlay.fillStyle(0xffd84d, 1);
          for (const [cx, cy] of [
            [pb.x - 4, pb.y - 4],
            [pb.right + 4, pb.y - 4],
            [pb.x - 4, pb.bottom + 4],
            [pb.right + 4, pb.bottom + 4]
          ]) {
            overlay.fillRect(cx! - 5, cy! - 5, 10, 10);
          }
        }
      }
    }
  };
  // Per-frame stage enforcement: siblings stay hidden (UIScene logic keeps
  // re-showing the regen label etc. on its own schedule), the staged node stays
  // pinned to its centered spot (patches/rebuilds reset it to authored coords),
  // and a deferred re-center catches async rig loads growing the bounds.
  scene.events.on(Phaser.Scenes.Events.UPDATE, (t: number) => {
    if (editMode) {
      for (const [eid, el] of uiRegistry.elements) {
        if (eid !== staged?.id && el.node.scene && el.node.visible) el.node.setVisible(false);
      }
      if (staged) {
        const el = uiRegistry.elements.get(staged.id);
        if (el?.node.scene) {
          if (restageAt && t >= restageAt) {
            restageAt = 0;
            placeStaged();
          }
          el.node.setPosition(staged.x, staged.y);
          if (!el.node.visible) el.node.setVisible(true);
        }
      }
    }
    redraw();
  });

  const customIdOf = (id: string | null): string | null =>
    id && id.startsWith('custom.') ? id.slice('custom.'.length) : null;

  const describe = (id: string): (UiElementInfo & { custom?: CustomComponent }) | null => {
    const info = uiRegistry.describe(id);
    if (!info) return null;
    const cid = customIdOf(id);
    return cid ? { ...info, custom: uiRegistry.doc.custom[cid] } : info;
  };

  const announceSelection = (): void =>
    post({ type: 'selected', info: selectedId ? describe(selectedId) : null, part: selectedPart });

  const setPeek = (id: string, on: boolean): void => {
    const el = uiRegistry.elements.get(id);
    if (!el) return;
    if (on) {
      if (!peeked.has(id)) peeked.set(id, el.node.visible);
      el.node.setVisible(true);
      el.opts.onPeek?.(true);
    } else if (peeked.has(id)) {
      el.opts.onPeek?.(false);
      el.node.setVisible(peeked.get(id)!);
      peeked.delete(id);
    }
  };

  /* ------------------------------ stage ------------------------------ */

  /** Compute + apply the stage position for the staged component.
   *  Saved (custom) components are WYSIWYG: the canvas is the game window, so
   *  they sit at their authored x/y — exactly where they appear in-game.
   *  Built-ins are display-centered by their visual bounds (their in-game spot
   *  is code-authored; the centering is editing convenience only). */
  const placeStaged = (): void => {
    if (!staged) return;
    const el = uiRegistry.elements.get(staged.id);
    if (!el?.node.scene) return;
    const cid = customIdOf(staged.id);
    if (cid) {
      const def = uiRegistry.doc.custom[cid];
      staged.x = def?.x ?? staged.origX;
      staged.y = def?.y ?? staged.origY;
    } else {
      const cx = LIVE_GAME_WIDTH / 2;
      const cy = LIVE_GAME_HEIGHT / 2;
      el.node.setPosition(staged.origX, staged.origY); // measure from authored spot
      const b = el.node.getBounds();
      staged.x = staged.origX + (cx - (b.x + b.width / 2));
      staged.y = staged.origY + (cy - (b.y + b.height / 2));
    }
    el.node.setPosition(staged.x, staged.y);
  };

  /** Put a component on the stage (or clear it). Built-in centering is
   *  display-only (authored position preserved); saved components show — and
   *  edit — their real document position. */
  const stage = (id: string | null): void => {
    if (staged) {
      const el = uiRegistry.elements.get(staged.id);
      const cid = customIdOf(staged.id);
      const def = cid ? uiRegistry.doc.custom[cid] : undefined;
      // Saved components go back to their DOCUMENT position (root drags may
      // have moved it); built-ins return to their authored spot.
      el?.node.setPosition(def?.x ?? staged.origX, def?.y ?? staged.origY);
      setPeek(staged.id, false);
      staged = null;
    }
    if (id) {
      const el = uiRegistry.elements.get(id);
      if (!el?.node.scene) return;
      setPeek(id, true); // hidden components get their sample content
      staged = { id, origX: el.node.x, origY: el.node.y, x: el.node.x, y: el.node.y };
      placeStaged();
      restageAt = scene.time.now + 900; // re-place once async art (rigs) lands
    }
  };

  /** Selection == staging: the stage shows exactly the selected component. */
  const select = (id: string | null, part: string | null = null): void => {
    selectedId = id;
    selectedPart = part;
    if (staged?.id !== id) stage(id);
    announceSelection();
  };

  /* ------------------------------ drag ------------------------------- */

  let drag: {
    id: string;
    part: string | null;
    startX: number;
    startY: number;
    dx0: number;
    dy0: number;
  } | null = null;
  /** Corner-resize of a sized image layer (frames): drag any handle; the frame
   *  is centre-anchored, so w/h follow the pointer's distance from the centre. */
  let resize: { id: string; part: string; cx: number; cy: number } | null = null;
  /** Whole-component drag of a SAVED component: edits its authored x/y — the
   *  document's in-game position, not a display offset. */
  let rootDrag: { id: string; cid: string; startX: number; startY: number; x0: number; y0: number } | null = null;

  /** The custom image layer eligible for corner-resize, if selected. */
  const resizableLayer = (): { cid: string; layer: CustomLayer } | null => {
    if (!selectedId || !selectedPart) return null;
    const cid = customIdOf(selectedId);
    if (!cid) return null;
    const layer = uiRegistry.doc.custom[cid]?.layers.find((l) => l.name === selectedPart);
    return layer && layer.kind === 'image' ? { cid, layer } : null;
  };

  const cornerHit = (x: number, y: number): boolean => {
    if (!selectedId || !selectedPart) return false;
    const pb = partBoundsOf(selectedId, selectedPart);
    if (!pb) return false;
    const near = (cx: number, cy: number): boolean => Math.abs(x - cx) <= 18 && Math.abs(y - cy) <= 18;
    return (
      near(pb.x - 4, pb.y - 4) || near(pb.right + 4, pb.y - 4) ||
      near(pb.x - 4, pb.bottom + 4) || near(pb.right + 4, pb.bottom + 4)
    );
  };

  /** Same-origin embedding quirk: window-level listeners inside the iframe
   *  also receive the PARENT page's mousedowns (their target is tool DOM, not
   *  our canvas) — accept only events that genuinely hit the game canvas. */
  const isCanvasEvent = (pointer: Phaser.Input.Pointer): boolean => {
    const target = (pointer.event as Event | undefined)?.target;
    return !target || target === scene.game.canvas;
  };

  blocker.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    if (!editMode || !isCanvasEvent(pointer)) return;
    // Grabbing a corner handle of a sized frame layer starts a RESIZE.
    const rl = resizableLayer();
    if (rl && cornerHit(pointer.x, pointer.y)) {
      const pb = partBoundsOf(selectedId!, selectedPart!)!;
      remember(`resize:${selectedId}:${selectedPart}`);
      resize = { id: selectedId!, part: selectedPart!, cx: pb.centerX, cy: pb.centerY };
      return;
    }
    const id = hitTest(pointer.x, pointer.y);
    if (!id) {
      // Clicking empty stage steps out of the current layer.
      if (selectedPart) {
        selectedPart = null;
        announceSelection();
      }
      return;
    }
    // Click on the staged component drills into its layers. For SAVED
    // components a fresh grab (layer not already selected) drags the WHOLE
    // component — its authored x/y IS its in-game position, so the canvas is
    // the placement tool; drag an already-selected layer to move just it.
    // Built-ins are display-centered, so only their LAYERS drag.
    const part = hitTestPart(id, pointer.x, pointer.y);
    const cid = customIdOf(id);
    const partWasSelected = part !== null && part === selectedPart;
    if (part !== selectedPart) {
      selectedPart = part;
      announceSelection();
    }
    if (cid && !partWasSelected) {
      const def = uiRegistry.doc.custom[cid];
      if (!def) return;
      remember(`dragRoot:${cid}`);
      rootDrag = { id, cid, startX: pointer.x, startY: pointer.y, x0: def.x, y0: def.y };
      return;
    }
    if (!part) return;
    remember(`drag:${id}:${part}`);
    if (cid) {
      const layer = uiRegistry.doc.custom[cid]?.layers.find((l) => l.name === part);
      if (!layer) return;
      drag = { id, part, startX: pointer.x, startY: pointer.y, dx0: layer.x, dy0: layer.y };
    } else {
      const pp = uiRegistry.doc.elements[id]?.parts?.[part] ?? {};
      drag = { id, part, startX: pointer.x, startY: pointer.y, dx0: pp.dx ?? 0, dy0: pp.dy ?? 0 };
    }
  });

  blocker.on('pointermove', (pointer: Phaser.Input.Pointer) => {
    if (!editMode || !isCanvasEvent(pointer)) return;
    if (rootDrag && pointer.isDown) {
      const def = uiRegistry.doc.custom[rootDrag.cid];
      const node = uiRegistry.elements.get(rootDrag.id)?.node;
      if (def && node) {
        def.x = Math.round(rootDrag.x0 + pointer.x - rootDrag.startX);
        def.y = Math.round(rootDrag.y0 + pointer.y - rootDrag.startY);
        // Centring snap: pull the component's VISUAL centre onto the canvas
        // centre lines when close (Alt bypasses); a pink guide shows the lock.
        node.setPosition(def.x, def.y);
        const b = node.getBounds();
        const bypass = snapBypassed(pointer);
        def.x += snapAxis('v', b.centerX, [LIVE_GAME_WIDTH / 2], bypass);
        def.y += snapAxis('h', b.centerY, [LIVE_GAME_HEIGHT / 2], bypass);
        if (staged?.id === rootDrag.id) {
          staged.x = def.x;
          staged.y = def.y;
        }
        node.setPosition(def.x, def.y);
        post({ type: 'changed', info: describe(rootDrag.id), part: selectedPart });
      }
      return;
    }
    if (resize && pointer.isDown) {
      const rl = resizableLayer();
      if (rl) {
        rl.layer.w = Math.max(48, Math.round(Math.abs(pointer.x - resize.cx) * 2));
        rl.layer.h = Math.max(48, Math.round(Math.abs(pointer.y - resize.cy) * 2));
        if (rl.layer.slice === undefined) rl.layer.slice = true;
        const obj = uiRegistry.elements.get(resize.id)?.parts.find((pp) => pp.name === resize!.part)?.obj;
        if (obj instanceof Phaser.GameObjects.NineSlice) obj.setSize(rl.layer.w, rl.layer.h);
        else (obj as Phaser.GameObjects.Image | undefined)?.setDisplaySize?.(rl.layer.w, rl.layer.h);
        post({ type: 'changed', info: describe(resize.id), part: resize.part });
      }
      return;
    }
    if (drag && pointer.isDown) {
      const d = drag;
      if (!d.part) return;
      let dx = Math.round(d.dx0 + pointer.x - d.startX);
      let dy = Math.round(d.dy0 + pointer.y - d.startY);
      const el = uiRegistry.elements.get(d.id);
      const obj = el?.parts.find((pp) => pp.name === d.part)?.obj;
      const boundsOfObj = (): Phaser.Geom.Rectangle | undefined =>
        (obj as unknown as { getBounds?: () => Phaser.Geom.Rectangle } | undefined)?.getBounds?.();
      const bypass = snapBypassed(pointer);
      const scale = el?.node.scaleX || 1; // world→local for the snap correction
      const cid = customIdOf(d.id);
      if (cid) {
        // Custom components: authored layer coordinates ARE the document.
        const layer = uiRegistry.doc.custom[cid]?.layers.find((l) => l.name === d.part);
        if (layer && el) {
          obj?.setPosition?.(dx, dy);
          // Centring snap: canvas centre lines, plus the component's own axes
          // (centre a layer inside its frame). Alt bypasses.
          const gb = boundsOfObj();
          if (gb) {
            dx += Math.round(snapAxis('v', gb.centerX, [LIVE_GAME_WIDTH / 2, el.node.x], bypass) / scale);
            dy += Math.round(snapAxis('h', gb.centerY, [LIVE_GAME_HEIGHT / 2, el.node.y], bypass) / scale);
          }
          layer.x = dx;
          layer.y = dy;
          obj?.setPosition?.(dx, dy);
        }
      } else {
        uiRegistry.setPatch(d.id, { parts: { [d.part]: { dx, dy } } });
        // Built-in parts snap to the canvas centre lines the same way.
        const gb = boundsOfObj();
        if (gb) {
          const cdx = Math.round(snapAxis('v', gb.centerX, [LIVE_GAME_WIDTH / 2], bypass) / scale);
          const cdy = Math.round(snapAxis('h', gb.centerY, [LIVE_GAME_HEIGHT / 2], bypass) / scale);
          if (cdx || cdy) {
            dx += cdx;
            dy += cdy;
            uiRegistry.setPatch(d.id, { parts: { [d.part]: { dx, dy } } });
          }
        }
      }
      post({ type: 'changed', info: describe(d.id), part: d.part });
      return;
    }
    const id = hitTest(pointer.x, pointer.y);
    if (id !== hoverId) {
      hoverId = id;
      post({ type: 'hover', id });
    }
  });

  const endDrag = (): void => {
    if (rootDrag) post({ type: 'changed', info: describe(rootDrag.id), part: selectedPart });
    if (drag) post({ type: 'changed', info: describe(drag.id), part: drag.part });
    if (resize) {
      // A NineSlice may need a proper rebuild (e.g. plain image grew a size).
      const cid = customIdOf(resize.id);
      if (cid) customUi.build(cid);
      if (staged?.id === resize.id) stage(resize.id);
      post({ type: 'changed', info: describe(resize.id), part: resize.part });
    }
    drag = null;
    resize = null;
    rootDrag = null;
    clearSnapGuides();
  };
  blocker.on('pointerup', endDrag);
  blocker.on('pointerupoutside', endDrag);

  // Arrow-key nudging of the selected LAYER (Shift = 10px); Esc steps out.
  scene.input.keyboard?.on('keydown', (ev: KeyboardEvent) => {
    if (!editMode) return;
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) redo();
      else undo();
      return;
    }
    if (ev.key === 'Escape') {
      if (selectedPart) select(selectedId, null);
      else select(null);
      return;
    }
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      // Delete the selected layer: custom layers are removed outright;
      // built-in parts are code-authored, so "delete" hides them (Reset
      // element brings them back).
      if (!selectedId || !selectedPart) return;
      ev.preventDefault();
      const delCid = customIdOf(selectedId);
      if (delCid) {
        const def = uiRegistry.doc.custom[delCid];
        if (!def) return;
        remember(`removeLayer:${delCid}:${selectedPart}`);
        def.layers = def.layers.filter((l) => l.name !== selectedPart);
        customUi.build(delCid);
        if (staged?.id === selectedId) stage(selectedId);
      } else {
        remember(`hidePart:${selectedId}:${selectedPart}`);
        uiRegistry.setPatch(selectedId, { parts: { [selectedPart]: { visible: false } } });
      }
      selectedPart = null;
      announceSelection();
      post({ type: 'changed', info: describe(selectedId), part: null });
      return;
    }
    if (!selectedId) return;
    const step = ev.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    };
    const move = moves[ev.key];
    if (!move) return;
    ev.preventDefault();
    const cid = customIdOf(selectedId);
    if (!selectedPart) {
      // Component-level nudge: only saved components have an authored root
      // position (built-ins are display-centered — nothing meaningful to move).
      const def = cid ? uiRegistry.doc.custom[cid] : undefined;
      if (!cid || !def) return;
      remember(`nudgeRoot:${cid}`);
      def.x += move[0];
      def.y += move[1];
      if (staged?.id === selectedId) {
        staged.x = def.x;
        staged.y = def.y;
      }
      uiRegistry.elements.get(selectedId)?.node.setPosition(def.x, def.y);
      post({ type: 'changed', info: describe(selectedId), part: null });
      return;
    }
    remember(`nudge:${selectedId}:${selectedPart}`);
    if (cid) {
      const layer = uiRegistry.doc.custom[cid]?.layers.find((l) => l.name === selectedPart);
      if (!layer) return;
      layer.x += move[0];
      layer.y += move[1];
      const obj = uiRegistry.elements.get(selectedId)?.parts.find((pp) => pp.name === selectedPart)?.obj;
      obj?.setPosition?.(layer.x, layer.y);
    } else {
      const pp = uiRegistry.doc.elements[selectedId]?.parts?.[selectedPart] ?? {};
      uiRegistry.setPatch(selectedId, {
        parts: { [selectedPart]: { dx: (pp.dx ?? 0) + move[0], dy: (pp.dy ?? 0) + move[1] } }
      });
    }
    post({ type: 'changed', info: describe(selectedId), part: selectedPart });
  });

  /** Re-materialise EVERYTHING from a restored doc: chrome colors, art
   *  replacements, custom components, element patches, staging, inventory. */
  const restore = (doc: UiThemeDoc): void => {
    uiRegistry.doc = sanitizeThemeDoc(doc);
    factory.setUiColors(uiRegistry.doc.textures);
    for (const key of Object.keys(UI_TEXTURE_PARAMS)) factory.regenerate(key);
    for (const key of ICON_KEYS) factory.regenerate(key); // no-op for file art
    applyUiReplacements(scene);
    // Re-materialise sequence frame textures the restored doc references.
    for (const [name, seq] of Object.entries(uiRegistry.doc.sequences)) ensureSequenceTextures(scene, name, seq.frames);
    customUi.syncAll();
    for (const id of [...uiRegistry.elements.keys()]) uiRegistry.applyElement(id);
    lastSig = ''; // a restore breaks gesture coalescing
    if (selectedId && !uiRegistry.elements.get(selectedId)) {
      selectedId = null;
      selectedPart = null;
    }
    stage(selectedId); // re-stage (custom nodes were rebuilt)
    sendInventory();
    announceSelection();
    postHistory();
  };

  const undo = (): void => {
    const prev = undoStack.pop();
    if (!prev) return;
    redoStack.push(structuredClone(uiRegistry.doc));
    restore(prev);
  };

  const redo = (): void => {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(structuredClone(uiRegistry.doc));
    restore(next);
  };

  /* --------------------------- inventory ----------------------------- */

  const thumb = (key: string): string | null => {
    try {
      return scene.textures.exists(key) ? scene.game.textures.getBase64(key) : null;
    } catch {
      return null;
    }
  };

  const chromeList = (): unknown[] =>
    Object.entries(UI_TEXTURE_PARAMS).map(([key, defaults]) => ({
      key,
      defaults,
      params: uiRegistry.doc.textures[key] ?? {},
      replaced: uiRegistry.doc.replacements[key]?.src ?? null,
      thumb: thumb(key)
    }));

  const sendInventory = (): void => {
    post({
      type: 'inventory',
      elements: uiRegistry.describeAll(),
      palette: PALETTE,
      fonts: FONT_PRESETS,
      chrome: chromeList(),
      icons: ICON_KEYS.map((key) => ({
        key,
        thumb: thumb(key),
        replaced: uiRegistry.doc.replacements[key]?.src ?? null,
        anchor: uiRegistry.doc.replacements[key]
          ? [uiRegistry.doc.replacements[key]!.anchorX, uiRegistry.doc.replacements[key]!.anchorY]
          : null
      })).filter((i) => i.thumb),
      uploads: Object.keys(uiRegistry.doc.assets).map((name) => ({ name, thumb: thumb(uploadKey(name)) })),
      sequences: [
        // Preloaded (built-in) character banks first — always present, no upload.
        ...BUILTIN_SEQUENCES.map((s) => ({
          name: s.key,
          label: s.label,
          frameCount: s.count + 1, // + trailing idle
          fps: 12,
          loop: s.loop,
          builtin: true,
          thumb: thumb(sequenceFrameKey(s.key, 0))
        })),
        ...Object.entries(uiRegistry.doc.sequences).map(([name, seq]) => ({
          name,
          label: name,
          frameCount: seq.frames.length,
          fps: seq.fps ?? null,
          loop: true,
          builtin: false,
          thumb: thumb(sequenceFrameKey(name, 0))
        }))
      ],
      history: { undo: undoStack.length, redo: redoStack.length },
      characters: Object.entries(CHARACTER_RIGS).map(([id, c]) => ({
        id,
        label: c.label,
        thumb: thumb(c.thumbTexture),
        bodies: bodyMotions(),
        faces: faceMotions(id)
      })),
      doc: uiRegistry.exportDoc()
    });
  };

  /* ----------------------- drag-drop from the rail ------------------- */

  const uniqueCustomId = (): string => {
    let n = 1;
    while (uiRegistry.doc.custom[`component${n}`]) n++;
    return `component${n}`;
  };

  /** Turn a dragged rail item into a new custom LAYER spec (position filled in
   *  by the drop handler). Mirrors the double-click "+ …" defaults. */
  const layerFromPayload = (payload: { kind: string; id?: string; name?: string; key?: string; loop?: boolean }): CustomLayer | null => {
    switch (payload.kind) {
      case 'character':
        return {
          kind: 'rig', name: '', x: 0, y: 0, scale: 0.35,
          character: payload.id ?? 'dragon-red', body: 'idle',
          face: faceMotions(payload.id ?? 'dragon-red').includes('blink') ? 'blink' : 'none',
          facing: 'left'
        };
      case 'sequence':
        // Built-in banks end on an idle; default loop:false so they play
        // through once and rest there. The payload carries the sequence default.
        return { kind: 'anim', name: '', x: 0, y: 0, scale: 1, sequence: payload.name, loop: payload.loop !== false };
      case 'upload':
        return { kind: 'image', name: '', x: 0, y: 0, scale: 1, texture: uploadKey(payload.name ?? '') };
      case 'texture':
        return { kind: 'image', name: '', x: 0, y: 0, scale: 1, texture: payload.key };
      default:
        return null;
    }
  };

  type DropPayload = { kind: string; id?: string; name?: string; key?: string; loop?: boolean };

  /** Short feedback line shown in the tool's status bar. */
  const note = (text: string): void => post({ type: 'note', text });

  /** Replace the layer at `index` of a custom component with a rail payload —
   *  same slot (name/position/order) and same on-screen FOOTPRINT: explicit
   *  w/h carries over between images; otherwise the new art is contain-fit to
   *  the old layer's display size (a talk bank dropped on an icon stays
   *  icon-sized instead of landing at native resolution). */
  const replaceCustomLayer = (cid: string, index: number, payload: DropPayload): CustomLayer | null => {
    const def = uiRegistry.doc.custom[cid];
    const old = def?.layers[index];
    const next = layerFromPayload(payload);
    if (!def || !old || !next) return null;
    next.name = old.name;
    next.x = old.x;
    next.y = old.y;
    if (next.kind === 'image' && old.kind === 'image' && old.w && old.h) {
      next.w = old.w;
      next.h = old.h;
      if (old.slice !== undefined) next.slice = old.slice;
    } else {
      const obj = uiRegistry.elements.get(`custom.${cid}`)?.parts.find((pp) => pp.name === old.name)?.obj as
        | { displayWidth?: number; displayHeight?: number }
        | undefined;
      const oldW = obj?.displayWidth ?? 0;
      const oldH = obj?.displayHeight ?? 0;
      const texKey = next.kind === 'anim' ? sequenceFrameKey(next.sequence ?? '', 0) : next.texture;
      if (oldW && oldH && texKey && scene.textures.exists(texKey)) {
        const src = scene.textures.get(texKey).getSourceImage() as { width: number; height: number };
        if (src.width && src.height) next.scale = +Math.min(oldW / src.width, oldH / src.height).toFixed(3);
      }
    }
    def.layers[index] = next;
    return next;
  };

  /** Apply a rail payload to a BUILT-IN element's image part: sequences attach
   *  as an animated part patch (contain-fit by the PartAnimator); textures and
   *  uploads swap the part texture. Characters can't live on built-in parts. */
  const applyPayloadToBuiltinPart = (id: string, partName: string, payload: DropPayload): boolean => {
    const part = uiRegistry.elements.get(id)?.parts.find((pp) => pp.name === partName);
    if (!part || part.kind !== 'image') {
      note(`"${partName}" isn't an image layer — drop on an image layer instead`);
      return false;
    }
    if (payload.kind === 'sequence') {
      remember(`part:replace:${id}:${partName}`);
      uiRegistry.setPatch(id, { parts: { [partName]: { sequence: payload.name, loop: payload.loop } } });
      return true;
    }
    if (payload.kind === 'texture' || payload.kind === 'upload') {
      remember(`part:replace:${id}:${partName}`);
      const key = payload.kind === 'upload' ? uploadKey(payload.name ?? '') : payload.key ?? '';
      uiRegistry.setPatch(id, { parts: { [partName]: { texture: key, sequence: null } } });
      return true;
    }
    note('characters need a custom component — create one with ＋ New, then drop the character there');
    return false;
  };

  /* --------------------------- message loop -------------------------- */

  window.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data as BridgeMsg;
    if (!msg || msg.__uib !== true) return;
    switch (msg.type) {
      case 'hello':
        sendInventory();
        break;
      case 'select':
      case 'isolate': // legacy alias — staging IS selection now
        select((msg.id as string) ?? null, (msg.part as string) ?? null);
        break;
      case 'patch': {
        const id = msg.id as string;
        remember(`patch:${id}:${JSON.stringify(Object.keys(msg.patch ?? {}))}`);
        uiRegistry.setPatch(id, msg.patch as UiElementPatch);
        post({ type: 'changed', info: describe(id), part: selectedPart });
        break;
      }
      case 'resetElement': {
        const id = msg.id as string;
        remember(`resetElement:${id}:x`);
        uiRegistry.resetElement(id);
        post({ type: 'changed', info: describe(id), part: null });
        break;
      }
      case 'texture': {
        const key = msg.key as string;
        remember(`texture:${key}:${JSON.stringify(Object.keys(msg.params ?? {}))}`);
        uiRegistry.doc.textures[key] = {
          ...(uiRegistry.doc.textures[key] ?? {}),
          ...(msg.params as Record<string, string>)
        };
        factory.setUiColors(uiRegistry.doc.textures);
        factory.regenerate(key);
        const rep = uiRegistry.doc.replacements[key];
        if (rep) repaintTextureWith(scene, key, uploadKey(rep.src));
        post({ type: 'textureUpdated', key, thumb: thumb(key), params: uiRegistry.doc.textures[key] });
        break;
      }
      case 'resetTexture': {
        const key = msg.key as string;
        remember(`resetTexture:${key}:x`);
        delete uiRegistry.doc.textures[key];
        factory.setUiColors(uiRegistry.doc.textures);
        factory.regenerate(key);
        post({ type: 'textureUpdated', key, thumb: thumb(key), params: {} });
        break;
      }
      case 'peek':
        setPeek(msg.id as string, msg.on === true);
        break;
      case 'custom:create': {
        const cid = String(msg.id ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
        if (!cid || uiRegistry.doc.custom[cid]) break;
        remember(`custom:create:${cid}`);
        uiRegistry.doc.custom[cid] = {
          label: String(msg.label ?? cid),
          x: LIVE_GAME_WIDTH / 2,
          y: LIVE_GAME_HEIGHT / 2,
          layers: []
        };
        customUi.build(cid);
        sendInventory();
        select(`custom.${cid}`); // new components land centered on the stage
        break;
      }
      case 'custom:remove': {
        const cid = customIdOf(msg.id as string);
        if (!cid) break;
        remember(`custom:remove:${cid}`);
        customUi.destroyComponent(cid);
        delete uiRegistry.doc.custom[cid];
        if (selectedId === msg.id) select(null);
        sendInventory();
        announceSelection();
        break;
      }
      case 'custom:update': {
        // Root-level props (x, y, scale, depth, visible, label).
        const cid = customIdOf(msg.id as string);
        const def = cid ? uiRegistry.doc.custom[cid] : undefined;
        if (!cid || !def) break;
        remember(`custom:update:${cid}:${JSON.stringify(Object.keys(msg.props ?? {}))}`);
        Object.assign(def, msg.props as Partial<CustomComponent>);
        customUi.build(cid);
        if (staged?.id === msg.id) stage(msg.id as string);
        post({ type: 'changed', info: describe(msg.id as string), part: selectedPart });
        break;
      }
      case 'custom:addLayer': {
        const cid = customIdOf(msg.id as string);
        const def = cid ? uiRegistry.doc.custom[cid] : undefined;
        if (!cid || !def) break;
        remember(`custom:addLayer:${cid}`);
        const layer = msg.layer as CustomLayer;
        let n = def.layers.length + 1;
        while (def.layers.some((l) => l.name === `${layer.kind}${n}`)) n++;
        layer.name = `${layer.kind}${n}`;
        def.layers.push(layer);
        customUi.build(cid);
        if (staged?.id === msg.id) stage(msg.id as string);
        selectedPart = layer.name;
        post({ type: 'changed', info: describe(msg.id as string), part: selectedPart });
        break;
      }
      case 'custom:updateLayer': {
        const cid = customIdOf(msg.id as string);
        const def = cid ? uiRegistry.doc.custom[cid] : undefined;
        const layer = def?.layers.find((l) => l.name === msg.name);
        if (!cid || !def || !layer) break;
        remember(`custom:updateLayer:${cid}:${String(msg.name)}:${JSON.stringify(Object.keys(msg.props ?? {}))}`);
        Object.assign(layer, msg.props as Partial<CustomLayer>);
        customUi.build(cid);
        if (staged?.id === msg.id) stage(msg.id as string);
        post({ type: 'changed', info: describe(msg.id as string), part: layer.name });
        break;
      }
      case 'custom:removeLayer': {
        const cid = customIdOf(msg.id as string);
        const def = cid ? uiRegistry.doc.custom[cid] : undefined;
        if (!cid || !def) break;
        remember(`custom:removeLayer:${cid}:${String(msg.name)}`);
        def.layers = def.layers.filter((l) => l.name !== msg.name);
        customUi.build(cid);
        if (staged?.id === msg.id) stage(msg.id as string);
        if (selectedPart === msg.name) selectedPart = null;
        post({ type: 'changed', info: describe(msg.id as string), part: selectedPart });
        break;
      }
      case 'custom:moveLayer': {
        const cid = customIdOf(msg.id as string);
        const def = cid ? uiRegistry.doc.custom[cid] : undefined;
        if (!cid || !def) break;
        remember(`custom:moveLayer:${cid}:${String(msg.name)}`);
        const i = def.layers.findIndex((l) => l.name === msg.name);
        const j = i + (msg.dir === 'up' ? 1 : -1);
        if (i < 0 || j < 0 || j >= def.layers.length) break;
        const tmp = def.layers[i]!;
        def.layers[i] = def.layers[j]!;
        def.layers[j] = tmp;
        customUi.build(cid);
        if (staged?.id === msg.id) stage(msg.id as string);
        post({ type: 'changed', info: describe(msg.id as string), part: selectedPart });
        break;
      }
      case 'asset:add': {
        const name = String(msg.name ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
        const dataUrl = String(msg.dataUrl ?? '');
        if (!name || !dataUrl.startsWith('data:image/')) break;
        const key = uploadKey(name);
        const finish = (): void => {
          remember(`asset:add:${name}`);
          uiRegistry.doc.assets[name] = dataUrl;
          post({ type: 'assetAdded', name, thumb: thumb(key) });
        };
        if (scene.textures.exists(key)) {
          finish();
        } else {
          scene.textures.once(Phaser.Textures.Events.ADD_KEY + key, finish);
          scene.textures.addBase64(key, dataUrl);
        }
        break;
      }
      case 'sequence:add': {
        // A whole PNG-sequence animation (talk / idle character bank). Frames
        // arrive as data URLs; store the sequence and pre-load frame 0's
        // texture so the first anim layer shows immediately.
        const name = String(msg.name ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
        const seq = msg.sequence as UiSequence | undefined;
        if (!name || !seq || !Array.isArray(seq.frames) || !seq.frames.length) break;
        remember(`sequence:add:${name}`);
        uiRegistry.doc.sequences[name] = seq;
        const keys = ensureSequenceTextures(scene, name, seq.frames);
        const announce = (): void =>
          post({ type: 'sequenceAdded', name, frameCount: seq.frames.length, thumb: thumb(keys[0]!) });
        if (scene.textures.exists(keys[0]!)) announce();
        else scene.textures.once(Phaser.Textures.Events.ADD_KEY + keys[0]!, announce);
        break;
      }
      case 'replace': {
        // Re-skin a GENERATED texture with an upload — in place, same key, so
        // every consumer updates and no event/interaction is ever touched.
        const key = msg.key as string;
        const src = (msg.src as string | null) ?? null;
        remember(`replace:${key}:${src ?? 'none'}`);
        if (!src) {
          delete uiRegistry.doc.replacements[key];
          factory.regenerate(key); // back to the authored painter (+ colors)
        } else {
          uiRegistry.doc.replacements[key] = {
            src,
            anchorX: typeof msg.anchorX === 'number' ? (msg.anchorX as number) : undefined,
            anchorY: typeof msg.anchorY === 'number' ? (msg.anchorY as number) : undefined
          };
          repaintTextureWith(scene, key, uploadKey(src));
        }
        post({
          type: 'textureUpdated',
          key,
          thumb: thumb(key),
          params: uiRegistry.doc.textures[key] ?? {},
          replaced: uiRegistry.doc.replacements[key]?.src ?? null
        });
        break;
      }
      case 'canvas:drop': {
        // A rail item dropped on the canvas. Routing:
        //  · BUILT-IN element staged → replace the LAYER under the pointer
        //    (else the selected layer). The stage never switches — dropping the
        //    talk bank on the bubble animates its portrait, everything else
        //    stays put.
        //  · custom component staged → drop ON a layer replaces it (footprint
        //    kept), empty space ADDS a layer at the drop point.
        //  · nothing staged → a new component is created at the drop point.
        const payload = msg.payload as DropPayload | undefined;
        if (!payload) break;
        const gx = Math.round(Number(msg.x) || 0);
        const gy = Math.round(Number(msg.y) || 0);
        let cid = customIdOf(selectedId);
        if (selectedId && !cid) {
          // Built-in staged: act ON it, never bury it under a new component.
          const target = hitTestPart(selectedId, gx, gy) ?? selectedPart;
          if (!target) {
            note('drop it on a layer (or select one first) to replace that layer');
            break;
          }
          if (applyPayloadToBuiltinPart(selectedId, target, payload)) {
            selectedPart = target;
            announceSelection();
            post({ type: 'changed', info: describe(selectedId), part: selectedPart });
          }
          break;
        }
        const layer = layerFromPayload(payload);
        if (!layer) break;
        const created = !cid;
        if (!cid) {
          cid = uniqueCustomId();
          remember(`canvas:drop:new:${cid}`);
          uiRegistry.doc.custom[cid] = { label: cid, x: gx, y: gy, layers: [] };
        } else {
          remember(`canvas:drop:${cid}`);
        }
        const def = uiRegistry.doc.custom[cid]!;
        const overPart = created ? null : hitTestPart(`custom.${cid}`, gx, gy);
        let placed: CustomLayer | null = layer;
        if (overPart) {
          const i = def.layers.findIndex((l) => l.name === overPart);
          placed = i >= 0 ? replaceCustomLayer(cid, i, payload) : null;
        } else {
          layer.x = Math.round(gx - def.x);
          layer.y = Math.round(gy - def.y);
          let n = def.layers.length + 1;
          while (def.layers.some((l) => l.name === `${layer.kind}${n}`)) n++;
          layer.name = `${layer.kind}${n}`;
          def.layers.push(layer);
        }
        if (!placed) break;
        customUi.build(cid);
        selectedId = `custom.${cid}`;
        selectedPart = placed.name;
        if (created || staged?.id !== selectedId) stage(selectedId);
        if (created) sendInventory();
        announceSelection();
        post({ type: 'changed', info: describe(selectedId), part: selectedPart });
        break;
      }
      case 'layer:drop': {
        // A rail item dropped on a LAYER ROW in the tool's panel — precise
        // replace, no hit-testing.
        const payload = msg.payload as DropPayload | undefined;
        const id = msg.id as string;
        const name = msg.part as string;
        if (!payload || !id || !name) break;
        const cid = customIdOf(id);
        if (!cid) {
          if (applyPayloadToBuiltinPart(id, name, payload)) {
            selectedPart = name;
            announceSelection();
            post({ type: 'changed', info: describe(id), part: name });
          }
          break;
        }
        const def = uiRegistry.doc.custom[cid];
        const i = def?.layers.findIndex((l) => l.name === name) ?? -1;
        if (!def || i < 0) break;
        remember(`layer:drop:${cid}:${name}`);
        const placed = replaceCustomLayer(cid, i, payload);
        if (!placed) break;
        customUi.build(cid);
        if (staged?.id === id) stage(id);
        selectedPart = placed.name;
        announceSelection();
        post({ type: 'changed', info: describe(id), part: placed.name });
        break;
      }
      case 'custom:reorderLayer': {
        // Drag-reorder in the panel: move a layer to an exact index. The array
        // IS the z hierarchy (bottom → top) — customUi re-stacks on rebuild.
        const cid = customIdOf(msg.id as string);
        const def = cid ? uiRegistry.doc.custom[cid] : undefined;
        if (!cid || !def) break;
        const from = def.layers.findIndex((l) => l.name === msg.name);
        const to = Math.max(0, Math.min(def.layers.length - 1, Math.round(Number(msg.index) || 0)));
        if (from < 0 || from === to) break;
        remember(`custom:reorderLayer:${cid}:${String(msg.name)}`);
        const [moved] = def.layers.splice(from, 1);
        def.layers.splice(to, 0, moved!);
        customUi.build(cid);
        if (staged?.id === msg.id) stage(msg.id as string);
        post({ type: 'changed', info: describe(msg.id as string), part: selectedPart });
        break;
      }
      case 'grid':
        if (typeof msg.size === 'number' && msg.size > 0) drawGrid(msg.size as number);
        grid.setVisible(msg.on === true);
        break;
      case 'undo':
        undo();
        break;
      case 'redo':
        redo();
        break;
      case 'getDoc':
        post({ type: 'doc', doc: uiRegistry.exportDoc() });
        break;
    }
  });

  // Re-outline + notify when patches land from either side.
  uiRegistry.onChanged = () => redraw();

  // Trackpad navigation happens over the CANVAS (this iframe), so capture the
  // wheel stream here and forward it: two-finger scroll = pan, pinch (wheel
  // with ctrl/meta on macOS) = zoom — the tool applies the view transform.
  window.addEventListener(
    'wheel',
    (ev: WheelEvent) => {
      ev.preventDefault();
      post({
        type: 'nav',
        pinch: ev.ctrlKey || ev.metaKey,
        dx: ev.deltaX,
        dy: ev.deltaY,
        x: ev.clientX,
        y: ev.clientY
      });
    },
    { passive: false }
  );

  post({ type: 'ready' });
  sendInventory();
}
