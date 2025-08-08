import json
import os
import random
from typing import Any, Dict, List

import streamlit as st

from .domain_folding import load_from_cache, matelda_domain_folding, save_to_cache
from .quality_folding import generate_cell_features


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
    datasets_path = os.path.join(root_dir, "datasets", dataset)

    if not os.path.exists(datasets_path):
        print(f"Dataset path does not exist: {datasets_path}")
        return {"domain_folds": {}}

    try:
        tables = [
            d
            for d in os.listdir(datasets_path)
            if os.path.isdir(os.path.join(datasets_path, d))
        ]
    except Exception as e:
        print(f"Error reading dataset directory: {e}")
        return {"domain_folds": {}}

    if not tables:
        print(f"No tables found in dataset: {dataset}")
        return {"domain_folds": {}}

    # Setup cache directory
    cache_dir = os.path.join(datasets_path, "cache")
    os.makedirs(cache_dir, exist_ok=True)

    # Check for cached results
    cached_result = load_from_cache(cache_dir, tables)
    if cached_result:
        print("Loading domain folds from cache...")
        return {"domain_folds": cached_result}

    print("Cache not found or invalid. Computing domain folds from scratch...")

    try:
        domain_folds = matelda_domain_folding(datasets_path, tables)
        if domain_folds:
            # Save to cache
            save_to_cache(cache_dir, tables, domain_folds)
            return {"domain_folds": domain_folds}
    except Exception as e:
        print(f"Error in domain folding: {e}")
        print("Falling back to original random assignment")

    # Fallback logic
    num_folds = min(1, len(tables))
    folds = [f"Domain Fold {i + 1}" for i in range(num_folds)]

    # Randomly assign tables to folds
    domain_folds = {fold: [] for fold in folds}
    for table in tables:
        fold = random.choice(folds)
        domain_folds[fold].append(table)

    # Remove empty folds
    domain_folds = {k: v for k, v in domain_folds.items() if v}

    # Save fallback result to cache as well
    save_to_cache(cache_dir, tables, domain_folds)

    return {"domain_folds": domain_folds}


def backend_qbf(
    selected_dataset: str,
    labeling_budget: int,
    domain_folds: Dict[str, List[str]],
) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """
    Backend function that performs quality-based folding.
    This is a dummy implementation that will be replaced with actual logic in the future.

    Args:
        selected_dataset (str): Name of the dataset to process
        labeling_budget (int): Budget for labeling
        domain_folds (Dict[str, List[str]]): Dictionary mapping domain fold names to lists of table names
            Example: {
                "Domain Fold 1": ["beers", "rayyan"],
                "Domain Fold 2": ["lichess", "pokemon"]
            }

    Returns:
        Dict[str, Dict[str, List[Dict[str, Any]]]]: Dictionary containing cell folds in the format:
        {
            "Domain Fold 1": {
                "Domain Fold 1 / Cell Fold 1": [
                    {
                        "table": "beers",
                        "row": 42,
                        "col": "name",
                        "val": "Heineken",
                        "strategies": {
                            "strategy01": true,
                            "strategy02": false,
                            ...
                        }
                    },
                    ...
                ],
                "Domain Fold 1 / Cell Fold 2": [...],
            },
            "Domain Fold 2": {...}
        }
    """
    features_dict, tables_tuples_dict = generate_cell_features(
        selected_dataset,
        st.session_state.pipeline_path,
    )
    print("Done generating cell features")
    cell_folds = {}

    # For each domain fold, create cell folds
    # for domain_fold, tables in domain_folds.items():
    #     # Randomly decide to create 1 or 2 cell folds per domain fold
    #     num_cell_folds = random.randint(1, 2)
    #     cell_fold_names = [
    #         f"{domain_fold} / Cell Fold {i + 1}" for i in range(num_cell_folds)
    #     ]

    #     # Collect cells from each table
    #     cells = []
    #     for table in tables:
    #         try:
    #             # Read the CSV file
    #             table_path = os.path.join(selected_dataset, table, "clean.csv")
    #             with open(table_path, "r") as f:
    #                 # Read header line
    #                 header = f.readline().strip().split(",")
    #                 # Read a few random lines
    #                 lines = f.readlines()
    #                 if lines:
    #                     # Generate 3-5 random cells from this table
    #                     for _ in range(random.randint(3, 5)):
    #                         row = random.randint(0, len(lines) - 1)
    #                         col = random.choice(header)
    #                         # Get the value from the CSV line
    #                         values = lines[row].strip().split(",")
    #                         col_idx = header.index(col)
    #                         if col_idx < len(values):
    #                             val = values[col_idx]
    #                             # Generate random strategies
    #                             num_strategies = random.randint(3, 5)
    #                             strategies = {
    #                                 f"strategy{i:02d}": random.choice([True, False])
    #                                 for i in range(1, num_strategies + 1)
    #                             }
    #                             cells.append(
    #                                 {
    #                                     "table": table,
    #                                     "row": row,
    #                                     "col": col,
    #                                     "val": val,
    #                                     "strategies": strategies,
    #                                 }
    #                             )
    #         except Exception as e:
    #             print(f"Error processing table {table}: {e}")
    #             continue

    #     # Randomly distribute cells among cell folds
    #     random.shuffle(cells)
    #     cell_fold_dict = {}
    #     for i, name in enumerate(cell_fold_names):
    #         # Distribute cells evenly among folds
    #         fold_cells = cells[i::num_cell_folds]
    #         if fold_cells:  # Only add non-empty folds
    #             cell_fold_dict[name] = fold_cells

    #     if cell_fold_dict:  # Only add domain folds that have cell folds
    #         cell_folds[domain_fold] = cell_fold_dict

    return cell_folds


def backend_sample_labeling(
    selected_dataset: str,
    labeling_budget: int,
    cell_folds: Dict[str, Dict[str, List[Dict[str, Any]]]],
    domain_folds: Dict[str, List[str]],
) -> List[Dict[str, Any]]:
    """
    Backend function that samples cells for labeling.
    This is a dummy implementation that will be replaced with actual logic in the future.

    Args:
        selected_dataset (str): Name of the dataset to process
        labeling_budget (int): Number of cells to sample for labeling
        cell_folds (Dict[str, Dict[str, List[Dict[str, Any]]]]): Cell folds from quality-based folding
        domain_folds (Dict[str, List[str]]): Domain folds mapping

    Returns:
        List[Dict[str, Any]]: List of sampled cells in the format:
        [
            {
                "id": 1,
                "name": "Domain Fold 1 / Cell Fold 1 - Table1",
                "table": "Table1",
                "row": 42,
                "col": "name",
                "val": "Example",
                "domain_fold": "Domain Fold 1",
                "cell_fold": "Domain Fold 1 / Cell Fold 1",
                "cell_fold_label": "correct"|"false"|"neutral",  # Label from bulk annotation
                "strategies": {
                    "strategy01": true,
                    "strategy02": false,
                    ...
                }
            },
            ...
        ]
    """
    # Get the actual tables from the dataset directory
    current_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(
        current_dir
    )  # Go up one level since we're in backend/ folder
    datasets_path = os.path.join(root_dir, "datasets", selected_dataset)

    def generate_strategies():
        """Helper function to generate exactly 8 strategies"""
        return {
            f"strategy{i:02d}": random.choice([True, False])
            for i in range(1, 9)  # Generate strategies 01-08
        }

    # Load cell fold labels from configurations.json
    config_path = os.path.join(
        root_dir,
        "pipelines",
        os.path.basename(os.path.dirname(datasets_path)),
        "configurations.json",
    )
    cell_fold_labels = {}
    if os.path.exists(config_path):
        try:
            with open(config_path, "r") as f:
                config = json.load(f)
                cell_fold_labels = config.get("cell_fold_labels", {})
        except Exception as e:
            print(f"Error loading cell fold labels: {e}")

    # Collect all available cells from cell folds
    all_cells = []
    for domain_fold, cell_fold_dict in cell_folds.items():
        for cell_fold_name, cells in cell_fold_dict.items():
            # Get the label for this cell fold
            cell_fold_label = cell_fold_labels.get(cell_fold_name, "neutral")

            for cell in cells:
                # If cell has strategies, ensure it has exactly 8
                existing_strategies = cell.get("strategies", {})
                strategies = {
                    f"strategy{i:02d}": existing_strategies.get(
                        f"strategy{i:02d}", random.choice([True, False])
                    )
                    for i in range(1, 9)
                }

                cell_info = {
                    "table": cell["table"],
                    "row": cell["row"],
                    "col": cell["col"],
                    "val": cell["val"],
                    "domain_fold": domain_fold,
                    "cell_fold": cell_fold_name,
                    "cell_fold_label": cell_fold_label,  # Include the cell fold label
                    "strategies": strategies,
                }
                all_cells.append(cell_info)

    # If we don't have enough cells in cell_folds, generate additional random cells
    if len(all_cells) < labeling_budget:
        # Get all tables from domain folds
        all_tables = []
        for tables in domain_folds.values():
            all_tables.extend(tables)

        # Generate additional random cells
        while len(all_cells) < labeling_budget:
            table = random.choice(all_tables)
            try:
                # Read the CSV file
                table_path = os.path.join(datasets_path, table, "clean.csv")
                with open(table_path, "r") as f:
                    header = f.readline().strip().split(",")
                    lines = f.readlines()
                    if lines:
                        row = random.randint(0, len(lines) - 1)
                        col = random.choice(header)
                        values = lines[row].strip().split(",")
                        col_idx = header.index(col)
                        if col_idx < len(values):
                            val = values[col_idx]
                            # Find the domain fold for this table
                            domain_fold = next(
                                (
                                    fold
                                    for fold, tables in domain_folds.items()
                                    if table in tables
                                ),
                                "Unknown Domain",
                            )
                            cell_fold_name = f"{domain_fold} / Random Sample"
                            cell_info = {
                                "table": table,
                                "row": row,
                                "col": col,
                                "val": val,
                                "domain_fold": domain_fold,
                                "cell_fold": cell_fold_name,
                                "cell_fold_label": cell_fold_labels.get(
                                    cell_fold_name, "neutral"
                                ),
                                "strategies": generate_strategies(),
                            }
                            if cell_info not in all_cells:  # Avoid duplicates
                                all_cells.append(cell_info)
            except Exception as e:
                print(f"Error processing table {table}: {e}")
                continue

    # Randomly sample labeling_budget cells
    sampled_cells = random.sample(all_cells, min(labeling_budget, len(all_cells)))

    # Format the output
    return [
        {
            "id": i,
            "name": f"{cell['domain_fold']} – {cell['table']}",
            "table": cell["table"],
            "row": cell["row"],
            "col": cell["col"],
            "val": cell["val"],
            "domain_fold": cell["domain_fold"],
            "cell_fold": cell["cell_fold"],
            "cell_fold_label": cell["cell_fold_label"],
            "strategies": cell["strategies"],
        }
        for i, cell in enumerate(sampled_cells)
    ]


def backend_label_propagation(
    selected_dataset: str, labeled_cells: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Backend function that propagates errors based on labeled cells.
    This is a dummy implementation that will be replaced with actual logic in the future.

    Args:
        selected_dataset (str): Name of the dataset to process
        labeled_cells (List[Dict[str, Any]]): List of labeled cells with their properties
            Each cell should have:
            {
                "table": str,
                "row": int,
                "col": str,
                "val": Any,
                "is_error": bool,  # True if labeled as error, False if labeled as correct
                "domain_fold": str,
                "cell_fold": str,
                "cell_fold_label": str  # "correct", "false", or "neutral"
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
                            "confidence": float,  # confidence score for this being an error
                            "reason": str  # explanation of why this was propagated
                        },
                        ...
                    ]
                },
                ...
            ]
        }
    """
    # Get the actual tables from the dataset directory
    current_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(
        current_dir
    )  # Go up one level since we're in backend/ folder
    datasets_path = os.path.join(root_dir, "datasets", selected_dataset)

    # Initialize results structure
    labeled_cells_with_propagation = []

    # For each labeled cell, generate some random propagated cells
    for labeled_cell in labeled_cells:
        table = labeled_cell["table"]
        try:
            # Read the CSV file
            table_path = os.path.join(datasets_path, table, "clean.csv")
            with open(table_path, "r") as f:
                header = f.readline().strip().split(",")
                lines = f.readlines()

                # Generate 2-4 random propagated cells for this labeled cell
                num_propagated = random.randint(2, 4)
                propagated_cells = []

                for _ in range(num_propagated):
                    if lines:
                        row = random.randint(0, len(lines) - 1)
                        col = random.choice(header)
                        values = lines[row].strip().split(",")
                        col_idx = header.index(col)
                        if col_idx < len(values):
                            val = values[col_idx]
                            propagated = {
                                "table": table,
                                "row": row,
                                "col": col,
                                "val": val,
                                "confidence": round(
                                    random.uniform(0.6, 0.95), 2
                                ),  # Random confidence score
                                "reason": random.choice(
                                    [
                                        "Similar value pattern",
                                        "Same column characteristics",
                                        "Domain similarity",
                                        "Statistical correlation",
                                    ]
                                ),
                            }
                            propagated_cells.append(propagated)

                labeled_cells_with_propagation.append(
                    {
                        **labeled_cell,  # Include all original labeled cell info
                        "propagated_cells": propagated_cells,
                    }
                )

        except Exception as e:
            print(f"Error processing table {table}: {e}")
            continue

    return {"labeled_cells": labeled_cells_with_propagation}


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
