"""
Common utility functions used across pages
"""

import json
import os
from typing import Any, Dict

import pandas as pd


def get_datasets_path(selected_dataset: str) -> str:
    """Get the path to the datasets directory"""
    # Get the root directory (go up from components to project root)
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(root_dir, "datasets", selected_dataset)


def load_clean_table(table_name: str, datasets_path: str) -> pd.DataFrame:
    """Load clean.csv file for a given table"""
    file_path = os.path.join(datasets_path, table_name, "clean.csv")
    try:
        return pd.read_csv(file_path)
    except Exception as e:
        return pd.DataFrame({"Error": [f"Could not load {file_path}: {e}"]})


def load_dirty_table(table_name: str, datasets_path: str) -> pd.DataFrame:
    """Load dirty.csv file for a given table"""
    file_path = os.path.join(datasets_path, table_name, "dirty.csv")
    try:
        return pd.read_csv(file_path)
    except Exception as e:
        return pd.DataFrame({"Error": [f"Could not load {file_path}: {e}"]})


def load_pipeline_config(pipeline_path: str) -> Dict[str, Any]:
    """Load pipeline configuration from JSON file"""
    config_path = os.path.join(pipeline_path, "configurations.json")
    if os.path.exists(config_path):
        with open(config_path, "r") as f:
            return json.load(f)
    return {}


def save_pipeline_config(pipeline_path: str, config: Dict[str, Any]) -> None:
    """Save pipeline configuration to JSON file"""
    config_path = os.path.join(pipeline_path, "configurations.json")
    with open(config_path, "w") as f:
        json.dump(config, f, indent=4)


def update_domain_folds_in_config(
    pipeline_path: str, table_locations: Dict[str, str]
) -> bool:
    """Update domain folds in pipeline configuration and return success status"""
    try:
        config = load_pipeline_config(pipeline_path)

        # Convert table_locations to domain_folds format
        domain_folds = {}
        for table, fold in table_locations.items():
            domain_folds.setdefault(fold, []).append(table)

        config["domain_folds"] = domain_folds
        save_pipeline_config(pipeline_path, config)
        return True
    except Exception as e:
        print(f"Error saving domain folds: {e}")
        return False
