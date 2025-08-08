from typing import Dict, List, Optional, Tuple


class Cell:
    """Unified cell representation"""

    def __init__(
        self,
        dirty_value: str,
        ground_truth: str,
        table_id: str,
        row_idx: int,
        col_idx: int,
        col_name: str,
    ):
        # Core cell identity
        self.dirty_value = dirty_value
        self.ground_truth = ground_truth
        self.table_id = table_id
        self.row_idx = row_idx
        self.col_idx = col_idx
        self.col_name = col_name

        self.features: List[float] = []
        self.is_error: bool = False
        self.original_key: Tuple = (
            table_id,
            col_idx,
            row_idx,
            dirty_value,
        )

        self.domain: Optional[str] = None
        self.quality_type: Optional[str] = None

    @property
    def has_error(self) -> bool:
        """Check if cell has an error by comparing dirty vs ground truth"""
        return self.dirty_value != self.ground_truth

    # Then you can use: if cell.has_error: instead of manual comparison
    def __repr__(self):
        return (
            f"Cell({self.dirty_value}, {self.table_id}, {self.row_idx}, {self.col_idx})"
        )

    def to_dict(self) -> Dict:
        """Convert to dictionary for compatibility"""
        return {
            "dirty_value": self.dirty_value,
            "ground_truth": self.ground_truth,
            "table_id": self.table_id,
            "row_idx": self.row_idx,
            "col_idx": self.col_idx,
            "col_name": self.col_name,
            "features": self.features,
            "is_error": self.is_error,
            "domain": self.domain,
            "quality_type": self.quality_type,
        }
