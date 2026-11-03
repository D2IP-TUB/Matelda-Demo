import pytest
from fastapi.testclient import TestClient

from api import services
from api.datasets import list_datasets, resolve_dataset
from api.main import create_app
from api.settings import Settings, get_settings


@pytest.fixture
def root(tmp_path):
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    (tmp_path / "c.txt").write_text("x")
    return tmp_path


def test_list_datasets_only_directories_sorted(root):
    assert list_datasets(root) == ["a", "b"]


def test_resolve_known_dataset(root):
    assert resolve_dataset(root, "a") == root / "a"


@pytest.mark.parametrize("name", ["../a", "a/../../etc", "/etc", "", "c.txt", "missing"])
def test_resolve_rejects_traversal_and_unknown(root, name):
    assert resolve_dataset(root, name) is None


def _client(root):
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        datasets_dir=root, cors_origins=[]
    )
    return TestClient(app)


def test_datasets_endpoint_lists(root):
    response = _client(root).get("/api/datasets")
    assert response.status_code == 200
    assert response.json() == ["a", "b"]


def test_strategies_endpoint(monkeypatch, root):
    monkeypatch.setattr(services, "get_available_strategies", lambda: ["x"])
    assert _client(root).get("/api/strategies").json() == ["x"]
