"""
Restart controls component for placing a guarded restart action
at the end of pages. Shows an expander named "Restart" containing
one button that opens a confirmation dialog. On confirm, switches
back to the main `app.py` page.
"""
from typing import Optional
import streamlit as st
from .session_persistence import clear_persisted_session


def render_restart_expander(page_id: Optional[str] = None) -> None:
    """Render a single restart button with confirmation dialog.

    Kept the function name for compatibility, but it now renders
    a plain button (no expander). On confirm, switches to `app.py`.

    Args:
        page_id: Optional suffix to make widget keys unique per page.
    """
    suffix = page_id or "default"

    if st.button("Restart from the beginning", key=f"restart_btn_{suffix}"):

        @st.dialog("Restart Pipeline?", width="small")
        def _confirm_restart_dialog():
            st.write(
                "Are you sure you want to restart the pipeline and start from the beginning?"
            )
            col_a, col_b = st.columns(2)
            with col_a:
                if st.button("Restart", key=f"confirm_restart_{suffix}"):
                    # Preserve a one-time flag to suppress balloons after restarting from Results
                    suppress_balloons = suffix == "results"
                    # Clear all session state to start from scratch
                    clear_persisted_session()
                    for key in list(st.session_state.keys()):
                        del st.session_state[key]
                    if suppress_balloons:
                        st.session_state["suppress_balloons_after_restart"] = True
                    st.switch_page("app.py")
            with col_b:
                if st.button("Cancel", key=f"cancel_restart_{suffix}"):
                    st.rerun()

        _confirm_restart_dialog()


def render_inline_restart_button(page_id: Optional[str] = None, use_container_width: bool = False) -> bool:
    """Render an inline restart button for navigation bars.
    
    Returns True if restart was clicked (for handling in parent).
    
    Args:
        page_id: Optional suffix to make widget keys unique per page.
        use_container_width: Whether to use full container width.
    """
    suffix = page_id or "default"
    
    # Create a unique key for this button instance
    button_key = f"restart_inline_{suffix}"
    
    if st.button("Restart", key=button_key, use_container_width=use_container_width):
        @st.dialog("Restart Pipeline?", width="small")
        def _confirm_restart_dialog():
            st.write(
                "Are you sure you want to restart the pipeline and start from the beginning? This will delete the session state."
            )
            col_a, col_b = st.columns(2)
            with col_a:
                if st.button("Restart", key=f"confirm_restart_inline_{suffix}"):
                    # Preserve a one-time flag to suppress balloons after restarting from Results
                    suppress_balloons = suffix == "results"
                    # Clear all session state to start from scratch
                    clear_persisted_session()
                    for key in list(st.session_state.keys()):
                        del st.session_state[key]
                    if suppress_balloons:
                        st.session_state["suppress_balloons_after_restart"] = True
                    st.switch_page("app.py")
            with col_b:
                if st.button("Cancel", key=f"cancel_restart_inline_{suffix}"):
                    st.rerun()

        _confirm_restart_dialog()
        return True
    return False
