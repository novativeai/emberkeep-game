# Emberkeep — bug-log.md (cumulative project journal)

> **Protocol (Software Architect & System Maintenance).** This file is the single
> append-only source of truth. Rules: never edit or delete past entries — only
> append at the end. Every issue / bug / structural change is logged with:
> **Date-Time (ISO 8601) · Context (file + lines) · Description · Solution/Action
> · Status (Resolved / Pending / In progress)**. Read this file BEFORE acting on
> any new prompt; cross-reference it against a deep scan before proposing changes.

---

## Project identity
- **Path (active project root):** `/home/kioto/projetN/emberkeep-game/new/emberkeep-game2`
- **Stack:** Phaser 3.90 · TypeScript (strict, noUnusedLocals) · Vite · pnpm.
- **VCS:** git, branch `main`. Remote `origin` = `github.com/novativeai/emberkeep-game` (PRIVATE). **Pushes are blocked — never push without an explicit fresh token; an old PAT pasted in chat must be revoked.**
- **Verify gate:** `pnpm verify` = typecheck → unit (Vitest, `tests/unit/`) → build → e2e (Playwright, drives the whole tutorial; serves the PROD build via vite preview → run `pnpm build` first if invoking `playwright test` directly). Run before calling anything done.
- **Map rule:** the map is a deliberate **départ-0** (fresh start). Do NOT rewrite it wholesale or make it "like the parent's green map". Targeted, user-requested item placements inside `src/data/map.json` are allowed (e.g. moving the woods onto the isle, placing the chest in level 2); wholesale map swaps are not.

## Architecture — mental map (navigate in the dark)
- **EventBus is the only cross-module channel** (`src/core/EventBus.ts`; contract in `src/core/types.ts`). Systems never call each other; they emit commands (`energy:spend`, `economy:add`, `board:consume_items`, `time:advanced`…) handled synchronously by the owning system. UI/scenes/audio only emit intents + subscribe.
- **State:** all in `GameState` (`src/core/GameState.ts`); only systems mutate, scenes read. `GameContext` (`src/core/Context.ts`) wires systems + data; unit tests build it Phaser-free in node.
- **Tunables:** `src/core/Constants.ts` + `src/data/*.json` only — no magic numbers in systems/scenes.
- **Clock:** all gameplay timers use `GameClock.now()` (never `Date.now()`), so `window.advanceTime(ms)` stays deterministic.
- **Systems** (`src/systems/`): BoardSystem (spawns startingItems), MergeSystem (drag→merge, 8-connected + snap), GeneratorSystem, EconomySystem (gold/xp/level), EnergySystem (Warmth + regen), RewardSystem, OrderSystem, UnlockSystem (KEY/LEVEL region reveals), DragonJobSystem, **ChestSystem** (passive 10-min random gift), TutorialDirector, SaveSystem.
- **Scenes** (`src/scenes/`): Boot → Preload → Title → Board (+ UI scene parallel). BoardScene renders the board; UIScene has its own fixed camera — board-anchored markers (tutorial hand/arrow) re-project through the board camera `worldView` each frame.
- **Render/rig:** `src/render/RigPlayer.ts` + `rigAnimations.ts` (adaptive anchor→pin-chain→bare-layer). Dragons: `DRAGON_RIGS` map in BoardScene, scaled by `DRAGON_RIG_SCALE`.
- **Data:** `chains.json` (merge chains), `map.json` (engine map, généré), `world-map.json` (intermediate), `tutorial.json`, `orders.json`, `assets.json` (+`anchors.json`).
- **Instrumentation contract (Playwright depends on it):** `window.render_game_to_text()`, `window.advanceTime(ms)`, `window.__emberkeep.gridToPage(col,row)`.

---

## Cumulative history

### 2026-06-19T15:54+03:00 — Code fixes only (grounded objects, snap-merge, camera hints, scales)
- **Context:** `src/core/Constants.ts`, `src/entities/BoardItem.ts` (applyBob/landSquash), `src/scenes/BoardScene.ts` (springBounce→settleSprite, acquireSprite), `src/scenes/UIScene.ts` (markers update), `src/systems/MergeSystem.ts` (trySnapMerge), `index.html`, `tests/unit/MergeSystem.spec.ts`. Commit `0b17b59`.
- **Description:** items floated (idle bob); merge required dead-on drops; tutorial hand stuck to screen on camera pan; assorted scale requests.
- **Solution:** `applyBob`→no-op + one-time `landSquash` on every spawn & after drag; decor/tiles settle once (no perpetual bounce); `trySnapMerge` makes dropping NEAR a mergeable pair fuse onto the completing tile (+2 unit tests); UIScene re-projects hand/arrow to their board cell each frame; scales: dragon 0.88→0.7, house 1.0→0.9, wood 0.4→0.38, trees ×0.5; logo raised. **Map untouched.**
- **Status:** Resolved.

### 2026-06-19T17:04+03:00 — Treasure chest, hide Ember Bloom, grounded-visible wood, play-icon title
- **Context:** `src/systems/ChestSystem.ts` (new), `src/core/Constants.ts` (CHEST_*, HIDDEN_CHAINS, item_chest scale), `src/core/Context.ts` + `types.ts`, `src/data/{assets,anchors,chains,orders}.json`, `src/systems/{BoardSystem,UnlockSystem}.ts`, `src/scenes/{BoardScene,TitleScene}.ts`, `tests/unit/ChestSystem.spec.ts`. Commit `a6938fa`.
- **Description:** chest.png unused; "Ember Bloom" (sparkweed flower) unwanted but the map keeps a hidden Spark Weed and unit tests use the `sparkweed` chain; wood read as floating; title Play button had a text label.
- **Solution:** wired `item_chest_1` (chain `chest`, anchor+scale = wood) + `ChestSystem` random gift; `HIDDEN_CHAINS={'sparkweed'}` filters the flower out of `UnlockSystem` reveals (map kept, chains.json kept for tests) + dropped its order; wood `lumber_1` 0.38→0.48, anchor 0.84→0.92; Play button → drawn play-triangle icon (no text). **Map untouched at this step.**
- **Status:** Resolved.

### 2026-06-19T18:47+03:00 — Wood −20% + repositioned onto isle, chest = level-2 passive 10-min gift, dragon −20%, START button, cloud title bg
- **Context:** `src/data/map.json` (+16/−8: wood positions, chest into level_2 contents), `src/core/Constants.ts` (scales, CHEST_INTERVAL_MS=600000), `src/systems/ChestSystem.ts` (passive standing gift), `src/scenes/TitleScene.ts`, `src/main.ts`, `tests/{unit/ChestSystem,e2e/level1}.spec.ts`. Commit `4303e8b`.
- **Description:** user asked: woods "bien placés dans le sol", chest in level 2 giving random gifts every 10 min, wood −20%, dragon −20%.
- **Solution:** woods repositioned onto playable isle cells `(7,6)(8,6)(9,6)(7,7)(8,7)`; chest moved into `level_2` region contents at `(5,2)`; chest reward made a STANDING passive gift every `CHEST_INTERVAL_MS` (never consumed); `lumber_1`→0.384, `ember_dragon` rig→0.56; cloud title background + START button. **This is the deliberate, user-requested map edit** (overrides "don't touch the map" for these placements only).
- **Status:** Resolved.

### 2026-06-19T20:54+03:00 — Centre the START button + robust e2e tap
- **Context:** `index.html`, `src/scenes/TitleScene.ts`, `src/main.ts`, `tests/e2e/level1.spec.ts`. Commit `acd55b9`.
- **Description:** Play/START/Continue button needed centring; synthetic clicks on the bobbing button dropped in headless e2e.
- **Solution:** button moved to screen centre (GAME_HEIGHT/2), logo shrunk + raised to clear it; shared `tapPlay()` e2e helper re-taps until the board boots; removed temporary `window.__game` debug hook.
- **Status:** Resolved.

### 2026-06-19T17:19+03:00 — Title cloud background (title-only) + logo top / round button bottom
- **Context:** `index.html` (.title-bg / .title-logo CSS), `src/scenes/TitleScene.ts` (show/hide), `assets/sprites/ui/title-screen-background.jpg` (new). Commits `38fd17a`, `a88f4b1` (superseded by `acd55b9` centring).
- **Description:** wanted a pro title: dedicated cloud background for the TITLE ONLY, logo up, round Play button.
- **Solution:** `title-screen-background.jpg` shown as a z-0 DOM bg only while TitleScene is alive (gameplay keeps the emberkeep backdrop); logo contained near the top; round drawn Play button. NOTE: the .jpg is ~7 MB — compression to WebP/q85 is an open optimisation.
- **Status:** Resolved (compression = Pending optimisation).

### Current key tunables (snapshot, `src/core/Constants.ts`)
- `ITEM_SCALE`: `lumber_1` 0.384 · `chest_1` 0.336 (wood-sized −30%) · `bigtree_1` 0.31.
- `DRAGON_RIG_SCALE.ember_dragon` 0.56.
- `CHEST_INTERVAL_MS` 600000 (10 min); `CHEST_REWARDS` = {2 Gold | +3 Warmth | 5 Wood}.
- `HIDDEN_CHAINS` = {`sparkweed`}.

---

## Pending / watch
- **[Pending]** Compress `assets/sprites/ui/title-screen-background.jpg` (~7 MB) → WebP/q85 for faster load (no visual change).
- **[Pending]** Push to GitHub — blocked on a FRESH token; old pasted PAT must be revoked. Never push without explicit user request + token.
- **[Watch]** `src/data/map.json` was deliberately edited (wood/chest placements). Keep the départ-0 spirit; no wholesale map swaps.
- **[Watch]** Unit tests depend on the `sparkweed` chain in `chains.json` — keep the chain even though Ember Bloom is hidden in-game via `HIDDEN_CHAINS`.
