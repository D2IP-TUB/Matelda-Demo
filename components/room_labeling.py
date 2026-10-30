"""Glue between a multiplayer room and the labeling page.

Cells are identified by `table|row|col` so labels stay meaningful across
players whose folding configurations differ.
"""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Any, Dict, List, Optional, Set, Tuple

import pandas as pd
import streamlit as st

from . import room_store as rs
from .utils import get_datasets_path


def cell_key(table: str, row: Any, col: str) -> str:
    return f"{table}|{int(row)}|{col}"


def parse_cell_key(key: str) -> Tuple[str, int, str]:
    table, row, col = key.split("|", 2)
    return table, int(row), col


def current_room_player() -> Tuple[Optional[Dict], Optional[Dict]]:
    """(room, player) for this session, or (None, None) when playing solo."""
    name, token = st.session_state.get("room_name"), st.session_state.get("player_token")
    if not name or not token:
        return None, None
    room = rs.get_room(name)
    player = rs.get_player(name, token) if room else None
    return (room, player) if player else (None, None)


@lru_cache(maxsize=64)
def _truth_pair(dataset_path: str, table: str):
    folder = os.path.join(dataset_path, table)
    try:
        read = lambda f: pd.read_csv(os.path.join(folder, f), dtype=str, keep_default_na=False)
        return read("dirty.csv"), read("clean.csv")
    except Exception:
        return None


def label_is_correct(dataset: str, table: str, row: int, col: str,
                     said_correct: bool) -> Optional[bool]:
    """Compare a player's verdict with ground truth (None if no clean.csv)."""
    pair = _truth_pair(get_datasets_path(dataset), table)
    if pair is None:
        return None
    dirty, clean = pair
    try:
        is_error = dirty.at[row, col] != clean.at[row, col]
    except Exception:
        return None
    return (not said_correct) == is_error


def extend_candidates(base: List[Dict[str, Any]], cell_folds: Dict[str, Any],
                      skip_folds: Set[str]) -> List[Dict[str, Any]]:
    """Append the rest of the folds' cells after the sampler's preselected ones.

    The sampler never returns more than its preselected cells, which is too few
    once several players share a room. Extra cells are taken round-robin across
    folds so every player still covers every fold."""
    out = list(base)
    seen = {cell_key(c["table"], c["row"], c["col"]) for c in base}
    queues = [
        (domain, fold, iter(cells))
        for domain, folds in cell_folds.items()
        for fold, cells in folds.items()
        if fold not in skip_folds
    ]
    next_id = max((c["id"] for c in base), default=0) + 1
    while queues:
        alive = []
        for domain, fold, it in queues:
            for cell in it:
                key = cell_key(cell["table"], cell["row"], cell["col"])
                if key in seen:
                    continue
                seen.add(key)
                out.append({
                    "id": next_id,
                    "name": f"{fold} - {cell['table']}",
                    "table": cell["table"], "row": cell["row"], "col": cell["col"],
                    "val": cell.get("val", ""),
                    "domain_fold": domain, "cell_fold": fold,
                    "cell_fold_label": "neutral",
                    "features": cell.get("features", {}),
                    "strategies": cell.get("strategies", []),
                })
                next_id += 1
                alive.append((domain, fold, it))
                break
        queues = alive
    return out


def claim_for_player(room: Dict, player: Dict, candidates: List[Dict[str, Any]],
                     budget: int) -> List[Dict[str, Any]]:
    """Keep the first `budget` candidates nobody else holds, claiming them.

    `candidates` is the sampler's full priority-ordered list, so cells taken by
    other players are skipped and replaced by the next ones in line."""
    keys = [cell_key(c["table"], c["row"], c["col"]) for c in candidates]
    got = set(rs.claim_cells(room["name"], player["id"], keys, budget))
    return [c for c, k in zip(candidates, keys) if k in got]


def merge_with_pool(room: Dict, player: Dict, cell_folds: Dict[str, Any],
                    own: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Combine this player's labeled cells with everyone else's from the room.

    Every cell gets one verdict: the majority of all players' votes on it. A
    50/50 cell is disputed and left out entirely. Other players' labels are
    mapped onto *this* player's folds; cells missing from their folding are
    dropped. The player's own earlier labels (from a previous round) count too. Returns (labeled_cells, disputed_cell_keys)."""
    lookup = {}
    for domain, folds in cell_folds.items():
        for fold_name, cells in folds.items():
            for c in cells:
                lookup[cell_key(c["table"], c["row"], c["col"])] = (domain, fold_name, c.get("val", ""))

    votes: Dict[str, List[bool]] = {}  # cell key -> list of is_error votes
    cells: Dict[str, Dict[str, Any]] = {}
    for c in own:
        key = cell_key(c["table"], c["row"], c["col"])
        votes.setdefault(key, []).append(bool(c["is_error"]))
        cells[key] = dict(c)
    for lab in rs.room_labels(room["name"]):
        key = lab["cell_id"]
        if lab["player"] == player["id"] and key in cells:
            continue  # the card on screen is this player's current verdict
        hit = lookup.get(key)
        if not hit:
            continue
        votes.setdefault(key, []).append(not lab["value"])
        if key not in cells:
            table, row, col = parse_cell_key(key)
            cells[key] = {"table": table, "row": row, "col": col, "val": hit[2],
                          "domain_fold": hit[0], "cell_fold": hit[1]}

    merged, disputed = [], []
    for key, vs in votes.items():
        errors = sum(vs)
        if errors * 2 == len(vs):
            disputed.append(key)
            continue
        cells[key]["is_error"] = errors * 2 > len(vs)
        merged.append(cells[key])
    return merged, disputed
