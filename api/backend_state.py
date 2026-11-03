"""Run the Streamlit-era `backend_*` functions outside Streamlit.

Some of them read the pipeline, the cell folds or the propagation results from
`st.session_state`. `backend_state` provides exactly those keys for the duration of one
call. A module lock serialises callers, so two requests never see each other's state.
When Streamlit is dropped, replace this shim with explicit function parameters.
"""
import threading
from contextlib import contextmanager
from typing import Any, Iterator

import streamlit as st

_lock = threading.RLock()


class _State(dict):
    """dict that also supports attribute access, like Streamlit's session state."""

    def __getattr__(self, name: str) -> Any:
        try:
            return self[name]
        except KeyError:
            raise AttributeError(name)

    def __setattr__(self, name: str, value: Any) -> None:
        self[name] = value


@contextmanager
def backend_state(**state: Any) -> Iterator[None]:
    with _lock:
        original = st.session_state
        st.session_state = _State(state)
        try:
            yield
        finally:
            st.session_state = original
