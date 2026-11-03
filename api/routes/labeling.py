from pathlib import Path
from typing import Any

import pandas as pd

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from api import pipelines as store
from api import services
from api.datasets import require_dataset
from api.jobs import JobStore, get_job_store
from api.labeling import (
    Card,
    LabeledCell,
    RoomLabel,
    Verdict,
    sampled_keys,
    cards_for_keys,
    judge,
    merge_with_pool,
    sampled_to_cards,
)
from api.routes.matelda import JobStarted
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
    keys = sampled_keys(sampled)
    return CandidatesResponse(keys=keys, sample_size=len(keys))


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


USER_LABEL_COLUMNS = ["table", "is_error", "row", "col", "val", "domain_fold", "cell_fold"]


class PropagateBody(BaseModel):
    own: list[LabeledCell]
    room_labels: list[RoomLabel] = []
    player_id: str | None = None


def _run_propagation(
    path: Path, dataset: str, cell_folds: dict[str, Any], body: PropagateBody
) -> dict[str, Any]:
    own = [c.model_dump() for c in body.own]
    if body.player_id is not None:
        labeled, disputed = merge_with_pool(
            own, [label.model_dump() for label in body.room_labels], body.player_id, cell_folds
        )
    else:
        labeled, disputed = own, []
    pd.DataFrame(labeled, columns=USER_LABEL_COLUMNS).to_csv(path / "user_labels.csv", index=False)

    result = services.label_propagation(dataset, labeled, cell_folds, str(path))
    if not result or not result.get("labeled_cells"):
        raise RuntimeError("Propagation produced no labeled cells")

    def save(config: dict[str, Any]) -> dict[str, Any]:
        out = {k: v for k, v in config.items() if k != "error_detection"}
        out["propagation_results"] = result
        return out

    store.update_config(path, save)
    return {
        "labeled_count": len(result["labeled_cells"]),
        "propagated_count": sum(len(c.get("propagated_cells") or []) for c in result["labeled_cells"]),
        "disputed": disputed,
    }


@router.post("/pipelines/{name}/labeling/propagate", response_model=JobStarted)
def labeling_propagate(
    name: str,
    body: PropagateBody,
    settings: Settings = Depends(get_settings),
    jobs: JobStore = Depends(get_job_store),
) -> JobStarted:
    path, config = _load(settings, name)
    return JobStarted(
        job_id=jobs.submit(_run_propagation, path, config["selected_dataset"], config["cell_folds"], body)
    )


class PropagationPage(BaseModel):
    total: int
    propagated_total: int
    labeled_cells: list[dict[str, Any]]


@router.get("/pipelines/{name}/propagation", response_model=PropagationPage)
def propagation_results(
    name: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=200),
    settings: Settings = Depends(get_settings),
) -> PropagationPage:
    path = store.resolve_pipeline(settings.pipelines_dir, name)
    if path is None:
        raise HTTPException(status_code=404, detail="Unknown pipeline")
    results = store.load_config(path).get("propagation_results")
    if not results or not results.get("labeled_cells"):
        raise HTTPException(status_code=409, detail="Run label propagation first")
    cells = results["labeled_cells"]
    return PropagationPage(
        total=len(cells),
        propagated_total=sum(len(c.get("propagated_cells") or []) for c in cells),
        labeled_cells=cells[offset : offset + limit],
    )
