#!/usr/bin/env python3
"""
Script to clean hospital dataset by removing only empty columns and overly long text columns.
"""

import pandas as pd


def clean_hospital_dataset_refined():
    """Clean the hospital dataset by removing only problematic columns"""

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
    print(f"Original dirty columns: {list(dirty_df.columns)}")
    print(f"Original clean columns: {list(clean_df.columns)}")

    # Identify columns to remove
    columns_to_remove = set()

    # 1. Remove address_2 and address_3 as they only contain "empty"
    for col in dirty_df.columns:
        if "address_2" in col.lower() or "address_3" in col.lower():
            unique_vals = dirty_df[col].dropna().unique()
            meaningful_values = [
                val
                for val in unique_vals
                if str(val).lower() not in ["empty", "nan", ""]
            ]
            if len(meaningful_values) == 0:
                columns_to_remove.add(col)
                print(f"Removing {col} - only contains 'empty' values")

    # Do the same for clean dataset
    for col in clean_df.columns:
        if "address2" in col.lower() or "address3" in col.lower():
            unique_vals = clean_df[col].dropna().unique()
            meaningful_values = [
                val
                for val in unique_vals
                if str(val).lower() not in ["empty", "nan", ""]
            ]
            if len(meaningful_values) == 0:
                columns_to_remove.add(col)
                print(f"Removing {col} - only contains 'empty' values")

    # 2. Remove measure_name column as it's very long and makes the dataset unwieldy
    for col in dirty_df.columns:
        if "measure_name" in col.lower():
            max_length = max(len(str(val)) for val in dirty_df[col].dropna())
            if max_length > 100:
                columns_to_remove.add(col)
                print(f"Removing {col} - text too long (max length: {max_length})")

    for col in clean_df.columns:
        if "measure_name" in col.lower() or "measurename" in col.lower():
            max_length = max(len(str(val)) for val in clean_df[col].dropna())
            if max_length > 100:
                columns_to_remove.add(col)
                print(f"Removing {col} - text too long (max length: {max_length})")

    print(f"\nColumns to remove: {sorted(columns_to_remove)}")

    # Remove the problematic columns
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
    print(f"Remaining dirty columns: {list(cleaned_dirty.columns)}")
    print(f"Remaining clean columns: {list(cleaned_clean.columns)}")

    # Save cleaned datasets, replacing the originals
    cleaned_dirty.to_csv(dirty_path, index=False)
    cleaned_clean.to_csv(clean_path, index=False)

    print("\nDatasets cleaned and saved back to original files:")
    print(f"- {dirty_path}")
    print(f"- {clean_path}")

    # Show a preview of the cleaned data
    print("\nPreview of cleaned dirty dataset:")
    print(cleaned_dirty.head(2))
    print("\nPreview of cleaned clean dataset:")
    print(cleaned_clean.head(2))

    return cleaned_dirty, cleaned_clean


if __name__ == "__main__":
    cleaned_dirty, cleaned_clean = clean_hospital_dataset_refined()
