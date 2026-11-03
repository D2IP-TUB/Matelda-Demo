# Matelda Demo: React + FastAPI + PocketBase foundation

Status: DRAFT, awaiting approval. Items marked **[my call]** were decided by the
designer, not by the project owner.

## Intent

The demo is a Streamlit app: UI, ML pipeline and session handling run in one
Python process. The owner wants a modern, clearly separated stack, with a React
frontend, a FastAPI backend and PocketBase for live and persistent state, so that
each page can later be rebuilt properly (folding steps, swipecards, results,
multiplayer).

This document covers **only the foundation**: the three services, how they talk
to each other, and an empty app shell. Rebuilding individual pages is explicitly
later work, done page by page, each with its own design.

## Goals

1. Three separately running parts with clear responsibilities:
   - **frontend/**: React app. All UI, no ML, no business logic beyond view state.
   - **api/**: FastAPI app. The only place that imports the Python ML code.
   - **pocketbase/**: rooms, players, labels, runs, and per-browser session state.
2. The existing Python logic is reused, not rewritten. `api/` imports `backend/`
   (and through it `Matelda/`) as-is.
3. One command starts all three for local development, on localhost or a LAN
   address (the demo is played by several people on their own devices).
4. A typed contract between frontend and API: the frontend's API client is
   generated from FastAPI's OpenAPI schema.
5. The foundation proves the plumbing end to end (see "Done when").

## Non-goals

- Visual design. Only general functionality needs to match the Streamlit app.
- Rebuilding any real page (Configurations, folding views, Labeling, Results...).
- Changing `Matelda/` (upstream research snapshot) or the ML algorithms.
- Restructuring or trimming `backend/` and `Matelda/`; they stay as they are.
- Production hardening, authentication beyond what rooms already do, deployment.
- Deleting the Streamlit app in this step (see Constraints).

## Anti-goals (a failure even if it technically works)

- ML or pandas logic duplicated in the frontend or reimplemented in `api/`.
- `api/` growing its own copy of room/player logic that PocketBase already owns.
- A React shell that only works on `localhost`, which breaks LAN multiplayer.

## Current state (facts from the repo)

- `pages/*.py`: Lobby, InputOutput, Configurations, DomainBasedFolding,
  QualityBasedFolding, Labeling (swipecards), ErrorDetection, PropagatedErrors,
  Results.
- `backend/backend.py` exposes `backend_dbf`, `backend_qbf`,
  `backend_sample_labeling`, `backend_label_propagation`, `backend_pull_errors`,
  plus `get_available_strategies`. `backend/` imports `Matelda/` in two places
  only (feature extraction).
- PocketBase (v0.40.x binary in `pocketbase/`) already holds `rooms`, `players`,
  `claims`, `labels`, `runs`, created by `scripts/init_pocketbase.py`, used via
  `components/room_store.py`. `admin/index.html` is a live dashboard served as
  PocketBase's public dir.
- Session state is a JSON snapshot per browser tab in `.streamlit/sessions/<sid>.json`,
  keyed by `?sid=` in the URL. Persisted keys are listed in
  `components/session_persistence.py` (`DEFAULT_INCLUDE_PREFIXES`): dataset and
  pipeline selection, room name and player token, budgets and strategies, domain
  and quality fold results.
- Pipeline runs are folders under `pipelines/`, each with a `configurations.json`.
- `scripts/run_multiplayer.sh` starts PocketBase and Streamlit; `MATELDA_BASE_URL`
  in `.env` sets the LAN address.

## Design

### Layout

```
frontend/        React + Vite + TypeScript
api/             FastAPI app (imports backend/, which imports Matelda/)
pocketbase/      binary + pb_data + pb_migrations (existing)
backend/         unchanged
Matelda/         unchanged
scripts/         dev launcher, PocketBase init (extended)
```

The Streamlit app (`app.py`, `pages/`, `components/`) stays in place and runnable
during the migration, and is removed only after the last page is ported. **[my call]**

### API (FastAPI)

- Thin, typed endpoints over the existing `backend_*` functions: list datasets and
  strategies, run domain folding, run quality folding, sample cells for labeling,
  propagate labels, pull errors. Request and response models are Pydantic.
- Foundation scope: the endpoints exist and call the real functions, with models
  that match what the functions return today. Shape refinements happen per page.
- Long-running steps (folding, propagation) run as background jobs: the call
  returns a job id; `GET /jobs/{id}` reports status, progress if available, and
  result or error. Decided with the owner: in-process job runner (single
  worker), **no Redis or external queue for now**. The runner sits behind a small
  interface (`submit`, `status`, `result`) so a worker queue (RQ/arq + Redis) can
  replace it later without changing endpoints or the frontend. Revisit if several
  rooms run folding at the same time.
- CORS allows the frontend origin(s) from configuration, including LAN origins.
- The API serves OpenAPI at `/openapi.json`; the frontend generates its client
  from it with a checked-in npm script.
- Pipeline folders under `pipelines/` remain the store for heavy artifacts
  (fold results, caches). Pipeline *identity and selection* moves to the session
  record in PocketBase; the API reads the pipeline path it is given.

### PocketBase

- Keep `rooms`, `players`, `claims`, `labels`, `runs` and their rules unchanged.
- Add a `sessions` collection holding the same state the Streamlit session file
  holds today, as one JSON field plus a client-generated id, so a browser reload
  restores the user's place. **[my call]** Keyed by a random id stored in the
  browser's localStorage, replacing `?sid=`.
- Room and player operations (create, join with token, vote, start, claim cells,
  write labels, record runs) are done by the frontend directly against PocketBase
  (REST + realtime subscriptions). The API does not proxy them. **[my call]**
  Port the semantics of `components/room_store.py` (unique funny names, rejoin by
  token, most-voted dataset wins with random tie-break, claim uniqueness).
- Collections keep public rules as today (demo setup, not for sensitive data).
  `scripts/init_pocketbase.py` stays the idempotent source of truth for schema.

### Frontend (React)

- Vite + TypeScript, React Router, TanStack Query for API calls, the PocketBase
  JS SDK for rooms/sessions/realtime. **[my call]**
- A router with one placeholder route per current Streamlit page, in the same
  order as the existing flow, with navigation between them.
- A working Lobby: create a room, join a room, see players join live, vote for a
  dataset, start. This is the proof that PocketBase plumbing works from React.
- A session provider that loads and saves the session record (replaces
  `session_persistence.py`).
- A typed API client generated from OpenAPI.
- No styling work beyond basic readable layout.

### Dev workflow

- One script (successor of `scripts/run_multiplayer.sh`) starts PocketBase, runs
  schema init, starts the API and the Vite dev server, and prints the LAN URLs.
  Reads `.env` (`MATELDA_BASE_URL` or successor). **[my call]**
- Vite proxies `/api` to FastAPI in dev, so the browser needs only one origin plus
  PocketBase.

## Constraints

- Python ML dependencies (torch, hdbscan, transformers, ...) stay pinned as in
  `requirements.txt`; `api/` runs in the existing environment, adding only
  FastAPI and uvicorn.
- `Matelda/` and `backend/` are not edited as part of the foundation, except for
  minimal changes strictly needed to import them from `api/`.
- The existing multiplayer data in `pb_data` must keep working (no destructive
  schema changes).
- Must work across the LAN, not only localhost.

## Done when

1. One command brings up PocketBase, API and frontend.
2. In two browsers on different origins/devices: one creates a room, the other
   joins it, both see each other live, votes are visible, and the room starts.
3. Reloading either browser restores the same room and place, via the PocketBase
   `sessions` record.
4. The frontend calls a real API endpoint (dataset list) through the generated
   client, and starts and polls one real background job (domain folding on a
   small dataset) through to a result.
5. Every current Streamlit page has a placeholder route in the React app.
6. A README section explains the layout and how to run it.

## Left to the builder

- Exact endpoint names and Pydantic models.
- Test setup (API tests with pytest; frontend tests are the builder's choice).
- Folder internals of `api/` and `frontend/`.
- How to report job progress, if `backend/` offers no progress hooks (a simple
  running/done/failed status is acceptable for the foundation).

## Open questions for the owner

None blocking after the calls above; see the list of calls in the hand-over message.
