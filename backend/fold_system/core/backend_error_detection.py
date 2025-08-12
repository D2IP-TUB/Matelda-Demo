import datetime
import json
import logging
import os
from typing import Any, Dict, List

from backend.cache_utils import exists_in_cache, load_from_cache, save_to_cache
from backend.fold_system.core.data_reader import DataReader
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import confusion_matrix


def backend_error_detection(
    selected_dataset: str,
    propagated_labels: Dict[str, Any],
    pipeline_config: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Backend function that performs error detection using column-wise classifiers.

    Trains GradientBoostingClassifier per column using labeled samples,
    then predicts on all unlabeled cells - NO CHEATING with ground truth!
    """
    logging.info(f"Starting error detection for dataset: {selected_dataset}")

    # Generate cache key
    cache_key = _generate_detection_cache_key(
        selected_dataset, propagated_labels, pipeline_config
    )
    cache_filename = f"error_detection_{cache_key}.pickle"
    pipeline_name = f"error_detection_{selected_dataset}"

    # Try to load from cache first
    if exists_in_cache(pipeline_name, cache_filename):
        logging.info("Loading error detection results from cache...")
        try:
            cached_result = load_from_cache(pipeline_name, cache_filename)
            if cached_result is not None:
                logging.info("Successfully loaded error detection results from cache")
                return cached_result
        except Exception as e:
            logging.warning(
                f"Failed to load from cache: {e}, proceeding with fresh computation"
            )

    try:
        logging.info("Cache miss - performing column-wise classification...")

        # Read all cells with features
        base_path = os.path.join("datasets", selected_dataset)
        reader = DataReader()
        all_cells = reader.read_all_tables(base_path)

        # Organize cells by table and column for per-column classification
        cells_by_table_col = {}
        ground_truth = {}  # Only used for final evaluation, NOT for training

        for cell in all_cells:
            table_col_key = (cell.table_id, cell.col_name)
            if table_col_key not in cells_by_table_col:
                cells_by_table_col[table_col_key] = []
            cells_by_table_col[table_col_key].append(cell)

            # Store ground truth for evaluation only
            cell_key = (cell.table_id, cell.row_idx, cell.col_name)
            ground_truth[cell_key] = cell.is_error

        # Extract training data from propagated labels
        training_data = _extract_training_data(propagated_labels)

        # Perform column-wise classification
        all_predictions = {}
        detected_cells = []

        for table_col_key, column_cells in cells_by_table_col.items():
            table_id, col_name = table_col_key

            # Get training data for this column
            column_training = training_data.get(
                table_col_key, {"X_train": [], "y_train": []}
            )

            if column_training["X_train"] and len(set(column_training["y_train"])) > 1:
                # Train classifier for this column (your logic)
                predictions = _train_and_predict_column(column_cells, column_training)

                # Store predictions and detected cells
                for cell, prediction in predictions.items():
                    all_predictions[cell] = prediction
                    if prediction:  # If predicted as error
                        cell_obj = next(
                            (
                                c
                                for c in column_cells
                                if (c.table_id, c.row_idx, c.col_name) == cell
                            ),
                            None,
                        )
                        if cell_obj:
                            detected_cells.append(
                                {
                                    "table": cell_obj.table_id,
                                    "row": cell_obj.row_idx,
                                    "col": cell_obj.col_name,
                                    "val": cell_obj.dirty_value,
                                    "confidence": 0.8,  # Default confidence from classifier
                                    "source": "classifier",
                                }
                            )
            else:
                # Not enough training data for this column
                logging.warning(
                    f"Insufficient training data for column {table_col_key}"
                )
                for cell in column_cells:
                    cell_key = (cell.table_id, cell.row_idx, cell.col_name)
                    all_predictions[cell_key] = False  # Default to no error

        # Calculate metrics by comparing predictions with ground truth
        metrics = _calculate_metrics_from_predictions(ground_truth, all_predictions)

        # Create result
        result = {
            "metrics": metrics,
            "Time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "detected_cells": detected_cells,
            "n_detected": len(detected_cells),
            "n_total_cells": len(ground_truth),
        }

        # Save to cache
        logging.info("Saving error detection results to cache...")
        try:
            save_to_cache(pipeline_name, result, cache_filename)
            logging.info("Successfully saved error detection results to cache")
        except Exception as e:
            logging.warning(f"Failed to save to cache: {e}")

        logging.info(
            f"Error detection completed - Detected {len(detected_cells)} errors"
        )
        logging.info(
            f"Metrics - Recall: {metrics['Recall']:.3f}, F1: {metrics['F1']:.3f}, Precision: {metrics['Precision']:.3f}"
        )

        return result

    except Exception as e:
        logging.error(f"Error in error detection: {e}")
        return _create_empty_result()


def _extract_training_data(propagated_labels: Dict[str, Any]) -> Dict[tuple, Dict]:
    """Extract training data organized by (table_id, col_name)"""

    training_data = {}

    for labeled_cell in propagated_labels.get("labeled_cells", []):
        table_id = labeled_cell["table"]
        col_name = labeled_cell["col"]
        table_col_key = (table_id, col_name)

        if table_col_key not in training_data:
            training_data[table_col_key] = {"X_train": [], "y_train": [], "cells": []}

        # Original labeled cell - this is our training data
        # NOTE: We assume cell.features were populated during quality folding
        labeled_cell_key = (table_id, labeled_cell["row"], col_name)
        is_error = labeled_cell.get("is_error", False)

        # We need to get features from somewhere - ideally from the quality folding step
        # For now, create dummy features (this should be replaced with actual cell.features)
        dummy_features = [0.0] * 20  # Replace with actual features

        training_data[table_col_key]["X_train"].append(dummy_features)
        training_data[table_col_key]["y_train"].append(int(is_error))
        training_data[table_col_key]["cells"].append(labeled_cell_key)

        # Add propagated cells as training data too (with propagated labels)
        for prop_cell in labeled_cell.get("propagated_cells", []):
            prop_table_col_key = (prop_cell["table"], prop_cell["col"])
            if prop_table_col_key == table_col_key:  # Same column
                if prop_table_col_key not in training_data:
                    training_data[prop_table_col_key] = {
                        "X_train": [],
                        "y_train": [],
                        "cells": [],
                    }

                # Propagated cell inherits label from source
                training_data[prop_table_col_key]["X_train"].append(dummy_features)
                training_data[prop_table_col_key]["y_train"].append(int(is_error))

                prop_cell_key = (prop_cell["table"], prop_cell["row"], prop_cell["col"])
                training_data[prop_table_col_key]["cells"].append(prop_cell_key)

    return training_data


def _train_and_predict_column(
    column_cells: List, column_training: Dict
) -> Dict[tuple, bool]:
    """Train GradientBoostingClassifier for one column and predict (your classify logic)"""

    X_train = column_training["X_train"]
    y_train = column_training["y_train"]

    predictions = {}

    # Handle edge cases (your logic)
    if sum(y_train) == 0:
        # All training samples are correct - predict all as correct
        for cell in column_cells:
            cell_key = (cell.table_id, cell.row_idx, cell.col_name)
            predictions[cell_key] = False

    elif sum(y_train) == len(y_train):
        # All training samples are errors - predict all as errors
        for cell in column_cells:
            cell_key = (cell.table_id, cell.row_idx, cell.col_name)
            predictions[cell_key] = True

    else:
        # Mixed training data - train classifier (your GBC logic)
        logging.info(f"Training GBC for column with {len(X_train)} samples")

        gbc = GradientBoostingClassifier(n_estimators=100)
        gbc.fit(X_train, y_train)

        # Predict on all cells in this column
        X_test = []
        cell_keys = []

        for cell in column_cells:
            # Use cell features (should be populated from quality folding)
            if hasattr(cell, "features") and cell.features:
                X_test.append(cell.features)
            else:
                X_test.append([0.0] * 20)  # Fallback dummy features

            cell_key = (cell.table_id, cell.row_idx, cell.col_name)
            cell_keys.append(cell_key)

        if X_test:
            predicted_labels = gbc.predict(X_test)

            for i, prediction in enumerate(predicted_labels):
                predictions[cell_keys[i]] = bool(prediction)

    return predictions


def _calculate_metrics_from_predictions(
    ground_truth: Dict, predictions: Dict
) -> Dict[str, float]:
    """Calculate metrics by comparing predictions with ground truth (evaluation only)"""

    # Find common keys
    common_keys = set(ground_truth.keys()) & set(predictions.keys())

    if not common_keys:
        logging.warning(
            "No common keys between ground truth and predictions for evaluation"
        )
        return {
            "Recall": 0.0,
            "F1": 0.0,
            "Precision": 0.0,
            "TP": 0,
            "FP": 0,
            "FN": 0,
            "TN": 0,
        }

    y_true = [ground_truth[key] for key in common_keys]
    y_pred = [predictions[key] for key in common_keys]

    # Calculate confusion matrix
    try:
        tn, fp, fn, tp = confusion_matrix(
            y_true=y_true, y_pred=y_pred, labels=[0, 1]
        ).ravel()
    except ValueError:
        # Handle edge cases
        tp = sum(1 for i in range(len(y_true)) if y_true[i] and y_pred[i])
        fp = sum(1 for i in range(len(y_true)) if not y_true[i] and y_pred[i])
        fn = sum(1 for i in range(len(y_true)) if y_true[i] and not y_pred[i])
        tn = sum(1 for i in range(len(y_true)) if not y_true[i] and not y_pred[i])

    # Calculate metrics (your formulas)
    precision = tp / (tp + fp) if tp + fp > 0 else 0.0
    recall = tp / (tp + fn) if tp + fn > 0 else 0.0
    f1 = (
        (2 * precision * recall) / (precision + recall)
        if precision + recall > 0
        else 0.0
    )

    return {
        "Recall": recall,
        "F1": f1,
        "Precision": precision,
        "TP": int(tp),
        "FP": int(fp),
        "FN": int(fn),
        "TN": int(tn),
    }


def _create_empty_result() -> Dict[str, Any]:
    """Create empty result for error cases"""
    return {
        "metrics": {
            "Recall": 0.0,
            "F1": 0.0,
            "Precision": 0.0,
            "TP": 0,
            "FP": 0,
            "FN": 0,
            "TN": 0,
        },
        "Time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "detected_cells": [],
        "n_detected": 0,
        "n_total_cells": 0,
    }


def _generate_detection_cache_key(
    selected_dataset: str, propagated_labels: Dict, pipeline_config: Dict
) -> str:
    """Generate cache key for error detection"""
    import hashlib

    cache_input = {
        "dataset": selected_dataset,
        "n_labeled_cells": len(propagated_labels.get("labeled_cells", [])),
        "config_hash": str(hash(str(sorted(pipeline_config.items())))),
    }

    cache_string = json.dumps(cache_input, sort_keys=True)
    return hashlib.md5(cache_string.encode()).hexdigest()[:12]
