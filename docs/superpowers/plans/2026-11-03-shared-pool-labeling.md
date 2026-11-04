# Shared-Pool Room Labeling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a room, the host (the player who created it) runs the pipeline once and publishes the sampler's B cells as one shared pool; helpers see a "waiting for labeling" screen meanwhile, then label from the pool first-come-first-served without running any pipeline step. The lobby lets anyone leave or create a room, shows a QR code for the join address, and lets the host kick players.

**Architecture:** The pool (ordered cell keys), the host's pipeline name and the host player id live on the PocketBase `rooms` record. Players claim one cell at a time through the existing `claims` collection (unique `(room, cell_id)` index decides races), starting at a per-player offset. FastAPI stays stateless per player; two read-path caches remove repeated parsing.

**Tech Stack:** FastAPI + pytest (`api/`), React + Vitest (`frontend/`), PocketBase migrations (`pocketbase/pb_migrations/`).

**Spec:** Agreed in conversation (no written spec). Decisions: one shared budget B = pipeline `labeling_budget`; first-come-first-served claiming; host = room creator (first player to join a room with an empty `host`); host-only pipeline steps; helpers wait on a waiting screen until the pool is published; stale claims released by the host; host can kick; leaving passes the host role to the oldest remaining player; no per-player cap.

## Global Constraints

- Pool = exactly the sampler's cells; no filler cells from other folds.
- A cell is claimed by at most one player (the `idx_claims_cell` unique index is the arbiter).
- Helpers never call folding, propagation, detection or `/labeling/candidates`; they only call `/labeling/cards` and `/datasets/{ds}/judge`.
- Solo (no room) behaviour is unchanged.
- Kick/host checks are client-side only: the `rooms`/`players`/`claims` PocketBase rules are open (`""`), so this is a trust-based demo feature, not security. Say so in the UI-facing docs/comments, do not pretend otherwise.
- QR code uses one new dependency, `qrcode.react` (pin an exact version at least two weeks old); join URL is `${window.location.origin}/lobby?room=<name>`.
- Existing tests keep passing: `pytest` in the repo root, `npm test` in `frontend/`.

## Review Focus

- Helper opens Labeling before the host has published the pool: shows "Waiting for the host", then starts when the pool appears (no crash, no empty "finished" state).
- Pool exhausted (all claimed) while a player has no card: shows "All cells are claimed", Next still works.
- Player reloads mid-session: gets back their own unlabeled claims first, in the same order.
- Two players claim the same key at once: the loser moves to the next key; nobody gets a duplicate.
- Host releases claims: only claims **without a label** are deleted; labeled cells keep their owner.
- `B` larger than the number of available sampler cells: pool is smaller than B, no error.
- Kicked player: their open tab drops back to the lobby with "You were removed by the host", their unlabeled claims return to the pool, their labels stay.
- Host leaves or is kicked-by-nobody-but-disconnects: host passes to the oldest remaining player; last player leaving leaves an empty room without error.
- Session ended while a helper is mid-card: their last answer is not lost locally, no unhandled error from the failed share; opening an `ended` room's link shows "This session has ended" and does not add a player.
- Join link opened by someone already in another room: they leave the old room first, no double membership.

---

### Task 1: Candidates endpoint returns the sampler's cells only

**Files:**
- Modify: `api/labeling.py` (replace `candidate_keys`), `api/routes/labeling.py:labeling_candidates`
- Test: `api/tests/test_labeling.py`, `api/tests/test_labeling_routes.py`

**Interfaces:**
- Produces: `sampled_keys(sampled: list[dict[str, Any]]) -> list[str]` (order preserved, duplicates removed); `GET /pipelines/{name}/labeling/candidates` → `{keys, sample_size}` where `keys` has exactly `sample_size` entries.

- [ ] **Step 1: Write failing tests** — `test_sampled_keys_keeps_order_and_dedupes` (input three cells, one repeated → keys in sampler order, no repeat); route test `test_candidates_are_only_sampler_cells` (fake sampler returns 2 cells while `cell_folds` holds 6 → response `keys` has length 2 and `sample_size == 2`). Remove/replace the existing round-robin tests.
- [ ] **Step 2: Run** `pytest api/tests/test_labeling.py api/tests/test_labeling_routes.py -v` → new tests FAIL.
- [ ] **Step 3: Implement** `sampled_keys` in `api/labeling.py`, delete `candidate_keys`, and use `sampled_keys(sampled)` in `labeling_candidates` (drop the `skip` computation).
- [ ] **Step 4: Run** the same command → PASS; run `pytest` for the full suite.
- [ ] **Step 5: Commit** `feat(api): candidates are the sampler's cells only`.

### Task 2: Cache parsed pipeline configs and ground-truth frames

**Files:**
- Modify: `api/pipelines.py:load_config`, `api/labeling.py:judge`
- Test: `api/tests/test_pipelines.py`, `api/tests/test_labeling.py`

**Interfaces:**
- Produces: `load_config` unchanged signature; returns a cached parse keyed on `(path, st_mtime_ns, st_size)` and **never exposes mutable shared state** (callers get a deep copy or the cache stores the raw text and re-parses only on change — pick the copy approach). `save_config` invalidates the entry.

- [ ] **Step 1: Write failing tests** — `test_load_config_parses_once_until_file_changes` (patch `json.loads` with a counter: two loads → one parse; after `save_config` → second parse); `test_load_config_returns_independent_copies` (mutating the first result does not change the second); `test_judge_reads_each_csv_once_across_calls` (patch `pd.read_csv` counter: two `judge` calls on the same table → 2 reads total, not 4; touching the file re-reads).
- [ ] **Step 2: Run** `pytest api/tests/test_pipelines.py api/tests/test_labeling.py -v` → FAIL.
- [ ] **Step 3: Implement** a module-level dict cache in `pipelines.py` guarded by `_config_lock`-independent small lock; and an `lru`-style dict in `labeling.py` keyed on `(table_dir, mtime_ns)` for the `(dirty, clean)` pair, bounded to 64 entries.
- [ ] **Step 4: Run** the full backend suite → PASS.
- [ ] **Step 5: Commit** `perf(api): cache parsed configs and judge ground truth`.

### Task 3: PocketBase fields for the shared pool

**Files:**
- Create: `pocketbase/pb_migrations/<timestamp>_updated_rooms.js` (add fields), generate with the same tool as the existing migrations
- Modify: `frontend/src/lib/schema.d.ts` only if it lists room fields; `frontend/src/rooms/roomService.ts` (`Room` interface)
- Test: `api/tests/test_pocketbase_schema.py`

**Interfaces:**
- Produces: `rooms.pipeline: text`, `rooms.pool: json` (ordered array of cell keys), `rooms.host: text` (player id). All optional/empty by default. `Room` gains `pipeline?: string; pool?: string[]; host?: string`.

- [ ] **Step 1: Write failing test** in `test_pocketbase_schema.py` asserting the three fields exist on `rooms` (follow how that file already inspects migrations).
- [ ] **Step 2: Run** `pytest api/tests/test_pocketbase_schema.py -v` → FAIL.
- [ ] **Step 3: Add the migration** with an `up` that adds the fields and a `down` that removes them; update the `Room` interface.
- [ ] **Step 4: Run** the test → PASS.
- [ ] **Step 5: Commit** `feat(pocketbase): room pipeline, pool and host fields`.

### Task 4: Pool publishing, first-come claiming and claim release in `RoomService`

**Files:**
- Modify: `frontend/src/rooms/roomService.ts`
- Test: `frontend/src/rooms/roomService.test.ts`

**Interfaces:**
- Consumes: Task 3 fields.
- Produces:
  - `publishPool(room: Room, hostPlayerId: string, pipeline: string, keys: string[]): Promise<Room>` — sets `pipeline`, `pool`, `host`; no-op returning the room if `pool` is already non-empty (first publisher wins).
  - `claimNext(roomName: string, playerId: string, pool: string[]): Promise<string | null>` — returns the player's oldest own claim that has no label yet; otherwise creates a claim on the first free key scanning from offset `hash(playerId) % pool.length`, wrapping; `null` when the pool is exhausted.
  - `releaseUnlabeledClaims(roomName: string): Promise<number>` — deletes claims with no matching `(room, cell_id, player)` label; returns the count.
  - `claimHost(room: Room, player: Player): Promise<Room>` — sets `host = player.id` only if `room.host` is empty (re-reads the room first); returns the current room.
  - `leaveRoom(room: Room, player: Player): Promise<void>` — deletes the player's unlabeled claims and the player record; if `player.id === room.host`, sets `host` to the oldest remaining player's id (or `''` if none).
  - `endRoom(room: Room, hostId: string): Promise<Room>` — throws `RoomError` unless `room.host === hostId`; sets `phase = 'ended'` (free-text field, no migration). `Room.phase` type widens to `'lobby' | 'labeling' | 'ended'`.
  - `kickPlayer(room: Room, hostId: string, target: Player): Promise<void>` — throws `RoomError` unless `room.host === hostId` and `target.id !== hostId`; otherwise same cleanup as `leaveRoom` for `target`.
  - `publishPool` additionally throws `RoomError` unless `room.host === hostPlayerId`.
  - `claimCells` is removed (callers migrate in Task 6).

- [ ] **Step 1: Write failing tests** — `publishPool` stores fields and a second call does not overwrite; `claimNext` returns own unlabeled claim before taking a new one; `claimNext` skips keys claimed by another player; two players with different ids start at different pool positions on an empty claims table; unique-index conflict (fake `create` throws status 400 once) moves on to the next key; returns `null` when every key is claimed by others; `releaseUnlabeledClaims` deletes only unlabeled claims and returns how many; `claimHost` first caller wins, second is a no-op; `leaveRoom` removes the player and their unlabeled claims but keeps their labels, and hands the host role over (and to `''` when last); `endRoom` sets phase `ended` for the host and rejects everyone else; `kickPlayer` rejects non-hosts and kicking the host, and otherwise cleans up like `leaveRoom`; `publishPool` rejects non-hosts. Use the existing fake PocketBase in the test file.
- [ ] **Step 2: Run** `npm test -- roomService` (in `frontend/`) → FAIL.
- [ ] **Step 3: Implement** the three methods; `hash` is a small deterministic string hash (sum of char codes is enough). The fake's `delete` may need adding to the test helper.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(frontend): shared pool, first-come claims and claim release`.

### Task 5: Lobby — create, leave, QR code, host kick

**Files:**
- Modify: `frontend/src/pages/Lobby.tsx`, `frontend/src/components/TopBar.tsx`, `frontend/src/rooms/useRoomInfo.ts` (expose `me`, `isHost`, `room`)
- Create: `frontend/src/components/JoinQr.tsx` (renders `qrcode.react`'s `QRCodeSVG` for a URL, plus the URL as copyable text)
- Modify: `frontend/package.json` (+ lockfile) for `qrcode.react`
- Test: `frontend/src/pages/Lobby.test.tsx`

**Interfaces:**
- Consumes: Task 4 `claimHost`, `leaveRoom`, `kickPlayer`.
- Produces (page behaviour): after joining, the first player calls `claimHost`; the player list marks the host and shows a **Kick** button next to every other player, visible only to the host; a **Leave room** button clears `room_name`/`player_token` from the session (via `session.update`), calls `leaveRoom`, and returns to the create/join view (which keeps **Create room** and the join form); the room view shows `<JoinQr url={...} />` while the room is open; the **same Leave room button and, for the host only, an End session button live in `TopBar`**, so they are available on every page (lobby, waiting screen, labeling, results) and not only in the lobby; End session asks for confirmation, calls `endRoom`, and every player in the room (watching via `useRoomInfo`'s subscription) is shown "The host ended the session" and has the room keys cleared from the session, keeping their own `labeling_results`; leaving mid-labeling keeps the labels already shared; when the player's own record disappears (kicked), the page clears the session room keys and shows "You were removed by the host". Opening `?room=other` while in a room leaves the old room first.

- [ ] **Step 1: Write failing tests** — TopBar shows Leave on a non-lobby route and End session only for the host; confirming End session sets the room to `ended` and a helper's page then shows the ended notice and loses `room_name`; cancelling the confirm changes nothing; Leave during labeling keeps that player's labels in `labels` and frees their unlabeled claims; QR present with the exact join URL (`http://localhost:3000/lobby?room=<name>` in jsdom origin); first joiner becomes host and sees Kick buttons, a second joiner sees none; Kick removes the target from the list; Leave room clears session keys and shows Create/Join again; a kicked player's page (player record deleted, subscription fires) shows the removed message and has no room in the session; host leaving transfers the host marker to the next player; joining via `?room=` while in another room calls `leaveRoom` on the old one.
- [ ] **Step 2: Run** `npm test -- Lobby` → FAIL.
- [ ] **Step 3: Implement** the changes; install `qrcode.react` with an exact pinned version; keep existing dataset-vote and Start behaviour (Start is host-only now, others see "Waiting for the host to start").
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(frontend): lobby leave, create, QR code and host kick`.

### Task 6: Labeling page uses the shared pool

**Files:**
- Modify: `frontend/src/pages/Labeling.tsx`, `frontend/src/lib/api.ts` (no change expected beyond using `fetchCandidates`)
- Test: `frontend/src/pages/Labeling.test.tsx`

**Interfaces:**
- Consumes: Task 1 endpoint, Task 4 service methods, Task 3 room fields. The "waiting" state renders the `WaitingForLabeling` component from Task 7 (create it there; until then a plain notice is fine and Task 7 swaps it in).
- Produces (page behaviour): in a room, the pipeline name is `room.pipeline` for everyone; if the room has no pool and this player owns a configured pipeline with cell folds, they publish it (`fetchCandidates` → `publishPool`) and become host; otherwise the page shows "Waiting for the host to start labeling" and re-checks on the room subscription (`service.subscribe`). Cards are loaded one at a time: after each answer, `claimNext` then `fetchCards(pipeline, [key])`; `null` shows "All cells are claimed". A "Release unlabeled claims" button is visible only to the host and calls `releaseUnlabeledClaims`. Solo mode is untouched.

- [ ] **Step 1: Write failing tests** replacing the old claim tests (`claims exactly the player budget…`, `another player's claims are skipped`): host publishes the pool once and `fetchCandidates` is called by the host only; helper with no pool shows the waiting notice and does **not** call `fetchCandidates`/`startPropagation`-related endpoints; helper starts when the pool appears; answering a card claims the next and fetches only that card; reload resumes own unlabeled claim; pool exhausted shows the claimed notice and Next stays enabled; release button hidden for helpers and, for the host, calls the service and shows the count.
- [ ] **Step 2: Run** `npm test -- Labeling` → FAIL.
- [ ] **Step 3: Implement** in `Labeling.tsx`: derive `pipelineName` from `room.pipeline ?? session pipeline`; replace the single `cards` query's room branch with pool-driven incremental loading (a `useState` list appended per claim, seeded with already-answered own claims so reload keeps order); keep solo branch as is. Update the room `Notice` copy to say cells are shared out first-come.
- [ ] **Step 4: Run** `npm test` (whole frontend) → PASS.
- [ ] **Step 5: Commit** `feat(frontend): label from a shared room pool`.

### Task 7: Waiting screen and host-only gating for helpers

**Files:**
- Modify: `frontend/src/App.tsx` / the step navigation that sends a room player through Configurations → Quality Folding (locate it first; do not restructure unrelated routing)
- Test: matching `*.test.tsx`

**Interfaces:**
- Consumes: Task 3 `room.host`.
- Produces: `WaitingForLabeling` component (`frontend/src/components/WaitingForLabeling.tsx`) showing "Waiting for labeling — the host is preparing the cells" with the live player list; a helper (room player who is not the host) on any pipeline step route (Intro onward through Quality Folding) sees it instead of the page; when `room.pool` becomes non-empty (room subscription) it navigates to `/labeling`. The host and solo users see all pages unchanged. Once the pool exists, helpers can also open Labeling directly.

- [ ] **Step 1: Write failing tests**: helper in a started room without a pool sees the waiting screen on `/configuration` and `/quality-folding`, with no "Run" button and no API calls to folding endpoints; publishing the pool (fake PocketBase update fires the subscription) navigates the helper to Labeling; host and solo users see the pages unchanged; a helper in the lobby phase is not redirected.
- [ ] **Step 2: Run** the affected test files → FAIL.
- [ ] **Step 3: Implement** a small `useRoomRole()` hook returning `'solo' | 'host' | 'helper'` and use it in the lobby redirect and the pages above.
- [ ] **Step 4: Run** `npm test` and `pytest` → PASS.
- [ ] **Step 5: Commit** `feat(frontend): helpers skip the pipeline steps`.

---

## Self-review notes

- `merge_with_pool` is left as is: with disjoint cells every cell has a single vote, so there are no ties and the result equals a plain union. Simplifying it would be churn without behaviour change.
- Stale-claim handling is a host button (Task 4/5), not a timeout; a heartbeat is deliberately out of scope.
- Per-player cap is out of scope.
- **Discovered gap:** before this plan each player's pipeline lived in their own session (`pipeline_path`); rooms had no notion of a host or shared pipeline. Tasks 3, 5 and 6 add that.
