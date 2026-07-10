# Emberkeep — Game-Design Review & Improvement Plan

> A merge-genre specialist audit of the current build (post-tutorial demo,
> "Cinder Hollow"), evaluated against genre benchmarks (Merge Dragons, Merge
> Mansion, Travel Town, Gossip Harbor) **and against Emberkeep's own design
> targets in [MECHANICS.md](MECHANICS.md)**. Every number below was extracted
> from the live code/data (Constants.ts, chains.json, orders.json, map.json,
> tutorial.json, the systems layer) — file references inline.
>
> **This is an evaluation + improvement plan only. No changes have been made.**
> Almost every fix below is a `Constants.ts` / `src/data/*.json` edit or a new
> EventBus system — exactly what the architecture was built for (MECHANICS §18).

---

## 0. Executive verdict

| Question asked | Verdict |
| --- | --- |
| **Is the game flow perfect?** | **No.** The 16-step tutorial itself is genuinely strong (it teaches every verb, including the free-shop beat). But the *first thing the game asks after the tutorial* — Order 1: deliver **20× tier-1 Gem Shards** — is the single grindiest task in the entire game (~40–60 min of timer-waiting with one dragon), and the promised "grand surprise" at Keeper Level 3 is a **demo-over end screen**, an anticlimax after that grind. Post-tutorial, the guide character never speaks again and the player gets zero signposting. |
| **Is the waiting for each reward optimal?** | **No.** Wait timers contradict the game's own cozy design pillars by 6–30×: Warmth regen is 1/**3 min** (design target: 1/**30 s**), dragon harvest cooldown is **5 min** (design target: **10 s** nap + stamina). The result is a *double gate* — energy AND cooldown — where cooldown is almost always the binding constraint, making the energy meter (and the energy shop) nearly irrelevant. Offline return pays **one** pending gift per producer regardless of hours away, so "come back later" barely rewards coming back. |
| **Are there enough daily quests?** | **There are zero.** No daily quests, no login streak, no repeatable orders, no timed events — nothing resets on a calendar. The content total is **4 one-shot orders**, single-active, and when the 4th completes the Ledger says "Cindra will have new work for you soon" *forever*. MECHANICS §14 specifies 3 dailies/12 h reset + a 7-day login streak; none of it exists. |

**Overall:** the *systems spine* (EventBus, data-driven chains/orders, GameClock
determinism, save/versioning) is production-grade and better than most shipped
merge games at this stage. The *tuning and content layer on top of it* is where
the game currently fails its own design document. Everything below is fixable
without touching the architecture.

---

## 1. Current state — the numbers that matter

### 1.1 Wait timers (the pacing skeleton)

| Timer | Current value | Own design target (MECHANICS) | Genre norm | Location |
| --- | --- | --- | --- | --- |
| Warmth regen | 1 / **180 s** | 1 / 30 s (§8.1) | 1 / 120 s (cap ~100) | `Constants.ts:217` |
| Warmth cap | 20 (+3/level) | 40, +5/milestone | 100 | `Constants.ts:213,231` |
| Dragon harvest cooldown | **300 s** (5 min) | 10 s nap + stamina deep-nap (§4.2) | seconds, with "Too Tired" gate | `chains.json:58-63,158-163` |
| Dragon passive gift | 300 s | — | — | same |
| Crystal (emerald source) | **1 200 s** (20 min), no passive | — | — | `chains.json:127-133` |
| House → 1 coin | 600 s | — | — | `chains.json:87-93` |
| Ancient Tree → 1 bush | 1 200 s | — | — | `chains.json:107-113` |
| Chest recharge | 600 s | — | — | `Constants.ts:189` |
| Dragon work / rest | 180 s / 300 s | — | — | `Constants.ts:327-333` |

### 1.2 The order book (all quest content in the game)

| # | Order | Requires | Raw t1 shards needed | Rewards |
| --- | --- | --- | --- | --- |
| 1 | cindra_brazier | 20× flame_gem **t1** | **20** | 0 coins, 30 XP, 1 Golden Egg |
| 2 | cindra_hearth | 4× flame_gem t2 | 12 | 75 coins, 35 XP |
| 3 | cindra_centerpiece | 1× flame_gem t3 | 9 | 110 coins, 1 key, 50 XP |
| 4 | cindra_hoard | 3× flame_gem t3 | 27 | 240 coins, 1 key, 85 XP |

One active at a time, strictly sequential, never refreshed (`OrderSystem.ts:25-27,71-74`).

### 1.3 Progression & ceiling

- `LEVEL_XP = [0, 60, 140, 250, 400, 590, 820]` (`Constants.ts:228`). Tutorial grants exactly **60 XP** (26 hatch + 24 hatch + 10 scripted) → lands on Level 2 at the scripted beat. *(The comment at `Constants.ts:226` still says "~54 XP" — stale.)*
- **Level 3 (140 XP) triggers the `EndScreen('level3')` demo wall** (`UIScene.ts:351-360`). Levels 4–7 are defined but gate **nothing**.
- Regions: `level_1` (active), `level_2_gate` (1 key + L2, 3 bushes inside), `level_2` (auto at L2, 1 Ancient Tree), and `level_5` — locked at **level 99, empty** → unreachable dead content.

### 1.4 Economy flows

- **Gold sources:** orders (425 total), level-ups (25+15×L), house coin (1/10 min), chest (+5, 1-in-3 chance/10 min), selling items. **Gold sinks:** timer skips only (≤9 gold; crystal ≤50). → Gold accumulates with nothing meaningful to buy. The Golden Egg (order-1 reward) exists only to be sold for 200 more sink-less gold.
- **Keys:** earn 2 (orders 3, 4) + 1 tutorial-granted; sink is exactly 1 (level_2_gate — which is already open by then, since the tutorial key unlocks it). → Orders 3–4 pay keys **that have no remaining use**.
- **Skip pricing quirk:** a Warmth skip costs ~0.55× the gold price (`Constants.ts:116-123`) — the *energy* currency is the cheap way to skip timers, inverting the usual premium hierarchy and encouraging burning the session resource on skips.
- **Shop** (`ShopPanel.ts:17-48`, mock USD): sells Warmth, Gold, **and Keys**. Selling keys violates the game's own monetization law — "Star Shards monetise *impatience and friction*, never progression" (MECHANICS §7); keys gate story/land.

### 1.5 Feedback & retention surface

- Order completion — the game's **primary reward beat** — celebrates with *audio only* (a fanfare + the panel closes: `UIScene.ts:223-227`). Level-up gets a banner + 28-particle burst; hatching gets flash + confetti + chime. The reward hierarchy is upside-down.
- Laurah speaks in all 16 tutorial steps, then **never again** (`UIScene.ts:372-377`). Cindra has full `CharacterBubble` support (portrait, name-tag, color — `CharacterBubble.ts:127-191`) and **zero lines**.
- `state:loaded` emits `offlineMs` / `energyRecovered` — **no subscriber reads them** (`types.ts:405`). No welcome-back moment. Passive producers pay at most **one** gift on return, no matter how long you were gone (`GeneratorSystem.ts:162`).
- No pity/stuck mechanics: at 0 Warmth with all cooldowns running, the session is simply over.

### 1.6 The post-tutorial math (why the flow breaks)

To fulfil Order 1 the player must *hold* 20 un-merged t1 shards. The only
shard source is the Green Dragon: 1 per tap (1 Warmth, 5-min cooldown) + 1
passive/5 min ⇒ **≤2 shards per 5 min ⇒ ≥50 minutes** of returning to a
near-idle board — right after a snappy 6-minute tutorial. Making a *second*
green dragon needs 9 emeralds at 1/20 min from the crystal (~3 h, chest luck
aside). Meanwhile 20 held shards + eggs + dragons + houses crowd the small
active region → board-space pressure with no bubble/overflow valve (§4.4 of
MECHANICS, unbuilt). Estimated real time from tutorial-end to the Level-3 end
screen: **2–4 hours, dominated by waiting** — for a demo whose target session
profile is "5–10 minutes" (GDD-L1 §Session profile).

---

## 2. What's genuinely good (keep, don't touch)

1. **The tutorial** — 16 gated steps that teach merge → hatch → harvest →
   ledger → key/fog → work/rest → skip → shop in one continuous arc, landing
   the level-up exactly on the scripted beat. Best-in-class structure.
2. **Hatch ceremony** (flash, confetti, dragon burst) — the emotional engine
   works as designed.
3. **The architecture** — every fix in §3 is a data edit or a new bus system;
   GameClock determinism means every retune stays e2e-testable via
   `advanceTime`.
4. **Anchored energy regen with offline catch-up** and versioned autosave —
   correct and genre-standard.
5. **Dragon Job system** (work/rest global time-acceleration) — a novel,
   thematic idle hook not in the original GDD; worth keeping and surfacing more.

---

## 3. Improvement plan

Ordered P0 → P2. Every item lists concrete target values and where the change
lives. **[data]** = JSON/Constants only. **[system]** = new/changed code.

### P0 — Flow-breaking (fix before anyone else plays the demo)

**P0-1. Invert the order difficulty curve. [data — `orders.json`]**
Order 1 is the grindiest task in the game (20 raw shards); Order 3 needs only 9.
Retarget so raw-shard cost *escalates*:

| # | Requires (new) | Raw shards | Rewards (new) |
| --- | --- | --- | --- |
| 1 | 6× flame_gem t1 | 6 | 25 coins, 30 XP, Golden Egg |
| 2 | 3× flame_gem t2 | 9 | 75 coins, 35 XP |
| 3 | 2× flame_gem t3 | 18 | 110 coins, 50 XP |
| 4 | 3× flame_gem t3 + 1× flame_gem t2 | 30 | 240 coins, 85 XP, 1 key *(only if a key sink exists — see P2-3)* |

Also give Order 1 a small coin reward — 0 coins on the first-ever order reads
as a bug to players.

**P0-2. Pick ONE binding wait-gate and retune to the cozy targets. [data]**
Energy should gate *session length*; cooldowns should be flavor, not walls
(MECHANICS §8). Targets:

| Knob | Current | Target |
| --- | --- | --- |
| Dragon harvest cooldown (`chains.json`) | 300 000 | **20 000–30 000** (20–30 s) |
| Dragon passive gift | 300 000 | 120 000 (2 min) |
| `ENERGY_REGEN_MS` | 180 000 | **60 000** (1/min; own doc says 30 s — 60 s is a safe first step) |
| `ENERGY_MAX` | 20 | 30 (keep +3/level) |
| Crystal cooldown | 1 200 000 | 300 000 (5 min) — it gates dragon #2, the main mid-game goal |
| Chest interval | 600 000 | 300 000 (5 min) for the demo |

With these numbers, Order 1 (new: 6 shards) takes ~3–5 active minutes, and a
20-Warmth session lasts ~10 lively minutes instead of 3 dead ones. Later, add
the designed stamina/deep-nap (§4.2) as the *real* pacing valve — short naps,
occasional "she's too tired" long rest.

**P0-3. Never dead-end the Ledger: repeatable order generation. [system — `OrderSystem`]**
After the 4 scripted orders, generate orders from data templates
(`orders.json` gains a `repeatable` pool: e.g. "N× flame_gem tX" with
N/X/rewards scaled to Keeper level). Cozy rule: the active order must always
exist. This single change removes the "content is finished" cliff and makes
every retention mechanic below have something to point at.

**P0-4. Fix the Level-3 anticlimax. [data + small system]**
`free_play` promises "a grand surprise" at Keeper Level 3; the surprise is an
end screen. Two options, in preference order:
1. Make Level 3 unlock the `level_5` region (rename `level_3_terrace`, set
   `unlock: { level: 3 }`, author contents: 3 strawberry sprouts + 2 eggs +
   a second crystal) and move the demo end screen to **Level 5**, so the
   "surprise" is the camera flying to new land — the game's own best moment
   (the zone-reveal fly already exists and is genre-perfect).
2. If the demo must end at L3, at least stage the end screen *after* a reward
   burst (chest rain + Cindra's first bubble line), not instead of one.

**P0-5. Show 2–3 orders at once. [data + `LedgerPanel`/`OrderSystem`]**
Single-active ordering makes the board feel like a queue, not a sandbox.
MECHANICS §11 specifies 3–4 visible requests. Even 2 concurrent orders lets
the player *choose* what to work toward — the core agency of the order loop.
(`LedgerPanel` currently renders only `requires[0]` of one order — needs a
card list.)

### P1 — Retention & reward loop (the "daily quests" answer)

**P1-1. Daily quests: 3 per day. [new data file + small `LiveOpsSystem`]**
Per MECHANICS §14: a `quests.json` with task templates —
*merge N times, harvest N times, complete N orders, hatch a dragon, open the
chest N times* — pick 3 per day (deterministic from day-index so it's
testable via `GameClock`). Each pays a small reward (10–20 gold or 2 Warmth);
completing all 3 pays an **Ember Box** (chest-tier bundle: +5 Warmth + 3
emeralds). Reset every 24 h off `GameClock.now()`; persist
`{ dayIndex, questIds, progress }` in `GameState` (bump `SAVE_VERSION`).
Three is the right number for this genre and session profile — enough to
shape a session, few enough to finish in one.

**P1-2. 7-day login streak. [same system]**
Day 1–6 small ascending gifts (gold → emeralds → Warmth → key-shard flavor),
Day 7 mega-bundle. Missing a day holds (not resets) the streak for cozy tone.

**P1-3. A welcome-back moment. [system — consume the already-emitted `offlineMs`]**
The payload exists and nothing reads it. Add: (a) passive producers bank up to
**3 cycles** offline (not 1, not unlimited — a small waiting harvest, per
MECHANICS §4.3); (b) a "While you were away" card on load: Warmth recovered,
gifts waiting, chest ready. This is the single highest-leverage retention fix
in the codebase because the plumbing already exists.

**P1-4. Celebrate order completion properly. [scene-layer]**
Give the primary reward beat at least level-up parity: banner + spark burst +
coin-fly + **Cindra's first spoken bubble line** (CharacterBubble already
supports her — she has never used it). Rotate 3–4 proud-grandmother lines.

**P1-5. Post-tutorial guidance. [data — extend tutorial.json or a hints table]**
Laurah idle-nudges on trigger conditions, each shown once: first time at 0
Warmth ("rest by the fire — Warmth returns on its own"), first `order:all_done`,
first board-nearly-full, chest-ready-but-unclaimed for >2 min. Kills the
guidance vacuum without a second tutorial.

**P1-6. Pity valve at zero. [data first]**
The design's own rule: *always something to do at zero Warmth* (§4.3). Cheapest
version: make the strawberry generator real (see P2-2) with `energyCost: 0` —
a free 20-second producer is exactly the designed "cozy floor." Optionally: if
Warmth is 0 and no generator is ready, the chest recharges 2× faster.

### P2 — Economy hygiene & depth

**P2-1. Give gold a purpose. [data + small system]**
Current sinks (timer skips ≤50) can't absorb order payouts (425+). Add, in
order of value: (a) a gold-purchasable board region (the dead `level_5` area
— "restore the terrace: 300 gold" fits the restoration fantasy and the
Merge-Mansion renovation spine); (b) buy chest gifts directly (25 gold);
(c) decor items per GDD. Raise chest gold from +5 to +15 so the gift tier
matches the sink scale.

**P2-2. Revive the dead content. [data]**
- **strawberry chain**: fully built (art, anchors, 20 s generator) and placed
  nowhere. Drop 3 sprouts into `level_2_gate` or the new L3 terrace — it's the
  designed free auto-producer.
- **level_5 region**: repurpose (P0-4 / P2-1) or delete from map.json.
- **Levels 4–7**: each must gate something (region, chain tier, Warmth-cap
  bump, the Stoke booster from §9.4) or trim `LEVEL_XP` to the demo's real
  ceiling. An XP bar that fills toward nothing is negative signaling.
- Delete or wire: `GENERATOR_SKIP_ENERGY` (`Constants.ts:92`), `SKIP_GOLD_MAX`
  (`Constants.ts:210`), the unused `generator.reward` path, the unreachable
  merge-XP on `coin_2` (60) / `golden_egg` (80), the stale "~54 XP" comment
  (`Constants.ts:226` — actual is 60), and note `world-map.json` is
  tooling-only.

**P2-3. Fix the key economy. [data]**
Earnable keys: 3. Key sinks: 1 (already spent by the tutorial). Either add
key-locked regions (best), or stop paying keys in orders 3–4 and pay gold/
Warmth instead. And **remove keys from the shop** — selling story-gates
violates the game's own monetization law (§7); replace the third shop tab
with a Star-Shard-style convenience currency when one exists.

**P2-4. Rationalize skip pricing. [data — `Constants.ts:116-123`]**
Warmth-skips at 0.55× the gold price make energy the discount skip currency.
Invert: gold (plentiful, sink-starved) should be the *cheap* skip; Warmth
skips should cost ≥1.5× equivalent or be removed. One knob, big incentive fix.

**P2-5. Golden Egg should hatch, not sell. [data + a hatch hook]**
The order-1 reward is the game's emotional currency (an egg = a promise) that
can only be… sold. Even a cosmetic hatch (a golden whelp decor/generator with
a long timer) converts it from 200 sink-less gold into the game's best
retention object.

**P2-6. Telemetry hooks. [system, small]**
Nothing measures the funnel today. Emit (or log behind a flag) the events a
tuning pass needs: `tutorial:step` timing (exists — persist durations),
time-to-order-N, session length, Warmth-at-zero occurrences, end-screen
reached. The EventBus makes this a single subscriber. Without it, every number
in this doc gets re-tuned on vibes.

---

## 4. Recommended tuning table (current → proposed)

| Knob | File | Current | Proposed |
| --- | --- | --- | --- |
| ENERGY_REGEN_MS | Constants.ts:217 | 180 000 | 60 000 |
| ENERGY_MAX | Constants.ts:213 | 20 | 30 |
| Dragon cooldownMs (both) | chains.json | 300 000 | 25 000 |
| Dragon passiveMs (both) | chains.json | 300 000 | 120 000 |
| Crystal cooldownMs | chains.json | 1 200 000 | 300 000 |
| CHEST_INTERVAL_MS | Constants.ts:189 | 600 000 | 300 000 |
| Chest gold gift | Constants.ts:202 | +5 | +15 |
| House passiveMs | chains.json | 600 000 | 420 000 |
| Order 1 requirement | orders.json | 20× t1 | 6× t1 |
| Order 1 coins | orders.json | 0 | 25 |
| Warmth-skip multiplier | Constants.ts:116 | 0.55× gold | ≥1.5× gold (or remove) |
| Active orders visible | OrderSystem/LedgerPanel | 1 | 2–3 |
| Daily quests | — | 0 | 3/day + all-3 bonus |
| Offline producer banking | GeneratorSystem.ts:162 | 1 cycle | 3 cycles |

All timer changes stay deterministic under `window.advanceTime`; the tutorial
e2e must be re-run (`pnpm verify`) since `dragon_rest`/`house_skip` steps
reference concrete durations (185 000 / 600 000 ms in tutorial.json).

---

## 5. Suggested sequencing

1. **Wave 1 (pure data, ~no code):** P0-1, P0-2, P2-4, chest/gold retune,
   strawberry placement (P1-6/P2-2). → The demo becomes playable at the
   designed 5–10-minute session immediately.
2. **Wave 2 (small systems):** P0-3 repeatable orders, P1-3 welcome-back,
   P1-4 order celebration + Cindra lines, P0-5 multi-order Ledger.
3. **Wave 3 (retention layer):** P1-1 dailies + P1-2 streak (one
   `LiveOpsSystem` + `quests.json` + save-version bump), P1-5 hint nudges,
   P0-4 L3 terrace reveal.
4. **Wave 4 (hygiene):** P2 dead-content cleanup, key/shop fixes, telemetry.

Each wave is independently shippable and verifiable with `pnpm verify`.
