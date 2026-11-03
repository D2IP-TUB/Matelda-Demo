import json
import re
import shutil
import threading
from pathlib import Path
from typing import Any, Callable

import numpy as np

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
CONFIG_KEYS = ("selected_dataset", "labeling_budget", "selected_strategies")
DERIVED_KEYS = ("domain_folds", "cell_folds", "results")


def valid_name(name: str) -> bool:
    return bool(NAME_RE.fullmatch(name))


def list_pipelines(root: Path) -> list[str]:
    if not root.is_dir():
        return []
    return sorted(p.name for p in root.iterdir() if p.is_dir())


def resolve_pipeline(root: Path, name: str) -> Path | None:
    if not valid_name(name):
        return None
    path = root / name
    return path if path.is_dir() else None


def load_config(pipeline_dir: Path) -> dict[str, Any]:
    path = pipeline_dir / "configurations.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text())


def _json_default(obj: Any) -> Any:
    """Make numpy scalars/arrays (returned by the ML code) JSON serialisable."""
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, np.generic):
        return obj.item()
    raise TypeError(f"Type {obj.__class__.__name__} not serializable")


def save_config(pipeline_dir: Path, config: dict[str, Any]) -> None:
    (pipeline_dir / "configurations.json").write_text(
        json.dumps(config, indent=4, default=_json_default)
    )


_config_lock = threading.Lock()


def update_config(pipeline_dir: Path, fn: Callable[[dict[str, Any]], dict[str, Any]]) -> dict[str, Any]:
    """Read-modify-write the pipeline config; requests cannot interleave."""
    with _config_lock:
        config = fn(load_config(pipeline_dir))
        save_config(pipeline_dir, config)
        return config


def suggest_name(root: Path, dataset: str, suffix: str) -> str:
    prefix, tail = f"{dataset}-pipeline-", f"-{suffix}"
    highest = 0
    for name in list_pipelines(root):
        if name.startswith(prefix) and name.endswith(tail):
            middle = name[len(prefix) : -len(tail)]
            if middle.isdigit():
                highest = max(highest, int(middle))
    return f"{prefix}{highest + 1:02d}{tail}"


def create_pipeline(root: Path, name: str, config: dict[str, Any]) -> None:
    root.mkdir(parents=True, exist_ok=True)
    path = root / name
    path.mkdir()  # FileExistsError if taken
    save_config(path, config)


def copy_pipeline(root: Path, src: str, dst: str) -> None:
    src_dir = root / src
    if not src_dir.is_dir():
        raise FileNotFoundError(src)
    shutil.copytree(src_dir, root / dst)  # FileExistsError if taken


def apply_update(existing: dict[str, Any], update: dict[str, Any]) -> dict[str, Any]:
    merged = dict(existing)
    old_dataset = existing.get("selected_dataset")
    for key in CONFIG_KEYS:
        merged[key] = update[key]
    if old_dataset is not None and old_dataset != update["selected_dataset"]:
        for key in DERIVED_KEYS:
            merged.pop(key, None)
    return merged
