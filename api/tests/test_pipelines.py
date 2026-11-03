import json

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.pipelines import suggest_name, valid_name
from api.settings import Settings, get_settings


@pytest.fixture
def env(tmp_path):
    datasets = tmp_path / "datasets"
    (datasets / "d").mkdir(parents=True)
    (datasets / "e").mkdir()
    pipelines = tmp_path / "pipelines"
    pipelines.mkdir()
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        datasets_dir=datasets, cors_origins=[], pipelines_dir=pipelines
    )
    return TestClient(app), pipelines


CONFIG = {"selected_dataset": "d", "labeling_budget": 10, "selected_strategies": ["Typo Detector"]}


def test_suggest_name_starts_at_01(tmp_path):
    assert suggest_name(tmp_path, "d", "aaaaaa") == "d-pipeline-01-aaaaaa"


def test_suggest_name_increments_per_dataset_and_suffix(tmp_path):
    for n in ["d-pipeline-01-aaaaaa", "d-pipeline-02-aaaaaa", "d-pipeline-07-bbbbbb", "x-pipeline-09-aaaaaa"]:
        (tmp_path / n).mkdir()
    assert suggest_name(tmp_path, "d", "aaaaaa") == "d-pipeline-03-aaaaaa"


@pytest.mark.parametrize("name", ["a", "d-pipeline-01-abc123", "A.b_c-1"])
def test_valid_names(name):
    assert valid_name(name)


@pytest.mark.parametrize("name", ["", "../x", "a/b", ".hidden", "x" * 101, "a b"])
def test_invalid_names(name):
    assert not valid_name(name)


def test_suggest_name_endpoint(env):
    client, _ = env
    assert client.get("/api/pipelines/suggest-name?dataset=d&suffix=abc123").json() == {
        "name": "d-pipeline-01-abc123"
    }
    assert client.get("/api/pipelines/suggest-name?dataset=nope&suffix=abc123").status_code == 404
    assert client.get("/api/pipelines/suggest-name?dataset=d&suffix=a/b").status_code == 422


def test_create_then_get_roundtrip(env):
    client, pipelines = env
    r = client.post("/api/pipelines", json={"name": "p1", "config": CONFIG})
    assert r.status_code == 201 and r.json() == {"name": "p1"}
    assert client.get("/api/pipelines/p1").json() == CONFIG
    assert json.loads((pipelines / "p1" / "configurations.json").read_text()) == CONFIG
    assert client.get("/api/pipelines").json() == ["p1"]


def test_create_existing_is_409(env):
    client, _ = env
    client.post("/api/pipelines", json={"name": "p1", "config": CONFIG})
    assert client.post("/api/pipelines", json={"name": "p1", "config": CONFIG}).status_code == 409


@pytest.mark.parametrize("name", ["", "../x", "a/b", "x" * 101])
def test_create_invalid_name_is_422(env, name):
    client, _ = env
    assert client.post("/api/pipelines", json={"name": name, "config": CONFIG}).status_code == 422


def test_create_unknown_dataset_is_422(env):
    client, _ = env
    bad = {**CONFIG, "selected_dataset": "nope"}
    assert client.post("/api/pipelines", json={"name": "p1", "config": bad}).status_code == 422


@pytest.mark.parametrize("budget", [0, 101])
def test_budget_out_of_range_is_422(env, budget):
    client, _ = env
    bad = {**CONFIG, "labeling_budget": budget}
    assert client.post("/api/pipelines", json={"name": "p1", "config": bad}).status_code == 422


def _seed_derived(client, pipelines):
    client.post("/api/pipelines", json={"name": "p1", "config": CONFIG})
    path = pipelines / "p1" / "configurations.json"
    data = json.loads(path.read_text())
    data.update({"domain_folds": {"f": ["t"]}, "cell_folds": {"x": {}}, "results": [1]})
    path.write_text(json.dumps(data))


def test_update_keeps_derived_when_dataset_same(env):
    client, pipelines = env
    _seed_derived(client, pipelines)
    r = client.put("/api/pipelines/p1", json={**CONFIG, "labeling_budget": 20})
    assert r.status_code == 200
    body = r.json()
    assert body["labeling_budget"] == 20 and body["domain_folds"] == {"f": ["t"]}


def test_update_drops_derived_when_dataset_changes(env):
    client, pipelines = env
    _seed_derived(client, pipelines)
    body = client.put("/api/pipelines/p1", json={**CONFIG, "selected_dataset": "e"}).json()
    assert body["selected_dataset"] == "e"
    assert not any(k in body for k in ("domain_folds", "cell_folds", "results"))


def test_update_unknown_pipeline_404(env):
    client, _ = env
    assert client.put("/api/pipelines/nope", json=CONFIG).status_code == 404


def test_copy_copies_folder_including_extra_files(env):
    client, pipelines = env
    _seed_derived(client, pipelines)
    (pipelines / "p1" / "user_labels.csv").write_text("x")
    r = client.post("/api/pipelines/p1/copy", json={"new_name": "p2"})
    assert r.status_code == 201 and r.json() == {"name": "p2"}
    assert (pipelines / "p2" / "user_labels.csv").read_text() == "x"
    assert client.get("/api/pipelines/p2").json()["results"] == [1]


def test_copy_onto_existing_409_and_missing_404_and_bad_name_422(env):
    client, _ = env
    client.post("/api/pipelines", json={"name": "p1", "config": CONFIG})
    client.post("/api/pipelines", json={"name": "p2", "config": CONFIG})
    assert client.post("/api/pipelines/p1/copy", json={"new_name": "p2"}).status_code == 409
    assert client.post("/api/pipelines/nope/copy", json={"new_name": "p3"}).status_code == 404
    assert client.post("/api/pipelines/p1/copy", json={"new_name": "../x"}).status_code == 422


def test_get_traversal_name_404(env):
    client, _ = env
    assert client.get("/api/pipelines/..%2Fdatasets").status_code == 404
    assert client.get("/api/pipelines/.hidden").status_code == 404
