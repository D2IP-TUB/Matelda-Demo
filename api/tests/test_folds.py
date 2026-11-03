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
