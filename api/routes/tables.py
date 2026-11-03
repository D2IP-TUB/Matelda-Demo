from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query

from api.datasets import require_dataset
from api.settings import Settings, get_settings
from api.tables import CompareResult, TablePage, compare, list_tables, read_page, resolve_table

router = APIRouter()


def _dataset_dir(dataset: str, settings: Settings) -> Path:
    return settings.datasets_dir / dataset


def _table_dir(dataset: str, table: str, settings: Settings) -> Path:
    found = resolve_table(_dataset_dir(dataset, settings), table)
    if found is None:
        raise HTTPException(status_code=404, detail="Unknown table")
    return found


@router.get("/datasets/{dataset}/tables")
def tables(
    dataset: str = Depends(require_dataset), settings: Settings = Depends(get_settings)
) -> list[str]:
    return list_tables(_dataset_dir(dataset, settings))


@router.get("/datasets/{dataset}/tables/{table}/dirty", response_model=TablePage)
def dirty(
    table: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    dataset: str = Depends(require_dataset),
    settings: Settings = Depends(get_settings),
) -> TablePage:
    return read_page(_table_dir(dataset, table, settings), offset, limit)


@router.get("/datasets/{dataset}/tables/{table}/compare", response_model=CompareResult)
def compare_table(
    table: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    dataset: str = Depends(require_dataset),
    settings: Settings = Depends(get_settings),
) -> CompareResult:
    table_dir = _table_dir(dataset, table, settings)
    try:
        return compare(table_dir, offset, limit)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
