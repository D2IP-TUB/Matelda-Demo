"""Pure labeling logic: cards, candidate ordering, judging against ground truth."""
from pathlib import Path
from typing import Any

import pandas as pd
from pydantic import BaseModel

from api.tables import resolve_table


def cell_key(table: str, row: int, col: str) -> str:
    return f"{table}|{int(row)}|{col}"


def parse_cell_key(key: str) -> tuple[str, int, str]:
    parts = key.split("|", 2)
    if len(parts) != 3 or not parts[0] or not parts[2]:
        raise ValueError(f"Malformed cell key: {key!r}")
    try:
        return parts[0], int(parts[1]), parts[2]
    except ValueError:
        raise ValueError(f"Malformed cell key: {key!r}")


class Card(BaseModel):
    key: str
    table: str
    row: int
    col: str
    val: Any = ""
    domain_fold: str = ""
    cell_fold: str = ""
    strategies: list[str] = []


def _card(cell: dict[str, Any], domain: str, fold: str) -> Card:
    return Card(
        key=cell_key(cell["table"], cell["row"], cell["col"]),
        table=cell["table"],
        row=int(cell["row"]),
        col=cell["col"],
        val=cell.get("val", ""),
        domain_fold=domain,
        cell_fold=fold,
        strategies=list(cell.get("strategies") or []),
    )


def sampled_to_cards(sampled: list[dict[str, Any]]) -> list[Card]:
    return [_card(c, c.get("domain_fold", ""), c.get("cell_fold", "")) for c in sampled]


def candidate_keys(
    sampled: list[dict[str, Any]], cell_folds: dict[str, Any], skip_folds: set[str]
) -> list[str]:
    """The sampler's cells first, then the rest round-robin across the folds.

    Same ordering as `extend_candidates` in components/room_labeling.py: with several
    players the sampler alone has too few cells, so every fold keeps contributing."""
    keys = [cell_key(c["table"], c["row"], c["col"]) for c in sampled]
    seen = set(keys)
    queues = [
        iter(cells)
        for folds in cell_folds.values()
        for fold, cells in folds.items()
        if fold not in skip_folds
    ]
    while queues:
        alive = []
        for it in queues:
            for cell in it:
                key = cell_key(cell["table"], cell["row"], cell["col"])
                if key in seen:
                    continue
                seen.add(key)
                keys.append(key)
                alive.append(it)
                break
        queues = alive
    return keys


def cards_for_keys(cell_folds: dict[str, Any], keys: list[str]) -> list[Card]:
    index: dict[str, Card] = {}
    wanted = set(keys)
    for domain, folds in cell_folds.items():
        for fold, cells in folds.items():
            for cell in cells:
                key = cell_key(cell["table"], cell["row"], cell["col"])
                if key in wanted and key not in index:
                    index[key] = _card(cell, domain, fold)
    return [index[k] for k in keys if k in index]


class Verdict(BaseModel):
    table: str
    row: int
    col: str
    said_correct: bool


def judge(dataset_dir: Path, verdicts: list[Verdict]) -> list[bool | None]:
    """Was each verdict right according to ground truth? None when it cannot be told."""
    frames: dict[str, tuple[pd.DataFrame, pd.DataFrame] | None] = {}

    def pair(table: str):
        if table not in frames:
            table_dir = resolve_table(dataset_dir, table)
            try:
                read = lambda name: pd.read_csv(table_dir / name, dtype=str, keep_default_na=False)  # noqa: E731
                frames[table] = (read("dirty.csv"), read("clean.csv")) if table_dir else None
            except Exception:
                frames[table] = None
        return frames[table]

    out: list[bool | None] = []
    for v in verdicts:
        both = pair(v.table)
        if both is None:
            out.append(None)
            continue
        dirty, clean = both
        try:
            is_error = dirty.at[v.row, v.col] != clean.at[v.row, v.col]
        except (KeyError, IndexError, ValueError):
            out.append(None)
            continue
        out.append((not v.said_correct) == bool(is_error))
    return out
