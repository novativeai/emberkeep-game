import '@fortawesome/fontawesome-free/css/all.min.css';
import Phaser from 'phaser';
import { AudioManager } from './audio/AudioManager';
import { GameContext } from './core/Context';
import { GAME_WIDTH, IS_MOBILE, LIVE_GAME_HEIGHT, SAVE_KEY, SCENES } from './core/Constants';
import { createGameConfig } from './core/GameConfig';
import { MapEditor } from './editor/mapEditor';
import { gridToWorld } from './core/iso';
import { msUntilPhase } from './core/dayCycle';
import { printSaveAudit, type SaveAudit } from './core/saveAudit';
import { editorStore } from './editor/editorStore';
import type { DayPhase } from './core/types';

interface BoardCellText {
  chain?: string;
  tier?: number;
  ready?: boolean;
  decor?: string;
  fog?: string;
}

interface RenderedGame {
  scene: string;
  fps: number;
  tutorial: { step: string; index: number; total: number; done: boolean };
  energy: { current: number; max: number };
  /** The four-phase day (morning · day · dusk · night, 8 min each). */
  day: { phase: DayPhase; index: number; remainingMs: number };
  coins: number;
  keys: number;
  xp: number;
  level: number;
  order: {
    id: string;
    title: string;
    have: number[];
    need: number[];
    deliverable: boolean;
  } | null;
  completedOrders: string[];
  regions: Record<string, string>;
  board: (BoardCellText | null)[][];
  inventory: Record<string, number>;
}

declare global {
  interface Window {
    render_game_to_text: () => RenderedGame;
    advanceTime: (ms: number) => { now: number; offset: number };
    __emberkeep: {
      gridToPage: (col: number, row: number) => { x: number; y: number };
      itemToPage: (col: number, row: number) => { x: number; y: number };
      centerCell: (col: number, row: number) => void;
      grantXp: (xp: number) => void;
      /** Jump the virtual clock to the next `phase` of the four-phase day. */
      advanceToPhase: (phase: DayPhase) => { now: number; offset: number; phase: DayPhase };
      /** Save-integrity report: every world's board measured against the ground it
       *  actually offers. Prints a table and returns the raw findings. */
      audit: () => SaveAudit;
      reset: () => void;
      saveKey: string;
      game: Phaser.Game;
    };
    webkitAudioContext?: typeof AudioContext;
  }
}

if (IS_MOBILE && 'orientation' in screen) {
  // The game is portrait on mobile; best-effort lock (iOS ignores it — the
  // #rotate-hint overlay in index.html covers the landscape-held case).
  (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })
    .lock?.('portrait')
    ?.catch(() => {});
}

const ctx = new GameContext(window.localStorage);
// The UI Builder's editor document (?uiedit=1) is a silent canvas — no audio
// engine exists there at all: no music loop, no SFX subscriptions, nothing to
// unlock. Only the real game gets an AudioManager.
const uiEditMode = new URLSearchParams(window.location.search).has('uiedit');
const audio = uiEditMode ? null : new AudioManager(ctx.bus);

const game = new Phaser.Game({
  ...createGameConfig('game'),
  callbacks: {
    preBoot: (bootingGame) => {
      bootingGame.registry.set('ctx', ctx);
    },
    postBoot: () => {
      document.getElementById('boot-note')?.remove();
    }
  }
});

// In-game Map Editor (dev level tool) — opened from Settings via `editor:open`.
new MapEditor(game, ctx);

// GPU safety net: a weak or overloaded device can drop the WebGL context. Without
// preventDefault() the browser permanently kills the canvas — the visible "crash".
// With it, we pause and reload from the autosave (the player loses nothing) — a
// graceful recovery instead of a frozen/blank tab. A per-session counter stops a
// fundamentally-too-weak device from reload-looping: after a few losses we show a
// static message instead.
let contextLostHandled = false;
game.canvas.addEventListener(
  'webglcontextlost',
  (e: Event) => {
    e.preventDefault();
    if (contextLostHandled) return;
    contextLostHandled = true;
    const KEY = 'ek_ctxloss_reloads';
    const n = Number(window.sessionStorage.getItem(KEY) ?? '0');
    if (n >= 2) {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div class="boot-note">Graphics ran out of memory on this device — close other apps/tabs and reload.</div>'
      );
      return;
    }
    window.sessionStorage.setItem(KEY, String(n + 1));
    window.setTimeout(() => window.location.reload(), 1200);
  },
  false
);

// WebAudio unlock must come from a user gesture; resume on any pointer.
if (audio) document.addEventListener('pointerdown', () => audio.unlock());

/* ------------------- agent instrumentation (spec §5) ------------------ */

window.advanceTime = (ms: number) => {
  ctx.clock.advance(ms);
  ctx.bus.emit('time:advanced', { ms });
  return { now: ctx.clock.now(), offset: ctx.clock.offset };
};

window.render_game_to_text = (): RenderedGame => {
  const state = ctx.state;
  const now = ctx.clock.now();
  const activeScenes = game.scene.getScenes(true).map((s) => s.scene.key);
  const scene =
    [SCENES.board, SCENES.title, SCENES.preload, SCENES.boot].find((key) =>
      activeScenes.includes(key)
    ) ?? activeScenes[0] ?? 'none';

  const board: (BoardCellText | null)[][] = [];
  for (let row = 0; row < state.rows; row++) {
    const cells: (BoardCellText | null)[] = [];
    for (let col = 0; col < state.cols; col++) {
      const regionStatus = state.regionStatusAt(col, row);
      if (regionStatus !== 'active') {
        cells.push({ fog: state.regionIdAt(col, row) ?? 'void' });
        continue;
      }
      const item = state.itemAt(col, row);
      if (!item) {
        cells.push(null);
      } else if (item.kind === 'decor') {
        cells.push({ decor: item.chain });
      } else {
        const cell: BoardCellText = { chain: item.chain, tier: item.tier };
        if (item.readyAt !== undefined) cell.ready = now >= item.readyAt;
        cells.push(cell);
      }
    }
    board.push(cells);
  }

  const inventory: Record<string, number> = {};
  for (const item of state.items.values()) {
    if (item.kind !== 'item') continue;
    const key = `${item.chain}:${item.tier}`;
    inventory[key] = (inventory[key] ?? 0) + 1;
  }

  const activeOrder = ctx.systems.order.activeOrder;
  const progress = activeOrder ? ctx.systems.order.progressFor(activeOrder) : null;

  const tutorialStep = ctx.systems.tutorial.currentStep;

  return {
    scene,
    fps: Math.round(game.loop.actualFps),
    tutorial: {
      step: state.tutorialDone ? 'done' : tutorialStep?.id ?? 'none',
      index: state.tutorialIndex,
      total: ctx.data.tutorial.steps.length,
      done: state.tutorialDone
    },
    energy: { current: state.energyCurrent, max: state.energyMax },
    day: {
      phase: ctx.systems.day.phase,
      index: ctx.systems.day.index,
      remainingMs: ctx.systems.day.remainingMs
    },
    coins: state.coins,
    keys: state.keys,
    xp: state.xp,
    level: state.level,
    order:
      activeOrder && progress
        ? {
            id: activeOrder.id,
            title: activeOrder.title,
            have: progress.have,
            need: progress.need,
            deliverable: progress.deliverable
          }
        : null,
    completedOrders: [...state.completedOrderIds],
    regions: Object.fromEntries(state.regionStatus),
    board,
    inventory
  };
};

/** Map a BOARD-world point to page (CSS) coordinates through the board camera
 *  (which pans/zooms across the big map), wherever it currently sits. */
const worldToPage = (world: { x: number; y: number }): { x: number; y: number } => {
  const rect = game.canvas.getBoundingClientRect();
  const board = game.scene.getScene(SCENES.board) as Phaser.Scene | undefined;
  const view = board?.cameras?.main?.worldView;
  if (view && view.width > 0 && view.height > 0) {
    return {
      x: rect.left + ((world.x - view.x) / view.width) * rect.width,
      y: rect.top + ((world.y - view.y) / view.height) * rect.height
    };
  }
  return {
    x: rect.left + (world.x / GAME_WIDTH) * rect.width,
    y: rect.top + (world.y / LIVE_GAME_HEIGHT) * rect.height
  };
};

window.__emberkeep = {
  saveKey: SAVE_KEY,
  game,
  // Test/diagnostic: award XP so a level-up (and its camera fly) can be driven
  // deterministically without grinding merges.
  grantXp: (xp: number) => ctx.bus.emit('economy:add', { xp, reason: 'debug:grantXp' }),
  // Test/diagnostic: fast-forward to a day phase (0 ms when already in it), so a
  // night-only producer or a dusk-only feed can be driven without waiting 8 min.
  advanceToPhase: (phase: DayPhase) => {
    const { now, offset } = window.advanceTime(msUntilPhase(ctx.clock.now(), phase));
    return { now, offset, phase: ctx.systems.day.phase };
  },
  // Save integrity, on demand: every world's board measured against the ground it
  // actually offers, plus the cross-world facts that no single world can check —
  // chiefly "the Golden dragon stands in exactly one place". See core/saveAudit.
  audit: () => printSaveAudit(ctx.state, editorStore.baseHidden),
  // Dev/diagnostic: wipe the save and hard-reload, so a fresh newGame() runs and
  // any change to startingItems/startingDecor (e.g. the L1 dragon) shows again.
  // A loaded save otherwise masks new-game seeding.
  reset: () => {
    window.localStorage.removeItem(SAVE_KEY);
    window.location.reload();
  },
  gridToPage: (col: number, row: number) => worldToPage(gridToWorld(col, row)),
  // The page position a pointer test should AIM at for the item on (col,row):
  // the centre of its art (hit zones wrap the art, which can sit off the tile
  // point). Falls back to the tile centre for empty cells.
  itemToPage: (col: number, row: number) => {
    const board = game.scene.getScene(SCENES.board) as
      | (Phaser.Scene & {
          itemArtWorldPoint?: (c: number, r: number) => { x: number; y: number } | null;
        })
      | undefined;
    return worldToPage(board?.itemArtWorldPoint?.(col, row) ?? gridToWorld(col, row));
  },
  /** Centre the board camera on a cell (test hook; the closer camera can leave
   *  off-zone targets like the fog gate out of view). */
  centerCell: (col: number, row: number) => {
    const board = game.scene.getScene(SCENES.board) as Phaser.Scene | undefined;
    if (!board) return;
    const { x, y } = gridToWorld(col, row);
    board.cameras.main.centerOn(x, y);
  }
};
