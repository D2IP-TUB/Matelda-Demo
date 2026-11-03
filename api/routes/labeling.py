from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api import pipelines as store
from api import services
from api.datasets import require_dataset
from api.labeling import Card, Verdict, candidate_keys, cards_for_keys, judge, sampled_to_cards
from api.settings import Settings, get_settings

router = APIRouter()


def _load(settings: Settings, name: str) -> tuple[Path, dict[str, Any]]:
    path = store.resolve_pipeline(settings.pipelines_dir, name)
    if path is None:
        raise HTTPException(status_code=404, detail="Unknown pipeline")
    config = store.load_config(path)
    if not config.get("cell_folds"):
        raise HTTPException(status_code=409, detail="Run quality folding first")
    return path, config


def _sample(path: Path, config: dict[str, Any]) -> list[dict[str, Any]]:
    return services.sample_labeling(
        config["selected_dataset"],
        config.get("labeling_budget", 10),
        config["cell_folds"],
        config.get("domain_folds", {}),
        str(path),
    )


class SampleResponse(BaseModel):
    cards: list[Card]
    bulk_annotated_folds: int


class CandidatesResponse(BaseModel):
    keys: list[str]
    sample_size: int


class CardsBody(BaseModel):
    keys: list[str] = Field(max_length=500)


class JudgeBody(BaseModel):
    verdicts: list[Verdict] = Field(max_length=500)


class JudgeResponse(BaseModel):
    correct: list[bool | None]


@router.get("/pipelines/{name}/labeling/sample", response_model=SampleResponse)
def labeling_sample(name: str, settings: Settings = Depends(get_settings)) -> SampleResponse:
    path, config = _load(settings, name)
    return SampleResponse(
        cards=sampled_to_cards(_sample(path, config)),
        bulk_annotated_folds=len(config.get("cell_fold_labels", {})),
    )


@router.get("/pipelines/{name}/labeling/candidates", response_model=CandidatesResponse)
def labeling_candidates(name: str, settings: Settings = Depends(get_settings)) -> CandidatesResponse:
    path, config = _load(settings, name)
    sampled = _sample(path, config)
    skip = set(config.get("cell_fold_labels", {}))
    return CandidatesResponse(
        keys=candidate_keys(sampled, config["cell_folds"], skip), sample_size=len(sampled)
    )


@router.post("/pipelines/{name}/labeling/cards", response_model=list[Card])
def labeling_cards(name: str, body: CardsBody, settings: Settings = Depends(get_settings)) -> list[Card]:
    _, config = _load(settings, name)
    return cards_for_keys(config["cell_folds"], body.keys)


@router.post("/datasets/{dataset}/judge", response_model=JudgeResponse)
def judge_verdicts(
    body: JudgeBody,
    dataset: str = Depends(require_dataset),
    settings: Settings = Depends(get_settings),
) -> JudgeResponse:
    return JudgeResponse(correct=judge(settings.datasets_dir / dataset, body.verdicts))
