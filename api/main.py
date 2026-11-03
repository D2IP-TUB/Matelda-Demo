from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import jobs as jobs_routes
from api.routes import matelda as matelda_routes
from api.routes import meta as meta_routes
from api.routes import pipelines as pipelines_routes
from api.routes import tables as tables_routes
from api.settings import get_settings


def create_app() -> FastAPI:
    app = FastAPI(title="Matelda API")
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
    app.include_router(router)
    return app


app = create_app()
