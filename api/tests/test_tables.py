import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.settings import Settings, get_settings
from api.tables import compare, list_tables, read_page, resolve_table


@pytest.fixture
def dataset(tmp_path):
    root = tmp_path / "datasets"
    d = root / "d"
    for name, dirty, clean in [
        ("t1", "a,b\n1,2\n3,x\n", "a,b\n1,2\n3,4\n"),
        ("t2", "a,b\n1,2\n", None),
        ("t3", "a\n1\n", "a,b\n1,2\n"),
        ("empty", "a,b\n", "a,b\n"),
    ]:
        (d / name).mkdir(parents=True)
        (d / name / "dirty.csv").write_text(dirty)
        if clean is not None:
            (d / name / "clean.csv").write_text(clean)
    (d / "notes.txt").write_text("x")
    (d / "nodirty").mkdir()
    return d


def test_list_tables_only_dirs_with_dirty_csv(dataset):
    assert list_tables(dataset) == ["empty", "t1", "t2", "t3"]


@pytest.mark.parametrize("name", ["../t1", "t1/..", "/etc", "", "missing"])
def test_resolve_table_rejects_traversal(dataset, name):
    assert resolve_table(dataset, name) is None


def test_dirty_page_returns_rows_as_strings(dataset):
    page = read_page(dataset / "t1", offset=1, limit=1)
    assert page.columns == ["a", "b"]
    assert page.rows == [["3", "x"]]
    assert page.total_rows == 2
    assert page.offset == 1


def test_dirty_page_offset_past_end_is_empty(dataset):
    assert read_page(dataset / "t1", offset=50, limit=10).rows == []


def test_empty_table_page(dataset):
    page = read_page(dataset / "empty", offset=0, limit=10)
    assert page.rows == [] and page.total_rows == 0 and page.columns == ["a", "b"]


def test_compare_counts_and_mask(dataset):
    result = compare(dataset / "t1", offset=0, limit=100)
    assert result.total_cells == 4
    assert result.differing_cells == 1
    assert result.error_rate == 25.0
    assert result.diff == [[False, False], [False, True]]
    assert result.dirty_rows[1] == ["3", "x"] and result.clean_rows[1] == ["3", "4"]


def test_compare_pages_but_counts_whole_table(dataset):
    result = compare(dataset / "t1", offset=0, limit=1)
    assert len(result.dirty_rows) == 1
    assert result.differing_cells == 1 and result.total_cells == 4 and result.total_rows == 2


def test_compare_empty_table_has_zero_rate(dataset):
    result = compare(dataset / "empty", offset=0, limit=10)
    assert result.total_cells == 0 and result.error_rate == 0.0


def test_compare_without_clean_raises(dataset):
    with pytest.raises(FileNotFoundError):
        compare(dataset / "t2", offset=0, limit=10)


def test_compare_shape_mismatch_raises(dataset):
    with pytest.raises(ValueError):
        compare(dataset / "t3", offset=0, limit=10)


@pytest.fixture
def client(dataset, tmp_path):
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        datasets_dir=dataset.parent, cors_origins=[], pipelines_dir=tmp_path / "pipelines"
    )
    return TestClient(app)


def test_endpoint_lists_tables(client):
    assert client.get("/api/datasets/d/tables").json() == ["empty", "t1", "t2", "t3"]


def test_endpoint_unknown_dataset_404(client):
    assert client.get("/api/datasets/nope/tables").status_code == 404


def test_endpoint_traversal_table_404(client):
    assert client.get("/api/datasets/d/tables/..%2Ft1/dirty").status_code == 404
    assert client.get("/api/datasets/d/tables/missing/compare").status_code == 404


def test_endpoint_dirty_and_compare(client):
    assert client.get("/api/datasets/d/tables/t1/dirty?limit=1").json()["rows"] == [["1", "2"]]
    assert client.get("/api/datasets/d/tables/t1/compare").json()["differing_cells"] == 1


def test_endpoint_compare_errors(client):
    assert client.get("/api/datasets/d/tables/t2/compare").status_code == 404
    assert client.get("/api/datasets/d/tables/t3/compare").status_code == 422


@pytest.mark.parametrize("query", ["limit=0", "limit=501", "offset=-1"])
def test_endpoint_rejects_bad_paging(client, query):
    assert client.get(f"/api/datasets/d/tables/t1/dirty?{query}").status_code == 422
