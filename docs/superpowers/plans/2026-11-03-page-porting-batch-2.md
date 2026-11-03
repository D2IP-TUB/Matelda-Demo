# Page Porting, Batch 2 (Domain Folding, Quality Folding) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Domain Based Folding and Quality Based Folding pages to React. The API runs the folding as per-pipeline background jobs and owns all edits to cell folds; the browser edits the (small) domain folds locally.

**Architecture:** New pipeline-scoped endpoints call the existing `services.backend_dbf` / `backend_qbf`, store results in `pipelines/<name>/configurations.json`, and expose summaries/pages/edit operations for cell folds. React pages use TanStack Query and `useJob`.

**Tech Stack:** As Batch 1.

**Spec:** `docs/superpowers/specs/2026-11-03-page-porting-design.md` (section "Batch 2 behaviour")

## Global Constraints

- `backend/`, `Matelda/` and the Streamlit app are not edited. `backend_dbf` / `backend_qbf` run from the repo root (relative `datasets/` paths), which is how `scripts/dev.sh` and the tests start the API.
- `configurations.json` keys stay: `domain_folds` (`{fold: [tables]}`), `cell_folds` (`{domain: {cell_fold: [cell]}}`), `cell_fold_labels` (`{cell_fold: "correct" | "false"}`, no entry = neutral), plus the Batch 1 keys. A cell is `{table, row, col, val, features, strategies, selected_for_labeling, assigned_budget}`.
- Cell fold names are unique across domains (they start with the domain name), so folds are addressed by name alone.
- A cell is identified by `(table, row, col)`.
- Whenever `domain_folds` change (run or save with different content) remove `cell_folds`, `cell_fold_labels` and `results`; whenever `cell_folds` are re-run remove `cell_fold_labels` and `results`.
- The browser never receives `features`, and never receives all cells of the dataset at once (pages of at most 200 cells).
- Config file read-modify-write goes through one locked helper so concurrent requests cannot interleave.
- Test commands: `venv/bin/python -m pytest api/tests -q`; `cd frontend && npx vitest run`; `cd frontend && npm run build`.

## Review Focus

1. Unknown pipeline, unknown fold name, a cell not in the fold, a merge with fewer than two folds or a split with no cells: 404/422, never a 500 and never a half-applied change. (Tasks 1, 3)
2. Saving domain folds that list a table twice, an unknown table, or an empty fold name: 422; saving unchanged folds does not delete cell folds. (Task 1)
3. Merge label rules and moving the last cell out of a fold (the fold, its label and an empty domain disappear). (Task 3)
4. Quality folding requested before domain folds exist: 409 with a message; a backend that raises or returns `{}` marks the job failed instead of saving empty folds. (Task 2)
5. Pages opened without a pipeline, or with a pipeline that has no folds yet: a notice and a link, no crash; a job that is lost shows the lost message. (Tasks 5, 6)

---

## File Structure

```
api/pipelines.py                 modify: update_config (locked), numpy-safe save
api/folds.py                     new: domain-fold validation/apply, cell-fold pure operations
api/routes/folding.py            new: per-pipeline folding jobs, domain-folds save, cell-fold endpoints
api/tests/test_folds.py          new: pure operation tests
api/tests/test_folding_routes.py new
frontend/src/folds/domainOps.ts  new: pure domain fold operations
frontend/src/components/forms.tsx  new: BudgetField, StrategyChecklist (extracted from Configurations)
frontend/src/pages/DomainFolding.tsx, QualityFolding.tsx  new
frontend/src/lib/api.ts          modify
```

---

### Task 1: Locked config updates and domain folds save

**Files:**
- Modify: `api/pipelines.py`
- Create: `api/folds.py`, `api/routes/folding.py`, `api/tests/test_folds.py`, `api/tests/test_folding_routes.py`
- Modify: `api/main.py`

**Interfaces:**
- Produces in `api/pipelines.py`: `update_config(pipeline_dir: Path, fn: Callable[[dict], dict]) -> dict` (holds a module-level `threading.Lock`; loads, applies, saves, returns the new config); `save_config` serialises numpy/pandas scalars and arrays (`default=` handler converting `np.generic` via `.item()` and `np.ndarray` via `.tolist()`).
- Produces in `api/folds.py`:
  - `validate_domain_folds(folds: dict[str, list[str]], known_tables: list[str]) -> None` raising `ValueError` for empty fold names, empty folds, a table listed twice, or an unknown table
  - `apply_domain_folds(config: dict, folds: dict[str, list[str]]) -> dict` sets `domain_folds`; if it differs from the stored value removes `cell_folds`, `cell_fold_labels`, `results`
- Endpoint: `PUT /api/pipelines/{name}/domain-folds` body `{"domain_folds": {fold: [table]}}` -> the saved `domain_folds`; 404 unknown pipeline; 422 invalid folds or a pipeline without a dataset. Known tables come from `list_tables(datasets_dir / config["selected_dataset"])`.

- [ ] **Step 1: Write failing tests.** `test_folds.py`: `validate_domain_folds` accepts valid folds; rejects duplicate table, unknown table, empty fold name, empty list; `apply_domain_folds` with identical folds keeps `cell_folds`/`cell_fold_labels`/`results`; with different folds removes all three and keeps the Batch 1 keys; `update_config` serialises a numpy int/float/array without error and two threads incrementing a counter 50 times each end at 100. `test_folding_routes.py` (tmp datasets with tables `t1`, `t2`, `t3` and a pipeline `p1` seeded with `cell_folds`): `test_save_domain_folds_roundtrip`; `test_save_same_folds_keeps_cell_folds`; `test_save_changed_folds_drops_cell_folds`; `test_save_invalid_folds_422` (duplicate, unknown table, empty name); `test_save_unknown_pipeline_404`.
- [ ] **Step 2:** Run the two files. Expected: FAIL.
- [ ] **Step 3:** Implement and wire the router into `create_app()`.
- [ ] **Step 4:** Run `api/tests`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(api): locked config updates and domain folds save`.

---

### Task 2: Per-pipeline folding jobs

**Files:**
- Modify: `api/routes/folding.py`, `api/tests/test_folding_routes.py`

**Interfaces:**
- Consumes: `JobStore`, `get_job_store`, `services.backend_dbf`, `services.backend_qbf`, `update_config`, `apply_domain_folds`.
- Produces in `api/folds.py`: `summarize_cell_folds(cell_folds: dict, labels: dict[str, str]) -> list[DomainSummary]` is Task 3; this task only needs `cell_fold_count(cell_folds) -> int`.
- Endpoints (all return `{"job_id": str}`; job results are small):
  - `POST /api/pipelines/{name}/domain-folding` (no body): job runs `services.backend_dbf(config["selected_dataset"], config["labeling_budget"])`, saves via `apply_domain_folds`, result `{"domain_folds": {...}}`. A result with empty `domain_folds` fails the job with "Domain folding produced no folds".
  - `POST /api/pipelines/{name}/quality-folding` body `{"labeling_budget": int | None, "selected_strategies": list[str] | None}` (budget 1..100): 409 if the pipeline has no `domain_folds`; stores given budget/strategies in the config, job runs `services.backend_qbf(dataset, budget, domain_folds, strategies)`, an empty result `{}` fails the job with "Quality folding produced no cell folds", otherwise saves `cell_folds`, removes `cell_fold_labels` and `results`, result `{"cell_fold_count": int, "domain_count": int}`.
- 404 unknown pipeline for both.

- [ ] **Step 1: Write failing tests** (monkeypatched `services`, poll `/api/jobs/{id}`): `test_domain_folding_job_saves_folds` (config gains `domain_folds`, uses the config's dataset and budget); `test_domain_folding_rerun_drops_stale_derived`; `test_domain_folding_empty_result_fails_job_and_keeps_old_folds`; `test_quality_folding_requires_domain_folds_409`; `test_quality_folding_saves_cell_folds_budget_and_strategies`; `test_quality_folding_empty_result_fails_job`; `test_quality_folding_backend_error_fails_job`; `test_folding_unknown_pipeline_404`; `test_quality_budget_out_of_range_422`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `api/tests`. Expected: all pass.
- [ ] **Step 5 (slow smoke):** add `test_real_folding_on_demo_dataset` marked `slow` that copies nothing from the real `pipelines/`: it overrides `get_settings` with a tmp `pipelines_dir`, creates a pipeline for `BIFOLD_Demo` (budget 10, strategies `["Typo Detector"]`), runs domain folding then quality folding through the API, and asserts both jobs `done` and `cell_fold_count > 0`. Run `venv/bin/python -m pytest api/tests -m slow -q -s` (timeout 600 s). Expected: PASS; if quality folding is too slow or fails inside `backend/`, report the output rather than altering `backend/`.
- [ ] **Step 6:** Commit: `feat(api): per-pipeline folding jobs`.

---

### Task 3: Cell fold operations and endpoints

**Files:**
- Modify: `api/folds.py`, `api/routes/folding.py`
- Modify: `api/tests/test_folds.py`, `api/tests/test_folding_routes.py`

**Interfaces:**
- Produces in `api/folds.py` (pure functions on dicts; they mutate nothing and return new structures, raising `ValueError` with a message for invalid requests):
  - `CellRef(BaseModel)`: `table: str`, `row: int`, `col: str`
  - `class FoldSummary(BaseModel)`: `name: str`, `domain: str`, `cell_count: int`, `label: Literal["correct", "false", "neutral"]`, `tables: dict[str, dict[str, int]]` (table -> column -> cell count)
  - `class CellView(BaseModel)`: `table`, `row`, `col`, `val` (any), `strategies: list[str]`, `selected_for_labeling: bool`
  - `summarize(cell_folds, labels) -> list[FoldSummary]` in stored order
  - `fold_cells(cell_folds, fold: str, offset: int, limit: int) -> tuple[list[CellView], int]` (cells without `features`, plus total)
  - `move_cell(cell_folds, labels, cell: CellRef, to_fold: str) -> tuple[dict, dict]` (removes the source fold, its label and an emptied domain when it becomes empty)
  - `merge_folds(cell_folds, labels, folds: list[str]) -> tuple[dict, dict]`: needs >= 2 distinct existing folds; the first is the target; the source folds' cells are appended and the sources removed; label rule: both `correct` and `false` present -> no label (neutral); otherwise `false` if any false; otherwise `correct` if any correct; otherwise none; source labels are removed
  - `split_fold(cell_folds, labels, fold: str, after: list[CellRef]) -> tuple[dict, dict]`: needs >= 1 cell that is in the fold; splits after each selected cell (by position), segments named `<fold> - Split N` (N from 1) in the same domain; the original fold and its label are removed and the label is copied to every segment; when the last cell is selected there is no empty trailing segment
  - `set_label(labels, fold, label: Literal["correct","false"] | None) -> dict`
- Endpoints (all 404 for unknown pipeline or fold, 409 when the pipeline has no `cell_folds`, 422 for `ValueError`; each mutating endpoint applies its operation through `update_config` and returns the new `list[FoldSummary]`):
  - `GET /api/pipelines/{name}/cell-folds` -> `list[FoldSummary]`
  - `GET /api/pipelines/{name}/cell-folds/cells?fold=&offset=0&limit=20` -> `{"cells": list[CellView], "total": int}` (limit 1..200)
  - `POST /api/pipelines/{name}/cell-folds/move` body `{cell: CellRef, to_fold: str}`
  - `POST /api/pipelines/{name}/cell-folds/merge` body `{folds: list[str]}`
  - `POST /api/pipelines/{name}/cell-folds/split` body `{fold: str, after: list[CellRef]}`
  - `PUT /api/pipelines/{name}/cell-folds/label` body `{fold: str, label: "correct" | "false" | null}`

- [ ] **Step 1: Write failing tests** with a small fixture of two domains (`D0` folds `D0 / Cell Fold 0` (3 cells, with `features`), `D0 / Cell Fold 1` (2 cells); `D1` fold `D1 / Cell Fold 0` (1 cell)): `test_summarize_counts_tables_and_labels`; `test_fold_cells_strips_features_and_pages`; `test_move_cell_between_folds`; `test_move_last_cell_removes_fold_label_and_empty_domain`; `test_move_unknown_cell_or_fold_raises`; `test_merge_label_rules` (parametrized: correct+false -> none; correct+neutral -> correct; false+neutral -> false; neutral+neutral -> none; correct+correct -> correct); `test_merge_moves_cells_into_first_fold_across_domains`; `test_merge_needs_two_distinct_folds`; `test_split_after_selected_cells_names_segments_and_copies_label`; `test_split_selecting_last_cell_makes_no_empty_segment`; `test_split_without_cells_or_with_foreign_cell_raises`; `test_set_label_and_clear`; operations do not mutate their inputs. Route tests for each endpoint incl. 404 unknown fold, 409 without cell folds, 422 merge with one fold, `limit=201` 422, and that the saved JSON on disk equals the returned summary's counts.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement operations and endpoints.
- [ ] **Step 4:** Run `api/tests`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(api): cell fold summary, paging and edit operations`.

---

### Task 4: Frontend API functions, domain operations, shared form controls

**Files:**
- Create: `frontend/src/folds/domainOps.ts`, `frontend/src/folds/domainOps.test.ts`, `frontend/src/components/forms.tsx`
- Modify: `frontend/src/lib/api.ts`, `frontend/src/lib/schema.d.ts` (regenerate with the API running), `frontend/src/pages/Configurations.tsx` (use the shared controls)

**Interfaces:**
- `domainOps.ts` (pure, immutable; a "location map" is `Record<table, fold>`):
  - `toLocations(folds: Record<string, string[]>): Record<string, string>`; `toFolds(locations): Record<string, string[]>` (fold order = first appearance, table order preserved)
  - `moveTable(folds, table, toFold): Record<string, string[]>` (unknown target creates nothing: returns folds unchanged)
  - `mergeFolds(folds, selected: string[]): Record<string, string[]>` (needs >= 2 selected; the first becomes the target; tables keep order)
  - `splitFolds(folds, selectedTables: Record<string, string[]>): Record<string, string[]>` (per fold, splits after every selected table; segments named `<fold> - Split N`, N from 1; selecting only the last table changes nothing; folds without selection untouched)
- `forms.tsx`: `BudgetField({ value, onChange })` (slider + number input labelled "Labeling budget", using `clampBudget`) and `StrategyChecklist({ strategies, selected, onChange, error })` (checkboxes, error notice, "Select at least one strategy." warning). Configurations is changed to use them without changing its tests' expectations.
- `lib/api.ts` additions (types from the generated schema): `fetchPipelineFull` is not needed (`fetchPipeline` exists); add `saveDomainFolds(name, folds)`, `startDomainFolding(name)`, `startQualityFolding(name, body)`, `fetchCellFolds(name): Promise<FoldSummary[]>`, `fetchFoldCells(name, fold, offset, limit): Promise<{cells: CellView[]; total: number}>`, `moveCell(name, cell, toFold)`, `mergeCellFolds(name, folds)`, `splitCellFold(name, fold, after)`, `setFoldLabel(name, fold, label)`. The existing `startDomainFolding(dataset, budget)` is renamed `startDatasetDomainFolding` (only `DevPlayground` uses it).

- [ ] **Step 1: Write failing tests** in `domainOps.test.ts`: `toLocations`/`toFolds` roundtrip; `moveTable` moves and drops an emptied fold; `moveTable` to an unknown fold is a no-op; `mergeFolds` of three folds puts everything into the first and keeps table order; `mergeFolds` with one selected is a no-op; `splitFolds` after the middle table of a 3-table fold gives `<fold> - Split 1` (first two tables) and `<fold> - Split 2` (last); selecting the last table only is a no-op; operations do not mutate their input.
- [ ] **Step 2:** Run `npx vitest run src/folds`. Expected: FAIL.
- [ ] **Step 3:** Implement `domainOps.ts`, the API functions, extract the controls, update `DevPlayground`, regenerate `schema.d.ts`.
- [ ] **Step 4:** Run the whole frontend suite and `npm run build`. Expected: pass (Configurations tests unchanged and green).
- [ ] **Step 5:** Commit: `feat(frontend): domain fold operations, folding API client, shared form controls`.

---

### Task 5: Domain Folding page

**Files:**
- Create: `frontend/src/pages/DomainFolding.tsx`, `frontend/src/pages/DomainFolding.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `useSession` (`pipeline_path`), `fetchPipeline`, `startDomainFolding`, `saveDomainFolds`, `useJob`, `JobStatus`, `fetchDirtyPage`, `domainOps`.
- Behaviour: no `pipeline_path` -> warn notice "Pipeline not configured." with a link to `/configuration`. Loads the pipeline config; `domain_folds` become the editable local state (empty state hint when absent). "Run domain based folding" calls `startDomainFolding(name)`, shows `JobStatus`, and on `done` reloads the config and resets local edits. The fold list shows fold name and its tables; each table has a `<details>` that loads `fetchDirtyPage(dataset, table, 0, 20)` when opened and a "Move <table> to" select. Buttons "Merge folds" (shows fold checkboxes and a "Confirm merge" button enabled with >= 2 selected) and "Split folds" (shows table checkboxes and "Confirm split" enabled with >= 1 selected); confirming applies `mergeFolds`/`splitFolds` locally and leaves the mode. "Save" and "Next -> Quality Folding" persist with `saveDomainFolds`; Next then navigates to `/quality-folding`; a save error stays on the page with an error notice. "Back" links to `/configuration`.

- [ ] **Step 1: Write failing tests** (mock `../lib/api`, seeded session with `pipeline_path: "p1"`): no pipeline shows the warning and link; existing folds are listed with their tables; Run calls `startDomainFolding("p1")`, polls the job (mock `fetchJob`), and reloads folds when done; a failed job shows its error; moving a table via its select changes the list; merge mode needs two selected folds and then combines them (list shows one fold with all tables); split mode splits a fold after the selected table; opening a table's details requests `fetchDirtyPage("demo", table, 0, 20)` exactly once; Next calls `saveDomainFolds` with the edited folds and navigates to the Quality Folding route; a rejected save shows the error and stays.
- [ ] **Step 2:** Run `npx vitest run src/pages/DomainFolding.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement the page and route.
- [ ] **Step 4:** Run the whole suite and `npm run build`. Expected: pass.
- [ ] **Step 5:** Commit: `feat(frontend): Domain Folding page`.

---

### Task 6: Quality Folding page

**Files:**
- Create: `frontend/src/pages/QualityFolding.tsx`, `frontend/src/pages/QualityFolding.test.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/styles/app.css` (fold label colours, dialog)

**Interfaces:**
- Consumes: Task 4 API functions, `BudgetField`, `StrategyChecklist`, `fetchStrategies`, `useJob`, `JobStatus`, `DataTable`, `fetchDirtyPage`.
- Behaviour: no `pipeline_path` -> warn + link to Configurations. Pipeline without `domain_folds` -> warn + link to Domain Folding. Budget and strategies start from the pipeline config and are editable; "Run quality based folding" calls `startQualityFolding(name, {labeling_budget, selected_strategies})` (disabled with no strategy), shows `JobStatus`, and on `done` invalidates the cell-fold queries. Fold list from `fetchCellFolds`: grouped by domain heading; each fold shows name (green text for `correct`, red for `false`), cell count, and Show/Hide. Shown folds list tables and columns with counts and load cells with `fetchFoldCells(name, fold, offset, 20)` per fold (a "Show more" button adds the next 20). Clicking a cell opens a `<dialog>` (role `dialog`) with table, column, row, the cell's `strategies` (or "This cell passed all error detection checks"), a table excerpt `fetchDirtyPage(dataset, table, max(0,row-5), 11)` with the cell highlighted (class `diff-dirty`), and a select to move the cell to another fold (calls `moveCell`, closes, refreshes). Action buttons: Merge (fold checkboxes; "Confirm merge" enabled with >= 2; calls `mergeCellFolds`), Split (cell checkboxes inside one fold; "Confirm split" calls `splitCellFold(fold, selected)`), Bulk annotate (each fold gets "✓"/"✗" buttons and a "Clear" button calling `setFoldLabel`). API errors show an error notice. "Back" -> `/domain-folding`; "Next -> Labeling" -> `/labeling`.

- [ ] **Step 1: Write failing tests** (mocked API; two domains, three folds; seeded session): no pipeline and no domain folds warnings with links; folds and counts rendered, `correct` fold has class `label-correct`; Run sends the edited budget and strategies and refreshes folds on job done; Run is disabled with no strategies; Show loads the first 20 cells and "Show more" requests offset 20; clicking a cell opens the dialog with strategies and, for a cell without strategies, the "passed all" text, and requests the excerpt with offset `max(0,row-5)`; moving a cell calls `moveCell` with the right arguments and closes the dialog; merge needs two folds, then calls `mergeCellFolds` with them in selection order; split calls `splitCellFold` with the selected cells; bulk annotate buttons call `setFoldLabel` with `correct`, `false` and `null`; a rejected operation shows its message.
- [ ] **Step 2:** Run `npx vitest run src/pages/QualityFolding.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement the page and route.
- [ ] **Step 4:** Run the whole suite and `npm run build`. Expected: pass.
- [ ] **Step 5:** Commit: `feat(frontend): Quality Folding page`.

---

### Task 7: Batch acceptance

**Files:** none; findings reported to the owner.

- [ ] **Step 1:** Run `venv/bin/python -m pytest api/tests -q`, the slow smoke test from Task 2, `cd frontend && npx vitest run` and `npm run build`; record the results.
- [ ] **Step 2:** With `scripts/dev.sh` running, use a temporary pipeline created through the API under a unique name (`accept-<timestamp>`) for `BIFOLD_Demo`: run domain folding and quality folding through the Vite proxy and poll both jobs; GET the cell-fold summary and one page of cells (check no `features` key); merge two folds, split one, move one cell, set and clear a label, and check the summary counts add up to the total before and after each step; save modified domain folds and confirm `cell_folds` disappear. Then delete exactly that temporary pipeline folder (`pipelines/accept-<timestamp>`) and nothing else; stop the script and confirm no stray processes.
- [ ] **Step 3:** State plainly which behaviours were verified by automated tests, which by the live API run, and that rendering in a real browser was not checked.
