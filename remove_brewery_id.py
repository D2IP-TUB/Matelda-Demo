#!/usr/bin/env python3
"""
Script to remove the 'brewery_id' column from beers datasets
"""

import logging
from pathlib import Path

import pandas as pd

# Set up logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def remove_brewery_id_column_from_beers():
    """Remove the brewery_id column from all beers splits"""
    output_dir = Path(
        "/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM_small_sampled"
    )

    for split_num in range(1, 4):
        split_dir = output_dir / f"beers_split_{split_num}"

        logger.info(f"Processing beers split {split_num}")

        # Process clean file
        clean_path = split_dir / "clean.csv"
        clean_df = pd.read_csv(clean_path)

        # Remove brewery_id column if it exists
        if "brewery_id" in clean_df.columns:
            clean_df = clean_df.drop("brewery_id", axis=1)
            logger.info("  Removed 'brewery_id' column from clean.csv")

        # Process dirty file
        dirty_path = split_dir / "dirty.csv"
        dirty_df = pd.read_csv(dirty_path)

        # Remove brewery_id column if it exists
        if "brewery_id" in dirty_df.columns:
            dirty_df = dirty_df.drop("brewery_id", axis=1)
            logger.info("  Removed 'brewery_id' column from dirty.csv")

        # Save updated files
        clean_df.to_csv(clean_path, index=False)
        dirty_df.to_csv(dirty_path, index=False)

        logger.info(
            f"  Beers split {split_num}: Now has {len(clean_df.columns)} columns"
        )
        logger.info(f"  Columns: {list(clean_df.columns)}")


def main():
    logger.info("Removing 'brewery_id' column from beers datasets...")
    remove_brewery_id_column_from_beers()
    logger.info("Done!")


if __name__ == "__main__":
    main()
