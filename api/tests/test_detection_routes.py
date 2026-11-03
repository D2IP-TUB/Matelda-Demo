import json
import time

import pytest
from fastapi.testclient import TestClient

from api import services
from api.jobs import JobStore, get_job_store
from api.main import create_app
from api.settings import Settings, get_settings

PROPAGATION = {"labeled_cells": [{"table": "t1", "row": 0, "col": "a", "is_error": True, "propagated_cells": []}]}
DETECTION = {
    "propagated_errors": {
        "t1": [{"row": i, "col": "a", "val": f"v{i}", "confidence": 0.5, "source": "s"} for i in range(5)],
        "t2": [{"row": 0, "col": "b", "val": "z", "confidence": 1.0, "source": "direct_label"}],
    },
    "metrics": {"precision": 0.8, "recall": 0.6, "f1": 0.69, "fold_label_influence": 0.1},
}


@pytest.fixture
def env(tmp_path):
    pipelines = tmp_path / "pipelines"
    for name, extra in (("p1", {"propagation_results": PROPAGATION}), ("p2", {})):
        (pipelines / name).mkdir(parents=True)
        cfg = {"selected_dataset": "d", "labeling_budget": 6, "selected_strategies": [], **extra}
        (pipelines / name / "configurations.json").write_text(json.dumps(cfg))
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        datasets_dir=tmp_path / "datasets", cors_origins=[], pipelines_dir=pipelines
    )
    store = JobStore()
    app.dependency_overrides[get_job_store] = lambda: store
    return TestClient(app), pipelines


def poll(client, job_id, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/api/jobs/{job_id}").json()
        if body["state"] != "running":
            return body
        time.sleep(0.01)
    raise AssertionError("job did not finish")


def stored(pipelines, name="p1"):
    return json.loads((pipelines / name / "configurations.json").read_text())


def test_detection_job_stores_result_and_returns_table_counts(env, monkeypatch):
    client, pipelines = env
    seen = {}

    def fake(dataset, propagation_results, pipeline_dir):
        seen["args"] = (dataset, propagation_results, pipeline_dir)
        return DETECTION

    monkeypatch.setattr(services, "pull_errors", fake)
    body = poll(client, client.post("/api/pipelines/p1/error-detection").json()["job_id"])
    assert body["state"] == "done"
    assert body["result"]["tables"] == {"t1": 5, "t2": 1}
    assert body["result"]["metrics"]["f1"] == 0.69
    assert seen["args"] == ("d", PROPAGATION, str(pipelines / "p1"))
    saved = stored(pipelines)["error_detection"]
    assert saved["propagated_errors"] == DETECTION["propagated_errors"] and saved["time"]


def test_detection_empty_result_fails_and_keeps_old(env, monkeypatch):
    client, pipelines = env
    cfg = stored(pipelines)
    cfg["error_detection"] = {"time": "old", "metrics": {}, "propagated_errors": {"t": [{}]}}
    (pipelines / "p1" / "configurations.json").write_text(json.dumps(cfg))
    monkeypatch.setattr(services, "pull_errors", lambda *a: {"propagated_errors": {}, "metrics": {}})
    body = poll(client, client.post("/api/pipelines/p1/error-detection").json()["job_id"])
    assert body["state"] == "failed" and "no result" in body["error"]
    assert stored(pipelines)["error_detection"]["time"] == "old"


def test_detection_requires_propagation_and_pipeline(env):
    client, _ = env
    r = client.post("/api/pipelines/p2/error-detection")
    assert r.status_code == 409 and "propagation" in r.json()["detail"].lower()
    assert client.post("/api/pipelines/nope/error-detection").status_code == 404


def seed_result(pipelines):
    cfg = stored(pipelines)
    cfg["error_detection"] = {"time": "2025-01-01 10:00:00", "metrics": DETECTION["metrics"],
                              "propagated_errors": DETECTION["propagated_errors"]}
    (pipelines / "p1" / "configurations.json").write_text(json.dumps(cfg))


def test_get_summary_and_404(env):
    client, pipelines = env
    assert client.get("/api/pipelines/p1/error-detection").status_code == 404
    seed_result(pipelines)
    body = client.get("/api/pipelines/p1/error-detection").json()
    assert body == {"time": "2025-01-01 10:00:00", "metrics": DETECTION["metrics"], "tables": {"t1": 5, "t2": 1}}


def test_errors_endpoint_pages_and_unknown_table(env):
    client, pipelines = env
    seed_result(pipelines)
    body = client.get("/api/pipelines/p1/error-detection/errors", params={"table": "t1", "offset": 3, "limit": 2}).json()
    assert body["total"] == 5 and [e["row"] for e in body["errors"]] == [3, 4]
    assert client.get("/api/pipelines/p1/error-detection/errors", params={"table": "nope"}).json() == {"errors": [], "total": 0}
    assert client.get("/api/pipelines/p1/error-detection/errors", params={"table": "t1", "limit": 201}).status_code == 422
