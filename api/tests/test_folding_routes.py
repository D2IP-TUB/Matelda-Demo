import json

import pytest
from fastapi.testclient import TestClient

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
