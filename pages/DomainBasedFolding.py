import json
import os
import time

import pandas as pd
import streamlit as st
from backend import backend_dbf
from components import (
    apply_base_styles,
    apply_folding_styles,
    render_inline_restart_button,
    render_sidebar,
)

# Set the page title and layout
st.set_page_config(page_title="Domain Based Folding", layout="wide")
st.title("Domain Based Folding")

# Apply global styles and sidebar
apply_base_styles()
apply_folding_styles()
render_sidebar()

# 🔄 Load dataset from pipeline config if not already in session_state
# Load the dataset from the pipeline configuration if available
if "dataset_select" not in st.session_state and "pipeline_path" in st.session_state:
    config_path = os.path.join(st.session_state.pipeline_path, "configurations.json")
    if os.path.exists(config_path):
        with open(config_path) as f:
            config = json.load(f)
        selected = config.get("selected_dataset")
        if selected:
            st.session_state["dataset_select"] = selected

# If we still don't have a dataset configured, show a warning and redirect option
if "dataset_select" not in st.session_state:
    st.warning("⚠️ Dataset not configured.")
    if st.button("Go back to Configurations"):
        st.switch_page("pages/Configurations.py")
    st.stop()

selected_dataset = st.session_state.dataset_select
# Use absolute path for datasets
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
datasets_path = os.path.join(root_dir, "datasets", selected_dataset)

# Load saved domain folds only if a pipeline is selected and table_locations is not already set.
if "pipeline_path" in st.session_state and "table_locations" not in st.session_state:
    pipeline_config_path = os.path.join(
        st.session_state.pipeline_path, "configurations.json"
    )
    if os.path.exists(pipeline_config_path):
        with open(pipeline_config_path, "r") as f:
            pipeline_config = json.load(f)
        if "domain_folds" in pipeline_config:
            saved_folds = pipeline_config["domain_folds"]
            # Convert the saved fold structure {fold: [table1, table2, ...]} into our internal mapping {table: fold}
            st.session_state.table_locations = {
                table: fold for fold, tables in saved_folds.items() for table in tables
            }

# Initialize session state variables
if "merge_mode" not in st.session_state:
    st.session_state.merge_mode = False
if "selected_folds" not in st.session_state:
    st.session_state.selected_folds = []
if "global_split_mode" not in st.session_state:
    st.session_state.global_split_mode = False
if "selected_split_tables" not in st.session_state:
    st.session_state.selected_split_tables = {}


# Function to load the "dirty.csv" file for a given table (i.e. subfolder)
def load_table(table_name):
    file_path = os.path.join(datasets_path, table_name, "dirty.csv")
    try:
        df = pd.read_csv(file_path)
    except Exception as e:
        df = pd.DataFrame({"Error": [f"Could not load {file_path}: {e}"]})
    return df


# Button to start domain folding
if st.button("▶️ Run Domain Based Folding"):
    with st.spinner("🔄 Processing... Please wait..."):
        # Call the backend function to get domain folds
        labeling_budget = st.session_state.get(
            "labeling_budget", 10
        )  # Default to 10 if not set
        result = backend_dbf(selected_dataset, labeling_budget)
        domain_folds = result["domain_folds"]

        # Convert domain folds to table_locations format
        st.session_state.table_locations = {
            table: fold for fold, tables in domain_folds.items() for table in tables
        }
        time.sleep(2)  # Keep a small delay for UX
    st.session_state.run_folding = True

if st.session_state.get("run_folding"):
    st.markdown("---")
    st.markdown("### Options / Actions")
    st.markdown('<div class="action-container">', unsafe_allow_html=True)
    action_cols = st.columns(2)
    if action_cols[0].button(
        "Merge Folds", key="global_merge_button", use_container_width=True
    ):
        st.info(
            "Merge Folds: Combine multiple domain folds into one. Select the folds you wish to merge, and all tables from those folds will be grouped under a single fold.",
            icon="ℹ️",
        )
        st.session_state.merge_mode = True
        st.session_state.global_split_mode = False
        st.session_state.selected_folds = []
    if action_cols[1].button(
        "Split Folds", key="global_split_button", use_container_width=True
    ):
        st.info(
            "Split Folds: Divide a domain fold into separate folds. Choose the tables at which you want the split to occur; the folds will be split immediately below the selected tables, separating the tables into multiple groups.",
            icon="ℹ️",
        )
        st.session_state.global_split_mode = True
        st.session_state.merge_mode = False
        st.session_state.selected_split_tables = {}
    st.markdown("</div>", unsafe_allow_html=True)

    st.markdown("---")
    st.markdown("### Folds / Tables")

    # Group tables by their assigned fold
    domain_folds = {}
    for table, fold in st.session_state.table_locations.items():
        domain_folds.setdefault(fold, []).append(table)

    header_cols = st.columns([4, 1])
    header_cols[0].markdown("**Fold / Table**")
    header_cols[1].markdown("**Select**")

    for fold_name, tables in domain_folds.items():
        fold_cols = st.columns([4, 1])
        fold_cols[0].markdown(f"**{fold_name}**")
        if st.session_state.merge_mode:
            merge_selected = fold_cols[1].checkbox(
                "Select fold", key=f"merge_{fold_name}", label_visibility="hidden"
            )
            if merge_selected and fold_name not in st.session_state.selected_folds:
                st.session_state.selected_folds.append(fold_name)
            elif not merge_selected and fold_name in st.session_state.selected_folds:
                st.session_state.selected_folds.remove(fold_name)
        else:
            fold_cols[1].empty()

        for table in tables:
            table_cols = st.columns([4, 1])
            with table_cols[0].expander(f"📊 {table}"):
                df = load_table(table)
                st.dataframe(df)
                new_location = st.radio(
                    f"Move {table} to:",
                    options=list(domain_folds.keys()),
                    index=list(domain_folds.keys()).index(
                        st.session_state.table_locations[table]
                    ),
                    key=f"move_{table}",
                )
                if new_location != st.session_state.table_locations[table]:
                    st.session_state.table_locations[table] = new_location
                    st.rerun()
            if st.session_state.global_split_mode:
                split_selected = table_cols[1].checkbox(
                    "Select table",
                    key=f"split_{fold_name}_{table}",
                    label_visibility="hidden",
                )
                if fold_name not in st.session_state.selected_split_tables:
                    st.session_state.selected_split_tables[fold_name] = []
                selected_tables = st.session_state.selected_split_tables[fold_name]
                if split_selected and table not in selected_tables:
                    selected_tables.append(table)
                    st.session_state.selected_split_tables[fold_name] = selected_tables
                elif not split_selected and table in selected_tables:
                    selected_tables.remove(table)
                    st.session_state.selected_split_tables[fold_name] = selected_tables
            else:
                table_cols[1].empty()

    # Global Confirm Merge: if merge mode is active and more than one fold is selected.
    if st.session_state.merge_mode and len(st.session_state.selected_folds) > 1:
        merge_confirm_cols = st.columns([4, 1])
        if merge_confirm_cols[1].button(
            "Confirm Merge", key="confirm_merge", use_container_width=True
        ):
            target_fold = st.session_state.selected_folds[0]
            for fold in st.session_state.selected_folds[1:]:
                for table in domain_folds.get(fold, []):
                    st.session_state.table_locations[table] = target_fold
            st.session_state.selected_folds = []
            st.session_state.merge_mode = False
            st.rerun()

    # Global Confirm Split: if split mode is active and at least one table is selected.
    if st.session_state.global_split_mode:
        any_split = any(
            st.session_state.selected_split_tables.get(fold, [])
            for fold in st.session_state.selected_split_tables
        )
        if any_split:
            split_confirm_cols = st.columns([4, 1])
            if split_confirm_cols[1].button(
                "Confirm Split", key="confirm_split", use_container_width=True
            ):
                for (
                    fold_name,
                    selected_tables,
                ) in st.session_state.selected_split_tables.items():
                    if selected_tables:
                        tables_in_fold = domain_folds.get(fold_name, [])
                        indices = sorted(
                            [
                                tables_in_fold.index(t)
                                for t in selected_tables
                                if t in tables_in_fold
                            ]
                        )
                        new_folds = []
                        prev_idx = 0
                        for idx in indices:
                            new_fold_name = f"{fold_name} - Split {len(domain_folds) + len(new_folds) + 1}"
                            new_folds.append(new_fold_name)
                            for t in tables_in_fold[prev_idx : idx + 1]:
                                st.session_state.table_locations[t] = new_fold_name
                            prev_idx = idx + 1
                        if prev_idx < len(tables_in_fold):
                            new_fold_name = f"{fold_name} - Split {len(domain_folds) + len(new_folds) + 1}"
                            for t in tables_in_fold[prev_idx:]:
                                st.session_state.table_locations[t] = new_fold_name
                st.session_state.global_split_mode = False
                st.session_state.selected_split_tables = {}
                st.rerun()
            st.markdown("---")

    # Navigation row: Restart | Back | Next
    st.markdown("---")
    nav_cols = st.columns([1, 1, 1], gap="small")

    # Restart: confirmation dialog to go to app.py
    with nav_cols[0]:
        render_inline_restart_button(
            page_id="domain_based_folding", use_container_width=True
        )

    # Back: to Configurations
    if nav_cols[1].button("Back", key="dbf_back", use_container_width=True):
        st.switch_page("pages/Configurations.py")

    # Next: Save and Continue
    if nav_cols[2].button("Next", key="dbf_next", use_container_width=True):
        if "pipeline_path" in st.session_state:
            pipeline_config_path = os.path.join(
                st.session_state.pipeline_path, "configurations.json"
            )
            if os.path.exists(pipeline_config_path):
                with open(pipeline_config_path, "r") as f:
                    pipeline_config = json.load(f)
            else:
                pipeline_config = {}
            domain_folds_to_save = {}
            for table, fold in st.session_state.table_locations.items():
                domain_folds_to_save.setdefault(fold, []).append(table)
            pipeline_config["domain_folds"] = domain_folds_to_save
            with open(pipeline_config_path, "w") as f:
                json.dump(pipeline_config, f, indent=4)
            st.success("Domain folds saved to pipeline configurations!")
        else:
            st.warning("No pipeline selected; domain folds not saved.")
        st.switch_page("pages/QualityBasedFolding.py")
