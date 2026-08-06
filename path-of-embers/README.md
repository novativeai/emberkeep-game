# Emberkeep — development board

A task board and dependency graph for the Emberkeep build, for two developers:
**Aina** (blue) and **Onja** (red). Switch with the control top-left or `Tab`;
the active developer re-themes the accent and authors anything you write. Task
ownership shows as a colour stripe on every card regardless of who is active.

```sh
pnpm install
pnpm dev        # http://localhost:3210
pnpm build
pnpm typecheck
```

Node 22 is required (`engines.node`).

## Views

| Key | View | Purpose |
|---|---|---|
| `1` | **Graph** | Dependency graph, grouped into lanes. The primary view. |
| `2` | **Board** | Status columns; drag cards between them. |
| `3` | **List** | Sortable table with inline editing. |
| `4` | **Timeline** | Earliest-start schedule and the critical path. |
| `5` | **Stats** | Progress, velocity, burndown, levels and achievements. |

## The graph

- **X is dependency depth** — a task always sits to the right of everything it
  depends on, so the graph reads strictly left to right.
- **Y is the group** — each group gets its own horizontal lane.
- Colour is the assignee, the dot is status, and a small dot on the right is
  priority (high or critical only). Blocked cards say so.
- Drag a card to place it by hand; **Auto layout** discards manual placement.
  Drag the handle on a selected card into another to create a dependency. Links
  that would create a cycle are refused.

## Data model notes

- `blocked` is **not** a status. It is derived from whether a task's
  dependencies are done, so it can never drift out of sync with the graph.
  Statuses are `backlog → ready → active → review → done`.
- XP scales with estimate and priority; levels, streaks and achievements are all
  derived on read, so none of them can be stale.
- The Timeline assumes a task starts the moment its last dependency ends. It is
  a forecast of the shape of the work, not a promise of dates.

## Storage and the API

The project lives in `data/project.json` on the server, and **the server is the
source of truth** — the browser is a client of the API like anything else. Only
view preferences (active developer, current view, filters, camera) stay in
`localStorage`.

Writes are serialised and land via a temp file plus rename. Every write bumps
`rev`; the browser sends the `rev` its edit was based on, so a `409` stops a
stale tab clobbering a task added over the API. It polls every four seconds, so
changes made with `curl` appear without a reload.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/project` | Whole project + `rev` |
| `PUT` | `/api/project` | Replace it. Body `{ project, rev? }`; `rev` makes it conditional |
| `GET` | `/api/tasks` | List, with filters (below) |
| `POST` | `/api/tasks` | Create one |
| `GET` | `/api/tasks/:ref` | Read, by id **or** key (`EMB-2`) |
| `PATCH` | `/api/tasks/:ref` | Partial update |
| `DELETE` | `/api/tasks/:ref` | Delete, and strip it from every other task's deps |
| `POST` | `/api/tasks/:ref/deps` | Add one link. Body `{ dep }` |
| `DELETE` | `/api/tasks/:ref/deps?dep=EMB-1` | Remove one link |
| `POST` | `/api/tasks/:ref/files` | Attach a file (multipart, field `file`, optional `by=A\|O`) |
| `GET` | `/api/tasks/:ref/files/:fileId` | Download it — streamed with `Content-Disposition: attachment` |
| `DELETE` | `/api/tasks/:ref/files/:fileId` | Remove the file and its object |
| `GET`/`POST` | `/api/groups` | List with counts / create |
| `PATCH`/`DELETE` | `/api/groups/:id` | Rename / delete (tasks move to the first group) |
| `GET` | `/api/stats` | Progress, per-developer numbers, the critical path |

List filters: `assignee` (`A`, `O`, `aina`, `onja`, `unassigned`), `status`,
`priority`, `group` (id or name), `tag`, `q`, and the booleans `ready`,
`blocked`, `overdue`.

Conveniences that matter when typing curl:

- `assignee` accepts **`A`** and **`O`**.
- `deps` and every `:ref` accept a **key** (`EMB-2`) as well as an internal id.
- `groupId` accepts an id (`world`) or a name (`World`).
- Reads return derived fields alongside stored ones: `blocked`, `ready`,
  `overdue`, `xp`, `hoursLogged`, `waitingOn[]`, `unlocks[]`.

```sh
# what can be started right now
curl -s 'localhost:3210/api/tasks?ready=true' | jq '.tasks[].title'

# add a task that depends on two others
curl -s -X POST localhost:3210/api/tasks -H 'content-type: application/json' -d '{
  "title": "Zone-3 masking", "assignee": "A", "groupId": "world",
  "estimate": 12, "deps": ["EMB-1", "EMB-3"]
}'

curl -s -X PATCH localhost:3210/api/tasks/EMB-4 -d '{"status":"active"}' \
  -H 'content-type: application/json'
```

Bad input is refused rather than absorbed: unknown tasks `404`, invalid enums
`400`, and a dependency that would create a cycle `409` — the same guard the
canvas uses when you drag a link.

Settings (`⚙` in the filter bar) exports and imports the whole project as JSON,
edits groups and forecast settings, and can reset the board to its defaults.

## Files

Attachments live in R2 under `emberkeep/attachments/<taskId>/`. Downloads are
streamed back **through the API**, so the bucket stays private and the browser
saves the file under its original name — no public R2 link is ever handed out.
Uploads pass through the app too, which avoids needing a CORS rule on the
bucket; the trade-off is the serverless body limit, so uploads are capped at
4 MB with an explicit error above that.

Without R2 credentials the app falls back to local disk, so attachments work in
`pnpm dev` out of the box. That fallback is **not durable on Vercel** — the
sync indicator says "storage not durable" when that is the case.

## Shortcuts

`⌘K` command palette · `N` new task · `Space` advance selected · `1`–`5` views ·
`Tab` switch developer · `F` fit · `E` toggle detail panel · `/` search ·
`⌘Z` / `⇧⌘Z` undo and redo · `?` full list.

## Art

`public/art/` holds two character plates and the background, generated with the
repo's `nano-banana` skill (Seedream 5.0 Pro for the characters against a chroma
key, Nano Banana 2 for the backdrop) and keyed to transparent alpha. They are
decoration only. The layout keeps a clear column on the right so the right-hand
figure is never covered by interface — the detail panel is bottom-anchored for
the same reason.

## A note on the CSS

Component classes in `globals.css` live inside `@layer components` on purpose.
Tailwind declares utilities in a later layer, so a utility on an element always
wins. Declared unlayered, a rule like `.panel { position: relative }` silently
beats an `absolute` utility.
