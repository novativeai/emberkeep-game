# Tutorial Master Skill

## What a tutorial step is made of

Every step in `src/data/tutorial.json` produces a `TutorialStepEvent` that
simultaneously controls four visual layers rendered by UIScene + CharacterBubble:

```
┌─────────────────────────────────────────────────────┐
│  CharacterBubble (bottom of screen, UIScene layer)  │
│  ┌──────────┐  Speaker name          ▼ tap chevron  │
│  │ Portrait │  Dialogue text (max ~4 lines at 38px) │
│  └──────────┘                                       │
└─────────────────────────────────────────────────────┘
      ▲                                      ▲
 hand sprite                           arrow sprite
 (drag loop or point pulse)            (tile / UI / fog, vertical bob)
```

The board cells listed in `highlight` get a golden border glow.
The `allow` block restricts/enables everything else while the step is live.

---

## The three files to touch for ANY tutorial change

| File | What you edit |
|------|--------------|
| `src/data/tutorial.json` | Add / edit / reorder steps (the full scenario) |
| `src/systems/TutorialDirector.ts` | New gate types, new effect types, resolve logic for new `TileRef` forms |
| `src/scenes/UIScene.ts` | New hand/arrow target types (new `uiTarget()` variants, new placement modes in `placeHand()`) |

`src/entities/CharacterBubble.ts` — only touch for bubble layout/style changes.
`src/core/types.ts` — add new union arms when adding gate/allow/hand/arrow variants.

---

## tutorial.json anatomy

```jsonc
{
  "id": "unique_step_id",        // string — used for logging and gate checks
  "speaker": "pip",              // "pip" | "cindra" | "laurah"
  "text": "Dialogue text here.", // shown in CharacterBubble
  "gate": {
    // How the step is dismissed:
    "type": "tap"                // player taps the bubble (chevron pulses)
    // OR
    "type": "event",
    "event": "item:merged",      // EventBus event name
    "chain": "ember_dragon"      // optional: only specific item chain
    // OR
    "type": "count",
    "event": "item:spawned",
    "chain": "ember_dragon",
    "threshold": 3               // advance when N items of chain exist
  },
  "highlight": [                 // optional board cell glow
    [4, 7],                      // [col, row] absolute
    "last_hatched",              // dynamic: tracks the most recently hatched cell
    { "chain": "ember_dragon", "nth": 0 }  // Nth item of chain (sorted by position)
  ],
  "hand": {
    "type": "drag",
    "from": [4, 8],              // [col, row] — source cell
    "to":   [4, 7]               // [col, row] — target cell
    // OR
    "type": "ui",
    "target": "ledger"           // "ledger" | "deliver" | "fog:{col},{row}"
    // (deliver only works when ledger is open)
  },
  "arrow": {
    "type": "tile",
    "pos": [4, 7]                // points at a board cell (arrowLift = 156)
    // OR
    "type": "ui",
    "target": "ledger"           // "ledger" | "deliver" (arrowLift = 116)
    // OR
    "type": "fog",
    "region": "level_2_gate"    // fog region key from map.json (arrowLift = 192)
  },
  "allow": {
    "drag":           ["ember_dragon"],  // item chain keys allowed for drag-merge
    "tapGenerators":  true,              // allow tapping generators
    "ledger":         false,             // can player open the ledger?
    "deliver":        false,             // can player press Deliver?
    "fog":            false,             // can player tap fog regions?
    "sell":           false              // can player sell items?
  },
  "effects": [
    // Run once when the step BECOMES active:
    { "type": "spawn",    "chain": "ember_dragon", "tier": 1, "at": [4, 9] },
    { "type": "retier",   "chain": "ember_dragon", "at": [4, 8], "to": 2 },
    { "type": "grantKeys","count": 1 }
  ]
}
```

---

## How each visual layer works

### CharacterBubble (`src/entities/CharacterBubble.ts`)

- Fixed at bottom-center of the UI scene
- Width: 1200px, font 38px bold, text wrap at 940px
- Speaker portrait: 150px tall, left side
- Name badge: colored per speaker
  - laurah → `goldShade` (`#D9821F`) — the sole tutorial narrator; portrait from `guide-character-bubble-icon.png`
  - cindra → `lavaShade` (`#C73A2E`)
- Tap chevron (▼, gold): only visible for `gate.type === 'tap'`; pulses alpha 1→0.25 every 520ms
- Emits `'tutorial:advance_requested'` when player taps the bubble (and gate is tap)

### Hand sprite (`src/scenes/UIScene.ts:373–432`)

**Drag mode** (when `hand.type === 'drag'`):
- Loops: 200ms fade-in → 950ms travel from→to → 260ms fade-out → 160ms pause → repeat
- Hand interpolates along the line from `from` to `to` in screen space (via `gridToPage`)
- The loop is a tween on `handProg.t` (0→1), re-projected every frame

**Point mode** (when `hand.type === 'ui'`):
- Hand stays at `uiTarget()` return value (re-evaluated every frame — it tracks moving UI)
- Scale pulse: 1→0.88 every 420ms yoyo, for visual attention
- `uiTarget()` resolves:
  - `'ledger'` → ledger button world position (bottom-right HUD)
  - `'deliver'` → Deliver button inside the open Ledger panel
  - `'fog:{col},{row}'` → centroid of named fog region cells

### Arrow sprite (`src/scenes/UIScene.ts:434–461`)

- Positioned `arrowLift` pixels above the anchor, with a vertical bob of −20 to 0 every 430ms (yoyo)
- `arrowLift` values:
  - tile target: 156px
  - UI target: 116px
  - fog target: 192px
- Anchor re-evaluated every frame (arrow follows moving targets automatically)

---

## Adding a FREE tile for a new step

The tutorial places items at specific cells. Before placing, find a free adjacent cell:

1. Open `tools/worldbuilder/index.html`, load the current world export
2. Identify a `playable` cell at the same zone level that has no existing items
3. Note `[col, row]` in the board's coordinate space (after `+1,+4` re-anchor applied by `build-gamemap.mjs`)
4. Use that `[col, row]` in the step's `"at"` field for effects, `"hand"` drag target, `"highlight"`, or `"arrow"` target

The L1 zone focal cell is `[4, 7]` (world center). Tutorial items cluster around it.
Zone 2 focal is stored in `cameraKeyframes` in `map.json`.

---

## EventBus contract for the tutorial

| Direction | Event | Payload | Who |
|-----------|-------|---------|-----|
| Subscribe | `item:hatched` | `{ chain, col, row }` | TutorialDirector gates |
| Subscribe | `item:merged` | `{ chain, col, row }` | TutorialDirector gates |
| Subscribe | `item:harvested` | `{ chain, col, row }` | TutorialDirector gates |
| Subscribe | `order:completed` | `{ orderId }` | TutorialDirector gates |
| Subscribe | `region:unlocked` | `{ regionId }` | TutorialDirector gates |
| Subscribe | `ui:ledger_opened` | — | TutorialDirector gates |
| Subscribe | `item:spawned` | `{ chain }` | TutorialDirector count gates |
| Subscribe | `item:removed` | `{ chain }` | TutorialDirector count gates |
| Subscribe | `tutorial:advance_requested` | — | TutorialDirector (from bubble tap) |
| **Emit** | `tutorial:step` | `TutorialStepEvent` | TutorialDirector → UIScene |
| **Emit** | `board:spawn` | `{ chain, tier, col, row }` | TutorialDirector effects |
| **Emit** | `board:retier` | `{ col, row, to }` | TutorialDirector effects |
| **Emit** | `economy:add` | `{ keys: N }` | TutorialDirector effects |

---

## Chain catalogue (what every chain does)

| Chain | Tiers | Role | hatchAtTier |
|-------|-------|------|-------------|
| `ember_dragon` | 1 Dragon Ruby → 2 Ember Hatchling → 3 Ember Whelp | Fire dragon family; T2/T3 produce flame_gem | 2 |
| `emerald` | 1 Emerald → 2 Emerald Hatchling → 3 Emerald Whelp | Green dragon family; T2/T3 produce flame_gem | 2 |
| `flame_gem` | 1 Gem Shard → 2 Flame Gem → 3 Radiant Gem | Merge-chain currency; feeds order board | — |
| `lumber` | 1 Bush → 2 House | Bush merges 3→1 House; House passively earns coins | — |
| `crystal` | 1 Theme Crystal | startingItem at [8,11] (decor3d position); tappable (30 s cooldown) → produces emerald_1 on nearest free active tile | — |
| `chest` | 1 Treasure Chest | Tap to open → coins / energy / wood fan, then consumed | — |
| `bigtree` | 1 Ancient Tree | Passive lumber_1 producer (10 min); lives in level_2 at [1,2] | — |
| `sparkweed` | 1-3 | Merge filler; no longer in starting content | — |
| `strawberry` | 1-3 | Merge-then-harvest plant | — |
| `coin` | 1 Gold Coin | Currency collectible; tapping banks it | — |

### Emerald notes
- `hatchAtTier: 2` — 3× emerald_1 merge → emerald_2 fires **item:hatched** (chain:'emerald')
- Emerald tier 1 is merge-only (tap does nothing). Tier 2+ are dragons and get the tap/generator path.
- BoardScene check: `if (item.chain === 'emerald' && item.tier === 1) return;`

### Lumber notes
- Default 3→1 merge rule (no `merge` override).
- Bush (T1) → House (T2) passive coin generator (5 min cooldown, passiveMs 5 min, tappable: false).
- After tutorial, bigtree at [1,2] slowly grows more bushes.

---

## Map layout (post-redesign)

```
Col →  1   2   3   4   5   6   7   8   9  10  11  12
Row ↓
 1          L2      L2  L5
 2     L2  L2  L2  L2  L5  L5  L1
 3     L2  L2  L2  L2  L5  L5  L1  L1
 4     L2  L2  L2  L2  L5  LG  L1  L1  L1
 5         L2  L2       LG  LG  L1  L1  L1
 6                       LG  LG  L1  L1  L1
 7               L1  L1           L1  L1  L11 L12
 8               L1  L1           L1  L1  L11 L12
11                               [CRYSTAL]
```

**Region key:**
- `L1` = `level_1` (active, game start)
- `L2` = `level_2` (auto-unlock at Keeper level 2; contains bigtree at [1,2])
- `LG` = `level_2_gate` (key unlock + level 2; 4 tiles: [6,5],[5,5],[6,6],[5,6]; contains 3× Bush)
- `L5` = `level_5` (locked, unlock.level:99 — permanent demo fog, never lifted in tutorial)
- `[CRYSTAL]` = crystal_1 at [8,11] (NOT in any region; startingItem placed directly)

**Camera focal cells (cameraKeyframes):** L1 focal ≈ [4,7]; L2 focal from authored keyframes.

**Note:** Camera fly on `keeper:leveled` is suppressed while `tutorialDone === false` (BoardScene line ~469). The level_2_gate and bigtree zone are revealed naturally — the player pans to them.

---

## Starting state at new game

| What | Where |
|------|-------|
| (nothing) | Board starts empty — all items arrive via tutorial step effects |

All startingItems have been removed. Each tutorial step spawns exactly what it needs via its `effects` array. The code-injected chest has also been removed.

**Note on the decor3d crystal**: `map.json` still has a `decor3d` entry for `emerald_crystal` at [8,11] (pure visual scenery rendered by the world-builder pipeline). The interactive crystal is spawned on an active L1 tile by the `emerald_tap` step effect.

---

## Tutorial step sequence (current)

| # | id | Gate | Key effects |
|---|---|------|------------|
| 0 | lore_1 | tap | — |
| 1 | lore_2 | tap | — |
| 2 | ruby_merge | item:merged (chain:ember_dragon) | spawn 3× ember_dragon_1 |
| 3 | dragon_hatch | item:hatched (chain:ember_dragon) | spawn 2× ember_dragon_2 |
| 4 | emerald_tap | item:harvested (chain:emerald) | spawn 2× emerald_1 |
| 5 | emerald_egg_merge | item:merged (chain:emerald) | — |
| 6 | green_dragon_hatch | item:hatched (chain:emerald) | spawn 2× emerald_2 |
| 7 | chest | chest:open | spawn 1× chest (near ember_dragon) |
| 8 | levelup | tap | grantXp 10 → triggers level 2 → level_2 + camera fly |
| 9 | key_unlock | region:unlocked | grantKeys 1 |
| 10 | bush_merge | item:merged (chain:lumber) | — (3 bushes in level_2_gate) |
| 11 | dragon_work | dragon:working | — teaches drag-dragon-next-to-house → tap → ⛏ Work |
| 12 | dragon_rest | tap | Effect: advanceClock 185000 (dragon enters rest) |
| 13 | buy_energy | marketplace:purchased | arrow: marketplace ⚡ button; first pack free |
| 14 | free_play | tap | tutorialDone; EndScreen deferred to Level 3 |

**Note:** Level 3 = EndScreen trigger (not tutorialDone). The `celebrateLevelUp` in UIScene creates EndScreen with variant `'level3'` when `level >= 3`.

### XP accounting
- merge ember_dragon: +12 XP (ember_dragon_2.xp)
- merge emerald: +10 XP (emerald_2.xp)
- grantXp 38 (step 6 effect)
- Total ≈ 60 XP → Keeper level 2 ✓ (LEVEL_XP[1] = 60)

---

## EventBus fixes applied

| Fix | Before | After |
|-----|--------|-------|
| `item:hatched` chain | not passed to onGateEvent | passes `item.chain` |
| `item:harvested` chain | not passed to onGateEvent | passes `output.chain` |
| `chest:open` gate | not subscribed in TutorialDirector | added handler |
| `grantXp` effect | not in TutorialEffect union | added `\| { grantXp: number }` |
| `chest:open` gate type | not in TutorialGate event union | added to string union |

---

## Checklist for adding a new tutorial step

- [ ] Add the step object to `tutorial.json` at the right index
- [ ] Make sure the gate event is already emitted by the relevant system (or add it)
- [ ] Identify a free board tile for any hand/arrow board target
- [ ] Confirm the `allow` block doesn't accidentally lock out a mechanic needed for the gate
- [ ] If using a new `TileRef` form, add the resolver in `TutorialDirector.resolveStep()`
- [ ] If using a new `hand.target` string, add the case in `UIScene.uiTarget()`
- [ ] If the step places items via `effects.spawn`, confirm the tile is empty at that point
- [ ] Run `pnpm e2e` — the Playwright suite drives the full tutorial scenario
