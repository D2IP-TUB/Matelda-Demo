import time

import pytest
from fastapi.testclient import TestClient

from api import services
from api.jobs import JobStore, get_job_store
from api.main import create_app
from api.settings import Settings, get_settings


@pytest.fixture
def client(tmp_path):
    (tmp_path / "demo").mkdir()
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        datasets_dir=tmp_path, cors_origins=[]
    )
    store = JobStore()
    app.dependency_overrides[get_job_store] = lambda: store
    return TestClient(app)


def poll(client, job_id, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/api/jobs/{job_id}").json()
        if body["state"] != "running":
            return body
        time.sleep(0.01)
    raise AssertionError("job did not finish")


def test_domain_folding_starts_job_and_returns_result(client, monkeypatch):
    folds = {"domain_folds": {"Domain Fold 1": ["t1"]}}
    monkeypatch.setattr(services, "backend_dbf", lambda d, b: folds)
    response = client.post("/api/folding/domain", json={"dataset": "demo", "labeling_budget": 5})
    assert response.status_code == 200
    body = poll(client, response.json()["job_id"])
    assert body["state"] == "done"
    assert body["result"] == folds


def test_domain_folding_unknown_dataset_404(client):
    response = client.post("/api/folding/domain", json={"dataset": "../x", "labeling_budget": 5})
    assert response.status_code == 404


def test_domain_folding_rejects_zero_budget(client):
    response = client.post("/api/folding/domain", json={"dataset": "demo", "labeling_budget": 0})
    assert response.status_code == 422


def test_failing_backend_marks_job_failed(client, monkeypatch):
    def boom(d, b):
        raise RuntimeError("model exploded")

    monkeypatch.setattr(services, "backend_dbf", boom)
    job_id = client.post(
        "/api/folding/domain", json={"dataset": "demo", "labeling_budget": 5}
    ).json()["job_id"]
    body = poll(client, job_id)
    assert body["state"] == "failed"
    assert "model exploded" in body["error"]


CASES = [
    (
        "backend_qbf",
        "/api/folding/quality",
        {
            "dataset": "demo",
            "labeling_budget": 3,
            "domain_folds": {"Domain Fold 1": ["t1"]},
            "selected_strategies": ["Typo Detector"],
        },
        ("demo", 3, {"Domain Fold 1": ["t1"]}, ["Typo Detector"]),
    ),
    (
        "backend_sample_labeling",
        "/api/labeling/sample",
        {
            "dataset": "demo",
            "labeling_budget": 4,
            "cell_folds": {"f": {"g": []}},
            "domain_folds": {"Domain Fold 1": ["t1"]},
        },
        ("demo", 4, {"f": {"g": []}}, {"Domain Fold 1": ["t1"]}),
    ),
    (
        "backend_label_propagation",
        "/api/labeling/propagate",
        {"dataset": "demo", "labeled_cells": [{"table": "t1", "row": 0}]},
        ("demo", [{"table": "t1", "row": 0}]),
    ),
    ("backend_pull_errors", "/api/errors", {"dataset": "demo"}, ("demo",)),
]


@pytest.mark.parametrize("fn_name,url,body,expected_args", CASES)
def test_each_endpoint_passes_arguments_through(client, monkeypatch, fn_name, url, body, expected_args):
    seen = {}

    def fake(*args):
        seen["args"] = args
        return {"ok": True}

    monkeypatch.setattr(services, fn_name, fake)
    job_id = client.post(url, json=body).json()["job_id"]
    result = poll(client, job_id)
    assert result["state"] == "done"
    assert result["result"] == {"ok": True}
    assert seen["args"] == expected_args


@pytest.mark.slow
def test_real_domain_folding_on_demo_dataset():
    app = create_app()
    client = TestClient(app)
    job_id = client.post(
        "/api/folding/domain", json={"dataset": "BIFOLD_Demo", "labeling_budget": 10}
    ).json()["job_id"]
    body = poll(client, job_id, timeout=300)
    assert body["state"] == "done"
    assert body["result"]["domain_folds"]
