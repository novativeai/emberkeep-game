# Emberkeep — agent instructions

Phaser 3 + TypeScript (strict) + Vite isometric merge game; three.js renders the
cel-shaded 3D crystal decor offscreen. Runs the authored 51×24 world
(`src/data/map.json`, GENERATED — never hand-edit). Production architecture —
nothing is throwaway.

## Commands
- `pnpm dev` — dev server · `pnpm verify` — typecheck → unit → build → e2e (run before calling anything done)
- `pnpm test` (Vitest, node, `tests/unit/`) · `pnpm e2e` (Playwright, drives the whole tutorial)
- e2e serves the PRODUCTION build via `vite preview` — `pnpm build` first if invoking `playwright test` directly.

## Deeper docs (read when relevant, not upfront)
- `docs/ripple-map.md` — REQUIRED before cross-cutting changes (chains/tiers, asset
  swaps, event payloads, GameState fields, world re-export, tutorial refs): full
  event emitter→handler adjacency + TOUCH X → CHECK Y invariants. Regenerate its
  scans after structural refactors.
- `docs/pipelines.md` — rigger/worldbuilder tool workflows, map ingest scripts,
  rig runtime details, art-sourcing rules (e.g. magenta de-keying).
- `docs/GDD-L1.md`, `docs/MECHANICS.md` — design intent.

## Architecture laws (non-negotiable)
- ALL cross-module communication goes through the typed synchronous `EventBus`
  (contract in `src/core/types.ts`). Systems never call each other — they emit
  commands (`energy:spend`, `economy:add`, `board:consume_items`) handled by the
  owning system. Scenes/UI/audio only emit intents and subscribe to facts.
- All state lives in `GameState`; only systems mutate it (scenes read to render).
- Every tunable lives in `src/core/Constants.ts` or `src/data/*.json` — no magic
  numbers. New chains/orders/tutorial steps are JSON-only edits.
- Gameplay timers read `GameClock.now()` (never `Date.now()`) so
  `window.advanceTime(ms)` stays deterministic.
- Systems stay Phaser-free — unit tests construct a full `GameContext` in node,
  injecting the 8×8 fixture map (`new GameContext(storage, { map })`).
- Everything tweens; nothing teleports. BoardItems and particles are pooled.

## Rendering & coordinates
- Canvas renders at 2560×1600 (`RES = 2`) and FIT-scales; ALL coordinates/fonts are
  in that hi-res space. CSS/e2e coordinates are half the game-space values.
  TextureFactory paints logical units ×RES.
- e2e Chromium runs WITH GPU (`--use-angle=metal`) — SwiftShader can't push 2560×1600.
- Depth: items at `itemBase + y` (board spans ~5100 screenY), fog +2, always-on-top
  bands (dragged/particles/flash) at 50000+ — never tie those to a small const.
- Board camera frames ONE level, gliding to the next zone's focal cell on level-up
  (suppressed during the tutorial). UIScene has its own fixed camera — `gridToPage`
  (main.ts) and board-anchored UI markers map through the board camera's
  `worldView`; keep that conversion when refactoring.
- Placeholder art is painted at runtime (`src/art/TextureFactory.ts`); real art
  swaps in via `src/data/assets.json` (`source:"file"`) + `anchors.json`. Load
  failures fall back: bespoke generator → parcel/tile stand-in → magenta (unknown
  keys only). SFX are WebAudio-synthesised in `AudioManager` (bus subscriber only).
- XP (`LEVEL_XP`) is tuned so the ~54 XP tutorial ends AT level 1; the first
  level-up right after wakes zone 2 + flies the camera (the first big reveal).

## Phaser gotchas (do not regress)
- Container hit areas test against `localPoint + displayOrigin` — custom hit rects
  must be origin-shifted (see `acquireSprite`). Keep board hit areas ≤ one iso row
  above tile centre or front items mask the tile behind them.
- Pooled BoardItems: never `disableInteractive()` on release; `acquire()` must
  fully reset (a pooled item may have been a hidden rig host).
- `setAlpha(0)`/`setVisible(false)` clear the render flag → Phaser skips hit-tests.
  Hide a rig host's art via `BoardItem.setArtVisible(false)`, never container alpha.
- Never run two scale tweens on one spawning sprite — the longer one wins the write.
- Fog puffs get a tile-diamond polygon hit area, not their full puffy frame.
- Dragon rigs animate via `rigAnimations.ts` resolution (anchor → pin-chain →
  bare-layer → skip) — reuse it, don't re-derive. Right-facing = single
  `container.scaleX = -1` flip (`setFacing`); source art faces LEFT.
- Head blink/talk frames swap the head TEXTURE (`faceAnimations.ts`), driven by
  the pose's `eyelid`/`mouth` — `src/data/faces.json` is GENERATED calibration
  (`scripts/calibrate-faces.mjs`); re-run it if head art changes (see pipelines.md).
- Blink is a randomized per-dragon `BlinkScheduler` (faceAnimations.ts), NOT a
  preset period; RigPlayer injects `pose.eyelid`. Don't reintroduce a fixed
  `t`-based blink in the presets — dragons would blink in unison.

## World data (essentials)
- Re-export of the world requires re-running BOTH `scripts/ingest-world.mjs` and
  `scripts/build-gamemap.mjs` (details + invariants in `docs/pipelines.md`).
- Region `unlock` is `{ keys? | level? }`: KEY regions lift on a Gold-Key tap
  (tutorial lesson on `level_2_gate`); LEVEL regions lift free on `keeper:leveled`.
  Every fogged cell is an authored cloud — the build script asserts it.

## Instrumentation contract (Playwright depends on it)
Keep stable when refactoring `main.ts`/`TitleScene`: `window.render_game_to_text()`,
`window.advanceTime(ms)`, `window.__emberkeep.{gridToPage,centerCell,grantXp,reset}`,
and the Title Play button's position.
