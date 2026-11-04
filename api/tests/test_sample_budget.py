from unittest.mock import patch

from backend import backend as be


def _folds(selected: int, total: int):
    cells = [
        {"table": "t", "row": i, "col": "a", "val": str(i), "selected_for_labeling": i < selected}
        for i in range(total)
    ]
    return {"D0": {"F0": cells}}


def _sample(budget: int, selected: int, total: int):
    with patch.object(be, "_load_bulk_annotations", return_value={}):
        return be.backend_sample_labeling("demo", budget, _folds(selected, total), {})


def test_budget_is_used_in_full_even_when_quality_folding_preselected_fewer_cells():
    assert len(_sample(budget=10, selected=1, total=50)) == 10


def test_preselected_cells_come_first():
    sampled = _sample(budget=10, selected=3, total=50)
    assert [c["row"] for c in sampled[:3]] == [0, 1, 2]


def test_never_more_than_the_budget_or_the_available_cells():
    assert len(_sample(budget=4, selected=9, total=50)) == 4
    assert len(_sample(budget=10, selected=1, total=6)) == 6
