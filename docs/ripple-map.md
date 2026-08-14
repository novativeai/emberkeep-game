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
| ui:gift_deliver_requested | LedgerPanel (the GIFT-ASK card — the active quest's give step worn as an order) | RegardSystem (accepts each piece as a bag give would, THEN consumes it from the board) |
| order:give | RegardSystem (a give no gift step wants, but the giver's live order needs — decided via OrderSystem.giveTarget, read-only) | OrderSystem (banks it under `orderGiveKey`; a FULLY-given order completes on the spot) |
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
| chest:claimed | ChestSystem | BoardScene |
| dragon:working | DragonJobSystem | TutorialDirector (gate) — BoardScene animates in startDragonWork, not via this event |
| dragon:rest / dragon:rested | DragonJobSystem | BoardScene |
| energy:changed | EnergySystem, BoardSystem | Hud, Save |
| economy:changed | EconomySystem, BoardSystem | Hud, AudioManager, Save |
| keeper:leveled | EconomySystem | UnlockSystem (level regions lift), RewardSystem (Gold + refill + **chest from level 3**), BoardScene (camera fly to the opened region — skipped for perk-only levels and for the altar's level pre-awakening), UIScene (banner), AudioManager |
| order:progress | OrderSystem (one per VISIBLE order — payload orderId matters; `have` counts board + hand-given bank), RegardSystem (the active quest's gift asks under `gift:<stepId>` ids, incl. a final deliverable:false when an ask retires — the Hud dot has no other off-switch for them) | Hud (dot = ANY deliverable), LedgerPanel |
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

- **TOUCH a Keeper's Task target, or the supply behind one → RUN `pnpm quests`.**
  A counter task is not an item ask, so nothing in the ladder audit used to look
  at it — which is how **"Hatch 4 dragons" survived the decision to make dragons
  scarce and dear** and quietly became a wall. It is now `recipes_20`
  ("Discover 20 Cookbook recipes"), and `auditLadder` checks a `recipes` target
  against the Cookbook rows actually printable AT THE STEP THAT ASKS
  (`recipeKeysFrom`). The other kinds are unbounded by construction — gold,
  merges and orders all come off renewable loops — so `recipes` is the only one
  with a ceiling the data can state.
  Two numbers worth keeping in view when retuning it: the tutorial alone
  discovers **13** recipes, and **27** rows are reachable by the time the
  checklist is asked. A target at or below 13 is a task that is already done.

- **TOUCH map decor's `at`/`scale`/`anchor` in build-zones' `DECOR`, or a decor
  clip → CHECK the prop against its PAINTING, not against the grid.** `at` is a
  point on the backdrop; the cell is only the index that point falls in, which is
  why the ground shadow is drawn under the SPRITE and not under the cell (they
  are a nudge apart on the authored isle and most of a tile apart for Runevault's
  cauldron). A decor piece's animation lives in `character-anims.json` under a
  key equal to the DECOR NAME (`pink_cauldron`, not `cauldron`) with
  `stage: 'decor'` — that key is what `clipsFor(d.name)` looks up in worldArt,
  PreloadScene and `BoardScene.playDecorClip`, so a mismatched key costs the
  motion silently and the still just stands there. `CharacterAnims.spec` holds
  the key to the map-decor roster for that reason. The clip registers onto the
  STILL (scale = still px per atlas px, dx/dy = the frame's top-left in still
  px), so re-cutting the art means re-deriving all three.
- **TOUCH a cauldron recipe's inputs, or a `brew` quest step → RUN `pnpm quests`
  AND check `RUNEVAULT_QUESTS_NEEDED`.** Three couplings, none of them visible
  from the recipe: (1) a brew step is CHARGED its recipe's inputs × `count` in
  the world that asks, so widening a recipe can make a northern quest
  UNREACHABLE — and a recipe reaching for another world's goods would send the
  player back through a portal mid-step with no word of it on screen
  (`chainHiddenIn` is asserted over every quest-brewed input). (2) The pot stands
  through the Rune Way, whose gate counts FINISHED Selyna quests; it must clear
  before the ladder's first brew quest, which is why the constant is 2 and the
  first brew is quest 3. (3) The north's rhythm is merge/cauldron alternation
  from that quest on — `QuestAvailability.spec` fails the build if two brews
  land back to back, or if the first one leaves the 15–20% window. Free-play
  recipes (the eggs, Hearth Cake) that no quest names carry none of this.
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
- **TOUCH anything that reads `phaseAt` or a nap window → RULE for TESTS**
  `GameClock.now()` is `Date.now() + offset`, so the ABSOLUTE clock differs on every
  run and with it the day phase and every nap offset. A test asserting a dragon's mood
  must PIN the phase first (advance to a known phase start) or claim only what it
  means — `not.toBe('hungry')` rather than `toBe('awake')`. A test that demands `awake`
  at an unpinned moment passes or fails depending on the hour it runs at, which is the
  worst kind of flake to trace.
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
  second House. (2b) The commission is RANK-CAPPED (`produceMaxTier`, default 1): a
  House takes tier-1 pieces only, a Manor (now `chooseProduce` too) tiers 1–2.
  `GeneratorSystem.commission` refuses `tier_too_high`, the chooser renders over-rank
  bag slots locked (🔒, shake on tap — visible so the player learns what a Manor
  buys), and the `house_commission` beat cites the rule. `TimberLoop.spec` pins both
  sides. (3) Resolve output ONLY through `producesOf` — the passive tick, the
  offline catch-up and a tap must never disagree about what a House makes. (4) The
  chooser is suppressed for the whole tutorial: the script builds its own House and
  teaches the Warmth skip on it (`house_skip`), and a modal panel would fight that beat
  for the same tap. (5) `produces` rides `{...item}` into the save, so it persists with
  no `SAVE_VERSION` bump — but changing the FIELD NAME orphans every commissioned House
  in every existing save.
- **TOUCH a sleeping dragon's ITEM_SCALE → DERIVE IT FROM THE RIG, not from a tile.**
  The curled painting stands in for a live `RigPlayer`, and the rig renders at
  `DRAGON_ANIM.whelpScale × DRAGON_RIG_SCALE[chain(:tier)]` over its baked sheet
  (`item_ember_dragon_*` IS the rig at native resolution) — so the target is
  `bakedAlphaBboxWidth × thatProduct`, divided by the sleep art's own bbox width. The
  first pass read the `666` in `addGroundShadow(…, 666 * scale, …)` as the rig's width
  and dropped `DRAGON_RIG_SCALE` entirely, which put the sleeping whelp at 306 units
  against a 160-unit dragon. **666 is a shadow width.** Get the rig art's number.
- **TOUCH the sleep anchor, `SLEEP_BREATH.lift`, `setSleepBreath`'s `groundY`, or who
  owns the shadow while a dragon sleeps → CHECK it still lies ON the floor.** Four
  things cooperate and any one of them lifts it off: the sleep anchor in `anchors.json`
  is the art's own alpha-bbox BOTTOM (0.9932 / 0.9942, not a guessed 0.97); the belly is
  then SEATED `-DRAGON_ANIM.groundLift` (20px) below the container origin via
  `setSleepBreath`'s `groundY` — the floor line the rig's FEET stood on and the line its
  shadow was tuned to, because a belly left at the origin itself hovers exactly that gap
  above the shadow; `applyDragonMood` keeps the RIG's ground shadow (`ld.shadow`, on
  that line via `syncDragon`) and hides the item's own (`setGroundShadowVisible(false)`),
  so there is one shadow and the dragon is on it; and `SLEEP_BREATH.lift` is **0**
  because `amount` alone raises the ribcage off a planted belly. A non-zero lift moves
  the whole animal, which reads as hovering, not breathing.
- **TOUCH the 💤, or move a sleeping dragon → RULE the marker RIDES `syncDragon`.** The
  💤 is a container at the host's position whose inner text tweens in HOST-LOCAL space
  (`0,-150 → -210`); `syncDragon` re-seats the container every frame like the rig and
  the shadow. Tween the marker's own x/y in WORLD space and a dragged or wandering
  sleeper leaves its 💤 hanging over the tile it left.
- **TOUCH a dragon flight (wander / flourish / work), or a new one → RULE depth FOLLOWS
  the flight.** Every flight tween carries `onUpdate: () => sprite.settleDepth()`
  (itemBase + y each frame) and none sets `DEPTHS.dragged`: the always-on-top band is
  for the player's OWN hand (drag), and a self-moving dragon in it glides over UI
  badges and every tall landmark on the isle. Natural y-sorting also means the
  flourish/work flights no longer need their depth restored in `done()` — but
  `settleDepth()` stays there for the frame the tween ends off-target.
- **TOUCH key badges, `economy:changed`, or a region's `unlock.keys` → RULE a badge is
  EARNED into view.** `syncKeyBadges` shows a region's bronze key only while the Keeper
  HOLDS ≥ that region's key cost (and never mid-tutorial except the `key_unlock`
  lesson); post-tutorial the appearance plays a queued cinematic (glide + zoom-in, key
  pops gold, camera home). Borealis is why: both its isles are key-gated and floating
  both keys on arrival promised gates the player hadn't earned — now the coast's key
  appears when Selyna's first order pays it, the keep's when the second is banked.
  Loads/arrivals/tutorial steps sync QUIETLY (states, not moments). Spending keys
  re-hides what is no longer covered; `onRegionUnlocked` still lifts the badge away.
- **TOUCH a dialogue speaker's portrait, or add an animated speaker → RULE the split
  treatment keys on `_disc`, never on a name.** `CharacterBubble.layout()` applies the
  head-above-frame / body-behind-frame split to WHATEVER disc sheet is mounted
  (`texture.key.endsWith('_disc')`), matching `setSpeakerArt`'s `isAnimatedSpeaker`
  gate. It used to compare against `ELEANOR_DISC_TEXTURE`, so Selyna — animated, disc
  loaded — fell into the static-medallion branch and her bust floated above the ring
  (centre-position maths under a bottom-anchored origin). A new speaker needs: the
  `ANIMATED_SPEAKERS` entry, a disc bake, the Preload spritesheet — and nothing here.
  Since the Align Studio: a speaker with PORTRAIT-stage clips in
  `character-anims.json` (talking/blinking — Eleanor AND Selyna) bypasses the disc
  path entirely: `trySetAtlasPortrait` owns the ring with the SAME split (body copy
  masked behind the band, neck-cropped head copy above it — `portrait:
  {height, dy, headCrop}` per character), `layout()` keys the branch on `canim_`,
  and `PortraitAnimator` stays inert by its `_disc` guard. Talking/blinking are
  BUBBLE-ONLY — the board never plays them; the board's clips are idle/cast (+
  Eleanor's happy/laugh reactions).
- **TOUCH a dragon flight/sleep beat, or a standee cast/reaction → RULE the
  Align-Studio clip is the DEFINITIVE animation for its event when pushed.**
  Flight is PHASED (`dragonHover`/`dragonLand`/`dragonIdle`): takeoff → seamless
  cruise loop → landing, with a journey's landing led `DRAGON_ANIM.landingLeadMs`
  before touchdown, and drag hold/release mapping to loop/landing. SLEEP NEVER
  HAPPENS IN THE AIR: `dragon:mood` asleep while busy/airborne only records the
  mood, and `dragonIdle` — the one door onto the tile — seats the curl-up
  (`seatDragonSleep`, `sleepState`); the wake path only undoes a SEATED sleep.
  The dragon's grounded REST is the video-ingested `idle` clip (`dragonIdle`
  plays it on attach, wake, post-roar and every touchdown — the rig idle only
  without it) and EVERY bellow is the `roar` clip (`playRoarClip`: the hungry
  cadence, the newborn intro's arrival, and the AMBIENT cadence — one bellow
  after every 3–5 idle loops, `armIdleRoar` counting ANIMATION_REPEAT so only
  watched stillness accrues; one-shot, `remainMs` held to the clip's real
  length). The seated SLEEP is the tosleep clip's frozen LAST
  frame breathing in `syncDragon` — the sleep painting is only the no-clip
  fallback, never a cut after the transition. CLIP-COMPLETE breeds
  (red/frost/storm × baby/adult) carry NO RIG — `LiveDragon.player` is null,
  facing lives on `ld.facing`, and every `ld.player` touch must stay guarded.
  The worn Emporium skin picks the clip character
  (`dragonClipCharacter(chain, tier, skin)`); `applyDragonSkin` REBUILDS live
  animals (mood carried), and a sleeper without its own painting sleeps as
  its dimmed idle frame — a Frost dragon must never sleep in the red art. TWO INVARIANTS guard the machine:
  (1) every clip SWITCH goes through `dressOverlay` (transform applied
  synchronously) — mood events land in update()'s `time:advanced` tail AFTER
  updateLiveDragons ran, so waiting for syncDragon renders one frame of the
  new texture in the old clip's scale (the giant-flash bug); (2) `sleepState`
  resets whenever a flight/bellow takes the overlay, and `updateLiveDragons`
  re-seats any grounded sleeper whose seat got knocked over — a stale
  seated/transition once no-opped every later seatDragonSleep and froze the
  dragon in rig idle for a whole nap/night. `playStandeeCast` prefers the
  atlas cast over the bank one-shot; `regard:gift_accepted`/`regard:heart` play
  happy/laugh. The pre-atlas paths all survive as no-clip fallbacks — never in
  parallel. Clip roster + triggers: `scripts/apply-anim-align.mjs` (ROSTER),
  wiring table in docs/pipelines.md; video → atlas ingest:
  `scripts/anim-ingest.py` (technique: assets/raw/new-animations/raw-mp4/ATLAS_TUTO.md).
- **TOUCH the Ledger's face/title, or author orders for a new world → RULE the Ledger
  belongs to whoever keeps it HERE.** `OrderSystem.giverHere` derives the host from the
  orders data (first order whose `world` matches); `LedgerPanel.refresh` sets the tab
  title + empty text from it and mounts each card's medallion from the ORDER's own
  `giver` (`setMedallionGiver`, frame 0 of their disc atlas). No world→host table
  exists anywhere — a third world's Ledger is right the moment its orders carry
  `giver`/`world`.
- **TOUCH how a tap lands on a dragon → RULE dragons speak GENERATOR, not a dialect.**
  The bespoke Job menu (Work ⛏️ / Harvest ✋, `DRAGON_MENU`) is deleted: a cooling
  dragon offers the SAME Gold/Warmth skip pair as every generator (`showSkipButton`),
  a ready one harvests on the tap itself, and work is the drag-onto-a-House the
  `dragon_work` beat teaches. Do not reintroduce a second verb UI for one item kind;
  the status readout (`selectSubject('dragon', …)`) is the only dragon-specific tap
  effect left. The flourish also skips any dragon whose `moodOf` is `asleep` — theatre
  never wakes a sleeper, and the harvest it decorates has ALREADY paid out.
- **TOUCH `CHEST_GIFTS` → CHECK what the audit loses.** The chest is a permanent renewable
  SOURCE in `availability.ts`, so deleting a gift can strand a quest that had no other
  supply: dropping the Emeralds is what made the old brood quest and `hatch_4`'s
  Green Dragon UNREACHABLE, and both had to be retargeted onto `ember_dragon`.
  Both are gone entirely now — `hatch_4` to the counter-task rule below, and
  `the_emerald_brood` because dragons are RARE (the red one is meant to be
  unique and the Dragon Ruby is leaving the merge board, so "Make 4 Red Eggs"
  was asking for a thing the game no longer wants to exist four of). The `anyItem`
  wildcard is deliberately NOT counted as a source (it names no chain, so nothing can
  rely on it), and `chestWildcardChains` is the only thing standing between a random
  table and the Legendary Egg Directive — `pnpm quests` asserts the roster itself, not
  just the written gift lines. Deleting a quest id has the same save consequence a
  RENAME does — its `q:done:` latch is orphaned and the per-world counter
  `q:world:<id>:done` runs one short for anyone mid-chapter.
- **TOUCH `generator.bonus` on the Fir Tree → CHECK** the loop closes. `firgrain_3` is
  now the ONLY tree the isle has: `bigtree_1` was removed from `level_2`'s contents
  because a free Ancient Tree made the fir loop the tutorial teaches pointless. The chain
  and its art stay (it is a single-tier fixture, so it was never a Cookbook row), but
  nothing places one, and lumber's renewability rests entirely on the tree the player
  grows at `fir_grow`. `TimberLoop.spec` and `pnpm quests --all` both check it — the
  audit proves the whole wood → grain → sapling → tree loop RENEWABLE, and if that
  bonus breaks, timber goes FINITE for the whole chapter rather than merely slower.
- **TOUCH a tutorial `spawn`'s `nearChain` → CHECK the anchor exists BY THAT STEP.**
  `BoardSystem.spawn` falls back to "near any item, else the origin" when the anchor is
  missing, so a broken anchor does not throw — the pieces just land somewhere the line
  is not pointing at, and the `arrow`/`highlight` that names the same piece silently
  draws nothing. `tree_grain` anchors on `lumber:3` (the House raised one beat earlier);
  `resin_find` and `resin_pocket` anchor on `firgrain:3`, which is why neither may be
  reordered before `fir_grow`.
- **TOUCH a region's `tiles` in map.json → CHECK the screen-space picture, not the list.**
  Fog is per REGION (`BoardScene.buildFog` skips `active` ones), so a playable cell left
  in `level_1` while its neighbours sit in a locked region renders as a bare grass diamond
  punched through the cloud bank. Cell (4,1) was exactly that hole at the north tip and is
  now `level_5`. Plot `(col-row, col+row)` before believing a region reads as one mass —
  a grid-order tile list gives no hint of it. Keep `src/data/world-map.json`
  (`startClearing` / `fogRegions[].cells`) in step, or the next ingest re-opens the hole.
- **TOUCH the ORDER of `quests.json` → CHECK four things that are positional, not
  written down in the quest.** (1) The legendary eggs are chosen by completable
  INDEX — re-ordering re-chooses which quests must carry `rewards.spawn`, and
  `auditLegendaryArc` fails on gaps outside 3–4 or a last egg that is not
  second-to-last. (2) `orders.json`'s scripted list is served two at a time in
  FILE order, so a quest must not sit ahead of the order it waits on; keep the
  file in the order its quests consume it. (3) A moved quest is asked at a
  different Level with fewer regions open — `pnpm quests` is the only thing that
  knows whether its chain is reachable there (Moonwater at slot 2 is not).
  (4) `what_she_keeps` and `north_terms` gate on hearts the earlier quests must
  already have paid (see the Regard entry below). Unit tests pin the first two
  ladder positions by id, so a reorder that breaks nothing still reddens
  `QuestSystem.spec` / `OrderSystem.spec` — that is the reorder telling you it
  moved something the game reads by position.
- **TOUCH a `gift` step's chain/tier/count, or `REGARD_QUEST_POINTS`/
  `REGARD_POINTS_PER_HEART` → CHECK** `RegardSystem.spec`, which asserts BOTH that the
  gauge still fills in 15–20 quests and that no authored `regard` goal or
  `lockedUntil.regard` gate wants more hearts than its own world's ladder can have paid
  for by that point. A goal that outruns its ladder stalls the HUD forever — nothing but
  a quest or a gift pays Regard, so the player cannot grind past it. Gift progress is a
  LIFETIME counter (`gift:<who>:<chain>:<tier>` in `stats`), so changing a step's chain or
  tier re-opens it for every existing save exactly the way renaming a step id does.
- **TOUCH the deliver or give path → RULE** they are ONE verb in two grammars and must
  stay interchangeable both ways: a bag GIVE of a piece the giver's live order needs is
  banked toward that order (`order:give` → `orderGiveKey` stat; a fully-given order
  completes on the spot, and `progressFor` counts board + bank so the Deliver button
  lights either way), and the Ledger's Deliver works on a live GIFT step too (the
  gift-ask card → `ui:gift_deliver_requested` → RegardSystem accepts per piece, then
  consumes from the board). Order-gives pay NO Regard (points 0 — the button pays none
  either); gift-step delivers pay full per-piece Regard (a bag give would). The bank is
  cleared on completion so a repeatable's encore starts from zero.
- **TOUCH which pieces a person is asked for → RULE** the `gift` subquest is the ONLY
  want-list. `RegardSystem.wants()` derives it from the live ladder; do not add a second
  table in `characters.json` or the two will disagree about what she will take.
- **TOUCH LEVEL_XP or any tier `xp` → CHECK** tutorial pacing: the whole tutorial earns
  EXACTLY 60 XP (26 + 24 hatches + the `levelup` step's 10) and LEVEL_XP[1]=60, so Level 2
  lands ON the scripted `levelup` beat (`pnpm quests` errors if not). The curve runs to
  SIX levels: L3=220 (crosses on `eleanor_hearth`'s delivery; opens `level_5`; the
  Borealis door's rank floor), L4=420 (`beyond_l4`), L5=1000 (`beyond_l5`), L6=1400 cap.
  Keep every threshold OUT of the `keepers_hoard` XP window (~550–810): the finale fires
  on that quest's completion, and a level-up glide must not fight its camera. Changing
  LEVEL_XP also moves the build-zones `LEVEL_CAP` (hand-synced) — regenerate zones.json
  or 'beyond' ground goes stale. Camera glide is suppressed while the tutorial runs, for
  perk-only levels (no level region in the active map), and for the altar's level while
  the awakening quest is unfinished.
- **TOUCH keeper:leveled handlers → RULE** RewardSystem also drops a Bronze Chest
  (`board:spawn`, overflow to Bag) from `LEVELUP_REWARD.chestFromLevel` (3) on — never
  below it, or the tutorial's scripted `levelup` beat grows an unscripted interactive
  object. WorldSystem.settleUnlocks mirrors UnlockSystem's gates ('unlockable' only,
  never key-priced) and settles through `region:reveal` so contents spawn; it runs AFTER
  seed() or a first-arrival region would reveal twice.
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
