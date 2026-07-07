# Emberkeep — Big Plan (design + mechanism overhaul)

> Surgical plan for the requested batch. Nothing here is implemented yet — this is
> the map. Each item lists: **Current** (exact file:line), **Goal**, **Surgical steps**,
> **Files**, **Risk/effort**. Suggested phasing at the bottom (quick wins → economy).
> Rule: JSON/Constants edits over code where possible; verify gate (`pnpm verify`) each phase.

---

## PART A — DESIGN (visual / UI)

### A1 · Woman talking out of the text bubble
- **Current:** `CharacterBubble` shows a static disc `portrait_laurah` (scale ~150/height) overlapping the bubble's right edge — [CharacterBubble.ts:41,74,77,100](../src/entities/CharacterBubble.ts). The teammate just landed a head-frame face system (blink / roar-talk) for the **dragon rig** — [faceAnimations.ts](../src/render/faceAnimations.ts), [faces.json](../src/data/faces.json).
- **Goal:** Laurah's portrait **animates while she speaks** (mouth talk-cycle + blink), reading as "she's talking", ideally breaking the disc frame a little (bust that overlaps the bubble top).
- **Surgical steps:**
  1. Author a **Laurah face set** (mouth open/half/closed + eyes open/closed frames) mirroring the dragon's head-animation folders (`assets/sprites/characters/.../head-animation/*`). ➜ **asset dependency** (art).
  2. Add a `laurah` entry to `faces.json` (reuse the teammate's frames.json schema).
  3. In `CharacterBubble`, drive a lightweight talk-cycle on the portrait: swap mouth frames while the bubble text is "typing"/visible, idle-blink otherwise. Reuse `faceAnimations.ts` timing (BlinkScheduler) rather than re-deriving.
  4. Optional: enlarge/re-anchor the portrait so the bust rises above the bubble border ("out of the bubble").
- **Files:** `assets/…/laurah face frames` (new), `src/data/faces.json`, `src/entities/CharacterBubble.ts`, maybe `src/render/faceAnimations.ts` (expose a portrait talk helper).
- **Risk/effort:** **M–L**. Blocked on art frames. Engine reuse is clean (system already exists). Keep e2e's Play-button + bubble tap stable.

### A2 · Glove (tutorial pointer)
- **Current:** the guiding pointer is `ui_hand` — [UIScene.ts:81](../src/scenes/UIScene.ts). Placeholder painted in `TextureFactory`; real art swaps via `assets.json`.
- **Goal:** replace the pointing hand with a **glove** (style match).
- **Surgical steps:** drop a `ui_hand.png` (glove art) under `assets/`, wire `source:"file"` in `assets.json` + anchor in `anchors.json` (origin ~0.3/0.12, current default). No code change if the key stays `ui_hand`. If a distinct key is wanted, add `ui_glove` + swap the ref in UIScene (3 spots: hand image + origin).
- **Files:** `assets/…/ui_hand.png` (art), `src/data/assets.json`, `src/data/anchors.json`.
- **Risk/effort:** **S**. Pure asset swap. Verify anchor so the fingertip lands on the target.

### A3 · Purchase UI redesign
- **Current:** `ShopPanel` — hand-drawn pink card reel; 3 currency tabs (energy/coins/keys), each 3 mock-price cards; first energy card is the tutorial FREE — [ShopPanel.ts](../src/ui/ShopPanel.ts) `SHOP`, `makeCard` (W380×H560), `getFreeButtonPos`.
- **Goal:** cleaner, more "store"-like purchase UI (better hierarchy, best-value badge, clearer FREE state, real IAP-style layout).
- **Surgical steps:**
  1. Decide direction (keep drawn primitives vs. add real card art). ➜ **needs a design call.**
  2. Rework `makeCard` layout: bigger amount, clearer price CTA, "best value" ribbon, sale/most-popular. Keep `getFreeButtonPos()` contract (tutorial arrow depends on it) + `open(currency)` API.
  3. Keep the `marketplace:purchased` emit + `ek_energy_free_used` gate.
- **Files:** `src/ui/ShopPanel.ts` (+ optional art in `assets/`, `assets.json`).
- **Risk/effort:** **M**. Don't break the tutorial hand target (`getFreeButtonPos`) or the free-first logic.

### A4 · Daily-quest icons too big
- **Current:** the Ledger (Cindra's order = the "daily quest") draws the **required-item icon at `slotBoardScale × 2.0`** — [LedgerPanel.ts:277](../src/ui/LedgerPanel.ts#L277). Reward icon at `×0.75` (:269). That ×2.0 is the "too big".
- **Goal:** shrink the requirement (and reward) icons to sit cleanly in their slots.
- **Surgical steps:** change the `× 2.0` multiplier (:277) to ~`× 1.1–1.3` (tune to fit `ui_slot`); optionally clamp with a max display size instead of a raw board-scale multiple. Re-check the reward icon (:269) at the same time.
- **Files:** `src/ui/LedgerPanel.ts` (1–2 lines).
- **Risk/effort:** **S**. Trivial, high polish.

### A5 · Zzz interface
- **Current:** resting-dragon fatigue badge = a cream pill **296×118** with "💤 Zzz" + countdown, floating at `sprite.y-160` at `DEPTHS.flash` — [BoardScene.ts `showRestBadge`](../src/scenes/BoardScene.ts).
- **Goal:** a nicer, smaller, less-intrusive rest indicator (the current pill is large and hard-`flash`-depth, so it can dominate).
- **Surgical steps:** redesign the badge — smaller pill or a floating "💤" with a thin ring countdown; lower its depth band so it doesn't sit above everything; animate a gentle bob/fade. Keep the `restBadges` map lifecycle (create on `dragon:rest`, destroy on wake / in the update loop).
- **Files:** `src/scenes/BoardScene.ts` (`showRestBadge` + the update-loop refresh).
- **Risk/effort:** **S–M**. Self-contained.

### A6 · Smaller merge items
- **Current:** `ITEM_SCALE` — merge pieces already trimmed, but still on the large side: `emerald_1 0.25`, `ember_dragon_1 0.18`, `flame_gem_1 0.15`, `coin_1 0.12`, eggs `0.064` — [Constants.ts `ITEM_SCALE`](../src/core/Constants.ts).
- **Goal:** shrink the **mergeable board pieces** (gems/rubies/coins) so a full board reads clean and merges feel tidy.
- **Surgical steps:** reduce the merge-tier scales (`emerald_1`, `ember_dragon_1`, `flame_gem_1`, `emerald_2`/`ember_dragon_2` eggs, `coin_1`) by a chosen %; leave generators (house/tree/crystal/dragon host) alone. Also re-check any **full-body hit-areas** tied to a scale (chest/house/tree in `acquireSprite`) — only chest/house/tree have custom rects, gems use the default footprint, so gems are safe.
- **Files:** `src/core/Constants.ts` (`ITEM_SCALE`).
- **Risk/effort:** **S**. Pure tunables. Pick exact % with the user (they've iterated these before).

---

## PART B — MECHANISM

### B1 · Merge sensibility
- **Current:** `MergeSystem` flood-fills the orthogonally-connected same-chain+tier group at the drop cell; `minGroup` (3) merges; a **snap-merge** lets a drop NEXT-TO a mergeable cluster fuse onto the completing tile — [MergeSystem.ts `trySnapMerge`:83](../src/systems/MergeSystem.ts), `minGroup` from `chains.json mergeRule`.
- **Goal:** tune how "forgiving" merging feels (currently 8-/ortho-connected + snap-to-nearest-free). Likely make it more forgiving (bigger snap reach) or more precise per the user's taste.
- **Surgical steps:**
  1. Confirm the desired feel (more forgiving vs. stricter). ➜ **needs the user's intent.**
  2. Parameterise the snap search: today `trySnapMerge` scans free active tiles beside a cluster reaching `minGroup-1`; widen/narrow that neighbourhood, and/or accept diagonal adjacency.
  3. Add the tunable to `Constants`/`chains.json` (no magic numbers).
  4. Extend `tests/unit/MergeSystem.spec.ts` (snap cases already exist).
- **Files:** `src/systems/MergeSystem.ts`, `src/core/Constants.ts` or `src/data/chains.json`, `tests/unit/MergeSystem.spec.ts`.
- **Risk/effort:** **M**. Well-tested system — change behind a constant + tests.

### B2 · Key randomly appearing
- **Current:** keys enter only via **tutorial `grantKeys`** and **order rewards** (`orders.json rewards.keys`); spent in `UnlockSystem` on key-gated fog — [UnlockSystem.ts](../src/systems/UnlockSystem.ts), [EconomySystem.ts](../src/systems/EconomySystem.ts). No passive/random key source.
- **Goal:** keys appear **randomly** during play (a steady, exciting drip — feeds the fog-unlock loop).
- **Surgical steps:** mirror the **ChestSystem** pattern (it's the template): a small `KeySystem` (or extend a reward source) that, on a timer or a weighted event (e.g., a % chance on merges/harvests), spawns a **collectible key** on the board that the player taps to bank (`economy:add {keys}`). Tunables in Constants (`KEY_DROP_*`). Add a `key` collectible entry (art + `COLLECTIBLE_REWARD`-style banking) and a spawn cause. Phaser-free system → unit-testable.
- **Files:** `src/systems/KeySystem.ts` (new), `src/core/Context.ts` (wire), `src/core/Constants.ts` (rates), `src/data/{chains,assets,anchors}.json` (key collectible), `src/scenes/BoardScene.ts` (tap-to-bank + fly-to-gauge, reuse coin-collect path), `tests/unit/KeySystem.spec.ts` (new).
- **Risk/effort:** **M**. New system but ChestSystem/coin-collect give the shape.

### B3 · Economy tuning — the big one (gains, spending, engagement loop)
> "How long to get a resource again · what can be done with it · how to keep the user constantly engaged."
- **Current levers (all data, mostly one file):**
  - **Generators** (`chains.json`): dragon t3 cd/passive **300 000** (5m) → gem; house **600 000** (10m) → coin; tree **1 200 000** (20m) → wood; crystal **1 200 000** (20m, tap) → emerald; energyCosts 0–1; skip cost dynamic (`GENERATOR_SKIP_MAX_ENERGY 9`, crystal `skipMaxGold 50`).
  - **Energy** (`Constants`): `ENERGY_MAX 20`, `ENERGY_START 18`, regen **1 / 180 000 ms** (3m), `+3` max per Keeper level.
  - **XP / levels:** `LEVEL_XP [0,60,140,250,400,590,820]`; per-tier `xp`/`sell` in `chains.json`.
  - **Chest:** `CHEST_INTERVAL_MS 600 000`; gifts = 5 coins / 3 emeralds / 3 rubies.
  - **Dragon work:** `DRAGON_WORK_MS 180 000` (3m) then `DRAGON_REST_MS 300 000` (5m); each worker **×2** speed.
  - **Orders** (`orders.json`): 4 Cindra orders → coins/keys/xp/golden-egg.
- **Goal:** a deliberate **core loop** (produce → merge → spend → unlock → produce faster) with no dead time and no runaway inflation; every resource has a clear sink and a satisfying re-acquire cadence.
- **Surgical steps (design-first, then tune):**
  1. **Map the loop on paper first** (extend `docs/xp-pacing.md`): for each resource — **source(s)**, **rate**, **sink(s)**, **target session cadence** (e.g., "a meaningful action every ≤30–60 s"). Identify dead spots (long cooldowns with nothing to do) and inflation (a source with no sink).
  2. **Set target pacing**, then back-solve the numbers: cooldowns (`chains.json`), energy regen/costs, XP curve, chest interval/loot, order rewards, key drop rate (B2), skip prices.
  3. **Add sinks / uses** where a resource piles up (e.g., what emeralds/rubies/coins/keys are FOR at each stage).
  4. **Change data, not code**; keep every number in `Constants`/`*.json`. Re-run `docs/xp-pacing.md` math + adjust the tutorial's scripted XP so it still lands level-1-at-end.
  5. **Instrument**: a lightweight dev readout (extend `render_game_to_text`) of resource rates to validate the loop deterministically via `window.advanceTime`.
- **Files:** `src/data/chains.json`, `src/data/orders.json`, `src/core/Constants.ts`, `docs/xp-pacing.md` (+ maybe a new `docs/economy.md`), possibly `src/main.ts` (dev readout). Interacts with B2 (keys) + A3 (shop) + the chest.
- **Risk/effort:** **L**. Highest-value, needs a design pass + iteration + playtesting. Do it LAST, on top of the other fixes, as its own phase.

---

## Suggested phasing (do in order; verify + (optionally) deploy each)
1. **Quick polish (S):** A4 daily-quest icons · A6 smaller merge items · A2 glove (if art ready). Low risk, immediate feel.
2. **UI (M):** A5 Zzz badge · A3 purchase UI. Self-contained visual work.
3. **Merge feel (M):** B1 merge sensibility (behind a constant + tests).
4. **Talking Laurah (M–L):** A1 — once the Laurah face frames exist (art-blocked).
5. **New source (M):** B2 random keys (new KeySystem, ChestSystem template).
6. **Economy pass (L):** B3 — design the loop, back-solve numbers, instrument, playtest. Its own phase; touches everything above.

### Open questions to lock before coding
- **A1/A2:** are the Laurah talk-frames + glove art available, or do we author placeholders first?
- **A3:** keep drawn primitives or introduce card art? What IAP tiers/pricing?
- **A6/B1:** exact shrink % and how forgiving the merge should feel (user taste — they've iterated these).
- **B2:** key drop *trigger* (timer vs. % on merge/harvest) and *rate*.
- **B3:** target session length + "meaningful action every N seconds" — the anchor for all the numbers.
