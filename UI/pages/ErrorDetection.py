import os
import time

import numpy as np
import pandas as pd
import streamlit as st

# Set the page title and layout
st.set_page_config(page_title="Error Detection", layout="wide")
st.title("Error Detection")

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

# Get the dataset path from session state; default to a specific folder if not set
datasets_path = st.session_state.get(
    "dataset_path", os.path.join(os.path.dirname(__file__), "../datasets/demo")
)

# Dynamically list all subfolders in the dataset path (each subfolder represents a table)
if os.path.exists(datasets_path):
    tables = [
        table
        for table in os.listdir(datasets_path)
        if os.path.isdir(os.path.join(datasets_path, table))
    ]
else:
    st.error("Dataset path does not exist!")
    tables = []

if "run_error_detection" not in st.session_state:
    st.session_state.run_error_detection = False

if st.button("▶️ Run Error Detection"):
    with st.spinner("🔄 Detecting errors... Please wait..."):
        time.sleep(3)  # Simulate processing delay
    st.session_state.run_error_detection = True
    st.rerun()  # Refresh to show tables


# Function to load the real table data and randomly mark some cells as errors
# def load_table_with_errors(table_name):
#     file_path = os.path.join(datasets_path, table_name, "dirty.csv")
#     try:
#         df = pd.read_csv(file_path)
#     except Exception as e:
#         df = pd.DataFrame({"Error": [f"Could not load {file_path}: {e}"]})
#         return df.style  # Return styled dataframe even if loading fails

#     # Randomly determine the number of errors (at least 2, up to 6 or total cell count)
#     total_cells = df.size
#     if total_cells == 0:
#         num_errors = 0
#     else:
#         num_errors = np.random.randint(2, min(6, total_cells) + 1)

#     # Randomly choose cell positions to mark as errors
#     error_positions = set()
#     for _ in range(num_errors):
#         r = np.random.randint(0, df.shape[0])
#         c = np.random.randint(0, df.shape[1])
#         error_positions.add((r, c))

#     # Define a style function to highlight the error cells
#     def highlight_errors(data):
#         df_styles = pd.DataFrame("", index=data.index, columns=data.columns)
#         for r, c in error_positions:
#             try:
#                 df_styles.iloc[r, c] = "background-color: red; color: white"
#             except Exception:
#                 pass
#         return df_styles

# return df.style.apply(highlight_errors, axis=None)


def load_table_with_errors(table_name):
    file_path = os.path.join(datasets_path, table_name, "dirty.csv")
    try:
        df = pd.read_csv(file_path)
    except Exception as e:
        df = pd.DataFrame({"Error": [f"Could not load {file_path}: {e}"]})
        return df.style

    error_positions = set()
    # Custom fixed errors for Lichess_2
    if table_name == "Lichess_2":
        error_positions.add((0, 0))  # Mark the first cell as an error
        error_positions.add((6, 0))  # Mark the second cell as an error
    else:
        # Randomly choose cell positions to mark as errors
        total_cells = df.size
        num_errors = (
            np.random.randint(2, min(6, total_cells) + 1) if total_cells > 0 else 0
        )
        error_positions = set()
        for _ in range(num_errors):
            r = np.random.randint(0, df.shape[0])
            c = np.random.randint(0, df.shape[1])
            error_positions.add((r, c))

    # Apply styles
    def highlight_errors(data):
        style_df = pd.DataFrame("", index=data.index, columns=data.columns)
        for r, c in error_positions:
            try:
                colname = style_df.columns[c]
                style_df.at[r, colname] = "background-color: red; color: white"
            except:
                pass
        return style_df

    return df.style.apply(highlight_errors, axis=None)


# If errors have been detected, display each table with errors highlighted
if st.session_state.run_error_detection:
    st.markdown("---")

    for table in tables:
        with st.expander(f"📊 {table} (Errors Highlighted)"):
            st.dataframe(load_table_with_errors(table))

    st.markdown("---")

    # Navigation button to move to the next page
    if st.button("Next"):
        st.switch_page("pages/Results.py")
