import json
import logging
import os
import time
from typing import Any, Dict, List

import pandas as pd
import streamlit as st
from backend import backend_label_propagation, backend_sample_labeling
from components import (
    apply_base_styles,
    get_datasets_path,
    get_swipecard_colors,
    render_inline_restart_button,
    render_sidebar,
)
from components.utils import mark_pipeline_dirty
from streamlit_swipecards import streamlit_swipecards

# Logger setup (console only)
logger = logging.getLogger("labeling")
if not logger.handlers:
    _handler = logging.StreamHandler()
    _formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    _handler.setFormatter(_formatter)
    logger.addHandler(_handler)
logger.setLevel(logging.INFO)

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
    st.warning("⚠️ Pipeline not configured.")
    if st.button("Go back to Configurations"):
        st.switch_page("pages/Configurations.py")
    st.stop()

dataset = st.session_state.dataset_select

# Session-state keys
SAMPLE_KEY = "labeling.sampled_cells"
SAMPLE_DATASET_KEY = "labeling.sampled_cells.dataset"
SAMPLE_BUDGET_KEY = "labeling.sampled_cells.budget"

# Hydrate domain_folds and cell_folds from pipeline config on reload
if (
    "domain_folds" not in st.session_state or not st.session_state.get("domain_folds")
) and "pipeline_path" in st.session_state:
    cfg_path = os.path.join(st.session_state.pipeline_path, "configurations.json")
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path) as f:
                cfg = json.load(f)
            st.session_state.domain_folds = cfg.get("domain_folds", {})
        except Exception:
            pass

if (
    "cell_folds" not in st.session_state or not st.session_state.get("cell_folds")
) and "pipeline_path" in st.session_state:
    cfg_path = os.path.join(st.session_state.pipeline_path, "configurations.json")
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path) as f:
                cfg = json.load(f)
            if cfg.get("cell_folds"):
                st.session_state.cell_folds = cfg.get("cell_folds")
        except Exception:
            pass


def make_card(cell: Dict[str, Any]) -> Dict[str, Any]:
    """Return a table-mode card configuration for streamlit-swipecards."""

    datasets_path = get_datasets_path(dataset)
    dataset_path = os.path.join(datasets_path, cell["table"], "dirty.csv")

    row = int(cell.get("row", 0))
    column = cell.get("col", "")
    val = cell.get("val", "")
    if pd.isna(val) or str(val).lower() == "nan":
        val = ""

    # Handle strategies - just show all strategies as pills, no truncation or extra UI
    all_strategies = cell.get("strategies", [])
    description = f"Value: {val}"

    return {
        "dataset_path": dataset_path,
        "row_index": row,
        "name": cell.get("name", ""),
        "description": description,
        "highlight_cells": [{"row": row, "column": column}],
        "highlight_rows": [{"row": row}],
        "highlight_columns": [{"column": column}],
        "center_table_row": row,
        "center_table_column": column,
        "pills": all_strategies,
        "all_strategies": all_strategies,
        "cell_id": cell.get("id", ""),
        "table": cell.get("table", ""),
    }

    # ...existing code...


def _compute_sampled_cells(
    dataset: str,
    labeling_budget: int,
    cell_folds: Dict[str, Any],
    domain_folds: Dict[str, Any],
    bulk_annotations_hash: str,  # New parameter to break cache when bulk annotations change
):
    # Log only when actually computing (i.e., cache miss)
    logger.info(
        "Sampling cells via backend_sample_labeling (dataset=%s, budget=%s)",
        dataset,
        labeling_budget,
    )
    return backend_sample_labeling(
        selected_dataset=dataset,
        labeling_budget=labeling_budget,
        cell_folds=cell_folds,
        domain_folds=domain_folds,
    )


@st.cache_data(show_spinner=False)
def get_cached_sampled_cells(
    dataset: str,
    labeling_budget: int,
    cell_folds: Dict[str, Any],
    domain_folds: Dict[str, Any],
    bulk_annotations_hash: str,
):
    return _compute_sampled_cells(
        dataset, labeling_budget, cell_folds, domain_folds, bulk_annotations_hash
    )


def run_sampling():
    with st.spinner("🔄 Processing... Please wait..."):
        # Always read the latest labeling budget from the configuration file
        # This ensures we get the updated budget when it's changed in QBF
        labeling_budget = 10  # default
        if "pipeline_path" in st.session_state:
            cfg_path = os.path.join(
                st.session_state.pipeline_path, "configurations.json"
            )
            if os.path.exists(cfg_path):
                try:
                    with open(cfg_path) as f:
                        cfg = json.load(f)
                    labeling_budget = cfg.get("labeling_budget", 10)
                    # Update session state to reflect the current config
                    st.session_state["labeling_budget"] = labeling_budget
                    st.session_state["budget_slider"] = min(
                        labeling_budget, 100
                    )  # Clamp slider to 100
                    st.session_state["budget_input"] = labeling_budget
                    logger.info(
                        f"Loaded updated labeling budget from config: {labeling_budget}"
                    )
                except Exception as e:
                    logger.warning(f"Could not read labeling budget from config: {e}")
                    labeling_budget = st.session_state.get("labeling_budget", 10)
            else:
                labeling_budget = st.session_state.get("labeling_budget", 10)
        else:
            labeling_budget = st.session_state.get("labeling_budget", 10)

        cell_folds = st.session_state.get("cell_folds", {})
        domain_folds = st.session_state.get("domain_folds", {})

        # Check if labeling budget has changed and clear cache if so
        previous_budget = st.session_state.get(SAMPLE_BUDGET_KEY, None)
        if previous_budget is not None and previous_budget != labeling_budget:
            logger.info(
                f"Labeling budget changed from {previous_budget} to {labeling_budget}, clearing cache"
            )
            get_cached_sampled_cells.clear()

        # Generate hash of bulk annotations to break cache when they change
        bulk_annotations_hash = ""
        if "pipeline_path" in st.session_state:
            cfg_path = os.path.join(
                st.session_state.pipeline_path, "configurations.json"
            )
            if os.path.exists(cfg_path):
                try:
                    with open(cfg_path) as f:
                        cfg = json.load(f)
                    bulk_annotations = cfg.get("cell_fold_labels", {})
                    import hashlib

                    bulk_annotations_hash = hashlib.md5(
                        str(sorted(bulk_annotations.items())).encode()
                    ).hexdigest()
                except Exception:
                    bulk_annotations_hash = "error"

        sampled_cells = get_cached_sampled_cells(
            dataset=dataset,
            labeling_budget=labeling_budget,
            cell_folds=cell_folds,
            domain_folds=domain_folds,
            bulk_annotations_hash=bulk_annotations_hash,
        )
        # Persist in session state to avoid re-sampling on reload
        st.session_state[SAMPLE_KEY] = sampled_cells
        st.session_state[SAMPLE_DATASET_KEY] = dataset
        st.session_state[SAMPLE_BUDGET_KEY] = labeling_budget
        st.session_state["last_bulk_hash"] = (
            bulk_annotations_hash  # Store hash for change detection
        )
        # Small delay to make spinner visible and UX smooth
        time.sleep(0.3)


# Migration: support prior non-namespaced key
if "sampled_cells" in st.session_state and SAMPLE_KEY not in st.session_state:
    st.session_state[SAMPLE_KEY] = st.session_state["sampled_cells"]
    st.session_state[SAMPLE_DATASET_KEY] = dataset
    st.session_state[SAMPLE_BUDGET_KEY] = st.session_state.get("labeling_budget", 10)

# Auto-run sampling only if no samples exist for the current dataset or if bulk annotations changed
# First, read the current labeling budget from config file to get the most up-to-date value
_current_budget = 10  # default
if "pipeline_path" in st.session_state:
    cfg_path = os.path.join(st.session_state.pipeline_path, "configurations.json")
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path) as f:
                cfg = json.load(f)
            _current_budget = cfg.get("labeling_budget", 10)
            logger.info(f"Current budget from config: {_current_budget}")
        except Exception as e:
            logger.warning(f"Could not read current budget from config: {e}")
            _current_budget = st.session_state.get("labeling_budget", 10)
    else:
        _current_budget = st.session_state.get("labeling_budget", 10)
else:
    _current_budget = st.session_state.get("labeling_budget", 10)

# Check if we need to resample due to changes
needs_resampling = (
    SAMPLE_KEY not in st.session_state
    or st.session_state.get(SAMPLE_DATASET_KEY) != dataset
    or st.session_state.get(SAMPLE_BUDGET_KEY) != _current_budget
)

# Also check if bulk annotations have changed since last sampling
if not needs_resampling and "pipeline_path" in st.session_state:
    cfg_path = os.path.join(st.session_state.pipeline_path, "configurations.json")
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path) as f:
                cfg = json.load(f)
            bulk_annotations = cfg.get("cell_fold_labels", {})
            import hashlib

            current_bulk_hash = hashlib.md5(
                str(sorted(bulk_annotations.items())).encode()
            ).hexdigest()
            stored_bulk_hash = st.session_state.get("last_bulk_hash", "")
            if current_bulk_hash != stored_bulk_hash:
                needs_resampling = True
                logger.info("Bulk annotations changed, forcing re-sampling")
        except Exception:
            pass

if needs_resampling:
    run_sampling()

if SAMPLE_KEY in st.session_state:
    cards: List[Dict[str, Any]] = st.session_state.get(SAMPLE_KEY, [])
    # Log: initializing cards (console)
    logger.info(
        "Initializing cards (n=%s, dataset=%s, budget=%s)",
        len(cards),
        st.session_state.get(SAMPLE_DATASET_KEY),
        st.session_state.get(SAMPLE_BUDGET_KEY),
    )
    card_data = [c for c in (make_card(card) for card in cards) if c]

    # Show bulk annotation status
    try:
        import streamlit as st

        if "pipeline_path" in st.session_state:
            import json
            import os

            cfg_path = os.path.join(
                st.session_state.pipeline_path, "configurations.json"
            )
            if os.path.exists(cfg_path):
                with open(cfg_path) as f:
                    cfg = json.load(f)
                bulk_annotations = cfg.get("cell_fold_labels", {})
                if bulk_annotations:
                    st.info(
                        f"ℹ️ {len(bulk_annotations)} cell folds have been bulk-annotated and excluded from individual labeling."
                    )
    except Exception:
        pass

    # Check if there are no cards to show (all bulk-annotated)
    if len(card_data) == 0:
        st.success(
            "✅ All cell folds have been bulk-annotated! No individual labeling needed."
        )
        st.info(
            "💡 You can proceed directly to propagation by clicking the 'Next' button below."
        )
    else:
        st.info("Swipe left to mark as error, swipe right to mark as correct.")

        results = streamlit_swipecards(
            cards=card_data,
            display_mode="table",
            view="desktop",
            key="labeling_cards",
            last_card_message="No more cards to swipe, continue with the Next-button below.",
            colors=get_swipecard_colors(),
        )

        if "labeling_results" not in st.session_state:
            st.session_state.labeling_results = {}

        if results and isinstance(results.get("swipedCards", None), list):
            swipes = results.get("swipedCards", [])
            made_changes = False
            for swipe in swipes:
                idx = swipe.get("index")
                action = swipe.get("action")
                if idx is not None and action in {"left", "right"} and idx < len(cards):
                    card_id = cards[idx]["id"]
                    key = str(card_id)
                    new_val = action == "right"
                    prev_val = st.session_state.labeling_results.get(key)
                if prev_val is None or prev_val != new_val:
                    st.session_state.labeling_results[key] = new_val
                    made_changes = True
            if made_changes:
                mark_pipeline_dirty()

        st.markdown("---")
        nav_cols = st.columns([1, 1, 1], gap="small")

    # Restart: confirmation dialog to go to app.py
    with nav_cols[0]:
        render_inline_restart_button(page_id="labeling", use_container_width=True)

    # Back: to Quality Based Folding
    if nav_cols[1].button("Back", key="labeling_back", use_container_width=True):
        st.switch_page("pages/QualityBasedFolding.py")

    # Next: go to Propagated Errors (propagation triggered there)
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
