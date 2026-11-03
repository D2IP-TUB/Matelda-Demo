from pathlib import Path

import pandas as pd
from pydantic import BaseModel


class TablePage(BaseModel):
    columns: list[str]
    rows: list[list[str]]
    total_rows: int
    offset: int


class CompareResult(BaseModel):
    columns: list[str]
    dirty_rows: list[list[str]]
    clean_rows: list[list[str]]
    diff: list[list[bool]]
    offset: int
    total_rows: int
    total_cells: int
    differing_cells: int
    error_rate: float


def list_tables(dataset_dir: Path) -> list[str]:
    if not dataset_dir.is_dir():
        return []
    return sorted(
        p.name for p in dataset_dir.iterdir() if p.is_dir() and (p / "dirty.csv").is_file()
    )


def resolve_table(dataset_dir: Path, name: str) -> Path | None:
    """Return the table directory only if `name` is exactly one of the listed tables."""
    if name not in list_tables(dataset_dir):
        return None
    return dataset_dir / name


def _read(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, dtype=str, keep_default_na=False)


def read_page(table_dir: Path, offset: int, limit: int) -> TablePage:
    df = _read(table_dir / "dirty.csv")
    page = df.iloc[offset : offset + limit]
    return TablePage(
        columns=list(df.columns),
        rows=page.values.tolist(),
        total_rows=len(df),
        offset=offset,
    )


def compare(table_dir: Path, offset: int, limit: int) -> CompareResult:
    clean_path = table_dir / "clean.csv"
    if not clean_path.is_file():
        raise FileNotFoundError("No clean.csv for this table")
    dirty, clean = _read(table_dir / "dirty.csv"), _read(clean_path)
    if list(dirty.columns) != list(clean.columns) or len(dirty) != len(clean):
        raise ValueError("dirty.csv and clean.csv have different columns or row counts")
    mask = dirty.ne(clean)
    total_cells = int(dirty.shape[0] * dirty.shape[1])
    differing = int(mask.to_numpy().sum())
    window = slice(offset, offset + limit)
    return CompareResult(
        columns=list(dirty.columns),
        dirty_rows=dirty.iloc[window].values.tolist(),
        clean_rows=clean.iloc[window].values.tolist(),
        diff=mask.iloc[window].values.tolist(),
        offset=offset,
        total_rows=len(dirty),
        total_cells=total_cells,
        differing_cells=differing,
        error_rate=(differing / total_cells * 100) if total_cells else 0.0,
    )
