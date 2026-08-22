---
name: event-creator
description: Create and edit Emberkeep's authored EVENTS — input → output blocks in src/data/events.json that fire on a trigger (a tap, a bus fact, a property crossing a threshold, game time), guard on element properties (Eleanor's hearts, a dragon's trust, coins, a quest done), and then act (+1 to something, a spoken line, a clickable choice, a spawn, a panel, a tutorial). Use whenever asked to make something happen "when the player…", add a reaction, a reward, a mid-game moment, a choice dialogue, or to inspect what an event does. Works through the World Builder's ⚡ Events tab or the /__events dev-server API via scripts/evt.py. Pairs with `tutorial-editor` (scripted lessons) — an event can start one.
---

# Event Creator — the hands for `src/data/events.json`

The law is `docs/event-creator.md`; read it once. This skill is how you edit.

| Way in | Use it when |
|---|---|
| **World Builder → ⚡ Events tab** (`/tools/worldbuilder/` on `pnpm dev`) | a human wants to SEE the tree and the three columns |
| **`scripts/evt.py`** (this skill) | you are editing on the user's behalf from the shell |
| **`/__events` HTTP API** (`tools/events-api/server.ts`) | anything else |

Every write is validated by `validateEventsData` (`src/core/gameEvents.ts`) BEFORE it lands — the same function the unit suite runs on the committed file. A refused write says why and leaves the file untouched.

## The model in one breath

```
event { id, title?, when: Trigger[] (ANY), if?: Condition[] (ALL), then: Action[] (IN ORDER),
        once? | limit? + cooldownMs?, children?: event[] }
```

- **WHEN** — `event` (a bus fact, `match` narrows by payload key), `tap` (`character:<id>` `item:<chain>` `fog:<region>` `elder`), `property` (an EDGE: `prop op value` becomes true), `time` (`afterMs` after armed), `manual`.
- **IF** — `{ prop, op, value }` over the property catalogue: `keeper.{level,xp,coins,keys,energy,tutorialDone}`, `keeper.world.<id>`, `character.<id>.{hearts,regard}`, `dragon.<chain>.{trust,count}`, `board.<chain>.<tier>`, `quest.<id>.done`, `stat.<key>`, `flag.<name>`, `event.<id>.fired`.
- **THEN** — `add` (writable paths: keeper.xp/coins/keys/energy, character.<id>.regard, flag.*), `set` (flag.* only), `say`, `prompt` (choices, each with its own `then`), `spawn`, `retier`, `open` (ledger/store/bag/cauldron/codex/cookbook), `tutorial` (start a mid-game script), `fire` (another event), `emit` (a whitelisted command).
- **Children** are armed by the parent's firing. **Latches** live in `stats` (`evt:<id>:fired|last|armed`, `flag:<name>`) — no `SAVE_VERSION` ever.

`evt context` prints every picker list (facts + their payload keys, the property catalogue with `write` flags, commands, chains, quests, characters, regions, worlds, tutorial scripts). Check it before inventing an id.

## Recipes

```sh
EVT=.claude/skills/event-creator/scripts/evt.py

$EVT ls                                   # the tree
$EVT show greet                           # WHEN / IF / THEN / children
$EVT context properties                   # what can be read, what can be written
$EVT context triggerEvents                # facts and the payload keys `match` may name

# A reaction: Eleanor speaks the first time her third heart fills, after the tutorial
$EVT add --event '{"id":"eleanor_third_heart","title":"The third heart",
  "when":[{"type":"property","prop":"character.eleanor.hearts","op":">=","value":3}],
  "if":[{"prop":"keeper.tutorialDone","op":"==","value":1}],
  "then":[{"say":{"speaker":"eleanor","lines":["I kept this back for someone who would stay."]}},
          {"spawn":{"chain":"chest","tier":1,"count":1}}],
  "once":true}'

# A follow-up INSIDE it: tap her again → a clickable choice
$EVT add --parent eleanor_third_heart --event '{"id":"eleanor_asks","when":[{"type":"tap","target":"character:eleanor"}],
  "then":[{"prompt":{"id":"keep","speaker":"eleanor","text":"Will you keep it, or open it now?","choices":[
    {"id":"keep","label":"Keep it","then":[{"set":"flag.kept_chest","value":1}]},
    {"id":"open","label":"Open it","then":[{"emit":"chest:open","payload":{}}]}]}}],"once":true}'

# A counter: every Ash Moss merge after the tutorial, at most once a minute
$EVT add --event '{"id":"moss_merges","when":[{"type":"event","event":"item:merged","match":{"chain":"sparkweed"}}],
  "if":[{"prop":"keeper.tutorialDone","op":"==","value":1}],"then":[{"add":"flag.moss_merges","amount":1}],"cooldownMs":60000}'

$EVT edit moss_merges --set cooldownMs=30000 --set 'title="Moss count"'
$EVT edit moss_merges --unset cooldownMs
$EVT mv eleanor_asks --parent root --to 0        # un-nest
$EVT reorder eleanor_third_heart moss_merges     # root order
$EVT rm moss_merges
$EVT validate
$EVT fire eleanor_third_heart                    # prints __emberkeep.fireEvent('…') for the game console
```

Raw HTTP: `GET /__events` → `{events}`; `GET /__events/context`; `PUT /__events` ← `{events}`; `POST /__events/op` ← `add_event | update_event | remove_event | move_event | reorder` (shapes in `tools/events-api/server.ts` `EditOp`); `POST /__events/validate`.

## Laws you still own (the validator cannot see these)

1. **The XP tune.** `add keeper.xp` before the tutorial's `levelup` beat moves Level 2 off its scripted beat — guard with `keeper.tutorialDone == 1` unless you mean to retune (`LEVEL_XP`, docs/tutorial-coverage.md).
2. **Voice and names.** `say`/`prompt` lines are Eleanor's / Selyna's / the Elder's: `docs/naming.md` and the story bible §5. Never "tap the button".
3. **A prompt is a commitment.** It is not dismissible; every choice must lead somewhere the player can feel.
4. **Facts are inputs, commands are outputs.** If a fact you need is not in `triggerEvents`, it is added to `TRIGGER_EVENTS` in `gameEvents.ts` with its payload keys — never by listening to a command.
5. **Reading a counter** (`stat.*`) is fine; **owning** one is `flag.*`. Don't `add` to another system's number.
6. **Children vs. `fire`.** A child is a sequence ("after this, when…"); `fire` is composition ("do that too, now"). Depth of `fire` chains is capped at 8.
7. After a save the running game picks the file up on its next reload. `render_game_to_text().events` lists what has fired; `__emberkeep.events()` lists every event's armed/fired status.
