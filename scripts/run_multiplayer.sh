#!/usr/bin/env bash
# Starts PocketBase (rooms DB + live dashboard) and the Streamlit app.
# Reads MATELDA_BASE_URL from .env (e.g. http://192.168.188.21:8501); defaults to localhost.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && { set -a; . ./.env; set +a; }

export MATELDA_BASE_URL="${MATELDA_BASE_URL:-http://localhost:8501}"
HOST="${MATELDA_BASE_URL#*://}"; HOST="${HOST%%[:/]*}"
BIND="0.0.0.0"; case "$HOST" in localhost|127.0.0.1) BIND="127.0.0.1";; esac

pocketbase/pocketbase serve --http="$BIND:8090" --publicDir=admin &
PB_PID=$!
trap 'kill $PB_PID 2>/dev/null' EXIT
sleep 2
python3 scripts/init_pocketbase.py

export PB_URL="http://127.0.0.1:8090"
echo "Players:   $MATELDA_BASE_URL/Lobby"
echo "Dashboard: http://$HOST:8090/?join=$MATELDA_BASE_URL/Lobby"
venv/bin/streamlit run app.py --server.address "$BIND" --server.port 8501
