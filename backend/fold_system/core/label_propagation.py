import logging
from collections import Counter, defaultdict
from statistics import mode
from typing import Any, Dict, List


class LabelPropagator:
    """Implements label propagation logic with majority voting"""

    def __init__(self, propagation_method: str = "majority"):
        self.propagation_method = propagation_method  # "majority" or "homogeneity"

    def propagate_labels(
        self,
        labeled_cells: List[Dict[str, Any]],
        cell_folds: Dict[str, Dict[str, List[Dict[str, Any]]]],
    ) -> Dict[str, Any]:
        """Propagate labels within cell folds using majority voting logic"""

        logging.info(
            f"Starting label propagation using {self.propagation_method} method"
        )
        logging.info(f"Propagating from {len(labeled_cells)} labeled cells")

        # Step 1: Group labeled cells by cell fold
        labels_per_cell_fold = self._group_labels_by_cell_fold(labeled_cells)

        # Step 2: Calculate propagated labels for each cell fold
        propagated_results = []

        for labeled_cell in labeled_cells:
            cell_fold = labeled_cell["cell_fold"]

            # Get all cells in this cell fold
            domain_fold = labeled_cell["domain_fold"]
            all_cells_in_fold = cell_folds.get(domain_fold, {}).get(cell_fold, [])

            # Get labels for this cell fold
            fold_labels = labels_per_cell_fold.get(cell_fold, [])

            # Calculate cluster label
            cluster_label, confidence = self._calculate_cluster_label(fold_labels)

            # Propagate to all cells in the fold
            propagated_cells = self._propagate_to_fold_cells(
                all_cells_in_fold, cluster_label, confidence, labeled_cell
            )

            # Create result for this labeled cell
            labeled_cell_result = {
                "table": labeled_cell["table"],
                "row": labeled_cell["row"],
                "col": labeled_cell["col"],
                "val": labeled_cell["val"],
                "is_error": labeled_cell.get("is_error", False),
                "propagated_cells": propagated_cells,
            }

            propagated_results.append(labeled_cell_result)

        total_propagated = sum(
            len(result["propagated_cells"]) for result in propagated_results
        )
        logging.info(
            f"Propagated labels to {total_propagated} cells across {len(propagated_results)} cell folds"
        )

        return {"labeled_cells": propagated_results}

    def _group_labels_by_cell_fold(
        self, labeled_cells: List[Dict[str, Any]]
    ) -> Dict[str, List[bool]]:
        """Group labels by cell fold"""
        labels_per_fold = defaultdict(list)

        for cell in labeled_cells:
            cell_fold = cell["cell_fold"]
            is_error = cell.get("is_error", False)
            labels_per_fold[cell_fold].append(is_error)

        return dict(labels_per_fold)

    def _calculate_cluster_label(self, fold_labels: List[bool]) -> tuple:
        """Calculate cluster label using propagation methods"""

        if not fold_labels:
            return False, 0.0

        if self.propagation_method == "homogeneity":
            #  homogeneity logic: propagate only if all labels are the same
            if len(set(fold_labels)) == 1:
                cluster_label = fold_labels[0]
                confidence = 1.0
            else:
                # Mixed labels - no propagation
                cluster_label = None
                confidence = 0.0

        elif self.propagation_method == "majority":
            #  majority voting logic
            if len(set(fold_labels)) == 1:
                # All same label - high confidence
                cluster_label = fold_labels[0]
                confidence = 1.0
            else:
                # Mixed labels - use majority vote
                try:
                    cluster_label = mode(fold_labels)
                    # Calculate confidence as majority percentage
                    label_counts = Counter(fold_labels)
                    confidence = label_counts[cluster_label] / len(fold_labels)
                except:
                    # No clear mode - round to majority
                    error_count = sum(fold_labels)
                    cluster_label = error_count > len(fold_labels) / 2
                    confidence = max(error_count, len(fold_labels) - error_count) / len(
                        fold_labels
                    )

        return cluster_label, confidence

    def _propagate_to_fold_cells(
        self,
        all_cells_in_fold: List[Dict[str, Any]],
        cluster_label: bool,
        confidence: float,
        source_labeled_cell: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        """Propagate label to all cells in the fold"""

        if cluster_label is None:
            # No propagation for mixed/unclear labels
            return []

        propagated_cells = []

        for cell_data in all_cells_in_fold:
            # Don't propagate to the originally labeled cell
            if (
                cell_data["table"] == source_labeled_cell["table"]
                and cell_data["row"] == source_labeled_cell["row"]
                and cell_data["col"] == source_labeled_cell["col"]
            ):
                continue

            # Create propagated cell
            propagated_cell = {
                "table": cell_data["table"],
                "row": cell_data["row"],
                "col": cell_data["col"],
                "val": cell_data["val"],
                "confidence": confidence,
                "reason": f"Propagated via {self.propagation_method} voting from cell fold",
            }

            propagated_cells.append(propagated_cell)

        return propagated_cells
