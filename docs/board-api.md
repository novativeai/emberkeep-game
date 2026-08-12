# Emberkeep development board — REST API

`https://emberkeep-board.vercel.app` — the gamified task board. It already ships
a full REST API; this is the surface, verified live on 2026-08-04 by a
create → patch → upload → delete round trip.

The board's own client does **not** use it. The browser app only polls
`GET /api/project` and writes the whole document back with `PUT`. Everything
below is a separate, task-level API — the right thing for an agent to drive.

## Routes

| Method | Route | Purpose |
|---|---|---|
| GET, PUT | `/api/project` | The whole document. `PUT` replaces it — the client's own save path. |
| GET, POST | `/api/tasks` | List all tasks (`{rev, count, tasks[]}`) · create one. |
| GET, PATCH, DELETE | `/api/tasks/{id}` | One task. **Accepts either the internal id (`t_emb_5`) or the key (`EMB-5`).** |
| POST | `/api/tasks/{id}/files` | Attach a file — `multipart/form-data`, field name `file`. |
| GET, POST | `/api/groups` | Lanes: World, Gameplay, Characters, UI. |
| GET | `/api/stats` | Rollups — totals, byStatus, byPriority, byGroup, estimates, hours. |

Every mutating response returns the new `rev`, which is a monotonic counter on
the whole document. Storage is Cloudflare **R2** (`"storage": "r2"` on
`/api/project`); attachments land under `emberkeep/attachments/{taskId}/`.

## Task shape

```json
{
  "id": "t_emb_5", "key": "EMB-5", "title": "…", "notes": "…",
  "status": "backlog|ready|active|review|done",
  "priority": "low|normal|high|critical",
  "assignee": "aina|onja|null", "groupId": "world|gameplay|characters|ui",
  "deps": [], "tags": [], "estimate": 20, "due": null,
  "createdAt": 0, "updatedAt": 0, "startedAt": null, "completedAt": null,
  "checklist": [], "comments": [], "logs": [], "attachments": [],
  "pos": { "x": 0, "y": 0 }
}
```

Read-only fields the API computes on the way out: `group`, `blocked`, `ready`,
`overdue`, `xp`, `hoursLogged`, `waitingOn`, `unlocks`.

`deps` drives the graph: `blocked` is true while any dependency is unfinished,
which is why EMB-6 (Integration of 3D characters) sits blocked behind EMB-5.

## Worked examples

```sh
B=https://emberkeep-board.vercel.app

curl -sS "$B/api/tasks/EMB-5"                       # read one task by key
curl -sS "$B/api/stats"                             # burndown rollups

curl -sS -X PATCH "$B/api/tasks/EMB-5" \
  -H 'content-type: application/json' \
  -d '{"status":"review","assignee":"aina"}'

curl -sS -X POST "$B/api/tasks/EMB-5/files" \
  -F "file=@assets/sprites/characters/selyna/3d/selyna.glb;type=model/gltf-binary"

curl -sS -X POST "$B/api/tasks" -H 'content-type: application/json' \
  -d '{"title":"…","status":"backlog","groupId":"characters","estimate":4}'
```

The upload route takes one file per request — the *browser* input is
single-file too (no `multiple` attribute), so batching is not available on
either path. Send them one at a time.

## Two things to know before relying on it

**There is no authentication.** No key, no cookie, no origin check — an
unauthenticated `DELETE /api/tasks/EMB-1` from anywhere on the internet removes
that task, and `GET /api/project` discloses the whole board. That is fine for a
demo on an unguessable URL and not fine for anything else. A shared-secret
header checked in middleware would be the cheap fix.

**Do not leave the web app open while writing through the API.** The page holds
the whole document in memory and saves it back wholesale via `PUT
/api/project`, so a tab that loaded before your writes can clobber them. Close
it, or reload it afterwards.

Also worth fixing on the client: it polls `GET /api/project` continuously —
roughly 485 requests in a single idle session — where the `rev` counter already
gives it a cheap change check.
