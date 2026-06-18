import Phaser from 'phaser';
import { AudioManager } from './audio/AudioManager';
import { GameContext } from './core/Context';
import { GAME_HEIGHT, GAME_WIDTH, SAVE_KEY, SCENES } from './core/Constants';
import { createGameConfig } from './core/GameConfig';
import { gridToWorld } from './core/iso';

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
      centerCell: (col: number, row: number) => void;
      grantXp: (xp: number) => void;
      reset: () => void;
      saveKey: string;
      game: Phaser.Game;
    };
    webkitAudioContext?: typeof AudioContext;
  }
}

const ctx = new GameContext(window.localStorage);
const audio = new AudioManager(ctx.bus);

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

// WebAudio unlock must come from a user gesture; resume on any pointer.
document.addEventListener('pointerdown', () => audio.unlock());

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

window.__emberkeep = {
  saveKey: SAVE_KEY,
  game,
  // Test/diagnostic: award XP so a level-up (and its camera fly) can be driven
  // deterministically without grinding merges.
  grantXp: (xp: number) => ctx.bus.emit('economy:add', { xp, reason: 'debug:grantXp' }),
  // Dev/diagnostic: wipe the save and hard-reload, so a fresh newGame() runs and
  // any change to startingItems/startingDecor (e.g. the L1 dragon) shows again.
  // A loaded save otherwise masks new-game seeding.
  reset: () => {
    window.localStorage.removeItem(SAVE_KEY);
    window.location.reload();
  },
  gridToPage: (col: number, row: number) => {
    const rect = game.canvas.getBoundingClientRect();
    const world = gridToWorld(col, row);
    // Map through the BOARD camera (which pans/zooms across the big map) so a
    // cell's page position is correct wherever the camera currently sits.
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
      y: rect.top + (world.y / GAME_HEIGHT) * rect.height
    };
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
