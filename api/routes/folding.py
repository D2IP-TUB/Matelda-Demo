from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api import pipelines as store
from api.folds import apply_domain_folds, validate_domain_folds
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
