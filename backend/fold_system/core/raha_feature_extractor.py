from typing import Dict, List

from backend.fold_system.core.cell import Cell


class RAHAFeatureExtractor:
    """Extracts features by reading tables from disk again"""

    def __init__(self, base_path: str, raha_config: Dict):
        self.base_path = base_path
        self.raha_config = raha_config

    def _group_cells_by_table(self, cells: List[Cell]) -> Dict[str, List[Cell]]:
        """Group cells by table_id"""
        tables = {}
        for cell in cells:
            if cell.table_id not in tables:
                tables[cell.table_id] = []
            tables[cell.table_id].append(cell)
        return tables
