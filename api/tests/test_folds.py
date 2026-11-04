import threading

import numpy as np
import pytest

from api.folds import apply_domain_folds, validate_domain_folds
from api.pipelines import load_config, save_config, update_config

TABLES = ["t1", "t2", "t3"]


def test_valid_folds_pass():
    validate_domain_folds({"F0": ["t1", "t2"], "F1": ["t3"]}, TABLES)


@pytest.mark.parametrize(
    "folds",
    [
        {"F0": ["t1"], "F1": ["t1"]},  # duplicate table
        {"F0": ["nope"]},  # unknown table
        {"": ["t1"]},  # empty fold name
        {"F0": []},  # empty fold
    ],
)
def test_invalid_folds_raise(folds):
    with pytest.raises(ValueError):
        validate_domain_folds(folds, TABLES)


BASE = {
    "selected_dataset": "d",
    "labeling_budget": 10,
    "selected_strategies": ["s"],
    "domain_folds": {"F0": ["t1"]},
    "cell_folds": {"x": {}},
    "cell_fold_labels": {"x": "correct"},
    "results": [1],
}


def test_same_folds_keep_derived_data():
    out = apply_domain_folds(BASE, {"F0": ["t1"]})
    assert out["cell_folds"] == {"x": {}} and out["results"] == [1]


def test_changed_folds_drop_derived_data_but_keep_config():
    out = apply_domain_folds(BASE, {"F0": ["t1", "t2"]})
    assert out["domain_folds"] == {"F0": ["t1", "t2"]}
    assert not any(k in out for k in ("cell_folds", "cell_fold_labels", "results"))
    assert out["labeling_budget"] == 10 and out["selected_dataset"] == "d"


def test_apply_does_not_mutate_input():
    apply_domain_folds(BASE, {"Z": ["t3"]})
    assert BASE["domain_folds"] == {"F0": ["t1"]}


def test_save_config_serialises_numpy(tmp_path):
    save_config(tmp_path, {"a": np.int64(3), "b": np.float64(1.5), "c": np.array([1, 2]), "d": np.bool_(True)})
    assert load_config(tmp_path) == {"a": 3, "b": 1.5, "c": [1, 2], "d": True}


def test_update_config_is_atomic_across_threads(tmp_path):
    save_config(tmp_path, {"n": 0})

    def work():
        for _ in range(50):
            update_config(tmp_path, lambda c: {**c, "n": c["n"] + 1})

    threads = [threading.Thread(target=work) for _ in range(2)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert load_config(tmp_path)["n"] == 100


# ---------------------------------------------------------------- cell fold operations
import copy

from api.folds import (
    CellRef,
    FoldNotFound,
    fold_cells,
    merge_folds,
    move_cell,
    move_fold_to_domain,
    set_label,
    split_domain,
    merge_domains,
    split_fold,
    summarize,
)


def cell(table, row, col, strategies=None):
    return {
        "table": table, "row": row, "col": col, "val": "v", "features": [0.1, 0.2],
        "strategies": strategies or [], "selected_for_labeling": False, "assigned_budget": None,
    }


def make_folds():
    return {
        "D0": {
            "D0 / Cell Fold 0": [cell("t1", 0, "a"), cell("t1", 1, "a"), cell("t2", 0, "b")],
            "D0 / Cell Fold 1": [cell("t1", 2, "a"), cell("t2", 1, "b", ["Typo"])],
        },
        "D1": {"D1 / Cell Fold 0": [cell("t3", 0, "c")]},
    }


F00, F01, F10 = "D0 / Cell Fold 0", "D0 / Cell Fold 1", "D1 / Cell Fold 0"


def names(folds):
    return [f for d in folds.values() for f in d]


def test_summarize_counts_tables_and_labels():
    result = summarize(make_folds(), {F01: "false"})
    assert [s.name for s in result] == [F00, F01, F10]
    first = result[0]
    assert first.domain == "D0" and first.cell_count == 3 and first.label == "neutral"
    assert first.tables == {"t1": {"a": 2}, "t2": {"b": 1}}
    assert result[1].label == "false"


def test_fold_cells_strips_features_and_pages():
    cells, total = fold_cells(make_folds(), F00, offset=1, limit=1)
    assert total == 3 and len(cells) == 1
    assert cells[0].row == 1 and not hasattr(cells[0], "features")
    assert "features" not in cells[0].model_dump()


def test_fold_cells_unknown_fold():
    with pytest.raises(FoldNotFound):
        fold_cells(make_folds(), "nope", 0, 10)


def test_move_cell_between_folds():
    folds, labels = move_cell(make_folds(), {}, CellRef(table="t1", row=0, col="a"), F01)
    assert len(folds["D0"][F00]) == 2 and len(folds["D0"][F01]) == 3
    assert labels == {}


def test_move_last_cell_removes_fold_label_and_empty_domain():
    folds, labels = move_cell(
        make_folds(), {F10: "correct", F00: "false"}, CellRef(table="t3", row=0, col="c"), F00
    )
    assert "D1" not in folds and F10 not in labels and labels[F00] == "false"
    assert len(folds["D0"][F00]) == 4


def test_move_unknown_cell_or_fold_raises():
    with pytest.raises(ValueError):
        move_cell(make_folds(), {}, CellRef(table="zz", row=9, col="q"), F00)
    with pytest.raises(FoldNotFound):
        move_cell(make_folds(), {}, CellRef(table="t1", row=0, col="a"), "nope")


@pytest.mark.parametrize(
    "a,b,expected",
    [
        ("correct", "false", None),
        ("correct", None, "correct"),
        ("false", None, "false"),
        (None, None, None),
        ("correct", "correct", "correct"),
    ],
)
def test_merge_label_rules(a, b, expected):
    labels = {k: v for k, v in {F00: a, F01: b}.items() if v}
    folds, new = merge_folds(make_folds(), labels, [F00, F01])
    assert F01 not in new
    assert new.get(F00) == expected


def test_merge_moves_cells_into_first_fold_across_domains():
    folds, labels = merge_folds(make_folds(), {F10: "correct"}, [F00, F10])
    assert len(folds["D0"][F00]) == 4 and "D1" not in folds
    assert F10 not in labels and labels[F00] == "correct"


@pytest.mark.parametrize("selection", [[F00], [F00, F00], []])
def test_merge_needs_two_distinct_folds(selection):
    with pytest.raises(ValueError):
        merge_folds(make_folds(), {}, selection)


def test_merge_unknown_fold():
    with pytest.raises(FoldNotFound):
        merge_folds(make_folds(), {}, [F00, "nope"])


def test_split_after_selected_cells_names_segments_and_copies_label():
    folds, labels = split_fold(
        make_folds(), {F00: "correct"}, F00, [CellRef(table="t1", row=1, col="a")]
    )
    s1, s2 = f"{F00} - Split 1", f"{F00} - Split 2"
    assert F00 not in folds["D0"] and F00 not in labels
    assert [c["row"] for c in folds["D0"][s1]] == [0, 1] and len(folds["D0"][s2]) == 1
    assert labels[s1] == labels[s2] == "correct"
    assert list(folds["D0"]) == [s1, s2, F01]  # order preserved


def test_split_selecting_last_cell_makes_no_empty_segment():
    folds, _ = split_fold(make_folds(), {}, F00, [CellRef(table="t2", row=0, col="b")])
    assert list(folds["D0"])[0] == f"{F00} - Split 1" and len(folds["D0"]) == 2


def test_split_without_cells_or_with_foreign_cell_raises():
    with pytest.raises(ValueError):
        split_fold(make_folds(), {}, F00, [])
    with pytest.raises(ValueError):
        split_fold(make_folds(), {}, F00, [CellRef(table="t3", row=0, col="c")])


def test_set_label_and_clear():
    assert set_label({}, F00, "correct") == {F00: "correct"}
    assert set_label({F00: "correct"}, F00, None) == {}


def test_operations_do_not_mutate_inputs():
    folds, labels = make_folds(), {F00: "correct"}
    before = copy.deepcopy((folds, labels))
    move_cell(folds, labels, CellRef(table="t1", row=0, col="a"), F01)
    merge_folds(folds, labels, [F00, F01])
    split_fold(folds, labels, F00, [CellRef(table="t1", row=1, col="a")])
    set_label(labels, F00, None)
    assert (folds, labels) == before


# ---------------------------------------------------------------- domain-level operations
def three_in_d0():
    folds = make_folds()
    folds["D0"]["D0 / Cell Fold 2"] = [cell("t4", 0, "d")]
    return folds


F02 = "D0 / Cell Fold 2"


def test_move_fold_to_domain_keeps_name_cells_and_label():
    folds, labels = move_fold_to_domain(make_folds(), {F01: "false"}, F01, "D1")
    assert list(folds["D0"]) == [F00]
    assert list(folds["D1"]) == [F10, F01]
    assert len(folds["D1"][F01]) == 2 and labels == {F01: "false"}


def test_move_last_fold_out_of_a_domain_removes_that_domain():
    folds, _ = move_fold_to_domain(make_folds(), {}, F10, "D0")
    assert list(folds) == ["D0"] and list(folds["D0"]) == [F00, F01, F10]


def test_move_fold_to_its_own_domain_changes_nothing():
    folds, labels = move_fold_to_domain(make_folds(), {F00: "correct"}, F00, "D0")
    assert folds == make_folds() and labels == {F00: "correct"}


def test_move_fold_unknown_fold_or_domain():
    with pytest.raises(FoldNotFound):
        move_fold_to_domain(make_folds(), {}, "nope", "D1")
    with pytest.raises(FoldNotFound):
        move_fold_to_domain(make_folds(), {}, F00, "nope")


def test_split_domain_keeps_the_left_and_moves_the_right_into_a_new_domain():
    folds, labels = split_domain(three_in_d0(), {F02: "correct"}, "D0", F00)
    assert list(folds) == ["D0", "D0 - Split 1", "D1"]  # the new domain sits right after the one it came from
    assert list(folds["D0"]) == [F00]
    assert list(folds["D0 - Split 1"]) == [F01, F02]
    assert labels == {F02: "correct"}  # fold names and labels do not change


def test_split_domain_in_the_middle():
    folds, _ = split_domain(three_in_d0(), {}, "D0", F01)
    assert list(folds["D0"]) == [F00, F01] and list(folds["D0 - Split 1"]) == [F02]


def test_split_domain_picks_a_free_name():
    folds = three_in_d0()
    folds["D0 - Split 1"] = {"X": [cell("t9", 0, "z")]}
    out, _ = split_domain(folds, {}, "D0", F00)
    assert "D0 - Split 2" in out and list(out["D0 - Split 2"]) == [F01, F02]


def test_split_domain_after_the_last_fold_or_with_a_foreign_fold_is_rejected():
    with pytest.raises(ValueError):
        split_domain(make_folds(), {}, "D0", F01)  # nothing to the right
    with pytest.raises(FoldNotFound):
        split_domain(make_folds(), {}, "D0", F10)  # fold belongs to another domain
    with pytest.raises(FoldNotFound):
        split_domain(make_folds(), {}, "nope", F00)


def test_merge_domains_moves_every_fold_to_the_end_of_the_target():
    folds, labels = merge_domains(make_folds(), {F00: "correct"}, "D0", "D1")
    assert list(folds) == ["D1"]
    assert list(folds["D1"]) == [F10, F00, F01]
    assert labels == {F00: "correct"}  # fold names and labels do not change


def test_merge_domains_rejects_unknown_or_same_domain():
    with pytest.raises(FoldNotFound):
        merge_domains(make_folds(), {}, "nope", "D1")
    with pytest.raises(FoldNotFound):
        merge_domains(make_folds(), {}, "D0", "nope")
    with pytest.raises(ValueError):
        merge_domains(make_folds(), {}, "D0", "D0")


def test_domain_operations_do_not_mutate_inputs():
    folds, labels = three_in_d0(), {F00: "correct"}
    before = copy.deepcopy((folds, labels))
    move_fold_to_domain(folds, labels, F01, "D1")
    split_domain(folds, labels, "D0", F00)
    merge_domains(folds, labels, "D0", "D1")
    assert (folds, labels) == before
