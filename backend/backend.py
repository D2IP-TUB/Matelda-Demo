import hashlib
import json
import logging
import os
from typing import Any, Dict, List

from backend.cache_utils import (
    exists_in_cache,
    load_from_cache,
    save_to_cache,
)
from backend.fold_system.core.backend_error_detection import backend_error_detection
from backend.fold_system.core.cell_sampler import CellSampler
from backend.fold_system.core.data_reader import DataReader
from backend.fold_system.core.label_propagation import LabelPropagator
from backend.fold_system.core.labeling_budget_distribution import (
    LabelingBudgetDistributor,
)
from backend.fold_system.domain.domain_cell_fold import DomainCellFold
from backend.fold_system.quality.quality_cell_fold import QualityCellFold


def get_available_strategies() -> List[str]:
    """Return a mock list of available error detection strategies.

    This is a placeholder and should be replaced with a real discovery
    mechanism once strategies are implemented.
    """
    return [
        "Outlier Detector - Histogram",
        "Outlier Detector - Gaussian",
        "Typo Detector",
        "Rule Violation Detector",
    ]


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
    selected_strategies: List[str],
) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """
    Backend function that performs quality-based folding with caching support.
    """
    logging.info(f"Starting quality-based folding for dataset: {selected_dataset}")
    logging.info(f"Labeling budget: {labeling_budget}")

    # Generate cache key based on inputs
    cache_key = _generate_cache_key(selected_dataset, labeling_budget, domain_folds)
    cache_filename = f"qbf_results_{cache_key}.pickle"
    pipeline_name = f"quality_folding_{selected_dataset}"

    # Try to load from cache first
    if exists_in_cache(pipeline_name, cache_filename):
        logging.info("Loading quality folding results from cache...")
        try:
            cached_result = load_from_cache(pipeline_name, cache_filename)
            if cached_result is not None:
                logging.info("Successfully loaded results from cache")
                return cached_result
        except Exception as e:
            logging.warning(
                f"Failed to load from cache: {e}, proceeding with fresh computation"
            )

    # Setup
    base_path = os.path.join("datasets", selected_dataset)
    raha_config = {
        "save_results": False,
        "strategy_filtering": False,
        "error_detection_algorithms": [],
    }
    if selected_strategies:
        if "Outlier Detector - Histogram" in selected_strategies:
            raha_config["error_detection_algorithms"].append("ODH")
        if "Outlier Detector - Gaussian" in selected_strategies:
            raha_config["error_detection_algorithms"].append("ODG")
        if "Rule Violation Detector" in selected_strategies:
            raha_config["error_detection_algorithms"].append("RVD")
            raha_config["error_detection_algorithms"].append("RVD_orig")
        if "Typo Detector" in selected_strategies:
            raha_config["error_detection_algorithms"].append("TypoD")

    try:
        logging.info("Cache miss - computing quality folding from scratch...")

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
        quality_fold = QualityCellFold(base_path, raha_config, n_cores=os.cpu_count())

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
                        "features": _convert_features_to_strategies(cell.features),
                        "strategies": cell.strategies,
                        "selected_for_labeling": is_selected_for_labeling,
                        "assigned_budget": assigned_budget if i == 0 else None,
                    }
                    cell_fold_data.append(cell_dict)

                domain_result[cell_fold_name] = cell_fold_data
                logging.info(
                    f"Created {cell_fold_name} with {len(cell_fold_data)} cells, budget: {assigned_budget}"
                )

            result[domain_name] = domain_result

        # Save result to cache
        logging.info("Saving quality folding results to cache...")
        try:
            save_to_cache(pipeline_name, result, cache_filename)
            logging.info("Successfully saved results to cache")
        except Exception as e:
            logging.warning(f"Failed to save to cache: {e}")

        return result

    except Exception as e:
        logging.error(f"Error in quality-based folding: {e}")
        return {}


def _generate_cache_key(
    selected_dataset: str, labeling_budget: int, domain_folds: Dict[str, List[str]]
) -> str:
    """Generate a unique cache key based on inputs"""

    # Create deterministic string from inputs
    cache_input = {
        "dataset": selected_dataset,
        "budget": labeling_budget,
        "domain_folds": sorted([(k, sorted(v)) for k, v in domain_folds.items()]),
    }

    # Create hash
    cache_string = json.dumps(cache_input, sort_keys=True)
    cache_hash = hashlib.md5(cache_string.encode()).hexdigest()[:12]

    return cache_hash


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
    """Backend function that samples cells for labeling"""

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

        # Step 2: Sample cells
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
    Backend function that propagates errors based on labeled cells

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

        # Step 2: Load the complete cell_folds structure from cache or configuration
        cell_folds = _load_complete_cell_folds_structure(selected_dataset)

        if not cell_folds:
            logging.error("Could not load complete cell folds structure")
            return {"labeled_cells": []}

        # Step 3: Perform label propagation using majority voting logic
        propagator = LabelPropagator(propagation_method="majority")
        propagation_results = propagator.propagate_labels(
            processed_labeled_cells, cell_folds
        )

        # Step 4: Log propagation statistics
        _log_propagation_statistics(propagation_results)

        # Step 5: Cache the propagation results for later use by error detection
        _cache_propagation_results(selected_dataset, propagation_results)

        # Step 6: Also save to session state for immediate access
        try:
            import streamlit as st

            if hasattr(st, "session_state"):
                st.session_state.cached_propagation_results = propagation_results
        except ImportError:
            pass

        return propagation_results

    except Exception as e:
        logging.error(f"Error in label propagation: {e}")
        return {"labeled_cells": []}


def _load_propagated_labels_from_session_or_cache(
    selected_dataset: str,
) -> Dict[str, Any]:
    """Load propagated labels from session state or cache"""

    # First try session state (most current)
    try:
        import streamlit as st

        if hasattr(st, "session_state"):
            if "propagation_results" in st.session_state:
                logging.info("Loaded propagation results from session state")
                return st.session_state.propagation_results
            elif "cached_propagation_results" in st.session_state:
                logging.info("Loaded cached propagation results from session state")
                return st.session_state.cached_propagation_results
    except ImportError:
        pass

    # Fallback to cache
    try:
        pipeline_name = f"label_propagation_{selected_dataset}"
        cache_filename = "latest_propagation.pickle"

        propagated_labels = load_from_cache(pipeline_name, cache_filename)
        if propagated_labels:
            logging.info("Loaded propagated labels from cache")
            return propagated_labels
    except Exception as e:
        logging.warning(f"Failed to load propagated labels from cache: {e}")

    return None


def _load_complete_cell_folds_structure(
    selected_dataset: str,
) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """Load the complete cell folds structure from cache or configuration

    This function attempts to load the cell_folds in the following priority:
    1. From session state (if available in Streamlit context)
    2. From saved configuration file
    3. From cache (QBF results)
    4. Reconstruct from current data if all else fails
    """

    # Try to get from session state first (Streamlit context)
    try:
        import streamlit as st

        if hasattr(st, "session_state") and "cell_folds" in st.session_state:
            logging.info("Loaded cell_folds from session state")
            return st.session_state.cell_folds
    except ImportError:
        pass

    # Try to load from configuration file
    try:
        import streamlit as st

        if hasattr(st, "session_state") and "pipeline_path" in st.session_state:
            config_path = os.path.join(
                st.session_state.pipeline_path, "configurations.json"
            )
            if os.path.exists(config_path):
                with open(config_path, "r") as f:
                    config = json.load(f)
                if "cell_folds" in config:
                    logging.info("Loaded cell_folds from configuration file")
                    return config["cell_folds"]
    except (ImportError, Exception) as e:
        logging.warning(f"Could not load from config: {e}")

    # Try to load from cache (QBF results)
    try:
        pipeline_name = f"qbf_{selected_dataset}"
        # Get cache files for this pipeline
        cache_files = _get_recent_cache_files(pipeline_name)

        for cache_file in cache_files:
            cached_result = load_from_cache(pipeline_name, cache_file)
            if cached_result and isinstance(cached_result, dict):
                logging.info(f"Loaded cell_folds from cache: {cache_file}")
                return cached_result

    except Exception as e:
        logging.warning(f"Could not load from cache: {e}")

    # Last resort: reconstruct from current data
    logging.warning(
        "Reconstructing cell_folds from current data - this may be incomplete"
    )
    return _reconstruct_complete_cell_folds(selected_dataset)


def _get_recent_cache_files(pipeline_name: str) -> List[str]:
    """Get recent cache files for a pipeline, sorted by modification time"""
    try:
        cache_dir = os.path.join("cache", pipeline_name)
        if not os.path.exists(cache_dir):
            return []

        cache_files = []
        for filename in os.listdir(cache_dir):
            if filename.endswith(".pickle"):
                filepath = os.path.join(cache_dir, filename)
                mtime = os.path.getmtime(filepath)
                cache_files.append((filename, mtime))

        # Sort by modification time (newest first)
        cache_files.sort(key=lambda x: x[1], reverse=True)
        return [filename for filename, _ in cache_files]

    except Exception as e:
        logging.warning(f"Error getting cache files: {e}")
        return []


def _reconstruct_complete_cell_folds(
    selected_dataset: str,
) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """Reconstruct complete cell folds by re-running the folding process

    This is a fallback method that re-runs DBF and QBF to get the complete structure
    """
    try:
        logging.info("Reconstructing cell_folds by re-running folding process")

        # Get domain folds first
        dbf_results = backend_dbf(
            selected_dataset, labeling_budget=10
        )  # Use default budget
        domain_folds = dbf_results.get("domain_folds", {})

        if not domain_folds:
            logging.error("Could not get domain folds for reconstruction")
            return {}

        # Get quality-based cell folds
        qbf_results = backend_qbf(
            selected_dataset=selected_dataset,
            labeling_budget=10,  # Use default budget
            domain_folds=domain_folds,
        )

        if qbf_results:
            logging.info("Successfully reconstructed cell_folds")
            return qbf_results
        else:
            logging.error("Failed to reconstruct cell_folds")
            return {}

    except Exception as e:
        logging.error(f"Error reconstructing cell_folds: {e}")
        return {}


def _cache_propagation_results(
    selected_dataset: str, propagation_results: Dict[str, Any]
):
    """Cache the propagation results for use by backend_pull_errors"""
    try:
        pipeline_name = f"label_propagation_{selected_dataset}"
        cache_filename = "latest_propagation.pickle"

        save_to_cache(pipeline_name, cache_filename, propagation_results)
        logging.info("Cached propagation results successfully")

    except Exception as e:
        logging.warning(f"Failed to cache propagation results: {e}")


def _reconstruct_cell_folds_from_labeled_cells(
    labeled_cells: List[Dict[str, Any]],
) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """Reconstruct cell folds structure from labeled cells

    NOTE: This function is kept for backward compatibility but should not be used
    as it only contains labeled cells, not the complete fold structure.
    """
    logging.warning(
        "Using incomplete cell_folds reconstruction - this may cause issues"
    )

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


def _load_complete_cell_folds_structure(
    selected_dataset: str,
) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """Load the complete cell folds structure from cache or configuration

    This function attempts to load the cell_folds in the following priority:
    1. From session state (if available in Streamlit context)
    2. From saved configuration file
    3. From cache (QBF results)
    4. Reconstruct from current data if all else fails
    """

    # Try to get from session state first (Streamlit context)
    try:
        import streamlit as st

        if hasattr(st, "session_state") and "cell_folds" in st.session_state:
            logging.info("Loaded cell_folds from session state")
            return st.session_state.cell_folds
    except ImportError:
        pass

    # Try to load from configuration file
    try:
        import streamlit as st

        if hasattr(st, "session_state") and "pipeline_path" in st.session_state:
            config_path = os.path.join(
                st.session_state.pipeline_path, "configurations.json"
            )
            if os.path.exists(config_path):
                with open(config_path, "r") as f:
                    config = json.load(f)
                if "cell_folds" in config:
                    logging.info("Loaded cell_folds from configuration file")
                    return config["cell_folds"]
    except (ImportError, Exception) as e:
        logging.warning(f"Could not load from config: {e}")

    # Try to load from cache (QBF results)
    try:
        pipeline_name = f"qbf_{selected_dataset}"
        # Get cache files for this pipeline
        cache_files = _get_recent_cache_files(pipeline_name)

        for cache_file in cache_files:
            cached_result = load_from_cache(pipeline_name, cache_file)
            if cached_result and isinstance(cached_result, dict):
                logging.info(f"Loaded cell_folds from cache: {cache_file}")
                return cached_result

    except Exception as e:
        logging.warning(f"Could not load from cache: {e}")

    # Last resort: reconstruct from current data
    logging.warning(
        "Reconstructing cell_folds from current data - this may be incomplete"
    )
    return _reconstruct_complete_cell_folds(selected_dataset)


def _get_recent_cache_files(pipeline_name: str) -> List[str]:
    """Get recent cache files for a pipeline, sorted by modification time"""
    try:
        cache_dir = os.path.join("cache", pipeline_name)
        if not os.path.exists(cache_dir):
            return []

        cache_files = []
        for filename in os.listdir(cache_dir):
            if filename.endswith(".pickle"):
                filepath = os.path.join(cache_dir, filename)
                mtime = os.path.getmtime(filepath)
                cache_files.append((filename, mtime))

        # Sort by modification time (newest first)
        cache_files.sort(key=lambda x: x[1], reverse=True)
        return [filename for filename, _ in cache_files]

    except Exception as e:
        logging.warning(f"Error getting cache files: {e}")
        return []


def _reconstruct_complete_cell_folds(
    selected_dataset: str,
) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """Reconstruct complete cell folds by re-running the folding process

    This is a fallback method that re-runs DBF and QBF to get the complete structure
    """
    try:
        logging.info("Reconstructing cell_folds by re-running folding process")

        # Get domain folds first
        dbf_results = backend_dbf(
            selected_dataset, labeling_budget=10
        )  # Use default budget
        domain_folds = dbf_results.get("domain_folds", {})

        if not domain_folds:
            logging.error("Could not get domain folds for reconstruction")
            return {}

        # Get quality-based cell folds
        qbf_results = backend_qbf(
            selected_dataset=selected_dataset,
            labeling_budget=10,  # Use default budget
            domain_folds=domain_folds,
        )

        if qbf_results:
            logging.info("Successfully reconstructed cell_folds")
            return qbf_results
        else:
            logging.error("Failed to reconstruct cell_folds")
            return {}

    except Exception as e:
        logging.error(f"Error reconstructing cell_folds: {e}")
        return {}


def _cache_propagation_results(
    selected_dataset: str, propagation_results: Dict[str, Any]
):
    """Cache the propagation results for use by backend_pull_errors"""
    try:
        pipeline_name = f"label_propagation_{selected_dataset}"
        cache_filename = "latest_propagation.pickle"

        save_to_cache(pipeline_name, cache_filename, propagation_results)
        logging.info("Cached propagation results successfully")

    except Exception as e:
        logging.warning(f"Failed to cache propagation results: {e}")


def _load_complete_cell_folds_structure(
    selected_dataset: str,
) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """Load the complete cell folds structure from cache or configuration

    This function attempts to load the cell_folds in the following priority:
    1. From session state (if available in Streamlit context)
    2. From saved configuration file
    3. From cache (QBF results)
    4. Reconstruct from current data if all else fails
    """

    # Try to get from session state first (Streamlit context)
    try:
        import streamlit as st

        if hasattr(st, "session_state") and "cell_folds" in st.session_state:
            logging.info("Loaded cell_folds from session state")
            return st.session_state.cell_folds
    except ImportError:
        pass

    # Try to load from configuration file
    try:
        import streamlit as st

        if hasattr(st, "session_state") and "pipeline_path" in st.session_state:
            config_path = os.path.join(
                st.session_state.pipeline_path, "configurations.json"
            )
            if os.path.exists(config_path):
                with open(config_path, "r") as f:
                    config = json.load(f)
                if "cell_folds" in config:
                    logging.info("Loaded cell_folds from configuration file")
                    return config["cell_folds"]
    except (ImportError, Exception) as e:
        logging.warning(f"Could not load from config: {e}")

    # Try to load from cache (QBF results)
    try:
        pipeline_name = f"qbf_{selected_dataset}"
        # Get cache files for this pipeline
        cache_files = _get_recent_cache_files(pipeline_name)

        for cache_file in cache_files:
            cached_result = load_from_cache(pipeline_name, cache_file)
            if cached_result and isinstance(cached_result, dict):
                logging.info(f"Loaded cell_folds from cache: {cache_file}")
                return cached_result

    except Exception as e:
        logging.warning(f"Could not load from cache: {e}")

    # Last resort: reconstruct from current data
    logging.warning(
        "Reconstructing cell_folds from current data - this may be incomplete"
    )
    return _reconstruct_complete_cell_folds(selected_dataset)


def _get_recent_cache_files(pipeline_name: str) -> List[str]:
    """Get recent cache files for a pipeline, sorted by modification time"""
    try:
        cache_dir = os.path.join("cache", pipeline_name)
        if not os.path.exists(cache_dir):
            return []

        cache_files = []
        for filename in os.listdir(cache_dir):
            if filename.endswith(".pickle"):
                filepath = os.path.join(cache_dir, filename)
                mtime = os.path.getmtime(filepath)
                cache_files.append((filename, mtime))

        # Sort by modification time (newest first)
        cache_files.sort(key=lambda x: x[1], reverse=True)
        return [filename for filename, _ in cache_files]

    except Exception as e:
        logging.warning(f"Error getting cache files: {e}")
        return []


def _reconstruct_complete_cell_folds(
    selected_dataset: str,
) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """Reconstruct complete cell folds by re-running the folding process

    This is a fallback method that re-runs DBF and QBF to get the complete structure
    """
    try:
        logging.info("Reconstructing cell_folds by re-running folding process")

        # Get domain folds first
        dbf_results = backend_dbf(
            selected_dataset, labeling_budget=10
        )  # Use default budget
        domain_folds = dbf_results.get("domain_folds", {})

        if not domain_folds:
            logging.error("Could not get domain folds for reconstruction")
            return {}

        # Get quality-based cell folds
        qbf_results = backend_qbf(
            selected_dataset=selected_dataset,
            labeling_budget=10,  # Use default budget
            domain_folds=domain_folds,
        )

        if qbf_results:
            logging.info("Successfully reconstructed cell_folds")
            return qbf_results
        else:
            logging.error("Failed to reconstruct cell_folds")
            return {}

    except Exception as e:
        logging.error(f"Error reconstructing cell_folds: {e}")
        return {}


def _cache_propagation_results(
    selected_dataset: str, propagation_results: Dict[str, Any]
):
    """Cache the propagation results for use by backend_pull_errors"""
    try:
        pipeline_name = f"label_propagation_{selected_dataset}"
        cache_filename = "latest_propagation.pickle"

        save_to_cache(pipeline_name, propagation_results, cache_filename)
        logging.info("Cached propagation results successfully")

    except Exception as e:
        logging.warning(f"Failed to cache propagation results: {e}")


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
    Backend function that retrieves all detected errors from the error detection results.
    Runs error detection if not already cached.

    Args:
        selected_dataset (str): Name of the dataset to process

    Returns:
        Dict[str, Any]: Dictionary containing all detected errors and metrics
    """
    logging.info(f"Pulling detected errors for dataset: {selected_dataset}")

    try:
        # Try to load the latest error detection results from cache
        pipeline_name = f"error_detection_{selected_dataset}"
        detection_results = _load_latest_detection_results(pipeline_name)

        if not detection_results:
            logging.info(
                "No cached error detection results found - running error detection..."
            )

            # Run the complete error detection pipeline
            detection_results = _run_complete_error_detection(selected_dataset)

            if not detection_results:
                logging.warning("Error detection failed")
                return _create_empty_error_response()

        # Extract detected cells and organize by table
        detected_cells = detection_results.get("detected_cells", [])
        propagated_errors = _organize_errors_by_table(detected_cells)

        # Extract metrics
        metrics = detection_results.get("metrics", {})
        formatted_metrics = {
            "precision": metrics.get("Precision", 0.0),
            "recall": metrics.get("Recall", 0.0),
            "f1": metrics.get("F1", 0.0),
            "fold_label_influence": _calculate_fold_influence(detected_cells),
        }

        result = {"propagated_errors": propagated_errors, "metrics": formatted_metrics}

        total_errors = sum(
            len(table_errors) for table_errors in propagated_errors.values()
        )
        logging.info(
            f"Retrieved {total_errors} detected errors across {len(propagated_errors)} tables"
        )

        return result

    except Exception as e:
        logging.error(f"Error pulling detected errors: {e}")
        return _create_empty_error_response()


def _load_propagated_labels_from_cache(selected_dataset: str) -> Dict[str, Any]:
    """Load propagated labels from cache"""
    try:
        pipeline_name = f"label_propagation_{selected_dataset}"

        # Try to load latest propagation cache (simplified approach)
        cache_filename = "latest_propagation.pickle"  # You might want to make this more sophisticated

        propagated_labels = load_from_cache(pipeline_name, cache_filename)

        if propagated_labels:
            logging.info("Loaded propagated labels from cache")
            return propagated_labels

    except Exception as e:
        logging.warning(f"Failed to load propagated labels: {e}")

    return None


def _get_current_pipeline_path() -> str:
    """Get current pipeline path from session state or environment"""
    # This would typically come from Streamlit session state
    # For now, return a default path
    import streamlit as st

    if hasattr(st, "session_state") and "pipeline_path" in st.session_state:
        return st.session_state.pipeline_path
    else:
        return "pipelines/default"


def _load_pipeline_config(pipeline_path: str) -> Dict:
    """Load pipeline configuration"""
    config_path = os.path.join(pipeline_path, "configurations.json")

    if os.path.exists(config_path):
        with open(config_path, "r") as f:
            return json.load(f)
    else:
        return {}


def _save_results_to_config(pipeline_path: str, detection_results: Dict[str, Any]):
    """Save detection results to configurations.json"""
    config_path = os.path.join(pipeline_path, "configurations.json")

    # Load existing config
    if os.path.exists(config_path):
        with open(config_path, "r") as f:
            config = json.load(f)
    else:
        config = {}

    # Add results
    if "results" not in config:
        config["results"] = []

    result_entry = {
        "Time": detection_results["Time"],
        "metrics": detection_results["metrics"],
    }

    config["results"].append(result_entry)

    # Save back to file
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)

    logging.info(f"Saved results to {config_path}")


def _load_latest_detection_results(pipeline_name: str) -> Dict[str, Any]:
    """Load the most recent error detection results from cache"""

    # Try to find the most recent cache file
    # This is a simplified approach - in production you might want to track cache timestamps

    cache_dir = os.path.join(
        "/home/fatemeh/matelda-demo/temp-cache", pipeline_name
    )  # Use your cache root

    if not os.path.exists(cache_dir):
        return None

    # Find all error detection cache files
    cache_files = [f for f in os.listdir(cache_dir) if f.startswith("error_detection_")]

    if not cache_files:
        return None

    # Sort by modification time and get the latest
    cache_files_with_time = []
    for cache_file in cache_files:
        file_path = os.path.join(cache_dir, cache_file)
        mtime = os.path.getmtime(file_path)
        cache_files_with_time.append((mtime, cache_file))

    if cache_files_with_time:
        # Get the most recent file
        latest_file = sorted(cache_files_with_time, reverse=True)[0][1]

        try:
            result = load_from_cache(pipeline_name, latest_file)
            logging.info(f"Loaded latest error detection results from {latest_file}")
            return result
        except Exception as e:
            logging.error(f"Failed to load cache file {latest_file}: {e}")

    return None


def _organize_errors_by_table(
    detected_cells: List[Dict[str, Any]],
) -> Dict[str, List[Dict[str, Any]]]:
    """Organize detected errors by table"""

    errors_by_table = {}

    for cell in detected_cells:
        table_id = cell["table"]

        if table_id not in errors_by_table:
            errors_by_table[table_id] = []

        error_info = {
            "row": cell["row"],
            "col": cell["col"],
            "val": cell["val"],
            "confidence": cell.get("confidence", 0.5),
            "source": cell.get("source", "unknown"),
        }

        errors_by_table[table_id].append(error_info)

    return errors_by_table


def _calculate_fold_influence(detected_cells: List[Dict[str, Any]]) -> float:
    """Calculate measure of how cell fold labels influenced the results"""

    if not detected_cells:
        return 0.0

    # Count errors by source
    source_counts = {}
    for cell in detected_cells:
        source = cell.get("source", "unknown")
        source_counts[source] = source_counts.get(source, 0) + 1

    # Calculate influence as ratio of propagated vs direct
    propagated_count = source_counts.get("propagated", 0)
    total_count = len(detected_cells)

    fold_influence = propagated_count / total_count if total_count > 0 else 0.0

    logging.info(
        f"Fold label influence: {fold_influence:.3f} ({propagated_count}/{total_count} propagated)"
    )

    return fold_influence


def _create_empty_error_response() -> Dict[str, Any]:
    """Create empty response when no results found"""
    return {
        "propagated_errors": {},
        "metrics": {
            "precision": 0.0,
            "recall": 0.0,
            "f1": 0.0,
            "fold_label_influence": 0.0,
        },
    }


# Add these functions to backend/backend.py to fix the error detection pipeline


def _run_complete_error_detection(selected_dataset: str) -> Dict[str, Any]:
    """Run the complete error detection pipeline if not cached"""

    try:
        # Load pipeline configuration
        pipeline_path = _get_current_pipeline_path()
        config = _load_pipeline_config(pipeline_path)

        # Get propagated labels from session state or cache
        propagated_labels = _load_propagated_labels_from_session_or_cache(
            selected_dataset
        )

        if not propagated_labels:
            logging.warning(
                "No propagated labels found - need to complete labeling step first"
            )
            return None

        # Run the actual error detection
        detection_results = backend_error_detection(
            selected_dataset=selected_dataset,
            propagated_labels=propagated_labels,
            pipeline_config=config,
        )

        # Save results to configurations.json for Results page
        if detection_results:
            _save_results_to_config(pipeline_path, detection_results)

        return detection_results

    except Exception as e:
        logging.error(f"Error running complete error detection: {e}")
        return None


def _load_propagated_labels_from_session_or_cache(
    selected_dataset: str,
) -> Dict[str, Any]:
    """Load propagated labels from session state or cache - improved version"""

    # First try session state (most current)
    try:
        import streamlit as st

        if hasattr(st, "session_state"):
            if "propagation_results" in st.session_state:
                logging.info("Loaded propagation results from session state")
                return st.session_state.propagation_results
            elif "cached_propagation_results" in st.session_state:
                logging.info("Loaded cached propagation results from session state")
                return st.session_state.cached_propagation_results
    except ImportError:
        pass

    # Fallback to cache
    try:
        pipeline_name = f"label_propagation_{selected_dataset}"
        cache_filename = "latest_propagation.pickle"

        propagated_labels = load_from_cache(pipeline_name, cache_filename)
        if propagated_labels:
            logging.info("Loaded propagated labels from cache")
            return propagated_labels
    except Exception as e:
        logging.warning(f"Failed to load propagated labels from cache: {e}")

    return None


def _load_pipeline_config(pipeline_path: str) -> Dict[str, Any]:
    """Load pipeline configuration from file"""
    try:
        config_path = os.path.join(pipeline_path, "configurations.json")
        if os.path.exists(config_path):
            with open(config_path, "r") as f:
                return json.load(f)
    except Exception as e:
        logging.warning(f"Could not load pipeline config: {e}")

    return {}


def _save_results_to_config(pipeline_path: str, detection_results: Dict[str, Any]):
    """Save detection results to the pipeline configuration"""
    try:
        config_path = os.path.join(pipeline_path, "configurations.json")

        # Load existing config
        config = {}
        if os.path.exists(config_path):
            with open(config_path, "r") as f:
                config = json.load(f)

        # Add detection results
        import datetime

        current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        results_entry = {
            "Time": current_time,
            "metrics": detection_results.get("metrics", {}),
            "detected_cells": detection_results.get("detected_cells", []),
            "propagated_errors": _organize_errors_by_table(
                detection_results.get("detected_cells", [])
            ),
        }

        # Add to results list
        if "results" not in config:
            config["results"] = []

        # Replace today's result if it exists, otherwise append
        today = current_time.split(" ")[0]
        config["results"] = [
            r for r in config["results"] if r.get("Time", "").split(" ")[0] != today
        ]
        config["results"].append(results_entry)

        # Save back to file
        with open(config_path, "w") as f:
            json.dump(config, f, indent=2)

        logging.info("Saved detection results to configuration")

    except Exception as e:
        logging.error(f"Error saving results to config: {e}")


def _load_latest_detection_results(pipeline_name: str) -> Dict[str, Any]:
    """Load the latest error detection results from cache"""
    try:
        cache_dir = os.path.join("cache", pipeline_name)
        if not os.path.exists(cache_dir):
            return None

        # Get all cache files sorted by modification time
        cache_files = []
        for filename in os.listdir(cache_dir):
            if filename.endswith(".pickle"):
                filepath = os.path.join(cache_dir, filename)
                mtime = os.path.getmtime(filepath)
                cache_files.append((filename, mtime))

        if not cache_files:
            return None

        # Get the most recent file
        latest_file = sorted(cache_files, key=lambda x: x[1], reverse=True)[0][0]

        result = load_from_cache(pipeline_name, latest_file)
        logging.info(f"Loaded latest error detection results from {latest_file}")
        return result

    except Exception as e:
        logging.error(f"Failed to load latest detection results: {e}")
        return None
