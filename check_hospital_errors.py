#!/usr/bin/env python3
"""
Check hospital data specifically for errors
"""

from pathlib import Path

import pandas as pd


def check_hospital_errors():
    output_dir = Path(
        "/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM_small_sampled"
    )

    for split_num in [1, 2]:  # Only check existing splits
        split_dir = output_dir / f"hospital_split_{split_num}"

        print(f"\n=== Hospital Split {split_num} ===")

        clean_df = pd.read_csv(split_dir / "clean.csv")
        dirty_df = pd.read_csv(split_dir / "dirty.csv")

        print(f"Clean columns: {clean_df.columns.tolist()}")
        print(f"Dirty columns: {dirty_df.columns.tolist()}")

        # Check each column for differences
        for i, (clean_col, dirty_col) in enumerate(
            zip(clean_df.columns, dirty_df.columns)
        ):
            print(f"\nColumn {i}: {clean_col} vs {dirty_col}")

            # Compare values
            clean_vals = clean_df.iloc[:, i].astype(str)
            dirty_vals = dirty_df.iloc[:, i].astype(str)

            differences = clean_vals != dirty_vals
            diff_count = differences.sum()

            print(f"  Differences: {diff_count} out of {len(clean_df)} rows")

            if diff_count > 0:
                diff_indices = differences[differences].index[:3]
                for idx in diff_indices:
                    print(
                        f"    Row {idx}: '{clean_vals.iloc[idx]}' vs '{dirty_vals.iloc[idx]}'"
                    )

            # Show first few values
            print(f"  Clean samples: {clean_vals.head(3).tolist()}")
            print(f"  Dirty samples: {dirty_vals.head(3).tolist()}")


if __name__ == "__main__":
    check_hospital_errors()
