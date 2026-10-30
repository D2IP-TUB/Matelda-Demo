import os

import streamlit as st
from components import apply_base_styles, get_current_theme, render_sidebar
from components.room_ui import render_room

st.set_page_config(page_title="Lobby", layout="wide")
apply_base_styles(get_current_theme())
render_sidebar()

st.title("Lobby")

datasets_root = os.path.join(os.path.dirname(__file__), "../datasets")
datasets = sorted(
    d for d in os.listdir(datasets_root)
    if os.path.isdir(os.path.join(datasets_root, d))
)
room, player, dataset = render_room(datasets)

if room["phase"] != "lobby":
    col_l, col_c, col_r = st.columns([2, 1, 2])
    with col_c:
        if st.button("Next → Intro", use_container_width=True):
            st.switch_page("pages/InputOutput.py")
