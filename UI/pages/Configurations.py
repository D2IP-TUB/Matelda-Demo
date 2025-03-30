import json
import os

import streamlit as st

# Hide default Streamlit menu
st.markdown(
    """
    <style>
        [data-testid="stSidebarNav"] {display: none;}
    </style>
    """,
    unsafe_allow_html=True,
)

with st.sidebar:
    st.page_link("app.py", label="Matelda")
    st.page_link("pages/Configurations.py", label="Configurations")
    st.page_link("pages/DomainBasedFolding.py", label="Domain Based Folding")
    st.page_link("pages/QualityBasedFolding.py", label="Quality Based Folding")
    st.page_link("pages/Labeling.py", label="Labeling")
    st.page_link("pages/ErrorDetection.py", label="Error Detection")
    st.page_link("pages/Results.py", label="Results")

st.title("Configurations")

# ----------------------------
# Pipeline Selection Section
# ----------------------------
st.markdown("---")
st.subheader("Pipeline Selection")
pipelines_folder = os.path.join(os.path.dirname(__file__), "../pipelines")
if not os.path.exists(pipelines_folder):
    os.makedirs(pipelines_folder)

existing_pipelines = [
    f
    for f in os.listdir(pipelines_folder)
    if os.path.isdir(os.path.join(pipelines_folder, f))
]
placeholder = "Click here to select existing pipeline"


def load_pipeline_config():
    """
    Load labeling budget and dataset from the selected pipeline's configuration JSON.
    Additionally, if a dataset is already selected in the UI (via st.session_state.dataset_select),
    compare it to the one stored in the configuration. If they match, update the labeling budget
    to the actual saved value.
    """
    selected = st.session_state.selected_pipeline
    # Do nothing if the placeholder is still selected.
    if selected == placeholder:
        return
    pipeline_config_path = os.path.join(
        pipelines_folder, selected, "configurations.json"
    )
    if os.path.exists(pipeline_config_path):
        with open(pipeline_config_path, "r") as f:
            pipeline_config = json.load(f)
        pipeline_dataset = pipeline_config.get("selected_dataset", None)
        current_dataset = st.session_state.get("dataset_select")
        # Get the dataset currently selected in the UI (from the selectbox, which writes to st.session_state.dataset_select)
        current_dataset = st.session_state.get("dataset_select")
        if current_dataset is None and pipeline_dataset:
            st.session_state["dataset_select"] = pipeline_dataset
            current_dataset = pipeline_dataset
        # Update the budget regardless
        st.session_state.budget_slider = pipeline_config.get("labeling_budget", 10)
        st.session_state.preconfigured_dataset = pipeline_dataset
    else:
        st.session_state.budget_slider = 10
        st.session_state.preconfigured_dataset = "Not defined"


pipeline_choice = st.radio(
    "Do you want to use an existing pipeline or create a new one?",
    options=["Create New Pipeline", "Use Existing Pipeline"],
    index=0,
)

if pipeline_choice == "Use Existing Pipeline":
    # Show placeholder first, then existing pipelines.
    pipeline_options = [placeholder] + existing_pipelines
    selected_pipeline = st.selectbox(
        "Select an existing pipeline:",
        options=pipeline_options,
        key="selected_pipeline",
        on_change=load_pipeline_config,
    )

    # On first load, load configuration if not already set.
    if "budget_slider" not in st.session_state:
        load_pipeline_config()

    st.markdown("---")
    st.subheader("Labeling Budget")
    current_budget = st.session_state.get("budget_slider", 10)
    labeling_budget = st.slider(
        "Select Labeling Budget:",
        min_value=1,
        max_value=100,
        value=current_budget,
        label_visibility="visible",
    )
    st.number_input(
        "Enter Labeling Budget",
        min_value=1,
        max_value=100,
        value=labeling_budget,
        step=1,
        key="budget_input",
        label_visibility="hidden",
    )
    st.session_state.budget_slider = labeling_budget
else:
    # ----------------------------
    # Create New Pipeline: Dataset & Budget Selection
    # ----------------------------
    st.markdown("---")
    st.subheader("Dataset Selection")
    datasets_folder = os.path.join(os.path.dirname(__file__), "../datasets")
    dataset_options = [
        f
        for f in os.listdir(datasets_folder)
        if os.path.isdir(os.path.join(datasets_folder, f))
    ]
    if not dataset_options:
        st.warning("No dataset folders found in the datasets folder.")
    else:
        # The selectbox widget writes its value into st.session_state['dataset_select']
        selected_dataset_folder = st.selectbox(
            "Select the dataset you want to use:",
            options=dataset_options,
            key="dataset_select",
            label_visibility="visible",
        )
        folder_path = os.path.join(datasets_folder, selected_dataset_folder)
        st.write("Here is some information on the dataset.")

    st.markdown("---")
    st.subheader("Error Detection Strategies")
    st.checkbox(
        "Outlier Detector",
        value=True,
    )
    st.checkbox(
        "Pattern Violation Detector",
        value=True,
    )
    st.checkbox(
        "FD Violation Detector",
        value=True,
    )
    st.checkbox(
        "Typo Detector",
        value=True,
    )

    st.markdown("---")
    st.subheader("Labeling Budget")
    labeling_budget = st.slider(
        "Select Labeling Budget:",
        min_value=1,
        max_value=100,
        value=st.session_state.get("budget_slider", 10),
        label_visibility="visible",
    )
    st.number_input(
        "Enter Labeling Budget",
        min_value=1,
        max_value=100,
        value=labeling_budget,
        step=1,
        key="budget_input",
        label_visibility="hidden",
    )
    st.session_state.budget_slider = labeling_budget

    # ----------------------------
    # Suggest Unique Pipeline Folder Name at the Bottom
    # ----------------------------
    def suggest_pipeline_folder_name(dataset_name, pipelines_dir):
        """
        Suggests a unique pipeline folder name in the format:
        {dataset_name}-pipeline-{number:02d}
        """
        candidate_prefix = f"{dataset_name}-pipeline-"
        candidates = [
            d
            for d in os.listdir(pipelines_dir)
            if os.path.isdir(os.path.join(pipelines_dir, d))
            and d.startswith(candidate_prefix)
        ]
        if not candidates:
            return f"{dataset_name}-pipeline-01"
        else:
            max_num = 0
            for d in candidates:
                try:
                    num = int(d.replace(candidate_prefix, ""))
                    if num > max_num:
                        max_num = num
                except:
                    continue
            next_num = max_num + 1
            return f"{dataset_name}-pipeline-{next_num:02d}"

    st.markdown("---")
    st.subheader("Pipeline Name")
    default_pipeline_name = suggest_pipeline_folder_name(
        st.session_state.get("dataset_select", "dataset"), pipelines_folder
    )
    new_pipeline_name = st.text_input(
        "Enter a new pipeline name:", value=default_pipeline_name
    )


# ----------------------------
# Helper Functions for Saving Configurations
# ----------------------------
def create_unique_pipeline_folder(base_name, pipelines_dir):
    """Creates a new folder with a unique name in pipelines_dir based on base_name."""
    pipeline_dir = os.path.join(pipelines_dir, base_name)
    if not os.path.exists(pipeline_dir):
        os.makedirs(pipeline_dir)
        return pipeline_dir
    else:
        suffix = 1
        while True:
            new_name = f"{base_name}-{suffix:02d}"
            new_pipeline_dir = os.path.join(pipelines_dir, new_name)
            if not os.path.exists(new_pipeline_dir):
                os.makedirs(new_pipeline_dir)
                return new_pipeline_dir
            suffix += 1


def save_config_to_json(config, folder):
    """Saves the configuration dictionary as configurations.json inside the specified folder."""
    config_path = os.path.join(folder, "configurations.json")
    with open(config_path, "w") as f:
        json.dump(config, f, indent=4)


# ----------------------------
# Save and Continue Button
# ----------------------------
if st.button("Save and Continue"):
    if pipeline_choice == "Use Existing Pipeline":
        # Check if the placeholder is still selected
        if st.session_state.selected_pipeline == placeholder:
            st.warning("Please select an existing pipeline before continuing.")
        else:
            pipeline_folder = os.path.join(
                pipelines_folder, st.session_state.selected_pipeline
            )
            st.session_state.pipeline_path = pipeline_folder
            pipeline_config_path = os.path.join(pipeline_folder, "configurations.json")
            config_to_save = {}
            if os.path.exists(pipeline_config_path):
                with open(pipeline_config_path, "r") as f:
                    config_to_save = json.load(f)
            config_to_save["labeling_budget"] = st.session_state.get(
                "budget_slider", labeling_budget
            )
            config_to_save["selected_dataset"] = st.session_state.get("dataset_select")
            with open(pipeline_config_path, "w") as f:
                json.dump(config_to_save, f, indent=4)
            st.success(
                f"Configurations updated in existing pipeline: {pipeline_folder}!"
            )
            st.switch_page("pages/DomainBasedFolding.py")
    else:
        pipeline_folder = create_unique_pipeline_folder(
            new_pipeline_name, pipelines_folder
        )
        st.session_state.pipeline_path = pipeline_folder
        config_to_save = {
            "selected_dataset": st.session_state.get("dataset_select"),
            "labeling_budget": st.session_state.get("budget_slider", labeling_budget),
        }
        save_config_to_json(config_to_save, pipeline_folder)
        st.success(
            f"New pipeline created and configurations saved in {pipeline_folder}!"
        )
        st.switch_page("pages/DomainBasedFolding.py")
