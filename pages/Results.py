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
st.write("### Model Performance Metrics")


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

    if results:
        latest_result = results[-1]
        metrics = latest_result.get("metrics", {})
        recall_score = metrics.get("Recall", 0)
        f1_score = metrics.get("F1", 0)
        precision_score = metrics.get("Precision", 0)
        current_time = latest_result.get(
            "Time", datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        )
    else:
        recall_score = 0
        f1_score = 0
        precision_score = 0
        current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
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
        st.metric(label="Recall", value=f"{recall_score:.2f}")
    with col2:
        st.metric(label="F1 Score", value=f"{f1_score:.2f}")
    with col3:
        st.metric(label="Precision", value=f"{precision_score:.2f}")
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

# ---------------- ALL DATASETS ----------------
all_rows = []
for pipeline in os.listdir(pipelines_folder):
    pipeline_dir = os.path.join(pipelines_folder, pipeline)
    if os.path.isdir(pipeline_dir):
        cfg = load_config(os.path.join(pipeline_dir, "configurations.json"))
        labeling_budget = cfg.get("labeling_budget", "")
        selected_dataset = cfg.get("selected_dataset", "")
        results_list = cfg.get("results", [])
        for res in results_list:
            metrics = res.get("metrics", {})
            row = {
                "Time": res.get("Time", ""),
                "Pipeline Name": pipeline,
                "Dataset": selected_dataset,
                "Labeling Budget": labeling_budget,
                "Recall": metrics.get("Recall", ""),
                "F1": metrics.get("F1", ""),
                "Precision": metrics.get("Precision", ""),
            }
            all_rows.append(row)

found_current_all = any(
    row["Pipeline Name"] == current_pipeline_name and row["Time"] == current_time
    for row in all_rows
)
# Only synthesize a current row across all datasets when there is no match AND pipeline isn't marked dirty
if not found_current_all and results and not dirty:
    current_cfg_all = load_config(
        os.path.join(current_pipeline_path, "configurations.json")
    )
    current_labeling_budget_all = current_cfg_all.get("labeling_budget", "")
    current_row_all = {
        "Time": current_time,
        "Pipeline Name": current_pipeline_name,
        "Dataset": current_dataset,
        "Labeling Budget": current_labeling_budget_all,
        "Recall": recall_score,
        "F1": f1_score,
        "Precision": precision_score,
    }
    all_rows = [
        r
        for r in all_rows
        if not (
            r["Pipeline Name"] == current_pipeline_name
            and r["Time"].split(" ")[0] == current_time.split(" ")[0]
        )
    ]
    all_rows.append(current_row_all)

all_df = pd.DataFrame(all_rows)
for col in ["Recall", "F1", "Precision", "Labeling Budget"]:
    if col in all_df.columns:
        all_df[col] = pd.to_numeric(all_df[col], errors="coerce").round(2)
all_df = all_df.sort_values(by="Time", ascending=False)

styled_all_df = all_df.style.apply(highlight_current, axis=1).format(
    {
        "Recall": "{:.2f}",
        "F1": "{:.2f}",
        "Precision": "{:.2f}",
        "Labeling Budget": "{:}",
    }
)

st.markdown("---")
st.markdown("#### Result Comparison (All Pipelines/Datasets)")
st.write("_(Click on column headers to sort the table.)_")
st.dataframe(styled_all_df)

# Interactive graphs for all datasets/pipelines comparison
if not all_df.empty and len(all_df) > 1:
    st.markdown("---")
    st.markdown("#### Performance vs Labeling Budget")

    # Ensure numeric and sorted budgets for clean X-axis
    if "Labeling Budget" in all_df.columns:
        all_df["Labeling Budget"] = pd.to_numeric(
            all_df["Labeling Budget"], errors="coerce"
        )

    # Build three separate line charts with legends per pipeline
    metrics_to_plot = [
        ("F1", "F1 Score"),
        ("Precision", "Precision"),
        ("Recall", "Recall"),
    ]

    for metric_key, metric_label in metrics_to_plot:
        # Pivot so each pipeline is a separate series (legend), X = Labeling Budget
        if (
            metric_key in all_df.columns
            and "Pipeline Name" in all_df.columns
            and "Labeling Budget" in all_df.columns
        ):
            pivot_df = all_df.pivot_table(
                index="Labeling Budget",
                columns="Pipeline Name",
                values=metric_key,
                aggfunc="mean",
            ).sort_index()

            if not pivot_df.empty:
                st.markdown(f"##### {metric_label} vs Labeling Budget")
                st.caption(f"X-axis: Labeling Budget | Y-axis: {metric_label}")
                # Streamlit will render a legend using the column names (pipeline names)
                st.line_chart(pivot_df, use_container_width=True)


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
