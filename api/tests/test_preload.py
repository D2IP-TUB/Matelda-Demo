import threading

from fastapi.testclient import TestClient

from api import services
from api.main import create_app


def test_startup_preloads_the_ml_backend_in_the_background(monkeypatch):
    started = threading.Event()
    monkeypatch.setattr(services, "preload", lambda: started.set())
    with TestClient(create_app()):
        assert started.wait(timeout=2)


def test_preload_can_be_disabled(monkeypatch):
    called = []
    monkeypatch.setattr(services, "preload", lambda: called.append(1))
    monkeypatch.setenv("API_PRELOAD", "0")
    with TestClient(create_app()):
        pass
    assert called == []


def test_a_failing_preload_does_not_break_startup(monkeypatch):
    def boom():
        raise RuntimeError("no torch")

    monkeypatch.setattr(services, "preload", boom)
    with TestClient(create_app()) as client:
        assert client.get("/api/health").status_code == 200
