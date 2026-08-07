# Tutorial coverage — the concept ledger

Every concept a Chapter One player can touch, where it first becomes visible and
live, and the beat that teaches it. Audited by `.claude/skills/tutorial-design`
(law 1). `ftuecheck.py` parses this table: **column 3 must name a tutorial step
id or a `dialogue.json` hint key, in backticks.** An empty cell is an ERROR.

A concept is *available* the moment its object is on screen and can be touched —
not when it becomes useful. That is why the Ledger button, the satchel and
Eleanor herself are all rows: they are live from the first frame.

## Board verbs

| Concept | First on screen | Taught at | Note |
|---|---|---|---|
| Emberbark Stump — the moss farm | the Stump, from the first frame | `moss_stump` | the game's FIRST interaction: she names the burned tree, the player taps it, a Moss Tuft drops. "it will always grow more" says renewable out loud |
| Drag three alike to merge | first scripted spawn | `ash_green` | the harvested tuft plus two spawned at the stump; the hand demonstrates the exact drag |
| Merging climbs tiers | after the first merge | `dragon_hatch` | egg → dragon |
| The Cookbook records recipes | after the first merge | `cookbook_intro` | button appears for this beat, then permanently |
| Closing a panel | cookbook open | `cookbook_close` | the player closes it, not the script |
| Tap a ready generator to harvest | the Emberbark Stump, from the first frame | `moss_stump` | reinforced at `crystal_tap` on the Crystal |
| **Quartz — the mage's own stone** | the Crystal's first drop, at `crystal_tap` | `crystal_tap` → `quartz_merge` → `quartz_ball` | the Crystal shed Emeralds and a second dragon ladder until this pass; it sheds Quartz now, so the beat it anchors is about ELEANOR instead of about another egg. Taught end to end (pebble → Cut Crystal → Crystal Ball), both Cookbook rows discovered, and RENEWABLE off the same Crystal — which is what let it leave `HIDDEN_CHAINS` |
| Some chains are hers, not the dragons' | `quartz_merge` | `quartz_merge` | recipient locking (`MAGE_ONLY`) said out loud — "no dragon will touch it, and no dragon should". `isle_materials` later says the same of Moonwater, so the rule is named twice before anything depends on it |
| Why she wants them | `quartz_ball` | `quartz_ball` | the Crystal Ball is her reason for asking, which is what turns a merge chain into a motive |
| Tap a loose piece to pocket it | the Crystal Ball, at `ball_pocket` | `ball_pocket` | the satchel's first live use, moved here from the Cracked Stone so the bag is taught on a piece the very next beat needs |
| **The Bag's THREE verbs — Drop, Give, Sell** | the chooser, on the first tap of a filled slot | `ball_give` | all three plates appear together, so one beat names all three; it gates on GIVE being chosen. Sell is `allow`-off for this beat — the Crystal Ball is the next beat's whole subject and a mis-tap that turned it to coins would strand it |
| **Giving is two taps: what, then who** | `ball_give` → `eleanor_gift` | `eleanor_gift` | choosing Give only ARMS it and closes the panel; the recipient is the next tap on the board, and every valid one breathes while a piece is held out. The Ledger is not open yet, so there is no live `gift` subquest — the beat stages the want itself (`wantGift` effect, spent as it is met) |
| **Eleanor's hearts — her Regard** | the status readout, at `eleanor_hearts` | `eleanor_hearts` | chained deliberately off the quartz: `quartz_ball` ends on "that is why I will keep asking", so the next beat is her asking and the one after is the gauge that answers. The scripted gift pays a WHOLE heart (`points` on the effect) so the lesson has something lit to point at |
| Tapping somebody reads them | any character or dragon | `eleanor_hearts` | the readout OPENS ITSELF on the accepted gift (BoardScene selects her as subject), so the beat is a tap-through naming what is already on screen — an arrow back at her would demand a tap with nothing left to earn. `allow.status` debuts the readout here and LATCHES — the dragon beats later reuse the same surface, and `dragon_status` says the verb aloud ("Tap her to read it") |
| A treasure chest | scripted spawn | `chest` | |
| A chain longer than one merge | `level_2_gate`'s Cut Wood | `wood_merge` → `plank_merge` | raw material is MILLED before it builds: 3 Cut Wood → a Plank Set, 3 Plank Sets → the House. Two beats, because a single one would let the player think a House is three of anything |
| A generator with a second, rarer yield | the Emberberry patch | `emberberry_merge` | the patch pays a Sprout every 12 berries — named in the beat's line so the drop is never a mystery, and nine Sprouts are a second patch |
| Pocketing something that will never merge | level_2's Cracked Stones | `pocket_it` | the satchel's SECOND use, and the setup for Sell — `minGroup` is 3 and only 2 are seeded, so the stone has no other future |
| The Bag's two verbs — Drop and Sell | the chooser, on the first tap of a filled slot | `sell_it` | both buttons appear together, so one beat names both; it gates on the Sell |
| Sell a spare piece for Gold | the Bag chooser | `sell_it` | selling is a BAG verb — nothing on the board can be sold. Also names what Gold is for |
| Every tenth log carries a Grain | the wood the player just milled into a House | `tree_grain` | the Grains arrive AT THE HOUSE, not at a tree: the isle no longer authors a free Ancient Tree, so the only tree in Chapter One is the one the player grows two beats later. The bonus-yield rule was named one beat earlier on the Emberberry patch, so this is the SAME lesson with a second example |
| Fir: 3 Grains → a Small Fir Tree | `tree_grain`'s three Grains | `grain_merge` | an ordinary merge on a piece the milling just gave; no new verb |
| A tree the player grew, and it is the only one | the Small Firs | `fir_grow` | 3 Small Firs → a Fir Tree carrying the produce + bonus `bigtree_1` used to carry. This is the beat that closes the loop AND the beat that hands over the isle's only renewable timber — the supply stops being scenery the map gave away and becomes something the player farms |
| Dragons live on the isle by themselves | post-tutorial, the first wander | — *(ambient, taught by watching)* | they fly between distant tiles, curl up asleep (off a work shift, through the night, or just because), and roar when nothing has fed them today. Deliberately NOT taught: it gates nothing, costs nothing and asks nothing, so a lesson would be teaching the player to watch a screensaver. Wandering is suppressed for the whole tutorial |
| A House is commissioned, once | the chooser, on the House raised at `plank_merge` | `house_commission` | the chooser is suppressed by `allow.commission` for the whole tutorial EXCEPT this beat, so it can never land unheralded on `house_skip`. Placed deliberately AFTER `resin_pocket`: only what is in the satchel can be commissioned, and the beat before it puts the right thing there |
| A commission is a commitment, not a menu | the chooser's Yes/No | `house_commission` | the line names the price out loud — "a second thing needs a second House" — because write-once is invisible until you try to change it |
| Timed generators and their cooldown | the House, after `plank_merge` | `house_skip` | |
| Skip a timer with Warmth | House timer | `house_skip` | cost is `skipWarmthCost` — 18 of 28 |
| Skip a timer with Gold | the skip popup, post-tutorial | `goldSkip` | popup offers both; Gold is the cheaper one |
| Dragons work a generator | after `plank_merge` | `dragon_work` | ×2 per working dragon |
| Dragons tire and go home | after `dragon_work` | `dragon_rest` | |
| Harvest from a dragon (job menu) | the Red Dragon | `gem_harvest` | tap → menu → Harvest. Moved off the Green Dragon when the Emerald ladder left the opening — the Red produces the same Gem Shards, and the beat now calls her by name |

## The economy

| Concept | First on screen | Taught at | Note |
|---|---|---|---|
| Warmth is spent, and returns on its own | gauge + regen countdown, frame 1 | `buy_energy` | the countdown under the gauge is the readout |
| The Emporium sells Warmth | ⚡+ button, frame 1 | `buy_energy` | first Ember Spark is free |
| Running dry | Warmth hits 0 | `zeroWarmth` | |
| Gold is earned and spent | the House's payout | `sell_it` | earn by selling, spend on skips and Warmth |
| A generator that is free forever | Emberberry patch | `emberberry_tap` | contrast: dragon taps cost 1 Warmth |
| XP and Keeper Level | the XP bar, frame 1 | `levelup` | bar reads `n / 60 XP` from the first frame |
| Levelling opens land for free | level 2 | `levelup` | LEVEL regions |
| Keys open fogged land | the key pill, at `key_unlock` | `key_unlock` | KEY regions; keys gate story, never power |
| **Eleanor's Ledger holds orders** | the Ledger button, frame 1 | `ledger_open` | dimmed until this beat |
| The main quest, always on screen | quest tracker (top right), at `ledger_open` | `ledger_open` | rides the Ledger button's own gate — it is a readout of the Ledger, so it cannot precede the beat that teaches it |
| The Keeper's Tasks checklist | quest tracker sub-list, post-tutorial | `ledger_open` | same beat names the Ledger the tasks live in; the sub-list joins when the tutorial hands over, like the Ledger's Tasks tab |
| **Delivering an order** | an order with a full bar | `ledger_deliver` | pays coins + XP, and the golden tease |
| Where Gem Shards come from | the Red Dragon | `gem_harvest` | the order currency of Chapter One |
| The board filling up | when it does | `boardFull` | names sell + deliver, both taught by then |

## The world

| Concept | First on screen | Taught at | Note |
|---|---|---|---|
| Eleanor stands on the map | frame 1, at her `characters.json` anchor | `eleanor_helps` | tappable from the first frame; the beat's arrow is `{"character":"eleanor"}` — never a literal cell, which goes stale the moment the World Builder moves her |
| Moonwater — the isle's own material | level_2 + the gate, at `key_unlock` | `isle_materials` | 3 seeded on the west ledge; hers end to end (`MAGE_ONLY`) |
| Moonwater merges like anything else | `isle_materials` names it | `moonwater_merge` | she names the chain, then has the player actually fuse it — 3 Dew Drops → a Dew Vial |
| Ash Moss — the isle's green, given back | the Stump's first drop, at `moss_stump` | `moss_stump` → `ash_green` | 1 harvested + 2 spawned at the stump → a Moss Bundle. Pays off `arrival_ask`'s "the warmth, the green, and whatever's still asleep"; the Bale (tier 3) needs 9 and is not offered |
| Cracked Stones — rubble, not a chain | level_2, at `levelup` | `pocket_it` | exactly 2 seeded: one to pocket, one to sell. `minGroup` is 3, so they never merge, and the Cookbook does not print their recipe |
| **A dragon is somebody, and she has a name** | the Red Dragon, the instant she stands out of the shell | `name_intro` → `name_choose` | three beats with nothing else on screen: Eleanor makes the case, the picker opens (`nameDragon` effect, not dismissible), and `name_said` says it back. Placed immediately after `dragon_hatch` — before the Crystal, before anything else asks for the player's attention |
| Her name is hers, and the game uses it | `name_said` | `name_said` | the ONLY coloured word in any bubble (`PALETTE.lava`), because it is the only word the player wrote. `{dragon}` resolves in any authored line; `feed_dragon` and `dragon_status` both use it |
| Resin — the tree's other gift | the player's own Fir's trunk, at `resin_find` | `resin_find` | 3 beads spawned at the Fir Tree the player grew at `fir_grow` — which is why this beat sits AFTER it and cannot be moved before it. Taught end to end inside the tutorial (beads → Lump → Hearth Cake), which is what took it out of `HIDDEN_CHAINS`: both its Cookbook rows are discovered in the lesson, so it is never a row the chapter cannot finish |
| Dragons eat, and each has a favourite | the Hearth Cake, at `cake_pocket` | `cake_pocket` → `feed_dragon` | the SAME two-part gesture the Crystal Ball taught: pocket it, Give, tap her. A dragon is a recipient like a person is, so it is one verb rather than two that look alike. Resin is the Red's favourite (`DRAGON_DIET`), so the first feed is the good case. Dragging food straight onto her still works as a shortcut; the script teaches the satchel route |
| A refused meal costs nothing | a dragon's dislike | `feed_dragon` | not scripted — the board floats "It turns its head away" and leaves the piece exactly where it was, the same contract a declined gift holds |
| **The status readout** — who am I looking at | under the quest tracker, from `eleanor_hearts` | `eleanor_hearts` (people) → `dragon_status` (dragons) | switched on by `allow.status`, which LATCHES: it debuts on Eleanor's hearts and the dragon beats reuse the same surface. Five hearts = trust for a dragon, Regard for a person; the second line is what today still owes the animal |
| Selecting somebody to read them | any tap on a character or dragon | `dragon_status` | the line names both verbs — "tap her to read it again, tap me for mine". A value that MOVES flashes its own subject for `STATUS_FLASH_MS` without being asked |
| She can hasten a countdown | `eleanor_helps` | `eleanor_helps` | costs the player nothing; she has a cooldown |
| She cannot wake anything | canon, throughout | `arrival_ask` | the refusal line `not_mine` repeats it in play |
| The golden egg on the altar | authored decor, frame 1 (west) | `golden_tease` | aura starts once the tease has played |
| Two grown dragons make an Elder | post-tutorial | `twoDragons` | contextual recipe hint + hand |
| Two Houses make a Manor | post-tutorial | `twoHouses` | contextual recipe hint + hand |
| **Selyna's Cauldron** — brew from the Bag | the pot decor in the hatchery hub, post-tutorial | self-teaching on first tap | unreachable during the tutorial (the hub opens off borealis, worlds after Chapter One), so it carries no beat. The panel is its own lesson: recipe ledger left, the selected formula's ingredient cards right, have-counts in red when the Bag falls short, and the BREW button asleep until they don't |
| The egg stirs near Level 3 | post-tutorial | `eggTrembles` | requires `eleanor_brazier` delivered — which the tutorial now does |

## Deliberately not in Chapter One

**The husbandry roster is HELD, not merely out of reach** — all of it but two.
`emberberry` left the set because the tutorial's Ripe Emberberry Plant now drops
it (berry ×3 → basket). `ashmoss` left because this chapter owns it end to end:
the Emberbark Stump (`emberbark`, a single-tier landmark like the Crystal)
farms it from the first frame, `moss_stump` opens the game by harvesting it,
and `ash_green` merges the harvest. (The old "no farm by design" rule —
`merge-chains.md` §2's *"restoration IS the moss supply"* — was retired when
the stump shipped.) `firepine`, `dew_basin`, `nest`, `resin` and
`quartz` sit in `HIDDEN_CHAINS` — a later CHAPTER of this world. The Borealis
four are withheld for a different reason and by a different mechanism
(`chains.json` → `world: "borealis"`; `docs/merge-chains.md` §2.4.1,
`docs/quest-ladder.md` §5), and the two must not be conflated. This
chapter has no Cold Nest, no feeding and no recipient for any of them; their
seeds are authored in `level_5` (whose land opens at the Level-3 cap, though
`UnlockSystem` skips any chain still in `HIDDEN_CHAINS`)
and Eleanor's orders ask for Gem Shards. Left visible they were **twelve
permanent `· · ·` rows in the Cookbook** — a completion counter the chapter can
never let the player finish, which is exactly the defect law 2 names. Removing a
chain from `HIDDEN_CHAINS` is the one edit that turns it on for THIS world; a
chain that belongs to another world turns itself on when the player gets there.

Two of the new chains DO appear, because they are on the board and taught, and
each is honoured only as far as this chapter can take it:

- **Cracked Stone is a prop, not a chain.** Two are seeded — one for
  `pocket_it`, one for `sell_it` — and `minGroup` is 3, so no Cinder Seam can
  ever exist.
- **Moonwater stops at the Dew Vial.** Three seeded drops make exactly one, and
  `moonwater_merge` spends them on it. The third tier needs a Dew Basin, and the
  Basin is husbandry.

Neither chain's dead recipes are printed. The Cookbook lists a row only when its
OUTPUT is reachable, computed by `availability.reachableRecipeKeys` from the same
solver that proves the quest ladder playable — so the roster can keep moving
without anyone maintaining a list by hand, and `n / N` is always finishable.

The ceiling is the tile budget, and it is tighter than it looks. The reachable
regions hold 11 free cells; the level_2 seeds spend 5 (two Cracked Stones, three
Moonwater — `moonwater_merge` hands 2 back as a single Dew Vial, and the two
stones leave the board entirely) and level_1's remaining 5 are NOT usable — the south cluster
`[11,7]`–`[12,8]` sits inside `REWARD_SPAWN_RADIUS` of where the Green Dragon
ends up, so seeding it starves `gem_harvest`'s drop and the harvest fails with
`no_space`. Quartz was seeded there and pulled back out for exactly that. Any
future seed goes in level_2 or the gate, never in level_1.

## Borealis — what the north teaches, and where

The north is entered by a taught player, so it has no tutorial and must not grow
one. But it puts **new rules on screen**, and the law here is the same: a concept
the player must act on needs a teach-point, or it is a defect.

| Concept | First on screen | Taught at | Note |
| --- | --- | --- | --- |
| A merge cannot cross water | arrival — 9 cells with sea on all sides | Selyna's arrival beat (*"Nine feet of shingle… that is the whole of your holding"*) | the board itself is the lesson; the beat only names it |
| The tide, not the soil, is the supply | the Wrack Line, from the first frame | arrival beat (*"every stick of wood you see arrived on the water"*) | it is the world's premise AND its root producer |
| Fog costs Gold Keys here, not levels | `borealis_keep` cloud | `north_door` — *"Spend 1 Gold Key on the fog around the keep"* | the south taught the key tap once, at `level_2_gate`; this is the same verb |
| Keys come from her Ledger | first delivery | `selyna_signal` blurb (*"then the door is yours"*) | the reward card shows the key |
| **The diet inverts: fuel is the wall** | first Tar Knot | `selyna_pitch` blurb (*"Mine eat pitch, not berries. Nothing grows here, so the fire has to be built before it can be fed"*) | the one genuinely new RULE in the north, and the reason `tarknot` costs a woodpile where a berry cost a minute |
| Wrecks are the north's timber ladder | first Broken Strake (Wrack Line bonus) | `north_salvage` + `selyna_frames` blurb | the loop is `lumber`'s, so it is recognised rather than taught |

Nothing else is new: merging, tiers, the Cookbook, generators, chests, the
Ledger and delivery are all carried over intact, which is the entire reason the
north can open with a conversation instead of a lesson.
