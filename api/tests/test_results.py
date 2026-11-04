import json

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.results import comparison_rows, label_accuracy, latest_metrics, raha_baseline
from api.settings import Settings, get_settings


def test_latest_metrics_prefers_error_detection():
    cfg = {
        "error_detection": {"time": "2025-02-01 10:00:00", "metrics": {"precision": 0.5, "recall": 0.4, "f1": 0.44}},
        "results": [{"Time": "2025-01-01 10:00:00", "metrics": {"Precision": 0.9, "Recall": 0.9, "F1": 0.9}}],
    }
    assert latest_metrics(cfg) == {"precision": 0.5, "recall": 0.4, "f1": 0.44, "time": "2025-02-01 10:00:00"}


@pytest.mark.parametrize("keys", [("Precision", "Recall", "F1"), ("precision", "recall", "f1")])
def test_latest_metrics_from_results_in_either_key_style(keys):
    cfg = {"results": [
        {"Time": "t0", "metrics": dict(zip(keys, (0.1, 0.1, 0.1)))},
        {"Time": "t1", "metrics": dict(zip(keys, (0.7, 0.6, 0.65)))},
    ]}
    assert latest_metrics(cfg) == {"precision": 0.7, "recall": 0.6, "f1": 0.65, "time": "t1"}


def test_latest_metrics_none():
    assert latest_metrics({}) is None
    assert latest_metrics({"results": []}) is None


def write_pipeline(root, name, dataset, budget, results):
    (root / name).mkdir(parents=True)
    (root / name / "configurations.json").write_text(
        json.dumps({"selected_dataset": dataset, "labeling_budget": budget, "results": results})
    )


def test_comparison_rows_same_dataset_newest_first_and_skips_broken(tmp_path):
    write_pipeline(tmp_path, "a", "d", 10, [{"Time": "2025-01-01 10:00:00", "metrics": {"Precision": 0.5, "Recall": 0.4, "F1": 0.44}}])
    write_pipeline(tmp_path, "b", "d", 20, [{"Time": "2025-03-01 10:00:00", "metrics": {"precision": 0.9, "recall": 0.8, "f1": 0.85}}])
    write_pipeline(tmp_path, "c", "other", 5, [{"Time": "2025-02-01 10:00:00", "metrics": {}}])
    (tmp_path / "broken").mkdir()
    (tmp_path / "broken" / "configurations.json").write_text("{not json")
    rows = comparison_rows(tmp_path, "d")
    assert [(r["pipeline"], r["labeling_budget"], r["f1"]) for r in rows] == [("b", 20, 0.85), ("a", 10, 0.44)]
    assert rows[0]["time"] == "2025-03-01 10:00:00"


def test_raha_baseline_closest_budget(tmp_path):
    csv = tmp_path / "raha.csv"
    csv.write_text("labeling_budget,precision,recall,f_score,f_score_std\n5,0.2,0.1,0.13,0\n12,0.33,0.07,0.11,0\n24,0.58,0.32,0.41,0\n")
    assert raha_baseline(csv, 13) == {"labeling_budget": 12, "precision": 0.33, "recall": 0.07, "f1": 0.11}
    assert raha_baseline(csv, 0) is None
    assert raha_baseline(tmp_path / "missing.csv", 10) is None


@pytest.fixture
def env(tmp_path):
    datasets = tmp_path / "datasets" / "d"
    (datasets / "t1").mkdir(parents=True)
    (datasets / "t1" / "dirty.csv").write_text("a,b\nx,y\np,q\nr,s\n")
    (datasets / "t1" / "clean.csv").write_text("a,b\nx,y\np,Q\nr,s\n")
    (datasets / "noclean").mkdir()
    (datasets / "noclean" / "dirty.csv").write_text("a\n1\n")
    pipelines = tmp_path / "pipelines"
    write_pipeline(pipelines, "p1", "d", 12, [{"Time": "2025-03-01 10:00:00", "metrics": {"Precision": 0.9, "Recall": 0.8, "F1": 0.85}}])
    write_pipeline(pipelines, "p2", "d", 5, [])
    raha = tmp_path / "raha.csv"
    raha.write_text("labeling_budget,precision,recall,f_score,f_score_std\n12,0.33,0.07,0.11,0\n")
    (pipelines / "p1" / "user_labels.csv").write_text(
        "table,is_error,row,col,val,domain_fold,cell_fold\n"
        "t1,False,0,a,x,D,F\n"  # said correct, truly clean -> right
        "t1,False,1,b,q,D,F\n"  # said correct, truly dirty -> wrong
        "t1,True,2,b,s,D,F\n"  # said error, truly clean -> wrong
        "t1,True,1,b,q,D,F\n"  # said error, truly dirty -> right
        "noclean,True,0,a,1,D,F\n"  # no ground truth -> left out
    )
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        datasets_dir=tmp_path / "datasets", cors_origins=[], pipelines_dir=pipelines, raha_baseline_csv=raha
    )
    return TestClient(app), pipelines


def test_label_accuracy_function(env, tmp_path):
    _, pipelines = env
    result = label_accuracy(pipelines / "p1", tmp_path / "datasets" / "d")
    assert (result["total"], result["correct"], result["accuracy"]) == (4, 2, 0.5)
    assert [r["correct"] for r in result["rows"]] == [True, False, False, True]
    assert result["rows"][1]["clean_value"] == "Q" and result["rows"][1]["truth_is_error"] is True
    with pytest.raises(FileNotFoundError):
        label_accuracy(pipelines / "p2", tmp_path / "datasets" / "d")


def test_results_endpoint(env):
    client, _ = env
    body = client.get("/api/pipelines/p1/results").json()
    assert body["dataset"] == "d" and body["pipeline"] == "p1" and body["labeling_budget"] == 12
    assert body["metrics"]["f1"] == 0.85
    assert [r["pipeline"] for r in body["comparison"]] == ["p1"]
    assert body["raha"]["f1"] == 0.11
    empty = client.get("/api/pipelines/p2/results").json()
    assert empty["metrics"] is None
    assert [r["pipeline"] for r in empty["comparison"]] == ["p1"]  # all pipelines of the same dataset
    assert client.get("/api/pipelines/nope/results").status_code == 404


def test_label_accuracy_endpoints(env):
    client, _ = env
    body = client.get("/api/pipelines/p1/label-accuracy", params={"offset": 1, "limit": 2}).json()
    assert body["total"] == 4 and body["correct"] == 2 and body["accuracy"] == 0.5 and len(body["rows"]) == 2
    csv = client.get("/api/pipelines/p1/label-accuracy.csv")
    assert csv.status_code == 200 and csv.headers["content-type"].startswith("text/csv")
    assert "attachment" in csv.headers["content-disposition"]
    lines = csv.text.strip().splitlines()
    assert lines[0].startswith("table,row,col") and len(lines) == 5
    for url in ("/api/pipelines/p2/label-accuracy", "/api/pipelines/p2/label-accuracy.csv"):
        r = client.get(url)
        assert r.status_code == 409 and "user labels" in r.json()["detail"].lower()
    assert client.get("/api/pipelines/p1/label-accuracy", params={"limit": 201}).status_code == 422


def test_comparison_rows_does_not_reparse_unchanged_pipelines(tmp_path, monkeypatch):
    import api.results as results_mod

    write_pipeline(tmp_path, "cached-a", "d", 10, [{"Time": "2025-01-01 10:00:00", "metrics": {"f1": 0.4}}])
    write_pipeline(tmp_path, "cached-b", "d", 20, [{"Time": "2025-03-01 10:00:00", "metrics": {"f1": 0.8}}])
    first = comparison_rows(tmp_path, "d")
    parsed = []
    real = results_mod.json.loads
    monkeypatch.setattr(results_mod.json, "loads", lambda *a, **k: parsed.append(1) or real(*a, **k))
    assert comparison_rows(tmp_path, "d") == first
    assert parsed == []  # the pipelines' big config files are not parsed again
    # a changed pipeline is picked up
    write_pipeline_file = tmp_path / "cached-a" / "configurations.json"
    write_pipeline_file.write_text(json.dumps({"selected_dataset": "d", "labeling_budget": 99, "results": []}))
    assert [r["pipeline"] for r in comparison_rows(tmp_path, "d")] == ["cached-b"]
