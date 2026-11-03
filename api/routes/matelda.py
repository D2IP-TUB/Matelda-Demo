from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from api import services
from api.datasets import require_dataset
from api.jobs import JobStore, get_job_store
from api.settings import Settings, get_settings

router = APIRouter()


class JobStarted(BaseModel):
    job_id: str


class DomainFoldingRequest(BaseModel):
    dataset: str
    labeling_budget: int = Field(ge=1)


class QualityFoldingRequest(DomainFoldingRequest):
    domain_folds: dict[str, list[str]]
    selected_strategies: list[str]


class SampleRequest(DomainFoldingRequest):
    cell_folds: dict[str, Any]
    domain_folds: dict[str, list[str]]


class PropagateRequest(BaseModel):
    dataset: str
    labeled_cells: list[dict[str, Any]]


class DatasetRequest(BaseModel):
    dataset: str


# Handlers look up `services.<fn>` at call time so tests (and later work) can swap them.
@router.post("/folding/domain", response_model=JobStarted)
def folding_domain(
    body: DomainFoldingRequest,
    settings: Settings = Depends(get_settings),
    store: JobStore = Depends(get_job_store),
) -> JobStarted:
    require_dataset(body.dataset, settings)
    return JobStarted(
        job_id=store.submit(lambda: services.backend_dbf(body.dataset, body.labeling_budget))
    )


@router.post("/folding/quality", response_model=JobStarted)
def folding_quality(
    body: QualityFoldingRequest,
    settings: Settings = Depends(get_settings),
    store: JobStore = Depends(get_job_store),
) -> JobStarted:
    require_dataset(body.dataset, settings)
    return JobStarted(
        job_id=store.submit(
            lambda: services.backend_qbf(
                body.dataset, body.labeling_budget, body.domain_folds, body.selected_strategies
            )
        )
    )


@router.post("/labeling/sample", response_model=JobStarted)
def labeling_sample(
    body: SampleRequest,
    settings: Settings = Depends(get_settings),
    store: JobStore = Depends(get_job_store),
) -> JobStarted:
    require_dataset(body.dataset, settings)
    return JobStarted(
        job_id=store.submit(
            lambda: services.backend_sample_labeling(
                body.dataset, body.labeling_budget, body.cell_folds, body.domain_folds
            )
        )
    )


@router.post("/labeling/propagate", response_model=JobStarted)
def labeling_propagate(
    body: PropagateRequest,
    settings: Settings = Depends(get_settings),
    store: JobStore = Depends(get_job_store),
) -> JobStarted:
    require_dataset(body.dataset, settings)
    return JobStarted(
        job_id=store.submit(
            lambda: services.backend_label_propagation(body.dataset, body.labeled_cells)
        )
    )


@router.post("/errors", response_model=JobStarted)
def errors(
    body: DatasetRequest,
    settings: Settings = Depends(get_settings),
    store: JobStore = Depends(get_job_store),
) -> JobStarted:
    require_dataset(body.dataset, settings)
    return JobStarted(job_id=store.submit(lambda: services.backend_pull_errors(body.dataset)))
