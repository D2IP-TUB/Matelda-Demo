#!/usr/bin/env python3
"""
Script to selectively fix some ounces errors while keeping others for more realistic error distribution
"""

import logging
import re
from pathlib import Path

import pandas as pd

# Set up logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def selectively_fix_ounces_column():
    """Selectively fix some ounces errors while keeping others for realistic error distribution"""
    output_dir = Path(
        "/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM_small_sampled"
    )

    # Patterns to fix (replace with clean values)
    patterns_to_fix = [
        r"ounce",  # Fix "16.0 ounce" type errors
        r"OZ\.",  # Fix "19.2 OZ." type errors
        r"oz\. Alumi-Tek",  # Fix specific branded errors
    ]

    # Patterns to keep (leave as errors)
    patterns_to_keep = [
        r"^\d+\.\d+ oz$",  # Keep "12.0 oz"
        r"^\d+\.\d+ oz\.$",  # Keep "12.0 oz."
    ]

    for split_num in range(1, 4):
        split_dir = output_dir / f"beers_split_{split_num}"

        logger.info(f"Processing beers split {split_num}")

        # Read clean and dirty files
        clean_path = split_dir / "clean.csv"
        dirty_path = split_dir / "dirty.csv"

        clean_df = pd.read_csv(clean_path)
        dirty_df = pd.read_csv(dirty_path)

        if "ounces" in clean_df.columns and "ounces" in dirty_df.columns:
            original_dirty_values = dirty_df["ounces"].copy()

            logger.info(
                f"  Original dirty ounces examples: {original_dirty_values.head(5).tolist()}"
            )

            fixes_made = 0
            kept_errors = 0

            for idx in range(len(dirty_df)):
                dirty_value = str(dirty_df.loc[idx, "ounces"])
                clean_value = clean_df.loc[idx, "ounces"]

                # Check if this should be fixed
                should_fix = False
                for pattern in patterns_to_fix:
                    if re.search(pattern, dirty_value):
                        should_fix = True
                        break

                # Check if this should be kept as error
                should_keep = False
                for pattern in patterns_to_keep:
                    if re.search(pattern, dirty_value):
                        should_keep = True
                        break

                if should_fix and not should_keep:
                    dirty_df.loc[idx, "ounces"] = clean_value
                    fixes_made += 1
                elif should_keep or any(
                    pattern in dirty_value for pattern in ["oz", "OZ"]
                ):
                    kept_errors += 1

            logger.info(f"  Fixed {fixes_made} values with clean ground truth")
            logger.info(f"  Kept {kept_errors} values as realistic errors")
            logger.info(
                f"  Updated dirty ounces examples: {dirty_df['ounces'].head(5).tolist()}"
            )

            # Save updated dirty file
            dirty_df.to_csv(dirty_path, index=False)

            logger.info(f"  Updated dirty.csv for split {split_num}")
        else:
            logger.warning(f"  'ounces' column not found in split {split_num}")


def main():
    logger.info(
        "Selectively fixing ounces column errors while keeping realistic error patterns..."
    )
    selectively_fix_ounces_column()
    logger.info("Done! Mixed clean and error values for more realistic dataset.")


if __name__ == "__main__":
    main()
