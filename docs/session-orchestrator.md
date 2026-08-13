# Session orchestrator

Routing table for the concurrent Claude sessions on this repo. One task → one
lane. Keep it cheap: no polling, no broadcasts, no status round-trips.

## Lanes

| Lane | Session (re-verify) | Owns | Route on |
|---|---|---|---|
| `art-items` | `emberkeep-demo-f1` | Item/board art already in the repo: keyline weight, re-bakes, resizes, `optimize:art` | outline, keyline, ink weight, re-bake, sprite cleanup |
| `art-new` | `emberkeep-demo-49` | NEW art from AI: chains, icons, decor, `merge_style.py`, the `nano-banana` + `dragon-forge` skills | generate, new chain, new breed, skin, icon set, concept |
| `render` | `emberkeep-demo-da` | `src/render/**`, shaders, `RigPlayer`, rig ink, draw order, depth | shader, rig, depth, blend, GPU, draw call |
| `gameplay` | `emberkeep-demo-45` | onja lane: systems, EventBus, zones/world, board mechanics, `build-zones.mjs` | merge rule, system, zone, world, drag, unlock, economy |
| `ui` | `emberkeep-demo-c3` | aina lane: Emporium/shop, dialogue & conversation UI, portraits, HUD, `ui-theme.json` | shop, dialog, portrait, HUD, panel, button, theme |
| `spare` | `emberkeep-demo-dd` | Unassigned — takes overflow or a new category on request | — |

Not covered by any lane: **story/quests/tutorial**, **VFX/particles**,
**build/tooling/pipelines**, **audio**. Tasks in these get the top-3 prompt.

## Routing

1. Match the task against the **Route on** column. One hit → send it there.
2. No hit, or two lanes hit equally → do **not** guess. Print the top 3 closest
   lanes with a one-line reason each and ask the user to pick or name a new one.
3. Never split one task across lanes. If it genuinely spans two (e.g. new art
   that also needs a shader), send it to the lane that owns the *final*
   artifact and let that session hand off.

## Addressing

Names are auto-generated and change when a session restarts — the **lane** is
stable, the name is not. Before the first send in a session:

```
ListAgents                      # names + "started Nh ago"
ps -eo pid,etime | ...          # correlate age → PID when a name is ambiguous
```

Then send with the ref, which `ListAgents` prints:

```json
{"to": "emberkeep-demo-f1 [5c9ade]", "message": "..."}
```

- The bare name is **rejected on first use** — the ref is a required confirmation.
- Replies come back from `uds:/tmp/cc-socks/<PID>.sock`; the basename is the
  sender's PID, not the name you sent to. Match replies by PID, not by name.
- Only ping a session whose lane you cannot identify. Do not ask for status.

## Collision rule

Two sessions writing the same path is the failure mode here — it has already
happened on `assets/sprites/items/**`. Before routing art work, check the lane
table for an overlapping owner; if `art-items` and `art-new` would both touch a
file, the task belongs to whichever lane's change lands last.

Any session may commit; a session that commits the whole tree sweeps in other
lanes' in-flight work. Commit only your lane's paths unless told otherwise.
