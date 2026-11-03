from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api import pipelines as store
from api import services
from api.folds import STALE_AFTER_QUALITY_FOLDS, apply_domain_folds, validate_domain_folds
from api.jobs import JobStore, get_job_store
from api.routes.matelda import JobStarted
from api.settings import Settings, get_settings
from api.tables import list_tables

router = APIRouter()


class DomainFoldsBody(BaseModel):
    domain_folds: dict[str, list[str]]


def _pipeline_dir(settings: Settings, name: str):
    path = store.resolve_pipeline(settings.pipelines_dir, name)
    if path is None:
        raise HTTPException(status_code=404, detail="Unknown pipeline")
    return path


@router.put("/pipelines/{name}/domain-folds")
def save_domain_folds(
    name: str, body: DomainFoldsBody, settings: Settings = Depends(get_settings)
) -> dict[str, list[str]]:
    path = _pipeline_dir(settings, name)
    dataset = store.load_config(path).get("selected_dataset")
    if not dataset:
        raise HTTPException(status_code=422, detail="Pipeline has no dataset")
    try:
        validate_domain_folds(body.domain_folds, list_tables(settings.datasets_dir / dataset))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    config = store.update_config(path, lambda c: apply_domain_folds(c, body.domain_folds))
    return config["domain_folds"]


class QualityFoldingBody(BaseModel):
    labeling_budget: int | None = Field(default=None, ge=1, le=100)
    selected_strategies: list[str] | None = None


def _run_domain_folding(path: Path, dataset: str, budget: int) -> dict[str, Any]:
    result = services.backend_dbf(dataset, budget)
    folds = result.get("domain_folds") or {}
    if not folds:
        raise RuntimeError("Domain folding produced no folds")
    store.update_config(path, lambda c: apply_domain_folds(c, folds))
    return {"domain_folds": folds}


def _run_quality_folding(
    path: Path, dataset: str, budget: int, domain_folds: dict[str, list[str]], strategies: list[str]
) -> dict[str, int]:
    cell_folds = services.backend_qbf(dataset, budget, domain_folds, strategies)
    if not cell_folds:
        raise RuntimeError("Quality folding produced no cell folds")

    def save(config: dict[str, Any]) -> dict[str, Any]:
        out = {k: v for k, v in config.items() if k not in STALE_AFTER_QUALITY_FOLDS}
        out["cell_folds"] = cell_folds
        return out

    store.update_config(path, save)
    return {
        "cell_fold_count": sum(len(folds) for folds in cell_folds.values()),
        "domain_count": len(cell_folds),
    }


@router.post("/pipelines/{name}/domain-folding", response_model=JobStarted)
def start_domain_folding(
    name: str,
    settings: Settings = Depends(get_settings),
    jobs: JobStore = Depends(get_job_store),
) -> JobStarted:
    path = _pipeline_dir(settings, name)
    config = store.load_config(path)
    dataset, budget = config.get("selected_dataset"), config.get("labeling_budget", 10)
    if not dataset:
        raise HTTPException(status_code=422, detail="Pipeline has no dataset")
    return JobStarted(job_id=jobs.submit(_run_domain_folding, path, dataset, budget))


@router.post("/pipelines/{name}/quality-folding", response_model=JobStarted)
def start_quality_folding(
    name: str,
    body: QualityFoldingBody | None = None,
    settings: Settings = Depends(get_settings),
    jobs: JobStore = Depends(get_job_store),
) -> JobStarted:
    path = _pipeline_dir(settings, name)
    body = body or QualityFoldingBody()
    config = store.load_config(path)
    if not config.get("domain_folds"):
        raise HTTPException(status_code=409, detail="Run domain folding first")
    if not config.get("selected_dataset"):
        raise HTTPException(status_code=422, detail="Pipeline has no dataset")

    def remember(c: dict[str, Any]) -> dict[str, Any]:
        out = dict(c)
        if body.labeling_budget is not None:
            out["labeling_budget"] = body.labeling_budget
        if body.selected_strategies is not None:
            out["selected_strategies"] = body.selected_strategies
        return out

    config = store.update_config(path, remember)
    return JobStarted(
        job_id=jobs.submit(
            _run_quality_folding,
            path,
            config["selected_dataset"],
            config.get("labeling_budget", 10),
            config["domain_folds"],
            config.get("selected_strategies", []),
        )
    )
