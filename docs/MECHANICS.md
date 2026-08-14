# Emberkeep — Complete Game Mechanics & Rules

> The full ruleset for *Emberkeep: The Dragon Hatchery*, synthesised from a
> deep study of the merge genre (Merge Dragons, Merge Mansion, Travel Town,
> Gossip Harbor, EverMerge, Love & Pies) and fitted to Emberkeep's universe
> and its data-driven architecture. Sources for every borrowed pattern are in
> [docs/research/merge-genre.md](research/merge-genre.md).
>
> **What's built today:** "Chapter One: Cinder Hollow" implements the spine of
> this design and a good deal more than the original Level-1 scope — merge-3/5
> *plus per-tier merge-2 overrides*, hatching, two dragon breeds, tap **and**
> passive generators, Gold/Warmth timer skips, dragon jobs, a recurring chest,
> a 4-order Ledger with repeatables, a Keeper's Tasks checklist, level-gated
> region unlocks, and the scripted Level-3 finale. Sections below mark **[L1]**
> where the shipped build already realises a rule and **[full]** where it's the
> larger design.
>
> **Read [GDD-L1.md](GDD-L1.md) for the shipped numbers.** This document is the
> *design*; the GDD is the *build*. Where they disagree, the GDD (and the code
> it mirrors) wins.

---

## 0. Design pillars (the universe is the constraint)

Emberkeep is a **cozy, single-player, narrative restoration merge game**. The
genre research is unanimous on one point for cozy titles: **the waiting systems
exist to give closure and a reason to return, never to punish.** Every rule
below is tuned generous, and every mechanic is themed to the world rather than
bolted on.

1. **Hatching is the emotional engine.** Every egg is a promise; the hatch beat
   (shell-crack flash → confetti → baby dragon → Eleanor's proud line) is the
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
5. **Tone: warm, hopeful, a little mischievous.** **Eleanor**, of the Daughters
   of the Moon, both teaches (all 21 tutorial steps + every post-tutorial hint)
   and gives the orders. The **Golden Elder** is *saved* — silent for the whole
   game until she wakes at the finale, which works because she is asleep rather
   than because a writer withheld her. **[L1]** *(Earlier drafts cast Pip, then
   Laurah and Cindra; none are in the build — see GDD-L1.md.)*

---

## 1. The core loop

```
        ┌─────────────────────────────────────────────────────────┐
        │                                                         ▼
   merge rubies → eggs → HATCH a dragon → tap it (costs Warmth) or let it
   gift passively → it digs gems → merge gems up their chain → deliver to
   Eleanor's Ledger → earn Gold + XP → level up → ash-fog lifts on the next
   zone, the camera glides to it, new land rekindles (ash→moss) and new
   producers appear → restore the region → Eleanor reveals more of the Great
   Flame's story → repeat on the next terrace.
        ▲                                                         │
        └─────────────────────────────────────────────────────────┘
```

Two interlocking sub-loops, both from the research:

- **The sandbox loop** (Merge Dragons): harvest dragons → merge up chains →
  rekindle land / lift fog → unlock space, eggs and shrines. **[L1]**
- **The order loop** (Gossip Harbor/Travel Town): merge to fulfil Eleanor's
  Ledger → earn Gold + Keys + XP → advance the restoration & story. **[L1]**

Orders are the **primary XP/Gold faucet**; the sandbox is where supply is made.

---

## 2. Merge rules & merge types

> **[next]** The Eleanor/Selyna direction changes what merging is *for*: dragons
> become named companions that never merge, and the board becomes the husbandry
> layer that feeds them. The new rule grammar (recipient-locked consumables, the
> contested tier-1/tier-3 split, the anonymous-vs-named law) and the new chain
> roster live in **[merge-chains.md](merge-chains.md)**. The rules in §2.1–2.2
> below still hold — they are the substrate that direction builds on.

### 2.1 The base rule — merge-3, with the 5-merge bonus **[L1]**
- **3 identical adjacent items → 1 of the next tier**, created on the drop tile.
- **5 identical → 2 of the next tier** (consume 5, the "Great Merge"). This is
  the genre's core optimisation hook: 5 in gives ~20% more than two 3-merges
  would. Holding out for the 5th item is the skill expression.
- Grouping is an **orthogonal flood-fill** from the drop tile (so only one
  connected blob merges). Config in [`chains.json`](../src/data/chains.json):
  `mergeRule: { minGroup: 3, fiveBonus: true, fiveGroup: 5, fiveOutputs: 2 }`.
- **Per-tier overrides [L1].** A tier may carry its own `merge: { group, outputs }`
  which replaces the rule *for items of that tier* (and disables the 5-bonus for
  them). Shipped: **Red Dragon**, **Green Dragon** and **House** are all
  `{group: 2, outputs: 1}` — **2 dragons → 1 Adult**, **2 Houses → 1 Manor**.
  This is the game's "rare things merge in pairs" pacing valve; without it a
  fourth-tier dragon would need nine eggs.
- Max-tier items never merge (no next tier) — they become **Shrines** (§6).
- **[full]** extend the ladder: `7 → 3`, `9 → 4` (the `3·k−2 → k` pattern) for
  juicy big-blob payoffs, behind the same config.

### 2.2 Merge types (the verbs)
| Type | Trigger | Result | Theme | Status |
| --- | --- | --- | --- | --- |
| **Merge** | drag 3+ alike together | next tier | the ground remembers | **[L1]** |
| **Great Merge** | 5+ alike | 2 next tier + extra spark burst | a brighter bloom | **[L1]** |
| **Pair merge** | drag 2 alike (tiers with a `merge` override) | next tier | the rare ones pair off | **[L1]** |
| **Hatch merge** | a merge whose OUTPUT tier is `hatchAtTier` (3 eggs → dragon) | a **dragon** + shell-crack ceremony | a promise kept | **[L1]** |
| **Harvest** | tap a ready dragon | its produce onto a free tile within 3 tiles (costs Warmth, starts a nap) | she digs you a pebble | **[L1]** |
| **Passive gift** | wait — no tap, no Warmth | produce drops on its own every `passiveMs` | she works while you're away | **[L1]** |
| **Skip** | tap a waiting timer → pay Gold (or 1.5× in Warmth) | the wait ends; price ∝ time remaining | impatience has a price | **[L1]** |
| **Dragon job** | send a dragon to a House | every timer runs 2× per worker for 3 min, then she rests 5 min | a day's work | **[L1]** |
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
(Gold), `xp` (on creation), and optional `generator` and `merge` config.

> **[next]** The replacement roster for the Eleanor/Selyna direction —
> emberberry · resin · ashmoss · quartz · moonwater, with the dragon-diet axes
> (fuel / grit / green) and Eleanor's catch–hold–return craft — is specified in
> **[merge-chains.md](merge-chains.md)**. Its art is produced and registered in
> `assets.json`; `chains.json` does not reference it yet.

### 3.1 Shipped today **[L1]**
| Chain | Tier 1 | Tier 2 | Tier 3 | Tier 4 | Role |
| --- | --- | --- | --- | --- | --- |
| `ember_dragon` | Dragon Ruby | Red Egg | **Red Dragon** ⚙ | **Adult Red** ⚙ | dragons — dig Gem Shards |
| `emerald` | Emerald | Green Egg | **Green Dragon** ⚙ | **Adult Emerald** ⚙ | *dropped in Chapter One — no producer left* |
| `flame_gem` | Gem Shard | Flame Gem | Radiant Gem | — | order goods |
| `strawberry` | Emberberry Sprout | Emberberry Bush | **Ripe Plant** ⚙ | — | the free-producer floor — it drops `emberberry`, and a Sprout per 12 |
| `emberberry` | Emberberry | Basket | Preserve | — | the free food ladder (dragon fuel later) |
| `lumber` | Cut Wood | Plank Set | **House** ⚙ | **Manor** ⚙ | the Gold loop |
| `coin` | Gold Coin | Gold Pouch | — | — | tap-to-collect currency |
| `golden_egg` | Golden Egg | **Golden Elder** | — | — | the finale MacGuffin |
| `crystal` · `chest` | single-tier fixtures ⚙ | | | | seeded producers |

⚙ = generator tier. Both dragon chains hatch at tier 3 and pair-merge (2 → 1)
into their Adult. `sparkweed` still exists in `chains.json` as the unit tests'
generic merge chain but is in `HIDDEN_CHAINS` and **never spawns live**.

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
- Tap a **ready** dragon → it spends **1 Warmth** → spits its produce (a Dragon
  Ruby for Ember dragons, a Gem Shard for Emerald dragons) onto a free tile
  within `REWARD_SPAWN_RADIUS` (**3 tiles**) → enters a **nap**.
- No free tile in radius → "No room!" (rewards never teleport across the map).
  No Warmth → the Warmth pill shakes.
- Config per tier in `chains.json`:
  `generator: { produces: {chain,tier}, cooldownMs, energyCost, passiveMs?, tappable?, skipMaxGold? }`.
- **Every dragon also gifts passively** on `passiveMs` (180 s at tier 3, 120 s
  at tier 4) with no tap and no Warmth — so a dragon is never *only* a tap sink.

### 4.2 Nap = cooldown + stamina **[L1 cooldown / full stamina]**
- **Nap (cooldown):** after a harvest a dragon sleeps `cooldownMs` (**45 s** at
  tier 3, **30 s** for an Adult) — visualised by a muted tint; a ready dragon
  shows a sparkle. The wait is **skippable** for Gold or 1.5× Warmth, priced by
  the fraction still remaining (`skipEnergyCost` / `skipWarmthCost`). **[L1]**
- **Stamina [full]:** a dragon can harvest **N times** (by tier: Hatchling 3,
  Whelp 5, Drake 8) before a **deep nap** (a longer "Too Tired" sleep, ~minutes,
  `GameClock`-aware). Stamina refills over real time and on level-up. This is
  the Merge-Dragons "Too Tired" gate, themed: *she's just a baby, let her rest.*

### 4.3 Free auto-producers — the cozy floor **[L1 — shipped]**
The research is emphatic: **there must always be something to do at zero
Warmth.** Shipped free producers (all `energyCost: 0`):
- **Ripe Emberberry Plant** — an Emberberry every 20 s, tappable, free, plus a
  **bonus** Emberberry Sprout every 12 yields (`generator.bonus`): nine sprouts
  is a second patch, so the food chain seeds its own expansion.
- **House / Manor** — a Gold Coin / Gold Pouch every 210 s (`tappable: false`), until COMMISSIONED: tap one, pick a piece from the Bag, and it makes that forever (write-once). Rank-capped — a House takes tier-1 commissions only, a Manor tiers 1–2 (`produceMaxTier`).
- **Fir Tree** — a Cut Wood every 300 s, plus a Fir Grain every 10th (the loop
  closes on itself). The isle authors no tree; this one is grown. **Theme
  Crystal** — an Emerald every 300 s.
- **Treasure Chest** — a random gift every `CHEST_INTERVAL_MS` (300 s), forever.
- They keep producing **offline**, banking up to `OFFLINE_BANK_CYCLES` (**3**)
  overdue cycles per producer, which the "While you were away" card reports on
  load (gated by `WELCOME_BACK_MIN_MS`, 5 min). Energy-gated dragons + free
  auto-producers = the dual-gate the whole genre uses.

### 4.4 Bubbles — the overflow valve **[full]**
When the board is full and a harvest/merge has nowhere to land, the new item
**bubbles** off-grid (zero board space) until tapped to pop. Time is frozen
inside a bubble. This turns "board full" from a failure into storage — the
Merge-Dragons solution to the genre's central tension.

**Not shipped.** Today a drop with no free tile inside `REWARD_SPAWN_RADIUS` is
simply **blocked**: a tap-harvest fails ("No room!"), a passive gift retries in
`GENERATOR_PASSIVE_RETRY_MS` (8 s), and a chest pays Gold instead. That is a
safe fallback, not a solution.

> ### ⚠ The Bag now overlaps this — decide before building bubbles
> **[L1 — shipped]** The **Bag** (`BagSystem`, `BagPanel`) lets the player TAP a
> plain merge piece to pocket it and tap a slot to put it back. It solves the
> board-full problem from the other end: bubbles are automatic and rescue
> production the player was not present for, the bag is manual and deliberate.
>
> Shipping both would give the game two overflow systems and two answers to
> "where did my item go". Pick one — bag only, bubbles only, or the bag as the
> manual valve with bubbles reserved for offline overflow — and strike the loser
> from this section. Tracked as **EMB-30** on the board.

---

## 5. Land restoration (the heal mechanic, themed)

The map is ash-cold; rekindling it is the visible spine of progress.

- **Ash tiles** are inert until warmed. A region is **fogged** (ash-cloud
  blankets / level-blocker clouds) until unlocked. **[L1]**
- **Rekindle:**
  - Lifting a fog region blooms all its tiles **ash → moss** with a warm-light
    flood, reveals its authored `contents`, and glides the board camera to the
    new zone's focal cell. **[L1]**
  - **[full]** Per-tile: harvesting flora on or beside an ash tile warms it;
    fully-warmed terraces grant **Sanctuary Warmth** (§8) and may auto-reveal
    decor.
- Cloud level-blockers carry a **Level tag** (from the world-builder): a region's
  clouds clear when the Keeper reaches that level OR spends the matching Key.
  This is the gate that paces world expansion. **[L1 — shipped]** Today
  `level_2` opens at Level 2; `level_2_gate` accepts a key *or* Level 2 and is
  opened by the tutorial's granted key (§12); `level_5` opens at Level 3; the
  grafted `beyond_l4` / `beyond_l5` slabs open at Levels 4 and 5 now that the
  curve runs past the old chapter cap.

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
| **Warmth** (energy) | the lantern's hearthlight | regen (+1/60 s), level-up full refill, one free tutorial Ember Spark, Warmth Shop (bought with **Gold**) | harvesting dragons, premium timer skips (1.5×) | **[L1]** |
| **Gold** (coins) | the sanctuary's ancient gold | orders, Gold Coins/Pouches from Houses, selling, chests, level-ups | **timer skips** and **Warmth refills** — the two live sinks | **[L1]** |
| **Gold Keys** | keys of ancient gold ("Stone Key" in the tutorial) | **one, granted by the tutorial**; [full] orders, chests, merging Silver Keys | unlocking fog regions — one gate in the demo | **[L1 scripted once] — see §12** |
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
| Knob | Shipped today | Full-game target | Rationale |
| --- | --- | --- | --- |
| Max Warmth | **30**, +3 per Keeper level | **40**, +5 per milestone | cap = session *length* |
| Start | **28** (so the tutorial's free Spark visibly tops it up) | — | teach the shop without a wall |
| Regen | **+1 / 60 s** | +1 / 30 s (faster for cozy) | regen = session *frequency* |
| Level-up | **full refill + scaling Gold** (`LEVELUP_REWARD`) | + cap bump | rescue the player at the wall → reward, not friction |
| Offline | yes, catch-up on load, **3 banked cycles/producer** | **uncapped overflow banks** | rewards never wasted |
| Floor at 0 | **shipped** — free auto-producers keep working (§4.3) | same | never open to a dead board |

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

### 9.2 Level cap & curve **[L1 six-level array → full curve]**
- **Shipped:** `LEVEL_XP = [0, 60, 220, 420, 1000, 1400]` — six levels. The
  tutorial earns exactly 60 XP so Level 2 lands on its scripted `levelup` beat;
  Level 3 crosses on `eleanor_hearth`'s delivery and opens `level_5`'s land;
  Level 4 opens `beyond_l4`, Level 5 opens `beyond_l5`, Level 6 is the cap and
  lands near the north's last delivery. No threshold sits inside the
  `keepers_hoard` window (the finale fires on that quest, and a level-up glide
  must never fight its choreography). At the cap the XP bar reads *"A true
  Keeper ✦"*.
- **[full]** A visible **Keeper Level** with a **soft cap (~40)** the content
  roadmap raises (genre-standard; Merge Mansion caps at 50 "to be increased").
  **Steep-then-flat curve:** reach ~level 8–10 in the first 1–2 sessions to
  front-load unlocks, then rising XP-per-level.

### 9.3 Level-up rewards (a multi-reward burst) **[L1 refill + Gold + chest; rest full]**
Shipped: `RewardSystem` grants a **full Warmth refill + scaling Gold**
(`LEVELUP_REWARD`: 25 base + 15/level) on every `keeper:leveled`, plus a
**Bronze Chest on the board from Level 3 on** (`chestFromLevel` — never on the
tutorial's scripted Level-2 beat; the chest carries the active world's gift
table, and a full board banks it in the Bag), with a celebration banner, spark
burst and rising arpeggio. The full design adds more: an **alternating chest**
(odd levels Ember Chest, even levels Sky Chest, so each level feels distinct) +
occasional **cap bump / new unlock**. The refill rescues the player exactly
when they'd hit the Warmth wall — friction becomes reward.

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

## 11. Eleanor's Ledger — the order system

The order board is the narrative + XP/Gold engine.

### 11.1 Structure **[L1 one order → full board]**
- Orders **wait on the board — they never fail** (cozy: no timer pressure). **[L1]**
- Each order: *"deliver N of {chain,tier}"* → pays **Gold + XP**. **[L1]**
- **Deliver and Give are one verb in two grammars [L1]:** a piece GIVEN hand to
  hand that the giver's live order needs is banked toward the delivery (the
  card's count and the Deliver button read board + bank as one tally; giving
  every required piece completes the order by itself), and a live GIFT step of
  the active quest appears in the Ledger as its own card whose Deliver button
  hands the pieces over straight off the board — same counter, same per-piece
  Regard as a bag give.
- **Shipped:** four authored Eleanor orders forming the demo's difficulty ramp —
  *Rekindle the Brazier* (6× Gem Shard → 25 G / 30 XP, **and the Golden Egg
  appears**) → *Warm the Long Hearth* (3× Flame Gem → 75 G / 35 XP) → *The
  Radiant Centerpiece* (1× Radiant Gem → 110 G / 50 XP) → *The Keeper's Hoard*
  (3× Radiant → 240 G / 85 XP) — plus **4 repeatable orders** so the Ledger
  never dead-ends after the last authored one. Every shipped order pays
  `keys: 0`. **[L1]**
- **[full]** 3–4 persistent requests visible at once + **1 auto-order** slot
  (auto-completes when the item exists), and occasional **Gold Key / Star Shard**
  on milestone orders.
- **Givers:** Eleanor (all of them today), and **[full]** dragons themselves once
  hatched (a dragon "asks" for its favourite pebble — ties orders to the
  affection theme).
- **Keeper's Tasks [L1]:** a second Ledger tab holds the chapter checklist
  (`tasks.json`) — hatch 4 dragons · complete 5 orders · earn 500 Gold · merge
  30× · commune with the Golden Elder 10× (locked until `eleanor_brazier` +
  Level 3) → **150 Gold + 5 Warmth**. This is the demo's stand-in for dailies
  (§14): a checklist asks for one more *session*, not one more *day*.
- **Self-correcting difficulty:** if you end a session unable to fill an order,
  the next session offers an easier one (Gossip-Harbor pattern). **[full]**

### 11.2 The long project order **[full]**
One always-present **Restoration Project** is a multi-day deferred goal
("Relight the Grand Hearth: deliver 40 Hearthstones over time") — the long-tail
retention anchor distinct from moment-to-moment orders.

Orders are JSON ([`orders.json`](../src/data/orders.json)); adding one is a data
edit. **[L1]**

---

## 11b. Selyna's Cauldron — brewing **[L1]**

The pot standing in the **Runevault hub** opens a brew screen on tap
(`ui:cauldron_tapped` → `CauldronPanel`). Recipes live in
`src/data/cauldron.json`; `CauldronSystem` owns the trade.

- **Bag → Bag only.** Inputs are validated against and consumed FROM the Bag
  (`bag:consume`), the output is banked INTO it (`bag:bank`). The cauldron never
  touches a board, which is what lets goods gathered on any world pay for it.
- **The outputs are the point**: every dragon egg in the roster is brewable —
  Red and Green cheaply, the legendary Ashdrake/Rimewyrm eggs in multiples of
  cross-world tier-3 goods, and the Golden Egg as the mythic peak — plus
  utility brews (Hearth Cake, Treasure Chest). Difficulty scales with rarity;
  every input is a RENEWABLE piece (see `docs/quest-ladder.md` §6 for why that
  is load-bearing).
- **Refusals are loud and up-front**: `ingredients` (a have-count is red) or
  `bag_full` (the output would need a slot the Bag cannot free), and nothing is
  spent on a refusal — validated in full before the first `bag:consume`.
- UI grammar: recipe ledger left (lit dot = brewable now), the selected
  formula right — flavor, use, one ingredient card per input showing need and
  the in-bag count in **red when short** — and a BREW button that sleeps until
  the Bag covers everything.
- **The pot is Borealis's second verb, and its ladder is built on that.** Seven
  all-northern recipes (Broken Strake, Frost Thread, Pitch Cake, Oil Lamp,
  Lodestone, Spun Skein, Rune Shard) each turn an ABUNDANCE into a SCARCITY,
  which is the one trade a merge board cannot make — merges only ever climb one
  chain. Seven Borealis quests brew them, alternating with merge quests from
  quest 3 to 16; a `brew` quest goal counts a lifetime `brew:<recipeId>` stat
  and is charged its recipe's inputs by the availability audit. See
  `docs/quest-ladder.md` §2 (Borealis) for the rhythm and why each recipe exists.
  The southern recipes are free-play: no quest names them.

## 12. Keys & region unlocks

> ### Shipped scope — the key is a single scripted prop
> Exactly **one** key exists in the demo: the tutorial's `key_unlock` step fires
> `effects: [{ grantKeys: 1 }]`, and the player spends it on `level_2_gate` on
> the very next tap. That is the whole lesson — *keys open fog*. Eleanor calls it
> a **Stone Key** in dialogue; the HUD/state call it a key. Afterwards the
> counter is 0 permanently: no order, repeatable, chest gift or level-up grants
> another, and the shop sells none by design. Every later region is level-gated.
>
> So the key **loop** below is unbuilt, not broken. Building it (Chapter Two) is
> the natural home for chests and the Bronze→Silver→Gold ladder — and would give
> the tutorial's lesson somewhere to go.

- **Gold Keys** unlock **fog regions** (ash-fog clouds curl away, land
  rekindles, contents appear). **[L1 — once, scripted]**
- A region may *alternatively* open when the Keeper reaches the region's **Level
  tag** (authored on the clouds in the world-builder), so progress isn't
  hard-blocked on key luck. **[L1 — the only path that fires today]**
- **[full]** The Bronze→Silver→**Gold** key merge mini-chain (§3.2) is the
  satisfying secondary way to make Keys, with chests that open for **2 matching
  keys** (the Merge-Dragons chest/key model) — gating *loot*, never story.

---

## 13. The meta-spine: restoring the sanctuary

The long-term goal and the story container are **one thing**: rebuild Emberkeep,
terrace by terrace (the Merge-Mansion renovation spine, themed).

- Spend **Gold + Stone-chain materials** to **restore structures** on a rekindled
  terrace (the brazier, the hatchery roost, the gold-chain moorings).
- Each restoration **unlocks the next story beat** (Eleanor reveals another piece
  of *how the Great Flame went out*), a **new chain/breed**, and a small
  **resource payout** (so the meta-goal returns resources, never purely
  extractive).
- Offer **2–3 cosmetic restoration choices with no wrong answer** (warm cozy
  self-expression), and keep **one central deflected mystery** open — *why* the
  Flame really died, and what Eleanor isn't saying — to pull the player across
  the whole campaign.

---

## 14. Events & LiveOps (cozy, solo-friendly)

**None of this is in the demo, on purpose** — a 25-minute chapter shouldn't ask
for a calendar. The **Keeper's Tasks** checklist (§11.1) and the finale
cliffhanger do the retention work instead; the hooks below are for the full
game. No competitive leaderboards (wrong tone for cozy). Three light recurring
hooks:

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

**The collection half is already seeded [L1]:** the **Emberkeep Cookbook**
(`CookbookPanel`, `cookbook:discovered`) inscribes every merge recipe the player
discovers and keeps a discovered-count — a reason to merge something you don't
currently need. The dragon album is its natural extension.

---

## 15. The event catalogue (EventBus contract)

All cross-module communication is the typed synchronous `EventBus`
([`types.ts`](../src/core/types.ts)). The implemented contract **[L1]** plus the
**[full]** additions this design implies:

The live contract is **58 events** in `types.ts`; the adjacency table
(emitter → handler, per event) is [docs/ripple-map.md](ripple-map.md) §1 —
regenerate it after structural refactors rather than duplicating it here.

**Intents (UI/scenes emit) [L1]:** `drag:dropped`, `item:tapped`, `fog:tapped`,
`generator:skip`, `dragon:work`, `dragon:rest`, `elder:tapped`,
`chest:open`, `ui:ledger_toggled`, `ui:deliver_requested`, `ui:sell_requested`,
`ui:shop_requested`, `ui:cookbook_opened`, `ui:cookbook_closed`,
`tutorial:advance_requested`, `game:reset_requested`, `time:advanced`,
`audio:set_music_muted` · **[full]** `ui:stoke_requested`, `ui:bubble_popped`,
`ui:restore_requested`, `ui:festival_claim`.

**Commands (systems handle synchronously) [L1]:** `energy:spend`, `energy:add`,
`energy:refill`, `energy:set`, `economy:add`, `economy:spend_keys`,
`board:spawn`, `board:move`, `board:retier`, `board:consume_items`,
`generator:set_timer`, `generator:reward` · **[full]** `board:bubble_item`,
`warmth:rekindle_tiles`, `shrine:produce`.

**Notifications (UI + audio subscribe) [L1]:** `item:spawned`, `item:moved`,
`item:move_bounced`, `item:merged`, `item:hatched`, `item:harvested`,
`item:harvest_failed`, `item:produced`, `item:removed`, `item:sold`,
`generator:skipped`, `dragon:working`, `dragon:rested`, `chest:claimed`,
`gold:collected`, `marketplace:purchased`, `cookbook:discovered`,
`energy:changed`, `economy:changed`, `keeper:leveled`, `order:progress`,
`order:completed`, `order:all_done`, `tasks:all_complete`, `region:unlocked`,
`region:unlock_failed`, `tutorial:step`, `state:saved`, `state:loaded`,
`game:reset` · **[full]** `item:cascaded`, `dragon:napped`, `dragon:tired`,
`shrine:lit`, `shrine:reward`, `terrace:rekindled`, `festival:progress`,
`daily:completed`.

Systems never call each other — they emit commands the owning system handles.
UI and audio only emit intents and subscribe. **[L1, non-negotiable]**

---

## 16. Tuning tables (concrete starting numbers)

All live in [`Constants.ts`](../src/core/Constants.ts) or `src/data/*.json` — no
magic numbers in systems. Starting values for the full game (tune to telemetry):

| System | Knob | **Shipped today** | Full-game target |
| --- | --- | --- | --- |
| Warmth | max / start / regen / level-up | 30 (+3/level) · 28 · +1 per 60 s · full refill + Gold | 40 (+5/milestone) · +1 per 30 s |
| Dragon t3 | harvest cost · nap · passive | 1 Warmth · 45 s · gift/180 s | + stamina 3 then deep-nap 3 min |
| Dragon t4 (Adult) | harvest cost · nap · passive | 1 Warmth · 30 s · gift/120 s | + stamina 5 then deep-nap 4 min |
| Free producers | berry · house · tree/crystal · chest | 20 s · 210 s · 300 s · 300 s | + nests, Hearth Trees |
| Skips | max Gold · Warmth premium | 20 (60 for the Crystal) · 1.5× | unchanged |
| Dragon jobs | work · rest · rate | 180 s · 300 s · 2× per worker | unchanged |
| Merge XP | tier 2 / 3 / 4 | 0–6 / 14–26 / 36–40 | 0–4 / 8–14 / 20–30 · top 40+ |
| Order reward | O1 → O4 | 25/30 · 75/35 · 110/50 · 240/85 (G/XP) | + Keys, Shards on milestones |
| Keeper level | curve | `[0, 60, 220]` — ends at 3 (chapter) | level 10 by session 2 · soft cap 40 |
| Shrine | first drop · idle yield | **not shipped** | loot burst · reward / ~3 h active |
| Festival | milestones | **not shipped** | 3, cost ~doubling per stage |

---

## 17. What "Chapter One: Cinder Hollow" proves today

**[L1] implemented** (unit + full e2e through the finale): merge-3 & 5→2 **plus
per-tier merge-2 overrides**, the hatch ceremony on two dragon breeds, four-tier
dragon chains, tap **and** passive generators, Gold/Warmth timer skips, dragon
jobs at Houses, the recurring treasure chest, free auto-producers (the
zero-Warmth floor), Warmth (cap 30, +1/60 s, offline catch-up + banked cycles +
the welcome-back card), the Warmth/Gold shops, a **four-order Ledger with
repeatables**, the **Keeper's Tasks** checklist, the cookbook, level-gated region
unlocks with camera glide and ash→moss rekindle, XP & Keeper levels with
full-refill level-ups, sell tooltip, versioned autosave, the 58-event EventBus
contract, and the data-driven JSON spine.

**Deliberately capped:** `LEVEL_XP` ends at 3 — the chapter ends because the
*story* pauses, not because the land does (`level_5` opens at the cap). The
`FINALE` timeline already hangs off `quest:completed` for
`GOLDEN_ALTAR.awakenQuestId`, so extending the campaign is a quest edit.

**Known scope edge:** the key economy is one scripted grant, then nothing (§12);
board-full has no bubble overflow, only a block (§4.4).

**[full] designed here, ready to build** (mostly JSON + new systems on the same
bus): longer chains & more breeds, stamina deep-naps, bubbles, cascades, Flame
Shrines (idle income), Star Shards, auto-orders + project orders + dragon givers,
per-tile rekindle & Sanctuary Warmth, the restoration meta-spine, and the
festival/almanac/daily LiveOps.

---

## 18. How it maps to the architecture (so it's buildable, not just prose)

| Design concept | Where it lives | New work |
| --- | --- | --- |
| Chains, tiers, XP, sell, generators, merge overrides | `chains.json` | data only |
| Orders + repeatables, givers, rewards | `orders.json` (+ `OrderSystem`) | data; auto-order/projects new |
| Keeper's Tasks checklist | `tasks.json` (+ `TaskSystem`) | **shipped** |
| Regions, fog, level-tags, contents | `map.json` (+ world-builder export) | data only |
| Warmth tuning, cap curve, skip pricing, finale timeline | `Constants.ts` | data only |
| Merge / 5-merge / pair-merge / cascade | `MergeSystem` | cascade = new branch |
| Harvest / passive gifts / skips / auto-producers | `GeneratorSystem` | **shipped**; stamina new |
| Dragon jobs (work → rest) | `DragonJobSystem` | **shipped** |
| Recurring chest gifts | `ChestSystem` (+ `CHEST_GIFTS`) | **shipped** |
| Level-up payouts | `RewardSystem` | **shipped** |
| Bubbles / board-full | `BoardSystem` + `GameState` | new overflow path |
| Shrines (idle income) | new `ShrineSystem` | bus-driven, `GameClock` ticks |
| Sanctuary Warmth / restoration | new `RestorationSystem` | bus-driven |
| Festivals / almanac / dailies | new `LiveOpsSystem` | bus-driven, save-backed |
| Dragon art & animation | `RigPlayer` (+ rigger/animator tools) | rigs per breed |
| World layout & cloud level-tags | world-builder → `map.json` ingest | tooling done |

Everything new is **a system on the EventBus + a JSON edit** — the architecture
was built for exactly this expansion. Nothing here requires re-architecting what
Level 1 already proves.
