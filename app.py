import streamlit as st
from components import apply_base_styles, get_current_theme, render_sidebar
from components.session_persistence import clear_persisted_session

st.set_page_config(
    page_title="Matelda",
    layout="wide",
    page_icon="🔧",
    initial_sidebar_state="expanded",
)

# Apply base styles with current theme
current_theme = get_current_theme()
apply_base_styles(current_theme)

st.title("Matelda")
st.write("Welcome to Matelda!")
st.markdown("""
The underlying paper is available on [OpenProceedings](https://www.openproceedings.org/2025/conf/edbt/paper-98.pdf).
The Repository of the Demo is available on [GitHub](https://github.com/D2IP-TUB/Matelda-Demo).
Click the button below to start the demo.
""")

# Sidebar Navigation
render_sidebar()

# Start Button
if st.button("Start"):
    # Check if there's an existing pipeline or session data
    has_existing_pipeline = (
        "pipeline_path" in st.session_state
        or "dataset_select" in st.session_state
        or "selected_strategies" in st.session_state
        or any(
            key.startswith(("budget_", "labeling_", "domain_", "cell_"))
            for key in st.session_state.keys()
        )
    )

    if has_existing_pipeline:

        @st.dialog("Start New Pipeline?", width="medium")
        def _confirm_start_dialog():
            st.write(
                "You already have a pipeline in progress. What would you like to do?"
            )

            col_a, col_b = st.columns(2)
            with col_a:
                if st.button(
                    "🔄 Continue Current Pipeline",
                    key="continue_current",
                    use_container_width=True,
                ):
                    st.switch_page("pages/Configurations.py")

            with col_b:
                if st.button(
                    "🆕 Start Fresh Pipeline",
                    key="start_fresh",
                    use_container_width=True,
                ):
                    # Clear all session state to start from scratch (similar to restart functionality)
                    clear_persisted_session()
                    for key in list(st.session_state.keys()):
                        del st.session_state[key]
                    st.switch_page("pages/Configurations.py")

            st.markdown("---")
            st.info(
                "💾 Your existing pipeline is automatically saved and can be accessed via 'Use Existing Pipeline' in Configurations."
            )

            if st.button("Cancel", key="cancel_start"):
                st.rerun()  # Close dialog

        _confirm_start_dialog()
    else:
        # No existing pipeline, proceed normally
        st.switch_page("pages/Configurations.py")
