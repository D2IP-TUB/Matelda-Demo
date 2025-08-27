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
        self.feature_extractor = RAHAFeatureExtractor(base_path, raha_config)
        self.n_cores = n_cores

    def fold_cells(
        self, domain_groups: Dict[str, List[Cell]]
    ) -> Dict[str, Dict[str, List[Cell]]]:
        """Fold cells by quality within each domain"""

        # COLLECT ALL UNIQUE TABLES ACROSS ALL DOMAINS
        all_cells = []
        for cells in domain_groups.values():
            all_cells.extend(cells)

        unique_table_ids = set(cell.table_id for cell in all_cells)
        logging.info(
            f"Pre-generating RAHA features for {len(unique_table_ids)} unique tables"
        )

        # GENERATE FEATURES FOR ALL TABLES ONCE
        all_table_features = self._generate_features_for_all_tables(unique_table_ids)

        quality_groups = {}

        for domain_name, cells in domain_groups.items():
            logging.info(
                f"Quality folding domain {domain_name} with {len(cells)} cells"
            )

            # Extract RAHA features by reading tables from disk
            cells_with_features = self.self._populate_precomputed_features(
                cells, all_table_features
            )

            # Cluster cells by their features
            quality_clusters = self._cluster_cells_by_features(
                cells_with_features, domain_name
            )

            quality_groups[domain_name] = quality_clusters

        return quality_groups

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
