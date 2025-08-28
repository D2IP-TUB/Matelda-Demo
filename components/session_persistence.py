"""
Lightweight persistence of Streamlit session_state across browser reloads.

We store a JSON snapshot of selected session keys in a per-session file
under `.streamlit/sessions/<sid>.json` and keep a `sid` in URL query params
so the same browser tab reloads restore the same state.
"""
from __future__ import annotations

import json
import os
import uuid
from typing import Any, Dict, Iterable, Optional
import hashlib

import streamlit as st


# ----------------------------
# Helpers
# ----------------------------
def _project_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _sessions_dir() -> str:
    d = os.path.join(_project_root(), ".streamlit", "sessions")
    os.makedirs(d, exist_ok=True)
    return d


def _session_file(sid: str) -> str:
    return os.path.join(_sessions_dir(), f"{sid}.json")


def _get_or_create_sid() -> str:
    # Prefer new Streamlit API when available
    try:
        qp = st.query_params
        sid = qp.get("sid")
        if not sid:
            sid = uuid.uuid4().hex
            qp["sid"] = sid
        return sid
    except Exception:
        # Fallback to experimental API (older versions)
        qp = st.experimental_get_query_params()
        sid = qp.get("sid", [None])[0]
        if not sid:
            sid = uuid.uuid4().hex
            st.experimental_set_query_params(sid=sid)
        return sid


def _set_query_params(params: Dict[str, Any]) -> None:
    try:
        st.query_params.update(params)
    except Exception:
        st.experimental_set_query_params(**params)


def _clear_sid_param() -> None:
    try:
        qp = dict(st.query_params)
    except Exception:
        qp = {k: v[0] if isinstance(v, list) and v else v for k, v in st.experimental_get_query_params().items()}
    qp.pop("sid", None)
    _set_query_params(qp)


def _is_jsonable(value: Any) -> bool:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return True
    if isinstance(value, (list, tuple)):
        return all(_is_jsonable(v) for v in value)
    if isinstance(value, dict):
        return all(isinstance(k, str) and _is_jsonable(v) for k, v in value.items())
    return False


# ----------------------------
# Public API
# ----------------------------
DEFAULT_INCLUDE_PREFIXES: tuple[str, ...] = (
    # Global pipeline + dataset selections
    "pipeline_",
    "selected_pipeline",
    "dataset_select",
    # Budgets and strategies
    "budget_",
    "labeling_budget",
    "selected_strategies",
    # Domain/quality folding derived state
    "table_locations",
    "domain_folds",
    "cell_folds",
    "merge_mode",
    "selected_folds",
    "global_split_mode",
    "selected_split_tables",
    "run_folding",
)


def init_session_persistence(include_prefixes: Optional[Iterable[str]] = None) -> None:
    """Initialize persistence and restore a prior snapshot for this tab.

    Call this once early in each page before widgets read state.
    """
    sid = _get_or_create_sid()
    snap_path = _session_file(sid)
    if os.path.exists(snap_path):
        try:
            with open(snap_path, "r") as f:
                data = json.load(f)
            # Only set keys not already present (let current run override)
            for k, v in data.items():
                if k not in st.session_state:
                    st.session_state[k] = v
        except Exception:
            # Corrupt snapshot: ignore and continue
            pass


def persist_session(include_prefixes: Optional[Iterable[str]] = None) -> None:
    """Persist a filtered snapshot of session_state for this tab."""
    sid = _get_or_create_sid()
    prefixes = tuple(include_prefixes) if include_prefixes is not None else DEFAULT_INCLUDE_PREFIXES

    snapshot: Dict[str, Any] = {}
    for key, val in st.session_state.items():
        if not any(str(key).startswith(p) for p in prefixes):
            continue
        if _is_jsonable(val):
            snapshot[key] = val

    try:
        with open(_session_file(sid), "w") as f:
            json.dump(snapshot, f, indent=2)
    except Exception:
        # Best-effort; ignore write failures
        pass


def clear_persisted_session() -> None:
    """Delete the persisted snapshot for this tab and clear sid param."""
    try:
        qp_sid = None
        try:
            qp_sid = st.query_params.get("sid")
        except Exception:
            qp = st.experimental_get_query_params()
            qp_sid = qp.get("sid", [None])[0]
        if qp_sid:
            snap = _session_file(qp_sid)
            if os.path.exists(snap):
                try:
                    os.remove(snap)
                except Exception:
                    pass
    finally:
        # Remove sid from URL to force a clean session on next run
        _clear_sid_param()


def get_session_hash(length: int = 6) -> str:
    """Return a short, stable hash for the current Streamlit tab session.

    Uses the per-tab sid (stored in URL query params) and returns the first
    `length` hex chars of a SHA1 digest, defaulting to 6.
    """
    try:
        sid = _get_or_create_sid()
        digest = hashlib.sha1(str(sid).encode("utf-8")).hexdigest()
        n = max(1, int(length))
        return digest[:n]
    except Exception:
        # Fallback to a random-like short value if anything goes wrong
        return uuid.uuid4().hex[:max(1, int(length))]
