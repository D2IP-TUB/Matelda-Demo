from fastapi import APIRouter, Depends

from api import services
from api.datasets import list_datasets
from api.settings import Settings, get_settings

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/datasets")
def datasets(settings: Settings = Depends(get_settings)) -> list[str]:
    return list_datasets(settings.datasets_dir)


@router.get("/strategies")
def strategies() -> list[str]:
    return services.get_available_strategies()
