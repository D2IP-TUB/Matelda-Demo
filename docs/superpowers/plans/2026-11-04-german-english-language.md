# German / English Language Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A DE/EN switch in the app's top bar, on the landing page and in the live dashboard. It starts in English, each device remembers its choice, and German UI text uses "Sie" while dataset content and the Matelda vocabulary stay English.

**Architecture:** A dependency-free module `frontend/src/i18n/` holds a module-level language store (read with `useSyncExternalStore`, so components need **no provider** and existing tests that render without one keep working). Messages are plain nested objects: `en.ts` is the source and defines the type, and `de.ts` is typed against it, so a missing or mis-shaped German entry is a `tsc` error. Strings with counts or names are functions (`(n: number) => string`), so there is no interpolation engine. The dashboard (`admin/index.html`, served by PocketBase, separate origin) gets its own inline `{ en, de }` table and the same storage key.

**Tech Stack:** React 19 + TypeScript + Vitest/Testing Library (`frontend/`), plain HTML/JS (`admin/index.html`).

**Spec:** `docs/superpowers/specs/2026-11-04-german-english-language-design.md`

## Global Constraints

- Default language `en`. No browser-language detection. Storage key `matelda-lang`, values `'en' | 'de'`. Anything else counts as `en`.
- `<html lang>` always equals the active language, in the app and in the dashboard.
- Switching never reloads the page, and never loses route, room, swipe position or form input.
- **Never translated:** dataset content (cell values, column/table/dataset names, landing demo grid), step names (`PAGES` titles in `routes.ts`), detector names, metrics (precision, recall, F1, labeling budget, Raha, fold), backend/API messages, room and player names.
- **Domain vocabulary stays English inside German sentences** (German grammar, nouns capitalised): cell(s), label(s)/labeln/gelabelt, detector, pipeline, dataset, table, column, row, room, host, player, error(s), correct, accuracy/accurate. Example: "Sie haben 12 Cells gelabelt, 83 % correct". Swipe verdict buttons stay "Error"/"Correct". Ordinary words (join, start, wait, continue, back, leave, copy link, how it works, no results yet) are translated.
- German voice: formal **"Sie"**, short, plain. No "Zellen", "Fehler", "Raum", "bewertet".
- Number formatting unchanged in both languages (`0.87`, `87%`).
- No new dependencies.
- Existing tests keep passing unchanged in English: `npm test` and `npm run build` (runs `tsc -b`) in `frontend/`.

## Review Focus

- **Switch mid-flow** (e.g. on Labeling with a card on screen, or Configurations with edited fields): the text flips and the card index, room and inputs are unchanged. Pinned in Task 2 (TopBar test keeps a typed-in value) and Task 6 (Labeling keeps the current card).
- **Garbage in storage** (`matelda-lang = "fr"`, or storage throwing): the app runs in English without crashing. Pinned in Task 1.
- **Long German at 375px**: buttons and chips wrap without horizontal scroll. This is a manual check in every page task, listed in Task 8's final verification.
- **Text created outside components** (frontend-made error strings in `lib/`, `rooms/`, `session/`) must follow the language too: use `t()` (non-hook) at the moment the message is created. Pinned in Task 4 (Lobby join error shown in German).
- **Dashboard switch while live**: rows, meta, empty states and status ("Live") re-render in the new language without waiting for the next PocketBase event. Pinned in Task 8 (manual check list).

---

### Task 1: i18n core and language toggle

**Files:**
- Create: `frontend/src/i18n/index.ts`, `frontend/src/i18n/en.ts`, `frontend/src/i18n/de.ts`, `frontend/src/i18n/i18n.test.ts`
- Create: `frontend/src/components/LanguageToggle.tsx`, `frontend/src/components/LanguageToggle.test.tsx`
- Modify: `frontend/index.html` (pre-paint script), `frontend/src/test/setup.ts` (reset after each test), `frontend/src/styles/app.css` (`.lang-toggle` next to `.theme-toggle`)

**Interfaces:**
- Produces, `i18n/index.ts`:
  - `type Lang = 'en' | 'de'`, `const LANG_KEY = 'matelda-lang'`
  - `getLang(): Lang`: stored value if valid, else `'en'`. Never throws.
  - `setLang(lang: Lang): void`: stores (ignoring storage errors), sets `document.documentElement.lang`, notifies subscribers.
  - `useLang(): Lang`: hook (`useSyncExternalStore`).
  - `useT(): Messages`: hook, returns `messages[useLang()]`.
  - `t(): Messages`: non-hook, for strings built outside React.
- Produces, `i18n/en.ts`: `export const en = { common: {…}, … }` and `export type Messages = typeof en`. Later tasks **add one namespace each** (`topbar`, `landing`, `lobby`, …) to `en` and `de`.
- Produces, `i18n/de.ts`: `export const de: Messages = { … }`.
- Produces: `<LanguageToggle className?: string />`, a `button.lang-toggle` whose text is the *other* code (`DE` while en, `EN` while de), with `lang` = the target language and `aria-label`/`title` = `"Auf Deutsch umschalten"` (while en) or `"Switch to English"` (while de). Same 36px size and pill look as `.theme-toggle`, with the hit area extended to 44px on `(pointer: coarse)`.

- [ ] **Step 1: Write failing tests** in `i18n.test.ts`:
  - `defaults to English`: with storage empty, `getLang() === 'en'`.
  - `ignores an invalid stored value`: `localStorage.setItem('matelda-lang','fr')` → `getLang() === 'en'`.
  - `survives storage that throws`: `vi.spyOn(Storage.prototype,'getItem').mockImplementation(() => { throw new Error() })` → `getLang() === 'en'`; `setLang('de')` does not throw.
  - `setLang stores, sets html lang and notifies`: after `setLang('de')`: `localStorage.getItem('matelda-lang') === 'de'`, `document.documentElement.lang === 'de'`, and a component rendering `useT().common.<any key>` re-renders with the German value (wrap the call in `act`).
  
  In `LanguageToggle.test.tsx`:
  - `shows the other language and switches`: renders the button with name `"Auf Deutsch umschalten"` and text `DE`. After a click, `getLang() === 'de'`, the button text is `EN` and its name is `"Switch to English"`.
- [ ] **Step 2: Run** `npx vitest run src/i18n src/components/LanguageToggle.test.tsx`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the three i18n files (start `en.common` with the keys the toggle and theme toggle need), `LanguageToggle.tsx`, and `.lang-toggle` CSS using tokens only. In `setup.ts` add `afterEach(() => { setLang('en'); localStorage.removeItem('matelda-lang') })`.
- [ ] **Step 4: Add the pre-paint line** to `frontend/index.html` next to the theme script: read `matelda-lang`, and if it is `'de'` set `document.documentElement.lang = 'de'` (inside `try`).
- [ ] **Step 5: Run** `npx vitest run src/i18n src/components/LanguageToggle.test.tsx && npm run build`. Expected: PASS, build succeeds.
- [ ] **Step 6: Commit** `feat(frontend): i18n core with a DE/EN language toggle`.

### Task 2: App shell (top bar, theme toggle, step tracker, shared components)

**Files:**
- Modify: `components/TopBar.tsx` (render `<LanguageToggle />` just before `<ThemeToggle />`), `ThemeToggle.tsx`, `StepTracker.tsx`, `Layout.tsx`, `ui.tsx`, `forms.tsx`, `JoinQr.tsx`, `TableModal.tsx`, `DataTable.tsx`, `SwipeDeck.tsx`, `foldBoard.tsx`, `WaitingForLabeling.tsx`, `StepSlot.tsx` (all under `frontend/src/`)
- Modify: `i18n/en.ts`, `i18n/de.ts`: namespaces `topbar`, `shell`, `ui`
- Test: `components/shell.test.tsx`, add a `describe('German')` block

**Interfaces:**
- Consumes: `useT`, `setLang`, `LanguageToggle` from Task 1.

- [ ] **Step 1: Write failing tests** in `shell.test.tsx`:
  - `TopBar shows the language toggle`: `getByRole('button', { name: 'Auf Deutsch umschalten' })` exists.
  - `switching to German translates the shell but not step names`: `act(() => setLang('de'))`, render `TopBar` + `StepTracker`. The text `de.topbar.<leave-room key>` is visible (in a room via `seedSession`). Every `PAGES` title is still visible verbatim, e.g. `getByText('Domain Folding')`. The theme toggle's name equals `de.common.<switch-to-dark key>`.
  - `switching keeps page state`: render a `Layout` route whose page has an `<input>`, type `abc`, click the language toggle, and the input still has value `abc`.
- [ ] **Step 2: Run** `npx vitest run src/components/shell.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Replace every user-visible English literal** in the listed components (text, `aria-label`, `title`, `placeholder`, `alt`) with `useT()` lookups. Leave step names, detector names and data values as they are. Counts become functions (e.g. `topbar.players: (n: number) => …`, with German `1 Player` / `3 Player`).
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: all PASS (old English assertions still hold).
- [ ] **Step 5: Commit** `feat(frontend): translate the app shell`.

### Task 3: Landing page

**Files:** Modify `pages/Landing.tsx`, `styles/pages/landing.css`, `i18n/en.ts`, `i18n/de.ts` (namespace `landing`). Create test `pages/Landing.test.tsx`.

- [ ] **Step 1: Write failing tests:**
  - `has a language toggle`: name `Auf Deutsch umschalten`.
  - `German hero, English demo data`: after `setLang('de')`, `getByRole('heading', { level: 1 })` contains `de.landing.<headline key>`, and the first demo card value `'Hamburg 1,5'` plus its detector pill `'Typo Detector'` are still present.
- [ ] **Step 2: Run** `npx vitest run src/pages/Landing.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Place `<LanguageToggle className="lp-lang" />` absolutely in the top-right corner of `.lp-hero` (`top: var(--s-4); right: max(var(--s-4), env(safe-area-inset-right))`), styled with the landing's own dark variables (`--lp-surface-2`, `--lp-text`, `--lp-line`), because the landing is always dark. Translate headline, lead, CTA, section copy and verdict stamps per the vocabulary rule. `EXAMPLES` stays untouched.
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): German landing page with language toggle`.

### Tasks 4–7: Pages

Each page task uses the same five steps. **Files:** the page `.tsx` files, any page-local helpers they own (including frontend-made error strings in `lib/`, `rooms/`, `session/`, built with `t()` at creation time), `i18n/en.ts` + `i18n/de.ts` (one namespace per page, named after the page in camelCase), and each page's existing `.test.tsx`, where a `describe('German')` block is added.

1. **Write failing tests**: per page, at least (a) after `setLang('de')` the page heading or primary action shows the `de.<page>.…` value, (b) one dataset value or column name from the test fixture is unchanged, and (c) the task-specific test listed below.
2. **Run** `npx vitest run src/pages/<Page>.test.tsx`. Expected: FAIL.
3. **Replace literals** with `useT()` / `t()` as in Task 2.
4. **Run** `npm test && npm run build`. Expected: PASS. Check by hand at 375px width in German (`npm run dev`) that nothing overflows.
5. **Commit** `feat(frontend): German <pages>`.

- **Task 4: Lobby, Configurations.** Task-specific test: a frontend-made join/kick error (e.g. the "room not found" or "could not remove the player" message) renders in German when `lang = de`.
- **Task 5: Domain Folding, Quality Folding.** Task-specific test: fold/table names from the fixture are unchanged in German.
- **Task 6: Labeling, Labeling Stats.** Task-specific tests: (1) verdict buttons keep the names `Error` and `Correct` in German; (2) switching language while a card is shown keeps the same cell value on screen (no re-fetch, same index); (3) on Labeling Stats, the stat tile labels are German and the leaderboard player names are unchanged.
- **Task 7: Propagated Errors, Error Detection, Results.** Task-specific test: on Results the metric labels `Precision`, `Recall`, `F1` stay English and numbers keep `0.87` style. Share text: translate the sentence and keep the metric names.

### Task 8: Live dashboard (`admin/index.html`)

**Files:** Modify `admin/index.html`. No automated test harness exists for this page; verification is manual against a running PocketBase.

**Interfaces:** self-contained. It reuses the storage key `matelda-lang` and the toggle look and labels from Task 1 (copy the CSS, since this page has no build).

- [ ] **Step 1: Add the pre-paint language read** to the existing head script: `?lang=de|en` wins, then `localStorage['matelda-lang']`, else `en`. Set `document.documentElement.lang`.
- [ ] **Step 2: Add `const I18N = { en: {…}, de: {…} }`** and `function T(key, ...args)` (values are strings or functions). Mark static text with `data-i18n="key"` and fill it in `applyLang()`. Cover: status (Connecting…/Live/Reconnecting…), totals labels, board titles and subtitles, `correct` unit, row meta builders, empty states, table headers (Time/Room/Player/Budget translated per the vocabulary rule, Precision/Recall/F1 not), theme-toggle aria-label/title. German examples: `Sortiert nach correct Labels (Labels × Accuracy)`, `Warten auf die ersten Labels…`, `Noch keine abgeschlossenen Runs. Ergebnisse erscheinen hier, sobald Rooms die Pipeline beenden.`
- [ ] **Step 3: Add the toggle** `button.lang-toggle#lang` before `#theme` in `.bar-end`, with the same text and labels as `LanguageToggle`. On click: store, set `<html lang>`, call `applyLang()`, then `refresh()` so rows and meta rebuild immediately.
- [ ] **Step 4: Verify by hand** with PocketBase running at `http://127.0.0.1:8090/`: (a) default English; (b) click DE: every label flips, room/player names and dataset names stay, F1 column header stays; (c) reload: still German; (d) `?lang=en` overrides; (e) 375px width: no horizontal scroll; (f) switching while live: rows re-render immediately. Also syntax-check the inline scripts with `node --check` on extracted copies.
- [ ] **Step 5: Final check of the whole branch:** `cd frontend && npm test && npm run build && npm run lint`. Expected: all pass. Then click through every page in German at 375px and 1280px, in both themes.
- [ ] **Step 6: Commit** `feat(dashboard): German / English language switch`.
