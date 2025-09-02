#!/usr/bin/env python3
"""
Script to make column headers consistent between clean and dirty datasets
and remove phone column from hospital
"""

import logging
from pathlib import Path

import pandas as pd

# Set up logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def fix_column_headers():
    """Make column headers consistent between clean and dirty datasets"""
    output_dir = Path(
        "/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM_small_sampled"
    )

    logger.info("Making column headers consistent across all datasets...")

    # Fix beers datasets
    for split_num in range(1, 4):
        split_dir = output_dir / f"beers_split_{split_num}"

        logger.info(f"Processing beers split {split_num}")

        clean_df = pd.read_csv(split_dir / "clean.csv")
        dirty_df = pd.read_csv(split_dir / "dirty.csv")

        # Current clean columns: ['beer-name', 'ounces', 'abv', 'ibu', 'brewery-name', 'city', 'state']
        # Current dirty columns: ['beer_name', 'ounces', 'abv', 'ibu', 'brewery_name', 'city', 'state']

        # Make dirty columns match clean (with hyphens)
        dirty_df.columns = [
            "beer-name",
            "ounces",
            "abv",
            "ibu",
            "brewery-name",
            "city",
            "state",
        ]

        logger.info(f"  Fixed beers column headers to: {list(dirty_df.columns)}")

        # Save updated files
        dirty_df.to_csv(split_dir / "dirty.csv", index=False)

    # Fix flights datasets (already consistent, but verify)
    for split_num in range(1, 4):
        split_dir = output_dir / f"flights_split_{split_num}"

        logger.info(f"Processing flights split {split_num}")

        clean_df = pd.read_csv(split_dir / "clean.csv")
        dirty_df = pd.read_csv(split_dir / "dirty.csv")

        logger.info(f"  Clean columns: {list(clean_df.columns)}")
        logger.info(f"  Dirty columns: {list(dirty_df.columns)}")

        if list(clean_df.columns) == list(dirty_df.columns):
            logger.info("  Flights columns already consistent")
        else:
            logger.info("  Making flights columns consistent")
            dirty_df.columns = clean_df.columns
            dirty_df.to_csv(split_dir / "dirty.csv", index=False)

    # Fix hospital datasets and remove phone column
    for split_num in [1, 2]:  # Only existing splits
        split_dir = output_dir / f"hospital_split_{split_num}"

        logger.info(f"Processing hospital split {split_num}")

        clean_df = pd.read_csv(split_dir / "clean.csv")
        dirty_df = pd.read_csv(split_dir / "dirty.csv")

        logger.info(f"  Original clean columns: {list(clean_df.columns)}")
        logger.info(f"  Original dirty columns: {list(dirty_df.columns)}")

        # Remove phone/PhoneNumber columns
        if "PhoneNumber" in clean_df.columns:
            clean_df = clean_df.drop("PhoneNumber", axis=1)
            logger.info("  Removed PhoneNumber from clean.csv")

        if "phone" in dirty_df.columns:
            dirty_df = dirty_df.drop("phone", axis=1)
            logger.info("  Removed phone from dirty.csv")

        # Make column names consistent (use clean names)
        # Current: clean=['HospitalName', 'CountyName', 'City', 'HospitalType']
        # Current: dirty=['name', 'county', 'city', 'type']
        dirty_df.columns = ["HospitalName", "CountyName", "City", "HospitalType"]

        logger.info(f"  Final hospital columns: {list(clean_df.columns)}")

        # Save updated files
        clean_df.to_csv(split_dir / "clean.csv", index=False)
        dirty_df.to_csv(split_dir / "dirty.csv", index=False)

        logger.info(
            f"  Hospital split {split_num}: Now has {len(clean_df.columns)} columns"
        )


def main():
    logger.info("Standardizing column headers and removing phone column...")
    fix_column_headers()
    logger.info("Done!")


if __name__ == "__main__":
    main()
