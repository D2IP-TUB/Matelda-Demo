import time

from fastapi.testclient import TestClient

from api.jobs import JobStore, get_job_store
from api.main import create_app


def wait_done(store: JobStore, job_id: str, timeout: float = 5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        info = store.status(job_id)
        if info and info.state != "running":
            return info
        time.sleep(0.01)
    raise AssertionError("job did not finish")


def test_job_completes_with_result():
    store = JobStore()
    info = wait_done(store, store.submit(lambda: 41 + 1))
    assert info.state == "done"
    assert info.result == 42


def test_failing_job_reports_error():
    store = JobStore()

    def boom():
        raise ValueError("boom")

    info = wait_done(store, store.submit(boom))
    assert info.state == "failed"
    assert "boom" in info.error


def test_unknown_job_is_none():
    assert JobStore().status("nope") is None


def _client(store: JobStore) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_job_store] = lambda: store
    return TestClient(app)


def test_jobs_endpoint_404_for_unknown_id():
    assert _client(JobStore()).get("/api/jobs/missing").status_code == 404


def test_jobs_endpoint_returns_done_job():
    store = JobStore()
    job_id = store.submit(lambda: {"a": 1})
    wait_done(store, job_id)
    body = _client(store).get(f"/api/jobs/{job_id}").json()
    assert body["state"] == "done"
    assert body["result"] == {"a": 1}
    assert body["id"] == job_id
