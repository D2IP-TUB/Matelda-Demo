import json
import os
import time

import pandas as pd
import streamlit as st

# Set the page title and layout
st.set_page_config(page_title="Domain Based Folding", layout="wide")
st.title("Domain Based Folding")

# Hide default Streamlit menu
st.markdown(
    """
    <style>
        [data-testid="stSidebarNav"] {display: none;}
    </style>
    """,
    unsafe_allow_html=True,
)

# Sidebar navigation
with st.sidebar:
    st.page_link("app.py", label="Matelda")
    st.page_link("pages/Configurations.py", label="Configurations")
    st.page_link("pages/DomainBasedFolding.py", label="Domain Based Folding")
    st.page_link("pages/QualityBasedFolding.py", label="Quality Based Folding")
    st.page_link("pages/Labeling.py", label="Labeling")
    st.page_link("pages/ErrorDetection.py", label="Error Detection")
    st.page_link("pages/Results.py", label="Results")

# 🔄 Load dataset from pipeline config if not already in session_state
if "dataset_select" not in st.session_state and "pipeline_path" in st.session_state:
    config_path = os.path.join(st.session_state.pipeline_path, "configurations.json")
    if os.path.exists(config_path):
        with open(config_path) as f:
            config = json.load(f)
        st.session_state["dataset_select"] = config.get("selected_dataset", "Quintet")

selected_dataset = st.session_state.get("dataset_select", "demo")
datasets_path = os.path.join(os.path.dirname(__file__), "../datasets", selected_dataset)

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

# If table_locations is not already set (either from configuration or a previous run), assign tables randomly.
if "table_locations" not in st.session_state:
    tables = [
        f
        for f in os.listdir(datasets_path)
        if os.path.isdir(os.path.join(datasets_path, f))
    ]
    folds = ["Chess-A", "Chess-B", "Pokémon"]
    df_dict = {
        "Chess_com_1": "Chess-A",
        "Chess_com_2": "Chess-A",
        "Lichess_1": "Chess-A",
        "Lichess_2": "Chess-B",
        "Pokémon_1": "Pokémon",
        "Pokémon_2": "Pokémon",
    }
    st.session_state.table_locations = df_dict

if "merge_mode" not in st.session_state:
    st.session_state.merge_mode = False
if "selected_folds" not in st.session_state:
    st.session_state.selected_folds = []
if "global_split_mode" not in st.session_state:
    st.session_state.global_split_mode = False
if "selected_split_tables" not in st.session_state:
    st.session_state.selected_split_tables = {}


# Function to load the "clean.csv" file for a given table (i.e. subfolder)
def load_clean_table(table_name):
    file_path = os.path.join(datasets_path, table_name, "dirty.csv")
    try:
        df = pd.read_csv(file_path)
    except Exception as e:
        df = pd.DataFrame({"Error": [f"Could not load {file_path}: {e}"]})
    return df


# Button to start domain folding
if st.button("▶️ Run Domain Based Folding"):
    with st.spinner("🔄 Processing... Please wait..."):
        time.sleep(2)
    st.session_state.run_folding = True

if st.session_state.get("run_folding"):
    st.markdown("---")

    # Group tables by their assigned fold
    domain_folds = {}
    for table, fold in st.session_state.table_locations.items():
        domain_folds.setdefault(fold, []).append(table)

    # HEADER: Global action buttons for merging and splitting folds
    header_cols = st.columns([4, 1, 1])
    header_cols[0].markdown("**Fold / Table**")
    if header_cols[1].button("Merge Folds", key="global_merge_button"):
        st.info(
            "Merge Folds: Combine multiple domain folds into one. Select the folds you wish to merge, and all tables from those folds will be grouped under a single fold.",
            icon="ℹ️",
        )
        st.session_state.merge_mode = True
        st.session_state.selected_folds = []
    if header_cols[2].button("Split Folds", key="global_split_button"):
        st.info(
            "Split Folds: Divide a domain fold into separate folds. Choose the tables at which you want the split to occur; the folds will be split immediately below the selected tables, separating the tables into multiple groups.",
            icon="ℹ️",
        )
        st.session_state.global_split_mode = True
        st.session_state.selected_split_tables = {}

    st.markdown("---")

    # Iterate over each fold and display the tables
    for fold_name, tables in domain_folds.items():
        fold_cols = st.columns([4, 1, 1])
        fold_cols[0].markdown(f"**{fold_name}**")
        if st.session_state.merge_mode:
            merge_selected = fold_cols[1].checkbox(
                "Merge", key=f"merge_{fold_name}", label_visibility="hidden"
            )
            if merge_selected and fold_name not in st.session_state.selected_folds:
                st.session_state.selected_folds.append(fold_name)
            elif not merge_selected and fold_name in st.session_state.selected_folds:
                st.session_state.selected_folds.remove(fold_name)
        else:
            fold_cols[1].empty()
        fold_cols[2].empty()

        # Display each table within the fold
        for table in tables:
            table_cols = st.columns([4, 1, 1])
            with table_cols[0].expander(f"📊 {table}"):
                df = load_clean_table(table)
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
            table_cols[1].empty()
            if st.session_state.global_split_mode:
                split_selected = table_cols[2].checkbox(
                    "Split here",
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
                table_cols[2].empty()

    st.markdown("---")

    # Global Confirm Merge: if merge mode is active and more than one fold is selected.
    if st.session_state.merge_mode and len(st.session_state.selected_folds) > 1:
        merge_confirm_cols = st.columns([4, 1, 1])
        if merge_confirm_cols[1].button("Confirm Merge", key="confirm_merge"):
            target_fold = st.session_state.selected_folds[0]
            for fold in st.session_state.selected_folds[1:]:
                for table in domain_folds.get(fold, []):
                    st.session_state.table_locations[table] = target_fold
            st.session_state.selected_folds = []
            st.session_state.merge_mode = False
            st.rerun()
        st.markdown("---")

    # Global Confirm Split: if split mode is active and at least one table is selected.
    if st.session_state.global_split_mode:
        any_split = any(
            st.session_state.selected_split_tables.get(fold, [])
            for fold in st.session_state.selected_split_tables
        )
        if any_split:
            split_confirm_cols = st.columns([4, 1, 1])
            if split_confirm_cols[2].button("Confirm Split", key="confirm_split"):
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

    # Button to save the current domain fold structure to the pipeline's configurations.json file.
    if st.button("Save Domain Folds"):
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
            print("Domain folds to save:", domain_folds_to_save)
            pipeline_config["domain_folds"] = domain_folds_to_save
            with open(pipeline_config_path, "w") as f:
                json.dump(pipeline_config, f, indent=4)
            st.success("Domain folds saved to pipeline configurations!")
        else:
            st.warning("No pipeline selected; domain folds not saved.")

    if st.button("Next"):
        st.switch_page("pages/QualityBasedFolding.py")
