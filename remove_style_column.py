#!/usr/bin/env python3
"""
Script to remove the 'style' column from beers datasets
"""

import logging
from pathlib import Path

import pandas as pd

# Set up logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def remove_style_column_from_beers():
    """Remove the style column from all beers splits"""
    output_dir = Path(
        "/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM_small_sampled"
    )

    for split_num in range(1, 4):
        split_dir = output_dir / f"beers_split_{split_num}"

        logger.info(f"Processing beers split {split_num}")

        # Process clean file
        clean_path = split_dir / "clean.csv"
        clean_df = pd.read_csv(clean_path)

        # Remove style column if it exists
        if "style" in clean_df.columns:
            clean_df = clean_df.drop("style", axis=1)
            logger.info("  Removed 'style' column from clean.csv")

        # Process dirty file
        dirty_path = split_dir / "dirty.csv"
        dirty_df = pd.read_csv(dirty_path)

        # Remove style column if it exists
        if "style" in dirty_df.columns:
            dirty_df = dirty_df.drop("style", axis=1)
            logger.info("  Removed 'style' column from dirty.csv")

        # Save updated files
        clean_df.to_csv(clean_path, index=False)
        dirty_df.to_csv(dirty_path, index=False)

        logger.info(
            f"  Beers split {split_num}: Now has {len(clean_df.columns)} columns"
        )
        logger.info(f"  Columns: {list(clean_df.columns)}")


def main():
    logger.info("Removing 'style' column from beers datasets...")
    remove_style_column_from_beers()
    logger.info("Done!")


if __name__ == "__main__":
    main()
