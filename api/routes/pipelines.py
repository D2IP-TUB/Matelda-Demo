from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from api import pipelines as store
from api.datasets import list_datasets, resolve_dataset
from api.settings import Settings, get_settings

router = APIRouter()


class PipelineConfig(BaseModel):
    selected_dataset: str
    labeling_budget: int = Field(ge=1, le=100)
    selected_strategies: list[str]


class CreatePipeline(BaseModel):
    name: str
    config: PipelineConfig


class CopyPipeline(BaseModel):
    new_name: str


class PipelineName(BaseModel):
    name: str


def _check_dataset(settings: Settings, dataset: str) -> None:
    if resolve_dataset(settings.datasets_dir, dataset) is None:
        raise HTTPException(status_code=422, detail="Unknown dataset")


def _check_name(name: str) -> None:
    if not store.valid_name(name):
        raise HTTPException(status_code=422, detail="Invalid pipeline name")


@router.get("/pipelines")
def pipelines(settings: Settings = Depends(get_settings)) -> list[str]:
    return store.list_pipelines(settings.pipelines_dir)


@router.get("/pipelines/suggest-name", response_model=PipelineName)
def suggest_name(
    dataset: str,
    suffix: str = Query(pattern=r"^[A-Za-z0-9]{1,12}$"),
    settings: Settings = Depends(get_settings),
) -> PipelineName:
    if dataset not in list_datasets(settings.datasets_dir):
        raise HTTPException(status_code=404, detail="Unknown dataset")
    return PipelineName(name=store.suggest_name(settings.pipelines_dir, dataset, suffix))


@router.get("/pipelines/{name}")
def get_pipeline(name: str, settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    path = store.resolve_pipeline(settings.pipelines_dir, name)
    if path is None:
        raise HTTPException(status_code=404, detail="Unknown pipeline")
    return store.public_config(store.load_config(path))


@router.post("/pipelines", status_code=201, response_model=PipelineName)
def create(body: CreatePipeline, settings: Settings = Depends(get_settings)) -> PipelineName:
    _check_name(body.name)
    _check_dataset(settings, body.config.selected_dataset)
    try:
        store.create_pipeline(settings.pipelines_dir, body.name, body.config.model_dump())
    except FileExistsError:
        raise HTTPException(status_code=409, detail="A pipeline with that name already exists")
    return PipelineName(name=body.name)


@router.put("/pipelines/{name}")
def update(
    name: str, body: PipelineConfig, settings: Settings = Depends(get_settings)
) -> dict[str, Any]:
    path = store.resolve_pipeline(settings.pipelines_dir, name)
    if path is None:
        raise HTTPException(status_code=404, detail="Unknown pipeline")
    _check_dataset(settings, body.selected_dataset)
    merged = store.apply_update(store.load_config(path), body.model_dump())
    store.save_config(path, merged)
    return store.public_config(merged)


@router.post("/pipelines/{name}/copy", status_code=201, response_model=PipelineName)
def copy(name: str, body: CopyPipeline, settings: Settings = Depends(get_settings)) -> PipelineName:
    _check_name(body.new_name)
    if store.resolve_pipeline(settings.pipelines_dir, name) is None:
        raise HTTPException(status_code=404, detail="Unknown pipeline")
    try:
        store.copy_pipeline(settings.pipelines_dir, name, body.new_name)
    except FileExistsError:
        raise HTTPException(status_code=409, detail="A pipeline with that name already exists")
    return PipelineName(name=body.new_name)
