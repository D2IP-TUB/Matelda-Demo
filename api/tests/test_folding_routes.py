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


# ---------------------------------------------------------------- cell fold endpoints
def _cell(table, row, col, strategies=None):
    return {"table": table, "row": row, "col": col, "val": "v", "features": [1.0],
            "strategies": strategies or [], "selected_for_labeling": False, "assigned_budget": None}


F00, F01, F10 = "D0 / Cell Fold 0", "D0 / Cell Fold 1", "D1 / Cell Fold 0"
CF = {
    "D0": {F00: [_cell("t1", 0, "a"), _cell("t1", 1, "a"), _cell("t2", 0, "b")],
           F01: [_cell("t1", 2, "a")]},
    "D1": {F10: [_cell("t3", 0, "c")]},
}


@pytest.fixture
def folded(env):
    client, pipelines = env
    cfg = stored(pipelines)
    cfg["cell_folds"], cfg["cell_fold_labels"] = CF, {F00: "correct"}
    (pipelines / "p1" / "configurations.json").write_text(json.dumps(cfg))
    (pipelines / "p2").mkdir()
    (pipelines / "p2" / "configurations.json").write_text(json.dumps({"selected_dataset": "d"}))
    return client, pipelines


def counts(summary):
    return {s["name"]: s["cell_count"] for s in summary}


def test_summary_endpoint(folded):
    client, _ = folded
    body = client.get("/api/pipelines/p1/cell-folds").json()
    assert counts(body) == {F00: 3, F01: 1, F10: 1}
    assert body[0]["label"] == "correct" and body[1]["label"] == "neutral"


def test_cells_endpoint_pages_without_features(folded):
    client, _ = folded
    body = client.get("/api/pipelines/p1/cell-folds/cells", params={"fold": F00, "offset": 1, "limit": 1}).json()
    assert body["total"] == 3 and len(body["cells"]) == 1
    assert body["cells"][0]["row"] == 1 and "features" not in body["cells"][0]


def test_cells_endpoint_errors(folded):
    client, _ = folded
    assert client.get("/api/pipelines/p1/cell-folds/cells", params={"fold": "nope"}).status_code == 404
    assert client.get("/api/pipelines/p1/cell-folds/cells", params={"fold": F00, "limit": 201}).status_code == 422


def test_move_endpoint_persists(folded):
    client, pipelines = folded
    r = client.post("/api/pipelines/p1/cell-folds/move",
                    json={"cell": {"table": "t3", "row": 0, "col": "c"}, "to_fold": F01})
    assert r.status_code == 200 and counts(r.json()) == {F00: 3, F01: 2}
    assert sorted(stored(pipelines)["cell_folds"]) == ["D0"]


def test_merge_endpoint_persists_and_validates(folded):
    client, pipelines = folded
    r = client.post("/api/pipelines/p1/cell-folds/merge", json={"folds": [F00, F01]})
    assert counts(r.json()) == {F00: 4, F10: 1}
    assert stored(pipelines)["cell_fold_labels"] == {F00: "correct"}
    assert client.post("/api/pipelines/p1/cell-folds/merge", json={"folds": [F00]}).status_code == 422
    assert client.post("/api/pipelines/p1/cell-folds/merge", json={"folds": [F00, "nope"]}).status_code == 404


def test_split_endpoint(folded):
    client, _ = folded
    r = client.post("/api/pipelines/p1/cell-folds/split",
                    json={"fold": F00, "after": [{"table": "t1", "row": 1, "col": "a"}]})
    assert counts(r.json()) == {f"{F00} - Split 1": 2, f"{F00} - Split 2": 1, F01: 1, F10: 1}
    assert client.post("/api/pipelines/p1/cell-folds/split", json={"fold": F01, "after": []}).status_code == 422


def test_label_endpoint(folded):
    client, pipelines = folded
    r = client.put("/api/pipelines/p1/cell-folds/label", json={"fold": F01, "label": "false"})
    assert {s["name"]: s["label"] for s in r.json()}[F01] == "false"
    client.put("/api/pipelines/p1/cell-folds/label", json={"fold": F01, "label": None})
    assert F01 not in stored(pipelines)["cell_fold_labels"]
    assert client.put("/api/pipelines/p1/cell-folds/label", json={"fold": "nope", "label": "false"}).status_code == 404
    assert client.put("/api/pipelines/p1/cell-folds/label", json={"fold": F01, "label": "maybe"}).status_code == 422


def test_cell_fold_endpoints_without_cell_folds_or_pipeline(folded):
    client, _ = folded
    assert client.get("/api/pipelines/p2/cell-folds").status_code == 409
    assert client.get("/api/pipelines/nope/cell-folds").status_code == 404
    assert client.post("/api/pipelines/p2/cell-folds/merge", json={"folds": [F00, F01]}).status_code == 409


def test_move_fold_to_domain_and_split_domain_routes(env):
    client, pipelines = env
    cfg = stored(pipelines, "p1")
    cfg["cell_folds"] = {
        "F0": {
            "F0 / Cell Fold 0": [{"table": "t1", "row": 0, "col": "a", "val": "x"}],
            "F0 / Cell Fold 1": [{"table": "t1", "row": 1, "col": "a", "val": "y"}],
        },
        "F1": {"F1 / Cell Fold 0": [{"table": "t3", "row": 0, "col": "a", "val": "z"}]},
    }
    (pipelines / "p1" / "configurations.json").write_text(json.dumps(cfg))

    r = client.post("/api/pipelines/p1/cell-folds/split-domain", json={"domain": "F0", "after_fold": "F0 / Cell Fold 0"})
    assert r.status_code == 200
    assert {(f["name"], f["domain"]) for f in r.json()} == {
        ("F0 / Cell Fold 0", "F0"), ("F0 / Cell Fold 1", "F0 - Split 1"), ("F1 / Cell Fold 0", "F1"),
    }
    assert list(stored(pipelines)["cell_folds"]) == ["F0", "F0 - Split 1", "F1"]

    r = client.post("/api/pipelines/p1/cell-folds/move-fold", json={"fold": "F0 / Cell Fold 1", "to_domain": "F1"})
    assert r.status_code == 200
    assert list(stored(pipelines)["cell_folds"]) == ["F0", "F1"]  # the emptied domain is gone
    assert list(stored(pipelines)["cell_folds"]["F1"]) == ["F1 / Cell Fold 0", "F0 / Cell Fold 1"]

    assert client.post("/api/pipelines/p1/cell-folds/move-fold", json={"fold": "nope", "to_domain": "F1"}).status_code == 404
    assert client.post("/api/pipelines/p1/cell-folds/move-fold", json={"fold": "F1 / Cell Fold 0", "to_domain": "nope"}).status_code == 404
    assert client.post("/api/pipelines/p1/cell-folds/split-domain", json={"domain": "F0", "after_fold": "F0 / Cell Fold 0"}).status_code == 422
    assert client.post("/api/pipelines/p1/cell-folds/split-domain", json={"domain": "nope", "after_fold": "x"}).status_code == 404

    r = client.post("/api/pipelines/p1/cell-folds/merge-domain", json={"domain": "F0", "into": "F1"})
    assert r.status_code == 200
    assert list(stored(pipelines)["cell_folds"]) == ["F1"]
    assert list(stored(pipelines)["cell_folds"]["F1"]) == ["F1 / Cell Fold 0", "F0 / Cell Fold 1", "F0 / Cell Fold 0"]
    assert client.post("/api/pipelines/p1/cell-folds/merge-domain", json={"domain": "F1", "into": "F1"}).status_code == 422
    assert client.post("/api/pipelines/p1/cell-folds/merge-domain", json={"domain": "nope", "into": "F1"}).status_code == 404
