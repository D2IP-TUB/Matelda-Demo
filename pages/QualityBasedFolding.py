import json
import os
import time

import numpy as np
import pandas as pd
import streamlit as st
from backend import backend_qbf, get_available_strategies
from components import (
    apply_base_styles,
    apply_folding_styles,
    get_current_theme,
    get_datasets_path,
    load_dirty_table,
    render_inline_restart_button,
    render_sidebar,
)
from components.utils import mark_pipeline_dirty

# Page setup
st.set_page_config(page_title="Quality Based Folding", layout="wide")

# Apply styles with current theme
current_theme = get_current_theme()
apply_base_styles(current_theme)
apply_folding_styles(current_theme)

# Get theme colors for dynamic styling
primary_color = current_theme.get("primaryColor", "#f4b11c").strip()
text_color = current_theme.get("textColor", "#002f67").strip()


# Convert hex color to RGB for rgba usage
def hex_to_rgb(hex_color):
    """Convert hex color to RGB tuple"""
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))


primary_rgb = hex_to_rgb(primary_color)

# Custom CSS for small show more button and reduced header spacing
st.markdown(
    f"""
<style>
.main .block-container {{
    padding-top: 1rem !important;
}}
h1 {{
    margin-bottom: 0.5rem !important;
}}
.small-show-more button {{
    font-size: 10px !important;
    padding: 2px 8px !important;
    height: 24px !important;
    min-height: 24px !important;
    border-radius: 12px !important;
    background-color: {primary_color} !important;
    border: 1px solid {primary_color} !important;
    color: {text_color} !important;
}}
.small-show-more button:hover {{
    background-color: rgba({primary_rgb[0]}, {primary_rgb[1]}, {primary_rgb[2]}, 0.8) !important;
    border-color: rgba({primary_rgb[0]}, {primary_rgb[1]}, {primary_rgb[2]}, 0.8) !important;
}}
/* Fix button height consistency - target all cell buttons */
.stButton > button {{
    min-height: 42px !important;
    height: auto !important;
    white-space: normal !important;
    word-wrap: break-word !important;
    padding: 8px 12px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    text-align: center !important;
}}
/* Specific targeting for cell buttons in columns */
div[data-testid="column"] .stButton > button {{
    min-height: 42px !important;
    max-height: none !important;
    height: auto !important;
}}
</style>
""",
    unsafe_allow_html=True,
)

st.title("Quality Based Folding")

# Sidebar navigation
render_sidebar()


# JSON encoder for NumPy types and pandas types
def _json_default(obj):
    # NumPy arrays to lists
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    # NumPy scalar types (int, float, bool etc.) to native Python
    if isinstance(obj, np.generic):
        return obj.item()
    # pandas NA, boolean, integer, float
    try:
        import pandas as _pd

        if isinstance(obj, (_pd.NA.__class__,)):
            return None
        if isinstance(
            obj,
            (_pd.BooleanDtype().type, _pd.Int64Dtype().type, _pd.Float64Dtype().type),
        ):
            return obj.item()
    except Exception:
        pass
    # Fallback for Python bool
    if isinstance(obj, bool):
        return obj
    raise TypeError(f"Type {obj.__class__.__name__} not serializable")


# Load selected dataset
# Load selected dataset from pipeline configuration if available
if "dataset_select" not in st.session_state and "pipeline_path" in st.session_state:
    cfg_path = os.path.join(st.session_state.pipeline_path, "configurations.json")
    if os.path.exists(cfg_path):
        with open(cfg_path) as f:
            cfg = json.load(f)
        selected = cfg.get("selected_dataset")
        if selected:
            st.session_state.dataset_select = selected

# Ensure strategies selection is in session state (load from config if needed)
if (
    "selected_strategies" not in st.session_state
    and "pipeline_path" in st.session_state
):
    cfg_path = os.path.join(st.session_state.pipeline_path, "configurations.json")
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path) as f:
                cfg = json.load(f)
            st.session_state.selected_strategies = cfg.get("selected_strategies", [])
        except Exception:
            st.session_state.selected_strategies = []

# If dataset is still not configured, inform the user and provide navigation
if "dataset_select" not in st.session_state:
    st.warning("⚠️ Pipeline not configured.")
    if st.button("Go back to Configurations"):
        st.switch_page("pages/Configurations.py")
    st.stop()

# Paths
dataset = st.session_state.dataset_select
datasets_dir = get_datasets_path(dataset)

# Get the current theme to extract primary color
current_theme = get_current_theme()
primary_color = current_theme.get("primaryColor", "#f4b11c").strip()


def highlight_cell(row_idx, col_name):
    def apply(df):
        return df.style.apply(
            lambda _: [
                f"background-color: {primary_color}" if i == row_idx else ""
                for i in range(len(df))
            ],
            axis=0,
            subset=pd.IndexSlice[:, [col_name]],
        )

    return apply


# Load domain folds from config
if "domain_folds" not in st.session_state:
    if "pipeline_path" in st.session_state:
        cfg_path = os.path.join(st.session_state.pipeline_path, "configurations.json")
        if os.path.exists(cfg_path):
            with open(cfg_path) as f:
                cfg = json.load(f)
            st.session_state.domain_folds = cfg.get("domain_folds", {})
        else:
            st.warning("⚠️ No saved domain folds.")
            st.stop()
    else:
        st.warning("⚠️ No pipeline selected.")
        st.stop()

# If saved cell folds exist in the pipeline config, preload them and mark as already run
if "pipeline_path" in st.session_state and "cell_folds" not in st.session_state:
    cfg_path = os.path.join(st.session_state.pipeline_path, "configurations.json")
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path) as f:
                cfg = json.load(f)
            saved_cell_folds = cfg.get("cell_folds")
            if saved_cell_folds:
                st.session_state.cell_folds = saved_cell_folds
                st.session_state.run_quality_folding = True
        except Exception:
            pass

# Initialize controls
defaults = {
    "run_quality_folding": False,
    "merge_mode": False,
    "split_mode": False,
    "bulk_annotate_mode": False,  # New mode for bulk annotation
    "selected_folds_for_merge": [],  # List for merge mode
    "selected_cells_for_split": {},  # Dict for split mode
}
for key, val in defaults.items():
    if key not in st.session_state:
        st.session_state[key] = val

##############################
# Labeling Budget (editable) #
##############################

# Initialize labeling budget from pipeline config if missing in session or zero
if (
    ("budget_slider" not in st.session_state)
    or ("budget_input" not in st.session_state)
    or (st.session_state.get("budget_slider", 0) <= 0)
    or (st.session_state.get("budget_input", 0) <= 0)
):
    cfg_budget = 10
    if "pipeline_path" in st.session_state:
        _cfg_path = os.path.join(st.session_state.pipeline_path, "configurations.json")
        if os.path.exists(_cfg_path):
            try:
                with open(_cfg_path) as _f:
                    _cfg_tmp = json.load(_f)
                cfg_budget = int(_cfg_tmp.get("labeling_budget", 10))
            except Exception:
                cfg_budget = 10

    # Set both values to the same valid budget
    st.session_state["budget_slider"] = min(int(cfg_budget), 100)
    st.session_state["budget_input"] = int(cfg_budget)


def _sync_slider_to_input() -> None:
    st.session_state.budget_input = st.session_state.budget_slider


def _sync_input_to_slider() -> None:
    try:
        st.session_state.budget_slider = min(int(st.session_state.budget_input), 100)
    except Exception:
        st.session_state.budget_slider = 100


st.subheader("Labeling Budget")
col_slider, col_input = st.columns([3, 1])
with col_slider:
    st.slider(
        "Select Labeling Budget:",
        min_value=1,
        max_value=100,
        key="budget_slider",
        label_visibility="visible",
        on_change=_sync_slider_to_input,
    )
with col_input:
    st.number_input(
        "Enter Labeling Budget",
        min_value=1,
        step=1,
        key="budget_input",
        label_visibility="hidden",
        on_change=_sync_input_to_slider,
    )

# Use number input as source of truth
_current_labeling_budget = int(
    st.session_state.get("budget_input", st.session_state.get("budget_slider", 10))
)

st.markdown("---")

# Strategies selection (pre-run)
st.subheader("Error Detection Strategies")
strategies = get_available_strategies()
preselected = set(st.session_state.get("selected_strategies", []))
selected = []
for s in strategies:
    checked = st.checkbox(s, value=(s in preselected), key=f"strategy_{s}")
    if checked:
        selected.append(s)
st.session_state.selected_strategies = selected

# Run quality-based folding
st.markdown("---")
if st.button("▶️ Run Quality Based Folding"):
    with st.spinner("🔄 Processing... Please wait..."):
        # Load current configuration and persist the latest labeling budget from UI
        cfg_path = os.path.join(st.session_state.pipeline_path, "configurations.json")
        with open(cfg_path) as f:
            cfg = json.load(f)
        labeling_budget = int(
            st.session_state.get(
                "budget_input",
                st.session_state.get("budget_slider", cfg.get("labeling_budget", 10)),
            )
        )
        cfg["labeling_budget"] = labeling_budget
        # Persist current strategies selection
        cfg["selected_strategies"] = st.session_state.get("selected_strategies", [])

        # Call the backend function to get cell folds
        cell_folds = backend_qbf(
            selected_dataset=dataset,
            labeling_budget=labeling_budget,
            domain_folds=st.session_state.domain_folds,
            selected_strategies=cfg["selected_strategies"],
        )

        # Store the cell folds in session state
        st.session_state.cell_folds = cell_folds

        # Save to configuration file
        cfg["cell_folds"] = cell_folds
        with open(cfg_path, "w") as f:
            json.dump(cfg, f, indent=2, default=_json_default)

        time.sleep(2)  # Keep a small delay for UX
    # Cell folds changed, downstream results are outdated
    mark_pipeline_dirty()
    st.session_state.run_quality_folding = True
    st.rerun()

if not st.session_state.run_quality_folding:
    st.stop()

st.markdown("---")

# Prepare fold mappings
all_folds = []
fold_to_domain = {}
for dom, folds in st.session_state.cell_folds.items():
    for fname in folds:
        all_folds.append(fname)
        fold_to_domain[fname] = dom


def show_cell_dialog(cell, fold_name):
    r, c, tbl, v = cell["row"], cell["col"], cell["table"], cell["val"]
    lbl = str(v)[:30] + "..." if isinstance(v, str) and len(v) > 30 else str(v)

    @st.dialog(f"Details for {lbl}", width="large")
    def _dialog():
        st.markdown(f"### 📄 Table: `{tbl}`")
        st.markdown(f"**🔹 Column:** `{c}`  \n**🔹 Row Index:** `{r}`")
        st.markdown("---")
        st.markdown("### 🔍 Error Detection Results:")
        if "strategies" in cell and len(cell["strategies"]) > 0:
            for strategy in cell["strategies"]:
                status = "❌"
                st.markdown(f"{status} {strategy}")
        else:
            st.info("✅ This cell passed all error detection checks")
        st.markdown("---")
        st.markdown("### 🔍 Full Table Preview with Highlight")
        df_preview = load_dirty_table(tbl, datasets_dir)
        styled = highlight_cell(r, c)(df_preview)
        st.dataframe(styled, use_container_width=True)
        st.markdown("---")
        st.markdown("### 🔁 Move to another fold")
        new_loc = st.radio(
            f"Move `{lbl}` to:",
            all_folds,
            index=all_folds.index(fold_name),
            key=f"move_{fold_name}_{tbl}_{r}_{c}_{id(cell)}",
        )
        if new_loc != fold_name:
            old_dom = fold_to_domain[fold_name]
            new_dom = fold_to_domain[new_loc]

            st.session_state.cell_folds[old_dom][fold_name].remove(cell)
            st.session_state.cell_folds[new_dom][new_loc].append(cell)

            if not st.session_state.cell_folds[old_dom][fold_name]:
                del st.session_state.cell_folds[old_dom][fold_name]
                if not st.session_state.cell_folds[old_dom]:
                    del st.session_state.cell_folds[old_dom]

            if "pipeline_path" in st.session_state:
                cfg_path = os.path.join(
                    st.session_state.pipeline_path, "configurations.json"
                )
                with open(cfg_path, "r") as f:
                    cfg = json.load(f)
                cfg["cell_folds"] = st.session_state.cell_folds
                with open(cfg_path, "w") as f:
                    json.dump(cfg, f, indent=2, default=_json_default)
            # Moving a cell changes folds
            mark_pipeline_dirty()
            st.rerun()
        if st.button("Close", key=f"close_{fold_name}_{tbl}_{r}_{c}_{id(cell)}"):
            st.rerun()

    _dialog()


st.markdown("### Options / Actions")
st.markdown('<div class="action-container">', unsafe_allow_html=True)
action_cols = st.columns(3)
if action_cols[0].button(
    "Merge Folds", key="global_merge_button", use_container_width=True
):
    st.info(
        "Merge Folds: Combine multiple cell folds into one. Select the folds you wish to merge, and all cells from those folds will be grouped under a single fold.",
        icon="ℹ️",
    )
    st.session_state.merge_mode = True
    st.session_state.split_mode = False
    st.session_state.bulk_annotate_mode = False
    st.session_state.selected_folds_for_merge = []
    st.session_state.selected_cells_for_split = {}
if action_cols[1].button(
    "Split Folds", key="global_split_button", use_container_width=True
):
    st.info(
        "Split Folds: Divide a cell fold into separate folds. Choose the cells at which you want the split to occur; the folds will be split immediately below the selected cells, separating the cells into multiple groups.",
        icon="ℹ️",
    )
    st.session_state.split_mode = True
    st.session_state.merge_mode = False
    st.session_state.bulk_annotate_mode = False
    st.session_state.selected_folds_for_merge = []
    st.session_state.selected_cells_for_split = {}
if action_cols[2].button(
    "Bulk Annotate", key="global_bulk_annotate_button", use_container_width=True
):
    st.info(
        "Bulk Annotate: Label multiple cell folds at once as correct or incorrect. These labels will be used for error detection.",
        icon="ℹ️",
    )
    st.session_state.bulk_annotate_mode = True
    st.session_state.merge_mode = False
    st.session_state.split_mode = False
    st.session_state.selected_folds_for_merge = []
    st.session_state.selected_cells_for_split = {}
st.markdown("</div>", unsafe_allow_html=True)

st.markdown("---")
st.markdown("### Folds / Tables")

# Display folds in a simple, clean table format
for dom, folds in st.session_state.cell_folds.items():
    st.markdown(f"#### Domain: {dom}")

    # Limit initially visible folds per domain to 3, with a 'show more' button
    fold_names = list(folds.keys())
    total_folds_in_domain = len(fold_names)
    visible_folds_key = f"visible_folds_{dom}"
    if visible_folds_key not in st.session_state:
        st.session_state[visible_folds_key] = min(3, total_folds_in_domain)
    # Clamp
    st.session_state[visible_folds_key] = max(
        1, min(st.session_state[visible_folds_key], total_folds_in_domain)
    )
    show_fold_names = fold_names[: st.session_state[visible_folds_key]]

    for fname in show_fold_names:
        cell_list = folds[fname]
        fold_label = None
        if "pipeline_path" in st.session_state:
            cfg_path = os.path.join(
                st.session_state.pipeline_path, "configurations.json"
            )
            if os.path.exists(cfg_path):
                with open(cfg_path) as f:
                    cfg = json.load(f)
                fold_label = cfg.get("cell_fold_labels", {}).get(fname, "neutral")

        label_color = {"correct": "green", "false": "red", "neutral": None}.get(
            fold_label
        )

        # Create fold header row
        fold_cols = st.columns(
            [3, 1, 2]
            if (st.session_state.bulk_annotate_mode or st.session_state.merge_mode)
            else [4, 1]
        )

        # Fold name with color coding and cell count
        if label_color:
            fold_cols[0].markdown(
                f'📦 **<span style="color: {label_color}">{fname}</span>** ({len(cell_list)} cells)',
                unsafe_allow_html=True,
            )
        else:
            fold_cols[0].markdown(f"📦 **{fname}** ({len(cell_list)} cells)")

        # Show/hide toggle
        show_fold_key = f"show_fold_{fname}"
        if show_fold_key not in st.session_state:
            # Try to load fold visibility state from config
            if "pipeline_path" in st.session_state:
                cfg_path = os.path.join(
                    st.session_state.pipeline_path, "configurations.json"
                )
                if os.path.exists(cfg_path):
                    try:
                        with open(cfg_path) as f:
                            cfg = json.load(f)
                        fold_visibility = cfg.get("fold_visibility", {})
                        saved_state = fold_visibility.get(fname, False)
                        st.session_state[show_fold_key] = saved_state
                        # Debug: Show if we loaded state
                        if saved_state:
                            st.sidebar.success(
                                f"Loaded fold state for {fname}: {saved_state}"
                            )
                    except Exception as e:
                        st.session_state[show_fold_key] = False
                        st.sidebar.error(f"Failed to load fold state: {str(e)}")
                else:
                    st.session_state[show_fold_key] = False
                    st.sidebar.warning("No config file found")
            else:
                st.session_state[show_fold_key] = False
                st.sidebar.warning("No pipeline path set")

        if fold_cols[1].button(
            "Hide" if st.session_state[show_fold_key] else "Show",
            key=f"toggle_{fname}",
            use_container_width=True,
        ):
            st.session_state[show_fold_key] = not st.session_state[show_fold_key]

            # Save fold visibility state to config
            if "pipeline_path" in st.session_state:
                cfg_path = os.path.join(
                    st.session_state.pipeline_path, "configurations.json"
                )
                if os.path.exists(cfg_path):
                    try:
                        with open(cfg_path) as f:
                            cfg = json.load(f)
                        if "fold_visibility" not in cfg:
                            cfg["fold_visibility"] = {}
                        cfg["fold_visibility"][fname] = st.session_state[show_fold_key]
                        with open(cfg_path, "w") as f:
                            json.dump(cfg, f, indent=2, default=_json_default)
                        st.sidebar.success(
                            f"Saved fold state for {fname}: {st.session_state[show_fold_key]}"
                        )
                    except Exception as e:
                        st.sidebar.error(f"Failed to save fold state: {str(e)}")
            st.rerun()

        # Action controls (merge/bulk annotate)
        if st.session_state.merge_mode and len(fold_cols) > 2:
            merge_selected = fold_cols[2].checkbox(
                "Select fold", key=f"merge_{fname}", label_visibility="hidden"
            )
            if (
                merge_selected
                and fname not in st.session_state.selected_folds_for_merge
            ):
                st.session_state.selected_folds_for_merge.append(fname)
            elif (
                not merge_selected
                and fname in st.session_state.selected_folds_for_merge
            ):
                st.session_state.selected_folds_for_merge.remove(fname)
        elif st.session_state.bulk_annotate_mode and len(fold_cols) > 2:
            button_cols = fold_cols[2].columns(2)
            if button_cols[0].button(
                "✓", key=f"correct_{fname}", use_container_width=True
            ):
                if "pipeline_path" in st.session_state:
                    cfg_path = os.path.join(
                        st.session_state.pipeline_path, "configurations.json"
                    )
                    if os.path.exists(cfg_path):
                        with open(cfg_path) as f:
                            cfg = json.load(f)
                        if "cell_fold_labels" not in cfg:
                            cfg["cell_fold_labels"] = {}
                        cfg["cell_fold_labels"][fname] = "correct"
                        with open(cfg_path, "w") as f:
                            json.dump(cfg, f, indent=2, default=_json_default)
                        mark_pipeline_dirty()
                        st.rerun()
            if button_cols[1].button(
                "✗", key=f"false_{fname}", use_container_width=True
            ):
                if "pipeline_path" in st.session_state:
                    cfg_path = os.path.join(
                        st.session_state.pipeline_path, "configurations.json"
                    )
                    if os.path.exists(cfg_path):
                        with open(cfg_path) as f:
                            cfg = json.load(f)
                        if "cell_fold_labels" not in cfg:
                            cfg["cell_fold_labels"] = {}
                        cfg["cell_fold_labels"][fname] = "false"
                        with open(cfg_path, "w") as f:
                            json.dump(cfg, f, indent=2, default=_json_default)
                        mark_pipeline_dirty()
                        st.rerun()

        # Show fold contents if toggled on
        if st.session_state.get(show_fold_key, False):
            # Group cells by table and column for better organization
            def organize_cells(cells):
                organized = {}
                for cell in cells:
                    table = cell["table"]
                    column = cell["col"]
                    if table not in organized:
                        organized[table] = {}
                    if column not in organized[table]:
                        organized[table][column] = []
                    organized[table][column].append(cell)
                return organized

            organized_data = organize_cells(cell_list)

            # Create indented container for fold contents
            with st.container():
                st.markdown(
                    '<div style="margin-left: 15px; padding-left: 15px; border-left: 2px solid #e0e0e0;">',
                    unsafe_allow_html=True,
                )

                # Display each table
                for table_name in sorted(organized_data.keys()):
                    table_columns = organized_data[table_name]

                    # Table header
                    st.markdown(f"**📊 Table: `{table_name}`**")

                    # Display each column within the table
                    for column_name in sorted(table_columns.keys()):
                        cells_in_column = table_columns[column_name]

                        # Column header with cell count
                        st.markdown(
                            f"&nbsp;&nbsp;&nbsp;&nbsp;📋 **Column: `{column_name}`** ({len(cells_in_column)} cells)"
                        )

                        # Limit visible cells per column with "show more" functionality
                        visible_cells_key = (
                            f"visible_cells_{fname}_{table_name}_{column_name}"
                        )
                        if visible_cells_key not in st.session_state:
                            # Try to load visible cells count from config
                            if "pipeline_path" in st.session_state:
                                cfg_path = os.path.join(
                                    st.session_state.pipeline_path,
                                    "configurations.json",
                                )
                                if os.path.exists(cfg_path):
                                    try:
                                        with open(cfg_path) as f:
                                            cfg = json.load(f)
                                        visible_cells_state = cfg.get(
                                            "visible_cells_state", {}
                                        )
                                        saved_count = visible_cells_state.get(
                                            visible_cells_key,
                                            min(4, len(cells_in_column)),
                                        )
                                        st.session_state[visible_cells_key] = (
                                            saved_count
                                        )
                                    except Exception:
                                        st.session_state[visible_cells_key] = min(
                                            4, len(cells_in_column)
                                        )
                                else:
                                    st.session_state[visible_cells_key] = min(
                                        4, len(cells_in_column)
                                    )
                            else:
                                st.session_state[visible_cells_key] = min(
                                    4, len(cells_in_column)
                                )

                        # Clamp to valid range
                        st.session_state[visible_cells_key] = max(
                            0,
                            min(
                                st.session_state[visible_cells_key],
                                len(cells_in_column),
                            ),
                        )

                        visible_cells_count = st.session_state[visible_cells_key]
                        visible_cells = cells_in_column[:visible_cells_count]

                        # Create a grid of buttons for visible cells in this column
                        cells_per_row = 4
                        if len(visible_cells) > 0:
                            for i in range(0, len(visible_cells), cells_per_row):
                                # Create a consistent button row with proper spacing
                                button_cols = st.columns(cells_per_row, gap="small")

                                for j in range(cells_per_row):
                                    with button_cols[j]:
                                        if i + j < len(visible_cells):
                                            cell = visible_cells[i + j]
                                            r, c, tbl, v = (
                                                cell["row"],
                                                cell["col"],
                                                cell["table"],
                                                cell["val"],
                                            )
                                            strategies = cell.get("strategies", [])
                                            error_count = len(strategies)

                                            # Create clean button label - standardized length
                                            display_val = (
                                                str(v)[:15] + "..."
                                                if isinstance(v, str) and len(v) > 15
                                                else str(v)
                                            )

                                            # Pad short values to ensure consistent button sizes
                                            if len(display_val) < 10:
                                                display_val = display_val.ljust(10)

                                            # Status indicator
                                            if error_count > 0:
                                                status = f"❌{error_count}"
                                            else:
                                                status = "✅"

                                            # Clean button text with consistent format
                                            button_label = (
                                                f"R{r}: {display_val}\n{status}"
                                            )

                                            # Create a container for consistent sizing
                                            with st.container():
                                                st.markdown(
                                                    '<div style="height: 60px; display: flex; align-items: stretch;">',
                                                    unsafe_allow_html=True,
                                                )
                                                if st.button(
                                                    button_label,
                                                    key=f"cell_{fname}_{table_name}_{column_name}_{r}_{i + j}",
                                                    use_container_width=True,
                                                    type="secondary",
                                                    help=f"Table: {tbl}, Column: {c}, Row: {r}, Value: {v}",
                                                ):
                                                    show_cell_dialog(cell, fname)
                                                st.markdown(
                                                    "</div>", unsafe_allow_html=True
                                                )

                                            # Split mode checkbox
                                            if st.session_state.split_mode:
                                                split_selected = st.checkbox(
                                                    "Split here",
                                                    key=f"split_{fname}_{table_name}_{column_name}_{r}_{i + j}",
                                                    label_visibility="hidden",
                                                )
                                                if (
                                                    fname
                                                    not in st.session_state.selected_cells_for_split
                                                ):
                                                    st.session_state.selected_cells_for_split[
                                                        fname
                                                    ] = []
                                                selected_cells = st.session_state.selected_cells_for_split.get(
                                                    fname, []
                                                )

                                                if (
                                                    split_selected
                                                    and cell not in selected_cells
                                                ):
                                                    selected_cells.append(cell)
                                                    st.session_state.selected_cells_for_split[
                                                        fname
                                                    ] = selected_cells
                                                elif (
                                                    not split_selected
                                                    and cell in selected_cells
                                                ):
                                                    selected_cells.remove(cell)
                                                    st.session_state.selected_cells_for_split[
                                                        fname
                                                    ] = selected_cells
                                        else:
                                            # Empty column placeholder with consistent height
                                            st.markdown(
                                                '<div style="height: 60px; display: flex; align-items: center; justify-content: center; color: #ccc;">',
                                                unsafe_allow_html=True,
                                            )
                                            st.markdown("—")
                                            st.markdown(
                                                "</div>", unsafe_allow_html=True
                                            )
                        else:
                            st.info("No cells to display in this column.")

                        # Show more cells button if there are more cells to show
                        if visible_cells_count < len(cells_in_column):
                            remaining_cells = len(cells_in_column) - visible_cells_count
                            show_more_count = min(4, remaining_cells)

                            col1, col2, col3 = st.columns([1, 2, 1])
                            with col2:
                                if st.button(
                                    f"+ Show {show_more_count} more cells",
                                    key=f"show_more_{fname}_{table_name}_{column_name}",
                                    use_container_width=True,
                                ):
                                    st.session_state[visible_cells_key] = min(
                                        len(cells_in_column),
                                        visible_cells_count + show_more_count,
                                    )

                                    # Save visible cells state to config
                                    if "pipeline_path" in st.session_state:
                                        cfg_path = os.path.join(
                                            st.session_state.pipeline_path,
                                            "configurations.json",
                                        )
                                        if os.path.exists(cfg_path):
                                            try:
                                                with open(cfg_path) as f:
                                                    cfg = json.load(f)
                                                if "visible_cells_state" not in cfg:
                                                    cfg["visible_cells_state"] = {}
                                                cfg["visible_cells_state"][
                                                    visible_cells_key
                                                ] = st.session_state[visible_cells_key]
                                                with open(cfg_path, "w") as f:
                                                    json.dump(
                                                        cfg,
                                                        f,
                                                        indent=2,
                                                        default=_json_default,
                                                    )
                                            except Exception:
                                                pass

                                    st.rerun()

                        # Add some spacing between columns
                        st.markdown("&nbsp;")

                    # Add spacing between tables
                    st.markdown("---")

                st.markdown("</div>", unsafe_allow_html=True)

    # Domain-level 'show more folds' button if more folds are available
    if st.session_state[visible_folds_key] < total_folds_in_domain:
        if st.button(
            "+ Show More Folds", key=f"show_more_folds_{dom}", use_container_width=False
        ):
            st.session_state[visible_folds_key] = min(
                total_folds_in_domain, st.session_state[visible_folds_key] + 3
            )
            st.rerun()

    st.markdown("---")


# Global Confirm Merge: if merge mode is active and more than one fold is selected
if st.session_state.merge_mode and len(st.session_state.selected_folds_for_merge) > 1:
    merge_confirm_cols = st.columns([4, 1])
    if merge_confirm_cols[1].button(
        "Confirm Merge", key="confirm_merge", use_container_width=True
    ):
        target_fold = st.session_state.selected_folds_for_merge[0]
        target_domain = fold_to_domain[target_fold]

        # Get the labels of all folds being merged
        cfg_path = os.path.join(st.session_state.pipeline_path, "configurations.json")
        with open(cfg_path, "r") as f:
            cfg = json.load(f)

        fold_labels = cfg.get("cell_fold_labels", {})
        labels_to_merge = [
            fold_labels.get(fold, "neutral")
            for fold in st.session_state.selected_folds_for_merge
        ]

        # Determine the final label based on the rules
        has_correct = "correct" in labels_to_merge
        has_false = "false" in labels_to_merge
        all_correct_or_neutral = all(
            label in ["correct", "neutral"] for label in labels_to_merge
        )

        # Apply the rules
        if has_correct and has_false:
            final_label = (
                "neutral"  # Rule: if conflict between correct and false -> neutral
            )
        elif all_correct_or_neutral and has_correct:
            final_label = "correct"  # Rule: if all are correct or neutral, and at least one correct -> correct
        elif has_false:
            final_label = "false"  # Rule: if any false and no correct -> false
        else:
            final_label = "neutral"  # Default case

        # Update the label for the target fold
        if "cell_fold_labels" not in cfg:
            cfg["cell_fold_labels"] = {}
        cfg["cell_fold_labels"][target_fold] = final_label

        # Remove labels for the source folds that will be deleted
        for fold in st.session_state.selected_folds_for_merge[1:]:
            if fold in cfg["cell_fold_labels"]:
                del cfg["cell_fold_labels"][fold]

        # Perform the merge
        for fold in st.session_state.selected_folds_for_merge[1:]:
            source_domain = fold_to_domain[fold]
            # Extend target fold with cells from source fold
            st.session_state.cell_folds[target_domain][target_fold].extend(
                st.session_state.cell_folds[source_domain][fold]
            )
            # Remove the source fold
            del st.session_state.cell_folds[source_domain][fold]

        # Save the updated configuration
        with open(cfg_path, "w") as f:
            json.dump(cfg, f, indent=2, default=_json_default)

        st.session_state.selected_folds_for_merge = []
        st.session_state.merge_mode = False
        mark_pipeline_dirty()
        st.rerun()

# Global Confirm Split: if split mode is active and at least one cell is selected
if st.session_state.split_mode:
    any_split = any(
        st.session_state.selected_cells_for_split.get(fold, [])
        for fold in st.session_state.selected_cells_for_split
    )
    if any_split:
        split_confirm_cols = st.columns([4, 1])
        if split_confirm_cols[1].button(
            "Confirm Split", key="confirm_split", use_container_width=True
        ):
            for (
                fold_name,
                selected_cells,
            ) in st.session_state.selected_cells_for_split.items():
                if selected_cells:
                    domain = fold_to_domain[fold_name]
                    cell_list = st.session_state.cell_folds[domain][fold_name]
                    # Get indices of selected cells
                    indices = sorted(
                        [cell_list.index(c) for c in selected_cells if c in cell_list]
                    )

                    # Split the fold into segments
                    new_folds = []
                    prev_idx = 0
                    for idx in indices:
                        new_fold_name = f"{fold_name} - Split {len(new_folds) + 1}"
                        new_folds.append((new_fold_name, cell_list[prev_idx : idx + 1]))
                        prev_idx = idx + 1

                    # Add remaining cells if any
                    if prev_idx < len(cell_list):
                        new_fold_name = f"{fold_name} - Split {len(new_folds) + 1}"
                        new_folds.append((new_fold_name, cell_list[prev_idx:]))

                    # Remove the original fold and add new folds
                    del st.session_state.cell_folds[domain][fold_name]
                    for new_name, cells in new_folds:
                        st.session_state.cell_folds[domain][new_name] = cells

            st.session_state.split_mode = False
            st.session_state.selected_cells_for_split = {}
            mark_pipeline_dirty()
            st.rerun()

# Navigation row: Restart | Back | Next
st.markdown("---")
nav_cols = st.columns([1, 1, 1], gap="small")

# Restart: confirmation dialog to go to app.py
with nav_cols[0]:
    render_inline_restart_button(
        page_id="quality_based_folding", use_container_width=True
    )

# Back: to Domain Based Folding
if nav_cols[1].button("Back", key="qbf_back", use_container_width=True):
    st.switch_page("pages/DomainBasedFolding.py")

# Next: Save and Continue
if nav_cols[2].button("Next", key="save_cell_folds", use_container_width=True):
    if "pipeline_path" in st.session_state:
        cfg_path = os.path.join(st.session_state.pipeline_path, "configurations.json")
        with open(cfg_path, "r") as f:
            cfg = json.load(f)
        cfg["cell_folds"] = st.session_state.cell_folds
        with open(cfg_path, "w") as f:
            json.dump(cfg, f, indent=2, default=_json_default)
        st.success("✅ Saved.")
    else:
        st.warning("⚠️ No pipeline path set.")
    st.switch_page("pages/Labeling.py")
