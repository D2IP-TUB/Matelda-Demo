import json

import pytest
from fastapi.testclient import TestClient

from api import services
from api.main import create_app
from api.settings import Settings, get_settings
from api.tests.test_labeling import CELL_FOLDS, SAMPLED


@pytest.fixture
def env(tmp_path):
    datasets = tmp_path / "datasets" / "d"
    (datasets / "t1").mkdir(parents=True)
    (datasets / "t1" / "dirty.csv").write_text("a\n1\n2\n")
    (datasets / "t1" / "clean.csv").write_text("a\n1\n3\n")
    pipelines = tmp_path / "pipelines"
    for name, extra in (
        ("p1", {"cell_folds": CELL_FOLDS, "cell_fold_labels": {"F1": "correct"}}),
        ("p2", {}),
    ):
        (pipelines / name).mkdir(parents=True)
        cfg = {"selected_dataset": "d", "labeling_budget": 6, "selected_strategies": ["Typo"], **extra}
        (pipelines / name / "configurations.json").write_text(json.dumps(cfg))
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        datasets_dir=tmp_path / "datasets", cors_origins=[], pipelines_dir=pipelines
    )
    return TestClient(app), pipelines


def test_sample_returns_cards_and_counts_bulk_folds(env, monkeypatch):
    client, pipelines = env
    seen = {}

    def fake(dataset, budget, cell_folds, domain_folds, pipeline_dir):
        seen["args"] = (dataset, budget, pipeline_dir)
        return SAMPLED

    monkeypatch.setattr(services, "sample_labeling", fake)
    body = client.get("/api/pipelines/p1/labeling/sample").json()
    assert [c["key"] for c in body["cards"]] == ["t1|0|a"] and body["bulk_annotated_folds"] == 1
    assert seen["args"] == ("d", 6, str(pipelines / "p1"))


def test_sample_empty_result_is_zero_cards(env, monkeypatch):
    client, _ = env
    monkeypatch.setattr(services, "sample_labeling", lambda *a: [])
    assert client.get("/api/pipelines/p1/labeling/sample").json()["cards"] == []


def test_labeling_requires_cell_folds_and_pipeline(env):
    client, _ = env
    assert client.get("/api/pipelines/p2/labeling/sample").status_code == 409
    assert client.get("/api/pipelines/p2/labeling/candidates").status_code == 409
    assert client.get("/api/pipelines/nope/labeling/sample").status_code == 404


def test_candidates_are_only_sampler_cells(env, monkeypatch):
    client, _ = env
    two = [
        {"table": "t1", "row": 0, "col": "a", "val": "x", "domain_fold": "D0", "cell_fold": "F0", "strategies": []},
        {"table": "t3", "row": 1, "col": "c", "val": "y", "domain_fold": "D1", "cell_fold": "F2", "strategies": []},
    ]
    monkeypatch.setattr(services, "sample_labeling", lambda *a: two)
    body = client.get("/api/pipelines/p1/labeling/candidates").json()
    assert body["keys"] == ["t1|0|a", "t3|1|c"] and body["sample_size"] == 2


def test_cards_endpoint(env):
    client, _ = env
    r = client.post("/api/pipelines/p1/labeling/cards", json={"keys": ["t3|1|c", "nope", "t1|0|a"]})
    assert [c["key"] for c in r.json()] == ["t3|1|c", "t1|0|a"]
    too_many = client.post("/api/pipelines/p1/labeling/cards", json={"keys": ["t1|0|a"] * 501})
    assert too_many.status_code == 422


def test_judge_endpoint(env):
    client, _ = env
    body = {"verdicts": [
        {"table": "t1", "row": 0, "col": "a", "said_correct": True},
        {"table": "t1", "row": 1, "col": "a", "said_correct": True},
        {"table": "t1", "row": 9, "col": "a", "said_correct": True},
        {"table": "../x", "row": 0, "col": "a", "said_correct": True},
    ]}
    r = client.post("/api/datasets/d/judge", json=body)
    assert r.status_code == 200 and r.json() == {"correct": [True, False, None, None]}
    assert client.post("/api/datasets/nope/judge", json={"verdicts": []}).status_code == 404
    assert client.post("/api/datasets/d/judge", json={"verdicts": body["verdicts"][:1] * 501}).status_code == 422


# ---------------------------------------------------------------- propagation
import time

from api.jobs import JobStore, get_job_store


def poll(client, job_id, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/api/jobs/{job_id}").json()
        if body["state"] != "running":
            return body
        time.sleep(0.01)
    raise AssertionError("job did not finish")


def with_jobs(client):
    store = JobStore()
    client.app.dependency_overrides[get_job_store] = lambda: store
    return client


def stored(pipelines, name="p1"):
    return json.loads((pipelines / name / "configurations.json").read_text())


OWN = [
    {"table": "t1", "row": 0, "col": "a", "val": "x", "is_error": True, "domain_fold": "D0", "cell_fold": "F0"},
    {"table": "t1", "row": 1, "col": "a", "val": "y", "is_error": False, "domain_fold": "D0", "cell_fold": "F0"},
]
RESULT = {"labeled_cells": [
    {**OWN[0], "propagated_cells": [{"table": "t1", "row": 2, "col": "a", "confidence": 0.9, "reason": "r"}]},
    {**OWN[1], "propagated_cells": []},
]}


def test_propagation_job_saves_results_and_user_labels(env, monkeypatch):
    client, pipelines = env
    with_jobs(client)
    cfg = stored(pipelines)
    cfg["error_detection"] = {"old": 1}
    (pipelines / "p1" / "configurations.json").write_text(json.dumps(cfg))
    seen = {}

    def fake(dataset, labeled, cell_folds, pipeline_dir):
        seen["labeled"], seen["dir"] = labeled, pipeline_dir
        return RESULT

    monkeypatch.setattr(services, "label_propagation", fake)
    job = client.post("/api/pipelines/p1/labeling/propagate", json={"own": OWN}).json()["job_id"]
    body = poll(client, job)
    assert body["state"] == "done"
    assert body["result"] == {"labeled_count": 2, "propagated_count": 1, "disputed": []}
    assert [c["is_error"] for c in seen["labeled"]] == [True, False]
    assert all("cell_fold_label" not in c for c in seen["labeled"])  # would override the player's labels
    cfg = stored(pipelines)
    assert cfg["propagation_results"] == RESULT and "error_detection" not in cfg
    csv = (pipelines / "p1" / "user_labels.csv").read_text().splitlines()
    assert csv[0] == "table,is_error,row,col,val,domain_fold,cell_fold" and len(csv) == 3


def test_propagation_merges_room_labels_when_player_given(env, monkeypatch):
    client, _ = env
    with_jobs(client)
    seen = {}
    monkeypatch.setattr(services, "label_propagation", lambda d, labeled, cf, p: seen.setdefault("l", labeled) and RESULT)
    body = {
        "own": [OWN[0]],
        "room_labels": [{"cell_id": "t1|0|a", "player": "p2", "value": True}],  # tie with own error
        "player_id": "me",
    }
    # a second, uncontested label keeps the result non-empty
    body["room_labels"].append({"cell_id": "t1|1|a", "player": "p2", "value": True})
    job = client.post("/api/pipelines/p1/labeling/propagate", json=body).json()["job_id"]
    out = poll(client, job)
    assert out["result"]["disputed"] == ["t1|0|a"]
    assert [(c["row"], c["is_error"]) for c in seen["l"]] == [(1, False)]


def test_propagation_empty_result_fails_and_keeps_old_results(env, monkeypatch):
    client, pipelines = env
    with_jobs(client)
    cfg = stored(pipelines)
    cfg["propagation_results"] = {"labeled_cells": [{"old": True}]}
    (pipelines / "p1" / "configurations.json").write_text(json.dumps(cfg))
    monkeypatch.setattr(services, "label_propagation", lambda *a: {"labeled_cells": []})
    out = poll(client, client.post("/api/pipelines/p1/labeling/propagate", json={"own": OWN}).json()["job_id"])
    assert out["state"] == "failed" and "no labeled cells" in out["error"]
    assert stored(pipelines)["propagation_results"] == {"labeled_cells": [{"old": True}]}


def test_propagation_requires_cell_folds_and_pipeline(env):
    client, _ = env
    assert client.post("/api/pipelines/p2/labeling/propagate", json={"own": []}).status_code == 409
    assert client.post("/api/pipelines/nope/labeling/propagate", json={"own": []}).status_code == 404


def test_propagation_results_are_paged(env):
    client, pipelines = env
    cfg = stored(pipelines)
    cfg["propagation_results"] = {"labeled_cells": [
        {"table": "t", "row": i, "col": "a", "propagated_cells": [{"row": 0}] * (i % 3)} for i in range(5)
    ]}
    (pipelines / "p1" / "configurations.json").write_text(json.dumps(cfg))
    body = client.get("/api/pipelines/p1/propagation", params={"offset": 3, "limit": 2}).json()
    assert body["total"] == 5 and [c["row"] for c in body["labeled_cells"]] == [3, 4]
    assert body["propagated_total"] == 0 + 1 + 2 + 0 + 1
    assert client.get("/api/pipelines/p1/propagation", params={"limit": 201}).status_code == 422


def test_propagation_results_409_when_missing(env):
    client, _ = env
    r = client.get("/api/pipelines/p1/propagation")
    assert r.status_code == 409 and "propagation" in r.json()["detail"].lower()
    assert client.get("/api/pipelines/nope/propagation").status_code == 404
