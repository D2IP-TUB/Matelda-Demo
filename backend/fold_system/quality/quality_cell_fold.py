import logging
from typing import Dict, List

import numpy as np
from backend.fold_system.core.base_fold import BaseCellFold
from backend.fold_system.core.cell import Cell
from backend.fold_system.core.raha_feature_extractor import RAHAFeatureExtractor
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
        quality_groups = {}

        for domain_name, cells in domain_groups.items():
            logging.info(
                f"Quality folding domain {domain_name} with {len(cells)} cells"
            )

            # Extract RAHA features by reading tables from disk
            cells_with_features = self.feature_extractor.extract_features_for_domain(
                cells
            )

            # Cluster cells by their features
            quality_clusters = self._cluster_cells_by_features(
                cells_with_features, domain_name
            )

            quality_groups[domain_name] = quality_clusters

        return quality_groups

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
            n_clusters=n_clusters, batch_size=256 * self.n_cores, random_state=42
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
