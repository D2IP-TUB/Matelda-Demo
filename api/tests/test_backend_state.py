import sys
import threading
import types

import pytest
import streamlit as st

from api import services
from api.backend_state import backend_state


def test_state_is_visible_in_all_access_styles_and_does_not_leak():
    original = st.session_state
    with backend_state(a=1, nested={"x": 2}):
        assert "a" in st.session_state and "zzz" not in st.session_state
        assert st.session_state.a == 1
        assert st.session_state["nested"] == {"x": 2}
        st.session_state.b = 5
        assert st.session_state["b"] == 5
        with pytest.raises(AttributeError):
            st.session_state.missing
    assert st.session_state is original
    assert "a" not in st.session_state


def test_original_state_is_restored_after_an_exception():
    original = st.session_state
    with pytest.raises(RuntimeError):
        with backend_state(a=1):
            raise RuntimeError("boom")
    assert st.session_state is original


def test_threads_never_see_each_others_state():
    seen = {}
    a_inside, release_a = threading.Event(), threading.Event()
    order = []

    def thread_a():
        with backend_state(who="A"):
            order.append("A in")
            a_inside.set()
            release_a.wait(timeout=5)
            seen["A"] = st.session_state.who
            order.append("A out")

    def thread_b():
        a_inside.wait(timeout=5)
        with backend_state(who="B"):
            order.append("B in")
            seen["B"] = st.session_state.who

    ta, tb = threading.Thread(target=thread_a), threading.Thread(target=thread_b)
    ta.start(), tb.start()
    a_inside.wait(timeout=5)
    release_a.set()
    ta.join(5), tb.join(5)
    assert seen == {"A": "A", "B": "B"}
    assert order == ["A in", "A out", "B in"]


@pytest.fixture
def fake_backend(monkeypatch):
    fake = types.ModuleType("backend")

    def read(*keys):
        return {k: st.session_state[k] for k in keys if k in st.session_state}

    fake.backend_sample_labeling = lambda *a: {"args": a, **read("pipeline_path", "cell_folds")}
    fake.backend_label_propagation = lambda *a: {"args": a, **read("pipeline_path", "cell_folds")}
    fake.backend_pull_errors = lambda *a: {"args": a, **read("pipeline_path", "propagation_results")}
    monkeypatch.setitem(sys.modules, "backend", fake)
    return fake


def test_sample_labeling_wrapper_provides_pipeline_and_folds(fake_backend):
    original = st.session_state
    out = services.sample_labeling("d", 7, {"cf": 1}, {"df": 2}, "/p/x")
    assert out == {"args": ("d", 7, {"cf": 1}, {"df": 2}), "pipeline_path": "/p/x", "cell_folds": {"cf": 1}}
    assert st.session_state is original


def test_label_propagation_wrapper(fake_backend):
    out = services.label_propagation("d", [{"t": 1}], {"cf": 1}, "/p/x")
    assert out["args"] == ("d", [{"t": 1}]) and out["pipeline_path"] == "/p/x" and out["cell_folds"] == {"cf": 1}


def test_pull_errors_wrapper(fake_backend):
    out = services.pull_errors("d", {"labeled_cells": []}, "/p/x")
    assert out == {"args": ("d",), "pipeline_path": "/p/x", "propagation_results": {"labeled_cells": []}}
