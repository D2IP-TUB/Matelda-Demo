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

    # Handle strategies - limit to 3 strategies for display, add "show more" if needed
    all_strategies = cell.get("strategies", [])
    max_display_strategies = 3

    if len(all_strategies) <= max_display_strategies:
        display_strategies = all_strategies
        description = f"Value: {val}"
    else:
        display_strategies = all_strategies[:max_display_strategies]
        remaining_count = len(all_strategies) - max_display_strategies
        # Add the extra info to description to make it more visible
        description = (
            f"Value: {val} | 🔍 +{remaining_count} more strategies (see below)"
        )

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
        "pills": display_strategies,
        "all_strategies": all_strategies,  # Store all strategies for popup
        "cell_id": cell.get("id", ""),  # Add ID for popup reference
        "table": cell.get("table", ""),  # Add table info for popup
    }


def show_all_strategies_dialog(cell_data: Dict[str, Any]):
    """Show a dialog with all strategies for a cell."""
    cell_id = cell_data.get("cell_id", "unknown")
    table = cell_data.get("table", "unknown")
    row = cell_data.get("row_index", "unknown")
    column = cell_data.get("center_table_column", "unknown")
    value = cell_data.get("description", "").replace("Value: ", "")
    all_strategies = cell_data.get("all_strategies", [])

    @st.dialog("All Error Detection Strategies", width="large")
    def _dialog():
        st.markdown("### 📄 Cell Details")
        st.markdown(f"**📊 Table:** `{table}`")
        st.markdown(f"**📍 Location:** Row `{row}`, Column `{column}`")
        st.markdown(f"**💬 Value:** `{value}`")

        st.markdown("---")
        st.markdown(
            f"### 🔍 Error Detection Results ({len(all_strategies)} strategies)"
        )

        if all_strategies:
            # Display strategies in a nice format
            for i, strategy in enumerate(all_strategies, 1):
                st.markdown(f"**{i}.** ❌ {strategy}")
        else:
            st.info("✅ This cell passed all error detection checks")

        st.markdown("---")
        if st.button(
            "Close", key=f"close_strategies_{cell_id}", use_container_width=True
        ):
            st.rerun()

    _dialog()


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
        labeling_budget = st.session_state.get("labeling_budget", 10)
        cell_folds = st.session_state.get("cell_folds", {})
        domain_folds = st.session_state.get("domain_folds", {})

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

        # Check if any cards have truncated strategies (store for later use)
        cards_with_many_strategies = [
            (i, card)
            for i, card in enumerate(card_data)
            if len(card.get("all_strategies", [])) > 3
        ]

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
                # Only mark dirty if we actually recorded new swipes in this render
                mark_pipeline_dirty()

        # Show strategy details section after the swipe cards
        if cards_with_many_strategies:
            # Make this more prominent with a warning-style message
            st.warning(
                f"⚠️ {len(cards_with_many_strategies)} cards have additional error detection strategies not shown in the card details above. Expand below to view all strategies."
            )

            with st.expander(
                "🔍 **Click here to view all strategies for cards with 4+ strategies**",
                expanded=False,
            ):
                st.markdown("**Cards with truncated strategies:**")
                st.markdown(
                    "*Click on a card button below to see all error detection strategies for that specific cell.*"
                )

                # Create columns for strategy buttons
                cols_per_row = 2  # Reduced to 2 for better button sizing
                for i in range(0, len(cards_with_many_strategies), cols_per_row):
                    button_cols = st.columns(cols_per_row)

                    for j in range(cols_per_row):
                        if i + j < len(cards_with_many_strategies):
                            card_idx, card = cards_with_many_strategies[i + j]
                            table = card.get("table", "unknown")
                            row = card.get("row_index", "?")
                            col = card.get("center_table_column", "?")
                            total_strategies = len(card.get("all_strategies", []))
                            # Extract just the value part from description
                            description = card.get("description", "")
                            value = (
                                description.split(" | ")[0].replace("Value: ", "")
                                if " | " in description
                                else description.replace("Value: ", "")
                            )

                            with button_cols[j]:
                                if st.button(
                                    f"📋 **Card {card_idx + 1}**\n`{table}.{col}[{row}]`\nValue: `{str(value)[:20]}{'...' if len(str(value)) > 20 else ''}`\n🔍 **{total_strategies} strategies total**",
                                    key=f"view_strategies_{card_idx}",
                                    use_container_width=True,
                                    type="secondary",
                                ):
                                    show_all_strategies_dialog(card)

                st.markdown("---")
                st.info(
                    "💡 **Tip:** You can still swipe the cards normally. The strategy details are just additional information to help you make better decisions."
                )

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
