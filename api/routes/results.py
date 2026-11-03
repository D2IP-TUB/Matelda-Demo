import csv
import io
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

from api import pipelines as store
from api.results import comparison_rows, label_accuracy, latest_metrics, raha_baseline
from api.settings import Settings, get_settings

router = APIRouter()


class ResultsSummary(BaseModel):
    dataset: str
    pipeline: str
    labeling_budget: int | None
    metrics: dict[str, Any] | None
    comparison: list[dict[str, Any]]
    raha: dict[str, Any] | None


class AccuracyPage(BaseModel):
    total: int
    correct: int
    accuracy: float
    rows: list[dict[str, Any]]


def _pipeline(settings: Settings, name: str) -> Path:
    path = store.resolve_pipeline(settings.pipelines_dir, name)
    if path is None:
        raise HTTPException(status_code=404, detail="Unknown pipeline")
    return path


def _accuracy(settings: Settings, name: str) -> dict[str, Any]:
    path = _pipeline(settings, name)
    dataset = store.load_config(path).get("selected_dataset", "")
    try:
        return label_accuracy(path, settings.datasets_dir / dataset)
    except FileNotFoundError:
        raise HTTPException(status_code=409, detail="No saved user labels yet; finish the labeling step first")


@router.get("/pipelines/{name}/results", response_model=ResultsSummary)
def results(name: str, settings: Settings = Depends(get_settings)) -> ResultsSummary:
    config = store.load_config(_pipeline(settings, name))
    dataset = config.get("selected_dataset", "")
    budget = config.get("labeling_budget")
    return ResultsSummary(
        dataset=dataset,
        pipeline=name,
        labeling_budget=budget,
        metrics=latest_metrics(config),
        comparison=comparison_rows(settings.pipelines_dir, dataset),
        raha=raha_baseline(settings.raha_baseline_csv, int(budget or 0)),
    )


@router.get("/pipelines/{name}/label-accuracy", response_model=AccuracyPage)
def label_accuracy_page(
    name: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    settings: Settings = Depends(get_settings),
) -> AccuracyPage:
    result = _accuracy(settings, name)
    return AccuracyPage(
        total=result["total"],
        correct=result["correct"],
        accuracy=result["accuracy"],
        rows=result["rows"][offset : offset + limit],
    )


@router.get("/pipelines/{name}/label-accuracy.csv")
def label_accuracy_csv(name: str, settings: Settings = Depends(get_settings)) -> Response:
    rows = _accuracy(settings, name)["rows"]
    out = io.StringIO()
    fields = ["table", "row", "col", "val", "user_said_error", "truth_is_error", "clean_value", "correct"]
    writer = csv.DictWriter(out, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    return Response(
        content=out.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{name}-label-accuracy.csv"'},
    )
