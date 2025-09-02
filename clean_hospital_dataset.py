#!/usr/bin/env python3
"""
Script to analyze and clean hospital dataset by removing empty and long columns.
"""

import pandas as pd


def analyze_columns(df, dataset_name):
    """Analyze columns to identify empty or long columns"""
    print(f"\n=== Analyzing {dataset_name} ===")

    empty_columns = []
    long_columns = []
    column_stats = {}

    for col in df.columns:
        # Check for empty columns
        non_empty_count = df[col].notna().sum()
        unique_vals = df[col].dropna().unique()

        # Check if column is essentially empty (only "empty" values or nulls)
        meaningful_values = [
            val for val in unique_vals if str(val).lower() not in ["empty", "nan", ""]
        ]

        if len(meaningful_values) == 0:
            empty_columns.append(col)

        # Check for long columns (very long text)
        max_length = 0
        if len(meaningful_values) > 0:
            max_length = max(len(str(val)) for val in meaningful_values)

        if (
            max_length > 100
        ):  # Consider columns with text longer than 100 chars as "long"
            long_columns.append(col)

        column_stats[col] = {
            "non_empty_count": non_empty_count,
            "unique_meaningful_values": len(meaningful_values),
            "max_length": max_length,
            "sample_values": meaningful_values[:3]
            if len(meaningful_values) > 0
            else [],
        }

    return empty_columns, long_columns, column_stats


def clean_hospital_dataset():
    """Clean the hospital dataset by removing empty and long columns"""

    # Paths
    dirty_path = (
        "/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM_small/hospital/dirty.csv"
    )
    clean_path = (
        "/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM_small/hospital/clean.csv"
    )

    # Read datasets
    dirty_df = pd.read_csv(dirty_path)
    clean_df = pd.read_csv(clean_path)

    print(f"Original dirty dataset shape: {dirty_df.shape}")
    print(f"Original clean dataset shape: {clean_df.shape}")

    # Analyze columns
    dirty_empty, dirty_long, dirty_stats = analyze_columns(dirty_df, "dirty")
    clean_empty, clean_long, clean_stats = analyze_columns(clean_df, "clean")

    # Print analysis results
    print(f"\nEmpty columns in dirty: {dirty_empty}")
    print(f"Long columns in dirty: {dirty_long}")
    print(f"Empty columns in clean: {clean_empty}")
    print(f"Long columns in clean: {clean_long}")

    # Print detailed column statistics
    print("\n=== Column Details ===")
    for col in dirty_df.columns:
        stats = dirty_stats.get(col, {})
        print(
            f"{col}: {stats.get('non_empty_count', 0)} non-empty, "
            f"{stats.get('unique_meaningful_values', 0)} unique meaningful values, "
            f"max length: {stats.get('max_length', 0)}"
        )
        if stats.get("sample_values"):
            sample_str = str(stats["sample_values"][0])[:50]
            if len(sample_str) == 50:
                sample_str += "..."
            print(f"  Sample: {sample_str}")

    # Determine columns to remove
    # Combine empty columns from both datasets
    columns_to_remove = set()

    # Remove columns that are empty or mostly empty
    for col in dirty_df.columns:
        dirty_stats_col = dirty_stats.get(col, {})
        clean_stats_col = clean_stats.get(col, {})

        # Remove if empty in both or has very long text
        if (
            dirty_stats_col.get("unique_meaningful_values", 0) == 0
            or clean_stats_col.get("unique_meaningful_values", 0) == 0
        ):
            columns_to_remove.add(col)
        elif (
            dirty_stats_col.get("max_length", 0) > 100
            or clean_stats_col.get("max_length", 0) > 100
        ):
            columns_to_remove.add(col)

    # Also remove address_2 and address_3 as they seem to only contain "empty"
    columns_to_remove.update(["address_2", "address_3", "Address2", "Address3"])

    print(f"\nColumns to remove: {sorted(columns_to_remove)}")

    # Remove columns
    columns_to_keep_dirty = [
        col for col in dirty_df.columns if col not in columns_to_remove
    ]
    columns_to_keep_clean = [
        col for col in clean_df.columns if col not in columns_to_remove
    ]

    cleaned_dirty = dirty_df[columns_to_keep_dirty].copy()
    cleaned_clean = clean_df[columns_to_keep_clean].copy()

    print(f"\nCleaned dirty dataset shape: {cleaned_dirty.shape}")
    print(f"Cleaned clean dataset shape: {cleaned_clean.shape}")
    print(f"Remaining columns: {list(cleaned_dirty.columns)}")

    # Save cleaned datasets
    cleaned_dirty.to_csv(dirty_path.replace(".csv", "_cleaned.csv"), index=False)
    cleaned_clean.to_csv(clean_path.replace(".csv", "_cleaned.csv"), index=False)

    print("\nCleaned datasets saved as:")
    print(f"- {dirty_path.replace('.csv', '_cleaned.csv')}")
    print(f"- {clean_path.replace('.csv', '_cleaned.csv')}")

    return cleaned_dirty, cleaned_clean


if __name__ == "__main__":
    cleaned_dirty, cleaned_clean = clean_hospital_dataset()
