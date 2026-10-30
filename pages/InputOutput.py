import os

import numpy as np
import pandas as pd
import streamlit as st
from components.utils import read_csv_cached
from components import (
    apply_base_styles,
    get_current_theme,
    get_datasets_path,
    render_inline_restart_button,
    render_sidebar,
)

# Page setup
st.set_page_config(page_title="Intro", layout="wide")
current_theme = get_current_theme()
apply_base_styles(current_theme)
render_sidebar()

st.title("Intro")

# ── Dataset locked by the room (chosen in the Lobby) ────────────────────
datasets_root = os.path.join(os.path.dirname(__file__), "../datasets")
selected_dataset = st.session_state.get("dataset_select")
if not selected_dataset or not os.path.isdir(os.path.join(datasets_root, selected_dataset)):
    st.warning("No dataset yet. Create or join a room and start it in the Lobby first.")
    st.page_link("pages/Lobby.py", label="Go to the Lobby →")
    st.stop()

datasets_path = os.path.join(datasets_root, selected_dataset)

# Discover tables (sub-directories that contain dirty.csv)
tables = sorted(
    d
    for d in os.listdir(datasets_path)
    if os.path.isdir(os.path.join(datasets_path, d))
    and os.path.isfile(os.path.join(datasets_path, d, "dirty.csv"))
)

if not tables:
    st.info("No tables found in this dataset.")
    st.stop()

st.markdown(f"**Dataset:** `{selected_dataset}` — **{len(tables)} table(s)**")

# ── Theme-aware error highlighting ──────────────────────────────────────
primary_color = current_theme.get("primaryColor", "#f4b11c").strip()


def hex_to_rgb(hex_color):
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))


primary_rgb = hex_to_rgb(primary_color)

# ── Custom CSS for bold tab styling and red/green bordered panels ───────
st.markdown("""
<style>
/* Make tabs larger and bolder */
div[data-baseweb="tab-list"] button[data-baseweb="tab"] {
    font-size: 1.1rem !important;
    font-weight: 600 !important;
    padding: 0.75rem 1.5rem !important;
}
/* Red-bordered container for dirty tables */
.dirty-panel {
    border: 2.5px solid #e74c3c;
    border-radius: 10px;
    padding: 1rem;
    margin-bottom: 0.5rem;
}
.dirty-panel-header {
    color: #e74c3c;
    font-weight: 700;
    font-size: 1.05rem;
    margin-bottom: 0.5rem;
}
/* Green-bordered container for clean tables */
.clean-panel {
    border: 2.5px solid #2ecc71;
    border-radius: 10px;
    padding: 1rem;
    margin-bottom: 0.5rem;
}
.clean-panel-header {
    color: #2ecc71;
    font-weight: 700;
    font-size: 1.05rem;
    margin-bottom: 0.5rem;
}
</style>
""", unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════════════
# TAB LAYOUT: Input Tables | Dirty vs Clean
# ═══════════════════════════════════════════════════════════════════════
tab_input, tab_compare = st.tabs(
    ["📥  Input Tables", "🔀  Dirty vs Clean"]
)

# ── TAB 1 — Input Tables ───────────────────────────────────────────────
with tab_input:
    st.subheader("Input Tables (Dirty)")
    st.caption("Preview of all dirty input tables in the selected dataset.")

    # Expanders run their body even when collapsed, so only load the table the
    # user explicitly asks to preview.
    preview_table = st.selectbox(
        "Preview table", ["—"] + list(tables), key="io_preview_table"
    )
    if preview_table != "—":
        dirty_path = os.path.join(datasets_path, preview_table, "dirty.csv")
        try:
            df_dirty = read_csv_cached(dirty_path, dtype=str, keep_default_na=False)
            st.markdown(
                f"**Rows:** {len(df_dirty)} · **Columns:** {len(df_dirty.columns)}"
            )
            st.dataframe(df_dirty, use_container_width=True, height=300)
        except Exception as e:
            st.error(f"Could not load {dirty_path}: {e}")
    else:
        st.caption(
            "Tables: " + ", ".join(f"`{t}`" for t in tables) if tables else "No tables."
        )

# ── TAB 2 — Side-by-side Dirty vs Clean ────────────────────────────────
with tab_compare:
    st.subheader("Dirty vs Clean Comparison")
    st.caption(
        "Select a table to see its dirty and clean versions side by side. "
        "Cells that differ are highlighted."
    )

    selected_table = st.selectbox("Select table", tables, key="io_compare_table")

    dirty_path = os.path.join(datasets_path, selected_table, "dirty.csv")
    clean_path = os.path.join(datasets_path, selected_table, "clean.csv")

    if not os.path.isfile(clean_path):
        st.warning(f"No clean.csv found for **{selected_table}**.")
    else:
        df_dirty = read_csv_cached(dirty_path, dtype=str, keep_default_na=False)
        df_clean = read_csv_cached(clean_path, dtype=str, keep_default_na=False)

        # Compute cell-level differences
        diff_mask = df_dirty.ne(df_clean)
        n_errors = int(diff_mask.sum().sum())
        total_cells = df_dirty.shape[0] * df_dirty.shape[1]
        pct = (n_errors / total_cells * 100) if total_cells else 0

        col_m1, col_m2, col_m3 = st.columns(3)
        col_m1.metric("Total Cells", f"{total_cells:,}")
        col_m2.metric("Differing Cells", f"{n_errors:,}")
        col_m3.metric("Error Rate", f"{pct:.2f}%")

        col_left, col_right = st.columns(2)

        def _diff_styles(color):
            css = np.where(diff_mask.to_numpy(), f"background-color: {color};", "")
            return pd.DataFrame(css, index=diff_mask.index, columns=diff_mask.columns)

        dirty_styles = _diff_styles("rgba(231, 76, 60, 0.30)")
        clean_styles = _diff_styles("rgba(46, 204, 113, 0.30)")

        with col_left:
            st.markdown(
                '<div class="dirty-panel"><div class="dirty-panel-header">🔴 Dirty Table</div></div>',
                unsafe_allow_html=True,
            )
            styled_dirty = df_dirty.style.apply(lambda _: dirty_styles, axis=None)
            st.dataframe(styled_dirty, use_container_width=True, height=400)

        with col_right:
            st.markdown(
                '<div class="clean-panel"><div class="clean-panel-header">🟢 Clean Table</div></div>',
                unsafe_allow_html=True,
            )
            styled_clean = df_clean.style.apply(lambda _: clean_styles, axis=None)
            st.dataframe(styled_clean, use_container_width=True, height=400)

# ── Next button → Configurations ────────────────────────────────────────
st.markdown("---")
col_l, col_c, col_r = st.columns([2, 1, 2])
with col_c:
    if st.button("Next → Configurations", use_container_width=True):
        st.switch_page("pages/Configurations.py")
