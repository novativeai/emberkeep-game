# Emberkeep — Complete Game Mechanics & Rules

> The full ruleset for *Emberkeep: The Dragon Hatchery*, synthesised from a
> deep study of the merge genre (Merge Dragons, Merge Mansion, Travel Town,
> Gossip Harbor, EverMerge, Love & Pies) and fitted to Emberkeep's universe
> and its data-driven architecture. Sources for every borrowed pattern are in
> [docs/research/merge-genre.md](research/merge-genre.md).
>
> **What's built today:** Level 1 "Cinder Hollow" implements the spine of this
> design (merge-3/5, hatching, dragon generators, energy, one order, key →
> fog unlock, XP/levels, save). Sections below mark **[L1]** where the current
> build already realises a rule and **[full]** where it's the larger design.

---

## 0. Design pillars (the universe is the constraint)

Emberkeep is a **cozy, single-player, narrative restoration merge game**. The
genre research is unanimous on one point for cozy titles: **the waiting systems
exist to give closure and a reason to return, never to punish.** Every rule
below is tuned generous, and every mechanic is themed to the world rather than
bolted on.

1. **Hatching is the emotional engine.** Every egg is a promise; the hatch beat
   (shell-crack flash → confetti → baby dragon → Cindra's proud line) is the
   peak the whole loop builds toward. **[L1]**
2. **Warmth is the visual reward.** Ash greys bloom into reds, golds and moss as
   you restore the sanctuary. Progress is *seen*, not just numbered. **[L1]**
3. **The merge board is a place you heal, not a score you grind.** Emberkeep is
   the **merge-3 / land-restoration school** (Merge Dragons/EverMerge), not the
   merge-2 order-treadmill school — because the fantasy is *rekindling a
   sanctuary*, a sandbox you bring back to life.
4. **Dragons are characters, not resources.** They're sleepy, clumsy,
   affectionate; they nap when tired, hiccup sparks, hoard pebbles. Their
   "generator cooldown" is *a nap*, their "stamina" is *being a toddler*.
5. **Tone: warm, hopeful, a little mischievous.** Cindra (bossy elder
   fire-sprite) gives orders; Pip (flightless messenger dragon) teaches.

---

## 1. The core loop

```
        ┌─────────────────────────────────────────────────────────┐
        │                                                         ▼
   wake/merge eggs → HATCH a dragon → tap it (costs Warmth) → it digs a
   Gem Shard → merge shards & weeds & gems up their chains → deliver to
   Cindra's Ledger → earn Gold + a Gold Key → spend the Key to lift
   ash-fog → new land rekindles (ash→moss), new eggs & a dormant shrine
   appear → restore the region → Cindra reveals more of the Great Flame's
   story → repeat on the next terrace.
        ▲                                                         │
        └─────────────────────────────────────────────────────────┘
```

Two interlocking sub-loops, both from the research:

- **The sandbox loop** (Merge Dragons): harvest dragons → merge up chains →
  rekindle land / lift fog → unlock space, eggs and shrines. **[L1]**
- **The order loop** (Gossip Harbor/Travel Town): merge to fulfil Cindra's
  Ledger → earn Gold + Keys + XP → advance the restoration & story. **[L1]**

Orders are the **primary XP/Gold faucet**; the sandbox is where supply is made.

---

## 2. Merge rules & merge types

### 2.1 The base rule — merge-3, with the 5-merge bonus **[L1]**
- **3 identical adjacent items → 1 of the next tier**, created on the drop tile.
- **5 identical → 2 of the next tier** (consume 5, the "Great Merge"). This is
  the genre's core optimisation hook: 5 in gives ~20% more than two 3-merges
  would. Holding out for the 5th item is the skill expression.
- Grouping is an **orthogonal flood-fill** from the drop tile (so only one
  connected blob merges). Config in [`chains.json`](../src/data/chains.json):
  `mergeRule: { minGroup: 3, fiveBonus: true, fiveGroup: 5, fiveOutputs: 2 }`.
- Max-tier items never merge (no next tier) — they become **Shrines** (§6).
- **[full]** extend the ladder: `7 → 3`, `9 → 4` (the `3·k−2 → k` pattern) for
  juicy big-blob payoffs, behind the same config.

### 2.2 Merge types (the verbs)
| Type | Trigger | Result | Theme | Status |
| --- | --- | --- | --- | --- |
| **Merge** | drag 3+ alike together | next tier | the ground remembers | **[L1]** |
| **Great Merge** | 5+ alike | 2 next tier + extra spark burst | a brighter bloom | **[L1]** |
| **Hatch merge** | merge 3 eggs (`hatchAtTier`) | a **dragon** + shell-crack ceremony | a promise kept | **[L1]** |
| **Harvest** | tap a dragon | a Gem Shard onto a free tile (costs Warmth, starts a nap) | she digs you a pebble | **[L1]** |
| **Rekindle** | lift fog / merge onto an ash tile | ash → moss, warm-light bloom | warmth returns | **[L1]** fog; **[full]** per-tile |
| **Cascade** | a merge output lands beside matching items | chain-reaction merge + bonus spark per step | the flame spreads | **[full]** |
| **Shrine merge** | merge the chain's top tier | a passive **Flame Shrine** (idle producer) | a relic relit | **[full]** |
| **Sell** | tap item → Sell | Gold for the item's tier | a pebble for the coffer | **[L1]** |

### 2.3 Cascade / chain-reaction **[full]**
After a merge, if the new item is adjacent to ≥2 of its own kind, it may merge
again automatically, emitting one extra spark (and a sliver of XP) per cascade
step, capped at 4 steps. A level-1 tap can ripple into a tier-5 completion —
the genre's biggest dopamine spike. Toggleable in settings ("Allow cascades").

---

## 3. Chains (the content catalogue)

Chains are **JSON-only** content ([`chains.json`](../src/data/chains.json)); a
new chain is a data edit, never a code change. Each tier has `name`, `sell`
(Gold), `xp` (on creation), and optional `generator` config.

### 3.1 Shipped in L1 **[L1]**
| Chain | Tier 1 | Tier 2 | Tier 3 | Role |
| --- | --- | --- | --- | --- |
| `sparkweed` | Spark Weed | Ember Bloom | Flame Lily | tutorial flora |
| `ember_dragon` | Speckled Ember Egg | **Ember Hatchling** ⚙ | **Ember Whelp** ⚙ | dragons (generators) |
| `flame_gem` | Gem Shard | Flame Gem | Radiant Gem | resource / order goods |

⚙ = generator tier. Hatchling/Whelp dig Gem Shards.

### 3.2 Full-game catalogue **[full]** (design targets; drop straight into JSON)
Chains run **5–7 tiers** in the full game (research: 7–15 is genre-normal; cozy
leans shorter so completion feels reachable). New chains unlock as terraces are
restored, so the board is never overwhelming at the start.

- **Flora (warmth seeds):** Spark Weed → Ember Bloom → Flame Lily → Sun Orchid →
  **Hearth Tree** (Shrine). The flora chain *heals land* when harvested.
- **Eggs & dragons (one chain per dragon breed):**
  - *Ember* (red, the starter): Egg → Hatchling ⚙ → Whelp ⚙ → Drake ⚙ → **Elder Ember** (Shrine ⚙).
  - *Tideglass* (teal, unlocked on the water terrace): Egg → … → Elder.
  - *Goldhoard* (marigold, the pebble-hoarders): Egg → … → Elder.
  - Each higher dragon tier digs a **better** resource (Shard → Gem → Radiant)
    and naps less.
- **Gems (resources / order goods):** Gem Shard → Flame Gem → Radiant Gem →
  Star Garnet → **Everflame Core** (Shrine).
- **Stone (restoration material):** Cinder Pebble → Warm Brick → Hearthstone →
  Keystone → **Brazier** (Shrine) — feeds structure rebuilds.
- **Keys (a merge mini-chain):** Bronze Key → Silver Key → **Gold Key**. Gold
  Keys *only* come from merging Silver (supply never drops Gold directly), so
  region unlocks stay paced. Mirrors the Merge-Dragons key ladder. **[full]**

---

## 4. Dragons as generators — the harvest & nap system

Dragons are the economy's heart and its pacing valve, themed as toddlers.

### 4.1 Harvest **[L1]**
- Tap a **ready** dragon → it spends **1 Warmth** → spits its produce (a Gem
  Shard for Ember dragons) onto a free adjacent tile → enters a **nap**.
- No free adjacent tile → "No room!" (clear space first). No Warmth → the
  Warmth pill shakes.
- Config per tier in `chains.json`:
  `generator: { produces: {chain,tier}, cooldownMs, energyCost }`.

### 4.2 Nap = cooldown + stamina **[L1 cooldown / full stamina]**
- **Nap (cooldown):** after a harvest a dragon sleeps `cooldownMs` (10 s for a
  hatchling) — visualised by a muted tint; a ready dragon shows a sparkle. **[L1]**
- **Stamina [full]:** a dragon can harvest **N times** (by tier: Hatchling 3,
  Whelp 5, Drake 8) before a **deep nap** (a longer "Too Tired" sleep, ~minutes,
  `GameClock`-aware). Stamina refills over real time and on level-up. This is
  the Merge-Dragons "Too Tired" gate, themed: *she's just a baby, let her rest.*

### 4.3 Free auto-producers — the cozy floor **[full]**
The research is emphatic: **there must always be something to do at zero
Warmth.** So a few producers cost **no Warmth** and drip on a timer:
- **Nests** slowly hatch a Spark Weed every few minutes (free).
- **Hearth Trees** (flora Shrine) drop a Cinder Pebble on a cooldown.
- They keep producing **offline**, so you return to a small harvest waiting —
  the strongest come-back hook. Energy-gated dragons + free auto-producers =
  the dual-gate the whole genre uses.

### 4.4 Bubbles — the overflow valve **[full]**
When the board is full and a harvest/merge has nowhere to land, the new item
**bubbles** off-grid (zero board space) until tapped to pop. Time is frozen
inside a bubble. This turns "board full" from a failure into storage — the
Merge-Dragons solution to the genre's central tension.

---

## 5. Land restoration (the heal mechanic, themed)

The map is ash-cold; rekindling it is the visible spine of progress.

- **Ash tiles** are inert until warmed. A region is **fogged** (ash-cloud
  blankets / level-blocker clouds) until unlocked. **[L1]**
- **Rekindle:**
  - Lifting a fog region (spend a Gold Key) blooms all its tiles **ash → moss**
    with a warm-light flood and reveals its hidden eggs + a dormant Shrine. **[L1]**
  - **[full]** Per-tile: harvesting flora on or beside an ash tile warms it;
    fully-warmed terraces grant **Sanctuary Warmth** (§8) and may auto-reveal
    decor.
- Cloud level-blockers carry a **Level tag** (from the world-builder): a region's
  clouds clear when the Keeper reaches that level OR spends the matching Key.
  This is the gate that paces world expansion. **[full, authored in the tool]**

---

## 6. Wonders → Flame Shrines (idle producers) **[full]**

A chain's **top tier** isn't a dead end — merging it lights a **Flame Shrine**:
a permanent, un-mergeable structure that, like a Merge-Dragons Wonder, **drops
loot on creation** and then **yields a reward every few hours** of active play
(Gold, Star Shards, or rare eggs). Shrines are the reward for *finishing* a
chain and the backbone of idle income. Each restored terrace can host one,
themed to its breed (Ember Brazier, Tideglass Font, Goldhoard Reliquary).

---

## 7. Resources & currencies

Research consensus for cozy single-player: **two persistent currencies + the
energy meter + temporary event currency.** Emberkeep themes them:

| Resource | Theme | Earned from | Spent on | Status |
| --- | --- | --- | --- | --- |
| **Warmth** (energy) | the lantern's hearthlight | regen over time, level-up full refill, Ember Boxes | harvesting dragons, clearing obstacles | **[L1]** |
| **Gold** (coins) | the sanctuary's ancient gold | orders, selling, harvests, Shrines | restoration, generator upgrades, decor | **[L1]** |
| **Gold Keys** | keys of ancient gold | orders, chests, merging Silver Keys | unlocking fog regions | **[L1]** |
| **Star Shards** (premium) | shards of fallen stars dragons hoard | sparse: daily, events, milestones (or purchase) | Warmth refills, skip a nap, +board space, pop a bubble early | **[full]** |
| **Festival Embers** (event) | embers of a seasonal festival | event tasks only | event reward track | **[full]** |

Design rule from the research: **keep Gold decoupled from power** (it only gates
restoration & story), so it can be handed out generously without breaking
balance. Star Shards monetise *impatience and friction*, never progression.

---

## 8. The waiting system (tuned cozy-generous)

The genre default is *cap 100, +1 / 2 min, full refill on level-up, offline
regen*. For a **cozy single-player** game the research says go gentler still.

### 8.1 Warmth tuning
| Knob | L1 today | Full-game target | Rationale |
| --- | --- | --- | --- |
| Max Warmth | 20 | **40**, +5 per Keeper level milestone | cap = session *length* |
| Regen | +1 / 30 s | **+1 / 30 s** (fast for cozy) | regen = session *frequency* |
| Level-up | — | **full refill** (+ cap bump) | rescue the player at the wall → reward, not friction |
| Offline | yes (catch-up on load) | yes, **uncapped overflow banks** | rewards never wasted |
| Floor at 0 | — | **free auto-producers keep working** (§4.3) | never open to a dead board |

All timers read `GameClock.now()` so `advanceTime(ms)` stays deterministic. **[L1]**

### 8.2 Session shape
Target **3–6 calm sessions/day, a few minutes each, each with a clear stopping
point** (a finished order, a leveled dragon, seeds maturing offline). Putting
the game down should feel *complete*, not interrupted. Opt-in, mutable
notifications ("Your hatchling woke up", "The nest has bloomed") — gentle
invitations, never guilt-trips.

---

## 9. Keeper progression — XP, points per merge, level cap

### 9.1 Where XP comes from (the research's strongest lesson)
**Orders are the primary XP source; only high-tier/terminal merges grant XP
directly; ordinary intermediate merges grant little or none.** This keeps the
XP economy controllable through order difficulty and pushes players *up* chains
rather than grinding sideways.

| Event | XP | Note | Status |
| --- | --- | --- | --- |
| Complete a Ledger order | **bulk** (scales with order tier) | the main faucet | **[L1] order; full curve** |
| Merge to a chain **top tier** | medium + loot drop | rewards finishing | **[L1] per-tier xp** |
| **Hatch** a dragon | medium + the ceremony | the emotional beat pays XP too | **[L1]** |
| Rekindle a terrace | medium, one-time | restoration is progress | **[full]** |
| Intermediate merge | small/zero (per-tier `xp` in JSON) | don't reward sideways grind | **[L1] tunable** |

Per-tier `xp` already lives in `chains.json`, so "points per merge" is data, not
code. Recommended: low/zero on tier-2, rising sharply on tier-4+ and Shrines.

### 9.2 Level cap & curve **[L1 array → full curve]**
- A visible **Keeper Level** with a **soft cap (~40)** the content roadmap
  raises (genre-standard; Merge Mansion caps at 50 "to be increased").
- **Steep-then-flat curve:** reach ~level 8–10 in the first 1–2 sessions to
  front-load unlocks, then rising XP-per-level. Current `LEVEL_XP` array in
  [`Constants.ts`](../src/core/Constants.ts) is the seed; extend to ~40 entries.

### 9.3 Level-up rewards (a multi-reward burst) **[full]**
Every level-up fires at once: **full Warmth refill** (the key beat) + **Gold** +
an **alternating chest** (odd levels Ember Chest, even levels Sky Chest, so each
level feels distinct) + occasional **cap bump / new unlock**. The refill rescues
the player exactly when they'd hit the Warmth wall — friction becomes reward.

### 9.4 What leveling gates **[full]**
Tie *capability* to level, not just cosmetics:
- new **chains** and **dragon breeds** as terraces open,
- a **Stoke** booster (harvest 2 Warmth for a chance at a higher-tier produce)
  at a mid level, and a stronger one later (the Gossip-Harbor 2×/4× ladder),
- **Warmth cap** increases at milestones,
- new **board terraces** (space is a metered reward).

---

## 10. Sanctuary Warmth — the secondary meta-stat **[full]**

Alongside Keeper Level, a persistent **Sanctuary Warmth** number (like Merge
Dragons' "Dragon Power") sums everything you've restored: rekindled tiles, lit
Shrines, hatched dragons, completed chains. It **gates content that level
doesn't** — opening **festivals**, deeper **terraces**, and **Elder dragon**
breeds at thresholds — giving lapsed-story players a between-content-drop goal.

---

## 11. Cindra's Ledger — the order system

The order board is the narrative + XP/Gold engine.

### 11.1 Structure **[L1 one order → full board]**
- **3–4 persistent character requests** visible at once + **1 auto-order** slot
  (auto-completes when the item exists). Orders **wait on the board — they never
  fail** (cozy: no timer pressure). **[full]**
- Each order: *"deliver N of {chain,tier}"* → pays **Gold + XP**, with occasional
  **Gold Key / Star Shard** on milestone orders. Today's single order — *Cindra:
  "Rekindle the Brazier" — deliver 2 Flame Gems → 50 Gold + 1 Gold Key* — is the
  template. **[L1]**
- **Givers:** Cindra (restoration), Pip (tutorial & errands), and **dragons
  themselves** once hatched (a dragon "asks" for its favourite pebble — ties
  orders to the affection theme). **[full]**
- **Self-correcting difficulty:** if you end a session unable to fill an order,
  the next session offers an easier one (Gossip-Harbor pattern). **[full]**

### 11.2 The long project order **[full]**
One always-present **Restoration Project** is a multi-day deferred goal
("Relight the Grand Hearth: deliver 40 Hearthstones over time") — the long-tail
retention anchor distinct from moment-to-moment orders.

Orders are JSON ([`orders.json`](../src/data/orders.json)); adding one is a data
edit. **[L1]**

---

## 12. Keys & region unlocks

- **Gold Keys** unlock **fog regions** (ash-fog clouds curl away, land
  rekindles, eggs + a Shrine appear). One Key per region in L1. **[L1]**
- A region may *alternatively* open when the Keeper reaches the region's **Level
  tag** (authored on the clouds in the world-builder), so progress isn't
  hard-blocked on key luck. **[full]**
- **[full]** The Bronze→Silver→**Gold** key merge mini-chain (§3.2) is the
  satisfying secondary way to make Keys, with chests that open for **2 matching
  keys** (the Merge-Dragons chest/key model) — gating *loot*, never story.

---

## 13. The meta-spine: restoring the sanctuary

The long-term goal and the story container are **one thing**: rebuild Emberkeep,
terrace by terrace (the Merge-Mansion renovation spine, themed).

- Spend **Gold + Stone-chain materials** to **restore structures** on a rekindled
  terrace (the brazier, the hatchery roost, the gold-chain moorings).
- Each restoration **unlocks the next story beat** (Cindra reveals another piece
  of *how the Great Flame went out*), a **new chain/breed**, and a small
  **resource payout** (so the meta-goal returns resources, never purely
  extractive).
- Offer **2–3 cosmetic restoration choices with no wrong answer** (warm cozy
  self-expression), and keep **one central deflected mystery** open — *why* the
  Flame really died, and what Cindra isn't saying — to pull the player across
  the whole campaign.

---

## 14. Events & LiveOps (cozy, solo-friendly)

No competitive leaderboards (wrong tone for cozy). Three light recurring hooks:

1. **Ember Festivals** — single-player *sawtooth races*: event tasks yield
   **Festival Embers** toward **3 escalating milestones**; each milestone gives
   exclusive decor / a festival dragon. Seasonal skins (Longest Night, First
   Thaw). **[full]**
2. **The Keeper's Almanac** — a **28-day seasonal reward track**, free + a
   low-cost premium lane (no tier-skip), with **3 daily quests** and bonus
   missions. The retention spine between content drops. **[full]**
3. **Daily & login** — **3 daily tasks** (reset 12 h; finishing all → an Ember
   Box of Star Shards) and a **7-day login streak** with a day-7 mega-bundle —
   the classic habit curve. **[full]**

End-game retention lives in **festivals + collection (the dragon album) +
Sanctuary Warmth**, not in the leveling bar.

---

## 15. The event catalogue (EventBus contract)

All cross-module communication is the typed synchronous `EventBus`
([`types.ts`](../src/core/types.ts)). The implemented contract **[L1]** plus the
**[full]** additions this design implies:

**Intents (UI/scenes emit):** `drag:dropped`, `item:tapped`, `ui:ledger_toggled`,
`ui:deliver_requested`, `ui:sell_requested`, `fog:tapped`,
`tutorial:advance_requested`, `game:reset_requested`, `time:advanced` · **[full]**
`ui:stoke_requested`, `ui:bubble_popped`, `ui:restore_requested`,
`ui:festival_claim`.

**Commands (systems handle synchronously):** `energy:spend`, `economy:add`,
`economy:spend_keys`, `board:consume_items` · **[full]** `board:bubble_item`,
`warmth:rekindle_tiles`, `shrine:produce`.

**Notifications (UI + audio subscribe):** `item:spawned`, `item:moved`,
`item:move_bounced`, `item:merged`, `item:hatched`, `item:harvested`,
`item:harvest_failed`, `item:removed`, `item:sold`, `energy:changed`,
`economy:changed`, `order:progress`, `order:completed`, `order:all_done`,
`region:unlocked`, `region:unlock_failed`, `tutorial:step`, `state:saved`,
`state:loaded`, `game:reset` · **[full]** `item:cascaded`, `dragon:napped`,
`dragon:tired`, `shrine:lit`, `shrine:reward`, `terrace:rekindled`,
`keeper:leveled`, `festival:progress`, `daily:completed`.

Systems never call each other — they emit commands the owning system handles.
UI and audio only emit intents and subscribe. **[L1, non-negotiable]**

---

## 16. Tuning tables (concrete starting numbers)

All live in [`Constants.ts`](../src/core/Constants.ts) or `src/data/*.json` — no
magic numbers in systems. Starting values for the full game (tune to telemetry):

| System | Knob | Value |
| --- | --- | --- |
| Warmth | max / regen / level-up | 40 (+5/milestone) · +1 per 30 s · full refill |
| Hatchling | harvest cost · nap · stamina | 1 Warmth · 10 s · 3 then deep-nap 3 min |
| Whelp | harvest cost · nap · stamina | 1 · 8 s · 5 then deep-nap 4 min |
| Merge XP | tier 2 / 3 / 4 / top | 0–4 / 8–14 / 20–30 / 40+ |
| Order reward | small / medium / milestone | 30 G · 60 G+1 Key · 120 G+Shards |
| Shrine | first drop · idle yield | loot burst · reward / ~3 h active |
| Keeper level | early / cap | level 10 by session 2 · soft cap 40 |
| Festival | milestones | 3, cost ~doubling per stage |

---

## 17. What Level 1 ("Cinder Hollow") proves today

**[L1] implemented & verified** (27 unit + full-tutorial e2e green): merge-3 &
5→2, hatching ceremony, dragon generators with energy + nap cooldown, Warmth
(cap 20, +1/30 s, offline catch-up), Cindra's one order, Gold + Gold-Key reward,
key → fog-lift with ash→moss rekindle, XP & Keeper levels, sell tooltip,
versioned autosave, the full EventBus contract, and the data-driven JSON spine.

**[full] designed here, ready to build** (mostly JSON + new systems on the same
bus): longer chains & dragon breeds, stamina deep-naps, free auto-producers,
bubbles, cascades, Flame Shrines (idle income), Star Shards, the multi-order
Ledger + project orders + dragon givers, per-tile rekindle & Sanctuary Warmth,
the restoration meta-spine, and the festival/almanac/daily LiveOps.

---

## 18. How it maps to the architecture (so it's buildable, not just prose)

| Design concept | Where it lives | New work |
| --- | --- | --- |
| Chains, tiers, XP, sell, generators | `chains.json` | data only |
| Orders, givers, rewards, projects | `orders.json` (+ `OrderSystem`) | data + queue/auto-order |
| Regions, fog, level-tags, contents | `map.json` (+ world-builder export) | data only |
| Warmth tuning, cap curve, nap/stamina | `Constants.ts` | data only |
| Merge / 5-merge / cascade | `MergeSystem` | cascade = new branch |
| Harvest / nap / stamina / auto-producers | `GeneratorSystem` | stamina + free producers |
| Bubbles / board-full | `BoardSystem` + `GameState` | new overflow path |
| Shrines (idle income) | new `ShrineSystem` | bus-driven, `GameClock` ticks |
| Sanctuary Warmth / restoration | new `RestorationSystem` | bus-driven |
| Festivals / almanac / dailies | new `LiveOpsSystem` | bus-driven, save-backed |
| Dragon art & animation | `RigPlayer` (+ rigger/animator tools) | rigs per breed |
| World layout & cloud level-tags | world-builder → `map.json` ingest | tooling done |

Everything new is **a system on the EventBus + a JSON edit** — the architecture
was built for exactly this expansion. Nothing here requires re-architecting what
Level 1 already proves.
