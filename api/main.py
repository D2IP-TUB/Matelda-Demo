import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import services
from api.routes import detection as detection_routes
from api.routes import folding as folding_routes
from api.routes import jobs as jobs_routes
from api.routes import labeling as labeling_routes
from api.routes import matelda as matelda_routes
from api.routes import meta as meta_routes
from api.routes import pipelines as pipelines_routes
from api.routes import tables as tables_routes
from api.settings import get_settings


def _preload() -> None:
    try:
        services.preload()
    except Exception:
        logging.getLogger("api").exception("Preloading the ML backend failed")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # The first import of backend/ takes seconds; do it now so no request has to wait for it.
    if os.environ.get("API_PRELOAD", "1") != "0":
        threading.Thread(target=_preload, name="preload-backend", daemon=True).start()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Matelda API", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_settings().cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    router = APIRouter(prefix="/api")
    router.include_router(meta_routes.router)
    router.include_router(jobs_routes.router)
    router.include_router(matelda_routes.router)
    router.include_router(tables_routes.router)
    router.include_router(pipelines_routes.router)
    router.include_router(folding_routes.router)
    router.include_router(labeling_routes.router)
    router.include_router(detection_routes.router)
    app.include_router(router)
    return app


app = create_app()
