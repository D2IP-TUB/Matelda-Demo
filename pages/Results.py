import datetime
import json
import os

import pandas as pd
import streamlit as st
from components import (
    apply_base_styles,
    get_current_theme,
    render_inline_restart_button,
    render_sidebar,
)
from components.utils import is_pipeline_dirty
from streamlit_social_share import streamlit_social_share

# Set page config and apply base styles
st.set_page_config(page_title="Results", layout="wide")
apply_base_styles()

# Sidebar navigation
render_sidebar()

st.title("Results")
# st.write("### Model Performance Metrics")


def load_config(path):
    if os.path.exists(path):
        try:
            with open(path, "r") as f:
                return json.load(f)
        except json.JSONDecodeError:
            return {}
    return {}


if "pipeline_path" in st.session_state:
    current_pipeline_path = st.session_state.pipeline_path
    config_path = os.path.join(current_pipeline_path, "configurations.json")
    config = load_config(config_path)
    results = config.get("results", [])
    current_labeling_budget = config.get("labeling_budget", "N/A")

    # Try to get metrics from error detection results first (most recent)
    recall_score = 0
    f1_score = 0
    precision_score = 0
    current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Check if we have fresh error detection results in session state
    if "error_detection_results" in st.session_state:
        error_results = st.session_state.error_detection_results
        metrics = error_results.get("metrics", {})

        # Handle both lowercase and capitalized metric keys
        precision_score = metrics.get("precision", metrics.get("Precision", 0))
        recall_score = metrics.get("recall", metrics.get("Recall", 0))
        f1_score = metrics.get("f1", metrics.get("F1", 0))

        # Save these results to configuration if not already saved
        if results:
            latest_result = results[-1]
            latest_time = latest_result.get("Time", "")
            today = datetime.datetime.now().strftime("%Y-%m-%d")
            if not latest_time.startswith(today):
                # Add today's results
                new_result = {
                    "Time": current_time,
                    "metrics": {
                        "Precision": precision_score,
                        "Recall": recall_score,
                        "F1": f1_score,
                    },
                }
                results.append(new_result)
                config["results"] = results
                with open(config_path, "w") as f:
                    json.dump(config, f, indent=2)
        else:
            # No results yet, create first entry
            new_result = {
                "Time": current_time,
                "metrics": {
                    "Precision": precision_score,
                    "Recall": recall_score,
                    "F1": f1_score,
                },
            }
            config["results"] = [new_result]
            with open(config_path, "w") as f:
                json.dump(config, f, indent=2)

    elif results:
        # Fallback to saved results
        latest_result = results[-1]
        metrics = latest_result.get("metrics", {})
        recall_score = metrics.get("Recall", metrics.get("recall", 0))
        f1_score = metrics.get("F1", metrics.get("f1", 0))
        precision_score = metrics.get("Precision", metrics.get("precision", 0))
        current_time = latest_result.get(
            "Time", datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        )
else:
    st.warning("⚠️ Pipeline not configured.")
    if st.button("Go back to Configurations"):
        st.switch_page("pages/Configurations.py")
    st.stop()

st.write("### Model Performance Metrics")
col1, col2, col3, col4 = st.columns(4)

# -----------------------------------------------------------------------------
# Ensure that the current dataset is defined in session state.
# -----------------------------------------------------------------------------
current_dataset = st.session_state.get("dataset_select", None)
if not current_dataset and "pipeline_path" in st.session_state:
    cfg = load_config(
        os.path.join(st.session_state.pipeline_path, "configurations.json")
    )
    current_dataset = cfg.get("selected_dataset", None)
    if current_dataset:
        st.session_state.dataset_select = current_dataset

dataset_configured = current_dataset is not None

dirty = is_pipeline_dirty()
# if dirty:
# st.info("Pipeline changed earlier in this session. Showing last saved results; rerun steps to refresh metrics.")

if dataset_configured:
    with col1:
        st.metric(label="Precision", value=f"{precision_score:.2f}")
    with col2:
        st.metric(label="Recall", value=f"{recall_score:.2f}")
    with col3:
        st.metric(label="F1 Score", value=f"{f1_score:.2f}")
    with col4:
        st.metric(label="Labeling Budget", value=str(current_labeling_budget))
else:
    with col1:
        st.warning("⚠️ Pipeline not configured.")
        if st.button("Go back to Configurations"):
            st.switch_page("pages/Configurations.py")
    col2.empty()
    col3.empty()
    col4.empty()

current_pipeline_name = os.path.basename(current_pipeline_path)
pipelines_folder = os.path.join(os.path.dirname(__file__), "../pipelines")

# Get the current theme to extract primary color
current_theme = get_current_theme()
primary_color = current_theme.get("primaryColor", "#f4b11c").strip()


def highlight_current(row):
    if row["Pipeline Name"] == current_pipeline_name and row["Time"] == current_time:
        return [f"background-color: {primary_color}"] * len(row)
    else:
        return [""] * len(row)


if dataset_configured:
    same_dataset_rows = []
    for pipeline in os.listdir(pipelines_folder):
        pipeline_dir = os.path.join(pipelines_folder, pipeline)
        if os.path.isdir(pipeline_dir):
            cfg = load_config(os.path.join(pipeline_dir, "configurations.json"))
            if cfg.get("selected_dataset") == current_dataset:
                labeling_budget = cfg.get("labeling_budget", "")
                results_list = cfg.get("results", [])
                for res in results_list:
                    metrics = res.get("metrics", {})
                    row = {
                        "Time": res.get("Time", ""),
                        "Pipeline Name": pipeline,
                        "Labeling Budget": labeling_budget,
                        "Recall": metrics.get("Recall", ""),
                        "F1": metrics.get("F1", ""),
                        "Precision": metrics.get("Precision", ""),
                    }
                    same_dataset_rows.append(row)

    found_current = any(
        row["Pipeline Name"] == current_pipeline_name and row["Time"] == current_time
        for row in same_dataset_rows
    )
    # Only synthesize a current row when we have no match AND pipeline isn't marked dirty
    if not found_current and results and not dirty:
        current_cfg = load_config(
            os.path.join(current_pipeline_path, "configurations.json")
        )
        current_labeling_budget = current_cfg.get("labeling_budget", "")
        current_row = {
            "Time": current_time,
            "Pipeline Name": current_pipeline_name,
            "Labeling Budget": current_labeling_budget,
            "Recall": recall_score,
            "F1": f1_score,
            "Precision": precision_score,
        }
        same_dataset_rows = [
            r
            for r in same_dataset_rows
            if not (
                r["Pipeline Name"] == current_pipeline_name
                and r["Time"].split(" ")[0] == current_time.split(" ")[0]
            )
        ]
        same_dataset_rows.append(current_row)

    same_dataset_df = pd.DataFrame(same_dataset_rows)
    for col in ["Recall", "F1", "Precision", "Labeling Budget"]:
        if col in same_dataset_df.columns:
            same_dataset_df[col] = pd.to_numeric(
                same_dataset_df[col], errors="coerce"
            ).round(2)
    same_dataset_df = same_dataset_df.sort_values(by="Time", ascending=False)

    styled_same_dataset_df = same_dataset_df.style.apply(
        highlight_current, axis=1
    ).format(
        {
            "Recall": "{:.2f}",
            "F1": "{:.2f}",
            "Precision": "{:.2f}",
            "Labeling Budget": "{:}",
        }
    )

    st.markdown("---")
    st.markdown(f"#### Result Comparison (Dataset: {current_dataset})")
    st.write("_(Click on column headers to sort the table.)_")
    st.dataframe(styled_same_dataset_df)

st.markdown("---")

# ---------------- RAHA BASELINE COMPARISON ----------------
st.markdown("#### 📊 Baseline Comparison: Raha Requirements")

# Count the number of tables in the current dataset
if current_dataset:
    datasets_path = os.path.join(os.path.dirname(__file__), "..", "datasets")
    dataset_path = os.path.join(datasets_path, current_dataset)

    if os.path.exists(dataset_path):
        subdirs = [
            f
            for f in os.listdir(dataset_path)
            if os.path.isdir(os.path.join(dataset_path, f))
        ]
        table_count = len(subdirs)

        st.markdown("""
        **One-table error detection with Raha doesn’t work unless each table has at least two labeled tuples. For this dataset, that means a minimum of 94 labeled cells (2 × 47 tables). If you randomly distribute labeling budgets across tables, Raha gives the following results:**
        """)

        # Load Raha baseline results
        try:
            raha_results_path = os.path.join(
                os.path.dirname(__file__), "..", "raha_baseline_results.csv"
            )
            raha_df = pd.read_csv(raha_results_path)

            # Find the closest budget match or interpolate
            current_budget_int = (
                int(current_labeling_budget)
                if str(current_labeling_budget).isdigit()
                else 0
            )

            if current_budget_int > 0:
                # Find exact match or closest budget
                closest_row = raha_df.iloc[
                    (raha_df["labeling_budget"] - current_budget_int)
                    .abs()
                    .argsort()[:1]
                ]

                if not closest_row.empty:
                    closest_budget = closest_row["labeling_budget"].iloc[0]
                    raha_precision = closest_row["precision"].iloc[0]
                    raha_recall = closest_row["recall"].iloc[0]
                    raha_f1 = closest_row["f_score"].iloc[0]

                    st.markdown(f"""
                    **Raha Baseline Results** (closest budget: {closest_budget} labels):
                    """)

                    # Display Raha baseline metrics
                    col1, col2, col3, col4 = st.columns(4)

                    with col1:
                        st.metric(
                            "Raha Precision",
                            f"{raha_precision:.3f}",
                            help="Raha baseline precision",
                        )
                    with col2:
                        st.metric(
                            "Raha Recall",
                            f"{raha_recall:.3f}",
                            help="Raha baseline recall",
                        )
                    with col3:
                        st.metric(
                            "Raha F1-Score",
                            f"{raha_f1:.3f}",
                            help="Raha baseline F1-score",
                        )
                    with col4:
                        # Calculate improvement over Raha baseline
                        if f1_score > 0:
                            improvement = (
                                ((f1_score - raha_f1) / raha_f1) * 100
                                if raha_f1 > 0
                                else 0
                            )
                            st.metric(
                                "Your Improvement",
                                f"{improvement:+.1f}%",
                                help="Your F1-score improvement over Raha baseline",
                            )
                        else:
                            st.metric(
                                "Your F1-Score",
                                f"{f1_score:.3f}",
                                help="Your current F1-score",
                            )

                    # Show detailed comparison table
                    with st.expander("📊 View Complete Raha Baseline Results"):
                        st.dataframe(raha_df, use_container_width=True)

                    st.info(
                        f"💡 **Budget Comparison**: Raha baseline requires {2 * table_count} labels vs. your current budget of {current_labeling_budget}"
                    )
                else:
                    st.warning("⚠️ Could not find matching Raha baseline results")
            else:
                st.warning("⚠️ Invalid labeling budget for Raha comparison")

        except Exception as e:
            st.error(f"❌ Could not load Raha baseline results: {e}")
            # Fallback to showing the requirement only
            st.info(
                f"💡 **Budget Requirement**: Raha baseline requires {2 * table_count} labels vs. your current budget of {current_labeling_budget}"
            )
    else:
        st.warning("⚠️ Could not analyze dataset structure for Raha comparison")
else:
    st.warning("⚠️ No dataset selected for Raha comparison")

st.markdown("---")


def show_ground_truth_table():
    """Display a table comparing user labels with ground truth - show how well the user did!"""
    try:
        # Load user labels from saved CSV file
        if "pipeline_path" not in st.session_state:
            st.error(
                "❌ No pipeline path found. Please complete the labeling step first."
            )
            return

        labels_file = os.path.join(st.session_state.pipeline_path, "user_labels.csv")

        if not os.path.exists(labels_file):
            st.error(
                "❌ No saved user labels found. Please complete the labeling step first."
            )
            st.info(
                "💡 Labels are automatically saved when you click 'Next' in the Labeling page."
            )
            return

        # Read user labels from CSV
        user_labels_df = pd.read_csv(labels_file)

        # Load ground truth data from CSV files
        ground_truth_lookup = {}

        if current_dataset:
            datasets_path = os.path.join(os.path.dirname(__file__), "..", "datasets")
            dataset_path = os.path.join(datasets_path, current_dataset)

            if os.path.exists(dataset_path):
                subdirs = [
                    f
                    for f in os.listdir(dataset_path)
                    if os.path.isdir(os.path.join(dataset_path, f))
                ]

                for subdir in subdirs:
                    subdir_path = os.path.join(dataset_path, subdir)
                    subdir_files = os.listdir(subdir_path)

                    if "dirty.csv" in subdir_files and "clean.csv" in subdir_files:
                        try:
                            dirty_df = pd.read_csv(
                                os.path.join(subdir_path, "dirty.csv")
                            )
                            clean_df = pd.read_csv(
                                os.path.join(subdir_path, "clean.csv")
                            )

                            if len(dirty_df.columns) == len(clean_df.columns):
                                dirty_df.columns = clean_df.columns
                                table_id = subdir

                                for col_idx, col_name in enumerate(dirty_df.columns):
                                    for row_idx in range(
                                        min(len(dirty_df), len(clean_df))
                                    ):
                                        dirty_val = (
                                            str(dirty_df.iloc[row_idx, col_idx])
                                            if pd.notna(dirty_df.iloc[row_idx, col_idx])
                                            else ""
                                        )
                                        clean_val = (
                                            str(clean_df.iloc[row_idx, col_idx])
                                            if pd.notna(clean_df.iloc[row_idx, col_idx])
                                            else ""
                                        )

                                        key = (table_id, row_idx, col_name)
                                        ground_truth_lookup[key] = {
                                            "is_error": dirty_val != clean_val,
                                            "clean_value": clean_val,
                                        }
                        except Exception as e:
                            st.warning(f"⚠️ Could not load CSV files from {subdir}: {e}")

        if not ground_truth_lookup:
            st.error("❌ Could not load ground truth data. Cannot perform comparison.")
            return

        # Compare user labels with ground truth
        comparison_data = []
        matched_count = 0

        for _, row in user_labels_df.iterrows():
            table_id = row.get("table")
            row_idx = row.get("row")
            col_name = row.get("col")
            user_label = row.get("is_error", False)
            cell_value = row.get("val", "")

            if table_id and row_idx is not None and col_name:
                key = (table_id, row_idx, col_name)

                if key in ground_truth_lookup:
                    matched_count += 1
                    ground_truth_is_error = ground_truth_lookup[key]["is_error"]
                    clean_value = ground_truth_lookup[key]["clean_value"]

                    is_correct = user_label == ground_truth_is_error

                    comparison_data.append(
                        {
                            "Table": table_id,
                            "Row": row_idx,
                            "Column": col_name,
                            "Cell Value": cell_value,
                            "Clean Value": clean_value,
                            "Ground Truth": "Error"
                            if ground_truth_is_error
                            else "Correct",
                            "Your Label": "Error" if user_label else "Correct",
                            "Result": "✅ Correct" if is_correct else "❌ Incorrect",
                            "Correct": is_correct,
                        }
                    )

        if not comparison_data:
            st.error("❌ No matching ground truth found for your labeled cells.")
            return

        # Convert to DataFrame and show results
        df = pd.DataFrame(comparison_data)
        correct_count = sum(df["Correct"])
        total_count = len(df)
        accuracy = correct_count / total_count if total_count > 0 else 0

        # Performance summary
        st.markdown("### 🎯 Your Labeling Performance")
        col1, col2, col3 = st.columns(3)

        with col1:
            st.metric("Total Cells Labeled", total_count)
        with col2:
            st.metric("Correct Labels", correct_count)
        with col3:
            st.metric("Your Accuracy", f"{accuracy:.1%}")

        st.markdown("---")

        # Style the dataframe
        def style_results(row):
            row_idx = row.name
            is_correct = df.iloc[row_idx]["Correct"]
            if is_correct:
                return ["background-color: #d4edda"] * len(row)
            else:
                return ["background-color: #f8d7da"] * len(row)

        # Display the comparison table
        st.markdown("#### 📊 Detailed Comparison: Your Labels vs Ground Truth")
        st.markdown("*Green rows = You got it right! Red rows = You got it wrong.*")

        display_cols = [
            "Table",
            "Row",
            "Column",
            "Cell Value",
            "Clean Value",
            "Ground Truth",
            "Your Label",
            "Result",
        ]
        display_df = df[display_cols].copy()

        try:
            styled_df = display_df.style.apply(style_results, axis=1)
            st.dataframe(styled_df, use_container_width=True)
        except Exception as e:
            st.error(f"Error styling table: {e}")
            st.dataframe(display_df, use_container_width=True)

        # Export option
        if st.button("📥 Export Your Results"):
            csv = df.to_csv(index=False)
            timestamp = pd.Timestamp.now().strftime("%Y%m%d_%H%M%S")
            filename = f"user_labeling_results_{current_dataset}_{timestamp}.csv"
            st.download_button("Download Results as CSV", csv, filename, "text/csv")

    except Exception as e:
        st.error(f"Error generating comparison: {str(e)}")


if dataset_configured and "propagation_results" in st.session_state:
    st.markdown("### 🔍 Label Analysis")

    if st.button(
        "Check My Labeling Accuracy",
        help="See how well your manual labels match the ground truth data",
    ):
        show_ground_truth_table()

st.markdown("---")

# Social Share Section (only if dataset is configured)
if dataset_configured:
    st.markdown("### 📤 Share Your Results")
    st.markdown("Share your Matelda performance metrics with the community!")

    # Create share text with more detailed information
    share_text = (
        f"🎯 Just achieved some great results with Matelda! "
        f"📊 Recall: {recall_score:.2f} | F1: {f1_score:.2f} | Precision: {precision_score:.2f} "
        f"� Budget: {current_labeling_budget} | "
        f"�📈 Dataset: {current_dataset} | Pipeline: {current_pipeline_name} "
        f"#ErrorDetection #DataCleaning #D2IP #TUB #VLDB"
    )

    current_url = "https://www.tu.berlin/d2ip"

    shared = streamlit_social_share(
        text=share_text,
        url=current_url,
        networks=["linkedin", "reddit", "email", "whatsapp", "telegram"],
        key="shared",
    )

    st.markdown("**📋 Copy Share Text:**")
    st.code(share_text, language=None)

st.balloons()

# Navigation: Restart | Back (no Next since this is the final page)
st.markdown("---")
nav_cols = st.columns([1, 1, 1], gap="small")

# Restart: confirmation dialog to go to app.py
with nav_cols[0]:
    render_inline_restart_button(page_id="results", use_container_width=True)

# Back: to Error Detection
if nav_cols[1].button("Back", key="results_back", use_container_width=True):
    st.switch_page("pages/ErrorDetection.py")
