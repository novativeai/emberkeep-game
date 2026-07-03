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
| ui:deliver_requested | LedgerPanel | OrderSystem |
| ui:sell_requested | Tooltip | EconomySystem |
| ui:shop_requested | Hud | UIScene |
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
| item:merged | MergeSystem | BoardScene, UIScene, AudioManager, OrderSystem, TutorialDirector (gate), Save |
| item:hatched | MergeSystem | BoardScene (hatch ceremony), AudioManager, TutorialDirector (gate) |
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
| keeper:leveled | EconomySystem | UnlockSystem (level regions lift), RewardSystem, BoardScene (camera fly), UIScene, AudioManager |
| order:progress | OrderSystem | Hud, LedgerPanel |
| order:completed | OrderSystem | Hud, LedgerPanel, UIScene, AudioManager, TutorialDirector, Save |
| region:unlocked | UnlockSystem | BoardScene (fog lift), AudioManager, OrderSystem, TutorialDirector (gate), Save |
| region:unlock_failed | UnlockSystem | BoardScene |
| marketplace:purchased | ShopPanel | TutorialDirector (gate) |
| tutorial:step | TutorialDirector | BoardScene (allow-list, highlights, camera nudges), UIScene (bubble, hand, arrow), Save |
| state:loaded | SaveSystem | BoardScene (fullResync), EnergySystem (offline regen), OrderSystem |
| game:reset | GameContext | UIScene, DragonJobSystem |
| **ORPHANS** (emitted, zero subscribers — safe to consume, don't assume anyone hears them): | | `state:saved`, `order:all_done` |

## 2. Cross-file invariants — TOUCH X → CHECK Y

Value-level couplings the type system cannot see. Each broke (or nearly broke) once.

- **TOUCH chains.json tier order/ids → CHECK** texture keys `item_${chain}_${tier}` in
  assets.json + anchors.json + `ITEM_SCALE` keys (`chain_tier`), TextureFactory bespoke
  cases (keyed per tier), tutorial.json `{chain, nth, tier}` refs, `CHEST_GIFTS` tiers,
  BoardScene hardcoded keys (grep `item_ember_dragon`). *Bug precedent: chain reorder made
  `item_ember_dragon_1` mean "ruby" not "egg"; hatch ghost showed a ruby.*
- **TOUCH any PNG under assets/ (swap/resize) → CHECK** `ITEM_SCALE`/`DECOR_SCALE` in
  Constants (tuned to source pixel size), anchors.json origin, and the hand-derived hit
  rects in `BoardScene.acquireSprite` (crystal/chest/lumber-2/bigtree rects encode
  `displayW/H = px × scale`, origin-shifted by +76). Compiles fine, taps break silently.
- **TOUCH tutorial.json hint refs → RULE** always pin `tier` when a chain has multiple
  tiers on the board at that step. `resolveTileRef` filters chain-only otherwise and sorts
  by col+row — whatever randomness (CHEST_GIFTS roll, generator drops) is standing there
  wins. *Bug precedent: dragon_work hand pointed at a ruby.*
- **TOUCH assets.json `source` / file paths → CHECK** the loaderror ladder in
  PreloadScene → `TextureFactory.generate`: bespoke case > `item_*`/`decor_*` parcel
  stand-in (counter-scaled vs ITEM_SCALE) > `tile_*` moss tile > magenta (unknown only).
  A key with no case is only safe because of the prefix fallback.
- **TOUCH LEVEL_XP or any tier `xp` → CHECK** tutorial pacing: whole tutorial ≈54 XP must
  END at level 1; `levelup` step grants 10 XP; first real level-up fires
  `keeper:leveled` → zone-2 fog lift + camera fly. Changing xp values moves WHEN a camera
  animation plays and can fire it mid-tutorial (glide is suppressed only while tutorial runs).
- **TOUCH world export → RULE** re-run BOTH `scripts/ingest-world.mjs` then
  `scripts/build-gamemap.mjs`. map.json is generated (hand edits clobbered). build-gamemap
  re-anchors tutorial start items by **+1,+4** and carves `level_2_gate` from the dozen
  nearest level-2 clouds; it asserts every fogged cell is an authored cloud.
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
