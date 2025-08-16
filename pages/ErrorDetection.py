import json
import os

import pandas as pd
import streamlit as st
from backend import backend_pull_errors
from components import apply_base_styles, render_inline_restart_button, render_sidebar

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

# Check if propagation results exist
if "propagation_results" not in st.session_state:
    st.warning(
        "⚠️ No propagation results found. Please complete the label propagation step first."
    )
    if st.button("Go back to Propagated Errors"):
        st.switch_page("pages/PropagatedErrors.py")
    st.stop()

# Initialize error detection state
if "error_detection_completed" not in st.session_state:
    st.session_state.error_detection_completed = False


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


# Main interface
st.markdown("### 🤖 Machine Learning Error Detection")
st.markdown(
    "Run the error detection classifier to automatically detect errors in your dataset based on the propagated labels."
)

# Show propagation summary
propagation_results = st.session_state.propagation_results
total_labeled = len(propagation_results.get("labeled_cells", []))
total_propagated = sum(
    len(cell.get("propagated_cells", []))
    for cell in propagation_results.get("labeled_cells", [])
)

st.info(
    f"📊 Ready to run error detection with {total_labeled} labeled cells and {total_propagated} propagated labels"
)

# Run Error Detection Button
if not st.session_state.error_detection_completed:
    if st.button("▶️ Run Error Detection", type="primary"):
        with st.spinner(
            "🔍 Training classifiers and detecting errors... This may take a moment..."
        ):
            try:
                # Run the error detection pipeline
                results = backend_pull_errors(selected_dataset)

                if results and results.get("propagated_errors"):
                    st.session_state.error_detection_results = results
                    st.session_state.error_detection_completed = True
                    st.success("✅ Error detection completed successfully!")
                    st.rerun()
                else:
                    st.error(
                        "❌ Error detection failed. Please check the logs for details."
                    )

            except Exception as e:
                st.error(f"❌ Error occurred during error detection: {str(e)}")

# Display results if error detection is completed
if (
    st.session_state.error_detection_completed
    and "error_detection_results" in st.session_state
):
    results = st.session_state.error_detection_results
    propagated_errors = results.get("propagated_errors", {})
    metrics = results.get("metrics", {})

    # Display metrics
    st.markdown("### 📈 Detection Metrics")
    col1, col2, col3, col4 = st.columns(4)

    with col1:
        st.metric("Precision", f"{metrics.get('precision', 0):.3f}")
    with col2:
        st.metric("Recall", f"{metrics.get('recall', 0):.3f}")
    with col3:
        st.metric("F1 Score", f"{metrics.get('f1', 0):.3f}")
    with col4:
        st.metric("Fold Influence", f"{metrics.get('fold_label_influence', 0):.3f}")

    # Display detected errors in tables
    st.markdown("### 🔍 Detected Errors")

    if propagated_errors:
        st.markdown(
            "The intensity of the red highlighting indicates the confidence level of the error detection (darker = higher confidence)"
        )

        for table, errors in propagated_errors.items():
            with st.expander(f"📊 {table} ({len(errors)} potential errors)"):
                styled_df = display_table_with_errors(table, errors)
                if styled_df is not None:
                    st.dataframe(styled_df, use_container_width=True)

                    # Display error details
                    st.markdown("#### Error Details:")
                    for i, error in enumerate(errors):
                        confidence_percentage = int(error["confidence"] * 100)
                        source = error.get("source", "Unknown")
                        st.markdown(f"""
                        **Error {i + 1}:**
                        - **Cell**: Row {error["row"]}, Column `{error["col"]}`
                        - **Value**: `{error["val"]}`
                        - **Confidence**: {confidence_percentage}%
                        - **Source**: {source}
                        """)
                        if i < len(errors) - 1:
                            st.markdown("---")
    else:
        st.info("🎉 No errors detected in the dataset!")

    # Reset button for re-running detection
    st.markdown("---")
    if st.button("🔄 Re-run Error Detection"):
        st.session_state.error_detection_completed = False
        if "error_detection_results" in st.session_state:
            del st.session_state.error_detection_results
        st.rerun()

# Navigation
st.markdown("---")
if st.session_state.error_detection_completed:
    if st.button("Next: View Results"):
        st.switch_page("pages/Results.py")
else:
    st.markdown("*Complete error detection to proceed to results.*")
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

st.markdown("---")
nav_cols = st.columns([1, 1, 1], gap="small")

# Restart: confirmation dialog to go to app.py
with nav_cols[0]:
    render_inline_restart_button(page_id="error_detection", use_container_width=True)

# Back: to Propagated Errors
if nav_cols[1].button("Back", key="err_back", use_container_width=True):
    st.switch_page("pages/PropagatedErrors.py")

# Next: to Results
if nav_cols[2].button("Next", key="err_next", use_container_width=True):
    st.switch_page("pages/Results.py")
