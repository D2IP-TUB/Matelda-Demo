import streamlit as st
import streamlit.components.v1 as components
from components import apply_base_styles, get_current_theme, render_sidebar
from components.session_persistence import clear_persisted_session
import os
import base64

st.set_page_config(
    page_title="Matelda",
    layout="wide",
    page_icon="🔧",
    initial_sidebar_state="expanded",
)

# Apply base styles with current theme
current_theme = get_current_theme()
apply_base_styles(current_theme)

# Theme colors for landing section
primary = current_theme.get("primaryColor", "#f4b11c").strip()[:7]
text_color = current_theme.get("textColor", "#002f67").strip()[:7]
secondary_bg = current_theme.get("secondaryBackgroundColor", "#ffffff").strip()[:7]
app_font = current_theme.get("font", "monospace")

# Hero and links section — inject CSS first, then HTML
st.markdown(
    f"""
    <style>
        .matelda-landing {{
            text-align: center;
            padding: 1rem 0 2rem;
            max-width: 900px;
            margin: 0 auto;
        }}
        .matelda-title {{
            font-size: 2.5rem;
            font-weight: 700;
            color: {text_color};
            margin-bottom: 0.5rem;
            letter-spacing: -0.02em;
        }}
        .matelda-tagline {{
            font-size: 1.15rem;
            color: {text_color};
            opacity: 0.9;
            margin-bottom: 2rem;
        }}
        .matelda-links {{
            display: flex;
            flex-wrap: wrap;
            gap: 1rem;
            justify-content: center;
            margin-bottom: 2rem;
        }}
        .matelda-link-card {{
            display: inline-flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-width: 180px;
            padding: 1.25rem 1.5rem;
            background: {secondary_bg};
            color: {text_color};
            text-decoration: none;
            border-radius: 12px;
            border: 2px solid {text_color}22;
            transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }}
        .matelda-link-card:hover {{
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0,0,0,0.12);
            border-color: {primary};
        }}
        .matelda-link-icon {{
            font-size: 1.75rem;
            margin-bottom: 0.5rem;
        }}
        .matelda-link-label {{
            font-weight: 600;
            font-size: 1rem;
        }}
        .matelda-link-meta {{
            font-size: 0.8rem;
            opacity: 0.8;
            margin-top: 0.25rem;
        }}
    </style>
    """,
    unsafe_allow_html=True,
)
st.markdown(
    """
    <div class="matelda-landing">
        <h1 class="matelda-title">Matelda</h1>
        <p class="matelda-tagline">Interactive data cleaning with human-in-the-loop error detection.</p>
    </div>
    """,
    unsafe_allow_html=True,
)
# Render link cards via HTML component so they are not escaped by Streamlit markdown
links_html = f"""
<!DOCTYPE html>
<html>
<head>
<style>
body {{ margin: 0; background: transparent; font-family: {app_font}, monospace; }}
.matelda-links {{
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: center;
    align-items: center;
    margin-bottom: 0.5rem;
}}
.matelda-link-card {{
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: transparent;
    color: {text_color};
    text-decoration: none;
    border-radius: 6px;
    border-left: 3px solid {primary};
    font-family: {app_font}, monospace;
    font-size: 0.95rem;
    transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
}}
.matelda-link-card:hover {{
    background: rgba(244, 177, 28, 0.08);
    border-left-color: {primary};
    box-shadow: 0 2px 6px rgba(0,0,0,0.06);
}}
.matelda-link-icon {{
    font-size: 1.1rem;
    opacity: 0.9;
}}
.matelda-link-text {{ display: flex; flex-direction: column; align-items: flex-start; gap: 0.05rem; }}
.matelda-link-label {{ font-weight: 600; font-size: 0.95rem; line-height: 1.2; font-family: {app_font}, monospace; }}
.matelda-link-meta {{ font-size: 0.8rem; opacity: 0.75; font-weight: 400; font-family: {app_font}, monospace; }}
</style>
</head>
<body>
<div class="matelda-links">
    <a href="https://www.openproceedings.org/2025/conf/edbt/paper-98.pdf" target="_blank" rel="noopener" class="matelda-link-card">
        <span class="matelda-link-icon">📄</span>
        <span class="matelda-link-text">
            <span class="matelda-link-label">Research paper</span>
            <span class="matelda-link-meta">EDBT 2025</span>
        </span>
    </a>
    <a href="https://www.vldb.org/pvldb/vol18/p5379-ahmadi.pdf" target="_blank" rel="noopener" class="matelda-link-card">
        <span class="matelda-link-icon">📋</span>
        <span class="matelda-link-text">
            <span class="matelda-link-label">Demo paper</span>
            <span class="matelda-link-meta">VLDB 2025</span>
        </span>
    </a>
    <a href="https://github.com/D2IP-TUB/Matelda-Demo" target="_blank" rel="noopener" class="matelda-link-card">
        <span class="matelda-link-icon">⌨</span>
        <span class="matelda-link-text">
            <span class="matelda-link-label">Code</span>
            <span class="matelda-link-meta">GitHub</span>
        </span>
    </a>
</div>
</body>
</html>
"""
components.html(links_html, height=62, scrolling=False)

# Sidebar Navigation
render_sidebar()

# Centered Start Button
col_l, col_c, col_r = st.columns([2, 1, 2])
with col_c:
    start_clicked = st.button("Start", use_container_width=True)

# Centered image below (smaller) — embed in HTML so it stays centered
init_path = "init.png"
if os.path.isfile(init_path):
    with open(init_path, "rb") as f:
        init_b64 = base64.b64encode(f.read()).decode()
    st.markdown(
        f'<div style="text-align: center; margin: 1rem 0;">'
        f'<img src="data:image/png;base64,{init_b64}" alt="Matelda" style="width: 420px; max-width: 100%; height: auto;" />'
        f'</div>',
        unsafe_allow_html=True,
    )
else:
    col_left, col_center, col_right = st.columns([1, 2, 1])
    with col_center:
        st.image("init.png", width=420)

if start_clicked:
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
                    st.switch_page("pages/InputOutput.py")

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
                    st.switch_page("pages/InputOutput.py")

            st.markdown("---")
            st.info(
                "💾 Your existing pipeline is automatically saved and can be accessed via 'Use Existing Pipeline' in Configurations."
            )

            if st.button("Cancel", key="cancel_start"):
                st.rerun()  # Close dialog

        _confirm_start_dialog()
    else:
        # No existing pipeline, proceed normally
        st.switch_page("pages/InputOutput.py")
