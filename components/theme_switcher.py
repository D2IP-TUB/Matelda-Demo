"""
Theme switcher component - maintains light theme functionality without showing UI
Always uses custom light theme regardless of device dark mode settings
"""
import streamlit as st
import shutil
import os
import toml


def load_theme_config(theme_mode):
    """Load theme configuration from theme-specific file"""
    try:
        config_dir = os.path.join(os.path.dirname(__file__), "../.streamlit")
        config_file = os.path.join(config_dir, f"config_{theme_mode}.toml")
        
        if os.path.exists(config_file):
            with open(config_file, 'r') as f:
                config = toml.load(f)
                return config.get('theme', {})
        else:
            # Fallback to default values
            return get_default_theme_config(theme_mode)
    except Exception as e:
        st.error(f"Error loading theme config: {e}")
        return get_default_theme_config(theme_mode)


def get_default_theme_config(theme_mode):
    """Get default theme configuration as fallback"""
    if theme_mode == "dark":
        return {
            "base": "dark",
            "primaryColor": "#f4b11c",
            "backgroundColor": "#0e1117",
            "secondaryBackgroundColor": "#262730",
            "textColor": "#fafafa",
            "font": "monospace"
        }
    else:  # light theme
        return {
            "base": "light",
            "primaryColor": "#f4b11c",
            "backgroundColor": "#e6e6e6",
            "secondaryBackgroundColor": "#ffffff",
            "textColor": "#002f67",
            "font": "monospace"
        }


def render_theme_switcher():
    """Initialize and maintain light theme without showing UI"""
    
    # Always force light theme regardless of device settings
    if "current_theme" not in st.session_state:
        st.session_state.current_theme = "light"
        # Ensure light theme is applied
        switch_theme("light")
    
    # If somehow the theme is not light, force it back to light
    if st.session_state.current_theme != "light":
        st.session_state.current_theme = "light"
        switch_theme("light")
        st.rerun()
    
    # No UI is rendered - theme switcher is hidden but functionality preserved


def switch_theme(theme_mode):
    """Switch between light and dark themes by copying the appropriate config file"""
    try:
        config_dir = os.path.join(os.path.dirname(__file__), "../.streamlit")
        source_config = os.path.join(config_dir, f"config_{theme_mode}.toml")
        target_config = os.path.join(config_dir, "config.toml")
        
        if os.path.exists(source_config):
            # Copy the theme-specific config file
            shutil.copy2(source_config, target_config)
        else:
            # If theme file doesn't exist, create it dynamically
            theme_config = {
                "theme": get_default_theme_config(theme_mode)
            }
            with open(target_config, 'w') as f:
                toml.dump(theme_config, f)
            
    except Exception as e:
        st.error(f"Error switching theme: {e}")


def get_current_theme() -> dict:
    """Get the current (active) theme - always returns light theme configuration.
    
    This ensures the app always uses light theme regardless of device settings.
    """
    # Always return light theme configuration
    return get_default_theme_config("light")
