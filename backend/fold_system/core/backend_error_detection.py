import datetime
import json
import logging
import os
from typing import Any, Dict, List

from backend.fold_system.core.data_reader import DataReader
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import confusion_matrix


def _extract_training_data_improved(
    propagated_labels: Dict[str, Any],
) -> Dict[tuple, Dict]:
    """Extract training data organized by (table_id, col_name) with better coverage"""

    training_data = {}

    for labeled_cell in propagated_labels.get("labeled_cells", []):
        table_id = labeled_cell["table"]
        col_name = labeled_cell["col"]
        table_col_key = (table_id, col_name)

        if table_col_key not in training_data:
            training_data[table_col_key] = {"X_train": [], "y_train": [], "cells": []}

        # Original labeled cell
        labeled_cell_key = (table_id, labeled_cell["row"], col_name)
        is_error = labeled_cell.get("is_error", False)

        # Use actual features if available, otherwise dummy features
        features = labeled_cell.get("features", [0.0] * 20)

        training_data[table_col_key]["X_train"].append(features)
        training_data[table_col_key]["y_train"].append(int(is_error))
        training_data[table_col_key]["cells"].append(labeled_cell_key)

        # Add propagated cells as training data too (with propagated labels)
        for prop_cell in labeled_cell.get("propagated_cells", []):
            prop_table_col_key = (prop_cell["table"], prop_cell["col"])

            if prop_table_col_key not in training_data:
                training_data[prop_table_col_key] = {
                    "X_train": [],
                    "y_train": [],
                    "cells": [],
                }

            # Propagated cell inherits label from source
            prop_features = prop_cell.get("features", [0.0] * 20)
            training_data[prop_table_col_key]["X_train"].append(prop_features)
            training_data[prop_table_col_key]["y_train"].append(int(is_error))

            prop_cell_key = (prop_cell["table"], prop_cell["row"], prop_cell["col"])
            training_data[prop_table_col_key]["cells"].append(prop_cell_key)

    return training_data


def _handle_insufficient_training_data(
    table_col_key: tuple,
    column_cells: List,
    column_training: Dict,
    all_predictions: Dict,
) -> tuple[int, List[Dict[str, Any]]]:
    """Handle columns with insufficient training data using fallback strategies

    Returns:
        tuple: (n_training_samples, detected_cells_from_this_column)
    """

    table_id, col_name = table_col_key
    X_train = column_training.get("X_train", [])
    y_train = column_training.get("y_train", [])

    n_training_samples = len(X_train)
    unique_labels = set(y_train) if y_train else set()
    detected_cells_from_column = []

    logging.info(
        f"Column {table_col_key}: {n_training_samples} training samples, {len(unique_labels)} unique labels"
    )

    # Strategy 1: If we have some training data but only one label type
    if n_training_samples > 0 and len(unique_labels) == 1:
        single_label = list(unique_labels)[0]
        logging.info(
            f"Column {table_col_key}: Single label strategy - all predicted as {bool(single_label)}"
        )

        for cell in column_cells:
            cell_key = (cell.table_id, cell.row_idx, cell.col_name)
            all_predictions[cell_key] = bool(single_label)

            # Add to detected_cells if predicted as error
            if bool(single_label):  # If predicted as error
                detected_cells_from_column.append(
                    {
                        "table": cell.table_id,
                        "row": cell.row_idx,
                        "col": cell.col_name,
                        "val": cell.dirty_value,
                        "confidence": 0.7,  # Medium confidence for single-label strategy
                        "source": "single_label_strategy",
                    }
                )

        return n_training_samples, detected_cells_from_column

    # Strategy 2: If no training data at all, predict based on global statistics
    elif n_training_samples == 0:
        # Use a conservative approach - predict all as correct (no error)
        logging.info(
            f"Column {table_col_key}: No training data - predicting all as correct"
        )

        for cell in column_cells:
            cell_key = (cell.table_id, cell.row_idx, cell.col_name)
            all_predictions[cell_key] = False  # Predict as correct

        return 0, detected_cells_from_column

    # Strategy 3: Use cross-column learning (if similar columns exist)
    else:
        logging.info(f"Column {table_col_key}: Attempting cross-column learning")
        # This could be enhanced to use similar columns' classifiers
        for cell in column_cells:
            cell_key = (cell.table_id, cell.row_idx, cell.col_name)
            all_predictions[cell_key] = False  # Default to correct

        return n_training_samples, detected_cells_from_column


def backend_error_detection(
    selected_dataset: str,
    propagated_labels: Dict[str, Any],
    pipeline_config: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Improved error detection with better handling of insufficient training data
    """
    logging.info(f"Starting improved error detection for dataset: {selected_dataset}")

    try:
        # Read all cells with features
        base_path = os.path.join("datasets", selected_dataset)
        reader = DataReader()
        all_cells = reader.read_all_tables(base_path)

        # Organize cells by table and column for per-column classification
        cells_by_table_col = {}
        ground_truth = {}

        for cell in all_cells:
            table_col_key = (cell.table_id, cell.col_name)
            if table_col_key not in cells_by_table_col:
                cells_by_table_col[table_col_key] = []
            cells_by_table_col[table_col_key].append(cell)

            # Store ground truth for evaluation only
            cell_key = (cell.table_id, cell.row_idx, cell.col_name)
            ground_truth[cell_key] = cell.is_error

        # Extract training data from propagated labels
        training_data = _extract_training_data_improved(propagated_labels)

        # Log training data statistics
        _log_training_data_statistics(training_data)

        # Perform column-wise classification with improved handling
        all_predictions = {}
        detected_cells = []
        trained_columns = 0
        insufficient_columns = 0

        for table_col_key, column_cells in cells_by_table_col.items():
            table_id, col_name = table_col_key

            # Get training data for this column
            column_training = training_data.get(
                table_col_key, {"X_train": [], "y_train": []}
            )

            # Check if we have sufficient and diverse training data
            if column_training["X_train"] and len(set(column_training["y_train"])) > 1:
                # Sufficient training data - train classifier
                predictions = _train_and_predict_column(column_cells, column_training)
                trained_columns += 1

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
                                    "confidence": 0.8,
                                    "source": "classifier",
                                }
                            )
            else:
                # Insufficient training data - use fallback strategies
                n_samples, detected_from_fallback = _handle_insufficient_training_data(
                    table_col_key, column_cells, column_training, all_predictions
                )
                detected_cells.extend(detected_from_fallback)
                insufficient_columns += 1

        # Calculate metrics
        metrics = _calculate_metrics_from_predictions(ground_truth, all_predictions)

        # Add training coverage statistics
        total_columns = len(cells_by_table_col)
        metrics["training_coverage"] = (
            trained_columns / total_columns if total_columns > 0 else 0.0
        )
        metrics["trained_columns"] = trained_columns
        metrics["insufficient_columns"] = insufficient_columns
        metrics["total_columns"] = total_columns

        # Create result
        result = {
            "metrics": metrics,
            "Time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "detected_cells": detected_cells,
            "n_detected": len(detected_cells),
            "n_total_cells": len(ground_truth),
            "training_coverage": {
                "trained_columns": trained_columns,
                "insufficient_columns": insufficient_columns,
                "total_columns": total_columns,
            },
        }

        logging.info("Error detection completed:")
        logging.info(
            f"  - Trained classifiers for {trained_columns}/{total_columns} columns"
        )
        logging.info(
            f"  - {insufficient_columns} columns had insufficient training data"
        )
        logging.info(f"  - Detected {len(detected_cells)} errors")
        logging.info(
            f"  - Metrics: Recall={metrics['Recall']:.3f}, F1={metrics['F1']:.3f}, Precision={metrics['Precision']:.3f}"
        )

        return result

    except Exception as e:
        logging.error(f"Error in improved error detection: {e}")
        return _create_empty_result()


def _log_training_data_statistics(training_data: Dict[tuple, Dict]):
    """Log detailed statistics about training data coverage"""

    logging.info("=== Training Data Statistics ===")

    total_columns = len(training_data)
    columns_with_data = 0
    columns_with_diverse_data = 0

    for table_col_key, data in training_data.items():
        n_samples = len(data["X_train"])
        unique_labels = set(data["y_train"]) if data["y_train"] else set()

        if n_samples > 0:
            columns_with_data += 1

        if len(unique_labels) > 1:
            columns_with_diverse_data += 1

        logging.info(
            f"  {table_col_key}: {n_samples} samples, {len(unique_labels)} unique labels"
        )

    logging.info(
        f"Summary: {columns_with_diverse_data}/{total_columns} columns can train classifiers"
    )
    logging.info(f"  - {columns_with_data} columns have some training data")
    logging.info(f"  - {columns_with_diverse_data} columns have diverse labels")
    logging.info(
        f"  - {total_columns - columns_with_data} columns have no training data"
    )


# Helper function to create empty result with proper structure
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
            "training_coverage": 0.0,
            "trained_columns": 0,
            "insufficient_columns": 0,
            "total_columns": 0,
        },
        "Time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "detected_cells": [],
        "n_detected": 0,
        "n_total_cells": 0,
        "training_coverage": {
            "trained_columns": 0,
            "insufficient_columns": 0,
            "total_columns": 0,
        },
    }


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
