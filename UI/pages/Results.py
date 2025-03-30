import streamlit as st
import random
import os
import json
import datetime
import pandas as pd

# Hide default Streamlit menu
st.markdown(
    """
    <style>
        [data-testid="stSidebarNav"] {display: none;}
    </style>
    """,
    unsafe_allow_html=True,
)

# Sidebar navigation links
with st.sidebar:
    st.page_link("app.py", label="Matelda")
    st.page_link("pages/Configurations.py", label="Configurations")
    st.page_link("pages/DomainBasedFolding.py", label="Domain Based Folding")
    st.page_link("pages/QualityBasedFolding.py", label="Quality Based Folding")
    st.page_link("pages/Labeling.py", label="Labeling")
    st.page_link("pages/ErrorDetection.py", label="Error Detection")
    st.page_link("pages/Results.py", label="Results")

st.title("Results")
st.write("### Model Performance Metrics")

# Generate current metrics
recall_score = round(random.uniform(0.7, 0.95), 2)
f1_score = round(random.uniform(0.65, 0.92), 2)
precision_score = round(random.uniform(0.75, 0.96), 2)
current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

# Display current metrics in columns
col1, col2, col3 = st.columns(3)
with col1:
    st.metric(label="Recall", value=f"{recall_score:.2f}")
with col2:
    st.metric(label="F1 Score", value=f"{f1_score:.2f}")
with col3:
    st.metric(label="Precision", value=f"{precision_score:.2f}")

# Save Result button positioned immediately after metrics
if st.button("Save Result"):
    if "pipeline_path" in st.session_state:
        pipeline_config_path = os.path.join(st.session_state.pipeline_path, "configurations.json")
        config = {}
        if os.path.exists(pipeline_config_path):
            with open(pipeline_config_path, "r") as f:
                config = json.load(f)
        historical_results = config.get("results", [])
        new_result = {
            "Time": current_time,
            "Recall": recall_score,
            "F1": f1_score,
            "Precision": precision_score
        }
        historical_results.append(new_result)
        config["results"] = historical_results
        with open(pipeline_config_path, "w") as f:
            json.dump(config, f, indent=4)
        st.success("Result saved!")
        st.rerun()  # Refresh the page to update the table
    else:
        st.warning("No pipeline selected; result not saved.")

# -----------------------------------------------------------------------------
# Ensure that the current dataset is defined in session state.
# -----------------------------------------------------------------------------
current_dataset = st.session_state.get("dataset_select", None)
if not current_dataset and "pipeline_path" in st.session_state:
    pipeline_config_path = os.path.join(st.session_state.pipeline_path, "configurations.json")
    if os.path.exists(pipeline_config_path):
        with open(pipeline_config_path, "r") as f:
            config = json.load(f)
        current_dataset = config.get("selected_dataset", None)
        if current_dataset:
            st.session_state.dataset_select = current_dataset

if not current_dataset:
    st.warning("No dataset defined in session state.")
    st.stop()

# -----------------------------------------------------------------------------
# Build the results comparison table from pipelines using the same dataset.
# -----------------------------------------------------------------------------
current_pipeline_path = st.session_state.pipeline_path
current_pipeline_name = os.path.basename(current_pipeline_path)
pipelines_folder = os.path.join(os.path.dirname(__file__), "../pipelines")

same_dataset_rows = []
for pipeline in os.listdir(pipelines_folder):
    pipeline_dir = os.path.join(pipelines_folder, pipeline)
    if os.path.isdir(pipeline_dir):
        config_path = os.path.join(pipeline_dir, "configurations.json")
        if os.path.exists(config_path):
            with open(config_path, "r") as f:
                cfg = json.load(f)
            # Only include pipelines that use the same dataset.
            if cfg.get("selected_dataset") == current_dataset:
                labeling_budget = cfg.get("labeling_budget", "")
                results_list = cfg.get("results", [])
                for res in results_list:
                    row = {
                        "Time": res.get("Time", ""),
                        "Pipeline Name": pipeline,
                        "Labeling Budget": labeling_budget,
                        "Recall": res.get("Recall", ""),
                        "F1": res.get("F1", ""),
                        "Precision": res.get("Precision", "")
                    }
                    same_dataset_rows.append(row)

# If the current run is not yet in the same-dataset results, add it.
found_current = any(
    row["Pipeline Name"] == current_pipeline_name and row["Time"] == current_time
    for row in same_dataset_rows
)
if not found_current:
    current_config = {}
    current_config_path = os.path.join(current_pipeline_path, "configurations.json")
    if os.path.exists(current_config_path):
        with open(current_config_path, "r") as f:
            current_config = json.load(f)
    current_labeling_budget = current_config.get("labeling_budget", "")
    current_row = {
        "Time": current_time,
        "Pipeline Name": current_pipeline_name,
        "Labeling Budget": current_labeling_budget,
        "Recall": recall_score,
        "F1": f1_score,
        "Precision": precision_score
    }
    same_dataset_rows.append(current_row)

same_dataset_df = pd.DataFrame(same_dataset_rows)
# Convert numeric columns and round to 2 decimals
for col in ["Recall", "F1", "Precision", "Labeling Budget"]:
    if col in same_dataset_df.columns:
        same_dataset_df[col] = pd.to_numeric(same_dataset_df[col], errors="coerce").round(2)
same_dataset_df = same_dataset_df.sort_values(by="Time", ascending=False)

# Define styling function for current run.
def highlight_current(row):
    if row["Pipeline Name"] == current_pipeline_name and row["Time"] == current_time:
        return ['background-color: red'] * len(row)
    else:
        return [''] * len(row)

styled_same_dataset_df = same_dataset_df.style.apply(highlight_current, axis=1).format({
    "Recall": "{:.2f}",
    "F1": "{:.2f}",
    "Precision": "{:.2f}",
    "Labeling Budget": "{:}"
})

st.markdown("---")
st.markdown(f"#### Result Comparison (Dataset: {current_dataset}):")
st.write("_(Click on column headers to sort the table.)_")
st.dataframe(styled_same_dataset_df)

# -----------------------------------------------------------------------------
# Build the results comparison table from all pipelines (across all datasets).
# -----------------------------------------------------------------------------
all_rows = []
for pipeline in os.listdir(pipelines_folder):
    pipeline_dir = os.path.join(pipelines_folder, pipeline)
    if os.path.isdir(pipeline_dir):
        config_path = os.path.join(pipeline_dir, "configurations.json")
        if os.path.exists(config_path):
            with open(config_path, "r") as f:
                cfg = json.load(f)
            labeling_budget = cfg.get("labeling_budget", "")
            selected_dataset = cfg.get("selected_dataset", "")
            results_list = cfg.get("results", [])
            for res in results_list:
                row = {
                    "Time": res.get("Time", ""),
                    "Pipeline Name": pipeline,
                    "Dataset": selected_dataset,
                    "Labeling Budget": labeling_budget,
                    "Recall": res.get("Recall", ""),
                    "F1": res.get("F1", ""),
                    "Precision": res.get("Precision", "")
                }
                all_rows.append(row)

# If the current run is not yet in the all-pipelines results, add it.
found_current_all = any(
    row["Pipeline Name"] == current_pipeline_name and row["Time"] == current_time
    for row in all_rows
)
if not found_current_all:
    current_config = {}
    current_config_path = os.path.join(current_pipeline_path, "configurations.json")
    if os.path.exists(current_config_path):
        with open(current_config_path, "r") as f:
            current_config = json.load(f)
    current_labeling_budget = current_config.get("labeling_budget", "")
    current_row_all = {
        "Time": current_time,
        "Pipeline Name": current_pipeline_name,
        "Dataset": current_dataset,
        "Labeling Budget": current_labeling_budget,
        "Recall": recall_score,
        "F1": f1_score,
        "Precision": precision_score
    }
    all_rows.append(current_row_all)

all_df = pd.DataFrame(all_rows)
# Convert numeric columns and round to 2 decimals
for col in ["Recall", "F1", "Precision", "Labeling Budget"]:
    if col in all_df.columns:
        all_df[col] = pd.to_numeric(all_df[col], errors="coerce").round(2)
all_df = all_df.sort_values(by="Time", ascending=False)

styled_all_df = all_df.style.apply(highlight_current, axis=1).format({
    "Recall": "{:.2f}",
    "F1": "{:.2f}",
    "Precision": "{:.2f}",
    "Labeling Budget": "{:}"
})

st.markdown("---")
st.markdown("#### Result Comparison (All Pipelines/Datasets):")
st.write("_(Click on column headers to sort the table.)_")
st.dataframe(styled_all_df)

st.balloons()
