# fold_system/core/base_fold.py
from abc import ABC, abstractmethod
from typing import Dict, List, Optional

from backend.fold_system.core.cell import Cell


class BaseCellFold(ABC):
    """Base class for cell-level folding operations"""

    def __init__(self, name: str):
        self.name = name
        self.child_fold: Optional["BaseCellFold"] = None
        self.parent_fold: Optional["BaseCellFold"] = None

    @abstractmethod
    def fold_cells(self, cells: List[Cell]) -> Dict[str, List[Cell]]:
        """Fold cells into groups"""
        pass

    def set_child(self, child: "BaseCellFold"):
        """Set the next fold in hierarchy"""
        self.child_fold = child
        child.parent_fold = self
