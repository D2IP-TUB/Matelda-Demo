"""The only module that imports `backend/`. Imports are lazy: loading the ML stack
takes several seconds and must not slow API startup or the test suite."""
from typing import Any


def get_available_strategies() -> list[str]:
    from backend import get_available_strategies as fn

    return fn()


def backend_dbf(dataset: str, labeling_budget: int) -> dict[str, Any]:
    from backend import backend_dbf as fn

    return fn(dataset, labeling_budget)


def backend_qbf(
    selected_dataset: str,
    labeling_budget: int,
    domain_folds: dict[str, list[str]],
    selected_strategies: list[str],
) -> dict[str, Any]:
    from backend import backend_qbf as fn

    return fn(selected_dataset, labeling_budget, domain_folds, selected_strategies)


def backend_sample_labeling(
    selected_dataset: str,
    labeling_budget: int,
    cell_folds: dict[str, Any],
    domain_folds: dict[str, list[str]],
) -> list[dict[str, Any]]:
    from backend import backend_sample_labeling as fn

    return fn(selected_dataset, labeling_budget, cell_folds, domain_folds)


def backend_label_propagation(
    selected_dataset: str, labeled_cells: list[dict[str, Any]]
) -> dict[str, Any]:
    from backend import backend_label_propagation as fn

    return fn(selected_dataset, labeled_cells)


def backend_pull_errors(selected_dataset: str) -> dict[str, Any]:
    from backend import backend_pull_errors as fn

    return fn(selected_dataset)
