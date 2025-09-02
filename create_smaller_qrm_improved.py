#!/usr/bin/env python3
"""
Improved script to create smaller QRM datasets with 100 rows per table and 60% error rate.
Errors are defined as cells where dirty != clean and both are not None.
This version handles column name differences and case sensitivity better.
"""

import os

import pandas as pd


def align_datasets(dirty_df, clean_df):
    """Align datasets by matching columns and ensuring same indices"""

    # Handle column name differences by mapping based on position
    # Assume columns are in the same order but may have different names
    min_cols = min(len(dirty_df.columns), len(clean_df.columns))

    # Create aligned dataframes with same column names
    dirty_aligned = dirty_df.iloc[:, :min_cols].copy()
    clean_aligned = clean_df.iloc[:, :min_cols].copy()

    # Use dirty column names as reference
    clean_aligned.columns = dirty_aligned.columns

    return dirty_aligned, clean_aligned


def calculate_error_rate(dirty_df, clean_df):
    """Calculate the current error rate between dirty and clean datasets"""
    dirty_aligned, clean_aligned = align_datasets(dirty_df, clean_df)

    total_cells = 0
    error_cells = 0

    for col in dirty_aligned.columns:
        for idx in dirty_aligned.index:
            if idx in clean_aligned.index:
                dirty_val = dirty_aligned.loc[idx, col]
                clean_val = clean_aligned.loc[idx, col]

                # Only count non-None/non-NaN values
                if pd.notna(dirty_val) and pd.notna(clean_val):
                    total_cells += 1
                    # Compare as strings, case-sensitive
                    dirty_str = str(dirty_val).strip()
                    clean_str = str(clean_val).strip()
                    if dirty_str != clean_str:
                        error_cells += 1

    return error_cells / total_cells if total_cells > 0 else 0


def count_errors_per_row(dirty_df, clean_df):
    """Count errors per row and return error counts"""
    dirty_aligned, clean_aligned = align_datasets(dirty_df, clean_df)

    error_counts = []

    for idx in dirty_aligned.index:
        if idx in clean_aligned.index:
            row_errors = 0
            row_cells = 0

            for col in dirty_aligned.columns:
                dirty_val = dirty_aligned.loc[idx, col]
                clean_val = clean_aligned.loc[idx, col]

                # Only count non-None/non-NaN values
                if pd.notna(dirty_val) and pd.notna(clean_val):
                    row_cells += 1
                    # Compare as strings, case-sensitive
                    dirty_str = str(dirty_val).strip()
                    clean_str = str(clean_val).strip()
                    if dirty_str != clean_str:
                        row_errors += 1

            error_rate = row_errors / row_cells if row_cells > 0 else 0
            error_counts.append((idx, row_errors, row_cells, error_rate))

    return error_counts


def create_smaller_dataset(dataset_path, target_rows=100, target_error_rate=0.6):
    """Create a smaller dataset with specified number of rows and error rate"""

    dirty_path = os.path.join(dataset_path, "dirty.csv")
    clean_path = os.path.join(dataset_path, "clean.csv")

    # Read the datasets
    dirty_df = pd.read_csv(dirty_path)
    clean_df = pd.read_csv(clean_path)

    print(f"\nProcessing {dataset_path}")
    print(f"Original size: {len(dirty_df)} rows")

    # Calculate current error rate
    current_error_rate = calculate_error_rate(dirty_df, clean_df)
    print(f"Current error rate: {current_error_rate:.3f}")

    # Get error information per row
    error_info = count_errors_per_row(dirty_df, clean_df)
    error_info.sort(key=lambda x: x[3], reverse=True)  # Sort by error rate

    # Show some statistics
    rows_with_errors = sum(1 for _, _, _, rate in error_info if rate > 0)
    print(f"Rows with errors: {rows_with_errors}/{len(error_info)}")

    # Calculate how many rows should have errors (60% of 100 = 60 rows)
    target_error_rows = int(target_rows * target_error_rate)
    target_clean_rows = target_rows - target_error_rows

    print(
        f"Target: {target_rows} rows with {target_error_rows} error rows ({target_error_rate:.1%})"
    )

    # Select rows strategically
    selected_indices = []

    # First, add rows with highest error rates
    error_rows_added = 0
    for idx, row_errors, row_cells, error_rate in error_info:
        if error_rate > 0 and error_rows_added < target_error_rows:
            selected_indices.append(idx)
            error_rows_added += 1

    # Then, add clean rows
    clean_rows_added = 0
    for idx, row_errors, row_cells, error_rate in error_info:
        if (
            error_rate == 0
            and clean_rows_added < target_clean_rows
            and idx not in selected_indices
        ):
            selected_indices.append(idx)
            clean_rows_added += 1

    # If we still need more rows, add any remaining rows
    remaining_needed = target_rows - len(selected_indices)
    for idx, _, _, _ in error_info:
        if remaining_needed <= 0:
            break
        if idx not in selected_indices:
            selected_indices.append(idx)
            remaining_needed -= 1

    # Ensure we have exactly target_rows
    selected_indices = selected_indices[:target_rows]

    # Create the smaller datasets
    smaller_dirty = dirty_df.loc[selected_indices].reset_index(drop=True)
    smaller_clean = clean_df.loc[selected_indices].reset_index(drop=True)

    # Update the index column if it exists
    if "index" in smaller_dirty.columns:
        smaller_dirty["index"] = range(1, len(smaller_dirty) + 1)
    if "index" in smaller_clean.columns:
        smaller_clean["index"] = range(1, len(smaller_clean) + 1)

    # Verify the final error rate
    final_error_rate = calculate_error_rate(smaller_dirty, smaller_clean)
    print(f"Final size: {len(smaller_dirty)} rows")
    print(f"Final error rate: {final_error_rate:.3f}")

    # Save the smaller datasets
    smaller_dirty.to_csv(dirty_path.replace(".csv", "_small.csv"), index=False)
    smaller_clean.to_csv(clean_path.replace(".csv", "_small.csv"), index=False)

    return smaller_dirty, smaller_clean, final_error_rate


def main():
    """Main function to process all QRM datasets"""
    qrm_path = "/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM"

    datasets = ["beers", "flights", "hospital"]

    results = {}

    for dataset in datasets:
        dataset_path = os.path.join(qrm_path, dataset)
        if os.path.exists(dataset_path):
            try:
                smaller_dirty, smaller_clean, error_rate = create_smaller_dataset(
                    dataset_path, target_rows=100, target_error_rate=0.6
                )
                results[dataset] = error_rate
            except Exception as e:
                print(f"Error processing {dataset}: {e}")
        else:
            print(f"Dataset {dataset} not found at {dataset_path}")

    print("\n" + "=" * 50)
    print("SUMMARY")
    print("=" * 50)
    for dataset, error_rate in results.items():
        print(f"{dataset}: {error_rate:.3f} error rate")

    print("\nSmaller datasets saved with '_small.csv' suffix")
    print("Each dataset now has 100 rows with target 60% error rate")


if __name__ == "__main__":
    main()
