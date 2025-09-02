#!/usr/bin/env python3
"""
Check for errors in the style column of beers datasets
"""

from pathlib import Path

import pandas as pd


def check_style_errors():
    output_dir = Path(
        "/home/fatemeh/matelda-demo/Matelda-Demo/datasets/QRM_small_sampled"
    )

    for split_num in range(1, 4):
        split_dir = output_dir / f"beers_split_{split_num}"

        print(f"\n=== Beers Split {split_num} ===")

        clean_df = pd.read_csv(split_dir / "clean.csv")
        dirty_df = pd.read_csv(split_dir / "dirty.csv")

        if "style" in clean_df.columns and "style" in dirty_df.columns:
            # Compare style columns
            style_differences = clean_df["style"] != dirty_df["style"]
            num_differences = style_differences.sum()

            print(
                f"Style column differences: {num_differences} out of {len(clean_df)} rows"
            )

            if num_differences > 0:
                print("Examples of differences:")
                diff_indices = style_differences[style_differences].index[:5]
                for idx in diff_indices:
                    print(f"  Row {idx}:")
                    print(f"    Clean: {clean_df.loc[idx, 'style']}")
                    print(f"    Dirty: {dirty_df.loc[idx, 'style']}")
            else:
                print("No differences found in style column")

            # Show some examples of style values
            print(f"Sample clean style values: {clean_df['style'].head(3).tolist()}")
            print(f"Sample dirty style values: {dirty_df['style'].head(3).tolist()}")
        else:
            print("Style column not found")


if __name__ == "__main__":
    check_style_errors()
