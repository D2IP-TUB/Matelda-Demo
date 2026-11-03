import json
import time

import pytest
from fastapi.testclient import TestClient

from api import services
from api.jobs import JobStore, get_job_store
from api.main import create_app
from api.settings import Settings, get_settings

CONFIG = {
    "selected_dataset": "d",
    "labeling_budget": 10,
    "selected_strategies": ["Typo Detector"],
    "domain_folds": {"F0": ["t1", "t2"], "F1": ["t3"]},
    "cell_folds": {"F0": {"F0 / Cell Fold 0": [{"table": "t1", "row": 0, "col": "a", "val": "x"}]}},
    "cell_fold_labels": {"F0 / Cell Fold 0": "correct"},
    "results": [1],
}


@pytest.fixture
def env(tmp_path):
    datasets = tmp_path / "datasets" / "d"
    for t in ("t1", "t2", "t3"):
        (datasets / t).mkdir(parents=True)
        (datasets / t / "dirty.csv").write_text("a\n1\n")
    pipelines = tmp_path / "pipelines"
    (pipelines / "p1").mkdir(parents=True)
    (pipelines / "p1" / "configurations.json").write_text(json.dumps(CONFIG))
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        datasets_dir=tmp_path / "datasets", cors_origins=[], pipelines_dir=pipelines
    )
    store = JobStore()
    app.dependency_overrides[get_job_store] = lambda: store
    return TestClient(app), pipelines


def stored(pipelines, name="p1"):
    return json.loads((pipelines / name / "configurations.json").read_text())


def test_save_domain_folds_roundtrip(env):
    client, pipelines = env
    folds = {"A": ["t1"], "B": ["t2", "t3"]}
    r = client.put("/api/pipelines/p1/domain-folds", json={"domain_folds": folds})
    assert r.status_code == 200 and r.json() == folds
    assert stored(pipelines)["domain_folds"] == folds


def test_save_same_folds_keeps_cell_folds(env):
    client, pipelines = env
    client.put("/api/pipelines/p1/domain-folds", json={"domain_folds": CONFIG["domain_folds"]})
    assert "cell_folds" in stored(pipelines)


def test_save_changed_folds_drops_cell_folds(env):
    client, pipelines = env
    client.put("/api/pipelines/p1/domain-folds", json={"domain_folds": {"A": ["t1", "t2", "t3"]}})
    assert not any(k in stored(pipelines) for k in ("cell_folds", "cell_fold_labels", "results"))


@pytest.mark.parametrize(
    "folds",
    [{"A": ["t1"], "B": ["t1"]}, {"A": ["nope"]}, {"": ["t1"]}, {"A": []}],
)
def test_save_invalid_folds_422(env, folds):
    client, pipelines = env
    assert client.put("/api/pipelines/p1/domain-folds", json={"domain_folds": folds}).status_code == 422
    assert stored(pipelines)["domain_folds"] == CONFIG["domain_folds"]


def test_save_unknown_pipeline_404(env):
    client, _ = env
    assert client.put("/api/pipelines/nope/domain-folds", json={"domain_folds": {"A": ["t1"]}}).status_code == 404


def poll(client, job_id, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/api/jobs/{job_id}").json()
        if body["state"] != "running":
            return body
        time.sleep(0.01)
    raise AssertionError("job did not finish")


NEW_FOLDS = {"Domain Fold 0": ["t1"], "Domain Fold 1": ["t2", "t3"]}


def test_domain_folding_job_saves_folds_and_drops_stale(env, monkeypatch):
    client, pipelines = env
    seen = {}

    def fake(dataset, budget):
        seen["args"] = (dataset, budget)
        return {"domain_folds": NEW_FOLDS}

    monkeypatch.setattr(services, "backend_dbf", fake)
    job = client.post("/api/pipelines/p1/domain-folding").json()["job_id"]
    body = poll(client, job)
    assert body["state"] == "done" and body["result"] == {"domain_folds": NEW_FOLDS}
    assert seen["args"] == ("d", 10)
    cfg = stored(pipelines)
    assert cfg["domain_folds"] == NEW_FOLDS
    assert not any(k in cfg for k in ("cell_folds", "cell_fold_labels", "results"))


def test_domain_folding_empty_result_fails_and_keeps_old_folds(env, monkeypatch):
    client, pipelines = env
    monkeypatch.setattr(services, "backend_dbf", lambda d, b: {"domain_folds": {}})
    body = poll(client, client.post("/api/pipelines/p1/domain-folding").json()["job_id"])
    assert body["state"] == "failed" and "no folds" in body["error"]
    assert stored(pipelines)["domain_folds"] == CONFIG["domain_folds"]
    assert "cell_folds" in stored(pipelines)


CELL_FOLDS = {"F0": {"F0 / Cell Fold 0": [{"table": "t1", "row": 0, "col": "a", "val": "x"}],
                     "F0 / Cell Fold 1": [{"table": "t2", "row": 1, "col": "a", "val": "y"}]}}


def test_quality_folding_requires_domain_folds_409(env):
    client, pipelines = env
    (pipelines / "p2").mkdir()
    (pipelines / "p2" / "configurations.json").write_text(
        json.dumps({"selected_dataset": "d", "labeling_budget": 10, "selected_strategies": []})
    )
    r = client.post("/api/pipelines/p2/quality-folding")
    assert r.status_code == 409 and "domain" in r.json()["detail"].lower()


def test_quality_folding_saves_cell_folds_budget_and_strategies(env, monkeypatch):
    client, pipelines = env
    seen = {}

    def fake(dataset, budget, folds, strategies):
        seen["args"] = (dataset, budget, folds, strategies)
        return CELL_FOLDS

    monkeypatch.setattr(services, "backend_qbf", fake)
    r = client.post(
        "/api/pipelines/p1/quality-folding",
        json={"labeling_budget": 20, "selected_strategies": ["Typo Detector", "X"]},
    )
    body = poll(client, r.json()["job_id"])
    assert body["state"] == "done"
    assert body["result"] == {"cell_fold_count": 2, "domain_count": 1}
    assert seen["args"] == ("d", 20, CONFIG["domain_folds"], ["Typo Detector", "X"])
    cfg = stored(pipelines)
    assert cfg["cell_folds"] == CELL_FOLDS
    assert cfg["labeling_budget"] == 20 and cfg["selected_strategies"] == ["Typo Detector", "X"]
    assert "cell_fold_labels" not in cfg and "results" not in cfg


def test_quality_folding_without_body_uses_config(env, monkeypatch):
    client, _ = env
    seen = {}
    monkeypatch.setattr(services, "backend_qbf", lambda *a: seen.setdefault("a", a) and CELL_FOLDS)
    poll(client, client.post("/api/pipelines/p1/quality-folding").json()["job_id"])
    assert seen["a"][1] == 10 and seen["a"][3] == ["Typo Detector"]


def test_quality_folding_empty_result_fails_and_keeps_old(env, monkeypatch):
    client, pipelines = env
    monkeypatch.setattr(services, "backend_qbf", lambda *a: {})
    body = poll(client, client.post("/api/pipelines/p1/quality-folding").json()["job_id"])
    assert body["state"] == "failed" and "no cell folds" in body["error"]
    assert stored(pipelines)["cell_folds"] == CONFIG["cell_folds"]


def test_quality_folding_backend_error_fails_job(env, monkeypatch):
    client, _ = env

    def boom(*a):
        raise RuntimeError("raha exploded")

    monkeypatch.setattr(services, "backend_qbf", boom)
    body = poll(client, client.post("/api/pipelines/p1/quality-folding").json()["job_id"])
    assert body["state"] == "failed" and "raha exploded" in body["error"]


def test_folding_unknown_pipeline_404(env):
    client, _ = env
    assert client.post("/api/pipelines/nope/domain-folding").status_code == 404
    assert client.post("/api/pipelines/nope/quality-folding").status_code == 404


@pytest.mark.parametrize("budget", [0, 101])
def test_quality_budget_out_of_range_422(env, budget):
    client, _ = env
    assert client.post("/api/pipelines/p1/quality-folding", json={"labeling_budget": budget}).status_code == 422


@pytest.mark.slow
def test_real_folding_on_demo_dataset(tmp_path):
    from api.settings import REPO_ROOT

    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        datasets_dir=REPO_ROOT / "datasets", cors_origins=[], pipelines_dir=tmp_path
    )
    client = TestClient(app)
    config = {"selected_dataset": "BIFOLD_Demo", "labeling_budget": 10, "selected_strategies": ["Typo Detector"]}
    assert client.post("/api/pipelines", json={"name": "real", "config": config}).status_code == 201
    domain = poll(client, client.post("/api/pipelines/real/domain-folding").json()["job_id"], timeout=300)
    assert domain["state"] == "done", domain
    quality = poll(client, client.post("/api/pipelines/real/quality-folding").json()["job_id"], timeout=900)
    assert quality["state"] == "done", quality
    assert quality["result"]["cell_fold_count"] > 0
