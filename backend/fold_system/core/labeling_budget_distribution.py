import logging
import math
from typing import Dict, List

import pandas as pd
from backend.fold_system.core.cell import Cell


class LabelingBudgetDistributor:
    """Distributes labeling budget across quality clusters"""

    def __init__(self, labeling_budget: int, min_labels_per_cluster: int = 1):
        self.labeling_budget = labeling_budget
        self.min_labels_per_cluster = min_labels_per_cluster

    def distribute_budget(
        self, quality_groups: Dict[str, Dict[str, List[Cell]]]
    ) -> Dict[str, Dict[str, int]]:
        """Distribute labeling budget across domains and quality clusters"""

        # Calculate cluster sizes for all domains and quality groups
        cluster_sizes = []
        for domain_name, quality_clusters in quality_groups.items():
            for quality_name, cells in quality_clusters.items():
                cluster_info = {
                    "domain": domain_name,
                    "quality_cluster": quality_name,
                    "n_cells": len(cells),
                    "error_rate": sum(1 for cell in cells if cell.is_error) / len(cells)
                    if cells
                    else 0,
                }
                cluster_sizes.append(cluster_info)

        if not cluster_sizes:
            return {}

        # Create DataFrame for budget distribution
        cluster_sizes_df = pd.DataFrame(cluster_sizes)

        labeled_df = self._get_n_labels(
            cluster_sizes_df, self.labeling_budget, self.min_labels_per_cluster
        )

        budget_distribution = {}
        for _, row in labeled_df.iterrows():
            domain = row["domain"]
            quality_cluster = row["quality_cluster"]
            n_labels = row["n_labels"]

            if domain not in budget_distribution:
                budget_distribution[domain] = {}
            budget_distribution[domain][quality_cluster] = n_labels

        total_assigned = sum(
            sum(cluster_budgets.values())
            for cluster_budgets in budget_distribution.values()
        )
        logging.info(
            f"Distributed {total_assigned}/{self.labeling_budget} labels across clusters"
        )

        return budget_distribution

    def _get_n_labels(
        self,
        cluster_sizes_df: pd.DataFrame,
        labeling_budget: int,
        min_num_labels_per_cluster: int,
    ):
        # Initialize with minimum labels per cluster
        cluster_sizes_df["n_labels"] = cluster_sizes_df.apply(
            lambda x: min(min_num_labels_per_cluster, x["n_cells"]), axis=1
        )
        cluster_sizes_df["sampled"] = cluster_sizes_df.apply(lambda x: False, axis=1)

        used_labels = cluster_sizes_df["n_labels"].sum()
        num_total_cells = cluster_sizes_df["n_cells"].sum()

        # Distribute remaining labels proportionally
        if labeling_budget > used_labels:
            remaining_labels = labeling_budget - used_labels
            cluster_sizes_df["n_labels"] = cluster_sizes_df.apply(
                lambda x: x["n_labels"]
                + math.floor(
                    min(
                        x["n_cells"] - x["n_labels"],
                        (x["n_cells"] / num_total_cells) * remaining_labels,
                    )
                ),
                axis=1,
            )

        i = 0
        j = 0
        cluster_sizes_df.sort_values(by=["n_cells"], ascending=False, inplace=True)

        while labeling_budget > cluster_sizes_df["n_labels"].sum() and j < len(
            cluster_sizes_df
        ):
            if (
                cluster_sizes_df["n_labels"].iloc[i]
                < cluster_sizes_df["n_cells"].iloc[i]
            ):
                cluster_sizes_df.loc[cluster_sizes_df.index[i], "n_labels"] += 1
                j = 0
            else:
                j += 1

            if i < len(cluster_sizes_df) - 1:
                i += 1
            else:
                i = 0

        return cluster_sizes_df
