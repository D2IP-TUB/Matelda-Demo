"""
Common CSS styling components for the application
"""
import streamlit as st
import toml
import os


def load_theme_config(theme_mode: str | None = None) -> dict:
    """Load the active theme configuration.

    Priority:
    1) Respect Streamlit's active theme via st.get_option("theme.*").
    2) If unavailable, read .streamlit/config.toml (and [theme.dark] when active).
    3) Fallback to hardcoded defaults.
    """
    # 1) Try to read the live active theme from Streamlit options
    try:
        active_base = st.get_option("theme.base")
        primary = st.get_option("theme.primaryColor")
        bg = st.get_option("theme.backgroundColor")
        secondary_bg = st.get_option("theme.secondaryBackgroundColor")
        text = st.get_option("theme.textColor")
        font = st.get_option("theme.font")

        if any(v is not None for v in (active_base, primary, bg, secondary_bg, text, font)):
            # Build from the available options (falling back if some are None)
            return {
                'base': active_base or ('dark' if theme_mode == 'dark' else 'light'),
                'primaryColor': primary or ('#f4b11c'),
                'backgroundColor': bg or ('#0e1117' if (active_base or theme_mode) == 'dark' else '#e6e6e6'),
                'secondaryBackgroundColor': secondary_bg or ('#262730' if (active_base or theme_mode) == 'dark' else '#ffffff'),
                'textColor': text or ('#fafafa' if (active_base or theme_mode) == 'dark' else '#002f67'),
                'font': font or 'monospace',
            }
    except Exception:
        # Ignore and try filesystem config
        pass

    # 2) Fallback to config files
    try:
        config_path = os.path.join(os.path.dirname(__file__), "../.streamlit/config.toml")
        with open(config_path, 'r') as f:
            cfg = toml.load(f)

        theme = cfg.get('theme', {})
        # Handle [theme.dark] if present and either explicitly requested or active via base
        requested = (theme_mode == 'dark') or (theme.get('base') == 'dark')
        dark_variant = None
        if isinstance(theme, dict):
            dark_variant = theme.get('dark')  # from [theme.dark]

        if requested and isinstance(dark_variant, dict):
            return dark_variant

        # Remove nested dark variant key for the light/base theme
        if isinstance(theme, dict) and 'dark' in theme:
            theme = {k: v for k, v in theme.items() if k != 'dark'}
        return theme
    except (FileNotFoundError, toml.TomlDecodeError):
        pass

    # 3) Hardcoded defaults
    if theme_mode == 'dark':
        return {
            'base': 'dark',
            'primaryColor': '#f4b11c',
            'backgroundColor': '#0e1117',
            'secondaryBackgroundColor': '#262730',
            'textColor': '#fafafa',
            'font': 'monospace'
        }
    else:
        return {
            'base': 'light',
            'primaryColor': '#f4b11c',
            'backgroundColor': '#e6e6e6',
            'secondaryBackgroundColor': '#ffffff',
            'textColor': '#002f67',
            'font': 'monospace'
        }


def get_swipecard_colors(theme_mode: str | None = None) -> dict:
    """Get color configuration for streamlit_swipecards based on current theme."""
    theme = load_theme_config(theme_mode)
    
    # Determine if we're in dark mode
    is_dark = theme.get('base') == 'dark' or theme.get('backgroundColor') in ['#0e1117', '#262730']
    
    # Button background color based on theme mode
    button_bg = "#262730" if is_dark else "#E6E6E6"
    
    return {
        # All buttons use the same background color
        "like_bg": button_bg,
        "like_fg": theme.get('textColor', '#fafafa' if is_dark else '#002f67'),
        "pass_bg": button_bg,
        "pass_fg": theme.get('textColor', '#fafafa' if is_dark else '#002f67'),
        "back_bg": button_bg,
        "back_fg": theme.get('textColor', '#fafafa' if is_dark else '#002f67'),
        "btn_border": theme.get('textColor', '#fafafa' if is_dark else '#002f67'),
        # Card and background colors from theme
        "card_bg": theme.get('secondaryBackgroundColor', '#262730' if is_dark else '#ffffff'),
        "background_color": theme.get('backgroundColor', '#0e1117' if is_dark else '#e6e6e6'),
        "secondary_background_color": theme.get('secondaryBackgroundColor', '#262730' if is_dark else '#ffffff'),
        "text_color": theme.get('textColor', '#fafafa' if is_dark else '#002f67'),
    }


def apply_base_styles(theme_mode: str | None = None):
    """Apply base styles that are common across all pages"""
    theme = load_theme_config(theme_mode)
    
    # Extract theme values and clean them
    bg_color = theme.get('backgroundColor', '#e6e6e6').strip()
    text_color = theme.get('textColor', '#002f67').strip()
    primary_color = theme.get('primaryColor', '#002f67').strip()
    secondary_bg = theme.get('secondaryBackgroundColor', '#ffffff').strip()
    font = theme.get('font', 'monospace')
    base_theme = theme.get('base', 'light')
    
    # Determine contrasting colors for button text based on theme
    if base_theme == 'dark':
        button_text_color = '#ffffff'  # White text on dark themes
        button_hover_color = '#333333'  # Darker background on hover
    else:
        button_text_color = '#ffffff'  # White text on light themes for better contrast
        button_hover_color = '#f0f0f0'  # Light background on hover
    
    # Ensure proper hex color format (remove extra characters)
    if len(text_color) > 7:
        text_color = text_color[:7]
    if len(bg_color) > 7:
        bg_color = bg_color[:7]
    if len(primary_color) > 7:
        primary_color = primary_color[:7]
    if len(secondary_bg) > 7:
        secondary_bg = secondary_bg[:7]
    
    st.markdown(
        f"""
        <style>
          /* Global theme application */
          :root {{
            --primary-color: {primary_color};
            --background-color: {bg_color};
            --secondary-background-color: {secondary_bg};
            --text-color: {text_color};
            --button-text-color: {button_text_color};
            --font-family: {font};
          }}
          
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
          
          /* Buttons and interactive elements */
          .stButton > button, [data-testid="baseButton-primary"] {{
            background-color: {secondary_bg} !important;
            color: {text_color} !important;
            border: 1px solid {text_color}66 !important;
            font-weight: 500 !important;
            font-family: {font} !important;
          }}
          
          .stButton > button:hover, [data-testid="baseButton-primary"]:hover {{
            background-color: {bg_color} !important;
            border-color: {text_color} !important;
            color: {text_color} !important;
          }}
          
          /* Secondary buttons */
          .stButton > button[kind="secondary"] {{
            background-color: transparent !important;
            color: {text_color} !important;
            border: 1px solid {text_color}66 !important;
          }}
          
          .stButton > button[kind="secondary"]:hover {{
            background-color: {secondary_bg} !important;
            color: {text_color} !important;
          }}
          
          /* Swipe card buttons - prefer theme backgroundColor */
          /* These selectors are intentionally broad to catch custom classes */
          [data-testid^="swipecards"],
          .swipecards, .swipe-card, .swipe-button {{
            --swipe-bg: {bg_color};
            --swipe-fg: {text_color};
          }}
          [data-testid^="swipecards"] button,
          .swipecards button,
          .swipe-card button,
          .swipe-button {{
            background-color: var(--swipe-bg) !important;
            color: var(--swipe-fg) !important;
            border: 2px solid {text_color}66 !important;
            border-radius: 8px !important;
            font-family: {font} !important;
            font-weight: 600 !important;
          }}
          [data-testid^="swipecards"] button:hover,
          .swipecards button:hover,
          .swipe-card button:hover,
          .swipe-button:hover {{
            background-color: {secondary_bg} !important;
            border-color: {text_color} !important;
            transform: scale(1.02) !important;
          }}
          
          /* Form elements */
          .stSelectbox > div > div, .stTextInput > div > div > input,
          .stNumberInput > div > div > input, .stTextArea > div > div > textarea {{
            background-color: {secondary_bg} !important;
            color: {text_color} !important;
            border-color: {primary_color} !important;
          }}
          
          /* Expanders */
          .streamlit-expanderHeader {{
            background-color: {secondary_bg} !important;
            color: {text_color} !important;
          }}
          
          .streamlit-expanderContent {{
            background-color: {bg_color} !important;
            color: {text_color} !important;
          }}
          
          /* Tables */
          .stDataFrame, [data-testid="stDataFrame"] {{
            background-color: {secondary_bg} !important;
            color: {text_color} !important;
          }}
          
          .stDataFrame table, [data-testid="stDataFrame"] table {{
            background-color: {secondary_bg} !important;
            color: {text_color} !important;
          }}
          
          .stDataFrame th, [data-testid="stDataFrame"] th {{
            background-color: {primary_color} !important;
            color: {button_text_color} !important;
          }}

          /* Static tables (st.table) */
          [data-testid="stTable"] {{
            background-color: {secondary_bg} !important;
            color: {text_color} !important;
            border-color: {primary_color} !important;
          }}
          [data-testid="stTable"] table {{
            background-color: {secondary_bg} !important;
            color: {text_color} !important;
          }}
          [data-testid="stTable"] th {{
            background-color: {primary_color} !important;
            color: {button_text_color} !important;
          }}
          
          /* Tabs */
          .stTabs [data-baseweb="tab-list"] {{
            background-color: {secondary_bg} !important;
          }}
          
          .stTabs [data-baseweb="tab"] {{
            background-color: {secondary_bg} !important;
            color: {text_color} !important;
          }}
          
          .stTabs [aria-selected="true"] {{
            background-color: {primary_color} !important;
            color: {button_text_color} !important;
          }}
          
          /* Columns */
          .stColumn {{
            background-color: inherit !important;
            color: {text_color} !important;
          }}
          
          /* Metrics */
          .metric-container {{
            background-color: {secondary_bg} !important;
            color: {text_color} !important;
          }}
          
          /* Progress bars */
          .stProgress > div > div {{
            background-color: {primary_color} !important;
          }}
          
          /* Sliders */
          .stSlider > div > div > div > div {{
            background-color: {primary_color} !important;
          }}
          
          /* Radio buttons and checkboxes */
          .stRadio > div, .stCheckbox > div {{
            color: {text_color} !important;
          }}
          
          /* Alerts and messages */
          .stAlert {{
            background-color: {secondary_bg} !important;
            color: {text_color} !important;
          }}
          
          /* Code blocks */
          .stCodeBlock, code {{
            background-color: {secondary_bg} !important;
            color: {text_color} !important;
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


def apply_folding_styles(theme_mode=None):
    """Apply styles specific to domain and quality based folding pages"""
    theme = load_theme_config(theme_mode)
    
    # Extract theme values and clean them
    bg_color = theme.get('backgroundColor', '#e6e6e6').strip()
    text_color = theme.get('textColor', '#002f67').strip()
    secondary_bg = theme.get('secondaryBackgroundColor', '#ffffff').strip()
    font = theme.get('font', 'monospace')
    base_theme = theme.get('base', 'light')
    
    # Ensure proper hex color format
    if len(text_color) > 7:
        text_color = text_color[:7]
    if len(bg_color) > 7:
        bg_color = bg_color[:7]
    if len(secondary_bg) > 7:
        secondary_bg = secondary_bg[:7]
    
    st.markdown(
        f"""
        <style>
        div.action-container div[data-testid="stHorizontalBlock"] {{
            gap: 0 !important;
        }}
        div.action-container div[data-testid="column"] {{
            padding: 0 !important;
            flex: 1 1 0 !important;
        }}
        div.action-container button {{
            margin: 0 !important;
            width: 100%;
        }}
        div[data-testid="baseButton-primary"] > button {{
            background-color: #ff4b4b !important;
            color: white !important;
        }}

        /* Distinct style for the per-fold "Show more" control */
        .show-more-container button {{
            background-color: {secondary_bg} !important;
            color: {text_color} !important;
            border: 1px solid {text_color}66 !important;
            box-shadow: none !important;
            font-family: {font} !important;
        }}
        .show-more-container button:hover {{
            background-color: {bg_color} !important;
            border-color: {text_color} !important;
        }}
        .show-more-container [data-testid="stButton"] {{
            width: 100% !important;
        }}
        </style>
        """,
        unsafe_allow_html=True,
    )
