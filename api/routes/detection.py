import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api import pipelines as store
from api import services
from api.jobs import JobStore, get_job_store
from api.routes.matelda import JobStarted
from api.settings import Settings, get_settings

router = APIRouter()


class DetectionSummary(BaseModel):
    time: str
    metrics: dict[str, Any]
    tables: dict[str, int]


class ErrorsPage(BaseModel):
    errors: list[dict[str, Any]]
    total: int


def _pipeline_dir(settings: Settings, name: str) -> Path:
    path = store.resolve_pipeline(settings.pipelines_dir, name)
    if path is None:
        raise HTTPException(status_code=404, detail="Unknown pipeline")
    return path


def _summary(detection: dict[str, Any]) -> DetectionSummary:
    return DetectionSummary(
        time=detection.get("time", ""),
        metrics=detection.get("metrics", {}),
        tables={t: len(errors) for t, errors in detection.get("propagated_errors", {}).items()},
    )


def _run_detection(path: Path, dataset: str, propagation_results: dict[str, Any]) -> dict[str, Any]:
    result = services.pull_errors(dataset, propagation_results, str(path))
    errors = (result or {}).get("propagated_errors") or {}
    if not errors:
        raise RuntimeError("Error detection produced no result")
    detection = {
        "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "metrics": result.get("metrics", {}),
        "propagated_errors": errors,
    }
    store.update_config(path, lambda c: {**c, "error_detection": detection})
    return _summary(detection).model_dump()


@router.post("/pipelines/{name}/error-detection", response_model=JobStarted)
def start_error_detection(
    name: str,
    settings: Settings = Depends(get_settings),
    jobs: JobStore = Depends(get_job_store),
) -> JobStarted:
    path = _pipeline_dir(settings, name)
    config = store.load_config(path)
    propagation = config.get("propagation_results")
    if not propagation or not propagation.get("labeled_cells"):
        raise HTTPException(status_code=409, detail="Run label propagation first")
    return JobStarted(job_id=jobs.submit(_run_detection, path, config["selected_dataset"], propagation))


@router.get("/pipelines/{name}/error-detection", response_model=DetectionSummary)
def error_detection_summary(name: str, settings: Settings = Depends(get_settings)) -> DetectionSummary:
    detection = store.read_config(_pipeline_dir(settings, name)).get("error_detection")
    if not detection:
        raise HTTPException(status_code=404, detail="No error detection result yet")
    return _summary(detection)


@router.get("/pipelines/{name}/error-detection/errors", response_model=ErrorsPage)
def detected_errors(
    name: str,
    table: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    settings: Settings = Depends(get_settings),
) -> ErrorsPage:
    detection = store.read_config(_pipeline_dir(settings, name)).get("error_detection") or {}
    errors = detection.get("propagated_errors", {}).get(table, [])
    return ErrorsPage(errors=errors[offset : offset + limit], total=len(errors))
