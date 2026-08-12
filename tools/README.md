# tools/

Dev-only. Nothing here is bundled — `vite.config.ts` sets `publicDir: 'assets'`,
so these are served straight off the project root during `pnpm dev` and are
absent from `dist`.

Three kinds of thing, kept apart because they have different lifetimes:

## Interactive tools — `tools/<name>/`

Browser apps opened against the dev server, e.g.
`http://localhost:5173/tools/worldbuilder/index.html`. **The directory name is
part of a URL** — renaming one breaks the harnesses that navigate to it and the
workflows in `docs/pipelines.md`.

| | |
|---|---|
| `worldbuilder` | authors the world; owns `default-world.json` and, on its 🧝 Characters tab, where Eleanor/Selyna stand (`src/data/characters.json`) |
| `uibuilder` | UI theming → `src/data/ui-theme.json` (written live via a dev endpoint) |
| `rigger` | dragon rig authoring |
| `face-animator` | blink/talk head frames |
| `fxstudio` | particle + flipbook FX |
| `iso3d` | isometric 3D decor preview |
| `mapmask` | island silhouette + tile-grid authoring (Python) |
| `maskstudio` | hand-drawn B/W masks + perspective tile grids over an uploaded image |
| `fbtest` | flipbook proof page — driven by `checks/fbtest.mjs` |

## Verification harnesses — `tools/checks/`

One-shot Playwright scripts that drive the game or a tool and assert something
visual. Run individually against a live `pnpm dev`; they are not part of
`pnpm verify` (that runs `tests/` and Playwright's own suite). Each documents its
own usage at the top of the file.

## Data migrations — `tools/migrations/`

One-time rewrites of game data that have **already been applied** — kept for
provenance, not to be re-run. `reskin-default-world.mjs` and
`wire-game-assets.mjs` both mutate authored JSON; running either again would
re-apply a migration on top of its own result.
