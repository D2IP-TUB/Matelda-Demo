"""
Common CSS styling components for the application
"""
import streamlit as st
import toml
import os


def load_theme_config():
    """Load theme configuration from .streamlit/config.toml"""
    try:
        config_path = os.path.join(os.path.dirname(__file__), "../.streamlit/config.toml")
        with open(config_path, 'r') as f:
            config = toml.load(f)
        return config.get('theme', {})
    except (FileNotFoundError, toml.TomlDecodeError):
        # Fallback theme values if config.toml is not found or invalid
        return {
            'primaryColor': '#F0C38E',
            'backgroundColor': '#48426D', 
            'secondaryBackgroundColor': '#312C51',
            'textColor': '#45474b',
            'font': 'monospace'
        }


def apply_base_styles():
    """Apply base styles that are common across all pages"""
    theme = load_theme_config()
    
    # Extract theme values
    bg_color = theme.get('backgroundColor', '#48426D')
    text_color = theme.get('textColor', '#45474b')
    primary_color = theme.get('primaryColor', '#F0C38E')
    secondary_bg = theme.get('secondaryBackgroundColor', '#312C51')
    font = theme.get('font', 'monospace')
    
    st.markdown(
        f"""
        <style>
          /* Apply theme colors to root and all containers */
          html, body, .stApp, .main, [data-testid="stAppViewContainer"] {{
            background-color: {bg_color} !important;
            color: {text_color} !important;
            font-family: {font} !important;
          }}
          
          /* Target the main content block specifically */
          .block-container, [data-testid="block-container"] {{
            background-color: {bg_color} !important;
            color: {text_color} !important;
          }}
          
          /* Header and toolbar areas */
          header[data-testid="stHeader"], .stToolbar, [data-testid="stToolbar"] {{
            background-color: {bg_color} !important;
          }}
          
          /* Secondary background areas */
          .stSidebar, [data-testid="stSidebar"] {{
            background-color: {secondary_bg} !important;
          }}
          
          /* Primary color for buttons and interactive elements */
          .stButton > button {{
            background-color: {primary_color} !important;
            color: {text_color} !important;
            border: none !important;
          }}
          
          /* Aggressively hide default Streamlit sidebar navigation */
          [data-testid="stSidebarNav"] {{
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
          }}
          
          /* Hide any Streamlit navigation elements */
          .css-1d391kg, .css-1vencpc, .css-1lcbmhc, .css-17eq0hr {{
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
          }}
          
          /* Prevent any sidebar navigation from appearing during page load */
          .stApp [data-testid="stSidebarNav"] {{
            display: none !important;
          }}
          
          /* Ensure fast rendering of custom sidebar content */
          .sidebar-nav {{
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
          }}

          [data-testid="stHorizontalBlock"] {{
            flex-wrap: nowrap !important;
            overflow-x: auto !important;
          }}
          [data-testid="stHorizontalBlock"] > div {{
            padding: 0 !important;
          }}

          [data-testid="stTable"],
          [data-testid="stCheckbox"] > div {{
            flex: 0 0 auto !important;
          }}

          @media (max-width: 768px) {{
            .block-container {{
              min-width: 0 !important;
            }}
            [data-testid="stHorizontalBlock"] > div,
            [data-testid="stTable"],
            [data-testid="stCheckbox"] > div {{
              min-width: 0 !important;
            }}
          }}
        </style>
        """,
        unsafe_allow_html=True,
    )


def apply_folding_styles():
    """Apply styles specific to domain and quality based folding pages"""
    st.markdown(
        """
        <style>
        div.action-container div[data-testid="stHorizontalBlock"] {
            gap: 0 !important;
        }
        div.action-container div[data-testid="column"] {
            padding: 0 !important;
            flex: 1 1 0 !important;
        }
        div.action-container button {
            margin: 0 !important;
            width: 100%;
        }
        div[data-testid="baseButton-primary"] > button {
            background-color: #ff4b4b;
            color: white;
        }

        /* Distinct style for the per-fold "Show more" control */
        .show-more-container button {
            background-color: #0f62fe !important; /* IBM blue for contrast */
            color: #ffffff !important;
            border: 1px solid #0b5bd3 !important;
            box-shadow: none !important;
        }
        .show-more-container button:hover {
            background-color: #0b5bd3 !important;
            border-color: #0949a6 !important;
        }
        .show-more-container [data-testid="stButton"] {
            width: 100% !important;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )
