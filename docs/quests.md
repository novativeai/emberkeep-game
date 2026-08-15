# Quests — the twelve chapters, and what must be true when each one speaks

> **Status: SPEC COMPLETE, NOT WIRED.** One quest per chapter, each one designed
> so the conversation that fires on its completion is *coherent with what the
> player just did*. Canon: [story-bible.md](story-bible.md). Lines:
> [script-chapters.md](script-chapters.md). Economy: [merge-chains.md](merge-chains.md).
>
> The coherence rule this document exists to enforce:
>
> > **A chapter beat may only presuppose things the completed quest made true.**
> > If Eleanor says "you've noticed," the player must have had something to
> > notice. If she says "two of them, with names," there must be exactly two.

---

## 1. Three new systems, all small

### 1.1 The bag's third verb — GIVE

The bag already stores and retrieves ([bag-system.md](../assets/raw/bag-concept/README.md),
EMB-29). Its third verb is **give**: open the bag while a character or dragon is
selected and tap a slot, and the item goes to them. Same motion as store,
reversed — the item flies *out* of the satchel to the recipient.

This is what makes the bag a game system rather than a convenience. It is the
only way to hand something to a person, and it is how every gift, every meal and
every keepsake in this document is delivered.

Recipient locking from [merge-chains.md](merge-chains.md) §1.5 holds unchanged:
dragon food cannot be given to a mage, mage materials cannot be fed to a dragon.
A refused gift bounces back to the bag with a line — never a silent failure.

### 1.1b Cold things — the props the story needs

Two authored fixtures exist so the player can *do* the thing the campaign is
about. Neither merges, neither is sellable, and both are one-shot:

| Fixture | Where | What it is for |
| --- | --- | --- |
| **Dead Ember** | region 2 contents (ch 4) | Eleanor fails to light it; the player lights it |
| **The Long Hearth** | region 3 contents (ch 8) | the same beat, larger, and the last time it is shown |

They are the *only* things in the game that respond to the player's hidden power
directly, so they must be rare — two, across the whole of world 1. A third would
turn a revelation into a mechanic.

### 1.2 Keepsakes — the relationship currency

**Keepsakes are not merge items.** No tier, no chain, not sellable, not
consumable by any recipe. They come from **land and dragons** — a restored
region, a chest, a Trust-4 forage, a hatched nest — never from the merge board.

That separation is load-bearing. If gifts were merge goods, gifting would just
be an alternate order-submission window and would compete with the economy for
the same items. Keepsakes are paid out by *care and restoration*, which are
exactly the things the new direction wants rewarded.

| Keepsake | Source | Valued by |
| --- | --- | --- |
| Nest-shard | first hatch | Eleanor |
| First bloom | a rekindled terrace | Eleanor |
| Shed scale | dragon, Trust 3 | Selyna |
| Moth in amber | chest | Eleanor |
| Torn account page | region 3 restoration | Eleanor — **and it is her father's hand** |
| River-smoothed stone | dragon forage, Trust 4 | any dragon |
| Harness bell | region 4 restoration | Selyna |
| Moulted whisker | dragon, adult | Selyna |

Each has one recipient who reacts properly; giving it to anyone else gets a
polite, in-character decline and the item back. **Keepsakes are never consumed
by quests** — they are given because the player wants to.

### 1.3 Regard 0–5, and Growth

> **Regard SHIPPED** (`RegardSystem`, five hearts) — see
> [quest-ladder.md](quest-ladder.md) §3.1 for what is actually wired, the tuning
> that paces it across 15–20 quests, and the two places this section's design
> was deliberately inverted: gifts today are merge goods named by a `gift`
> subquest (so a gift IS a requirement, contra §5), and there is no separate
> keepsake item class yet. Growth shipped separately, on servings rather than
> well-fed days (`ADULT_SERVINGS`, Constants.ts).

| Axis | Whose | Raised by | Never |
| --- | --- | --- | --- |
| **Trust** 0–5 | per dragon | feeding, favourites, presence (merge-chains §4.1) | decays |
| **Regard** 0–5 | Eleanor, Selyna | chapter quests (+1), first gift of each keepsake (+1) | decays |
| **Growth** | per dragon | **5 well-fed days** → adult | reverses |

**Well-fed day** = the dragon received all 3 meals that in-game day (32 min,
merge-chains §5.1). Five of them makes it an adult. This is the payoff the
shipped **tier-4 adult dragon art** now serves: dragons stop becoming adults by
merging and start becoming adults by being *raised*, which is the whole thesis
of the new direction stated in one mechanic.

An adult dragon: can work (`DragonJobSystem`), forages twice a day instead of
once, and at Trust 5 carries **+2 bag slots** while it follows you.

Regard is never shown as a number, exactly like Trust — it is expressed as
conduct. At Regard 3 Eleanor stops calling the work "the ledger" and starts
calling it "ours". At 5 she uses the player's dragons' names unprompted.

## 2. Quest grammar

Five kinds, so the ladder has texture rather than twelve delivery orders:

| Kind | Verb | Completion |
| --- | --- | --- |
| `order` | merge goods, deliver | requirement met at the Ledger |
| `restore` | clear fog, rebuild | region unlocked + its fixture built |
| `nest` | warm a Cold Nest | 9 points, ≤3/day, ends in a naming |
| `care` | feed, learn, bond | a Trust or Growth threshold |
| `journey` | travel, arrive | arrival at a new map |

`quests.json` shape, extending the shipped `orders.json`:

```jsonc
{
  "id": "cold_brazier",
  "chapter": 2,
  "kind": "order",
  "giver": "eleanor",
  "title": "The Cold Brazier",
  "blurb": "…",
  "requires": [{ "chain": "emberberry", "tier": 3, "count": 2 }],
  "rewards": { "coins": 40, "xp": 30, "regard": { "eleanor": 1 } },
  "unlocks": "chapter:3",
  "contract": ["first_delivery_to_isle"]   // asserted before ch2 fires
}
```

## 3. The ladder

| Ch | Quest | Kind | Requirement | Reward | Real time |
| --- | --- | --- | --- | --- | --- |
| 1 | First Warmth | tutorial | the tutorial | — | 5 min |
| 2 | The Cold Fire Bowl | order | 2× Berry Jam | 40 G · Regard 1 | ~20 min |
| 3 | The Cold Nest | nest | 9 pts, ≤3/day | **a dragon + a name** · Nest-shard | 3 days |
| 4 | The Second Terrace | restore | Gold Key + **give** Eleanor the First Bloom | Regard 2 · region 2 | 1–2 days |
| 5 | What It Likes | care | find the favourite, feed it 3× → Trust 2 | Trust 2 · first quartz · **letter** | 2 days |
| 6 | Five Pages | care | 5 Dragon Book entries | Regard 3 · Book shows confirmed likes | 3–4 days |
| 7 | The Second Nest | nest | 9 pts in region 3 | **2nd dragon + name** · Regard 4 | 3 days |
| 8 | The Third Gate | restore | 1× Crystal Ball → she forges the key | Regard 5 · region 3 | 2–3 days |
| 9 | The Golden Altar | care+order | **1 adult dragon** + the golden order | **the Elder wakes** · south opens | 5+ days |
| 10 | Pack for the Trip | order | every dragon fed, ledger closed | the journey south | 1 day |
| 11 | Find the Last Page | order | search the Hold's records | north opens | 1–2 days |
| 12 | Her Dragons | care | Selyna Regard 3, caring for **her** dragons | the terms | 4–5 days |

Floor: **~25 days**, and that is a player who never idles. The two Cold Nests
and the five well-fed days for the adult are hard multi-session gates that no
amount of stockpiling compresses (merge-chains §4).

**The campaign currently ends after ch 12 into free play.** The resolution —
Eleanor says the words, the Flame returns, Emberkeep wakes — is a deferred
chapter for a later version. Chapter 12's closing beat promises nothing on a
clock, so the deferral costs no broken promise.

## 4. Per chapter — the quest, and its coherence contract

Each **contract** is the list of things that must be true the instant the
conversation fires. These are the assertions the QA skill checks.

### Ch 2 — The Cold Fire Bowl
> *"Two jars of Berry Jam and that fire bowl lights. It has been cold since the last keeper left, and I would very much like to stand next to it while it burns."*

**Requires** 2× Berry Jam, delivered **to the fire bowl on the terrace,
not to Eleanor.** **Rewards** 40 G, 30 XP, Regard(Eleanor) 1.

**Contract** — the delivery target was *the isle*, not her. Her opening line is
*"the first thing anyone has given back to this place"*, which is false if she
took it herself. Emberberry is the only free producer, so this is reachable with
zero prerequisites. Nothing has yet asked for moonwater — she promises it here
and pays in ch 6.

### Ch 3 — The Cold Nest
> *"There is a nest under the north stone and there has been for sixty years. It will not hatch on its own. It wants feeding, and it wants time, and it will not take either from me."*

**Requires** 9 Warming points, any dragon-facing goods, tier N = N points, **max
3 per day**. **Rewards** the dragon, the naming prompt, a **Nest-shard**.

**Contract** — a dragon exists, it has just been **named by the player**, and
this is the first. Her *"Wait — you're naming it?"* needs the prompt to have
fired *before* she speaks. *"Names are the one thing nobody thought to take"* is
her first slip and must land while the player is still looking at a name they
chose.

**This is where GIVE is taught** — the nest is warmed from the bag.

### Ch 4 — The Second Terrace
> *"The strip west of you is clouded, not ruined. Burn the fog off it and something will come up that hasn't in sixty years. Bring me the first one you find."*

**Requires** the Gold Key spent on region 2, then the **First Bloom given to
Eleanor** — the player's first *gift* to a person, and the quest that teaches
GIVE on a human rather than a dragon.
**Rewards** Regard 2, region 2, the emberberry patch's second plot.

**Contract** — the region opened, and a **dead ember** is among what the fog was
hiding. Her scene needs a cold thing on screen that she can fail to light and the
player can light, so the quest must place one and leave it unlit. She fails
*first*, in front of them; the player succeeds second, with their own hands.
Order matters — reversed, it is a party trick instead of a revelation. Her
closing bubble **voices the player's question before deflecting it** (*"You're
wondering why it's you"*) — the Keeper is silent, so she must be seen asking on
their behalf, and ch 8's opener calls this exact phrasing back.

### Ch 5 — What It Likes
> *"It won't tell you what it likes. Nothing will. Try things, and write down the ones that stop it sulking."*

**Requires** discover the dragon's favourite chain by experiment, feed it 3
times → Trust 2. **Rewards** Trust 2, the first dug quartz pebble — a **gift for Eleanor**,
not the dragon's own grit — and **Selyna's letter L1**.

**Contract** — a bond now exists, which is what Selyna can feel from the north
(*"the isle has let something in"*). Eleanor's *"she writes when she wants
something and she has never once said what"* is a promise that pays in **ch 12**,
where Selyna says exactly what she wants, plainly, in one sentence.

### Ch 6 — Five Pages
> *"Feed them properly — a real feast, not scraps — and they show you something. Five entries and the book starts being useful instead of decorative."*

**Requires** 5 Dragon Book entries (tier-3 feasts reveal at 60%, merge-chains
§1.4). Eleanor's first **moonwater** order runs alongside as a repeatable — the
payoff of her ch 2 promise. **Rewards** Regard 3, the Book marks confirmed
preferences.

**Contract** — the player has been *reading the Book*, which is where her
marginalia lives. Her *"half of what's in that book isn't mine, it's copied out
of my father's accounts"* only works if they have already been staring at that
handwriting for days. The marginalia is doing the reveal; the chapter beat only
confirms it.

### Ch 7 — The Second Nest
> *"Another nest, in the cleared ground. You know the work now. I will not pretend I am calm about this one."*

**Requires** a second Cold Nest, 9 points. **Rewards** the second dragon + name,
Regard 4.

**Contract** — **exactly two named dragons.** Her line is *"two of them awake,
with names"*, so this gates on *named*, never on *hatched*. Also pays the
promise she made in ch 3 (*"I'll explain why that matters"*): the reason a name
matters is the Keeping.

### Ch 8 — The Third Gate
> *"The gate east needs a key, and the key needs a Crystal Ball. Bring me one and I'll make it. Making things is the half of this I can still do."*

**Requires** 1× Crystal Ball → she forges the key → the player opens region 3.
Beyond it stands **the Long Hearth, dead since the night it went out** — the
sanctuary's own fire, not a dragon. She lays hands on it first and nothing
happens; the player lights it. The second and last time the difference between
them is shown rather than said.

**It must not be a dragon.** The Cold Nest is the *only* way to get one
([merge-chains.md](merge-chains.md) §4) — 9 points across at least three days —
and a dragon handed over by a region would make the nest optional and cheapen
chapters 3 and 7.
**Rewards** Regard 5 (cap), region 3, and the **Torn account page** keepsake —
in her father's hand, a chapter before the player knows he exists as anything
but a librarian.

**Contract** — ch 4 has happened (she references it: *"You've been wondering
why it's you"* — the question she voiced for the player there), and the player
has *just* lit something she stood next to and could not. The confession is
triggered by a fresh, witnessed failure — hers — not by a timer.

### Ch 9 — The Golden Altar
> *"The altar wants a grown dragon's fire. Not a hatchling's. You will have to have raised one, and there is no way to hurry that, and I am sorry."*

**Requires** **one adult dragon** (5 well-fed days) + the golden order.
**Rewards** the Golden Elder wakes; the south opens.

**Scheduling risk, recorded.** The shipped demo fires the Elder's *"it was
TAKEN"* at Keeper Level 3, roughly 25 minutes in — that is this chapter's rung,
delivered before chapters 3–8 exist. When the campaign lands, the finale must
move behind this gate or the whole ladder collapses into the first session.

**Contract** — the player has *raised* something, not merged it. This is the
quest the Growth axis exists for: the finale is gated on weeks of daily care,
which is the strongest possible argument that the new direction's thesis works.
The Elder then testifies and hands the verdict on Eleanor to the player.

### Ch 10 — Pack for the Trip
> *"Everything fed, everything closed. I am not leaving this isle half-warm to go and be uncomfortable in the south."*

**Requires** every dragon fed today, the ledger cleared, keepsakes packed.
**Rewards** the journey; chapter 10 fires **on arrival at the Hold**.

**Contract** — a journey has happened between ch 9 and ch 10. Her first line was
originally *"The Elder told you. Good."*, which is stale by the time a whole
crossing has passed. **Changed** — see §6.

Her ch 1 promise, *"you'll hear it better when you're not standing in it,"* pays
here **literally**: she tells the player everything the moment they are off the
ash.

### Ch 11 — Find the Last Page
> *"My family kept records. All of them. Somewhere in this house is the last page anybody wrote about my father, and I have not read it in fifty years."*

**Requires** search the Hold's records (an order-style quest given by the Hold,
not by Eleanor). **Rewards** the Lantern's location; the north opens.

**Contract** — the player learns Selyna has it from *the record*, and Eleanor
confirms it afterwards. She must not volunteer it first; her *"I've known for
most of that"* has to land as an admission, not an announcement.

### Ch 12 — Her Dragons
> **Selyna:** *"You want something from me. Everyone who comes north does. Mine are hungry — start there, and we'll see whether you're worth talking to."*

**Requires** Selyna Regard 3, earned by feeding and bonding with **her**
dragons — the Borealis diet inverts (fuel-heavy, cheap green; merge-chains §8).
**Rewards** her terms.

**Contract** — the player has cared for Selyna's animals before asking her for
anything, which is the only reason she talks. Her *"you're being careful with
me, and nobody's careful with me who hasn't been told"* requires ch 10 to have
happened.

## 5. The promise ledger

Every forward-looking line and where it pays. **A promise with no payoff is a
bug; a payoff with no setup is worse.**

| Set in | The promise | Paid in |
| --- | --- | --- |
| Ch 1 | *"I was—"* | Ch 9 (witnessed) · Ch 10 (admitted) |
| Ch 1 | *"You'll hear it better when you're not standing in it."* | **Ch 10** — literally, off the ash |
| Ch 1 | *"…Keeper."* | Ch 7 — the rite was called the Keeping |
| Ch 1 | *"the ash under your hands went warm"* | Ch 8 — the Flame answers a Keeper's hands |
| Ch 2 | *"When I ask you for moonwater…"* | Ch 6 — her first material order |
| Ch 3 | *"I'll explain why that matters."* | Ch 7 |
| Ch 4 | *"It isn't a trick and it isn't luck."* | Ch 8 — she names what it is |
| Ch 5 | *"She never says what she wants."* | **Ch 12** — Selyna says it in one sentence |
| Ch 6 | *"A sad story about a librarian and nothing else."* | Ch 9 / Ch 10 |
| Ch 7 | *"Not tonight."* | Ch 10 |
| Ch 8 | *"Ask me who else did that."* | Ch 9 / Ch 10 — her father, named |
| Ch 9 | *"Whether she rides south is not my judgement."* | Ch 10 — she is there |
| Ch 10 | *"You may say no."* | Ch 11–12 |
| Ch 11 | Selyna: *"I never once put it down."* | Ch 12 — her terms |
| Marginalia | *"Entry left blank. I know what goes here."* | Ch 10 — the blank is the Keeping |
| Marginalia | *"Awake is not the same as warm."* | Ch 10 — the Lantern's stakes, said plainly |

## 6. One line changed for coherence

`script-chapters.md` ch 10 opened on *"The Elder told you. Good. I'd have found
a way not to."* — written when ch 9 and ch 10 were adjacent. With **Provisions
for the Road** and a crossing between them, that line is stale on arrival.

Replaced with a line that only works *because* a journey happened, and which
makes the next line's *"unasked"* literal rather than figurative:

> **You didn't ask me a single question the whole way south. I'd have preferred it if you had.**

Applied to `script-chapters.md`. It is a better line than the one it replaced,
which is the usual result of auditing dialogue against what the player actually
just did.

**2026-08-15 — the kid-clarity register pass, and three coherence fixes.**
The whole script was re-registered for the 8–13 target under
[naming.md](naming.md) §7 (shorter sentences, no idioms, no stumble words;
reveals, promises and gates untouched). Three line-level fixes rode along:

1. **Ch 4 now voices the player's question** — *"You're wondering why it's
   you. Don't ask me yet."* — so ch 8's opener (*"You've been wondering why
   it's you"*) calls back to a question that was actually seen being asked.
   The silent Keeper never asks; Eleanor must ask for them. (The line's
   wording also moved from "knack" to "trick" — the flagged-canon lie is the
   same lie.)
2. **The ch 8 hinge is now paid in plain words, on schedule.** *"Ask me who
   else did that"* was subtext-only — an adult gasps, a ten-year-old blinks.
   The Elder's testimony gained one bubble (*"He needed her hands for what his
   own could not do… Look at your own hands, child, and understand her"*) and
   ch 10 gained the plain statement (*"That's what I did to you"*). Reveal
   order is unchanged: suspicion in 8, testimony in 9, confession in 10.
3. **The Lantern's stakes are stated once, plainly** — ch 10: *"waking isn't
   warming"* — answering the question every player will ask ("why not just
   wake them all ourselves?"), seeded early by the new marginalia fragment
   *"Awake is not the same as warm."* Both rows are in §5.

Ch 10 also lost its hardest adult-introspection line (*"whether that makes it
better, or whether it's just the last excuse I've got left"*) — the content
survives in the surrounding bubbles; the register does not.

## 7. Coherence rules for authoring more

1. **Fire on state, never on a timer.** Every beat gates on a quest completion,
   and the quest's completion is what the beat is about.
2. **Count what you claim.** "Two of them, with names" gates on named == 2, not
   on hatched >= 2. Any line containing a number is a gate specification.
3. **A limitation must be demonstrated before it is confessed.** She fails to
   light a dead ember in ch 4 — in front of the player, who then succeeds — five
   chapters before she explains why.
4. **Reveals ride the channel the player already uses.** The father arrives
   through the Dragon Book because the player reads the Book daily; her
   powerlessness arrives through the board because the player just used their
   own hands on it.
5. **A gift is never a requirement.** Keepsakes raise Regard and unlock
   conversation; no quest consumes one. The moment a gift is mandatory it stops
   being a gift and becomes an order.
6. **Nothing that gates a chapter may be purchasable.** Nests, Growth and Trust
   are all time-and-care gated on purpose (merge-chains §4). Keys gate story,
   never power — that rule is already shipped.
</content>
