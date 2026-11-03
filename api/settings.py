import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    datasets_dir: Path
    cors_origins: list[str]


def get_settings() -> Settings:
    origins = os.environ.get("API_CORS_ORIGINS", "http://localhost:5173")
    return Settings(
        datasets_dir=REPO_ROOT / "datasets",
        cors_origins=[o.strip() for o in origins.split(",") if o.strip()],
    )
