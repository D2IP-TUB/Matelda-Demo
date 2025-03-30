import streamlit as st

st.set_page_config(page_title="Matelda", layout="wide")

# Hide default Streamlit menu
st.markdown("""
    <style>
        [data-testid="stSidebarNav"] {display: none;}
    </style>
""", unsafe_allow_html=True)

st.title("Matelda")
st.write("Welcome to Matelda!")
st.markdown("""Read the full paper [here](https://www.openproceedings.org/2025/conf/edbt/paper-98.pdf) or click the button below to continue with configurations.""")

# Sidebar Navigation (Rebuilt)
with st.sidebar:
    st.page_link("app.py", label="Matelda")
    st.page_link("pages/Configurations.py", label="Configurations")
    st.page_link("pages/DomainBasedFolding.py", label="Domain Based Folding")
    st.page_link("pages/QualityBasedFolding.py", label="Quality Based Folding")
    st.page_link("pages/Labeling.py", label="Labeling")
    st.page_link("pages/ErrorDetection.py", label="Error Detection")
    st.page_link("pages/Results.py", label="Results")

    #st.markdown("---")
    #st.markdown("### Tests")
    #st.page_link("pages/Test.py", label="Test")
    #st.page_link("pages/Test3.py", label="Test 3")
    #st.page_link("pages/Test6.py", label="Test 6")
    #st.page_link("pages/Test5.py", label="Test 5")

# Start Button
if st.button("Start"):
    st.switch_page("pages/Configurations.py")
