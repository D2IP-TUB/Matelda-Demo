"""
Common CSS styling components for the application
"""
import streamlit as st


def apply_base_styles():
    """Apply base styles that are common across all pages"""
    st.markdown(
        """
        <style>
          /* Aggressively hide default Streamlit sidebar navigation */
          [data-testid="stSidebarNav"] {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
          }
          
          /* Hide any Streamlit navigation elements */
          .css-1d391kg, .css-1vencpc, .css-1lcbmhc, .css-17eq0hr {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
          }
          
          /* Prevent any sidebar navigation from appearing during page load */
          .stApp [data-testid="stSidebarNav"] {
            display: none !important;
          }
          
          /* Ensure fast rendering of custom sidebar content */
          .sidebar-nav {
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
          }

          [data-testid="stHorizontalBlock"] {
            flex-wrap: nowrap !important;
            overflow-x: auto !important;
          }
          [data-testid="stHorizontalBlock"] > div {
            padding: 0 !important;
          }

          [data-testid="stTable"],
          [data-testid="stCheckbox"] > div {
            flex: 0 0 auto !important;
          }

          @media (max-width: 768px) {
            .block-container {
              min-width: 0 !important;
            }
            [data-testid="stHorizontalBlock"] > div,
            [data-testid="stTable"],
            [data-testid="stCheckbox"] > div {
              min-width: 0 !important;
            }
          }
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
