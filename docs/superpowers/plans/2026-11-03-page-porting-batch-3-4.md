# Page Porting, Batches 3 and 4 (Labeling, Propagated Errors, Error Detection, Results) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Labeling (swipe cards, multiplayer claims), Propagated Errors, Error Detection and Results pages, with the API running label propagation and error detection as per-pipeline background jobs.

**Architecture:** `api/backend_state.py` lets the API call the Streamlit-era `backend_*` functions with explicit pipeline state. New API modules hold the pure labeling logic (candidates, cards, judging, room merge) and read endpoints; React pages use TanStack Query, `useJob`, the session and the room service (PocketBase claims/labels/runs).

**Tech Stack:** As Batches 1 and 2.

**Spec:** `docs/superpowers/specs/2026-11-03-page-porting-design.md` (sections "Batch 2 behaviour" and "Batch 3 and 4 behaviour")

## Global Constraints

- `Matelda/` and the Streamlit app are not edited; `backend/` is not edited (state is supplied through the shim).
- Cells are identified by `table|row|col` (`cell_key`), as in `components/room_labeling.py`; PocketBase `claims.cell_id` and `labels.cell_id` use that key.
- Ground truth (`clean.csv`) never leaves the server except through the label-accuracy endpoints that the user triggers explicitly.
- Pipeline config keys added: `propagation_results` (backend output), `error_detection` (`{time, metrics:{precision,recall,f1}, propagated_errors:{table:[{row,col,val,confidence,source}]}}`). `user_labels.csv` is written into the pipeline folder. Re-running folding already removes `results` (Batch 2); also remove `propagation_results` and `error_detection` wherever `cell_folds`/`results` are removed (`STALE_AFTER_QUALITY_FOLDS`, `STALE_AFTER_DOMAIN_FOLDS`).
- A job that returns an empty/failed backend result fails with a clear message and leaves the previously stored results untouched.
- Endpoints that return lists are paged (`limit` 1..200; labeling cards by explicit key lists of at most 500).
- Test commands: `venv/bin/python -m pytest api/tests -q`; `cd frontend && npx vitest run`; `cd frontend && npm run build`.

## Review Focus

1. Two players claiming the same cell at the same time never both get it; a reload keeps a player's claims; a player whose budget exceeds the available cells gets what exists. (Task 6, 7)
2. Disputed (50/50) cells are left out of propagation; other players' labels for cells missing from this player's folds are dropped; a room label from the same player is not double counted. (Task 3)
3. Swiping the same card twice overwrites the verdict; unswiped cards are not sent as labeled; all folds bulk-annotated means zero cards and Next still works. (Task 7)
4. Propagation/error detection requested without the previous step's data: 409 with a message, and the pages show a notice with a link; a backend that raises or returns nothing fails the job without overwriting old results. (Tasks 3, 4, 8, 9)
5. The ground-truth endpoints and the judge endpoint reject unknown datasets/tables and never return a 500 for missing `clean.csv` or out-of-range rows. (Tasks 2, 5)

---

## File Structure

```
api/backend_state.py             new: streamlit.session_state shim (lock-guarded)
api/services.py                  modify: sample_labeling, label_propagation, pull_errors wrappers
api/labeling.py                  new: cards, candidates, judge, room merge (pure)
api/results.py                   new: results summary, comparison, Raha baseline, label accuracy
api/routes/labeling.py           new: sample/candidates/cards/judge/propagate/propagation endpoints
api/routes/detection.py          new: error-detection endpoints
api/routes/results.py            new: results endpoints
frontend/src/rooms/roomService.ts  modify: claimCells, saveLabel, roomLabels, getPlayer, saveRun, playerStats
frontend/src/components/SwipeCard.tsx  new
frontend/src/pages/Labeling.tsx, PropagatedErrors.tsx, ErrorDetection.tsx, Results.tsx  new
```

---

### Task 1: Backend state shim and service wrappers

**Files:**
- Create: `api/backend_state.py`, `api/tests/test_backend_state.py`
- Modify: `api/services.py`, `api/folds.py` (extend the stale-key tuples)

**Interfaces:**
- Produces in `api/backend_state.py`: `backend_state(**state) -> ContextManager[None]`. While active, `streamlit.session_state` supports `"key" in st.session_state`, `st.session_state.key`, `st.session_state["key"]` and assignment, backed by a dict initialised with `state`. A module `threading.RLock` serialises users; the original `streamlit.session_state` is restored on exit, also after an exception.
- Produces in `api/services.py` (lazy imports of `backend`, each wrapped in `backend_state`):
  - `sample_labeling(dataset: str, budget: int, cell_folds: dict, domain_folds: dict, pipeline_dir: str) -> list[dict]` -> `backend.backend_sample_labeling(...)` with `pipeline_path=pipeline_dir`
  - `label_propagation(dataset: str, labeled_cells: list[dict], cell_folds: dict, pipeline_dir: str) -> dict` -> `backend.backend_label_propagation(...)` with `pipeline_path`, `cell_folds`
  - `pull_errors(dataset: str, propagation_results: dict, pipeline_dir: str) -> dict` -> `backend.backend_pull_errors(dataset)` with `pipeline_path`, `propagation_results`
- `api/folds.py`: add `"propagation_results"`, `"error_detection"` to `STALE_AFTER_QUALITY_FOLDS` and `STALE_AFTER_DOMAIN_FOLDS`.

- [ ] **Step 1: Write failing tests** in `test_backend_state.py`: state visible inside via `in`, attribute and item access, and assignment inside does not leak out; the original object is restored after normal exit and after an exception; two threads each entering the context with different state never see each other's (thread A sleeps inside while B waits; assert B sees only its own); the three service wrappers, with a fake `backend` module injected into `sys.modules` whose functions return what they read from `st.session_state` (`pipeline_path`, `cell_folds`, `propagation_results`) plus their arguments, return the expected values and leave `streamlit.session_state` restored.
- [ ] **Step 2:** Run `venv/bin/python -m pytest api/tests/test_backend_state.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement. Existing tests in `test_folding_routes.py` that assert the removed keys must still pass (extend them if needed with the two new keys).
- [ ] **Step 4:** Run `api/tests`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(api): backend state shim and service wrappers`.

---

### Task 2: Labeling cards, candidates and judging

**Files:**
- Create: `api/labeling.py`, `api/routes/labeling.py`, `api/tests/test_labeling.py`, `api/tests/test_labeling_routes.py`
- Modify: `api/main.py`

**Interfaces:**
- Produces in `api/labeling.py`:
  - `cell_key(table: str, row: int, col: str) -> str` (`"table|row|col"`), `parse_cell_key(key: str) -> tuple[str, int, str]` (raises `ValueError` on a malformed key)
  - `class Card(BaseModel)`: `key`, `table`, `row: int`, `col`, `val: Any`, `domain_fold`, `cell_fold`, `strategies: list[str]`
  - `sampled_to_cards(sampled: list[dict]) -> list[Card]` (backend sample dicts have `table,row,col,val,domain_fold,cell_fold,strategies`)
  - `candidate_keys(sampled: list[dict], cell_folds: dict, skip_folds: set[str]) -> list[str]`: the sampled keys first, then the remaining cells of the non-skipped folds round-robin across folds (same ordering as `extend_candidates` in `components/room_labeling.py`), no duplicates
  - `cards_for_keys(cell_folds: dict, keys: list[str]) -> list[Card]` in key order, unknown or malformed keys skipped
  - `class Verdict(BaseModel)`: `table`, `row: int`, `col`, `said_correct: bool`
  - `judge(dataset_dir: Path, verdicts: list[Verdict]) -> list[bool | None]`: `None` when the table has no readable `clean.csv`/`dirty.csv` or the row/column is out of range; otherwise `(not said_correct) == (dirty != clean)` using string comparison
- Endpoints:
  - `GET /api/pipelines/{name}/labeling/sample` -> `{"cards": list[Card], "bulk_annotated_folds": int}`; budget from the config; runs `services.sample_labeling` (409 without `cell_folds`; 404 unknown pipeline); an empty sampler result with some non-bulk folds present is returned as zero cards
  - `GET /api/pipelines/{name}/labeling/candidates` -> `{"keys": list[str], "sample_size": int}` (`sample_size` = number of sampler cards); skip folds = keys of `cell_fold_labels`
  - `POST /api/pipelines/{name}/labeling/cards` body `{"keys": list[str]}` (max 500, else 422) -> `list[Card]`
  - `POST /api/datasets/{dataset}/judge` body `{"verdicts": list[Verdict]}` (max 500, else 422; dataset validated with `require_dataset`) -> `{"correct": list[bool | None]}`

- [ ] **Step 1: Write failing tests.** `test_labeling.py` (pure): `cell_key`/`parse_cell_key` roundtrip incl. a column containing `|`; malformed key raises; `sampled_to_cards`; `candidate_keys` order (sampled first, then round-robin across two folds of different sizes, skipped fold excluded, no duplicates); `cards_for_keys` keeps order and skips unknown; `judge` truth table (said_correct on a clean cell -> True; said_correct on a dirty cell -> False; said_error on a dirty cell -> True; said_error on a clean cell -> False), `None` for missing clean.csv, out-of-range row and unknown column. `test_labeling_routes.py` (monkeypatched `services.sample_labeling`, tmp datasets/pipeline): sample endpoint returns cards and counts bulk folds and passes the pipeline dir; 409 without cell folds; candidates endpoint ordering and `sample_size`; cards endpoint with 501 keys 422; judge endpoint for known/unknown dataset and out-of-range rows (no 500).
- [ ] **Step 2:** Run both files. Expected: FAIL.
- [ ] **Step 3:** Implement and wire into `create_app()`.
- [ ] **Step 4:** Run `api/tests`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(api): labeling cards, candidates and judging`.

---

### Task 3: Room merge, propagation job and propagation results

**Files:**
- Modify: `api/labeling.py`, `api/routes/labeling.py`, `api/tests/test_labeling.py`, `api/tests/test_labeling_routes.py`

**Interfaces:**
- Produces in `api/labeling.py`:
  - `class LabeledCell(BaseModel)`: `table`, `row: int`, `col`, `val: Any = ""`, `is_error: bool`, `domain_fold: str = ""`, `cell_fold: str = ""`
  - `class RoomLabel(BaseModel)`: `cell_id: str`, `player: str`, `value: bool` (`value` = the player said "correct")
  - `merge_with_pool(own: list[dict], room_labels: list[dict], player_id: str | None, cell_folds: dict) -> tuple[list[dict], list[str]]`: port of `components/room_labeling.merge_with_pool`: own cells vote with `is_error`; labels of other players vote `not value` and are mapped onto this player's folds (unknown keys dropped); the player's own room labels for cells already in `own` are ignored; per cell the majority wins, an exact tie is disputed (left out, key returned)
- Endpoints:
  - `POST /api/pipelines/{name}/labeling/propagate` body `{"own": list[LabeledCell], "room_labels": list[RoomLabel] = [], "player_id": str | None = None}` -> `{"job_id"}`. 404 unknown pipeline, 409 without `cell_folds`. The job merges (only when `player_id` is set), writes `user_labels.csv` (columns `table,is_error,row,col,val,domain_fold,cell_fold`) into the pipeline folder, calls `services.label_propagation(dataset, labeled, cell_folds, pipeline_dir)`, fails with "Propagation produced no labeled cells" when the result has none (old `propagation_results` stay), otherwise stores `propagation_results` (and removes `error_detection`) and returns `{"labeled_count", "propagated_count", "disputed"}`. The `cell_fold_label` key is added to each labeled cell from `cell_fold_labels` (`neutral` when absent).
  - `GET /api/pipelines/{name}/propagation?offset=0&limit=20` -> `{"total": int, "propagated_total": int, "labeled_cells": list[dict]}` (the stored labeled cells slice, each with its `propagated_cells`); 409 "Run label propagation first" when none.

- [ ] **Step 1: Write failing tests.** `merge_with_pool`: own only -> unchanged; majority across three players; 1-1 tie is disputed and absent from the merged list; other player's label for a key missing from the folds is dropped; own room label ignored for a cell already in `own`; other player's label creates a cell with domain/fold/val taken from the folds. Route tests (monkeypatched `services.label_propagation`): job saves `propagation_results` and removes `error_detection`; `user_labels.csv` content; room merge applied when `player_id` given and result lists `disputed`; empty backend result fails the job and keeps old results; propagation GET paging and 409; unknown pipeline 404; `cell_fold_label` passed from `cell_fold_labels`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `api/tests`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(api): room label merge, propagation job and results`.

---

### Task 4: Error detection endpoints

**Files:**
- Create: `api/routes/detection.py`, `api/tests/test_detection_routes.py`
- Modify: `api/main.py`

**Interfaces:**
- Endpoints:
  - `POST /api/pipelines/{name}/error-detection` -> `{"job_id"}`; 404 unknown pipeline, 409 "Run label propagation first" without `propagation_results`. The job calls `services.pull_errors(dataset, propagation_results, pipeline_dir)`; fails with "Error detection produced no result" when `propagated_errors` is empty (stored `error_detection` stays); otherwise stores `error_detection = {"time": "YYYY-MM-DD HH:MM:SS", "metrics": {"precision","recall","f1"}, "propagated_errors": ...}` and returns `{"time", "metrics", "tables": {table: error_count}}`.
  - `GET /api/pipelines/{name}/error-detection` -> `{"time", "metrics", "tables"}`; 404 when none.
  - `GET /api/pipelines/{name}/error-detection/errors?table=&offset=0&limit=100` -> `{"errors": list[{row, col, val, confidence, source}], "total": int}` (limit 1..200; unknown table -> empty list with total 0).

- [ ] **Step 1: Write failing tests** (monkeypatched `services.pull_errors`, tmp pipeline seeded with `propagation_results`): job stores `error_detection` with metrics and per-table counts; empty result fails and keeps the old one; 409 without propagation results; GET summary and 404; errors paging and unknown table; `limit=201` 422.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement and wire in.
- [ ] **Step 4:** Run `api/tests`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(api): error detection job and result endpoints`.

---

### Task 5: Results endpoints

**Files:**
- Create: `api/results.py`, `api/routes/results.py`, `api/tests/test_results.py`
- Modify: `api/main.py`

**Interfaces:**
- Produces in `api/results.py`:
  - `latest_metrics(config: dict) -> dict | None` -> `{"precision","recall","f1","time"}` from `config["error_detection"]` if present, else from the last entry of `config["results"]` (keys `Precision/Recall/F1` or lowercase), else `None`
  - `comparison_rows(pipelines_dir: Path, dataset: str) -> list[dict]`: one row per entry of `results` of every pipeline whose `selected_dataset == dataset`: `{time, pipeline, labeling_budget, precision, recall, f1}` newest first; unreadable configs skipped
  - `raha_baseline(csv_path: Path, budget: int) -> dict | None`: the row with the closest `labeling_budget` -> `{labeling_budget, precision, recall, f1}` (CSV column `f_score`); `None` when the file is missing or the budget is not positive
  - `label_accuracy(pipeline_dir: Path, dataset_dir: Path) -> dict`: compares `user_labels.csv` with ground truth; returns `{"rows": [{table,row,col,val,user_said_error,truth_is_error,clean_value,correct}], "total": int, "correct": int, "accuracy": float}`; rows whose table/cell has no ground truth are left out; raises `FileNotFoundError` without `user_labels.csv`
- Endpoints: `GET /api/pipelines/{name}/results` -> `{"dataset","pipeline","labeling_budget","metrics","comparison","raha"}`; `GET /api/pipelines/{name}/label-accuracy?offset=0&limit=100` -> counts plus the row slice (409 "No saved user labels" without the file); `GET /api/pipelines/{name}/label-accuracy.csv` -> `text/csv` attachment with all rows (same 409). Raha CSV path is `<repo>/raha_baseline_results.csv`, added to `Settings` as `raha_baseline_csv: Path` with that default.

- [ ] **Step 1: Write failing tests** with tmp pipelines/datasets: `latest_metrics` from `error_detection`, from capitalised and lowercase `results`, `None`; `comparison_rows` only same dataset, sorted newest first, skips a broken `configurations.json`; `raha_baseline` closest budget, missing file, budget 0; `label_accuracy` counts/accuracy on a small labeled set incl. a label for a table without ground truth (left out) and a missing `user_labels.csv`; endpoint tests incl. CSV headers/content, paging, 409, 404 unknown pipeline.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement and wire in.
- [ ] **Step 4:** Run `api/tests`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(api): results, comparison, Raha baseline and label accuracy endpoints`.

---

### Task 6: Frontend client, room service additions and swipe card

**Files:**
- Modify: `frontend/src/rooms/roomService.ts`, `frontend/src/test/fakePocketBase.ts`, `frontend/src/lib/api.ts`, `frontend/src/lib/schema.d.ts` (regenerate with the API running), `frontend/src/components/DataTable.tsx` (optional `cellStyle`), tests
- Create: `frontend/src/components/SwipeCard.tsx`, `frontend/src/components/SwipeCard.test.tsx`, `frontend/src/rooms/roomLabels.test.ts`

**Interfaces:**
- `RoomService` additions (ports of `components/room_store.py`, same semantics):
  - `getPlayer(roomName: string, token: string): Promise<Player | null>`
  - `claimCells(roomName: string, playerId: string, candidates: string[], n: number): Promise<string[]>`: first the player's own existing claims that are in `candidates` (up to `n`), then claims further candidates in order by creating `claims` records, skipping any whose creation conflicts (unique `(room, cell_id)`) until `n` are held
  - `saveLabel(roomName: string, playerId: string, cellId: string, value: boolean, isCorrect: boolean | null, latencyMs: number): Promise<void>`: creates, or updates the existing record of the same `(room, cell_id, player)`
  - `roomLabels(roomName: string): Promise<RoomLabelRecord[]>` (`{cell_id, player, value, is_correct, latency_ms}`)
  - `saveRun(room: Room, player: Player, budget: number, precision: number, recall: number, f1: number): Promise<void>`
  - `playerStats(roomName: string): Promise<PlayerStat[]>` (`{id,name,labels,correct,accuracy,median_ms,error_share}` for players with labels, sorted by correct then labels, descending)
- `FakePocketBase` gains unique constraints for `claims` (`room`+`cell_id`) and `labels` (`room`+`cell_id`+`player`).
- `DataTable` gains optional `cellStyle?: (row: number, col: number) => CSSProperties | undefined`.
- `SwipeCard({ onSwipe, disabled, children })`: pointer-drag horizontally; releasing after more than 100 px right calls `onSwipe('right')`, more than 100 px left `onSwipe('left')`, less snaps back and calls nothing; while dragging the card translates and rotates slightly (inline style); `disabled` ignores drags.
- `lib/api.ts` additions (typed from the schema): `fetchLabelingSample(name)`, `fetchCandidates(name)`, `fetchCards(name, keys)`, `judgeVerdicts(dataset, verdicts)`, `startPropagation(name, body)`, `fetchPropagation(name, offset, limit)`, `startErrorDetection(name)`, `fetchErrorDetection(name)`, `fetchDetectedErrors(name, table, offset, limit)`, `fetchResults(name)`, `fetchLabelAccuracy(name, offset, limit)`, and `labelAccuracyCsvUrl(name): string`. A 404 or 409 from the "fetch" functions that mean "not there yet" are thrown as `Error` with the API `detail`.

- [ ] **Step 1: Write failing tests.** `roomLabels.test.ts` (fake PocketBase): `claimCells` takes the first n free candidates in order; returns own earlier claims first; skips candidates claimed by another player; two players claiming the same list never overlap and together hold at most the candidates; fewer candidates than n returns what exists; `saveLabel` creates then overwrites (one record); `roomLabels` lists; `playerStats` aggregates accuracy, median latency and error share and sorts; `saveRun` creates a `runs` record with the room's dataset. `SwipeCard.test.tsx`: drag right past the threshold calls `onSwipe('right')`, left calls `'left'`, a short drag calls nothing, `disabled` calls nothing.
- [ ] **Step 2:** Run `npx vitest run src/rooms src/components/SwipeCard.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement; regenerate `schema.d.ts` (start the API).
- [ ] **Step 4:** Run the whole frontend suite and `npm run build`. Expected: pass.
- [ ] **Step 5:** Commit: `feat(frontend): room claims/labels, swipe card, labeling and results API client`.

---

### Task 7: Labeling page

**Files:**
- Create: `frontend/src/pages/Labeling.tsx`, `frontend/src/pages/Labeling.test.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/styles/app.css`

**Interfaces:**
- Consumes: Task 6 API functions and `RoomService`, `useSession` (`pipeline_path`, `room_name`, `player_token`, `labeling_results`), `SwipeCard`, `DataTable`, `fetchDirtyPage`, `useJob`, `JobStatus`.
- Behaviour: no `pipeline_path` -> warn "Pipeline not configured." + link to Configurations; config without cell folds (`has_cell_folds` false) -> warn + link to Quality Folding. With a `room_name` in the session: load room and player (`getRoom`, `getPlayer`); room phase `lobby` -> warn "Your room has not started yet." + link to the lobby; room unreachable -> error notice. Solo: cards = `fetchLabelingSample`. In a room: `fetchCandidates`, `claimCells(room, player.id, keys, player.budget)`, then `fetchCards(claimedKeys)` (order of claims). Info text names the room and player. If there are zero cards: success notice "All cell folds have been bulk-annotated! No individual labeling needed." Otherwise one card at a time: value, strategies as pills, `Cell fold` name, and the table excerpt (`fetchDirtyPage(dataset, table, max(0,row-5), 11)`, target cell shaded via `cellStyle`), progress "Card i of n", buttons "Correct" and "Error" (same effect as swiping right/left), "Previous" to step back and change a verdict, and a done message when all are answered. A verdict is stored in the session as `labeling_results[key] = true|false` (overwrites); in a room it is also saved immediately: `judgeVerdicts` then `saveLabel(room, player.id, key, value, isCorrect, latencyMs since the card was shown)`; a failing judge or save shows a warning but keeps the verdict. "Next" (always enabled) builds `own` from swiped cards only (`is_error = !verdict`), in a room first loads `roomLabels`, starts propagation with `player_id` and `room_labels` (`{cell_id, player, value}`), shows `JobStatus`, and on `done` stores `room_disputed_cells` (the job's `disputed`) in the session and navigates to `/propagated-errors`; a failed job shows its error and stays. "Back" -> `/quality-folding`.

- [ ] **Step 1: Write failing tests** (mocked `../lib/api` and a fake PocketBase behind `RoomService`; seeded session): pipeline/cell-fold warnings with links; solo flow loads the sample, shows the first card's value and strategies, "Correct" advances and stores `labeling_results` in the session record, "Previous" then "Error" overwrites the same key; zero cards shows the bulk-annotated message and Next still starts propagation with `own: []`; room flow claims cells (assert `claims` records exist for exactly `player.budget` keys and `fetchCards` was called with those keys in order), a second render after a reload does not create new claims; room lobby warning; verdict in a room calls `judgeVerdicts` and creates a `labels` record with `is_correct`, a second verdict on the same card updates it (still one record); a failing `judgeVerdicts` still keeps the verdict and shows a warning; Next sends only swiped cards as `own` with `is_error` inverted from the verdict, passes `room_labels`/`player_id` in a room, and navigates after the job is done (mock `fetchJob`), storing `room_disputed_cells`; a failed propagation job shows the error and stays.
- [ ] **Step 2:** Run `npx vitest run src/pages/Labeling.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement the page and route.
- [ ] **Step 4:** Run the whole suite (three times, to catch timing flakes) and `npm run build`. Expected: pass.
- [ ] **Step 5:** Commit: `feat(frontend): Labeling page`.

---

### Task 8: Propagated Errors page

**Files:**
- Create: `frontend/src/pages/PropagatedErrors.tsx`, `frontend/src/pages/PropagatedErrors.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `fetchPropagation(name, offset, limit)`, session `pipeline_path`.
- Behaviour: no pipeline -> warn + Configurations link; API 409 ("Run label propagation first") -> info notice with a link to `/labeling`. Otherwise: "Label Propagation Results" with totals (labeled cells, propagated labels). Each labeled cell is a `<details>`-style expandable row with an error/correct icon and its value; expanded it shows table, row, column, domain fold, cell fold and the propagated cells (table, row, column, value, confidence as a percentage, reason) or "No cells were propagated from this label". Paged 20 labeled cells at a time (Previous/Next page). "Back" -> `/labeling`, "Next" -> `/error-detection`.

- [ ] **Step 1: Write failing tests** (mocked API): warnings/links for no pipeline and 409; summary totals; expanding a labeled cell shows its details and propagated cells with `85%` for confidence 0.85; a labeled cell without propagated cells shows the empty text; paging requests `offset=20`; Next link target.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the page and route.
- [ ] **Step 4:** Run the whole suite and `npm run build`. Expected: pass.
- [ ] **Step 5:** Commit: `feat(frontend): Propagated Errors page`.

---

### Task 9: Error Detection page

**Files:**
- Create: `frontend/src/pages/ErrorDetection.tsx`, `frontend/src/pages/ErrorDetection.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `startErrorDetection`, `fetchErrorDetection`, `fetchDetectedErrors`, `fetchDirtyPage`, `useJob`, `JobStatus`, `DataTable` with `cellStyle`.
- Behaviour: no pipeline -> warn; no propagation results (the first `fetchErrorDetection` 404 plus the pipeline config's `propagation_results` missing is signalled by the start call's 409) -> notice with a link to `/propagated-errors`. "Run error detection" starts the job (disabled while running); on `done` the stored result is reloaded; a failed job shows its message. With a result: metrics Precision, Recall and F1 with three decimals, then "Detected errors" with one expandable row per table ("<table> (<n> potential errors)"). Expanding loads the table's first 100 rows (`fetchDirtyPage(dataset, table, 0, 100)`) with detected cells shaded `rgba(244, 177, 28, confidence)`, and the error list (`fetchDetectedErrors(name, table, offset, 100)`, paged) with row, column, value, confidence percentage and source. "Re-run error detection" is the same button. "Next: View results" is enabled once a result exists; "Back" -> `/propagated-errors`.

- [ ] **Step 1: Write failing tests** (mocked API): warnings/links; running the job shows metrics and tables after done; a failed job shows its message; expanding a table requests rows and errors once and shades exactly the cells of errors in the first 100 rows (assert inline style contains the confidence); error list shows `87%`; paging requests `offset=100`; "no errors" (empty `tables`) shows the "No errors detected" note; Next disabled before a result and linking to `/results` after.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the page and route.
- [ ] **Step 4:** Run the whole suite and `npm run build`. Expected: pass.
- [ ] **Step 5:** Commit: `feat(frontend): Error Detection page`.

---

### Task 10: Results page

**Files:**
- Create: `frontend/src/pages/Results.tsx`, `frontend/src/pages/Results.test.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/components/DataTable.tsx` (optional `sortable` header sorting with TanStack Table `getSortedRowModel`), `frontend/src/styles/app.css`

**Interfaces:**
- Consumes: `fetchResults(name)`, `fetchLabelAccuracy`, `labelAccuracyCsvUrl`, `RoomService` (`getRoom`, `getPlayer`, `playerStats`, `saveRun`), session (`pipeline_path`, `room_name`, `player_token`, `run_saved_for`, `room_disputed_cells`).
- Behaviour: no pipeline -> warn + link. Model Performance Metrics: Precision, Recall, F1 (two decimals) and Labeling Budget; with no metrics yet a notice linking to `/error-detection`. "Result Comparison (Dataset: X)" table (Time, Pipeline Name, Labeling Budget, Recall, F1, Precision; sortable by clicking a header; the current pipeline's latest row highlighted with class `current`). Raha baseline card when `raha` exists: precision, recall, F1 of the closest budget and the F1 change in percent versus the current run (`n/a` when the baseline F1 is 0). "Check my labeling accuracy" button loads the first page: Total labeled, Correct, Accuracy (percent, one decimal) and the per-cell table (paged 100), a "Download CSV" link to `labelAccuracyCsvUrl`; API 409 shows its message. In a room (`room_name` in session): "Room labeling" with labels in the room, labelers, room accuracy percent, a table per player (name with "(you)", labels, correct, accuracy percent, median time in seconds with one decimal, marked as error percent, pattern: "very fast" when at least 5 labels and median under 700 ms, "same answer" when at least 5 labels and one answer share is at least 90 %), the disputed-cell count from the session when present, and, once per result `time` (guard with `run_saved_for` in the session), `saveRun(room, player, budget, p, r, f1)`. "Share your results": the share text with metrics, budget, dataset and pipeline in a copyable block and a "Copy" button using `navigator.clipboard` when available. "Back" -> `/error-detection`.

- [ ] **Step 1: Write failing tests** (mocked API, fake PocketBase): no-pipeline warning; metrics rendered with two decimals; missing metrics notice; comparison rows sorted newest first and the current row has class `current`, clicking the "F1" header sorts ascending then descending; Raha card values and `+12.5%` style change (assert text for known inputs) and `n/a` for baseline 0; accuracy button shows counts and rows, `Accuracy 75.0%`, CSV link href, 409 message; room section totals/accuracy and the "very fast" and "same answer" flags from seeded labels; `saveRun` called exactly once for the same result time across re-renders and again for a new time; share text contains metrics, dataset and pipeline; no room section without `room_name`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the page, sorting in `DataTable`, route.
- [ ] **Step 4:** Run the whole suite (three times) and `npm run build`. Expected: pass.
- [ ] **Step 5:** Commit: `feat(frontend): Results page`.

---

### Task 11: Acceptance

**Files:** none; findings reported to the owner.

- [ ] **Step 1:** Run `venv/bin/python -m pytest api/tests -q`, `venv/bin/python -m pytest api/tests -m slow -q`, `cd frontend && npx vitest run` and `npm run build`; record the results.
- [ ] **Step 2:** With `scripts/dev.sh` running and a temporary pipeline `accept-<timestamp>` created through the API for `BIFOLD_Demo` (budget 10, strategy `Typo Detector`): run domain and quality folding; bulk-annotate one fold; GET the labeling sample and candidates (assert the bulk-annotated fold is absent and candidates start with the sample keys), fetch cards by keys; judge two verdicts; start propagation with 5 own labels, then GET propagation (paged); start error detection, GET its summary and one table's errors; GET results (metrics, comparison containing the pipeline, Raha card), label-accuracy (JSON and CSV). Every job must reach `done`; if `backend_pull_errors` or propagation fail inside `backend/` under the shim, capture the log output and report it without editing `backend/`. Then delete exactly that temporary pipeline folder (via the script's `finally`, using `shutil.rmtree` on `pipelines/accept-<timestamp>`) and nothing else; stop the script and confirm no stray processes.
- [ ] **Step 3:** State plainly which behaviours were verified by automated tests, which by the live run, and that rendering and swiping in a real browser were not checked.
