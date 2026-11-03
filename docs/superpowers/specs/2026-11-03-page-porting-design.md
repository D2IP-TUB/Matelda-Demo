# Porting the Streamlit pages to React: shared design

Status: approved in chat (owner: "dont focus too much on the design now, first port the pages with this simple design"). Items marked **[my call]** were decided by the designer.

Builds on `2026-11-03-react-fastapi-pocketbase-foundation-design.md` (three services, `/api` under FastAPI, PocketBase for rooms and sessions, jobs for long steps).

## Intent

Port every remaining Streamlit page to the React app with the same general functionality. Visual design is deliberately plain; only enough styling that the app is readable and consistent.

## Scope and order

Pages are ported in batches, each with its own plan, in the Streamlit sidebar order:

1. **Batch 1 (this plan):** shared shell, InputOutput ("Intro"), Configurations.
2. Batch 2: DomainBasedFolding, QualityBasedFolding.
3. Batch 3: Labeling (swipecards, room claims, live multiplayer).
4. Batch 4: PropagatedErrors, ErrorDetection, Results.

Step order in the tracker (Streamlit sidebar order): Lobby, Intro, Configurations, Domain Folding, Quality Folding, Labeling, Propagated Errors, Error Detection, Results. **[my call]** This swaps PropagatedErrors and ErrorDetection relative to the foundation's placeholder order.

## Shared look (chosen by owner: top bar + step tracker)

- Top bar: Matelda name; current room name and live player count (from PocketBase), or a "Join a room" link to the lobby when not in a room.
- Step tracker for the 9 steps: completed amber, current navy with amber ring, future grey; every step is a link (no gating). Collapses to "Step N of 9" + a select on narrow screens. **[my call]**
- Palette from `.streamlit/config_light.toml`: navy `#002f67`, amber `#f4b11c`, grey `#e6e6e6`, white cards, monospace font.
- Plain hand-written CSS with CSS variables; no CSS framework. Dark theme and theme toggle are out of scope. **[my call]**
- Shared components: `Card`, `Button`, `Notice` (info/warn/error), `JobStatus` (running/failed/lost/done), `DataTable`.
- Prefer common, headless React libraries so behaviour and design can be changed later: `@tanstack/react-table` for tables (owner request). Libraries for later pages (swipe gestures for Labeling, charts for Results) are chosen when those batches start. **[my call]**

## Conventions for ported pages

- Page state that Streamlit kept in `st.session_state` lives in the PocketBase `sessions` record via `useSession()`, using the same key names (`dataset_select`, `pipeline_path`, `labeling_budget`, `selected_strategies`, `domain_folds`, `cell_folds`, ...). `pipeline_path` stores the pipeline folder **name** only, not an absolute path. **[my call]**
- The room's dataset (set when the room starts) is written to the session as `dataset_select` by the Lobby.
- The API reads and writes the existing `pipelines/<name>/configurations.json` format unchanged (`selected_dataset`, `labeling_budget`, `selected_strategies`, `domain_folds`, `cell_folds`, `results`) so Streamlit and React pipelines stay interchangeable.
- Pipeline folder names keep the Streamlit scheme `<dataset>-pipeline-NN-<suffix>`, where the suffix is the first 6 characters of the browser session id. **[my call]**
- API data endpoints return JSON that is paginated or limited; the browser never receives a whole large table.
- Name and path inputs from the browser (dataset, table, pipeline) are checked against server-side listings or a strict pattern before any filesystem access.
- Missing prerequisites (no dataset, no pipeline) show a notice with a link to the earlier step, like the Streamlit pages do.

## Non-goals

- Pixel parity with Streamlit, dark mode, theme switcher, QR code, restart dialog (restart can come with a later batch).
- Dataset upload (disabled on the university server in Streamlit too).
- Changing the ML code in `backend/` or `Matelda/`.

## Batch 1 behaviour

**Intro (InputOutput):** requires `dataset_select`. Lists the dataset's tables (directories containing `dirty.csv`). Tab "Input tables": pick a table, see row/column counts and a scrollable preview of the dirty data. Tab "Dirty vs Clean": pick a table, see total cells, differing cells and error rate, and the dirty and clean tables side by side with differing cells highlighted. Large tables are shown in pages of rows. "Next" goes to Configurations.

**Configurations:** choose "Create new pipeline" or "Use existing pipeline".
- Dataset: defaults to the session dataset (the room's), changeable from the list of datasets.
- Labeling budget: slider and number input kept in sync, 1 to 100.
- Error detection strategies: checkboxes from `/api/strategies`, all preselected for a new pipeline.
- New: pipeline name prefilled with the suggested unique name; a name that already exists is rejected.
- Existing: pick a pipeline, its dataset, budget and strategies load into the form; "Save as" name field optional. Unchanged name overwrites the config; a different name copies the whole pipeline folder first (keeping results), then updates the copy.
- "Next" saves, stores `pipeline_path`, `dataset_select`, `labeling_budget` and `selected_strategies` in the session, and goes to Domain Folding. Creating a brand-new pipeline clears the session's derived state (`domain_folds`, `cell_folds`) but keeps room keys.

## Left to the builder

Exact response shapes, component internals, table pagination size (default 100 rows), CSS details.
