"""PocketBase-backed storage for multiplayer rooms.

Thin REST wrapper (no extra dependency beyond `requests`). Collections are
created by scripts/init_pocketbase.py.
"""
from __future__ import annotations

import os
import random
import secrets
from collections import Counter
from statistics import median
from typing import Any, Dict, List, Optional

import requests

def _load_dotenv() -> None:
    """Read KEY=VALUE lines from the project's .env (existing env vars win)."""
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    os.environ.setdefault(key.strip(), value.strip().strip("\"'"))
    except OSError:
        pass

_load_dotenv()
PB_URL = os.environ.get("PB_URL", "http://127.0.0.1:8090")

ADJECTIVES = [
    "Blue", "Sneaky", "Fluffy", "Grumpy", "Cosmic", "Wobbly", "Turbo", "Sleepy",
    "Dizzy", "Funky", "Spicy", "Mighty", "Lazy", "Jolly", "Quirky", "Salty",
]
NOUNS = [
    "Banana", "Penguin", "Waffle", "Llama", "Pickle", "Narwhal", "Muffin", "Otter",
    "Taco", "Walrus", "Noodle", "Badger", "Pretzel", "Koala", "Falafel", "Yeti",
]

TEAM_COLORS = ['#f4b11c', '#4cc9f0', '#3ddc97', '#ff6b6b', '#b388ff', '#ff8fab', '#7bd88f', '#ff9f43', '#5aa9ff', '#e6e65a']

def room_color(room_name: str) -> str:
    """Team color of a room (same hash/palette as teamColor() in admin/index.html)."""
    h = 0
    for ch in room_name:
        h = (h * 31 + ord(ch)) % 2**32
    return TEAM_COLORS[h % len(TEAM_COLORS)]

class RoomError(Exception):
    pass

def _api(path: str) -> str:
    return f"{PB_URL}/api/collections/{path}"

def _list(collection: str, filter_: str = "", **params) -> List[Dict[str, Any]]:
    out, page = [], 1
    while True:
        r = requests.get(
            _api(f"{collection}/records"),
            params={"filter": filter_, "perPage": 200, "page": page, **params},
            timeout=5,
        )
        r.raise_for_status()
        data = r.json()
        out += data["items"]
        if page >= data["totalPages"]:
            return out
        page += 1

def _create(collection: str, body: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Create a record; returns None on a unique-constraint (400) conflict."""
    r = requests.post(_api(f"{collection}/records"), json=body, timeout=5)
    if r.status_code == 400:
        return None
    r.raise_for_status()
    return r.json()

def _update(collection: str, rec_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    r = requests.patch(_api(f"{collection}/records/{rec_id}"), json=body, timeout=5)
    r.raise_for_status()
    return r.json()

# ----------------------------
# Rooms
# ----------------------------
def create_room() -> Dict[str, Any]:
    for _ in range(20):
        name = f"{random.choice(ADJECTIVES)}-{random.choice(NOUNS)}-{random.randint(10, 99)}".lower()
        rec = _create("rooms", {"name": name, "phase": "lobby", "dataset": ""})
        if rec:
            return rec
    raise RoomError("Could not allocate a room name")

def get_room(name: str) -> Optional[Dict[str, Any]]:
    items = _list("rooms", f'name="{name}"')
    return items[0] if items else None

def start_room(room: Dict[str, Any]) -> Dict[str, Any]:
    """Lock the room: the most-picked dataset wins, ties are broken randomly."""
    if room["phase"] != "lobby":
        return room
    votes = Counter(p["vote"] for p in list_players(room["name"]) if p["vote"])
    if not votes:
        raise RoomError("Nobody picked a dataset yet")
    top = max(votes.values())
    dataset = random.choice([d for d, n in votes.items() if n == top])
    return _update("rooms", room["id"], {"phase": "labeling", "dataset": dataset})

# ----------------------------
# Players
# ----------------------------
def join_room(room_name: str, token: Optional[str] = None) -> Dict[str, Any]:
    """Rejoin with a known token, otherwise join with a fresh unique funny name."""
    if token:
        items = _list("players", f'token="{token}" && room="{room_name}"')
        if items:
            return items[0]
    taken = {p["name"] for p in list_players(room_name)}
    for _ in range(50):
        name = f"{random.choice(ADJECTIVES)} {random.choice(NOUNS)}"
        if name in taken:
            continue
        rec = _create("players", {
            "room": room_name, "token": secrets.token_urlsafe(12),
            "name": name, "budget": 10, "vote": "",
        })
        if rec:
            return rec
        taken = {p["name"] for p in list_players(room_name)}
    raise RoomError("No free player names left in this room")

def get_player(room_name: str, token: str) -> Optional[Dict[str, Any]]:
    items = _list("players", f'token="{token}" && room="{room_name}"')
    return items[0] if items else None

def list_players(room_name: str) -> List[Dict[str, Any]]:
    return _list("players", f'room="{room_name}"', sort="created")

def set_vote(player: Dict[str, Any], dataset: str) -> None:
    _update("players", player["id"], {"vote": dataset})

def set_budget(player: Dict[str, Any], budget: int) -> None:
    _update("players", player["id"], {"budget": budget})

# ----------------------------
# Claims and labels
# ----------------------------
def claim_cells(room_name: str, player_id: str, candidates: List[str], n: int) -> List[str]:
    """Claim up to n cells from `candidates` (priority order). The unique
    (room, cell_id) index decides races between players."""
    mine = {c["cell_id"] for c in _list("claims", f'room="{room_name}" && player="{player_id}"')}
    got = [c for c in candidates if c in mine][:n]
    for cell_id in candidates:
        if len(got) >= n:
            break
        if cell_id in mine:
            continue
        if _create("claims", {"room": room_name, "cell_id": cell_id, "player": player_id}):
            got.append(cell_id)
    return got

def save_label(room_name: str, player_id: str, cell_id: str, value: bool,
               is_correct: Optional[bool], latency_ms: int) -> None:
    """Store a player's verdict on a cell; a second save by the same player overwrites it."""
    body = {
        "room": room_name, "player": player_id, "cell_id": cell_id,
        "value": value, "is_correct": bool(is_correct), "latency_ms": latency_ms,
    }
    if _create("labels", body):
        return
    existing = _list("labels", f'room="{room_name}" && cell_id="{cell_id}" && player="{player_id}"')
    if existing:
        _update("labels", existing[0]["id"], body)


def room_labels(room_name: str) -> List[Dict[str, Any]]:
    """All labels currently in the room (used as the snapshot for a run)."""
    return _list("labels", f'room="{room_name}"')

# ----------------------------
# Pipeline runs (precision / recall / F1)
# ----------------------------
def save_run(room: Dict[str, Any], player: Dict[str, Any], budget: int,
             precision: float, recall: float, f1: float) -> None:
    """Record the metrics of one finished pipeline run (shown on the dashboard)."""
    _create("runs", {
        "room": room["name"], "player": player["id"], "player_name": player["name"],
        "dataset": room.get("dataset", ""), "budget": budget,
        "precision": precision, "recall": recall, "f1": f1,
    })

def list_runs(room_name: str) -> List[Dict[str, Any]]:
    return _list("runs", f'room="{room_name}"', sort="-created")

# ----------------------------
# Dashboard aggregates
# ----------------------------
def player_ranking(room_name: str) -> List[Dict[str, Any]]:
    labels = room_labels(room_name)
    rows = []
    for p in list_players(room_name):
        mine = [l for l in labels if l["player"] == p["id"]]
        correct = sum(1 for l in mine if l["is_correct"])
        rows.append({"name": p["name"], "labels": len(mine), "correct": correct,
                     "budget": p["budget"],
                     "accuracy": correct / len(mine) if mine else 0.0})
    return sorted(rows, key=lambda r: (r["correct"], r["labels"]), reverse=True)

def player_stats(room_name: str) -> List[Dict[str, Any]]:
    """Per-player label stats for the Results page (display only, nobody is excluded)."""
    labels = room_labels(room_name)
    rows = []
    for p in list_players(room_name):
        mine = [l for l in labels if l["player"] == p["id"]]
        if not mine:
            continue
        correct = sum(1 for l in mine if l["is_correct"])
        said_error = sum(1 for l in mine if not l["value"])
        rows.append({
            "id": p["id"], "name": p["name"], "labels": len(mine), "correct": correct,
            "accuracy": correct / len(mine),
            "median_ms": int(median(l["latency_ms"] for l in mine)),
            "error_share": said_error / len(mine),
        })
    return sorted(rows, key=lambda r: (r["correct"], r["labels"]), reverse=True)


def room_ranking() -> List[Dict[str, Any]]:
    counts = Counter(l["room"] for l in _list("labels", fields="room"))
    players = Counter(p["room"] for p in _list("players", fields="room"))
    rooms = _list("rooms")
    return sorted(
        ({"room": r["name"], "dataset": r["dataset"], "labels": counts[r["name"]],
          "players": players[r["name"]]} for r in rooms),
        key=lambda r: r["labels"], reverse=True,
    )
