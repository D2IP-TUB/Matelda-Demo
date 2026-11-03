from pathlib import Path

from fastapi import Depends, HTTPException

from api.settings import Settings, get_settings


def list_datasets(root: Path) -> list[str]:
    if not root.is_dir():
        return []
    return sorted(p.name for p in root.iterdir() if p.is_dir())


def resolve_dataset(root: Path, name: str) -> Path | None:
    """Return the dataset directory only if `name` is exactly one of the listed datasets."""
    if name not in list_datasets(root):
        return None
    return root / name


def require_dataset(dataset: str, settings: Settings = Depends(get_settings)) -> str:
    if resolve_dataset(settings.datasets_dir, dataset) is None:
        raise HTTPException(status_code=404, detail="Unknown dataset")
    return dataset
