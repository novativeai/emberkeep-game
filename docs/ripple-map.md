# Ripple map — cause & effect reference (for the agent, not the player)

Purpose: answer "if I change X, what else moves?" without re-deriving it. Everything
here was extracted from source, not memory. **Regenerate after structural changes:**

```sh
# emit sites            grep -rno "\.emit('[a-z_:]*'" src --include=*.ts
# subscribe sites       grep -rno "\.on('[a-z_:]*'" src --include=*.ts   # beware: filter Phaser input events ('drag' prefix also matches 'dragon:*')
# event contract        src/core/types.ts EventContract (55 events)
```

## 1. Event adjacency (who emits → who handles)

Synchronous bus (`core/EventBus`). A handler runs BEFORE the emitter's next line.
SaveSystem additionally autosaves on: `item:spawned/moved/merged/harvested/removed`,
`energy:changed`, `economy:changed`, `order:completed`, `region:unlocked`, `tutorial:step`
(list: `SaveSystem.SAVE_ON` — adding a state-mutating fact? add it there or it won't persist).

### Intents (view → system)
| event | emitted by | handled by |
|---|---|---|
| drag:dropped | BoardScene | MergeSystem |
| item:tapped | BoardScene | GeneratorSystem, UIScene (tooltip) |
| generator:skip | BoardScene | GeneratorSystem |
| dragon:work | BoardScene | DragonJobSystem |
| fog:tapped | BoardScene | UnlockSystem |
| chest:open | BoardScene | ChestSystem, TutorialDirector (gate) |
| ui:deliver_requested | LedgerPanel (per-card, TWO orders visible) | OrderSystem |
| ui:sell_requested | Tooltip | EconomySystem (refuses `sellable:false` tiers — golden egg/Elder) |
| ui:shop_requested | Hud (energy/coins only — keys are never sold) | UIScene |
| elder:tapped | BoardScene (communing at the GOLDEN ALTAR — the scenic fixture at GOLDEN_ALTAR.cell (-2,2), NOT a board item; egg appears on order `cindra_brazier`, Elder awakens at L3, all derived from save state) | TaskSystem |
| ui:ledger_toggled | LedgerPanel | AudioManager, TutorialDirector, UIScene |
| audio:set_music_muted | UIScene | AudioManager |
| tutorial:advance_requested | CharacterBubble | TutorialDirector, AudioManager |
| game:reset_requested | UIScene, EndScreen | GameContext |
| time:advanced | BoardScene (every 500ms, real elapsed), main.ts advanceTime(), TutorialDirector advanceClock effect | EnergySystem (regen), GeneratorSystem (passives), DragonJobSystem (work speed-up + fatigue) |

### Commands (system → owning system)
| event | emitted by | handled by (owner) |
|---|---|---|
| energy:spend | GeneratorSystem | EnergySystem |
| energy:add | GeneratorSystem, ShopPanel | EnergySystem |
| energy:set | TutorialDirector | EnergySystem |
| energy:refill | RewardSystem | EnergySystem |
| economy:add | MergeSystem, GeneratorSystem, ChestSystem, OrderSystem, RewardSystem, TutorialDirector, ShopPanel, BoardScene, main.ts grantXp | EconomySystem |
| economy:spend_keys | UnlockSystem | EconomySystem |
| board:consume_items | EconomySystem (sell), OrderSystem (deliver), BoardScene | BoardSystem |
| board:spawn | OrderSystem, TutorialDirector | BoardSystem |
| board:retier / board:move | TutorialDirector | BoardSystem |
| generator:set_timer | TutorialDirector | GeneratorSystem |

### Facts (system → views + downstream systems)
| event | emitted by | handled by |
|---|---|---|
| item:spawned | BoardSystem, ChestSystem | BoardScene, OrderSystem, TutorialDirector, Save |
| item:moved | BoardSystem, MergeSystem | BoardScene, Save |
| item:move_bounced | MergeSystem | BoardScene, AudioManager |
| item:merged | MergeSystem | BoardScene, UIScene, AudioManager, OrderSystem, TutorialDirector (gate), TaskSystem, Save |
| item:hatched | MergeSystem | BoardScene (hatch ceremony), AudioManager, TutorialDirector (gate), TaskSystem |
| item:harvested | GeneratorSystem | BoardScene, AudioManager, TutorialDirector (gate), Save |
| item:harvest_failed | GeneratorSystem | BoardScene, AudioManager, Hud |
| item:produced | GeneratorSystem | BoardScene, AudioManager, OrderSystem |
| item:removed | BoardSystem | BoardScene, UIScene, OrderSystem, TutorialDirector, DragonJobSystem (job cancel), Save |
| item:sold | EconomySystem | BoardScene, AudioManager |
| generator:reward | GeneratorSystem | BoardScene |
| generator:skipped | GeneratorSystem | TutorialDirector (gate) |
| gold:collected | BoardScene | UIScene |
| chest:claimed | ChestSystem | BoardScene |
| dragon:working | DragonJobSystem | TutorialDirector (gate) — BoardScene animates in startDragonWork, not via this event |
| dragon:rest / dragon:rested | DragonJobSystem | BoardScene |
| energy:changed | EnergySystem, BoardSystem | Hud, Save |
| economy:changed | EconomySystem, BoardSystem | Hud, AudioManager, Save |
| keeper:leveled | EconomySystem | UnlockSystem (level regions lift), RewardSystem, BoardScene (camera fly; **level≥3 runs the FINALE sequence instead**), UIScene (banner; **level≥3 → Cindra line + chapter card on the FINALE timeline**), AudioManager |
| order:progress | OrderSystem (one per VISIBLE order — payload orderId matters) | Hud (dot = ANY deliverable), LedgerPanel |
| order:completed | OrderSystem | Hud, LedgerPanel, UIScene (celebration banner), AudioManager, TutorialDirector, TaskSystem, Save |
| tasks:all_complete | TaskSystem (reward already paid) | UIScene (banner + Cindra line), LedgerPanel (Tasks-tab refresh) |
| cookbook:discovered | MergeSystem (first merge of a chain:fromTier>resultTier; `state.discoveredRecipes`) | UIScene (cookbook-button dot + pulse), CookbookPanel (refresh while open) |
| ui:cookbook_opened | CookbookPanel.open | TutorialDirector (cookbook_intro gate) |
| region:unlocked | UnlockSystem | BoardScene (fog lift), AudioManager, OrderSystem, TutorialDirector (gate), Save |
| region:unlock_failed | UnlockSystem | BoardScene |
| marketplace:purchased | ShopPanel | TutorialDirector (gate) |
| tutorial:step | TutorialDirector | BoardScene (allow-list, highlights, camera nudges), UIScene (bubble, hand, arrow), Save |
| state:loaded | SaveSystem | BoardScene (fullResync), EnergySystem (offline regen), OrderSystem, GeneratorSystem (banks ≤3 offline passive cycles → `lastOfflineGifts`), UIScene (welcome-back card reads offlineMs/energyRecovered + lastOfflineGifts) |
| game:reset | GameContext | UIScene, DragonJobSystem |
| **ORPHANS** (emitted, zero subscribers — safe to consume, don't assume anyone hears them): | | `state:saved`, `order:all_done` |

## 2. Cross-file invariants — TOUCH X → CHECK Y

Value-level couplings the type system cannot see. Each broke (or nearly broke) once.

- **TOUCH `map.json` cols/rows, `tile`, or the `backgrounds` placement → RULE** you have
  moved the grid relative to the ART, so `mapSignature` changes and every existing save
  takes the re-grid path in `GameState.hydrate` instead of trusting its `(col,row)`. That
  path is the whole point of `src/core/mapSpace.ts` — read its header before touching any
  of those fields. **CHECK** `tests/unit/MapSpace.spec.ts` (it re-grids the SHIPPED map and
  asserts nothing is lost) and that the change is really intended: a signature change is
  cheap and safe, but it silently switches every player onto the recovery path.
- **TOUCH how a position is stored anywhere → RULE** a `(col,row)` alone is not a position
  any more. The world is about to become `world → zone → tile` with several worlds at
  different grid sizes, so a cell index is only meaningful next to the grid it indexes.
  Anything PERSISTED (saves) must carry a `PersistedPlace` beside the cell — art-anchored
  pixels that survive a re-grid. Anything AUTHORED (map.json, characters.json,
  emitters.json, tutorial.json) does not: it is re-derivable from the map it ships with,
  which is exactly what `MapSpace.spec` proves by round-tripping every authored cell.
- **TOUCH `src/core/iso.ts` → RULE** the module-level projection (`setProjection`,
  `gridToWorld`, `worldToGrid`) is correct ONLY inside a running BoardScene, which is the
  one place that sets it. Anything computing a coordinate outside a scene — saves, the
  re-grid recovery, scripts, unit tests — must use the pure layer (`projectionOf` /
  `project` / `unproject`) with a projection built from its own `map.tile`. *Trap it
  guards: a stored map point computed against the default 2:1 projection instead of the
  authored 420×242 one looks perfectly plausible and is silently wrong; nothing would
  reveal it until the migration, by which point every save carries the error.*

- **TOUCH chains.json tier order/ids → CHECK** texture keys `item_${chain}_${tier}` in
  assets.json + anchors.json + `ITEM_SCALE` keys (`chain_tier`), TextureFactory bespoke
  cases (keyed per tier), tutorial.json `{chain, nth, tier}` refs, `CHEST_GIFTS` tiers,
  BoardScene hardcoded keys (grep `item_ember_dragon`). *Bug precedent: chain reorder made
  `item_ember_dragon_1` mean "ruby" not "egg"; hatch ghost showed a ruby.*
- **TOUCH any PNG under assets/ (swap/resize) → CHECK** `ITEM_SCALE`/`DECOR_SCALE` in
  Constants (tuned to source pixel size), anchors.json origin, and the hand-derived hit
  rects in `BoardScene.acquireSprite` (crystal/chest/lumber-3/bigtree rects encode
  `displayW/H = px × scale`, origin-shifted by +76). Compiles fine, taps break silently.
- **TOUCH tutorial.json hint refs → RULE** always pin `tier` when a chain has multiple
  tiers on the board at that step. `resolveTileRef` filters chain-only otherwise and sorts
  by col+row — whatever randomness (CHEST_GIFTS roll, generator drops) is standing there
  wins. *Bug precedent: dragon_work hand pointed at a ruby.*
- **TOUCH assets.json `source` / file paths → CHECK** the loaderror ladder in
  PreloadScene → `TextureFactory.generate`: bespoke case > `item_*`/`decor_*` parcel
  stand-in (counter-scaled vs ITEM_SCALE) > `tile_*` moss tile > magenta (unknown only).
  A key with no case is only safe because of the prefix fallback.
- **TOUCH quests.json / orders.json / tasks.json / chains.json / map region contents /
  tutorial effects → RUN `pnpm quests`.** The quest ladder is the only thing the
  on-screen tracker reads, and every subquest must be satisfiable at the exact point it
  is asked. `src/core/availability.ts` proves that offline — it simulates the tutorial
  beat by beat, then classifies every piece as RENEWABLE / FINITE(n) / UNREACHABLE by a
  fixpoint over map seed → region reveal → tutorial spawn → generator → merge → order
  reward → chest → the scripted altar fixtures. `tests/unit/QuestAvailability.spec.ts`
  runs the same functions, so `pnpm verify` fails on a regression even if nobody runs the
  CLI. *Standing traps it guards: `cinder_vein` T3 and `moonwater` T3 are mathematically
  impossible in Chapter One (5→2 and 3→1 leave too few), and `firepine`/`dew_basin`/`nest`
  sit in `level_5` and stay in `HIDDEN_CHAINS`, which is what keeps them off the board.* See
  [quest-ladder.md](quest-ladder.md).
- **TOUCH `neighborsOf` / `buildAdjacency` / a zone's `u`,`v`,`origin`,`rotation` →
  CHECK** `Zones.spec.ts`. Adjacency is MEASURED from world pixels for every
  non-dense zone, so zone geometry is now merge rules: move a slab and you change
  what can merge with what. The authored dense lattice is exempt by category and
  must stay that way — a `beyond` slab is 80 px from an isle cell.

- **TOUCH a world's region `status`/`unlock` → RULE** a `locked` region is opened
  by NOTHING at runtime (`UnlockSystem` acts only on `unlockable`); only
  `WorldSystem.settleUnlocks` force-opens, and only for `unlock.level`. A region
  meant to be bought with keys must be authored `status: "unlockable"` +
  `unlock: { keys: n }`. And a LEVEL gate at or below a world's own `level` opens
  the instant the player arrives — which is how Borealis once unfogged all 141
  cells in one frame.

- **TOUCH a region's `contents` on an ACTIVE region → RULE** they reach the board
  only via `region:reveal`, which `WorldSystem` emits once per world on a FIRST
  arrival. `BoardSystem.newGame` seeds the authored world and nothing else, so a
  new world's opening board is this path or nothing.

- **TOUCH `OrderConfig.world` / `CHEST_GIFTS_BY_WORLD` / `ChainConfig.world` →
  RULE** three separate per-world tables, one reason: `state.items` is the board
  you are STANDING on. An order, a chest gift or a chain that ignores the world
  asks for — or hands over — a piece with no producer, no recipient and no order
  on that board. `pnpm quests --all` is the check.

- **TOUCH a `legendary` chain, a quest's `rewards.spawn`, or the ORDER of quests
  in quests.json → RUN `pnpm quests`.** The legendary egg arc is a directive
  (Constants §LEGENDARY_EGG_COUNT, docs/quest-ladder.md §6) enforced by
  `auditLegendaryArc`: three eggs, one per quest, spaced 3–4 apart, the third on
  the second-to-last quest and the last quest the hatch. **Quest ORDER is load-
  bearing** — reordering a ladder moves the arc and breaks the build. Adding a
  quest mid-ladder shifts every position after it.

- **TOUCH `QuestConfig.rewards` → RULE** it is paid by QuestSystem on the
  `q:done:<id>` latch flipping, NOT on `announce`, so a reload cannot pay twice.
  Any `spawn` goes out with `overflow: 'bag'`: a quest reward is authored once
  and never repeats, so a full board must bank it rather than drop it. Distinct
  from `orderId`'s payout — the Ledger pays for goods, the quest pays for story.

- **TOUCH zones.json worlds / add a world → RUN `pnpm quests --all`.** Each world is its
  OWN supply graph — `state.items` is the board you are standing on, so a Gem Shard in
  Emberkeep is not one in the north, and a world must be self-sufficient in everything its
  own quests ask for. Two warnings exist so an empty world cannot pass by having nothing
  to check: *no quest is tracked here* and *nothing arrives on this board*. **CHECK also**
  `QuestConfig.world` (the HUD tracks only the active world's ladder) and `chains.json`
  `world` vs `HIDDEN_CHAINS` — wrong-WORLD and wrong-CHAPTER are different withholdings
  and `chainHiddenIn` is the only predicate that may decide either.
- **TOUCH the `teleport` block in worlds.json → RULE** it is a map-editor placeholder and
  must NOT be wired. A world is opened by a quest step (`{kind:'world'}`), never by a
  merge: the shipped trigger names a hatch on `flame_gem`, which has no `hatchAtTier`, and
  would land the player in Borealis — reveal-ladder rung 11 — during Chapter One.
- **TOUCH a quest step id → RULE** step completion is LATCHED in `GameState.stats` as
  `q:<stepId>` (and `q:done:<questId>` per quest). Renaming a step re-opens it for every
  existing save. That is also why the ladder needed no `SAVE_VERSION` bump: `stats` was
  already persisted.
- **TOUCH DragonLifeSystem (wander cadence, mood rules) → RULES** (1) NOTHING here
  may read `Math.random()` — every schedule is derived from the item id and
  `GameClock.now()`, because a piece that MOVES on a random timer makes
  `window.advanceTime(ms)` irreproducible and the e2e suite flaky in a way that is
  very hard to trace back. `DragonLifeSystem.spec` asserts reproducibility. (2) A
  wander must never take a piece the player could merge: `mayWander` refuses when the
  dragon is orthogonally adjacent to its own chain+tier. Ambience is not allowed to
  cost the player anything. (3) It keeps NO counter — hunger is `DragonSystem.careOf`
  (the record feeding writes and the gauge draws) and sleep is `phaseAt`'s `night`.
  Adding a private clock for either is how the roar and the gauge start disagreeing.
  (4) Wandering is off for the whole tutorial: the board is the script's stage.
- **TOUCH the sleep paths → RULE** there are THREE ways to be asleep and they must
  all look like ONE thing (same curled painting, same breath): sleeping off a
  `DragonJobSystem` rest, the day clock's `night`, and an ambient nap. Order in
  `moodOf` is load-bearing: hungry > resting > working(awake) > night > nap. A dragon
  out WORKING is awake whatever the sky says, and a HUNGRY one does not sleep through
  it. The nap is stateless — a window inside `DRAGON_NAP_CYCLE_MS` whose offset is
  hashed off the item id — so it survives a reload, needs no save field, and stays
  reproducible under `advanceTime`.
- **TOUCH the sleeping breath → RULE** it is driven from `BoardItem.applyBob` off
  ABSOLUTE time, never a tween. `applyBob` is the one per-frame art hook, so it cannot
  fight the landing squash or the drag lift for the same two properties, and absolute
  time means the power governor's dropped frames slow it rather than desyncing it.
  Phase is hashed off the item id — two dragons asleep side by side must not inhale
  together. `setSleepBreath(false)` must restore the art scale, and waking must restore
  the STANDING texture: a pooled item released still wearing the curled art comes back
  as a sleeping dragon in another tile's clothes.
- **TOUCH DRAGON_ANIM cadence or the wander/nap intervals → RULE** this is a COZY game
  and the retune direction is always slower. A whelp should be still ~93% of the time,
  and whatever it does when it stops being still should be long enough to watch. If a
  number here goes DOWN, that is a deliberate design change, not a tuning tweak.
- **TOUCH a dragon's sleep art or `sleep_<chain>_<tier>` → CHECK** `ITEM_SCALE` and
  `anchors.json` for that key. The sleep painting is a DIFFERENT pose at its own
  resolution, so it can neither inherit the rig's scale (it would land at ~2× the
  tile) nor a standing dragon's 0.88 anchor (a curled body's contact point is the
  bottom of the art). A breed with no sleep art degrades to a dimmed rig plus the 💤
  — the behaviour is identical, only the portrait is missing.
- **TOUCH `chooseProduce` on a tier, or `BoardItemState.produces` → RULES** (1) a
  commissioned tier MUST still carry a `generator.produces` — that is what it makes
  until the player commits, and a tier without one leaves a closed chooser holding an
  ornament. (2) The commission is WRITE-ONCE (`GeneratorSystem.commission`); a
  re-pointable House is a menu, and the whole design is that a second output costs a
  second House. (3) Resolve output ONLY through `producesOf` — the passive tick, the
  offline catch-up and a tap must never disagree about what a House makes. (4) The
  chooser is suppressed for the whole tutorial: the script builds its own House and
  teaches the Warmth skip on it (`house_skip`), and a modal panel would fight that beat
  for the same tap. (5) `produces` rides `{...item}` into the save, so it persists with
  no `SAVE_VERSION` bump — but changing the FIELD NAME orphans every commissioned House
  in every existing save.
- **TOUCH `generator.bonus` on the Ancient Tree / Fir Tree → CHECK** the loop closes:
  `bigtree_1` and `firgrain_3` carry the SAME produce and the SAME bonus on purpose, so
  a grown tree is indistinguishable in play from the authored one. Change one and change
  both, or the tree the player grew is quietly worse than the one they were given.
  `TimberLoop.spec` and `pnpm quests --all` both check it (the audit proves the whole
  wood → grain → sapling → tree loop RENEWABLE).
- **TOUCH a `gift` step's chain/tier/count, or `REGARD_QUEST_POINTS`/
  `REGARD_POINTS_PER_HEART` → CHECK** `RegardSystem.spec`, which asserts BOTH that the
  gauge still fills in 15–20 quests and that no authored `regard` goal or
  `lockedUntil.regard` gate wants more hearts than its own world's ladder can have paid
  for by that point. A goal that outruns its ladder stalls the HUD forever — nothing but
  a quest or a gift pays Regard, so the player cannot grind past it. Gift progress is a
  LIFETIME counter (`gift:<who>:<chain>:<tier>` in `stats`), so changing a step's chain or
  tier re-opens it for every existing save exactly the way renaming a step id does.
- **TOUCH which pieces a person is asked for → RULE** the `gift` subquest is the ONLY
  want-list. `RegardSystem.wants()` derives it from the live ladder; do not add a second
  table in `characters.json` or the two will disagree about what she will take.
- **TOUCH LEVEL_XP or any tier `xp` → CHECK** tutorial pacing: the whole tutorial earns
  EXACTLY 60 XP (26 + 24 hatches + the `levelup` step's 10) and LEVEL_XP[1]=60, so Level 2
  lands ON the scripted `levelup` beat. LEVEL_XP[2]=220 is the FINALE curve (lands on
  Order 3's delivery — DEMO-PLAN §Act IV); the array deliberately ENDS at level 3.
  keeper:leveled(≥3) triggers the finale in BOTH BoardScene and UIScene (shared FINALE
  timeline in Constants). Camera glide is suppressed while the tutorial runs.
- **TOUCH world export → RULE** re-run BOTH `scripts/ingest-world.mjs` then
  `scripts/build-gamemap.mjs`. map.json is generated (hand edits clobbered). build-gamemap
  re-anchors tutorial start items by **+1,+4** and carves `level_2_gate` from the dozen
  nearest level-2 clouds; it asserts every fogged cell is an authored cloud.
  World CHARACTERS are the exception: ingest carries them into world-map.json but
  build-gamemap never sees them — they land in `src/data/characters.json` via
  `scripts/apply-characters.mjs` (or the builder's ⤒ Apply, same module), and ONLY
  the `anchor` moves. So a character move needs no map.json regeneration at all.
- **TOUCH STANDEE_BANKS or `sprites/<id>/world-*.webp` → RULE** both are GENERATED by
  `scripts/bake-standee.py` from `sprites/characters/<id>/world-standee/` — regenerate,
  don't hand-tune, and paste back the block it prints. Every frame of BOTH banks is
  registered onto one reference by her FEET and shares one frame box (union + a thin
  transparent margin, so no frame's content is ever flush against an edge), so
  the sprite origin is the baked `anchorX/anchorY` (NOT 0.5/1) and the hit rect comes
  from `body` (NOT the frame — the frame also holds the scepter blaze and the ember
  bolt). **CHECK** `BoardScene.buildWorldCharacters` and the `char_<id>` still in
  assets.json, which is the same bake's output. STANDEE_BANKS is the WHOLE roster,
  but PreloadScene only fetches banks whose `characters.json` `world` matches
  `WORLD_ID` — adding a character there costs nothing until her world ships.
- **TOUCH GameState fields → CHECK** `SaveSystem` (`toSave`/load + `SAVE_VERSION` — bump it
  or old saves half-load), `render_game_to_text()` shape (e2e reads it), `state:loaded`
  fullResync in BoardScene.
- **TOUCH main.ts / scene keys → RULE** keep `window.render_game_to_text`,
  `window.advanceTime`, `window.__emberkeep.{gridToPage,centerCell,grantXp,reset}` stable;
  e2e also taps the Title Play button at its current position.
- **TOUCH BoardScene update cadence → CHECK** the 500ms `time:advanced` emission: energy
  regen, passive generators AND dragon work-speed all derive from it. It must pass real
  elapsed ms (not 0) — jobs multiply that delta into House timers.
- **TOUCH rig.json / rig joint names → RULE** names come from LOCKED lists in
  tools/rigger (`LAYER_PARTS`, `ANCHOR_NAMES`, `PIN_NAMES`); `rigAnimations` resolves
  anchor → pin-chain → bare-layer → skip. Game + animator tool must keep the same order.
  `root_ground` pin is required.
- **TOUCH head-animation frames OR the rig's head layer/anchor → RULE** re-run
  `scripts/calibrate-faces.mjs` — `src/data/faces.json` is GENERATED calibration
  (per-set textureScale/origin) and self-verifies (content-scale drift ≤0.5px,
  silhouette IoU ≥94%). Frame ORDER is semantic: blink `[open,half,closed,half2]`,
  talk `[closed,half,wide,half2]` — `faceAnimations.ts` indexes into it. Consumed
  by BoardScene (`FACES`) + `RigPlayer.attachFace`; `pose.mouth` is recorded by
  rigAnimations' `jaw()`. Visual check: `node tools/checks/facetest.mjs`.
- **TOUCH UI element structure (Hud pills/buttons, bubble, tooltip, panels) →
  CHECK** the `uiRegistry.register` calls in those constructors (part names are
  the UI Builder's layer ids AND the keys inside saved `ui-theme.json` patches —
  renaming a part orphans saved overrides) and `tools/checks/uibtest.mjs`. ui-theme.json
  is GENERATED by tools/uibuilder via the dev endpoint `/__uibuilder/theme`
  (vite.config.ts); empty doc = authored look. Scenes may set depth AFTER
  registration — the registry only writes depth when overridden. Its `custom`
  section holds tool-authored components (image/text/rig layers) instantiated
  by `CustomUiManager` at boot; rig layers reference `characterCatalog` ids +
  rigAnimations preset keys — renaming presets/characters orphans saved layers.
- **TOUCH ui_* chrome painters (button/panel/card/pill/slot) → CHECK**
  `UI_TEXTURE_PARAMS` defaults stay in sync with the painter's actual colors,
  and `TextureFactory.regenerate` still repaints IN PLACE (CanvasTexture only —
  never delete/re-add the key, live Images hold the texture object).
- **TOUCH blink cadence → WHERE** `BlinkScheduler` in `faceAnimations.ts` (NOT the
  presets — a fixed `t`-based blink there makes all dragons blink in unison).
  RigPlayer owns one per rig and injects `pose.eyelid`; ranges `BLINK_GAP_CALM`/
  `BLINK_GAP_EXCITED`. Runs on frame delta, not GameClock (cosmetic, doesn't
  affect `advanceTime` determinism). anim-tuning.json's `blinkGapSec` is reference-only.
- **TOUCH RES / GAME_WIDTH → CHECK** every coordinate is authored in 2560×1600 space;
  CSS/e2e coords are game÷2; TextureFactory paints ×RES; `gridToPage` maps through the
  board camera worldView.
- **TOUCH depth logic → RULE** items sit at `itemBase + y` (board spans ~5100 screenY),
  fog at +2, dragged/particles/flash at 50000+. Never tie top bands to a small const.
- **TOUCH pooled BoardItem lifecycle → RULES** `acquire()` must fully reset (texture,
  origin, scale, tint, art visibility — pooled item may have been a hidden rig host);
  never `disableInteractive()` on release; hide rig hosts via `setArtVisible(false)` only
  (`setAlpha(0)`/`setVisible(false)` kill hit-tests); one scale tween per sprite; container
  hit rects are origin-shifted (+76) and ≤ one iso row above tile centre.
- **TOUCH GameClock → RULE** `Date.now()` banned in gameplay; determinism of
  `advanceTime()` is what makes the unit + e2e suites meaningful.
- **TOUCH board-dragon feeding (`BoardItemState.care`) → CHECK** `DragonSystem.feedBoardDragon`
  (the only writer), `careOf` (READ-ONLY — it reports a day rollover without committing one,
  so merely looking at a dragon never dirties the save), `MergeSystem.bestCare` (the record
  survives the merge that grows the dragon, at the best of what went in), and
  `StatusPanel.paintDragon`. Board dragons are NOT `Companion`s: companions come from a Cold
  Nest, are named, and never touch the merge board. Chapter One has no nest, so its dragons
  are items — hence a per-ITEM record, the same shape the House's commission takes. Growth is
  deliberately absent: a board dragon grows by MERGING, and a second ladder to tier 4 would
  make one of the two a lie.
- **TOUCH dragon naming (`BoardItemState.dragonName`) → CHECK** `DragonSystem.nameBoardDragon`
  (write-once, real dragons only), `MergeSystem` (the name rides the merge — dropping it is the
  one way a board dragon breaks the naming law), `StatusPanel.paintDragon` (name beats breed),
  and `CharacterBubble.setToken('dragon', …)` fed by UIScene off `dragon:named`. NamePanel
  serves BOTH subjects now: a nest hatchling emits `ui:companion_named`, a board dragon
  `ui:dragon_named` — same panel, one union, do not fork it.
- **TOUCH `CharacterBubble.paintHighlight` → RULE** Phaser `Text` is one colour per object. The
  lava name is drawn OVER the label's own glyphs on a patch of the card's flat `0xfffdf6`
  paper, reusing `getWrappedText` so the runs land on the label's real wrap. If the card's fill
  ever stops being a flat colour behind the text column, or the label gains padding/stroke,
  this overlay has to be re-derived — and the per-row advance is computed from the measured
  line box, never `height / lines.length` (that drifts and clips the patch).
- **TOUCH the status readout → CHECK** `ui:subject_selected` / `ui:subject_cleared` are emitted
  ONLY by `BoardScene.selectSubject`/`clearSubject`, and selection is deliberately NOT arming
  (a dragon is never armed, and a second tap on a character puts both away). `item:removed`
  must clear a selected dragon or the readout outlives its subject. The panel's enable latch
  lives in UIScene (`statusTaught`) — every other `allow` flag is a permission a later beat may
  take back; this one is a taught concept, so it only ever turns on.
- **TOUCH `QUEST_TRACKER_BOTTOM`/`_TOP_Y`/`_RIGHT` (QuestTracker) → CHECK** StatusPanel seats
  itself from those three exports. Change the row pitch or the visible-row count and the
  readout moves with it; hardcode a copy and it will overlap the list the first time either
  changes.
- **TOUCH `HIDDEN_CHAINS` → RULE** a chain leaves that set only when the chapter can FINISH
  it. `resin` left it because the tutorial now discovers both its Cookbook rows
  (`resin_find` → `resin_merge` → `hearth_cake`) and `house_commission` makes it renewable
  afterwards. Removing a chain without both halves puts a permanent "· · ·" row in the book.

## 3. High-fanout cascades (one change, many screens)

- `item:merged` → sprites gather/pop + audio + order progress + tutorial gate +
  `economy:add`(xp) → maybe `keeper:leveled` → region unlock + fog lift + **camera fly** +
  RewardSystem. A merge can move the camera.
- `time:advanced` → energy regen + every passive generator + dragon fatigue. Any code
  emitting it (tests do!) advances the whole economy.
- `item:removed` → five subscribers incl. DragonJobSystem (cancels jobs) and
  TutorialDirector. Removing items programmatically mid-tutorial can strand a gate.
- `state:loaded` → BoardScene.fullResync destroys/rebuilds ALL sprites + rigs. Anything
  holding a BoardItem reference across it is stale.

## 4. Cold-start read order (new session, zero context)

1. `CLAUDE.md` → 2. `src/core/types.ts` (EventContract) → 3. `src/core/Context.ts`
(wiring) → 4. this file → 5. the one system/scene the task touches. `docs/GDD-L1.md` /
`MECHANICS.md` for design intent; `pnpm verify` before calling anything done.
