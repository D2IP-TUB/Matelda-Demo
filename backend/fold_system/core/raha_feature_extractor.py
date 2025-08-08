import logging
from typing import Dict, List

import numpy as np
from backend.fold_system.core.cell import Cell
from Matelda.marshmallow_pipeline.cell_grouping_module.generate_raha_features import (
    generate_raha_features,
)


class RAHAFeatureExtractor:
    """Extracts features by reading tables from disk again"""

    def __init__(self, base_path: str, raha_config: Dict):
        self.base_path = base_path
        self.raha_config = raha_config

    def extract_features_for_domain(self, domain_cells: List[Cell]) -> List[Cell]:
        """Extract RAHA features for cells by reading tables from disk"""

        # Group cells by table
        tables_cells = self._group_cells_by_table(domain_cells)

        for table_id, table_cells in tables_cells.items():
            logging.info(f"Extracting RAHA features for table {table_id}")

            # Read table from disk again using your existing function
            column_features, column_feature_names = generate_raha_features(
                self.base_path, table_id
            )

            # Populate cell features
            self._populate_cell_features(table_cells, column_features)

        return domain_cells

    def _group_cells_by_table(self, cells: List[Cell]) -> Dict[str, List[Cell]]:
        """Group cells by table_id"""
        tables = {}
        for cell in cells:
            if cell.table_id not in tables:
                tables[cell.table_id] = []
            tables[cell.table_id].append(cell)
        return tables

    def _populate_cell_features(
        self, table_cells: List[Cell], column_features: List[np.ndarray]
    ):
        """Populate cell.features from RAHA column_features"""

        for cell in table_cells:
            if cell.col_idx < len(column_features):
                col_features = column_features[cell.col_idx]
                if cell.row_idx < len(col_features):
                    cell.features = col_features[cell.row_idx].tolist()
                else:
                    cell.features = []
            else:
                cell.features = []

        features_populated = sum(1 for cell in table_cells if cell.features)
        logging.info(
            f"Populated features for {features_populated}/{len(table_cells)} cells in table {table_cells[0].table_id}"
        )
