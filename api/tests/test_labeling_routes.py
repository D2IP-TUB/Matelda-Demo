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


def test_candidates_start_with_sample_and_skip_bulk_folds(env, monkeypatch):
    client, _ = env
    monkeypatch.setattr(services, "sample_labeling", lambda *a: SAMPLED)
    body = client.get("/api/pipelines/p1/labeling/candidates").json()
    assert body["sample_size"] == 1 and body["keys"][0] == "t1|0|a"
    assert "t2|0|b" not in body["keys"]  # F1 is bulk annotated


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
