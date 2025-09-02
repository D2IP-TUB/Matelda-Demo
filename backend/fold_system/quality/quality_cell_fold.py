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

# Global cache for RAHA features (avoids regenerating for same tables)
_raha_features_cache = {}


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
        """Generate RAHA features for all unique tables once (with caching)"""
        all_features = {}

        for table_id in table_ids:
            cache_key = f"{self.base_path}_{table_id}_{hash(str(sorted(self.raha_config.items())))}"

            # Check cache first
            if cache_key in _raha_features_cache:
                logging.info(f"✅ Using cached features for table {table_id}")
                all_features[table_id] = _raha_features_cache[cache_key]
                continue

            # Generate features if not cached
            logging.info(f"🔄 Generating features for table {table_id}")
            col_features, col_feature_names, cell_to_strategies = (
                generate_raha_features(self.base_path, table_id, self.raha_config)
            )

            # Store in both local and global cache
            features_data = {
                "col_features": col_features,
                "col_feature_names": col_feature_names,
                "cell_to_strategies": cell_to_strategies,
            }
            all_features[table_id] = features_data
            _raha_features_cache[cache_key] = features_data
            logging.info(f"💾 Cached features for table {table_id}")

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
        """Cluster cells using MiniBatchKMeans with table_id/column_id one-hot encoding"""

        # COMMENTED OUT: Collect all unique (table_id, col_idx) pairs for one-hot encoding
        # table_col_pairs = set()
        # for cell in cells:
        #     if cell.features and len(cell.features) > 0:
        #         table_col_pairs.add((cell.table_id, cell.col_idx))

        # Convert to sorted list for consistent ordering
        # all_table_cols = sorted(list(table_col_pairs))
        # logging.info(f"Found {len(all_table_cols)} unique table-column pairs for one-hot encoding")

        # Extract feature vectors with table_id/column_id one-hot encoding
        feature_vectors = []
        valid_cells = []

        for cell in cells:
            if cell.features and len(cell.features) > 0:
                # Create one-hot encoded features for table_id and column_id pairs
                # COMMENTED OUT: table_id/column_id one-hot encoding
                # table_col_features = [0] * len(all_table_cols)
                # try:
                #     pair_idx = all_table_cols.index((cell.table_id, cell.col_idx))
                #     table_col_features[pair_idx] = 1
                # except ValueError:
                #     logging.warning(f"Table-column pair ({cell.table_id}, {cell.col_idx}) not found in collected pairs")

                # Combine original features with table-column one-hot features
                # COMMENTED OUT: Using only original features without table-column encoding
                # complete_feature_vector = cell.features + table_col_features
                complete_feature_vector = cell.features  # Use only original features
                feature_vectors.append(complete_feature_vector)
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
        """Cluster cells using exactly k clusters with table_id/column_id one-hot encoding"""
        feature_vectors = []
        valid_cells = []

        # COMMENTED OUT: Collect all unique (table_id, col_idx) pairs for one-hot encoding
        # table_col_pairs = set()
        # for cell in cells:
        #     if cell.features and len(cell.features) > 0:
        #         table_col_pairs.add((cell.table_id, cell.col_idx))

        # Convert to sorted list for consistent ordering
        # all_table_cols = sorted(list(table_col_pairs))
        # logging.info(f"Found {len(all_table_cols)} unique table-column pairs for one-hot encoding")

        # Build feature vectors with table_id/column_id one-hot encoding
        for cell in cells:
            if cell.features and len(cell.features) > 0:
                # Create one-hot encoded features for table_id and column_id pairs
                # COMMENTED OUT: table_id/column_id one-hot encoding
                # table_col_features = [0] * len(all_table_cols)
                # try:
                #     pair_idx = all_table_cols.index((cell.table_id, cell.col_idx))
                #     table_col_features[pair_idx] = 1
                # except ValueError:
                #     # This shouldn't happen since we collected all pairs above
                #     logging.warning(f"Table-column pair ({cell.table_id}, {cell.col_idx}) not found in collected pairs")

                # Combine original features with table-column one-hot features
                # COMMENTED OUT: Using only original features without table-column encoding
                # complete_feature_vector = cell.features + table_col_features
                complete_feature_vector = cell.features  # Use only original features
                feature_vectors.append(complete_feature_vector)
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
