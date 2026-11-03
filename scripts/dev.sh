#!/usr/bin/env bash
# Starts PocketBase (rooms DB + live dashboard), the FastAPI backend and the React dev server.
# Reads MATELDA_BASE_URL from .env only for its host (e.g. http://192.168.188.21:8501);
# the React app is served on port 5173. Defaults to localhost.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && { set -a; . ./.env; set +a; }

BASE="${MATELDA_BASE_URL:-http://localhost:5173}"
HOST="${BASE#*://}"; HOST="${HOST%%[:/]*}"
BIND="0.0.0.0"; case "$HOST" in localhost|127.0.0.1) BIND="127.0.0.1";; esac
FRONTEND_URL="${MATELDA_FRONTEND_URL:-http://$HOST:5173}"

PIDS=()
cleanup() { for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

(exec pocketbase/pocketbase serve --http="$BIND:8090" --publicDir=admin) &
PIDS+=($!)
for _ in $(seq 1 30); do
  curl -sf "http://127.0.0.1:8090/api/health" >/dev/null && break
  sleep 1
done
venv/bin/python scripts/init_pocketbase.py

(exec env API_CORS_ORIGINS="$FRONTEND_URL" venv/bin/uvicorn api.main:app --host 127.0.0.1 --port 8000) &
PIDS+=($!)

(cd frontend && exec node_modules/.bin/vite --host "$BIND" --port 5173 --strictPort) &
PIDS+=($!)

echo "Players:   $FRONTEND_URL/lobby"
echo "Dashboard: http://$HOST:8090/?join=$FRONTEND_URL/lobby"
wait
