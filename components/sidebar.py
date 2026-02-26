"""
Common sidebar navigation component for all pages
"""
import streamlit as st
import os
from .session_persistence import init_session_persistence, persist_session
from .theme_switcher import render_theme_switcher

# Paths relative to project root (parent of components/)
def _project_root():
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

def render_sidebar():
    """Render the common sidebar navigation with minimal flicker"""
    # Restore any previous session snapshot for this browser tab
    init_session_persistence()
    # Get current page path
    try:
        current_script = os.path.basename(st._get_script_run_ctx().info.script_path)
    except Exception:
        current_script = "app.py"

    # Store current page in session state for persistence
    if "current_page" not in st.session_state:
        st.session_state.current_page = current_script
    else:
        st.session_state.current_page = current_script

    # Define pages
    pages = [
        ("app.py", "Matelda"),
        ("pages/InputOutput.py", "Intro"),
        ("pages/Configurations.py", "Configurations"),
        ("pages/DomainBasedFolding.py", "Domain Based Folding"),
        ("pages/QualityBasedFolding.py", "Quality Based Folding"),
        ("pages/Labeling.py", "Labeling"),
        ("pages/PropagatedErrors.py", "Propagated Errors"),
        ("pages/ErrorDetection.py", "Error Detection"),
        ("pages/Results.py", "Results")
    ]

    root = _project_root()
    logo_path = os.path.join(root, "bifold_logo.png")
    qr_path = os.path.join(root, "qrcode-2.png")

    with st.sidebar:
        # CSS: hide default nav only (no flex reflow)
        st.markdown("""
            <style>
            [data-testid="stSidebarNav"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
            }
            .css-1d391kg, .css-1vencpc, .css-1lcbmhc, .css-17eq0hr {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
            }
            div[data-testid="stSidebarNav"], .sidebar-nav {
                transition: none !important;
                animation: none !important;
            }
            .sidebar-nav {
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
            }
            .element-container { transition: none !important; }
            .stSpinner { display: none !important; }
            </style>
        """, unsafe_allow_html=True)

        # Top: BIFOLD logo (as requested)
        if os.path.isfile(logo_path):
            st.image(logo_path, use_container_width=True)
        st.markdown('<div class="sidebar-nav">', unsafe_allow_html=True)

        # Navigation links (unchanged order)
        for path, label in pages:
            if path != "app.py" and (path.endswith(current_script) or path == current_script):
                label = f"**→ {label}**"
            st.page_link(path, label=label)

        st.markdown('</div>', unsafe_allow_html=True)

        # Bottom: QR then theme switcher (theme switcher stays at very bottom like before)
        if os.path.isfile(qr_path):
            st.markdown("**Try on your phone**")
            st.image(qr_path, use_container_width=True)
        render_theme_switcher()

    persist_session()
