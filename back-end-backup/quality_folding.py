import logging
import os

import streamlit as st
from Matelda.marshmallow_pipeline.cell_grouping_module.generate_cell_features import (
    get_cells_features,
)

from backend.cache_utils import exists_in_cache, load_from_cache, save_to_cache


def generate_cell_features(
    dataset,
    output_path,
):
    logging.info("Starting cell feature generation and clustering")
    logging.info("Generating cell features")
    current_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(
        current_dir
    )  # Go up one level since we're in backend/ folder
    datasets_path = os.path.join(root_dir, "datasets", dataset)

    if not os.path.exists(datasets_path):
        print(f"Dataset path does not exist: {datasets_path}")
        return {"domain_folds": {}}

    logging.info("Generating cell features enabled")

    pipeline_name = os.path.basename(st.session_state.get("pipeline_path", ""))
    if exists_in_cache(pipeline_name, "features_dict.pkl") and exists_in_cache(
        pipeline_name, "tables_tuples_dict.pkl"
    ):
        logging.info("Loading features_dict from cache")
        features_dict = load_from_cache(pipeline_name, "features_dict.pkl")
        tables_tuples_dict = load_from_cache(pipeline_name, "tables_tuples_dict.pkl")
    else:
        logging.info("Generating features_dict")
        features_dict, tables_tuples_dict = get_cells_features(
            datasets_path, output_path
        )
        save_to_cache(pipeline_name, features_dict, "features_dict.pkl")
        save_to_cache(pipeline_name, tables_tuples_dict, "tables_tuples_dict.pkl")
    return features_dict, tables_tuples_dict

    # logging.info("Selecting label")
    # cluster_sizes_df = pd.DataFrame.from_dict(cluster_sizes_dict)
    # df_n_labels = get_n_labels(
    #     cluster_sizes_df,
    #     labeling_budget=n_labels,
    #     min_num_labes_per_col_cluster=min_num_labes_per_col_cluster,
    # )

    # if not cell_clustering_res_available:
    #     logging.info("Cell Clustering")
    #     start_time = time.time()
    #     col_group_file_names = [
    #         file_name
    #         for file_name in os.listdir(col_groups_dir)
    #         if ".pickle" in file_name
    #     ]
    #     n_processes = min((len(col_group_file_names), os.cpu_count()))
    #     # logging.debug("Number of processes: %s", str(n_processes))

    #     table_clusters = []
    #     cell_cluster_cells_dict_all = {}
    #     cell_clustering_dict_all = {}
    #     col_clusters = []
    #     logging.info("Number of column groups: %s", str(len(col_group_file_names)))
    #     logging.info("Starting parallel processing of column groups")
    #     # Prepare the arguments as tuples
    #     args = [(x, n_cores) for x in col_group_file_names]
    #     logging.debug("args: %s", str(args))
    #     # Use starmap to pass arguments as separate values
    #     results = []
    #     for x in col_group_file_names:
    #         results.append(
    #             cluster_column_group(
    #                 col_groups_dir,
    #                 df_n_labels,
    #                 features_dict,
    #                 labels_per_cell_group,
    #                 x,
    #                 n_cores,
    #             )
    #         )
    #     logging.info("Storing cluster_column_group results")
    #     for result in results:
    #         if result is not None:
    #             table_clusters.append(result["table_cluster"])
    #             cell_cluster_cells_dict_all.update(
    #                 result["cell_cluster_cells_dict_all"]
    #             )
    #             cell_clustering_dict_all.update(result["cell_clustering_dict_all"])
    #             col_clusters.append(result["col_clusters"])

    #     all_cell_clusters_records = []
    #     for table_group in cell_clustering_dict_all:
    #         for col_group in cell_clustering_dict_all[table_group]:
    #             all_cell_clusters_records.append(
    #                 cell_clustering_dict_all[table_group][col_group]
    #             )

    #     all_cell_clusters_records = update_n_labels(all_cell_clusters_records)
    #     cell_clustering_dir = os.path.join(output_path, "cell_clustering")
    #     end_time = time.time()
    #     logging.info("Cell Clustering took %s seconds", str(end_time - start_time))
    #     if save_mediate_res_on_disk:
    #         logging.info("Saving cell clustering results")
    #         if not os.path.exists(cell_clustering_dir):
    #             os.makedirs(cell_clustering_dir)
    #         with open(
    #             os.path.join(cell_clustering_dir, "all_cell_clusters_records.pickle"),
    #             "wb",
    #         ) as pickle_file:
    #             pickle.dump(all_cell_clusters_records, pickle_file)
    #         with open(
    #             os.path.join(cell_clustering_dir, "cell_cluster_cells_dict_all.pickle"),
    #             "wb",
    #         ) as pickle_file:
    #             pickle.dump(cell_cluster_cells_dict_all, pickle_file)
    # else:
    #     logging.info("Loading cell clustering results from disk")
    #     with open(
    #         os.path.join(
    #             output_path, "cell_clustering", "all_cell_clusters_records.pickle"
    #         ),
    #         "rb",
    #     ) as pickle_file:
    #         all_cell_clusters_records = pickle.load(pickle_file)
    #     with open(
    #         os.path.join(
    #             output_path, "cell_clustering", "cell_cluster_cells_dict_all.pickle"
    #         ),
    #         "rb",
    #     ) as pickle_file:
    #         cell_cluster_cells_dict_all = pickle.load(pickle_file)
