#!/usr/bin/env python3
"""
Script to sample QRM datasets according to specific requirements:
1) Tables shouldn't be larger than 40 rows
2) # error cells / #total cells should be more than 50% if possible
3) For flights, keep complete records for same flight identifiers
4) Keep only 5 columns in Hospital, the ones with most errors
5) Keep dirty and clean versions consistent
6) Remove index columns (1-2-... columns)
7) Create separate folder for output
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


def sample_beers_data(clean_path, dirty_path, output_dir, split_num, max_rows=40):
    """Sample beers dataset"""
    logger.info(f"Processing beers split {split_num}")

    clean_df = pd.read_csv(clean_path)
    dirty_df = pd.read_csv(dirty_path)

    # Remove index columns
    clean_df = remove_index_columns(clean_df)
    dirty_df = remove_index_columns(dirty_df)

    # Sample rows to get high error rate
    total_rows = len(clean_df)
    sample_size = min(max_rows, total_rows)

    # Try different sampling strategies to maximize error rate
    best_error_rate = 0
    best_indices = None

    for attempt in range(10):  # Try 10 different random samples
        if attempt == 0:
            # First attempt: take first rows
            indices = list(range(sample_size))
        else:
            # Random sampling
            indices = np.random.choice(
                total_rows, size=sample_size, replace=False
            ).tolist()

        sample_clean = clean_df.iloc[indices].reset_index(drop=True)
        sample_dirty = dirty_df.iloc[indices].reset_index(drop=True)

        error_rate = calculate_error_percentage(sample_clean, sample_dirty)

        if error_rate > best_error_rate:
            best_error_rate = error_rate
            best_indices = indices

    # Use the best sample
    final_clean = clean_df.iloc[best_indices].reset_index(drop=True)
    final_dirty = dirty_df.iloc[best_indices].reset_index(drop=True)

    logger.info(
        f"Beers split {split_num}: {len(final_clean)} rows, {best_error_rate:.1f}% error rate"
    )

    # Save the samples
    split_dir = output_dir / f"beers_split_{split_num}"
    split_dir.mkdir(exist_ok=True)

    final_clean.to_csv(split_dir / "clean.csv", index=False)
    final_dirty.to_csv(split_dir / "dirty.csv", index=False)

    return best_error_rate


def sample_flights_data(clean_path, dirty_path, output_dir, split_num, max_rows=40):
    """Sample flights dataset keeping complete flight records together"""
    logger.info(f"Processing flights split {split_num}")

    clean_df = pd.read_csv(clean_path)
    dirty_df = pd.read_csv(dirty_path)

    # Remove index columns
    clean_df = remove_index_columns(clean_df)
    dirty_df = remove_index_columns(dirty_df)

    # Group by flight identifier to keep complete records together
    flight_groups = clean_df.groupby("flight")

    # Select flights that together don't exceed max_rows
    selected_flights = []
    total_rows = 0

    # Try to maximize error rate while keeping flight groups together
    flight_error_rates = []

    for flight, group in flight_groups:
        if len(group) + total_rows <= max_rows:
            # Calculate error rate for this flight group
            flight_indices = group.index
            flight_clean = clean_df.loc[flight_indices]
            flight_dirty = dirty_df.loc[flight_indices]
            error_rate = calculate_error_percentage(flight_clean, flight_dirty)

            flight_error_rates.append((flight, len(group), error_rate, flight_indices))

    # Sort by error rate (descending) to prioritize high-error flights
    flight_error_rates.sort(key=lambda x: x[2], reverse=True)

    # Select flights starting with highest error rates
    selected_indices = []
    total_rows = 0

    for flight, size, error_rate, indices in flight_error_rates:
        if total_rows + size <= max_rows:
            selected_indices.extend(indices)
            selected_flights.append(flight)
            total_rows += size
            logger.info(
                f"Selected flight {flight}: {size} rows, {error_rate:.1f}% error rate"
            )

    if not selected_indices:
        # Fallback: just take first max_rows
        selected_indices = list(range(min(max_rows, len(clean_df))))

    final_clean = clean_df.loc[selected_indices].reset_index(drop=True)
    final_dirty = dirty_df.loc[selected_indices].reset_index(drop=True)

    overall_error_rate = calculate_error_percentage(final_clean, final_dirty)
    logger.info(
        f"Flights split {split_num}: {len(final_clean)} rows, {overall_error_rate:.1f}% error rate"
    )
    logger.info(f"Selected flights: {selected_flights}")

    # Save the samples
    split_dir = output_dir / f"flights_split_{split_num}"
    split_dir.mkdir(exist_ok=True)

    final_clean.to_csv(split_dir / "clean.csv", index=False)
    final_dirty.to_csv(split_dir / "dirty.csv", index=False)

    return overall_error_rate


def find_columns_with_most_errors(clean_df, dirty_df, num_cols=5):
    """Find the columns with the most errors"""
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

    # Sort by error count and return top columns
    sorted_cols = sorted(error_counts.items(), key=lambda x: x[1], reverse=True)
    top_cols = [col for col, _ in sorted_cols[:num_cols]]

    logger.info(f"Selected top {num_cols} columns with most errors:")
    for col in top_cols:
        logger.info(f"  {col}: {error_counts[col]} errors")

    return top_cols


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
    """Main function to process all datasets"""
    # Define paths
    qrm_dir = Path("/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM")
    output_dir = Path(
        "/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM_small_sampled"
    )

    # Create output directory
    output_dir.mkdir(exist_ok=True)

    logger.info("Starting QRM dataset sampling...")

    # Process each dataset with multiple splits
    datasets = ["beers", "flights", "hospital"]
    num_splits = 3

    summary = {}

    for dataset in datasets:
        logger.info(f"\n=== Processing {dataset} dataset ===")
        clean_path = qrm_dir / dataset / "clean.csv"
        dirty_path = qrm_dir / dataset / "dirty.csv"

        summary[dataset] = []

        for split_num in range(1, num_splits + 1):
            if dataset == "beers":
                error_rate = sample_beers_data(
                    clean_path, dirty_path, output_dir, split_num
                )
            elif dataset == "flights":
                error_rate = sample_flights_data(
                    clean_path, dirty_path, output_dir, split_num
                )
            elif dataset == "hospital":
                error_rate = sample_hospital_data(
                    clean_path, dirty_path, output_dir, split_num
                )

            summary[dataset].append(error_rate)

    # Print summary
    logger.info("\n=== SUMMARY ===")
    for dataset, error_rates in summary.items():
        logger.info(f"{dataset.upper()}:")
        for i, rate in enumerate(error_rates, 1):
            logger.info(f"  Split {i}: {rate:.1f}% error rate")

    logger.info(f"\nAll sampled datasets saved to: {output_dir}")


if __name__ == "__main__":
    main()
