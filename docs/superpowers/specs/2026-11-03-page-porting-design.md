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

## Batch 2 behaviour (Domain Folding, Quality Folding)

**Where fold state lives.** Domain folds and cell folds are stored in the pipeline's `configurations.json` (`domain_folds`, `cell_folds`, `cell_fold_labels`), not in the PocketBase session: `cell_folds` is about 2.5 MB for the demo dataset. The API owns all edits to cell folds; the browser only receives summaries and pages of cells (without the `features` vectors). **[my call]** Domain folds are small, so the browser edits them locally and saves them with one call.

**Prerequisite.** Both pages need `pipeline_path` in the session; without it they show a notice linking to Configurations. Quality Folding also needs saved domain folds, otherwise a notice linking to Domain Folding.

**Domain Folding.** "Run domain based folding" starts a background job (budget and dataset come from the pipeline config); the result is saved as `domain_folds`. Running again replaces the folds and removes `cell_folds`, `cell_fold_labels` and `results`, since they would be stale. **[my call]** The fold list shows each fold with its tables; per table: a preview (first 20 rows, loaded on demand) and a "move to" select. Merge mode (select two or more folds, the first becomes the target) and split mode (select tables; each fold splits after every selected table, new folds are named `<fold> - Split N`). Empty folds disappear. "Save" and "Next" persist the folds (changing them removes the stale derived data above) and "Next" goes to Quality Folding.

**Quality Folding.** Budget and strategies are editable on the page (same controls as Configurations) and saved to the pipeline config on run. "Run quality based folding" starts a job that saves `cell_folds`. The page lists domains and their cell folds with cell counts and label colour (green correct, red false). Per fold: show/hide, cells grouped by table and column, 20 cells at a time. Clicking a cell opens a dialog with the detection results (`strategies`, or "passed all checks"), a table excerpt around its row with the cell highlighted, and a select to move it to another fold. Actions: Merge (two or more folds; labels combine: correct+false conflict = neutral, correct only = correct, false only = false), Split (select cells in one fold; splits after each), Bulk annotate (per fold: correct / false / clear). All edits are saved immediately by the API. "Next" goes to Labeling.

**Not in this batch:** the Streamlit per-fold remembered "visible cells" counts, restart button.

## Batch 3 and 4 behaviour (Labeling, Propagated Errors, Error Detection, Results)

**Calling `backend/` without Streamlit.** `backend_sample_labeling`, `backend_label_propagation` and `backend_pull_errors` read the pipeline, the cell folds and the propagation results from `st.session_state`. The API runs them inside `api/backend_state.py`, a lock-guarded context manager that temporarily provides those keys as `streamlit.session_state`, so `backend/` stays unedited and the Streamlit app keeps working. When Streamlit is dropped, replace the shim with explicit parameters. **[my call]**

**Labeling.** Needs a pipeline with cell folds and, when in a room, a started room. Solo: the cards are the sampler's output (budget from the pipeline config; bulk-annotated folds are skipped and their budget redistributed, as in Streamlit). In a room: the API supplies an ordered list of candidate cells (sampler output first, then the remaining cells round-robin across folds) and the browser claims `player.budget` of them in PocketBase (`claims`, unique per room and cell), so no two players label the same cell; a reload keeps the same claims. A card shows the value, the detection strategies, and the table around the row with the cell highlighted. Swipe right = correct, left = error (drag, or the Correct / Error buttons). Verdicts are kept in the session (`labeling_results`) so a reload keeps them. In a room each verdict is saved to PocketBase immediately (`labels`), with `is_correct` judged server-side against `clean.csv` so ground truth never reaches the browser, and the swipe latency. **[my call]** Only swiped cards count as labeled (Streamlit counted unswiped cards as errors). **[my call]** Next merges the room's labels (majority per cell, 50/50 cells are dropped as disputed, other players' labels are mapped onto this player's folds), saves `user_labels.csv`, runs label propagation as a background job, stores `propagation_results` in the pipeline config and goes to Propagated Errors. If every fold is bulk-annotated there are no cards and Next still works.

**Propagated Errors.** Shows the stored propagation results: each labeled cell (error or correct icon, value, table, row, column, folds) expandable to the cells its label was propagated to (table, row, column, value, confidence, reason), paged 20 labeled cells at a time. Without results: notice linking to Labeling. The Streamlit page's "Propagate Errors" button and its randomly generated placeholder metrics are not ported. **[my call]**

**Error Detection.** Needs propagation results. "Run error detection" starts a job; the result (time, precision, recall, F1, detected errors by table) is stored in the pipeline config as `error_detection`. The page shows the three metrics and, per table, the error count; expanding a table shows its first 100 rows with detected cells shaded by confidence and a paged list of the errors (row, column, value, confidence, source). Re-run is allowed. "Next" goes to Results.

**Results.** Shows precision, recall, F1 and labeling budget of the latest detection result; a comparison table of all results of all pipelines for the same dataset (newest first, current pipeline highlighted, sortable by clicking headers); the Raha baseline for the closest labeling budget from `raha_baseline_results.csv` with the F1 improvement; "Check my labeling accuracy" (user labels versus ground truth: counts, accuracy, per-cell table, CSV download); in a room the room summary (labels, labelers, room accuracy, per-player table, disputed cells) and, once per detection result, the run is saved to PocketBase `runs` for the live dashboard; share text to copy. No social-share widget, no balloons. **[my call]**

**Swipe component.** `react-tinder-card` does not support React 19, so the swipe card is a small own component (pointer-drag with threshold plus buttons) that can be swapped later. **[my call]**
