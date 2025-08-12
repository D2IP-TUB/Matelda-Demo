import logging
import random
from typing import Any, Dict, List

import numpy as np
from scipy.spatial.distance import euclidean


class CellSampler:
    """Implements your sophisticated sampling strategies"""

    def __init__(self, sampling_strategy: str = "centroid"):
        self.sampling_strategy = sampling_strategy  # "centroid", "random", "mixed"

    def sample_cells_from_cell_folds_direct(
        self,
        cell_folds: Dict[str, Dict[str, List[Dict[str, Any]]]],
        budget_distribution: Dict[str, Dict[str, int]],
    ) -> List[Dict[str, Any]]:
        """Sample cells directly from cell_folds structure"""

        sampled_cells = []
        sample_id = 1

        for domain_name, domain_cell_folds in cell_folds.items():
            for cell_fold_name, cells_data in domain_cell_folds.items():
                # Get budget for this cell fold
                n_samples = budget_distribution.get(domain_name, {}).get(
                    cell_fold_name, 0
                )

                if n_samples > 0 and cells_data:
                    logging.info(f"Sampling {n_samples} cells from {cell_fold_name}")

                    # Extract features from strategies
                    cell_features = []
                    for cell_data in cells_data:
                        strategies = cell_data.get("strategies", {})
                        feature_vector = [
                            float(strategies.get(f"strategy{i:02d}", 0))
                            for i in range(20)
                        ]
                        cell_features.append(feature_vector)

                    # Apply your sampling strategy
                    if n_samples == 1:
                        selected_indices = self._sample_nearest_to_centroid(
                            cell_features
                        )
                    else:
                        selected_indices = self._sample_mixed_strategy(
                            cell_features, n_samples
                        )

                    # Create sampled cell objects
                    for idx in selected_indices:
                        if idx < len(cells_data):
                            cell_data = cells_data[idx]
                            sampled_cell = {
                                "id": sample_id,
                                "name": f"{cell_fold_name} - {cell_data['table']}",
                                "table": cell_data["table"],
                                "row": cell_data["row"],
                                "col": cell_data["col"],
                                "val": cell_data["val"],
                                "domain_fold": domain_name,
                                "cell_fold": cell_fold_name,
                                "cell_fold_label": "neutral",
                                "strategies": cell_data.get("strategies", {}),
                            }
                            sampled_cells.append(sampled_cell)
                            sample_id += 1

        return sampled_cells

    def _extract_quality_cluster_name(self, cell_fold_name: str) -> str:
        """Extract quality cluster name from cell fold name"""
        # "Domain Fold 1 / Cell Fold 0" -> "quality_0"
        if " / Cell Fold " in cell_fold_name:
            fold_number = cell_fold_name.split(" / Cell Fold ")[-1]
            return f"quality_{fold_number}"
        return "quality_0"

    def _extract_features_from_cells(
        self, cells_data: List[Dict[str, Any]]
    ) -> List[List[float]]:
        """Extract feature vectors from cells data"""
        features = []
        for cell_data in cells_data:
            strategies = cell_data.get("strategies", {})
            # Convert strategy dict to feature vector
            feature_vector = [
                float(strategies.get(f"strategy{i:02d}", 0)) for i in range(20)
            ]  # Assume 20 strategies
            features.append(feature_vector)
        return features

    def _sample_nearest_to_centroid(self, features: List[List[float]]) -> List[int]:
        """get_the_nearest_point_to_centroid logic"""
        if not features:
            return []

        features_array = np.array(features)
        centroid = np.mean(features_array, axis=0)
        closest_index = min(
            range(len(features)), key=lambda i: euclidean(features[i], centroid)
        )
        return [closest_index]

    def _sample_mixed_strategy(
        self, features: List[List[float]], n_samples: int
    ) -> List[int]:
        """pick_samples_in_cell_cluster logic - mixed random + centroid"""
        if not features or n_samples <= 0:
            return []

        selected_indices = []
        available_indices = list(range(len(features)))

        # First sample: always centroid
        if n_samples >= 1:
            centroid_idx = self._sample_nearest_to_centroid(features)[0]
            selected_indices.append(centroid_idx)
            available_indices.remove(centroid_idx)
            n_samples -= 1

        # Remaining samples: random with uniqueness check
        trial_count = 5
        while (
            len(selected_indices) < n_samples + 1
            and available_indices
            and trial_count > 0
        ):
            # Random sampling with uniqueness check
            sample_idx = random.choice(available_indices)
            selected_indices.append(sample_idx)
            available_indices.remove(sample_idx)

            if len(selected_indices) >= n_samples + 1:
                break

            trial_count -= 1

        return (
            selected_indices[: n_samples + 1]
            if n_samples + 1 <= len(selected_indices)
            else selected_indices
        )
