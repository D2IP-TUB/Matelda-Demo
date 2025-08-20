import html
import logging
import os
import re
from typing import List

import numpy as np
import pandas as pd
from backend.fold_system.core.cell import Cell


class DataReader:
    """Reads all tables and creates all Cell objects upfront"""

    def value_normalizer(self, value: str) -> str:
        """
        This method takes a value and minimally normalizes it. (Raha's value normalizer)
        """
        if value is not np.NAN:
            value = html.unescape(value)
            value = re.sub("[\t\n ]+", " ", value, re.UNICODE)
            value = value.strip("\t\n ")
        return value

    def read_csv(self, path: str, low_memory: bool = False) -> pd.DataFrame:
        """
        This method reads a table from a csv file path,
        with pandas default null values and str data type
        Args:
            low_memory: whether to use low memory mode (bool), default False
            path: table path (str)

        Returns:
            pandas dataframe of the table
        """
        logging.info("Reading table, name: %s", path)

        return pd.read_csv(
            path,
            sep=",",
            header="infer",
            low_memory=low_memory,
            encoding="latin-1",
            dtype=str,
            keep_default_na=False,
        ).applymap(lambda x: self.value_normalizer(x) if isinstance(x, str) else x)

    def read_all_tables(
        self,
        base_path: str,
        dirty_suffix: str = "dirty.csv",
        clean_suffix: str = "clean.csv",
    ) -> List[Cell]:
        """Read all tables from directory structure and create all cells"""
        all_cells = []

        # Walk through directory structure
        for root, dirs, files in os.walk(base_path):
            dirty_files = [f for f in files if f.endswith(dirty_suffix)]

            for dirty_file in dirty_files:
                table_id = os.path.basename(root)  # Use folder name as table_id
                dirty_path = os.path.join(root, dirty_file)

                # Look for corresponding clean file
                clean_file = dirty_file.replace(dirty_suffix, clean_suffix)
                clean_path = os.path.join(root, clean_file)

                if os.path.exists(clean_path):
                    # Read with ground truth
                    table_cells = self._read_table_with_ground_truth(
                        dirty_path, clean_path, table_id
                    )
                else:
                    # Read without ground truth
                    table_cells = self._read_table_only(dirty_path, table_id)

                all_cells.extend(table_cells)

        return all_cells

    def _read_table_with_ground_truth(
        self, dirty_path: str, clean_path: str, table_id: str
    ) -> List[Cell]:
        """Read single table with ground truth"""
        dirty_df = self.read_csv(dirty_path)
        clean_df = self.read_csv(clean_path)

        dirty_df.columns = clean_df.columns
        diff = dirty_df.compare(clean_df, keep_shape=True)
        self_diff = diff.xs("self", axis=1, level=1)
        other_diff = diff.xs("other", axis=1, level=1)

        # Custom comparison. True (or 1) only when values are different and not both NaN.
        label_df = (
            (self_diff != other_diff) & ~(self_diff.isna() & other_diff.isna())
        ).astype(int)

        cells = []

        for col_idx, col_name in enumerate(dirty_df.columns):
            for row_idx in range(len(dirty_df)):
                dirty_value = dirty_df.iloc[row_idx, col_idx]
                clean_value = clean_df.iloc[row_idx, col_idx]
                is_error = bool(label_df.iloc[row_idx, col_idx])

                cell = Cell(
                    dirty_value=str(dirty_value) if pd.notna(dirty_value) else "",
                    ground_truth=str(clean_value) if pd.notna(clean_value) else "",
                    table_id=table_id,
                    row_idx=row_idx,
                    col_idx=col_idx,
                    col_name=col_name,
                )

                cell.is_error = is_error
                cells.append(cell)

        return cells

    def _read_table_only(self, csv_path: str, table_id: str) -> List[Cell]:
        """Read single table without ground truth"""
        df = self.read_csv(csv_path)
        cells = []

        for row_idx, row in df.iterrows():
            for col_idx, (col_name, dirty_value) in enumerate(row.items()):
                cell = Cell(
                    dirty_value=str(dirty_value) if pd.notna(dirty_value) else "",
                    ground_truth="",  # Unknown
                    table_id=table_id,
                    row_idx=row_idx,
                    col_idx=col_idx,
                    col_name=col_name,
                )
                cells.append(cell)

        return cells
