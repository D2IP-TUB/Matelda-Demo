import json
import logging
import os
from typing import Any, Dict, List

import streamlit as st

from backend.fold_system.core.cell_sampler import CellSampler
from backend.fold_system.core.data_reader import DataReader
from backend.fold_system.core.label_propagation import LabelPropagator
from backend.fold_system.core.labeling_budget_distribution import (
    LabelingBudgetDistributor,
)
from backend.fold_system.domain.domain_cell_fold import DomainCellFold
from backend.fold_system.quality.quality_cell_fold import QualityCellFold


def backend_dbf(dataset: str, labeling_budget: int) -> dict:
    """
    Backend function that performs domain-based folding with caching.
    Args:
        dataset (str): Name of the dataset to process
        labeling_budget (int): Budget for labeling
    Returns:
        dict: Dictionary containing domain folds in the format:
        {
            "domain_folds": {
                "Domain Fold 1": ["table1", "table2"],
                "Domain Fold 2": ["table3", "table4"],
                ...
            }
        }
    """
    current_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(
        current_dir
    )  # Go up one level since we're in backend/ folder
    base_path = os.path.join(root_dir, "datasets", dataset)

    logging.info(f"Starting domain-based folding for dataset: {dataset}")
    logging.info(f"Labeling budget: {labeling_budget}")

    if not os.path.exists(base_path):
        logging.error(f"Dataset path does not exist: {base_path}")
        return {"domain_folds": {}}

    try:
        # Step 1: Read all cells from all tables
        reader = DataReader()
        all_cells = reader.read_all_tables(base_path)
        logging.info(f"Loaded {len(all_cells)} total cells")

        # Step 2: Perform domain folding
        domain_fold = DomainCellFold()
        domain_groups = domain_fold.fold_cells(all_cells)
        logging.info(f"Created {len(domain_groups)} domain groups")

        # Step 3: Convert to required output format
        domain_folds = {}
        for domain_id, cells in domain_groups.items():
            # Get unique table names in this domain
            tables_in_domain = list(set(cell.table_id for cell in cells))
            domain_name = f"Domain Fold {domain_id.replace('domain_', '')}"
            domain_folds[domain_name] = tables_in_domain

            # Log domain statistics
            error_count = sum(1 for cell in cells if cell.is_error)
            logging.info(
                f"{domain_name}: {len(tables_in_domain)} tables, {len(cells)} cells, {error_count} errors"
            )

        return {"domain_folds": domain_folds}

    except Exception as e:
        logging.error(f"Error in domain folding: {e}")
        return {"domain_folds": {}}


def backend_qbf(
    selected_dataset: str,
    labeling_budget: int,
    domain_folds: Dict[str, List[str]],
) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """
    Backend function that performs quality-based folding with real labeling budget distribution.
    """
    logging.info(f"Starting quality-based folding for dataset: {selected_dataset}")
    logging.info(f"Labeling budget: {labeling_budget}")

    # Setup
    base_path = os.path.join("datasets", selected_dataset)
    raha_config = {
        "save_results": False,
        "strategy_filtering": False,
        "error_detection_algorithms": ["OD", "RVD", "RVD_orig"],
    }

    try:
        # Read all cells
        reader = DataReader()
        all_cells = reader.read_all_tables(base_path)

        # Create cell lookup by table
        cells_by_table = {}
        for cell in all_cells:
            if cell.table_id not in cells_by_table:
                cells_by_table[cell.table_id] = []
            cells_by_table[cell.table_id].append(cell)

        # Perform quality folding for all domains
        all_quality_groups = {}
        quality_fold = QualityCellFold(base_path, raha_config, n_cores=1)

        for domain_fold_name, table_names in domain_folds.items():
            # Get cells for this domain
            domain_cells = []
            for table_name in table_names:
                if table_name in cells_by_table:
                    domain_cells.extend(cells_by_table[table_name])

            if domain_cells:
                # Perform quality folding
                domain_groups = {domain_fold_name: domain_cells}
                quality_groups = quality_fold.fold_cells(domain_groups)
                all_quality_groups.update(quality_groups)

        # Distribute labeling budget across quality clusters
        budget_distributor = LabelingBudgetDistributor(
            labeling_budget, min_labels_per_cluster=2
        )
        budget_distribution = budget_distributor.distribute_budget(all_quality_groups)

        # Convert to output format with budget information
        result = {}
        for domain_name, quality_clusters in all_quality_groups.items():
            domain_result = {}

            for quality_group_name, quality_cells in quality_clusters.items():
                # Get assigned budget for this cluster
                assigned_budget = budget_distribution.get(domain_name, {}).get(
                    quality_group_name, 0
                )

                cell_fold_name = f"{domain_name} / Cell Fold {quality_group_name.replace('quality_', '')}"

                cell_fold_data = []
                for i, cell in enumerate(quality_cells):
                    # Mark cells as selected for labeling based on budget
                    is_selected_for_labeling = i < assigned_budget

                    cell_dict = {
                        "table": cell.table_id,
                        "row": cell.row_idx,
                        "col": cell.col_name,
                        "val": cell.dirty_value,
                        "strategies": _convert_features_to_strategies(cell.features),
                        "selected_for_labeling": is_selected_for_labeling,
                        "assigned_budget": assigned_budget
                        if i == 0
                        else None,  # Only show budget on first cell
                    }
                    cell_fold_data.append(cell_dict)

                domain_result[cell_fold_name] = cell_fold_data
                logging.info(
                    f"Created {cell_fold_name} with {len(cell_fold_data)} cells, budget: {assigned_budget}"
                )

            result[domain_name] = domain_result

        return result

    except Exception as e:
        logging.error(f"Error in quality-based folding: {e}")
        return {}


def _convert_features_to_strategies(features: List[float]) -> Dict[str, bool]:
    """Convert RAHA feature vector to strategy dictionary"""
    strategies = {}

    for i, feature_value in enumerate(features):
        strategy_name = f"strategy{i:02d}"
        strategies[strategy_name] = bool(feature_value > 0)

    return strategies


def backend_sample_labeling(
    selected_dataset: str,
    labeling_budget: int,
    cell_folds: Dict[str, Dict[str, List[Dict[str, Any]]]],
    domain_folds: Dict[str, List[str]],
) -> List[Dict[str, Any]]:
    """Backend function that samples cells for labeling using your sophisticated sampling strategies."""

    logging.info(f"Starting cell sampling for dataset: {selected_dataset}")
    logging.info(f"Labeling budget: {labeling_budget}")

    try:
        # Step 1: Calculate budget distribution across cell folds (simplified)
        cluster_info = []
        for domain_name, domain_cell_folds in cell_folds.items():
            for cell_fold_name, cells_data in domain_cell_folds.items():
                cluster_info.append(
                    {
                        "domain": domain_name,
                        "cell_fold": cell_fold_name,
                        "n_cells": len(cells_data),
                        "error_rate": 0.1,  # Default error rate for budget calculation
                    }
                )

        # Simple proportional budget distribution
        total_cells = sum(info["n_cells"] for info in cluster_info)
        budget_distribution = {}

        for info in cluster_info:
            domain = info["domain"]
            cell_fold = info["cell_fold"]
            proportion = info["n_cells"] / total_cells if total_cells > 0 else 0
            allocated_budget = max(
                1, int(labeling_budget * proportion)
            )  # At least 1 sample

            if domain not in budget_distribution:
                budget_distribution[domain] = {}
            budget_distribution[domain][cell_fold] = allocated_budget

        # Step 2: Sample cells using your sophisticated sampling strategies
        sampler = CellSampler(sampling_strategy="mixed")
        sampled_cells = sampler.sample_cells_from_cell_folds_direct(
            cell_folds, budget_distribution
        )

        # Step 3: Validate budget usage
        if len(sampled_cells) > labeling_budget:
            sampled_cells = sampled_cells[:labeling_budget]

        logging.info(f"Successfully sampled {len(sampled_cells)} cells for labeling")
        return sampled_cells

    except Exception as e:
        logging.error(f"Error in cell sampling: {e}")
        return []


def _convert_cell_folds_to_quality_groups(
    cell_folds: Dict[str, Dict[str, List[Dict[str, Any]]]],
) -> Dict[str, Dict[str, List]]:
    """Convert cell_folds format to quality_groups format for budget distributor"""
    quality_groups = {}

    for domain_name, domain_cell_folds in cell_folds.items():
        quality_groups[domain_name] = {}

        for cell_fold_name, cells_data in domain_cell_folds.items():
            # Extract quality cluster name
            if " / Cell Fold " in cell_fold_name:
                quality_name = f"quality_{cell_fold_name.split(' / Cell Fold ')[-1]}"
            else:
                quality_name = "quality_0"

            # Create mock Cell objects for budget calculation
            mock_cells = [
                {"is_error": False} for _ in cells_data
            ]  # Simplified for budget calc
            quality_groups[domain_name][quality_name] = mock_cells

    return quality_groups


def _log_sampling_statistics(
    sampled_cells: List[Dict[str, Any]], budget_distribution: Dict[str, Dict[str, int]]
):
    """Log detailed sampling statistics"""

    # Count samples by domain
    domain_counts = {}
    for cell in sampled_cells:
        domain = cell["domain_fold"]
        domain_counts[domain] = domain_counts.get(domain, 0) + 1

    logging.info("=== Sampling Statistics ===")
    for domain, count in domain_counts.items():
        total_budget = sum(budget_distribution.get(domain, {}).values())
        logging.info(f"Domain {domain}: {count} samples (budget: {total_budget})")

    # Count samples by cell fold
    cell_fold_counts = {}
    for cell in sampled_cells:
        cell_fold = cell["cell_fold"]
        cell_fold_counts[cell_fold] = cell_fold_counts.get(cell_fold, 0) + 1

    logging.info("Top cell folds by sample count:")
    sorted_folds = sorted(cell_fold_counts.items(), key=lambda x: x[1], reverse=True)[
        :5
    ]
    for cell_fold, count in sorted_folds:
        logging.info(f"  {cell_fold}: {count} samples")


def backend_label_propagation(
    selected_dataset: str, labeled_cells: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Backend function that propagates errors based on labeled cells using your majority voting logic.

    Args:
        selected_dataset (str): Name of the dataset to process
        labeled_cells (List[Dict[str, Any]]): List of labeled cells with their properties
            Each cell should have:
            {
                "table": str,
                "row": int,
                "col": str,
                "val": Any,
                "is_error": bool, # True if labeled as error, False if labeled as correct
                "domain_fold": str,
                "cell_fold": str,
                "cell_fold_label": str # "correct", "false", or "neutral"
            }

    Returns:
        Dict[str, Any]: Dictionary containing propagated errors and their sources:
        {
            "labeled_cells": [
                {
                    "table": str,
                    "row": int,
                    "col": str,
                    "val": Any,
                    "is_error": bool,
                    "propagated_cells": [
                        {
                            "table": str,
                            "row": int,
                            "col": str,
                            "val": Any,
                            "confidence": float, # confidence score for this being an error
                            "reason": str # explanation of why this was propagated
                        },
                        ...
                    ]
                },
                ...
            ]
        }
    """
    logging.info(f"Starting label propagation for dataset: {selected_dataset}")
    logging.info(f"Processing {len(labeled_cells)} labeled cells")

    try:
        # Step 1: Convert cell_fold_label to is_error boolean
        processed_labeled_cells = []
        for cell in labeled_cells:
            processed_cell = cell.copy()

            # Convert cell_fold_label to is_error
            if "cell_fold_label" in cell:
                if cell["cell_fold_label"] == "false":
                    processed_cell["is_error"] = True
                elif cell["cell_fold_label"] == "correct":
                    processed_cell["is_error"] = False
                else:  # neutral
                    processed_cell["is_error"] = False  # Default to not error

            processed_labeled_cells.append(processed_cell)

        # Step 2: We need the cell_folds to know which cells to propagate to
        # This should be passed from the previous step or reconstructed
        # For now, let's reconstruct cell folds from labeled cells
        cell_folds = _reconstruct_cell_folds_from_labeled_cells(processed_labeled_cells)

        # Step 3: Perform label propagation using majority voting logic
        propagator = LabelPropagator(propagation_method="majority")
        propagation_results = propagator.propagate_labels(
            processed_labeled_cells, cell_folds
        )

        # Step 4: Log propagation statistics
        _log_propagation_statistics(propagation_results)

        return propagation_results

    except Exception as e:
        logging.error(f"Error in label propagation: {e}")
        return {"labeled_cells": []}


def _reconstruct_cell_folds_from_labeled_cells(
    labeled_cells: List[Dict[str, Any]],
) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """Reconstruct cell folds structure from labeled cells"""
    cell_folds = {}

    for cell in labeled_cells:
        domain_fold = cell["domain_fold"]
        cell_fold = cell["cell_fold"]

        if domain_fold not in cell_folds:
            cell_folds[domain_fold] = {}
        if cell_fold not in cell_folds[domain_fold]:
            cell_folds[domain_fold][cell_fold] = []

        # Add this cell to the fold
        cell_data = {
            "table": cell["table"],
            "row": cell["row"],
            "col": cell["col"],
            "val": cell["val"],
        }
        cell_folds[domain_fold][cell_fold].append(cell_data)

    return cell_folds


def _log_propagation_statistics(propagation_results: Dict[str, Any]):
    """Log detailed propagation statistics"""
    labeled_cells = propagation_results.get("labeled_cells", [])

    total_labeled = len(labeled_cells)
    total_propagated = sum(
        len(cell.get("propagated_cells", [])) for cell in labeled_cells
    )

    # Count by error type
    error_propagations = 0
    correct_propagations = 0

    for labeled_cell in labeled_cells:
        is_source_error = labeled_cell.get("is_error", False)
        propagated_count = len(labeled_cell.get("propagated_cells", []))

        if is_source_error:
            error_propagations += propagated_count
        else:
            correct_propagations += propagated_count

    logging.info("=== Label Propagation Statistics ===")
    logging.info(f"Labeled cells: {total_labeled}")
    logging.info(f"Total propagated cells: {total_propagated}")
    logging.info(f"Error propagations: {error_propagations}")
    logging.info(f"Correct propagations: {correct_propagations}")
    logging.info(
        f"Average propagations per labeled cell: {total_propagated / total_labeled:.2f}"
    )


def backend_pull_errors(selected_dataset: str) -> Dict[str, Any]:
    """
    Backend function that retrieves all detected errors from the configurations.json file.
    This is a dummy implementation that will be replaced with actual logic in the future.

    Args:
        selected_dataset (str): Name of the dataset to process

    Returns:
        Dict[str, Any]: Dictionary containing all detected errors and metrics:
        {
            "propagated_errors": {
                "table1": [
                    {
                        "row": int,
                        "col": str,
                        "val": Any,
                        "confidence": float,  # confidence score for this being an error
                        "source": str  # e.g., "direct_label", "cell_fold_propagation", etc.
                    },
                    ...
                ],
                "table2": [...],
                ...
            },
            "metrics": {
                "precision": float,
                "recall": float,
                "f1": float,
                "fold_label_influence": float  # measure of how cell fold labels influenced the results
            }
        }
    """
    # Get the actual tables from the dataset directory
    current_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(
        current_dir
    )  # Go up one level since we're in backend/ folder

    # Get the pipeline path from session state
    if "pipeline_path" not in st.session_state:
        print("No pipeline path in session state")
        return {
            "propagated_errors": {},
            "metrics": {
                "precision": 0.0,
                "recall": 0.0,
                "f1": 0.0,
                "fold_label_influence": 0.0,
            },
        }

    config_path = os.path.join(st.session_state.pipeline_path, "configurations.json")

    try:
        with open(config_path, "r") as f:
            config = json.load(f)

        # Get the propagated errors from the config
        propagated_errors = config.get("propagated_errors", {})

        # Get the metrics from the latest result
        results = config.get("results", [])
        if results:
            metrics = results[-1].get("metrics", {})
        else:
            metrics = {
                "precision": 0.0,
                "recall": 0.0,
                "f1": 0.0,
                "fold_label_influence": 0.0,
            }

        return {"propagated_errors": propagated_errors, "metrics": metrics}

    except Exception as e:
        print(f"Error loading configuration: {e}")
        return {
            "propagated_errors": {},
            "metrics": {
                "precision": 0.0,
                "recall": 0.0,
                "f1": 0.0,
                "fold_label_influence": 0.0,
            },
        }
