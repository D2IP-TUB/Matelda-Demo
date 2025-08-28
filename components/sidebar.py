"""
Common sidebar navigation component for all pages
"""
import streamlit as st
import os
from .session_persistence import init_session_persistence, persist_session
from .theme_switcher import render_theme_switcher

def render_sidebar():
    """Render the common sidebar navigation with minimal flicker"""
    # Restore any previous session snapshot for this browser tab
    init_session_persistence()
    # Get current page path
    try:
        current_script = os.path.basename(st._get_script_run_ctx().info.script_path)
    except:
        current_script = "app.py"
    
    # Store current page in session state for persistence
    if "current_page" not in st.session_state:
        st.session_state.current_page = current_script
    else:
        st.session_state.current_page = current_script
    
    # Define pages
    pages = [
        ("app.py", "Matelda"),
        ("pages/Configurations.py", "Configurations"),
        ("pages/DomainBasedFolding.py", "Domain Based Folding"),
        ("pages/QualityBasedFolding.py", "Quality Based Folding"),
        ("pages/Labeling.py", "Labeling"),
        ("pages/PropagatedErrors.py", "Propagated Errors"),
        ("pages/ErrorDetection.py", "Error Detection"),
        ("pages/Results.py", "Results")
    ]
    
    with st.sidebar:
        # Preemptive CSS injection to hide default elements immediately
        st.markdown("""
            <style>
            /* Immediate hiding of default Streamlit sidebar */
            [data-testid="stSidebarNav"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
            }
            
            /* Hide any default navigation during load */
            .css-1d391kg, .css-1vencpc, .css-1lcbmhc, .css-17eq0hr {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
            }
            
            /* Fast rendering for our custom navigation */
            div[data-testid="stSidebarNav"], .sidebar-nav {
                transition: none !important;
                animation: none !important;
            }
            
            /* Immediate visibility for our sidebar */
            .sidebar-nav {
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
            }
            
            /* Prevent loading artifacts */
            .element-container {
                transition: none !important;
            }
            
            /* Hide sidebar content loading states */
            .stSpinner {
                display: none !important;
            }
            </style>
        """, unsafe_allow_html=True)
        
        # Immediately render navigation with custom container
        st.markdown('<div class="sidebar-nav">', unsafe_allow_html=True)
        
        # Render all navigation items at once
        for path, label in pages:
            # Don't add arrow to the main Matelda page
            if path != "app.py" and (path.endswith(current_script) or (path == current_script)):
                label = f"**→ {label}**"
            st.page_link(path, label=label)
            
        st.markdown('</div>', unsafe_allow_html=True)
        
        # Add theme switcher
        render_theme_switcher()

    # Persist a snapshot of important session keys for reload survival
    persist_session()
