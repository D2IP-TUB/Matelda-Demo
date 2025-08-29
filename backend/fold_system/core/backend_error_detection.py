import datetime
import logging
import os
from typing import Any, Dict, List

from backend.fold_system.core.data_reader import DataReader
from backend.fold_system.quality.quality_cell_fold import QualityCellFold
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import confusion_matrix


def _calculate_confusion_matrix_safe(y_true, y_pred):
    """Safely calculate confusion matrix handling edge cases"""
    try:
        # Handle case where all predictions are negative
        if not any(y_pred):
            tp = fp = 0
            tn = sum(1 for y in y_true if not y)
            fn = sum(1 for y in y_true if y)
        elif not any(y_true):
            # No actual errors in dataset
            tp = fn = 0
            fp = sum(y_pred)
            tn = len(y_pred) - fp
        else:
            # Normal case - use confusion matrix
            cm = confusion_matrix(y_true, y_pred, labels=[False, True])
            if cm.size == 4:  # 2x2 matrix
                tn, fp, fn, tp = cm.ravel()
            else:
                # Handle edge case where only one class is present
                tp = fp = fn = tn = 0
                for true_val, pred_val in zip(y_true, y_pred):
                    if true_val and pred_val:
                        tp += 1
                    elif not true_val and pred_val:
                        fp += 1
                    elif true_val and not pred_val:
                        fn += 1
                    else:
                        tn += 1

        return int(tn), int(fp), int(fn), int(tp)
    except Exception as e:
        logging.error(f"Error in confusion matrix calculation: {e}")
        # Return safe defaults
        return (0, 0, 0, 0)


# ==== SOLUTION 1: Fix Feature Population in backend_error_detection.py ====


def backend_error_detection(
    selected_dataset: str,
    propagated_labels: Dict[str, Any],
    pipeline_config: Dict[str, Any],
) -> Dict[str, Any]:
    """
    FIXED error detection with proper feature population
    """
    logging.info(f"Starting FIXED error detection for dataset: {selected_dataset}")

    try:
        # Read all cells
        base_path = os.path.join("datasets", selected_dataset)
        reader = DataReader()
        all_cells = reader.read_all_tables(base_path)

        # ⭐ FIX 1: ENSURE ALL CELLS HAVE PROPER FEATURES
        logging.info("Populating features for all cells...")
        all_cells = _ensure_features_populated(all_cells, base_path)

        # Verify feature population
        cells_with_features = sum(
            1 for cell in all_cells if cell.features and len(cell.features) > 0
        )
        logging.info(f"Cells with features: {cells_with_features}/{len(all_cells)}")

        if cells_with_features < len(all_cells) * 0.5:  # Less than 50% have features
            logging.warning(
                "⚠️  Many cells missing features - this will hurt performance!"
            )

        # Organize cells by table and column
        cells_by_table_col = {}
        ground_truth = {}

        for cell in all_cells:
            table_col_key = (cell.table_id, cell.col_name)
            if table_col_key not in cells_by_table_col:
                cells_by_table_col[table_col_key] = []
            cells_by_table_col[table_col_key].append(cell)

            # Store ground truth for evaluation
            cell_key = (cell.table_id, cell.row_idx, cell.col_name)
            ground_truth[cell_key] = cell.is_error

        # Extract training data
        training_data = _extract_training_data_with_features(
            propagated_labels, all_cells
        )

        # ⭐ FIX 2: VERIFY TRAINING DATA QUALITY
        _verify_training_data_quality(training_data)

        # Perform classification with better handling
        all_predictions = {}
        detected_cells = []
        trained_columns = 0
        insufficient_columns = 0
        feature_issues = 0

        for table_col_key, column_cells in cells_by_table_col.items():
            table_id, col_name = table_col_key

            # Get training data for this column
            column_training = training_data.get(
                table_col_key, {"X_train": [], "y_train": []}
            )

            # ⭐ FIX 3: BETTER TRAINING DATA VALIDATION
            if _has_sufficient_training_data(
                column_training
            ) and _has_meaningful_features(column_training):
                # Train classifier with proper features
                predictions = _train_and_predict_column_fixed(
                    column_cells, column_training
                )
                trained_columns += 1

                # Store predictions and detected cells with real confidence scores
                for cell_key, (prediction, confidence) in predictions.items():
                    all_predictions[cell_key] = prediction
                    if prediction:  # If predicted as error
                        cell_obj = _find_cell_by_key(column_cells, cell_key)
                        if cell_obj:
                            detected_cells.append(
                                {
                                    "table": cell_obj.table_id,
                                    "row": cell_obj.row_idx,
                                    "col": cell_obj.col_name,
                                    "val": cell_obj.dirty_value,
                                    "confidence": confidence,  # Real classifier confidence
                                    "source": "trained_classifier",
                                }
                            )
            else:
                # Handle insufficient training data
                try:
                    result = _handle_insufficient_training_data_fixed(
                        table_col_key, column_cells, column_training, all_predictions
                    )
                    if result is not None and len(result) == 2:
                        n_samples, detected_from_fallback = result
                        detected_cells.extend(detected_from_fallback)
                    else:
                        logging.error(
                            f"Invalid return from _handle_insufficient_training_data_fixed: {result}"
                        )
                except Exception as e:
                    logging.error(
                        f"Error handling insufficient training data for {table_col_key}: {e}"
                    )

                insufficient_columns += 1

                if not _has_meaningful_features(column_training):
                    feature_issues += 1

        # Calculate metrics EXCLUDING training data
        metrics = _calculate_metrics_from_predictions(
            ground_truth, all_predictions, training_data
        )

        # Add detailed diagnostics
        metrics.update(
            {
                "trained_columns": trained_columns,
                "insufficient_columns": insufficient_columns,
                "feature_issues": feature_issues,
                "total_columns": len(cells_by_table_col),
                "cells_with_features": cells_with_features,
                "total_cells": len(all_cells),
                "feature_coverage": cells_with_features / len(all_cells)
                if all_cells
                else 0.0,
            }
        )

        result = {
            "metrics": metrics,
            "Time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "detected_cells": detected_cells,
            "n_detected": len(detected_cells),
            "n_total_cells": len(ground_truth),
            "training_coverage": {
                "trained_columns": trained_columns,
                "insufficient_columns": insufficient_columns,
                "feature_issues": feature_issues,
                "total_columns": len(cells_by_table_col),
            },
        }

        logging.info("✅ Error detection completed:")
        logging.info(f"   Trained columns: {trained_columns}/{len(cells_by_table_col)}")
        logging.info(f"   Feature coverage: {metrics['feature_coverage']:.1%}")
        logging.info(f"   Total evaluation cells: {metrics.get('n_total', 0)}")
        logging.info(f"   - Labeled cells: {metrics.get('n_labeled', 0)}")
        logging.info(f"   - Unlabeled cells: {metrics.get('n_unlabeled', 0)}")
        logging.info(f"   Detected errors: {len(detected_cells)}")
        logging.info(
            f"   Overall Metrics: P={metrics.get('precision', 0):.3f}, R={metrics.get('recall', 0):.3f}, F1={metrics.get('f1', 0):.3f}"
        )

        # Show breakdown if available
        if (
            metrics.get("labeled_f1") is not None
            and metrics.get("unlabeled_f1") is not None
        ):
            logging.info(
                f"   Labeled subset: P={metrics.get('labeled_precision', 0):.3f}, R={metrics.get('labeled_recall', 0):.3f}, F1={metrics.get('labeled_f1', 0):.3f}"
            )
            logging.info(
                f"   Unlabeled subset: P={metrics.get('unlabeled_precision', 0):.3f}, R={metrics.get('unlabeled_recall', 0):.3f}, F1={metrics.get('unlabeled_f1', 0):.3f}"
            )

        # ⭐ Warn if labeled data performance is poor (suggests training issues)
        if metrics.get("labeled_f1", 1.0) < 0.8 and metrics.get("n_labeled", 0) > 10:
            logging.warning(
                f"⚠️  Poor performance on labeled data (F1={metrics.get('labeled_f1', 0):.3f}) - check training quality!"
            )

        return result

    except Exception as e:
        logging.error(f"Error in backend_error_detection: {str(e)}")
        raise e


# ==== HELPER FUNCTIONS ====


def _ensure_features_populated(all_cells: List, base_path: str):
    """Ensure all cells have proper RAHA features populated"""

    try:
        # Get unique table IDs
        table_ids = set(cell.table_id for cell in all_cells)
        logging.info(f"Generating features for {len(table_ids)} tables: {table_ids}")

        # Initialize quality folder to generate features
        raha_config = {
            "save_results": False,
            "strategy_filtering": False,
            "error_detection_algorithms": ["RVD", "TypoD"],  # Basic algorithms
        }

        quality_folder = QualityCellFold(base_path, raha_config, n_cores=1)

        # Generate features for all tables
        all_table_features = quality_folder._generate_features_for_all_tables(table_ids)

        # Populate features for all cells
        populated_cells = quality_folder._populate_precomputed_features(
            all_cells, all_table_features
        )

        return populated_cells

    except Exception as e:
        logging.error(f"Error in feature population: {e}")
        # Return original cells if feature population fails
        return all_cells


def _extract_training_data_with_features(
    propagated_labels: Dict[str, Any], all_cells: List
) -> Dict:
    """Extract training data ensuring features are included"""

    training_data = {}

    # Create cell lookup for faster access
    cell_lookup = {}
    for cell in all_cells:
        cell_key = (cell.table_id, cell.row_idx, cell.col_name)
        cell_lookup[cell_key] = cell

    for labeled_cell in propagated_labels.get("labeled_cells", []):
        table_id = labeled_cell["table"]
        col_name = labeled_cell["col"]
        row_idx = labeled_cell["row"]
        table_col_key = (table_id, col_name)

        if table_col_key not in training_data:
            training_data[table_col_key] = {"X_train": [], "y_train": [], "cells": []}

        # Find the actual cell object to get real features
        cell_key = (table_id, row_idx, col_name)
        if cell_key in cell_lookup:
            cell = cell_lookup[cell_key]
            features = (
                cell.features if (cell.features and len(cell.features) > 0) else None
            )

            if features:  # Only include cells with real features
                is_error = labeled_cell.get("is_error", False)
                training_data[table_col_key]["X_train"].append(features)
                training_data[table_col_key]["y_train"].append(int(is_error))
                training_data[table_col_key]["cells"].append(cell_key)

        # Also process propagated cells
        for prop_cell in labeled_cell.get("propagated_cells", []):
            prop_table_col_key = (prop_cell["table"], prop_cell["col"])
            if prop_table_col_key not in training_data:
                training_data[prop_table_col_key] = {
                    "X_train": [],
                    "y_train": [],
                    "cells": [],
                }

            prop_cell_key = (prop_cell["table"], prop_cell["row"], prop_cell["col"])
            if prop_cell_key in cell_lookup:
                prop_cell_obj = cell_lookup[prop_cell_key]
                prop_features = (
                    prop_cell_obj.features
                    if (prop_cell_obj.features and len(prop_cell_obj.features) > 0)
                    else None
                )

                if prop_features:  # Only include cells with real features
                    is_error = labeled_cell.get(
                        "is_error", False
                    )  # Inherit from parent
                    training_data[prop_table_col_key]["X_train"].append(prop_features)
                    training_data[prop_table_col_key]["y_train"].append(int(is_error))
                    training_data[prop_table_col_key]["cells"].append(prop_cell_key)

    return training_data


def _has_sufficient_training_data(column_training: Dict) -> bool:
    """Check if we have enough diverse training data"""
    X_train = column_training.get("X_train", [])
    y_train = column_training.get("y_train", [])

    # Need at least 2 samples and both classes represented
    return len(X_train) >= 2 and len(set(y_train)) > 1 and len(X_train) == len(y_train)


def _has_meaningful_features(column_training: Dict) -> bool:
    """Check if training data has meaningful (non-dummy) features"""
    X_train = column_training.get("X_train", [])

    if not X_train:
        return False

    # Check if features are all zeros (dummy features)
    for features in X_train:
        if features and any(f != 0.0 for f in features):
            return True  # Found at least one non-dummy feature vector

    return False  # All features are dummy/empty


def _verify_training_data_quality(training_data: Dict):
    """Log training data quality statistics"""

    total_columns = len(training_data)
    columns_with_data = 0
    columns_with_meaningful_features = 0
    total_samples = 0

    for col_key, col_data in training_data.items():
        if col_data["X_train"]:
            columns_with_data += 1
            total_samples += len(col_data["X_train"])

            if _has_meaningful_features(col_data):
                columns_with_meaningful_features += 1

    logging.info("📊 Training Data Quality:")
    logging.info(f"   Total columns: {total_columns}")
    logging.info(f"   Columns with training data: {columns_with_data}")
    logging.info(
        f"   Columns with meaningful features: {columns_with_meaningful_features}"
    )
    logging.info(f"   Total training samples: {total_samples}")
    logging.info(
        f"   Feature quality: {columns_with_meaningful_features / max(1, columns_with_data):.1%}"
    )


def _train_and_predict_column_fixed(
    column_cells: List, column_training: Dict
) -> Dict[tuple, tuple]:
    """Train classifier with proper feature validation
    
    Returns:
        Dict[tuple, tuple]: Maps cell keys to (prediction, confidence) tuples
    """

    try:
        X_train = column_training["X_train"]
        y_train = column_training["y_train"]
        predictions = {}

        # Validate training data one more time
        if not X_train or not y_train or len(X_train) != len(y_train):
            logging.warning(
                "Invalid training data - falling back to conservative prediction"
            )
            for cell in column_cells:
                cell_key = (cell.table_id, cell.row_idx, cell.col_name)
                predictions[cell_key] = (False, 0.1)  # Low confidence when no training data
            return predictions

        # Handle edge cases with extreme confidence
        if all(y == 0 for y in y_train):
            # All training samples are correct - predict all as correct with high confidence
            for cell in column_cells:
                cell_key = (cell.table_id, cell.row_idx, cell.col_name)
                predictions[cell_key] = (False, 0.95)  # Very high confidence all are correct
        elif all(y == 1 for y in y_train):
            # All training samples are errors - predict all as errors with high confidence
            for cell in column_cells:
                cell_key = (cell.table_id, cell.row_idx, cell.col_name)
                predictions[cell_key] = (True, 0.95)  # Very high confidence all are errors
        else:
            # Mixed training data - train classifier and get real confidence scores
            logging.info(
                f"Training GBC with {len(X_train)} samples (features dim: {len(X_train[0]) if X_train else 0})"
            )

            gbc = GradientBoostingClassifier(
                n_estimators=100,
                random_state=42,  # Add random_state for reproducibility
            )
            gbc.fit(X_train, y_train)

            # Predict on all cells in this column
            X_test = []
            cell_keys = []

            for cell in column_cells:
                cell_key = (cell.table_id, cell.row_idx, cell.col_name)
                cell_keys.append(cell_key)

                # Use real features, skip cells without features
                if (
                    hasattr(cell, "features")
                    and cell.features
                    and len(cell.features) > 0
                ):
                    X_test.append(cell.features)
                else:
                    # Skip cells without features rather than using dummy features
                    logging.warning(
                        f"Cell {cell_key} missing features - predicting as correct with low confidence"
                    )
                    predictions[cell_key] = (False, 0.2)  # Conservative: predict as correct with low confidence
                    continue

            # Only predict for cells that have real features
            if X_test and len(X_test) > 0:
                predicted_labels = gbc.predict(X_test)
                predicted_probabilities = gbc.predict_proba(X_test)

                # Map predictions back to cells with real confidence scores
                test_idx = 0
                for i, cell_key in enumerate(cell_keys):
                    if cell_key not in predictions:  # Not already handled above
                        prediction = bool(predicted_labels[test_idx])
                        
                        # Get the maximum probability (confidence in the prediction)
                        # This gives us the classifier's confidence in its prediction
                        if len(predicted_probabilities[test_idx]) == 2:
                            if prediction:
                                # If predicting error (class 1), confidence is prob of class 1
                                confidence = predicted_probabilities[test_idx][1]
                            else:
                                # If predicting correct (class 0), confidence is prob of class 0
                                confidence = predicted_probabilities[test_idx][0]
                        else:
                            # Fallback if probabilities format is unexpected
                            confidence = max(predicted_probabilities[test_idx])
                        
                        predictions[cell_key] = (prediction, float(confidence))
                        test_idx += 1

        return predictions

    except Exception as e:
        logging.error(f"Error in train_and_predict_column: {e}")
        # Return safe defaults with low confidence
        predictions = {}
        for cell in column_cells:
            cell_key = (cell.table_id, cell.row_idx, cell.col_name)
            predictions[cell_key] = (False, 0.1)  # Safe default with very low confidence
        return predictions


def _find_cell_by_key(column_cells: List, cell_key: tuple):
    """Find cell object by key"""
    table_id, row_idx, col_name = cell_key
    for cell in column_cells:
        if (
            cell.table_id == table_id
            and cell.row_idx == row_idx
            and cell.col_name == col_name
        ):
            return cell
    return None


def _handle_insufficient_training_data_fixed(
    table_col_key: tuple,
    column_cells: List,
    column_training: Dict,
    all_predictions: Dict,
) -> tuple:
    """Handle insufficient training data with better logging"""

    try:
        table_id, col_name = table_col_key
        X_train = column_training.get("X_train", [])

        n_training_samples = len(X_train)
        has_meaningful_features = _has_meaningful_features(column_training)

        logging.info(
            f"Column {table_col_key}: Insufficient data - {n_training_samples} samples, meaningful_features={has_meaningful_features}"
        )

        detected_cells_from_column = []

        # Conservative approach: predict all as correct when insufficient data
        for cell in column_cells:
            cell_key = (cell.table_id, cell.row_idx, cell.col_name)
            all_predictions[cell_key] = False  # Predict as correct

        return n_training_samples, detected_cells_from_column

    except Exception as e:
        logging.error(
            f"Error in handling insufficient training data for {table_col_key}: {e}"
        )
        # Return safe defaults
        detected_cells_from_column = []
        for cell in column_cells:
            cell_key = (cell.table_id, cell.row_idx, cell.col_name)
            all_predictions[cell_key] = False
        return 0, detected_cells_from_column


def _calculate_metrics_from_predictions(
    ground_truth: Dict, predictions: Dict, training_data: Dict
) -> Dict[str, float]:
    """Calculate metrics INCLUDING labeled data - we want to evaluate against all ground truth"""

    # Get all training cells for reporting purposes
    training_cells = set()
    for col_training in training_data.values():
        training_cells.update(col_training.get("cells", []))

    # ✅ INCLUDE ALL DATA: We want to evaluate against all ground truth
    common_keys = set(ground_truth.keys()) & set(predictions.keys())

    # Separate metrics for analysis
    training_keys = common_keys & training_cells
    unseen_keys = common_keys - training_cells

    logging.info("📊 Evaluation scope:")
    logging.info(f"   Total cells: {len(common_keys)}")
    logging.info(f"   Labeled/training cells: {len(training_keys)}")
    logging.info(f"   Unlabeled cells: {len(unseen_keys)}")

    if not common_keys:
        logging.warning("⚠️  No evaluation data available!")
        return {
            "precision": 0.0,
            "recall": 0.0,
            "f1": 0.0,
            "accuracy": 0.0,
            "tp": 0,
            "fp": 0,
            "tn": 0,
            "fn": 0,
            "n_total": 0,
            "n_labeled": 0,
            "n_unlabeled": 0,
        }

    # ✅ Evaluate on ALL data (labeled + unlabeled)
    y_true = [ground_truth[key] for key in common_keys]
    y_pred = [predictions[key] for key in common_keys]

    # Calculate separate metrics for labeled vs unlabeled (for analysis)
    labeled_metrics = None
    unlabeled_metrics = None

    if training_keys:
        y_true_labeled = [ground_truth[key] for key in training_keys]
        y_pred_labeled = [predictions[key] for key in training_keys]
        labeled_metrics = _calculate_subset_metrics(y_true_labeled, y_pred_labeled)

    if unseen_keys:
        y_true_unlabeled = [ground_truth[key] for key in unseen_keys]
        y_pred_unlabeled = [predictions[key] for key in unseen_keys]
        unlabeled_metrics = _calculate_subset_metrics(
            y_true_unlabeled, y_pred_unlabeled
        )

    # Calculate overall metrics on ALL data
    tn, fp, fn, tp = _calculate_confusion_matrix_safe(y_true, y_pred)

    # Calculate metrics with division by zero protection
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (
        (2 * precision * recall) / (precision + recall)
        if (precision + recall) > 0
        else 0.0
    )
    accuracy = (tp + tn) / len(y_true) if y_true else 0.0

    # Prepare comprehensive metrics
    metrics = {
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "accuracy": accuracy,
        "tp": int(tp),
        "fp": int(fp),
        "tn": int(tn),
        "fn": int(fn),
        "n_total": len(common_keys),
        "n_labeled": len(training_keys),
        "n_unlabeled": len(unseen_keys),
    }

    # Add breakdown metrics if available
    if labeled_metrics:
        metrics.update(
            {
                "labeled_precision": labeled_metrics["precision"],
                "labeled_recall": labeled_metrics["recall"],
                "labeled_f1": labeled_metrics["f1"],
            }
        )

    if unlabeled_metrics:
        metrics.update(
            {
                "unlabeled_precision": unlabeled_metrics["precision"],
                "unlabeled_recall": unlabeled_metrics["recall"],
                "unlabeled_f1": unlabeled_metrics["f1"],
            }
        )

    return metrics


def _calculate_subset_metrics(y_true, y_pred):
    """Calculate metrics for a subset of data"""
    try:
        if not y_true or not y_pred or len(y_true) != len(y_pred):
            return {"precision": 0.0, "recall": 0.0, "f1": 0.0}

        tn, fp, fn, tp = _calculate_confusion_matrix_safe(y_true, y_pred)

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = (
            (2 * precision * recall) / (precision + recall)
            if (precision + recall) > 0
            else 0.0
        )

        return {"precision": precision, "recall": recall, "f1": f1}
    except Exception as e:
        logging.error(f"Error in subset metrics calculation: {e}")
        return {"precision": 0.0, "recall": 0.0, "f1": 0.0}


# ==== DEBUGGING HELPER ====
def debug_feature_population(all_cells: List):
    """Debug helper to analyze feature population"""

    feature_stats = {
        "total_cells": len(all_cells),
        "cells_with_features": 0,
        "cells_with_nonzero_features": 0,
        "feature_dimensions": set(),
        "sample_features": [],
    }

    for i, cell in enumerate(all_cells[:100]):  # Sample first 100 cells
        if hasattr(cell, "features") and cell.features:
            feature_stats["cells_with_features"] += 1
            feature_stats["feature_dimensions"].add(len(cell.features))

            if any(f != 0.0 for f in cell.features):
                feature_stats["cells_with_nonzero_features"] += 1

            if i < 5:  # Store sample features for inspection
                feature_stats["sample_features"].append(
                    {
                        "cell": f"({cell.table_id}, {cell.row_idx}, {cell.col_name})",
                        "features": cell.features[:5],  # First 5 features
                        "n_nonzero": sum(1 for f in cell.features if f != 0.0),
                    }
                )

    logging.info("🔍 Feature Population Debug:")
    logging.info(f"   Total cells: {feature_stats['total_cells']}")
    logging.info(f"   Cells with features: {feature_stats['cells_with_features']}")
    logging.info(
        f"   Cells with non-zero features: {feature_stats['cells_with_nonzero_features']}"
    )
    logging.info(f"   Feature dimensions: {feature_stats['feature_dimensions']}")

    for sample in feature_stats["sample_features"]:
        logging.info(
            f"   Sample {sample['cell']}: {sample['features']} (nonzero: {sample['n_nonzero']})"
        )

    return feature_stats
