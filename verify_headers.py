#!/usr/bin/env python3
"""
Script to verify column headers are consistent across all datasets
"""

import logging
from pathlib import Path

import pandas as pd

# Set up logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def verify_headers():
    """Verify that all column headers are consistent"""
    output_dir = Path(
        "/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM_small_sampled"
    )

    logger.info("Verifying column headers consistency...")

    # Check beers datasets
    logger.info("\n=== BEERS DATASETS ===")
    for split_num in range(1, 4):
        split_dir = output_dir / f"beers_split_{split_num}"

        clean_df = pd.read_csv(split_dir / "clean.csv")
        dirty_df = pd.read_csv(split_dir / "dirty.csv")

        logger.info(f"Beers split {split_num}:")
        logger.info(f"  Clean columns: {list(clean_df.columns)}")
        logger.info(f"  Dirty columns: {list(dirty_df.columns)}")
        logger.info(f"  Match: {list(clean_df.columns) == list(dirty_df.columns)}")

    # Check flights datasets
    logger.info("\n=== FLIGHTS DATASETS ===")
    for split_num in range(1, 4):
        split_dir = output_dir / f"flights_split_{split_num}"

        clean_df = pd.read_csv(split_dir / "clean.csv")
        dirty_df = pd.read_csv(split_dir / "dirty.csv")

        logger.info(f"Flights split {split_num}:")
        logger.info(f"  Clean columns: {list(clean_df.columns)}")
        logger.info(f"  Dirty columns: {list(dirty_df.columns)}")
        logger.info(f"  Match: {list(clean_df.columns) == list(dirty_df.columns)}")

    # Check hospital datasets
    logger.info("\n=== HOSPITAL DATASETS ===")
    for split_num in [1, 2]:
        split_dir = output_dir / f"hospital_split_{split_num}"

        clean_df = pd.read_csv(split_dir / "clean.csv")
        dirty_df = pd.read_csv(split_dir / "dirty.csv")

        logger.info(f"Hospital split {split_num}:")
        logger.info(f"  Clean columns: {list(clean_df.columns)}")
        logger.info(f"  Dirty columns: {list(dirty_df.columns)}")
        logger.info(f"  Match: {list(clean_df.columns) == list(dirty_df.columns)}")
        logger.info(
            f"  Phone column removed: {'PhoneNumber' not in clean_df.columns and 'phone' not in dirty_df.columns}"
        )


def main():
    verify_headers()


if __name__ == "__main__":
    main()
