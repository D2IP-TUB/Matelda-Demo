#!/usr/bin/env python3
"""
Script to find edge cases where error detection might fail
"""

from pathlib import Path

import pandas as pd


def analyze_edge_cases():
    """Find edge cases that could challenge error detection algorithms"""
    output_dir = Path(
        "/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM_small_sampled"
    )

    print("=== ANALYZING EDGE CASES FOR ERROR DETECTION ===\n")

    # Check all datasets
    datasets = ["beers", "flights", "hospital"]

    for dataset in datasets:
        print(f"--- {dataset.upper()} DATASET ---")

        for split_num in range(1, 4):
            if dataset == "beers":
                split_dir = output_dir / f"beers_split_{split_num}"
            elif dataset == "flights":
                split_dir = output_dir / f"flights_split_{split_num}"
            else:
                split_dir = output_dir / f"hospital_split_{split_num}"

            clean_df = pd.read_csv(split_dir / "clean.csv")
            dirty_df = pd.read_csv(split_dir / "dirty.csv")

            print(f"\n{dataset} Split {split_num}:")

            # Edge Case 1: Missing values vs empty strings
            for col in clean_df.columns:
                if col in dirty_df.columns:
                    clean_missing = clean_df[col].isna().sum()
                    dirty_missing = dirty_df[col].isna().sum()

                    clean_empty = (clean_df[col] == "").sum()
                    dirty_empty = (dirty_df[col] == "").sum()

                    if clean_missing != dirty_missing or clean_empty != dirty_empty:
                        print(f"  Missing value edge case in {col}:")
                        print(f"    Clean: {clean_missing} NaN, {clean_empty} empty")
                        print(f"    Dirty: {dirty_missing} NaN, {dirty_empty} empty")

            # Edge Case 2: Identical values that look different (subtle errors)
            for col in clean_df.columns:
                if col in dirty_df.columns:
                    # Look for very similar values
                    clean_vals = clean_df[col].astype(str)
                    dirty_vals = dirty_df[col].astype(str)

                    differences = clean_vals != dirty_vals
                    if differences.any():
                        diff_indices = differences[differences].index[:3]
                        for idx in diff_indices:
                            clean_val = str(clean_vals.iloc[idx])
                            dirty_val = str(dirty_vals.iloc[idx])

                            # Check for subtle differences
                            if len(clean_val) == len(dirty_val) and len(clean_val) > 5:
                                char_diffs = sum(
                                    c1 != c2 for c1, c2 in zip(clean_val, dirty_val)
                                )
                                if char_diffs <= 2:  # Very subtle differences
                                    print(f"  Subtle difference in {col} (row {idx}):")
                                    print(f"    Clean: '{clean_val}'")
                                    print(f"    Dirty: '{dirty_val}'")
                                    print(
                                        f"    Only {char_diffs} character(s) different"
                                    )

            # Edge Case 3: Check for valid-looking but wrong values
            if dataset == "beers":
                # Check ABV values that might be formatted differently but still look valid
                if "abv" in clean_df.columns and "abv" in dirty_df.columns:
                    for idx in range(min(5, len(clean_df))):
                        clean_abv = str(clean_df.loc[idx, "abv"])
                        dirty_abv = str(dirty_df.loc[idx, "abv"])
                        if clean_abv != dirty_abv:
                            print(f"  ABV formatting edge case (row {idx}):")
                            print(f"    Clean: '{clean_abv}'")
                            print(f"    Dirty: '{dirty_abv}'")

            # Edge Case 4: Check for data type inconsistencies
            for col in clean_df.columns:
                if col in dirty_df.columns:
                    clean_type = clean_df[col].dtype
                    dirty_type = dirty_df[col].dtype
                    if clean_type != dirty_type:
                        print(f"  Data type inconsistency in {col}:")
                        print(f"    Clean: {clean_type}")
                        print(f"    Dirty: {dirty_type}")

            # Edge Case 5: Look for completely clean rows (no errors)
            row_errors = []
            for idx in range(len(clean_df)):
                errors_in_row = 0
                for col in clean_df.columns:
                    if col in dirty_df.columns:
                        if str(clean_df.loc[idx, col]) != str(dirty_df.loc[idx, col]):
                            errors_in_row += 1
                row_errors.append(errors_in_row)

            clean_rows = sum(1 for e in row_errors if e == 0)
            if clean_rows > 0:
                print(f"  Edge case: {clean_rows} completely clean rows (no errors)")
                clean_row_indices = [i for i, e in enumerate(row_errors) if e == 0][:3]
                for idx in clean_row_indices:
                    print(f"    Row {idx}: All values identical between clean/dirty")


def find_specific_edge_cases():
    """Look for specific challenging edge cases"""
    output_dir = Path(
        "/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM_small_sampled"
    )

    print("\n=== SPECIFIC EDGE CASES ===")

    # Check beers for ounces column edge cases
    for split_num in range(1, 4):
        split_dir = output_dir / f"beers_split_{split_num}"
        clean_df = pd.read_csv(split_dir / "clean.csv")
        dirty_df = pd.read_csv(split_dir / "dirty.csv")

        print(f"\nBeers Split {split_num} - Ounces Column Edge Cases:")

        if "ounces" in clean_df.columns and "ounces" in dirty_df.columns:
            # Look for cases where dirty value is clean but clean has precision differences
            for idx in range(len(clean_df)):
                clean_val = clean_df.loc[idx, "ounces"]
                dirty_val = dirty_df.loc[idx, "ounces"]

                # Check if dirty is numeric while clean might have formatting
                if isinstance(dirty_val, (int, float)) and isinstance(
                    clean_val, (int, float)
                ):
                    if abs(clean_val - dirty_val) < 0.001 and clean_val != dirty_val:
                        print(
                            f"  Precision edge case (row {idx}): {clean_val} vs {dirty_val}"
                        )

                # Check for cases where values are same but types differ
                if str(clean_val) == str(dirty_val) and not isinstance(
                    clean_val, type(dirty_val)
                ):
                    print(
                        f"  Type mismatch (row {idx}): {clean_val} ({type(clean_val)}) vs {dirty_val} ({type(dirty_val)})"
                    )


if __name__ == "__main__":
    analyze_edge_cases()
    find_specific_edge_cases()
