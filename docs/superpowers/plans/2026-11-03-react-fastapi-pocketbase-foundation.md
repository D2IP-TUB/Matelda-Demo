# React + FastAPI + PocketBase Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `frontend/` (React), `api/` (FastAPI) and PocketBase as three cooperating services, with a working multiplayer Lobby, persistent sessions, one real background job, and placeholder routes for every Streamlit page.

**Architecture:** `api/` is the only code that imports `backend/` (which imports `Matelda/`); it exposes thin typed endpoints under `/api` and runs long steps as in-process background jobs. The browser talks to PocketBase directly for rooms, players, votes, sessions and realtime, and to FastAPI (through the Vite dev proxy) for ML work. The Streamlit app stays untouched and runnable.

**Tech Stack:** Python 3.10 (existing `venv/`), FastAPI, uvicorn, pytest, httpx; Node 20.19, Vite, React, TypeScript, React Router, TanStack Query, `pocketbase` JS SDK, `openapi-typescript` + `openapi-fetch`, Vitest; PocketBase 0.40.x (existing binary).

**Spec:** `docs/superpowers/specs/2026-11-03-react-fastapi-pocketbase-foundation-design.md`

## Global Constraints

- `Matelda/` and `backend/` are not edited (except minimal changes strictly needed to import them from `api/`).
- No Redis or external queue; job runner is in-process, single worker, behind `submit` / `status` / `result`.
- Existing PocketBase collections `rooms`, `players`, `claims`, `labels`, `runs` and their rules are unchanged; no destructive schema changes. `scripts/init_pocketbase.py` stays the idempotent source of truth for schema.
- Must work across the LAN: no hardcoded `localhost` PocketBase URL in the browser; it derives the host from `window.location.hostname`.
- Python ML dependency pins in `requirements.txt` are not changed; `api/` adds only FastAPI, uvicorn (and test deps) via `api/requirements.txt`.
- API routes live under the `/api` prefix. Ports: PocketBase 8090, API 8000 (loopback only), Vite 5173.
- Visual design is out of scope; plain readable layout only.
- The Streamlit app (`app.py`, `pages/`, `components/`) is not removed.

## Review Focus

1. A dataset name like `../etc` or an unknown dataset reaches an endpoint: respond 404, never touch the filesystem outside `datasets/`. (Task 3)
2. A job function raises: the job ends `failed` with the error message, never stuck `running`. (Task 2)
3. The API restarts while the frontend polls a job: `GET /api/jobs/{id}` is 404 and the UI shows "job lost", not an endless spinner. (Tasks 2, 9)
4. `localStorage` is empty, blocked, or holds a session id that no longer exists in PocketBase: a fresh session is created, the app does not crash. (Task 7)
5. Lobby opened with `?room=` naming a room that does not exist, or a stored player token that belongs to another room: show "room not found" or join as a new player, never throw. Two players joining at the same instant get different names. (Task 6, 8)

---

## File Structure

```
api/__init__.py            package marker
api/main.py                create_app(): router wiring, CORS
api/settings.py            env-driven settings (datasets dir, CORS origins)
api/jobs.py                JobStore: submit/status/result, single-worker executor
api/datasets.py            list_datasets(), resolve_dataset()
api/services.py            lazy wrappers over backend_* (the only importer of backend/)
api/routes/meta.py         GET /api/health, /api/datasets, /api/strategies
api/routes/jobs.py         GET /api/jobs/{id}
api/routes/matelda.py      POST endpoints that start jobs over backend_*
api/tests/                 pytest suite
api/requirements.txt       fastapi, uvicorn, pytest, httpx
scripts/init_pocketbase.py add `sessions` collection (modify)
scripts/dev.sh             one-command launcher
frontend/                  Vite React TS app (layout in Tasks 5-9)
```

---

### Task 1: API skeleton with health endpoint

**Files:**
- Create: `api/__init__.py`, `api/main.py`, `api/settings.py`, `api/requirements.txt`, `api/tests/__init__.py`, `api/tests/test_health.py`, `pytest.ini`

**Interfaces:**
- Produces: `create_app() -> FastAPI` in `api/main.py`; module-level `app = create_app()`; `Settings` dataclass with `datasets_dir: Path`, `cors_origins: list[str]` and `get_settings() -> Settings` in `api/settings.py` (env `API_CORS_ORIGINS`, comma-separated, default `http://localhost:5173`; datasets dir is `<repo>/datasets`).

- [ ] **Step 1:** Create `api/requirements.txt` listing `fastapi`, `uvicorn[standard]`, `pytest`, `httpx`; install with `uv pip install --python venv/bin/python -r api/requirements.txt`. Add `pytest.ini` at repo root with `testpaths = api/tests` and a `slow` marker.
- [ ] **Step 2: Write failing test** `test_health_returns_ok` in `api/tests/test_health.py`: `TestClient(create_app()).get("/api/health")` has status 200 and JSON `{"status": "ok"}`.
- [ ] **Step 3:** Run `venv/bin/python -m pytest api/tests/test_health.py -v`. Expected: FAIL (import error).
- [ ] **Step 4:** Implement `create_app()` with an `/api` router exposing `GET /health`, and CORS middleware using `get_settings().cors_origins`.
- [ ] **Step 5:** Re-run the test. Expected: PASS.
- [ ] **Step 6:** Commit: `git add api pytest.ini && git commit -m "feat(api): FastAPI skeleton with health endpoint"`.

---

### Task 2: Job runner and jobs endpoint

**Files:**
- Create: `api/jobs.py`, `api/routes/__init__.py`, `api/routes/jobs.py`, `api/tests/test_jobs.py`
- Modify: `api/main.py` (include jobs router)

**Interfaces:**
- Produces in `api/jobs.py`:
  - `JobState = Literal["running", "done", "failed"]`
  - `class JobInfo(BaseModel)`: `id: str`, `state: JobState`, `result: Any | None`, `error: str | None`
  - `class JobStore`: `submit(self, fn: Callable[..., Any], *args, **kwargs) -> str`, `status(self, job_id: str) -> JobInfo | None`. Backed by `ThreadPoolExecutor(max_workers=1)`; unknown id returns `None`.
  - `get_job_store() -> JobStore` (process-wide singleton, used as a FastAPI dependency so tests can override it).
- `GET /api/jobs/{job_id}` returns `JobInfo`, or 404 for unknown ids.

- [ ] **Step 1: Write failing tests** in `api/tests/test_jobs.py`: `test_job_completes_with_result` (submit `lambda: 41 + 1`, poll `status` until not running, assert state `done` and result 42); `test_failing_job_reports_error` (fn raises `ValueError("boom")` → state `failed`, `"boom"` in error); `test_unknown_job_is_none`; `test_jobs_endpoint_404_for_unknown_id` (via TestClient); `test_jobs_endpoint_returns_done_job`.
- [ ] **Step 2:** Run `venv/bin/python -m pytest api/tests/test_jobs.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement `JobStore` (dict of id → future plus info; update info in a done-callback; exceptions become `failed` with `str(exc)`), the route, and wire it into `create_app()`.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): in-process job store and /api/jobs/{id}`.

---

### Task 3: Datasets, strategies and safe dataset resolution

**Files:**
- Create: `api/datasets.py`, `api/routes/meta.py`, `api/services.py`, `api/tests/test_datasets.py`
- Modify: `api/main.py` (include meta router; move `/health` into it)

**Interfaces:**
- Produces in `api/datasets.py`: `list_datasets(root: Path) -> list[str]` (sorted names of subdirectories), `resolve_dataset(root: Path, name: str) -> Path | None` (returns the path only if `name` is exactly one of `list_datasets(root)`; anything else, including `../x`, absolute paths, or empty, returns `None`).
- Produces in `api/services.py`: functions `get_available_strategies()`, `backend_dbf(...)`, `backend_qbf(...)`, `backend_sample_labeling(...)`, `backend_label_propagation(...)`, `backend_pull_errors(...)`, each importing from `backend` **inside the function body** (the import takes ~7 s and must not slow API startup or tests).
- `GET /api/datasets` → `list[str]`; `GET /api/strategies` → `list[str]` (via `services.get_available_strategies`).
- Provides FastAPI dependency `require_dataset(dataset: str) -> str` raising `HTTPException(404)` when `resolve_dataset` returns `None`; later tasks reuse it.

- [ ] **Step 1: Write failing tests** in `api/tests/test_datasets.py` using `tmp_path` with dirs `a`, `b` and a plain file `c.txt`: `test_list_datasets_only_directories_sorted` (`["a","b"]`); `test_resolve_known_dataset`; `test_resolve_rejects_traversal` (parametrized: `"../a"`, `"a/../../etc"`, `"/etc"`, `""`, `"c.txt"`, `"missing"` → `None`); `test_datasets_endpoint_lists` (override `get_settings` to point at `tmp_path`); `test_strategies_endpoint` (monkeypatch `api.services.get_available_strategies` to return `["x"]`).
- [ ] **Step 2:** Run `venv/bin/python -m pytest api/tests/test_datasets.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement the module, the router and the dependency.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): datasets/strategies endpoints with safe dataset resolution`.

---

### Task 4: Pipeline endpoints as background jobs

**Files:**
- Create: `api/routes/matelda.py`, `api/tests/test_matelda_routes.py`
- Modify: `api/main.py` (include router)

**Interfaces:**
- Consumes: `JobStore.submit`, `get_job_store`, `require_dataset`, `api.services.*`.
- Produces, all `POST`, all return `{"job_id": str}` and run the matching `services.*` function in a job, result is the function's return value unchanged:
  - `/api/folding/domain` body `{dataset: str, labeling_budget: int}` → `services.backend_dbf(dataset, labeling_budget)`
  - `/api/folding/quality` body `{dataset, labeling_budget, domain_folds: dict[str, list[str]], selected_strategies: list[str]}` → `services.backend_qbf(...)`
  - `/api/labeling/sample` body `{dataset, labeling_budget, cell_folds: dict[str, Any], domain_folds: dict[str, list[str]]}` → `services.backend_sample_labeling(...)`
  - `/api/labeling/propagate` body `{dataset, labeled_cells: list[dict[str, Any]]}` → `services.backend_label_propagation(...)`
  - `/api/errors` body `{dataset}` → `services.backend_pull_errors(dataset)`
- Result payloads stay loosely typed (`dict[str, Any]`); request bodies are Pydantic models with `labeling_budget` constrained to `>= 1`.

- [ ] **Step 1: Write failing tests** in `api/tests/test_matelda_routes.py`, monkeypatching `api.services.*` with fakes and overriding `get_settings` to a `tmp_path` containing dataset `demo`: `test_domain_folding_starts_job_and_returns_result` (fake returns `{"domain_folds": {"Domain Fold 1": ["t1"]}}`; POST, poll `/api/jobs/{id}`, assert state `done` and result equal); `test_domain_folding_unknown_dataset_404`; `test_domain_folding_rejects_zero_budget` (422); `test_failing_backend_marks_job_failed` (fake raises); parametrized `test_each_endpoint_passes_arguments_through` for quality, sample, propagate, errors asserting the fake received the exact arguments.
- [ ] **Step 2:** Run `venv/bin/python -m pytest api/tests/test_matelda_routes.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement the router; each handler validates the dataset with `require_dataset` before submitting.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5 (slow smoke):** Add `test_real_domain_folding_on_demo_dataset` marked `@pytest.mark.slow`, no mocks, posting `{dataset: "BIFOLD_Demo", labeling_budget: 10}`, polling up to 300 s, asserting state `done` and a non-empty `result["domain_folds"]`. Run `venv/bin/python -m pytest api/tests -m slow -v -s`. Expected: PASS. If it fails because `backend_dbf` swallowed an exception and returned `{"domain_folds": {}}`, report this rather than altering `backend/`.
- [ ] **Step 6:** Commit: `feat(api): pipeline endpoints running as background jobs`.

---

### Task 5: PocketBase `sessions` collection

**Files:**
- Modify: `scripts/init_pocketbase.py` (add collection to `COLLECTIONS`)
- Create: `api/tests/test_pocketbase_schema.py` (integration, skipped when PocketBase is unreachable)

**Interfaces:**
- Produces: collection `sessions` with fields `created` (autodate), `sid` (text, required), `data` (json), unique index `idx_sessions_sid` on `sid`, public rules like the other collections. A `json_field(name)` helper in the script returns `{"name": name, "type": "json"}`.

- [ ] **Step 1: Write failing test** `test_sessions_collection_roundtrip`: skip unless `GET {PB_URL}/api/health` answers; create a record `{sid: <uuid>, data: {"room_name": "x"}}` via REST, read it back by `filter=sid="<uuid>"`, assert `data == {"room_name": "x"}`, assert creating a second record with the same `sid` returns 400, delete the record.
- [ ] **Step 2:** Start PocketBase (`pocketbase/pocketbase serve --http=127.0.0.1:8090 &`), run the test. Expected: FAIL (collection missing, 404).
- [ ] **Step 3:** Add the collection definition and run `venv/bin/python scripts/init_pocketbase.py`. Confirm it prints `created sessions` and that rerunning prints `synced indexes of sessions` (idempotent) and the five existing collections are untouched.
- [ ] **Step 4:** Re-run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(pocketbase): sessions collection`.

---

### Task 6: Frontend scaffold, routes and room logic

**Files:**
- Create: `frontend/` via Vite React-TS template (`npm create vite@latest frontend -- --template react-ts`), then add deps `react-router-dom`, `@tanstack/react-query`, `pocketbase`, `openapi-fetch`; dev deps `vitest`, `openapi-typescript`, `@testing-library/react`, `jsdom`.
- Create: `frontend/src/routes.ts`, `frontend/src/pages/Placeholder.tsx`, `frontend/src/App.tsx` (router), `frontend/src/lib/pb.ts`, `frontend/src/rooms/names.ts`, `frontend/src/rooms/roomService.ts`, `frontend/src/rooms/names.test.ts`, `frontend/src/rooms/roomService.test.ts`, `frontend/src/routes.test.tsx`
- Modify: `frontend/vite.config.ts` (proxy `/api` → `http://127.0.0.1:8000`, vitest `jsdom` env)

**Interfaces:**
- `routes.ts` exports `PAGES: {path: string; title: string}[]` in flow order: `/lobby` Lobby, `/intro` InputOutput, `/configuration` Configurations, `/domain-folding` DomainBasedFolding, `/quality-folding` QualityBasedFolding, `/labeling` Labeling, `/error-detection` ErrorDetection, `/propagated-errors` PropagatedErrors, `/results` Results. `/` redirects to `/lobby`; `/dev` is reserved for Task 9.
- `lib/pb.ts` exports `pb: PocketBase` created with URL `import.meta.env.VITE_PB_URL ?? \`${location.protocol}//${location.hostname}:8090\``, and `pbUrl: string`.
- `rooms/names.ts` (word lists copied verbatim from `components/room_store.py` `ADJECTIVES`/`NOUNS`):
  - `generateRoomName(rng?: () => number): string` → `adj-noun-NN` lowercase, NN in 10..99
  - `generatePlayerName(taken: Set<string>, rng?: () => number): string | null` → `"Adj Noun"` not in `taken`, `null` after 50 failed attempts
  - `pickWinningDataset(votes: string[], rng?: () => number): string | null` → most-voted non-empty dataset, random tie-break, `null` when no votes
- `rooms/roomService.ts` exports `class RoomService` constructed with a `PocketBase`-shaped object, methods (semantics ported from `components/room_store.py`):
  - `createRoom(): Promise<Room>` (retries on unique-name conflict, up to 20 times; phase `lobby`)
  - `getRoom(name: string): Promise<Room | null>`
  - `joinRoom(roomName: string, token?: string): Promise<Player>` (rejoin by `token` only if that token belongs to `roomName`; otherwise create a player with a free name and fresh token, retrying on unique conflict)
  - `listPlayers(roomName: string): Promise<Player[]>` (sorted by `created`)
  - `setVote(player: Player, dataset: string): Promise<void>`
  - `startRoom(room: Room): Promise<Room>` (no-op unless phase is `lobby`; throws `RoomError("Nobody picked a dataset yet")` when no votes; sets phase `labeling` and the winning dataset)
  - `subscribe(roomName: string, onChange: () => void): Promise<() => void>` (realtime on `players` and `rooms`, returns unsubscribe)
  - Types: `Room {id, name, phase: "lobby" | "labeling", dataset}`, `Player {id, room, token, name, budget, vote}`; `class RoomError extends Error`.

- [ ] **Step 1: Write failing tests.** `names.test.ts`: room name matches `/^[a-z]+-[a-z]+-\d{2}$/`; player name avoids `taken`; returns `null` when every combination is taken; `pickWinningDataset` returns the single most voted, picks among ties using a fixed rng, ignores empty strings, returns `null` for `[]`. `roomService.test.ts` with an in-memory fake PocketBase: createRoom retries after a simulated unique conflict; joinRoom with a token from another room creates a new player; two sequential joins get different names; startRoom throws `RoomError` without votes; startRoom is a no-op when already `labeling`. `routes.test.tsx`: renders `<App/>` at each path in `PAGES` and finds the page title.
- [ ] **Step 2:** Run `npx vitest run` in `frontend/`. Expected: FAIL.
- [ ] **Step 3:** Implement `routes.ts`, `Placeholder`, `App` (React Router; `QueryClientProvider`), `names.ts`, `roomService.ts`, `pb.ts`.
- [ ] **Step 4:** Re-run `npx vitest run`. Expected: PASS. Run `npm run build`. Expected: succeeds.
- [ ] **Step 5:** Commit (add `frontend/` excluding `node_modules`, ensure `.gitignore` covers `frontend/node_modules` and `frontend/dist`): `feat(frontend): scaffold, routes, room service`.

---

### Task 7: Session persistence

**Files:**
- Create: `frontend/src/session/sessionService.ts`, `frontend/src/session/SessionProvider.tsx`, `frontend/src/session/sessionService.test.ts`
- Modify: `frontend/src/App.tsx` (wrap in `SessionProvider`)

**Interfaces:**
- `sessionService.ts`: `SessionData = Record<string, unknown>` (keys follow the Streamlit persisted keys: `room_name`, `player_token`, `dataset_select`, `pipeline_path`, `labeling_budget`, `selected_strategies`, `domain_folds`, `cell_folds`, ...); `class SessionService` constructed with a PocketBase-shaped object and a storage-like object (`getItem`/`setItem`, may throw):
  - `load(): Promise<{sid: string; data: SessionData}>` (reads `matelda.sid` from storage; fetches the `sessions` record by `sid`; if storage is empty/throws or the record does not exist, creates a new random sid and record)
  - `save(sid: string, patch: SessionData): Promise<SessionData>` (merges `patch` into the stored `data`, returns merged)
  - `clear(sid: string, keep?: string[]): Promise<SessionData>` (replaces data with only `keep` keys, defaulting to `["room_name","player_token"]`, mirroring `clear_session_keep_room`)
- `SessionProvider` + `useSession(): {ready: boolean; data: SessionData; update(patch): Promise<void>; clear(keep?): Promise<void>}`.

- [ ] **Step 1: Write failing tests** with fake PocketBase and fake storage: `load` creates a session on first run and stores the sid; second `load` returns the same sid and data; `save` merges without dropping other keys; stored sid with no matching record yields a fresh sid and record (no throw); storage whose `getItem` throws still returns a working session; `clear` keeps only the room keys.
- [ ] **Step 2:** Run `npx vitest run src/session`. Expected: FAIL.
- [ ] **Step 3:** Implement service and provider.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(frontend): PocketBase-backed session persistence`.

---

### Task 8: Lobby page

**Files:**
- Create: `frontend/src/pages/Lobby.tsx`, `frontend/src/pages/Lobby.test.tsx`, `frontend/src/lib/api.ts`
- Modify: `frontend/src/App.tsx` (route `/lobby` → `Lobby`)

**Interfaces:**
- Consumes: `RoomService`, `useSession`, and `GET /api/datasets` (through `lib/api.ts`, a typed `openapi-fetch` client over `/api`; types file `frontend/src/lib/schema.d.ts` generated by `npm run gen:api` = `openapi-typescript http://127.0.0.1:8000/openapi.json -o src/lib/schema.d.ts`, checked in).
- Behaviour of `/lobby`: shows "Create room" and a room-name input with "Join". Room in URL as `?room=<name>`. On create/join it stores `room_name` and `player_token` in the session, shows the player list live, lets the player pick a dataset (radio over `GET /api/datasets`), shows vote counts, and a "Start" button that calls `startRoom`. When the room phase is `labeling` it shows the chosen dataset and a link to `/intro`. If `?room=` or the stored room does not exist: show "Room not found" with the create/join controls, no crash.

- [ ] **Step 1:** Start the API (`venv/bin/uvicorn api.main:app --port 8000`), run `npm run gen:api` in `frontend/`, commit the generated types.
- [ ] **Step 2: Write failing component tests** (fake `RoomService`, fake dataset list): create button creates a room and lists the player; unknown `?room=` shows "Room not found"; voting calls `setVote`; Start is disabled until someone voted and shows the winner after start; a realtime `onChange` callback refreshes the player list.
- [ ] **Step 3:** Run `npx vitest run src/pages/Lobby.test.tsx`. Expected: FAIL.
- [ ] **Step 4:** Implement `Lobby.tsx` and `lib/api.ts`.
- [ ] **Step 5:** Re-run. Expected: PASS; `npm run build` succeeds.
- [ ] **Step 6:** Commit: `feat(frontend): multiplayer lobby`.

---

### Task 9: Dev page with a real background job

**Files:**
- Create: `frontend/src/jobs/useJob.ts`, `frontend/src/jobs/useJob.test.ts`, `frontend/src/pages/DevPlayground.tsx`
- Modify: `frontend/src/App.tsx` (route `/dev`)

**Interfaces:**
- `useJob<T>(jobId: string | null): {state: "idle" | "running" | "done" | "failed" | "lost"; result?: T; error?: string}` polling `GET /api/jobs/{id}` every 1 s (TanStack Query `refetchInterval`) until the state is not `running`; a 404 maps to `lost` and stops polling.
- `/dev` page: dataset dropdown (from `/api/datasets`), budget input, "Run domain folding" button that `POST`s `/api/folding/domain` and displays `useJob` state and the resulting fold names.

- [ ] **Step 1: Write failing tests** for `useJob` with a mocked fetch: running then done returns result; failed exposes error; 404 → `lost` and polling stops; `null` id → `idle`.
- [ ] **Step 2:** Run `npx vitest run src/jobs`. Expected: FAIL.
- [ ] **Step 3:** Implement `useJob` and `DevPlayground`.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(frontend): job polling hook and dev playground`.

---

### Task 10: One-command launcher, LAN, README

**Files:**
- Create: `scripts/dev.sh`
- Modify: `.env.example` (`MATELDA_BASE_URL=http://192.168.0.10:5173`), `README.md` (new "React + FastAPI + PocketBase (development)" section; Streamlit instructions stay), `scripts/init_pocketbase.py` not touched.

**Interfaces:**
- `scripts/dev.sh` (executable, `set -euo pipefail`, modelled on `scripts/run_multiplayer.sh`): loads `.env`; derives `HOST` from `MATELDA_BASE_URL` and `BIND` (`127.0.0.1` for localhost, else `0.0.0.0`); starts PocketBase `--http=$BIND:8090 --publicDir=admin`; waits for `GET /api/health` on it; runs `venv/bin/python scripts/init_pocketbase.py`; starts `venv/bin/uvicorn api.main:app --host 127.0.0.1 --port 8000`; starts `npm run dev -- --host $BIND --port 5173` in `frontend/`; traps `EXIT` to kill all child processes; prints Players URL (`$MATELDA_BASE_URL/lobby`) and Dashboard URL (`http://$HOST:8090/?join=$MATELDA_BASE_URL/lobby`).

- [ ] **Step 1:** Write `scripts/dev.sh` and `chmod +x` it; update `.env.example` and README (layout, how to run, ports, how it differs from Streamlit).
- [ ] **Step 2: Verify** `bash -n scripts/dev.sh` is clean, then run `scripts/dev.sh` and confirm all three URLs answer: `curl -s localhost:8090/api/health`, `curl -s localhost:8000/api/health` and `curl -s localhost:5173/api/health` (the last through the Vite proxy) each return a healthy response. Stop it with Ctrl-C and confirm no stray `pocketbase`/`uvicorn`/`node` processes remain (`pgrep -fl "pocketbase serve|uvicorn api|vite"`).
- [ ] **Step 3:** Commit: `feat: one-command dev launcher and README`.

---

### Task 11: End-to-end acceptance (spec "Done when")

**Files:** none created; findings reported to the owner.

- [ ] **Step 1:** Run all automated checks and record the output: `venv/bin/python -m pytest api/tests -v`, `venv/bin/python -m pytest api/tests -m slow -v -s`, and in `frontend/`: `npx vitest run` and `npm run build`. Expected: all pass.
- [ ] **Step 2:** With `scripts/dev.sh` running and `MATELDA_BASE_URL` set to the machine's LAN address, verify by hand and report each result: (a) browser A creates a room, browser B on another device or a different origin joins via `/lobby?room=<name>`, each sees the other appear live; (b) both vote, vote counts show on both; (c) Start locks the room to the winning dataset on both; (d) reload each browser and confirm the same room and player are restored from the `sessions` record; (e) `/dev` lists datasets and runs domain folding on `BIFOLD_Demo` to a result; (f) every path in `PAGES` renders a placeholder; (g) the existing dashboard at `http://<host>:8090/` still shows the room.
- [ ] **Step 3:** If any check fails, report it with the output; do not claim completion. Otherwise state that the "Done when" list is met, item by item, with the evidence.
