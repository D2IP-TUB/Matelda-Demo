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


class LabeledCell(BaseModel):
    table: str
    row: int
    col: str
    val: Any = ""
    is_error: bool
    domain_fold: str = ""
    cell_fold: str = ""


class RoomLabel(BaseModel):
    cell_id: str
    player: str
    value: bool  # True = the player said "correct"


def merge_with_pool(
    own: list[dict[str, Any]],
    room_labels: list[dict[str, Any]],
    player_id: str | None,
    cell_folds: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Combine this player's labeled cells with everyone's labels in the room.

    Port of `merge_with_pool` in components/room_labeling.py. Every cell gets the majority
    verdict of all votes on it; an exact tie is disputed and left out. Other players' labels
    are mapped onto this player's folds (cells that are not in them are dropped). The player's
    own room label for a cell that is in `own` is ignored: the card on screen is the verdict."""
    lookup: dict[str, tuple[str, str, Any]] = {}
    for domain, folds in cell_folds.items():
        for fold, cells in folds.items():
            for c in cells:
                lookup[cell_key(c["table"], c["row"], c["col"])] = (domain, fold, c.get("val", ""))

    votes: dict[str, list[bool]] = {}  # cell key -> list of is_error votes
    cells: dict[str, dict[str, Any]] = {}
    for c in own:
        key = cell_key(c["table"], c["row"], c["col"])
        votes.setdefault(key, []).append(bool(c["is_error"]))
        cells[key] = dict(c)
    for label in room_labels:
        key = label["cell_id"]
        if player_id is not None and label["player"] == player_id and key in cells:
            continue
        hit = lookup.get(key)
        if not hit:
            continue
        votes.setdefault(key, []).append(not label["value"])
        if key not in cells:
            table, row, col = parse_cell_key(key)
            cells[key] = {
                "table": table, "row": row, "col": col, "val": hit[2],
                "domain_fold": hit[0], "cell_fold": hit[1],
            }

    merged, disputed = [], []
    for key, vs in votes.items():
        errors = sum(vs)
        if errors * 2 == len(vs):
            disputed.append(key)
            continue
        cells[key]["is_error"] = errors * 2 > len(vs)
        merged.append(cells[key])
    return merged, disputed
