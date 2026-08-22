# Event Creator — the structured event system

`src/data/events.json` · model `src/core/gameEvents.ts` · runtime `src/systems/EventSystem.ts` ·
editor World Builder **⚡ Events** tab · API `/__events` · skill `event-creator`

An **event** is an input → output block the game evaluates for you. Authoring
one is a data edit: it ships with the JSON, is validated before it lands, and is
persisted through `stats` alone (no `SAVE_VERSION` bump, ever).

```
              ┌──────────────────────────────────────────────────────┐
   INPUT      │  WHEN   one of the triggers fires     (the click)    │
              │  IF     every condition holds         (the property) │
   OUTPUT     │  THEN   the actions run, in order     (the +1)       │
              │  ├─ a prompt's CHOICE is a nested output branch       │
              │  └─ CHILD events are armed only after this one fired │
              └──────────────────────────────────────────────────────┘
```

## 1. The three vocabularies

### 1.1 Elements and their properties — `element.property`

Everything an event can read is a **property path**. The catalogue is closed
(`PROPERTY_CATALOG` in gameEvents.ts — the editor's picker and the validator
both read it), and every value is a number (booleans are 0/1), so one
comparison grammar covers all of it.

| path | meaning | writable by `add`/`set` |
|---|---|---|
| `keeper.level` | current level | — |
| `keeper.xp` `keeper.coins` `keeper.keys` | currencies | `add` → `economy:add` |
| `keeper.energy` | warmth now | `add` → `energy:add` |
| `keeper.tutorialDone` | 0/1 | — |
| `keeper.world.<worldId>` | 1 while standing in that world | — |
| `character.<id>.hearts` | Regard hearts (0–5) | — (derived) |
| `character.<id>.regard` | Regard points | `add` → `regard:add` |
| `dragon.<chain>.trust` | highest Trust among that breed's board dragons | — |
| `dragon.<chain>.count` | named or not, any tier ≥ hatch, on the active board | — |
| `board.<chain>.<tier>` | pieces of that chain+tier on the active board | — |
| `quest.<id>.done` | 0/1 (`q:done:<id>` latch) | — |
| `stat.<key>` | any lifetime counter in `GameState.stats` | — (owned elsewhere) |
| `flag.<name>` | an event-owned number, `stats['flag:<name>']` | `add`, `set` |
| `event.<id>.fired` | how many times that event has fired | — |

`stat.*` is read-only on purpose: counters have owners (TaskSystem, the
director, the ladder). Events keep their own numbers under `flag.*`.

### 1.2 Inputs — triggers (WHEN, any of)

| trigger | fires when |
|---|---|
| `{ "type": "event", "event": "<bus event>", "match"?: { "<payloadKey>": value } }` | that fact is emitted on the bus and every `match` key equals the payload's. The allowed facts are the bus events in `TRIGGER_EVENTS` (taps, merges, hatches, feeds, deliveries, panels opening, world arrivals, chapter turns…). |
| `{ "type": "tap", "target": "character:<id>" \| "item:<chain>" \| "fog:<region>" \| "elder" }` | sugar over the tap facts, resolved against the live piece/character. |
| `{ "type": "property", "prop": "<path>", "op": ">=", "value": n }` | **edge**: the comparison was false on the last look and is true now. Re-read on every fact in `PROPERTY_WATCH_EVENTS` and on the clock tick. |
| `{ "type": "time", "afterMs": n }` | `n` ms of game time (`GameClock`, so `advanceTime` works) after the event became ARMED — boot for a root, the parent's firing for a child. |
| `{ "type": "manual" }` | never on its own — only `fire` from another event, `__emberkeep.fireEvent(id)`, or the API's run action. |

### 1.3 Guards — conditions (IF, all of)

`{ "prop": "<path>", "op": "==" | "!=" | ">" | ">=" | "<" | "<=", "value": n }`

Read at the moment a trigger fires. A guard that fails **consumes nothing**:
the trigger is simply not answered, and the event stays armed.

### 1.4 Outputs — actions (THEN, in order)

| action | what happens | owner |
|---|---|---|
| `{ "add": "<writable path>", "amount": n, "reason"?: s }` | `economy:add` / `energy:add` / `regard:add` / flag += | the owning system |
| `{ "set": "flag.<name>", "value": n }` | flag = n | EventSystem |
| `{ "say": { "speaker": "eleanor", "lines": ["…"] } }` | tap-advanced bubble, same surface as a chapter beat; held if the speaker is not on this world | UIScene |
| `{ "prompt": { "id", "speaker", "text", "choices": [{ "id", "label", "then": [actions] }] } }` | a **clickable dialogue**: the player picks, that choice's `then` runs. One open prompt at a time. | UIScene asks, EventSystem answers |
| `{ "spawn": { "chain", "tier", "count", "at"?: [c,r] } }` | `board:spawn` (overflow → Bag) | BoardSystem |
| `{ "retier": { "chain", "fromTier", "toTier" } }` | `board:retier` | BoardSystem |
| `{ "open": "ledger" \| "store" \| "bag" \| "cauldron" \| "codex" \| "cookbook" }` | the panel's toggle intent | UIScene |
| `{ "tutorial": "<script id>" }` | start a mid-game tutorial script (`tutorial:start_requested`) | TutorialDirector |
| `{ "fire": "<event id>" }` | run another event's guards+actions now (depth-limited) | EventSystem |
| `{ "emit": "<command>", "payload": {…} }` | escape hatch for any command in `EMITTABLE_COMMANDS` | the command's owner |

Actions never reach into another system: every one of them is a bus command
the owner already handles. The event system is a **scheduler of intents**.

## 2. One event

```jsonc
{
  "id": "eleanor_third_heart_gift",
  "title": "A gift at the third heart",
  "when":  [{ "type": "property", "prop": "character.eleanor.hearts", "op": ">=", "value": 3 }],
  "if":    [{ "prop": "keeper.tutorialDone", "op": "==", "value": 1 }],
  "then":  [
    { "say": { "speaker": "eleanor", "lines": ["I kept this back for someone who would stay."] } },
    { "spawn": { "chain": "chest", "tier": 1, "count": 1 } }
  ],
  "once": true,                       // latch: stats["evt:<id>:fired"]
  "cooldownMs": 0,                    // min game-time between firings (when not once)
  "limit": 0,                         // max firings, 0 = unlimited
  "children": [                       // ARMED only after this event has fired
    {
      "id": "eleanor_asks_back",
      "when": [{ "type": "tap", "target": "character:eleanor" }],
      "then": [{ "prompt": {
        "id": "keep_or_give", "speaker": "eleanor", "text": "Will you keep it, or open it now?",
        "choices": [
          { "id": "keep", "label": "Keep it",  "then": [{ "set": "flag.kept_chest", "value": 1 }] },
          { "id": "open", "label": "Open it",  "then": [{ "emit": "chest:open", "payload": {} }] }
        ] } }],
      "once": true
    }
  ]
}
```

### Lifecycle and latches (all in `stats`, all monotonic)

| key | meaning |
|---|---|
| `evt:<id>:fired` | times fired (the `once` latch and `event.<id>.fired`) |
| `evt:<id>:last` | `GameClock.now()` of the last firing (cooldown) |
| `evt:<id>:armed` | `now` when the event became armed (time triggers; children stamp it when the parent fires) |
| `flag:<name>` | event-owned numbers |

**Armed** = a root event at boot, a child once its parent has fired at least
once. A disarmed event hears nothing. Firing is: a trigger matches → every `if`
holds → `once`/`limit`/`cooldown` allow → actions run in order → `fired`+1,
`event:fired` emitted → children stamp `armed` → property-edge baselines
refresh. A `prompt` suspends only its own branch: the event counts as fired
when the prompt opens, the chosen branch runs when the answer arrives
(`ui:event_choice`), and an unanswered prompt dies with the session — nothing
about it is saved, because nothing it promised has happened yet.

### Nesting rule

A child is an event **inside** its parent: same shape, same vocabulary, armed
by the parent's firing instead of by boot. Depth is unbounded in data, and the
validator flattens the tree, so ids are unique across the whole file and a
`fire` may name any event anywhere. Sequences ("greet → tap again → choose")
are parent → child → prompt; alternatives are prompt choices; fan-out is one
parent with several children.

## 3. What the system refuses (validator, before every write)

- unknown property path, op, speaker, panel, bus event, command, or chain
- a `match` key not in the bus event's payload catalogue
- a duplicate id anywhere in the tree, a `fire` naming nobody, a choice `then` that is empty
- an event with no triggers, or no actions
- `add` on a read-only path, `set` on anything but `flag.*`
- `once` together with `limit`/`cooldownMs` (say one thing)

## 4. Laws the author still owns

1. **The tune.** `economy:add` XP from an event before the tutorial's `levelup`
   beat moves Level 2 off its scripted beat — guard with `keeper.tutorialDone`.
2. **Silence while the tutorial owns the bubble.** `say`/`prompt` are queued by
   UIScene until the director hands back, exactly like a reveal card.
3. **Voice.** Lines are Eleanor's/Selyna's — `docs/naming.md`, `story-bible` §5.
4. **Idempotence on load.** Nothing in the system re-fires on hydrate: `once`
   reads its latch, time triggers re-arm from their stamp, property edges take
   their baseline from the loaded state without firing.

## 5. Tooling

- **⚡ Events tab** (World Builder): the tree on the left, the selected event as
  three columns — WHEN / IF / THEN — with pickers driven by `GET /__events/context`
  (bus facts and their payload keys, the property catalogue, speakers, chains,
  quests, panels, commands). Save validates; Run fires an event in the running
  game through the dev bridge.
- **API** (`tools/events-api/server.ts`, mounted by vite at `/__events`):
  `GET /` `GET /context` `PUT /` `POST /op` (`add_event | update_event |
  remove_event | move_event | reorder`) `POST /validate`.
- **Skill** `event-creator` — `scripts/evt.py ls|show|context|add|edit|rm|mv|validate|dump|put|fire`.
- **Unit**: `tests/unit/GameEvents.spec.ts` (model + validator against the
  shipped file) and `tests/unit/EventSystem.spec.ts` (runtime through a real
  `GameContext` in node).
