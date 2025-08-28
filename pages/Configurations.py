import os
import shutil
import zipfile

import streamlit as st
from backend import get_available_strategies
from components import (
    apply_base_styles,
    get_current_theme,
    get_datasets_path,
    load_pipeline_config,
    render_inline_restart_button,
    render_sidebar,
    save_pipeline_config,
)
from components.session_persistence import get_session_hash
from components.utils import mark_pipeline_clean, mark_pipeline_dirty

# Set page config and apply base styles
st.set_page_config(page_title="Configurations", layout="wide")
current_theme = get_current_theme()
apply_base_styles(current_theme)

# Sidebar navigation
render_sidebar()

st.title("Configurations")

# Stable, per-tab session suffix used to avoid name collisions
SESSION_SUFFIX = get_session_hash(6)

# ----------------------------
# Pipeline Selection Section
# ----------------------------
pipelines_folder = os.path.join(os.path.dirname(__file__), "../pipelines")
if not os.path.exists(pipelines_folder):
    os.makedirs(pipelines_folder)

existing_pipelines = [
    f
    for f in os.listdir(pipelines_folder)
    if os.path.isdir(os.path.join(pipelines_folder, f))
]
placeholder = "Click here to select existing pipeline"

# Initialize state for new pipeline validation
if "valid_pipeline_name" not in st.session_state:
    st.session_state.valid_pipeline_name = True


def load_pipeline_config_ui():
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

    pipeline_path = os.path.join(pipelines_folder, selected)
    pipeline_config = load_pipeline_config(pipeline_path)

    pipeline_dataset = pipeline_config.get("selected_dataset", None)
    # Always sync dataset to the pipeline's configured dataset to avoid corruption on revisits
    if pipeline_dataset:
        st.session_state["dataset_select"] = pipeline_dataset
    # Update the budget from config. Clamp slider to 100 but keep input full value.
    _cfg_budget = pipeline_config.get("labeling_budget", 10)
    st.session_state.budget_slider = min(int(_cfg_budget), 100)
    st.session_state.budget_input = int(_cfg_budget)
    st.session_state.preconfigured_dataset = pipeline_dataset
    # Load previously selected strategies if available, default to all strategies if none selected
    saved_strategies = pipeline_config.get("selected_strategies", [])
    if not saved_strategies:
        # If no strategies were previously selected, default to all strategies
        saved_strategies = get_available_strategies()
    st.session_state.selected_strategies = saved_strategies


def sync_slider_to_input():
    """Keep the number input in sync when the slider changes."""
    st.session_state.budget_input = st.session_state.budget_slider


def sync_input_to_slider():
    """Keep the slider in sync when the number input changes (clamped to 100)."""
    try:
        st.session_state.budget_slider = min(int(st.session_state.budget_input), 100)
    except Exception:
        st.session_state.budget_slider = 100


# Determine default choice based on session state (prefer existing pipeline if in use)
default_choice_index = 0  # 0 = Create New Pipeline, 1 = Use Existing Pipeline
try:
    # If a pipeline_path is set and points under the pipelines folder, preselect existing
    current_pipeline_path = st.session_state.get("pipeline_path")
    if current_pipeline_path:
        current_dir_name = os.path.basename(os.path.normpath(current_pipeline_path))
        if os.path.exists(os.path.join(pipelines_folder, current_dir_name)):
            default_choice_index = 1
            # Ensure the selectbox defaults to the current pipeline name
            st.session_state["selected_pipeline"] = current_dir_name
    elif st.session_state.get("selected_pipeline") in existing_pipelines:
        default_choice_index = 1
except Exception:
    pass

pipeline_choice = st.radio(
    "Do you want to use an existing pipeline or create a new one?",
    options=["Create New Pipeline", "Use Existing Pipeline"],
    index=default_choice_index,
)

if pipeline_choice == "Use Existing Pipeline":
    # Show placeholder first, then existing pipelines.
    pipeline_options = [placeholder] + existing_pipelines
    selected_pipeline = st.selectbox(
        "Select an existing pipeline:",
        options=pipeline_options,
        key="selected_pipeline",
        on_change=load_pipeline_config_ui,
    )
    # Always sync the selected pipeline's configuration (dataset, budget, strategies)
    load_pipeline_config_ui()

    st.markdown("---")
    st.subheader("Labeling Budget")
    st.session_state.setdefault("budget_slider", 10)
    st.session_state.setdefault("budget_input", st.session_state.budget_slider)

    col_slider, col_input = st.columns([3, 1])

    with col_slider:
        st.slider(
            "Select Labeling Budget:",
            min_value=1,
            max_value=100,
            key="budget_slider",
            label_visibility="visible",
            on_change=sync_slider_to_input,
        )

    with col_input:
        st.number_input(
            "Enter Labeling Budget",
            min_value=1,
            step=1,
            key="budget_input",
            label_visibility="hidden",
            on_change=sync_input_to_slider,
        )

    # Use the number input as the source of truth
    labeling_budget = st.session_state.get(
        "budget_input", st.session_state.get("budget_slider", 10)
    )

    # ----------------------------
    # Strategies Selection (Existing Pipeline)
    # ----------------------------
    st.markdown("---")
    st.subheader("Error Detection Strategies")
    strategies = get_available_strategies()
    # Preselect all strategies by default if none are selected
    if (
        "selected_strategies" not in st.session_state
        or not st.session_state.selected_strategies
    ):
        st.session_state.selected_strategies = strategies.copy()
    preselected = set(st.session_state.get("selected_strategies", []))
    selected = []
    for s in strategies:
        checked = st.checkbox(s, value=(s in preselected), key=f"strategy_{s}")
        if checked:
            selected.append(s)
    st.session_state.selected_strategies = selected

    # ----------------------------
    # Pipeline Name (Editable)
    # ----------------------------
    st.markdown("---")
    st.subheader("Pipeline Name")

    def suggest_copy_name(
        original: str, all_dirs_path: str, session_suffix: str
    ) -> str:
        """Suggest a unique copy name by appending '-copy-[number]'.

        If original already ends with '-copy-N', start from N+1; otherwise start from 1.
        """
        base = original
        start_n = 1
        if "-copy-" in original:
            parts = original.rsplit("-copy-", 1)
            if len(parts) == 2 and parts[1].isdigit():
                base = parts[0]
                start_n = int(parts[1]) + 1
        n = start_n
        while True:
            # Ensure the candidate includes the per-session suffix
            if not base.endswith(f"-{session_suffix}"):
                candidate_base = f"{base}-{session_suffix}"
            else:
                candidate_base = base
            candidate = f"{candidate_base}-copy-{n}"
            if not os.path.exists(os.path.join(all_dirs_path, candidate)):
                return candidate
            n += 1

    current_name = st.session_state.get("selected_pipeline", placeholder)
    if current_name != placeholder:
        # Show the current pipeline name as the editable default
        st.text_input(
            "Pipeline name:",
            value=current_name,
            key="copy_pipeline_name",
            help="Leaving unchanged will ask to overwrite on Next. When saving under a new name, your session suffix will be appended automatically.",
        )
else:
    # ----------------------------
    # Create New Pipeline: Dataset & Budget Selection
    # ----------------------------

    st.markdown("---")
    st.subheader("Dataset Selection")

    # 1) Get datasets folder path using component function
    datasets_folder = os.path.dirname(
        get_datasets_path("")
    )  # Get parent directory of datasets

    # 2) Initialize our session_state buckets (only happens once)
    if "processed_file_ids" not in st.session_state:
        # Track which uploaded files we've already extracted in this session
        st.session_state["processed_file_ids"] = set()

    if "uploaded_dataset_name" not in st.session_state:
        # This will hold the most recently uploaded folder-name
        st.session_state["uploaded_dataset_name"] = None

    # 3) File uploader (always visible)
    st.markdown("##### Add Dataset (optional)")
    uploaded_file = st.file_uploader(
        "Upload a zip file containing the dataset:",
        type=["zip"],
        key="dataset_zip_uploader",
    )

    # 4) If the user has picked a new ZIP, extract it once per unique file upload
    if uploaded_file is not None:
        file_id = getattr(uploaded_file, "id", None)
        if file_id is None:
            file_id = getattr(uploaded_file, "file_id", None)
        if file_id is None:
            file_id = id(uploaded_file)
        if file_id not in st.session_state["processed_file_ids"]:
            # Start extraction
            status = st.empty()
            with st.spinner("Uploading and extracting…"):
                status.text("Uploading…")
                zip_filename = uploaded_file.name
                base_name = os.path.splitext(zip_filename)[0]
                with zipfile.ZipFile(uploaded_file, "r") as zip_ref:
                    entries = [
                        info.filename
                        for info in zip_ref.infolist()
                        if info.filename and not info.filename.startswith("__MACOSX/")
                    ]
                    top_dirs = {entry.split("/", 1)[0] for entry in entries}
                    if len(top_dirs) == 1:
                        inner_root = next(iter(top_dirs))
                        dataset_base = inner_root.rstrip("/")
                    else:
                        dataset_base = base_name

                    new_dataset_path = os.path.join(datasets_folder, dataset_base)

                    # Auto‐increment if folder already exists
                    counter = 1
                    dataset_name = dataset_base
                    while os.path.exists(new_dataset_path):
                        dataset_name = f"{dataset_base}_{counter}"
                        new_dataset_path = os.path.join(datasets_folder, dataset_name)
                        counter += 1

                    os.makedirs(new_dataset_path, exist_ok=True)
                    status.text("Extracting…")
                    if len(top_dirs) == 1:
                        for member in zip_ref.infolist():
                            member_name = member.filename
                            if member_name.startswith(inner_root):
                                member_name = member_name[len(inner_root) :].lstrip("/")
                            if not member_name:
                                continue
                            target_path = os.path.join(new_dataset_path, member_name)
                            if member.is_dir():
                                os.makedirs(target_path, exist_ok=True)
                            else:
                                os.makedirs(os.path.dirname(target_path), exist_ok=True)
                                with (
                                    zip_ref.open(member) as src,
                                    open(target_path, "wb") as dst,
                                ):
                                    shutil.copyfileobj(src, dst)
                    else:
                        zip_ref.extractall(new_dataset_path)
                status.text("Cleaning up…")
                status.empty()

            # Remember that we extracted this one, and record the created folder-name
            st.session_state["processed_file_ids"].add(file_id)
            # Record only the latest uploaded dataset so previous
            # notifications can be cleared on subsequent uploads
            st.session_state["uploaded_dataset_name"] = dataset_name

    # 5) Show a persistent notification for the most recently uploaded dataset
    if st.session_state.get("uploaded_dataset_name"):
        st.success(f"Added new dataset: {st.session_state['uploaded_dataset_name']}")

    # 6) Now list all folders under "../datasets" (including ones you uploaded previously,
    #    plus any that already existed on disk before you ran this app).
    st.markdown("##### Select Dataset")

    dataset_options = [
        d
        for d in os.listdir(datasets_folder)
        if os.path.isdir(os.path.join(datasets_folder, d))
    ]
    if not dataset_options:
        st.warning("No dataset folders found in the datasets folder.")
    else:
        selected_dataset_folder = st.selectbox(
            "Select the dataset you want to use:",
            options=dataset_options,
            key="dataset_select",
            label_visibility="visible",
        )
        st.write(
            "Here is some information about the selected dataset: `Insert Information`"
        )

    st.markdown("---")
    st.subheader("Labeling Budget")
    st.session_state.setdefault("budget_slider", 10)
    st.session_state.setdefault("budget_input", st.session_state.budget_slider)

    col_slider, col_input = st.columns([3, 1])

    with col_slider:
        st.slider(
            "Select Labeling Budget:",
            min_value=1,
            max_value=100,
            key="budget_slider",
            label_visibility="visible",
            on_change=sync_slider_to_input,
        )

    with col_input:
        st.number_input(
            "Enter Labeling Budget",
            min_value=1,
            step=1,
            key="budget_input",
            label_visibility="hidden",
            on_change=sync_input_to_slider,
        )

    # Use the number input as the source of truth
    labeling_budget = st.session_state.get(
        "budget_input", st.session_state.get("budget_slider", 10)
    )

    # ----------------------------
    # Strategies Selection (New Pipeline)
    # ----------------------------
    st.markdown("---")
    st.subheader("Error Detection Strategies")
    strategies = get_available_strategies()
    # Preselect all strategies by default if none are selected
    if (
        "selected_strategies" not in st.session_state
        or not st.session_state.selected_strategies
    ):
        st.session_state.selected_strategies = strategies.copy()
    preselected = set(st.session_state.get("selected_strategies", []))
    selected = []
    for s in strategies:
        checked = st.checkbox(s, value=(s in preselected), key=f"strategy_{s}")
        if checked:
            selected.append(s)
    st.session_state.selected_strategies = selected

    # ----------------------------
    # Suggest Unique Pipeline Folder Name at the Bottom
    # ----------------------------
    def suggest_pipeline_folder_name(dataset_name, pipelines_dir, session_suffix: str):
        """
        Suggests a unique pipeline folder name in the format:
        {dataset_name}-pipeline-{number:02d}-{session_suffix}
        """
        candidate_prefix = f"{dataset_name}-pipeline-"
        suffix_token = f"-{session_suffix}"
        candidates = [
            d
            for d in os.listdir(pipelines_dir)
            if os.path.isdir(os.path.join(pipelines_dir, d))
            and d.startswith(candidate_prefix)
            and d.endswith(suffix_token)
        ]
        if not candidates:
            return f"{dataset_name}-pipeline-01{suffix_token}"
        else:
            max_num = 0
            for d in candidates:
                try:
                    # extract number between prefix and suffix
                    middle = (
                        d[len(candidate_prefix) : -len(suffix_token)]
                        if d.endswith(suffix_token)
                        else d.replace(candidate_prefix, "")
                    )
                    num = int(middle)
                    if num > max_num:
                        max_num = num
                except:
                    continue
            next_num = max_num + 1
            return f"{dataset_name}-pipeline-{next_num:02d}{suffix_token}"

    st.markdown("---")
    st.subheader("Pipeline Name")
    default_pipeline_name = suggest_pipeline_folder_name(
        st.session_state.get("dataset_select", "dataset"),
        pipelines_folder,
        SESSION_SUFFIX,
    )
    new_pipeline_name = st.text_input(
        "Enter a new pipeline name:",
        value=default_pipeline_name,
        key="new_pipeline_name",
    )
    # Real-time validation for existing pipeline name
    if new_pipeline_name:
        # Always validate against the suffixed name to avoid cross-session collisions
        validated_name = (
            new_pipeline_name
            if new_pipeline_name.endswith(f"-{SESSION_SUFFIX}")
            else f"{new_pipeline_name}-{SESSION_SUFFIX}"
        )
        new_folder_path = os.path.join(pipelines_folder, validated_name)
        if os.path.exists(new_folder_path):
            st.warning(
                "A pipeline with that name already exists. Please choose a different name."
            )
            st.session_state.valid_pipeline_name = False
        else:
            st.session_state.valid_pipeline_name = True

# ----------------------------
# Helper Functions for Saving Configurations
# ----------------------------


def save_config_to_json(config, folder):
    """Saves the configuration dictionary as configurations.json inside the specified folder."""
    save_pipeline_config(folder, config)


# ----------------------------
# Navigation Buttons
# ----------------------------
st.markdown("---")
nav_cols = st.columns([1, 1, 1], gap="small")

# Restart: confirmation dialog to go to app.py
with nav_cols[0]:
    render_inline_restart_button(page_id="configurations", use_container_width=True)

# Back: to main app
if nav_cols[1].button("Back", key="config_back", use_container_width=True):
    st.switch_page("app.py")


if nav_cols[2].button("Next", key="config_next", use_container_width=True):
    if pipeline_choice == "Use Existing Pipeline":
        # Check if the placeholder is still selected
        if st.session_state.selected_pipeline == placeholder:
            st.warning("Please select an existing pipeline before continuing.")
        else:
            current_name = st.session_state.selected_pipeline
            entered_name = st.session_state.get("copy_pipeline_name", current_name)

            # Helper to ensure our session suffix is present
            def _ensure_suffix(name: str) -> str:
                return (
                    name
                    if name.endswith(f"-{SESSION_SUFFIX}")
                    else f"{name}-{SESSION_SUFFIX}"
                )

            if entered_name != current_name:
                # User wants to save under a new name -> must be unique
                final_entered = _ensure_suffix(entered_name)
                new_folder_path = os.path.join(pipelines_folder, final_entered)
                if os.path.exists(new_folder_path):
                    st.warning(
                        "A pipeline with that name already exists. Please choose a different name."
                    )
                else:
                    # Copy the entire pipeline folder to preserve results
                    src_path = os.path.join(pipelines_folder, current_name)
                    try:
                        shutil.copytree(src_path, new_folder_path)
                    except Exception as e:
                        st.error(f"Failed to create pipeline copy: {e}")
                    else:
                        st.session_state.selected_pipeline = final_entered
                        st.session_state.pipeline_path = new_folder_path

                        # Save current selections into the new pipeline config; name change is not a dirty action
                        config_to_save = load_pipeline_config(new_folder_path)
                        config_to_save["labeling_budget"] = int(
                            st.session_state.get("budget_input", labeling_budget)
                        )
                        config_to_save["selected_dataset"] = st.session_state.get(
                            "dataset_select"
                        )
                        config_to_save["selected_strategies"] = st.session_state.get(
                            "selected_strategies", []
                        )
                        save_pipeline_config(new_folder_path, config_to_save)

                        mark_pipeline_clean()
                        st.success(f"Pipeline copied to: {final_entered}")
                        st.switch_page("pages/DomainBasedFolding.py")
            else:
                # Name unchanged -> open dialog to choose overwrite or new name
                @st.dialog("Continue With Existing Name?", width="small")
                def _confirm_overwrite_dialog():
                    st.write(
                        "You are about to continue using the same pipeline name. "
                        "Do you want to overwrite the existing pipeline or create a copy with a new name?"
                    )

                    # New name input first, spanning full width
                    suggested = suggest_copy_name(
                        current_name, pipelines_folder, SESSION_SUFFIX
                    )
                    new_name = st.text_input(
                        "New pipeline name:",
                        value=suggested,
                        key="dialog_new_pipeline_name",
                    )

                    # Side-by-side buttons on the same row
                    col_overwrite, col_copy = st.columns([1, 1])

                    with col_overwrite:
                        if st.button(
                            "Overwrite existing",
                            key="confirm_overwrite",
                            use_container_width=True,
                        ):
                            pipeline_folder = os.path.join(
                                pipelines_folder, current_name
                            )
                            st.session_state.pipeline_path = pipeline_folder

                            existing_cfg = load_pipeline_config(pipeline_folder)
                            new_budget = int(st.session_state.get("budget_input", 10))
                            new_dataset = st.session_state.get("dataset_select")
                            new_strategies = st.session_state.get(
                                "selected_strategies", []
                            )

                            existing_strats = existing_cfg.get(
                                "selected_strategies", []
                            )
                            strategies_changed = bool(existing_strats) and (
                                sorted(existing_strats) != sorted(new_strategies)
                            )
                            changed = (
                                int(existing_cfg.get("labeling_budget", -1))
                                != new_budget
                                or existing_cfg.get("selected_dataset") != new_dataset
                                or strategies_changed
                            )

                            config_to_save = {**existing_cfg}
                            config_to_save["labeling_budget"] = new_budget
                            config_to_save["selected_dataset"] = new_dataset
                            config_to_save["selected_strategies"] = new_strategies
                            save_pipeline_config(pipeline_folder, config_to_save)

                            if changed:
                                mark_pipeline_dirty()
                            else:
                                mark_pipeline_clean()
                            st.success(
                                f"Configurations updated in existing pipeline: {pipeline_folder}!"
                            )
                            st.switch_page("pages/DomainBasedFolding.py")

                    with col_copy:
                        if st.button(
                            "Create copy and continue",
                            key="confirm_create_copy",
                            use_container_width=True,
                        ):
                            final_name = new_name or ""
                            # Ensure suffix is present
                            if final_name and not final_name.endswith(
                                f"-{SESSION_SUFFIX}"
                            ):
                                final_name = f"{final_name}-{SESSION_SUFFIX}"
                            if not final_name.strip():
                                st.warning("Please enter a new pipeline name.")
                            else:
                                new_path = os.path.join(pipelines_folder, final_name)
                                if os.path.exists(new_path):
                                    st.warning(
                                        "A pipeline with that name already exists. Please choose a different name."
                                    )
                                else:
                                    src_path = os.path.join(
                                        pipelines_folder, current_name
                                    )
                                    try:
                                        shutil.copytree(src_path, new_path)
                                    except Exception as e:
                                        st.error(f"Failed to create pipeline copy: {e}")
                                    else:
                                        st.session_state.selected_pipeline = final_name
                                        st.session_state.pipeline_path = new_path
                                        config_to_save = load_pipeline_config(new_path)
                                        config_to_save["labeling_budget"] = int(
                                            st.session_state.get("budget_input", 10)
                                        )
                                        config_to_save["selected_dataset"] = (
                                            st.session_state.get("dataset_select")
                                        )
                                        config_to_save["selected_strategies"] = (
                                            st.session_state.get(
                                                "selected_strategies", []
                                            )
                                        )
                                        save_pipeline_config(new_path, config_to_save)
                                        mark_pipeline_clean()
                                        st.success(f"Pipeline copied to: {final_name}")
                                        st.switch_page("pages/DomainBasedFolding.py")

                _confirm_overwrite_dialog()
    else:
        # Create New Pipeline: Check for existing folder name
        if not new_pipeline_name:
            st.warning("Please enter a pipeline name.")
        elif not st.session_state.valid_pipeline_name:
            st.warning("Cannot save: pipeline name already exists.")
        else:
            # Always create a suffixed folder to keep names unique per session
            final_new_name = (
                new_pipeline_name
                if new_pipeline_name.endswith(f"-{SESSION_SUFFIX}")
                else f"{new_pipeline_name}-{SESSION_SUFFIX}"
            )
            new_folder_path = os.path.join(pipelines_folder, final_new_name)
            os.makedirs(new_folder_path)
            pipeline_folder = new_folder_path
            st.session_state.pipeline_path = pipeline_folder

            # Ensure budget is saved to session state with a persistent key
            current_budget = st.session_state.get("budget_slider", labeling_budget)
            st.session_state.labeling_budget = current_budget

            config_to_save = {
                "selected_dataset": st.session_state.get("dataset_select"),
                "labeling_budget": st.session_state.get(
                    "budget_input", labeling_budget
                ),
                "selected_strategies": st.session_state.get("selected_strategies", []),
            }
            save_config_to_json(config_to_save, pipeline_folder)
            st.success(
                f"New pipeline created and configurations saved in {pipeline_folder}!"
            )
            # Reset session to ensure a fresh start when creating a brand-new pipeline
            # Preserve only the newly created pipeline path so downstream pages can load config
            from components.session_persistence import clear_persisted_session

            _new_pipeline_path = pipeline_folder
            # Clear persisted snapshot so fresh pipeline starts clean
            try:
                clear_persisted_session()
            except Exception:
                pass
            for key in list(st.session_state.keys()):
                try:
                    del st.session_state[key]
                except Exception:
                    pass
            st.session_state["pipeline_path"] = _new_pipeline_path
            mark_pipeline_clean()
            st.switch_page("pages/DomainBasedFolding.py")
