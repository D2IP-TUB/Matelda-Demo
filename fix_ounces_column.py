#!/usr/bin/env python3
"""
Script to fix the ounces column in dirty beers datasets by replacing with clean ground truth values
"""

import logging
from pathlib import Path

import pandas as pd

# Set up logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def fix_ounces_column_in_beers():
    """Fix the ounces column in dirty beers datasets by using clean ground truth values"""
    output_dir = Path(
        "/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM_small_sampled"
    )

    for split_num in range(1, 4):
        split_dir = output_dir / f"beers_split_{split_num}"

        logger.info(f"Processing beers split {split_num}")

        # Read clean and dirty files
        clean_path = split_dir / "clean.csv"
        dirty_path = split_dir / "dirty.csv"

        clean_df = pd.read_csv(clean_path)
        dirty_df = pd.read_csv(dirty_path)

        if "ounces" in clean_df.columns and "ounces" in dirty_df.columns:
            # Show some examples of current dirty ounces values
            logger.info(
                f"  Current dirty ounces examples: {dirty_df['ounces'].head(3).tolist()}"
            )
            logger.info(
                f"  Clean ounces examples: {clean_df['ounces'].head(3).tolist()}"
            )

            # Replace dirty ounces column with clean ground truth values
            dirty_df["ounces"] = clean_df["ounces"].copy()

            logger.info("  Fixed ounces column with ground truth values")
            logger.info(
                f"  New dirty ounces examples: {dirty_df['ounces'].head(3).tolist()}"
            )

            # Save updated dirty file
            dirty_df.to_csv(dirty_path, index=False)

            logger.info(f"  Updated dirty.csv for split {split_num}")
        else:
            logger.warning(f"  'ounces' column not found in split {split_num}")


def main():
    logger.info(
        "Fixing ounces column in dirty beers datasets with ground truth values..."
    )
    fix_ounces_column_in_beers()
    logger.info(
        "Done! Ounces column now contains clean ground truth values in all dirty datasets."
    )


if __name__ == "__main__":
    main()
