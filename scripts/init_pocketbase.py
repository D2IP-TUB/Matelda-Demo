"""Create the PocketBase collections used for multiplayer rooms (idempotent).

Requires PocketBase v0.23+ running at PB_URL (default http://127.0.0.1:8090).
All API rules are left empty (public) so the browser dashboard can subscribe
without auth; this is a demo setup, not for sensitive data.
"""
import os
import requests

PB_URL = os.environ.get("PB_URL", "http://127.0.0.1:8090")
EMAIL = os.environ.get("PB_ADMIN_EMAIL", "admin@matelda.local")
PASSWORD = os.environ.get("PB_ADMIN_PASSWORD", "matelda-admin-pw")


def text(name, required=False):
    return {"name": name, "type": "text", "required": required}


def number(name):
    return {"name": name, "type": "number"}


def json_field(name):
    # maxSize raised from the 1 MB default: fold results can be large.
    return {"name": name, "type": "json", "maxSize": 5 * 1024 * 1024}


CREATED = {"name": "created", "type": "autodate", "onCreate": True}


COLLECTIONS = [
    {
        "name": "rooms",
        "fields": [CREATED, text("name", True), text("phase", True), text("dataset")],
        "indexes": ["CREATE UNIQUE INDEX idx_rooms_name ON rooms (name)"],
    },
    {
        "name": "players",
        "fields": [CREATED, text("room", True), text("token", True), text("name", True),
                   number("budget"), text("vote")],
        "indexes": [
            "CREATE UNIQUE INDEX idx_players_token ON players (token)",
            "CREATE UNIQUE INDEX idx_players_room_name ON players (room, name)",
        ],
    },
    {
        "name": "claims",
        "fields": [CREATED, text("room", True), text("cell_id", True), text("player", True)],
        "indexes": ["CREATE UNIQUE INDEX idx_claims_cell ON claims (room, cell_id)"],
    },
    {
        "name": "labels",
        "fields": [CREATED, text("room", True), text("player", True), text("cell_id", True),
                   {"name": "value", "type": "bool"},
                   {"name": "is_correct", "type": "bool"}, number("latency_ms")],
        "indexes": ["CREATE UNIQUE INDEX idx_labels_cell ON labels (room, cell_id, player)"],
    },
    {
        "name": "runs",
        "fields": [CREATED, text("room", True), text("player", True), text("player_name"),
                   text("dataset"), number("budget"), number("precision"), number("recall"),
                   number("f1")],
        "indexes": ["CREATE INDEX idx_runs_room ON runs (room)"],
    },
    {
        "name": "sessions",
        "fields": [CREATED, text("sid", True), json_field("data")],
        "indexes": ["CREATE UNIQUE INDEX idx_sessions_sid ON sessions (sid)"],
    },
]


def main():
    r = requests.post(f"{PB_URL}/api/collections/_superusers/auth-with-password",
                      json={"identity": EMAIL, "password": PASSWORD})
    r.raise_for_status()
    headers = {"Authorization": r.json()["token"]}
    existing = {c["name"] for c in requests.get(
        f"{PB_URL}/api/collections?perPage=200", headers=headers).json()["items"]}
    for col in COLLECTIONS:
        if col["name"] in existing:
            requests.patch(f"{PB_URL}/api/collections/{col['name']}",
                           json={"indexes": col["indexes"]}, headers=headers).raise_for_status()
            print(f"synced indexes of {col['name']}")
            continue
        body = {**col, "type": "base", "listRule": "", "viewRule": "",
                "createRule": "", "updateRule": "", "deleteRule": ""}
        requests.post(f"{PB_URL}/api/collections", json=body,
                      headers=headers).raise_for_status()
        print(f"created {col['name']}")


if __name__ == "__main__":
    main()
