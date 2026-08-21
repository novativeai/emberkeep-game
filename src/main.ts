// The Map Editor's chrome is drawn with FontAwesome glyphs (src/editor/EditorDom.ts).
import '@fortawesome/fontawesome-free/css/all.min.css';
import { onErrorRecorded, recordedErrors, type RecordedError } from './core/crash';
import Phaser from 'phaser';
import { AudioManager } from './audio/AudioManager';
import { GameContext } from './core/Context';
import { LIVE_GAME_WIDTH, IS_MOBILE, LIVE_GAME_HEIGHT, SAVE_KEY, SCENES } from './core/Constants';
import { createGameConfig } from './core/GameConfig';
import { PowerGovernor } from './core/PowerGovernor';
import { iapBridge } from './core/iapBridge';
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
  tutorial: { step: string; index: number; total: number; done: boolean; lesson: string | null };
  /** Authored events that have fired, as `id×count`. */
  events: string[];
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
      itemToPage: (col: number, row: number) => { x: number; y: number };
      skipKeyToPage: (currency: 'gold' | 'warmth') => { x: number; y: number } | null;
      /** Why the merge hint is or is not on screen. */
      hint: () => unknown;
      characterToPage: (characterId: string) => { x: number; y: number } | null;
      /** Page point of a tutorial UI target (the cookbook button, the Codex card…) — what the lesson's arrow aims at. */
      uiToPage: (ui: string) => { x: number; y: number } | null;
      centerCell: (col: number, row: number) => void;
      grantXp: (xp: number) => void;
      /** Run an authored event by id (guards and latches apply) — the editor's Run button. */
      fireEvent: (id: string) => boolean;
      /** Every authored event with its live armed/fired status. */
      events: () => Array<{ id: string; armed: boolean; fired: number; depth: number }>;
      errors: () => RecordedError[];
      reset: () => void;
      saveKey: string;
      game: Phaser.Game;
      power: () => { state: string; fpsLimit: number; renderedFps: number };
      worlds: () => {
        active: string;
        all: { id: string; name: string; level: number; zones: number; cells: number }[];
        available: string[];
      };
      switchWorld: (id: string) => string;
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

// WebAudio unlock must come from a user gesture; resume on any pointer.
if (audio) document.addEventListener('pointerdown', () => audio.unlock());

// Battery governor: throttles the loop (and, via power:state, the ambient FX)
// whenever the board sits untouched. Scenes read it from the registry.
const power = new PowerGovernor(game, ctx.bus);
game.registry.set('power', power);

// Host-page bridge: real-money packs. Requests the hub's catalog when the
// game is embedded; standalone builds stay on the Emporium's mock showcase.
iapBridge.attach(ctx.bus);

/**
 * Map Editor — the authoring tool for the zone registry the engine runs
 * (src/editor/, opened from Settings). LAZY, and this is the codebase's second
 * dynamic import for exactly the reason of the first.
 *
 * It used to be constructed at boot, which made every player pay for a tool
 * almost none of them open, twice over:
 *
 *   • It is the ONLY thing in the codebase that pulls three.js into a bundle
 *     besides `Crystal3D` — so deferring the gem alone (see `ensureCrystal3D`)
 *     would have moved nothing, the library would simply have ridden in on this
 *     import instead. 250 KB of editor source went with it.
 *   • Its constructor fetches `asset3d/editor-map.json` — 8.9 MB of embedded
 *     project art — and JSON-parses it. On a phone over LAN that is most of the
 *     wait before the title appears.
 *
 * Nothing in the game calls into it (its own comment: it no longer restores
 * anything INTO the game), so the only thing boot construction bought was the
 * `editor:open` subscription — which this bootstrap holds instead, handing the
 * first open to the real editor once its chunk lands. Later opens are its own
 * listener's. The UI Builder document has no board to edit, so it is the one
 * boot that skips the editor entirely.
 */
if (!uiEditMode) {
  let editorAsked = false;
  ctx.bus.on('editor:open', () => {
    if (editorAsked) return; // constructed already — its own listener has this one
    editorAsked = true;
    // In a `.then`, so the editor's own `editor:open` subscription is added after
    // this dispatch has finished rather than during it.
    void import('./editor/mapEditor')
      .then(({ MapEditor }) => new MapEditor(game, ctx).open())
      .catch((err) => {
        editorAsked = false; // a failed fetch must not lock the tool out for good
        console.warn('[MapEditor] could not be loaded.', err);
      });
  });
}

// Host-page bridge: the EmberGames hub reports when the game's iframe is
// scrolled out of view — sleep the whole loop (tab-hidden is Phaser built-in).
window.addEventListener('message', (event: MessageEvent) => {
  if (event.origin !== window.location.origin) return;
  const data = event.data as { type?: string; visible?: boolean } | null;
  if (!data || data.type !== 'embergames:visibility') return;
  if (data.visible) {
    game.loop.wake();
    power.notifyActivity(2000);
  } else {
    game.loop.sleep();
  }
});

/**
 * WRITE THE BOARD DOWN BEFORE THE PAGE GOES AWAY.
 *
 * Autosave is event-driven (SaveSystem.SAVE_ON), which covers every mutation but
 * says nothing about the moment the player leaves — and leaving is not an event
 * the game gets to see coming. A closed tab, a switched app, a phone locking:
 * whatever happened since the last mutation would simply never be written.
 *
 * `pagehide` and `visibilitychange` are the pair that actually fire. `unload` and
 * `beforeunload` are unreliable on mobile Safari and skipped entirely when a page
 * goes into the back/forward cache, which is precisely the "come back later" case
 * this exists for. The write is synchronous localStorage, so it completes inside
 * the handler; both may fire for one departure and saving twice is harmless.
 */
const flushSave = (): void => {
  // ONLY while a run is actually in progress. `running` is false before the
  // first board exists and again the moment the game is reset — and a flush in
  // either window writes an EMPTY state over the file. That is not a lost save,
  // it is worse: the empty file LOADS, so `beginRun` sees a save, skips
  // `newGame()`, and the player lands on a board with nothing on it at all. Reset
  // wipes localStorage and reloads, so the flush fired between the two.
  if (!ctx.running) return;
  ctx.systems.save.save();
};
window.addEventListener('pagehide', flushSave);

/**
 * AND THE ISLE STOPS WHEN NOBODY IS LOOKING AT IT.
 *
 * The page being hidden is the only signal the browser gives for "the player
 * left" that actually fires — and until now all it did was write the save. The
 * game itself kept its appointment with the wall clock: producers came due,
 * dragons grew hungry, the day rolled on. A dev server left running in another
 * window was enough to make hours of unattended play happen.
 *
 * So the clock stops here and starts again on the way back, and the span in
 * between is deducted rather than remembered (`GameClock.pause`/`resume`).
 * Stopping FIRST is deliberate: the save that follows then stamps the frozen
 * reading, which is the same instant `load` will rebase to if the tab is closed
 * instead of merely hidden. Hidden and closed become the same story.
 *
 * `visibilitychange` covers switching tab, minimising, locking the phone and
 * closing; `pagehide` above still flushes for the departures that skip it.
 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    ctx.clock.pause();
    flushSave();
  } else {
    ctx.clock.resume();
  }
});

/**
 * Coming BACK is not the same as reloading, and the difference was visible.
 *
 * Leaving the site and returning through history restores the page from the
 * back/forward cache: the whole JS heap comes back as it was, so nothing loads
 * — no `hydrate`, none of the repairs hydration runs (map fixtures re-seated,
 * regions settled), and a `GameClock` that has been frozen since `pagehide`
 * while real time kept going. The board the player sees is the one they left
 * plus however long they were away, un-reconciled. Pressing F5 fixed it, which
 * is exactly the shape of the complaint: "I leave and it's wrong, I refresh and
 * it's fine."
 *
 * A restored page therefore reloads for real. The state is already on disk —
 * `pagehide` flushed it on the way out — so this costs a boot, not a save.
 */
window.addEventListener('pageshow', (event: PageTransitionEvent) => {
  if (event.persisted) window.location.reload();
});

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
      // `currentStep` is the live beat of WHICHEVER script holds the board —
      // the main one, or a mid-game lesson playing after it (tutorialScripts).
      step: tutorialStep?.id ?? (state.tutorialDone ? 'done' : 'none'),
      index: state.tutorialIndex,
      total: ctx.data.tutorial.steps.length,
      done: state.tutorialDone,
      lesson: ctx.systems.tutorial.activeScriptId
    },
    events: ctx.systems.events.status().filter((e) => e.fired > 0).map((e) => `${e.id}×${e.fired}`),
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
    x: rect.left + (world.x / LIVE_GAME_WIDTH) * rect.width,
    y: rect.top + (world.y / LIVE_GAME_HEIGHT) * rect.height
  };
};

window.__emberkeep = {
  saveKey: SAVE_KEY,
  game,
  // Test/diagnostic: award XP so a level-up (and its camera fly) can be driven
  // deterministically without grinding merges.
  grantXp: (xp: number) => ctx.bus.emit('economy:add', { xp, reason: 'debug:grantXp' }),
  fireEvent: (id: string) => ctx.systems.events.fire(id),
  events: () => ctx.systems.events.status(),
  /** Everything the game caught rather than let end the RAF chain — see
   *  `src/core/crash.ts`. Empty is the healthy answer. */
  errors: () => recordedErrors(),
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
  /**
   * Where to AIM at one of the generator popup's two keys.
   *
   * The popup used to be a pair of keys at a fixed offset under the piece, so a
   * test could hard-code `+SKIP_KEYS.dx, +100` and hit it. It is a hanging pin
   * now, stacked, and it rides the ART's height so a tall House is not covered
   * by its own offer — which means the offset is no longer a constant anything
   * outside the scene can know. Ask the scene instead: this reports the live
   * world point of the row, so the test aims at what is actually drawn however
   * the pin is later re-tuned.
   */
  /** Why the merge hint is (or is not) showing — see BoardScene.hintDiagnostics. */
  hint: () => {
    const board = game.scene.getScene(SCENES.board) as
      | (Phaser.Scene & { hintDiagnostics?: () => unknown })
      | undefined;
    return board?.hintDiagnostics?.() ?? { error: 'board scene not running' };
  },
  skipKeyToPage: (currency: 'gold' | 'warmth') => {
    const board = game.scene.getScene(SCENES.board) as
      | (Phaser.Scene & {
          skipKeyWorldPoint?: (c: 'gold' | 'warmth') => { x: number; y: number } | null;
        })
      | undefined;
    const at = board?.skipKeyWorldPoint?.(currency);
    return at ? worldToPage(at) : null;
  },
  /**
   * Where to AIM at a world character — the middle of her BODY, not her cell.
   * Her cell is no longer where she is drawn (characters.json carries a free
   * dx/dy off it) and her hit rect is the lower half of her silhouette, which
   * stands well above her feet either way. `null` if she is not on this map.
   */
  characterToPage: (characterId: string) => {
    const board = game.scene.getScene(SCENES.board) as
      | (Phaser.Scene & { characterAimWorldPoint?: (id: string) => { x: number; y: number } | null })
      | undefined;
    const at = board?.characterAimWorldPoint?.(characterId);
    return at ? worldToPage(at) : null;
  },
  /** Where a tutorial UI target is on the page — the same resolver the arrow
   *  uses, so a test taps exactly what the player is shown. UIScene's camera
   *  is fixed, so its coordinates map straight through the live space. */
  uiToPage: (ui: string) => {
    const uiScene = game.scene.getScene(SCENES.ui) as
      | (Phaser.Scene & { uiTarget?: (ref: { ui: string }) => { x: number; y: number } | null })
      | undefined;
    const at = uiScene?.uiTarget?.({ ui });
    if (!at) return null;
    const rect = game.canvas.getBoundingClientRect();
    return {
      x: rect.left + (at.x / LIVE_GAME_WIDTH) * rect.width,
      y: rect.top + (at.y / LIVE_GAME_HEIGHT) * rect.height
    };
  },
  /** Centre the board camera on a cell (test hook; the closer camera can leave
   *  off-zone targets like the fog gate out of view). */
  centerCell: (col: number, row: number) => {
    const board = game.scene.getScene(SCENES.board) as Phaser.Scene | undefined;
    if (!board) return;
    const { x, y } = gridToWorld(col, row);
    board.cameras.main.centerOn(x, y);
  },
  /**
   * World travel. `worlds()` lists what this build can run and which of them the
   * Keeper may currently reach; `switchWorld(id)` asks WorldSystem to go there —
   * it refuses mid-tutorial and above the Keeper's rank exactly as any in-game
   * door would, so driving it from here tests the real path rather than a
   * shortcut around it. Returns the world actually being shown.
   */
  worlds: () => ({
    active: ctx.state.worldId,
    all: [...ctx.state.worlds.values()].map((w) => ({
      id: w.id,
      name: w.name,
      level: w.level,
      zones: w.zones.length,
      cells: w.zones.reduce((n, z) => n + (z.dense ? z.matrix.cols * z.matrix.rows : z.cells.size), 0)
    })),
    available: ctx.systems.worlds.available().map((w) => w.id)
  }),
  switchWorld: (id: string) => {
    ctx.bus.emit('world:switch', { to: id });
    return ctx.state.worldId;
  },
  /** Battery-governor diagnostics: current state + real rendered step rate. */
  power: () => ({
    state: power.state,
    fpsLimit: game.loop.fpsLimit,
    renderedFps: Math.round(power.renderedFps())
  })
};

/**
 * DEV ONLY — put the black box on the screen.
 *
 * `guard` keeps a failure from ending the session, but a caught failure is
 * SILENT: the ceremony is missing a piece and nothing says why. The console
 * holds the stack, and on the device where these are hardest to reproduce —
 * a phone on the LAN — there is no console to read it in.
 *
 * So the first occurrence of each distinct failure paints itself, tap to
 * dismiss. Gated on `import.meta.env.DEV`, so it is a development instrument
 * and never a thing a player can see: the whole point of degrading gracefully
 * is that the player is not shown the machinery.
 */
if (import.meta.env.DEV) {
  onErrorRecorded((rec) => {
    const el = document.createElement('div');
    el.textContent = `⚠ ${rec.where} — ${rec.message}`;
    el.style.cssText =
      'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;padding:10px 14px;' +
      'background:#7a1420;color:#ffd9d9;font:13px/1.4 monospace;border-radius:8px;' +
      'white-space:pre-wrap;word-break:break-word;box-shadow:0 4px 18px #0008';
    el.addEventListener('pointerdown', () => el.remove());
    document.body.appendChild(el);
  });
}
