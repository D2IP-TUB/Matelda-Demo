import logging
from typing import Dict, List

import numpy as np
from backend.fold_system.core.base_fold import BaseCellFold
from backend.fold_system.core.cell import Cell
from backend.fold_system.core.raha_feature_extractor import RAHAFeatureExtractor
from Matelda.marshmallow_pipeline.cell_grouping_module.generate_raha_features import (
    generate_raha_features,
)
from sklearn.cluster import MiniBatchKMeans


class QualityCellFold(BaseCellFold):
    """Folds cells by quality"""

    def __init__(self, base_path: str, raha_config: Dict, n_cores: int = 1):
        super().__init__("quality")
        self.base_path = base_path
        self.feature_extractor = RAHAFeatureExtractor(base_path, raha_config)
        self.n_cores = n_cores
        self.raha_config = raha_config

    def fold_cells(self, cells):
        return super().fold_cells(cells)

    def _generate_features_for_all_tables(self, table_ids: set):
        """Generate RAHA features for all unique tables once"""
        all_features = {}
        for table_id in table_ids:
            if table_id not in all_features:
                logging.info(f"Generating features for table {table_id}")
                col_features, col_feature_names, cell_to_strategies = (
                    generate_raha_features(self.base_path, table_id, self.raha_config)
                )
                all_features[table_id] = {
                    "col_features": col_features,
                    "col_feature_names": col_feature_names,
                    "cell_to_strategies": cell_to_strategies,
                }
        return all_features

    def _populate_precomputed_features(
        self, cells: List[Cell], all_table_features: Dict
    ) -> List[Cell]:
        """Populate cell features using precomputed table features"""
        for cell in cells:
            if cell.table_id in all_table_features:
                table_features = all_table_features[cell.table_id]
                # Populate features same way as RAHAFeatureExtractor._populate_cell_features
                self._set_cell_features(cell, table_features)
        return cells

    def _cluster_cells_by_features(
        self, cells: List[Cell], domain_name: str
    ) -> Dict[str, List[Cell]]:
        """Cluster cells using MiniBatchKMeans"""

        # Extract feature vectors
        feature_vectors = []
        valid_cells = []

        for cell in cells:
            if cell.features and len(cell.features) > 0:
                feature_vectors.append(cell.features)
                valid_cells.append(cell)

        if len(feature_vectors) < 2:
            logging.warning(f"Domain {domain_name}: Insufficient cells with features")
            return {"quality_0": cells}

        # MiniBatchKMeans clustering
        X = np.array(feature_vectors)
        n_clusters = min(10, len(feature_vectors))

        clustering = MiniBatchKMeans(
            n_clusters=n_clusters,
            batch_size=256 * self.n_cores,
            random_state=42,
            n_init="auto",
        ).fit(X)

        # Group cells by cluster
        quality_clusters = {}
        for i, cluster_id in enumerate(clustering.labels_):
            quality_name = f"quality_{cluster_id}"
            if quality_name not in quality_clusters:
                quality_clusters[quality_name] = []

            valid_cells[i].quality_type = quality_name
            quality_clusters[quality_name].append(valid_cells[i])

        return quality_clusters

    def _cluster_cells_by_features_with_k(
        self, cells: List[Cell], domain_name: str, k: int
    ) -> Dict[str, List[Cell]]:
        """Cluster cells using exactly k clusters"""
        feature_vectors = []
        valid_cells = []

        for cell in cells:
            if cell.features and len(cell.features) > 0:
                feature_vectors.append(cell.features)
                valid_cells.append(cell)

        if len(feature_vectors) < 2:
            return {"quality_0": cells}

        X = np.array(feature_vectors)
        n_clusters = min(k, len(feature_vectors))

        clustering = MiniBatchKMeans(
            n_clusters=n_clusters,
            batch_size=256 * self.n_cores,
            random_state=42,
            n_init="auto",
        ).fit(X)

        quality_clusters = {}
        for i, cluster_id in enumerate(clustering.labels_):
            quality_name = f"quality_{cluster_id}"
            if quality_name not in quality_clusters:
                quality_clusters[quality_name] = []
            quality_clusters[quality_name].append(valid_cells[i])

        return quality_clusters

    def _set_cell_features(self, cell: Cell, table_features: Dict):
        """Set cell features from precomputed table features"""
        from backend.fold_system.core.error_detection_strategy_parser import (
            ErrorDetectionParser,
        )

        col_features = table_features["col_features"]
        cell_to_strategies = table_features["cell_to_strategies"]

        # Set features
        if cell.col_idx < len(col_features):
            col_feature_array = col_features[cell.col_idx]
            if cell.row_idx < len(col_feature_array):
                cell.features = col_feature_array[cell.row_idx].tolist()
            else:
                cell.features = []
        else:
            cell.features = []

        # Set strategies
        parser = ErrorDetectionParser()
        # FIXED: Use correct coordinate order (row, col) to match strategy detection
        if (cell.row_idx, cell.col_idx) in cell_to_strategies:
            strategies = cell_to_strategies[(cell.row_idx, cell.col_idx)]
            cell.strategies = parser.parse(strategies)
        else:
            cell.strategies = []
