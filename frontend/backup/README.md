# UI backup, v1 (2026-11-03)

`ui-v1-2026-11-03.tar.gz` holds the frontend UI as it was before the "stage" restyle:
`index.html`, `src/App.tsx`, `src/main.tsx`, `src/routes.ts`, `src/pages/`, `src/components/`, `src/styles/`.

Restore (from `frontend/`; this overwrites the current files):

    tar xzf backup/ui-v1-2026-11-03.tar.gz

List the contents without restoring:

    tar tzf backup/ui-v1-2026-11-03.tar.gz | head
