# The quest ladder — what the HUD tracks, and the proof it is playable

> **Status: SHIPPED.** This is the Chapter One ladder the on-screen tracker
> actually reads. The twelve-chapter campaign spec — nests, Trust, Regard,
> journeys — is [quests.md](quests.md), and none of it is wired yet.
>
> Source of truth: `src/data/quests.json` (the ladder), `src/systems/QuestSystem.ts`
> (the pointer), `src/core/availability.ts` (the proof), `src/ui/QuestTracker.ts`
> (the readout). This document is the map to them.

## 1. One question, answered in one place

The tracker used to show two unrelated things stacked on each other: the active
Ledger order on top, the five lifetime Keeper's Tasks underneath. They never
referred to one another, so the sub-rows were not subquests of anything.

They are now **one thing**: a MAIN quest, and its own ordered SUBQUESTS.

```
                              Craft the Radiant Centerpiece
                                                     1 / 2
                                      Make 1 Radiant Gem  1 / 1
                        Deliver 1 Radiant Gem to Eleanor  0 / 1
```

**Every sub-row is a verb, a number and a piece**, and a delivery names who it
goes to. That is a rule, not a style: the row is the only instruction most
players will read, it renders on ONE line with no wrap, and a title like *"Give
the old court something to look at"* tells someone who just merged three gems
precisely nothing about what to press next. Flavour lives in Eleanor's blurb on
the Ledger card, where there is room for it. Budget is ~45 characters; the
longest shipped row is 33.

The main line is `QuestSystem.activeQuest` — the first quest on the ladder that
is not finished. The rows are that quest's steps. Nothing else can appear there.

## 2. The ladder (`src/data/quests.json`)

*Emberkeep. 🥚 marks a quest whose reward is a legendary egg (§6).*

| # | Quest | Order | Chain | Tier | Subquests |
| --- | --- | --- | --- | --- | --- |
| 1 | **Light the Brazier** | `eleanor_brazier` | gems | **T1** | Merge 10 times · Collect 6 Gem Shards · Deliver 6 Gem Shards to Eleanor |
| 2 🥚 | **Fill the Larder** | — | berries | T3 | Make 2 Emberberry Preserves |
| 3 | **Warm the Long Hearth** | `eleanor_hearth` | gems | **T2** | Make 2 Flame Gems · Deliver 2 Flame Gems to Eleanor |
| 4 | **Raise the Roofs** | — | timber | T3 | Build 2 Houses |
| 5 | **Light the Long Gallery** | — | gems | **T2** | Make 4 Flame Gems |
| 6 🥚 | **Catch the Moonwater** | `eleanor_moonwater` | moonwater | T3 | Make 1 Moonwater · Deliver 1 Moonwater to Eleanor |
| 7 | **What She Keeps** | — | berries | **T2** | Give Eleanor 2 Emberberry Baskets · Give Eleanor 1 Emberberry Preserve *(locked until 1 heart — long paid by here)* |
| 8 | **Craft the Radiant Centerpiece** | `eleanor_centerpiece` | gems | T3 | Make 1 Radiant Gem · Deliver 1 Radiant Gem to Eleanor |
| 9 | **Fill the Keeper's Hoard** | `eleanor_hoard` | timber | T4 | Merge 2 Houses into a Manor · Make 3 Radiant Gems · Deliver 3 Radiant Gems to Eleanor — **the FINALE quest** (`GOLDEN_ALTAR.awakenQuestId`) |
| 10 🥚 | **The Keeper's Tasks** | — | mixed | — | the five `tasks.json` entries, by reference |
| 11 | **Wake the Ashdrake** | — | — | — | Merge 3 Ashdrake Eggs into the Ashdrake |
| 12 | *(the live order's title)* | the encore | — | — | Deliver 8 × Gem Shard to Eleanor |

**No quest asks for a dragon any more.** "Raise the Ember Brood" (Make 4 Red
Eggs) was cut: the red dragon is meant to be UNIQUE and the Dragon Ruby is
leaving the merge board, so a quest asking for four of its eggs was asking the
player to mass-produce the one thing the design wants rare. It was also the
ladder's only `dragons` beat, which is why the order below is not simply the old
one with a hole in it.

**The ladder ping-pongs on TWO axes, and both are load-bearing.**

*By tier* — an easy low-tier ask, then a dear one, all the way down: **T1**, T3,
**T2**, T3, **T2**, T3, **T2**, T3, T4. A player is never asked for two deep
merges in a row, and the bold column is what they can clear in one sitting
between the long ones. The one exception is the last pair, 8 → 9, and it is
forced: with the brood quest cut there are four low-tier asks for five high ones,
so exactly one doubling has to happen and the finale is where it belongs. This is why **Raise the Roofs sits at 4, not at 2** — two
Houses is nine Plank Sets, and landing that on the quest right after the tutorial
made the second thing the game ever asked for the heaviest thing it had asked so
far. The low side climbs T1 → T2 across the chapter; the high side holds at T3
until the finale takes T4.

*By chain* — no two consecutive quests work the same merge chain, the low tiers
of a chain come before its high ones, and a chain rests at least one quest before
the ladder returns to it. (It used to open with FOUR gem quests in a row.)

Two things follow the shuffle rather than surviving it. The legendary eggs sit at
completable indices 1 / 5 / 9 — gaps of 3 and 3, last egg second-to-last, all
audit-enforced (§6). And `orders.json`'s scripted sequence is kept in the order
its quests consume it (brazier → hearth → moonwater → centerpiece → hoard),
because the Ledger serves scripted orders in file order, two at a time, and a
quest must never wait on an order the Ledger has not surfaced yet.

One slot is not free to move: **quest 2 has to be a T3 the board can already
make.** At Level 2 with three regions open, that is berries or timber and nothing
else — the Dew Basin is behind a Level-3 fog, so Moonwater at slot 2 audits
UNREACHABLE ("needs 3 × Dew Vial, and only 1 can ever exist"). Timber is spoken
for at 4, which leaves the Larder. Anything cheaper there would break the
alternation on its first step.

Quest 6 is the tutorial's `moonwater_merge` promise kept: Eleanor tells the
player "three vials make true Moonwater, and that is what I will ask you for",
and this is the order that asks. Moonwater and quartz are `MAGE_ONLY` — no
dragon eats any tier of either — so without this sink the chain and the Dew
Basin that feeds it would be dead stock.

*Borealis (`world: "borealis"`). 🍲 marks a CAULDRON quest — brewed at Selyna's
pot through the Rune Way, not merged on an island.*

| # | Quest | Order | Subquests |
| --- | --- | --- | --- |
| 1 | **Make Camp on the Ice** | `selyna_signal` | Merge 3 Drift Spars into a Bound Faggot · Deliver 2 Bound Faggots to Selyna |
| 2 | **Open the Wrack Coast** | — | Spend 1 Gold Key on the fog along the coast |
| 3 🍲 | **Strakes from Spars** | — | Brew 4 Broken Strakes |
| 4 | **Feed the Northern Dragons** | `selyna_pitch` | Build a Drift Stack from 9 Drift Spars · Make 3 Pitch Cakes · Deliver 3 Pitch Cakes to Selyna |
| 5 🍲 | **Thread from the Frost** | — | Brew 4 Frost Threads |
| 6 | **Salvage the Wrecks** | `selyna_frames` | Make 2 Lashed Frames · Deliver 2 Lashed Frames to Selyna |
| 7 🍲 | **Boil the Pitch** | — | Brew 3 Pitch Cakes |
| 8 🥚 | **Open Selyna's Keep** | — | Spend 2 Gold Keys on the fog around the keep |
| 9 🍲 | **Light for the Long Dark** | — | Brew 3 Oil Lamps |
| 10 | **What She Will Take** | — | Give Selyna 2 Bound Faggots · Give Selyna 3 Frost Flowers |
| 11 🍲 | **Something That Points** | — | Brew 3 Lodestones |
| 12 🥚 | **Turn Two Hulls** | — | Make 2 Upturned Hulls |
| 13 🍲 | **Spin It Fine** | — | Brew 3 Spun Skeins |
| 14 | **Stock the Pitchworks** | — | Make 1 Black Ember |
| 15 🍲 | **Split the Nodule** | — | Fire a Black Ember into shards |
| 16 | **Raise a Longhall** | — | Merge 2 Lashed Frames into an Upturned Hull · Merge 2 Upturned Hulls into a Longhall — the two hulls from quest 12 are exactly what it merges |
| 17 🥚 | **Spin the Light-Fast Spindles** | `selyna_spindle` | Earn a place at Selyna's fire · Grow a Rime Bloom · Make 2 Light-Fast Spindles · Deliver 2 to Selyna |
| 18 | **Wake the Rimewyrm** | — | Merge 3 Rimewyrm Eggs into the Rimewyrm |
| 19 | *(the live order's title)* | the encore | whatever her Ledger asks |

**The north ping-pongs between its two KINDS of work, where Emberkeep ping-pongs
between tiers.** Its islands are small and its chains are short, so a tier
rhythm runs out of low-tier asks by quest 6 (§2's problem, restated). What the
north has instead is a second verb: the pot. From quest 3 to quest 16 the ladder
alternates **M C M C M C M C M C M C M M** — never two brews back to back (a
second trip through the Rune Way with nothing merged between them is the thing
this rhythm exists to prevent), and exactly one merge double at the end, because
the legendary arc puts the last egg on the second-to-last quest.

**The first brew lands at quest 3 of 18 — 17% of the way down.** That number is
authored, not incidental: `RUNEVAULT_QUESTS_NEEDED = 2` opens the Rune Way on
quest 2's completion, one quest before the ladder first asks for a brew, and
`QuestAvailability.spec` fails the build if the two ever drift apart or if the
first brew leaves the 15–20% window.

**Every northern recipe converts an ABUNDANCE into a SCARCITY, which is the one
thing a merge board cannot do** — merges only ever climb one chain. That is what
each of the seven quests is for:

| # | Brews | Out of | Because |
| --- | --- | --- | --- |
| 3 | Broken Strake | 1 Bound Faggot | Strakes trickle from the Wrack Line one per three yields; the whole keel chain waits on them |
| 5 | Frost Thread | 1 Rime Cluster | Thread otherwise needs a full-grown Rime Bloom first |
| 7 | Pitch Cake | 2 Tar Knots + 2 Drift Spars | The north's fuel, and the wood is what makes it burn slow |
| 9 | Oil Lamp | 1 Pitch Cake + 2 Dram Vials | Only five lamps were ever seeded; the Hearthlamp is a tappable generator |
| 11 | Lodestone | 2 Mana Pebbles + 1 Broken Strake | Same for the Wayfinder, which pays coin forever once built |
| 13 | Spun Skein | 2 Frost Threads + 1 Rime Cluster | Feeds quest 17's two Light-Fast Spindles directly |
| 15 | Rune Shard ×3 | 1 Mana Nodule + 1 Black Ember | A SECOND Runestone, i.e. a second tar generator — and it spends the Black Ember quest 14 just taught |

Two rules hold this together, both enforced. **A brew is charged its
ingredients**, `count` times over, in the world that asks (`questStepNeeds`), so
`pnpm quests` proves a northern brew the same way it proves a merge. And
**no northern recipe reaches south**: the cauldron trades Bag→Bag and the Bag
crosses worlds, so a recipe *could* ask for Gem Shards — and then the quest would
send the player back through a portal mid-step with no word of it on screen.
`chainHiddenIn` is asserted over every quest-brewed input for that reason. (The
seven southern recipes — Hearth Cake, the eggs, the Golden Egg — are untouched
and remain free-play brewing, driven by no quest.)

**The Borealis fog lifts south → north, on keys alone.** Shore (open, cy≈1509
world px) → coast (1 key, cy≈884) → keep (2 keys, cy≈652): each cloud is the
next island up the map, and the escalating cost makes the march unspendable out
of order — at one banked key only the coast is affordable. Every generator a
quest needs stands on ground already open when it asks (shore's Wrack Line funds
the signal fire; the coast's Wrack Lines, Hoarfrost Fonts and six Broken Strakes
fund the pitch and frames orders that pay for the keep) — `pnpm quests --all`
proves it, and Selyna's door is deliberately the arc's last and dearest fog.

*The Golden Elder (`giver: "golden_elder"`, Emberkeep, post-finale).*

A world can host TWO givers: a quest belongs to a `(world, giver)` TRACK, and
`QuestSystem` runs each track's pointer separately (`giversHere`,
`activeQuestFor`, `trackedFor`; `quest:advanced` names its giver). The tracker
shows one track at a time and grows a small round arrow left of the main line —
visible only while two tracks are live — that cycles between them; the Elder's
titles wear a `✦` so a glance says whose page is open. His whole ladder carries
`lockedUntil: { quest: "keepers_hoard" }`, a QUEST-level gate reading the
`q:done:` latch: while he sleeps his quests are dormant — not tracked, not
announced, and **never latched**, so a board that happens to satisfy an ask
weeks early credits nothing.

| # | Quest | Chain | Ask |
| --- | --- | --- | --- |
| 1 | **The Seeing Stones** | quartz T2 | Make 2 Cut Crystals |
| 2 | **Green Over the Ash** | ashmoss T3 | Make 2 Green Bales |
| 3 | **The Old Forest** | firgrain T3 | Grow 2 Fir Trees |
| 4 | **Kindle the Brood** | dragons T3 | Raise 2 Red Dragons |
| 5 | **Gold in Hand** | coin T2 | Make 2 Gold Pouches |
| 6 | **Grow, Keeper** | — | Reach Keeper Level 4 (opens `beyond_l4`) |
| 7 | **The Berry Mothers** | strawberry T3 | Grow 2 Ripe Emberberry Plants |
| 8 | **The Cold Light** | moonwater T2 | Make 3 Dew Vials |
| 9 | **The Far-Sight** | quartz T3 | Make 1 Crystal Ball |
| 10 | **Rise Higher Still** | — | Reach Keeper Level 5 (opens `beyond_l5`) |
| 11 | **Two Flames, One Crown** | dragons T4 | Merge 2 Red Dragons into an Adult |
| 12 | **A True Keeper** | — | Reach Keeper Level 6 — the cap |

His ladder is the ENDGAME ladder: it works only chains Eleanor never asks for
(quartz, ashmoss, firgrain, strawberry, coin, moonwater T2, dragons T3/T4 —
no ask collides with hers, no two consecutive quests share a chain, and a chain
rests before it returns), its XP rewards pace the climb to the Level-4/5 land
slabs, and it ends on the level cap rather than an endless tail — when quest 12
closes, the track retires and the arrow disappears. All twelve carry
`regard: 0` (he keeps no gauge) and pay no legendary egg — the Ashdrake arc is
Eleanor's, which is why `auditLegendaryArc` measures rules 3–5 over the
ARC-GIVER's own ladder rather than the whole world's (and errors if two givers
ever split one dragon's eggs).

His voice is `dialogue.json` → `elder`: a one-time greeting on the Gate
ceremony's tail (its last line teaches the arrow), a start/done pair per quest
keyed by quest id, `allDone` for the twelfth, and a once-per-session
restatement of the current ask on load — all timed by `ELDER_VOICE` in
Constants. He never speaks from another world.

**A quest title and its Ledger order carry the SAME name.** `quests.json` and
`orders.json` are edited together — the player opens the Ledger to act on the
HUD line, and two names for one job is a bug, not a synonym.

Quest 1 is the tutorial's own arc, and both halves of the tracker appear on the
`ledger_open` beat — the sub-rows used to wait for the tutorial to finish, by
which point the tutorial had already delivered Order 1 and quest 1's rows had
never rendered at all. They now introduce the widget at the moment the tutorial
is pointing at the Ledger anyway: one row, `Deliver 6 Gem Shards to Eleanor`,
which is the instruction. The last quest never completes, which is what stops the
HUD dead-ending when the scripted orders run out.

**Out-of-order delivery is legal and handled.** The Ledger shows two orders at
once (`VISIBLE_ORDERS = 2`) and Order 3 costs the same nine shards as Order 2, so
a player can finish them backwards. Steps latch wherever they are met, and the
ladder skips any quest already satisfied — the tracker only ever plays a
completion beat for the quest it is actually showing.

## 3. Goal kinds — and why none of them keeps a counter

A goal reads state that already exists, so it cannot drift from the thing it
claims to measure. `TaskKind` counters, `completedOrderIds`, `countItems`,
`level`, `regionStatus`, `discoveredRecipes` — all of it was already there.

| Kind | Finished when | Notes |
| --- | --- | --- |
| `have` | that many of a chain+tier are on the board | **Non-monotonic** — delivering consumes them, so a met `have` is LATCHED |
| `order` | that order is DELIVERED | Its counters show the goods (`6 / 6 — go and deliver`), but holding them is not finishing. Deliver and Give are interchangeable: a piece GIVEN hand to hand that the order needs is banked toward it (board + bank is one tally), and giving everything completes the order by itself |
| `active_order` | never | The endless tail: a live readout of the Ledger |
| `stat` | a lifetime counter reaches the target | The same counters TaskSystem owns |
| `task` | mirrors one Keeper's Task by id | Label, target and lock come from `tasks.json` — **one definition, two readouts** |
| `level` / `region` / `recipe` | Keeper level · fog lifted · Cookbook page | |
| `world` | the player has STOOD there | Latched on arrival, so coming home never re-opens the crossing |
| `gift` | that many of a piece GIVEN to a person | A **lifetime** counter (`gift:<who>:<chain>:<tier>`), so it never needs latching. **Consumed** — the audit counts it as a need. Works in the Deliver grammar too: the active quest's live gift step appears in the Ledger as a card whose Deliver button hands the pieces over straight off the board, per-piece Regard included |
| `regard` | that person's hearts reach N | The only goal that reads a relationship. See §3.1 |
| `brew` | that recipe has been brewed N times | A **lifetime** counter (`brew:<recipeId>`), for the same reason `gift` is one: the output is meant to be SPENT, and a step that un-finished when the player used what they brewed would be a trap. **Consumed** — the audit charges the step its recipe's inputs, `count` times over |

**The latch adds no save field.** It lives in `GameState.stats` as `q:<stepId>`,
which is already persisted — so the whole ladder shipped without a
`SAVE_VERSION` bump (ripple-map: TOUCH GameState fields → CHECK SaveSystem).

### 3.1 Regard — the five hearts (`RegardSystem`)

The relationship gauge for the two PEOPLE, and the human counterpart of a
dragon's Trust. Eleanor keeps one in the south, Selyna one in the north. It
never decays and it cannot be bought: the only two things that pay it are a
completed quest and a gift she actually asked for.

**Points, not hearts.** `stats['regard:<who>']` holds points and
`heartsForPoints()` derives the readout — one number, so the gate and the icons
can never disagree. Tuning lives in `Constants.ts`:

| | | Why |
| --- | --- | --- |
| `REGARD_HEARTS` 5 · `REGARD_POINTS_PER_HEART` 12 | 60 points to fill | |
| `REGARD_QUEST_POINTS` 3 | 20 quests, ledger only | The whole twelve-chapter campaign |
| `REGARD_GIFT_POINTS` 1 | ≈15 quests if you also gift | The floor of the same range |

`QuestConfig.regard` overrides the per-quest payout; an explicit `0` says "this
one is not about her" (both endless Ledger tails carry it). The pacing is
asserted by `RegardSystem.spec` rather than believed, and a second test refuses
any authored `regard` goal or `lockedUntil.regard` gate that wants more hearts
than its own ladder can have paid for by that point — the stalled-HUD defect.

**What she wants is the ladder's business, not the system's.** A gift is
accepted when, and only when, a live `gift` subquest names that exact piece for
that exact person. There is no second want-table to drift, and a decline leaves
the piece on the board — the same contract a nest offering already holds.

**The gesture is the one that already exists**: tap her to arm, tap the piece.
GIVE outranks ASK, so if she is waiting for exactly that piece she takes it
instead of shortening a timer with it. Her hearts float over her standee, hidden
until the tutorial hands the game over.

**Three things it is NOT.** Never shown as a number (`3/5` nowhere, ever —
it is expressed as conduct, [quests.md](quests.md) §1.3). Never purchasable, so
it can never gate story behind a spend. Never keyed to the chapter: the heart
banks in `dialogue.json` are indexed by heart alone, because a diligent gifter
reaches heart 3 chapters before a Ledger-only player and both must hear the same
scene when they get there.

> **Shipped scope.** Gifting is board-only — the bag's third verb
> ([quests.md](quests.md) §1.1) is not built, and keepsakes as a separate
> non-merge item class are not either, so today's gifts are merge goods named by
> a subquest. That inverts §5 of quests.md ("a gift is never a requirement") on
> purpose: the relationship subquest IS the ask.

## 4. The availability proof — `pnpm quests`

> **A quest may only ask for something the player can get at the moment it asks.**

`src/core/availability.ts` answers that offline, with no browser and no save.

**Half one — the tutorial is simulated, beat by beat.** Effects are applied on
the advance INTO a step (exactly as `TutorialDirector` does), then the gate is
satisfied by the cheapest legal player action: merge, harvest, sell, pocket,
unlock, deliver. Anything the script asks for that the board cannot supply is a
hard finding. The XP/level/region state it ends on is the true starting world for
the ladder — which is how the audit knows the tutorial earns **exactly 60 XP**
and lands Level 2 on the `levelup` beat, rather than taking the comment's word.

**Half two — every piece is classified** by a fixpoint over the supply graph:
map seed → region reveal → tutorial spawn → generator → merge → order reward →
chest recharge → the two scripted altar fixtures. Each piece lands in one class:

- **RENEWABLE** — a generator (or a merge chain over one) feeds it. A generator
  is never consumed by producing, so one reachable instance is an unbounded
  supply; quantity is only a question of time.
- **FINITE(n)** — no generator behind it. Exactly `n` can *ever* exist, computed
  through the real merge arithmetic: per-tier overrides (2 Houses → 1 Manor),
  and the 5→2 bonus as `2·⌊k/5⌋ + ⌊(k mod 5)/3⌋`.
- **UNREACHABLE** — with the reason.

FINITE is the dangerous class and the reason the file exists. Five Cracked Stones
*look* like a chain; 5 → 2, and a Cinder Vein needs 3. What Chapter One can never
finish, stated plainly so nothing ever asks for it:

| Chain | Verdict |
| --- | --- |
| `cinder_vein` | T1 finite 5 → T2 finite 2 → **T3 impossible** (needs 3) |
| `moonwater` | T1 finite 3 → T2 finite 1 → **T3 impossible** — its `dew_basin` producer is in `level_5` |
| `firepine` · `dew_basin` · `nest` | only in `level_5`. Its land opens at Level 3 now, but all three are still in `HIDDEN_CHAINS`, so `UnlockSystem` skips them at spawn |
| `quartz` · `resin` · `ashmoss` | nothing in the game supplies tier 1 |
| `sparkweed` · the four Borealis chains | `HIDDEN_CHAINS` — never spawn |

Everything the shipped ladder asks for is renewable, except the Golden Elder,
which is correctly a one-off altar fixture and cannot be spent.

### Running it

```
pnpm quests            # tutorial simulation + per-step provenance + verdict
pnpm quests --brief    # findings only
pnpm quests --items    # + the full per-piece availability table
```

Exit code is non-zero on any error. `tests/unit/QuestAvailability.spec.ts` runs
the same functions, so a data edit that breaks reachability fails `pnpm verify`
whether or not anyone remembers this command.

### Severities

- **error** — a step asks for something unreachable, or short of its finite cap,
  or the tutorial deadlocks. Fails the build.
- **warning** — satisfiable but fragile: a finite supply that a sale would
  destroy, a step needing more tiles than are free, or an `expects.levelAtEnd`
  the scripted XP floor does not reach on its own.
- **info** — a one-off scenic fixture, finite by design.

### The finale no longer depends on how much the player merges

`expects.levelAtEnd: 3` on the Centerpiece (quest 6) used to warn:

> *the scripted floor is Level 2 at 193 XP — the beat depends on 27 XP of
> free-play merging landing before the last delivery.*

`Constants.ts` used to pin the Chapter One finale to Order 3's delivery, but the
scripted XP alone did not reach `LEVEL_XP[2] = 220`. A player who merged nothing
beyond the four deliveries reached Level 3 on **Order 4**, and the whole finale —
camera to the altar, the egg cracking, the Elder's only line — landed a quest
late, on a delivery that has nothing to do with her.

**Fixed by paying `eleanor_centerpiece` 80 XP instead of 50.** (Both halves are
history now: the finale fires on `keepers_hoard`'s completion rather than on any
level, and after the ladder re-rhythm the floor crosses 220 on
`eleanor_hearth`'s delivery — still an order beat, which is the property that
matters. The curve also runs past 3 to Level 6; see Constants' LEVEL_XP.) The
`expects` assertion stays, and the audit reports zero warnings — which is the
point of declaring design intent in data rather than in a comment.

## 5. More than one world

The engine runs several worlds (`src/core/world.ts`, `zones.json`): `emberkeep`,
`borealis` and `roothold` today. `state.items` is the board you are **standing
on**, and that one fact drives everything below.

**A quest belongs to a board.** `QuestConfig.world` (absent = the authored world)
scopes it, and `QuestSystem.tracked` filters the ladder to `state.worldId`. This
is correctness, not tidiness: a `have` goal counts the active board, so an
Emberkeep quest would sit at `0 / 6` the whole time the player is in the north
and read as broken rather than as absent. The HUD shows the board you are on; a
world with no ladder shows nothing at all.

**A chain belongs to a world OR to a chapter — never confuse the two.**

| Withheld because | Mechanism | Turns on |
| --- | --- | --- |
| wrong **world** | `chains.json` → `world: "borealis"` | by itself, on arrival |
| wrong **chapter** | `HIDDEN_CHAINS` in Constants | when someone deletes the line |

`chainHiddenIn(chain, worldId)` is the single predicate; `UnlockSystem`, the
Cookbook and the audit all call it. Selyna's four frozen chains used to sit in
`HIDDEN_CHAINS`, which was the wrong tool — it would have needed a second manual
edit at exactly the moment the player crossed, and would have leaked the roster
into Emberkeep if anyone forgot to put it back.

**A world may only be opened by a quest step.** The `world` goal kind completes
when the player has stood there, and latches, so coming home never re-opens the
crossing.

> ⚠️ `worlds.json` carries `teleport: { trigger: "hatch", chain: "flame_gem",
> tier: 2, … toWorld: "borealis" }`. That is a **map-editor placeholder and must
> not be wired**. It is incoherent twice: `flame_gem` has no `hatchAtTier`, so
> the event can never fire; and if it did, it would drop the player in Borealis
> during Chapter One — Borealis is rung 11 of the reveal ladder, so a merge would
> spoil chapters 9–12 (quests.md §7 rule 1: *fire on state, never on a merge*).

### Auditing a world before it ships

```
pnpm quests --all          # every world, each as its own supply graph
pnpm quests --all --items  # + what each world can and cannot make
```

The worlds do not pool: a Gem Shard in Emberkeep is not a Gem Shard in the
north, so each world must be self-sufficient in everything its own quests ask
for. Two warnings exist specifically to stop an empty world passing by having
nothing to check — **no quest is tracked here** and **nothing arrives on this
board**.

**Borealis — shipped, and how it is put together.** It is one of the few worlds
whose whole economy had to be designed rather than inherited, so it is worth
stating what the answer was.

*Three islands, and the merge law that makes them matter.* The world is painted
as three landmasses and the map editor delivered it as 38 grids. `world.ts`
measures which cells actually touch, and the three connected components it finds
are exactly the three the editor's unlock levels named:

| Region | Cells | Opens on | What stands there |
| --- | --- | --- | --- |
| `borealis_shore` | 9 | active on arrival | Wrack Line ×1 · Drift Spar ×4 |
| `borealis_keep` | 29 | **1 Gold Key** | Hoarfrost Font · Wrack Line · 3 Frost Flowers · 3 Drift Spars · 3 Broken Strakes · a Chest |
| `borealis_coast` | 103 | **2 Gold Keys** | 2 Wrack Lines · 2 Fonts · 5 spars · 5 flowers · 6 strakes · a Chest |

**A merge cannot cross water**, so each island is seeded to run on its own. That
is not generosity: an island with no producer is an island where nothing can
ever happen, no matter how long the player waits. Seeds are authored in
`scripts/build-zones.mjs` (`BOREALIS_PLAN`) and PLACED by `seedRegion`, which
orders a region's cells outward from its centre — a re-export moves every cell,
so a hand-written `[col,row]` would become a hole in the sky.

*Keys, not levels.* As generated the two fogged islands gated on Keeper Level 2
and 3 — and the north opens at Level 3, the Chapter One cap. A player arriving
for the first time satisfied both, so all 141 cells unfogged in the frame they
landed and the world was spent before it started. The alternative fix was to
extend `LEVEL_XP` past 3, which costs the XP bar its *"Chapter One complete"*
reading. Keys are the right instrument: the only source of one is Selyna's
Ledger, so the north opens at the pace the player works it — and it keeps the
rule the south already follows, **keys gate story, levels gate power**.

*Its own everything.* `OrderConfig.world` gives Selyna her own Ledger (Eleanor's
would otherwise follow the player north and ask, for ever, for Gem Shards that
cannot be made there). `CHEST_GIFTS_BY_WORLD` gives the northern chests northern
goods — the global table pays `emerald` and `ember_dragon`, neither of which
carries a `world`, so `chainHiddenIn` would NOT have stopped a chest dropping
Dragon Rubies onto an island with no dragon and no order that wants them.
`chestGiftsIn(worldId)` is the one predicate; `ChestSystem` and the audit share it.

*Three new chains* (`chains.json`, all `world: "borealis"`): `wrackline` — the
north's Ancient Tree, a passive 300 s drip of `driftwood_1` with a `bonus` of one
`keel_1` every third haul, so ONE landmark bootstraps two chains and the rare
drop reads as the sea giving something back rather than as a drip rate;
`frostfont`, feeding the rime farm; and `keel`, the north's gold loop — Broken
Strake → Lashed Frame → **Upturned Hull** (2→1, generates `coin_1`) → **Longhall**
(`coin_2`), mirroring `lumber` beat for beat including the tier-3 override, so the
loop is learned rather than re-taught. It deliberately does not reuse
`driftwood`: that chain is already the fuel farm, and one chain feeding both the
furnace and the housing collapses two decisions into one.

*The ladder* is eight quests, `north_landing` → `north_ledger`, and it walks the
islands: make camp on the shore, buy the door, feed her dragons, salvage the
wrecks, buy the coast, raise a Longhall, spin the spindles, then her endless
Ledger. `pnpm quests --all` proves every step and every key.

> **The one thing still missing is the crossing itself.** `WorldSystem` validates
> travel and `UIScene` already draws the travelling curtain, but nothing on
> screen asks for it — only `window.__emberkeep.switchWorld`. That affordance
> belongs to the hub work (board EMB-23); everything behind it is proven.

### Counter tasks, and the one that has a ceiling

`The Keeper's Tasks` mirrors `tasks.json` by id, so those five rows have exactly
one definition and the HUD cannot disagree with the Ledger's Tasks tab. Four of
the five measure loops that are unbounded by construction — gold, merges and
orders all come off renewable supply, and the Elder can be tapped forever.

**`recipes_20` is the exception, and it is the one that needed a guard.** It
counts Cookbook pages discovered, which is finite by definition: there are only
so many recipes a chapter can print. `auditLadder` therefore checks the target
against the rows actually printable *at the step that asks for it*
(`recipeKeysFrom`), and fails the build if it asks for more.

It replaced **"Hatch 4 dragons"**. That target was fine when it was written and
stopped being fine when dragons became deliberately scarce and dear — the ruby
loop is technically self-sustaining, so no reachability check ever complained,
but four hatches had quietly turned from a chapter's work into a wall. Nothing
in the audit was looking at counter targets at all, which is exactly why the
guard exists now rather than a note somewhere.

Two numbers to keep in view when retuning it: the tutorial alone discovers **13**
recipes, and **27** rows are reachable by the time the checklist is asked. A
target at or below 13 is a task that is already complete when it appears.

## 6. THE LEGENDARY EGG DIRECTIVE

> **Every zone gives up exactly one legendary dragon, and the quest ladder is the
> only thing that can hand it over.**

The rule lives in `Constants.ts` (`LEGENDARY_EGG_COUNT`) and is enforced by
`auditLegendaryArc` in `pnpm quests`, so a ladder that breaks it fails the build.

1. **One per zone.** A world has at most one chain marked `legendary` in
   `chains.json`. Egg is tier 1, the dragon is tier 2, three eggs merge into it.
2. **No producer on a BOARD ever makes an egg.** Not a generator, not a region
   seed, not a chest, not an order, not the tutorial. On the boards, the only
   source is a quest `rewards.spawn`. Checked *structurally* over every table
   that can put a piece on a board — not by asking the solver whether one turns
   up, because a producer behind a fog the audit never lifts is invisible to
   the solver and perfectly real in play.
   **The one sanctioned exception is Selyna's Cauldron** (`src/data/cauldron.json`,
   the pot in the Runevault hub): a deliberate late-game faucet that BREWS eggs
   out of the Bag, priced in renewable tier-3 goods so a legendary egg is a
   session-scale project rather than a drop. It trades Bag→Bag only — it can
   never place a piece on a board — which is why it lives outside the audit's
   producer tables, and why every recipe input must stay RENEWABLE (the
   `CauldronSystem.spec.ts` data tests hold the shape; check renewability here
   when touching a recipe).
3. **Three eggs, one per quest.** Never two from the same quest, and never from
   the endless tail — it does not finish, so its reward never lands.
4. **Spaced by 3–4 quests that pay something else.** Back-to-back eggs make the
   dragon a formality; a longer gap and the player forgets there is an arc.
5. **The third egg is the second-to-last quest, and the last quest is the
   hatch.** The zone ends on the dragon waking. That is the entire reason to pay
   the eggs out over a zone instead of handing over a dragon.

Consequence, stated out loud because it decides ladder length: a zone needs
**10 completable quests** before it can hold an arc (`1 + 2×(gap+1) + 1`). A
shorter ladder is not "mostly compliant" — it is a zone that cannot have a
dragon, and the audit says so in those words.

| | Emberkeep — **Ashdrake** | Borealis — **Rimewyrm** |
| --- | --- | --- |
| Egg 1 | 2. Fill the Larder | 8. Open Selyna's Keep |
| Egg 2 | 6. Catch the Moonwater | 12. Turn Two Hulls |
| Egg 3 | 10. The Keeper's Tasks | 17. Spin the Light-Fast Spindles |
| Hatch | 11. Wake the Ashdrake | 18. Wake the Rimewyrm |

The Emberkeep column is chosen by INDEX, not by quest identity, so it has moved
twice: once when the ladder was re-rhythmed by tier, and again when the brood
quest was cut. With eleven completable quests and the last egg pinned to the
second-to-last, the only legal triples are (1,5,9), (1,6,9) and (2,6,9) 0-based —
and the opener is spoken for (its ORDER already teases the Golden Egg), which
leaves exactly one: the Larder, the Moonwater and the Keeper's Tasks.

Both dragons come out **FINITE 1** in the audit, which is the correct and
intended verdict: exactly one can ever exist per zone. That is also why a quest
`rewards.spawn` always banks its overflow in the Bag — a full board must never
be able to eat an egg (`board:spawn` → `overflow: 'bag'`).

**The reward that is not the order's.** `QuestConfig.rewards` is paid by
`QuestSystem` when the quest's done-latch flips, which is distinct from
`orderId`'s payout: the Ledger pays for goods delivered, the quest pays for the
story being advanced. It is latched, so a reload never pays twice, and a quest
that completes during a silent re-derive is still owed its reward — it simply
gets no banner.

### Art for a legendary (four keys per zone)

Placeholders render today (the keys start `item_`, so `TextureFactory` paints a
palette stand-in, never magenta). Dropping real art in is three data edits and
no code:

| Key | File | What it is |
| --- | --- | --- |
| `item_ashdrake_1` | `sprites/items/chains/ashdrake_1.webp` | Ashdrake Egg |
| `item_ashdrake_2` | `sprites/items/chains/ashdrake_2.webp` | Ashdrake |
| `item_rimewyrm_1` | `sprites/items/chains/rimewyrm_1.webp` | Rimewyrm Egg |
| `item_rimewyrm_2` | `sprites/items/chains/rimewyrm_2.webp` | Rimewyrm |

1. `src/data/assets.json` — a `{ key, source: "file", file }` entry each.
2. `src/data/anchors.json` — the anchor, as every chain icon has.
3. `ITEM_SCALE` in `Constants.ts` — the egg at the tier-1 size band, the dragon
   at the top band, on the alpha bbox's longest side.

The eggs are the SAME dragon at tier 1 and 2, so they must read as one creature:
the egg carries the adult's palette and its one distinguishing mark. Three of
them sit side by side on the board before they merge, so the egg silhouette must
survive being seen in triplicate without reading as clutter.

## 7. Authoring more

1. **Add the quest to `quests.json`**, in ladder position. Steps are ordered.
2. **Every step's items must be declared.** The audit reads what a goal *names*
   (`have` names itself, `order` names its requirements) plus an explicit
   `needs` array for anything the goal cannot name — the dragons behind a hatch
   count, the Elder behind a commune. A step that consumes something listed in
   neither is a step the audit is checking a lie about.
3. **Run `pnpm quests`.** If a piece comes back FINITE or UNREACHABLE, the fix is
   the *world*, not the quest: give the chain a producer, put it in a region that
   opens, or ask for something else.
4. **Chapter beats stay `StorySystem`'s.** The ladder is what the player is
   doing; the chapter pointer is what the story has said. A quest completing is a
   fine gate for a chapter, but the two are separate on purpose
   ([quests.md](quests.md) §7 rule 1).
