import backend.cache_utils as cache_utils
import streamlit as st
from components import apply_base_styles, render_sidebar

cache_utils.set_cache_dir("/home/fatemeh/matelda-demo/temp-cache")

st.set_page_config(page_title="Matelda", layout="wide")

# Apply base styles
apply_base_styles()

st.title("Matelda")
st.write("Welcome to Matelda!")
st.markdown("""
The underlying paper is available on [OpenProceedings](https://www.openproceedings.org/2025/conf/edbt/paper-98.pdf).
The Repository of the Demo is available on [GitHub](https://github.com/lejuliennn/Matelda-Demo).
Click the button below to start the demo.
""")

# Sidebar Navigation
render_sidebar()

# Start Button
if st.button("Start"):
    st.switch_page("pages/Configurations.py")
