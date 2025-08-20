import json
import logging
import os
import time
from typing import Any, Dict, List

import streamlit as st
from backend import backend_label_propagation, backend_sample_labeling
from components import apply_base_styles, get_datasets_path, render_sidebar
from components.restart import render_inline_restart_button
from streamlit_swipecards import streamlit_swipecards

# Page setup
st.set_page_config(page_title="Labeling", layout="wide")
st.title("Labeling")

# Apply base styles
apply_base_styles()

# Sidebar navigation
render_sidebar()

# Load dataset from pipeline config if not already in session_state
# Load dataset from pipeline configuration if available
if "dataset_select" not in st.session_state and "pipeline_path" in st.session_state:
    cfg_path = os.path.join(st.session_state.pipeline_path, "configurations.json")
    if os.path.exists(cfg_path):
        with open(cfg_path) as f:
            cfg = json.load(f)
        selected = cfg.get("selected_dataset")
        labeling_budget = cfg.get("labeling_budget", 10)
        if selected:
            st.session_state.dataset_select = selected
            st.session_state["budget_slider"] = labeling_budget

# If dataset remains undefined, warn user and provide a navigation button
if "dataset_select" not in st.session_state:
    st.warning("⚠️ Dataset not configured.")
    if st.button("Go back to Configurations"):
        st.switch_page("pages/Configurations.py")
    st.stop()

dataset = st.session_state.dataset_select


def make_card(cell: Dict[str, Any]) -> Dict[str, Any]:
    """Return a table-mode card configuration for streamlit-swipecards."""

    datasets_path = get_datasets_path(dataset)
    dataset_path = os.path.join(datasets_path, cell["table"], "dirty.csv")

    row = int(cell.get("row", 0))
    column = cell.get("col", "")

    return {
        "dataset_path": dataset_path,
        "row_index": row,
        "name": cell.get("name", ""),
        "description": f"Value: {cell.get('val', '')}",
        "highlight_cells": [{"row": row, "column": column}],
        "highlight_rows": [{"row": row}],
        "highlight_columns": [{"column": column}],
        "center_table_row": row,
        "center_table_column": column,
        "pills": cell.get("strategies", []),
    }


if "run_quality_folding" not in st.session_state:
    st.session_state.run_quality_folding = False

if not st.session_state.run_quality_folding:
    if st.button("Run Labeling"):
        with st.spinner("🔄 Processing... Please wait..."):
            labeling_budget = st.session_state.get("budget_slider", 10)
            cell_folds = st.session_state.get("cell_folds", {})
            domain_folds = st.session_state.get("domain_folds", {})
            sampled_cells = backend_sample_labeling(
                selected_dataset=dataset,
                labeling_budget=labeling_budget,
                cell_folds=cell_folds,
                domain_folds=domain_folds,
            )
            st.session_state.sampled_cells = sampled_cells
            time.sleep(2)
        st.session_state.run_quality_folding = True
        st.rerun()
else:
    # Quality-based folding already completed but sampling might be missing
    if "sampled_cells" not in st.session_state:
        with st.spinner("🔄 Processing... Please wait..."):
            labeling_budget = st.session_state.get("budget_slider", 10)
            cell_folds = st.session_state.get("cell_folds", {})
            domain_folds = st.session_state.get("domain_folds", {})
            sampled_cells = backend_sample_labeling(
                selected_dataset=dataset,
                labeling_budget=labeling_budget,
                cell_folds=cell_folds,
                domain_folds=domain_folds,
            )
            st.session_state.sampled_cells = sampled_cells

if st.session_state.run_quality_folding:
    cards: List[Dict[str, Any]] = st.session_state.get("sampled_cells", [])
    card_data = [c for c in (make_card(card) for card in cards) if c]

    st.info("Swipe left to mark as error, swipe right to mark as correct.")

    results = streamlit_swipecards(
        cards=card_data, display_mode="table", key="labeling_cards"
    )

    if "labeling_results" not in st.session_state:
        st.session_state.labeling_results = {}

    if results and results.get("swipedCards"):
        for swipe in results.get("swipedCards", []):
            idx = swipe.get("index")
            action = swipe.get("action")
            if idx is not None and action in {"left", "right"} and idx < len(cards):
                card_id = cards[idx]["id"]
                st.session_state.labeling_results[str(card_id)] = action == "right"

    st.markdown("---")
    nav_cols = st.columns([1, 1, 1], gap="small")

    # Restart: confirmation dialog to go to app.py
    with nav_cols[0]:
        render_inline_restart_button(page_id="labeling", use_container_width=True)

    # Back: to Quality Based Folding
    if nav_cols[1].button("Back", key="labeling_back", use_container_width=True):
        st.switch_page("pages/QualityBasedFolding.py")

    # Next: run propagation and continue
    if nav_cols[2].button("Next", key="labeling_next", use_container_width=True):
        labeled_cells = []
        for cell in cards:
            is_error = not st.session_state.labeling_results.get(str(cell["id"]), False)
            cell_info = {
                "table": cell.get("table"),
                "is_error": is_error,
                "row": cell.get("row", 0),
                "col": cell.get("col", ""),
                "val": cell.get("val", ""),
                "domain_fold": cell.get("domain_fold", ""),
                "cell_fold": cell.get("cell_fold", ""),
            }
            labeled_cells.append(cell_info)

        propagation_results = backend_label_propagation(dataset, labeled_cells)
        logging.info(
            f"Label propagation completed with {len(propagation_results['labeled_cells'])} labeled cells."
        )
        st.session_state.propagation_results = propagation_results
        st.session_state.propagation_saved = False
        st.switch_page("pages/PropagatedErrors.py")
