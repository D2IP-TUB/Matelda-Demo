"""Read-only summaries for the Results page."""
import json
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


def comparison_rows(pipelines_dir: Path, dataset: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for name in store.list_pipelines(pipelines_dir):
        try:
            config = store.load_config(pipelines_dir / name)
        except (OSError, json.JSONDecodeError):
            continue
        if config.get("selected_dataset") != dataset:
            continue
        for entry in config.get("results", []):
            metrics = entry.get("metrics", {})
            rows.append(
                {
                    "time": entry.get("Time", ""),
                    "pipeline": name,
                    "labeling_budget": config.get("labeling_budget"),
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
