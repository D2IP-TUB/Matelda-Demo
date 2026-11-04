"""Read-only summaries for the Results page."""
import json
import threading
from pathlib import Path
from typing import Any

import pandas as pd

from api import pipelines as store
from api.tables import list_tables


def _metric(metrics: dict[str, Any], name: str) -> float | None:
    value = metrics.get(name, metrics.get(name.capitalize(), metrics.get(name.upper())))
    return float(value) if isinstance(value, (int, float)) else None


def latest_metrics(config: dict[str, Any]) -> dict[str, Any] | None:
    detection = config.get("error_detection")
    if detection and detection.get("metrics"):
        source, time = detection["metrics"], detection.get("time", "")
    elif config.get("results"):
        entry = config["results"][-1]
        source, time = entry.get("metrics", {}), entry.get("Time", "")
    else:
        return None
    return {
        "precision": _metric(source, "precision"),
        "recall": _metric(source, "recall"),
        "f1": _metric(source, "f1"),
        "time": time,
    }


_summary_cache: dict[str, tuple[tuple[int, int], dict[str, Any]]] = {}
_summary_lock = threading.Lock()


def _summary(pipeline_dir: Path) -> dict[str, Any] | None:
    """Just the few fields the comparison table needs from a pipeline's config.

    The config files are huge (all folds and cells), and parsing every pipeline's on each Results visit took seconds.
    The small summary is cached per pipeline and re-read only when its file changes (mtime + size).
    """
    path = pipeline_dir / "configurations.json"
    try:
        st = path.stat()
    except OSError:
        return None
    stamp = (st.st_mtime_ns, st.st_size)
    key = str(path)
    with _summary_lock:
        hit = _summary_cache.get(key)
    if hit is not None and hit[0] == stamp:
        return hit[1]
    try:
        config = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    summary = {
        "dataset": config.get("selected_dataset"),
        "budget": config.get("labeling_budget"),
        "results": [
            {"Time": e.get("Time", ""), "metrics": e.get("metrics", {})} for e in config.get("results", [])
        ],
    }
    with _summary_lock:
        _summary_cache[key] = (stamp, summary)
    return summary


def warm_summaries(pipelines_dir: Path) -> None:
    """Fill the cache ahead of time (at server start) so the first Results visit is not the slow one."""
    for name in store.list_pipelines(pipelines_dir):
        _summary(pipelines_dir / name)


def comparison_rows(pipelines_dir: Path, dataset: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for name in store.list_pipelines(pipelines_dir):
        summary = _summary(pipelines_dir / name)
        if summary is None or summary["dataset"] != dataset:
            continue
        for entry in summary["results"]:
            metrics = entry["metrics"]
            rows.append(
                {
                    "time": entry["Time"],
                    "pipeline": name,
                    "labeling_budget": summary["budget"],
                    "precision": _metric(metrics, "precision"),
                    "recall": _metric(metrics, "recall"),
                    "f1": _metric(metrics, "f1"),
                }
            )
    return sorted(rows, key=lambda r: r["time"], reverse=True)


def raha_baseline(csv_path: Path, budget: int) -> dict[str, Any] | None:
    if budget <= 0 or not csv_path.is_file():
        return None
    df = pd.read_csv(csv_path)
    if df.empty:
        return None
    row = df.iloc[(df["labeling_budget"] - budget).abs().argsort().iloc[0]]
    return {
        "labeling_budget": int(row["labeling_budget"]),
        "precision": float(row["precision"]),
        "recall": float(row["recall"]),
        "f1": float(row["f_score"]),
    }


def _ground_truth(dataset_dir: Path) -> dict[tuple[str, int, str], tuple[bool, str]]:
    truth: dict[tuple[str, int, str], tuple[bool, str]] = {}
    for table in list_tables(dataset_dir):
        try:
            dirty = pd.read_csv(dataset_dir / table / "dirty.csv", dtype=str, keep_default_na=False)
            clean = pd.read_csv(dataset_dir / table / "clean.csv", dtype=str, keep_default_na=False)
        except Exception:
            continue
        if len(dirty.columns) != len(clean.columns):
            continue
        dirty.columns = clean.columns
        for r in range(min(len(dirty), len(clean))):
            for col in clean.columns:
                truth[(table, r, col)] = (dirty.at[r, col] != clean.at[r, col], clean.at[r, col])
    return truth


def label_accuracy(pipeline_dir: Path, dataset_dir: Path) -> dict[str, Any]:
    labels_file = pipeline_dir / "user_labels.csv"
    if not labels_file.is_file():
        raise FileNotFoundError("No saved user labels")
    labels = pd.read_csv(labels_file, dtype={"val": str}, keep_default_na=False)
    truth = _ground_truth(dataset_dir)
    rows = []
    for _, label in labels.iterrows():
        key = (str(label["table"]), int(label["row"]), str(label["col"]))
        if key not in truth:
            continue
        is_error, clean_value = truth[key]
        said_error = str(label["is_error"]).lower() == "true"
        rows.append(
            {
                "table": key[0],
                "row": key[1],
                "col": key[2],
                "val": str(label.get("val", "")),
                "user_said_error": said_error,
                "truth_is_error": is_error,
                "clean_value": clean_value,
                "correct": said_error == is_error,
            }
        )
    correct = sum(1 for r in rows if r["correct"])
    return {
        "rows": rows,
        "total": len(rows),
        "correct": correct,
        "accuracy": (correct / len(rows)) if rows else 0.0,
    }
