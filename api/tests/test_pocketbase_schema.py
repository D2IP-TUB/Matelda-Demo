import os
import uuid

import pytest
import requests

PB_URL = os.environ.get("PB_URL", "http://127.0.0.1:8090")


def _pb_up() -> bool:
    try:
        return requests.get(f"{PB_URL}/api/health", timeout=1).ok
    except requests.RequestException:
        return False


pytestmark = pytest.mark.skipif(not _pb_up(), reason="PocketBase is not running")


def test_sessions_collection_roundtrip():
    sid = uuid.uuid4().hex
    created = requests.post(
        f"{PB_URL}/api/collections/sessions/records",
        json={"sid": sid, "data": {"room_name": "x"}},
    )
    assert created.status_code == 200, created.text
    rec_id = created.json()["id"]
    try:
        found = requests.get(
            f"{PB_URL}/api/collections/sessions/records", params={"filter": f'sid="{sid}"'}
        ).json()["items"]
        assert found[0]["data"] == {"room_name": "x"}
        duplicate = requests.post(
            f"{PB_URL}/api/collections/sessions/records", json={"sid": sid, "data": {}}
        )
        assert duplicate.status_code == 400
    finally:
        requests.delete(f"{PB_URL}/api/collections/sessions/records/{rec_id}")


def test_rooms_migration_adds_pool_fields():
    from pathlib import Path

    migrations = Path(__file__).resolve().parents[2] / "pocketbase" / "pb_migrations"
    text = "\n".join(p.read_text() for p in sorted(migrations.glob("*_updated_rooms.js")))
    assert "pbc_3085411453" in text
    for name, kind in (("pipeline", "text"), ("pool", "json"), ("host", "text")):
        assert f'"name": "{name}"' in text
        assert f'"type": "{kind}"' in text
        assert f'removeById("{name}_field")' in text or f'removeByName("{name}")' in text
