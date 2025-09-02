#!/usr/bin/env python3
"""
Script to count total columns across all datasets
"""

import logging
from pathlib import Path

import pandas as pd

# Set up logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def count_total_columns():
    """Count total columns across all datasets"""
    output_dir = Path(
        "/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM_small_sampled"
    )

    total_columns = 0
    dataset_summary = {}

    logger.info("Counting total columns across all datasets...")

    # Count beers datasets (3 splits)
    beers_columns = 0
    for split_num in range(1, 4):
        split_dir = output_dir / f"beers_split_{split_num}"
        clean_df = pd.read_csv(split_dir / "clean.csv")
        beers_columns = len(clean_df.columns)
        break  # All splits have same columns

    beers_total = beers_columns * 3  # 3 splits
    dataset_summary["beers"] = {
        "columns_per_split": beers_columns,
        "splits": 3,
        "total_columns": beers_total,
    }
    total_columns += beers_total

    # Count flights datasets (3 splits)
    flights_columns = 0
    for split_num in range(1, 4):
        split_dir = output_dir / f"flights_split_{split_num}"
        clean_df = pd.read_csv(split_dir / "clean.csv")
        flights_columns = len(clean_df.columns)
        break  # All splits have same columns

    flights_total = flights_columns * 3  # 3 splits
    dataset_summary["flights"] = {
        "columns_per_split": flights_columns,
        "splits": 3,
        "total_columns": flights_total,
    }
    total_columns += flights_total

    # Count hospital datasets (2 splits)
    hospital_columns = 0
    for split_num in [1, 2]:
        split_dir = output_dir / f"hospital_split_{split_num}"
        clean_df = pd.read_csv(split_dir / "clean.csv")
        hospital_columns = len(clean_df.columns)
        break  # All splits have same columns

    hospital_total = hospital_columns * 2  # 2 splits
    dataset_summary["hospital"] = {
        "columns_per_split": hospital_columns,
        "splits": 2,
        "total_columns": hospital_total,
    }
    total_columns += hospital_total

    # Print summary
    logger.info("\n=== COLUMN COUNT SUMMARY ===")
    logger.info(
        f"Beers: {beers_columns} columns × 3 splits = {beers_total} total columns"
    )
    logger.info(
        f"Flights: {flights_columns} columns × 3 splits = {flights_total} total columns"
    )
    logger.info(
        f"Hospital: {hospital_columns} columns × 2 splits = {hospital_total} total columns"
    )
    logger.info(f"\nGRAND TOTAL: {total_columns} columns across all datasets")

    # Detailed breakdown
    logger.info("\n=== DETAILED BREAKDOWN ===")
    logger.info(
        "Beers columns: ['beer-name', 'ounces', 'abv', 'ibu', 'brewery-name', 'city', 'state']"
    )
    logger.info(
        "Flights columns: ['src', 'flight', 'sched_dep_time', 'act_dep_time', 'sched_arr_time', 'act_arr_time']"
    )
    logger.info(
        "Hospital columns: ['HospitalName', 'CountyName', 'City', 'HospitalType']"
    )

    return total_columns, dataset_summary


def main():
    total_columns, summary = count_total_columns()
    return total_columns


if __name__ == "__main__":
    main()
