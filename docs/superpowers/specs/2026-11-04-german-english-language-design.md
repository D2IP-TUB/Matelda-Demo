# German / English language switch: design

Date: 2026-11-04 · Status: draft for review

## Intent
Matelda is demoed to German-speaking audiences. Both groups should be able to read it in German: the people
watching the live dashboard on a projector, and the players going through the app on their phones. The
point is comfort for non-technical visitors. Matelda's technical vocabulary stays as it is.

## Goals
- A **DE / EN switch in the header** of:
  - the React app's top bar (`frontend/src/components/TopBar.tsx`), next to the theme toggle;
  - the live dashboard's top bar (`admin/index.html`), next to the theme toggle;
  - the landing page (`frontend/src/pages/Landing.tsx`), which has no top bar: top-right corner of the hero,
    in the landing's always-dark style.
- **Starts in English.** No browser-language detection.
- **Each device remembers its own choice** (like the theme, in `localStorage`). The projector and each phone
  are independent, and switching on one device never changes another. The app and the dashboard run on
  different origins (`:5173`/app host vs `:8090`), so they do not share the setting. That is acceptable.
- All everyday UI text is translated: buttons, headings, hints, info popovers, notices, empty and loading
  states, dialogs, stat labels, aria-labels and titles, and the dashboard's labels ("Top rooms", "correct", "Live",
  "Reconnecting…", the totals, column headers that are plain words like "Time", "Room", "Player").
- Switching applies immediately, without a reload, and keeps the player's place and state.
- `<html lang>` follows the chosen language.

## Non-goals: stays English in both languages
- **Dataset content**: table cell values, column names, table and dataset names, the landing's demo grid
  values. The user was explicit: *don't translate the tables*.
- **Technical terms**: pipeline step names (Lobby, Configurations, Domain Folding, Quality Folding, Labeling,
  Labeling Stats, Propagated Errors, Error Detection, Results, i.e. `PAGES` in `routes.ts`), detector names
  ("Typo Detector", "Outlier Detector", "Rule Violation Detector"), and metrics and terms such as precision,
  recall, F1, labeling budget, Raha, fold. When such a term sits inside a German sentence it keeps its English form.
- **The domain vocabulary**, too (user's choice: the "gelabelt" style). These words stay English inside German
  sentences, which are built around them with German grammar: *cell(s), label(s) / labeln / gelabelt, detector,
  pipeline, dataset, table, column, row, room, host, player, error(s), correct, accuracy / accurate*. Examples:
  "Sie haben 12 Cells gelabelt, 83 % correct" · swipe buttons stay "Error" / "Correct" · dashboard "12 correct",
  "3 players · 40 labels · 83 % accurate" may stay as is, but "Ranked by correct labels" becomes
  "Sortiert nach correct Labels". Treat any word not listed here by the same test: if it names a Matelda/data
  concept, keep it English; if it is ordinary connective language (join, start, wait, continue, back, leave, copy
  link, how it works, no results yet), translate it. Nouns kept in English are capitalised as German nouns
  where the sentence is German (Cells, Labels, Room).
- **Messages from the backend** (FastAPI errors and texts from Python): shown as received.
- Generated room names (`rooms/names.ts`, e.g. `sneaky-otter-79`) and player names.
- The Streamlit app (`pages/*.py`) and `DevPlayground`.

## Anti-goals: a failure even if it works
- Any dataset value or column name changing with the language.
- German that reads like machine translation, or German that translates the technical terms or the domain
  vocabulary (no "Zellen", "Fehler", "Raum", "bewertet").
- A layout that breaks because German strings are longer (buttons wrapping badly, chips overflowing at 375px).
- A heavy dependency or build change for what is a two-language string table.

## Decided
- Default language: English (user).
- Scope: app and dashboard (user).
- Tables and technical terms: untranslated (user), including the domain vocabulary listed above (user: "gelabelt").
- Landing button placement and backend messages staying English (proposed, user agreed).

## Builder's calls (mine, open to correction)
- **No i18n library.** A small typed module in the app (e.g. `src/i18n/`): `en.ts` as the source of keys,
  `de.ts` typed against it so a missing German key is a compile error, a `LanguageProvider` + `useT()` hook,
  storage key `matelda-lang`, mirroring `lib/theme.ts`. Simple `{name}` interpolation and singular/plural
  where counts appear ("1 player" / "2 players"). How keys are named is up to the builder.
- **Dashboard**: an inline `{ en: {...}, de: {...} }` object in `admin/index.html`, same storage key, applied
  before first paint like the theme. Dynamic strings (row meta, empty states) are rebuilt on switch.
- **Button**: a pill matching `.theme-toggle` height (36px; hit area ≥ 44px on touch), showing the *other*
  language code ("DE" while in English, "EN" while in German), with `aria-label` "Auf Deutsch umschalten" /
  "Switch to English" and `lang` set on the label.
- **German voice**: formal "Sie" (user), short and plain. Written by Claude, reviewed by the user before merge.
- **Tests**: existing tests keep asserting English (the default). Add tests that the switch flips visible
  text, persists, sets `<html lang>`, and leaves a dataset value and a step name unchanged. A type check covers
  German key completeness.
- Numbers keep the current formatting (e.g. `0.87`, `87%`) in both languages, so they match the tables.
