# Page Porting, Batch 1 (shell, Intro, Configurations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the shared app shell (top bar and step tracker) and port the Intro (InputOutput) and Configurations pages to React, backed by new data and pipeline endpoints in FastAPI.

**Architecture:** FastAPI gains read-only dataset table endpoints and pipeline CRUD endpoints that operate on the existing `datasets/` and `pipelines/<name>/configurations.json` formats. The React app gains a `Layout` route wrapper, plain CSS, and the two pages; page state lives in the PocketBase session via `useSession()`.

**Tech Stack:** As the foundation plan (FastAPI, pandas already in the venv, React, TanStack Query, Vitest + happy-dom, openapi-typescript).

**Spec:** `docs/superpowers/specs/2026-11-03-page-porting-design.md` (builds on `2026-11-03-react-fastapi-pocketbase-foundation-design.md`)

## Global Constraints

- `backend/`, `Matelda/` and the Streamlit app are not edited.
- `pipelines/<name>/configurations.json` format unchanged: keys `selected_dataset`, `labeling_budget`, `selected_strategies`, `domain_folds`, `cell_folds`, `results`.
- Pipeline folder names: `<dataset>-pipeline-NN-<suffix>`, suffix = first 6 characters of the session id.
- `pipeline_path` in the session holds the pipeline folder name only.
- Labeling budget is an integer from 1 to 100.
- Browser-supplied dataset, table and pipeline names are validated (listing match or pattern `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`) before touching the filesystem.
- Palette: navy `#002f67`, amber `#f4b11c`, grey `#e6e6e6`, white cards, monospace font. Plain CSS with variables; no CSS framework.
- Step order: Lobby, Intro, Configurations, Domain Folding, Quality Folding, Labeling, Propagated Errors, Error Detection, Results.
- Test commands: `venv/bin/python -m pytest api/tests -q`; `cd frontend && npx vitest run`; `cd frontend && npm run build`.

## Review Focus

1. A table name like `../x` or an unknown table: 404, never read outside the dataset. A `compare` request for a table without `clean.csv`, with different columns/shape in dirty vs clean, an empty table, or an offset past the end: a clear 404/422 or an empty page, never a 500. (Task 1)
2. Pipeline names that are empty, contain `/` or `..`, or exceed 100 characters: 422; creating or copying onto an existing name: 409. (Task 2)
3. Changing the dataset of an existing pipeline removes its stale `domain_folds`, `cell_folds` and `results`. (Task 2)
4. Intro or Configurations opened with no dataset or no room: a notice with a link back, no crash; the strategies list failing to load shows an error instead of an empty form that can be saved. (Tasks 4, 5)
5. Budget input of `0`, `101`, empty or non-numeric is clamped to 1..100 and never sent to the API; a typed pipeline name that already exists disables Next with a warning. (Task 5)

---

## File Structure

```
api/settings.py                 modify: add pipelines_dir
api/tables.py                   new: list_tables, resolve_table, read_page, compare
api/pipelines.py                new: name validation, list/load/save/suggest/create/copy
api/routes/tables.py            new: tables + dirty + compare endpoints
api/routes/pipelines.py         new: pipelines endpoints
api/tests/test_tables.py        new
api/tests/test_pipelines.py     new
frontend/src/styles/app.css     new: tokens + layout
frontend/src/components/        new: Layout.tsx, TopBar.tsx, StepTracker.tsx, ui.tsx (Card, Button, Notice, JobStatus), DataTable.tsx
frontend/src/rooms/useRoomInfo.ts      new
frontend/src/pages/Intro.tsx           new (replaces placeholder)
frontend/src/pages/Configurations.tsx  new (replaces placeholder)
frontend/src/configurations/pipelineFlow.ts  new: ensureSuffix, savePipelineChoice
```

---

### Task 1: Dataset table endpoints

**Files:**
- Create: `api/tables.py`, `api/routes/tables.py`, `api/tests/test_tables.py`
- Modify: `api/main.py` (include router)

**Interfaces:**
- Consumes: `get_settings`, `require_dataset` (path param `dataset`).
- Produces in `api/tables.py`:
  - `list_tables(dataset_dir: Path) -> list[str]` sorted subdirectories that contain `dirty.csv`
  - `resolve_table(dataset_dir: Path, name: str) -> Path | None` only an exact member of `list_tables`
  - `class TablePage(BaseModel)`: `columns: list[str]`, `rows: list[list[str]]`, `total_rows: int`, `offset: int`
  - `class CompareResult(BaseModel)`: `columns: list[str]`, `dirty_rows: list[list[str]]`, `clean_rows: list[list[str]]`, `diff: list[list[bool]]`, `offset: int`, `total_rows: int`, `total_cells: int`, `differing_cells: int`, `error_rate: float` (percent, whole table)
  - `read_page(table_dir: Path, offset: int, limit: int) -> TablePage` (reads `dirty.csv` with `dtype=str, keep_default_na=False`)
  - `compare(table_dir: Path, offset: int, limit: int) -> CompareResult`; raises `FileNotFoundError` without `clean.csv`, `ValueError` when dirty and clean differ in columns or row count
- Endpoints: `GET /api/datasets/{dataset}/tables` -> `list[str]`; `GET /api/datasets/{dataset}/tables/{table}/dirty?offset=0&limit=100` -> `TablePage`; `GET /api/datasets/{dataset}/tables/{table}/compare?offset=0&limit=100` -> `CompareResult`. `limit` is 1..500, `offset` >= 0 (422 otherwise). Unknown table 404; missing `clean.csv` 404; mismatched shapes 422.

- [ ] **Step 1: Write failing tests** in `api/tests/test_tables.py` using `tmp_path` datasets: dataset `d` with tables `t1` (dirty `a,b\n1,2\n3,x\n`, clean `a,b\n1,2\n3,4\n`), `t2` (dirty only), `t3` (dirty has columns `a`, clean has `a,b`), `empty` (dirty with header only), plus a plain file. Tests: `test_list_tables_only_dirs_with_dirty_csv`; `test_resolve_table_rejects_traversal` (parametrized `../t1`, `t1/..`, `/etc`, `""`, `missing`); `test_dirty_page_returns_rows_as_strings` (offset 1, limit 1 returns `[["3","x"]]`, `total_rows == 2`); `test_dirty_page_offset_past_end_is_empty`; `test_empty_table_page`; `test_compare_counts_and_mask` (`differing_cells == 1`, `total_cells == 4`, `error_rate == 25.0`, `diff == [[False, False],[False, True]]`); `test_compare_pages_but_counts_whole_table` (limit 1: one row, stats unchanged); `test_compare_without_clean_is_404`; `test_compare_shape_mismatch_is_422`; endpoint tests via `TestClient` with `get_settings` overridden: tables list, unknown dataset 404, `..%2F` table 404, `limit=0` 422, `limit=501` 422.
- [ ] **Step 2:** Run `venv/bin/python -m pytest api/tests/test_tables.py -q`. Expected: FAIL (import error).
- [ ] **Step 3:** Implement `api/tables.py` and the router (pandas `iloc` slicing for pages; the diff mask is `dirty.ne(clean)` over the whole table, sliced for the page) and wire it into `create_app()`.
- [ ] **Step 4:** Re-run. Expected: PASS; then run the whole `api/tests` suite. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(api): dataset table preview and dirty/clean compare endpoints`.

---

### Task 2: Pipeline endpoints

**Files:**
- Modify: `api/settings.py` (add `pipelines_dir: Path` = `<repo>/pipelines`; `Settings` gains the field, so update existing test fixtures that build `Settings(...)` to pass `pipelines_dir=tmp_path / "pipelines"`)
- Create: `api/pipelines.py`, `api/routes/pipelines.py`, `api/tests/test_pipelines.py`
- Modify: `api/main.py`, `api/tests/test_datasets.py`, `api/tests/test_matelda_routes.py` (fixtures only)

**Interfaces:**
- Produces in `api/pipelines.py`:
  - `NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")`
  - `valid_name(name: str) -> bool`
  - `list_pipelines(root: Path) -> list[str]` sorted directory names
  - `resolve_pipeline(root: Path, name: str) -> Path | None` (valid name and existing directory, else `None`)
  - `load_config(pipeline_dir: Path) -> dict[str, Any]` (`{}` when no file)
  - `save_config(pipeline_dir: Path, config: dict[str, Any]) -> None` (indent 4, like `components/utils.py`)
  - `suggest_name(root: Path, dataset: str, suffix: str) -> str` -> `<dataset>-pipeline-NN-<suffix>` with NN = 1 + highest existing number for that dataset and suffix, two digits, starting at 01
  - `create_pipeline(root: Path, name: str, config: dict[str, Any]) -> None` (raises `FileExistsError`)
  - `copy_pipeline(root: Path, src: str, dst: str) -> None` (whole folder, `shutil.copytree`; raises `FileNotFoundError` / `FileExistsError`)
  - `DERIVED_KEYS = ("domain_folds", "cell_folds", "results")`
  - `apply_update(existing: dict, update: dict) -> dict` merges the three config keys; when `selected_dataset` changes, drops `DERIVED_KEYS`
- Models: `PipelineConfig(selected_dataset: str, labeling_budget: int = Field(ge=1, le=100), selected_strategies: list[str])`; `CreatePipeline(name: str, config: PipelineConfig)`; `CopyPipeline(new_name: str)`.
- Endpoints: `GET /api/pipelines` -> `list[str]`; `GET /api/pipelines/suggest-name?dataset=&suffix=` -> `{"name": str}` (dataset must be a listed dataset, suffix `^[A-Za-z0-9]{1,12}$`, else 422/404); `GET /api/pipelines/{name}` -> config dict (404); `POST /api/pipelines` -> 201 `{"name"}` (422 invalid name or unknown dataset, 409 exists); `PUT /api/pipelines/{name}` body `PipelineConfig` -> updated config (404, 422 unknown dataset); `POST /api/pipelines/{name}/copy` -> 201 `{"name": new_name}` (404, 409, 422).

- [ ] **Step 1: Write failing tests** in `api/tests/test_pipelines.py` (`tmp_path` roots, `get_settings` overridden): `test_suggest_name_starts_at_01`; `test_suggest_name_increments_per_dataset_and_suffix` (existing `d-pipeline-01-aaaaaa`, `d-pipeline-02-aaaaaa`, `d-pipeline-07-bbbbbb`, `x-pipeline-09-aaaaaa` -> `d-pipeline-03-aaaaaa`); `test_valid_name` (parametrized good: `a`, `d-pipeline-01-abc123`; bad: `""`, `../x`, `a/b`, `.hidden`, 101 chars); `test_create_then_get_roundtrip`; `test_create_existing_is_409`; `test_create_invalid_name_is_422`; `test_create_unknown_dataset_is_422`; `test_budget_out_of_range_is_422` (0 and 101); `test_update_merges_and_keeps_derived_when_dataset_same`; `test_update_drops_derived_when_dataset_changes`; `test_update_unknown_pipeline_404`; `test_copy_copies_folder_incl_results` (extra file `user_labels.csv` present in the copy); `test_copy_onto_existing_409`; `test_get_traversal_name_404`; `test_list_pipelines`.
- [ ] **Step 2:** Run `venv/bin/python -m pytest api/tests/test_pipelines.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement settings change, `api/pipelines.py`, the router (register `suggest-name` before `{name}`), fix existing test fixtures, wire into `create_app()`.
- [ ] **Step 4:** Run the whole `api/tests` suite. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(api): pipeline endpoints`.

---

### Task 3: Shell, styles and shared components

**Files:**
- Create: `frontend/src/styles/app.css`, `frontend/src/components/{Layout,TopBar,StepTracker,ui}.tsx`, `frontend/src/rooms/useRoomInfo.ts`, tests `frontend/src/components/shell.test.tsx`, `frontend/src/components/ui.test.tsx`
- Modify: `frontend/src/routes.ts` (reorder `PAGES`; add `stepIndex`), `frontend/src/App.tsx` (wrap routes in `Layout`, drop the old nav), `frontend/src/main.tsx` (import css), `frontend/src/session/SessionProvider.tsx` (expose `sid`), `frontend/src/pages/Lobby.tsx` (write `dataset_select`), `frontend/src/pages/Lobby.test.tsx`, `frontend/src/routes.test.tsx`

**Interfaces:**
- `routes.ts`: `PAGES` in the spec's step order (Lobby, Intro, Configurations, Domain Folding, Quality Folding, Labeling, Propagated Errors, Error Detection, Results; paths unchanged except `/propagated-errors` before `/error-detection`); `stepIndex(path: string): number` returns the 0-based index or -1.
- `useSession()` additionally returns `sid: string` (empty string when PocketBase was unreachable).
- `useRoomInfo(service?: RoomService): { roomName: string | null; playerCount: number }` reads `room_name` from the session; when set, loads players and subscribes through `RoomService` for live counts.
- `StepTracker({ currentPath }: { currentPath: string })`: `<nav aria-label="Progress">` with an ordered list of links; the current step has `aria-current="step"`; completed steps have class `done`; text "Step N of 9".
- `TopBar`: product name, then `Room <name> · <n> players` or a link "Join a room" to `/lobby`.
- `Layout`: `TopBar`, `StepTracker` and `<Outlet/>` inside `<main className="page">`.
- `ui.tsx`: `Card({title?, children})`, `Button` (native button with class `btn`, prop `variant?: "primary" | "ghost"`), `Notice({kind: "info" | "warn" | "error", children})` (role `alert` for warn/error), `JobStatus({state, error?})` rendering Running / Failed (with error) / "Job lost, run it again" / nothing for idle and done.
- Lobby: after the room is in phase `labeling`, call `session.update({ dataset_select: room.dataset })` once per dataset change.

- [ ] **Step 1: Write failing tests.** `shell.test.tsx`: `PAGES` order matches the spec (titles array equality); `stepIndex('/configuration') === 2`, `stepIndex('/nope') === -1`; `StepTracker` at `/configuration` renders 9 links, marks exactly one `aria-current="step"`, marks two as `done`, shows "Step 3 of 9"; `TopBar` with no stored room shows the "Join a room" link; with a fake session holding `room_name` and a seeded room/players shows the room name and "2 players". `ui.test.tsx`: `Notice kind="warn"` has role alert; `JobStatus state="lost"` shows the lost text; `JobStatus state="failed" error="boom"` shows boom; `JobStatus state="idle"` renders nothing. Add to `Lobby.test.tsx`: after Start, the session record holds `dataset_select` equal to the winning dataset (read from the fake PocketBase `sessions` rows). Update `routes.test.tsx` to expect the new titles/order.
- [ ] **Step 2:** Run `cd frontend && npx vitest run`. Expected: new tests FAIL.
- [ ] **Step 3:** Implement the files above. CSS: variables for the palette, body background grey and monospace, `.topbar` navy with amber brand, `.steps` as a horizontal list with dots and connecting lines (amber for done, navy ring for current, grey for future), below 640px hide the dots and show "Step N of 9" plus a `<select>` of pages that navigates, `.card` white with radius and amber left border, `.btn` amber/navy, `.notice` variants, `.table-wrap` scrollable table with `td.diff-dirty` / `td.diff-clean` highlight classes.
- [ ] **Step 4:** Re-run `npx vitest run` and `npm run build`. Expected: all pass, build succeeds.
- [ ] **Step 5:** Commit: `feat(frontend): app shell with step tracker, shared components`.

---

### Task 4: Intro page

**Files:**
- Create: `frontend/src/pages/Intro.tsx`, `frontend/src/components/DataTable.tsx`, `frontend/src/pages/Intro.test.tsx`
- Modify: `frontend/src/lib/api.ts` (add table functions), `frontend/src/App.tsx` (route), `frontend/src/lib/schema.d.ts` (regenerated with the API running: `npm run gen:api`)

**Interfaces:**
- Consumes: `useSession()`, endpoints from Task 1, `Notice`, `Card`.
- Produces in `lib/api.ts`: `fetchTables(dataset: string): Promise<string[]>`, `fetchDirtyPage(dataset, table, offset, limit): Promise<TablePage>`, `fetchCompare(dataset, table, offset, limit): Promise<CompareResult>` (types re-exported from the generated schema; non-OK responses throw `Error` with the API `detail`).
- `DataTable({ columns, rows, diff?, highlight?: 'dirty' | 'clean' })` renders a scrollable table; cells where `diff[r][c]` is true get class `diff-dirty` or `diff-clean` according to `highlight`.
- Intro behaviour: no `dataset_select` -> `Notice` warn "No dataset yet. Create or join a room and start it in the Lobby first." plus link to `/lobby`. Otherwise "Dataset: <name> - N table(s)", two tabs "Input tables" (table select, row/column counts, preview page with Previous/Next 100 rows) and "Dirty vs Clean" (table select, three stats: Total cells, Differing cells, Error rate with 2 decimals, side-by-side highlighted tables with paging, notice when `clean.csv` is missing). Footer link/button "Next -> Configurations".

- [ ] **Step 1: Write failing tests** in `Intro.test.tsx` (mock `../lib/api`; seeded fake session): no dataset shows the warning and the Lobby link; tables are listed and the first table's preview shows header and rows with counts; "Next" paging requests `offset=100`; compare tab shows `Total cells`, `Differing cells`, `Error rate 25.00%` for mocked stats and exactly one element with class `diff-dirty` and one with `diff-clean`; compare error (mock rejects with "No clean.csv") shows a warn notice; tables request failing shows an error notice; a dataset with zero tables shows "No tables found in this dataset."
- [ ] **Step 2:** Run `npx vitest run src/pages/Intro.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement `DataTable`, API functions, `Intro` (TanStack Query for each fetch) and the route.
- [ ] **Step 4:** Re-run the whole frontend suite and `npm run build`. Expected: pass.
- [ ] **Step 5:** Commit: `feat(frontend): Intro page`.

---

### Task 5: Configurations page

**Files:**
- Create: `frontend/src/pages/Configurations.tsx`, `frontend/src/configurations/pipelineFlow.ts`, tests `frontend/src/configurations/pipelineFlow.test.ts`, `frontend/src/pages/Configurations.test.tsx`
- Modify: `frontend/src/lib/api.ts`, `frontend/src/App.tsx`, `frontend/src/lib/schema.d.ts` (regenerate)

**Interfaces:**
- Produces in `lib/api.ts`: `fetchStrategies(): Promise<string[]>`, `fetchPipelines(): Promise<string[]>`, `fetchPipeline(name): Promise<PipelineConfigView>`, `suggestPipelineName(dataset, suffix): Promise<string>`, `createPipeline(name, config): Promise<string>`, `updatePipeline(name, config): Promise<void>`, `copyPipeline(name, newName): Promise<string>`, with `PipelineConfigView = { selected_dataset: string; labeling_budget: number; selected_strategies: string[] } & Record<string, unknown>`.
- Produces in `pipelineFlow.ts`:
  - `clampBudget(value: unknown): number` -> integer in 1..100; empty or non-numeric -> 10 (the Streamlit default), `0` -> 1, `101` -> 100, fractions are truncated
  - `ensureSuffix(name: string, suffix: string): string` (no double suffix)
  - `savePipelineChoice(args): Promise<string>` where args = `{ mode: 'new' | 'existing'; name: string; originalName?: string; suffix: string; config: { selected_dataset: string; labeling_budget: number; selected_strategies: string[] }; api: { createPipeline; updatePipeline; copyPipeline } }`. New: `createPipeline(ensureSuffix(name))`. Existing with `name === originalName`: `updatePipeline(originalName)`. Existing with a different name: `copyPipeline(originalName, ensureSuffix(name))` then `updatePipeline(newName)`. Returns the final pipeline name.
- Configurations behaviour: requires nothing but works best with a session dataset. Radio "Create new pipeline" / "Use existing pipeline". Dataset select (from `/api/datasets`, default `dataset_select`). Budget: range slider + number input synchronized via `clampBudget`. Strategies: checkboxes from `/api/strategies`, all checked for a new pipeline; at least one required. New: name input prefilled from `suggestPipelineName(dataset, sid.slice(0, 6))`; warn and disable Next if the name (with suffix) is in `fetchPipelines()`. Existing: select pipeline (loads dataset/budget/strategies into the form) and an optional "Save as" name field (blank or unchanged = overwrite). Buttons: "Back" (to Intro) and "Next". Next calls `savePipelineChoice`, then `session.update({ pipeline_path: finalName, dataset_select, labeling_budget, selected_strategies })`; for a new pipeline first `session.clear()` (keeps room keys) and then update; finally navigates to `/domain-folding`. Errors from the API show as an error notice and keep the user on the page.

- [ ] **Step 1: Write failing tests.** `pipelineFlow.test.ts`: `clampBudget` table (`0->1`, `1->1`, `55->55`, `101->100`, `''->10`, `'abc'->10`, `'7'->7`, `7.9->7`); `ensureSuffix('a','x1') === 'a-x1'`, `ensureSuffix('a-x1','x1') === 'a-x1'`; `savePipelineChoice` new calls create only with suffixed name; existing unchanged calls update only; existing renamed calls copy then update on the new name (call order asserted) and returns the new name; a rejecting `copyPipeline` rejects and `updatePipeline` is not called. `Configurations.test.tsx` (mock `../lib/api`, seeded session with `dataset_select` and a known `sid`): form loads strategies all checked and a suggested name using the session sid's first 6 characters; strategies fetch failure shows an error notice and disables Next; unchecking all strategies disables Next; typing `0` in the budget input results in `1`, `101` results in `100`; an existing name from `fetchPipelines()` shows the warning and disables Next; choosing an existing pipeline fills dataset/budget/strategies from `fetchPipeline`; clicking Next on a new pipeline calls `createPipeline` once with the suffixed name, writes `pipeline_path` and `labeling_budget` to the session record, and navigates to `/domain-folding` (assert through a `MemoryRouter` route showing the Domain Folding placeholder title).
- [ ] **Step 2:** Run `npx vitest run src/configurations src/pages/Configurations.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement the API functions, `pipelineFlow.ts`, the page and the route; regenerate `schema.d.ts` with the API running.
- [ ] **Step 4:** Run the whole frontend suite and `npm run build`. Expected: pass.
- [ ] **Step 5:** Commit: `feat(frontend): Configurations page`.

---

### Task 6: Batch acceptance

**Files:** none; findings reported to the owner.

- [ ] **Step 1:** Run `venv/bin/python -m pytest api/tests -q`, `cd frontend && npx vitest run` and `npm run build`; record the results. Expected: all pass.
- [ ] **Step 2:** Start `scripts/dev.sh` and, through the Vite proxy on port 5173, request (read-only): `/api/datasets/BIFOLD_Demo/tables`, `/api/datasets/BIFOLD_Demo/tables/<first table>/dirty?limit=3`, `/api/datasets/BIFOLD_Demo/tables/<first table>/compare?limit=3` and `/api/pipelines`, `/api/pipelines/suggest-name?dataset=BIFOLD_Demo&suffix=abc123`; check the responses are shaped as specified and that `/api/datasets/BIFOLD_Demo/tables/..%2F..` is a 404. Do not create pipelines in the real `pipelines/` folder during this check. Stop the script and confirm no stray processes.
- [ ] **Step 3:** State plainly which spec behaviours were verified by automated tests and which (rendering in a real browser) were not.
