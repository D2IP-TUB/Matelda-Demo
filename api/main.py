from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import jobs as jobs_routes
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

    @router.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    router.include_router(jobs_routes.router)
    app.include_router(router)
    return app


app = create_app()
