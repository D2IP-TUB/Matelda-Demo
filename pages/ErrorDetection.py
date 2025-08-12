import json
import os

import pandas as pd
import streamlit as st
from backend import backend_pull_errors
from components import apply_base_styles, render_sidebar

# Set the page title and layout
st.set_page_config(page_title="Error Detection", layout="wide")
st.title("Error Detection")

# Apply base styles
apply_base_styles()

# Sidebar navigation
render_sidebar()

# ---------------------------------------------------------------------------
# Determine the selected dataset, loading from the pipeline configuration if
# available. Warn the user if no dataset is configured.
# ---------------------------------------------------------------------------
if "dataset_select" not in st.session_state and "pipeline_path" in st.session_state:
    cfg_path = os.path.join(st.session_state.pipeline_path, "configurations.json")
    if os.path.exists(cfg_path):
        with open(cfg_path) as f:
            cfg = json.load(f)
        selected = cfg.get("selected_dataset")
        if selected:
            st.session_state.dataset_select = selected

if "dataset_select" not in st.session_state:
    st.warning("⚠️ Dataset not configured.")
    if st.button("Go back to Configurations"):
        st.switch_page("pages/Configurations.py")
    st.stop()

selected_dataset = st.session_state.dataset_select
datasets_path = os.path.join(os.path.dirname(__file__), "../datasets", selected_dataset)


# Function to load and display table with propagated errors
def display_table_with_errors(table_name, error_cells):
    file_path = os.path.join(datasets_path, table_name, "dirty.csv")
    try:
        df = pd.read_csv(file_path)
    except Exception as e:
        st.error(f"Could not load {file_path}: {e}")
        return

    # Define a style function to highlight the error cells with confidence
    def highlight_errors(data):
        df_styles = pd.DataFrame("", index=data.index, columns=data.columns)
        for error in error_cells:
            try:
                confidence = error["confidence"]
                # Convert confidence to color intensity (higher confidence = more intense red)
                color_intensity = int(255 * (1 - confidence))
                color = f"rgb(255, {color_intensity}, {color_intensity})"
                df_styles.iloc[error["row"], data.columns.get_loc(error["col"])] = (
                    f"background-color: {color}; color: white"
                )
            except Exception:
                continue
        return df_styles

    # Apply styling and display
    styled_df = df.style.apply(highlight_errors, axis=None)
    return styled_df


# Display loading message
with st.spinner("🔍 Searching for possible errors in the datasets..."):
    # Get errors using the new backend function
    results = backend_pull_errors(selected_dataset)
    propagated_errors = results["propagated_errors"]

    # Display tables with propagated errors
    st.markdown("### 🔍 Detected Errors")
    st.markdown(
        "The intensity of the red highlighting indicates the confidence level of the error detection (darker = higher confidence)"
    )

    for table, errors in propagated_errors.items():
        with st.expander(f"📊 {table} ({len(errors)} potential errors)"):
            styled_df = display_table_with_errors(table, errors)
            if styled_df is not None:
                st.dataframe(styled_df)

                # Display error details
                st.markdown("#### Error Details:")
                for error in errors:
                    confidence_percentage = int(error["confidence"] * 100)
                    source = error.get("source", "Unknown")
                    st.markdown(f"""
                    - **Cell**: Row {error["row"]}, Column `{error["col"]}`
                    - **Value**: `{error["val"]}`
                    - **Confidence**: {confidence_percentage}%
                    - **Source**: {source}
                    ---
                    """)

# Navigation button to move to the next page
if st.button("Next"):
    st.switch_page("pages/Results.py")
