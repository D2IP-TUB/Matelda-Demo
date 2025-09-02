#!/usr/bin/env python3
"""
Script to regenerate only hospital data with HospitalName included and MeasureName excluded
"""

import logging
from pathlib import Path

import numpy as np
import pandas as pd

# Set up logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def calculate_error_percentage(clean_df, dirty_df):
    """Calculate the percentage of error cells between clean and dirty datasets"""
    if clean_df.shape != dirty_df.shape:
        logger.warning("Clean and dirty dataframes have different shapes")
        return 0.0

    # Compare each cell by position (since column names might be different)
    errors = 0
    total_cells = clean_df.shape[0] * clean_df.shape[1]

    for i in range(clean_df.shape[1]):
        # Convert to string for comparison to handle different data types
        clean_col = clean_df.iloc[:, i].astype(str)
        dirty_col = dirty_df.iloc[:, i].astype(str)
        errors += (clean_col != dirty_col).sum()

    return (errors / total_cells) * 100 if total_cells > 0 else 0.0


def remove_index_columns(df):
    """Remove columns that appear to be index columns (like 1, 2, 3... or index)"""
    cols_to_remove = []
    for col in df.columns:
        if col.lower() in ["index", "tuple_id"] or col.isdigit():
            cols_to_remove.append(col)

    return df.drop(columns=cols_to_remove)


def find_columns_with_most_errors_hospital(clean_df, dirty_df, num_cols=5):
    """Find the columns with the most errors for hospital data, ensuring HospitalName is included and MeasureName is excluded"""
    error_counts = {}

    # Create a mapping between clean and dirty column names
    clean_cols = clean_df.columns.tolist()
    dirty_cols = dirty_df.columns.tolist()

    # For hospital data, the column names are different between clean and dirty
    # We'll match them by position since they should correspond
    min_cols = min(len(clean_cols), len(dirty_cols))

    for i in range(min_cols):
        clean_col = clean_cols[i]
        dirty_col = dirty_cols[i]

        clean_col_data = clean_df.iloc[:, i].astype(str)
        dirty_col_data = dirty_df.iloc[:, i].astype(str)
        error_count = (clean_col_data != dirty_col_data).sum()
        error_counts[clean_col] = error_count

        logger.info(f"  {clean_col} -> {dirty_col}: {error_count} errors")

    # Sort by error count and get candidates
    sorted_cols = sorted(error_counts.items(), key=lambda x: x[1], reverse=True)

    # Build the final list: ensure HospitalName is included, exclude MeasureName
    final_cols = []

    # Always include HospitalName if it exists
    if "HospitalName" in error_counts:
        final_cols.append("HospitalName")
        logger.info(f"  HospitalName: {error_counts['HospitalName']} errors (required)")

    # Add other high-error columns, excluding MeasureName
    for col, count in sorted_cols:
        if len(final_cols) >= num_cols:
            break
        if col not in final_cols and col != "MeasureName":
            final_cols.append(col)

    logger.info(
        f"Selected top {num_cols} columns (HospitalName required, MeasureName excluded):"
    )
    for col in final_cols:
        logger.info(f"  {col}: {error_counts[col]} errors")

    return final_cols


def sample_hospital_data(clean_path, dirty_path, output_dir, split_num, max_rows=40):
    """Sample hospital dataset keeping only 5 columns with most errors"""
    logger.info(f"Processing hospital split {split_num}")

    clean_df = pd.read_csv(clean_path)
    dirty_df = pd.read_csv(dirty_path)

    # Remove index columns
    clean_df = remove_index_columns(clean_df)
    dirty_df = remove_index_columns(dirty_df)

    # Find columns with most errors, but exclude MeasureName and ensure HospitalName is included
    top_error_cols = find_columns_with_most_errors_hospital(
        clean_df, dirty_df, num_cols=5
    )

    # Get the column indices for both clean and dirty
    clean_cols = clean_df.columns.tolist()

    # Find the indices of the top error columns in clean dataframe
    top_col_indices = [
        clean_cols.index(col) for col in top_error_cols if col in clean_cols
    ]

    # Keep only these columns by index (to handle different column names)
    clean_df = clean_df.iloc[:, top_col_indices]
    dirty_df = dirty_df.iloc[:, top_col_indices]

    # Sample rows to maximize error rate
    total_rows = len(clean_df)
    sample_size = min(max_rows, total_rows)

    best_error_rate = 0
    best_indices = None

    for attempt in range(10):
        if attempt == 0:
            indices = list(range(sample_size))
        else:
            indices = np.random.choice(
                total_rows, size=sample_size, replace=False
            ).tolist()

        sample_clean = clean_df.iloc[indices].reset_index(drop=True)
        sample_dirty = dirty_df.iloc[indices].reset_index(drop=True)

        error_rate = calculate_error_percentage(sample_clean, sample_dirty)

        if error_rate > best_error_rate:
            best_error_rate = error_rate
            best_indices = indices

    final_clean = clean_df.iloc[best_indices].reset_index(drop=True)
    final_dirty = dirty_df.iloc[best_indices].reset_index(drop=True)

    logger.info(
        f"Hospital split {split_num}: {len(final_clean)} rows, {best_error_rate:.1f}% error rate"
    )
    logger.info(f"Selected columns: {top_error_cols}")

    # Save the samples
    split_dir = output_dir / f"hospital_split_{split_num}"
    split_dir.mkdir(exist_ok=True)

    final_clean.to_csv(split_dir / "clean.csv", index=False)
    final_dirty.to_csv(split_dir / "dirty.csv", index=False)

    return best_error_rate


def main():
    """Main function to regenerate hospital datasets"""
    # Define paths
    qrm_dir = Path("/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM")
    output_dir = Path(
        "/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM_small_sampled"
    )

    logger.info(
        "Regenerating hospital datasets with HospitalName (excluding MeasureName)..."
    )

    clean_path = qrm_dir / "hospital" / "clean.csv"
    dirty_path = qrm_dir / "hospital" / "dirty.csv"

    summary = []

    for split_num in range(1, 4):
        error_rate = sample_hospital_data(clean_path, dirty_path, output_dir, split_num)
        summary.append(error_rate)

    # Print summary
    logger.info("\n=== HOSPITAL REGENERATION SUMMARY ===")
    for i, rate in enumerate(summary, 1):
        logger.info(f"  Split {i}: {rate:.1f}% error rate")

    logger.info(f"\nHospital datasets regenerated in: {output_dir}")


if __name__ == "__main__":
    main()
