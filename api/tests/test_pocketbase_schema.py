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
